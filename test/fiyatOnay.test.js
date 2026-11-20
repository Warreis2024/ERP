import { test } from 'node:test';
import assert from 'node:assert/strict';
import { limitYeter, onaylayanBul, fiyatOnayIsle, fiyatEngeli } from '../src/kurallar/fiyatOnay.js';

const K = [
  { id: 'gm', ad: 'GM', rol: 'yonetici', aktif: true },
  { id: 'md', ad: 'Müdür', rol: 'personel', aktif: true, ust_id: 'gm', onay_limit: '{"TL":100000,"USD":3000}' },
  { id: 'sf', ad: 'Şef', rol: 'personel', aktif: true, ust_id: 'md', onay_limit: { TL: 20000, EUR: 500 } },
  { id: 'pr', ad: 'Personel', rol: 'personel', aktif: true, ust_id: 'sf', onay_limit: { TL: 5000 } },
];
const by = (id) => K.find((k) => k.id === id);

test('limit aynı para biriminde kıyaslanır', () => {
  assert.equal(limitYeter(by('pr'), '4.000', 'TRY'), true);
  assert.equal(limitYeter(by('pr'), '5.001', 'TRY'), false);
  assert.equal(limitYeter(by('pr'), '10', 'USD'), false); // USD limiti yok → 0
  assert.equal(limitYeter(by('md'), '2.500', 'USD'), true);
  assert.equal(limitYeter(by('gm'), '9.999.999', 'USD'), true);
});
test('ana üçlü dışı TCMB kuruyla TL limitine', () => {
  assert.equal(limitYeter(by('sf'), '400', 'GBP', { GBP: 45 }), true); // 18.000 TL
  assert.equal(limitYeter(by('sf'), '500', 'GBP', { GBP: 45 }), false); // 22.500 TL
  assert.equal(limitYeter(by('sf'), '1', 'GBP', {}), false); // kur yok
});
test('onaylayan: zincirde limiti yeten ilk kişi', () => {
  assert.equal(onaylayanBul(K, 'pr', '15.000', 'TRY').id, 'sf');
  assert.equal(onaylayanBul(K, 'pr', '50.000', 'TRY').id, 'md');
  assert.equal(onaylayanBul(K, 'pr', '500.000', 'TRY').id, 'gm');
  assert.equal(onaylayanBul(K, 'pr', '600', 'EUR').id, 'gm');
});
test('kaydederken: değişmeyen tutar onayı korur, değişen yeniden hesaplanır', () => {
  const fn = [{ uid: 'fo', tip: 'fiyatonay', ad: 'Teklif fiyatı' }];
  const eski = [{ fnUid: 'fo', tutar: '8000,00', para: 'TRY', onay: 'onaylandi', kisi: 'sf', onaylayan: 'sf', talep: 'pr' }];
  const y1 = [{ fnUid: 'fo', tutar: '8000,00', para: 'TRY', onay: 'gerekmez' }]; // istemci hile denemesi
  fiyatOnayIsle({ u: by('pr'), fonksiyonlar: fn, yeni: y1, eski, kullanicilar: K });
  assert.equal(y1[0].onay, 'onaylandi');
  const y2 = [{ fnUid: 'fo', tutar: '9000', para: 'TRY' }];
  const { bildir } = fiyatOnayIsle({ u: by('pr'), fonksiyonlar: fn, yeni: y2, eski, kullanicilar: K });
  assert.equal(y2[0].onay, 'bekliyor'); assert.equal(y2[0].kisi, 'sf'); assert.equal(bildir.length, 1);
  const y3 = [{ fnUid: 'fo', tutar: '100', para: 'TRY' }];
  fiyatOnayIsle({ u: by('pr'), fonksiyonlar: fn, yeni: y3, eski: [], kullanicilar: K });
  assert.equal(y3[0].onay, 'gerekmez');
});
test('onay beklerken engellenen durumlar', () => {
  const fn = [{ uid: 'fo', tip: 'fiyatonay', ad: 'F', ayar: { engel: ['d3'] } }];
  const d = [{ fnUid: 'fo', onay: 'bekliyor' }];
  assert.ok(fiyatEngeli(fn, d, { id: 'd3' }));
  assert.equal(fiyatEngeli(fn, d, { id: 'd2' }), null);
  const fn2 = [{ uid: 'fo', tip: 'fiyatonay', ad: 'F' }];
  assert.ok(fiyatEngeli(fn2, d, { id: 'x', kapat: true }));
  assert.equal(fiyatEngeli(fn2, [{ fnUid: 'fo', onay: 'onaylandi' }], { id: 'x', kapat: true }), null);
});
