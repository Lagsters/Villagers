"""
Natura i obiekty mapy: drzewa (po dwie odmiany iglastych i lisciastych), pien, skaly (dwie odmiany), pola zboza
(rosnace i dojrzale, z rzedami klosow), znak geologa, ruina, ogien, slupek graniczny, flaga.
Styl: gladkie, zaokraglone bryly (korony i glazy z kilku zlepionych kul), kolor malowany w wierzcholkach - ciemny
dol, jasna gora - i drobny wzor rysowany w grze shaderem (kepy lisci, igliwie, kora, skala, zdzbla, klosy;
MODEL_PATTERNS w client/render/scene.ts). Budzety: drzewo <= 150 trojkatow, reszta <= 300.
Uruchomienie: blender --background --python art/scripts/nature.py [-- nazwa ...]
"""
import math
import os
import sys

import bmesh
from mathutils import Vector

sys.path.insert(0, os.path.dirname(__file__))
from lib import BARK, EARS, FOLIAGE, NEEDLES, PALETTE, PATTERN_STRIDE, PLAIN, ROCK, STALKS, build, color  # noqa: E402

PALETTE.update({
    'leaf_deep': '#24561c', 'leaf_mid': '#4a8f2b', 'leaf_sun': '#93c844',
    'birch_deep': '#3f7a26', 'birch_mid': '#6fae35', 'birch_sun': '#b9dc5c',
    'pine_deep': '#123622', 'pine_mid': '#25603a', 'pine_sun': '#4f8f48',
    'scots_deep': '#173d2e', 'scots_mid': '#2f6646', 'scots_sun': '#5d9455',
    'bark_dark': '#3f2a17', 'birch_bark': '#ece6d6', 'birch_mark': '#3a3530', 'scots_bark': '#93583a',
    'rock_deep': '#56514b', 'rock_mid': '#837d73', 'rock_sun': '#b4ad9f', 'moss': '#6f8a3a',
    'wheat_deep': '#a77c26', 'wheat_mid': '#dcb24c', 'wheat_sun': '#f7df86',
    'sprout_deep': '#3e7322', 'sprout_mid': '#6ea83a', 'sprout_sun': '#a6d25a',
    'soil_furrow': '#4a321d', 'soil_top': '#7a5434', 'ash': '#5a5550', 'char': '#26211d', 'sign_board': '#d9c49a',
})

R = math.pi / 2


def hsh(*a):
    """Deterministyczna liczba z [0, 1)."""
    h = 2166136261
    for v in a:
        h = ((h ^ (int(v) & 0xffffffff)) * 16777619) & 0xffffffff
    h ^= h >> 13
    h = (h * 1274126177) & 0xffffffff
    return (h ^ (h >> 16)) % 10000 / 10000


def ramp(names, t):
    """Kolor liniowy z gradientu palety (ciemny, sredni, jasny) w punkcie t 0..1."""
    t = min(1.0, max(0.0, t))
    cs = [color(n) for n in names]
    k = t * (len(cs) - 1)
    i = min(int(k), len(cs) - 2)
    f = k - i
    return tuple(cs[i][j] * (1 - f) + cs[i + 1][j] * f for j in range(3))


def paint_loops(ob, fn):
    """Kolor kazdego rogu sciany z fn(polozenie, normalna wierzcholka) -> (r, g, b) liniowo: plynny gradient."""
    me = ob.data
    attr = me.color_attributes['Col']
    for loop in me.loops:
        v = me.vertices[loop.vertex_index]
        c = fn(v.co, v.normal)
        attr.data[loop.index].color = (c[0], c[1], c[2], 1.0)


def uv_wrap(ob, pid, cx=0.0, cy=0.0, radius=0.1, v_of=None):
    """Wzor `pid` owiniety wokol pionowej osi (cx, cy): u = kat * radius, v = v_of(polozenie) albo wysokosc.
    Szew za osia: sciana na szwie dostaje katy z jednej strony; wierzcholek na osi - srednia katow sasiadow."""
    me = ob.data
    lay = me.uv_layers.get('UVMap') or me.uv_layers.new(name='UVMap')
    for poly in me.polygons:
        cos = [me.vertices[me.loops[li].vertex_index].co for li in poly.loop_indices]
        angs = [math.atan2(c.y - cy, c.x - cx) if math.hypot(c.x - cx, c.y - cy) > 1e-5 else None for c in cos]
        known = [a for a in angs if a is not None]
        if known and max(known) - min(known) > math.pi:
            angs = [a + 2 * math.pi if a is not None and a < 0 else a for a in angs]
            known = [a for a in angs if a is not None]
        mean = sum(known) / len(known) if known else 0.0
        for li, a, c in zip(poly.loop_indices, angs, cos):
            lay.data[li].uv = (pid * PATTERN_STRIDE + (mean if a is None else a) * radius, v_of(c) if v_of else c.z)


def uv_plain(ob):
    """Czesc bez koloru instancji (wzor PLAIN) - np. slupek znaku, gdy gra barwi sam symbol."""
    me = ob.data
    lay = me.uv_layers.get('UVMap') or me.uv_layers.new(name='UVMap')
    for d in lay.data:
        d.uv = (PLAIN * PATTERN_STRIDE, 0.0)


class Blob:
    """Elipsoida o srodku (x, y, z) i polosiach (rx, ry, rz) - bryla korony albo glazu."""

    def __init__(self, x, y, z, rx, ry, rz, seg=8, rings=5, lump=0.08):
        self.c = Vector((x, y, z))
        self.r = Vector((rx, ry, rz))
        self.seg, self.rings, self.lump = seg, rings, lump

    def inside(self, p, k):
        d = p - self.c
        return (d.x / self.r.x) ** 2 + (d.y / self.r.y) ** 2 + (d.z / self.r.z) ** 2 < k * k


def blobs(m, items, pid, cols, seed=0, shade=None, flat_bottom=False):
    """
    Zlepione bryly (korona drzewa, stos glazow): kazda to kula UV splaszczona do elipsoidy, z lekkimi
    nierownosciami (lump); sciany schowane gleboko w sasiednich brylach sa usuwane (tylko trojkaty widoczne).
    Kolor: gradient cols (ciemny, sredni, jasny) wg wysokosci w bryle i nachylenia (gora jasna, spod ciemny).
    shade(polozenie, normalna, t) -> kolor albo None - wlasne plamy (mech na glazie).
    flat_bottom - spod bryly splaszczony do z = 0 (glaz lezy na ziemi).
    """
    obs = []
    for n, b in enumerate(items):
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=b.seg, v_segments=b.rings, radius=1.0)
        for v in bm.verts:
            d = v.co.normalized()
            k = 1.0 + b.lump * (hsh(v.index, n, seed) - 0.5) * 2.0
            v.co = Vector((d.x * b.r.x * k, d.y * b.r.y * k, d.z * b.r.z * k)) + b.c
            if flat_bottom and v.co.z < 0.0:
                v.co.z = 0.0
        others = [o for o in items if o is not b]
        # Usuwane sa tylko sciany calkiem schowane w innej bryle - bez szczelin na styku.
        dead = [f for f in bm.faces if any(all(o.inside(v.co, 0.92) for v in f.verts) for o in others)]
        bmesh.ops.delete(bm, geom=dead, context='FACES')
        ob = m._add(bm, cols[1], 0.0)
        z0, z1 = b.c.z - b.r.z, b.c.z + b.r.z

        def tone(co, no, z0=z0, z1=z1):
            t = (co.z - z0) / (z1 - z0)
            own = shade(co, no, t) if shade else None
            return own if own else ramp(cols, 0.15 + 0.5 * t + 0.35 * no.z)

        paint_loops(ob, tone)
        rad = (b.r.x + b.r.y) / 2

        def arc(co, b=b, rad=rad):
            # Odleglosc po poludniku od spodu bryly: rzedy wzoru rownej wielkosci takze na wierzchu.
            return rad * (math.pi - math.acos(max(-1.0, min(1.0, (co.z - b.c.z) / b.r.z))))

        uv_wrap(ob, pid, b.c.x, b.c.y, rad, arc)
        obs.append(ob)
    return obs


def trunk(m, r0, r1, h, seg=6, col='bark', z=0.0, x=0.0, y=0.0, paint=None, bands=None):
    """Pien: stozek sciety bez podstaw (spod w ziemi, wierzch w koronie), wzor kory."""
    ob = m.cyl(r0, h, seg, x=x, y=y, z=z, col=col, r_top=r1, bottom=False, top=False, paint=paint, bands=bands)
    uv_wrap(ob, BARK, x, y, (r0 + r1) / 2)
    return ob


# ---------------------------------------------------------------- drzewa

def tree_leaf(m):
    """Lisciaste (dab, lipa): krotki, gruby pien i szeroka, klebiasta korona z trzech bryl."""
    trunk(m, 0.06, 0.038, 0.5)
    blobs(m, [Blob(0.0, 0.0, 0.7, 0.3, 0.28, 0.23, 8, 5, 0.07), Blob(0.18, -0.1, 0.58, 0.18, 0.17, 0.14, 6, 4),
              Blob(-0.1, 0.08, 0.86, 0.19, 0.18, 0.14, 6, 4)],
          FOLIAGE, ('leaf_deep', 'leaf_mid', 'leaf_sun'), seed=1)


def tree_leaf2(m):
    """Brzoza: smukly bialy pien z ciemnymi przetarciami i jajowata, jasna korona z dwoch bryl."""
    trunk(m, 0.038, 0.024, 0.74, col='birch_bark', bands=[0.3, 0.36],
          paint=lambda k, j: 'birch_mark' if j == 1 and k % 3 != 0 else None)
    blobs(m, [Blob(0.0, 0.0, 0.8, 0.2, 0.19, 0.27, 8, 6, 0.06), Blob(0.04, -0.03, 1.05, 0.13, 0.12, 0.15, 6, 4)],
          FOLIAGE, ('birch_deep', 'birch_mid', 'birch_sun'), seed=2)


def pine_tier(m, z, radius, h, cols, seed=0):
    """Pietro galezi swierka: stozek z opadajacym brzegiem (spod widoczny od dolu), wzor igliwia."""
    prof = [(radius * 0.45, z - 0.03), (radius, z + 0.07 * h), (radius * 0.3, z + 0.72 * h)]
    ob = m.lathe(prof, 8, col=cols[1])
    me = ob.data
    for v in me.vertices:
        a = math.atan2(v.co.y, v.co.x)
        # Brzeg opada czterema falami wokol pnia - galezie, nie rowny stozek.
        if abs(v.co.z - (z + 0.07 * h)) < 1e-4:
            v.co.z -= 0.035 * h * (1 + math.cos(a * 4 + seed))
    paint_loops(ob, lambda co, no: ramp(cols, 0.1 + 0.8 * (co.z - z) / h + 0.25 * no.z))
    uv_wrap(ob, NEEDLES, 0.0, 0.0, radius * 0.7)
    return ob


def tree_pine(m):
    """Swierk: wysoki, ciemny, trzy pietra galezi z zabkowanym brzegiem."""
    trunk(m, 0.05, 0.035, 0.36)
    cols = ('pine_deep', 'pine_mid', 'pine_sun')
    pine_tier(m, 0.2, 0.36, 0.5, cols, 0)
    pine_tier(m, 0.5, 0.28, 0.46, cols, 1)
    pine_tier(m, 0.78, 0.19, 0.48, cols, 2)


def tree_pine2(m):
    """Sosna: wysoki pien, u gory rudawy, i plaska, parasolowata korona z trzech bryl."""
    trunk(m, 0.045, 0.028, 0.86, col='bark', bands=[0.4], paint=lambda k, j: 'scots_bark' if j == 1 else None)
    blobs(m, [Blob(0.0, 0.0, 0.92, 0.26, 0.24, 0.13, 8, 4, 0.08), Blob(0.15, -0.06, 0.78, 0.16, 0.15, 0.09, 6, 4),
              Blob(-0.13, 0.08, 1.03, 0.15, 0.14, 0.09, 6, 4)],
          FOLIAGE, ('scots_deep', 'scots_mid', 'scots_sun'), seed=3)


def felled_trunk(m):
    """Pien scietego drzewa lezacy wzdluz X (srodek w osi): niesiony przez drwala, po okrzesaniu ten sam -
    grubosc jak towar drewno (good_8) niesiony przez postac."""
    ob = m.cyl(0.04, 0.42, 8, x=-0.21, col='bark', r_top=0.03, ry=math.pi / 2)
    me = ob.data
    lay = me.uv_layers.new(name='UVMap')
    for poly in me.polygons:
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            lay.data[li].uv = (BARK * PATTERN_STRIDE + math.atan2(co.z, co.y) * 0.035, co.x)


def felled_branches(m):
    """Galezie z liscmi scietego drzewa (w ukladzie felled_trunk) - znikaja po okrzesaniu."""
    for (x0, x1, y1, z1, col) in ((0.04, 0.13, 0.07, 0.05, 'leaf_mid'), (0.09, 0.17, -0.07, 0.04, 'leaf_deep'),
                                  (0.14, 0.22, 0.05, -0.04, 'leaf_mid'), (0.17, 0.27, -0.03, 0.06, 'leaf_deep')):
        m.beam((x0, 0, 0), (x1, y1, z1), 0.012, 'bark')
        m.sphere(0.05, 5, 3, x=x1, y=y1, z=z1, col=col)
    m.sphere(0.065, 5, 3, x=0.25, col='leaf_mid')


def stump(m):
    """Pniak: niski pien z trzema korzeniami, na wierzchu jasne drewno z ciemnym slojem."""
    trunk(m, 0.085, 0.072, 0.12, seg=8)
    m.cyl(0.072, 0.006, 8, z=0.114, col='wood_light', bottom=False)
    m.cyl(0.04, 0.004, 8, z=0.12, col='wood', bottom=False)
    for k in range(3):
        # Korzen: stozek od pnia skosnie w dol i na zewnatrz.
        a = k * 2.1 + 0.4
        m.cyl(0.035, 0.12, 5, x=math.cos(a) * 0.05, y=math.sin(a) * 0.05, z=0.05, col='bark_dark', r_top=0.006, rz=a, ry=2.05, bottom=False)


# ---------------------------------------------------------------- skaly

def rock_shade(co, no, t):
    """Mech na wierzchu glazu (plamy wg polozenia)."""
    if no.z > 0.55 and hsh(round(co.x * 30), round(co.y * 30)) < 0.45:
        return ramp(('moss', 'rock_sun'), 0.2 + 0.4 * t)
    return None


ROCK_COLS = ('rock_deep', 'rock_mid', 'rock_sun')


def stone(m):
    """Skala: duzy, obly glaz z mniejszymi u boku (glowna bryla o promieniu ~0,26 - kamieniarz bije w jej sciane)."""
    blobs(m, [Blob(0.0, 0.0, 0.07, 0.26, 0.22, 0.2, 8, 6, 0.13), Blob(0.2, 0.1, 0.03, 0.15, 0.13, 0.11, 7, 5, 0.15),
              Blob(-0.18, -0.12, 0.02, 0.12, 0.11, 0.09, 6, 4, 0.15), Blob(0.06, -0.2, 0.0, 0.09, 0.08, 0.07, 6, 4, 0.15)],
          ROCK, ROCK_COLS, seed=11, shade=rock_shade, flat_bottom=True)


def stone2(m):
    """Skala: wysoka, postrzepiona turnia z plaska plyta i kamieniem u stop."""
    blobs(m, [Blob(0.0, 0.0, 0.1, 0.22, 0.2, 0.27, 8, 6, 0.14), Blob(0.18, -0.06, 0.0, 0.17, 0.13, 0.07, 7, 4, 0.12),
              Blob(-0.16, 0.12, 0.02, 0.1, 0.09, 0.08, 6, 4, 0.15), Blob(-0.08, -0.17, 0.0, 0.08, 0.07, 0.06, 6, 4, 0.15)],
          ROCK, ROCK_COLS, seed=12, shade=rock_shade, flat_bottom=True)


# ---------------------------------------------------------------- pola

# Rzedy pola (jak ROWS w client/render/work/field.ts): przesuniecie w x, dlugosc wzdluz y. Kazdy rzad to dwa
# grzbiety klosow (srodki co RIDGE_GAP) - z kamery szesc rownych pasow z waska bruzda miedzy nimi.
FIELD_ROWS = ((-0.22, 0.42), (0.0, 0.64), (0.22, 0.42))
RIDGE_W, RIDGE_GAP, ROW_H, ROW_Z = 0.084, 0.11, 0.14, 0.03
RIPE = ('wheat_deep', 'wheat_mid', 'wheat_sun')
SPROUT = ('sprout_deep', 'sprout_mid', 'sprout_sun')


def field_plot(m):
    """Zaorana ziemia pola (szesciokat r = 0.42), ciemniejsza ku brzegowi; bez koloru instancji (gra barwi nim
    tylko dojrzewajace zboze)."""
    ob = m.cyl(0.42, 0.03, 6, col='soil')
    paint_loops(ob, lambda co, no: ramp(('soil_furrow', 'soil', 'soil_top'), 0.3 + 0.6 * co.z / 0.03 - 0.25 * math.hypot(co.x, co.y)))
    uv_plain(ob)


def ridge(m, x, y, length, cols, h):
    """Grzbiet zboza wzdluz Y: zdzbla (wzor na scianach) i zaokraglony wierzch z klosami."""
    body = m.block(RIDGE_W, length, h, x=x, y=y, z=ROW_Z, col=cols[1], bevel=0.0, open_sides=('-z', '+z'), wall=STALKS)
    paint_loops(body, lambda co, no: ramp(cols, 0.1 + 0.55 * (co.z - ROW_Z) / h))
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=6, radius1=1.0, radius2=1.0, depth=length)
    for v in bm.verts:
        v.co = Vector((v.co.x * RIDGE_W * 0.62, v.co.z, v.co.y * 0.04))
    bmesh.ops.translate(bm, vec=(x, y, ROW_Z + h), verts=bm.verts)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    crown = m._add(bm, cols[2], 0.0)
    paint_loops(crown, lambda co, no: ramp(cols, 0.55 + 0.45 * no.z))
    me = crown.data
    lay = me.uv_layers.new(name='UVMap')
    for poly in me.polygons:
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            # Klosy: u wzdluz grzbietu, v w poprzek.
            lay.data[li].uv = (EARS * PATTERN_STRIDE + co.y, math.atan2(co.z - ROW_Z - h, co.x - x) * 0.03)


def wheat_row(m, x, y, length, cols, h=ROW_H):
    """Rzad zboza wzdluz Y (od y + length/2 do y - length/2): dwa grzbiety po bokach osi x."""
    for s in (-1, 1):
        ridge(m, x + s * RIDGE_GAP / 2, y, length, cols, h)


def field(m):
    """Pole rosnace (gra skaluje wysokosc wg wzrostu i podbarwia ku zlotu przed dojrzaloscia): zielone rzedy."""
    field_plot(m)
    for x, length in FIELD_ROWS:
        wheat_row(m, x, 0.0, length, SPROUT)


def field_ripe(m):
    """Pole dojrzale: zlote rzedy klosow."""
    field_plot(m)
    for x, length in FIELD_ROWS:
        wheat_row(m, x, 0.0, length, RIPE)


# ---------------------------------------------------------------- znaki, ruina

def sign(m):
    """Znak geologa: palik z deszczulka i symbolem zloza (bialy - gra barwi go kolorem zloza)."""
    uv_plain(m.cyl(0.016, 0.42, 6, col='wood', r_top=0.013))
    uv_plain(m.block(0.2, 0.025, 0.14, y=-0.012, z=0.25, col='sign_board', bevel=0.006))
    m.sphere(0.04, 8, 4, y=-0.03, z=0.32, col='white', sy=0.5)


def ruin(m):
    """Zgliszcza: resztki kamiennych scian, zweglone belki i kupka popiolu."""
    stones = {'+y': ([-0.12, 0.0, 0.12], [0.04], lambda i, j: 'stone_dark' if (i + j) % 2 else None)}
    m.block(0.5, 0.06, 0.12, y=0.2, col='stone', paint=stones)
    m.block(0.06, 0.34, 0.08, x=-0.24, y=0.0, col='stone', paint={'+x': ([0.0], [0.04], lambda i, j: 'stone_dark' if (i + j) % 2 else None)})
    m.block(0.16, 0.06, 0.18, x=-0.17, y=0.2, col='stone_light')
    blobs(m, [Blob(0.04, -0.02, 0.0, 0.22, 0.2, 0.06, 8, 4, 0.2)], ROCK, ('char', 'ash', 'stone_dark'), seed=21, flat_bottom=True)
    for (p0, p1) in (((-0.15, -0.12, 0.02), (0.2, 0.05, 0.05)), ((0.1, -0.18, 0.02), (-0.05, 0.14, 0.2)), ((0.22, 0.12, 0.0), (0.14, 0.18, 0.24))):
        m.beam(p0, p1, 0.04, 'char')


# ---------------------------------------------------------------- pozostale obiekty mapy

def fire(m):
    m.cone(0.22, 0.5, 5, col='fire')
    m.cone(0.13, 0.34, 5, x=0.08, y=0.04, z=0.1, col='fire_core')
    m.cone(0.1, 0.3, 5, x=-0.1, y=-0.05, z=0.05, col='fire')


def border(m):
    m.cyl(0.03, 0.2, 4, col='white', r_top=0.02)


def flag(m):
    m.cyl(0.018, 0.56, 4, col='wood')
    m.cyl(0.03, 0.02, 4, z=0.56, col='gold')


def flag_cloth(m):
    # Plotno biale - kolor gracza nakladany w rendererze.
    m.box(0.2, 0.012, 0.13, x=0.1, z=0.4, col='white', jitter=0)


def animal(m):
    """Jelen (cel mysliwego)."""
    m.box(0.1, 0.24, 0.1, z=0.12, col='deer')
    m.box(0.07, 0.09, 0.08, y=-0.14, z=0.22, col='deer')
    m.box(0.05, 0.05, 0.06, y=-0.15, z=0.17, col='deer_light')
    for x in (-0.03, 0.03):
        m.box(0.01, 0.01, 0.07, x=x, y=-0.14, z=0.29, col='wood_dark')
        for y in (-0.08, 0.08):
            m.box(0.025, 0.025, 0.12, x=x, y=y, col='deer')


BUILDERS = {
    'tree_pine': tree_pine, 'tree_pine2': tree_pine2, 'tree_leaf': tree_leaf, 'tree_leaf2': tree_leaf2, 'stump': stump,
    'stone': stone, 'stone2': stone2, 'field': field, 'field_ripe': field_ripe, 'sign': sign, 'ruin': ruin, 'fire': fire,
    'border': border, 'flag': flag, 'flag_cloth': flag_cloth, 'animal': animal, 'felled_trunk': felled_trunk,
    'felled_branches': felled_branches,
}

if __name__ == '__main__':
    # Gladkie cieniowanie do 75 stopni (jak postacie): korony, glazy i pnie bez widocznych scian.
    build(BUILDERS, icons=False, smooth=75.0)
