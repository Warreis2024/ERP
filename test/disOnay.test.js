// Dış onay (QR): anahtar, müşteri alanları ve yanıt doğrulama kuralları.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANAHTAR_RE, anahtarUret, anahtarOzet, musteriAlanlari, yanitDogrula, hizSiniri } from '../src/disOnay.js';

test('anahtar 256 bit, base64url; özet sabit uzunlukta ve geri çevrilemez', () => {
  const a = anahtarUret(), b = anahtarUret();
  assert.match(a, ANAHTAR_RE); assert.notEqual(a, b);
  assert.equal(anahtarOzet(a).length, 64); assert.equal(anahtarOzet(a), anahtarOzet(a));
  assert.ok(!ANAHTAR_RE.test("x' or 1=1 --"));
  assert.ok(!ANAHTAR_RE.test(a + 'a'));
});

test('şablondan müşteri alanları: etiket ve varlıklar temizlenir, imza tanınır, tekrar atılır', () => {
  const html = '<p>[[Yetkili]]</p><td>{{<b>Proje</b>}}</td><p>[[ <b>Yetkili</b> ]] {{musteri:İmza}} [[ Not &amp; açıklama ]]</p>{{QR}} [[Signature]]';
  assert.deepEqual(musteriAlanlari(html), [
    { ad: 'Yetkili', tip: 'metin' }, { ad: 'İmza', tip: 'imza' }, { ad: 'Not & açıklama', tip: 'metin' }, { ad: 'Signature', tip: 'imza' },
  ]);
  assert.deepEqual(musteriAlanlari('{{Proje}} {{QR}}'), []);
});

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const kayit = { alanlar: [{ ad: 'Yetkili', tip: 'metin' }, { ad: 'İmza', tip: 'imza' }], onay_istenir: true, not_istenir: true };

test('geçerli yanıt kabul edilir, metin kırpılır ve kontrol karakterleri atılır', () => {
  const { sonuc, hatalar } = yanitDogrula({ alanlar: { Yetkili: '  Ali\u0000 Veli ', 'İmza': PNG }, karar: 'onay', notu: 'tamam' }, kayit);
  assert.deepEqual(hatalar, []);
  assert.equal(sonuc.alanlar.Yetkili, 'Ali Veli');
  assert.equal(sonuc.imzalar['İmza'], PNG);
  assert.equal(sonuc.karar, 'onay');
});

test('tanımsız alan, eksik alan, geçersiz imza ve karar reddedilir', () => {
  assert.ok(yanitDogrula({ alanlar: { Yetkili: 'A', 'İmza': PNG, Fiyat: '0' }, karar: 'onay' }, kayit).hatalar.includes('Tanımsız alan'));
  assert.ok(yanitDogrula({ alanlar: { 'İmza': PNG }, karar: 'onay' }, kayit).hatalar.includes('Yetkili gerekli'));
  assert.ok(yanitDogrula({ alanlar: { Yetkili: 'A', 'İmza': 'javascript:alert(1)' }, karar: 'onay' }, kayit).hatalar.includes('İmza geçersiz'));
  assert.ok(yanitDogrula({ alanlar: { Yetkili: 'A', 'İmza': 'data:image/png;base64,' + 'A'.repeat(400000) }, karar: 'onay' }, kayit).hatalar.includes('İmza geçersiz'));
  assert.ok(yanitDogrula({ alanlar: { Yetkili: 'A', 'İmza': PNG }, karar: 'evet' }, kayit).hatalar.includes('Onay ya da red seçilmeli'));
  assert.ok(yanitDogrula({ alanlar: { Yetkili: 'A', 'İmza': PNG }, karar: 'red' }, kayit).hatalar.includes('Red için not yazılmalı'));
  assert.ok(yanitDogrula(null, kayit).hatalar.length > 0);
});

test('onay/not kapalıysa karar ve not alınmaz', () => {
  const { sonuc, hatalar } = yanitDogrula({ alanlar: {}, karar: 'red', notu: 'x' }, { alanlar: [], onay_istenir: false, not_istenir: false });
  assert.deepEqual(hatalar, []); assert.equal(sonuc.karar, ''); assert.equal(sonuc.notu, '');
});

test('hız sınırı pencere içinde sayar', () => {
  const s = hizSiniri(2, 60_000);
  assert.ok(s('ip')); assert.ok(s('ip')); assert.ok(!s('ip')); assert.ok(s('baska'));
});
