// Kayıt kuralları (saf): silme kuralı, alan değişikliği logu, değer birleştirme.
import { COKLU, degerBos, ozet, sayiOku } from './degerler.js';
import { fnErisim, fnDegistirebilir } from './yetki.js';

// README genel kuralı: yalnız ilk durumda olan VE işlem görmemiş kayıt veritabanından silinir.
// İşlem görmüş: durum/alan değişikliği logu var ya da (proje için) bağlı kaydı var.
export function islemGordu(loglar, bagliKayitSayisi = 0) {
  return loglar.some((l) => l.tip === 'durum' || l.tip === 'alan') || bagliKayitSayisi > 0;
}
export function silinebilir(kayit, ilkDurumId, loglar, bagliKayitSayisi = 0) {
  return kayit.durum_id === ilkDurumId && !islemGordu(loglar, bagliKayitSayisi);
}

// Fonksiyon başına özet (log karşılaştırması için).
export function fnOzetleri(fonksiyonlar, degerler, ad) {
  const o = {};
  for (const f of fonksiyonlar) {
    if (f.tip === 'gecmis') continue;
    o[f.uid] = degerler.filter((d) => d.fnUid === f.uid).sort((a, b) => (a.sira || 0) - (b.sira || 0))
      .map((d) => ozet(d, ad)).filter(Boolean).join(' | ').slice(0, 1000);
  }
  return o;
}
export function alanLoglari(fonksiyonlar, once, sonra) {
  const L = [];
  for (const f of fonksiyonlar) {
    if (f.tip === 'gecmis') continue;
    const a = once[f.uid] || '', b = sonra[f.uid] || '';
    if (a !== b) L.push({ tip: 'alan', alan: f.ad, eski: a, yeni: b, metin: f.ad + ' değişti' });
  }
  return L;
}

// İstemciden gelen değerleri, kullanıcının erişimine göre eskileriyle birleştirir.
//  • 'duzenle' fonksiyonlar istemciden gelir (boş satırlar atılır).
//  • 'gor' ve 'gizli' fonksiyonlar istemciye güvenilmeden veritabanındaki haliyle korunur.
//  • Modülde olmayan fn_uid'ler reddedilir.
// Dönüş: { yeni: [...], zorunluEksik: [ad], hatalar: [mesaj] }
export function degerleriBirlestir(u, fonksiyonlar, gelen, eski, yeniId, baglam = { yeni: true }) {
  const fnMap = new Map(fonksiyonlar.map((f) => [f.uid, f]));
  const yeni = []; const hatalar = []; const zorunluEksik = [];
  const idHarita = new Map();
  const eskiIdler = new Set(eski.map((d) => d.id));
  for (const r of gelen || []) {
    if (!fnMap.has(r.fnUid)) continue; // modülden kaldırılmış fonksiyonun değeri (eski ekran durumu): yok sayılır
    if (!r.id || !eskiIdler.has(r.id)) { const n = yeniId(); if (r.id) idHarita.set(r.id, n); r.id = n; }
  }
  for (const f of fonksiyonlar) {
    if (f.tip === 'gecmis') continue;
    if (f.tip === 'efor' || f.tip === 'ticket') { yeni.push(...eski.filter((d) => d.fnUid === f.uid)); continue; } // efor satırlarını yalnız Başla / Mola / Bitir uçları yazar
    const erisim = fnErisim(u, f);
    const dolu = eski.some((d) => d.fnUid === f.uid);
    if (erisim !== 'duzenle' || !fnDegistirebilir(u, f, { ...baglam, dolu })) { yeni.push(...eski.filter((d) => d.fnUid === f.uid)); continue; }
    let liste = (gelen || []).filter((r) => r.fnUid === f.uid && !degerBos(f.tip, r));
    if (!COKLU.has(f.tip)) liste = liste.slice(0, 1);
    liste = liste.map((r, i) => ({ ...r, fnTip: f.tip, sira: Number.isInteger(r.sira) ? r.sira : i, ustId: r.ustId && idHarita.has(r.ustId) ? idHarita.get(r.ustId) : (r.ustId || null) }));
    if (f.zorunlu && !liste.length) zorunluEksik.push(f.ad);
    if (f.tip === 'tarihara' || f.tip === 'saatara') {
      const saat = /^([01]\d|2[0-3]):[0-5]\d$/;
      for (const r of liste) {
        const [x, y] = f.tip === 'tarihara' ? [r.tarih, r.vade] : [r.bas, r.bit];
        if (!x || !y) hatalar.push(f.ad + ': başlangıç ve bitiş birlikte girilmeli');
        else if (f.tip === 'saatara' && (!saat.test(x) || !saat.test(y))) hatalar.push(f.ad + ': saat SS:DD biçiminde olmalı');
        else if (String(y) < String(x)) hatalar.push(f.ad + ': bitiş başlangıçtan önce olamaz');
      }
    }
    if (f.tip === 'puan') {
      const mx = f.tarihVarsayilan === '10' ? 10 : 5;
      for (const r of liste) { const v = sayiOku(r.adet); if (!Number.isInteger(v) || v < 1 || v > mx) hatalar.push(`${f.ad}: puan 1 ile ${mx} arasında tam sayı olmalı`); }
    }
    if (f.tip === 'kontrol') {
      if (liste.some((r) => r.tur === 'sorun' && !String(r.not || '').trim())) hatalar.push(f.ad + ': "Uygun değil" maddesine açıklama yazılmalı');
      if (f.zorunlu && liste.some((r) => !r.tur)) hatalar.push(f.ad + ': bütün maddeler işaretlenmeli');
    }
    yeni.push(...liste);
  }
  return { yeni, zorunluEksik, hatalar };
}

// Kartın tarihi: süre ve doküman dışındaki ilk tarih/vade (şablonla aynı).
export function kartTarihi(degerler) {
  return degerler.filter((d) => d.fnTip !== 'sure' && d.fnTip !== 'dokuman').map((d) => d.tarih || d.vade).find(Boolean) || null;
}
