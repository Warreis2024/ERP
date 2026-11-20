// Efor (zaman takibi) kuralları — saf fonksiyonlar.
// Satır: { fnTip:'efor', kisi: kullanıcı id, tur, zaman: başlangıç (ISO), adet: süre dakika ('' = açık) }
//  tur: 'calisma' | 'mola' (süreli) · 'durdu' | 'bitti' (an; başka işe geçildi / iş bitti)
// Bir kişinin aynı anda tek açık işi olur: başka bir işte "Başla" denince önceki iş durdurulur.
import { sayiOku } from './degerler.js';

export const SURELI = new Set(['calisma', 'mola']);
const acik = (r) => SURELI.has(r.tur) && String(r.adet ?? '').trim() === '';
const ms = (r) => new Date(r.zaman).getTime();

// Kişinin bu kayıttaki durumu: 'yok' | 'calisiyor' | 'molada' | 'durdu' | 'bitti'
export function eforDurum(satirlar, kisi) {
  const L = satirlar.filter((r) => r.kisi === kisi && r.zaman).sort((a, b) => ms(a) - ms(b));
  const son = L[L.length - 1];
  if (!son) return 'yok';
  if (acik(son)) return son.tur === 'calisma' ? 'calisiyor' : 'molada';
  if (son.tur === 'bitti') return 'bitti';
  return 'durdu';
}

// Kişi başına toplam çalışma ve mola (dakika). Açık satır şimdiye kadar sayılır.
export function eforOzet(satirlar, simdi = Date.now()) {
  const o = {};
  for (const r of satirlar) {
    if (!SURELI.has(r.tur) || !r.zaman) continue;
    const dk = acik(r) ? Math.max(0, (simdi - ms(r)) / 60000) : sayiOku(r.adet);
    const x = (o[r.kisi] = o[r.kisi] || { calisma: 0, mola: 0 });
    x[r.tur] += dk;
  }
  return o;
}

// Bir eylemin bu kayıttaki satırlara etkisi. kapat: [{ id, adet }], ekle: [{ tur, zaman, adet }]
export function eforEylem(satirlar, kisi, eylem, simdi = new Date()) {
  const durum = eforDurum(satirlar, kisi);
  const z = simdi.toISOString();
  const kapat = satirlar.filter((r) => r.kisi === kisi && acik(r)).map((r) => ({ id: r.id, adet: Math.round(((simdi.getTime() - ms(r)) / 60000) * 100) / 100 }));
  const ekle = [];
  if (eylem === 'basla' || eylem === 'devam') {
    if (durum === 'calisiyor') return { kapat: [], ekle: [], durum };
    ekle.push({ tur: 'calisma', zaman: z, adet: '' });
  } else if (eylem === 'mola') {
    if (durum !== 'calisiyor') throw new Error('Mola için önce işe başlanmalı');
    ekle.push({ tur: 'mola', zaman: z, adet: '' });
  } else if (eylem === 'bitir') {
    if (durum === 'yok' || durum === 'bitti') throw new Error('Bitirilecek açık iş yok');
    ekle.push({ tur: 'bitti', zaman: z, adet: '0' });
  } else throw new Error('Geçersiz eylem');
  return { kapat, ekle, durum };
}

// Başka bir işte "Başla" denince kişinin diğer kayıtlardaki açık satırları kapatılır ve "durdu" işareti eklenir.
export function digerleriniDurdur(acikSatirlar, simdi = new Date()) {
  return acikSatirlar.filter(acik).map((r) => ({ id: r.id, adet: Math.round(((simdi.getTime() - ms(r)) / 60000) * 100) / 100, kayit: r }));
}

export const dakikaYaz = (dk) => { const d = Math.round(dk); return d >= 60 ? `${Math.floor(d / 60)} sa ${d % 60} dk` : `${d} dk`; };
