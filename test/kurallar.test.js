import { test } from 'node:test';
import assert from 'node:assert/strict';
import { degerBos, ozet, sayiOku, duz, degerDb, degerApi } from '../src/kurallar/degerler.js';
import { modulYetki, izin, fnErisim, kapanisIzni, dosyaGorur } from '../src/kurallar/yetki.js';
import { silinebilir, islemGordu, degerleriBirlestir, fnOzetleri, alanLoglari, kartTarihi } from '../src/kurallar/kayit.js';

test('sayiOku Türkçe ve İngilizce biçimleri okur', () => {
  assert.equal(sayiOku('1.250,50'), 1250.5);
  assert.equal(sayiOku('385,50'), 385.5);
  assert.equal(sayiOku('1250.5'), 1250.5);
  assert.equal(sayiOku('12.500'), 12500);
  assert.equal(sayiOku(''), 0);
  assert.equal(sayiOku('abc'), 0);
});

test('duz HTML etiketlerini ayıklar', () => {
  assert.equal(duz('<p>Merhaba <b>dünya</b></p>'), 'Merhaba dünya');
  assert.equal(duz('<img src="x">'), 'Resim');
  assert.equal(duz('düz metin'), 'düz metin');
});

test('degerBos tiplere göre', () => {
  assert.equal(degerBos('mali', { metin: '', tutar: '', adet: '' }), true);
  assert.equal(degerBos('mali', { tutar: '0' }), false);
  assert.equal(degerBos('evet', { metin: '' }), true);
  assert.equal(degerBos('kontrol', { metin: 'Basınç' }), false);
  assert.equal(degerBos('rich', { metin: '<p></p>' }), true);
});

test('ozet şablonla aynı metni üretir', () => {
  assert.equal(ozet({ fnTip: 'mali', hareket: 'Çıkış', tutar: '12500', para: 'TRY', odeme: 'EFT', metin: 'Keçe' }), 'Çıkış · 12500 TRY · EFT · Keçe');
  assert.equal(ozet({ fnTip: 'kontrol', tur: 'sorun', metin: 'Sızıntı yok', not: 'damlama' }), '✗ Sızıntı yok (damlama)');
  assert.equal(ozet({ fnTip: 'tarih', tarih: '2026-11-19' }), '19.11.2026');
});

test('degerDb / degerApi gidiş-dönüş', () => {
  const r = { id: 'd1', fnUid: 'mali-mali-0', fnTip: 'mali', tutar: '1.250,50', adet: '2', tarih: '2026-11-02', not: 'açıklama', okuyan: ['u1'], metin: 'Yakıt' };
  const db = degerDb(r, { modulId: 'mali', projeId: 'p1', kartId: 'k1' });
  assert.equal(db.tutar, 1250.5); assert.equal(db.adet, 2); assert.equal(db.notu, 'açıklama'); assert.equal(db.kart_id, 'k1');
  assert.deepEqual(JSON.parse(db.ek), { okuyan: ['u1'] });
  const api = degerApi(db);
  assert.equal(api.tutar, '1250,50'); assert.equal(api.not, 'açıklama'); assert.deepEqual(api.okuyan, ['u1']); assert.equal(api.tarih, '2026-11-02');
});

const yon = { id: 'u1', rol: 'yonetici' };
const satis = { id: 'u2', rol: 'personel', grup_id: 'g-satis', yetkiler: { ana: { yetki: 'oku' }, crm: { yetki: 'yaz', onay: true } } };

test('modül yetkisi ve izinler', () => {
  assert.equal(modulYetki(yon, 'mali'), 'yaz');
  assert.equal(modulYetki(satis, 'mali'), 'yok');
  assert.equal(modulYetki(satis, 'ana'), 'oku');
  assert.equal(izin(satis, 'crm', 'onay'), true);
  assert.equal(izin(satis, 'crm', 'disa'), false);
  assert.equal(izin(satis, 'mali', 'onay'), false);
});

test('fonksiyon erişimi gruba göre', () => {
  const butce = { uid: 'ana-fiyat-2', yetki: { 'g-satis': 'gizli', 'g-saha': 'gor' } };
  assert.equal(fnErisim(satis, butce), 'gizli');
  assert.equal(fnErisim({ rol: 'personel', grup_id: 'g-saha' }, butce), 'gor');
  assert.equal(fnErisim(yon, butce), 'duzenle');
});

test('kapanış izni ve gizli dosya', () => {
  const kapat = { id: 'is-bitti', kapat: true };
  assert.equal(kapanisIzni(satis, 'crm', 'x', kapat), true);
  assert.equal(kapanisIzni(satis, 'ana', 'x', kapat), false);
  assert.equal(dosyaGorur(satis, { fnTip: 'dokuman', onem: 'gizli', yukleyen: 'u9' }, ['u1']), false);
  assert.equal(dosyaGorur(satis, { fnTip: 'dokuman', onem: 'gizli', yukleyen: 'u2' }, []), true);
});

test('silme kuralı', () => {
  assert.equal(silinebilir({ durum_id: 'is-acik' }, 'is-acik', [{ tip: 'yeni' }]), true);
  assert.equal(silinebilir({ durum_id: 'is-acik' }, 'is-acik', [{ tip: 'yeni' }, { tip: 'alan' }]), false);
  assert.equal(silinebilir({ durum_id: 'is-yapiliyor' }, 'is-acik', []), false);
  assert.equal(islemGordu([], 2), true);
});

test('değer birleştirme: gizli/gör fonksiyonlar istemciden değiştirilemez', () => {
  const fns = [
    { uid: 'f-ad', tip: 'light', ad: 'Ad', zorunlu: true },
    { uid: 'f-butce', tip: 'fiyat', ad: 'Bütçe', yetki: { 'g-satis': 'gizli' } },
    { uid: 'f-kt', tip: 'kontrol', ad: 'Kontrol' },
  ];
  const eski = [{ id: 'e1', fnUid: 'f-butce', fnTip: 'fiyat', tutar: '1000' }];
  let n = 0;
  const gelen = [
    { fnUid: 'f-ad', metin: 'Yeni ad' },
    { id: 'e1', fnUid: 'f-butce', tutar: '1' },            // satış gizli alanı değiştirmeye çalışıyor
    { id: 'tmp1', fnUid: 'f-kt', metin: 'Madde', tur: 'sorun', not: '' },
  ];
  const s = degerleriBirlestir(satis, fns, gelen, eski, () => 'n' + (++n));
  assert.equal(s.yeni.find((d) => d.fnUid === 'f-butce').tutar, '1000');
  assert.equal(s.yeni.find((d) => d.fnUid === 'f-ad').id, 'n1');
  assert.ok(s.hatalar.some((h) => /açıklama/.test(h)));
  const bos = degerleriBirlestir(yon, fns, [], [], () => 'x');
  assert.deepEqual(bos.zorunluEksik, ['Ad']);
  // Modülde olmayan (ör. kaldırılmış) fonksiyonun değeri kaydı reddettirmez ama asla kaydedilmez
  const kotu = degerleriBirlestir(yon, fns, [{ fnUid: 'baska', metin: 'x' }, { fnUid: 'f-ad', metin: 'Ad' }], [], () => 'x');
  assert.equal(kotu.yeni.some((d) => d.fnUid === 'baska'), false);
  assert.equal(kotu.yeni.some((d) => d.fnUid === 'f-ad'), true);
  assert.deepEqual(kotu.hatalar, []);
});

test('alan logları yalnız değişen fonksiyonlar için', () => {
  const fns = [{ uid: 'a', tip: 'light', ad: 'Konu' }, { uid: 'b', tip: 'tarih', ad: 'Termin' }];
  const once = fnOzetleri(fns, [{ fnUid: 'a', fnTip: 'light', metin: 'Eski' }, { fnUid: 'b', fnTip: 'tarih', tarih: '2026-11-20' }]);
  const sonra = fnOzetleri(fns, [{ fnUid: 'a', fnTip: 'light', metin: 'Yeni' }, { fnUid: 'b', fnTip: 'tarih', tarih: '2026-11-20' }]);
  const L = alanLoglari(fns, once, sonra);
  assert.equal(L.length, 1); assert.equal(L[0].alan, 'Konu'); assert.equal(L[0].eski, 'Eski'); assert.equal(L[0].yeni, 'Yeni');
  assert.equal(kartTarihi([{ fnTip: 'sure', tarih: '2026-01-01' }, { fnTip: 'tarih', tarih: '2026-11-20' }]), '2026-11-20');
});
