// Fiyat onayı kuralları (saf fonksiyonlar; veritabanı ve ağ yok).
//  • Her kullanıcının TL / USD / EUR için ayrı onay limiti vardır; tutar aynı para birimindeki limitle kıyaslanır.
//  • Bu üçü dışındaki para birimi TCMB kuruyla TL'ye çevrilip TL limitiyle kıyaslanır.
//  • Yönetim (rol: yonetici) limitsizdir.
//  • Limit yetmezse onay, kişinin üst yönetici zincirinde limiti yeten ilk kişiye gider; zincirde kimse yoksa yönetime.
import { sayiOku } from './degerler.js';

export const ANA_PB = ['TL', 'USD', 'EUR'];
export const pbNormal = (p) => { const x = String(p || 'TRY').toUpperCase().trim(); return x === 'TRY' ? 'TL' : x; };
export const ONAY_DURUM = ['gerekmez', 'bekliyor', 'onaylandi', 'reddedildi'];

const limitOku = (u) => {
  const v = u?.onay_limit ?? u?.onayLimit;
  if (!v) return {};
  if (typeof v === 'object') return v;
  try { return JSON.parse(v) || {}; } catch { return {}; }
};

// kurlar: { USD: 34.5, GBP: 43.2, … } (1 birim = x TL). Ana üçlü dışı için gerekir.
export function limitYeter(u, tutar, para, kurlar = {}) {
  if (!u) return false;
  if (u.rol === 'yonetici') return true;
  const t = sayiOku(tutar), pb = pbNormal(para), L = limitOku(u);
  if (ANA_PB.includes(pb)) return t <= (Number(L[pb]) || 0);
  const kur = Number(kurlar[pb]);
  if (!(kur > 0)) return false; // kur bilinmiyorsa onaya gider
  return t * kur <= (Number(L.TL) || 0);
}

// Onaya kimin bakacağı: talep edenin üst zinciri → limiti yeten ilk kişi; yoksa ilk aktif yönetici.
export function onaylayanBul(kullanicilar, talepEdenId, tutar, para, kurlar = {}) {
  const harita = new Map(kullanicilar.map((k) => [k.id, k]));
  const gorulen = new Set([talepEdenId]);
  let x = harita.get(talepEdenId)?.ust_id ?? harita.get(talepEdenId)?.ust;
  while (x && !gorulen.has(x)) {
    gorulen.add(x);
    const k = harita.get(x);
    if (!k) break;
    if (k.aktif !== false && limitYeter(k, tutar, para, kurlar)) return k;
    x = k.ust_id ?? k.ust;
  }
  const yon = kullanicilar.filter((k) => k.rol === 'yonetici' && k.aktif !== false && k.id !== talepEdenId);
  return yon.find((k) => !k.sistem) || yon[0] || null;
}

// Kaydederken fiyat onayı satırlarını hesaplar. İstemcinin gönderdiği onay alanlarına güvenilmez.
//  donus: { bildir: [{ kisi, satir }] } — onaya düşen satırlar
export function fiyatOnayIsle({ u, fonksiyonlar, yeni, eski, kullanicilar, kurlar }) {
  const bildir = [];
  for (const f of fonksiyonlar.filter((x) => x.tip === 'fiyatonay')) {
    const r = yeni.find((d) => d.fnUid === f.uid);
    if (!r) continue;
    const e = eski.find((d) => d.fnUid === f.uid);
    r.para = pbNormal(r.para) === 'TL' ? 'TRY' : pbNormal(r.para);
    const ayni = e && sayiOku(e.tutar) === sayiOku(r.tutar) && pbNormal(e.para) === pbNormal(r.para);
    if (ayni) {
      for (const k of ['onay', 'kisi', 'talep', 'onaylayan', 'onayZaman', 'not']) r[k] = e[k] ?? '';
      continue;
    }
    r.talep = u.id; r.onaylayan = ''; r.onayZaman = ''; r.not = '';
    if (limitYeter(u, r.tutar, r.para, kurlar)) { r.onay = 'gerekmez'; r.kisi = ''; continue; }
    const o = onaylayanBul(kullanicilar, u.id, r.tutar, r.para, kurlar);
    r.onay = 'bekliyor'; r.kisi = o?.id || '';
    if (o) bildir.push({ kisi: o.id, satir: r });
  }
  return { bildir };
}

// Onay beklerken (ya da reddedilmişken) geçilemeyecek durumlar. Ayar boşsa "akışı kapatır" durumları.
export function fiyatEngeli(fonksiyonlar, degerler, durum) {
  if (!durum) return null;
  for (const f of fonksiyonlar.filter((x) => x.tip === 'fiyatonay')) {
    const r = degerler.find((d) => d.fnUid === f.uid);
    if (!r || !['bekliyor', 'reddedildi'].includes(r.onay)) continue;
    const engel = Array.isArray(f.ayar?.engel) && f.ayar.engel.length ? f.ayar.engel.includes(durum.id) : !!durum.kapat;
    if (engel) return { fn: f, satir: r };
  }
  return null;
}
