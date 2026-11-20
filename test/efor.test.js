import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eforDurum, eforOzet, eforEylem, digerleriniDurdur } from '../src/kurallar/efor.js';

const T = (dk) => new Date(Date.UTC(2026, 10, 21, 8, 0) + dk * 60000);
test('başla → mola → devam → bitir', () => {
  let L = [];
  const uygula = (eylem, dk) => {
    const r = eforEylem(L, 'a', eylem, T(dk));
    L = L.map((x) => { const k = r.kapat.find((y) => y.id === x.id); return k ? { ...x, adet: String(k.adet) } : x; });
    r.ekle.forEach((e, i) => L.push({ id: eylem + dk + i, kisi: 'a', ...e }));
  };
  uygula('basla', 0); assert.equal(eforDurum(L, 'a'), 'calisiyor');
  uygula('mola', 60); assert.equal(eforDurum(L, 'a'), 'molada');
  uygula('devam', 75); assert.equal(eforDurum(L, 'a'), 'calisiyor');
  uygula('bitir', 135); assert.equal(eforDurum(L, 'a'), 'bitti');
  const o = eforOzet(L, T(500).getTime());
  assert.equal(Math.round(o.a.calisma), 120); assert.equal(Math.round(o.a.mola), 15);
  assert.throws(() => eforEylem(L, 'a', 'mola', T(140)));
  assert.equal(eforDurum(L, 'b'), 'yok');
});
test('açık satır şimdiye kadar sayılır; başka işte başlayınca durdurulur', () => {
  const L = [{ id: 'x', kisi: 'a', tur: 'calisma', zaman: T(0).toISOString(), adet: '' }];
  assert.equal(Math.round(eforOzet(L, T(30).getTime()).a.calisma), 30);
  const d = digerleriniDurdur(L, T(45));
  assert.equal(d.length, 1); assert.equal(d[0].adet, 45);
  assert.equal(eforEylem(L, 'a', 'basla', T(50)).ekle.length, 0); // zaten çalışıyor
});
