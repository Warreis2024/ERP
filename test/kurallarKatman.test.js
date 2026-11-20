import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fnDegistirebilir, durumGecisIzni } from '../src/kurallar/yetki.js';
import { degerleriBirlestir } from '../src/kurallar/kayit.js';

const yon = { id: 'y', rol: 'yonetici' };
const ali = { id: 'a', rol: 'personel', grup_id: 'g' };
const veli = { id: 'v', rol: 'personel', grup_id: 'g' };

test('Değiştirebilir: açan + yönetim', () => {
  const f = { ayar: { degistir: 'acan' } };
  assert.equal(fnDegistirebilir(ali, f, { yeni: true }), true);
  assert.equal(fnDegistirebilir(ali, f, { acan: 'a' }), true);
  assert.equal(fnDegistirebilir(veli, f, { acan: 'a' }), false);
  assert.equal(fnDegistirebilir(yon, f, { acan: 'a' }), true);
});
test('Değiştirebilir: yalnız yönetim ve kilit', () => {
  assert.equal(fnDegistirebilir(ali, { ayar: { degistir: 'yonetim' } }, { yeni: true }), false);
  const k = { ayar: { degistir: 'kilit' } };
  assert.equal(fnDegistirebilir(ali, k, { yeni: false, dolu: false }), true);
  assert.equal(fnDegistirebilir(ali, k, { yeni: false, dolu: true }), false);
  assert.equal(fnDegistirebilir(ali, {}, { dolu: true }), true);
});
test('Durum geçişi', () => {
  assert.equal(durumGecisIzni(veli, { gecis: 'acan' }, 'a'), false);
  assert.equal(durumGecisIzni(ali, { gecis: 'acan' }, 'a'), true);
  assert.equal(durumGecisIzni(yon, { gecis: 'acan' }, 'a'), false);
  assert.equal(durumGecisIzni(yon, { gecis: 'acanYonetim' }, 'a'), true);
  assert.equal(durumGecisIzni(veli, {}, 'a'), true);
});
test('Kilitli alan sunucuda eski değerini korur', () => {
  const fns = [{ uid: 'f1', tip: 'light', ad: 'Konu', ayar: { degistir: 'acan' }, zorunlu: true }];
  const eski = [{ id: 'd1', fnUid: 'f1', fnTip: 'light', metin: 'Eski' }];
  const r = degerleriBirlestir(veli, fns, [{ id: 'd1', fnUid: 'f1', metin: 'Yeni' }], eski, () => 'n', { yeni: false, acan: 'a' });
  assert.equal(r.yeni[0].metin, 'Eski');
  assert.deepEqual(r.zorunluEksik, []);
  const r2 = degerleriBirlestir(ali, fns, [{ id: 'd1', fnUid: 'f1', metin: 'Yeni' }], eski, () => 'n', { yeni: false, acan: 'a' });
  assert.equal(r2.yeni[0].metin, 'Yeni');
});
