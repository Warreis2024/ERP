import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { iletiCoz, baslikCoz, alintiKes } from '../src/baglanti/mime.js';
import { okunmamislariIsle } from '../src/baglanti/imap.js';

const ILETI = [
  'From: =?utf-8?B?QXnFn2UgWcSxbG1heg==?= <ayse@acme.com.tr>',
  'Subject: =?iso-8859-9?Q?Klima_=E7al=FD=FEm=FDyor?=',
  'Message-ID: <abc123@acme.com.tr>',
  'Content-Type: multipart/mixed; boundary="SINIR"',
  '',
  '--SINIR',
  'Content-Type: multipart/alternative; boundary="IC"',
  '',
  '--IC',
  'Content-Type: text/plain; charset=utf-8',
  'Content-Transfer-Encoding: quoted-printable',
  '',
  'Merhaba, 3. kattaki klima =C3=A7al=C4=B1=C5=9Fm=C4=B1yor.',
  '',
  '> eski yaz=C4=B1',
  '--IC',
  'Content-Type: text/html; charset=utf-8',
  '',
  '<p>Merhaba</p>',
  '--IC--',
  '--SINIR',
  'Content-Type: image/png; name="foto.png"',
  'Content-Disposition: attachment; filename="foto.png"',
  'Content-Transfer-Encoding: base64',
  '',
  'iVBORw0KGgo=',
  '--SINIR--',
  '',
].join('\r\n');

test('MIME: başlık, gövde, ek', () => {
  assert.equal(baslikCoz('=?utf-8?B?w5Z6ZWw=?= =?utf-8?B?IGfDvG4=?='), 'Özel gün');
  const c = iletiCoz(ILETI);
  assert.equal(c.konu, 'Klima çalışmıyor');
  assert.equal(c.kimdenAd, 'Ayşe Yılmaz');
  assert.equal(c.kimdenAdres, 'ayse@acme.com.tr');
  assert.equal(c.mesajId, '<abc123@acme.com.tr>');
  assert.match(c.metin, /klima çalışmıyor/);
  assert.deepEqual(c.ekler, ['foto.png']);
  assert.equal(alintiKes('Tamam\n\n> eski\nOn Mon, Ali wrote:\nesk'), 'Tamam');
});

test('IMAP: giriş, okunmamışlar, getir, okundu', async () => {
  const komutlar = [];
  const sunucu = net.createServer((s) => {
    s.write('* OK hazir\r\n');
    let t = '';
    s.on('data', (d) => {
      t += d.toString();
      let i;
      while ((i = t.indexOf('\r\n')) >= 0) {
        const satir = t.slice(0, i); t = t.slice(i + 2); komutlar.push(satir);
        const [et, ...k] = satir.split(' '), c = k.join(' ');
        if (c.startsWith('LOGIN')) s.write(`${et} OK giris\r\n`);
        else if (c.startsWith('SELECT')) s.write(`* 2 EXISTS\r\n${et} OK [READ-WRITE] secildi\r\n`);
        else if (c === 'UID SEARCH UNSEEN') s.write(`* SEARCH 7\r\n${et} OK arandi\r\n`);
        else if (c.startsWith('UID FETCH 7')) { const b = Buffer.from(ILETI); s.write(`* 1 FETCH (UID 7 BODY[] {${b.length}}\r\n`); s.write(b); s.write(`)\r\n${et} OK getirildi\r\n`); }
        else if (c.startsWith('UID STORE 7')) s.write(`${et} OK isaretlendi\r\n`);
        else if (c === 'LOGOUT') { s.write(`* BYE\r\n${et} OK\r\n`); s.end(); }
        else s.write(`${et} BAD bilinmiyor\r\n`);
      }
    });
  });
  await new Promise((r) => sunucu.listen(0, '127.0.0.1', r));
  const gelen = [];
  const sonuc = await okunmamislariIsle({ host: '127.0.0.1', port: sunucu.address().port, tls: false, kullanici: 'destek@x.com', sifre: 'p"q' }, async (ham) => { gelen.push(iletiCoz(ham)); return true; });
  sunucu.close();
  assert.deepEqual(sonuc, { bulunan: 1, islenen: 1 });
  assert.equal(gelen[0].konu, 'Klima çalışmıyor');
  assert.ok(komutlar.some((k) => k.includes('LOGIN "destek@x.com" "p\\"q"')));
  assert.ok(komutlar.some((k) => k.includes('UID STORE 7 +FLAGS (\\Seen)')));
});
