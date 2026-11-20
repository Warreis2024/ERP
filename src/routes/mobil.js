// Mobil uygulama uçları.
//  • Eşleme: bilgisayarda oturumlu kullanıcı tek kullanımlık QR kodu üretir (10 dk); telefon kodu okutunca
//    o cihaza şifresiz, uzun ömürlü (180 gün) ve iptal edilebilir bir oturum verilir.
//  • Notlarım: kayda bağlanmamış hızlı notlar (metin + resim/ses/video); sonra bir kayda mesaj olarak taşınır.
//  • Web push aboneliği.
import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { HttpHata } from '../hata.js';
import { json } from '../db.js';
import { belirtecUret, csrfUret, CEREZ } from '../auth/oturum.js';
import { config } from '../config.js';
import { vapid } from '../push.js';
import { hizSiniri } from '../disOnay.js';
import { tanimlar, yeniId } from '../veri.js';
import { okuyabilir, fnErisim } from '../kurallar/yetki.js';
import { projeKisileri, gorunurDegerler } from '../kayitServis.js';
import { mesajYaz, MesajSema } from './kayitlar.js';
import { EkSema } from '../kurallar/ekler.js';
import { misafirGirisEngeli, kayitGorur } from '../kurallar/misafir.js';
import { eforDurum, eforOzet } from '../kurallar/efor.js';
import { degerApi } from '../kurallar/degerler.js';
import * as google from '../baglanti/google.js';
import * as drive from '../baglanti/driveHesap.js';
import * as ms from '../baglanti/microsoft.js';

const ozet = (k) => crypto.createHash('sha256').update(String(k)).digest('hex');
const KOD_RE = /^[A-Za-z0-9_-]{43}$/;
const CIHAZ_GUN = 180;
const Kimlik = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);

function cerez(ad, deger, maxAge, httpOnly) {
  const p = [`${ad}=${encodeURIComponent(deger)}`, 'Path=/', 'SameSite=Lax', `Max-Age=${maxAge}`];
  if (httpOnly) p.push('HttpOnly');
  if (config.oturum.guvenliCerez) p.push('Secure');
  return p.join('; ');
}

// ---------- herkese açık: telefonun eşleme kodunu kullanması ----------
export const cihazGenel = Router();
const sinir = hizSiniri(20, 10 * 60_000);
cihazGenel.post('/bagla', async (req, res) => {
  if (!sinir(String(req.ip || ''))) throw new HttpHata(429, 'Çok fazla deneme. Biraz sonra tekrar dene.');
  const v = z.object({ kod: z.string().regex(KOD_RE), ad: z.string().trim().max(120).default('') }).parse(req.body || {});
  const db = req.db, simdi = new Date();
  const c = await db('cihazlar').where({ kod_ozet: ozet(v.kod), durum: 'bekliyor' }).first();
  if (!c || !c.kod_son || new Date(c.kod_son) < simdi) throw new HttpHata(410, 'Eşleme kodunun süresi doldu; bilgisayarda yeni QR oluştur');
  const u = await db('kullanicilar').where({ id: c.kullanici_id }).first();
  if (!u || !u.aktif) throw new HttpHata(403, 'Bu kullanıcı pasif. Yöneticine başvur.');
  const misafirEngel = misafirGirisEngeli(u);
  if (misafirEngel) throw new HttpHata(403, misafirEngel);
  // tek kullanım: kod silinir, cihaz etkinleşir
  const n = await db('cihazlar').where({ id: c.id, durum: 'bekliyor' }).update({ durum: 'aktif', kod_ozet: null, kod_son: null, ad: v.ad || c.ad || 'Telefon', tarayici: String(req.get('user-agent') || '').slice(0, 250), son_kullanim: simdi });
  if (!n) throw new HttpHata(409, 'Bu kod kullanıldı');
  const sure = CIHAZ_GUN * 86400, csrf = csrfUret();
  res.append('Set-Cookie', cerez(CEREZ.oturum, belirtecUret({ uid: u.id, f: req.firma.sub, sv: u.oturum_surumu, c: c.id, h: 1 }, sure), sure, true));
  res.append('Set-Cookie', cerez(CEREZ.csrf, csrf, sure, false));
  res.json({ ok: true, ad: u.ad });
});

// ---------- oturumlu ----------
export const mobil = Router();

mobil.post('/cihaz/eslestir', async (req, res) => {
  if (req.cihazId) throw new HttpHata(403, 'Telefon eşlemesi bilgisayardan yapılır');
  const kod = crypto.randomBytes(32).toString('base64url'), simdi = new Date();
  const son = new Date(simdi.getTime() + 10 * 60_000);
  // kullanıcının bekleyen eski kodları silinir
  await req.db('cihazlar').where({ kullanici_id: req.kullanici.id, durum: 'bekliyor' }).del();
  await req.db('cihazlar').insert({ id: yeniId(), kullanici_id: req.kullanici.id, ad: 'Telefon', kod_ozet: ozet(kod), kod_son: son, durum: 'bekliyor', olusturma: simdi });
  res.json({ kod, son: son.toISOString() });
});

mobil.get('/cihaz', async (req, res) => {
  const L = await req.db('cihazlar').where({ kullanici_id: req.kullanici.id, durum: 'aktif' }).orderBy('olusturma', 'desc');
  res.json(L.map((c) => ({ id: c.id, ad: c.ad, tarayici: c.tarayici, sonKullanim: c.son_kullanim ? new Date(c.son_kullanim).toISOString() : null, olusturma: c.olusturma ? new Date(c.olusturma).toISOString() : null, bu: c.id === req.cihazId })));
});

mobil.post('/cihaz/:id/kaldir', async (req, res) => {
  const id = Kimlik.parse(req.params.id);
  await req.db('cihazlar').where({ id, kullanici_id: req.kullanici.id }).update({ durum: 'iptal' });
  await req.db('push_abonelikleri').where({ cihaz_id: id, kullanici_id: req.kullanici.id }).del();
  res.json({ ok: true });
});

// ---------- web push ----------
mobil.get('/push/anahtar', async (req, res) => { res.json({ anahtar: (await vapid(req.db)).pub }); });
mobil.post('/push/abone', async (req, res) => {
  const v = z.object({ endpoint: z.string().url().max(1000).refine((x) => x.startsWith('https://'), 'https gerekli'), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }) }).parse(req.body || {});
  const db = req.db;
  await db('push_abonelikleri').where({ endpoint: v.endpoint }).del();
  await db('push_abonelikleri').insert({ id: yeniId(), kullanici_id: req.kullanici.id, cihaz_id: req.cihazId || null, endpoint: v.endpoint, p256dh: v.keys.p256dh, auth: v.keys.auth, olusturma: new Date() });
  res.json({ ok: true });
});
mobil.post('/push/sil', async (req, res) => {
  const v = z.object({ endpoint: z.string().max(1000) }).parse(req.body || {});
  await req.db('push_abonelikleri').where({ endpoint: v.endpoint, kullanici_id: req.kullanici.id }).del();
  res.json({ ok: true });
});

// ---------- Notlarım ----------
const NotSema = z.object({ metin: z.string().trim().max(10000).default(''), ekler: EkSema });
const notApi = (n) => ({ id: n.id, metin: n.metin || '', ekler: json.oku(n.ekler, []), olusturma: n.olusturma ? new Date(n.olusturma).toISOString() : null });

mobil.get('/mobil/notlar', async (req, res) => {
  const L = await req.db('notlar').where({ kullanici_id: req.kullanici.id }).orderBy('olusturma', 'desc').limit(100);
  res.json(L.map(notApi));
});
mobil.post('/mobil/notlar', async (req, res) => {
  const v = NotSema.parse(req.body || {});
  if (!v.metin && !v.ekler.length) throw new HttpHata(400, 'Not boş');
  const n = { id: yeniId(), kullanici_id: req.kullanici.id, metin: v.metin, ekler: json.yaz(v.ekler), olusturma: new Date() };
  await req.db('notlar').insert(n);
  res.status(201).json(notApi(n));
});
mobil.delete('/mobil/notlar/:id', async (req, res) => {
  await req.db('notlar').where({ id: Kimlik.parse(req.params.id), kullanici_id: req.kullanici.id }).del();
  res.json({ ok: true });
});

mobil.post('/mobil/notlar/:id/tasi', async (req, res) => {
  const id = Kimlik.parse(req.params.id);
  const v = z.object({ projeId: z.string().max(40).default(''), kartId: z.string().max(40).optional().nullable() }).parse(req.body || {});
  const n = await req.db('notlar').where({ id, kullanici_id: req.kullanici.id }).first();
  if (!n) throw new HttpHata(404, 'Not bulunamadı');
  const sonuc = await mesajYaz(req, MesajSema.parse({ projeId: v.projeId, kartId: v.kartId || null, metin: n.metin || '', ekler: json.oku(n.ekler, []) }));
  await req.db('notlar').where({ id }).del();
  res.json(sonuc);
});

// ---------- telefon için hafif özet ----------
// Firmanın varsayılan deposu bulutsa ve bağlıysa büyük ekler oraya yüklenir (masaüstündeki bulutHazir ile aynı kural)
async function bulutDepo(db) {
  try {
    const a = await db('ayarlar').where({ anahtar: 'firma' }).first();
    const d = json.oku(a?.deger, {}).depo;
    if (d === 'gdrive') { const [gd, g] = await Promise.all([drive.durum(db), google.durum(db)]); return gd.bagli || (g.bagli && g.drive) ? 'gdrive' : ''; }
    if (d === 'onedrive') { const m = await ms.durum(db); return m.bagli && m.dosya ? 'onedrive' : ''; }
  } catch (e) { console.error('mobil depo:', e.message); }
  return '';
}
const iso = (x) => (x ? new Date(x).toISOString() : '');
const duzMetin = (h) => String(h || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const ekOzet = (L) => (Array.isArray(L) ? L.map((e) => ({ ad: e.ad || '', tur: e.depo ? String(e.tip || '').split('/')[0] || 'dosya' : String(e.url || '').slice(5, String(e.url || '').indexOf('/')) })) : []);

// Kayıtlar (başlıklarıyla), modüller, kişiler ve son mesajlar. Ekler burada gönderilmez (boyut); kayıt açılınca gelir.
mobil.get('/mobil/ozet', async (req, res) => {
  const u = req.kullanici, db = req.db, t = await tanimlar(req);
  const moduller = t.moduller.filter((m) => okuyabilir(u, m.id));
  const gorulen = new Set(moduller.map((m) => m.id));
  const [projeSat, kartSat, kullanicilar] = await Promise.all([
    db('projeler').where({ silindi: false, arsiv: false }).select('id', 'kod', 'ad', 'durum_id', 'guncelleme'),
    db('kartlar').where({ silindi: false }).select('id', 'kod', 'modul_id', 'proje_id', 'durum_id', 'guncelleme'),
    db('kullanicilar').where({ aktif: true }).select('id', 'ad', 'foto').orderBy('ad'),
  ]);
  const kartlar = kartSat.filter((k) => gorulen.has(k.modul_id) && kayitGorur(u, 'kart', k.id));
  if (u._kapsam) { const L = projeSat.filter((p) => kayitGorur(u, 'proje', p.id)); projeSat.length = 0; projeSat.push(...L); }
  const kartIds = new Set(kartlar.map((k) => k.id));
  const kisiler = await projeKisileri(db, projeSat.map((p) => p.id));
  const sinirTarih = new Date(Date.now() - 21 * 86400_000);
  const [baslikSat, mesajSat] = await Promise.all([
    db('degerler').whereIn('fn_tip', ['light', 'aciklama']).whereNotNull('kart_id'),
    db('degerler').where({ fn_tip: 'mesaj' }).andWhere('zaman', '>', sinirTarih).orderBy('zaman', 'desc').limit(400),
  ]);
  const baslik = new Map();
  for (const d of gorunurDegerler(u, t, baslikSat.filter((d) => kartIds.has(d.kart_id)), kisiler)) {
    const m = duzMetin(d.metin); if (!m) continue;
    if (d.fnTip === 'light' || !baslik.has(d.kartId)) baslik.set(d.kartId, m.slice(0, 90));
  }
  const kayitlar = [
    ...projeSat.map((p) => ({ tur: 'proje', id: p.id, projeId: p.id, kod: p.kod, baslik: p.ad, modulId: (moduller.find((m) => m.tur === 'proje') || {}).id || '', zaman: iso(p.guncelleme) })),
    ...kartlar.map((k) => ({ tur: 'kart', id: k.id, projeId: k.proje_id, kod: k.kod, baslik: baslik.get(k.id) || '', modulId: k.modul_id, zaman: iso(k.guncelleme) })),
  ].sort((a, b) => (b.zaman > a.zaman ? 1 : -1)).slice(0, 3000);
  const gelen = gorunurDegerler(u, t, mesajSat.filter((d) => !d.kart_id || kartIds.has(d.kart_id)), kisiler)
    .filter((d) => { const a = Array.isArray(d.alici) ? d.alici : []; return !a.length || a.includes(u.id) || d.kisi === u.id || d.kisi === u.ad; })
    .slice(0, 80)
    .map((d) => ({ id: d.id, projeId: d.projeId, kartId: d.kartId || null, kimden: d.kisi, metin: String(d.metin || '').replace(/\s+/g, ' ').trim().slice(0, 240), ekler: ekOzet(d.ekler), zaman: d.zaman, okundu: Array.isArray(d.okuyan) && d.okuyan.includes(u.id) }));
  // bana atanmış fiyat onayları
  const foSat = await db('degerler').where({ fn_tip: 'fiyatonay', onay: 'bekliyor', kisi: u.id }).limit(50);
  const onaylar = gorunurDegerler(u, t, foSat.filter((d) => !d.kart_id || kartIds.has(d.kart_id)), kisiler)
    .map((d) => ({ projeId: d.projeId, kartId: d.kartId || null, fnUid: d.fnUid, ad: (t.modul(d.modulId)?.fn.find((f) => f.uid === d.fnUid) || {}).ad || '', tutar: d.tutar, para: d.para || 'TRY', talep: d.talep || '' }));
  // yapı adlarının çevirisi (kullanıcının dili)
  const dil = (u.tercih && u.tercih.dil) || '';
  const firmaAyar = json.oku((await db('ayarlar').where({ anahtar: 'firma' }).first())?.deger, {});
  const ceviri = dil && dil !== 'tr' ? (firmaAyar.ceviriler || {})[dil] || {} : {};
  res.json({
    ceviri,
    depo: await bulutDepo(db),
    onaylar,
    ben: { id: u.id, ad: u.ad, foto: u.foto || '' },
    kullanicilar: kullanicilar.map((k) => ({ id: k.id, ad: k.ad, foto: typeof k.foto === 'string' && k.foto.length < 60000 ? k.foto : '' })),
    moduller: moduller.map((m) => ({ id: m.id, ad: m.ad, renk: m.renk, tur: m.tur, yaz: m.fn.some((f) => f.tip === 'mesaj' && fnErisim(u, f) === 'duzenle'), efor: m.fn.some((f) => f.tip === 'efor' && fnErisim(u, f) === 'duzenle') })),
    aktifEfor: (await db('degerler').where({ fn_tip: 'efor', kisi: u.id }).whereNull('adet').whereIn('tur', ['calisma', 'mola'])).map(degerApi).map((x) => ({ projeId: x.projeId, kartId: x.kartId || null, tur: x.tur, zaman: x.zaman })),
    kayitlar, gelen,
  });
});

// Bir kaydın mesajları (eklerle). Mesajlar okundu olarak işaretlenir.
mobil.get('/mobil/mesajlar', async (req, res) => {
  const u = req.kullanici, db = req.db, t = await tanimlar(req);
  const v = z.object({ projeId: Kimlik, kartId: Kimlik.optional() }).parse(req.query);
  if (!kayitGorur(u, v.kartId ? 'kart' : 'proje', v.kartId || v.projeId, !v.kartId)) throw new HttpHata(404, 'Kayıt bulunamadı');
  let q = db('degerler').where({ fn_tip: 'mesaj', proje_id: v.projeId });
  q = v.kartId ? q.andWhere({ kart_id: v.kartId }) : q.whereNull('kart_id');
  const sat = await q.orderBy('zaman', 'desc').limit(60);
  const kisiler = await projeKisileri(db, [v.projeId]);
  const L = gorunurDegerler(u, t, sat, kisiler).reverse();
  const okunmamis = L.filter((d) => !(Array.isArray(d.okuyan) && d.okuyan.includes(u.id)));
  for (const d of okunmamis) {
    const ham = sat.find((x) => x.id === d.id); const ek = json.oku(ham.ek, {});
    ek.okuyan = [...new Set([...(Array.isArray(ek.okuyan) ? ek.okuyan : []), u.id])];
    await db('degerler').where({ id: d.id }).update({ ek: JSON.stringify(ek) });
  }
  res.json(L.map((d) => ({ id: d.id, kimden: d.kisi, metin: d.metin || '', ekler: Array.isArray(d.ekler) ? d.ekler : [], zaman: d.zaman, ustId: d.ustId || null })));
});

// Kayıttaki efor fonksiyonları ve benim durumum (telefonda Başla / Mola / Bitir düğmeleri için)
mobil.get('/mobil/efor', async (req, res) => {
  const u = req.kullanici, db = req.db, t = await tanimlar(req);
  const v = z.object({ projeId: Kimlik, kartId: Kimlik.optional() }).parse(req.query);
  const k = v.kartId ? await db('kartlar').where({ id: v.kartId, silindi: false }).first() : await db('projeler').where({ id: v.projeId, silindi: false }).first();
  if (!k || !kayitGorur(u, v.kartId ? 'kart' : 'proje', k.id, !v.kartId)) throw new HttpHata(404, 'Kayıt bulunamadı');
  const m = v.kartId ? t.modul(k.modul_id) : t.moduller.find((x) => x.tur === 'proje');
  if (!m || !okuyabilir(u, m.id)) throw new HttpHata(404, 'Kayıt bulunamadı');
  const fnler = m.fn.filter((f) => f.tip === 'efor' && fnErisim(u, f) === 'duzenle');
  if (!fnler.length) return res.json([]);
  const sat = (await db('degerler').where(v.kartId ? { kart_id: v.kartId, fn_tip: 'efor' } : { proje_id: v.projeId, kart_id: null, fn_tip: 'efor' })).map(degerApi);
  res.json(fnler.map((f) => { const L = sat.filter((r) => r.fnUid === f.uid), o = eforOzet(L)[u.id] || { calisma: 0, mola: 0 }; return { fnUid: f.uid, ad: f.ad, durum: eforDurum(L, u.id), calisma: Math.round(o.calisma), mola: Math.round(o.mola) }; }));
});
