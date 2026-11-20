// Arayüz dili: önce kullanıcının seçimi (yerel), yoksa tarayıcı dili; desteklenmeyen dil → Türkçe.
// Türkçe kaynak metin anahtardır: t('Kaydet') → seçili dildeki karşılığı (yoksa Türkçe kalır).
// {0}, {1}… yer tutucuları argümanlarla doldurulur. Kullanıcı adları ve tanımlar (modül, alan, durum) çevrilmez.
(function () {
  var DESTEK = ['tr', 'en', 'de', 'es'];
  var d = '';
  try { d = localStorage.getItem('yerp-dil') || ''; } catch (e) { /* gizli kip */ }
  if (DESTEK.indexOf(d) < 0) {
    var tarayici = (navigator.languages && navigator.languages[0]) || navigator.language || 'tr';
    d = String(tarayici).slice(0, 2).toLowerCase();
    if (DESTEK.indexOf(d) < 0) d = 'tr';
  }
  window.DIL = d;
  window.DILLER = [['tr', 'Türkçe'], ['en', 'English'], ['de', 'Deutsch'], ['es', 'Español']];
  window.LOKAL = { tr: 'tr-TR', en: 'en-GB', de: 'de-DE', es: 'es-ES' }[d];
  window.SOZLUK = window.SOZLUK || {};
  document.documentElement.lang = d;
  window._t = function (m) {
    // 'Pano¦görünüm' gibi bağlamlı anahtar: Türkçede ¦ öncesi gösterilir
    var s = (d !== 'tr' && Object.prototype.hasOwnProperty.call(window.SOZLUK, m)) ? window.SOZLUK[m] : String(m).split('\u00a6')[0];
    if (arguments.length < 2) return s;
    var a = arguments;
    return String(s).replace(/\{(\d+)\}/g, function (x, i) { var v = a[+i + 1]; return v == null ? '' : v; });
  };
  if (d !== 'tr') document.write('<script src="' + (window.DIL_YOL || 'dil/') + d + '.js"><\/script>');
})();
