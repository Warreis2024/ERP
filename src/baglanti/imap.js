// En basit IMAP istemcisi (bağımlılıksız): bağlan, giriş, klasör seç, okunmamışları getir, okundu işaretle.
// Yalnız TLS (993) ya da sınama için düz bağlantı. Yanıtlardaki {n} literal blokları desteklenir.
import tls from 'node:tls';
import net from 'node:net';

const tirnak = (s) => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

export class Imap {
  constructor(soket, sure = 20000) {
    this.s = soket; this.tampon = Buffer.alloc(0); this.bekleyen = null; this.no = 0; this.sure = sure;
    soket.on('data', (d) => { this.tampon = Buffer.concat([this.tampon, d]); this._isle(); });
    soket.on('error', (e) => { if (this.bekleyen) { const b = this.bekleyen; this.bekleyen = null; b.red(e); } });
    soket.on('close', () => { if (this.bekleyen) { const b = this.bekleyen; this.bekleyen = null; b.red(new Error('IMAP bağlantısı kapandı')); } });
  }

  // Yanıt: { satirlar: [metin], literaller: [Buffer] } — etiketli sonuç satırına kadar
  _isle() {
    const b = this.bekleyen; if (!b) return;
    for (;;) {
      if (b.literal != null) {
        if (this.tampon.length < b.literal) return;
        b.literaller.push(this.tampon.slice(0, b.literal));
        this.tampon = this.tampon.slice(b.literal); b.literal = null; continue;
      }
      const i = this.tampon.indexOf('\r\n'); if (i < 0) return;
      const satir = this.tampon.slice(0, i).toString('utf8'); this.tampon = this.tampon.slice(i + 2);
      b.satirlar.push(satir);
      const lit = satir.match(/\{(\d+)\}$/);
      if (lit) { b.literal = Number(lit[1]); if (b.literal > 30 * 1024 * 1024) { b.red(new Error('İleti çok büyük')); this.bekleyen = null; return; } continue; }
      if (b.etiket === '*' ? /^\* (OK|PREAUTH|BYE)/.test(satir) : satir.startsWith(b.etiket + ' ')) {
        this.bekleyen = null; clearTimeout(b.zaman);
        if (b.etiket !== '*' && !/^\S+ OK/i.test(satir)) b.red(new Error('IMAP: ' + satir.replace(/^\S+ /, '').slice(0, 200)));
        else b.coz({ satirlar: b.satirlar, literaller: b.literaller });
        return;
      }
    }
  }
  _bekle(etiket) {
    return new Promise((coz, red) => {
      const zaman = setTimeout(() => { this.bekleyen = null; red(new Error('IMAP zaman aşımı')); this.s.destroy(); }, this.sure);
      this.bekleyen = { etiket, satirlar: [], literaller: [], literal: null, coz, red, zaman };
      this._isle();
    });
  }
  karsilama() { return this._bekle('*'); }
  komut(k) {
    const etiket = 'A' + (++this.no);
    const p = this._bekle(etiket);
    this.s.write(`${etiket} ${k}\r\n`);
    return p;
  }
  giris(kullanici, sifre) { return this.komut(`LOGIN ${tirnak(kullanici)} ${tirnak(sifre)}`); }
  sec(klasor = 'INBOX') { return this.komut(`SELECT ${tirnak(klasor)}`); }
  async okunmamis() {
    const r = await this.komut('UID SEARCH UNSEEN');
    const s = r.satirlar.find((x) => x.startsWith('* SEARCH')) || '';
    return s.replace('* SEARCH', '').trim().split(/\s+/).filter(Boolean).map(Number);
  }
  async getir(uid) {
    const r = await this.komut(`UID FETCH ${Number(uid)} (BODY.PEEK[])`);
    return r.literaller[0] || null;
  }
  okundu(uid) { return this.komut(`UID STORE ${Number(uid)} +FLAGS (\\Seen)`); }
  async cikis() { try { await this.komut('LOGOUT'); } catch { /* kapanırken */ } this.s.destroy(); }
}

// ayar: { host, port, tls (varsayılan true), kullanici, sifre }
export function baglan(ayar, sure = 20000) {
  return new Promise((coz, red) => {
    const port = Number(ayar.port) || (ayar.tls === false ? 143 : 993);
    const s = ayar.tls === false ? net.connect({ host: ayar.host, port }) : tls.connect({ host: ayar.host, port, servername: ayar.host });
    const zaman = setTimeout(() => { s.destroy(); red(new Error('IMAP sunucusuna bağlanılamadı (zaman aşımı)')); }, sure);
    s.once('error', (e) => { clearTimeout(zaman); red(new Error('IMAP sunucusuna bağlanılamadı: ' + e.message)); });
    s.once(ayar.tls === false ? 'connect' : 'secureConnect', async () => {
      clearTimeout(zaman);
      const c = new Imap(s, sure);
      try { await c.karsilama(); coz(c); } catch (e) { s.destroy(); red(e); }
    });
  });
}

// Okunmamış iletileri getirir; isle(ham) başarıyla dönen her ileti okundu işaretlenir.
export async function okunmamislariIsle(ayar, isle, enCok = 20) {
  const c = await baglan(ayar);
  try {
    await c.giris(ayar.kullanici, ayar.sifre);
    await c.sec(ayar.klasor || 'INBOX');
    const L = (await c.okunmamis()).slice(0, enCok);
    let n = 0;
    for (const uid of L) {
      const ham = await c.getir(uid);
      if (!ham) continue;
      if (await isle(ham)) { await c.okundu(uid); n++; }
    }
    return { bulunan: L.length, islenen: n };
  } finally { await c.cikis(); }
}
