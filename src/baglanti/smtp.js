// En küçük SMTP istemcisi (harici paket yok): SSL/TLS (465), STARTTLS (587), şifresiz (25);
// AUTH PLAIN / LOGIN; çok satırlı yanıtlar; DATA nokta kaçışı. Firma e-posta hesabıyla gönderim için.
// Şifre firma ayarında değil, bağlantı kasasında (AES-256-GCM) tutulur.
import net from 'node:net';
import tls from 'node:tls';
import crypto from 'node:crypto';
import { HttpHata } from '../hata.js';
import { kasaOku, kasaYaz, kasaSil } from './kasa.js';
import { mimeOlustur } from './google.js';

const ZAMAN_ASIMI = 12_000;
const KASA = 'eposta-firma';

// Bir bağlantı üzerinde komut/yanıt sırası. Yanıt: { kod, satirlar }
function oturum(soket) {
  let tampon = '', bekleyen = null, hata = null;
  const satirlar = [];
  const besle = (veri) => {
    tampon += veri.toString('utf8');
    let i;
    while ((i = tampon.indexOf('\n')) >= 0) {
      const satir = tampon.slice(0, i).replace(/\r$/, ''); tampon = tampon.slice(i + 1);
      satirlar.push(satir);
      if (/^\d{3} /.test(satir) || /^\d{3}$/.test(satir)) { // son satır: "250 ..." (devam satırı "250-...")
        const y = { kod: Number(satir.slice(0, 3)), satirlar: satirlar.splice(0).map((x) => x.slice(4)) };
        if (bekleyen) { const b = bekleyen; bekleyen = null; b.ok(y); }
      }
    }
  };
  const bagla = (s) => {
    s.on('data', besle);
    s.on('error', (e) => { hata = e; if (bekleyen) { const b = bekleyen; bekleyen = null; b.red(e); } });
    s.on('close', () => { if (bekleyen) { const b = bekleyen; bekleyen = null; b.red(new Error('Sunucu bağlantıyı kapattı')); } });
  };
  bagla(soket);
  const yanit = () => new Promise((ok, red) => { if (hata) return red(hata); bekleyen = { ok, red }; });
  return {
    yanit,
    async komut(metin, beklenen, gizli) {
      soket.write(metin + '\r\n');
      const y = await yanit();
      if (beklenen && !beklenen.includes(y.kod)) {
        const e = new Error(`SMTP ${gizli || metin.split(' ')[0]}: ${y.kod} ${y.satirlar.join(' ')}`); e.smtpKod = y.kod; throw e;
      }
      return y;
    },
    degistir(yeni) { soket.removeAllListeners('data'); soket = yeni; bagla(yeni); yeni.setTimeout(ZAMAN_ASIMI, () => yeni.destroy(new Error('Sunucu yanıt vermedi (zaman aşımı)'))); },
    get soket() { return soket; },
  };
}

function baglan({ host, port, guvenlik }) {
  return new Promise((ok, red) => {
    const s = guvenlik === 'ssl' ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
    const t = setTimeout(() => { s.destroy(); red(new Error('Sunucuya bağlanılamadı (zaman aşımı)')); }, ZAMAN_ASIMI);
    s.once(guvenlik === 'ssl' ? 'secureConnect' : 'connect', () => { clearTimeout(t); ok(s); });
    s.once('error', (e) => { clearTimeout(t); red(e); });
    s.setTimeout(ZAMAN_ASIMI, () => s.destroy(new Error('Sunucu yanıt vermedi (zaman aşımı)')));
  });
}

const yetenekler = (y) => y.satirlar.map((x) => x.toUpperCase());

// Bağlan, (gerekirse) STARTTLS, giriş yap. Açık oturumu döndürür.
async function ac(a, tlsSecenek = {}) {
  const ehloAd = 'neterp.local';
  const s0 = await baglan(a);
  const o = oturum(s0);
  try {
    const k = await o.yanit();
    if (k.kod !== 220) throw new Error('SMTP karşılama: ' + k.kod + ' ' + k.satirlar.join(' '));
    let ehlo = await o.komut('EHLO ' + ehloAd, [250]);
    if (a.guvenlik === 'starttls') {
      if (!yetenekler(ehlo).some((x) => x.startsWith('STARTTLS'))) throw new Error('Sunucu STARTTLS desteklemiyor; güvenliği "SSL/TLS" (port 465) dene');
      await o.komut('STARTTLS', [220]);
      const g = await new Promise((ok, red) => {
        const t = tls.connect({ socket: o.soket, servername: a.host, ...tlsSecenek }, () => ok(t));
        t.once('error', red);
      });
      o.degistir(g);
      ehlo = await o.komut('EHLO ' + ehloAd, [250]);
    }
    if (a.kullanici) {
      const auth = yetenekler(ehlo).find((x) => x.startsWith('AUTH')) || '';
      if (/\bPLAIN\b/.test(auth)) {
        await o.komut('AUTH PLAIN ' + Buffer.from(`\0${a.kullanici}\0${a.sifre}`).toString('base64'), [235], 'AUTH');
      } else if (/\bLOGIN\b/.test(auth)) {
        await o.komut('AUTH LOGIN', [334]);
        await o.komut(Buffer.from(a.kullanici).toString('base64'), [334], 'AUTH kullanıcı');
        await o.komut(Buffer.from(a.sifre).toString('base64'), [235], 'AUTH şifre');
      } else throw new Error('Sunucu kimlik doğrulama (AUTH PLAIN/LOGIN) sunmuyor' + (a.guvenlik === 'yok' ? '; güvenliği STARTTLS ya da SSL/TLS yap' : ''));
    }
    return o;
  } catch (e) { o.soket.destroy(); throw e; }
}

async function kapat(o) { try { await o.komut('QUIT', [221]); } catch { /* yok say */ } o.soket.destroy(); }

// Hata metnini kullanıcıya anlaşılır hale getirir
function anlasilir(e) {
  const m = String(e.message || e);
  if (e.code === 'ENOTFOUND' || e.code === 'EAI_AGAIN') return 'SMTP sunucu adı bulunamadı (' + m.split(' ').pop() + ')';
  if (e.code === 'ECONNREFUSED') return 'Sunucu bu portta bağlantıyı reddetti; port ve güvenlik türünü kontrol et (587 STARTTLS / 465 SSL)';
  if (e.code === 'ECONNRESET' || /wrong version number|packet length too long/i.test(m)) return 'Güvenlik türü portla uyuşmuyor: 587 için STARTTLS, 465 için SSL/TLS seç';
  if (/certificate|self.signed|CERT_/i.test(m)) return 'Sunucunun SSL sertifikası doğrulanamadı (' + m + ')';
  if (e.smtpKod === 535 || /AUTH.*5\d\d/.test(m)) return 'Kullanıcı adı ya da şifre hatalı (sunucu girişi reddetti)';
  if (e.smtpKod === 553 || e.smtpKod === 550 || e.smtpKod === 554) return 'Sunucu gönderimi reddetti: ' + m.replace(/^SMTP \S+: /, '') + ' — gönderen adresi giriş yapılan hesapla aynı olmalı';
  return m;
}

const dogrula = (a) => {
  if (!a.host) throw new HttpHata(400, 'SMTP sunucu gerekli');
  if (!Number.isInteger(a.port) || a.port < 1 || a.port > 65535) throw new HttpHata(400, 'SMTP port geçersiz');
  if (!['starttls', 'ssl', 'yok'].includes(a.guvenlik)) throw new HttpHata(400, 'Güvenlik türü geçersiz');
};

// Bağlantı + giriş denemesi (gönderim yapmaz)
export async function dene(a, tlsSecenek) {
  dogrula(a);
  let o;
  try { o = await ac(a, tlsSecenek); } catch (e) { throw new HttpHata(400, anlasilir(e)); }
  await kapat(o);
  return true;
}

const zarf = (s) => String(s || '').replace(/[\r\n<>]/g, '').trim();

export async function gonder(a, ileti, tlsSecenek) {
  dogrula(a);
  const kimden = zarf(ileti.kimden);
  const tarih = new Date().toUTCString().replace('GMT', '+0000');
  const alan = kimden.split('@')[1] || 'neterp.local';
  const mesajId = `<${crypto.randomUUID()}@${alan}>`;
  const govde = `Date: ${tarih}\r\nMessage-ID: ${mesajId}\r\n` + mimeOlustur({ ...ileti, kimden });
  let o;
  try {
    o = await ac(a, tlsSecenek);
    await o.komut(`MAIL FROM:<${kimden}>`, [250]);
    for (const k of [...ileti.kime, ...(ileti.cc || [])]) await o.komut(`RCPT TO:<${zarf(k)}>`, [250, 251]);
    await o.komut('DATA', [354]);
    // Satır başındaki nokta ikilenir (RFC 5321 4.5.2); ileti tek nokta satırıyla biter
    await o.komut(govde.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..') + '\r\n.', [250], 'DATA');
    await kapat(o);
    return { mesajId };
  } catch (e) {
    if (o) o.soket.destroy();
    throw e instanceof HttpHata ? e : new HttpHata(400, anlasilir(e));
  }
}

// ---- şifre kasası: firma hesabı (varsayılan) ya da kullanıcının kendi hesabı (anahtar = kullaniciKasasi(id)) ----
export const kullaniciKasasi = (uid) => 'eposta-k:' + uid;
export async function sifreOku(db, ad = KASA) { return (await kasaOku(db, ad))?.sifre || ''; }
export async function kaydet(db, { sifre, ozet }, ad = KASA) { await kasaYaz(db, ad, { sifre, ozet, zaman: new Date().toISOString() }); }
export const sil = (db, ad = KASA) => kasaSil(db, ad);
export async function durum(db, ad = KASA) {
  const k = await kasaOku(db, ad);
  return k ? { kayitli: true, zaman: k.zaman, ozet: k.ozet || '' } : { kayitli: false };
}
// Ayar özeti: sunucu/port/kullanıcı değişince eski test geçersiz sayılır
export const ayarOzeti = (a) => crypto.createHash('sha256').update([a.host, a.port, a.guvenlik, a.kullanici].join('|')).digest('base64url').slice(0, 16);
