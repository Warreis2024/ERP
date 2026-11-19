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
  const kapsam = u.searchParams.get('scope').split(' ');
  assert.ok(kapsam.includes(google.KAPSAM.drive));
  assert.ok(!kapsam.includes(google.KAPSAM.gmail), 'hassas Gmail izni istenmemeli (Access blocked)');
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

// ---------------- ERP hizmet hesabı + Paylaşılan Drive ----------------
import crypto from 'node:crypto';
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const drive = await import('../src/baglanti/driveHesap.js');
function saKur() {
  process.env.GOOGLE_SERVICE_ACCOUNT = JSON.stringify({ client_email: 'neterp-drive@neterp.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), token_uri: 'https://oauth2.googleapis.com/token' });
  drive._sifirla();
}
const belirtecCevabi = { url: /oauth2\.googleapis\.com\/token/, durum: 200, govde: { access_token: 'SA1', expires_in: 3600 } };

test('hizmet hesabı: JWT RS256 doğru imzalı, kapsam drive; belirteç önbellekte', async () => {
  saKur();
  fetchKur([belirtecCevabi, { url: /\/drives\?/, durum: 200, govde: { drives: [{ id: 'D1', name: 'NetERP' }] } }, { url: /\/drives\?/, durum: 200, govde: { drives: [] } }]);
  assert.deepEqual(await drive.suruculer(), [{ id: 'D1', ad: 'NetERP' }]);
  const jwt = istekler[0].sec.body.get('assertion');
  const [h, p, im] = jwt.split('.');
  assert.ok(crypto.verify('RSA-SHA256', Buffer.from(h + '.' + p), publicKey, Buffer.from(im, 'base64url')));
  const yuk = JSON.parse(Buffer.from(p, 'base64url').toString());
  assert.equal(yuk.iss, 'neterp-drive@neterp.iam.gserviceaccount.com');
  assert.equal(yuk.scope, 'https://www.googleapis.com/auth/drive');
  assert.equal(istekler[1].sec.headers.authorization, 'Bearer SA1');
  await drive.suruculer();
  assert.equal(istekler.filter((x) => /token/.test(x.url)).length, 1, 'ikinci çağrıda yeniden belirteç alınmamalı');
});

test('hizmet hesabı tanımlı değilse anlaşılır hata', async () => {
  delete process.env.GOOGLE_SERVICE_ACCOUNT; drive._sifirla();
  assert.equal(drive.yapilandirildi(), false);
  await assert.rejects(drive.suruculer(), /GOOGLE_SERVICE_ACCOUNT/);
});

test('sürücü seçimi: yazma yetkisi yoksa reddedilir; varsa NetERP kökü kurulur ve kaydedilir', async () => {
  saKur();
  const db = sahteDb();
  fetchKur([belirtecCevabi, { url: /\/drives\/D1\?/, durum: 200, govde: { id: 'D1', name: 'NetERP', capabilities: { canAddChildren: false } } }]);
  await assert.rejects(drive.baglan(db, 'D1', 'u0'), /İçerik yöneticisi/);
  fetchKur([
    { url: /\/drives\/D1\?/, durum: 200, govde: { id: 'D1', name: 'NetERP', capabilities: { canAddChildren: true } } },
    { url: /\/files\?/, durum: 200, govde: { files: [] } },
    { url: /\/files\?/, durum: 200, govde: { id: 'KOK' } },
  ]);
  const k = await drive.baglan(db, 'D1', 'u0');
  assert.deepEqual([k.driveId, k.driveAd, k.kokId], ['D1', 'NetERP', 'KOK']);
  const ara = new URL(istekler[1].url).searchParams;
  assert.deepEqual([ara.get('corpora'), ara.get('driveId'), ara.get('supportsAllDrives'), ara.get('includeItemsFromAllDrives')], ['drive', 'D1', 'true', 'true']);
  assert.equal(new URL(istekler[2].url).searchParams.get('supportsAllDrives'), 'true');
  assert.deepEqual(JSON.parse(istekler[2].sec.body).parents, ['D1']);
  const d = await drive.durum(db);
  assert.deepEqual([d.bagli, d.driveAd, d.hesap], [true, 'NetERP', 'neterp-drive@neterp.iam.gserviceaccount.com']);
});

test('üye olunmayan sürücü: 404 anlaşılır mesaj', async () => {
  saKur();
  fetchKur([belirtecCevabi, { url: /\/drives\/YOK\?/, durum: 404, govde: { error: { message: 'Shared drive not found' } } }]);
  await assert.rejects(drive.baglan(sahteDb(), 'YOK', 'u0'), /üye olarak eklediğinden/);
});

test('Paylaşılan Drive\'a yükleme: NetERP/<kod> klasörü ve supportsAllDrives ile resumable oturum', async () => {
  saKur();
  const db = sahteDb();
  await kasaYaz(db, 'gdrive-paylasimli', { driveId: 'D1', driveAd: 'NetERP', kokId: 'KOK' });
  fetchKur([
    belirtecCevabi,
    { url: /\/files\?/, durum: 200, govde: { files: [{ id: 'KOK' }] } },
    { url: /\/files\?/, durum: 200, govde: { files: [] } },
    { url: /\/files\?/, durum: 200, govde: { id: 'PRJ' } },
    { url: /upload\/drive\/v3\/files\?/, durum: 200, headers: { location: 'https://upload/oturum1' } },
  ]);
  const klasor = await drive.projeKlasoru(db, 'PRJ-1048', 'Kalıp Tasarımı');
  assert.equal(klasor, 'PRJ');
  assert.deepEqual(JSON.parse(istekler[3].sec.body), { name: 'PRJ-1048', mimeType: 'application/vnd.google-apps.folder', parents: ['KOK'], description: 'Kalıp Tasarımı' });
  const uri = await drive.yuklemeBaslat({ ad: 'çizim.pdf', tip: 'application/pdf', boyut: 1234, klasorId: klasor });
  assert.equal(uri, 'https://upload/oturum1');
  const y = new URL(istekler[4].url).searchParams;
  assert.deepEqual([y.get('uploadType'), y.get('supportsAllDrives')], ['resumable', 'true']);
  assert.equal(istekler[4].sec.headers['x-upload-content-length'], '1234');
  assert.deepEqual(JSON.parse(istekler[4].sec.body), { name: 'çizim.pdf', parents: ['PRJ'] });
});

// ---------------- Microsoft / OneDrive ----------------
process.env.MS_CLIENT_ID = 'mscid';
process.env.MS_CLIENT_SECRET = 'msgizli';
const ms = await import('../src/baglanti/microsoft.js');
const msBagli = (db, ek = {}) => kasaYaz(db, 'microsoft', {
  yenile: 'MR1', erisim: 'MA1', bitis: Date.now() + 3600e3, kapsam: ['openid', 'User.Read', 'Files.ReadWrite'],
  hesap: 'ofis@outlook.com', surucuTur: 'personal', zaman: '2026-11-20T00:00:00Z', ...ek,
});

test('Microsoft izin adresi: common uç, offline_access + Files.ReadWrite, dönüş adresi', () => {
  const req = { protocol: 'https', get: (h) => (h === 'host' ? 'yontem-erp.vercel.app' : undefined) };
  const u = new URL(ms.izinAdresi(req, 'D'));
  assert.equal(u.origin + u.pathname, 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
  assert.equal(u.searchParams.get('redirect_uri'), 'https://yontem-erp.vercel.app/api/baglanti/microsoft/donus');
  assert.deepEqual(u.searchParams.get('scope').split(' ').sort(), ['Files.ReadWrite', 'User.Read', 'offline_access']);
  assert.equal(u.searchParams.get('state'), 'D');
});

test('Microsoft kod takası: hesap ve sürücü türü kasaya, durum dosya=true', async () => {
  const db = sahteDb();
  const req = { protocol: 'https', get: (h) => (h === 'host' ? 'x.vercel.app' : undefined) };
  fetchKur([
    { url: /login\.microsoftonline\.com\/common\/oauth2\/v2\.0\/token/, durum: 200, govde: { access_token: 'A', refresh_token: 'R', expires_in: 3600, scope: 'https://graph.microsoft.com/Files.ReadWrite https://graph.microsoft.com/User.Read' } },
    { url: /graph\.microsoft\.com\/v1\.0\/me\?/, durum: 200, govde: { userPrincipalName: 'ali@outlook.com', displayName: 'Ali' } },
    { url: /\/me\/drive\?/, durum: 200, govde: { id: 'DR', driveType: 'personal' } },
  ]);
  await ms.kodTakas(req, db, 'KOD', 'u0');
  const govde = istekler[0].sec.body;
  assert.deepEqual([govde.get('code'), govde.get('grant_type'), govde.get('client_secret')], ['KOD', 'authorization_code', 'msgizli']);
  const d = await ms.durum(db);
  assert.deepEqual([d.bagli, d.dosya, d.hesap, d.surucuTur], [true, true, 'ali@outlook.com', 'personal']);
});

test('Microsoft hata kodları anlaşılır mesaja çevrilir (süresi dolmuş gizli anahtar)', async () => {
  const req = { protocol: 'https', get: () => 'x' };
  fetchKur([{ url: /token/, durum: 401, govde: { error: 'invalid_client', error_description: 'AADSTS7000222: The provided client secret keys for app are expired.' } }]);
  await assert.rejects(ms.kodTakas(req, sahteDb(), 'K', 'u0'), /süresi dolmuş/);
  fetchKur([{ url: /token/, durum: 401, govde: { error: 'invalid_client', error_description: 'AADSTS7000215: Invalid client secret provided.' } }]);
  await assert.rejects(ms.kodTakas(req, sahteDb(), 'K', 'u0'), /Secret ID" değil "Value"/);
});

test('Microsoft: yenilemede yeni yenileme belirteci saklanır; invalid_grant kopuk işaretler', async () => {
  const db = sahteDb();
  await msBagli(db, { bitis: 0 });
  fetchKur([
    { url: /token/, durum: 200, govde: { access_token: 'MA2', refresh_token: 'MR2', expires_in: 3600 } },
    { url: /\/me\/drive\/root\?/, durum: 200, govde: { id: 'ROOT' } },
    { url: /items\/ROOT:\/NetERP\?/, durum: 200, govde: { id: 'NE' } },
    { url: /items\/NE:\/PRJ-1048\?/, durum: 200, govde: { id: 'P' } },
  ]);
  assert.equal(await ms.projeKlasoru(db, 'PRJ-1048'), 'P');
  assert.equal(istekler[0].sec.body.get('refresh_token'), 'MR1');
  assert.equal(istekler[1].sec.headers.authorization, 'Bearer MA2');
  assert.equal((await kasaOku(db, 'microsoft')).yenile, 'MR2');

  await msBagli(db, { bitis: 0 });
  fetchKur([{ url: /token/, durum: 400, govde: { error: 'invalid_grant', error_description: 'AADSTS70008: expired' } }]);
  await assert.rejects(ms.projeKlasoru(db, 'X'), /bağlantısı düştü/);
  assert.equal((await ms.durum(db)).bagli, false);
});

test('OneDrive klasörü yoksa oluşturulur (NetERP kökte, proje kodu altında)', async () => {
  const db = sahteDb();
  await msBagli(db);
  fetchKur([
    { url: /\/me\/drive\/root\?/, durum: 200, govde: { id: 'ROOT' } },
    { url: /items\/ROOT:\/NetERP\?/, durum: 404, govde: { error: { code: 'itemNotFound' } } },
    { url: /items\/ROOT\/children$/, durum: 201, govde: { id: 'NE' } },
    { url: /items\/NE:\/PRJ-1048\?/, durum: 404, govde: {} },
    { url: /items\/NE\/children$/, durum: 201, govde: { id: 'P' } },
  ]);
  assert.equal(await ms.projeKlasoru(db, 'PRJ-1048'), 'P');
  assert.deepEqual(JSON.parse(istekler[2].sec.body), { name: 'NetERP', folder: {}, '@microsoft.graph.conflictBehavior': 'fail' });
  assert.equal(JSON.parse(istekler[4].sec.body).name, 'PRJ-1048');
});

test('OneDrive yükleme: oturum yetkisiz PUT, 202 devam, 201 bitti; Türkçe ad kodlanır', async () => {
  const db = sahteDb();
  await msBagli(db);
  fetchKur([{ url: /items\/P:\/%C3%A7izim%20son\.pdf:\/createUploadSession$/, durum: 200, govde: { uploadUrl: 'https://up.onedrive/s1' } }]);
  const uri = await ms.yuklemeBaslat(db, { ad: 'çizim son.pdf', klasorId: 'P' });
  assert.equal(uri, 'https://up.onedrive/s1');
  assert.deepEqual(JSON.parse(istekler[0].sec.body), { item: { '@microsoft.graph.conflictBehavior': 'rename' } });
  fetchKur([
    { durum: 202, govde: { nextExpectedRanges: ['327680-'] } },
    { durum: 201, govde: { id: 'F1', name: 'çizim son.pdf', size: 400000, webUrl: 'https://onedrive.live.com/x', file: { mimeType: 'application/pdf' } } },
  ]);
  const a = await ms.parcaGonder(uri, Buffer.alloc(327680), 0, 400000);
  assert.deepEqual(a, { bitti: false, alinan: 327680 });
  assert.equal(istekler[0].sec.headers.authorization, undefined, 'yükleme adresine yetki başlığı gönderilmemeli');
  assert.equal(istekler[0].sec.headers['content-range'], 'bytes 0-327679/400000');
  const b = await ms.parcaGonder(uri, Buffer.alloc(400000 - 327680), 327680, 400000);
  assert.deepEqual([b.bitti, b.dosya.id, b.dosya.webViewLink], [true, 'F1', 'https://onedrive.live.com/x']);
});

test('OneDrive: yasak karakterli proje kodu güvenli ada çevrilir; kişisel hesapta paylaşım yapılmaz', async () => {
  const db = sahteDb();
  await msBagli(db);
  fetchKur([
    { url: /\/me\/drive\/root\?/, durum: 200, govde: { id: 'ROOT' } },
    { url: /items\/ROOT:\/NetERP\?/, durum: 200, govde: { id: 'NE' } },
    { url: /items\/NE:\/A_B\?/, durum: 200, govde: { id: 'Q' } },
  ]);
  assert.equal(await ms.projeKlasoru(db, 'A/B'), 'Q');
  assert.equal(await ms.kurulustaPaylas(db, 'F1'), null);
});
