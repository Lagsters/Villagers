"""
Budynki (building_<rodzaj> wg numeracji z sim/defs.ts), place budowy i skrzydla wiatraka.
Styl: dachy z terakoty z dachowkami w szachownice, sciany bielone, z desek albo z bali, wysokie sciany
i niskie dachy (czytelne z kamery), kazdy budynek z wlasna sylwetka (wieza wyciagowa kopalni,
silos farmy, smukle wieze zamku, przysadzista chata wartownicza...).
Front (drzwi) modelujemy na -Y; build() obraca model o 30 stopni, zeby patrzyl na flage (SE).
Budzety trojkatow: chata <= 800, dom <= 1200, duzy <= 2000.
Uruchomienie: blender --background --python art/scripts/buildings.py [-- nazwa ...]
"""
import math
import os
import sys

import bmesh

sys.path.insert(0, os.path.dirname(__file__))
from lib import LOGS, PLANKS, TARPAPER, TILES, build  # noqa: E402

ROT = 30.0
R = math.pi / 2


# =====================================================================
# Architektura
# =====================================================================

def hsh(i, j, salt=0):
    """Deterministyczna liczba z [0, 1) dla komorki wzoru."""
    return (((i + 7) * 73856093) ^ ((j + 3) * 19349663) ^ ((salt + 1) * 83492791)) % 1000 / 1000


def cuts(lo, hi, step):
    """Rowne ciecia przedzialu [lo, hi] co mniej wiecej step (bez koncow)."""
    n = max(1, round((hi - lo) / step))
    return [lo + (hi - lo) * k / n for k in range(1, n)]


def roofing(col):
    """Wzor polaci wg pokrycia: dachowki, papa albo deski."""
    return {'terracotta': TILES, 'tarpaper': TARPAPER}.get(col, PLANKS)


def roof(m, w, d, h, x=0.0, y=0.0, z=0.0, col='roof_red', over=0.04, gable_col='plaster', ridge=None,
         front=False, frame=None):
    """Dach dwuspadowy: grube polacie z dachowkami w szachownice (malowanymi, plaskimi), okragla
    kalenica i sciany szczytowe. w = dlugosc kalenicy, d = rozpietosc. Domyslnie kalenica wzdluz X;
    front=True - wzdluz Y (szczyt od frontu). frame = kolor belek szachulca na szczycie frontowym."""
    rz = R if front else 0.0

    def P(lx, ly):
        return (x - ly, y + lx) if front else (x + lx, y + ly)

    t = 0.024
    m.gable(w, d, h, x=x, y=y, z=z, col=gable_col, overhang=0.0, rz=rz, wall=PATTERN_OF.get(gable_col, 0))
    ye = d / 2 + over
    drop = over * h / (d / 2)
    dz = h + drop
    length = math.hypot(ye, dz)
    ang = math.atan2(dz, ye)
    W = w + 2 * over
    dark = 'tile_dark' if col == 'terracotta' else col + '_dark'
    for s in (-1, 1):
        cz = z - drop + dz / 2 + t / 2
        px, py = P(0, s * ye / 2)
        m.block(W, length, t, x=px, y=py, z=cz, col=col, rx=-s * ang, rz=rz, center=True, bevel=0.0,
                open_sides=('-z',), slope=roofing(col))
    # Kalenica z gasiorow.
    m.cyl(0.02, W + 0.02, 8, x=P(-W / 2 - 0.01, 0)[0], y=P(-W / 2 - 0.01, 0)[1], z=z + h + 0.016, col=ridge or dark,
          ry=R if not front else 0.0, rx=-R if front else 0.0)
    if frame:
        # Szachulec na szczycie: slup krolewski, jetka i zastrzaly.
        gx = -w / 2 - 0.006
        pts = [((gx, 0, z), (gx, 0, z + h)), ((gx, -d * 0.25, z + h * 0.5), (gx, d * 0.25, z + h * 0.5)),
               ((gx, -d * 0.38, z), (gx, -d * 0.12, z + h * 0.5)), ((gx, d * 0.38, z), (gx, d * 0.12, z + h * 0.5))]
        for (a0, a1) in pts:
            q0, q1 = P(a0[0], a0[1]), P(a1[0], a1[1])
            m.beam((q0[0], q0[1], a0[2]), (q1[0], q1[1], a1[2]), 0.022, frame)
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
    m.doors.append((x, y, z, w))
    m.cbox(w + 0.03, 0.014, h + 0.02, x=x, y=y - 0.004, z=z + h / 2 + 0.005, col='wood_dark')
    m.block(w, 0.018, h, x=x, y=y - 0.009, z=z, col=col, bevel=0.0, open_sides=('+y', '-z'), wall=PLANKS)
    m.cbox(0.012, 0.02, 0.012, x=x + w * 0.3, y=y - 0.02, z=z + h * 0.45, col='metal_dark')
    m.cbox(w + 0.06, 0.05, 0.03, x=x, y=y - 0.03, z=0.015, col='plinth')


def chimney(m, x, y, z, h=0.2, col='whitewash'):
    """Komin bielony z kamieniami, z kamienna czapa."""
    m.block(0.08, 0.08, h, x=x, y=y, z=z, col=col, bevel=0.008, paint=wall_paint('white', 0.08, 0.08, h, step=0.05), open_sides=('-z', '+z'))
    m.block(0.1, 0.1, 0.028, x=x, y=y, z=z + h, col='stone_light', bevel=0.0)
    m.cbox(0.06, 0.06, 0.004, x=x, y=y, z=z + h + 0.028, col='coal')


def crenels(m, w, d, z, x=0.0, y=0.0, col='stone_light', n=4):
    for i in range(n):
        t = (i + 0.5) / n - 0.5
        for (cx, cy) in ((x + t * w, y - d / 2), (x + t * w, y + d / 2), (x - w / 2, y + t * d), (x + w / 2, y + t * d)):
            m.block(0.06, 0.06, 0.06, x=cx, y=cy, z=z, col=col, bevel=0.0, open_sides=('-z',))


def banner(m, x, y, z, h=0.3):
    m.cyl(0.012, h, 4, x=x, y=y, z=z, col='wood_dark')
    m.ico(0.016, x=x, y=y, z=z + h, col='gold', sub=0)


# =====================================================================
# Rekwizyty
# =====================================================================

def barrel(m, x, y, z=0.0, r=0.045, h=0.1):
    m.cyl(r, h, 8, x=x, y=y, z=z, col='wood', bands=[h * 0.16, h * 0.26, h * 0.7, h * 0.8], bottom=z > 0,
          paint=lambda k, j: 'metal_dark' if j in (1, 3) else None)


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
        m.cyl(r, length, 8, x=px - length / 2 * c, y=py - length / 2 * s, z=r + j * r * 1.75, col='log', ry=R, rz=0)


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
# Styl osady: dachy z terakoty z dachowkami w szachownice, sciany bielone (kamien z widocznymi
# kamieniami), z desek albo z bali. Kamera widzi front (-Y) i lewy bok (-X) modelu.
# =====================================================================

WALL = {'white': 'whitewash', 'plank': 'plank', 'log': 'log_o', 'stone': 'stone'}
PATTERN_OF = {'plank': PLANKS, 'log_o': LOGS}


def wall_paint(style, w, d, h, step=0.06, sides=('-y', '-x', '+y', '+x')):
    """Kamienie malowane na plaskiej bryle (biel, kamien ciosany); deski i bale rysuje shader (PATTERN_OF)."""
    paint = {}
    for n, side in enumerate(sides):
        span = w if side[1] == 'y' else d
        if style == 'white':
            if side[0] == '+':
                continue  # tyl: sama biel (oszczednosc trojkatow)
            paint[side] = (cuts(-span / 2, span / 2, step), cuts(0, h, step * 0.8),
                           lambda i, j, s=n: 'stone_pale' if hsh(i, j, s) < 0.2 else ('stone_light' if hsh(i, j, s) < 0.26 else None))
        elif style == 'stone':
            if side[0] == '+':
                continue
            paint[side] = (cuts(-span / 2, span / 2, step), cuts(0, h, step * 0.75),
                           lambda i, j, s=n: ('stone_light' if hsh(i, j, s) < 0.3 else 'stone_dark' if hsh(i, j, s) < 0.42
                                              else 'stone_pale' if hsh(i, j, s) < 0.52 else None))
    return paint


def wall(m, style, w, d, h, x=0.0, y=0.0, z=0.0, step=0.075, top=False):
    """Sciana-bryla w danym stylu (wzor malowany, sfazowane naroza); top=True - z wierzchem (bez dachu)."""
    return m.block(w, d, h, x=x, y=y, z=z, col=WALL[style], bevel=0.0 if style == 'log' else 0.01, paint=wall_paint(style, w, d, h, step),
                   open_sides=('-z',) if top else ('-z', '+z'), wall=PATTERN_OF.get(WALL[style], 0))


def house(m, w, d, h, style='white', roof_col=None, front=False, x=0.0, y=0.0, roof_h=None, wins=(-1, 1),
          side_wins=True, has_door=True, door_x=0.0, door_w=0.1, found=0.04, chim=None, detail=True, hip=False):
    """Dom w stylu osady (hip=True - dach czterospadowy). Zwraca wysokosc okapu.
    Domyslne pokrycie: papa na scianach z drewna (bale, deski), dachowka na murowanych."""
    roof_col = roof_col or ('tarpaper' if style in ('log', 'plank') else 'terracotta')
    span = w if front else d
    h *= 1.5  # wysokie sciany, niskie dachy - czytelne z kamery z gory
    roof_h = roof_h if roof_h is not None else span * 0.3
    m.block(w + 0.03, d + 0.03, found, x=x, y=y, col='plinth', bevel=0.008, open_sides=('-z',))
    if detail:
        wall(m, style, w, d, h, x, y, found)
    else:
        m.block(w, d, h, x=x, y=y, z=found, col=WALL[style], bevel=0.01, open_sides=('-z', '+z'))
    top = found + h
    for wx in wins:
        window(m, x + wx * w * 0.3, y - d / 2, found + h * 0.6, 'front', shutters=False)
    if side_wins:
        window(m, x - w / 2, y, found + h * 0.6, 'left', shutters=False)
    if has_door:
        door(m, x + door_x, y - d / 2, found, w=door_w, h=min(0.17, h * 0.72), col='plank')
    gable = WALL[style]
    if hip:
        m.hip(w, d, roof_h * 1.2, x=x, y=y, z=top, col=roof_col, overhang=0.035, slope=roofing(roof_col))
    elif front:
        roof(m, d, w, roof_h, x=x, y=y, z=top, col=roof_col, gable_col=gable, front=True, over=0.035)
    else:
        roof(m, w, d, roof_h, x=x, y=y, z=top, col=roof_col, gable_col=gable, over=0.035)
    if chim:
        chimney(m, x + chim[0], y + chim[1], top + 0.02, roof_h + 0.06)
    return top


def lean_to(m, w, d, h, x, y, col='tarpaper', posts=True, style='plank'):
    """Przybudowka z dachem jednospadowym (opadajacym ku -Y)."""
    if posts:
        for (px, py) in ((x - w / 2 + 0.02, y - d / 2 + 0.02), (x + w / 2 - 0.02, y - d / 2 + 0.02)):
            m.block(0.03, 0.03, h * 0.8, x=px, y=py, col='plank_dark', bevel=0.005)
    else:
        # Sciany do dachu: wierzch opada razem z nim (z tylu wyzej), bez szpary pod dachem z bokow i z tylu.
        ob = wall(m, style, w, d, h * 0.8, x, y)
        for v in ob.data.vertices:
            if v.co.z > h * 0.8 - 1e-4:
                v.co.z = h * 0.8 + h * 0.35 * (v.co.y - (y - d / 2)) / d
    ang = math.atan2(h * 0.35, d)
    W, L = w + 0.06, d / math.cos(ang) + 0.06
    m.block(W, L, 0.03, x=x, y=y, z=h * 0.8 + h * 0.175, col=col, rx=ang, center=True, bevel=0.0, open_sides=('-z',),
            slope=roofing(col))


def double_door(m, x, y, z=0.04, w=0.16, h=0.17):
    m.doors.append((x, y, z, w))
    m.cbox(w + 0.03, 0.014, h + 0.02, x=x, y=y - 0.004, z=z + h / 2, col='plank_dark')
    for s in (-1, 1):
        m.block(w / 2 - 0.006, 0.018, h, x=x + s * w / 4, y=y - 0.01, z=z - 0.005, col='plank', bevel=0.0, open_sides=('+y', '-z'), wall=PLANKS)
    m.beam((x - w / 2 + 0.01, y - 0.021, z + 0.02), (x + w / 2 - 0.01, y - 0.021, z + h - 0.02), 0.012, 'plank_dark')


def fir(m, x, y, s=1.0):
    m.cyl(0.02 * s, 0.08 * s, 5, x=x, y=y, col='bark')
    m.cone(0.11 * s, 0.2 * s, 7, x=x, y=y, z=0.06 * s, col='pine')
    m.cone(0.08 * s, 0.17 * s, 7, x=x, y=y, z=0.17 * s, col='pine_dark')


def slim_tower(m, r, h, x, y, col='whitewash', roof_col='terracotta', seg=12, cone_k=3.0, pole=True, stones=True, ring=True):
    """Smukla wieza z wysokim, spiczastym dachem (stones=False - gladka biel, mniej trojkatow)."""
    if stones:
        m.cyl(r * 1.06, h, seg, x=x, y=y, col=col, r_top=r, bands=cuts(0, h, 0.09), paint=tower_stones(col), bottom=False)
    else:
        m.cyl(r * 1.06, h, seg, x=x, y=y, col=col, r_top=r, bottom=False)
    if ring:
        m.cyl(r * 1.15, 0.035, seg, x=x, y=y, z=h, col='stone_light')
    ch = r * cone_k
    m.cone(r * 1.3, ch, seg, x=x, y=y, z=h + (0.035 if ring else 0.0), col=roof_col, bottom=False, slope=TILES)
    m.cbox(0.03, 0.02, 0.06, x=x, y=y - r, z=h * 0.7, col='glass')
    m.cbox(0.02, 0.03, 0.06, x=x - r, y=y, z=h * 0.45, col='glass')
    if pole:
        m.cyl(0.007, 0.08, 4, x=x, y=y, z=h + 0.035 + r * cone_k - 0.02, col='wood_dark')


def cabin(m, w, d, h, x=0.0, y=0.0, style='log', roof_h=None, **kw):
    """Chata z bali/desek: dluga sciana do kamery, szczyt po lewej."""
    return house(m, w, d, h, style, x=x, y=y, roof_h=roof_h, **kw)


def headframe(m, x, y, h=0.5):
    """Wieza wyciagowa kopalni: A-rama z dwoch par nog i szopka z desek na szczycie; przed szopka lozysko
    kola linowego (kolo rysuje gra - kreci sie przy wyciaganiu urobku) i dwie liny schodzace do szybu."""
    for sy in (-0.04, 0.04):
        for sx in (-1, 1):
            m.beam((x + sx * 0.13, y + sy, 0), (x + sx * 0.06, y + sy, h), 0.026, 'plank')
    for zz in (0.18, 0.34):
        k = zz / h
        r = 0.13 + (0.06 - 0.13) * k
        m.beam((x - r, y - 0.045, zz), (x + r, y - 0.045, zz), 0.018, 'plank_dark')
    # Szopka na szczycie (szczelinowe deski) z daszkiem.
    m.block(0.17, 0.12, 0.13, x=x, y=y, z=h, col='plank', bevel=0.0, wall=PLANKS)
    roof(m, 0.17, 0.12, 0.07, x=x, y=y, z=h + 0.13, col='tarpaper', over=0.02, gable_col='plank')
    # Lozysko kola (MINE.sheave w industry.ts: os w (x, y - 0.09, h + 0.055), promien kola 0.075) i liny.
    m.beam((x, y - 0.06, h + 0.055), (x, y - 0.078, h + 0.055), 0.024, 'wood_dark')
    for sx in (-1, 1):
        m.beam((x + sx * 0.074, y - 0.09, h + 0.055), (x + sx * 0.074, y - 0.09, 0.27), 0.006, 'black')


def tower_stones(col):
    """Wzor kamieni na okraglej wiezy (segment, pas) - jak na scianach."""
    if col == 'stone':
        return lambda k, j: 'stone_light' if hsh(k, j) < 0.3 else ('stone_dark' if hsh(k, j) < 0.42 else None)
    return lambda k, j: 'stone_pale' if hsh(k, j) < 0.2 else None


def round_bastion(m, r, h, x, y, col='whitewash'):
    """Okragla baszta z blankami, bez dachu (jak w magazynie i warowni pierwowzoru)."""
    m.cyl(r, h, 12, x=x, y=y, col=col, bands=cuts(0, h, 0.12), paint=tower_stones(col), bottom=False)
    m.cyl(r * 0.75, 0.01, 12, x=x, y=y, z=h, col='stone_dark')
    for k in range(4):
        a = k * R + 0.4
        m.block(0.05, 0.045, 0.05, x=x + math.cos(a) * r * 0.85, y=y + math.sin(a) * r * 0.85, z=h, col=col, rz=a, bevel=0.0, open_sides=('-z',))
    m.cbox(0.025, 0.012, 0.05, x=x, y=y - r, z=h * 0.65, col='coal')


# =====================================================================
# Budynki (wzorowane na grafikach budynkow pierwowzoru)
# =====================================================================

def castle(m):
    for (x, y) in ((-0.5, -0.3), (0.45, -0.42), (-0.3, -0.48)):
        m.ico(0.07, x=x, y=y, z=0.02, col='leaf', sub=0, sz=0.6)
    m.box(1.03, 0.85, 0.04, col='plinth')
    wall(m, 'white', 1.0, 0.82, 0.32, 0, 0, 0.04, step=0.12, top=True)
    crenels(m, 1.0, 0.82, 0.36, n=4, col='whitewash')
    m.cbox(0.15, 0.03, 0.2, y=-0.42, z=0.14, col='plank_dark')
    m.doors.append((0.0, -0.41, 0.04, 0.15))  # brama
    m.cbox(0.19, 0.035, 0.03, y=-0.425, z=0.255, col='stone')
    wall(m, 'white', 0.44, 0.34, 0.86, 0, 0.12, 0.04, step=0.1)
    for sx in (-1, 1):
        window(m, sx * 0.1, 0.12 - 0.17, 0.72, 'front', shutters=False)
        window(m, sx * 0.1, 0.12 - 0.17, 0.5, 'front', shutters=False)
    roof(m, 0.44, 0.34, 0.2, y=0.12, z=0.9, col='terracotta', gable_col='whitewash', over=0.03)
    for (x, y, r, h) in ((-0.48, -0.39, 0.09, 0.72), (0.48, -0.39, 0.09, 0.72), (-0.48, 0.38, 0.1, 0.92),
                         (0.48, 0.38, 0.1, 0.92), (-0.28, 0.22, 0.08, 1.25), (0.3, 0.2, 0.075, 1.4),
                         (-0.13, -0.43, 0.06, 0.55), (0.13, -0.43, 0.06, 0.55)):
        slim_tower(m, r, h, x, y, seg=10, cone_k=3.4, stones=False, ring=False)
    banner(m, 0.0, 0.12, 1.14, 0.32)
    return ROT


def warehouse(m):
    """Magazyn: bielony blok z trzema rownoleglymi dachami, okragle baszty, komin-wieza, schody."""
    m.box(0.64, 0.5, 0.04, col='plinth')
    wall(m, 'white', 0.6, 0.46, 0.34, 0, 0, 0.04, step=0.09)
    for x in (-0.2, 0.0, 0.2):
        roof(m, 0.46, 0.2, 0.14, x=x, z=0.38, col='terracotta', gable_col='whitewash', over=0.015, front=True)
    for x in (-0.18, 0.18):
        window(m, x, -0.23, 0.26, 'front', shutters=False)
    door(m, 0.0, -0.23, 0.04, w=0.12, col='plank')
    for (x, y) in ((-0.32, -0.25), (0.32, -0.25)):
        round_bastion(m, 0.08, 0.42, x, y)
    m.cyl(0.07, 0.62, 8, x=-0.12, y=0.26, col='whitewash')  # komin-wieza
    m.cyl(0.08, 0.03, 8, x=-0.12, y=0.26, z=0.62, col='stone')
    for i in range(2):  # schody
        m.box(0.16, 0.05, 0.03 - i * 0.012, y=-0.27 - i * 0.05, col='stone_light')
    return ROT


def woodcutter(m):
    """Chata drwala: bale, kamienny komin, klody wzdluz lewej sciany (jak przy tartaku) i pieniek do okrzesywania
    z prawej, blisko drzwi (siekiere w pienku dorysowuje gra)."""
    cabin(m, 0.44, 0.36, 0.2, wins=(), side_wins=True, has_door=False)
    double_door(m, 0.02, -0.18, w=0.14)
    chimney(m, -0.14, 0.08, 0.36, 0.2)
    m.cyl(0.028, 0.28, 8, x=-0.31, y=-0.17, z=0.028, col='log', rx=-R)
    m.cyl(0.026, 0.26, 8, x=-0.31, y=-0.15, z=0.078, col='log', rx=-R)
    m.cyl(0.055, 0.07, 10, x=0.22, y=-0.29, col='log', bottom=False)
    m.cyl(0.05, 0.004, 10, x=0.22, y=-0.29, z=0.07, col='wood_light')
    return ROT


def woodcutter_axe(m):
    """Siekiera wbita w pieniek przed chata drwala (uklad modelu chaty) - widoczna, gdy drwal jest w domu."""
    m.beam((0.21, -0.29, 0.07), (0.25, -0.29, 0.18), 0.012, 'wood')
    m.cbox(0.05, 0.008, 0.035, x=0.205, y=-0.29, z=0.09, col='metal', ry=0.4)
    return ROT


def forester(m):
    """Lesniczowka: chata z bali z szerokimi wrotami i swierki obok. Grzadke sadzonek przed chata z lewej od wejscia
    rysuje gra na wysokosci terenu (fld_seedbed, SEEDBED w client/render/work/field.ts)."""
    cabin(m, 0.46, 0.38, 0.22, wins=(), side_wins=False, has_door=False)
    double_door(m, 0.02, -0.19, w=0.18, h=0.18)
    fir(m, -0.36, 0.06, 1.0)
    fir(m, 0.34, 0.24, 0.7)
    return ROT


def sawmill(m):
    """Tartak: bielony dom szczytem do kamery z lukowym otworem, niska dobudowka z desek."""
    house(m, 0.36, 0.5, 0.26, 'white', front=True, x=0.1, y=0.04, wins=(), side_wins=True, has_door=False)
    m.cbox(0.16, 0.014, 0.2, x=0.1, y=-0.213, z=0.16, col='coal')  # lukowy otwor
    m.doors.append((0.1, -0.21, 0.04, 0.16))
    m.cyl(0.08, 0.014, 10, x=0.1, y=-0.213, z=0.26, col='coal', rx=R)
    lean_to(m, 0.3, 0.3, 0.22, x=-0.26, y=-0.08, posts=False)
    m.cyl(0.028, 0.28, 8, x=-0.5, y=-0.24, z=0.028, col='log', rx=-R)
    m.cyl(0.026, 0.26, 8, x=-0.5, y=-0.22, z=0.078, col='log', rx=-R)
    # Koziol do ciecia przed tartakiem (klode i tracza dorysowuje gra, gdy tartak pracuje: SAW_HORSE).
    for x in (-0.2, -0.04):
        for s in (-1, 1):
            m.beam((x, -0.44 - s * 0.05, 0.0), (x, -0.44 + s * 0.035, 0.1), 0.016, 'plank_dark')
    m.beam((-0.2, -0.44, 0.045), (-0.04, -0.44, 0.045), 0.014, 'plank_dark')
    m.block(0.04, 0.04, 0.04, x=0.04, y=-0.46, col='wood_light')  # klocek z odcietym kawalkiem
    plank_stack(m, 0.3, -0.34, 4)
    return ROT


def stonecutter(m):
    """Kamieniarz: chata z desek z kominem i sterta kamieni przed wejsciem. Kamienny stol do ociosywania blokow
    rysuje gra na wysokosci terenu (fld_table, STONE_TABLE w client/render/work/field.ts)."""
    cabin(m, 0.42, 0.36, 0.2, style='plank', wins=(1,), side_wins=False)
    chimney(m, -0.12, 0.06, 0.34, 0.2)
    for (x, y, r) in ((-0.3, -0.28, 0.08), (-0.18, -0.36, 0.06), (-0.38, -0.14, 0.06)):
        m.ico(r, x=x, y=y, col='stone_light', sub=1, sz=0.7)
    return ROT


def fisher(m):
    """Rybak: chata z desek na kamiennej podmurowce, szczyt z oknem i przybudowka. Zerdz z suszaca sie siecia
    rysuje gra na wysokosci terenu (fld_netrack, fld_net, NET_BAR w client/render/work/field.ts)."""
    m.box(0.52, 0.44, 0.05, col='plinth')
    house(m, 0.34, 0.36, 0.2, 'plank', front=True, found=0.05, wins=(), side_wins=True, y=0.02, x=-0.06)
    window(m, -0.06, -0.16, 0.23, 'front', shutters=False)
    lean_to(m, 0.18, 0.3, 0.24, x=0.2, y=0.02, posts=False)
    return ROT


def hunter(m):
    """Chata mysliwego: poroze nad drzwiami i skora rozpieta na scianie. Stojak na zdobycz rysuje gra na wysokosci
    terenu (fld_rack, GAME_RACK w client/render/work/field.ts)."""
    cabin(m, 0.42, 0.36, 0.2, wins=(1,), side_wins=False)
    m.cbox(0.03, 0.012, 0.03, y=-0.188, z=0.265, col='cream')  # poroze nad drzwiami (pod okapem)
    for s in (-1, 1):
        m.beam((s * 0.008, -0.19, 0.27), (s * 0.05, -0.19, 0.325), 0.01, 'cream')
        m.beam((s * 0.028, -0.19, 0.295), (s * 0.058, -0.19, 0.3), 0.008, 'cream')
    m.cbox(0.085, 0.01, 0.1, x=-0.13, y=-0.186, z=0.16, col='deer', rx=0.0)
    for (x, z) in ((-0.17, 0.21), (-0.09, 0.21), (-0.17, 0.11), (-0.09, 0.11)):
        m.cbox(0.01, 0.014, 0.01, x=x, y=-0.192, z=z, col='wood_dark')
    return ROT


def farm(m):
    """Farma: maly bielony dom z kominem, wysoki silos z desek, radlo i snopki."""
    house(m, 0.44, 0.36, 0.22, 'white', x=-0.26, y=0.12, chim=(-0.1, 0.08), wins=(1,))
    wall(m, 'plank', 0.2, 0.2, 0.56, 0.18, 0.2, 0)
    m.cbox(0.08, 0.012, 0.1, x=0.18, y=0.097, z=0.44, col='plank_dark')
    roof(m, 0.2, 0.2, 0.1, x=0.18, y=0.2, z=0.56, col='tarpaper', gable_col='plank', over=0.02)
    # Radlo i tyczki na polu przed domem.
    m.beam((-0.1, -0.3, 0.0), (0.2, -0.2, 0.1), 0.02, 'wood')
    m.beam((0.14, -0.22, 0.0), (0.2, -0.2, 0.1), 0.016, 'wood_dark')
    m.cbox(0.06, 0.012, 0.04, x=-0.1, y=-0.3, z=0.02, col='metal')
    for (x, y) in ((0.42, -0.2), (0.5, -0.34), (-0.5, -0.3)):
        hay(m, x, y, 0.7)
    return ROT


def mill(m):
    """Mlyn: niska okragla kamienna wieza z malym stozkiem; duze plocienne skrzydla (crf_sails) na dlugim wale
    wysunietym przed wieze - mlynarz przechodzi za nimi do drzwi. Z lewej paleta na worki ze zbozem
    (worki i mlynarza dorysowuje gra: MILL w client/render/work/crafts.ts), przed drzwiami rozsypana maka."""
    m.cyl(0.2, 0.05, 16, col='stone_dark', bottom=False)
    m.cyl(0.18, 0.5, 16, col='stone', r_top=0.14, bands=cuts(0, 0.5, 0.06), paint=tower_stones('stone'), bottom=False)
    m.cone(0.16, 0.14, 16, z=0.5, col='terracotta', slope=TILES)
    m.cbox(0.08, 0.014, 0.12, y=-0.178, z=0.1, col='coal')
    door(m, 0.09, -0.16, 0.05, w=0.07, h=0.12, col='plank')
    m.cyl(0.035, 0.15, 6, y=-0.16, z=0.5, col='wood_dark', rx=R)
    m.cbox(0.13, 0.1, 0.014, x=-0.29, y=-0.19, z=0.007, col='plank_dark', rz=0.35)
    for (x, y, r) in ((0.07, -0.225, 0.05), (0.12, -0.25, 0.032), (0.02, -0.21, 0.026)):
        m.cyl(r, 0.004, 8, x=x, y=y, col='flour', jitter=0.0)
    return ROT


def bakery(m):
    """Piekarnia: wyzsza bielona czesc z tylu, nizsza z przodu z lukowym otworem pieca w kamiennej oprawie
    i kamiennym parapetem; komin z prawej, szyld z bochenkiem. Z lewej stol, na ktorym piekarz wyrabia
    ciasto i kladzie chleb (ogien w piecu, piekarza, lopate, kosz i bochenki dorysowuje gra: BAKERY w crafts.ts)."""
    house(m, 0.4, 0.26, 0.34, 'white', x=-0.04, y=0.14, wins=(-1,), side_wins=True, has_door=False)
    house(m, 0.46, 0.26, 0.18, 'white', x=0.02, y=-0.12, wins=(), side_wins=False, has_door=False)
    ox = -0.08
    m.cbox(0.17, 0.016, 0.1, x=ox, y=-0.252, z=0.12, col='stone_light', jitter=0.0)
    m.cyl(0.085, 0.016, 12, x=ox, y=-0.244, z=0.17, rx=R, col='stone_light', jitter=0.0)
    m.cbox(0.12, 0.018, 0.08, x=ox, y=-0.258, z=0.12, col='coal', jitter=0.0)
    m.cyl(0.06, 0.018, 12, x=ox, y=-0.249, z=0.16, rx=R, col='coal', jitter=0.0)
    m.cbox(0.19, 0.045, 0.014, x=ox, y=-0.272, z=0.072, col='stone')
    door(m, 0.14, -0.25, 0.04, col='plank')
    chimney(m, 0.3, 0.14, 0.2, 0.44)
    sign(m, 0.225, -0.25, 0.27, emblem='bread')
    tx, ty = -0.42, -0.35
    m.cbox(0.18, 0.085, 0.012, x=tx, y=ty, z=0.074, col='wood_light')
    for sx in (-1, 1):
        for sy in (-1, 1):
            m.box(0.014, 0.014, 0.068, x=tx + sx * 0.075, y=ty + sy * 0.03, col='wood')
    sack(m, -0.31, -0.1)
    return ROT


def pigfarm(m):
    """Chlewnia: bielony dom z duzymi oknami i osobna skrzynia-chlew z desek, plot."""
    house(m, 0.42, 0.34, 0.24, 'white', x=-0.3, y=0.1, wins=(-1, 1))
    wall(m, 'plank', 0.34, 0.28, 0.22, 0.28, 0.08, 0)
    m.block(0.38, 0.32, 0.03, x=0.28, y=0.08, z=0.25, col='tarpaper', rx=0.2, center=True, bevel=0.0,
            open_sides=('-z',), slope=TARPAPER)
    m.cbox(0.1, 0.012, 0.1, x=0.28, y=-0.063, z=0.05, col='plank_dark')
    fence(m, -0.1, -0.46, 0.6, -0.46, posts=5)
    fence(m, 0.6, -0.46, 0.6, -0.08, posts=3)
    fence(m, -0.1, -0.46, -0.1, -0.16, posts=4)
    # Koryto przy lewym plocie (hodowca sypie do niego pasze zza plotu) i kaluza blota; swinie, pasze i wode
    # w korycie dorysowuje gra (PIGFARM w client/render/work/crafts.ts).
    m.box(0.06, 0.2, 0.045, x=-0.045, y=-0.29, col='wood')
    m.box(0.044, 0.184, 0.004, x=-0.045, y=-0.29, z=0.042, col='wood_dark')
    m.cyl(0.11, 0.003, 10, x=0.37, y=-0.3, col='soil', jitter=0.0)
    m.cyl(0.06, 0.003, 8, x=0.25, y=-0.36, col='soil', jitter=0.0)
    return ROT


def butcher(m):
    """Rzeznia: dlugi dom - bielona czesc pod dachowka i nizsza przybudowka z desek pod papa, komin."""
    m.box(0.73, 0.43, 0.04, col='plinth')
    wall(m, 'plank', 0.3, 0.4, 0.24, -0.21, 0, 0.04)
    wall(m, 'white', 0.4, 0.4, 0.3, 0.14, 0, 0.04)
    m.cbox(0.1, 0.014, 0.09, x=-0.22, y=-0.203, z=0.17, col='coal')
    m.cbox(0.12, 0.014, 0.09, x=0.25, y=-0.203, z=0.2, col='coal')
    door(m, 0.04, -0.2, 0.04, col='plank')
    roof(m, 0.3, 0.4, 0.16, x=-0.21, z=0.28, col='tarpaper', gable_col='plank', over=0.03)
    roof(m, 0.4, 0.4, 0.2, x=0.14, z=0.34, col='terracotta', gable_col='whitewash', over=0.03)
    chimney(m, -0.26, 0.06, 0.3, 0.3)
    # Pien rzezniczy (wierzch na 0.068, z plama) i lawka na deske z miesem; rzeznika, tusze i deske
    # dorysowuje gra (BUTCHER w client/render/work/crafts.ts).
    m.cyl(0.05, 0.062, 10, x=-0.22, y=-0.38, col='log', bottom=False)
    m.cyl(0.047, 0.006, 10, x=-0.22, y=-0.38, z=0.062, col='wood_light')
    m.cyl(0.022, 0.002, 7, x=-0.205, y=-0.385, z=0.068, col='meat', jitter=0.0)
    m.cbox(0.11, 0.075, 0.012, x=-0.33, y=-0.37, z=0.06, col='plank')
    for sx in (-1, 1):
        for sy in (-1, 1):
            m.box(0.012, 0.012, 0.054, x=-0.33 + sx * 0.045, y=-0.37 + sy * 0.027, col='plank_dark')
    return ROT


# Kopalnia (uklad modelu): szopa nad szybem, z jej lewej sciany wyjezdza po szynach wozek z urobkiem do kupki.
# Kopalnie stoja na niewyrownanych stokach, wiec tor i kupke rysuje gra na wysokosci terenu
# (client/render/work/industry.ts: MINE - te same polozenia).
MINE_SHED_X = 0.08
MINE_RAIL_Y = -0.08


def mine(m, ore, stone_shed=False):
    """Kopalnia: A-rama z szopka i kolem linowym na szczycie, pod nia szopa nad szybem z wylotem toru w lewej
    scianie (tor, kupke urobku, wozek i gornika rysuje gra), kilof oparty o sciane. `ore` - kolor urobku
    na kopczyku przy drzwiach."""
    sx, ry = MINE_SHED_X, MINE_RAIL_Y
    headframe(m, sx - 0.02, 0.14)
    house(m, 0.3, 0.24, 0.16, 'stone' if stone_shed else 'plank', x=sx, y=-0.08, wins=(), side_wins=False, found=0.03)
    # Wylot toru w lewej scianie: ciemny otwor w ramie z belek.
    wx = sx - 0.15
    m.cbox(0.01, 0.084, 0.215, x=wx - 0.012, y=ry, z=0.1075, col='coal')
    for s in (-1, 1):
        m.box(0.016, 0.016, 0.225, x=wx - 0.016, y=ry + s * 0.05, col='plank_dark')
    m.cbox(0.02, 0.124, 0.02, x=wx - 0.016, y=ry, z=0.23, col='plank_dark')
    # Kilof oparty o sciane szopy obok drzwi i kopczyk urobku przy progu.
    m.beam((sx + 0.12, -0.215, 0.0), (sx + 0.125, -0.21, 0.13), 0.01, 'wood')
    m.beam((sx + 0.1, -0.212, 0.125), (sx + 0.152, -0.208, 0.112), 0.011, 'metal_dark')
    for (x, y, r) in ((sx - 0.1, -0.235, 0.03), (sx - 0.065, -0.25, 0.02)):
        m.ico(r, x=x, y=y, col=ore, sub=1, sz=0.6)
    return ROT


def coalmine(m):
    return mine(m, 'coal')


def ironmine(m):
    return mine(m, 'iron_ore')


def goldmine(m):
    """Kopalnia zlota: jak kazda kopalnia, w kopczyku przy progu blyszcza okruchy zlota."""
    mine(m, 'gold_ore')
    for (x, y, z) in ((MINE_SHED_X - 0.105, -0.24, 0.02), (MINE_SHED_X - 0.09, -0.225, 0.012)):
        m.cbox(0.012, 0.012, 0.012, x=x, y=y, z=z, col='fire_core', rz=0.7, rx=0.5)
    return ROT


def stonemine(m):
    return mine(m, 'stone_light', stone_shed=True)


def steelworks(m):
    """Huta: bielony dom z dwoch czesci - wyzsza z kamiennym kominem z prawej, nizsza z piecem z lewej (kamienne
    ujscie z ciemnym otworem od frontu). Zar, forme na wlewek i hutnika rysuje gra (SMELT w industry.ts)."""
    house(m, 0.34, 0.4, 0.3, 'white', x=0.14, y=0.06, wins=(1,), side_wins=False, chim=(0.0, 0.06))
    house(m, 0.3, 0.34, 0.18, 'white', x=-0.2, y=0.0, wins=(-1,), side_wins=True, has_door=False)
    # Ujscie pieca: kamienna obudowa, otwor i prog.
    m.block(0.13, 0.03, 0.17, x=-0.13, y=-0.18, col='stone', bevel=0.006, open_sides=('-z',))
    m.cbox(0.075, 0.01, 0.075, x=-0.13, y=-0.196, z=0.09, col='coal')
    m.cbox(0.11, 0.035, 0.03, x=-0.13, y=-0.205, z=0.035, col='stone_dark')
    m.cbox(0.15, 0.04, 0.025, x=-0.13, y=-0.182, z=0.18, col='stone_dark')
    # Sterta wegla przy scianie.
    for (x, y, r) in ((-0.33, -0.2, 0.035), (-0.29, -0.215, 0.025)):
        m.ico(r, x=x, y=y, col='coal', sub=1, sz=0.6)
    return ROT


def mint(m):
    """Mennica: dol z kamienia, gora z desek, dach z papy, szyld ze zlotem na slupku. Pien mincerza z kowadelkiem,
    stosik monet i mincerza rysuje gra (MINT w industry.ts)."""
    m.box(0.52, 0.44, 0.04, col='plinth')
    wall(m, 'stone', 0.5, 0.42, 0.2, 0, 0, 0.04)
    door(m, -0.02, -0.21, 0.04, col='plank')
    window(m, -0.16, -0.21, 0.15, 'front', shutters=False)
    window(m, 0.14, -0.21, 0.15, 'front', shutters=False)
    wall(m, 'plank', 0.54, 0.46, 0.18, 0, 0, 0.24)
    window(m, 0.0, -0.23, 0.33, 'front', shutters=False)
    roof(m, 0.54, 0.46, 0.16, z=0.42, col='tarpaper', gable_col='plank', over=0.03)
    chimney(m, 0.12, 0.1, 0.44, 0.2)
    m.box(0.02, 0.02, 0.24, x=0.36, y=-0.3, col='wood_dark')  # szyld
    m.cbox(0.13, 0.014, 0.12, x=0.36, y=-0.31, z=0.24, col='wood_dark')
    m.cbox(0.08, 0.016, 0.07, x=0.36, y=-0.317, z=0.24, col='gold')
    return ROT


def toolmaker(m):
    """Narzedziownia: dlugi bielony dom z duzym ciemnym wejsciem (palenisko w glebi), z tylu kamienna wieza
    z czterospadowym dachem i wiatrowskazem, na scianie wieszak z narzedziami. Zar, kowadlo i beczke z woda
    przed domem oraz kowala rysuje gra (TOOLSHOP w industry.ts)."""
    house(m, 0.6, 0.36, 0.24, 'white', x=0.0, y=-0.04, wins=(-1,), side_wins=True, has_door=False)
    m.cbox(0.14, 0.014, 0.18, x=0.1, y=-0.223, z=0.13, col='coal')
    m.doors.append((0.1, -0.22, 0.04, 0.14))  # wejscie do kuzni
    m.cbox(0.17, 0.02, 0.025, x=0.1, y=-0.226, z=0.23, col='wood_dark')
    wall(m, 'stone', 0.18, 0.18, 0.56, 0.02, 0.24, 0)
    m.cbox(0.05, 0.012, 0.06, x=0.02, y=0.147, z=0.46, col='coal')
    m.hip(0.18, 0.18, 0.14, x=0.02, y=0.24, z=0.56, col='terracotta', overhang=0.02, slope=TILES)
    m.cyl(0.006, 0.1, 4, x=0.02, y=0.24, z=0.7, col='metal_dark')
    m.cbox(0.06, 0.004, 0.03, x=0.045, y=0.24, z=0.78, col='metal_dark')
    chimney(m, -0.22, 0.0, 0.4, 0.22)
    # Wieszak z narzedziami na scianie (kleszcze, mlotek).
    m.cbox(0.12, 0.012, 0.014, x=-0.045, y=-0.226, z=0.27, col='wood_dark')
    m.beam((-0.085, -0.232, 0.265), (-0.09, -0.232, 0.18), 0.008, 'metal_dark')
    m.beam((-0.065, -0.232, 0.265), (-0.055, -0.232, 0.18), 0.008, 'metal_dark')
    m.beam((-0.015, -0.232, 0.265), (-0.015, -0.232, 0.2), 0.01, 'wood')
    m.cbox(0.03, 0.016, 0.016, x=-0.015, y=-0.234, z=0.198, col='metal_dark')
    return ROT


def weaponsmith(m):
    """Zbrojownia: bielony dom pod dachowka, z lewej otwarta kuznia pod wysokim daszkiem z papy (palenisko
    z kominem), szyld z mieczem. Zar, kowadlo i beczke z woda przed kuznia oraz platnerza rysuje gra
    (ARMORY w industry.ts)."""
    m.box(0.46, 0.44, 0.04, x=0.12, col='stone_dark')
    wall(m, 'white', 0.42, 0.42, 0.3, 0.12, 0, 0.04)
    for (x, y) in ((-0.34, -0.19), (-0.34, 0.19)):
        m.box(0.03, 0.03, 0.32, x=x, y=y, col='plank_dark')
    m.block(0.25, 0.03, 0.32, x=-0.22, y=0.19, col='plank', bevel=0.0, wall=PLANKS)
    # Palenisko (zar na wierzchu: ARMORY_FORGE w industry.ts) i komin z jego tylu.
    m.block(0.16, 0.13, 0.12, x=-0.22, y=-0.02, col='stone', bevel=0.006, open_sides=('-z',))
    m.cbox(0.13, 0.1, 0.006, x=-0.22, y=-0.02, z=0.121, col='coal')
    chimney(m, -0.24, 0.07, 0.12, 0.52)
    door(m, 0.2, -0.21, 0.04, col='plank')
    window(m, 0.02, -0.21, 0.22, 'front', shutters=False)
    roof(m, 0.27, 0.42, 0.14, x=-0.225, z=0.32, col='tarpaper', gable_col='plank', over=0.03)
    roof(m, 0.42, 0.42, 0.2, x=0.12, z=0.34, col='terracotta', gable_col='whitewash', over=0.03)
    m.beam((0.33, -0.21, 0.28), (0.33, -0.33, 0.28), 0.014, 'wood_dark')  # szyld na wysiegniku
    m.cbox(0.012, 0.012, 0.03, x=0.33, y=-0.31, z=0.26, col='metal_dark')
    m.cbox(0.08, 0.014, 0.08, x=0.33, y=-0.31, z=0.21, col='red')
    m.cbox(0.012, 0.016, 0.1, x=0.33, y=-0.316, z=0.21, col='white', ry=0.7)
    return ROT


def shipyard(m):
    """Stocznia: otwarta szopa z desek z tylu (wiosla i zwoj liny), przed nia pochylnia - dwie prowadnice
    i klocki pod stepka; lodz rosnaca deska po desce rysuje gra (BOAT w industry.ts). Stos desek z prawej."""
    for (x, y) in ((-0.28, -0.07), (0.28, -0.07), (-0.28, 0.24), (0.28, 0.24)):
        m.box(0.035, 0.035, 0.3, x=x, y=y, col='plank_dark')
    m.block(0.56, 0.03, 0.3, y=0.24, col='plank', bevel=0.0, wall=PLANKS)
    m.block(0.03, 0.3, 0.3, x=0.28, y=0.085, col='plank', bevel=0.0, wall=PLANKS)
    roof(m, 0.58, 0.31, 0.12, y=0.085, z=0.3, col='tarpaper', gable_col='plank', over=0.03)
    # W szopie: wiosla oparte o tylna sciane, zwoj liny, koziol.
    for x in (-0.18, -0.14):
        m.beam((x, 0.2, 0.0), (x + 0.03, 0.22, 0.26), 0.012, 'wood_light')
        m.cbox(0.03, 0.008, 0.06, x=x + 0.003, y=0.2, z=0.03, col='wood_light', rx=-0.08)
    m.cyl(0.04, 0.025, 10, x=0.12, y=0.14, col='wheat')
    m.cyl(0.02, 0.026, 8, x=0.12, y=0.14, z=0.0, col='wood_dark')
    for s in (-1, 1):
        m.beam((-0.02 + s * 0.04, 0.06, 0.0), (-0.02 + s * 0.02, 0.06, 0.09), 0.012, 'plank_dark')
    m.cbox(0.012, 0.06, 0.012, x=-0.02, y=0.06, z=0.09, col='plank_dark', rz=R)
    # Pochylnia: prowadnice i klocki pod stepka (BOAT.y, stepka na wysokosci 0.045).
    for s in (-1, 1):
        m.beam((-0.31, -0.24 + s * 0.05, 0.01), (0.25, -0.24 + s * 0.05, 0.01), 0.02, 'wood_dark')
    for x in (-0.15, -0.03, 0.09):
        m.cbox(0.03, 0.07, 0.025, x=x, y=-0.24, z=0.0325, col='plank_dark')
    plank_stack(m, 0.33, -0.24, 4, rz=R)
    return ROT


def guardhut(m):
    """Wachhutte: kwadratowa kamienna chata pod czterospadowym dachem."""
    m.box(0.36, 0.34, 0.04, col='plinth')
    wall(m, 'stone', 0.32, 0.3, 0.24, 0, 0, 0.04)
    door(m, 0.06, -0.15, 0.04, w=0.08, h=0.15, col='plank')
    window(m, -0.08, -0.15, 0.2, 'front', shutters=False)
    m.hip(0.32, 0.3, 0.2, z=0.28, col='terracotta', overhang=0.03, slope=TILES)
    banner(m, 0.0, 0.0, 0.46, 0.22)
    return ROT


def tower_building(m):
    """Wachturm: wysoka kwadratowa kamienna wieza z czterospadowym dachem, z przodu mur z blankami i brama."""
    m.box(0.3, 0.3, 0.04, x=0.02, y=0.1, col='stone_dark')
    wall(m, 'stone', 0.26, 0.26, 0.86, 0.02, 0.1, 0.04)
    for z in (0.52, 0.72):
        m.cbox(0.03, 0.014, 0.07, x=0.02, y=-0.033, z=z, col='coal')
    m.hip(0.28, 0.28, 0.22, x=0.02, y=0.1, z=0.9, col='terracotta', overhang=0.025, slope=TILES)
    wall(m, 'stone', 0.44, 0.1, 0.26, 0.02, -0.12, 0, top=True)
    crenels(m, 0.44, 0.1, 0.26, x=0.02, y=-0.12, n=4, col='stone')
    door(m, 0.02, -0.17, 0.0, w=0.09, h=0.16, col='plank')
    banner(m, 0.02, 0.1, 1.12, 0.22)
    return ROT


def fortress(m):
    """Wachburg: wysoki blok z czerwonym dachem, okragle baszty z blankami, brama."""
    m.box(0.98, 0.84, 0.04, col='plinth')
    wall(m, 'stone', 0.94, 0.8, 0.3, 0, 0, 0.04, step=0.1, top=True)
    crenels(m, 0.94, 0.8, 0.34, n=4, col='stone_light')
    m.cbox(0.16, 0.03, 0.2, y=-0.41, z=0.14, col='plank_dark')
    m.doors.append((0.0, -0.4, 0.04, 0.16))  # brama
    wall(m, 'white', 0.5, 0.36, 0.56, -0.12, 0.14, 0.04, step=0.09)
    for z in (0.34, 0.5):
        for sx in (-1, 1):
            window(m, -0.12 + sx * 0.12, 0.14 - 0.18, z, 'front', shutters=False)
    roof(m, 0.5, 0.36, 0.2, x=-0.12, y=0.14, z=0.6, col='terracotta', gable_col='whitewash', over=0.03)
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
    """Studnia: niska kamienna cembrowina z otworem (lustro wody w srodku), dwa slupy z daszkiem, obok otwarta
    beczka na wode. Kolowrot z korba od strony kamery, sznur, wiadro, studniarza i wode w beczce dorysowuje gra
    (WELL w client/render/work/crafts.ts)."""
    def open_barrel(x, y, r=0.042, h=0.09, seg=10):
        """Otwarta beczka (bryla obrotowa: klepki z obreczami, rant, wewnetrzna scianka i dno)."""
        prof = [(r * 0.94, 0.0), (r, h * 0.13), (r * 1.01, h * 0.22), (r * 1.07, h * 0.5), (r * 1.02, h * 0.78),
                (r * 1.0, h * 0.87), (r * 0.98, h), (r * 0.86, h), (r * 0.86, h * 0.12)]
        m.lathe(prof, seg, x=x, y=y, col='wood',
                paint=lambda i: {1: 'metal_dark', 4: 'metal_dark', 6: 'wood_light', 7: 'wood_dark', 8: 'wood_dark'}.get(i))

    m.cyl(0.14, 0.07, 16, col='stone', bands=cuts(0, 0.07, 0.035), paint=tower_stones('stone'), bottom=False, top=False)
    m.lathe([(0.148, 0.07), (0.148, 0.09), (0.108, 0.09), (0.108, 0.05), (0.004, 0.05)], 16,
            col='stone_light', paint=lambda i: {2: 'stone_dark', 3: 'water', 4: 'water'}.get(i))
    for x in (-0.13, 0.13):
        m.box(0.03, 0.03, 0.34, x=x, col='plank_dark')
    roof(m, 0.28, 0.12, 0.07, z=0.34, col='terracotta', over=0.015, gable_col='plank')
    open_barrel(-0.2, -0.22)
    return ROT


def brewery(m):
    """Browar: bielony dom z przybudowka z desek, beczki; przed przybudowka otwarty miedziany kociol z brzeczka
    na kamiennym palenisku z otworem na ogien (ogien, pare, piwowara z wioslem dorysowuje gra:
    BREWERY w client/render/work/crafts.ts)."""
    house(m, 0.42, 0.4, 0.26, 'white', x=0.12, y=0.04, wins=(1,), side_wins=False, chim=(0.1, 0.1))
    house(m, 0.28, 0.32, 0.18, 'plank', x=-0.24, y=0.0, wins=(), side_wins=True, has_door=False)
    kx, ky = -0.27, -0.33
    m.cyl(0.074, 0.036, 10, x=kx, y=ky, col='stone', bottom=False)
    m.cbox(0.05, 0.012, 0.026, x=kx, y=ky - 0.069, z=0.015, col='coal', jitter=0.0)
    m.lathe([(0.045, 0.035), (0.06, 0.05), (0.067, 0.075), (0.064, 0.1), (0.069, 0.104), (0.069, 0.112),
             (0.059, 0.112), (0.057, 0.094), (0.004, 0.094)], 14, x=kx, y=ky, col='copper',
            paint=lambda i: {5: '#d08a50', 6: '#7a4a24', 7: '#6e4520', 8: '#6e4520'}.get(i))
    for (x, y) in ((0.2, -0.3), (0.31, -0.26)):
        barrel(m, x, y)
    return ROT


def donkeybreeder(m):
    house(m, 0.3, 0.3, 0.2, 'white', x=-0.44, y=0.16, wins=(), side_wins=True)
    wall(m, 'plank', 0.56, 0.36, 0.26, 0.1, 0.16, 0)
    for x in (-0.08, 0.12, 0.3):
        m.cbox(0.1, 0.014, 0.12, x=x, y=-0.023, z=0.1, col='plank_dark')
    roof(m, 0.56, 0.36, 0.14, x=0.1, y=0.16, z=0.26, col='tarpaper', gable_col='plank', over=0.03)
    fence(m, -0.6, -0.5, 0.58, -0.5, posts=6)
    fence(m, 0.58, -0.5, 0.58, -0.08, posts=3)
    # Siano z lewej (tu stoi oslica, gdy hodowca jej nie oprowadza) i poidlo przy stajni; osly i hodowce
    # dorysowuje gra (DONKEYBREEDER w client/render/work/crafts.ts).
    hay(m, -0.5, -0.3)
    hay(m, -0.53, -0.2, 0.6)
    m.box(0.05, 0.14, 0.04, x=0.48, y=-0.12, col='wood')
    m.box(0.036, 0.126, 0.003, x=0.48, y=-0.12, z=0.038, col='water')
    return ROT


def charburner(m):
    """Smolarnia: chata z bali, mielerz (kopiec drewna pod ziemia i darnia, przy ziemi czarny pierscien,
    otwory dymne dookola) i sagi. Dym z mielerza i smolarza obchodzacego kopiec rysuje gra (KILN w industry.ts)."""
    cabin(m, 0.36, 0.3, 0.18, x=-0.3, y=0.2, wins=(), side_wins=True)
    kx, ky = 0.24, -0.08
    m.ico(0.26, x=kx, y=ky, col='coal', sub=1, sz=0.42)
    m.ico(0.235, x=kx, y=ky, z=0.02, col='soil', sub=1, sz=0.62)
    for (a, r) in ((0.6, 0.11), (2.3, 0.13), (3.9, 0.1), (5.2, 0.14)):
        z = 0.02 + 0.146 * math.sqrt(1 - (r / 0.235) ** 2) - 0.012
        m.ico(0.045, x=kx + math.cos(a) * r, y=ky + math.sin(a) * r, z=z, col='leaf_dark', sub=0, sz=0.35)
    m.cyl(0.02, 0.01, 6, x=kx, y=ky, z=0.158, col='coal')
    for a in (0.0, 1.05, 2.1, 3.15, 4.2, 5.25):
        m.cbox(0.026, 0.026, 0.022, x=kx + math.cos(a) * 0.24, y=ky + math.sin(a) * 0.24, z=0.03, col='black', rz=a)
    log_pile(m, -0.35, -0.3, n=5, rz=0.2)
    return ROT


def catapult(m):
    """Katapulta: kamienna chata i machina na kolach. Ramie z koszem, kolo zapadkowe i pociski rysuje scena
    (client/render/work/people.ts, CATAPULT): tu os ramienia (wzdluz Y w x = 0.02, z = 0.16) w lozyskach, rama
    z poprzeczka, o ktora uderza ramie po strzale (w prawo), os kola z przodu i lewa podpora napietego ramienia."""
    house(m, 0.3, 0.26, 0.18, 'stone', x=-0.3, y=0.26, wins=(), side_wins=False, found=0.03)
    m.box(0.46, 0.34, 0.05, x=0.1, y=-0.06, z=0.04, col='plank_dark')
    for x in (-0.08, 0.28):
        for y in (-0.22, 0.1):
            m.cyl(0.05, 0.03, 10, x=x, y=y, col='plank', rx=R)
    for y in (-0.16, 0.04):
        m.beam((-0.02, y, 0.09), (0.14, y, 0.38), 0.03, 'plank')
        m.beam((0.29, y, 0.09), (0.14, y, 0.38), 0.03, 'plank')
    m.cbox(0.04, 0.26, 0.04, x=0.14, y=-0.06, z=0.38, col='plank_dark')
    for y in (-0.105, -0.015):
        m.block(0.07, 0.03, 0.09, x=0.02, y=y, z=0.09, col='plank', bevel=0.004)
    m.cyl(0.014, 0.13, 6, x=0.02, y=-0.07, z=0.16, col='metal_dark', rx=R)
    for y in (-0.095, -0.025):
        m.box(0.022, 0.022, 0.15, x=-0.33, y=y, col='plank_dark')
    m.cbox(0.03, 0.1, 0.025, x=-0.33, y=-0.06, z=0.15, col='plank')
    return ROT


def site(size):
    """Plac budowy: wyrownana ziemia z belkami podwaliny (obrys przyszlego budynku), slupki z zerdziami z tylu
    i z lewej, przod otwarty (tam pracuje budowniczy); przed placem nic nie stoi - tam pojawi sie stanowisko pracy
    budynku. Materialy (deski, kamienie)
    i budowniczego rysuje scena (client/render/work/people.ts, siteOf - ten sam obrys podwaliny)."""
    def f(m):
        w = {'small': 0.55, 'medium': 0.72, 'large': 1.2}[size]
        hx, hy = w * 0.42, w * 0.36
        # Ziemia placu: gesta siatka kladziona na terenie (Model.draped) - plaska plyta na stoku chowalaby sie w trawie.
        bm = bmesh.new()
        bmesh.ops.create_grid(bm, x_segments=7, y_segments=7, size=1.0)
        span = max(v.co.x for v in bm.verts) - min(v.co.x for v in bm.verts)
        bmesh.ops.scale(bm, vec=(w * 0.98 / span, w * 0.86 / span, 1.0), verts=bm.verts)
        bmesh.ops.translate(bm, vec=(0.0, 0.0, 0.012), verts=bm.verts)
        m.draped.add(m._add(bm, '#8d6c47', 0.0).name)
        for sy in (-1, 1):
            m.cbox(2 * hx + 0.03, 0.03, 0.026, y=sy * hy, z=0.025, col='plank_dark')
        for sx in (-1, 1):
            m.cbox(0.03, 2 * hy - 0.03, 0.026, x=sx * hx, z=0.025, col='plank_dark')
        for (sx, sy, h) in ((-1, 1, 0.42), (1, 1, 0.42), (-1, -1, 0.3), (1, -1, 0.3)):
            m.box(0.03, 0.03, h, x=sx * hx, y=sy * hy, z=0.012, col='plank')
        m.beam((-hx, hy, 0.38), (hx, hy, 0.38), 0.02, 'plank')
        m.beam((-hx, hy, 0.06), (hx * 0.2, hy, 0.37), 0.014, 'plank_dark')
        m.beam((-hx, -hy, 0.27), (-hx, hy, 0.37), 0.018, 'plank')
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
    'woodcutter_axe': woodcutter_axe, 'site_small': site('small'), 'site_medium': site('medium'), 'site_large': site('large'),
}

if __name__ == '__main__':
    build(BUILDERS, ao=0.35, yard=lambda name: name.startswith(('building_', 'site_')))
