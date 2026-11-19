import { belirtecCoz, cerezleriOku, CEREZ } from './oturum.js';
import { kullaniciYukle } from '../veri.js';
import { HttpHata } from '../hata.js';
import { yonetici } from '../kurallar/yetki.js';

// Çerezdeki oturumu doğrular, req.kullanici'yi doldurur. Oturum yoksa req.kullanici = null.
export async function kimlik(req, _res, next) {
  try {
    req.cerezler = cerezleriOku(req);
    req.kullanici = null;
    const yuk = belirtecCoz(req.cerezler[CEREZ.oturum]);
    if (yuk && yuk.f === req.firma.sub) {
      const u = await kullaniciYukle(req.db, yuk.uid);
      if (u && u.aktif && u.oturum_surumu === yuk.sv) req.kullanici = u;
    }
    next();
  } catch (e) { next(e); }
}

export function girisGerekli(req, _res, next) {
  if (!req.kullanici) return next(new HttpHata(401, 'Oturum açılmamış'));
  // İlk şifreyle girmiş kullanıcı yalnız şifre değiştirme ve oturum uçlarını kullanabilir.
  if (req.kullanici.sifre_degismeli && !req.path.startsWith('/oturum')) return next(new HttpHata(403, 'Önce şifreni değiştirmelisin', { kod: 'SIFRE_DEGISMELI' }));
  next();
}

export function yoneticiGerekli(req, _res, next) {
  if (!yonetici(req.kullanici)) return next(new HttpHata(403, 'Bu işlem için yönetici yetkisi gerekir'));
  next();
}

// CSRF: durum değiştiren isteklerde X-CSRF-Token başlığı, csrf çereziyle aynı olmalı (double-submit).
// Ayrıca Origin başlığı varsa isteğin geldiği adresle eşleşmeli.
export function csrfDenetle(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.path === '/oturum/giris') return next(); // girişte henüz çerez yok; SameSite=Lax + kilit kuralı korur
  const baslik = req.get('x-csrf-token');
  const cerez = (req.cerezler || cerezleriOku(req))[CEREZ.csrf];
  if (!baslik || !cerez || baslik !== cerez) return next(new HttpHata(403, 'Güvenlik belirteci geçersiz, sayfayı yenile'));
  const origin = req.get('origin');
  if (origin) {
    const host = (req.get('x-forwarded-host') || req.get('host') || '').toLowerCase();
    try { if (new URL(origin).host.toLowerCase() !== host) return next(new HttpHata(403, 'Geçersiz kaynak')); } catch { return next(new HttpHata(403, 'Geçersiz kaynak')); }
  }
  next();
}
