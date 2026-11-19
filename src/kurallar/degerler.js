// Fonksiyon değerleri: boşluk kontrolü, özet metni, API ↔ veritabanı dönüşümü.
// Şablondaki (sablon.html) degerBos / ozet / sayiOku kurallarının sunucu karşılığı. Bağımlılığı yoktur.

export const COKLU = new Set(['ekip', 'karar', 'dokuman', 'mali', 'mesaj', 'baglanti', 'etiket', 'sure', 'stok', 'kontrol']);

// HTML'den düz metin (sunucuda DOM yok; etiketleri ve varlıkları basitçe ayıklar).
export function duz(s) {
  if (!s) return '';
  s = String(s);
  if (!/[<&]/.test(s)) return s;
  const t = s
    .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr)\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (t) return t;
  if (/<img/i.test(s)) return 'Resim';
  if (/<table/i.test(s)) return 'Tablo';
  return '';
}

// "1.250,50" | "1250.5" | 1250.5 → 1250.5
export function sayiOku(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  let t = String(v ?? '').trim().replace(/\s/g, '');
  if (!t) return 0;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}
const sayiMi = (v) => String(v ?? '').trim() !== '';

export function degerBos(tip, r) {
  if (!r) return true;
  const d = (x) => String(x ?? '').trim();
  switch (tip) {
    case 'tarih': return !r.tarih;
    case 'kisi': return !d(r.kisi);
    case 'firma': return !d(r.firma);
    case 'yer': { const u = d(r.ulke); return ![r.yer, r.il, r.ilce].some((x) => d(x)) && (!u || u === 'Türkiye'); }
    case 'sayi': case 'yuzde': return !sayiMi(r.adet);
    case 'fiyat': return !sayiMi(r.tutar);
    case 'tur': return !r.tur;
    case 'evet': return r.metin !== 'Evet';
    case 'sure': return !sayiMi(r.adet) && !d(r.metin);
    case 'imza': return !r.url;
    case 'stok': return !d(r.malzeme) && !sayiMi(r.adet);
    case 'depo': return !r.depo;
    case 'kontrol': return !d(r.metin);
    case 'mali': return !(d(r.metin) || sayiMi(r.tutar) || sayiMi(r.adet));
    case 'dokuman': return !r.dosya && !r.url;
    case 'baglanti': return !r.url && !d(r.metin);
    case 'ekip': return !r.kisi && !d(r.metin);
    case 'karar': case 'mesaj': case 'etiket': return !d(r.metin);
    case 'gecmis': return true;
    case 'rich': case 'zengin': return !duz(r.metin);
    default: return !d(r.metin);
  }
}

const trh = (s) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(8, 10) + '.' + s.slice(5, 7) + '.' + s.slice(0, 4) : (s || ''));

// Log ve özetlerde kullanılan tek satırlık metin. ad(): kullanıcı/depo id → ad.
export function ozet(r, ad = { kisi: (x) => x || '', depo: (x) => x || '' }) {
  if (!r) return '';
  const m = duz(r.metin);
  const f = (...a) => a.filter((x) => String(x ?? '').trim()).join(' · ');
  switch (r.fnTip) {
    case 'mali': return f(r.hareket, sayiMi(r.tutar) ? r.tutar + ' ' + (r.para || '') : '', r.odeme, m);
    case 'tarih': return trh(r.tarih);
    case 'kisi': case 'ekip': return [ad.kisi(r.kisi), m].filter(Boolean).join(': ');
    case 'firma': return r.firma || '';
    case 'yer': return f(r.yer, r.ilce, r.il, r.ulke);
    case 'sayi': return String(r.adet ?? '');
    case 'yuzde': return sayiMi(r.adet) ? '%' + r.adet : '';
    case 'fiyat': return [r.tutar, r.para].filter((x) => String(x ?? '').trim()).join(' ');
    case 'evet': return r.metin === 'Evet' ? 'Evet' : 'Hayır';
    case 'sure': return f(sayiMi(r.adet) ? r.adet + ' sa' : '', ad.kisi(r.kisi), m);
    case 'imza': return r.url ? 'İmzalı' + (r.kisi ? ' · ' + r.kisi : '') : '';
    case 'konum': return f(m, r.not);
    case 'dokuman': return r.dosya || m || '';
    case 'baglanti': return m || r.url || '';
    case 'stok': return f(r.hareket, r.malzeme, sayiMi(r.adet) ? r.adet + ' ' + (r.birim || '') : '', ad.depo(r.depo) + (r.hareket === 'Transfer' && r.hedef ? ' → ' + ad.depo(r.hedef) : ''));
    case 'depo': return ad.depo(r.depo);
    case 'karar': return (r.tur === 'tamam' ? '✓ ' : '') + m;
    case 'kontrol': return ({ uygun: '✓ ', sorun: '✗ ', yok: '– ' }[r.tur] || '○ ') + m + (r.not ? ' (' + r.not + ')' : '');
    case 'mesaj': return m + ((r.ekler || []).length ? ' 📷' : '');
  }
  return m || r.tur || trh(r.tarih) || r.firma || '';
}

// ---- API (şablonla aynı alan adları) ↔ veritabanı sütunları ----
const DUZ = ['metin', 'kisi', 'tur', 'firma', 'hareket', 'odeme', 'para', 'url', 'dosya', 'depo', 'hedef', 'malzeme', 'birim',
  'rev', 'onem', 'onay', 'yukleyen', 'renk', 'yer', 'il', 'ilce', 'ulke'];
const EK = ['okuyan', 'ekler', 'slot', 'tip', 'kisiId'];
const TARIH = (v) => (v && /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10) : null);
const ZAMAN = (v) => { if (!v) return null; const d = new Date(String(v).replace(' ', 'T')); return Number.isNaN(d.getTime()) ? null : d; };
const KES = (v, n) => (v === undefined || v === null ? null : String(v).slice(0, n));

export function degerDb(r, ortak) {
  const o = {
    id: r.id, modul_id: ortak.modulId, proje_id: ortak.projeId, kart_id: ortak.kartId || null,
    fn_uid: r.fnUid, fn_tip: r.fnTip, ust_id: r.ustId || null, sira: Number.isInteger(r.sira) ? r.sira : 0,
    tarih: TARIH(r.tarih), vade: TARIH(r.vade), zaman: ZAMAN(r.zaman),
    adet: sayiMi(r.adet) ? sayiOku(r.adet) : null,
    tutar: sayiMi(r.tutar) ? sayiOku(r.tutar) : null,
    boyut: Number.isFinite(Number(r.boyut)) && r.boyut !== '' && r.boyut != null ? Math.round(Number(r.boyut)) : null,
    yildiz: !!r.yildiz,
    notu: r.not ?? null,
    kisi_id: r.kisiId || null,
  };
  for (const k of DUZ) o[k] = r[k] === undefined || r[k] === '' ? null : KES(r[k], k === 'url' ? 3e6 : k === 'metin' ? 1e7 : 300);
  const ek = {}; for (const k of EK) if (r[k] !== undefined && r[k] !== null && !(Array.isArray(r[k]) && !r[k].length)) ek[k] = r[k];
  o.ek = Object.keys(ek).length ? JSON.stringify(ek) : null;
  return o;
}

const sayiYaz = (v) => (v === null || v === undefined ? '' : String(Number(v)).replace('.', ','));
export function degerApi(d) {
  const ek = (() => { try { return d.ek ? JSON.parse(d.ek) : {}; } catch { return {}; } })();
  const tarih = (v) => (v ? (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10)) : '');
  const r = {
    id: d.id, modulId: d.modul_id, projeId: d.proje_id, kartId: d.kart_id, fnUid: d.fn_uid, fnTip: d.fn_tip,
    ustId: d.ust_id, sira: d.sira ?? 0, tarih: tarih(d.tarih), vade: tarih(d.vade),
    zaman: d.zaman ? new Date(d.zaman).toISOString() : '',
    adet: sayiYaz(d.adet), tutar: d.tutar === null || d.tutar === undefined ? '' : Number(d.tutar).toFixed(2).replace('.', ','),
    boyut: d.boyut === null || d.boyut === undefined ? null : Number(d.boyut), yildiz: !!d.yildiz, not: d.notu ?? '',
  };
  for (const k of DUZ) r[k] = d[k] ?? '';
  return Object.assign(r, ek);
}
