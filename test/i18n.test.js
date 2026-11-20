// Çoklu dil: arayüzdeki her _t('…') anahtarının EN/DE/ES sözlüklerinde karşılığı olmalı; yer tutucular korunmalı.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const kok = new URL('../public/', import.meta.url);
const html = fs.readFileSync(new URL('index.html', kok), 'utf8') + fs.readFileSync(new URL('m/m.js', kok), 'utf8');
const coz = (ham) => JSON.parse('"' + ham.replace(/"/g, '\\"').replace(/\\'/g, "'").replace(/\\`/g, '`').replace(/\\\$/g, '$') + '"');
const anahtarlar = [...new Set([...html.matchAll(/(?<![\w.$])_t\('((?:[^'\\\n]|\\.)*)'/g)].map((m) => coz(m[1])))];
const sozluk = (d) => { const s = fs.readFileSync(new URL(`dil/${d}.js`, kok), 'utf8'); return JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1)); };
const yer = (s) => (String(s).match(/\{\d+\}/g) || []).sort().join();

test('arayüzde çeviri anahtarı var', () => { assert.ok(anahtarlar.length > 1000); });
for (const d of ['en', 'de', 'es']) {
  test(`${d}: bütün anahtarlar çevrilmiş, yer tutucular aynı`, () => {
    const S = sozluk(d);
    const eksik = anahtarlar.filter((k) => !(k in S));
    assert.deepEqual(eksik, []);
    const bozuk = Object.entries(S).filter(([k, v]) => yer(k) !== yer(v)).map(([k]) => k);
    assert.deepEqual(bozuk, []);
  });
}
