"""Çeviri parçalarını (ceviri/NNN.json: [[en,de,es],…], anahtarlar.json sırasıyla) public/dil/{en,de,es}.js'e yazar.
Yer tutucu ({0}…) ve HTML etiket sayısı tutmayan çevirileri bildirir."""
import json, re, sys, glob, os
kok = sys.argv[1]  # çeviri klasörü (anahtarlar.json ve ceviri/)
cikti = sys.argv[2]  # public/dil
A = json.load(open(os.path.join(kok, 'anahtarlar.json'), encoding='utf-8'))
T = {}
for f in sorted(glob.glob(os.path.join(kok, 'ceviri', '*.json')), key=lambda x: int(os.path.basename(x).split('.')[0])):
    bas = int(os.path.basename(f).split('.')[0]); L = json.load(open(f, encoding='utf-8'))
    for i, u in enumerate(L): T[bas + i] = u
eksik = [i for i in range(len(A)) if i not in T]
fazla = [i for i in T if i >= len(A)]
sorun = []
yer = lambda s: sorted(re.findall(r'\{\d+\}', s))
etiket = lambda s: sorted(re.findall(r'</?[a-z]+', s))
for i, k in enumerate(A):
    if i not in T: continue
    for d, v in zip(('en', 'de', 'es'), T[i]):
        if yer(v) != yer(k): sorun.append((i, d, 'yer tutucu', k[:50], v[:50]))
        if etiket(v) != etiket(k): sorun.append((i, d, 'etiket', k[:50], v[:50]))
        if k[:1] == ' ' and v[:1] != ' ' or k[-1:] == ' ' and v[-1:] != ' ': sorun.append((i, d, 'boşluk', repr(k[:30]), repr(v[:30])))
# sonradan eklenen anahtarlar: ek.json {anahtar: [en, de, es]}
EK = json.load(open(os.path.join(kok, 'ek.json'), encoding='utf-8')) if os.path.exists(os.path.join(kok, 'ek.json')) else {}
for k, v in EK.items():
    for d, x in zip(('en', 'de', 'es'), v):
        if yer(x) != yer(k): sorun.append(('ek', d, 'yer tutucu', k[:50], x[:50]))
for j, d in enumerate(('en', 'de', 'es')):
    S = {k: T[i][j] for i, k in enumerate(A) if i in T}
    S.update({k: v[j] for k, v in EK.items()})
    open(os.path.join(cikti, d + '.js'), 'w', encoding='utf-8').write('// Otomatik üretilir: scripts/i18n/sozluk_yaz.py — Türkçe kaynak metin → ' + d + '\nwindow.SOZLUK=' + json.dumps(S, ensure_ascii=False, indent=0) + ';\n')
print('anahtar', len(A), 'çeviri', len(T), 'eksik', eksik[:20], len(eksik), 'fazla', fazla[:5])
for s in sorun[:40]: print(s)
print('sorun', len(sorun))
