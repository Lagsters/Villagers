"""Arkusz podgladow (do obejrzenia wielu modeli naraz): python art/contact_sheet.py prefiks wyjscie.png"""
import os
import sys
from PIL import Image, ImageDraw

prefix = sys.argv[1] if len(sys.argv) > 1 else ''
out = sys.argv[2] if len(sys.argv) > 2 else 'sheet.png'
folder = os.path.join(os.path.dirname(__file__), 'previews')
files = sorted(f for f in os.listdir(folder) if f.startswith(prefix) and f.endswith('.png'))
n = len(files)
cols = min(8, n)
rows = (n + cols - 1) // cols
cell = 160
sheet = Image.new('RGB', (cols * cell, rows * (cell + 16)), (60, 80, 55))
d = ImageDraw.Draw(sheet)
for i, f in enumerate(files):
    im = Image.open(os.path.join(folder, f)).convert('RGBA').resize((cell, cell))
    x, y = (i % cols) * cell, (i // cols) * (cell + 16)
    sheet.paste(im, (x, y), im)
    d.text((x + 4, y + cell), f[:-4], fill=(255, 255, 255))
sheet.save(out)
print(out, n)
