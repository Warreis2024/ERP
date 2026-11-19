// Bağlantı kasası ve Google modülü: ağ yerine sahte fetch, veritabanı yerine bellek içi tablo.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.OTURUM_GIZLI ||= 'test-gizli-anahtar-en-az-otuz-iki-karakter-uzunlugunda';
process.env.GOOGLE_CLIENT_ID = 'cid';
process.env.GOOGLE_CLIENT_SECRET = 'cgizli';

const { sifrele, coz, kasaOku, kasaYaz } = await import('../src/baglanti/kasa.js');
const google = await import('../src/baglanti/google.js');

// --- bellek içi "ayarlar" tablosu (knex benzeri en küçük arayüz) ---
function sahteDb() {
  const satir = new Map();
  const db = (tablo) => {
    assert.equal(tablo, 'ayarlar');
    let k = null;
    const q = {
      where(o) { k = o.anahtar; return q; },
      first: async () => (satir.has(k) ? { anahtar: k, deger: satir.get(k) } : undefined),
      update: async (o) => { satir.set(k, o.deger); return 1; },
      insert: async (o) => { satir.set(o.anahtar, o.deger); return [1]; },
      del: async () => { satir.delete(k); return 1; },
    };
    return q;
  };
  db.satir = satir;
  return db;
}

// --- sahte fetch: sırayla beklenen istekleri karşılar ---
let istekler = [];
function fetchKur(cevaplar) {
  istekler = [];
  globalThis.fetch = async (url, sec = {}) => {
    istekler.push({ url: String(url), sec });
    const c = cevaplar.shift();
    assert.ok(c, 'beklenmeyen istek: ' + url);
    if (c.url) assert.match(String(url), c.url);
    const h = new Headers(c.headers || {});
    return { ok: c.durum >= 200 && c.durum < 300, status: c.durum, headers: h, json: async () => c.govde ?? {} };
  };
}
const bagliKasa = (db, ek = {}) => kasaYaz(db, 'google', {
  yenile: 'R1', erisim: 'A1', bitis: Date.now() + 3600e3, kapsam: ['openid', google.KAPSAM.drive, google.KAPSAM.gmail],
  hesap: 'ofis@yontem.com.tr', alan: 'yontem.com.tr', zaman: '2026-11-19T20:00:00Z', ...ek,
});

beforeEach(() => { istekler = []; });

test('kasa: şifreler, çözer; kurcalanmış veri çözülmez', () => {
  const s = sifrele({ yenile: 'gizli-belirtec' });
  assert.ok(s.startsWith('v1.') && !s.includes('gizli-belirtec'));
  assert.deepEqual(coz(s), { yenile: 'gizli-belirtec' });
  const p = s.split('.'); p[3] = p[3].slice(0, -2) + (p[3].endsWith('AA') ? 'BB' : 'AA');
  assert.equal(coz(p.join('.')), null);
  assert.equal(coz('duz metin'), null);
});

test('kasa: veritabanında düz metin belirteç durmaz', async () => {
  const db = sahteDb();
  await bagliKasa(db);
  const ham = db.satir.get('baglanti:google');
  assert.ok(!ham.includes('R1') && !ham.includes('ofis@'));
  assert.equal((await kasaOku(db, 'google')).hesap, 'ofis@yontem.com.tr');
});

test('izin adresi: offline erişim, onay, doğru kapsamlar ve dönüş adresi', () => {
  const req = { protocol: 'https', get: (h) => (h === 'host' ? 'yontem-erp.vercel.app' : undefined) };
  const u = new URL(google.izinAdresi(req, 'DURUM'));
  assert.equal(u.searchParams.get('redirect_uri'), 'https://yontem-erp.vercel.app/api/baglanti/google/donus');
  assert.equal(u.searchParams.get('access_type'), 'offline');
  assert.equal(u.searchParams.get('prompt'), 'consent');
  assert.equal(u.searchParams.get('state'), 'DURUM');
  for (const k of [google.KAPSAM.drive, google.KAPSAM.gmail]) assert.ok(u.searchParams.get('scope').split(' ').includes(k));
});

test('kod takası: belirteç ve hesap kasaya yazılır', async () => {
  const db = sahteDb();
  const req = { protocol: 'https', get: (h) => (h === 'host' ? 'x.vercel.app' : undefined) };
  fetchKur([
    { url: /oauth2\.googleapis\.com\/token/, durum: 200, govde: { access_token: 'A', refresh_token: 'R', expires_in: 3599, scope: `openid ${google.KAPSAM.drive} ${google.KAPSAM.gmail}` } },
    { url: /userinfo/, durum: 200, govde: { email: 'ofis@yontem.com.tr', hd: 'yontem.com.tr' } },
  ]);
  const k = await google.kodTakas(req, db, 'KOD', 'u0');
  assert.equal(k.hesap, 'ofis@yontem.com.tr');
  assert.equal(String(istekler[0].sec.body.get('code')), 'KOD');
  const d = await google.durum(db);
  assert.deepEqual([d.bagli, d.drive, d.gmail, d.alan], [true, true, true, 'yontem.com.tr']);
});

test('süresi dolan erişim belirteci yenilenir; invalid_grant bağlantıyı kopuk işaretler', async () => {
  const db = sahteDb();
  await bagliKasa(db, { bitis: Date.now() - 1000 });
  fetchKur([
    { url: /token/, durum: 200, govde: { access_token: 'A2', expires_in: 3600 } },
    { url: /drive\/v3\/files\?/, durum: 200, govde: { files: [{ id: 'KOK' }] } },
    { url: /drive\/v3\/files\?/, durum: 200, govde: { files: [{ id: 'PRJ' }] } },
  ]);
  assert.equal(await google.projeKlasoru(db, 'PRJ-1048', 'Kalıp'), 'PRJ');
  assert.equal(istekler[1].sec.headers.authorization, 'Bearer A2');
  assert.equal((await kasaOku(db, 'google')).erisim, 'A2');

  await bagliKasa(db, { bitis: 0 });
  fetchKur([{ url: /token/, durum: 400, govde: { error: 'invalid_grant' } }]);
  await assert.rejects(google.projeKlasoru(db, 'PRJ-1', ''), /bağlantısı düştü/);
  assert.equal((await google.durum(db)).bagli, false);
});

test('klasör yoksa NetERP ve proje kodu klasörü oluşturulur', async () => {
  const db = sahteDb();
  await bagliKasa(db);
  fetchKur([
    { url: /files\?q=/, durum: 200, govde: { files: [] } },
    { url: /files\?fields=id/, durum: 200, govde: { id: 'KOK' } },
    { url: /files\?q=/, durum: 200, govde: { files: [] } },
    { url: /files\?fields=id/, durum: 200, govde: { id: 'P1' } },
  ]);
  assert.equal(await google.projeKlasoru(db, 'PRJ-1048', 'Kalıp Tasarımı'), 'P1');
  const kok = JSON.parse(istekler[1].sec.body), pr = JSON.parse(istekler[3].sec.body);
  assert.deepEqual([kok.name, kok.parents[0]], ['NetERP', 'root']);
  assert.deepEqual([pr.name, pr.parents[0], pr.description], ['PRJ-1048', 'KOK', 'Kalıp Tasarımı']);
  assert.match(new URL(istekler[2].url).searchParams.get('q'), /name='PRJ-1048'.*'KOK' in parents/);
});

test('parçalı yükleme: 308 devam, 200 bitti; Content-Range doğru', async () => {
  fetchKur([
    { durum: 308, headers: { range: 'bytes=0-262143' } },
    { durum: 200, govde: { id: 'F1', name: 'a.pdf', size: '300000', webViewLink: 'https://drive.google.com/file/d/F1/view' } },
  ]);
  const a = await google.parcaGonder('https://upload/x', Buffer.alloc(262144), 0, 300000);
  assert.deepEqual(a, { bitti: false, alinan: 262144 });
  assert.equal(istekler[0].sec.headers['content-range'], 'bytes 0-262143/300000');
  const b = await google.parcaGonder('https://upload/x', Buffer.alloc(300000 - 262144), 262144, 300000);
  assert.equal(b.bitti, true);
  assert.equal(istekler[1].sec.headers['content-range'], 'bytes 262144-299999/300000');
});

test('Gmail: MIME UTF-8 başlık ve gövde, Reply-To kullanıcı, satır sonu enjeksiyonu yok', async () => {
  const db = sahteDb();
  await bagliKasa(db);
  fetchKur([{ url: /gmail\/v1\/users\/me\/messages\/send/, durum: 200, govde: { id: 'M1' } }]);
  const g = await google.gmailGonder(db, { kimdenAd: 'Yöntem Teknoloji', kime: ['musteri@ornek.com'], konu: 'SRV-1001 servis raporu\r\nBcc: kotu@x.com', metin: 'Merhaba, ölçüm şöyle.', cevap: 'can@yontem.com.tr' });
  assert.deepEqual(g, { id: 'M1', kimden: 'ofis@yontem.com.tr' });
  const ham = Buffer.from(JSON.parse(istekler[0].sec.body).raw, 'base64url').toString('utf8');
  const [bas, govde] = ham.split('\r\n\r\n');
  assert.match(bas, /^From: =\?UTF-8\?B\?.+\?= <ofis@yontem\.com\.tr>$/m);
  assert.match(bas, /^To: musteri@ornek\.com$/m);
  assert.match(bas, /^Reply-To: can@yontem\.com\.tr$/m);
  assert.ok(!/^Bcc:/m.test(bas), 'konu satırından başlık sızmamalı');
  const konu = bas.match(/^Subject: =\?UTF-8\?B\?(.+)\?=$/m) || bas.match(/^Subject: (.+)$/m);
  assert.ok(konu);
  assert.equal(Buffer.from(govde.replace(/\r\n/g, ''), 'base64').toString('utf8'), 'Merhaba, ölçüm şöyle.');
});
