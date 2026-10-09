"""
Arkusz klatek z scripts/capture.ts: wycina srodek kazdej klatki i sklada je w siatke (do szybkiego ogladania).
  python scripts/sheet.py <katalog> [szerokosc_wycinka] [wysokosc_wycinka] [kolumny]
Wynik: <katalog>/sheet.png
"""
import glob
import os
import sys

from PIL import Image

d = sys.argv[1]
cw = int(sys.argv[2]) if len(sys.argv) > 2 else 420
ch = int(sys.argv[3]) if len(sys.argv) > 3 else 320
cols = int(sys.argv[4]) if len(sys.argv) > 4 else 3
files = sorted(glob.glob(os.path.join(d, 'frame_*.png')))
ims = []
for f in files:
    im = Image.open(f)
    w, h = im.size
    x0, y0 = (w - cw) // 2, (h - ch) // 2
    ims.append(im.crop((x0, y0, x0 + cw, y0 + ch)))
rows = (len(ims) + cols - 1) // cols
out = Image.new('RGB', (cw * min(cols, len(ims)), ch * rows), 'white')
for i, im in enumerate(ims):
    out.paste(im, ((i % cols) * cw, (i // cols) * ch))
out.save(os.path.join(d, 'sheet.png'))
print(os.path.join(d, 'sheet.png'))
