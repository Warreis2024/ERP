// Ticket fonksiyonu: modüle bağlı bir e-posta kutusunu (IMAP) kontrol eder; okunmamış her iletiden kayıt açar.
//  • Konuda modülün kayıt kodu varsa ([SRV-1001] gibi) ileti o kayda mesaj olarak eklenir (yanıt zinciri).
//  • Aynı ileti (Message-ID) ikinci kez işlenmez.
//  • Gönderen, rehberde e-postasıyla eşleşen firmaya bağlanır; kayıttaki Firma / E-posta alanlarına yazılır.
//  • Kutu ayarı yöneticidedir; şifre şifreli kasada tutulur. Kontrol, modül açıldığında (en çok 2 dakikada bir)
//    ya da "Şimdi kontrol et" ile yapılır; AI ile sınıflandırma sonra eklenecek.
import { Router } from 'express';
import { z } from 'zod';
import { HttpHata } from '../hata.js';
import { json } from '../db.js';
import { yonetici, yazabilir } from '../kurallar/yetki.js';
import { tanimlar, yeniId, logYaz, kodUret } from '../veri.js';
import { kasaOku, kasaYaz } from '../baglanti/kasa.js';
import { okunmamislariIsle, baglan } from '../baglanti/imap.js';
import { iletiCoz, alintiKes } from '../baglanti/mime.js';
import { degerDb } from '../kurallar/degerler.js';
import { mesajBildir } from '../bildirimServis.js';

const r = Router();
const Kimlik = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);
const KutuSema = z.object({
  host: z.string().trim().min(3).max(200).regex(/^[A-Za-z0-9.-]+$/, 'Sunucu adı geçersiz'),
  port: z.coerce.number().int().min(1).max(65535).default(993),
  kullanici: z.string().trim().min(1).max(254),
  sifre: z.string().max(500).optional(),
  klasor: z.string().trim().max(100).default('INBOX'),
});
const DURUM = (fn) => 'ticket-son:' + fn;

async function fnBul(req, fnUid) {
  const t = await tanimlar(req);
  for (const m of t.moduller) { const f = m.fn.find((x) => x.uid === fnUid && x.tip === 'ticket'); if (f) return { m, f }; }
  throw new HttpHata(404, 'Ticket fonksiyonu bulunamadı');
}

r.get('/ticket/:fn', async (req, res) => {
  if (!yonetici(req.kullanici)) throw new HttpHata(403, 'Yalnız yönetim');
  const fn = Kimlik.parse(req.params.fn); await fnBul(req, fn);
  const k = await kasaOku(req.db, 'ticket:' + fn);
  const d = json.oku((await req.db('ayarlar').where({ anahtar: DURUM(fn) }).first())?.deger, {});
  res.json({ host: k?.host || '', port: k?.port || 993, kullanici: k?.kullanici || '', klasor: k?.klasor || 'INBOX', sifreKayitli: !!k?.sifre, son: d.zaman || null, sonuc: d.sonuc || null, hata: d.hata || null });
});

// Kutu ayarını sına ve kaydet (şifre boş gelirse kayıtlı olan kullanılır)
r.put('/ticket/:fn', async (req, res) => {
  if (!yonetici(req.kullanici)) throw new HttpHata(403, 'Yalnız yönetim');
  const fn = Kimlik.parse(req.params.fn); await fnBul(req, fn);
  const v = KutuSema.parse(req.body || {});
  const eski = await kasaOku(req.db, 'ticket:' + fn);
  const sifre = v.sifre || eski?.sifre;
  if (!sifre) throw new HttpHata(400, 'Şifre gerekli');
  const ayar = { host: v.host, port: v.port, kullanici: v.kullanici, sifre, klasor: v.klasor };
  let c;
  try { c = await baglan(ayar, 12000); await c.giris(ayar.kullanici, ayar.sifre); await c.sec(ayar.klasor); }
  catch (e) { throw new HttpHata(400, 'Bağlanılamadı: ' + e.message); }
  finally { if (c) await c.cikis(); }
  await kasaYaz(req.db, 'ticket:' + fn, ayar);
  res.json({ ok: true });
});

// Gelen kutusunu kontrol et
r.post('/ticket/:fn/kontrol', async (req, res) => {
  const u = req.kullanici, db = req.db, fn = Kimlik.parse(req.params.fn);
  const { m, f } = await fnBul(req, fn);
  if (!yazabilir(u, m.id)) throw new HttpHata(403, 'Bu modülde yazma yetkin yok');
  const zorla = !!(req.body && req.body.zorla);
  const durumSat = await db('ayarlar').where({ anahtar: DURUM(fn) }).first();
  const once = json.oku(durumSat?.deger, {});
  if (!zorla && once.zaman && Date.now() - new Date(once.zaman) < 120_000) return res.json({ atlandi: true, son: once.zaman, sonuc: once.sonuc || null });
  const ayar = await kasaOku(db, 'ticket:' + fn);
  if (!ayar?.sifre) throw new HttpHata(400, 'Ticket e-posta kutusu ayarlanmamış (Ayarlar → Modüller → fonksiyon)');
  const yaz = async (o) => {
    const deger = json.yaz({ zaman: new Date().toISOString(), ...o });
    if (await db('ayarlar').where({ anahtar: DURUM(fn) }).first()) await db('ayarlar').where({ anahtar: DURUM(fn) }).update({ deger, guncelleme: new Date() });
    else await db('ayarlar').insert({ anahtar: DURUM(fn), deger, guncelleme: new Date() });
  };
  await yaz({ sonuc: once.sonuc || null }); // aynı anda iki kontrol başlamasın
  const sayac = { yeni: 0, yanit: 0, tekrar: 0, kodlar: [] };
  try {
    const sonuc = await okunmamislariIsle(ayar, async (ham) => {
      const e = iletiCoz(ham);
      return iletiIsle(req, m, f, e, sayac);
    });
    await yaz({ sonuc: { ...sayac, bulunan: sonuc.bulunan } });
    res.json({ ...sayac, bulunan: sonuc.bulunan });
  } catch (e) {
    await yaz({ sonuc: once.sonuc || null, hata: e.message });
    throw new HttpHata(502, 'E-posta kutusu okunamadı: ' + e.message);
  }
});

const ilkFn = (m, tipler, uid) => (uid && m.fn.find((x) => x.uid === uid)) || m.fn.find((x) => tipler.includes(x.tip));

async function iletiIsle(req, m, f, e, sayac) {
  const db = req.db, ayar = f.ayar?.ticket || {};
  if (e.mesajId && await db('degerler').where({ fn_tip: 'ticket', metin: e.mesajId }).first()) { sayac.tekrar++; return true; }
  const simdi = new Date(), kim = { id: null, ad: e.kimdenAd || e.kimdenAdres || 'E-posta' };
  // yanıt: konuda bu modülün kodu
  const onek = String(m.onek || '').replace(/[^A-Za-z0-9ÇĞİÖŞÜ]/g, '');
  const kodM = onek && e.konu.match(new RegExp(`\\[?(${onek}-\\d{3,})\\]?`, 'i'));
  if (kodM) {
    const k = await db('kartlar').where({ kod: kodM[1].toUpperCase(), modul_id: m.id, silindi: false }).first();
    const mf = m.fn.find((x) => x.tip === 'mesaj');
    if (k && mf) {
      const ortak = { projeId: k.proje_id, modulId: m.id, kartId: k.id };
      const metin = (alintiKes(e.metin) || e.metin).slice(0, 10000);
      await db.transaction(async (trx) => {
        await trx('degerler').insert({ ...degerDb({ id: yeniId(), fnUid: mf.uid, fnTip: 'mesaj', metin: `✉ ${kim.ad}: ${metin}`, kisi: kim.ad, zaman: simdi.toISOString(), okuyan: [] }, ortak), olusturma: simdi, guncelleme: simdi });
        await trx('degerler').insert({ ...degerDb({ id: yeniId(), fnUid: f.uid, fnTip: 'ticket', metin: e.mesajId || 'yanit-' + yeniId(), kisi: e.kimdenAdres, tur: 'yanit', zaman: simdi.toISOString() }, ortak), olusturma: simdi, guncelleme: simdi });
        await logYaz(trx, kim, ortak, { tip: 'alan', alan: f.ad, metin: `E-posta yanıtı geldi: ${e.kimden}` });
      });
      await mesajBildir(req, { projeId: k.proje_id, kartId: k.id, alici: [], metin, kod: k.kod, baslik: e.konu });
      sayac.yanit++; sayac.kodlar.push(k.kod);
      return true;
    }
  }
  // yeni kayıt
  const p = (ayar.projeId && await db('projeler').where({ id: ayar.projeId, silindi: false }).first()) || null;
  if (!p) throw new Error('Ticket fonksiyonunda proje seçilmemiş');
  const durum = m.durumlar.find((d) => d.id === ayar.durumId) || m.durumlar[0];
  // rehber: e-postası eşleşen kişi ya da firma
  let firma = '';
  if (e.kimdenAdres) {
    const rk = await db('rehber_kisiler').whereRaw('lower(eposta) = ?', [e.kimdenAdres]).first();
    const rf = rk?.firma_id ? await db('rehber_firmalar').where({ id: rk.firma_id }).first() : await db('rehber_firmalar').whereRaw('lower(eposta) = ?', [e.kimdenAdres]).first();
    firma = rf?.ad || '';
  }
  const kartId = yeniId(), ortak = { projeId: p.id, modulId: m.id, kartId };
  const satir = [{ fnUid: f.uid, fnTip: 'ticket', metin: e.mesajId || 'ileti-' + kartId, kisi: e.kimdenAdres, tur: 'yeni', zaman: simdi.toISOString(), not: e.kimdenAd }];
  const konuF = ilkFn(m, ['light'], ayar.konuFn), govdeF = ilkFn(m, ['aciklama', 'rich', 'zengin'], ayar.govdeFn);
  if (konuF && e.konu) satir.push({ fnUid: konuF.uid, fnTip: konuF.tip, metin: e.konu.slice(0, 500) });
  if (govdeF && e.metin) {
    const g = e.metin.slice(0, 20000) + (e.ekler.length ? `\n\n[Ekler: ${e.ekler.join(', ')}]` : '');
    satir.push({ fnUid: govdeF.uid, fnTip: govdeF.tip, metin: govdeF.tip === 'aciklama' || govdeF.tip === 'light' ? g : '<p>' + g.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])).replace(/\n/g, '<br>') + '</p>' });
  }
  const epF = m.fn.find((x) => x.tip === 'eposta');
  if (epF && e.kimdenAdres) satir.push({ fnUid: epF.uid, fnTip: 'eposta', metin: e.kimdenAdres });
  const fiF = m.fn.find((x) => x.tip === 'firma');
  if (fiF && firma) satir.push({ fnUid: fiF.uid, fnTip: 'firma', firma });
  let kod;
  await db.transaction(async (trx) => {
    kod = await kodUret(trx, m);
    await trx('kartlar').insert({ id: kartId, kod, modul_id: m.id, proje_id: p.id, durum_id: durum.id, olusturan: null, olusturma: simdi, guncelleyen: null, guncelleme: simdi });
    for (const s of satir) await trx('degerler').insert({ ...degerDb({ id: yeniId(), sira: 0, ...s }, ortak), olusturma: simdi, guncelleme: simdi });
    await logYaz(trx, kim, ortak, { tip: 'yeni', metin: `E-postadan açıldı: ${e.kimden}${firma ? ' (' + firma + ')' : ''} · ${e.konu}`.slice(0, 3000) });
  });
  sayac.yeni++; sayac.kodlar.push(kod);
  return true;
}

export default r;
