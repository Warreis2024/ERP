// Yetki kuralları (saf fonksiyonlar). Kullanıcı nesnesi: { id, rol, grup_id, yetkiler: { modulId: {yetki,onay,disa} } }
// Şablondaki yetki / izin / fnErisim / gorunurDeger kurallarının sunucu karşılığı.

export const yonetici = (u) => u?.rol === 'yonetici';

export function modulYetki(u, modulId) {
  if (!u) return 'yok';
  if (yonetici(u)) return 'yaz';
  return u.yetkiler?.[modulId]?.yetki || 'yok';
}
export const okuyabilir = (u, m) => modulYetki(u, m) !== 'yok';
export const yazabilir = (u, m) => modulYetki(u, m) === 'yaz';

// tip: 'onay' | 'disa'
export function izin(u, modulId, tip) {
  if (!u) return false;
  if (yonetici(u)) return true;
  return okuyabilir(u, modulId) && !!u.yetkiler?.[modulId]?.[tip];
}

// Fonksiyon düzeyi: yetki grubuna göre 'duzenle' | 'gor' | 'gizli'
export function fnErisim(u, fn) {
  if (!u || yonetici(u)) return 'duzenle';
  const v = fn?.yetki?.[u.grup_id];
  return v === 'gor' || v === 'gizli' ? v : 'duzenle';
}
export const fnGorunur = (u, fn) => fnErisim(u, fn) !== 'gizli';

// Gizli dosya: yalnız yükleyen, proje yöneticisi ve yönetici görür.
export function dosyaGorur(u, deger, projeYoneticileri = []) {
  if (deger.fnTip !== 'dokuman' || deger.onem !== 'gizli') return true;
  return yonetici(u) || deger.yukleyen === u.id || projeYoneticileri.includes(u.id);
}

// Durum değişimi: "akışı kapatır" durumuna geçmek onay yetkisi ister.
export function kapanisIzni(u, modulId, onceDurum, yeniDurum) {
  if (!yeniDurum || onceDurum === yeniDurum || !yeniDurum.kapat) return true;
  return izin(u, modulId, 'onay');
}
