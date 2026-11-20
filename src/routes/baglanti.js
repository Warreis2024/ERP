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
import * as ms from '../baglanti/microsoft.js';
import * as smtp from '../baglanti/smtp.js';

const r = Router();
const PARCA = 3 * 1310720; // 3,75 MB: Google (256 KB) ve OneDrive (320 KB) katı; Vercel 4,5 MB istek sınırının altında
const AZAMI_BOYUT = 5 * 1024 ** 3;

// ---------- durum ----------
r.get('/baglanti/durum', async (req, res) => {
  const [g, d, m, sm, fa, km] = await Promise.all([google.durum(req.db), drive.durum(req.db), ms.durum(req.db), smtp.durum(req.db), req.db('ayarlar').where({ anahtar: 'firma' }).first(), smtp.durum(req.db, smtp.kullaniciKasasi(req.kullanici.id))]);
  const fe = json.oku(fa?.deger, {}).eposta || {};
  const ke = kullaniciHesabi(req.kullanici);
  // Kullanıcının kendi hesabı: kayıtlı test şimdiki ayarlarıyla mı, firma buna izin veriyor mu
  const hesabim = { kayitli: km.kayitli, zaman: km.zaman, guncel: km.kayitli && ke.tur === 'smtp' && km.ozet === smtp.ayarOzeti(smtpAyar(ke)), izinli: fe.kullaniciBaglar !== false };
  // Kayıtlı test, şu anki sunucu/port/güvenlik/kullanıcı ayarlarıyla mı yapılmış?
  const e = { smtp: { ...sm, guncel: sm.kayitli && sm.ozet === smtp.ayarOzeti(smtpAyar(fe)), ozet: undefined }, hesabim };
  if (g.bagli) console.log('google durum: drive', !!g.drive, 'kapsam', (g.kapsam || []).join(' '));
  // Yönetici olmayanlara hesap ayrıntısı gerekmez; yalnız ne kullanılabildiği
  if (m.bagli) console.log('microsoft durum: dosya', !!m.dosya, 'tur', m.surucuTur, 'kapsam', (m.kapsam || []).join(' '));
  res.json(yonetici(req.kullanici) ? { google: g, gdrive: d, microsoft: m, eposta: e } : {
    eposta: { smtp: { kayitli: e.smtp.kayitli, guncel: e.smtp.guncel }, hesabim },
    google: { yapilandirildi: g.yapilandirildi, bagli: g.bagli, drive: g.drive, gmail: g.gmail },
    gdrive: { bagli: d.bagli, driveAd: d.driveAd },
    microsoft: { yapilandirildi: m.yapilandirildi, bagli: m.bagli, dosya: m.dosya },
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

// Microsoft'tan dönüş (Google dönüşüyle aynı kurallar)
donusRouter.get('/baglanti/microsoft/donus', async (req, res) => {
  const don = (sonuc, mesaj) => res.redirect(303, '/?' + new URLSearchParams({ baglanti: 'microsoft', sonuc, ...(mesaj ? { mesaj } : {}) }) + '#ayar');
  try {
    if (req.query.error) {
      const t = String(req.query.error_description || '');
      return don(req.query.error === 'access_denied' ? 'iptal' : 'hata', req.query.error === 'access_denied' ? 'İzin verilmedi' : (t.match(/AADSTS\d+[^\r\n.]*/) || [String(req.query.error)])[0]);
    }
    if (!req.kullanici) return don('hata', 'Oturum kapalı; giriş yapıp yeniden dene');
    const d = belirtecCoz(String(req.query.state || ''));
    if (!d || d.t !== 'ms-baglan' || d.f !== req.firma.sub || d.uid !== req.kullanici.id) return don('hata', 'Bağlantı isteği geçersiz ya da süresi doldu; yeniden dene');
    if (!yonetici(req.kullanici)) return don('hata', 'Yönetici yetkisi gerekir');
    const k = await ms.kodTakas(req, req.db, String(req.query.code || ''), req.kullanici.id);
    don('ok', k.hesap);
  } catch (e) {
    console.error('microsoft donus:', e.message);
    don('hata', e instanceof HttpHata ? e.message : 'Microsoft bağlantısı kurulamadı');
  }
});

r.post('/baglanti/microsoft/basla', yoneticiGerekli, (req, res) => {
  if (!ms.yapilandirildi()) throw new HttpHata(400, 'Sunucuda MS_CLIENT_ID / MS_CLIENT_SECRET tanımlı değil (Vercel ortam değişkenleri).');
  const durum = belirtecUret({ t: 'ms-baglan', uid: req.kullanici.id, f: req.firma.sub }, 600);
  res.json({ url: ms.izinAdresi(req, durum) });
});
r.post('/baglanti/microsoft/kes', yoneticiGerekli, async (req, res) => {
  await ms.kes(req.db);
  res.json({ ok: true });
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
  depo: z.enum(['gdrive', 'onedrive']),
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
  if (v.depo === 'onedrive') {
    const klasorId = await ms.projeKlasoru(req.db, kod);
    const klasor = `${ms.KOK_KLASOR}/${kod || 'Genel'}`;
    if (v.boyut === 0) { const d = await ms.bosDosya(req.db, { ad: v.ad, klasorId }); return res.json({ klasor, dosya: { id: d.id, ad: d.name, boyut: 0, tip: d.mimeType, url: d.webViewLink, paylasildi: false } }); }
    const uri = await ms.yuklemeBaslat(req.db, { ad: v.ad, klasorId });
    const oturum = sifrele({ uri, toplam: v.boyut, uid: u.id, f: req.firma.sub, exp: Date.now() + 6 * 3600e3, saglayici: 'ms' });
    return res.json({ oturum, parca: PARCA, klasor });
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
  if (o.saglayici === 'ms' && parca.length === 0) throw new HttpHata(400, 'Boş parça');
  const s = o.saglayici === 'ms' ? await ms.parcaGonder(o.uri, parca, bas, o.toplam) : await google.parcaGonder(o.uri, parca, bas, o.toplam);
  if (!s.bitti) return res.json({ bitti: false, alinan: s.alinan });
  let paylasildi = false;
  if (o.saglayici === 'ms') {
    // İş hesabında kuruluş içi görüntüleme bağlantısı; kişisel hesapta dosyanın kendi adresi
    let url = s.dosya.webViewLink;
    try { const l = await ms.kurulustaPaylas(req.db, s.dosya.id); if (l) { url = l; paylasildi = true; } } catch (e) { console.error('onedrive paylas:', e.message); }
    return res.json({ bitti: true, dosya: { id: s.dosya.id, ad: s.dosya.name, boyut: Number(s.dosya.size || o.toplam), tip: s.dosya.mimeType, url, paylasildi } });
  }
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
  html: z.string().max(3_500_000).optional(), // zengin gövde (resimler gömülü eke dönüşür)
  imza: z.boolean().default(false), // gönderenin kayıtlı HTML imzası (logo dahil) eklensin mi
});

// Kullanıcının kendi e-posta hesabı ayarı (kullanicilar.eposta_hesap; şifre burada değil kasada)
const kullaniciHesabi = (u) => (typeof u.eposta_hesap === 'string' ? json.oku(u.eposta_hesap, { tur: 'yok' }) : u.eposta_hesap) || { tur: 'yok' };

// Firma SMTP ayarı (ayarlar.firma.eposta) → istemci ayarı
function smtpAyar(fe, sifre = '') {
  return { host: String(fe.smtp || '').trim(), port: Number(fe.smtpPort || 587), guvenlik: fe.guvenlik || 'starttls', kullanici: String(fe.kullanici || fe.adres || '').trim(), sifre };
}
const SmtpV = z.object({
  smtp: z.string().trim().min(3).max(200), smtpPort: z.coerce.number().int().min(1).max(65535),
  guvenlik: z.enum(['starttls', 'ssl', 'yok']).default('starttls'), kullanici: z.string().trim().max(254).default(''),
  sifre: z.string().max(500).optional().default(''),
});
// Bağlantıyı ve girişi dener; başarılıysa şifreyi kasaya yazar (şifre girilmezse kayıtlıyla dener)
r.post('/eposta/smtp/dene', yoneticiGerekli, async (req, res) => {
  const v = SmtpV.parse(req.body);
  const a = { host: v.smtp, port: v.smtpPort, guvenlik: v.guvenlik, kullanici: v.kullanici, sifre: v.sifre || (await smtp.sifreOku(req.db)) };
  if (a.kullanici && !a.sifre) throw new HttpHata(400, 'Şifre gerekli');
  await smtp.dene(a);
  await smtp.kaydet(req.db, { sifre: a.sifre, ozet: smtp.ayarOzeti(a) });
  console.log('smtp dene: ok', a.host, a.port, a.guvenlik);
  res.json({ ok: true });
});
r.post('/eposta/smtp/sil', yoneticiGerekli, async (req, res) => { await smtp.sil(req.db); res.json({ ok: true }); });

// Kullanıcının kendi hesabı (Profilim): her kullanıcı yalnız kendi şifresini dener/kaydeder/siler
async function kullaniciIzinli(req) {
  const fe = json.oku((await req.db('ayarlar').where({ anahtar: 'firma' }).first())?.deger, {}).eposta || {};
  if (fe.kullaniciBaglar === false) throw new HttpHata(403, 'Yönetici, kullanıcıların kendi e-posta hesabını bağlamasını kapattı');
}
r.post('/eposta/hesabim/dene', async (req, res) => {
  await kullaniciIzinli(req);
  const v = SmtpV.parse(req.body);
  const kasa = smtp.kullaniciKasasi(req.kullanici.id);
  const a = { host: v.smtp, port: v.smtpPort, guvenlik: v.guvenlik, kullanici: v.kullanici, sifre: v.sifre || (await smtp.sifreOku(req.db, kasa)) };
  if (a.kullanici && !a.sifre) throw new HttpHata(400, 'Şifre gerekli');
  await smtp.dene(a);
  await smtp.kaydet(req.db, { sifre: a.sifre, ozet: smtp.ayarOzeti(a) }, kasa);
  console.log('smtp hesabim dene: ok', req.kullanici.id, a.host, a.port, a.guvenlik);
  res.json({ ok: true });
});
r.post('/eposta/hesabim/sil', async (req, res) => { await smtp.sil(req.db, smtp.kullaniciKasasi(req.kullanici.id)); res.json({ ok: true }); });

r.post('/eposta/gonder', async (req, res) => {
  const v = GonderV.parse(req.body);
  // Gövde: düz metin + (istenirse) gönderenin HTML imzası; imzadaki resimler gömülü eke dönüşür
  const imzaHtml = v.imza ? String(kullaniciHesabi(req.kullanici).imza || '') : '';
  const govdeYap = (kimden) => google.iletiGovdesi(v.metin, imzaHtml, String(kimden).split('@')[1], v.html);
  const kime = v.kime.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
  if (!kime.length || kime.length > 50 || !kime.every((x) => eposta.safeParse(x).success)) throw new HttpHata(400, 'Alıcı adresi geçersiz');
  const firma = json.oku((await req.db('ayarlar').where({ anahtar: 'firma' }).first())?.deger, {});
  const fe = firma.eposta || {};
  // 1) Kullanıcının kendi hesabı (firma izin veriyorsa ve test edilip şifresi kayıtlıysa)
  const ke = kullaniciHesabi(req.kullanici);
  if (fe.kullaniciBaglar !== false && ke.tur === 'smtp') {
    const sifre = await smtp.sifreOku(req.db, smtp.kullaniciKasasi(req.kullanici.id));
    if (sifre) {
      const a = smtpAyar(ke, sifre);
      const kimden = String(ke.adres || a.kullanici || req.kullanici.eposta).trim();
      try {
        await smtp.gonder(a, { kimden, kimdenAd: ke.ad || req.kullanici.ad || '', kime, konu: v.konu, ...govdeYap(kimden) });
      } catch (e) { console.error('smtp hesabim gonder:', req.kullanici.id, e.message); throw e; }
      return res.json({ ok: true, kimden, kanal: 'kisisel' });
    }
  }
  // 2) Firma hesabı
  if (fe.tur === 'smtp') {
    const sifre = await smtp.sifreOku(req.db);
    if (!sifre) throw new HttpHata(409, 'Firma SMTP şifresi kayıtlı değil: Ayarlar → Firma → E-posta → "Test et ve kaydet"', { kod: 'SMTP_YOK' });
    const a = smtpAyar(fe, sifre);
    const kimden = String(fe.adres || a.kullanici).trim();
    try {
      await smtp.gonder(a, { kimden, kimdenAd: fe.gonderenAd || firma.ad || '', kime, konu: v.konu, ...govdeYap(kimden), cevap: req.kullanici.eposta });
    } catch (e) { console.error('smtp gonder:', e.message); throw e; }
    return res.json({ ok: true, kimden, kanal: 'smtp' });
  }
  if (fe.tur !== 'google') throw new HttpHata(409, 'Firma e-posta hesabı ayarlı değil; Ayarlar → Firma → E-posta', { kod: 'EPOSTA_YOK' });
  const g = await google.gmailGonder(req.db, {
    kimdenAd: fe.gonderenAd || firma.ad || '', kime, konu: v.konu, ...govdeYap(fe.adres || 'neterp.local'), cevap: req.kullanici.eposta,
  });
  res.json({ ok: true, id: g.id, kimden: g.kimden, kanal: 'gmail' });
});

export default r;
