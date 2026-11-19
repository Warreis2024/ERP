import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.OTURUM_GIZLI = 'x'.repeat(40);
process.env.GUVENLI_CEREZ = 'true';
const { belirtecUret, belirtecCoz, cerezleriOku } = await import('../src/auth/oturum.js');
const { sifreKuraliHatasi, sifreOzetle, sifreDogrula } = await import('../src/auth/sifre.js');

test('belirteç üret / çöz / kurcalama', () => {
  const b = belirtecUret({ uid: 'u1', f: 'yontem', sv: 3 }, 60);
  const y = belirtecCoz(b);
  assert.equal(y.uid, 'u1'); assert.equal(y.sv, 3);
  const [g, i] = b.split('.');
  const sahte = Buffer.from(JSON.stringify({ uid: 'u0', f: 'yontem', sv: 3, exp: 9e9 })).toString('base64url') + '.' + i;
  assert.equal(belirtecCoz(sahte), null);
  assert.equal(belirtecCoz(g + '.x'), null);
  assert.equal(belirtecCoz(belirtecUret({ uid: 'u1' }, -1)), null);
});

test('çerez ayrıştırma', () => {
  assert.deepEqual(cerezleriOku({ headers: { cookie: 'a=1; erp_csrf=x%3Dy' } }), { a: '1', erp_csrf: 'x=y' });
});

test('şifre kuralı ve özet (scrypt yedeği)', async () => {
  assert.ok(sifreKuraliHatasi('kisa1'));
  assert.ok(sifreKuraliHatasi('sadeceharf'));
  assert.equal(sifreKuraliHatasi('admin123'), null);
  const o = await sifreOzetle('Deneme123');
  assert.equal(await sifreDogrula(o, 'Deneme123'), true);
  assert.equal(await sifreDogrula(o, 'deneme123'), false);
});
