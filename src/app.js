import express from 'express';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { json } from './db.js';
import { firmaCoz } from './tenant.js';
import { kimlik, girisGerekli, csrfDenetle } from './auth/middleware.js';
import { hataYakala, HttpHata } from './hata.js';
import oturum from './routes/oturum.js';
import meta from './routes/meta.js';
import durum from './routes/durum.js';
import kayitlar from './routes/kayitlar.js';
import ayar, { firmaRouter, kullaniciRouter } from './routes/ayar.js';

const kok = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1); // IIS (ARR) ya da Vercel önünde: gerçek IP ve https bilgisi bir önceki vekilden gelir

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      // Not: arayüz şimdilik tek dosya (satır içi script/style). Modüllere bölününce 'unsafe-inline' kaldırılacak.
      'script-src': ["'self'", "'unsafe-inline'"],
      'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
      'img-src': ["'self'", 'data:', 'blob:', 'https:'],
      'frame-src': ["'self'", 'blob:', 'data:', 'https://drive.google.com', 'https://docs.google.com', 'https://onedrive.live.com', 'https://*.sharepoint.com'],
      'connect-src': ["'self'", ...(config.depo.supabaseUrl ? [config.depo.supabaseUrl] : [])],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

const api = express.Router();
api.use(express.json({ limit: '4mb' })); // Vercel istek sınırı 4,5 MB; büyük dosyalar depo adaptörüyle doğrudan yüklenecek
api.get('/saglik', (_req, res) => res.json({ ok: true, mod: config.mod, zaman: new Date().toISOString() }));
// Veritabanı erişim denetimi (ayrıntı sızdırmaz; yalnızca hata kodu döner)
api.get('/saglik/db', firmaCoz, async (req, res) => {
  const t0 = Date.now();
  try { await req.db.raw('select 1 as x'); res.json({ ok: true, ms: Date.now() - t0 }); }
  catch (e) { console.error('saglik/db:', e.code || '', e.message); res.status(503).json({ ok: false, kod: e.code || 'HATA' }); }
});
// Giriş sayfası için firma adı ve logosu (oturum gerektirmez; başka bilgi vermez)
api.get('/firma-genel', firmaCoz, async (req, res) => {
  const a = await req.db('ayarlar').where({ anahtar: 'firma' }).first();
  const f = json.oku(a?.deger, {});
  res.set('Cache-Control', 'no-store').json({ ad: f.ad || req.firma.ad, sub: req.firma.sub, logo: typeof f.logo === 'string' && f.logo.startsWith('data:image/') ? f.logo : '' });
});
api.use(firmaCoz, kimlik, csrfDenetle);
api.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
api.use('/oturum', oturum);
api.use(girisGerekli);
api.use(meta);
api.use(durum);
api.use(kayitlar);
api.use('/ayar/firma', firmaRouter);
api.use('/ayar/kullanicilar', kullaniciRouter);
api.use('/ayar', ayar);
api.use((_req, _res, next) => next(new HttpHata(404, 'Bulunamadı')));
api.use(hataYakala);
app.use('/api', api);

// Arayüz dosyaları (Vercel'de public/ klasörünü Vercel kendisi sunar; IIS/yerelde Express sunar)
app.use(express.static(path.join(kok, 'public'), { index: 'index.html', maxAge: config.uretim ? '1h' : 0 }));
app.use(hataYakala);

export default app;
