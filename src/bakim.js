// Veri bakımı:
//  • arsivTemizle: proje arşivlenince o projenin silindi işaretli kayıtları ve artıkları kalıcı silinir.
//    İşlem günlüğü (log) hiç silinmez; projeye "Arşiv bakımı" satırı yazılır.
//  • depoyaSupur: 3 yıldan uzun süredir arşivdeki projelerde veritabanına gömülü dosyalar (doküman, mesaj ekleri)
//    firmanın bulut deposuna (Google Drive / OneDrive, NetERP/<proje kodu>) taşınır; kayıtta bağlantısı kalır.
//    Vercel süre sınırı için her çağrı en çok SURE_MS / ADET_SINIR kadar iş yapar; kalan varsa istemci yeniden çağırır.
//    İmzalar taşınmaz (çıktılarda gömülü gerekir).
import { json } from './db.js';
import { logYaz } from './veri.js';
import { HttpHata } from './hata.js';
import * as google from './baglanti/google.js';
import * as drive from './baglanti/driveHesap.js';
import * as ms from './baglanti/microsoft.js';

const PARCA = 100; // whereIn parçası

async function parcali(ids, f) { for (let i = 0; i < ids.length; i += PARCA) await f(ids.slice(i, i + PARCA)); }

/** Bir arşiv projesinin silinmiş kayıtlarını ve artıklarını temizler. Sayıları döner. */
export async function arsivTemizle(db, projeId, u) {
  const p = await db('projeler').where({ id: projeId }).first();
  if (!p || !p.arsiv) return null;
  const say = { kayit: 0, deger: 0, bag: 0, onay: 0, takip: 0, eposta: 0 };
  await db.transaction(async (trx) => {
    const ids = await trx('kartlar').where({ proje_id: projeId, silindi: true }).pluck('id');
    await parcali(ids, async (L) => {
      say.deger += await trx('degerler').whereIn('kart_id', L).del();
      say.bag += await trx('kayit_baglari').whereIn('kaynak_id', L).orWhereIn('hedef_id', L).del();
      say.onay += await trx('dis_onaylar').whereIn('kart_id', L).del();
      say.takip += await trx('form_takipler').whereIn('kart_id', L).del();
      say.eposta += await trx('epostalar').whereIn('kart_id', L).del();
      say.kayit += await trx('kartlar').whereIn('id', L).del();
    });
    // artıklar: kaydı olmayan değerler; süresi geçmiş, yanıtlanmamış dış onaylar
    say.deger += await trx('degerler').where({ proje_id: projeId }).whereNotNull('kart_id')
      .whereNotExists(trx('kartlar').whereRaw('kartlar.id = degerler.kart_id')).del();
    say.onay += await trx('dis_onaylar').where({ proje_id: projeId, durum: 'bekliyor' }).where('son_gecerlilik', '<', new Date()).del();
    const toplam = Object.values(say).reduce((a, b) => a + b, 0);
    if (toplam && u) {
      const ortak = { projeId, modulId: null };
      await logYaz(trx, u, ortak, { tip: 'bakim', metin: `Arşiv bakımı: ${say.kayit} silinmiş kayıt ve ${toplam - say.kayit} artık satır kalıcı temizlendi` });
    }
  });
  return say;
}

/** Kaydı olmayan bağlar ve süresi geçmiş eşleme kodları (firma geneli). */
export async function artikTemizle(db) {
  const bag = await db('kayit_baglari')
    .where((q) => q.where('kaynak_tur', 'kart').whereNotExists(db('kartlar').whereRaw('kartlar.id = kayit_baglari.kaynak_id'))
      .orWhere((q2) => q2.where('kaynak_tur', 'proje').whereNotExists(db('projeler').whereRaw('projeler.id = kayit_baglari.kaynak_id'))))
    .orWhereNotExists(db('kartlar').whereRaw('kartlar.id = kayit_baglari.hedef_id')).del();
  const giris = await db('giris_kayitlari').where('zaman', '<', new Date(Date.now() - 365 * 864e5)).del();
  return { bag, giris };
}

// ---------------- depoya süpür ----------------
const DATA_RE = /^data:([\w.+-]+\/[\w.+-]+)(;[\w=.,-]+)*;base64,([A-Za-z0-9+/]+=*)$/;
const UZANTI = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf', 'audio/webm': 'webm', 'video/mp4': 'mp4', 'video/webm': 'webm', 'audio/mpeg': 'mp3' };
export function dataCoz(url) {
  const m = DATA_RE.exec(String(url || ''));
  return m ? { tip: m[1], veri: Buffer.from(m[3], 'base64') } : null;
}
const adTemiz = (s) => String(s || '').replace(/[\\/:*?"<>|\r\n]+/g, '_').trim().slice(0, 150);
export function dosyaAdi(ad, tip, yedek) {
  const a = adTemiz(ad);
  if (a && /\.[a-z0-9]{2,5}$/i.test(a)) return a;
  return (a || yedek) + '.' + (UZANTI[tip] || tip.split('/')[1] || 'bin');
}

/** Firmanın kullanılabilir bulut deposu: 'gdrive' | 'onedrive' | '' */
export async function bulutDepo(db) {
  try {
    const a = await db('ayarlar').where({ anahtar: 'firma' }).first();
    const d = json.oku(a?.deger, {}).depo;
    if (d === 'gdrive') { const [gd, g] = await Promise.all([drive.durum(db), google.durum(db)]); return gd.bagli || (g.bagli && g.drive) ? 'gdrive' : ''; }
    if (d === 'onedrive') { const m = await ms.durum(db); return m.bagli && m.dosya ? 'onedrive' : ''; }
  } catch (e) { console.error('bulut depo:', e.message); }
  return '';
}

// Tek parçada yükler (gömülü dosyalar en çok birkaç MB). { id, url } döner.
async function bulutaYaz(db, depo, klasor, { ad, tip, veri }) {
  if (depo === 'onedrive') {
    const klasorId = klasor.id || (klasor.id = await ms.projeKlasoru(db, klasor.kod));
    const uri = await ms.yuklemeBaslat(db, { ad, klasorId });
    const s = await ms.parcaGonder(uri, veri, 0, veri.length);
    if (!s.bitti) throw new HttpHata(502, 'OneDrive yüklemesi tamamlanmadı');
    let url = s.dosya.webViewLink;
    try { url = (await ms.kurulustaPaylas(db, s.dosya.id)) || url; } catch { /* kişisel hesap */ }
    return { id: s.dosya.id, url };
  }
  if (klasor.paylasimli === undefined) klasor.paylasimli = drive.yapilandirildi() && !!(await drive.ayar(db));
  const klasorId = klasor.id || (klasor.id = klasor.paylasimli ? await drive.projeKlasoru(db, klasor.kod, klasor.ad) : await google.projeKlasoru(db, klasor.kod, klasor.ad));
  const uri = klasor.paylasimli ? await drive.yuklemeBaslat({ ad, tip, boyut: veri.length, klasorId }) : await google.yuklemeBaslat(db, { ad, tip, boyut: veri.length, klasorId });
  const s = await google.parcaGonder(uri, veri, 0, veri.length);
  if (!s.bitti) throw new HttpHata(502, 'Google Drive yüklemesi tamamlanmadı');
  if (!klasor.paylasimli) { try { await google.alandaPaylas(db, s.dosya.id); } catch { /* kişisel hesap */ } }
  return { id: s.dosya.id, url: s.dosya.webViewLink };
}

const ESKI_YIL = 3;
export const supurSiniri = (simdi = new Date()) => new Date(simdi.getFullYear() - ESKI_YIL, simdi.getMonth(), simdi.getDate());

// Bir değer satırındaki gömülü dosyalar: [{yer:'url'|'ek', i, ad, url}]
export function gomululer(d) {
  const L = [];
  if (d.fn_tip === 'dokuman' && String(d.url || '').startsWith('data:')) L.push({ yer: 'url', ad: d.dosya || d.metin || '', url: d.url });
  if (d.fn_tip === 'mesaj' && d.ek && d.ek.includes('"data:')) {
    const ek = json.oku(d.ek, {});
    (Array.isArray(ek.ekler) ? ek.ekler : []).forEach((e, i) => { if (!e.depo && String(e.url || '').startsWith('data:')) L.push({ yer: 'ek', i, ad: e.ad, url: e.url }); });
  }
  return L;
}

const satirSorgu = (db, projeIdler) => db('degerler').whereIn('proje_id', projeIdler)
  .where((q) => q.where((a) => a.where('fn_tip', 'dokuman').where('url', 'like', 'data:%'))
    .orWhere((a) => a.where('fn_tip', 'mesaj').where('ek', 'like', '%"data:%')));

/** Önizleme (dene) ya da taşıma. */
export async function depoyaSupur(db, u, { dene = true, SURE_MS = 20000, ADET_SINIR = 40 } = {}) {
  const projeler = await db('projeler').where({ arsiv: true, silindi: false }).where('arsiv_tarihi', '<', supurSiniri()).select('id', 'kod', 'ad');
  const sonuc = { proje: projeler.length, dosya: 0, bayt: 0, tasinan: 0, hata: 0, kalan: 0, depo: '' };
  if (!projeler.length) return sonuc;
  const idler = projeler.map((p) => p.id);
  if (dene) {
    const sat = await satirSorgu(db, idler).select('fn_tip', 'url', 'ek', 'dosya', 'metin');
    for (const d of sat) for (const g of gomululer(d)) { sonuc.dosya++; sonuc.bayt += Math.floor(String(g.url).length * 0.75); }
    sonuc.depo = await bulutDepo(db);
    return sonuc;
  }
  const depo = await bulutDepo(db);
  if (!depo) throw new HttpHata(409, 'Bulut depo bağlı değil. Ayarlar → Firma → Bulut depolar.');
  sonuc.depo = depo;
  const bas = Date.now();
  const klasorler = new Map(projeler.map((p) => [p.id, { kod: p.kod, ad: p.ad }]));
  const sat = await satirSorgu(db, idler).select('*').limit(ADET_SINIR);
  for (const d of sat) {
    if (Date.now() - bas > SURE_MS) break;
    const ek = json.oku(d.ek, {}) || {};
    const degisim = {}; let degisti = false;
    for (const g of gomululer(d)) {
      const c = dataCoz(g.url);
      if (!c) { sonuc.hata++; continue; }
      try {
        const ad = dosyaAdi(g.ad, c.tip, `${d.fn_tip}-${d.id}${g.yer === 'ek' ? '-' + g.i : ''}`);
        const y = await bulutaYaz(db, depo, klasorler.get(d.proje_id), { ad, tip: c.tip, veri: c.veri });
        if (g.yer === 'url') { degisim.url = y.url; degisim.depo = depo; degisim.boyut = c.veri.length; ek.dosyaId = y.id; ek.klasor = `NetERP/${klasorler.get(d.proje_id).kod || 'Genel'}`; }
        else ek.ekler[g.i] = { ad: g.ad || ad, url: y.url, depo, dosyaId: y.id, boyut: c.veri.length, tip: c.tip };
        sonuc.tasinan++; sonuc.bayt += c.veri.length; degisti = true;
      } catch (e) { sonuc.hata++; console.error('depoya süpür:', e.message); }
    }
    if (degisti) {
      await db('degerler').where({ id: d.id }).update({ ...degisim, ek: JSON.stringify(ek) });
    }
  }
  sonuc.kalan = Number((await satirSorgu(db, idler).count({ n: '*' }).first()).n);
  if (sonuc.tasinan) {
    await logYaz(db, u, { projeId: null }, { tip: 'bakim', metin: `Depoya süpür: ${sonuc.tasinan} dosya ${depo === 'onedrive' ? 'OneDrive' : 'Google Drive'}'a taşındı` });
  }
  return sonuc;
}
