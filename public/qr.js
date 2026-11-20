/* Küçük QR kod üretici (bayt kipi, hata düzeltme M, sürüm 1–10 ≈ 213 bayta kadar).
   Algoritma ISO/IEC 18004; yapı Project Nayuki'nin açık anlatımını izler. Dış bağımlılık yoktur.
   QR.matris(metin) → boolean[][]  ·  QR.svg(metin, {kenar, renk}) → SVG metni */
(function (kok) {
  'use strict';
  // [ECC kod sözcüğü / blok, blok sayısı] — düzey M, sürüm 1..10
  const ECC = [null, [10, 1], [16, 1], [26, 1], [18, 2], [24, 2], [16, 4], [18, 4], [22, 4], [22, 5], [26, 5]];
  const ham = (v) => { let r = (16 * v + 128) * v + 64; if (v >= 2) { const n = Math.floor(v / 7) + 2; r -= (25 * n - 10) * n - 55; if (v >= 7) r -= 36; } return r; };
  const veriSozcuk = (v) => Math.floor(ham(v) / 8) - ECC[v][0] * ECC[v][1];

  function carp(x, y) { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; } return z & 0xff; }
  function bolen(d) { const r = new Array(d).fill(0); r[d - 1] = 1; let kok2 = 1; for (let i = 0; i < d; i++) { for (let j = 0; j < d; j++) { r[j] = carp(r[j], kok2); if (j + 1 < d) r[j] ^= r[j + 1]; } kok2 = carp(kok2, 2); } return r; }
  function kalan(veri, b) { const r = new Array(b.length).fill(0); for (const x of veri) { const f = x ^ r.shift(); r.push(0); b.forEach((c, i) => { r[i] ^= carp(c, f); }); } return r; }

  function kodla(metin) {
    const baytlar = Array.from(new TextEncoder().encode(String(metin)));
    let v = 1; while (v <= 10 && veriSozcuk(v) * 8 < 4 + (v <= 9 ? 8 : 16) + baytlar.length * 8) v++;
    if (v > 10) throw new Error('QR için metin çok uzun');
    const bit = []; const ekle = (deger, n) => { for (let i = n - 1; i >= 0; i--) bit.push((deger >>> i) & 1); };
    ekle(4, 4); ekle(baytlar.length, v <= 9 ? 8 : 16); baytlar.forEach((b) => ekle(b, 8));
    const kap = veriSozcuk(v) * 8;
    ekle(0, Math.min(4, kap - bit.length)); ekle(0, (8 - bit.length % 8) % 8);
    for (let p = 0xec; bit.length < kap; p ^= 0xec ^ 0x11) ekle(p, 8);
    const veri = []; for (let i = 0; i < bit.length; i += 8) { let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | bit[i + j]; veri.push(b); }
    // bloklara böl, hata düzeltme ekle, iç içe geçir
    const [eccLen, blokSay] = ECC[v], toplam = Math.floor(ham(v) / 8);
    const kisaSay = blokSay - toplam % blokSay, kisaUz = Math.floor(toplam / blokSay), b = bolen(eccLen);
    const bloklar = []; let k = 0;
    for (let i = 0; i < blokSay; i++) {
      const d = veri.slice(k, k + kisaUz - eccLen + (i < kisaSay ? 0 : 1)); k += d.length;
      const e = kalan(d, b); if (i < kisaSay) d.push(0); bloklar.push(d.concat(e));
    }
    const sonuc = [];
    for (let i = 0; i < bloklar[0].length; i++) bloklar.forEach((bl, j) => { if (i !== kisaUz - eccLen || j >= kisaSay) sonuc.push(bl[i]); });
    return { v, sozcukler: sonuc };
  }

  function matris(metin) {
    const { v, sozcukler } = kodla(metin);
    const n = v * 4 + 17;
    const M = Array.from({ length: n }, () => new Array(n).fill(false));
    const F = Array.from({ length: n }, () => new Array(n).fill(false));
    const koy = (x, y, d) => { M[y][x] = d; F[y][x] = true; };
    for (let i = 0; i < n; i++) { koy(6, i, i % 2 === 0); koy(i, 6, i % 2 === 0); }
    const bulucu = (x, y) => { for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const xx = x + dx, yy = y + dy, u = Math.max(Math.abs(dx), Math.abs(dy)); if (xx >= 0 && xx < n && yy >= 0 && yy < n) koy(xx, yy, u !== 2 && u !== 4); } };
    bulucu(3, 3); bulucu(n - 4, 3); bulucu(3, n - 4);
    if (v > 1) {
      const say = Math.floor(v / 7) + 2, adim = Math.ceil((v * 4 + 4) / (say * 2 - 2)) * 2, P = [6];
      for (let p = n - 7; P.length < say; p -= adim) P.splice(1, 0, p);
      P.forEach((a, i) => P.forEach((c, j) => {
        if ((i === 0 && j === 0) || (i === 0 && j === say - 1) || (i === say - 1 && j === 0)) return;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) koy(a + dx, c + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }));
    }
    const bicim = (mask) => {
      const d = (0 << 3) | mask; let r = d; for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
      const bits = ((d << 10) | r) ^ 0x5412, g = (i) => ((bits >>> i) & 1) !== 0;
      for (let i = 0; i <= 5; i++) koy(8, i, g(i));
      koy(8, 7, g(6)); koy(8, 8, g(7)); koy(7, 8, g(8));
      for (let i = 9; i < 15; i++) koy(14 - i, 8, g(i));
      for (let i = 0; i < 8; i++) koy(n - 1 - i, 8, g(i));
      for (let i = 8; i < 15; i++) koy(8, n - 15 + i, g(i));
      koy(8, n - 8, true);
    };
    bicim(0); // yer ayır
    if (v >= 7) {
      let r = v; for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
      const bits = (v << 12) | r;
      for (let i = 0; i < 18; i++) { const d = ((bits >>> i) & 1) !== 0, a = n - 11 + i % 3, c = Math.floor(i / 3); koy(a, c, d); koy(c, a, d); }
    }
    let i = 0;
    for (let sag = n - 1; sag >= 1; sag -= 2) {
      if (sag === 6) sag = 5;
      for (let d = 0; d < n; d++) for (let j = 0; j < 2; j++) {
        const x = sag - j, yukari = ((sag + 1) & 2) === 0, y = yukari ? n - 1 - d : d;
        if (!F[y][x] && i < sozcukler.length * 8) { M[y][x] = ((sozcukler[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0; i++; }
      }
    }
    const maskeler = [
      (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
      (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => (x * y) % 2 + (x * y) % 3 === 0,
      (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0, (x, y) => ((x + y) % 2 + (x * y) % 3) % 2 === 0,
    ];
    const uygula = (m) => { for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (!F[y][x] && maskeler[m](x, y)) M[y][x] = !M[y][x]; };
    // ceza puanı (kural 1, 2 ve 4) ile en iyi maske
    const ceza = () => {
      let p = 0, koyu = 0;
      for (let y = 0; y < n; y++) for (const yon of [0, 1]) {
        let son = null, uz = 0;
        for (let x = 0; x < n; x++) { const c = yon ? M[x][y] : M[y][x]; if (c === son) { uz++; if (uz === 5) p += 3; else if (uz > 5) p++; } else { son = c; uz = 1; } }
      }
      for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) { const c = M[y][x]; if (c === M[y][x + 1] && c === M[y + 1][x] && c === M[y + 1][x + 1]) p += 3; }
      M.forEach((s) => s.forEach((c) => { if (c) koyu++; }));
      return p + Math.floor(Math.abs(koyu * 20 - n * n * 10) / (n * n)) * 10;
    };
    let enIyi = 0, enAz = Infinity;
    for (let m = 0; m < 8; m++) { uygula(m); bicim(m); const c = ceza(); if (c < enAz) { enAz = c; enIyi = m; } uygula(m); }
    uygula(enIyi); bicim(enIyi);
    return M;
  }

  function svg(metin, o) {
    o = o || {}; const M = matris(metin), n = M.length, k = o.kenar == null ? 4 : o.kenar, b = n + k * 2;
    let yol = '';
    M.forEach((s, y) => s.forEach((c, x) => { if (c) yol += `M${x + k},${y + k}h1v1h-1z`; }));
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${b} ${b}" shape-rendering="crispEdges"${o.boyut ? ` width="${o.boyut}" height="${o.boyut}"` : ''}><rect width="100%" height="100%" fill="#fff"/><path d="${yol}" fill="${o.renk || '#000'}"/></svg>`;
  }
  const dataUrl = (metin, o) => 'data:image/svg+xml;base64,' + btoa(svg(metin, o));
  kok.QR = { matris, svg, dataUrl };
})(typeof window !== 'undefined' ? window : globalThis);
