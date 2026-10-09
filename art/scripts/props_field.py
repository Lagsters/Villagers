"""
Rekwizyty scen pracy zawodow w terenie (client/render/work/field.ts): lesnik, kamieniarz, rybak, mysliwy,
rolnik i jelen. Modele z prefiksem fld_. Uklady:
- "narzedzie" (fld_rod, fld_scythe): poczatek w barku, dlon w z = HAND, przod na -Y (jak tool_* w units.py);
- "tulow" (fld_quiver, fld_seedbag): uklad modelu tulowia postaci (poczatek na ziemi pod biodrami);
- jelen (fld_deer_*): jednostki jak model `animal`, rysowany ze skala postaci; noga i glowa maja poczatek
  w stawie (biodro, nasada szyi) - gra je obraca;
- stanowiska przy chatach (fld_seedbed, fld_table, fld_rack, fld_netrack): jednostki modelu budynku;
- pozostale: poczatek u podstawy, wymiary opisane przy modelu.
Uruchomienie: blender --background --python art/scripts/props_field.py [-- nazwa ...]
"""
import math
import os
import sys

import bmesh

sys.path.insert(0, os.path.dirname(__file__))
from lib import PALETTE, build  # noqa: E402

PALETTE.update({
    'wicker': '#c8a46a', 'wicker_dark': '#9c7a44', 'linen': '#e9dfc8', 'cork': '#c79a5e', 'float_red': '#d23a2a',
    'straw': '#d8bf72', 'stubble': '#9c8448', 'soil_dark': '#4e3520', 'soil_ridge': '#7a5636', 'net': '#ece4cc',
    'net_gap': '#5d5a50', 'leather': '#7a5230', 'fletch': '#c0392b', 'deer_dark': '#6e4527', 'antler': '#e6dcc4',
    'hoof': '#3a2f28', 'eye': '#1c1c1c',
})

R = math.pi / 2
HAND = -0.15


# ---------------------------------------------------------------- lesnik, rolnik: ziemia

def fld_soil(m):
    """Zaorana ziemia pola (r = 0.42 jak plaskie pole `field`) z bruzdami miedzy rzedami - pod siew i pod skoszone zboze."""
    m.cyl(0.42, 0.03, 6, col='soil')
    for x in (-0.33, -0.11, 0.11, 0.33):
        m.box(0.045, 0.66 - abs(x) * 0.95, 0.006, x=x, z=0.03, col='soil_dark', jitter=0.0)
    for x in (-0.22, 0.0, 0.22):
        m.box(0.07, 0.64 - abs(x), 0.01, x=x, z=0.03, col='soil_ridge', jitter=0.0)


def fld_wheat_row(m):
    """Rzad dojrzalego zboza o dlugosci 1 (od y = 0 do y = -1; gra skraca go skala), przekroj jak w `field_ripe`."""
    m.box(0.1, 1.0, 0.34, y=-0.5, z=0.03, col='wheat')
    m.box(0.12, 1.0, 0.04, y=-0.5, z=0.37, col='wheat', jitter=0.0)


def fld_stubble(m):
    """Rzerysko (krotkie sciete zdzbla) - niski rzad o dlugosci 1 (od y = 0 do y = -1)."""
    m.box(0.1, 1.0, 0.035, y=-0.5, z=0.03, col='stubble', jitter=0.0)


def fld_swath(m):
    """Pokos: sciete zboze lezace na ziemi (dlugosc 1 wzdluz -Y), klosy po prawej stronie (+X)."""
    m.box(0.09, 1.0, 0.03, x=-0.015, y=-0.5, z=0.03, col='straw', jitter=0.0)
    m.box(0.04, 1.0, 0.04, x=0.05, y=-0.5, z=0.03, col='wheat', jitter=0.0)


# ---------------------------------------------------------------- kamieniarz

def fld_lumps(m):
    """Nierowne narosla bloku wyrabanego ze skaly, wokol kostki `good_11` (0.1 x 0.08 x 0.07, podstawa z = 0):
    duze, kanciaste guzy na scianach i grzbiecie, razem z kostka czytelne jako jeden nieforemny kamien.
    Gra zmniejsza je wzgledem srodka kostki (0, 0, 0.035) przy ociosywaniu, az schowaja sie w kostce."""
    for (x, y, z, r, sx, sy, sz, col) in ((0.03, 0.0, 0.06, 0.042, 1.2, 1.0, 0.7, 'stone'),
                                          (-0.03, -0.01, 0.055, 0.04, 1.1, 1.1, 0.75, 'stone_dark'),
                                          (0.0, 0.03, 0.03, 0.038, 1.3, 0.8, 0.9, 'stone'),
                                          (0.012, -0.03, 0.025, 0.036, 1.2, 0.8, 0.85, 'stone_light'),
                                          (-0.045, 0.02, 0.02, 0.03, 0.9, 1.1, 0.9, 'stone')):
        m.ico(r, x=x, y=y, z=z, col=col, sub=0, sx=sx, sy=sy, sz=sz)


# ---------------------------------------------------------------- rybak

def fld_rod(m):
    """Wedka do zarzucania (uklad narzedzia): dluga, bez zylki - zylke rysuje gra od czubka (0, -0.48, HAND + 0.26)."""
    m.beam((0, 0.05, HAND - 0.012), (0, -0.04, HAND + 0.01), 0.016, 'cork')
    m.cyl(0.014, 0.012, 8, x=0.0, y=0.02, z=HAND - 0.004, col='metal_dark', rx=R)
    m.beam((0, -0.04, HAND + 0.01), (0, -0.25, HAND + 0.13), 0.011, 'wood_light')
    m.beam((0, -0.25, HAND + 0.13), (0, -0.48, HAND + 0.26), 0.007, 'wood_light')


def fld_float(m):
    """Splawik (skala swiata, poczatek na linii wody): biala bania pod woda do polowy, czerwona czapka i antenka."""
    m.sphere(0.013, 8, 4, z=0.0, col='white', sz=1.2)
    m.cone(0.012, 0.022, 8, z=0.006, col='float_red')
    m.beam((0, 0, 0.02), (0, 0, 0.04), 0.003, 'float_red')


def fld_line(m):
    """Odcinek o dlugosci 1 (od z = 0 do z = 1) i przekroju 1 x 1 - zylka, cieciwa: gra skaluje go macierza."""
    m.box(1.0, 1.0, 1.0, col='white', jitter=0.0)


def fld_ripple(m):
    """Plaski pierscien fali na wodzie (srednica 1), bialy - kolor i rozmiar nadaje gra."""
    bm = bmesh.new()
    seg = 14
    ro, ri = 0.5, 0.42
    outer = [bm.verts.new((ro * math.cos(2 * math.pi * k / seg), ro * math.sin(2 * math.pi * k / seg), 0)) for k in range(seg)]
    inner = [bm.verts.new((ri * math.cos(2 * math.pi * k / seg), ri * math.sin(2 * math.pi * k / seg), 0)) for k in range(seg)]
    for k in range(seg):
        bm.faces.new((outer[k], outer[(k + 1) % seg], inner[(k + 1) % seg], inner[k]))
    bm.normal_update()
    for f in bm.faces:
        if f.normal.z < 0:
            f.normal_flip()
    m._add(bm, 'white', 0.0)


def fld_basket(m):
    """Kosz wiklinowy na ryby (skala postaci, podstawa z = 0, wierzch palaka z = 0.11)."""
    m.cyl(0.036, 0.05, 8, col='wicker', r_top=0.045, bands=[0.012, 0.024, 0.036],
          paint=lambda k, j: 'wicker_dark' if (j + k) % 2 else None)
    m.cyl(0.047, 0.008, 8, z=0.048, col='wicker_dark', bottom=False)
    pts = [(-0.043, 0, 0.05), (-0.03, 0, 0.09), (0, 0, 0.108), (0.03, 0, 0.09), (0.043, 0, 0.05)]
    for a, b in zip(pts, pts[1:]):
        m.beam(a, b, 0.008, 'wicker_dark')


def fld_net(m):
    """Siec rozwieszona do suszenia (uklad budynku): szerokosc 0.32, wisi od z = 0 (zerdz) do z = -0.1;
    oczka malowane na przedzie (jasne nici, ciemne oczka), z tylu gladka. Gra kolysze ja wokol zerdzi."""
    w, h = 0.32, 0.1
    step = 0.04
    ucuts = []
    for k in range(1, int(w / step)):
        u = -w / 2 + k * step
        ucuts += [u - 0.004, u + 0.004]
    vcuts = []
    for k in range(1, int(h / 0.033) + 1):
        v = k * 0.033
        if v < h - 0.01:
            vcuts += [v - 0.004, v + 0.004]

    def paint(i, j):
        line_u = i % 2 == 1
        line_v = j % 2 == 1
        return None if (line_u or line_v) else 'net_gap'
    m.block(w, 0.006, h, z=-h, col='net', bevel=0.0, paint={'-y': (ucuts, vcuts, paint)})
    # Plywaki z korka na gornej krawedzi.
    for k in range(4):
        m.cbox(0.022, 0.012, 0.014, x=-0.12 + k * 0.08, y=0.0, z=-0.008, col='cork')


# ---------------------------------------------------------------- mysliwy

def fld_bow(m):
    """Luk bez cieciwy (cieciwe rysuje gra): majdan w poczatku ukladu, ramiona wzdluz Y (+-0.14), konce
    odgiete ku +Z (ku lucznikowi, gdy luk jest w dloni na koncu wyciagnietej reki)."""
    pts = []
    for k in range(7):
        t = -0.14 + k * 0.28 / 6
        pts.append((0.0, t, 0.042 * (t / 0.14) ** 2))
    for a, b in zip(pts, pts[1:]):
        m.beam(a, b, 0.011, 'wood_dark')
    m.cbox(0.016, 0.03, 0.016, col='leather')


def fld_arrow(m):
    """Strzala: poczatek w nasadce (na cieciwie), grot na -Y (dlugosc 0.22, skala postaci)."""
    m.beam((0, 0.0, 0), (0, -0.2, 0), 0.006, 'wood_light')
    m.cone(0.009, 0.028, 4, y=-0.195, col='metal_dark', rx=R)
    for (rz, col) in ((0.0, 'fletch'), (R, 'white')):
        m.cbox(0.002, 0.04, 0.014, y=-0.03, col=col, rz=0.0, ry=rz)


def fld_quiver(m):
    """Kolczan na plecach (uklad tulowia): skorzany tubus z lotkami strzal nad prawym barkiem i pas przez piers."""
    m.cyl(0.022, 0.15, 7, x=0.02, y=0.085, z=0.16, col='leather', rx=0.3, ry=0.35)
    m.cyl(0.024, 0.012, 7, x=0.022, y=0.086, z=0.16, col='wood_dark', rx=0.3, ry=0.35)
    for (dx, dy, col) in ((0.0, 0.0, 'fletch'), (0.012, -0.008, 'white'), (-0.01, 0.006, 'fletch')):
        m.beam((0.07 + dx, 0.13 + dy, 0.29), (0.085 + dx, 0.145 + dy, 0.34), 0.012, col)
    m.beam((0.07, -0.072, 0.3), (-0.07, -0.074, 0.15), 0.014, 'leather')


def fld_deer_body(m):
    """Tulow jelenia (jednostki jak `animal`, przod na -Y): beczkowaty, jasny brzuch i lustro, ogon."""
    m.sphere(0.055, 8, 5, z=0.178, col='deer', sx=0.95, sy=2.1, sz=0.95,
             paint=lambda c: 'deer_light' if c.z < -0.028 else ('deer_dark' if c.z > 0.045 else None))
    m.sphere(0.03, 6, 3, y=0.1, z=0.19, col='deer_light', sx=1.2, sy=0.6)
    m.box(0.016, 0.02, 0.028, y=0.122, z=0.19, col='deer_dark', rx=-0.5)


def fld_deer_head(m):
    """Szyja, glowa, uszy i poroze jelenia; poczatek w nasadzie szyi (przod na -Y). Gra pochyla ja (pasienie, upadek)."""
    m.sphere(0.026, 6, 4, y=-0.02, z=0.04, col='deer', sx=0.9, sz=1.9, rx=0.45)
    m.sphere(0.03, 7, 4, y=-0.045, z=0.095, col='deer', sx=0.85, sy=1.15)
    m.sphere(0.018, 6, 3, y=-0.085, z=0.083, col='deer_light', sx=0.9, sy=1.3)
    m.sphere(0.007, 4, 2, y=-0.103, z=0.087, col='black')
    for s in (-1, 1):
        m.sphere(0.012, 4, 2, x=s * 0.03, y=-0.03, z=0.122, col='deer_dark', sx=1.6, sy=0.5)
        m.sphere(0.005, 4, 2, x=s * 0.024, y=-0.068, z=0.104, col='eye')
        base = (s * 0.014, -0.038, 0.12)
        top = (s * 0.045, -0.03, 0.2)
        m.beam(base, top, 0.008, 'antler')
        m.beam((s * 0.027, -0.035, 0.155), (s * 0.03, -0.065, 0.185), 0.006, 'antler')
        m.beam((s * 0.038, -0.032, 0.18), (s * 0.06, -0.025, 0.205), 0.006, 'antler')


def fld_deer_leg(m):
    """Noga jelenia z poczatkiem w stawie (biodro/lopatka), spod kopyta na z = -0.136."""
    m.sphere(0.018, 5, 3, z=-0.03, col='deer', sz=2.0)
    m.beam((0, 0, -0.05), (0, 0.004, -0.122), 0.011, 'deer')
    m.box(0.014, 0.018, 0.014, y=0.0, z=-0.136, col='hoof')


# ---------------------------------------------------------------- rolnik

def fld_scythe(m):
    """Kosa (uklad narzedzia): dlugie kosisko z raczka i szerokie, wygiete ostrze w lewo od konca kosiska."""
    end = (0.0, -0.24, HAND - 0.15)
    m.beam((0, 0.12, HAND + 0.13), end, 0.014, 'wood')
    m.beam((0, -0.02, HAND - 0.01), (0.045, -0.03, HAND - 0.005), 0.011, 'wood_dark')
    pts = [end, (-0.07, -0.27, HAND - 0.16), (-0.14, -0.265, HAND - 0.165), (-0.2, -0.22, HAND - 0.165)]
    for a, b in zip(pts, pts[1:]):
        mx, my, mz = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2
        ang = math.atan2(b[1] - a[1], b[0] - a[0])
        ln = math.hypot(b[0] - a[0], b[1] - a[1]) + 0.012
        m.cbox(ln, 0.026, 0.005, x=mx, y=my, z=mz, col='metal', rz=ang)
        m.cbox(ln, 0.008, 0.007, x=mx - math.sin(ang) * 0.012, y=my + math.cos(ang) * 0.012, z=mz, col='metal_dark', rz=ang)


def fld_seedbag(m):
    """Worek z ziarnem u lewego biodra na pasie przez prawe ramie (uklad tulowia); wierzch otwarty - widac ziarno."""
    m.cyl(0.04, 0.07, 7, x=-0.085, y=-0.03, z=0.1, col='linen', r_top=0.036)
    m.cyl(0.033, 0.006, 7, x=-0.085, y=-0.03, z=0.17, col='wheat', bottom=False)
    m.beam((-0.075, -0.06, 0.17), (0.05, -0.074, 0.31), 0.013, 'leather')


# ---------------------------------------------------------------- stanowiska przy chatach (jednostki modelu budynku)
# Gra stawia je na wysokosci terenu w ich srodku (teren przed budynkiem bywa wyzszy niz pole budynku),
# obrocone i przeskalowane jak budynek. Spod siega ponizej z = 0, zeby na pochylym terenie nie bylo szpar.

def fld_seedbed(m):
    """Grzadka sadzonek lesnika: ziemia (wierzch z = 0.035) w ramie z desek 0.22 x 0.12, konewka przy lewym koncu."""
    m.box(0.2, 0.11, 0.065, z=-0.03, col='soil')
    for y in (-0.025, 0.025):
        m.box(0.19, 0.012, 0.003, y=y, z=0.035, col='soil_dark', jitter=0.0)
    for (bx, by, w, d) in ((0.0, -0.057, 0.222, 0.014), (0.0, 0.057, 0.222, 0.014), (-0.107, 0.0, 0.014, 0.1), (0.107, 0.0, 0.014, 0.1)):
        m.box(w, d, 0.075, x=bx, y=by, z=-0.03, col='plank')
    # Konewka: beczulka z blachy, dziobek i palak.
    cx, cy = -0.15, 0.03
    m.cyl(0.022, 0.04, 8, x=cx, y=cy, z=-0.005, col='metal', r_top=0.019)
    m.beam((cx - 0.015, cy, 0.02), (cx - 0.05, cy - 0.01, 0.055), 0.007, 'metal')
    m.cyl(0.008, 0.006, 6, x=cx - 0.052, y=cy - 0.01, z=0.052, col='metal_dark', ry=-0.8)
    m.beam((cx + 0.016, cy, 0.03), (cx + 0.006, cy, 0.05), 0.006, 'metal_dark')
    m.beam((cx + 0.006, cy, 0.05), (cx - 0.012, cy, 0.05), 0.006, 'metal_dark')


def fld_table(m):
    """Kamienny stol kamieniarza: masywna podstawa i gruba plyta (wierzch z = 0.082), odlamki wokol."""
    m.block(0.06, 0.045, 0.095, z=-0.03, col='stone_dark', bevel=0.006, open_sides=('-z',))
    m.block(0.12, 0.08, 0.022, z=0.06, col='stone_light', bevel=0.005)
    for (x, y, r) in ((-0.06, -0.055, 0.012), (0.06, -0.06, 0.01), (0.03, 0.05, 0.011), (-0.05, 0.045, 0.009), (0.08, 0.01, 0.008)):
        m.ico(r, x=x, y=y, col='stone', sub=0, sz=0.6)


def fld_rack(m):
    """Stojak na zdobycz: dwa slupy i poprzeczka (wierzch z = 0.3) - srodek poprzeczki nad poczatkiem ukladu."""
    for x in (-0.07, 0.07):
        m.box(0.018, 0.018, 0.34, x=x, z=-0.03, col='wood')
        m.beam((x, -0.05, -0.02), (x, 0.0, 0.12), 0.012, 'wood_dark')
    m.beam((-0.095, 0.0, 0.3), (0.095, 0.0, 0.3), 0.017, 'wood_dark')


def fld_netrack(m):
    """Zerdz do suszenia sieci na trzech slupkach (wierzch z = 0.148), srodkowy slupek w poczatku ukladu."""
    for x in (-0.16, 0.0, 0.16):
        m.box(0.016, 0.016, 0.18, x=x, z=-0.03, col='wood')
    m.beam((-0.18, 0.0, 0.148), (0.18, 0.0, 0.148), 0.014, 'wood_dark')


BUILDERS = {
    'fld_soil': fld_soil, 'fld_wheat_row': fld_wheat_row, 'fld_stubble': fld_stubble, 'fld_swath': fld_swath,
    'fld_lumps': fld_lumps, 'fld_rod': fld_rod, 'fld_float': fld_float, 'fld_line': fld_line, 'fld_ripple': fld_ripple,
    'fld_basket': fld_basket, 'fld_net': fld_net, 'fld_bow': fld_bow, 'fld_arrow': fld_arrow, 'fld_quiver': fld_quiver,
    'fld_deer_body': fld_deer_body, 'fld_deer_head': fld_deer_head, 'fld_deer_leg': fld_deer_leg,
    'fld_scythe': fld_scythe, 'fld_seedbag': fld_seedbag,
    'fld_seedbed': fld_seedbed, 'fld_table': fld_table, 'fld_rack': fld_rack, 'fld_netrack': fld_netrack,
}

if __name__ == '__main__':
    build(BUILDERS, icons=False)
