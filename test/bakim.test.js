import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dataCoz, dosyaAdi, gomululer, supurSiniri } from '../src/bakim.js';

test('dataCoz: base64 data URL çözülür, bozuk olan null', () => {
  const c = dataCoz('data:image/png;base64,' + Buffer.from('merhaba').toString('base64'));
  assert.equal(c.tip, 'image/png'); assert.equal(c.veri.toString(), 'merhaba');
  assert.ok(dataCoz('data:video/webm;codecs=vp8,opus;base64,AAAA'));
  assert.equal(dataCoz('https://drive.google.com/x'), null);
});

test('dosyaAdi: uzantı eklenir, yasak karakter temizlenir', () => {
  assert.equal(dosyaAdi('rapor.pdf', 'application/pdf', 'y'), 'rapor.pdf');
  assert.equal(dosyaAdi('a/b:c', 'image/jpeg', 'y'), 'a_b_c.jpg');
  assert.equal(dosyaAdi('', 'image/png', 'mesaj-1-0'), 'mesaj-1-0.png');
});

test('gomululer: doküman url ve mesaj ekleri; buluttakiler atlanır', () => {
  assert.deepEqual(gomululer({ fn_tip: 'dokuman', url: 'data:image/png;base64,AA', dosya: 'x.png' }).map((g) => g.yer), ['url']);
  assert.deepEqual(gomululer({ fn_tip: 'dokuman', url: 'https://drive.google.com/a' }), []);
  const ek = JSON.stringify({ ekler: [{ ad: 'a', url: 'data:image/jpeg;base64,AA' }, { ad: 'b', url: 'https://drive.google.com/b', depo: 'gdrive' }] });
  const L = gomululer({ fn_tip: 'mesaj', ek });
  assert.equal(L.length, 1); assert.equal(L[0].i, 0);
  assert.deepEqual(gomululer({ fn_tip: 'imza', url: 'data:image/png;base64,AA' }), []);
});

test('supurSiniri: 3 yıl önce', () => {
  assert.equal(supurSiniri(new Date(2026, 10, 21)).getFullYear(), 2023);
});
