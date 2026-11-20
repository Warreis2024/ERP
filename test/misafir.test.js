import { test } from 'node:test';
import assert from 'node:assert/strict';
import { misafirGirisEngeli, yerelAn, kapsamDeger, kayitGorur, misafirKapsam } from '../src/kurallar/misafir.js';

// 2026-11-23 Pazartesi 10:00 İstanbul = 07:00 UTC
const PZT10 = new Date(Date.UTC(2026, 10, 23, 7, 0));
test('yerel an İstanbul saatiyle', () => {
  assert.deepEqual(yerelAn(PZT10), { tarih: '2026-11-23', gun: 1, saat: '10:00' });
});
test('misafir giriş penceresi', () => {
  const m = { tur: 'misafir', gecerli_bas: '2026-11-20', gecerli_bit: '2026-11-30', gunler: '12345', saat_bas: '08:00', saat_bit: '18:00' };
  assert.equal(misafirGirisEngeli(m, PZT10), null);
  assert.match(misafirGirisEngeli({ ...m, gecerli_bit: '2026-11-22' }, PZT10), /doldu/);
  assert.match(misafirGirisEngeli({ ...m, gecerli_bas: '2026-11-24' }, PZT10), /başlamadı/);
  assert.match(misafirGirisEngeli({ ...m, gunler: '67' }, PZT10), /gün/);
  assert.match(misafirGirisEngeli({ ...m, saat_bas: '11:00' }, PZT10), /saatleri/);
  assert.equal(misafirGirisEngeli({ ...m, saat_bas: '22:00', saat_bit: '11:00' }, PZT10), null); // gece aralığı
  assert.equal(misafirGirisEngeli({ tur: 'kullanici', gecerli_bit: '2000-01-01' }, PZT10), null);
});
test('kapsam: kendi ve firma', async () => {
  const tablolar = {
    kartlar: [{ id: 'k1', proje_id: 'p1', olusturan: 'm' }, { id: 'k2', proje_id: 'p1', olusturan: 'x' }, { id: 'k3', proje_id: 'p2', olusturan: 'x' }, { id: 'k4', proje_id: 'p3', olusturan: 'x' }],
    degerler: [{ fn_tip: 'kisi', proje_id: 'p1', kart_id: 'k2', kisi: 'Misafir Ali' }, { fn_tip: 'firma', proje_id: 'p2', kart_id: 'k3', firma: 'ACME A.Ş.' }, { fn_tip: 'firma', proje_id: 'p3', kart_id: null, firma: 'acme a.ş.' }],
    proje_kisileri: [],
  };
  const db = (t) => { const q = { _t: t, _w: null, where(o) { this._w = o; return this; }, whereIn(k, L) { this._in = [k, L]; return this; }, select() {
    let L = tablolar[t] || [];
    if (this._w) L = L.filter((r) => Object.entries(this._w).every(([k, v]) => k === 'silindi' || k === 'kullanici_id' ? true : r[k] === v));
    if (this._in) L = L.filter((r) => this._in[1].includes(r[this._in[0]]));
    return Promise.resolve(L);
  } }; return q; };
  const kendi = await misafirKapsam(db, { id: 'm', ad: 'Misafir Ali', tur: 'misafir', gorunum: 'kendi', firma: 'ACME A.Ş.' });
  assert.deepEqual([...kendi.kart].sort(), ['k1', 'k2']);
  const firma = await misafirKapsam(db, { id: 'm', ad: 'Misafir Ali', tur: 'misafir', gorunum: 'firma', firma: 'ACME A.Ş.' });
  assert.deepEqual([...firma.kart].sort(), ['k1', 'k2', 'k3', 'k4']);
  assert.ok(firma.projeTam.has('p3')); assert.ok(!firma.projeTam.has('p1')); assert.ok(firma.proje.has('p1'));
  const u = { _kapsam: kendi };
  assert.equal(kayitGorur(u, 'kart', 'k3'), false);
  assert.equal(kayitGorur(u, 'proje', 'p1'), true);
  assert.equal(kayitGorur(u, 'proje', 'p1', true), false);
  assert.equal(kapsamDeger(kendi, { kartId: 'k1' }), true);
  assert.equal(kapsamDeger(kendi, { projeId: 'p1', kartId: null }), false);
  assert.equal(kayitGorur({}, 'kart', 'zz'), true);
});
