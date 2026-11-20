import { Router } from 'express';
import { z } from 'zod';
import { HttpHata } from '../hata.js';
import { sifreOzetle, sifreDogrula, sifreKuraliHatasi } from '../auth/sifre.js';
import { belirtecUret, csrfUret, oturumCerezleriYaz, oturumCerezleriSil, oturumSuresiSn } from '../auth/oturum.js';
import { girisGerekli } from '../auth/middleware.js';
import { kullaniciDis } from '../veri.js';
import { misafirGirisEngeli } from '../kurallar/misafir.js';
import { json } from '../db.js';

const r = Router();
const KILIT_DENEME = 5, KILIT_DK = 5;
// IP başına kaba sınır (tek süreçte; Vercel'de örnekler arası paylaşılmaz — asıl koruma kullanıcı kilidi)
const ipSayac = new Map();
function ipSinir(ip) {
  const s = Date.now(), k = ipSayac.get(ip) || { n: 0, t: s };
  if (s - k.t > 60_000) { k.n = 0; k.t = s; }
  k.n++; ipSayac.set(ip, k);
  if (ipSayac.size > 5000) ipSayac.clear();
  return k.n > 20;
}
const SAHTE_OZET = 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$' + 'A'.repeat(88); // kullanıcı yokken de aynı süre harcansın

function oturumVer(req, res, u, hatirla) {
  const csrf = csrfUret();
  oturumCerezleriYaz(res, belirtecUret({ uid: u.id, f: req.firma.sub, sv: u.oturum_surumu, h: hatirla ? 1 : 0 }, oturumSuresiSn(hatirla)), csrf, hatirla);
  return csrf;
}

r.post('/giris', async (req, res) => {
  const { eposta, sifre, hatirla } = z.object({ eposta: z.string().trim().toLowerCase().email().max(254), sifre: z.string().min(1).max(200), hatirla: z.boolean().optional() }).parse(req.body);
  const ip = req.ip, tarayici = String(req.get('user-agent') || '').slice(0, 200);
  if (ipSinir(ip)) throw new HttpHata(429, 'Çok fazla deneme. Biraz sonra tekrar dene.');
  const db = req.db;
  const u = await db('kullanicilar').where({ eposta }).first();
  if (u?.kilit && new Date(u.kilit) > new Date()) throw new HttpHata(429, `Çok fazla hatalı deneme. ${Math.ceil((new Date(u.kilit) - Date.now()) / 60000)} dakika sonra tekrar dene.`);
  const dogru = await sifreDogrula(u?.sifre_ozet || SAHTE_OZET, sifre);
  if (!u || !dogru || !u.aktif) {
    if (u) {
      const hatali = (u.hatali || 0) + 1;
      await db('kullanicilar').where({ id: u.id }).update(hatali >= KILIT_DENEME ? { hatali: 0, kilit: new Date(Date.now() + KILIT_DK * 60000) } : { hatali });
    }
    await db('giris_kayitlari').insert({ kullanici_id: u?.id || null, eposta, basarili: false, ip, tarayici, zaman: new Date() });
    throw new HttpHata(401, u && dogru && !u.aktif ? 'Bu kullanıcı pasif. Yöneticine başvur.' : 'E-posta ya da şifre hatalı.');
  }
  const misafirEngel = misafirGirisEngeli(u);
  if (misafirEngel) {
    await db('giris_kayitlari').insert({ kullanici_id: u.id, eposta, basarili: false, ip, tarayici, zaman: new Date() });
    throw new HttpHata(403, misafirEngel);
  }
  await db('kullanicilar').where({ id: u.id }).update({ hatali: 0, kilit: null, son_giris: new Date() });
  await db('giris_kayitlari').insert({ kullanici_id: u.id, eposta, basarili: true, ip, tarayici, zaman: new Date() });
  const csrf = oturumVer(req, res, u, !!hatirla);
  res.json({ ok: true, csrf, sifreDegismeli: !!u.sifre_degismeli });
});

r.post('/cikis', (req, res) => { oturumCerezleriSil(res); res.json({ ok: true }); });

// Bütün cihazlardaki oturumları kapatır.
r.post('/cikis-hepsi', girisGerekli, async (req, res) => {
  await req.db('kullanicilar').where({ id: req.kullanici.id }).increment('oturum_surumu', 1);
  oturumCerezleriSil(res); res.json({ ok: true });
});

r.get('/ben', girisGerekli, async (req, res) => {
  const girisler = await req.db('giris_kayitlari').where({ kullanici_id: req.kullanici.id, basarili: true }).orderBy('id', 'desc').limit(8);
  res.json({ kullanici: kullaniciDis(req.kullanici, true), firma: req.firma, girisler: girisler.map((g) => ({ zaman: new Date(g.zaman).toISOString(), tarayici: g.tarayici, ip: g.ip })) });
});

r.post('/sifre', girisGerekli, async (req, res) => {
  const { eski, yeni } = z.object({ eski: z.string().max(200), yeni: z.string().max(200) }).parse(req.body);
  const u = req.kullanici;
  if (!(await sifreDogrula(u.sifre_ozet, eski))) throw new HttpHata(400, 'Mevcut şifre yanlış');
  const kural = sifreKuraliHatasi(yeni); if (kural) throw new HttpHata(400, kural);
  if (eski === yeni) throw new HttpHata(400, 'Yeni şifre eskisiyle aynı');
  const sv = u.oturum_surumu + 1;
  await req.db('kullanicilar').where({ id: u.id }).update({ sifre_ozet: await sifreOzetle(yeni), sifre_degismeli: false, sifre_tarih: new Date(), oturum_surumu: sv });
  const csrf = oturumVer(req, res, { ...u, oturum_surumu: sv }, true);
  res.json({ ok: true, csrf });
});

// Profilim: kullanıcının kendi değiştirebildiği alanlar
r.put('/profil', girisGerekli, async (req, res) => {
  const v = z.object({
    ad: z.string().trim().min(1).max(150).optional(),
    tel: z.string().trim().max(40).optional(),
    foto: z.string().max(60000).regex(/^(data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+)?$/).optional(),
    tercih: z.record(z.any()).optional(),
  }).parse(req.body);
  const u = req.kullanici, d = {};
  if (v.ad !== undefined) d.ad = v.ad;
  if (v.tel !== undefined) d.tel = v.tel;
  if (v.foto !== undefined) d.foto = v.foto || null;
  if (v.tercih !== undefined) { const t = json.yaz({ ...u.tercih, ...v.tercih }); if (t.length > 50000) throw new HttpHata(400, 'Tercih verisi çok büyük'); d.tercih = t; }
  if (Object.keys(d).length) await req.db('kullanicilar').where({ id: u.id }).update({ ...d, guncelleyen: u.id, guncelleme: new Date() });
  res.json({ ok: true });
});

// E-posta hesabı: tür ve sunucu bilgisi. Şifre/OAuth belirteci burada tutulmaz (sunucu aşamasında şifreli kasa).
r.put('/eposta-hesap', girisGerekli, async (req, res) => {
  const v = z.object({
    tur: z.enum(['yok', 'google', 'microsoft', 'smtp']),
    ad: z.string().max(150).optional(), adres: z.string().email().max(254).optional().or(z.literal('')),
    smtp: z.string().max(200).optional(), smtpPort: z.coerce.number().int().min(1).max(65535).optional(),
    guvenlik: z.enum(['starttls', 'ssl', 'yok']).optional(), imap: z.string().max(200).optional(),
    imapPort: z.coerce.number().int().min(1).max(65535).optional(), kullanici: z.string().max(254).optional(),
    imza: z.string().max(20000).optional(),
  }).parse(req.body);
  await req.db('kullanicilar').where({ id: req.kullanici.id }).update({ eposta_hesap: json.yaz({ ...v, bagli: false }) });
  res.json({ ok: true });
});

export default r;
