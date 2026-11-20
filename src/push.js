// Web Push (mobil uygulama bildirimleri). VAPID anahtarları ilk kullanımda üretilir ve kasada şifreli saklanır;
// ortam değişkeni gerekmez. Gönderim web-push kütüphanesiyle; kütüphane yoksa sessizce atlanır.
import crypto from 'node:crypto';
import { kasaOku, kasaYaz } from './baglanti/kasa.js';

const KASA = 'vapid';
let _wp = null;
async function wp() {
  if (_wp !== null) return _wp;
  try { const m = await import('web-push'); _wp = m.default || m; } catch { _wp = false; }
  return _wp;
}

export async function vapid(db) {
  let k = await kasaOku(db, KASA);
  if (k?.pub && k?.priv) return k;
  const ec = crypto.createECDH('prime256v1'); ec.generateKeys();
  k = { pub: ec.getPublicKey().toString('base64url'), priv: ec.getPrivateKey().toString('base64url') };
  await kasaYaz(db, KASA, k);
  return k;
}

// yuk: { baslik, govde, url, etiket }
export async function bildir(db, kullaniciIdler, yuk) {
  const idler = [...new Set((kullaniciIdler || []).filter(Boolean))];
  if (!idler.length) return 0;
  const lib = await wp(); if (!lib) return 0;
  const abo = await db('push_abonelikleri').whereIn('kullanici_id', idler);
  if (!abo.length) return 0;
  const k = await vapid(db);
  const veri = JSON.stringify({ baslik: String(yuk.baslik || '').slice(0, 120), govde: String(yuk.govde || '').slice(0, 300), url: yuk.url || '/m/', etiket: yuk.etiket || '' });
  let n = 0;
  await Promise.all(abo.map(async (a) => {
    try {
      await lib.sendNotification({ endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } }, veri,
        { TTL: 86400, urgency: 'high', vapidDetails: { subject: 'mailto:bildirim@neterp.local', publicKey: k.pub, privateKey: k.priv }, timeout: 5000 });
      n++;
    } catch (e) {
      if (e?.statusCode === 404 || e?.statusCode === 410) await db('push_abonelikleri').where({ id: a.id }).del().catch(() => {});
      else console.error('push:', e?.statusCode || '', String(e?.message || e).slice(0, 200));
    }
  }));
  return n;
}

// En çok "sure" ms bekler; bildirim kaydı hiçbir zaman yanıtı bozmaz
export async function bildirBekle(db, idler, yuk, sure = 4000) {
  try { await Promise.race([bildir(db, idler, yuk), new Promise((r) => setTimeout(r, sure))]); } catch (e) { console.error('push:', e.message); }
}
