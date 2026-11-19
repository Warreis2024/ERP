// Dış bağlantılar (firma hesabı): durum, bağlan (OAuth), dönüş, kes.
// Dosya yükleme (Drive, NetERP/<proje kodu>) ve e-posta gönderimi (Gmail) de buradadır.
import { Router } from 'express';
import express from 'express';
import { z } from 'zod';
import { HttpHata } from '../hata.js';
import { json } from '../db.js';
import { yoneticiGerekli } from '../auth/middleware.js';
import { belirtecUret, belirtecCoz } from '../auth/oturum.js';
import { yonetici, okuyabilir } from '../kurallar/yetki.js';
import { sifrele, coz } from '../baglanti/kasa.js';
import * as google from '../baglanti/google.js';
import * as drive from '../baglanti/driveHesap.js';

const r = Router();
const PARCA = 3 * 1310720; // 3,75 MB: Google (256 KB) ve OneDrive (320 KB) katı; Vercel 4,5 MB istek sınırının altında
const AZAMI_BOYUT = 5 * 1024 ** 3;

// ---------- durum ----------
r.get('/baglanti/durum', async (req, res) => {
  const [g, d] = await Promise.all([google.durum(req.db), drive.durum(req.db)]);
  // Yönetici olmayanlara hesap ayrıntısı gerekmez; yalnız ne kullanılabildiği
  res.json(yonetici(req.kullanici) ? { google: g, gdrive: d } : {
    google: { yapilandirildi: g.yapilandirildi, bagli: g.bagli, drive: g.drive, gmail: g.gmail },
    gdrive: { bagli: d.bagli, driveAd: d.driveAd },
  });
});

// ---------- Google: bağlan / dönüş / kes ----------
r.post('/baglanti/google/basla', yoneticiGerekli, (req, res) => {
  if (!google.yapilandirildi()) throw new HttpHata(400, 'Sunucuda GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET tanımlı değil (Vercel ortam değişkenleri).');
  const durum = belirtecUret({ t: 'g-baglan', uid: req.kullanici.id, f: req.firma.sub }, 600);
  res.json({ url: google.izinAdresi(req, durum) });
});

// Google'dan tarayıcı yönlendirmesiyle gelinir: oturum yoksa JSON hata yerine sayfaya geri yönlendirilir.
// Bu yüzden girisGerekli'den önce bağlanır (app.js).
export const donusRouter = Router();
donusRouter.get('/baglanti/google/donus', async (req, res) => {
  const don = (sonuc, mesaj) => res.redirect(303, '/?' + new URLSearchParams({ baglanti: 'google', sonuc, ...(mesaj ? { mesaj } : {}) }) + '#ayar');
  try {
    if (req.query.error) return don('iptal', req.query.error === 'access_denied' ? 'İzin verilmedi' : String(req.query.error));
    if (!req.kullanici) return don('hata', 'Oturum kapalı; giriş yapıp yeniden dene');
    const d = belirtecCoz(String(req.query.state || ''));
    if (!d || d.t !== 'g-baglan' || d.f !== req.firma.sub || d.uid !== req.kullanici.id) return don('hata', 'Bağlantı isteği geçersiz ya da süresi doldu; yeniden dene');
    if (!yonetici(req.kullanici)) return don('hata', 'Yönetici yetkisi gerekir');
    const k = await google.kodTakas(req, req.db, String(req.query.code || ''), req.kullanici.id);
    don('ok', k.hesap);
  } catch (e) {
    console.error('google donus:', e.message);
    don('hata', e instanceof HttpHata ? e.message : 'Google bağlantısı kurulamadı');
  }
});

r.post('/baglanti/google/kes', yoneticiGerekli, async (req, res) => {
  await google.kes(req.db);
  res.json({ ok: true });
});

// ---------- Google Drive: Paylaşılan Drive + ERP hizmet hesabı (sihirbaz) ----------
r.get('/baglanti/gdrive/suruculer', yoneticiGerekli, async (req, res) => {
  const suruculer = await drive.suruculer();
  // Hiç Paylaşılan Drive yoksa, yanlışlıkla normal klasör paylaşılmış mı bak (kullanıcıya doğru yönlendirme için)
  const klasorler = suruculer.length ? [] : await drive.paylasilanKlasorler().catch(() => []);
  console.log('gdrive suruculer:', suruculer.length, 'paylasilan klasor:', klasorler.length);
  res.json({ hesap: drive.hesapEposta(), suruculer, klasorler });
});
r.post('/baglanti/gdrive/sec', yoneticiGerekli, async (req, res) => {
  const v = z.object({ driveId: z.string().trim().min(5).max(100) }).parse(req.body);
  const k = await drive.baglan(req.db, v.driveId, req.kullanici.id);
  res.json({ ok: true, driveId: k.driveId, driveAd: k.driveAd, klasor: drive.klasorAdresi(k.kokId) });
});
r.post('/baglanti/gdrive/kes', yoneticiGerekli, async (req, res) => {
  await drive.kes(req.db);
  res.json({ ok: true });
});

// ---------- dosya yükleme (Google Drive) ----------
const BaslaV = z.object({
  depo: z.enum(['gdrive']),
  ad: z.string().trim().min(1).max(250),
  tip: z.string().max(150).optional().default(''),
  boyut: z.number().int().min(0).max(AZAMI_BOYUT),
  projeId: z.string().max(40).optional().nullable(),
  modulId: z.string().max(40).optional().nullable(),
});

r.post('/dosya/yukle/basla', async (req, res) => {
  const v = BaslaV.parse(req.body);
  const u = req.kullanici;
  if (v.modulId && !okuyabilir(u, v.modulId)) throw new HttpHata(403, 'Bu modüle dosya yükleme yetkin yok');
  let kod = '', projeAd = '';
  if (v.projeId) {
    const p = await req.db('projeler').where({ id: v.projeId, silindi: false }).first();
    if (!p) throw new HttpHata(404, 'Proje bulunamadı');
    kod = p.kod; projeAd = p.ad;
  }
  const paylasimli = drive.yapilandirildi() && !!(await drive.ayar(req.db));
  const klasorId = paylasimli ? await drive.projeKlasoru(req.db, kod, projeAd) : await google.projeKlasoru(req.db, kod, projeAd);
  const uri = paylasimli ? await drive.yuklemeBaslat({ ad: v.ad, tip: v.tip, boyut: v.boyut, klasorId }) : await google.yuklemeBaslat(req.db, { ad: v.ad, tip: v.tip, boyut: v.boyut, klasorId });
  // Oturum adresi şifrelenip istemciye verilir; yalnız bu kullanıcı, 6 saat içinde kullanabilir.
  const oturum = sifrele({ uri, toplam: v.boyut, uid: u.id, f: req.firma.sub, exp: Date.now() + 6 * 3600e3, paylasimli });
  res.json({ oturum, parca: PARCA, klasor: `${google.KOK_KLASOR}/${kod || 'Genel'}` });
});

r.post('/dosya/yukle/parca', express.raw({ type: 'application/octet-stream', limit: PARCA + 1024 }), async (req, res) => {
  const o = coz(String(req.get('x-yukleme-oturum') || ''));
  if (!o || o.uid !== req.kullanici.id || o.f !== req.firma.sub || o.exp < Date.now()) throw new HttpHata(400, 'Yükleme oturumu geçersiz; dosyayı yeniden yükle');
  const bas = Number(req.query.bas);
  const parca = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  if (!Number.isInteger(bas) || bas < 0 || bas + parca.length > o.toplam) throw new HttpHata(400, 'Parça aralığı geçersiz');
  if (parca.length > PARCA || (bas + parca.length < o.toplam && parca.length % 262144 !== 0)) throw new HttpHata(400, 'Parça boyutu geçersiz');
  const s = await google.parcaGonder(o.uri, parca, bas, o.toplam);
  if (!s.bitti) return res.json({ bitti: false, alinan: s.alinan });
  let paylasildi = false;
  // Paylaşılan Drive'da dosyayı Drive üyeleri görür; kişisel (OAuth) yüklemede Workspace alanına bağlantıyla açılır.
  if (o.paylasimli) paylasildi = true;
  else try { paylasildi = await google.alandaPaylas(req.db, s.dosya.id); } catch (e) { console.error('drive paylas:', e.message); }
  res.json({ bitti: true, dosya: { id: s.dosya.id, ad: s.dosya.name, boyut: Number(s.dosya.size || o.toplam), tip: s.dosya.mimeType, url: s.dosya.webViewLink, paylasildi } });
});

// ---------- e-posta gönderimi (firma hesabı, Gmail) ----------
const eposta = z.string().trim().email().max(254);
const GonderV = z.object({
  kime: z.string().max(2000),
  konu: z.string().max(500).default(''),
  metin: z.string().max(200000).default(''),
});

r.post('/eposta/gonder', async (req, res) => {
  const v = GonderV.parse(req.body);
  const kime = v.kime.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
  if (!kime.length || kime.length > 50 || !kime.every((x) => eposta.safeParse(x).success)) throw new HttpHata(400, 'Alıcı adresi geçersiz');
  const firma = json.oku((await req.db('ayarlar').where({ anahtar: 'firma' }).first())?.deger, {});
  const fe = firma.eposta || {};
  if (fe.tur !== 'google') throw new HttpHata(409, 'Firma e-posta hesabı Google değil; Ayarlar → Firma → E-posta', { kod: 'EPOSTA_YOK' });
  const g = await google.gmailGonder(req.db, {
    kimdenAd: fe.gonderenAd || firma.ad || '', kime, konu: v.konu, metin: v.metin, cevap: req.kullanici.eposta,
  });
  res.json({ ok: true, id: g.id, kimden: g.kimden, kanal: 'gmail' });
});

export default r;
