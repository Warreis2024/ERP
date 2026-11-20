// Açık form: dışarıdan doldurulan şablonun [[Alan]] cevaplarını modülün fonksiyonlarına yerleştirir (saf fonksiyonlar).
const norm = (s) => String(s || '').trim().toLocaleLowerCase('tr').replace(/\s+/g, ' ');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ATLA = new Set(['gecmis', 'mesaj', 'efor', 'fiyatonay', 'kontrol', 'dokuman', 'sablon', 'stok', 'mali', 'karar', 'ekip']);

// alan adı → fonksiyon. Elle eşleme önce; yoksa aynı ad. imza alanı yalnız imza fonksiyonuna gider.
export function alanEslesme(alanlar, fonksiyonlar, eslesme = {}) {
  const o = {};
  for (const a of alanlar) {
    const el = eslesme[a.ad];
    if (el === '-') continue;
    let f = el ? fonksiyonlar.find((x) => x.uid === el) : fonksiyonlar.find((x) => !ATLA.has(x.tip) && norm(x.ad) === norm(a.ad));
    if (!f || ATLA.has(f.tip)) continue;
    if ((a.tip === 'imza') !== (f.tip === 'imza')) continue;
    o[a.ad] = f;
  }
  return o;
}

const tarihOku = (v) => {
  const s = String(v || '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return '';
};

// Fonksiyon türüne göre değer satırının alanları
export function degerUret(f, v) {
  switch (f.tip) {
    case 'imza': return { url: v };
    case 'firma': return { firma: v };
    case 'kisi': return { kisi: v };
    case 'tarih': { const t = tarihOku(v); return t ? { tarih: t } : null; }
    case 'sayi': case 'yuzde': case 'puan': return /^-?\d+([.,]\d+)?$/.test(String(v).trim()) ? { adet: String(v).trim() } : null;
    case 'fiyat': return /^-?[\d.,]+$/.test(String(v).trim()) ? { tutar: String(v).trim(), para: 'TRY' } : null;
    case 'tur': return { tur: v };
    case 'evet': return { metin: /^(evet|yes|ja|sí|si|1|true)$/i.test(String(v).trim()) ? 'Evet' : 'Hayır' };
    case 'rich': case 'zengin': return { metin: '<p>' + esc(v).replace(/\n/g, '<br>') + '</p>' };
    default: return { metin: v };
  }
}

// Belgeye cevaplar yazılır (kayıtta saklanmak üzere). Değerler kaçışlanır; imza resim olur.
export function belgeDoldur(html, cevaplar, imzalar) {
  return String(html || '')
    .replace(/\{\{\s*QR\s*\}\}/gi, '')
    .replace(/\[\[\s*([^\[\]]+?)\s*\]\]/g, (_, ad) => {
      const k = String(ad).replace(/<[^>]*>/g, '').trim();
      if (imzalar[k]) return `<img src="${esc(imzalar[k])}" alt="${esc(k)}" style="max-width:240px;height:auto">`;
      return cevaplar[k] !== undefined ? `<b>${esc(cevaplar[k])}</b>` : '';
    });
}
