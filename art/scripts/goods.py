"""
Towary: male modele noszone przez tragarzy i lezace na flagach; ich rendery sluza tez jako ikony UI.
Kolejnosc = numeracja towarow w sim/defs.ts (good_0 ... good_30).
Uruchomienie: blender --background --python art/scripts/goods.py [-- nazwa ...]
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from lib import build  # noqa: E402

R = math.pi / 2


def fish(m):
    m.ico(0.05, col='fish', sub=1, sx=0.6, sy=1.8, sz=0.7, z=0.035)
    m.wedge(0.012, 0.05, 0.05, y=0.1, z=0.01, col='fish')


def pig(m):
    m.box(0.09, 0.14, 0.08, z=0.02, col='pig')
    m.box(0.06, 0.05, 0.06, y=-0.09, z=0.04, col='pig')
    for x in (-0.03, 0.03):
        for y in (-0.05, 0.05):
            m.box(0.02, 0.02, 0.03, x=x, y=y, col='pig')


def meat(m):
    m.ico(0.055, col='meat', sub=1, sx=1.2, sy=0.9, sz=0.7, z=0.04)
    m.cyl(0.012, 0.06, 5, x=0.07, z=0.04, col='cream', ry=R)


def wheat(m):
    m.cyl(0.035, 0.14, 6, col='wheat', r_top=0.05)
    m.cyl(0.038, 0.02, 6, z=0.05, col='wood')


def flour(m):
    m.cyl(0.055, 0.1, 6, col='flour', r_top=0.04)
    m.cyl(0.02, 0.02, 6, z=0.1, col='wood')


def bread(m):
    m.ico(0.06, col='bread', sub=1, sx=1.3, sy=0.9, sz=0.6, z=0.03)


def water(m):
    m.cyl(0.045, 0.08, 7, col='wood', r_top=0.05)
    m.cyl(0.047, 0.006, 7, z=0.078, col='water')
    m.box(0.1, 0.008, 0.008, z=0.12, col='metal_dark')


def beer(m):
    m.cyl(0.045, 0.1, 7, col='wood', r_top=0.045)
    m.cyl(0.047, 0.012, 7, z=0.02, col='metal_dark')
    m.cyl(0.047, 0.012, 7, z=0.07, col='metal_dark')


def lumber(m):
    m.cyl(0.035, 0.18, 6, x=-0.09, z=0.035, col='log', ry=R)


def plank(m):
    for i in range(3):
        m.box(0.2, 0.05, 0.015, z=i * 0.016, y=(i - 1) * 0.004, col='wood_light')


def boat(m):
    m.wedge(0.1, 0.2, 0.05, col='wood', rz=0)
    m.box(0.1, 0.12, 0.04, y=0.04, col='wood_dark')


def stone(m):
    m.box(0.1, 0.08, 0.07, col='stone')


def iron_ore(m):
    m.ico(0.05, col='iron_ore', sub=1, sz=0.8, z=0.035)


def steel(m):
    for i in range(2):
        m.box(0.16, 0.04, 0.025, y=(i - 0.5) * 0.045, col='metal')
    m.box(0.16, 0.04, 0.025, z=0.025, col='metal_dark')


def coal(m):
    m.ico(0.045, col='coal', sub=1, z=0.03)
    m.ico(0.03, x=0.04, col='coal', sub=1, z=0.02)


def gold_ore(m):
    m.ico(0.05, col='gold_ore', sub=1, sz=0.8, z=0.035)


def gold(m):
    for i in range(3):
        m.cyl(0.04, 0.012, 8, z=i * 0.013, col='gold')


def handle(m, length=0.16):
    m.box(0.015, 0.015, length, col='wood', rx=0.0)


def shovel(m):
    m.box(0.015, 0.015, 0.16, col='wood')
    m.box(0.05, 0.01, 0.06, z=-0.05, col='metal')


def hammer(m):
    m.box(0.015, 0.015, 0.12, col='wood')
    m.box(0.07, 0.025, 0.025, z=0.12, col='metal_dark')


def rod(m):
    m.cyl(0.006, 0.2, 4, col='wood', r_top=0.003)
    m.cyl(0.015, 0.01, 6, z=0.03, x=0.012, col='metal')


def cleaver(m):
    m.box(0.015, 0.015, 0.06, col='wood')
    m.box(0.06, 0.008, 0.05, x=0.02, z=0.06, col='metal')


def scythe(m):
    m.box(0.015, 0.015, 0.18, col='wood')
    m.box(0.1, 0.008, 0.02, x=0.05, z=0.17, col='metal', ry=0.3)


def axe(m):
    m.box(0.015, 0.015, 0.15, col='wood')
    m.box(0.05, 0.01, 0.045, x=0.02, z=0.12, col='metal')


def saw(m):
    m.box(0.16, 0.006, 0.05, col='metal')
    m.box(0.03, 0.015, 0.05, x=0.09, col='wood')


def pick(m):
    m.box(0.015, 0.015, 0.15, col='wood')
    m.box(0.12, 0.015, 0.02, z=0.14, col='metal_dark')


def pincer(m):
    m.box(0.01, 0.01, 0.13, x=-0.012, col='metal_dark', ry=0.12)
    m.box(0.01, 0.01, 0.13, x=0.012, col='metal_dark', ry=-0.12)


def bow(m):
    # Luk jako luk okregu z 7 segmentow (srodek segmentu na okregu) + cieciwa.
    for i in range(7):
        a = (i - 3) * 0.3
        px, pz = 0.05 - 0.1 * math.cos(a), 0.1 + 0.1 * math.sin(a)
        m.box(0.013, 0.013, 0.034, x=px - 0.017 * math.sin(a), z=pz - 0.017 * math.cos(a), col='wood', ry=a)
    m.box(0.003, 0.003, 0.19, x=0.018, z=0.005, col='white')


def crucible(m):
    m.cyl(0.045, 0.06, 7, col='copper', r_top=0.055)
    m.cyl(0.03, 0.005, 7, z=0.058, col='fire')


def rolling_pin(m):
    m.cyl(0.02, 0.12, 6, x=-0.06, z=0.02, col='wood_light', ry=R)
    m.cyl(0.008, 0.04, 5, x=-0.1, z=0.02, col='wood', ry=R)
    m.cyl(0.008, 0.04, 5, x=0.06, z=0.02, col='wood', ry=R)


def sword(m):
    m.box(0.016, 0.006, 0.17, z=0.05, col='white')
    m.box(0.06, 0.012, 0.012, z=0.045, col='metal_dark')
    m.box(0.016, 0.016, 0.045, col='wood_dark')


def shield(m):
    m.box(0.1, 0.012, 0.12, col='wood_dark')
    m.box(0.05, 0.014, 0.05, z=0.035, col='metal')


BUILDERS = {f'good_{i}': f for i, f in enumerate([
    fish, pig, meat, wheat, flour, bread, water, beer, lumber, plank, boat, stone, iron_ore, steel, coal,
    gold_ore, gold, shovel, hammer, rod, cleaver, scythe, axe, saw, pick, pincer, bow, crucible, rolling_pin,
    sword, shield,
])}

if __name__ == '__main__':
    build(BUILDERS)
    _ = handle
