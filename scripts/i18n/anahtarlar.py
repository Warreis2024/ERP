"""index.html içindeki _t('…') anahtarlarını (JS kaçışları çözülmüş) ve varsayılan pano/bileşen adlarını listeler.
Kullanım: python3 scripts/i18n/anahtarlar.py public/index.html > anahtarlar.json"""
import json, re, sys
s = open(sys.argv[1], encoding='utf-8').read()
def coz(ham):
    return json.loads('"' + ham.replace('"', '\\"').replace("\\'", "'").replace('\\`', '`').replace('\\$', '$') + '"')
A = set()
for m in re.finditer(r"(?<![\w.$])_t\('((?:[^'\\\n]|\\.)*)'", s):
    A.add(coz(m.group(1)))
# varsayılan panolar: pano adı ve b('tip','Ad',…)
v = re.search(r'function varsayilanPanolar\(\)\{(.*?)\n\}', s, re.S)
if v:
    for m in re.finditer(r"\bad:'([^']+)'", v.group(1)): A.add(m.group(1))
    for m in re.finditer(r"\bb\('\w+','([^']+)'", v.group(1)): A.add(m.group(1))
print(json.dumps(sorted(A), ensure_ascii=False, indent=0))
