// Projeler ve kayıtlar (kartlar). Liste uçları sayfalıdır; yalnız kullanıcının görebildiği veri döner.
import { Router } from 'express';
import { z } from 'zod';
import { HttpHata } from '../hata.js';
import { okuyabilir, fnErisim, yonetici } from '../kurallar/yetki.js';
import { degerDb, degerApi } from '../kurallar/degerler.js';
import { tanimlar, yeniId, logYaz } from '../veri.js';
import { limitYeter, onaylayanBul, ANA_PB, pbNormal } from '../kurallar/fiyatOnay.js';
import { kurlar } from '../kur.js';
import { eforEylem, digerleriniDurdur } from '../kurallar/efor.js';
import { kaydet, durumDegistir, sil, kayitLog, projeKisileri, gorunurDegerler, projeApi, kartApi, aliciTemizle, kayitBaglari } from '../kayitServis.js';
import { mesajBildir, dilliBildir, FIYAT_METIN } from '../bildirimServis.js';

import { EkSema } from '../kurallar/ekler.js';
import { kayitGorur } from '../kurallar/misafir.js';

const r = Router();
const Sayfa = z.object({ sayfa: z.coerce.number().int().min(1).default(1), adet: z.coerce.number().int().min(1).max(1000).default(500) });

// ---------- projeler ----------
r.get('/projeler', async (req, res) => {
  const u = req.kullanici, db = req.db, tanim = await tanimlar(req);
  const q = Sayfa.extend({ arsiv: z.enum(['0', '1']).optional(), degerler: z.enum(['0', '1']).optional() }).parse(req.query);
  let s = db('projeler').where({ silindi: false });
  if (q.arsiv !== '1') s = s.andWhere({ arsiv: false });
  const satirlar = (await s.orderBy('kod').limit(q.adet).offset((q.sayfa - 1) * q.adet)).filter((p) => kayitGorur(u, 'proje', p.id));
  const ids = satirlar.map((p) => p.id);
  const kisiler = await projeKisileri(db, ids);
  const projeModul = tanim.moduller.find((m) => m.tur === 'proje');
  // Proje adı/kodu seçim listeleri için herkese gerekir; proje alanları yalnız ana modülü görebilene gider.
  let degerler = [];
  if (q.degerler !== '0' && projeModul && okuyabilir(u, projeModul.id) && ids.length) {
    const d = [];
    for (let i = 0; i < ids.length; i += 500) d.push(...await db('degerler').whereIn('proje_id', ids.slice(i, i + 500)).whereNull('kart_id'));
    degerler = gorunurDegerler(u, tanim, d, kisiler);
  }
  res.json({ projeler: satirlar.map((p) => projeApi(p, kisiler.get(p.id))), degerler, sayfa: q.sayfa, adet: q.adet });
});

// Kaydın bağlı kayıtları: karşı taraf kullanıcının görebildiği bir kayıtsa döner
async function gorulenBaglar(req, id) {
  const u = req.kullanici, db = req.db;
  const L = await db('kayit_baglari').where({ kaynak_id: id }).orWhere({ hedef_id: id });
  const out = [];
  for (const b of L) {
    const [tur, karsi] = b.kaynak_id === id ? [b.hedef_tur, b.hedef_id] : [b.kaynak_tur, b.kaynak_id];
    const x = await db(tur === 'proje' ? 'projeler' : 'kartlar').where({ id: karsi, silindi: false }).first();
    if (!x || (tur === 'kart' && !okuyabilir(u, x.modul_id))) continue;
    out.push({ id: b.id, kaynakTur: b.kaynak_tur, kaynakId: b.kaynak_id, hedefTur: b.hedef_tur, hedefId: b.hedef_id, aktarim: b.aktarim || '' });
  }
  return out;
}

r.get('/projeler/:id', async (req, res) => {
  const u = req.kullanici, db = req.db, tanim = await tanimlar(req);
  const p = await db('projeler').where({ id: req.params.id, silindi: false }).first();
  if (!p || !kayitGorur(u, 'proje', p.id)) throw new HttpHata(404, 'Proje bulunamadı');
  const kisiler = await projeKisileri(db, [p.id]);
  const pm = tanim.moduller.find((m) => m.tur === 'proje');
  const okur = pm && okuyabilir(u, pm.id);
  const degerler = okur ? gorunurDegerler(u, tanim, await db('degerler').where({ proje_id: p.id }).whereNull('kart_id'), kisiler) : [];
  res.json({ proje: projeApi(p, kisiler.get(p.id)), degerler, log: okur && kayitGorur(u, 'proje', p.id, true) ? await kayitLog(db, 'proje', p.id) : [], baglar: await gorulenBaglar(req, p.id) });
});
r.post('/projeler', async (req, res) => res.status(201).json(await kaydet(req, 'proje', null, req.body)));
r.put('/projeler/:id', async (req, res) => res.json(await kaydet(req, 'proje', req.params.id, req.body)));
r.patch('/projeler/:id/durum', async (req, res) => res.json(await durumDegistir(req, 'proje', req.params.id, z.object({ durumId: z.string().max(40) }).parse(req.body).durumId)));
r.delete('/projeler/:id', async (req, res) => res.json(await sil(req, 'proje', req.params.id)));

// ---------- kayıtlar ----------
r.get('/kartlar', async (req, res) => {
  const u = req.kullanici, db = req.db, tanim = await tanimlar(req);
  const q = Sayfa.extend({ modul: z.string().max(40).optional(), proje: z.string().max(40).optional(), durum: z.string().max(40).optional() }).parse(req.query);
  const izinli = tanim.moduller.filter((m) => m.tur !== 'proje' && okuyabilir(u, m.id)).map((m) => m.id);
  if (q.modul && !izinli.includes(q.modul)) throw new HttpHata(403, 'Bu modülü görme yetkin yok');
  let s = db('kartlar as k').join('projeler as p', 'p.id', 'k.proje_id').where('k.silindi', false).andWhere('p.silindi', false)
    .whereIn('k.modul_id', q.modul ? [q.modul] : (izinli.length ? izinli : ['__yok']));
  if (q.proje) s = s.andWhere('k.proje_id', q.proje);
  if (q.durum) s = s.andWhere('k.durum_id', q.durum);
  const kartlar = (await s.select('k.*').orderBy('k.kod').limit(q.adet).offset((q.sayfa - 1) * q.adet)).filter((k) => kayitGorur(u, 'kart', k.id));
  const ids = kartlar.map((k) => k.id);
  const d = [];
  for (let i = 0; i < ids.length; i += 500) d.push(...await db('degerler').whereIn('kart_id', ids.slice(i, i + 500)));
  const kisiler = await projeKisileri(db, [...new Set(kartlar.map((k) => k.proje_id))]);
  res.json({ kartlar: kartlar.map(kartApi), degerler: gorunurDegerler(u, tanim, d, kisiler), sayfa: q.sayfa, adet: q.adet });
});

r.get('/kartlar/:id', async (req, res) => {
  const u = req.kullanici, db = req.db, tanim = await tanimlar(req);
  const k = await db('kartlar').where({ id: req.params.id, silindi: false }).first();
  if (!k || !okuyabilir(u, k.modul_id) || !kayitGorur(u, 'kart', k.id)) throw new HttpHata(404, 'Kayıt bulunamadı');
  const kisiler = await projeKisileri(db, [k.proje_id]);
  res.json({ kart: kartApi(k), degerler: gorunurDegerler(u, tanim, await db('degerler').where({ kart_id: k.id }), kisiler), log: await kayitLog(db, 'kart', k.id), baglar: await gorulenBaglar(req, k.id) });
});
r.post('/kartlar', async (req, res) => res.status(201).json(await kaydet(req, 'kart', null, req.body)));
r.put('/kartlar/:id', async (req, res) => res.json(await kaydet(req, 'kart', req.params.id, req.body)));
r.patch('/kartlar/:id/durum', async (req, res) => res.json(await durumDegistir(req, 'kart', req.params.id, z.object({ durumId: z.string().max(40) }).parse(req.body).durumId)));
r.delete('/kartlar/:id', async (req, res) => res.json(await sil(req, 'kart', req.params.id)));

// ---------- mesaj: kaydı açıp Kaydet'e basmadan mesaj yazma ----------
// Kayda mesaj yazar (masaüstü, mobil ve "Notlarım"dan taşıma aynı yoldan geçer).
// fnUid verilmezse modülün yazma yetkisi olan ilk mesaj fonksiyonu kullanılır.
export async function mesajYaz(req, v) {
  const u = req.kullanici, db = req.db, tanim = await tanimlar(req);
  if (!v.metin && !(v.ekler || []).length) throw new HttpHata(400, 'Mesaj boş');
  const kayit = v.kartId ? await db('kartlar').where({ id: v.kartId, silindi: false }).first() : await db('projeler').where({ id: v.projeId, silindi: false }).first();
  if (!kayit || !kayitGorur(u, v.kartId ? 'kart' : 'proje', kayit.id, !v.kartId)) throw new HttpHata(404, 'Kayıt bulunamadı');
  const m = v.kartId ? tanim.modul(kayit.modul_id) : tanim.moduller.find((x) => x.tur === 'proje');
  const f = m?.fn.find((x) => x.tip === 'mesaj' && (v.fnUid ? x.uid === v.fnUid : fnErisim(u, x) === 'duzenle'));
  if (!f || !okuyabilir(u, m.id) || fnErisim(u, f) !== 'duzenle') throw new HttpHata(403, 'Bu kayda mesaj yazma yetkin yok');
  const ortak = { modulId: m.id, projeId: v.kartId ? kayit.proje_id : kayit.id, kartId: v.kartId || null };
  const id = yeniId(), zaman = new Date();
  const alici = aliciTemizle(v.alici, u.id);
  await db('degerler').insert({ ...degerDb({ id, fnUid: f.uid, fnTip: 'mesaj', metin: v.metin, kisi: u.id, ustId: v.ustId || null, zaman: zaman.toISOString(), okuyan: [u.id], alici, ekler: v.ekler || [] }, ortak), olusturan: u.id, olusturma: zaman, guncelleyen: u.id, guncelleme: zaman });
  await mesajBildir(req, { projeId: ortak.projeId, kartId: ortak.kartId, alici, metin: v.metin, kod: kayit.kod, baslik: v.kartId ? '' : kayit.ad });
  return { id, zaman: zaman.toISOString() };
}
export const MesajSema = z.object({ projeId: z.string().max(40).default(''), kartId: z.string().max(40).optional().nullable(), fnUid: z.string().max(40).optional(), metin: z.string().trim().max(10000).default(''), ustId: z.string().max(40).optional().nullable(), alici: z.array(z.string().max(40)).max(50).optional(), ekler: EkSema });

r.post('/mesaj', async (req, res) => {
  res.status(201).json(await mesajYaz(req, MesajSema.parse(req.body)));
});

// Fiyat onayı: atanan kişi (ya da yönetim) onaylar / reddeder. Limiti yetmeyen onaylayan, onayı bir üste gönderir.
const FIYAT_AD = { bekliyor: 'Onay bekliyor', onaylandi: 'Onaylandı', reddedildi: 'Reddedildi' };
export async function fiyatOnayla(req, v) {
  const u = req.kullanici, db = req.db, t = await tanimlar(req), proj = v.tur === 'proje';
  const k = await db(proj ? 'projeler' : 'kartlar').where({ id: v.id, silindi: false }).first();
  if (!k || !kayitGorur(u, v.tur, k.id, proj)) throw new HttpHata(404, 'Kayıt bulunamadı');
  const m = proj ? t.moduller.find((x) => x.tur === 'proje') : t.modul(k.modul_id);
  if (!m || !okuyabilir(u, m.id)) throw new HttpHata(403, 'Bu kaydı görme yetkin yok');
  const f = m.fn.find((x) => x.uid === v.fnUid && x.tip === 'fiyatonay');
  if (!f) throw new HttpHata(404, 'Fiyat onayı bulunamadı');
  const sat = await db('degerler').where(proj ? { proje_id: v.id, kart_id: null, fn_uid: f.uid } : { kart_id: v.id, fn_uid: f.uid }).first();
  if (!sat) throw new HttpHata(404, 'Fiyat onayı bulunamadı');
  const r = degerApi(sat);
  if (r.onay !== 'bekliyor') throw new HttpHata(409, 'Bu fiyat onay beklemiyor');
  if (r.kisi !== u.id && !yonetici(u)) throw new HttpHata(403, 'Bu onay sana atanmamış');
  const kul = await db('kullanicilar').select('id', 'ad', 'rol', 'aktif', 'sistem', 'ust_id', 'onay_limit');
  const kurL = ANA_PB.includes(pbNormal(r.para)) ? {} : await kurlar();
  let sonuc, sonraki = null;
  if (v.karar === 'red') sonuc = 'reddedildi';
  else if (limitYeter(u, r.tutar, r.para, kurL)) sonuc = 'onaylandi';
  else { sonraki = onaylayanBul(kul, u.id, r.tutar, r.para, kurL); sonuc = 'bekliyor'; }
  const yeni = { ...r, onay: sonuc, kisi: sonuc === 'bekliyor' ? (sonraki?.id || '') : r.kisi, onaylayan: u.id, onayZaman: new Date().toISOString(), not: v.not || '' };
  const ortak = { projeId: proj ? k.id : k.proje_id, modulId: m.id, kartId: proj ? null : k.id };
  const { id: _i, ...satir } = degerDb(yeni, ortak);
  await db.transaction(async (trx) => {
    await trx('degerler').where({ id: sat.id }).update({ ...satir, guncelleyen: u.id, guncelleme: new Date() });
    const metin = sonuc === 'bekliyor' ? `${f.ad}: ${u.ad} onayı üst yöneticiye gönderdi` : `${f.ad}: ${FIYAT_AD[sonuc]}${v.not ? ' — ' + v.not : ''}`;
    await logYaz(trx, u, ortak, { tip: 'alan', alan: f.ad, eski: FIYAT_AD.bekliyor, yeni: sonuc === 'bekliyor' ? FIYAT_AD.bekliyor + ' · ' + (sonraki?.ad || '') : FIYAT_AD[sonuc], metin });
  });
  const tutar = `${r.tutar} ${r.para || 'TRY'}`, url = `/m/#${proj ? 'p' : 'k'}=${k.id}`;
  if (sonuc === 'bekliyor' && sonraki) await dilliBildir(req, [sonraki.id], { baslik: k.kod, metinler: FIYAT_METIN.bekliyor, args: [u.ad, tutar], url, etiket: 'fo:' + k.id });
  else if (sonuc !== 'bekliyor' && r.talep && r.talep !== u.id) await dilliBildir(req, [r.talep], { baslik: k.kod, metinler: FIYAT_METIN[sonuc], args: [u.ad, tutar], url, etiket: 'fo:' + k.id });
  return { onay: sonuc, kisi: yeni.kisi };
}
export const FiyatOnaySema = z.object({ tur: z.enum(['proje', 'kart']), id: z.string().max(40), fnUid: z.string().max(40), karar: z.enum(['onay', 'red']), not: z.string().trim().max(1000).default('') });
r.post('/fiyat-onay', async (req, res) => res.json(await fiyatOnayla(req, FiyatOnaySema.parse(req.body || {}))));

// Efor: Başla / Mola / Devam / Bitir. Satırlar anında yazılır (formdaki kaydetmeyi beklemez).
// Başla denince kişinin başka kayıtlardaki açık sayacı durdurulur (aynı anda tek açık iş).
export async function eforIsle(req, v) {
  const u = req.kullanici, db = req.db, t = await tanimlar(req), proj = v.tur === 'proje';
  const k = await db(proj ? 'projeler' : 'kartlar').where({ id: v.id, silindi: false }).first();
  if (!k || !kayitGorur(u, v.tur, k.id, proj)) throw new HttpHata(404, 'Kayıt bulunamadı');
  const m = proj ? t.moduller.find((x) => x.tur === 'proje') : t.modul(k.modul_id);
  const f = m?.fn.find((x) => x.uid === v.fnUid && x.tip === 'efor');
  if (!f) throw new HttpHata(404, 'Efor fonksiyonu bulunamadı');
  if (!okuyabilir(u, m.id) || fnErisim(u, f) !== 'duzenle') throw new HttpHata(403, 'Bu kayıtta efor girme yetkin yok');
  const ortak = { projeId: proj ? k.id : k.proje_id, modulId: m.id, kartId: proj ? null : k.id };
  const simdi = new Date();
  await db.transaction(async (trx) => {
    const buKayit = (await trx('degerler').where(proj ? { proje_id: k.id, kart_id: null, fn_uid: f.uid } : { kart_id: k.id, fn_uid: f.uid })).map(degerApi);
    let sonuc;
    try { sonuc = eforEylem(buKayit, u.id, v.eylem, simdi); } catch (e) { throw new HttpHata(409, e.message); }
    if ((v.eylem === 'basla' || v.eylem === 'devam') && sonuc.ekle.length) {
      const acik = (await trx('degerler').where({ fn_tip: 'efor', kisi: u.id }).whereNull('adet').whereIn('tur', ['calisma', 'mola'])).map(degerApi).filter((r) => !buKayit.some((x) => x.id === r.id));
      for (const x of digerleriniDurdur(acik, simdi)) {
        await trx('degerler').where({ id: x.id }).update({ adet: x.adet, guncelleyen: u.id, guncelleme: simdi });
        const r = x.kayit;
        await trx('degerler').insert({ ...degerDb({ id: yeniId(), fnUid: r.fnUid, fnTip: 'efor', kisi: u.id, tur: 'durdu', zaman: simdi.toISOString(), adet: '0', sira: (r.sira || 0) + 1 }, { projeId: r.projeId, modulId: r.modulId, kartId: r.kartId }), olusturan: u.id, olusturma: simdi, guncelleyen: u.id, guncelleme: simdi });
      }
    }
    for (const x of sonuc.kapat) await trx('degerler').where({ id: x.id }).update({ adet: x.adet, guncelleyen: u.id, guncelleme: simdi });
    let sira = buKayit.reduce((a, r) => Math.max(a, r.sira || 0), 0);
    for (const e of sonuc.ekle) {
      await trx('degerler').insert({ ...degerDb({ id: yeniId(), fnUid: f.uid, fnTip: 'efor', kisi: u.id, tur: e.tur, zaman: e.zaman, adet: e.adet, sira: ++sira }, ortak), olusturan: u.id, olusturma: simdi, guncelleyen: u.id, guncelleme: simdi });
    }
    const AD = { basla: 'başladı', devam: 'devam etti', mola: 'molaya çıktı', bitir: 'işi bitirdi' };
    if (sonuc.ekle.length) await logYaz(trx, u, ortak, { tip: 'alan', alan: f.ad, eski: '', yeni: AD[v.eylem], metin: `${f.ad}: ${u.ad} ${AD[v.eylem]}` });
  });
  return { ok: true };
}
export const EforSema = z.object({ tur: z.enum(['proje', 'kart']), id: z.string().max(40), fnUid: z.string().max(40), eylem: z.enum(['basla', 'devam', 'mola', 'bitir']) });
r.post('/efor', async (req, res) => res.json(await eforIsle(req, EforSema.parse(req.body || {}))));
// Kişinin açık sayaçları (unutulan sayaç uyarısı ve "şu an üzerinde çalıştığım iş")
r.get('/efor/acik', async (req, res) => {
  const L = (await req.db('degerler').where({ fn_tip: 'efor', kisi: req.kullanici.id }).whereNull('adet').whereIn('tur', ['calisma', 'mola'])).map(degerApi);
  res.json(L.map((x) => ({ projeId: x.projeId, kartId: x.kartId || null, fnUid: x.fnUid, tur: x.tur, zaman: x.zaman })));
});

export default r;
