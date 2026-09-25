"""Obrazek stanu mapy z ai/trace.ts (DUMP=plik.json): teren, terytoria, drogi, budynki, zamki."""
import json
import sys
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
d = json.load(open(src))
w, h, S = d['w'], d['h'], 8
im = Image.new('RGB', (w * S + S // 2, h * S), (0, 0, 0))
tc = {0: (40, 90, 140), 1: (90, 140, 70), 2: (210, 190, 120), 3: (120, 110, 100), 4: (240, 240, 240)}
oc = {1: (60, 110, 230), 2: (220, 60, 50), 3: (230, 200, 40), 4: (60, 170, 80)}
px = im.load()
for y in range(h):
    for x in range(w):
        i = y * w + x
        c = tc[d['terrain'][i]]
        o = d['owner'][i]
        if o:
            c = tuple(int(c[k] * 0.45 + oc[o][k] * 0.55) for k in range(3))
        if d['roads'][i]:
            c = (230, 200, 150)
        if d['obj'][i] in (20, 21):
            c = (0, 0, 0)
        if d['obj'][i] == 5:
            c = (30, 70, 30)
        ox = x * S + (S // 2 if y % 2 else 0)
        for dy in range(S):
            for dx in range(S):
                px[ox + dx, y * S + dy] = c
for c in d['castles']:
    if c < 0:
        continue
    x, y = c % w, c // w
    ox = x * S + (S // 2 if y % 2 else 0)
    for dy in range(-6, 7):
        for dx in range(-6, 7):
            px[min(w * S, max(0, ox + dx + S // 2)), min(h * S - 1, max(0, y * S + dy + S // 2))] = (255, 255, 0)
im.save(out)
