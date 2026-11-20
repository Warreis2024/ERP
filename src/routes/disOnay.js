// Dış onay (QR) uçları.
//  • Oturumlu: bağlantı oluştur / listele / iptal (yalnız kaydı yazabilen kullanıcı).
//  • Herkese açık (/api/dis/:anahtar): şifresiz, süreli; yalnız o bağlantının belgesini gösterir ve tek bir yanıt alır.
// Bütün sorgular Knex ile parametrelidir; anahtar biçimi ve gövde zod/elle doğrulanır.
import { Router } from 'express';
import { z } from 'zod';
import { kayitGorur } from '../kurallar/misafir.js';
import { HttpHata } from '../hata.js';
import { json } from '../db.js';
import { yazabilir, okuyabilir, fnErisim } from '../kurallar/yetki.js';
import { tanimlar, yeniId, logYaz } from '../veri.js';
import { sifrele, coz } from '../baglanti/kasa.js';
import { ANAHTAR_RE, SINIR, anahtarUret, anahtarOzet, musteriAlanlari, yanitDogrula, hizSiniri } from '../disOnay.js';

const Kimlik = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);
const OlusturSema = z.object({
  kartId: Kimlik,
  fnUid: Kimlik,
  saat: z.number().int().min(SINIR.saatEn).max(SINIR.saatEnCok).default(SINIR.varsayilanSaat),
  belge: z.string().min(1).max(SINIR.belge),
});

const disApi = (r, u) => {
  const acik = r.durum === 'bekliyor' && new Date(r.son_gecerlilik) > new Date();
  let anahtar = null;
  if (acik && u) { try { anahtar = coz(r.anahtar_sifreli)?.a || null; } catch { anahtar = null; } }
  return {
    id: r.id, kartId: r.kart_id, fnUid: r.fn_uid, durum: acik ? 'bekliyor' : r.durum === 'bekliyor' ? 'suresi-doldu' : r.durum,
    son: r.son_gecerlilik ? new Date(r.son_gecerlilik).toISOString() : null,
    olusturma: r.olusturma ? new Date(r.olusturma).toISOString() : null, olusturan: r.olusturan,
    alanlar: json.oku(r.alanlar, []), onay: !!r.onay_istenir, not: !!r.not_istenir,
    yanit: json.oku(r.yanit, null), yanitZaman: r.yanit_zaman ? new Date(r.yanit_zaman).toISOString() : null,
    yanitIp: r.yanit_ip || null, yanitTarayici: r.yanit_tarayici || null,
    anahtar,
  };
};

async function kartVeAlan(req, kartId, fnUid) {
  const kart = await req.db('kartlar').where({ id: kartId, silindi: false }).first();
  if (!kart || !kayitGorur(req.kullanici, 'kart', kart.id)) throw new HttpHata(404, 'Kayıt bulunamadı');
  const tanim = await tanimlar(req);
  const m = tanim.modul(kart.modul_id);
  const f = m?.fn.find((x) => x.uid === fnUid && x.tip === 'sablon');
  if (!m || !f) throw new HttpHata(400, 'Şablon alanı bulunamadı');
  return { kart, m, f };
}

// ---------- oturumlu ----------
export const disYonetim = Router();

disYonetim.post('/dis-onay', async (req, res) => {
  const v = OlusturSema.parse(req.body || {});
  const u = req.kullanici;
  const { kart, m, f } = await kartVeAlan(req, v.kartId, v.fnUid);
  if (!yazabilir(u, m.id) || fnErisim(u, f) !== 'duzenle') throw new HttpHata(403, 'Bu alanda yazma yetkin yok');
  // Onay / not seçenekleri şablon ayarından (istemciye güvenilmez)
  const deger = await req.db('degerler').where({ kart_id: kart.id, fn_uid: f.uid }).first();
  const sb = deger?.tur ? await req.db('sablonlar').where({ id: deger.tur }).first() : null;
  const dis = json.oku(sb?.tanim, {})?.dis || {};
  const anahtar = anahtarUret();
  const simdi = new Date();
  const kayit = {
    id: yeniId(), anahtar_ozet: anahtarOzet(anahtar), anahtar_sifreli: sifrele({ a: anahtar }),
    kart_id: kart.id, proje_id: kart.proje_id, modul_id: m.id, fn_uid: f.uid,
    baslik: String(sb?.ad || f.ad).slice(0, 200), belge: v.belge, alanlar: json.yaz(musteriAlanlari(v.belge)),
    onay_istenir: dis.onay !== false, not_istenir: dis.not !== false,
    son_gecerlilik: new Date(simdi.getTime() + v.saat * 3600_000), durum: 'bekliyor',
    olusturan: u.id, olusturma: simdi, guncelleyen: u.id, guncelleme: simdi,
  };
  await req.db.transaction(async (trx) => {
    // Aynı alanda tek etkin bağlantı: öncekiler iptal edilir
    await trx('dis_onaylar').where({ kart_id: kart.id, fn_uid: f.uid, durum: 'bekliyor' }).update({ durum: 'iptal', guncelleyen: u.id, guncelleme: simdi });
    await trx('dis_onaylar').insert(kayit);
    await logYaz(trx, u, { projeId: kart.proje_id, modulId: m.id, kartId: kart.id }, { tip: 'alan', alan: f.ad, metin: `Dış onay bağlantısı oluşturuldu (${v.saat} saat geçerli)` });
  });
  res.status(201).json(disApi(kayit, u));
});

disYonetim.get('/dis-onay', async (req, res) => {
  const kartId = Kimlik.parse(req.query.kartId);
  const kart = await req.db('kartlar').where({ id: kartId }).first();
  if (!kart || !kayitGorur(req.kullanici, 'kart', kart.id)) throw new HttpHata(404, 'Kayıt bulunamadı');
  if (!okuyabilir(req.kullanici, kart.modul_id)) throw new HttpHata(403, 'Yetkin yok');
  const L = await req.db('dis_onaylar').where({ kart_id: kartId }).orderBy('olusturma', 'desc').limit(30);
  const yaz = yazabilir(req.kullanici, kart.modul_id);
  res.json(L.map((r) => disApi(r, yaz ? req.kullanici : null)));
});

disYonetim.post('/dis-onay/:id/iptal', async (req, res) => {
  const id = Kimlik.parse(req.params.id);
  const r = await req.db('dis_onaylar').where({ id }).first();
  if (!r || !kayitGorur(req.kullanici, 'kart', r.kart_id)) throw new HttpHata(404, 'Bulunamadı');
  if (!yazabilir(req.kullanici, r.modul_id)) throw new HttpHata(403, 'Bu modülde yazma yetkin yok');
  const n = await req.db('dis_onaylar').where({ id, durum: 'bekliyor' }).update({ durum: 'iptal', guncelleyen: req.kullanici.id, guncelleme: new Date() });
  if (n) await logYaz(req.db, req.kullanici, { projeId: r.proje_id, modulId: r.modul_id, kartId: r.kart_id }, { tip: 'alan', alan: r.baslik, metin: 'Dış onay bağlantısı iptal edildi' });
  res.json({ ok: true });
});

// ---------- herkese açık ----------
export const disGenel = Router();
const sinir = hizSiniri(60, 10 * 60_000);
const ip = (req) => String(req.ip || req.headers['x-forwarded-for'] || '').split(',')[0].trim().slice(0, 64);

disGenel.use((req, res, next) => {
  res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' });
  if (!sinir(ip(req))) return next(new HttpHata(429, 'Çok fazla istek; biraz sonra yeniden dene'));
  next();
});

async function bul(req) {
  const a = String(req.params.anahtar || '');
  if (!ANAHTAR_RE.test(a)) throw new HttpHata(404, 'Bağlantı geçersiz');
  const r = await req.db('dis_onaylar').where({ anahtar_ozet: anahtarOzet(a) }).first();
  if (!r) throw new HttpHata(404, 'Bağlantı geçersiz');
  if (r.durum === 'iptal') throw new HttpHata(410, 'Bu bağlantı iptal edildi');
  return r;
}

disGenel.get('/:anahtar', async (req, res) => {
  const r = await bul(req);
  const fa = await req.db('ayarlar').where({ anahtar: 'firma' }).first();
  const f = json.oku(fa?.deger, {});
  const firma = { ad: f.ad || req.firma.ad, logo: typeof f.logo === 'string' && f.logo.startsWith('data:image/') ? f.logo : '' };
  if (r.durum === 'yanitlandi') {
    const y = json.oku(r.yanit, {});
    return res.json({ durum: 'yanitlandi', firma, baslik: r.baslik, karar: y.karar || '', yanitZaman: new Date(r.yanit_zaman).toISOString() });
  }
  if (new Date(r.son_gecerlilik) <= new Date()) throw new HttpHata(410, 'Bu bağlantının süresi doldu');
  res.json({
    durum: 'bekliyor', firma, baslik: r.baslik, belge: r.belge, alanlar: json.oku(r.alanlar, []),
    onay: !!r.onay_istenir, not: !!r.not_istenir, son: new Date(r.son_gecerlilik).toISOString(),
  });
});

disGenel.post('/:anahtar', async (req, res) => {
  const r = await bul(req);
  if (r.durum === 'yanitlandi') throw new HttpHata(409, 'Bu belge zaten yanıtlandı');
  if (new Date(r.son_gecerlilik) <= new Date()) throw new HttpHata(410, 'Bu bağlantının süresi doldu');
  const { sonuc, hatalar } = yanitDogrula(req.body, { ...r, alanlar: json.oku(r.alanlar, []) });
  if (hatalar.length) throw new HttpHata(400, hatalar[0], { hatalar });
  const simdi = new Date();
  await req.db.transaction(async (trx) => {
    // Koşullu güncelleme: aynı anda iki yanıt gelirse yalnız biri yazılır
    const n = await trx('dis_onaylar').where({ id: r.id, durum: 'bekliyor' }).andWhere('son_gecerlilik', '>', simdi)
      .update({ durum: 'yanitlandi', yanit: json.yaz(sonuc), yanit_zaman: simdi, yanit_ip: ip(req), yanit_tarayici: String(req.headers['user-agent'] || '').slice(0, 250), guncelleme: simdi });
    if (!n) throw new HttpHata(409, 'Bu belge zaten yanıtlandı ya da süresi doldu');
    const ozet = [sonuc.karar === 'onay' ? 'ONAYLANDI' : sonuc.karar === 'red' ? 'REDDEDİLDİ' : 'Yanıtlandı',
      ...Object.entries(sonuc.alanlar).map(([k, v]) => `${k}: ${v}`), Object.keys(sonuc.imzalar).length ? 'İmzalı' : '',
      sonuc.notu ? 'Not: ' + sonuc.notu : '', 'IP: ' + ip(req)].filter(Boolean).join(' · ');
    await logYaz(trx, { id: null, ad: 'Dış onay (müşteri)' }, { projeId: r.proje_id, modulId: r.modul_id, kartId: r.kart_id },
      { tip: 'alan', alan: r.baslik, metin: ozet.slice(0, 3000) });
  });
  res.json({ ok: true, karar: sonuc.karar });
});
