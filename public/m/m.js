// NetERP mobil (PWA). Bilgisayardaki ERP'den QR ile eşlenir; şifre sorulmaz.
// Özellikler: bildirimler (web push), gelen mesajlar, kayda mesaj yazma, hızlı not (Notlarım),
// sesli not, sesten metne dikte, fotoğraf ve video ekleme.
(function () {
  'use strict';
  const _t = window._t || ((m) => m);
  const $ = (s, k) => (k || document).querySelector(s);
  const KOK = $('#uygulama');
  const EN_COK_EK = 6;
  const TOPLAM_SINIR = 4_400_000; // data URL karakteri (≈3,2 MB) — sunucu sınırının biraz altı
  const BULUT_ESIK = 900_000;            // bu boyuttan büyük ses/video, bulut deposu bağlıysa oraya yüklenir
  const BULUT_AZAMI = 1024 * 1048576;    // tek dosya en çok 1 GB
  const bulutVar = () => !!(D.ozet && D.ozet.depo);
  const videoSn = () => (bulutVar() ? 180 : 30);
  const DEPO_AD = { gdrive: 'Google Drive', onedrive: 'OneDrive' };
  const bulutAdresi = (u) => { try { const x = new URL(u); return x.protocol === 'https:' && /^(drive\.google\.com|docs\.google\.com|onedrive\.live\.com|1drv\.ms|[a-z0-9-]+(-my)?\.sharepoint\.com)$/i.test(x.hostname); } catch (e) { return false; } };

  const D = { ozet: null, sekme: 'gelen', ara: '', notlar: [], kayit: null, mesajlar: [], son: null, push: 'bilinmiyor' };
  const taslak = { hedef: null, metin: '', ekler: [] };

  // ---------- yardımcılar ----------
  const kac = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const csrf = () => { const m = document.cookie.match(/(?:^|;\s*)erp_csrf=([^;]+)/); return m ? decodeURIComponent(m[1]) : ''; };
  let toastZ;
  function toast(m, sure) { const t = $('#toast'); t.textContent = m; t.classList.add('goster'); clearTimeout(toastZ); toastZ = setTimeout(() => t.classList.remove('goster'), sure || 2600); }
  function zaman(iso) {
    if (!iso) return '';
    const z = new Date(iso), simdi = new Date(), fark = (simdi - z) / 1000;
    if (fark < 60) return _t('şimdi');
    if (fark < 3600) return _t('{0} dk', Math.floor(fark / 60));
    if (z.toDateString() === simdi.toDateString()) return z.toLocaleTimeString(window.LOKAL || 'tr-TR', { hour: '2-digit', minute: '2-digit' });
    return z.toLocaleDateString(window.LOKAL || 'tr-TR', { day: 'numeric', month: 'short' });
  }
  async function api(yol, { method = 'GET', govde } = {}) {
    const h = { Accept: 'application/json' };
    if (govde !== undefined) h['Content-Type'] = 'application/json';
    if (method !== 'GET') h['X-CSRF-Token'] = csrf();
    const r = await fetch('/api' + yol, { method, headers: h, body: govde !== undefined ? JSON.stringify(govde) : undefined, credentials: 'same-origin' });
    let v = null; try { v = await r.json(); } catch (e) { /* boş yanıt */ }
    if (!r.ok) { const e = new Error(_t((v && v.hata) || 'Sunucu hatası')); e.durum = r.status; throw e; }
    return v;
  }
  // Mesajın yazarı kullanıcı kimliği ya da (eski kayıtlarda) adı olabilir
  const kisi = (v) => (D.ozet && D.ozet.kullanicilar.find((k) => k.id === v || k.ad === v)) || { id: v, ad: v || '?', foto: '' };
  const benMi = (v) => !!D.ozet && (v === D.ozet.ben.id || v === D.ozet.ben.ad);
  const modul = (id) => (D.ozet && D.ozet.moduller.find((m) => m.id === id)) || null;
  const kayitBul = (tur, id) => (D.ozet ? D.ozet.kayitlar.find((k) => k.id === id && (!tur || k.tur === tur)) : null);
  const kayitAd = (k) => (k ? (k.kod || '') + (k.baslik ? ' · ' + k.baslik : '') : '');
  function avatar(u) {
    if (u.foto && /^data:image\//.test(u.foto)) return `<img class="avatar" alt="" src="${kac(u.foto)}">`;
    const h = String(u.ad || '?').split(/\s+/).map((x) => x[0] || '').join('').slice(0, 2).toUpperCase();
    return `<span class="avatar">${kac(h)}</span>`;
  }
  const sure = (s) => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  const guvenliEk = (u) => /^data:(image|audio|video)\/[\w.+-]+(;codecs=[\w.,]+)?;base64,/.test(String(u || ''));

  // ---------- başlangıç ----------
  async function basla() {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {});
    if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', (e) => {
      if (!e.data) return;
      if (e.data.tur === 'git') { location.href = e.data.url; rotaIsle(); }
      if (e.data.tur === 'push') yenile(true);
    });
    const h = new URLSearchParams(location.hash.slice(1));
    const kod = h.get('e');
    if (kod) {
      history.replaceState(null, '', location.pathname);
      try { await eslestir(kod); } catch (e) { return esleEkran(e.message); }
    }
    try { await yukle(); } catch (e) {
      if (e.durum === 401 || e.durum === 403) return esleEkran();
      return hataEkran(e.message);
    }
    paylasimAl();
    rotaIsle();
    pushDurum();
    setInterval(() => { if (document.visibilityState === 'visible') yenile(true); }, 45000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') yenile(true); });
    window.addEventListener('hashchange', rotaIsle);
  }

  function cihazAdi() {
    const ua = navigator.userAgent;
    const m = ua.match(/Android [\d.]+; ([^;)]+?)(?: Build|\))/);
    if (m) return m[1].trim().slice(0, 60);
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/iPad/.test(ua)) return 'iPad';
    return _t('Telefon');
  }
  async function eslestir(kod) {
    KOK.innerHTML = '<div class="bekle"><div class="donen"></div></div>';
    await api('/cihaz/bagla', { method: 'POST', govde: { kod, ad: cihazAdi() } });
    toast(_t('Telefon bağlandı'));
  }
  async function yukle() {
    D.ozet = await api('/mobil/ozet');
    D.son = D.son || new Date().toISOString();
    try { D.notlar = await api('/mobil/notlar'); } catch (e) { D.notlar = []; }
  }
  let yenileniyor = false;
  async function yenile(sessiz) {
    if (yenileniyor || !D.ozet) return;
    yenileniyor = true;
    try {
      const eski = new Set(D.ozet.gelen.map((g) => g.id));
      await yukle();
      const yeni = D.ozet.gelen.filter((g) => !eski.has(g.id) && !benMi(g.kimden));
      if (D.kayit) await mesajlariYukle(true);
      if (yeni.length && sessiz) toast(_t('{0} yeni mesaj', yeni.length));
      if (!D.kayit && !$('.perde')) ciz();
    } catch (e) { if (!sessiz) toast(e.message); }
    yenileniyor = false;
  }

  // ---------- eşleme / hata ekranları ----------
  function esleEkran(hata) {
    window.onhashchange = () => { if (/[#&]e=/.test(location.hash)) location.reload(); };
    KOK.innerHTML = `<div class="esle"><img src="ikon-192.png" alt=""><h1>NetERP</h1>
      ${hata ? `<p style="color:#c0392b">${kac(hata)}</p>` : ''}
      <p>${kac(_t('Bu telefon henüz bağlı değil.'))}</p>
      <ol><li>${kac(_t('Bilgisayarda ERP\'yi aç.'))}</li><li>${kac(_t('Profilim → Telefonu bağla\'ya tıkla.'))}</li><li>${kac(_t('Ekrandaki QR kodu bu telefonun kamerasıyla okut.'))}</li></ol>
      <p class="kucuk">${kac(_t('Şifre gerekmez; bağlantıyı istediğin zaman bilgisayardan kaldırabilirsin.'))}</p></div>`;
  }
  function hataEkran(m) {
    KOK.innerHTML = `<div class="esle"><h1>NetERP</h1><p>${kac(m)}</p><button class="dugme" id="tekrar">${kac(_t('Tekrar dene'))}</button></div>`;
    $('#tekrar').onclick = () => location.reload();
  }

  // ---------- rota ----------
  function rotaIsle() {
    const h = new URLSearchParams(location.hash.slice(1));
    const k = h.get('k'), p = h.get('p');
    if (k || p) return kayitAc(k ? 'kart' : 'proje', k || p);
    D.kayit = null; ciz();
  }

  // ---------- ana ekran ----------
  function ciz() {
    const o = D.ozet; if (!o) return;
    const okunmamis = o.gelen.filter((g) => !g.okundu && !benMi(g.kimden)).length;
    const sekmeler = [['gelen', '✉', _t('Gelen'), okunmamis], ['kayitlar', '☰', _t('Kayıtlar'), 0], ['notlar', '✎', _t('Notlarım'), D.notlar.length]];
    KOK.innerHTML = `<header class="ust">${avatar(o.ben)}<h1>${kac(o.ben.ad)}</h1><button id="yenile" aria-label="${kac(_t('Yenile'))}">⟳</button></header>
      <main id="icerik"></main>
      <button class="fab" id="yeni" aria-label="${kac(_t('Yeni not'))}">+</button>
      <nav class="sekme">${sekmeler.map(([id, ik, ad, n]) => `<button data-sekme="${id}" class="${D.sekme === id ? 'secili' : ''}"><b>${ik}</b><span>${kac(ad)}${n ? `<span class="rozet">${n}</span>` : ''}</span></button>`).join('')}</nav>`;
    $('#yenile').onclick = () => yenile(false).then(() => toast(_t('Güncellendi')));
    $('#yeni').onclick = () => olusturucu(D.sekme === 'notlar' ? null : undefined);
    KOK.querySelectorAll('[data-sekme]').forEach((b) => { b.onclick = () => { D.sekme = b.dataset.sekme; D.ara = ''; ciz(); }; });
    const ic = $('#icerik');
    ic.innerHTML = pushBilgi() + (D.sekme === 'gelen' ? gelenHTML() : D.sekme === 'kayitlar' ? kayitlarHTML() : notlarHTML());
    baglaIcerik(ic);
  }
  // Android Chrome: "Uygulamayı yükle" (WebAPK — mağazasız, ana ekranda uygulama olarak)
  let yukleIstegi = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); yukleIstegi = e; if (D.ozet && !D.kayit && !$('.perde')) ciz(); });
  window.addEventListener('appinstalled', () => { yukleIstegi = null; toast(_t('Uygulama yüklendi')); });
  function pushBilgi() {
    const y = yukleIstegi ? `<div class="bilgi"><p>${kac(_t('NetERP\'yi telefonuna uygulama olarak yükle.'))}</p><button class="dugme" data-yukle>${kac(_t('Yükle'))}</button></div>` : '';
    if (D.push !== 'sor') return y;
    return y + pushSoru();
  }
  function pushSoru() {
    return `<div class="bilgi"><p>${kac(_t('Yeni mesaj ve atamalarda telefonuna bildirim gelsin mi?'))}</p><button class="dugme" data-push="ac">${kac(_t('Bildirimleri aç'))}</button></div>`;
  }
  function gelenHTML() {
    const L = D.ozet.gelen;
    if (!L.length) return `<div class="bos">${kac(_t('Son üç haftada mesaj yok.'))}</div>`;
    return `<div class="liste">${L.map((g) => {
      const k = g.kartId ? kayitBul('kart', g.kartId) : kayitBul('proje', g.projeId);
      const u = kisi(g.kimden);
      const ek = g.ekler && g.ekler.length ? ' 📎' + g.ekler.length : '';
      return `<button class="oge ${!g.okundu && !benMi(g.kimden) ? 'yeni' : ''}" data-ac="${g.kartId ? 'kart' : 'proje'}:${kac(g.kartId || g.projeId)}">${avatar(u)}
        <div class="ic"><div class="ust-satir"><b>${kac(u.ad)}</b><span class="zaman">${kac(zaman(g.zaman))}</span></div>
        <div class="baslik">${kac(kayitAd(k) || '—')}</div><div class="metin">${kac(g.metin || '')}${ek}</div></div></button>`;
    }).join('')}</div>`;
  }
  function kayitSuz(q, sinir) {
    const s = String(q || '').toLocaleLowerCase(window.LOKAL || 'tr-TR').trim();
    const L = D.ozet.kayitlar.filter((k) => !s || ((k.kod || '') + ' ' + (k.baslik || '') + ' ' + ((modul(k.modulId) || {}).ad || '')).toLocaleLowerCase(window.LOKAL || 'tr-TR').includes(s));
    return L.slice(0, sinir || 60);
  }
  function kayitOge(k, veri) {
    const m = modul(k.modulId) || {};
    return `<button class="oge" ${veri}="${k.tur}:${kac(k.id)}"><div class="ic"><div class="ust-satir"><span class="etiket" style="background:${/^#[0-9a-f]{3,8}$/i.test(m.renk || '') ? m.renk : ''}">${kac(m.ad || '')}</span><b>${kac(k.kod || '')}</b><span class="zaman">${kac(zaman(k.zaman))}</span></div>
      <div class="baslik">${kac(k.baslik || '—')}</div></div></button>`;
  }
  function kayitlarHTML() {
    const L = kayitSuz(D.ara);
    return `<input class="ara" id="ara" type="search" placeholder="${kac(_t('Kod, başlık veya modül ara…'))}" value="${kac(D.ara)}">
      <div class="liste" id="kayitListe">${L.length ? L.map((k) => kayitOge(k, 'data-ac')).join('') : `<div class="bos">${kac(_t('Kayıt bulunamadı'))}</div>`}</div>`;
  }
  function notlarHTML() {
    if (!D.notlar.length) return `<div class="bos">${kac(_t('Henüz not yok. + ile hızlı not ekle; sonra bir kayda taşıyabilirsin.'))}</div>`;
    return `<div class="liste">${D.notlar.map((n) => `<div class="oge"><div class="ic"><div class="ust-satir"><span>✎</span><span class="zaman">${kac(zaman(n.olusturma))}</span></div>
      <div class="gov">${kac(n.metin).replace(/\n/g, '<br>')}</div>${eklerHTML(n.ekler)}
      <div class="alt-dugmeler"><button class="dugme" data-not-tasi="${kac(n.id)}">${kac(_t('Kayda taşı'))}</button><button class="dugme ikincil" data-not-sil="${kac(n.id)}">${kac(_t('Sil'))}</button></div></div></div>`).join('')}</div>`;
  }
  function eklerHTML(L) {
    const bulut = (L || []).filter((e) => e.depo && bulutAdresi(e.url)).map((e) => {
      const ik = /^video\//.test(e.tip || '') ? '🎬' : /^audio\//.test(e.tip || '') ? '🎙' : /^image\//.test(e.tip || '') ? '🖼' : '📎';
      return `<a class="bulut-ek" href="${kac(e.url)}" target="_blank" rel="noopener noreferrer"><b>${ik}</b><span>${kac(e.ad || _t('Dosya'))}<small>${kac(DEPO_AD[e.depo] || '')}${e.boyut ? ' · ' + (e.boyut / 1048576).toFixed(1) + ' MB' : ''}</small></span></a>`;
    }).join('');
    return bulut + (L || []).filter((e) => !e.depo && guvenliEk(e.url)).map((e) => {
      const u = kac(e.url);
      if (e.url.startsWith('data:image/')) return `<img src="${u}" alt="${kac(e.ad)}" loading="lazy">`;
      if (e.url.startsWith('data:audio/')) return `<audio controls preload="none" src="${u}"></audio>`;
      return `<video controls playsinline preload="metadata" src="${u}"></video>`;
    }).join('');
  }
  function baglaIcerik(ic) {
    ic.querySelectorAll('[data-ac]').forEach((b) => { b.onclick = () => { const [tur, id] = b.dataset.ac.split(':'); location.hash = (tur === 'kart' ? 'k=' : 'p=') + id; }; });
    const a = $('#ara', ic);
    if (a) a.oninput = () => { D.ara = a.value; const L = kayitSuz(D.ara); $('#kayitListe').innerHTML = L.length ? L.map((k) => kayitOge(k, 'data-ac')).join('') : `<div class="bos">${kac(_t('Kayıt bulunamadı'))}</div>`; baglaIcerik($('#kayitListe')); };
    ic.querySelectorAll('[data-not-sil]').forEach((b) => { b.onclick = async () => {
      if (!confirm(_t('Not silinsin mi?'))) return;
      try { await api('/mobil/notlar/' + encodeURIComponent(b.dataset.notSil), { method: 'DELETE' }); D.notlar = D.notlar.filter((n) => n.id !== b.dataset.notSil); ciz(); } catch (e) { toast(e.message); }
    }; });
    ic.querySelectorAll('[data-not-tasi]').forEach((b) => { b.onclick = () => kayitSec(async (k) => {
      try {
        await api('/mobil/notlar/' + encodeURIComponent(b.dataset.notTasi) + '/tasi', { method: 'POST', govde: { projeId: k.projeId, kartId: k.tur === 'kart' ? k.id : null } });
        D.notlar = D.notlar.filter((n) => n.id !== b.dataset.notTasi); toast(_t('Not kayda taşındı')); ciz();
      } catch (e) { toast(e.message, 4000); }
    }, false); });
    ic.querySelectorAll('[data-push]').forEach((b) => { b.onclick = pushAc; });
    ic.querySelectorAll('[data-yukle]').forEach((b) => { b.onclick = async () => { if (!yukleIstegi) return; yukleIstegi.prompt(); await yukleIstegi.userChoice.catch(() => {}); yukleIstegi = null; ciz(); }; });
  }

  // ---------- kayıt (mesaj akışı) ----------
  async function kayitAc(tur, id) {
    const k = kayitBul(tur, id);
    if (!k) { toast(_t('Kayıt bulunamadı ya da görme yetkin yok')); location.hash = ''; return; }
    D.kayit = k; D.mesajlar = null;
    const m = modul(k.modulId) || {};
    KOK.innerHTML = `<header class="ust"><button id="geri" aria-label="${kac(_t('Geri'))}">‹</button><h1>${kac(kayitAd(k))}</h1></header>
      <main><div class="kucuk" style="margin-bottom:8px">${kac(m.ad || '')}</div><div class="akis" id="akis"><div class="bekle"><div class="donen"></div></div></div></main>
      ${m.yaz ? `<div class="yazici"><div class="ekler" id="ekListe"></div><div style="display:flex;gap:6px;align-items:flex-end">
        <button class="arac" id="ekBtn" style="flex:none;min-width:44px" aria-label="${kac(_t('Ekle'))}"><b>＋</b></button>
        <textarea class="yaz" id="yaz" rows="1" placeholder="${kac(_t('Mesaj yaz…'))}"></textarea>
        <button class="dugme" id="gonder">${kac(_t('Gönder'))}</button></div></div>` : ''}`;
    $('#geri').onclick = () => { location.hash = ''; };
    taslak.hedef = k; taslak.ekler = []; taslak.metin = '';
    if (m.yaz) {
      $('#yaz').oninput = (e) => { taslak.metin = e.target.value; };
      $('#gonder').onclick = () => gonder($('#gonder'));
      $('#ekBtn').onclick = () => olusturucu(k);
    }
    await mesajlariYukle();
  }
  async function mesajlariYukle(sessiz) {
    const k = D.kayit; if (!k) return;
    try {
      const q = '?projeId=' + encodeURIComponent(k.projeId) + (k.tur === 'kart' ? '&kartId=' + encodeURIComponent(k.id) : '');
      const L = await api('/mobil/mesajlar' + q);
      if (D.kayit !== k) return;
      if (sessiz && D.mesajlar && L.length === D.mesajlar.length) return;
      D.mesajlar = L; akisCiz();
      D.ozet.gelen.forEach((g) => { if ((g.kartId || null) === (k.tur === 'kart' ? k.id : null) && g.projeId === k.projeId) g.okundu = true; });
    } catch (e) { if (!sessiz) { $('#akis').innerHTML = `<div class="bos">${kac(e.message)}</div>`; } }
  }
  function akisCiz() {
    const a = $('#akis'); if (!a) return;
    a.innerHTML = D.mesajlar.length ? D.mesajlar.map((m) => {
      const u = kisi(m.kimden);
      return `<div class="balon ${benMi(m.kimden) ? 'ben' : ''}"><div class="kim">${benMi(m.kimden) ? '' : kac(u.ad) + ' · '}${kac(zaman(m.zaman))}</div>
        <div class="gov">${kac(m.metin).replace(/\n/g, '<br>')}</div>${eklerHTML(m.ekler)}</div>`;
    }).join('') : `<div class="bos">${kac(_t('Bu kayıtta henüz mesaj yok.'))}</div>`;
    window.scrollTo(0, document.body.scrollHeight);
  }

  // ---------- gönderme ----------
  function toplamBoyut() { return taslak.ekler.reduce((t, e) => t + (e.blob ? 0 : e.url.length), 0); }
  // Büyük dosyayı firmanın bulut deposuna parça parça yükler (masaüstündeki gibi, sunucu üzerinden 3,75 MB'lık parçalar)
  async function bulutaYukle(e, hedef, ilerle) {
    const o = await api('/dosya/yukle/basla', { method: 'POST', govde: { depo: D.ozet.depo, ad: e.ad, tip: e.tip || '', boyut: e.blob.size, projeId: hedef ? hedef.projeId : null, modulId: hedef ? hedef.modulId || null : null } });
    let bas = 0, son = o.dosya || null;
    while (!son) {
      const parca = e.blob.slice(bas, Math.min(bas + o.parca, e.blob.size));
      const r = await fetch('/api/dosya/yukle/parca?bas=' + bas, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/octet-stream', 'x-csrf-token': csrf(), 'x-yukleme-oturum': o.oturum }, body: parca });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(_t(j.hata || 'Yükleme hatası'));
      if (j.bitti) { son = j.dosya; break; }
      bas = j.alinan || bas + parca.size; ilerle(bas / e.blob.size);
      if (bas >= e.blob.size) break;
    }
    if (!son) throw new Error(_t('Yükleme tamamlanmadı'));
    return { ad: e.ad, url: son.url, depo: D.ozet.depo, dosyaId: son.id || '', boyut: Number(son.boyut || e.blob.size), tip: e.tip || '' };
  }
  async function gonder(btn) {
    const metin = (taslak.metin || '').trim();
    if (!metin && !taslak.ekler.length) return toast(_t('Mesaj boş'));
    btn.disabled = true;
    const yazi = btn.textContent;
    try {
      const ekler = [];
      const buyuk = taslak.ekler.filter((e) => e.blob);
      for (const e of taslak.ekler) {
        if (!e.blob) { ekler.push({ ad: e.ad, url: e.url }); continue; }
        const n = buyuk.indexOf(e) + 1;
        ekler.push(await bulutaYukle(e, taslak.hedef, (x) => { btn.textContent = _t('Yükleniyor {0}/{1} · %{2}', n, buyuk.length, Math.round(x * 100)); }));
        e.blob = null; Object.assign(e, ekler[ekler.length - 1]); // yeniden denemede tekrar yüklenmesin
      }
      btn.textContent = yazi;
      if (taslak.hedef) {
        const k = taslak.hedef;
        await api('/mesaj', { method: 'POST', govde: { projeId: k.projeId, kartId: k.tur === 'kart' ? k.id : null, metin, ekler } });
        toast(_t('Gönderildi'));
      } else {
        const n = await api('/mobil/notlar', { method: 'POST', govde: { metin, ekler } });
        D.notlar.unshift(n); toast(_t('Notlarım\'a kaydedildi'));
      }
      taslak.metin = ''; taslak.ekler = [];
      const p = $('.perde'); if (p) p.remove();
      if (D.kayit) { const y = $('#yaz'); if (y) y.value = ''; ekListeCiz(); await mesajlariYukle(); } else ciz();
    } catch (e) { toast(e.message, 5000); }
    btn.textContent = yazi; btn.disabled = false;
  }

  // ---------- oluşturucu (hızlı not / mesaj) ----------
  // hedef: undefined → son açılan kayıt yoksa seçtir; null → Notlarım; kayıt → o kayıt
  function olusturucu(hedef) {
    if (hedef !== undefined) taslak.hedef = hedef;
    else if (!D.kayit) taslak.hedef = null;
    if (!D.kayit) { taslak.ekler = taslak.ekler || []; }
    const p = document.createElement('div'); p.className = 'perde';
    p.innerHTML = `<div class="sayfa" role="dialog" aria-modal="true"><h2>${kac(D.kayit ? _t('Ek ve not') : _t('Hızlı not'))}<button data-kapat aria-label="${kac(_t('Kapat'))}">×</button></h2>
      ${D.kayit ? '' : `<button class="hedef" id="hedefSec"><span id="hedefAd"></span><b>›</b></button>`}
      <textarea class="yaz" id="notMetin" placeholder="${kac(_t('Yaz ya da 🎤 ile konuş…'))}"></textarea>
      <div class="araclar">
        <button class="arac" data-arac="dikte"><b>🎤</b>${kac(_t('Dikte'))}</button>
        <button class="arac" data-arac="ses"><b>🎙</b><span>${kac(_t('Sesli not'))}</span></button>
        <button class="arac" data-arac="foto"><b>📷</b>${kac(_t('Fotoğraf'))}</button>
        <button class="arac" data-arac="video"><b>🎬</b>${kac(_t('Video'))}</button>
        <button class="arac" data-arac="dosya"><b>🖼</b>${kac(_t('Galeri'))}</button>
      </div>
      <div class="ekler" id="ekListe2"></div>
      <div class="kucuk" id="boyut"></div>
      <div class="alt-dugmeler"><button class="dugme ikincil" data-kapat>${kac(_t('Vazgeç'))}</button><button class="dugme" id="kaydet">${kac(_t('Gönder'))}</button></div></div>`;
    document.body.appendChild(p);
    const metin = $('#notMetin', p);
    metin.value = D.kayit ? (($('#yaz') || {}).value || '') : taslak.metin || '';
    metin.oninput = () => { taslak.metin = metin.value; const y = $('#yaz'); if (y) y.value = metin.value; };
    const hedefYaz = () => { const h = $('#hedefAd', p); if (h) h.textContent = taslak.hedef ? kayitAd(taslak.hedef) : '✎ ' + _t('Notlarım (kayıt seçilmedi)'); };
    hedefYaz();
    const hs = $('#hedefSec', p); if (hs) hs.onclick = () => kayitSec((k) => { taslak.hedef = k; hedefYaz(); }, true);
    p.querySelectorAll('[data-kapat]').forEach((b) => { b.onclick = () => { dikteDur(); sesDur(); p.remove(); if (D.kayit) ekListeCiz(); }; });
    $('#kaydet', p).onclick = () => { dikteDur(); sesDur(); gonder($('#kaydet', p)); };
    p.querySelector('[data-arac="dikte"]').onclick = (e) => dikte(e.currentTarget, metin);
    p.querySelector('[data-arac="ses"]').onclick = (e) => sesKaydi(e.currentTarget);
    p.querySelector('[data-arac="foto"]').onclick = () => dosyaSec('image/*', 'environment');
    p.querySelector('[data-arac="video"]').onclick = () => videoKaydi();
    p.querySelector('[data-arac="dosya"]').onclick = () => dosyaSec(bulutVar() ? '*/*' : 'image/*,video/*,audio/*');
    ekListeCiz();
    setTimeout(() => metin.focus(), 50);
  }

  function ekListeCiz() {
    const kutular = [$('#ekListe2'), $('#ekListe')].filter(Boolean);
    const html = taslak.ekler.map((e, i) => {
      const u = kac(e.onizleme || e.url), tur = e.tip || e.url.slice(5, e.url.indexOf('/'));
      const ic = e.depo && !e.blob ? `<span class="bulut-ad">☁ ${kac(e.ad)}</span>` : /^image/.test(tur) ? `<img src="${u}" alt="">` : /^video/.test(tur) ? `<video src="${u}" muted playsinline></video>` : `<audio controls src="${u}"></audio>`;
      const etiket = e.blob ? `<span class="bulut-rozet">☁ ${(e.blob.size / 1048576).toFixed(1)} MB</span>` : '';
      return `<div class="ek">${ic}${etiket}<button class="x" data-ek-sil="${i}" aria-label="${kac(_t('Kaldır'))}">×</button></div>`;
    }).join('');
    kutular.forEach((k) => { k.innerHTML = html; k.querySelectorAll('[data-ek-sil]').forEach((b) => { b.onclick = () => { taslak.ekler.splice(+b.dataset.ekSil, 1); ekListeCiz(); }; }); });
    const b = $('#boyut');
    if (b) b.textContent = !taslak.ekler.length ? '' : bulutVar() ? _t('{0} ek · büyük dosyalar {1} deposuna yüklenir', taslak.ekler.length, DEPO_AD[D.ozet.depo]) : _t('{0} ek · {1} MB / {2} MB', taslak.ekler.length, (toplamBoyut() * 0.75 / 1048576).toFixed(1), (TOPLAM_SINIR * 0.75 / 1048576).toFixed(1));
  }
  function ekEkle(ad, url) {
    if (taslak.ekler.length >= EN_COK_EK) { toast(_t('En çok {0} ek eklenebilir', EN_COK_EK)); return false; }
    if (toplamBoyut() + url.length > TOPLAM_SINIR) { toast(_t('Ek çok büyük. Toplam sınır yaklaşık {0} MB; daha kısa bir kayıt dene.', (TOPLAM_SINIR * 0.75 / 1048576).toFixed(1)), 4500); return false; }
    taslak.ekler.push({ ad, url }); ekListeCiz(); return true;
  }
  // Ses / video: küçükse gömülü, büyükse (bulut bağlıysa) gönderirken buluta yüklenir
  async function blobEkle(ad, blob) {
    if (bulutVar() && blob.size > BULUT_ESIK) {
      if (blob.size > BULUT_AZAMI) { toast(_t('"{0}" çok büyük ({1} MB).', ad, (blob.size / 1048576).toFixed(0)), 4500); return false; }
      if (taslak.ekler.length >= EN_COK_EK) { toast(_t('En çok {0} ek eklenebilir', EN_COK_EK)); return false; }
      taslak.ekler.push({ ad, blob, tip: (blob.type || '').split(';')[0], onizleme: URL.createObjectURL(blob), url: '' }); ekListeCiz(); return true;
    }
    if (blob.size * 1.37 + toplamBoyut() > TOPLAM_SINIR) { toast(_t('"{0}" çok büyük ({1} MB). Uygulama içinden kısa video çek.', ad, (blob.size / 1048576).toFixed(1)), 5000); return false; }
    return ekEkle(ad, await blobUrl(blob));
  }
  const blobUrl = (b) => new Promise((ok, red) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = red; r.readAsDataURL(b); });
  // Fotoğraf: en uzun kenar 1600 px, JPEG %80
  function resimKucult(dosya) {
    return new Promise((ok, red) => {
      const img = new Image(), u = URL.createObjectURL(dosya);
      img.onload = () => {
        const o = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * o); c.height = Math.round(img.naturalHeight * o);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(u);
        ok(c.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = () => { URL.revokeObjectURL(u); red(new Error(_t('Resim okunamadı'))); };
      img.src = u;
    });
  }
  // Sunucunun kabul ettiği türler; diğerleri (ör. HEIC) resimse JPEG'e çevrilir
  const SES_TUR = /^audio\/(webm|ogg|mp4|mpeg|aac|x-m4a)/, VIDEO_TUR = /^video\/(webm|mp4|quicktime)/;
  function dosyaSec(kabul, kamera) {
    const g = document.createElement('input'); g.type = 'file'; g.accept = kabul; g.multiple = !kamera;
    if (kamera) g.setAttribute('capture', kamera);
    g.onchange = async () => {
      for (const f of [...g.files]) {
        try {
          if (f.type.startsWith('image/')) { ekEkle(f.name || 'foto.jpg', await resimKucult(f)); continue; }
          if (SES_TUR.test(f.type) || VIDEO_TUR.test(f.type)) { await blobEkle(f.name, f); continue; }
          if (bulutVar() && f.size) { await blobEkle(f.name, f); continue; } // diğer dosyalar yalnız buluta
          toast(_t('Desteklenmeyen dosya: {0}', f.name));
        } catch (e) { toast(e.message); }
      }
    };
    g.click();
  }

  // Sesten metne (tarayıcının konuşma tanıma özelliği; Android Chrome'da çalışır)
  let tanima = null;
  function dikte(btn, alan) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return toast(_t('Bu tarayıcı sesten metne çevirmeyi desteklemiyor. Klavyedeki mikrofonu kullanabilirsin.'), 4500);
    if (tanima) return dikteDur();
    tanima = new SR();
    tanima.lang = window.LOKAL || 'tr-TR'; tanima.continuous = true; tanima.interimResults = true;
    const bas = alan.value ? alan.value.replace(/\s*$/, ' ') : '';
    let kesin = '';
    tanima.onresult = (e) => {
      let ara = '';
      for (let i = e.resultIndex; i < e.results.length; i++) { const r = e.results[i]; if (r.isFinal) kesin += r[0].transcript + ' '; else ara += r[0].transcript; }
      alan.value = bas + kesin + ara; alan.dispatchEvent(new Event('input'));
    };
    tanima.onerror = (e) => { if (e.error === 'not-allowed') toast(_t('Mikrofon izni verilmedi')); };
    tanima.onend = () => { tanima = null; btn.classList.remove('aktif'); };
    tanima.start(); btn.classList.add('aktif'); toast(_t('Dinliyorum… bitince tekrar dokun'));
  }
  function dikteDur() { if (tanima) { try { tanima.stop(); } catch (e) { /* zaten durdu */ } } }

  // Sesli not (MediaRecorder)
  let sesKayit = null;
  function uygunTur(L) { return (window.MediaRecorder && L.find((t) => MediaRecorder.isTypeSupported(t))) || ''; }
  async function sesKaydi(btn) {
    if (sesKayit) return sesDur();
    if (!navigator.mediaDevices || !window.MediaRecorder) return toast(_t('Bu cihaz ses kaydını desteklemiyor'));
    let akis;
    try { akis = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e) { return toast(_t('Mikrofon izni verilmedi')); }
    const tur = uygunTur(['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm']);
    const r = new MediaRecorder(akis, tur ? { mimeType: tur, audioBitsPerSecond: 32000 } : { audioBitsPerSecond: 32000 });
    const parca = [], bas = Date.now(), etiket = btn.querySelector('span');
    const sayac = setInterval(() => { const s = Math.floor((Date.now() - bas) / 1000); etiket.innerHTML = `<span class="kayit-sayac">● ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}</span>`; if (s >= 600) sesDur(); }, 500);
    r.ondataavailable = (e) => { if (e.data.size) parca.push(e.data); };
    r.onstop = async () => {
      clearInterval(sayac); akis.getTracks().forEach((t) => t.stop()); btn.classList.remove('aktif'); etiket.textContent = _t('Sesli not');
      const b = new Blob(parca, { type: (r.mimeType || 'audio/webm').split(';')[0] });
      if (b.size) await blobEkle(_t('Sesli not') + '.' + (b.type.split('/')[1] || 'webm'), b);
      sesKayit = null;
    };
    r.start(1000); sesKayit = r; btn.classList.add('aktif');
  }
  function sesDur() { if (sesKayit && sesKayit.state !== 'inactive') sesKayit.stop(); }

  // Video: uygulama içinde düşük bit hızıyla (en çok 30 sn) — sunucu sınırına sığsın diye
  async function videoKaydi() {
    if (!navigator.mediaDevices || !window.MediaRecorder) return dosyaSec('video/*', 'environment');
    let akis;
    try { akis = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } }, audio: true }); }
    catch (e) { return dosyaSec('video/*', 'environment'); }
    const tur = uygunTur(['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']);
    const ekran = document.createElement('div'); ekran.className = 'video-kayit';
    ekran.innerHTML = `<video autoplay muted playsinline></video><div class="alt"><button class="dugme ikincil" data-vz>${kac(_t('Vazgeç'))}</button><button class="kayit-dugme" data-vk aria-label="${kac(_t('Kaydet'))}"></button><span class="kayit-sayac" data-vs>0:00 / ${sure(videoSn())}</span></div>`;
    document.body.appendChild(ekran);
    const v = ekran.querySelector('video'); v.srcObject = akis;
    let r = null, sayac = null, iptal = false;
    const kapat = () => { clearInterval(sayac); akis.getTracks().forEach((t) => t.stop()); ekran.remove(); };
    ekran.querySelector('[data-vz]').onclick = () => { iptal = true; if (r && r.state !== 'inactive') r.stop(); else kapat(); };
    ekran.querySelector('[data-vk]').onclick = (e) => {
      const b = e.currentTarget;
      if (r) { if (r.state !== 'inactive') r.stop(); return; }
      const parca = [], bas = Date.now();
      r = new MediaRecorder(akis, Object.assign(tur ? { mimeType: tur } : {}, { videoBitsPerSecond: bulutVar() ? 1500000 : 600000, audioBitsPerSecond: bulutVar() ? 64000 : 32000 }));
      r.ondataavailable = (x) => { if (x.data.size) parca.push(x.data); };
      r.onstop = async () => {
        kapat(); if (iptal) return;
        const bl = new Blob(parca, { type: (r.mimeType || 'video/webm').split(';')[0] });
        if (bl.size) await blobEkle(_t('Video') + '.' + (bl.type.split('/')[1] || 'webm'), bl);
      };
      r.start(1000); b.classList.add('duruyor');
      sayac = setInterval(() => { const s = Math.floor((Date.now() - bas) / 1000); ekran.querySelector('[data-vs]').textContent = `${sure(s)} / ${sure(videoSn())}`; if (s >= videoSn() && r.state !== 'inactive') r.stop(); }, 300);
    };
  }

  // Kayıt seçici
  function kayitSec(sec, notlarimSecenegi) {
    const p = document.createElement('div'); p.className = 'perde'; p.style.zIndex = 25;
    p.innerHTML = `<div class="sayfa secici"><h2>${kac(_t('Kayıt seç'))}<button data-kapat>×</button></h2>
      <input class="ara" type="search" placeholder="${kac(_t('Kod, başlık veya modül ara…'))}">
      ${notlarimSecenegi ? `<button class="hedef" data-notlarim>✎ <span>${kac(_t('Notlarım (kayıt seçmeden kaydet)'))}</span></button>` : ''}
      <div class="liste"></div></div>`;
    document.body.appendChild(p);
    const yaz = (q) => {
      const L = kayitSuz(q, 40).filter((k) => (modul(k.modulId) || {}).yaz);
      const l = $('.liste', p);
      l.innerHTML = L.length ? L.map((k) => kayitOge(k, 'data-sec')).join('') : `<div class="bos">${kac(_t('Kayıt bulunamadı'))}</div>`;
      l.querySelectorAll('[data-sec]').forEach((b) => { b.onclick = () => { const [tur, id] = b.dataset.sec.split(':'); p.remove(); sec(kayitBul(tur, id)); }; });
    };
    const a = $('.ara', p); a.oninput = () => yaz(a.value); yaz('');
    $('[data-kapat]', p).onclick = () => p.remove();
    const nb = $('[data-notlarim]', p); if (nb) nb.onclick = () => { p.remove(); sec(null); };
    setTimeout(() => a.focus(), 50);
  }

  // Başka uygulamadan "Paylaş" ile gelen metin
  function paylasimAl() {
    const q = new URLSearchParams(location.search);
    const m = [q.get('baslik'), q.get('metin'), q.get('adres')].filter(Boolean).join('\n');
    if (!m) return;
    history.replaceState(null, '', location.pathname + location.hash);
    taslak.metin = m; taslak.hedef = null; setTimeout(() => olusturucu(null), 100);
  }

  // ---------- web push ----------
  function pushDestek() { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; }
  async function pushDurum() {
    if (!pushDestek()) { D.push = 'yok'; return; }
    if (Notification.permission === 'denied') { D.push = 'red'; return; }
    try {
      const k = await navigator.serviceWorker.ready;
      const a = await k.pushManager.getSubscription();
      if (a && Notification.permission === 'granted') { D.push = 'acik'; aboneGonder(a).catch(() => {}); return; }
    } catch (e) { /* desteklenmiyor */ }
    D.push = 'sor'; if (!D.kayit) ciz();
  }
  const b64 = (s) => { const p = '='.repeat((4 - (s.length % 4)) % 4); const r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...r].map((c) => c.charCodeAt(0))); };
  async function aboneGonder(a) { const j = a.toJSON(); await api('/push/abone', { method: 'POST', govde: { endpoint: j.endpoint, keys: j.keys } }); }
  async function pushAc() {
    try {
      const izin = await Notification.requestPermission();
      if (izin !== 'granted') { D.push = 'red'; toast(_t('Bildirim izni verilmedi')); return ciz(); }
      const { anahtar } = await api('/push/anahtar');
      const k = await navigator.serviceWorker.ready;
      let a = await k.pushManager.getSubscription();
      if (!a) a = await k.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(anahtar) });
      await aboneGonder(a);
      D.push = 'acik'; toast(_t('Bildirimler açıldı')); ciz();
    } catch (e) { toast(_t('Bildirim açılamadı: {0}', e.message), 4500); }
  }

  basla();
})();
