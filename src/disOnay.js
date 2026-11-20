// Dış onay (QR) kuralları: bağlantı anahtarı, şablondan müşteri alanları, yanıt doğrulama.
// Bağımlılığı yoktur (birim testleri için).
import crypto from 'node:crypto';

export const ANAHTAR_RE = /^[A-Za-z0-9_-]{43}$/;           // 32 bayt base64url
export const anahtarUret = () => crypto.randomBytes(32).toString('base64url');
export const anahtarOzet = (a) => crypto.createHash('sha256').update(String(a)).digest('hex');

export const SINIR = {
  saatEn: 1, saatEnCok: 168, varsayilanSaat: 8,
  belge: 600_000, alanSayisi: 20, alanAd: 60, metin: 500, notu: 2000, imza: 300_000,
};

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' };
const varlikCoz = (s) => s.replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, k) => ENT[k]);
const kucuk = (s) => s.toLocaleLowerCase('tr').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i');

// [[Ad]] (dilden bağımsız; eski yazım {{müşteri:Ad}} de tanınır) → [{ad, tip}] (adında imza geçen alan imza kutusu olur)
export const MUSTERI_RE = /\[\[\s*([^\[\]]+?)\s*\]\]|\{\{\s*m(?:ü|u)ş?s?teri\s*:\s*([^{}]+?)\s*\}\}/giu;
export function musteriAlanlari(html) {
  const L = [];
  const metin = varlikCoz(String(html || '').replace(/<[^>]*>/g, ''));
  for (const m of metin.matchAll(MUSTERI_RE)) {
    const ad = (m[1] || m[2]).replace(/\s+/g, ' ').trim().slice(0, SINIR.alanAd);
    if (!ad || L.some((x) => x.ad === ad)) continue;
    L.push({ ad, tip: /imza|signature|unterschrift|firma\b/.test(kucuk(ad)) ? 'imza' : 'metin' });
    if (L.length >= SINIR.alanSayisi) break;
  }
  return L;
}

const IMZA_RE = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;
const temizMetin = (v, en) => String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, en);

// Müşteri yanıtını doğrular. Tanımsız alan, büyük imza, geçersiz karar reddedilir.
export function yanitDogrula(govde, kayit) {
  const g = govde && typeof govde === 'object' ? govde : {};
  const alanlar = Array.isArray(kayit.alanlar) ? kayit.alanlar : [];
  const gelen = g.alanlar && typeof g.alanlar === 'object' ? g.alanlar : {};
  const sonuc = { alanlar: {}, imzalar: {}, karar: '', notu: '' };
  const hatalar = [];
  for (const k of Object.keys(gelen)) if (!alanlar.some((a) => a.ad === k)) hatalar.push('Tanımsız alan');
  for (const a of alanlar) {
    const v = gelen[a.ad];
    if (a.tip === 'imza') {
      if (v == null || v === '') { hatalar.push(a.ad + ' gerekli'); continue; }
      if (typeof v !== 'string' || v.length > SINIR.imza || !IMZA_RE.test(v)) { hatalar.push(a.ad + ' geçersiz'); continue; }
      sonuc.imzalar[a.ad] = v;
    } else {
      const t = temizMetin(v, SINIR.metin);
      if (!t) { hatalar.push(a.ad + ' gerekli'); continue; }
      sonuc.alanlar[a.ad] = t;
    }
  }
  if (kayit.onay_istenir) {
    if (g.karar !== 'onay' && g.karar !== 'red') hatalar.push('Onay ya da red seçilmeli');
    else sonuc.karar = g.karar;
  }
  if (kayit.not_istenir) sonuc.notu = temizMetin(g.notu, SINIR.notu);
  if (kayit.onay_istenir && sonuc.karar === 'red' && kayit.not_istenir && !sonuc.notu) hatalar.push('Red için not yazılmalı');
  return { sonuc, hatalar: [...new Set(hatalar)] };
}

// Basit hız sınırı (sunucu örneği başına; anahtar zaten tahmin edilemez, bu yalnız kötüye kullanımı yavaşlatır)
export function hizSiniri(sayi, pencereMs) {
  const kova = new Map();
  return (anahtar) => {
    const t = Date.now();
    const L = (kova.get(anahtar) || []).filter((x) => t - x < pencereMs);
    L.push(t); kova.set(anahtar, L);
    if (kova.size > 5000) for (const [k, v] of kova) if (!v.length || t - v[v.length - 1] > pencereMs) kova.delete(k);
    return L.length <= sayi;
  };
}
