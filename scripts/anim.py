"""
Animacja (WebP albo GIF) z klatek scripts/capture.ts: python scripts/anim.py <katalog> <plik.webp|plik.gif> [ms_na_klatke] [skala]
"""
import glob
import os
import sys

from PIL import Image

d, out = sys.argv[1], sys.argv[2]
ms = int(sys.argv[3]) if len(sys.argv) > 3 else 100
k = float(sys.argv[4]) if len(sys.argv) > 4 else 1.0
frames = [Image.open(f).convert('RGB') for f in sorted(glob.glob(os.path.join(d, 'frame_*.png')))]
if k != 1.0:
    frames = [f.resize((round(f.width * k), round(f.height * k)), Image.LANCZOS) for f in frames]
if out.endswith('.gif'):
    frames[0].save(out, save_all=True, append_images=frames[1:], duration=ms, loop=0, optimize=True)
else:
    frames[0].save(out, save_all=True, append_images=frames[1:], duration=ms, loop=0, quality=80, method=6)
print(out, os.path.getsize(out) // 1024, 'KB')
