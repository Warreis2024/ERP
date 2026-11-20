// Açık form bağlantısı: kayıt açmadan, kalıcı bir bağlantı / QR ile dışarıdan yeni kayıt.
//  • Yönetim: Modül ayarlarında form tanımlanır (şablon, proje, ilk durum, [[Alan]] → fonksiyon eşlemesi).
//  • Herkese açık: form doldurulunca modülde yeni kayıt açılır; dolduran kişiye takip bağlantısı verilir.
//  • Kötüye kullanım: IP başına hız sınırı, gizli tuzak alanı (robotlar doldurur), sayfa açıldıktan
//    en az 3 sn sonra gönderim (imzalı belirteçle), tanımsız alan ve büyük imza reddi.
import { Router } from 'express';
import { z } from 'zod';
import { HttpHata } from '../hata.js';
import { json } from '../db.js';
import { yonetici } from '../kurallar/yetki.js';
import { tanimlar, yeniId, logYaz, kodUret } from '../veri.js';
import { sifrele, coz } from '../baglanti/kasa.js';
import { belirtecUret, belirtecCoz } from '../auth/oturum.js';
import { ANAHTAR_RE, anahtarUret, anahtarOzet, musteriAlanlari, yanitDogrula, hizSiniri } from '../disOnay.js';
import { alanEslesme, degerUret, belgeDoldur } from '../kurallar/acikForm.js';
import { degerDb } from '../kurallar/degerler.js';
import { firmaEpostasiGonder } from './baglanti.js';

const Kimlik = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);
const FormSema = z.object({
  modulId: Kimlik, ad: z.string().trim().min(1).max(150), sablonId: Kimlik, projeId: Kimlik,
  durumId: Kimlik.nullable().optional(), eslesme: z.record(z.string().max(40)).optional(), aktif: z.boolean().optional(),
});

async function sablonHtml(db, id) {
  const s = await db('sablonlar').where({ id }).first();
  return s ? (json.oku(s.tanim, {}).metin || '') : null;
}
const formApi = (r) => {
  let anahtar = null;
  try { anahtar = r.aktif && r.anahtar_sifreli ? coz(r.anahtar_sifreli)?.a || null : null; } catch { anahtar = null; }
  return {
    id: r.id, modulId: r.modul_id, ad: r.ad, sablonId: r.sablon_id, projeId: r.proje_id, durumId: r.durum_id || '',
    eslesme: json.oku(r.eslesme, {}), aktif: !!r.aktif, sayac: r.sayac || 0, anahtar,
    olusturma: r.olusturma ? new Date(r.olusturma).toISOString() : null,
  };
};

// ---------- yönetim (oturumlu, yalnız yönetim) ----------
export const acikYonetim = Router();
acikYonetim.use('/acik-formlar', (req, res, next) => (yonetici(req.kullanici) ? next() : next(new HttpHata(403, 'Açık formları yalnız yönetim düzenler'))));

acikYonetim.get('/acik-formlar', async (req, res) => {
  const L = await req.db('acik_formlar').orderBy('olusturma');
  res.json(L.map(formApi));
});
async function denetle(req, v) {
  const t = await tanimlar(req), m = t.modul(v.modulId);
  if (!m || m.tur === 'proje') throw new HttpHata(400, 'Modül bulunamadı');
  if (v.durumId && !m.durumlar.some((d) => d.id === v.durumId)) throw new HttpHata(400, 'Durum bu modüle ait değil');
  const html = await sablonHtml(req.db, v.sablonId);
  if (html === null) throw new HttpHata(400, 'Şablon bulunamadı');
  if (!musteriAlanlari(html).length) throw new HttpHata(400, 'Şablonda [[Alan]] yok; dışarıdan doldurulacak alanları [[ ]] ile işaretle');
  if (!await req.db('projeler').where({ id: v.projeId, silindi: false }).first()) throw new HttpHata(400, 'Proje bulunamadı');
}
acikYonetim.post('/acik-formlar', async (req, res) => {
  const v = FormSema.parse(req.body || {});
  await denetle(req, v);
  const a = anahtarUret(), simdi = new Date();
  const r = { id: yeniId(), modul_id: v.modulId, ad: v.ad, sablon_id: v.sablonId, proje_id: v.projeId, durum_id: v.durumId || null, eslesme: json.yaz(v.eslesme || {}), anahtar_ozet: anahtarOzet(a), anahtar_sifreli: sifrele({ a }), aktif: true, sayac: 0, olusturan: req.kullanici.id, olusturma: simdi };
  await req.db('acik_formlar').insert(r);
  res.status(201).json(formApi(r));
});
acikYonetim.put('/acik-formlar/:id', async (req, res) => {
  const id = Kimlik.parse(req.params.id);
  const r = await req.db('acik_formlar').where({ id }).first();
  if (!r) throw new HttpHata(404, 'Form bulunamadı');
  const v = FormSema.parse({ ...formApi(r), ...req.body, modulId: r.modul_id });
  await denetle(req, v);
  await req.db('acik_formlar').where({ id }).update({ ad: v.ad, sablon_id: v.sablonId, proje_id: v.projeId, durum_id: v.durumId || null, eslesme: json.yaz(v.eslesme || {}), guncelleyen: req.kullanici.id, guncelleme: new Date() });
  res.json(formApi(await req.db('acik_formlar').where({ id }).first()));
});
// Yeni anahtar (eski bağlantı ve QR geçersiz olur) ya da kapat / aç
acikYonetim.post('/acik-formlar/:id/:eylem', async (req, res) => {
  const id = Kimlik.parse(req.params.id), eylem = z.enum(['yenile', 'kapat', 'ac', 'sil']).parse(req.params.eylem);
  const r = await req.db('acik_formlar').where({ id }).first();
  if (!r) throw new HttpHata(404, 'Form bulunamadı');
  if (eylem === 'sil') { await req.db('acik_formlar').where({ id }).del(); return res.json({ ok: true }); }
  const d = { guncelleyen: req.kullanici.id, guncelleme: new Date() };
  if (eylem === 'yenile' || eylem === 'ac') { const a = anahtarUret(); Object.assign(d, { anahtar_ozet: anahtarOzet(a), anahtar_sifreli: sifrele({ a }), aktif: true }); }
  if (eylem === 'kapat') Object.assign(d, { aktif: false });
  await req.db('acik_formlar').where({ id }).update(d);
  res.json(formApi(await req.db('acik_formlar').where({ id }).first()));
});

// ---------- herkese açık ----------
export const acikGenel = Router();
const sinirOku = hizSiniri(120, 10 * 60_000), sinirYaz = hizSiniri(10, 10 * 60_000);
const ip = (req) => String(req.ip || req.headers['x-forwarded-for'] || '').split(',')[0].trim().slice(0, 64);
acikGenel.use((req, res, next) => {
  res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' });
  if (!sinirOku(ip(req))) return next(new HttpHata(429, 'Çok fazla istek; biraz sonra yeniden dene'));
  next();
});
async function firmaBilgi(req) {
  const f = json.oku((await req.db('ayarlar').where({ anahtar: 'firma' }).first())?.deger, {});
  return { ad: f.ad || req.firma.ad, logo: typeof f.logo === 'string' && f.logo.startsWith('data:image/') ? f.logo : '' };
}

// Takip: formu dolduranın kaydının durumu (kişisel veri ve iç alanlar gösterilmez)
acikGenel.get('/takip/:anahtar', async (req, res) => {
  const a = String(req.params.anahtar || '');
  if (!ANAHTAR_RE.test(a)) throw new HttpHata(404, 'Bağlantı geçersiz');
  const t = await req.db('form_takipler').where({ anahtar_ozet: anahtarOzet(a) }).first();
  if (!t) throw new HttpHata(404, 'Bağlantı geçersiz');
  const k = await req.db('kartlar').where({ id: t.kart_id }).first();
  if (!k || k.silindi) throw new HttpHata(410, 'Bu talep artık izlenemiyor');
  const tn = await tanimlar(req), m = tn.modul(k.modul_id), d = tn.durum(k.durum_id), form = await req.db('acik_formlar').where({ id: t.form_id }).first();
  res.json({
    firma: await firmaBilgi(req), baslik: form?.ad || m?.ad || '', kod: k.kod, durum: d?.ad || '', renk: d?.renk || '', kapali: !!d?.kapat,
    adimlar: (m?.durumlar || []).map((x) => ({ ad: x.ad, gecti: x.sira <= (d?.sira ?? -1) })),
    olusturma: new Date(k.olusturma).toISOString(), guncelleme: k.guncelleme ? new Date(k.guncelleme).toISOString() : null,
  });
});

async function formBul(req) {
  const a = String(req.params.anahtar || '');
  if (!ANAHTAR_RE.test(a)) throw new HttpHata(404, 'Bağlantı geçersiz');
  const r = await req.db('acik_formlar').where({ anahtar_ozet: anahtarOzet(a) }).first();
  if (!r) throw new HttpHata(404, 'Bağlantı geçersiz');
  if (!r.aktif) throw new HttpHata(410, 'Bu form şu an kapalı');
  return r;
}

acikGenel.get('/:anahtar', async (req, res) => {
  const r = await formBul(req);
  const html = await sablonHtml(req.db, r.sablon_id);
  if (html === null) throw new HttpHata(410, 'Bu form şu an kapalı');
  res.json({
    durum: 'acik', tur: 'form', firma: await firmaBilgi(req), baslik: r.ad, belge: html, alanlar: musteriAlanlari(html),
    belirtec: belirtecUret({ af: r.id, t: Date.now() }, 6 * 3600),
  });
});

const IletisimSema = z.object({ ad: z.string().trim().max(150).default(''), eposta: z.string().trim().toLowerCase().max(254).default('') });
acikGenel.post('/:anahtar', async (req, res) => {
  if (!sinirYaz(ip(req))) throw new HttpHata(429, 'Çok fazla istek; biraz sonra yeniden dene');
  const r = await formBul(req);
  const g = req.body && typeof req.body === 'object' ? req.body : {};
  // robot denetimi: tuzak alanı boş olmalı, belirteç bu formun ve en az 3 sn önce alınmış olmalı
  const b = belirtecCoz(String(g.belirtec || ''));
  if (g.web || !b || b.af !== r.id || Date.now() - Number(b.t) < 3000) throw new HttpHata(400, 'Form doğrulanamadı; sayfayı yenileyip yeniden dene');
  const iletisim = IletisimSema.parse(g.iletisim || {});
  if (iletisim.eposta && !z.string().email().safeParse(iletisim.eposta).success) throw new HttpHata(400, 'E-posta adresi geçersiz');
  const html = await sablonHtml(req.db, r.sablon_id);
  const alanlar = musteriAlanlari(html);
  const { sonuc, hatalar } = yanitDogrula({ alanlar: g.alanlar }, { alanlar });
  if (hatalar.length) throw new HttpHata(400, hatalar[0], { hatalar });

  const t = await tanimlar(req), m = t.modul(r.modul_id);
  if (!m) throw new HttpHata(410, 'Bu form şu an kapalı');
  const p = await req.db('projeler').where({ id: r.proje_id, silindi: false }).first();
  if (!p) throw new HttpHata(410, 'Bu form şu an kapalı');
  const durum = m.durumlar.find((d) => d.id === r.durum_id) || m.durumlar[0];
  const es = alanEslesme(alanlar, m.fn, json.oku(r.eslesme, {}));
  const cevap = { ...sonuc.alanlar, ...sonuc.imzalar };
  const simdi = new Date(), kartId = yeniId(), ortak = { projeId: p.id, modulId: m.id, kartId };
  const kullanan = new Set(), satirlar = [];
  for (const a of alanlar) {
    const f = es[a.ad]; if (!f || kullanan.has(f.uid) || !cevap[a.ad]) continue;
    const alan = degerUret(f, cevap[a.ad]); if (!alan) continue;
    kullanan.add(f.uid);
    satirlar.push({ id: yeniId(), fnUid: f.uid, fnTip: f.tip, sira: 0, ...alan });
  }
  // doldurulmuş belge, modülde Şablon fonksiyonu varsa saklanır (eşlenmeyen cevaplar da kaybolmaz)
  const sf = m.fn.find((f) => f.tip === 'sablon');
  if (sf) satirlar.push({ id: yeniId(), fnUid: sf.uid, fnTip: 'sablon', sira: 0, tur: r.sablon_id, metin: belgeDoldur(html, sonuc.alanlar, sonuc.imzalar) });
  const ef = m.fn.find((f) => f.tip === 'eposta' && !kullanan.has(f.uid));
  if (ef && iletisim.eposta) satirlar.push({ id: yeniId(), fnUid: ef.uid, fnTip: 'eposta', sira: 0, metin: iletisim.eposta });
  const takipAnahtar = anahtarUret();
  let kod;
  await req.db.transaction(async (trx) => {
    kod = await kodUret(trx, m);
    await trx('kartlar').insert({ id: kartId, kod, modul_id: m.id, proje_id: p.id, durum_id: durum.id, olusturan: r.olusturan, olusturma: simdi, guncelleyen: r.olusturan, guncelleme: simdi });
    for (const s of satirlar) await trx('degerler').insert({ ...degerDb(s, ortak), olusturan: r.olusturan, olusturma: simdi, guncelleyen: r.olusturan, guncelleme: simdi });
    const kim = { id: null, ad: iletisim.ad ? `${iletisim.ad} (açık form)` : 'Açık form' };
    const ozet = [`${r.ad} formundan geldi`, ...Object.entries(sonuc.alanlar).map(([k, v]) => `${k}: ${v}`), Object.keys(sonuc.imzalar).length ? 'İmzalı' : '',
      iletisim.ad ? 'Dolduran: ' + iletisim.ad : '', iletisim.eposta ? 'E-posta: ' + iletisim.eposta : '', 'IP: ' + ip(req)].filter(Boolean).join(' · ');
    await logYaz(trx, kim, ortak, { tip: 'yeni', metin: ozet.slice(0, 3000) });
    await trx('form_takipler').insert({ id: yeniId(), form_id: r.id, kart_id: kartId, anahtar_ozet: anahtarOzet(takipAnahtar), eposta: iletisim.eposta || null, ad: iletisim.ad || null, ip: ip(req), olusturma: simdi });
    await trx('acik_formlar').where({ id: r.id }).increment('sayac', 1);
  });
  const takip = `${req.protocol}://${req.get('host')}/onay.html#t=${takipAnahtar}`;
  let eposta = null;
  if (iletisim.eposta) {
    const fb = await firmaBilgi(req);
    eposta = await firmaEpostasiGonder(req, {
      kime: iletisim.eposta, konu: `[${kod}] ${r.ad}`,
      metin: `Talebiniz alındı. Kayıt numaranız: ${kod}\n\nDurumunu buradan izleyebilirsiniz:\n${takip}\n\n${fb.ad}`,
      html: `<p>Talebiniz alındı. Kayıt numaranız: <b>${kod}</b></p><p>Durumunu buradan izleyebilirsiniz:<br><a href="${takip}">${takip}</a></p><p>${String(fb.ad).replace(/[<>&]/g, '')}</p>`,
    }).catch(() => null);
  }
  res.status(201).json({ ok: true, kod, takip: '#t=' + takipAnahtar, epostaGitti: !!eposta?.gonderildi });
});

