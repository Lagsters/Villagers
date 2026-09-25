"""
Budynki (building_<rodzaj> wg numeracji z sim/defs.ts), place budowy i skrzydla wiatraka.
Styl: dachy z terakoty z rzedami dachowek, sciany bielone, z desek albo z bali, wysokie sciany
i niskie dachy (czytelne z kamery), kazdy budynek z wlasna sylwetka (wieza wyciagowa kopalni,
silos farmy, smukle wieze zamku, przysadzista chata wartownicza...).
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


# =====================================================================
# Architektura
# =====================================================================

def roof(m, w, d, h, x=0.0, y=0.0, z=0.0, col='roof_red', over=0.04, tiles=3, gable_col='plaster', ridge='wood_dark',
         trim='wood_dark', front=False, frame=None):
    """Dach dwuspadowy z grubymi polaciami, rzedami dachowek, kalenica i scianami szczytowymi.
    w = dlugosc kalenicy, d = rozpietosc. Domyslnie kalenica wzdluz X; front=True - wzdluz Y (szczyt od frontu).
    frame = kolor belek szachulca na szczycie frontowym."""
    rz = R if front else 0.0

    def P(lx, ly):
        return (x - ly, y + lx) if front else (x + lx, y + ly)

    t = 0.022
    m.gable(w - 0.01, d - 0.01, h, x=x, y=y, z=z, col=gable_col, overhang=0.0, rz=rz)
    ye = d / 2 + over
    drop = over * h / (d / 2)
    dz = h + drop
    length = math.hypot(ye, dz)
    ang = math.atan2(dz, ye)
    for s in (-1, 1):
        cz = z - drop + dz / 2 + t / 2
        px, py = P(0, s * ye / 2)
        m.cbox(w + 2 * over, length, t, x=px, y=py, z=cz, col=col, rx=-s * ang, rz=rz)
        # Rzedy dachowek: listwy na polaci, lekko nad nia.
        ny, nz = s * math.sin(ang), math.cos(ang)
        for k in range(tiles):
            f = (k + 0.5) / tiles - 0.5  # -0.5 okap .. 0.5 kalenica
            px, py = P(0, s * (ye / 2 - f * ye) + ny * 0.014)
            m.cbox(w + 2 * over + 0.004, 0.018, 0.012, x=px, y=py, z=cz + f * dz + nz * 0.014, col=col + '_dark', rx=-s * ang, rz=rz)
        if s == (1 if front else -1):
            # Pionowe spoiny na polaci widocznej z kamery - kratka dachowek jak w pierwowzorze.
            n = max(3, int((w + 2 * over) / 0.075))
            for i in range(1, n):
                lx = -(w / 2 + over) + i * (w + 2 * over) / n
                px, py = P(lx, s * ye / 2 + ny * 0.016)
                m.cbox(0.01, length, 0.012, x=px, y=py, z=cz + nz * 0.016, col=col + '_dark', rx=-s * ang, rz=rz)
        px, py = P(0, s * ye)
        m.cbox(w + 2 * over + 0.01, 0.014, 0.022, x=px, y=py, z=z - drop + 0.004, col=trim, rz=rz)
    m.cbox(w + 2 * over + 0.02, 0.035, 0.03, x=x, y=y, z=z + h + 0.018, col=ridge, rz=rz)
    if frame:
        # Szachulec na szczycie: slup krolewski, jetka i zastrzaly.
        gx = -w / 2 - 0.006
        pts = [((gx, 0, z), (gx, 0, z + h)), ((gx, -d * 0.25, z + h * 0.5), (gx, d * 0.25, z + h * 0.5)),
               ((gx, -d * 0.38, z), (gx, -d * 0.12, z + h * 0.5)), ((gx, d * 0.38, z), (gx, d * 0.12, z + h * 0.5))]
        for (a0, a1) in pts:
            q0, q1 = P(a0[0], a0[1]), P(a1[0], a1[1])
            m.beam((q0[0], q0[1], a0[2]), (q1[0], q1[1], a1[2]), 0.022, frame)
        # Okienko strychu.
        qx, qy = P(gx - 0.004, 0)
        m.cbox(0.05 if front else 0.012, 0.012 if front else 0.05, 0.05, x=qx, y=qy, z=z + h * 0.28, col='glass')


def window(m, x, y, z, face='front', w=0.075, h=0.08, shutters=True):
    """Okno z szyba (ciemna), parapetem i okiennicami na scianie frontowej (y) albo bocznej (x)."""
    if face == 'front':
        m.cbox(w + 0.02, 0.012, h + 0.02, x=x, y=y - 0.004, z=z, col='wood_dark')
        m.cbox(w, 0.014, h, x=x, y=y - 0.008, z=z, col='glass')
        m.cbox(w + 0.03, 0.03, 0.012, x=x, y=y - 0.015, z=z - h / 2 - 0.008, col='wood')
        if shutters:
            for s in (-1, 1):
                m.cbox(w * 0.45, 0.01, h + 0.01, x=x + s * (w * 0.75 + 0.012), y=y - 0.01, z=z, col='shutter')
    else:
        sx = 1 if face == 'right' else -1
        m.cbox(0.012, w + 0.02, h + 0.02, x=x + sx * 0.004, y=y, z=z, col='wood_dark')
        m.cbox(0.014, w, h, x=x + sx * 0.008, y=y, z=z, col='glass')
        m.cbox(0.03, w + 0.03, 0.012, x=x + sx * 0.015, y=y, z=z - h / 2 - 0.008, col='wood')


def door(m, x, y, z=0.05, w=0.1, h=0.17, col='wood'):
    m.cbox(w + 0.03, 0.014, h + 0.02, x=x, y=y - 0.004, z=z + h / 2 + 0.005, col='wood_dark')
    m.cbox(w, 0.018, h, x=x, y=y - 0.009, z=z + h / 2, col=col)
    m.cbox(0.012, 0.02, 0.012, x=x + w * 0.3, y=y - 0.02, z=z + h * 0.45, col='metal_dark')
    m.cbox(w + 0.06, 0.05, 0.03, x=x, y=y - 0.03, z=0.015, col='stone_dark')


def chimney(m, x, y, z, h=0.2, col='stone_dark'):
    m.box(0.075, 0.075, h, x=x, y=y, z=z, col=col)
    m.box(0.095, 0.095, 0.025, x=x, y=y, z=z + h, col='stone_light')


def crenels(m, w, d, z, x=0.0, y=0.0, col='stone_light', n=4):
    for i in range(n):
        t = (i + 0.5) / n - 0.5
        for (cx, cy) in ((x + t * w, y - d / 2), (x + t * w, y + d / 2), (x - w / 2, y + t * d), (x + w / 2, y + t * d)):
            m.box(0.06, 0.06, 0.06, x=cx, y=cy, z=z, col=col)


def banner(m, x, y, z, h=0.3):
    m.cyl(0.012, h, 4, x=x, y=y, z=z, col='wood_dark')
    m.ico(0.016, x=x, y=y, z=z + h, col='gold', sub=0)


# =====================================================================
# Rekwizyty
# =====================================================================

def barrel(m, x, y, z=0.0, r=0.045, h=0.1):
    m.cyl(r, h, 8, x=x, y=y, z=z, col='wood', r_top=r)
    m.cyl(r * 1.06, 0.012, 8, x=x, y=y, z=z + h * 0.2, col='metal_dark')
    m.cyl(r * 1.06, 0.012, 8, x=x, y=y, z=z + h * 0.72, col='metal_dark')


def crate(m, x, y, z=0.0, s=0.09, rz=0.0):
    m.box(s, s, s, x=x, y=y, z=z, col='wood_light', rz=rz)
    m.cbox(s * 1.02, s * 1.02, 0.012, x=x, y=y, z=z + s * 0.5, col='wood', rz=rz)


def sack(m, x, y, z=0.0, col='flour'):
    m.cyl(0.04, 0.08, 6, x=x, y=y, z=z, col=col, r_top=0.03)
    m.cyl(0.015, 0.02, 5, x=x, y=y, z=z + 0.08, col='wood')


def log_pile(m, x, y, n=3, length=0.22, r=0.03, rz=0.0):
    rows = [(0, 0), (1, 0), (2, 0), (0.5, 1), (1.5, 1), (1, 2)][:n]
    c, s = math.cos(rz), math.sin(rz)
    for (i, j) in rows:
        ox = (i - 1) * r * 2.05
        px, py = x + ox * -s, y + ox * c
        m.cyl(r, length, 7, x=px - length / 2 * c, y=py - length / 2 * s, z=r + j * r * 1.75, col='log', ry=R, rz=0)


def plank_stack(m, x, y, n=4, rz=0.0):
    for i in range(n):
        m.cbox(0.26, 0.05, 0.014, x=x, y=y + (i % 2) * 0.01, z=0.008 + i * 0.016, col='wood_light', rz=rz)


def stone_blocks(m, x, y, n=4):
    for i in range(n):
        m.box(0.08, 0.07, 0.06, x=x + (i % 2) * 0.085, y=y + (i // 2 % 2) * 0.075, z=(i // 4) * 0.06, col='stone_light' if i % 3 else 'stone')


def bush(m, x, y, s=1.0, col='leaf'):
    m.ico(0.06 * s, x=x, y=y, z=0.03 * s, col=col, sub=1, sz=0.75)


def flowers(m, x, y):
    m.box(0.14, 0.05, 0.03, x=x, y=y, col='wood')
    for i, c in enumerate(('red', 'gold', 'white')):
        m.ico(0.018, x=x - 0.045 + i * 0.045, y=y, z=0.04, col=c, sub=0)


def fence(m, x0, y0, x1, y1, posts=4, col='wood'):
    for i in range(posts):
        t = i / (posts - 1)
        m.box(0.022, 0.022, 0.13, x=x0 + (x1 - x0) * t, y=y0 + (y1 - y0) * t, col=col)
    for zz in (0.05, 0.1):
        m.beam((x0, y0, zz), (x1, y1, zz), 0.014, col)


def hay(m, x, y, s=1.0):
    m.ico(0.09 * s, x=x, y=y, z=0.05 * s, col='wheat', sub=1, sz=0.7)


def anvil(m, x, y):
    m.box(0.07, 0.07, 0.07, x=x, y=y, col='wood_dark')
    m.box(0.05, 0.04, 0.04, x=x, y=y, z=0.07, col='metal_dark')
    m.cbox(0.13, 0.05, 0.03, x=x, y=y, z=0.125, col='metal_dark')
    m.cone(0.025, 0.05, 5, x=x + 0.085, y=y, z=0.125 - 0.012, col='metal_dark', ry=R)


def cart(m, x, y, rz=0.0, load=None):
    c, s = math.cos(rz), math.sin(rz)
    m.cbox(0.16, 0.11, 0.05, x=x, y=y, z=0.07, col='wood', rz=rz)
    for side in (-1, 1):
        m.cyl(0.04, 0.015, 8, x=x - s * side * 0.065, y=y + c * side * 0.065, z=0.04, col='wood_dark', rx=R, rz=rz)
    m.beam((x + c * 0.08, y + s * 0.08, 0.07), (x + c * 0.2, y + s * 0.2, 0.03), 0.015, 'wood_dark')
    if load:
        m.ico(0.055, x=x, y=y, z=0.12, col=load, sub=1, sz=0.6)


def lantern(m, x, y):
    m.cyl(0.012, 0.25, 4, x=x, y=y, col='wood_dark')
    m.cbox(0.035, 0.035, 0.045, x=x, y=y, z=0.27, col='fire_core')
    m.cone(0.03, 0.03, 4, x=x, y=y, z=0.29, col='metal_dark')


def sign(m, x, y, z, emblem=None, col='cream'):
    """Szyld na wysiegniku przy scianie frontowej."""
    m.beam((x, y, z), (x, y - 0.1, z), 0.014, 'wood_dark')
    m.cbox(0.012, 0.012, 0.03, x=x, y=y - 0.08, z=z - 0.02, col='metal_dark')
    m.cbox(0.08, 0.012, 0.07, x=x, y=y - 0.08, z=z - 0.07, col=col)
    if emblem:
        m.cbox(0.045, 0.016, 0.04, x=x, y=y - 0.083, z=z - 0.07, col=emblem)


def path_stones(m, y0, n=3):
    for i in range(n):
        m.cyl(0.035, 0.012, 6, x=((i * 37) % 5 - 2) * 0.01, y=y0 - i * 0.07, col='stone_light')


# =====================================================================
# Styl osady: dachy z terakoty z rzedami dachowek, sciany bielone (kamien z widocznymi
# kamieniami), z desek albo z bali. Kamera widzi front (-Y) i lewy bok (-X) modelu.
# =====================================================================

WALL = {'white': 'whitewash', 'plank': 'plank', 'log': 'log_o', 'stone': 'stone'}

# Pseudolosowe polozenia kamieni na scianie (u, v w [0, 1]).
SPOTS = ((0.12, 0.2), (0.78, 0.35), (0.3, 0.75), (0.62, 0.12), (0.9, 0.8), (0.45, 0.5))


def wall_detail(m, style, w, d, h, x, y, z, n_front=4, n_side=3):
    """Faktura sciany na froncie (-Y) i lewym boku (-X)."""
    hw, hd = w / 2, d / 2
    if style in ('white', 'stone'):
        col = 'stone' if style == 'white' else 'stone_light'
        for (u, v) in SPOTS[:n_front]:
            m.cbox(0.05, 0.012, 0.032, x=x - hw + 0.04 + u * (w - 0.08), y=y - hd - 0.003, z=z + 0.03 + v * (h - 0.07), col=col)
        for (u, v) in SPOTS[2:2 + n_side]:
            m.cbox(0.012, 0.05, 0.032, x=x - hw - 0.003, y=y - hd + 0.04 + u * (d - 0.08), z=z + 0.03 + v * (h - 0.07), col=col)
    elif style == 'plank':
        n = max(2, int(w / 0.075))
        for i in range(1, n):
            m.cbox(0.008, 0.01, h, x=x - hw + i * w / n, y=y - hd - 0.003, z=z + h / 2, col='plank_dark')
        n = max(2, int(d / 0.075))
        for i in range(1, n):
            m.cbox(0.01, 0.008, h, x=x - hw - 0.003, y=y - hd + i * d / n, z=z + h / 2, col='plank_dark')
    elif style == 'log':
        n = max(2, int(h / 0.05))
        for i in range(1, n):
            zz = z + i * h / n
            m.cbox(w + 0.03, 0.012, 0.01, x=x, y=y - hd - 0.004, z=zz, col='plank_dark')
            m.cbox(0.012, d + 0.03, 0.01, x=x - hw - 0.004, y=y, z=zz, col='plank_dark')


def house(m, w, d, h, style='white', roof_col='terracotta', front=False, x=0.0, y=0.0, roof_h=None, wins=(-1, 1),
          side_wins=True, has_door=True, door_x=0.0, door_w=0.1, tiles=None, found=0.04, chim=None, detail=True, hip=False):
    """Dom w stylu osady (hip=True - dach czterospadowy). Zwraca wysokosc okapu."""
    span = w if front else d
    h *= 1.5  # wysokie sciany, niskie dachy - czytelne z kamery z gory
    roof_h = roof_h if roof_h is not None else span * 0.3
    tiles = tiles or max(3, round(span * 8))
    m.box(w + 0.03, d + 0.03, found, x=x, y=y, col='stone_dark')
    m.box(w, d, h, x=x, y=y, z=found, col=WALL[style])
    if detail:
        wall_detail(m, style, w, d, h, x, y, found)
    top = found + h
    for wx in wins:
        window(m, x + wx * w * 0.3, y - d / 2, found + h * 0.6, 'front', shutters=False)
    if side_wins:
        window(m, x - w / 2, y, found + h * 0.6, 'left', shutters=False)
    if has_door:
        door(m, x + door_x, y - d / 2, found, w=door_w, h=min(0.17, h * 0.72), col='plank')
    gable = WALL[style]
    if hip:
        m.hip(w, d, roof_h * 1.2, x=x, y=y, z=top, col=roof_col, overhang=0.035)
        for k in range(1, 3):  # rzedy dachowek jako pierscienie
            f = k / 3
            m.cbox(w + 0.07 - f * w, 0.012, 0.012, x=x, y=y - (d / 2 + 0.035) * (1 - f) - 0.004, z=top + roof_h * 1.2 * f + 0.006,
                   col=roof_col + '_dark', rx=math.atan2(roof_h * 1.2, d / 2 + 0.035))
    elif front:
        roof(m, d, w, roof_h, x=x, y=y, z=top, col=roof_col, gable_col=gable, tiles=tiles, front=True, over=0.035)
    else:
        roof(m, w, d, roof_h, x=x, y=y, z=top, col=roof_col, gable_col=gable, tiles=tiles, over=0.035)
    if chim:
        chimney(m, x + chim[0], y + chim[1], top + 0.02, roof_h + 0.06)
    return top


def lean_to(m, w, d, h, x, y, col='terracotta', posts=True, style='plank'):
    """Przybudowka z dachem jednospadowym (opadajacym ku -Y)."""
    if posts:
        for (px, py) in ((x - w / 2 + 0.02, y - d / 2 + 0.02), (x + w / 2 - 0.02, y - d / 2 + 0.02)):
            m.box(0.03, 0.03, h * 0.8, x=px, y=py, col='plank_dark')
    else:
        m.box(w, d, h * 0.8, x=x, y=y, col=WALL[style])
    ang = math.atan2(h * 0.35, d)
    m.cbox(w + 0.06, d / math.cos(ang) + 0.06, 0.03, x=x, y=y, z=h * 0.8 + h * 0.175, col=col, rx=ang)
    for k in range(2):
        f = (k + 0.5) / 2 - 0.5
        m.cbox(w + 0.07, 0.022, 0.016, x=x, y=y + f * d, z=h * 0.8 + h * 0.175 + f * h * 0.35 + 0.02, col=col + '_dark', rx=ang)


def double_door(m, x, y, z=0.04, w=0.16, h=0.17):
    m.cbox(w + 0.03, 0.014, h + 0.02, x=x, y=y - 0.004, z=z + h / 2, col='plank_dark')
    for s in (-1, 1):
        m.cbox(w / 2 - 0.006, 0.018, h, x=x + s * w / 4, y=y - 0.01, z=z + h / 2 - 0.005, col='plank')
    m.beam((x - w / 2 + 0.01, y - 0.021, z + 0.02), (x + w / 2 - 0.01, y - 0.021, z + h - 0.02), 0.012, 'plank_dark')


def fir(m, x, y, s=1.0):
    m.cyl(0.02 * s, 0.08 * s, 5, x=x, y=y, col='bark')
    m.cone(0.11 * s, 0.2 * s, 7, x=x, y=y, z=0.06 * s, col='pine')
    m.cone(0.08 * s, 0.17 * s, 7, x=x, y=y, z=0.17 * s, col='pine_dark')


def slim_tower(m, r, h, x, y, col='whitewash', roof_col='terracotta', seg=8, cone_k=3.0, pole=True):
    """Smukla wieza z wysokim, spiczastym dachem."""
    m.cyl(r * 1.06, h, seg, x=x, y=y, col=col, r_top=r)
    m.cyl(r * 1.15, 0.035, seg, x=x, y=y, z=h, col='stone_light')
    m.cone(r * 1.3, r * cone_k, seg, x=x, y=y, z=h + 0.035, col=roof_col)
    m.cbox(0.03, 0.02, 0.06, x=x, y=y - r, z=h * 0.7, col='glass')
    m.cbox(0.02, 0.03, 0.06, x=x - r, y=y, z=h * 0.45, col='glass')
    if pole:
        m.cyl(0.007, 0.08, 4, x=x, y=y, z=h + 0.035 + r * cone_k - 0.02, col='wood_dark')


def log_ends(m, x, y, h, z=0.04, n=None):
    """Jasne czola bali wystajace na narozniku chaty (lewy przedni naroznik - widoczny z kamery)."""
    n = n or max(3, int(h / 0.05))
    for i in range(n):
        zz = z + (i + 0.5) * h / n
        m.cbox(0.05, 0.035, 0.03, x=x - 0.012, y=y - 0.012, z=zz, col='wood_light')


def crossed_gable(m, x, y, z, front=False):
    """Skrzyzowane deski na szczycie dachu (koniki) - po lewej stronie kalenicy."""
    for s in (-1, 1):
        if front:
            m.beam((x, y - 0.02, z - 0.02), (x + s * 0.06, y - 0.05, z + 0.07), 0.018, 'wood_light')
        else:
            m.beam((x - 0.02, y, z - 0.02), (x - 0.05, y + s * 0.06, z + 0.07), 0.018, 'wood_light')


def cabin(m, w, d, h, x=0.0, y=0.0, style='log', roof_h=None, **kw):
    """Chata z bali/desek: dluga sciana do kamery, szczyt po lewej, koniki na szczycie."""
    top = house(m, w, d, h, style, x=x, y=y, roof_h=roof_h, **kw)
    rh = roof_h if roof_h is not None else d * 0.3
    if style == 'log':
        log_ends(m, x - w / 2, y - d / 2, top - 0.04)
    crossed_gable(m, x - w / 2 - 0.02, y, top + rh + 0.02)
    return top


def headframe(m, x, y, h=0.5):
    """Wieza wyciagowa kopalni: A-rama z dwoch par nog i szopka z desek na szczycie."""
    for sy in (-0.04, 0.04):
        for sx in (-1, 1):
            m.beam((x + sx * 0.13, y + sy, 0), (x + sx * 0.06, y + sy, h), 0.026, 'plank')
    for zz in (0.18, 0.34):
        k = zz / h
        r = 0.13 + (0.06 - 0.13) * k
        m.beam((x - r, y - 0.045, zz), (x + r, y - 0.045, zz), 0.018, 'plank_dark')
    # Szopka na szczycie (szczelinowe deski) z daszkiem.
    m.box(0.17, 0.12, 0.13, x=x, y=y, z=h, col='plank')
    for i in range(1, 5):
        m.cbox(0.008, 0.01, 0.13, x=x - 0.085 + i * 0.034, y=y - 0.062, z=h + 0.065, col='plank_dark')
    roof(m, 0.17, 0.12, 0.07, x=x, y=y, z=h + 0.13, col='terracotta', over=0.02, tiles=2, gable_col='plank')


def round_bastion(m, r, h, x, y, col='whitewash'):
    """Okragla baszta z blankami, bez dachu (jak w magazynie i warowni pierwowzoru)."""
    m.cyl(r, h, 8, x=x, y=y, col=col)
    m.cyl(r * 0.75, 0.01, 8, x=x, y=y, z=h, col='stone_dark')
    for k in range(4):
        a = k * R + 0.4
        m.box(0.045, 0.045, 0.05, x=x + math.cos(a) * r * 0.85, y=y + math.sin(a) * r * 0.85, z=h, col=col)
    m.cbox(0.025, 0.012, 0.05, x=x, y=y - r, z=h * 0.65, col='coal')


# =====================================================================
# Budynki (wzorowane na grafikach budynkow pierwowzoru)
# =====================================================================

def castle(m):
    m.ico(0.62, z=-0.02, col='rock', sub=1, sz=0.2)
    for (x, y) in ((-0.5, -0.3), (0.45, -0.42), (-0.3, -0.48)):
        m.ico(0.07, x=x, y=y, z=0.02, col='leaf', sub=1, sz=0.6)
    m.box(1.0, 0.82, 0.32, z=0.04, col='whitewash')
    wall_detail(m, 'white', 1.0, 0.82, 0.32, 0, 0, 0.04, n_front=6, n_side=4)
    crenels(m, 1.0, 0.82, 0.36, n=5, col='whitewash')
    m.cbox(0.15, 0.03, 0.2, y=-0.42, z=0.14, col='plank_dark')
    m.cbox(0.19, 0.035, 0.03, y=-0.425, z=0.255, col='stone')
    m.box(0.44, 0.34, 0.86, y=0.12, z=0.04, col='whitewash')
    wall_detail(m, 'white', 0.44, 0.34, 0.86, 0, 0.12, 0.04)
    for sx in (-1, 1):
        window(m, sx * 0.1, 0.12 - 0.17, 0.72, 'front', shutters=False)
        window(m, sx * 0.1, 0.12 - 0.17, 0.5, 'front', shutters=False)
    roof(m, 0.44, 0.34, 0.2, y=0.12, z=0.9, col='terracotta', gable_col='whitewash', tiles=4, over=0.03)
    for (x, y, r, h) in ((-0.48, -0.39, 0.09, 0.72), (0.48, -0.39, 0.09, 0.72), (-0.48, 0.38, 0.1, 0.92),
                         (0.48, 0.38, 0.1, 0.92), (-0.28, 0.22, 0.08, 1.25), (0.3, 0.2, 0.075, 1.4),
                         (-0.13, -0.43, 0.06, 0.55), (0.13, -0.43, 0.06, 0.55)):
        slim_tower(m, r, h, x, y, cone_k=3.4)
    banner(m, 0.0, 0.12, 1.14, 0.32)
    return ROT


def warehouse(m):
    """Magazyn: bielony blok z trzema rownoleglymi dachami, okragle baszty, komin-wieza, schody."""
    m.box(0.64, 0.5, 0.04, col='stone_dark')
    m.box(0.6, 0.46, 0.34, z=0.04, col='whitewash')
    wall_detail(m, 'white', 0.6, 0.46, 0.34, 0, 0, 0.04, n_front=6, n_side=4)
    for x in (-0.2, 0.0, 0.2):
        roof(m, 0.46, 0.2, 0.14, x=x, z=0.38, col='terracotta', gable_col='whitewash', tiles=2, over=0.015, front=True)
    for x in (-0.18, 0.18):
        window(m, x, -0.23, 0.26, 'front', shutters=False)
    door(m, 0.0, -0.23, 0.04, w=0.12, col='plank')
    for (x, y) in ((-0.32, -0.25), (0.32, -0.25)):
        round_bastion(m, 0.08, 0.42, x, y)
    m.cyl(0.07, 0.62, 8, x=-0.12, y=0.26, col='whitewash')  # komin-wieza
    m.cyl(0.08, 0.03, 8, x=-0.12, y=0.26, z=0.62, col='stone')
    for i in range(2):  # schody
        m.box(0.16, 0.05, 0.03 - i * 0.012, y=-0.27 - i * 0.05, col='stone_light')
    barrel(m, -0.2, -0.34)
    return ROT


def woodcutter(m):
    """Chata drwala: bale, kamienny komin, pieniek z siekiera i sagi."""
    cabin(m, 0.44, 0.36, 0.2, wins=(), side_wins=True, has_door=False)
    double_door(m, 0.02, -0.18, w=0.14)
    chimney(m, -0.14, 0.08, 0.36, 0.2)
    log_pile(m, -0.34, -0.32, n=3, length=0.2, rz=R)
    m.cyl(0.055, 0.07, 8, x=0.32, y=-0.28, col='log')
    m.beam((0.31, -0.28, 0.07), (0.35, -0.28, 0.18), 0.012, 'wood')
    m.cbox(0.05, 0.008, 0.035, x=0.305, y=-0.28, z=0.09, col='metal', ry=0.4)
    return ROT


def forester(m):
    """Lesniczowka: chata z bali z szerokimi wrotami, swierk obok."""
    cabin(m, 0.46, 0.38, 0.22, wins=(), side_wins=False, has_door=False)
    double_door(m, 0.02, -0.19, w=0.18, h=0.18)
    fir(m, -0.34, -0.2, 1.0)
    fir(m, 0.34, 0.24, 0.7)
    for (x, y) in ((0.3, -0.3), (0.4, -0.2)):
        m.cone(0.035, 0.08, 5, x=x, y=y, col='leaf')
    return ROT


def sawmill(m):
    """Tartak: bielony dom szczytem do kamery z lukowym otworem, niska dobudowka z desek."""
    house(m, 0.36, 0.5, 0.26, 'white', front=True, x=0.1, y=0.04, wins=(), side_wins=True, has_door=False)
    m.cbox(0.16, 0.014, 0.2, x=0.1, y=-0.213, z=0.16, col='coal')  # lukowy otwor
    m.cyl(0.08, 0.014, 10, x=0.1, y=-0.213, z=0.26, col='coal', rx=R)
    lean_to(m, 0.3, 0.3, 0.22, x=-0.26, y=-0.08, posts=False)
    m.cyl(0.028, 0.3, 7, x=-0.42, y=-0.3, z=0.03, col='log', ry=R)
    plank_stack(m, 0.3, -0.34, 4)
    return ROT


def stonecutter(m):
    """Kamieniarz: chata z desek z kominem, sterta kamieni przed wejsciem."""
    cabin(m, 0.42, 0.36, 0.2, style='plank', wins=(1,), side_wins=False)
    chimney(m, -0.12, 0.06, 0.34, 0.2)
    for (x, y, r) in ((-0.3, -0.28, 0.08), (-0.18, -0.36, 0.06), (-0.38, -0.14, 0.06)):
        m.ico(r, x=x, y=y, col='stone_light', sub=1, sz=0.7)
    stone_blocks(m, 0.2, -0.36, 3)
    return ROT


def fisher(m):
    """Rybak: chata z desek na kamiennej podmurowce, szczyt z oknem, przybudowka i siec."""
    m.box(0.52, 0.44, 0.08, col='stone')
    house(m, 0.34, 0.36, 0.2, 'plank', front=True, found=0.08, wins=(), side_wins=True, y=0.02, x=-0.06)
    window(m, -0.06, -0.16, 0.26, 'front', shutters=False)
    lean_to(m, 0.18, 0.3, 0.24, x=0.2, y=0.02, posts=False)
    for x in (-0.3, -0.14, 0.02):  # biala siec na plotku
        m.box(0.016, 0.016, 0.14, x=x, y=-0.3, col='wood')
    m.cbox(0.32, 0.006, 0.1, x=-0.14, y=-0.3, z=0.08, col='white')
    for k in range(2):
        m.cbox(0.02, 0.012, 0.04, x=-0.2 + k * 0.1, y=-0.31, z=0.07, col='fish')
    return ROT


def hunter(m):
    cabin(m, 0.42, 0.36, 0.2, wins=(1,), side_wins=False)
    for s in (-1, 1):  # poroze nad drzwiami
        m.beam((0, -0.185, 0.32), (s * 0.05, -0.185, 0.39), 0.01, 'cream')
        m.beam((s * 0.03, -0.185, 0.36), (s * 0.06, -0.185, 0.36), 0.008, 'cream')
    m.box(0.015, 0.015, 0.24, x=-0.28, y=-0.26, col='wood')
    m.box(0.015, 0.015, 0.24, x=-0.4, y=-0.26, col='wood')
    m.cbox(0.1, 0.01, 0.12, x=-0.34, y=-0.26, z=0.15, col='deer')
    return ROT


def farm(m):
    """Farma: maly bielony dom z kominem, wysoki silos z desek, radlo i snopki."""
    house(m, 0.44, 0.36, 0.22, 'white', x=-0.26, y=0.12, chim=(-0.1, 0.08), wins=(1,))
    m.box(0.2, 0.2, 0.56, x=0.18, y=0.2, col='plank')
    wall_detail(m, 'plank', 0.2, 0.2, 0.56, 0.18, 0.2, 0)
    m.cbox(0.08, 0.012, 0.1, x=0.18, y=0.097, z=0.44, col='plank_dark')
    roof(m, 0.2, 0.2, 0.1, x=0.18, y=0.2, z=0.56, col='terracotta', gable_col='plank', tiles=2, over=0.02)
    # Radlo i tyczki na polu przed domem.
    m.beam((-0.1, -0.3, 0.0), (0.2, -0.2, 0.1), 0.02, 'wood')
    m.beam((0.14, -0.22, 0.0), (0.2, -0.2, 0.1), 0.016, 'wood_dark')
    m.cbox(0.06, 0.012, 0.04, x=-0.1, y=-0.3, z=0.02, col='metal')
    for (x, y) in ((0.42, -0.2), (0.5, -0.34), (-0.5, -0.3)):
        hay(m, x, y, 0.7)
    return ROT


def mill(m):
    """Mlyn: niska okragla kamienna wieza z malym stozkiem; duze plocienne skrzydla (osobny model)."""
    m.cyl(0.2, 0.05, 8, col='stone_dark')
    m.cyl(0.18, 0.5, 8, col='stone', r_top=0.14)
    for (u, z) in ((0.2, 0.15), (-0.3, 0.3), (0.5, 0.42), (-0.1, 0.46)):
        m.cbox(0.05, 0.012, 0.03, x=u * 0.18, y=-0.17 + abs(u) * 0.03, z=z, col='stone_light')
    m.cone(0.16, 0.14, 8, z=0.5, col='terracotta')
    m.cbox(0.08, 0.014, 0.12, y=-0.178, z=0.1, col='coal')
    door(m, 0.09, -0.16, 0.05, w=0.07, h=0.12, col='plank')
    m.cyl(0.035, 0.1, 6, y=-0.16, z=0.5, col='wood_dark', rx=R)
    return ROT


def mill_sails(m):
    """Duze skrzydla wiatraka z krata i plotnem: srodek w piascie."""
    for k in range(4):
        a = k * R + 0.35
        ca, sa = math.cos(a), math.sin(a)
        m.box(0.03, 0.012, 0.46, x=sa * 0.23, z=ca * 0.23 - 0.23, col='wood_dark', ry=a)
        m.cbox(0.13, 0.008, 0.32, x=sa * 0.28 + ca * 0.07, z=ca * 0.28 - sa * 0.07, col='white', ry=a)
        for j in range(4):
            f = 0.14 + j * 0.09
            m.cbox(0.14, 0.012, 0.01, x=sa * f + ca * 0.07, z=ca * f - sa * 0.07, col='wood', ry=a)
    return 0.0


def bakery(m):
    """Piekarnia: wyzsza bielona czesc z tylu, nizsza z przodu z duzym oknem pieca; komin z prawej."""
    house(m, 0.4, 0.26, 0.34, 'white', x=-0.04, y=0.14, wins=(-1,), side_wins=True, has_door=False)
    house(m, 0.46, 0.26, 0.18, 'white', x=0.02, y=-0.12, wins=(), side_wins=False, has_door=False)
    m.cbox(0.14, 0.014, 0.1, x=-0.08, y=-0.253, z=0.14, col='coal')  # okno pieca
    m.cbox(0.1, 0.016, 0.03, x=-0.08, y=-0.256, z=0.1, col='fire')
    door(m, 0.14, -0.25, 0.04, col='plank')
    chimney(m, 0.3, 0.14, 0.2, 0.44)
    return ROT


def pigfarm(m):
    """Chlewnia: bielony dom z duzymi oknami i osobna skrzynia-chlew z desek, plot."""
    house(m, 0.42, 0.34, 0.24, 'white', x=-0.3, y=0.1, wins=(-1, 1))
    m.box(0.34, 0.28, 0.22, x=0.28, y=0.08, col='plank')
    wall_detail(m, 'plank', 0.34, 0.28, 0.22, 0.28, 0.08, 0)
    m.cbox(0.38, 0.32, 0.03, x=0.28, y=0.08, z=0.25, col='terracotta', rx=0.2)
    m.cbox(0.1, 0.012, 0.1, x=0.28, y=-0.063, z=0.05, col='plank_dark')
    fence(m, -0.1, -0.46, 0.6, -0.46, posts=5)
    fence(m, 0.6, -0.46, 0.6, -0.08, posts=3)
    for (x, y, r) in ((0.2, -0.3, 0.4), (0.42, -0.24, -0.8)):
        m.cbox(0.08, 0.13, 0.07, x=x, y=y, z=0.06, col='pig', rz=r)
        m.cbox(0.06, 0.05, 0.05, x=x - math.sin(r) * 0.08, y=y - math.cos(r) * 0.08, z=0.07, col='pig', rz=r)
        for (dx, dy) in ((-0.025, -0.04), (0.025, -0.04), (-0.025, 0.04), (0.025, 0.04)):
            m.box(0.018, 0.018, 0.03, x=x + dx, y=y + dy, col='pig')
    return ROT


def butcher(m):
    """Rzeznia: dlugi dom - czesc z desek i czesc bielona pod jednym duzym dachem, kamienny komin."""
    m.box(0.73, 0.43, 0.04, col='stone_dark')
    m.box(0.3, 0.4, 0.3, x=-0.21, z=0.04, col='plank')
    wall_detail(m, 'plank', 0.3, 0.4, 0.3, -0.21, 0, 0.04)
    m.box(0.4, 0.4, 0.3, x=0.14, z=0.04, col='whitewash')
    wall_detail(m, 'white', 0.4, 0.4, 0.3, 0.14, 0, 0.04, n_side=0)
    m.cbox(0.1, 0.014, 0.09, x=-0.22, y=-0.203, z=0.2, col='coal')
    m.cbox(0.12, 0.014, 0.09, x=0.25, y=-0.203, z=0.2, col='coal')
    door(m, 0.04, -0.2, 0.04, col='plank')
    roof(m, 0.72, 0.4, 0.2, z=0.34, col='terracotta', gable_col='plank', tiles=4, over=0.03)
    chimney(m, -0.26, 0.06, 0.36, 0.3)
    return ROT


def mine(m, ore, stone_shed=False):
    """Kopalnia: A-rama z szopka na szczycie, pod nia szopa, kupka urobku z przodu."""
    headframe(m, 0.0, 0.14)
    house(m, 0.3, 0.24, 0.16, 'stone' if stone_shed else 'plank', x=0.02, y=-0.08, wins=(), side_wins=False, found=0.03)
    for (x, y, r) in ((-0.2, -0.26, 0.08), (-0.1, -0.32, 0.06), (-0.28, -0.14, 0.05)):
        m.ico(r, x=x, y=y, col=ore, sub=1, sz=0.65)
    return ROT


def coalmine(m):
    return mine(m, 'coal')


def ironmine(m):
    return mine(m, 'iron_ore')


def goldmine(m):
    mine(m, 'gold_ore')
    for (x, y, z) in ((-0.2, -0.26, 0.08), (-0.1, -0.32, 0.06), (-0.25, -0.2, 0.2), (0.2, 0.1, 0.4), (0.24, -0.1, 0.3)):
        m.cbox(0.02, 0.02, 0.02, x=x, y=y, z=z, col='fire_core', rz=0.7)
    return ROT


def stonemine(m):
    return mine(m, 'stone_light', stone_shed=True)


def steelworks(m):
    """Huta: bielony dom z dwoch czesci - nizsza z lewej, wyzsza z kamiennym kominem z prawej."""
    house(m, 0.34, 0.4, 0.3, 'white', x=0.14, y=0.06, wins=(1,), side_wins=False, chim=(0.0, 0.06))
    house(m, 0.3, 0.34, 0.18, 'white', x=-0.2, y=0.0, wins=(-1,), side_wins=True, has_door=False)
    m.cbox(0.06, 0.016, 0.04, x=-0.14, y=-0.174, z=0.1, col='fire')
    return ROT


def mint(m):
    """Mennica: dol z kamienia, gora z desek, dach z dachowek, szyld ze zlotem na slupku."""
    m.box(0.52, 0.44, 0.04, col='stone_dark')
    m.box(0.5, 0.42, 0.2, z=0.04, col='stone')
    wall_detail(m, 'stone', 0.5, 0.42, 0.2, 0, 0, 0.04, n_front=5, n_side=3)
    door(m, -0.02, -0.21, 0.04, col='plank')
    window(m, -0.16, -0.21, 0.15, 'front', shutters=False)
    window(m, 0.14, -0.21, 0.15, 'front', shutters=False)
    m.box(0.54, 0.46, 0.18, z=0.24, col='plank')
    wall_detail(m, 'plank', 0.54, 0.46, 0.18, 0, 0, 0.24)
    window(m, 0.0, -0.23, 0.33, 'front', shutters=False)
    roof(m, 0.54, 0.46, 0.16, z=0.42, col='terracotta', gable_col='plank', tiles=4, over=0.03)
    chimney(m, 0.12, 0.1, 0.44, 0.2)
    m.box(0.02, 0.02, 0.24, x=0.36, y=-0.3, col='wood_dark')  # szyld
    m.cbox(0.13, 0.014, 0.12, x=0.36, y=-0.31, z=0.24, col='wood_dark')
    m.cbox(0.08, 0.016, 0.07, x=0.36, y=-0.317, z=0.24, col='gold')
    return ROT


def toolmaker(m):
    """Narzedziownia: dlugi bielony dom z duzym ciemnym wejsciem; z tylu kamienna wieza z czterospadowym dachem i wiatrowskazem."""
    house(m, 0.6, 0.36, 0.24, 'white', x=0.0, y=-0.04, wins=(-1,), side_wins=True, has_door=False)
    m.cbox(0.14, 0.014, 0.18, x=0.1, y=-0.223, z=0.13, col='coal')
    m.box(0.18, 0.18, 0.56, x=0.02, y=0.24, col='stone')
    wall_detail(m, 'stone', 0.18, 0.18, 0.56, 0.02, 0.24, 0, n_front=3, n_side=3)
    m.cbox(0.05, 0.012, 0.06, x=0.02, y=0.147, z=0.46, col='coal')
    m.hip(0.18, 0.18, 0.14, x=0.02, y=0.24, z=0.56, col='terracotta', overhang=0.02)
    m.cyl(0.006, 0.1, 4, x=0.02, y=0.24, z=0.7, col='metal_dark')
    m.cbox(0.06, 0.004, 0.03, x=0.045, y=0.24, z=0.78, col='metal_dark')
    chimney(m, -0.22, 0.0, 0.3, 0.2)
    return ROT


def weaponsmith(m):
    """Zbrojownia: bielony dom, z lewej otwarta kuznia z zarem pod dachem, komin, szyld na wysiegniku."""
    m.box(0.72, 0.44, 0.04, col='stone_dark')
    m.box(0.42, 0.42, 0.3, x=0.12, z=0.04, col='whitewash')
    wall_detail(m, 'white', 0.42, 0.42, 0.3, 0.12, 0, 0.04, n_side=0)
    for (x, y) in ((-0.34, -0.19), (-0.34, 0.19)):
        m.box(0.03, 0.03, 0.3, x=x, y=y, z=0.04, col='plank_dark')
    m.box(0.25, 0.03, 0.3, x=-0.22, y=0.19, z=0.04, col='plank')
    m.box(0.16, 0.14, 0.1, x=-0.2, y=0.0, z=0.04, col='stone')  # palenisko
    m.cbox(0.12, 0.1, 0.02, x=-0.2, y=0.0, z=0.15, col='fire')
    m.cbox(0.06, 0.06, 0.02, x=-0.2, y=0.0, z=0.16, col='fire_core')
    anvil(m, -0.16, -0.22)
    door(m, 0.2, -0.21, 0.04, col='plank')
    window(m, 0.02, -0.21, 0.22, 'front', shutters=False)
    roof(m, 0.72, 0.42, 0.2, z=0.34, col='terracotta', gable_col='plank', tiles=4, over=0.03)
    chimney(m, -0.28, 0.08, 0.36, 0.3)
    m.beam((0.33, -0.21, 0.28), (0.33, -0.33, 0.28), 0.014, 'wood_dark')  # szyld na wysiegniku
    m.cbox(0.012, 0.012, 0.03, x=0.33, y=-0.31, z=0.26, col='metal_dark')
    m.cbox(0.08, 0.014, 0.08, x=0.33, y=-0.31, z=0.21, col='red')
    m.cbox(0.012, 0.016, 0.1, x=0.33, y=-0.316, z=0.21, col='white', ry=0.7)
    return ROT


def shipyard(m):
    """Stocznia: otwarta szopa z desek z lodzia na pochylni."""
    for (x, y) in ((-0.28, -0.26), (0.28, -0.26), (-0.28, 0.24), (0.28, 0.24)):
        m.box(0.035, 0.035, 0.3, x=x, y=y, col='plank_dark')
    m.box(0.56, 0.03, 0.3, y=0.24, col='plank')
    roof(m, 0.58, 0.52, 0.2, z=0.3, col='plank', gable_col='plank', tiles=3, over=0.03)
    m.wedge(0.44, 0.16, 0.08, x=0.0, y=-0.02, z=0.02, col='wood_dark', rz=R)
    m.cbox(0.34, 0.15, 0.07, x=0.0, y=-0.02, z=0.1, col='plank')
    for k in range(4):
        m.cbox(0.012, 0.16, 0.085, x=-0.12 + k * 0.08, y=-0.02, z=0.12, col='plank_dark')
    plank_stack(m, -0.1, -0.38, 3)
    return ROT


def guardhut(m):
    """Wachhutte: kwadratowa kamienna chata pod czterospadowym dachem."""
    m.box(0.36, 0.34, 0.04, col='stone_dark')
    m.box(0.32, 0.3, 0.24, z=0.04, col='stone')
    wall_detail(m, 'stone', 0.32, 0.3, 0.24, 0, 0, 0.04, n_front=5, n_side=4)
    door(m, 0.06, -0.15, 0.04, w=0.08, h=0.15, col='plank')
    window(m, -0.08, -0.15, 0.2, 'front', shutters=False)
    m.hip(0.32, 0.3, 0.2, z=0.28, col='terracotta', overhang=0.03)
    for k in range(1, 3):
        f = k / 3
        m.cbox(0.38 - f * 0.32, 0.012, 0.012, y=-0.18 * (1 - f) - 0.004, z=0.28 + 0.2 * f + 0.006, col='terracotta_dark',
               rx=math.atan2(0.2, 0.18))
    banner(m, 0.0, 0.0, 0.46, 0.22)
    return ROT


def tower_building(m):
    """Wachturm: wysoka kwadratowa kamienna wieza z czterospadowym dachem, z przodu mur z blankami i brama."""
    m.box(0.3, 0.3, 0.04, x=0.02, y=0.1, col='stone_dark')
    m.box(0.26, 0.26, 0.86, x=0.02, y=0.1, z=0.04, col='stone')
    wall_detail(m, 'stone', 0.26, 0.26, 0.86, 0.02, 0.1, 0.04, n_front=6, n_side=5)
    for z in (0.52, 0.72):
        m.cbox(0.03, 0.014, 0.07, x=0.02, y=-0.033, z=z, col='coal')
    m.hip(0.28, 0.28, 0.22, x=0.02, y=0.1, z=0.9, col='terracotta', overhang=0.025)
    m.box(0.44, 0.1, 0.26, x=0.02, y=-0.12, col='stone')
    wall_detail(m, 'stone', 0.44, 0.1, 0.26, 0.02, -0.12, 0, n_front=4, n_side=1)
    crenels(m, 0.44, 0.1, 0.26, x=0.02, y=-0.12, n=4, col='stone')
    door(m, 0.02, -0.17, 0.0, w=0.09, h=0.16, col='plank')
    banner(m, 0.02, 0.1, 1.12, 0.22)
    return ROT


def fortress(m):
    """Wachburg: wysoki blok z czerwonym dachem, okragle baszty z blankami, brama."""
    m.box(0.98, 0.84, 0.04, col='stone_dark')
    m.box(0.94, 0.8, 0.3, z=0.04, col='stone')
    wall_detail(m, 'stone', 0.94, 0.8, 0.3, 0, 0, 0.04, n_front=6, n_side=4)
    crenels(m, 0.94, 0.8, 0.34, n=4, col='stone_light')
    m.cbox(0.16, 0.03, 0.2, y=-0.41, z=0.14, col='plank_dark')
    m.box(0.5, 0.36, 0.56, x=-0.12, y=0.14, z=0.04, col='whitewash')
    wall_detail(m, 'white', 0.5, 0.36, 0.56, -0.12, 0.14, 0.04)
    for z in (0.34, 0.5):
        for sx in (-1, 1):
            window(m, -0.12 + sx * 0.12, 0.14 - 0.18, z, 'front', shutters=False)
    roof(m, 0.5, 0.36, 0.2, x=-0.12, y=0.14, z=0.6, col='terracotta', gable_col='whitewash', tiles=4, over=0.03)
    for (x, y, h) in ((-0.47, -0.4, 0.5), (0.47, -0.4, 0.5), (0.47, 0.4, 0.62), (0.3, 0.2, 0.74)):
        round_bastion(m, 0.11, h, x, y, col='stone')
    banner(m, -0.12, 0.14, 0.82, 0.3)
    return ROT


def guardhouse(m):
    """Wartownia: kamienny dom z okragla baszta z blankami."""
    house(m, 0.4, 0.34, 0.22, 'stone', x=0.06, y=-0.04, wins=(1,), side_wins=True)
    round_bastion(m, 0.1, 0.56, -0.2, 0.12, col='stone')
    banner(m, -0.2, 0.12, 0.58, 0.22)
    return ROT


def well(m):
    m.cyl(0.14, 0.15, 10, col='stone')
    m.cyl(0.145, 0.02, 10, z=0.15, col='stone_light')
    m.cyl(0.11, 0.005, 10, z=0.13, col='water')
    for x in (-0.13, 0.13):
        m.box(0.03, 0.03, 0.34, x=x, col='plank_dark')
    roof(m, 0.28, 0.12, 0.07, z=0.34, col='terracotta', over=0.015, tiles=2, gable_col='plank')
    m.cyl(0.022, 0.26, 6, x=-0.13, z=0.28, col='wood', ry=R)
    m.beam((0.13, 0.0, 0.28), (0.19, 0.0, 0.24), 0.012, 'wood_dark')
    m.beam((0.0, 0.0, 0.28), (0.0, 0.0, 0.2), 0.004, 'wood_dark')
    m.cyl(0.035, 0.05, 7, y=0.0, z=0.16, col='wood')
    return ROT


def brewery(m):
    """Browar: bielony dom z przybudowka z desek, beczki i miedziany kociol."""
    house(m, 0.42, 0.4, 0.26, 'white', x=0.12, y=0.04, wins=(1,), side_wins=False, chim=(0.1, 0.1))
    house(m, 0.28, 0.32, 0.18, 'plank', x=-0.24, y=0.0, wins=(), side_wins=True, has_door=False)
    m.cyl(0.07, 0.09, 8, x=-0.3, y=-0.26, col='copper')
    m.cone(0.07, 0.05, 8, x=-0.3, y=-0.26, z=0.09, col='copper')
    for (x, y, z) in ((0.2, -0.3, 0), (0.3, -0.26, 0), (0.25, -0.28, 0.1)):
        barrel(m, x, y, z)
    return ROT


def donkeybreeder(m):
    house(m, 0.3, 0.3, 0.2, 'white', x=-0.44, y=0.16, wins=(), side_wins=True)
    m.box(0.56, 0.36, 0.26, x=0.1, y=0.16, col='plank')
    wall_detail(m, 'plank', 0.56, 0.36, 0.26, 0.1, 0.16, 0)
    for x in (-0.08, 0.12, 0.3):
        m.cbox(0.1, 0.014, 0.12, x=x, y=-0.023, z=0.1, col='plank_dark')
    roof(m, 0.56, 0.36, 0.14, x=0.1, y=0.16, z=0.26, col='terracotta', gable_col='plank', tiles=3, over=0.03)
    fence(m, -0.6, -0.5, 0.58, -0.5, posts=6)
    fence(m, 0.58, -0.5, 0.58, -0.08, posts=3)
    m.cbox(0.2, 0.09, 0.09, x=0.3, y=-0.3, z=0.14, col='donkey')
    m.cbox(0.08, 0.06, 0.07, x=0.43, y=-0.3, z=0.2, col='donkey', ry=0.4)
    for s in (-1, 1):
        m.beam((0.44, -0.3 + s * 0.015, 0.23), (0.44, -0.3 + s * 0.02, 0.29), 0.012, 'donkey_dark')
    for (dx, dy) in ((-0.07, -0.03), (0.07, -0.03), (-0.07, 0.03), (0.07, 0.03)):
        m.box(0.025, 0.025, 0.1, x=0.3 + dx, y=-0.3 + dy, col='donkey_dark')
    hay(m, -0.2, -0.3)
    return ROT


def charburner(m):
    cabin(m, 0.36, 0.3, 0.18, x=-0.3, y=0.2, wins=(), side_wins=True)
    m.ico(0.3, x=0.22, y=-0.06, col='coal', sub=1, sz=0.55)
    m.ico(0.23, x=0.22, y=-0.06, z=0.04, col='soil', sub=1, sz=0.6)
    for k in range(3):
        m.cone(0.05 - k * 0.012, 0.08, 5, x=0.22 + k * 0.02, y=-0.06, z=0.17 + k * 0.08, col='smoke')
    log_pile(m, -0.35, -0.3, n=5, rz=0.2)
    return ROT


def catapult(m):
    house(m, 0.3, 0.26, 0.18, 'stone', x=-0.3, y=0.26, wins=(), side_wins=False, found=0.03)
    m.box(0.46, 0.34, 0.05, x=0.1, y=-0.06, z=0.04, col='plank_dark')
    for x in (-0.08, 0.28):
        for y in (-0.22, 0.1):
            m.cyl(0.05, 0.03, 10, x=x, y=y, col='plank', rx=R)
    for x in (0.02, 0.18):
        m.beam((x, 0.02, 0.09), (x, -0.06, 0.32), 0.03, 'plank')
        m.beam((x, -0.14, 0.09), (x, -0.06, 0.32), 0.03, 'plank')
    m.cbox(0.22, 0.04, 0.04, x=0.1, y=-0.06, z=0.32, col='plank_dark')
    m.beam((0.1, 0.14, 0.18), (0.1, -0.28, 0.46), 0.035, 'wood_light')
    m.cyl(0.05, 0.035, 8, x=0.1, y=-0.28, z=0.46, col='plank_dark')
    m.ico(0.035, x=0.1, y=-0.28, z=0.5, col='stone', sub=1)
    m.box(0.1, 0.1, 0.09, x=0.1, y=0.16, z=0.09, col='stone_dark')
    stone_blocks(m, 0.38, 0.2, 3)
    return ROT


def site(size):
    def f(m):
        w = {'small': 0.55, 'medium': 0.72, 'large': 1.2}[size]
        m.box(w, w * 0.85, 0.03, col='wood_light')
        for (x, y) in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
            m.box(0.035, 0.035, 0.4, x=x * w * 0.45, y=y * w * 0.38, col='plank')
        for sy in (-1, 1):
            m.beam((-w * 0.45, sy * w * 0.38, 0.32), (w * 0.45, sy * w * 0.38, 0.32), 0.022, 'plank')
            m.beam((-w * 0.45, sy * w * 0.38, 0.05), (w * 0.45, sy * w * 0.38, 0.3), 0.016, 'plank_dark')
        m.box(0.06, 0.18, 0.12, x=-w * 0.3, y=-w * 0.5, col='wood_dark')
        m.cbox(0.012, 0.012, 0.16, x=-w * 0.3, y=-w * 0.5, z=0.16, col='wood', rx=0.4)
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
    build(BUILDERS, ao=0.35)
