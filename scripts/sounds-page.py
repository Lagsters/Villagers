"""
Strona odsluchu dzwiekow z wyniku scripts/sounds.ts: odtwarzacze wariantow (mp3 wbudowane w strone) i zaznaczanie
wariantow do gry. Publikuje ja Claude jako artefakt z baza (capabilities {"db": {}}): zaznaczenia trafiaja do
kolekcji "picks" (dokument na dzwiek, pole seeds), skad Claude przepisuje je do PICKS w client/sfx.ts.
  python scripts/sounds-page.py <katalog z sounds.ts>
Wynik: <katalog>/index.html
"""
import base64
import json
import os
import sys

here = os.path.dirname(os.path.abspath(__file__))
d = sys.argv[1]
res = json.load(open(os.path.join(d, 'sounds.json')))

LABELS = {
    'pig_grunt': ('Świnia — chrząkanie', 'przy korycie często, na wybiegu z rzadka'),
    'pig_squeal': ('Świnia — kwik', 'gdy biegnie do koryta'),
    'donkey_bray': ('Osioł — ryk', 'w hodowli między okrążeniami, na drodze z rzadka'),
    'deer_snort': ('Jeleń — prychnięcie', 'gdy myśliwy podchodzi'),
    'bird': ('Ptak', 'tło nad lasem i trawą'),
    'cricket': ('Świerszcz', 'tło na łąkach'),
    'shout': ('Rycerz — okrzyk', 'na początku pojedynku'),
    'death': ('Rycerz — upadek', 'gdy rycerz ginie'),
    'chop': ('Siekiera w pień', 'drwal'), 'wood_crack': ('Trzask pnia', 'drzewo zaczyna padać'),
    'tree_land': ('Drzewo o ziemię', 'koniec upadku'), 'hammer_wood': ('Młotek w drewno', 'budowniczy, szkutnik, geolog'),
    'anvil': ('Kowadło', 'kowal narzędzi, płatnerz'), 'pick_stone': ('Kilof w skałę', 'kamieniarz, geolog'),
    'chisel': ('Dłuto', 'kamieniarz przy stole, budowniczy'), 'shovel': ('Łopata', 'leśnik'),
    'dirt': ('Ziemia', 'rzut ziemi, sadzenie'), 'cleaver': ('Tasak', 'rzeźnik'), 'stamp': ('Stempel', 'mincerz'),
    'coins': ('Monety', ''), 'drop_wood': ('Odłożenie: drewno', 'tragarz'), 'drop_stone': ('Odłożenie: kamień', 'tragarz'),
    'drop_metal': ('Odłożenie: metal', 'tragarz'), 'drop_sack': ('Odłożenie: worek', 'tragarz'),
    'slap': ('Klepnięcie ciasta', 'piekarz, smolarz'), 'saw': ('Piła', 'tartak'), 'swish': ('Świst', 'kosa, worek'),
    'scatter': ('Sianie ziarna', 'rolnik'), 'bow': ('Cięciwa', 'myśliwy'), 'arrow_hit': ('Trafienie strzałą', 'myśliwy'),
    'splash': ('Plusk', 'studnia, ryba'), 'splash_small': ('Mały plusk', 'spławik, wiosła'), 'hiss': ('Syk pary', 'hartowanie'),
    'crackle': ('Trzask ognia', 'pożar'), 'bellows': ('Miech', ''), 'creak': ('Skrzypienie', 'wiatrak, kołowrót'),
    'roll': ('Toczenie', ''), 'catapult': ('Katapulta — strzał', ''), 'impact': ('Katapulta — trafienie', ''),
    'clash': ('Miecz o tarczę', 'pojedynek'), 'shield': ('Tarcza', ''), 'hoof': ('Kopyta', 'osioł'),
    'wind': ('Wiatr', 'zawsze, z góry głośniej'), 'leaves': ('Liście', 'las w kadrze'), 'sea': ('Morze', 'brzeg w kadrze'),
    'lake': ('Jezioro', 'woda w kadrze'), 'fire': ('Ogień', 'piec, kuźnia, mielerz, pożar'), 'pour': ('Lanie wody', 'studnia, koryto'),
    'bubbles': ('Bulgotanie', 'browar'), 'rubble': ('Urobek', 'kopalnia'), 'murmur': ('Gwar osady', 'dużo ludzi w kadrze'),
}
VOICES = ['pig_grunt', 'pig_squeal', 'donkey_bray', 'deer_snort', 'bird', 'cricket', 'shout', 'death']

items = []
for e in res:
    n = e['name']
    group = 'voice' if n in VOICES else 'loop' if e['loop'] else 'work'
    label, desc = LABELS.get(n, (n, ''))
    vs = []
    for s in e['picks']:
        b = base64.b64encode(open(os.path.join(d, f'{n}_{s}.mp3'), 'rb').read()).decode()
        f = e['feats'].get(str(s), {})
        vs.append({'seed': s, 'src': 'data:audio/mpeg;base64,' + b,
                   'dur': round(f.get('dur', 0), 2), 'f0': round(f.get('f0', 0)), 'cent': round(f.get('cent', 0)), 'score': f.get('s', 0)})
    items.append({'name': n, 'label': label, 'desc': desc, 'group': group, 'kept': e.get('kept', []), 'variants': vs})
order = {'voice': 0, 'work': 1, 'loop': 2}
items.sort(key=lambda x: (order[x['group']], VOICES.index(x['name']) if x['name'] in VOICES else 0))

tpl = open(os.path.join(here, 'sounds-page.html'), encoding='utf-8').read()
html = tpl.replace('/*DATA*/[]', json.dumps(items, ensure_ascii=False))
open(os.path.join(d, 'index.html'), 'w', encoding='utf-8').write(html)
print(len(html) // 1024, 'KB')
