// Vercel sunucusuz fonksiyonu: bütün /api/* istekleri buraya gelir (vercel.json).
import { app } from '../src/app.js';
import { configDenetle } from '../src/config.js';

const hatalar = configDenetle();
if (hatalar.length) console.error('Yapılandırma hatası: ' + hatalar.join(' | '));

export default app;
