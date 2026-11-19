// SMTP istemcisi: yerel sahte SMTP sunucusuna karşı gerçek soket trafiğiyle.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import tls from 'node:tls';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

process.env.OTURUM_GIZLI ||= 'test-gizli-anahtar-en-az-otuz-iki-karakter-uzunlugunda';
const smtp = await import('../src/baglanti/smtp.js');

// Kendinden imzalı sertifika (STARTTLS denemesi için); openssl yoksa o test atlanır
let sertifika = null;
try {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'smtp-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(d, 'k.pem'), '-out', path.join(d, 'c.pem'), '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
  sertifika = { key: fs.readFileSync(path.join(d, 'k.pem')), cert: fs.readFileSync(path.join(d, 'c.pem')) };
} catch { /* openssl yok */ }

// Sahte sunucu: yapılandırılabilir yetenekler ve yanıtlar; gelen komutları kaydeder
function sahteSunucu({ starttls = false, auth = 'PLAIN LOGIN', kullanici = 'erp@firma.com', sifre = 'Gizli.123', mailFromRed = false } = {}) {
  const kayit = { komutlar: [], veri: '', tlsOldu: false };
  const sunucu = net.createServer((soket) => {
    let s = soket, tampon = '', veriModu = false, loginAdim = 0, loginKul = '';
    const yaz = (x) => s.write(x + '\r\n');
    const ehlo = () => {
      const y = ['250-mail.firma.com merhaba', '250-SIZE 35882577', '250-8BITMIME'];
      if (starttls && !kayit.tlsOldu) y.push('250-STARTTLS');
      if (auth && (!starttls || kayit.tlsOldu)) y.push('250-AUTH ' + auth);
      y.push('250 SMTPUTF8');
      s.write(y.join('\r\n') + '\r\n');
    };
    const isle = (satir) => {
      if (veriModu) {
        if (satir === '.') { veriModu = false; yaz('250 2.0.0 Ok: queued'); return; }
        kayit.veri += satir + '\n'; return;
      }
      kayit.komutlar.push(satir);
      if (loginAdim === 1) { loginKul = Buffer.from(satir, 'base64').toString(); loginAdim = 2; return yaz('334 UGFzc3dvcmQ6'); }
      if (loginAdim === 2) { loginAdim = 0; return yaz(loginKul === kullanici && Buffer.from(satir, 'base64').toString() === sifre ? '235 2.7.0 Authentication successful' : '535 5.7.8 Error: authentication failed'); }
      const k = satir.split(' ')[0].toUpperCase();
      if (k === 'EHLO') return ehlo();
      if (k === 'STARTTLS') {
        yaz('220 2.0.0 Ready to start TLS');
        s.removeAllListeners('data');
        const t = new tls.TLSSocket(s, { isServer: true, ...sertifika });
        kayit.tlsOldu = true; s = t; t.on('data', oku); return;
      }
      if (k === 'AUTH' && satir.split(' ')[1] === 'PLAIN') {
        const [, u, p] = Buffer.from(satir.split(' ')[2], 'base64').toString().split('\0');
        return yaz(u === kullanici && p === sifre ? '235 2.7.0 Authentication successful' : '535 5.7.8 Error: authentication failed');
      }
      if (k === 'AUTH' && satir.split(' ')[1] === 'LOGIN') { loginAdim = 1; return yaz('334 VXNlcm5hbWU6'); }
      if (k === 'MAIL') return yaz(mailFromRed ? '553 5.7.1 Sender address rejected: not owned by user' : '250 2.1.0 Ok');
      if (k === 'RCPT') return yaz('250 2.1.5 Ok');
      if (k === 'DATA') { veriModu = true; return yaz('354 End data with <CR><LF>.<CR><LF>'); }
      if (k === 'QUIT') { yaz('221 2.0.0 Bye'); return s.end(); }
      yaz('502 5.5.2 Error: command not recognized');
    };
    const oku = (b) => { tampon += b.toString(); let i; while ((i = tampon.indexOf('\r\n')) >= 0) { const x = tampon.slice(0, i); tampon = tampon.slice(i + 2); isle(x); } };
    s.on('data', oku);
    s.on('error', () => {});
    yaz('220 mail.firma.com ESMTP');
  });
  return new Promise((ok) => sunucu.listen(0, '127.0.0.1', () => ok({ port: sunucu.address().port, kayit, kapat: () => sunucu.close() })));
}

const sunucular = [];
after(() => sunucular.forEach((s) => s.kapat()));
const ayar = (port, ek = {}) => ({ host: '127.0.0.1', port, guvenlik: 'yok', kullanici: 'erp@firma.com', sifre: 'Gizli.123', ...ek });

test('şifresiz bağlantı + AUTH PLAIN: ileti gönderilir, başlıklar ve alıcılar doğru, nokta kaçışı', async () => {
  const s = await sahteSunucu(); sunucular.push(s);
  await smtp.gonder(ayar(s.port), { kimden: 'erp@firma.com', kimdenAd: 'Yöntem Teknoloji', kime: ['a@x.com', 'b@y.com'], konu: 'SRV-1001 raporu', metin: 'Merhaba\n.gizli satır\nSon', cevap: 'can@firma.com' });
  const k = s.kayit.komutlar;
  assert.ok(k.some((x) => x.startsWith('AUTH PLAIN ')));
  assert.ok(k.includes('MAIL FROM:<erp@firma.com>'));
  assert.deepEqual(k.filter((x) => x.startsWith('RCPT')), ['RCPT TO:<a@x.com>', 'RCPT TO:<b@y.com>']);
  assert.match(s.kayit.veri, /^Date: /m);
  assert.match(s.kayit.veri, /^Message-ID: <[0-9a-f-]+@firma\.com>$/m);
  assert.match(s.kayit.veri, /^Reply-To: can@firma\.com$/m);
  assert.match(s.kayit.veri, /^From: =\?UTF-8\?B\?.+\?= <erp@firma\.com>$/m);
  const govde = s.kayit.veri.split('\n\n')[1].replace(/\n/g, '');
  assert.equal(Buffer.from(govde, 'base64').toString('utf8'), 'Merhaba\n.gizli satır\nSon');
});

test('yanlış şifre: anlaşılır mesaj', async () => {
  const s = await sahteSunucu(); sunucular.push(s);
  await assert.rejects(smtp.dene(ayar(s.port, { sifre: 'yanlis' })), /Kullanıcı adı ya da şifre hatalı/);
});

test('yalnız AUTH LOGIN sunan sunucu', async () => {
  const s = await sahteSunucu({ auth: 'LOGIN' }); sunucular.push(s);
  assert.equal(await smtp.dene(ayar(s.port)), true);
  assert.ok(s.kayit.komutlar.includes('AUTH LOGIN'));
});

test('STARTTLS: şifreli kanala geçip giriş yapar', { skip: !sertifika && 'openssl yok' }, async () => {
  const s = await sahteSunucu({ starttls: true }); sunucular.push(s);
  assert.equal(await smtp.dene(ayar(s.port, { guvenlik: 'starttls' }), { rejectUnauthorized: false }), true);
  assert.equal(s.kayit.tlsOldu, true);
  const k = s.kayit.komutlar;
  assert.ok(k.indexOf('STARTTLS') < k.findIndex((x) => x.startsWith('AUTH')), 'giriş TLS\'ten sonra olmalı');
});

test('STARTTLS istenip sunucu sunmuyorsa açık hata; şifresiz kanalda şifre gönderilmez', async () => {
  const s = await sahteSunucu({ starttls: false }); sunucular.push(s);
  await assert.rejects(smtp.dene(ayar(s.port, { guvenlik: 'starttls' })), /STARTTLS desteklemiyor/);
  assert.ok(!s.kayit.komutlar.some((x) => x.startsWith('AUTH')));
});

test('gönderen adresi reddedilirse sebep söylenir', async () => {
  const s = await sahteSunucu({ mailFromRed: true }); sunucular.push(s);
  await assert.rejects(smtp.gonder(ayar(s.port), { kimden: 'baska@firma.com', kime: ['a@x.com'], konu: 'x', metin: 'y' }), /gönderen adresi giriş yapılan hesapla aynı olmalı/);
});

test('kapalı port: port/güvenlik mesajı', async () => {
  const bos = net.createServer(); await new Promise((ok) => bos.listen(0, '127.0.0.1', ok));
  const port = bos.address().port; await new Promise((ok) => bos.close(ok));
  await assert.rejects(smtp.dene(ayar(port)), /reddetti; port ve güvenlik/);
});

test('ayar özeti: sunucu/port/kullanıcı değişince değişir, şifre değişince değişmez', () => {
  const a = ayar(587);
  assert.equal(smtp.ayarOzeti(a), smtp.ayarOzeti({ ...a, sifre: 'baska' }));
  assert.notEqual(smtp.ayarOzeti(a), smtp.ayarOzeti({ ...a, port: 465 }));
});

test('kasa: firma ve kullanıcı şifreleri ayrı anahtarlarda, şifreli', async () => {
  const satir = new Map();
  const db = () => { let k; const q = { where(o) { k = o.anahtar; return q; }, first: async () => (satir.has(k) ? { deger: satir.get(k) } : undefined), update: async (o) => satir.set(k, o.deger), insert: async (o) => satir.set(o.anahtar, o.deger), del: async () => satir.delete(k) }; return q; };
  await smtp.kaydet(db, { sifre: 'Firma.1', ozet: 'a' });
  await smtp.kaydet(db, { sifre: 'Can.2', ozet: 'b' }, smtp.kullaniciKasasi('u4'));
  assert.equal(await smtp.sifreOku(db), 'Firma.1');
  assert.equal(await smtp.sifreOku(db, smtp.kullaniciKasasi('u4')), 'Can.2');
  assert.equal(await smtp.sifreOku(db, smtp.kullaniciKasasi('u5')), '');
  assert.ok(![...satir.values()].some((v) => v.includes('Firma.1') || v.includes('Can.2')));
  await smtp.sil(db, smtp.kullaniciKasasi('u4'));
  assert.equal((await smtp.durum(db, smtp.kullaniciKasasi('u4'))).kayitli, false);
  assert.equal((await smtp.durum(db)).kayitli, true);
});

test('HTML imza: logo gömülü (cid) eke döner, betik temizlenir, düz metin kopyası da gider', async () => {
  const { iletiGovdesi } = await import('../src/baglanti/google.js');
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'); // PNG başlığı yeter
  const imza = `<p><b>Savaş SARAÇ</b><br>Proje Yöneticisi</p><p><img src="data:image/png;base64,${png.toString('base64')}" width="120" onerror="alert(1)"></p><script>alert('x')</script><a href="javascript:kotu()">tık</a>`;
  const g = iletiGovdesi('Merhaba,\nRapor ektedir.', imza, 'yontemteknoloji.com');
  assert.equal(g.satirIci.length, 1);
  assert.match(g.html, /src="cid:imza1\.[a-z0-9]+@yontemteknoloji\.com"/);
  assert.ok(!/data:image|<script|onerror|javascript:/i.test(g.html));
  assert.match(g.metin, /Rapor ektedir\.\n\n-- \nSavaş SARAÇ\nProje Yöneticisi/);

  const s = await sahteSunucu(); sunucular.push(s);
  await smtp.gonder(ayar(s.port), { kimden: 'erp@firma.com', kime: ['a@x.com'], konu: 'İmza testi', ...g });
  const v = s.kayit.veri;
  assert.match(v, /^Content-Type: multipart\/alternative; boundary="=_alt_/m);
  assert.match(v, /^Content-Type: text\/plain; charset=UTF-8$/m);
  assert.match(v, /^Content-Type: multipart\/related; boundary="=_rel_/m);
  assert.match(v, /^Content-Type: text\/html; charset=UTF-8$/m);
  const cid = g.html.match(/cid:([^"]+)/)[1];
  assert.ok(v.includes(`Content-ID: <${cid}>`));
  assert.match(v, /^Content-Type: image\/png; name="imza1\.png"$/m);
  // Gömülü resmin içeriği aynen gider
  const resimB64 = v.split(`Content-ID: <${cid}>`)[1].split('\n\n')[1].split('\n--')[0].replace(/\n/g, '');
  assert.deepEqual(Buffer.from(resimB64, 'base64'), png);
});

test('imzasız ileti eskisi gibi tek parça düz metin', async () => {
  const { mimeOlustur } = await import('../src/baglanti/google.js');
  const m = mimeOlustur({ kimden: 'a@b.com', kime: ['c@d.com'], konu: 'x', metin: 'y' });
  assert.ok(!/multipart/.test(m));
  assert.match(m, /Content-Type: text\/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n/);
});
