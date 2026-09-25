"""
Budynki (building_<rodzaj> wg numeracji z sim/defs.ts), place budowy i skrzydla wiatraka.
Front (drzwi) modelujemy na -Y; build() obraca model o 30 stopni, zeby patrzyl na flage (SE).
Budzety trojkatow: chata <= 800, dom <= 1200, duzy <= 2000.
Uruchomienie: blender --background --python art/scripts/buildings.py [-- nazwa ...]
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from lib import build  # noqa: E402

ROT = 30.0
R = math.pi / 2


# ---------- Elementy wspolne ----------

def house(m, w, d, h, roof='roof_red', roof_h=0.3, x=0.0, y=0.0, z=0.0, wall='wall', hip=False, door=True):
    m.box(w, d, h, x=x, y=y, z=z, col=wall)
    m.box(w + 0.02, d + 0.02, 0.04, x=x, y=y, z=z, col='stone_dark')  # cokol
    if hip:
        m.hip(w, d, roof_h, x=x, y=y, z=z + h, col=roof)
    else:
        m.gable(w, d, roof_h, x=x, y=y, z=z + h, col=roof)
    if door:
        m.box(0.11, 0.02, 0.17, x=x, y=y - d / 2 - 0.005, z=z, col='wood_dark')


def windows(m, w, d, h, x=0.0, y=0.0, z=0.0, n=1):
    for i in range(n):
        wx = x + (i - (n - 1) / 2) * (w / (n + 0.5))
        m.box(0.07, 0.015, 0.07, x=wx + (0.12 if n == 1 else 0), y=y - d / 2 - 0.004, z=z + h * 0.55, col='wood_dark')
    m.box(0.015, 0.07, 0.07, x=x - w / 2 - 0.004, y=y, z=z + h * 0.55, col='wood_dark')


def chimney(m, x, y, z, h=0.2, col='stone_dark'):
    m.box(0.07, 0.07, h, x=x, y=y, z=z, col=col)


def pile(m, x, y, col='log', n=3, horizontal=True):
    for i in range(n):
        if horizontal:
            m.cyl(0.03, 0.2, 6, x=x - 0.1, y=y + (i % 2) * 0.02, z=0.03 + i * 0.05, col=col, ry=R)
        else:
            m.box(0.08, 0.08, 0.08, x=x + (i % 2) * 0.09, y=y, z=(i // 2) * 0.08, col=col)


def fence(m, x0, y0, x1, y1, posts=4, col='wood'):
    for i in range(posts):
        t = i / (posts - 1)
        m.box(0.02, 0.02, 0.12, x=x0 + (x1 - x0) * t, y=y0 + (y1 - y0) * t, col=col)
    length = math.hypot(x1 - x0, y1 - y0)
    ang = math.atan2(y1 - y0, x1 - x0)
    m.box(length, 0.012, 0.012, x=(x0 + x1) / 2, y=(y0 + y1) / 2, z=0.08, col=col, rz=ang)


def barrel(m, x, y, z=0.0):
    m.cyl(0.045, 0.1, 7, x=x, y=y, z=z, col='wood')
    m.cyl(0.047, 0.012, 7, x=x, y=y, z=z + 0.04, col='metal_dark')


def banner(m, x, y, z, h=0.3):
    m.cyl(0.012, h, 4, x=x, y=y, z=z, col='wood')


def tower(m, r, h, x, y, roof='roof_blue', seg=8, col='stone'):
    m.cyl(r, h, seg, x=x, y=y, col=col, r_top=r * 0.92)
    m.cyl(r * 1.08, 0.05, seg, x=x, y=y, z=h, col='stone_dark')
    m.cone(r * 1.2, r * 1.6, seg, x=x, y=y, z=h + 0.05, col=roof)


def crenels(m, w, d, z, x=0.0, y=0.0, col='stone_light', n=4):
    for i in range(n):
        t = (i + 0.5) / n - 0.5
        for (cx, cy) in ((x + t * w, y - d / 2), (x + t * w, y + d / 2), (x - w / 2, y + t * d), (x + w / 2, y + t * d)):
            m.box(0.06, 0.06, 0.06, x=cx, y=cy, z=z, col=col)


# ---------- Budynki ----------

def castle(m):
    m.box(1.15, 1.0, 0.36, col='stone')  # mury
    crenels(m, 1.15, 1.0, 0.36, n=5)
    for (x, y) in ((-0.58, -0.5), (0.58, -0.5), (-0.58, 0.5), (0.58, 0.5)):
        tower(m, 0.15, 0.62, x, y)
    m.box(0.5, 0.45, 0.72, y=0.1, col='stone_light')  # donzon
    m.hip(0.5, 0.45, 0.32, y=0.1, z=0.72, col='roof_blue')
    m.box(0.22, 0.03, 0.26, y=-0.51, col='wood_dark')  # brama
    m.box(0.26, 0.04, 0.05, y=-0.51, z=0.26, col='stone_dark')
    banner(m, 0.0, 0.1, 1.02, 0.35)
    return ROT


def warehouse(m):
    house(m, 0.78, 0.56, 0.36, roof='roof_brown', roof_h=0.3)
    m.box(0.2, 0.02, 0.22, y=-0.29, col='wood_dark')
    for i in range(3):
        m.box(0.09, 0.09, 0.09, x=0.3 + (i % 2) * 0.1, y=-0.38, z=(i // 2) * 0.09, col='wood_light')
    barrel(m, -0.33, -0.38)
    return ROT


def woodcutter(m):
    house(m, 0.46, 0.4, 0.26, roof='roof_brown', roof_h=0.24)
    windows(m, 0.46, 0.4, 0.26)
    pile(m, 0.34, 0.05)
    m.cyl(0.07, 0.08, 7, x=-0.3, y=-0.22, col='log')  # pienek do rabania
    m.box(0.01, 0.06, 0.02, x=-0.3, y=-0.22, z=0.1, col='metal', rx=0.6)
    return ROT


def forester(m):
    house(m, 0.44, 0.4, 0.26, roof='roof_green', roof_h=0.24)
    windows(m, 0.44, 0.4, 0.26)
    for (x, y, s) in ((0.32, -0.15, 0.6), (0.32, 0.12, 0.8), (-0.32, 0.15, 0.5)):
        m.cyl(0.015, 0.1 * s, 4, x=x, y=y, col='bark')
        m.cone(0.07 * s, 0.18 * s, 6, x=x, y=y, z=0.07 * s, col='pine')
    return ROT


def sawmill(m):
    house(m, 0.62, 0.5, 0.32, roof='roof_brown', roof_h=0.28)
    windows(m, 0.62, 0.5, 0.32)
    m.box(0.36, 0.14, 0.12, x=0.12, y=-0.4, col='wood')  # stol
    m.cyl(0.11, 0.012, 12, x=0.12, y=-0.4, z=0.12, col='metal', rx=R)  # tarcza pily
    for i in range(3):
        m.box(0.3, 0.06, 0.015, x=-0.32, y=0.25 - i * 0.07, z=0.0, col='wood_light', rz=R)
    pile(m, -0.1, 0.4)
    return ROT


def stonecutter(m):
    house(m, 0.44, 0.4, 0.25, roof='roof_slate', roof_h=0.22, wall='stone_light')
    windows(m, 0.44, 0.4, 0.25)
    pile(m, 0.3, -0.2, col='stone', n=4, horizontal=False)
    m.box(0.012, 0.012, 0.16, x=-0.3, y=-0.25, col='wood', ry=0.4)
    return ROT


def fisher(m):
    for (x, y) in ((-0.18, -0.15), (0.18, -0.15), (-0.18, 0.15), (0.18, 0.15)):
        m.box(0.04, 0.04, 0.1, x=x, y=y, col='wood_dark')
    house(m, 0.44, 0.38, 0.22, roof='thatch', roof_h=0.24, z=0.1)
    m.box(0.12, 0.2, 0.012, x=-0.14, y=-0.28, z=0.0, col='wood', rx=0.5)  # schodki
    m.box(0.02, 0.02, 0.3, x=0.32, y=-0.1, col='wood')  # suszarnia sieci
    m.box(0.02, 0.02, 0.3, x=0.32, y=0.2, col='wood')
    m.box(0.012, 0.3, 0.16, x=0.32, y=0.05, z=0.12, col='cream')
    m.wedge(0.12, 0.26, 0.06, x=-0.34, y=0.25, col='wood')  # lodka
    return ROT


def hunter(m):
    house(m, 0.44, 0.4, 0.25, roof='roof_brown', roof_h=0.24, wall='wood_light')
    windows(m, 0.44, 0.4, 0.25)
    for s in (-1, 1):  # poroze nad drzwiami
        m.box(0.012, 0.012, 0.09, x=s * 0.04, y=-0.21, z=0.2, col='cream', ry=s * 0.5)
    m.box(0.1, 0.02, 0.1, x=0.3, y=-0.12, z=0.1, col='deer')  # skora
    m.box(0.02, 0.02, 0.2, x=0.3, y=-0.12, col='wood')
    return ROT


def farm(m):
    house(m, 0.62, 0.46, 0.32, roof='thatch', roof_h=0.3, x=-0.28, y=0.05)
    windows(m, 0.62, 0.46, 0.32, x=-0.28, y=0.05)
    m.box(0.46, 0.5, 0.36, x=0.32, y=0.1, col='wood')  # stodola
    m.gable(0.46, 0.5, 0.26, x=0.32, y=0.1, z=0.36, col='roof_red', rz=R)
    m.box(0.18, 0.02, 0.24, x=0.32, y=-0.16, col='wood_dark')
    fence(m, -0.6, -0.45, 0.6, -0.45, posts=6)
    for i in range(3):
        m.box(0.1, 0.26, 0.12, x=-0.5 + i * 0.13, y=0.45, col='wheat')
    return ROT


def mill(m):
    m.cyl(0.24, 0.62, 8, col='plaster', r_top=0.17)
    m.cone(0.22, 0.24, 8, z=0.62, col='roof_brown')
    m.box(0.1, 0.02, 0.17, y=-0.235, col='wood_dark')
    m.box(0.07, 0.02, 0.07, y=-0.2, z=0.38, col='wood_dark')
    m.cyl(0.035, 0.08, 6, y=-0.2, z=0.55, col='wood_dark', rx=R)  # piasta (skrzydla osobno)
    m.box(0.12, 0.12, 0.08, x=0.28, y=0.1, col='flour')  # worki
    return ROT


def mill_sails(m):
    """Skrzydla wiatraka: srodek w piascie, plaszczyzna XZ; w grze obracane wokol osi Y (modelu)."""
    for k in range(4):
        a = k * R
        m.box(0.035, 0.012, 0.46, x=math.sin(a) * 0.23, z=math.cos(a) * 0.23, col='wood', ry=a)
        m.box(0.11, 0.008, 0.3, x=math.sin(a) * 0.3 + math.cos(a) * 0.06, z=math.cos(a) * 0.3 - math.sin(a) * 0.06, col='cream', ry=a)
    return 0.0


def bakery(m):
    house(m, 0.6, 0.48, 0.3, roof='roof_red', roof_h=0.28)
    windows(m, 0.6, 0.48, 0.3)
    chimney(m, 0.18, 0.1, 0.4, 0.25)
    m.ico(0.14, x=-0.38, y=0.05, z=0.02, col='stone_light', sub=1, sz=0.8)  # piec chlebowy
    m.box(0.07, 0.02, 0.06, x=-0.38, y=-0.08, z=0.02, col='coal')
    return ROT


def pigfarm(m):
    house(m, 0.6, 0.46, 0.3, roof='roof_brown', roof_h=0.28, x=-0.25, y=0.1)
    windows(m, 0.6, 0.46, 0.3, x=-0.25, y=0.1)
    fence(m, 0.15, -0.45, 0.65, -0.45, posts=4)
    fence(m, 0.65, -0.45, 0.65, 0.3, posts=4)
    fence(m, 0.15, -0.45, 0.15, -0.1, posts=3)
    for (x, y) in ((0.35, -0.3), (0.5, -0.12), (0.32, 0.05)):
        m.box(0.08, 0.13, 0.07, x=x, y=y, col='pig', rz=0.4)
        m.box(0.06, 0.05, 0.05, x=x - 0.03, y=y - 0.08, z=0.02, col='pig', rz=0.4)
    m.box(0.22, 0.08, 0.05, x=0.4, y=0.25, col='wood_dark')  # koryto
    return ROT


def butcher(m):
    house(m, 0.58, 0.46, 0.3, roof='roof_red', roof_h=0.26, wall='plaster')
    windows(m, 0.58, 0.46, 0.3)
    m.box(0.16, 0.012, 0.012, x=0.18, y=-0.28, z=0.3, col='wood_dark')  # szyld z szynka
    m.ico(0.045, x=0.18, y=-0.28, z=0.23, col='meat', sub=1, sz=1.3)
    m.box(0.1, 0.1, 0.08, x=-0.36, y=-0.2, col='wood')  # pniak
    return ROT


def mine(m, ore):
    m.ico(0.34, y=0.12, col='stone_dark', sub=1, sz=0.6)  # skala
    m.box(0.26, 0.08, 0.28, y=-0.12, col='wood_dark')  # rama wejscia
    m.box(0.18, 0.09, 0.22, y=-0.13, col='coal')
    m.box(0.32, 0.1, 0.05, y=-0.12, z=0.28, col='wood')
    m.box(0.05, 0.4, 0.015, x=-0.05, y=-0.38, col='metal_dark')  # tory
    m.box(0.05, 0.4, 0.015, x=0.05, y=-0.38, col='metal_dark')
    m.box(0.14, 0.18, 0.1, y=-0.42, z=0.02, col='wood')  # wozek
    m.ico(0.07, y=-0.42, z=0.12, col=ore, sub=1, sz=0.6)
    pile(m, 0.3, -0.22, col=ore, n=3, horizontal=False)
    return ROT


def coalmine(m):
    return mine(m, 'coal')


def ironmine(m):
    return mine(m, 'iron_ore')


def goldmine(m):
    return mine(m, 'gold_ore')


def stonemine(m):
    return mine(m, 'stone')


def steelworks(m):
    house(m, 0.6, 0.5, 0.3, roof='roof_slate', roof_h=0.24, wall='stone')
    windows(m, 0.6, 0.5, 0.3)
    m.cyl(0.07, 0.62, 6, x=0.2, y=0.12, col='stone_dark', r_top=0.055)  # komin
    m.box(0.18, 0.18, 0.2, x=-0.38, y=-0.1, col='stone_dark')  # piec
    m.box(0.08, 0.02, 0.08, x=-0.38, y=-0.2, z=0.04, col='fire')
    pile(m, -0.4, 0.25, col='coal', n=3, horizontal=False)
    return ROT


def mint(m):
    house(m, 0.58, 0.48, 0.32, roof='roof_blue', roof_h=0.26, wall='stone_light')
    windows(m, 0.58, 0.48, 0.32)
    chimney(m, -0.16, 0.12, 0.4, 0.2)
    m.box(0.012, 0.012, 0.1, x=0.18, y=-0.28, z=0.26, col='wood_dark')
    m.cyl(0.06, 0.015, 10, x=0.18, y=-0.29, z=0.22, col='gold', rx=R)  # moneta-szyld
    return ROT


def toolmaker(m):
    house(m, 0.6, 0.48, 0.3, roof='roof_red', roof_h=0.26)
    windows(m, 0.6, 0.48, 0.3)
    chimney(m, 0.18, 0.12, 0.38, 0.22)
    m.box(0.06, 0.06, 0.08, x=-0.38, y=-0.2, col='stone_dark')  # kowadlo
    m.box(0.14, 0.06, 0.04, x=-0.38, y=-0.2, z=0.08, col='metal_dark')
    for i in range(3):  # narzedzia na scianie
        m.box(0.012, 0.012, 0.14, x=0.31, y=-0.12 + i * 0.07, z=0.08, col='wood', rx=0.2)
    return ROT


def weaponsmith(m):
    house(m, 0.6, 0.5, 0.3, roof='roof_slate', roof_h=0.26, wall='stone')
    windows(m, 0.6, 0.5, 0.3)
    chimney(m, -0.18, 0.12, 0.38, 0.24)
    m.box(0.12, 0.015, 0.14, x=0.18, y=-0.26, z=0.1, col='wood_dark')  # tarcza na scianie
    m.box(0.05, 0.016, 0.05, x=0.18, y=-0.265, z=0.15, col='metal')
    for s in (-1, 1):  # skrzyzowane miecze
        m.box(0.012, 0.012, 0.22, x=-0.38 + s * 0.03, y=-0.2, z=0.02, col='white', ry=s * 0.4)
    return ROT


def shipyard(m):
    house(m, 0.5, 0.42, 0.28, roof='roof_brown', roof_h=0.24, x=-0.15, y=0.12)
    windows(m, 0.5, 0.42, 0.28, x=-0.15, y=0.12)
    for x in (0.12, 0.42):  # pochylnia
        m.box(0.03, 0.03, 0.1, x=x, y=-0.3, col='wood_dark')
    m.wedge(0.16, 0.42, 0.09, x=0.27, y=-0.3, z=0.08, col='wood', rz=R)  # kadlub
    m.box(0.3, 0.14, 0.08, x=0.27, y=-0.3, z=0.08, col='wood_light')
    return ROT


def guardhut(m):
    """Barak: drewniana chata z palisada."""
    house(m, 0.42, 0.38, 0.26, roof='roof_brown', roof_h=0.22, wall='wood_light')
    for i in range(7):
        a = -R + i * (math.pi / 6)
        m.cyl(0.025, 0.2 + (i % 2) * 0.03, 5, x=math.cos(a) * 0.3, y=math.sin(a) * 0.3 + 0.03, col='wood', r_top=0.0)
    banner(m, 0.0, 0.05, 0.48, 0.25)
    return ROT


def tower_building(m):
    """Wieza straznicza (dom)."""
    m.box(0.44, 0.44, 0.7, col='stone')
    crenels(m, 0.44, 0.44, 0.7, n=3)
    m.box(0.12, 0.02, 0.18, y=-0.225, col='wood_dark')
    for z in (0.3, 0.5):
        m.box(0.04, 0.015, 0.08, y=-0.226, z=z, col='coal')
    m.box(0.3, 0.2, 0.2, x=0.0, y=0.3, col='stone_dark')
    banner(m, 0.0, 0.0, 0.76, 0.3)
    return ROT


def fortress(m):
    m.box(1.05, 0.9, 0.32, col='stone')
    crenels(m, 1.05, 0.9, 0.32, n=4)
    for (x, y) in ((-0.52, -0.45), (0.52, -0.45), (-0.52, 0.45), (0.52, 0.45)):
        tower(m, 0.13, 0.52, x, y, roof='roof_slate')
    m.box(0.42, 0.42, 0.85, y=0.08, col='stone_light')
    crenels(m, 0.42, 0.42, 0.85, y=0.08, n=3)
    m.box(0.2, 0.03, 0.24, y=-0.46, col='wood_dark')
    banner(m, 0.0, 0.08, 0.91, 0.35)
    return ROT


def well(m):
    m.cyl(0.14, 0.14, 8, col='stone')
    m.cyl(0.11, 0.005, 8, z=0.14, col='water')
    for x in (-0.13, 0.13):
        m.box(0.03, 0.03, 0.36, x=x, col='wood')
    m.gable(0.34, 0.24, 0.12, z=0.36, col='roof_red', rz=0.0)
    m.cyl(0.02, 0.26, 6, x=-0.13, z=0.28, col='wood_dark', ry=R)
    m.cyl(0.035, 0.05, 6, y=0.0, z=0.18, col='wood')  # wiadro
    return ROT


def brewery(m):
    house(m, 0.6, 0.5, 0.3, roof='roof_green', roof_h=0.28, wall='plaster')
    windows(m, 0.6, 0.5, 0.3)
    chimney(m, 0.16, 0.14, 0.4, 0.2, col='copper')
    for (x, y, z) in ((-0.38, -0.2, 0), (-0.38, -0.08, 0), (-0.38, -0.14, 0.1)):
        barrel(m, x, y, z)
    m.box(0.012, 0.12, 0.012, x=0.31, y=-0.14, z=0.32, col='wood_dark')  # szyld
    m.cyl(0.035, 0.07, 6, x=0.31, y=-0.2, z=0.22, col='beer')
    return ROT


def donkeybreeder(m):
    m.box(0.8, 0.44, 0.3, x=-0.1, y=0.15, col='wood')  # stajnia
    m.gable(0.8, 0.44, 0.24, x=-0.1, y=0.15, z=0.3, col='thatch')
    for x in (-0.36, -0.1, 0.16):
        m.box(0.13, 0.02, 0.16, x=x, y=-0.075, col='wood_dark')
    fence(m, -0.6, -0.5, 0.55, -0.5, posts=6)
    fence(m, 0.55, -0.5, 0.55, 0.1, posts=4)
    m.box(0.09, 0.2, 0.09, x=0.25, y=-0.3, z=0.1, col='donkey')  # osiol
    m.box(0.06, 0.08, 0.07, x=0.25, y=-0.42, z=0.15, col='donkey')
    for dy in (-0.07, 0.07):
        m.box(0.025, 0.025, 0.1, x=0.25, y=-0.3 + dy, col='donkey_dark')
    m.box(0.18, 0.12, 0.08, x=-0.35, y=-0.3, col='wheat')  # siano
    return ROT


def charburner(m):
    house(m, 0.44, 0.4, 0.24, roof='thatch', roof_h=0.22, x=-0.35, y=0.15)
    m.ico(0.3, x=0.22, y=-0.05, col='coal', sub=1, sz=0.55)  # mielerz
    m.ico(0.22, x=0.22, y=-0.05, z=0.03, col='soil', sub=1, sz=0.6)
    m.cone(0.06, 0.2, 5, x=0.22, y=-0.05, z=0.16, col='smoke')
    pile(m, -0.35, -0.3)
    m.box(0.12, 0.1, 0.07, x=0.55, y=0.3, col='coal')
    return ROT


def catapult(m):
    m.box(0.5, 0.36, 0.06, col='wood_dark')  # platforma
    for x in (-0.2, 0.2):
        for y in (-0.14, 0.14):
            m.cyl(0.05, 0.03, 8, x=x, y=y, z=0.0, col='wood', rx=R)
    for x in (-0.1, 0.1):
        m.box(0.04, 0.04, 0.26, x=x, z=0.06, col='wood')
    m.box(0.26, 0.04, 0.04, z=0.3, col='wood')
    m.box(0.04, 0.5, 0.04, y=0.05, z=0.24, col='wood_light', rx=0.7)  # ramie
    m.cyl(0.06, 0.04, 6, y=0.23, z=0.44, col='wood_dark')  # lyzka
    m.ico(0.04, y=0.23, z=0.49, col='stone', sub=1)
    pile(m, 0.3, 0.1, col='stone', n=3, horizontal=False)
    return ROT


def guardhouse(m):
    """Wartownia: kamienna chata z blankami."""
    m.box(0.44, 0.4, 0.34, col='stone')
    crenels(m, 0.44, 0.4, 0.34, n=3)
    m.box(0.11, 0.02, 0.17, y=-0.205, col='wood_dark')
    m.box(0.04, 0.015, 0.07, x=0.12, y=-0.206, z=0.18, col='coal')
    banner(m, 0.0, 0.0, 0.4, 0.28)
    return ROT


def site(size):
    def f(m):
        w = {'small': 0.55, 'medium': 0.72, 'large': 1.2}[size]
        m.box(w, w * 0.85, 0.03, col='wood_light')
        for (x, y) in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
            m.box(0.035, 0.035, 0.38, x=x * w * 0.45, y=y * w * 0.38, col='wood')
        m.box(w * 0.9, 0.02, 0.025, y=-w * 0.38, z=0.3, col='wood')
        m.box(w * 0.9, 0.02, 0.025, y=w * 0.38, z=0.3, col='wood')
        pile(m, w * 0.3, -w * 0.5, col='wood_light', n=2)
        return ROT
    return f


BUILDERS = {
    'building_0': castle, 'building_1': warehouse, 'building_2': woodcutter, 'building_3': forester,
    'building_4': sawmill, 'building_5': stonecutter, 'building_6': fisher, 'building_7': hunter,
    'building_8': farm, 'building_9': mill, 'building_10': bakery, 'building_11': pigfarm,
    'building_12': butcher, 'building_13': coalmine, 'building_14': ironmine, 'building_15': goldmine,
    'building_16': stonemine, 'building_17': steelworks, 'building_18': mint, 'building_19': toolmaker,
    'building_20': weaponsmith, 'building_21': shipyard, 'building_22': guardhut, 'building_23': tower_building,
    'building_24': fortress, 'building_25': well, 'building_26': brewery, 'building_27': donkeybreeder,
    'building_28': charburner, 'building_29': catapult, 'building_30': guardhouse,
    'mill_sails': mill_sails, 'site_small': site('small'), 'site_medium': site('medium'), 'site_large': site('large'),
}

if __name__ == '__main__':
    build(BUILDERS)
