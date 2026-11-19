// Fonksiyon silme: her kaydın son değeri geçmişe yazılır, sonra değerler silinir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fonksiyonVerisiniGecmiseYaz } from '../src/fonksiyonSil.js';

// En küçük knex benzeri bellek içi veritabanı
function sahteTrx(veri) {
  const t = (tablo) => {
    let kosul = {};
    const satirlar = () => (veri[tablo] || []).filter((r) => Object.entries(kosul).every(([k, v]) => r[k] === v));
    const q = {
      where(o) { kosul = o; return q; },
      select() { return Promise.resolve(veri[tablo] || []); },
      first: async () => satirlar()[0],
      insert: async (L) => { veri[tablo] = [...(veri[tablo] || []), ...(Array.isArray(L) ? L : [L])]; },
      del: async () => { const once = (veri[tablo] || []).length; veri[tablo] = (veri[tablo] || []).filter((r) => !satirlar().includes(r)); return once - veri[tablo].length; },
      then: (ok, red) => Promise.resolve(satirlar()).then(ok, red),
    };
    return q;
  };
  return t;
}

const deger = (o) => ({ id: o.id, modul_id: 'servis', proje_id: 'p1', kart_id: null, fn_uid: 'fn1', fn_tip: 'metin', sira: 0, metin: null, kisi: null, ...o });

test('değeri olan her kayıt için geçmişe son değer yazılır, değerler silinir, diğer fonksiyonlara dokunulmaz', async () => {
  const veri = {
    fonksiyonlar: [{ uid: 'fn1', modul_id: 'servis', tip: 'metin', ad: 'Garanti notu' }],
    kullanicilar: [{ id: 'u1', ad: 'Ayşe Yılmaz' }], depolar: [],
    degerler: [
      deger({ id: 'd1', kart_id: 'k1', metin: 'Garanti kapsamında' }),
      deger({ id: 'd2', kart_id: 'k2', metin: '' }),                // boş: geçmişe yazılmaz
      deger({ id: 'd3', kart_id: 'k3', metin: 'Kapsam dışı' }),
      deger({ id: 'd4', kart_id: 'k1', fn_uid: 'fn2', metin: 'başka alan' }),
    ],
    log: [],
  };
  const u = { id: 'u0', ad: 'Sistem Yöneticisi' };
  const s = await fonksiyonVerisiniGecmiseYaz(sahteTrx(veri), 'fn1', u);
  assert.deepEqual(s, { kayit: 2 });
  assert.deepEqual(veri.log.map((l) => [l.kart_id, l.alan, l.eski, l.yeni, l.tip, l.kisi_ad]).sort(), [
    ['k1', 'Garanti notu', 'Garanti kapsamında', '', 'alan', 'Sistem Yöneticisi'],
    ['k3', 'Garanti notu', 'Kapsam dışı', '', 'alan', 'Sistem Yöneticisi'],
  ]);
  assert.match(veri.log[0].metin, /modülden kaldırıldı/);
  assert.deepEqual(veri.degerler.map((d) => d.id), ['d4']);
});

test('kişi değerleri geçmişe ad olarak yazılır; çok satırlı değerler birleştirilir', async () => {
  const veri = {
    fonksiyonlar: [{ uid: 'fe', modul_id: 'servis', tip: 'ekip', ad: 'Ekip' }],
    kullanicilar: [{ id: 'u1', ad: 'Ayşe Yılmaz' }, { id: 'u4', ad: 'Can Öztürk' }], depolar: [],
    degerler: [
      deger({ id: 'a', kart_id: 'k1', fn_uid: 'fe', fn_tip: 'ekip', kisi: 'u4', metin: 'Saha', sira: 1 }),
      deger({ id: 'b', kart_id: 'k1', fn_uid: 'fe', fn_tip: 'ekip', kisi: 'u1', metin: 'Planlama', sira: 0 }),
    ],
    log: [],
  };
  await fonksiyonVerisiniGecmiseYaz(sahteTrx(veri), 'fe', { id: 'u0', ad: 'Yönetici' });
  assert.equal(veri.log.length, 1);
  assert.equal(veri.log[0].eski, 'Ayşe Yılmaz: Planlama | Can Öztürk: Saha');
  assert.equal(veri.degerler.length, 0);
});

test('verisi olmayan fonksiyon: geçmişe bir şey yazılmaz', async () => {
  const veri = { fonksiyonlar: [{ uid: 'fx', modul_id: 'm', tip: 'metin', ad: 'X' }], degerler: [], log: [] };
  assert.deepEqual(await fonksiyonVerisiniGecmiseYaz(sahteTrx(veri), 'fx', { id: 'u0', ad: 'Y' }), { kayit: 0 });
  assert.equal(veri.log.length, 0);
});
