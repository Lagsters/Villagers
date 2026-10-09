"""
Wspolna biblioteka skryptow modeli (bpy, tryb --background).

Kazdy model to zbior prostych brył z kolorem w wierzcholkach (jedna paleta dla calej gry, bez tekstur),
laczonych w jeden mesh. Eksport: art/models/<nazwa>.glb, podglad: art/previews/<nazwa>.png,
ikona 64x64: art/icons/<nazwa>.png.

Uklad: 1 jednostka = szerokosc pola mapy. Z w gore, podstawa na z = 0. Budynki modelujemy z wejsciem
na -Y i obracamy o 30 stopni, zeby drzwi patrzyly na flage (pole SE w grze).
"""
import bpy
import bmesh
import json
import math
import os
import sys
from mathutils import Matrix, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
MODELS = os.path.join(ROOT, 'models')
PREVIEWS = os.path.join(ROOT, 'previews')
ICONS = os.path.join(ROOT, 'icons')

# ---------- Paleta (sRGB) ----------
PALETTE = {
    'wall': '#e8dcc0', 'wall_dark': '#cdbf9f', 'plaster': '#f0e6cf',
    'wood': '#9a6b3f', 'wood_dark': '#6e4a2a', 'wood_light': '#c49a64', 'log': '#7a5230', 'bark': '#5b3d22',
    'roof_red': '#b0493a', 'roof_brown': '#7e5436', 'roof_green': '#5f7f3e', 'roof_blue': '#4f6a8f',
    'roof_slate': '#5c6470', 'thatch': '#c9a45a',
    'stone': '#a7a39c', 'stone_dark': '#7d7a74', 'stone_light': '#c4c0b8',
    'metal': '#8e959e', 'metal_dark': '#5a6068', 'gold': '#e8b83a', 'copper': '#b87333',
    'coal': '#2b2b2e', 'iron_ore': '#8a4f3d', 'gold_ore': '#c9a54a',
    'leaf': '#5b8f3a', 'leaf_dark': '#3f6f2e', 'pine': '#2f5f3e', 'pine_dark': '#244a31',
    'grass': '#79a84a', 'soil': '#6b4a2e', 'wheat': '#e3c25a', 'wheat_green': '#8fb04e',
    'water': '#4f86b0', 'fire': '#ff8a2a', 'fire_core': '#ffd65a', 'smoke': '#6a6a6a',
    'skin': '#f0c8a0', 'hair': '#5a3b24', 'cloth': '#ffffff', 'trousers': '#5b4a3c', 'boots': '#3a2f28',
    'donkey': '#8f8578', 'donkey_dark': '#6a6258', 'deer': '#a8703f', 'deer_light': '#d8b58a',
    'pig': '#f0a8a8', 'cream': '#f4ecd8', 'red': '#c0392b', 'white': '#f2f2f2', 'black': '#222222',
    'roof_red_dark': '#8e3a2e', 'roof_brown_dark': '#62412a', 'roof_green_dark': '#4a6630', 'roof_blue_dark': '#3d5474',
    'roof_slate_dark': '#474e58', 'thatch_dark': '#a8863f', 'glass': '#34465a', 'shutter': '#4f7a52',
    'brick': '#a2553f', 'brick_dark': '#7c3f2f',
    'terracotta': '#b8532c', 'terracotta_dark': '#86391c', 'whitewash': '#ece7dc', 'plank': '#b35a2b', 'plank_dark': '#7a3a1b',
    'log_o': '#a55a2f', 'rock': '#8d8a84',
    'tile_dark': '#94401f', 'stone_pale': '#c9ced6', 'tarpaper': '#4f4b47', 'tarpaper_dark': '#36322f',
    'bread': '#c98a3d', 'fish': '#8fb3cc', 'meat': '#b5483c', 'flour': '#f5f1e6', 'beer': '#d9a441',
}


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def color(name):
    """Kolor z palety (albo hex) jako liniowe RGBA."""
    h = PALETTE.get(name, name).lstrip('#')
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    return (srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b), 1.0)


# Krawedzie o kacie miedzy scianami ponizej tego progu cieniujemy gladko (walce >= 10 segmentow).
# Musi zostac ponizej 45 stopni: fazy narozy cieniowane gladko daja gradient na calej scianie.
SMOOTH_ANGLE = 40.0

# Wzory powierzchni rysowane w grze shaderem (client/render/scene.ts, MODEL_PATTERNS): drobne i ostre
# przy kazdym przyblizeniu, bez dodatkowych trojkatow. Numer wzoru i wspolrzedne na powierzchni (w metrach
# modelu) ida w UV: u = numer * PATTERN_STRIDE + polozenie poziome, v = wysokosc albo odleglosc od okapu.
TILES, PLANKS, LOGS, TARPAPER, FACE = 1, 2, 3, 4, 5
# Sciany bez koloru gracza w czesciach barwionych instancja (tulow, rece): skora, spodnie, pasek.
PLAIN = 6
# Natura (art/scripts/nature.py): kepy lisci, igliwie, kora, skala, zdzbla i klosy zboza.
FOLIAGE, NEEDLES, BARK, ROCK, STALKS, EARS = 7, 8, 9, 10, 11, 12
PATTERN_STRIDE = 1000.0


def surface_pattern(bm, slope=0, wall=0):
    """UV wzoru: slope - sciany skierowane w gore (polacie: u wzdluz okapu, v od okapu w gore polaci),
    wall - sciany pionowe (u poziomo wzdluz sciany, v = wysokosc, wspolna dla wszystkich scian - bale sie schodza)."""
    uvl = bm.loops.layers.uv.get('UVMap') or bm.loops.layers.uv.new('UVMap')
    up = Vector((0, 0, 1))
    for f in bm.faces:
        n = f.normal
        if slope and n.z > 0.3:
            pid = slope
        elif wall and abs(n.z) < 0.1:
            pid = wall
        else:
            continue
        t = up.cross(n)
        t = t.normalized() if t.length > 1e-6 else Vector((1, 0, 0))
        if pid == slope and n.z > 0.3:
            d = (up - n * n.z).normalized()
            v0 = min(lp.vert.co.dot(d) for lp in f.loops)
            for lp in f.loops:
                lp[uvl].uv = (pid * PATTERN_STRIDE + lp.vert.co.dot(t), lp.vert.co.dot(d) - v0)
        else:
            for lp in f.loops:
                lp[uvl].uv = (pid * PATTERN_STRIDE + lp.vert.co.dot(t), lp.vert.co.z)


def face_pattern(bm):
    """UV twarzy na glowie o srodku w poczatku ukladu: u = kat od przodu (-Y), v = wysokosc od srodka.
    Tylko sciany z przodu i z bokow - na szwie z tylu glowy (kat +-pi) interpolacja przeszlaby przez twarz."""
    uvl = bm.loops.layers.uv.get('UVMap') or bm.loops.layers.uv.new('UVMap')
    for f in bm.faces:
        c = f.calc_center_median()
        if abs(math.atan2(c.x, -c.y)) > 2.0:
            continue
        for lp in f.loops:
            co = lp.vert.co
            lp[uvl].uv = (FACE * PATTERN_STRIDE + math.atan2(co.x, -co.y), co.z)


# Podworko budynku (client/render/scene.ts, YARD_VERTEX): niskie sprzety przed i obok budynku gra stawia na terenie,
# a sciany zostaja na poziomie budynku. Konstrukcja to czesci stojace na ziemi, wysokie albo rozlegle
# (sciany, podmurowka, slupy wiaty, wieza szybowa); czesci zaczynajace sie nisko poza nia to podworko.
# Waga podworka rosnie z odlegloscia od obrysu konstrukcji (od YARD_NEAR do YARD_FAR), wiec rzeczy przy scianie
# zostaja przy niej, a dalsze leza na terenie. Ten sam wzor liczy gra dla scen (yardWeight w client/render/yard.ts).
YARD_NEAR, YARD_FAR = 0.03, 0.12
YARD_TALL, YARD_AREA, YARD_LOW = 0.24, 0.035, 0.2
# Czesc podworka nie dluzsza niz YARD_RIGID przesuwa sie w calosci (wysokosc terenu w jej srodku).
YARD_RIGID = 0.16


def yard_weight(rects, x, y):
    """Waga podworka 0..1 w punkcie (x, y) ukladu modelu: odleglosc od obrysu konstrukcji (prostokaty x0, y0, x1, y1)."""
    d = min((math.hypot(max(r[0] - x, 0.0, x - r[2]), max(r[1] - y, 0.0, y - r[3])) for r in rects), default=1.0)
    t = min(1.0, max(0.0, (d - YARD_NEAR) / (YARD_FAR - YARD_NEAR)))
    return t * t * (3 - 2 * t)


def mark_plain(bm, faces):
    """Sciany bez koloru gracza (wzor PLAIN) w czesci, ktora gra barwi kolorem gracza."""
    uvl = bm.loops.layers.uv.get('UVMap') or bm.loops.layers.uv.new('UVMap')
    for f in faces:
        for lp in f.loops:
            lp[uvl].uv = (PLAIN * PATTERN_STRIDE, 0.0)


# ---------- Scena ----------

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


class Model:
    """Buduje model z czesci; kazda czesc to osobny bmesh z jednolitym kolorem."""

    def __init__(self, name):
        self.name = name
        self.parts = []

    def _add(self, bm, col, jitter=0.04, cols=None):
        """Czesc z bmesha; cols = kolory wg material_index scian (malowany wzor), cols[0] to kolor bazowy."""
        me = bpy.data.meshes.new(f'{self.name}_part{len(self.parts)}')
        bm.to_mesh(me)
        bm.free()
        attr = me.color_attributes.new(name='Col', type='FLOAT_COLOR', domain='CORNER')
        bases = [color(c) for c in (cols or [col])]
        for poly in me.polygons:
            base = bases[min(poly.material_index, len(bases) - 1)]
            # Lekka zmiana jasnosci sciany (deterministyczna) - ozywia low-poly.
            k = 1.0 + ((poly.index * 2654435761) % 1000 / 1000 - 0.5) * jitter
            c = (min(1, base[0] * k), min(1, base[1] * k), min(1, base[2] * k), 1.0)
            for li in poly.loop_indices:
                attr.data[li].color = c
        ob = bpy.data.objects.new(me.name, me)
        bpy.context.scene.collection.objects.link(ob)
        self.parts.append(ob)
        return ob

    @staticmethod
    def _xf(bm, x, y, z, rz=0.0, rx=0.0, ry=0.0):
        m = Matrix.Translation((x, y, z)) @ Matrix.Rotation(rz, 4, 'Z') @ Matrix.Rotation(ry, 4, 'Y') @ Matrix.Rotation(rx, 4, 'X')
        bmesh.ops.transform(bm, matrix=m, verts=bm.verts)

    def box(self, w, d, h, x=0.0, y=0.0, z=0.0, col='wall', rz=0.0, rx=0.0, ry=0.0, jitter=0.04):
        """Prostopadloscian w x d x h, podstawa na z."""
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=(w, d, h), verts=bm.verts)
        bmesh.ops.translate(bm, vec=(0, 0, h / 2), verts=bm.verts)
        self._xf(bm, x, y, z, rz, rx, ry)
        return self._add(bm, col, jitter)

    def cyl(self, r, h, seg=6, x=0.0, y=0.0, z=0.0, col='wood', r_top=None, rz=0.0, rx=0.0, ry=0.0, jitter=0.04, bands=None, paint=None, bottom=True, slope=0, top=True):
        """Walec/stozek sciety (r_top) o podstawie na z. bands = wysokosci ciec (od podstawy),
        paint(segment, pas) -> kolor albo None maluje sciany boczne (kamienie wiezy, rzedy dachowek).
        bottom=False / top=False - bez dolnej / gornej podstawy (bryla stojaca na ziemi, schowana w innej)."""
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r, radius2=r if r_top is None else r_top, depth=h)
        bmesh.ops.translate(bm, vec=(0, 0, h / 2), verts=bm.verts)
        if not bottom:
            bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.normal.z < -0.99], context='FACES_ONLY')
        if not top:
            bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.normal.z > 0.99], context='FACES_ONLY')
        cols = None
        if bands:
            for c in bands:
                bmesh.ops.bisect_plane(bm, geom=list(bm.faces) + list(bm.edges) + list(bm.verts), dist=1e-6, plane_co=(0, 0, c), plane_no=(0, 0, 1))
        if paint:
            cols = [col]
            for f in bm.faces:
                if abs(f.normal.z) > 0.99 and r_top != 0.0:
                    continue
                cen = f.calc_center_median()
                k = int(((math.atan2(cen.y, cen.x) / (2 * math.pi)) % 1.0) * seg)
                j = sum(1 for c in (bands or ()) if cen.z > c)
                name = paint(k, j)
                if name:
                    if name not in cols:
                        cols.append(name)
                    f.material_index = cols.index(name)
            jitter = 0.0
        self._xf(bm, x, y, z, rz, rx, ry)
        if slope:
            surface_pattern(bm, slope=slope)
            jitter = 0.0
        return self._add(bm, col, jitter, cols)

    def cone(self, r, h, seg=6, x=0.0, y=0.0, z=0.0, col='roof_red', rz=0.0, rx=0.0, ry=0.0, bands=None, paint=None, bottom=True, slope=0):
        return self.cyl(r, h, seg, x, y, z, col, r_top=0.0, rz=rz, rx=rx, ry=ry, bands=bands, paint=paint, bottom=bottom, slope=slope)

    def sphere(self, r, seg=8, rings=5, x=0.0, y=0.0, z=0.0, col='skin', sx=1.0, sy=1.0, sz=1.0, face=False, rx=0.0, paint=None,
               half=False, plain=None, keep=None):
        """Kula UV (seg x rings; seg=4, rings=2 to osmioscian - przy gladkim cieniowaniu okragla grudka).
        face=True - twarz rysowana w grze (wzor FACE): przod kuli patrzy na -Y.
        paint(srodek sciany wzgledem srodka kuli, po skalowaniu) -> kolor albo None (np. dlon na koncu reki).
        half=True - sama gorna polkula (czasza: wlosy, czapka); rings parzyste, zeby byl rownik;
        half='flat' - polkula z plaskim dnem (np. but z plaska podeszwa).
        plain(srodek sciany) -> True: sciana bez koloru gracza (np. naga reka pod rekawem);
        keep(srodek sciany) -> False: sciany do usuniecia (np. wlosy bez czesci zaslaniajacej twarz)."""
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=r)
        if half:
            bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.calc_center_median().z < 0], context='FACES')
            if half == 'flat':
                bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary], sides=0)
        if keep:
            bmesh.ops.delete(bm, geom=[f for f in bm.faces if not keep(f.calc_center_median())], context='FACES_ONLY')
        bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=bm.verts)
        if face:
            face_pattern(bm)
        cols = None
        if paint:
            cols = [col]
            for f in bm.faces:
                name = paint(f.calc_center_median())
                if name:
                    if name not in cols:
                        cols.append(name)
                    f.material_index = cols.index(name)
        if plain:
            mark_plain(bm, [f for f in bm.faces if plain(f.calc_center_median())])
        self._xf(bm, x, y, z, rx=rx)
        return self._add(bm, col, 0.0, cols)

    def lathe(self, profile, seg=8, x=0.0, y=0.0, z=0.0, col='cloth', paint=None, plain=None):
        """Bryla obrotowa z profilu [(promien, wysokosc), ...] od dolu do gory, bez dna; gora domknieta stozkiem.
        paint(numer pasa miedzy kolejnymi punktami profilu) -> kolor albo None; plain(numer pasa) -> True:
        pas bez koloru gracza."""
        bm = bmesh.new()
        rings = []
        for (r, h) in profile:
            rings.append([bm.verts.new((r * math.cos(2 * math.pi * k / seg), r * math.sin(2 * math.pi * k / seg), h)) for k in range(seg)])
        cols = [col]

        def color_of(i):
            name = paint(i) if paint else None
            if not name:
                return 0
            if name not in cols:
                cols.append(name)
            return cols.index(name)

        flat = []
        for i in range(len(rings) - 1):
            mi = color_of(i)
            for k in range(seg):
                f = bm.faces.new((rings[i][k], rings[i][(k + 1) % seg], rings[i + 1][(k + 1) % seg], rings[i + 1][k]))
                f.material_index = mi
                if plain and plain(i):
                    flat.append(f)
        top = bm.verts.new((0, 0, profile[-1][1] + profile[-1][0] * 0.3))
        mi = color_of(len(rings) - 1)
        for k in range(seg):
            f = bm.faces.new((rings[-1][k], rings[-1][(k + 1) % seg], top))
            f.material_index = mi
        bm.normal_update()
        if flat:
            mark_plain(bm, flat)
        self._xf(bm, x, y, z)
        return self._add(bm, col, 0.0, cols)

    def ico(self, r, x=0.0, y=0.0, z=0.0, col='leaf', sub=1, sx=1.0, sy=1.0, sz=1.0):
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=r)
        bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=bm.verts)
        self._xf(bm, x, y, z)
        return self._add(bm, col)

    def gable(self, w, d, h, x=0.0, y=0.0, z=0.0, col='roof_red', rz=0.0, overhang=0.06, wall=0):
        """Dach dwuspadowy: kalenica wzdluz osi X, szerokosc w (X), glebokosc d (Y), wysokosc h."""
        bm = bmesh.new()
        hw, hd = w / 2 + overhang, d / 2 + overhang
        v = [bm.verts.new(p) for p in [(-hw, -hd, 0), (hw, -hd, 0), (hw, hd, 0), (-hw, hd, 0), (-hw, 0, h), (hw, 0, h)]]
        for f in [(0, 1, 5, 4), (2, 3, 4, 5), (0, 4, 3), (1, 2, 5), (0, 3, 2, 1)]:
            bm.faces.new([v[i] for i in f])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        self._xf(bm, x, y, z, rz)
        if wall:
            surface_pattern(bm, wall=wall)
        return self._add(bm, col)

    def hip(self, w, d, h, x=0.0, y=0.0, z=0.0, col='roof_red', overhang=0.06, rows=0, slope=0):
        """Dach czterospadowy (piramida na prostokacie); rows > 0 - rzedy dachowek malowane pasami,
        slope - wzor polaci (np. TILES, TARPAPER)."""
        bm = bmesh.new()
        hw, hd = w / 2 + overhang, d / 2 + overhang
        v = [bm.verts.new(p) for p in [(-hw, -hd, 0), (hw, -hd, 0), (hw, hd, 0), (-hw, hd, 0), (0, 0, h)]]
        for f in [(0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4), (0, 3, 2, 1)]:
            bm.faces.new([v[i] for i in f])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        cols = None
        if rows:
            # Kazdy rzad: dachowka i ciemniejszy cien przy dolnej krawedzi rzedu.
            cuts = []
            for k in range(rows):
                cuts += [h * k / rows, h * (k + 0.28) / rows]
            for c in cuts[1:]:
                bmesh.ops.bisect_plane(bm, geom=list(bm.faces) + list(bm.edges) + list(bm.verts), dist=1e-6, plane_co=(0, 0, c), plane_no=(0, 0, 1))
            cols = [col, 'tile_dark' if col == 'terracotta' else col + '_dark']
            for f in bm.faces:
                if f.normal.z < -0.99:
                    continue
                j = sum(1 for c in cuts if f.calc_center_median().z > c)
                f.material_index = 1 if j % 2 == 1 else 0
        self._xf(bm, x, y, z)
        if slope:
            surface_pattern(bm, slope=slope)
        return self._add(bm, col, 0.0 if rows or slope else 0.04, cols)

    def cbox(self, w, d, h, x=0.0, y=0.0, z=0.0, col='wall', rx=0.0, ry=0.0, rz=0.0, jitter=0.04):
        """Prostopadloscian ze srodkiem w (x, y, z) - wygodny do obracanych plyt (polacie dachu, belki)."""
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=(w, d, h), verts=bm.verts)
        self._xf(bm, x, y, z, rz, rx, ry)
        return self._add(bm, col, jitter)

    def block(self, w, d, h, x=0.0, y=0.0, z=0.0, col='wall', rx=0.0, ry=0.0, rz=0.0, bevel=0.008, paint=None, center=False, open_sides=(), slope=0, wall=0):
        """
        Prostopadloscian ze sfazowanymi krawedziami i wzorem (spoiny, dachowki, bale) malowanym kolorem
        na plaskich scianach - bez drobnych wystajacych bryl, ktore z kamery szarpia sylwetke i migocza.
        paint = {strona: (ciecia_u, ciecia_v, f(i, j) -> kolor albo None)}; strona to '-y', '+y', '-x', '+x',
        '+z' albo '-z'; u, v to wspolrzedne lokalne sciany: dla scian Y (x, z), dla X (y, z), dla Z (x, y).
        Ciecia sa we wspolrzednych lokalnych (srodek bryly w x = y = 0, z od 0 do h; center=True - z od -h/2).
        open_sides = strony bez sciany (niewidoczne: spod na ziemi, gora sciany pod dachem).
        slope, wall = wzor rysowany w grze na scianach skierowanych w gore / pionowych (TILES, PLANKS, LOGS, TARPAPER).
        """
        z0 = -h / 2 if center else 0.0
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=(w, d, h), verts=bm.verts)
        bmesh.ops.translate(bm, vec=(0, 0, z0 + h / 2), verts=bm.verts)
        paint = paint or {}
        axes = {'x': (0, 1, 2), 'y': (1, 0, 2), 'z': (2, 0, 1)}  # os normalnej, os u, os v

        def side_faces(side):
            ax = axes[side[1]][0]
            sg = 1 if side[0] == '+' else -1
            return [f for f in bm.faces if f.normal[ax] * sg > 0.99]

        for side in open_sides:
            bmesh.ops.delete(bm, geom=side_faces(side), context='FACES_ONLY')

        for side, (ucuts, vcuts, _fn) in paint.items():
            _, au, av = axes[side[1]]
            for (axis, cuts) in ((au, ucuts), (av, vcuts)):
                for c in cuts:
                    faces = side_faces(side)
                    geom = list(faces) + list({e for f in faces for e in f.edges}) + list({v for f in faces for v in f.verts})
                    no = [0.0, 0.0, 0.0]
                    no[axis] = 1.0
                    co = [0.0, 0.0, 0.0]
                    co[axis] = c
                    bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-6, plane_co=co, plane_no=no)
        if bevel > 0:
            edges = [e for e in bm.edges if len(e.link_faces) == 2 and e.calc_face_angle(0) > 1.0]
            verts = list({v for e in edges for v in e.verts})
            bmesh.ops.bevel(bm, geom=edges + verts, offset=min(bevel, w / 3, d / 3, h / 3), offset_type='OFFSET',
                            segments=1, profile=0.5, affect='EDGES', clamp_overlap=True, material=-1)
        cols = [col]
        for side, (ucuts, vcuts, fn) in paint.items():
            ax, au, av = axes[side[1]]
            sg = 1 if side[0] == '+' else -1
            for f in bm.faces:
                if f.normal[ax] * sg <= 0.99:
                    continue
                cen = f.calc_center_median()
                i = sum(1 for c in ucuts if cen[au] > c)
                j = sum(1 for c in vcuts if cen[av] > c)
                name = fn(i, j)
                if name:
                    if name not in cols:
                        cols.append(name)
                    f.material_index = cols.index(name)
        self._xf(bm, x, y, z, rz, rx, ry)
        if slope or wall:
            surface_pattern(bm, slope, wall)
        return self._add(bm, col, 0.0, cols)

    def beam(self, p0, p1, t=0.03, col='wood_dark'):
        """Belka o przekroju t x t miedzy punktami p0 i p1 (krotki od zera do dowolnego kierunku)."""
        a, b = Vector(p0), Vector(p1)
        d = b - a
        length = d.length
        if length < 1e-6:
            return None
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=(t, t, length), verts=bm.verts)
        rot = Vector((0, 0, 1)).rotation_difference(d.normalized()).to_matrix().to_4x4()
        mid = (a + b) / 2
        bmesh.ops.transform(bm, matrix=Matrix.Translation(mid) @ rot, verts=bm.verts)
        return self._add(bm, col)

    def wedge(self, w, d, h, x=0.0, y=0.0, z=0.0, col='wood', rz=0.0):
        """Klin (pochylnia): wysoki na +Y."""
        bm = bmesh.new()
        hw, hd = w / 2, d / 2
        v = [bm.verts.new(p) for p in [(-hw, -hd, 0), (hw, -hd, 0), (hw, hd, 0), (-hw, hd, 0), (-hw, hd, h), (hw, hd, h)]]
        for f in [(0, 1, 5, 4), (2, 3, 4, 5), (0, 4, 3), (1, 2, 5), (0, 3, 2, 1)]:
            bm.faces.new([v[i] for i in f])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        self._xf(bm, x, y, z, rz)
        return self._add(bm, col)

    def yard(self, rotate_deg=0.0):
        """
        Podworko (zob. YARD_NEAR): warstwy UV kazdej czesci - 'Yard': u = waga podworka, v = 1 na spodzie
        konstrukcji (gra wydluza go w dol do nizszego terenu); 'YardAt': punkt (x, z ukladu modelu w grze po obrocie
        rotate_deg), w ktorym gra bierze wysokosc terenu. Zwarty sprzet (pieniek, beczka, stos desek) bierze ja ze
        srodka i przesuwa sie caly, dluga czesc (zerdz plotu, belka) wierzcholek po wierzcholku - kladzie sie na
        stoku. Zwraca obrys konstrukcji [(x0, y0, x1, y1), ...] w ukladzie modelu przed obrotem.
        Eksporter glTF odwraca v (v' = 1 - v), stad zapis 1 - v.
        """
        boxes = []
        for p in self.parts:
            vs = [v.co for v in p.data.vertices]
            boxes.append((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs),
                          max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
        struct = [b[2] < 0.02 and (b[5] - b[2] > YARD_TALL or (b[3] - b[0]) * (b[4] - b[1]) > YARD_AREA) for b in boxes]
        rects = [(b[0], b[1], b[3], b[4]) for b, s in zip(boxes, struct) if s]
        ca, sa = math.cos(math.radians(rotate_deg)), math.sin(math.radians(rotate_deg))
        for p, b, s in zip(self.parts, boxes, struct):
            if not p.data.uv_layers:
                lay = p.data.uv_layers.new(name='UVMap')
                for d in lay.data:
                    d.uv = (0.0, 0.0)
            lay = p.data.uv_layers.new(name='Yard')
            at = p.data.uv_layers.new(name='YardAt')
            me = p.data
            cx, cy = (b[0] + b[3]) / 2, (b[1] + b[4]) / 2
            rigid = max(b[3] - b[0], b[4] - b[1]) <= YARD_RIGID
            w_c = yard_weight(rects, cx, cy) if not s and b[2] < YARD_LOW else 0.0
            for loop in me.loops:
                co = me.vertices[loop.vertex_index].co
                if s:
                    w, base = 0.0, 1.0 if co.z < 0.01 else 0.0
                else:
                    w, base = (w_c if rigid else yard_weight(rects, co.x, co.y)) if b[2] < YARD_LOW else 0.0, 0.0
                ax, ay = (cx, cy) if rigid and not s else (co.x, co.y)
                lay.data[loop.index].uv = (w, 1.0 - base)
                # Uklad gry: x = x Blendera, z = -y (po obrocie); v zapisane jako 1 - z.
                at.data[loop.index].uv = (ax * ca - ay * sa, 1.0 + (ax * sa + ay * ca))
        return [tuple(round(c, 4) for c in r) for r in rects]

    def finish(self, rotate_deg=0.0, ao=0.0, ao_height=0.35, smooth=SMOOTH_ANGLE):
        """
        Laczy czesci w jeden obiekt, trianguluje i obraca. Zwraca obiekt.
        ao > 0 przyciemnia wierzcholki przy ziemi (tani odpowiednik ambient occlusion w kolorach).
        """
        if any(p.data.uv_layers for p in self.parts):
            # Laczenie gubi UV czesci bez warstwy: kazda czesc dostaje UVMap, bez wzoru (u = 0).
            for p in self.parts:
                if not p.data.uv_layers:
                    lay = p.data.uv_layers.new(name='UVMap')
                    for d in lay.data:
                        d.uv = (0.0, 0.0)
        bpy.ops.object.select_all(action='DESELECT')
        for p in self.parts:
            p.select_set(True)
        bpy.context.view_layer.objects.active = self.parts[0]
        if len(self.parts) > 1:
            bpy.ops.object.join()
        ob = bpy.context.view_layer.objects.active
        ob.name = self.name
        ob.data.name = self.name
        if rotate_deg:
            ob.data.transform(Matrix.Rotation(math.radians(rotate_deg), 4, 'Z'))
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        bmesh.ops.triangulate(bm, faces=bm.faces)
        bm.to_mesh(ob.data)
        bm.free()
        ob.data.shade_smooth()
        ob.data.set_sharp_from_angle(angle=math.radians(smooth))
        if ao > 0:
            me = ob.data
            attr = me.color_attributes['Col']
            for loop in me.loops:
                z = me.vertices[loop.vertex_index].co.z
                k = 1.0 - ao * (1.0 - min(1.0, max(0.0, z / ao_height)))
                c = attr.data[loop.index].color
                attr.data[loop.index].color = (c[0] * k, c[1] * k, c[2] * k, 1.0)
        return ob


def tri_count(ob):
    return len(ob.data.polygons)


def export(ob, name=None):
    """Eksport pojedynczego obiektu do art/models/<nazwa>.glb."""
    name = name or ob.name
    os.makedirs(MODELS, exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    path = os.path.join(MODELS, f'{name}.glb')
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_normals=True,
        export_materials='NONE',
        export_vertex_color='ACTIVE',
        export_active_vertex_color_when_no_material=True,
    )
    return path


def render_preview(ob, name=None, size=256, icon=96):
    """Podglad PNG (i ikona) w stylu gry: kamera z gory pod katem od strony SE, przezroczyste tlo."""
    name = name or ob.name
    scene = bpy.context.scene
    try:
        scene.render.engine = 'BLENDER_WORKBENCH'
    except TypeError:
        pass
    shading = scene.display.shading
    shading.light = 'STUDIO'
    shading.color_type = 'VERTEX'
    shading.show_shadows = False
    shading.show_cavity = False
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.display_settings.display_device = 'sRGB'
    scene.view_settings.exposure = 0.7  # jasniejsze ikony
    # Kamera ortograficzna obejmujaca model.
    bb = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
    center = sum(bb, Vector()) / 8
    radius = max((v - center).length for v in bb)
    cam_data = bpy.data.cameras.new('cam')
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = radius * 1.75
    cam = bpy.data.objects.new('cam', cam_data)
    scene.collection.objects.link(cam)
    # Jak kamera w grze (od poludnia, 38 stopni nad horyzontem), lekko z boku dla czytelnosci ikon.
    direction = Vector((0.12, -0.78, 0.61)).normalized()
    cam.location = center + direction * (radius * 6 + 2)
    cam.rotation_euler = (-direction).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam
    for folder, px in ((PREVIEWS, size), (ICONS, icon)):
        if not px:
            continue
        os.makedirs(folder, exist_ok=True)
        scene.render.resolution_x = px
        scene.render.resolution_y = px
        scene.render.resolution_percentage = 100
        scene.render.filepath = os.path.join(folder, f'{name}.png')
        bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam)


def selected_names(all_names):
    """Nazwy modeli z argumentow po '--' (brak = wszystkie)."""
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    names = [a for a in argv if not a.startswith('-')]
    return [n for n in all_names if not names or n in names]


YARDS = os.path.join(MODELS, 'yards.json')


def save_yard(name, rects):
    """Obrys konstrukcji modelu do art/models/yards.json (sceny pracy licza z niego wysokosc podworka)."""
    data = {}
    if os.path.exists(YARDS):
        with open(YARDS, encoding='utf-8') as f:
            data = json.load(f)
    data[name] = rects
    rows = [f'  {json.dumps(k)}: {json.dumps(v)}' for k, v in sorted(data.items(), key=lambda kv: (len(kv[0]), kv[0]))]
    with open(YARDS, 'w', encoding='utf-8', newline='\n') as f:
        f.write('{\n' + ',\n'.join(rows) + '\n}\n')


def build(builders, icons=True, ao=0.0, smooth=SMOOTH_ANGLE, yard=None):
    """Buduje wybrane modele: builders = {nazwa: funkcja(Model)->rotacja}. Wypisuje liczbe trojkatow.
    smooth = prog gladkiego cieniowania (postacie bez faz moga wygladzac mocniej niz budynki).
    yard(nazwa) -> True: model z podworkiem (Model.yard) - budynki stojace na terenie."""
    for name in selected_names(list(builders)):
        reset()
        m = Model(name)
        rot = builders[name](m) or 0.0
        if yard and yard(name):
            save_yard(name, m.yard(rot))
        ob = m.finish(rot, ao=ao, smooth=smooth)
        export(ob)
        render_preview(ob, icon=96 if icons else 0)
        print(f'MODEL {name} tris={tri_count(ob)}')
