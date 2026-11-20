"""Arayüz metinlerini t() ile sarar.

Kullanım:  python3 scripts/i18n/sar.py public/index.html [--yaz] [--rapor dosya.json]

Kurallar (veri değerlerine dokunmamak için bilerek dar):
  * HTML şablonlarında (`...<etiket>...`) etiketler arasındaki görünen metin ve
    placeholder / title / aria-label / alt / data-ph öznitelikleri → ${t('…', …)}
    Metnin içindeki ${ifade}'ler {0}, {1}… yer tutucusu olur, ifadeler argüman olarak geçer.
    Baştaki/sondaki ${ikon} gibi ifadeler ve boşluklar çevirinin dışında kalır.
  * Düz (HTML olmayan) şablonlar ve '…' / "…" dizeleri SARILMAZ; ayrıca raporlanır.
  * Zaten t( ile başlayan çağrıların içi işlenmez.
"""
import json, re, sys

HARF = re.compile(r'[A-Za-zÇĞİÖŞÜçğıöşüÂâÎîÛû]{2,}')
TR = re.compile(r'[çğıöşüÇĞİÖŞÜ]')
KOD_GIBI = re.compile(r'^(?:[#.]?[\w-]+:|https?:|mailto:|[\w.-]+\.(?:png|jpe?g|svg|pdf|html|js|css)$)')
CEVRILEN_OZ = ('placeholder', 'title', 'aria-label', 'alt', 'data-ph')
ONCEKI_REGEX = set('(,=:[!&|?{};+-*%<>~^')
ANAHTAR_REGEX = {'return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'yield', 'await'}
MARK = '\x00'
FN_ETIKET = {'bas': [0], 'kv': [0], 'kpi': [0, 2], 'tg': [2], 'sl': [1, 3], 'n': [1], 'cb': [1],
             'bosEkran': [1, 2], 'kisiSecici': [0], 'liste': [1], 'kart': [0]}   # etiket argümanları
VERI_DEGER = {'Giriş', 'Çıkış', 'Transfer', 'Türkiye'}               # saklanan değerler: asla sarılmaz
MESAJ_CAGRI = {'toast', 'confirm', 'alert', 'prompt', 'girisGoster'}   # 1. argüman kullanıcıya gösterilen mesaj
BOS_SECENEK = {'secOp', 'secGrup'}                                       # 3. argüman boş seçenek etiketi


def cevrilebilir(m):
    """Doğal dil metni mi? (veri anahtarı / kod / sembol değil)"""
    s = re.sub(MARK + r'\d+' + MARK, '', m).strip()
    if not HARF.search(s) or KOD_GIBI.match(s):
        return False
    if s.startswith('&') and s.endswith(';') and ' ' not in s:  # &nbsp; vb.
        return False
    return bool(TR.search(s) or ' ' in s or re.match(r'[A-ZÇĞİÖŞÜ]', s))


def pisir(ham):
    """Şablon ham metnindeki kaçışları gerçek karaktere çevirir (\\' → ', \\` → `, \\n → satır sonu…)"""
    def f(m):
        x = m.group(1)
        if x == 'n': return '\n'
        if x == 't': return '\t'
        if x == '\n': return ''
        if x.startswith('u{'): return chr(int(x[2:-1], 16))
        if x[0] == 'u' and len(x) == 5: return chr(int(x[1:], 16))
        if x[0] == 'x' and len(x) == 3: return chr(int(x[1:], 16))
        return x
    return re.sub(r'\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)', f, ham, flags=re.S)


SATIR_ICI = {'b', 'strong', 'i', 'em', 'u', 's', 'code', 'small', 'kbd', 'sub', 'sup', 'br', 'mark'}


class Cozucu:
    def __init__(self, src):
        self.s, self.n = src, len(src)
        self.rapor_duz = []   # (satır, metin) — sarılmamış Türkçe düz dizeler
        self.sayac = 0
        self.html_ifade = False

    def satir(self, i):
        return self.s.count('\n', 0, i) + 1

    # ---- yardımcı: i'deki dize/şablon/regex/yorumun sonunu bul ----
    def dize_sonu(self, i):
        q = self.s[i]; j = i + 1
        while j < self.n:
            c = self.s[j]
            if c == '\\': j += 2; continue
            if c == q: return j + 1
            if c == '\n' and q != '`': raise ValueError(f'dize kapanmadı satır {self.satir(i)}')
            j += 1
        raise ValueError('dize sonu yok')

    def regex_sonu(self, i):
        j = i + 1; sinif = False
        while j < self.n:
            c = self.s[j]
            if c == '\\': j += 2; continue
            if c == '[': sinif = True
            elif c == ']': sinif = False
            elif c == '/' and not sinif:
                j += 1
                while j < self.n and self.s[j].isalpha(): j += 1
                return j
            elif c == '\n': raise ValueError(f'regex kapanmadı satır {self.satir(i)}')
            j += 1
        raise ValueError('regex sonu yok')

    def sablon_parcala(self, i):
        """`…` → ([quasi metinleri], [(ifade_bas, ifade_son)], son)"""
        assert self.s[i] == '`'
        j = i + 1; qs, ex = [], []; bas = j
        while j < self.n:
            c = self.s[j]
            if c == '\\': j += 2; continue
            if c == '`':
                qs.append(self.s[bas:j]); return qs, ex, j + 1
            if c == '$' and j + 1 < self.n and self.s[j + 1] == '{':
                qs.append(self.s[bas:j])
                e0 = j + 2; e1 = self.kod_sonu(e0, '}')
                ex.append((e0, e1)); j = e1 + 1; bas = j; continue
            j += 1
        raise ValueError('şablon kapanmadı')

    def kod_sonu(self, i, kapa):
        """i'den başlayan kodda eşleşen kapanış parantezinin konumu"""
        derinlik = 0; j = i; onceki = '('
        while j < self.n:
            c = self.s[j]
            if c in '\'"': j = self.dize_sonu(j); onceki = 'x'; continue
            if c == '`': j = self.sablon_parcala(j)[2]; onceki = 'x'; continue
            if c == '/' and self.s[j:j + 2] == '//': j = self.s.index('\n', j); continue
            if c == '/' and self.s[j:j + 2] == '/*': j = self.s.index('*/', j) + 2; continue
            if c == '/' and self.regex_mi(onceki): j = self.regex_sonu(j); onceki = 'x'; continue
            if c in '({[': derinlik += 1
            elif c in ')}]':
                if derinlik == 0 and c == kapa: return j
                derinlik -= 1
            if not c.isspace():
                onceki = self.kelime_bas(j) if (c.isalnum() or c in '_$') else c
                if c.isalnum() or c in '_$':
                    while j + 1 < self.n and (self.s[j + 1].isalnum() or self.s[j + 1] in '_$'): j += 1
            j += 1
        raise ValueError('kapanış yok')

    def kelime_bas(self, j):
        k = j
        while k < self.n and (self.s[k].isalnum() or self.s[k] in '_$'): k += 1
        w = self.s[j:k]
        return 'KW:' + w if w in ANAHTAR_REGEX else 'x'

    @staticmethod
    def regex_mi(onceki):
        return onceki in ONCEKI_REGEX or onceki.startswith('KW:')

    # ---- dönüştürme ----
    def donustur(self, i, son):
        """[i, son) kod aralığını dönüştürüp metin döndürür"""
        out = []; j = i; onceki = '('
        while j < son:
            c = self.s[j]
            if c in '\'"':
                k = self.dize_sonu(j); ham = self.s[j:k]
                if re.search(r'<[a-zA-Z/]', ham) and TR.search(ham):
                    out.append(self.html_dize(ham)); j = k; onceki = 'x'; continue   # R5
                if self.html_ifade and TR.search(ham) and self.gosterim_mi(j, k, ''.join(out)):
                    d = self.dize_degeri(ham)
                    if cevrilebilir(d) and d not in VERI_DEGER:
                        out.append('_t(' + self.js_dize(d) + ')'); self.sayac += 1; j = k; onceki = 'x'; continue   # R3
                if TR.search(ham): self.rapor_duz.append((self.satir(j), ham[:160]))
                out.append(ham); j = k; onceki = 'x'; continue
            if c == '`':
                qs, ex, k = self.sablon_parcala(j)
                out.append(self.sablon(qs, ex, j)); j = k; onceki = 'x'; continue
            if c == '[':
                m = re.match(r"\[\s*'([a-z0-9][A-Za-z0-9_.\-]*|)'\s*,\s*('(?:[^'\\\n]|\\.)*')\s*([,\]])", self.s[j:son])
                if m and cevrilebilir(self.dize_degeri(m.group(2))) and self.dize_degeri(m.group(2)) not in VERI_DEGER:
                    a_, b_ = j + m.start(2), j + m.end(2)
                    out.append(self.s[j:a_] + '_t(' + m.group(2) + ')'); self.sayac += 1
                    j = b_; onceki = 'x'; continue
            if c == '/' and self.s[j:j + 2] == '//':
                k = self.s.index('\n', j); out.append(self.s[j:k]); j = k; continue
            if c == '/' and self.s[j:j + 2] == '/*':
                k = self.s.index('*/', j) + 2; out.append(self.s[j:k]); j = k; continue
            if c == '/' and self.regex_mi(onceki):
                k = self.regex_sonu(j); out.append(self.s[j:k]); j = k; onceki = 'x'; continue
            if c.isalnum() or c in '_$':
                k = j
                while k < son and (self.s[k].isalnum() or self.s[k] in '_$'): k += 1
                w = self.s[j:k]; out.append(w)
                onceki = 'KW:' + w if w in ANAHTAR_REGEX else 'x'
                # t( çağrısının içi olduğu gibi kalsın (zaten sarılmış)
                bagimsiz = j == 0 or not (self.s[j - 1].isalnum() or self.s[j - 1] in '_$.')
                if w == '_t' and self.s[k:k + 1] == '(' and bagimsiz:
                    kk = self.kod_sonu(k + 1, ')'); out.append(self.s[k:kk + 1]); j = kk + 1; onceki = 'x'; continue
                # R1: mesaj çağrıları (toast, confirm, … ve Error)
                if self.s[k:k + 1] == '(' and (w in MESAJ_CAGRI and bagimsiz or w == 'Error'):
                    kk = self.kod_sonu(k + 1, ')')
                    argl = self.arg_bol(k + 1, kk)
                    if argl:
                        a0 = self.mesaj_ifade(*argl[0])
                        out.append('(' + a0 + ''.join(',' + self.donustur(a, b) for a, b in argl[1:]) + ')')
                        j = kk + 1; onceki = 'x'; continue
                # R6: etiket argümanı alan yardımcılar
                if self.s[k:k + 1] == '(' and w in FN_ETIKET and bagimsiz:
                    kk = self.kod_sonu(k + 1, ')')
                    argl = self.arg_bol(k + 1, kk)
                    parcalar = []
                    for n_, (a_, b_) in enumerate(argl):
                        ham = self.s[a_:b_].strip()
                        if n_ in FN_ETIKET[w] and re.fullmatch(r"'(?:[^'\\\n]|\\.)*'", ham) and cevrilebilir(self.dize_degeri(ham)):
                            self.sayac += 1; parcalar.append(self.s[a_:b_].replace(ham, '_t(' + ham + ')', 1))
                        else: parcalar.append(self.donustur(a_, b_))
                    out.append('(' + ','.join(parcalar) + ')'); j = kk + 1; onceki = 'x'; continue
                # R2: secOp/secGrup boş seçenek etiketi
                if self.s[k:k + 1] == '(' and w in BOS_SECENEK and bagimsiz:
                    kk = self.kod_sonu(k + 1, ')')
                    argl = self.arg_bol(k + 1, kk)
                    if len(argl) >= 3:
                        parcalar = [self.donustur(a, b) for a, b in argl]
                        parcalar[2] = self.dizeleri_sar(*argl[2])
                        out.append('(' + ','.join(parcalar) + ')'); j = kk + 1; onceki = 'x'; continue
                j = k; continue
            out.append(c)
            if not c.isspace(): onceki = c
            j += 1
        return ''.join(out)

    def gosterim_mi(self, j, k, onceki_cikti):
        """HTML şablon ifadesindeki dize gösterim amaçlı mı (karşılaştırma/anahtar/case değil)"""
        geri = onceki_cikti.rstrip()
        if re.search(r'(===|!==|==|!=|\bcase|\[)$', geri): return False
        ileri = self.s[k:k + 6].lstrip()
        if re.match(r'(===|!==|==|!=|:(?!\s*[\'"`(]))', ileri) and not re.search(r'\?$', geri): return False
        if ileri.startswith(']') : return False
        return True

    def ust_duzey_bol(self, a, b, ayrac):
        """[a,b) kodunu üst düzeydeki ayraçlardan böler (parantez/dize/şablon/regex içi hariç)"""
        parca = []; bas = a; j = a; derinlik = 0; onceki = '('
        while j < b:
            c = self.s[j]
            if c in '\'"': j = self.dize_sonu(j); onceki = 'x'; continue
            if c == '`': j = self.sablon_parcala(j)[2]; onceki = 'x'; continue
            if c == '/' and self.s[j:j + 2] == '//': j = self.s.index('\n', j); continue
            if c == '/' and self.s[j:j + 2] == '/*': j = self.s.index('*/', j) + 2; continue
            if c == '/' and self.regex_mi(onceki): j = self.regex_sonu(j); onceki = 'x'; continue
            if c in '({[': derinlik += 1
            elif c in ')}]': derinlik -= 1
            elif derinlik == 0 and c in ayrac:
                parca.append((bas, j)); bas = j + 1
            if not c.isspace(): onceki = 'x' if (c.isalnum() or c in '_$') else c
            j += 1
        parca.append((bas, b))
        return parca

    def arg_bol(self, a, b):
        if not self.s[a:b].strip(): return []
        return self.ust_duzey_bol(a, b, ',')

    def dize_degeri(self, ham):
        """'…' ya da "…" kaynağının gerçek değeri"""
        return pisir(ham[1:-1])

    @staticmethod
    def js_dize(deger):
        return "'" + deger.replace('\\', '\\\\').replace("'", "\\'").replace('\n', '\\n') + "'"

    def dizeleri_sar(self, a, b):
        """Aralıktaki çevrilebilir dize sabitlerini t('…') ile sarar (üçlü/|| dalları dahil)"""
        out = []; j = a
        while j < b:
            c = self.s[j]
            if c in '\'"':
                k = self.dize_sonu(j); ham = self.s[j:k]; d = self.dize_degeri(ham)
                if cevrilebilir(d): out.append('_t(' + self.js_dize(d) + ')'); self.sayac += 1
                else: out.append(ham)
                j = k; continue
            if c == '`':
                qs, ex, k = self.sablon_parcala(j); out.append(self.sablon(qs, ex, j)); j = k; continue
            out.append(c); j += 1
        return ''.join(out)

    def mesaj_ifade(self, a, b):
        """Mesaj argümanı: 'a'+x+'b' birleştirmesi → t('a{0}b', x); karmaşıksa dizeler tek tek sarılır"""
        terimler = self.ust_duzey_bol(a, b, '+')
        if len(terimler) == 1 or any(self.ust_duzey_bol(x, y, '?') [1:] for x, y in terimler):
            # tek terim ya da üst düzeyde üçlü ifade var
            if len(terimler) == 1:
                x, y = terimler[0]; ham = self.s[x:y].strip()
                if re.fullmatch(r"'(?:[^'\\\n]|\\.)*'|\"(?:[^\"\\\n]|\\.)*\"", ham):
                    d = self.dize_degeri(ham)
                    if cevrilebilir(d): self.sayac += 1; return self.s[a:x] + '_t(' + self.js_dize(d) + ')' + self.s[y:b]
                    return self.s[a:b]
            return self.dizeleri_sar(a, b)
        anahtar = ''; argl = []; cevrilir = False
        for x, y in terimler:
            ham = self.s[x:y].strip()
            if re.fullmatch(r"'(?:[^'\\\n]|\\.)*'|\"(?:[^\"\\\n]|\\.)*\"", ham):
                d = self.dize_degeri(ham); anahtar += d.replace('{', '{{').replace('}', '}}') if False else d
                if cevrilebilir(d): cevrilir = True
            else:
                argl.append(self.donustur(x, y).strip()); anahtar += '{' + str(len(argl) - 1) + '}'
        if not cevrilir: return self.donustur(a, b)
        self.sayac += 1
        return '_t(' + self.js_dize(anahtar) + ''.join(', ' + x for x in argl) + ')'

    def html_dize(self, ham):
        """İçinde HTML olan düz dize → çevrilmiş şablon (ifade yok)"""
        d = self.dize_degeri(ham)
        ifadeler = []
        yeni = self.html_isle(d.replace('`', '\\`').replace('${', '\\${'), ifadeler)
        if not ifadeler: return ham
        return '`' + re.sub(MARK + r'(\d+)' + MARK, lambda m: '${' + ifadeler[int(m.group(1))] + '}', yeni) + '`'

    def sablon(self, qs, ex, bas):
        html = re.search(r'<[a-zA-Z/!]', ''.join(qs)) is not None
        eski = self.html_ifade; self.html_ifade = html or eski
        ifadeler = [self.donustur(a, b) for a, b in ex]
        self.html_ifade = eski
        birlesik = ''.join(q + (MARK + str(n) + MARK if n < len(ifadeler) else '') for n, q in enumerate(qs))
        if html:
            yeni = self.html_isle(birlesik, ifadeler)
        else:
            if TR.search(''.join(qs)): self.rapor_duz.append((self.satir(bas), ('`' + birlesik.replace(MARK, '§') + '`')[:160]))
            yeni = birlesik
        # yer tutucuları geri ifadeye çevir
        return '`' + re.sub(MARK + r'(\d+)' + MARK, lambda m: '${' + ifadeler[int(m.group(1))] + '}', yeni) + '`'

    def mesaj(self, metin, ifadeler):
        """'Merhaba §0§ dünya' → ${t('Merhaba {0} dünya', ifade)} (baş/son ifadeler dışarıda)"""
        m = re.match(r'^(\s*(?:' + MARK + r'\d+' + MARK + r'\s*)*)(.*?)(\s*(?:' + MARK + r'\d+' + MARK + r'\s*)*)$', metin, re.S)
        on, govde, arka = m.group(1), m.group(2), m.group(3)
        if not cevrilebilir(govde): return metin
        argl = []
        def yer(mm):
            argl.append(ifadeler[int(mm.group(1))]); return '{' + str(len(argl) - 1) + '}'
        anahtar = pisir(re.sub(MARK + r'(\d+)' + MARK, yer, govde))
        anahtar_js = anahtar.replace('\\', '\\\\').replace("'", "\\'").replace('\n', '\\n')
        self.sayac += 1
        cagri = "_t('" + anahtar_js + "'" + ''.join(', ' + a for a in argl) + ')'
        # cagri yeni bir ifade olarak eklenecek: geçici işaretle
        ifadeler.append(cagri)
        return on + MARK + str(len(ifadeler) - 1) + MARK + arka

    def html_isle(self, h, ifadeler):
        # Parçalar: ('etiket', metin, ad) | ('metin', metin)
        parca = []; i = 0; n = len(h)
        while i < n:
            if h[i] == '<':
                k = self.etiket_sonu(h, i); e = h[i:k]
                m = re.match(r'</?\s*([a-zA-Z0-9-]+)', e)
                parca.append(('etiket', e, m.group(1).lower() if m else '')); i = k; continue
            k = h.find('<', i); k = n if k < 0 else k
            parca.append(('metin', h[i:k])); i = k
        out = []; tampon = []; atla = None

        def bosalt():
            if not tampon: return
            satir_ici = any(p[0] == 'etiket' for p in tampon)
            metinler = [p[1] for p in tampon if p[0] == 'metin' and cevrilebilir(p[1])]
            if satir_ici and metinler:
                # cümle bütün çevrilir; satır içi etiketler (öznitelikleri işlenmiş halde) anahtarın içinde kalır
                birlesik = ''.join(p[1] if p[0] == 'metin' else self.oznitelik_isle(p[1], ifadeler) for p in tampon)
                out.append(self.mesaj(birlesik, ifadeler))
            else:
                for p in tampon:
                    out.append(self.mesaj(p[1], ifadeler) if p[0] == 'metin' else self.oznitelik_isle(p[1], ifadeler))
            tampon.clear()

        for p in parca:
            if atla:
                out.append(p[1])
                if p[0] == 'etiket' and p[1].lower().startswith('</' + atla): atla = None
                continue
            if p[0] == 'etiket' and p[2] in ('style', 'script') and not p[1].startswith('</'):
                bosalt(); atla = p[2]; out.append(p[1]); continue
            if p[0] == 'metin' or p[2] in SATIR_ICI:
                tampon.append(p); continue
            bosalt(); out.append(self.oznitelik_isle(p[1], ifadeler))
        bosalt()
        return ''.join(out)

    @staticmethod
    def etiket_sonu(h, i):
        j = i + 1; q = None
        while j < len(h):
            c = h[j]
            if q:
                if c == q: q = None
            elif c in '"\'': q = c
            elif c == '>': return j + 1
            j += 1
        return len(h)

    def oznitelik_isle(self, etiket, ifadeler):
        def degis(m):
            ad, tirnak, deger = m.group(1), m.group(2), m.group(3)
            if ad.lower() not in CEVRILEN_OZ: return m.group(0)
            return f'{ad}={tirnak}{self.mesaj(deger, ifadeler)}{tirnak}'
        return re.sub(r'([a-zA-Z-]+)=(["\'])(.*?)\2', degis, etiket, flags=re.S)


def ana():
    yol = sys.argv[1]; yaz = '--yaz' in sys.argv
    rapor = sys.argv[sys.argv.index('--rapor') + 1] if '--rapor' in sys.argv else None
    s = open(yol, encoding='utf-8').read()
    m = list(re.finditer(r'<script>(.*?)</script>', s, re.S))[-1]
    c = Cozucu(s)
    # /*i18n-yok…*/ … /*i18n-var*/ arası (varsayılan veri) dokunulmadan kalır
    parcalar, j = [], m.start(1)
    for y in re.finditer(r'/\*i18n-yok[^*]*\*/(.*?)/\*i18n-var\*/', s[m.start(1):m.end(1)], re.S):
        a0, a1 = m.start(1) + y.start(), m.start(1) + y.end()
        parcalar.append(c.donustur(j, a0)); parcalar.append(s[a0:a1]); j = a1
    parcalar.append(c.donustur(j, m.end(1)))
    yeni_js = ''.join(parcalar)
    sonuc = s[:m.start(1)] + yeni_js + s[m.end(1):]
    anahtarlar = sorted(set(re.findall(r"\b_t\('((?:[^'\\]|\\.)*)'", yeni_js)))
    print(f'sarılan: {c.sayac}, benzersiz anahtar: {len(anahtarlar)}, sarılmamış Türkçe düz dize: {len(c.rapor_duz)}')
    if rapor:
        json.dump({'anahtarlar': anahtarlar, 'duz': c.rapor_duz}, open(rapor, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    if yaz:
        open(yol, 'w', encoding='utf-8').write(sonuc)


if __name__ == '__main__':
    ana()
