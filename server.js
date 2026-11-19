// Yerel geliştirme ve IIS (Windows servisi) için giriş noktası. Vercel api/index.js'i kullanır.
import { app } from './src/app.js';
import { config, configDenetle } from './src/config.js';
import { hepsiniKapat } from './src/db.js';

const hatalar = configDenetle();
if (hatalar.length) {
  console.error('Yapılandırma hatası:\n - ' + hatalar.join('\n - '));
  process.exit(1);
}

const sunucu = app.listen(config.port, () => console.log(`Yöntem ERP ${config.mod} modunda, http://localhost:${config.port}`));

const kapat = async () => { sunucu.close(); await hepsiniKapat(); process.exit(0); };
process.on('SIGINT', kapat);
process.on('SIGTERM', kapat);
