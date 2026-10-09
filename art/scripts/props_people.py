"""
Rekwizyty scen z client/render/work/people.ts: budowniczy (deska), kopacz (lopata, kopczyk ziemi), geolog
(wiazka znakow na plecach), rycerz (tarcza w kolorze gracza z okuciem), katapulta (ramie z koszem, kolo
zapadkowe, pocisk), osiol skladany z czesci (tulow, leb, noga, ogon), przewoznik (lodka, wioslo).
Modele z prefiksem ppl_. Narzedzia trzymane w rece maja poczatek w barku (dlon w z = HAND), jak tool_*.
Uruchomienie: blender --background --python art/scripts/props_people.py [-- nazwa ...]
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from mathutils import Matrix  # noqa: E402
from lib import PLANKS, PALETTE, build  # noqa: E402

PALETTE.update({
    'earth': '#7a5634', 'earth_dark': '#5e3f24',
})

R = math.pi / 2
HAND = -0.15


def ppl_plank(m):
    """Pojedyncza deska (dlugosc wzdluz X), srodek w poczatku ukladu, spod na z = 0."""
    m.block(0.34, 0.06, 0.016, col='wood_light', bevel=0.003, wall=PLANKS)
    for x in (-0.15, 0.15):
        m.cbox(0.012, 0.062, 0.018, x=x, z=0.008, col='wood')


def ppl_dig_shovel(m):
    """Lopata kopacza trzymana jak przedluzenie reki (poczatek w barku, dlon w z = HAND): uchwyt nad dlonia,
    trzonek wzdluz reki w dol, ostrze na koncu (lico na -Y)."""
    m.cbox(0.05, 0.014, 0.014, z=HAND + 0.04, col='wood_dark')
    m.box(0.014, 0.014, 0.22, z=HAND - 0.175, col='wood')
    m.cbox(0.022, 0.018, 0.03, z=HAND - 0.175, col='metal_dark')
    m.cbox(0.058, 0.01, 0.075, y=-0.004, z=HAND - 0.22, col='metal', rx=0.12)


def ppl_heap(m):
    """Kopczyk odrzuconej ziemi (srodek podstawy w poczatku ukladu)."""
    m.sphere(0.1, 9, 4, col='earth', sz=0.42, half=True)
    m.sphere(0.05, 7, 4, x=0.065, y=0.035, col='earth_dark', sz=0.6, half=True)
    m.sphere(0.04, 7, 4, x=-0.07, y=-0.03, col='earth_dark', sz=0.65, half=True)


def ppl_stakes(m):
    """Wiazka palikow ze znakami na plecach geologa (uklad tulowia: plecy na +Y Blendera)."""
    for k, (x, rz) in enumerate(((-0.022, 0.06), (0.0, 0.0), (0.022, -0.06))):
        y = 0.075 + (k % 2) * 0.012
        m.box(0.012, 0.012, 0.24, x=x, y=y, z=0.13, col='wood', ry=rz)
        m.cbox(0.05, 0.008, 0.032, x=x + math.sin(rz) * 0.22, y=y + 0.009, z=0.13 + 0.22, col='cream', ry=rz)
    m.cbox(0.075, 0.03, 0.018, x=0.0, y=0.078, z=0.2, col='wood_dark')


def heater(m, k, y, col):
    """Tarcza herbowa (prosta gora, ostry spod) w plaszczyznie XZ, srodek w poczatku ukladu, grubosc wzdluz Y."""
    m.cbox(0.115 * k, 0.012, 0.075 * k, y=y, z=0.03 * k, col=col)
    m.cbox(0.081 * k, 0.012, 0.081 * k, y=y, z=-0.008 * k, col=col, ry=math.pi / 4)


def ppl_shield(m):
    """Lico tarczy rycerza: biale (gra barwi je kolorem gracza), lico na -Y, poczatek w srodku tarczy."""
    heater(m, 1.0, -0.004, 'white')


def ppl_shield_rim(m):
    """Okucie tarczy (bez koloru gracza): ciemne obrzeze za licem i zloty guz, jak ppl_shield."""
    heater(m, 1.14, 0.006, 'metal_dark')
    m.sphere(0.02, 6, 4, y=-0.012, z=0.012, col='gold', sy=0.6)


def ppl_cat_arm(m):
    """Ramie katapulty: poczatek w osi obrotu (os wzdluz Y), ramie wzdluz +Z, na koncu kosz otwarty ku +X
    (przy napietym ramieniu, lezacym w lewo, kosz patrzy w gore)."""
    m.block(0.04, 0.045, 0.43, x=0.0, z=-0.03, col='wood_light', bevel=0.006)
    m.cyl(0.032, 0.07, 8, y=0.035, col='wood_dark', rx=R)
    m.cyl(0.03, 0.05, 10, x=0.018, z=0.375, col='plank_dark', r_top=0.052, top=False, ry=R)
    m.cyl(0.044, 0.004, 10, x=0.045, z=0.375, col='wood_dark', ry=R, bottom=False)
    for zz in (0.12, 0.26):
        m.cbox(0.046, 0.05, 0.012, z=zz, col='metal_dark')


def ppl_cat_stone(m):
    """Pocisk katapulty: okragly glaz (srodek w poczatku ukladu)."""
    m.ico(0.045, col='stone', sub=1, sx=1.0, sy=0.9, sz=0.85)
    m.ico(0.02, x=0.025, y=-0.02, z=0.02, col='stone_light', sub=0)


def ppl_cat_wheel(m):
    """Kolo zapadkowe katapulty: os wzdluz Y w poczatku ukladu, uchwyty z przodu (na -Y)."""
    m.cyl(0.075, 0.016, 10, y=0.008, col='wood', rx=R)
    m.cyl(0.05, 0.022, 10, y=0.011, col='wood_dark', rx=R)
    for k in range(4):
        a = k * R + 0.4
        m.beam((math.cos(a) * 0.07, -0.01, math.sin(a) * 0.07), (math.cos(a) * 0.085, -0.045, math.sin(a) * 0.085), 0.014, 'wood_dark')
    m.cyl(0.018, 0.03, 6, y=0.0, col='metal_dark', rx=R)


# Osiol skladany z czesci (jak donkey w art/scripts/units.py): tulow z jukami, leb na szyi, noga, ogon.
# Poczatki ukladow w stawach: szyja (0, -0.12, 0.21), biodra/barki nog (+-0.035, +-0.085, 0.14), nasada ogona (0, 0.135, 0.22).

def ppl_donkey_body(m):
    """Tulow osla z jukami (przod na -Y, poczatek na ziemi pod srodkiem)."""
    m.block(0.115, 0.27, 0.105, z=0.125, col='donkey', bevel=0.025)
    m.block(0.1, 0.1, 0.02, y=-0.01, z=0.225, col='wood_dark', bevel=0.006)
    for sx in (-1, 1):
        m.block(0.035, 0.09, 0.07, x=sx * 0.07, y=-0.01, z=0.15, col='wood', bevel=0.008)
    m.cbox(0.12, 0.016, 0.012, y=-0.01, z=0.247, col='wheat')


def ppl_donkey_head(m):
    """Szyja i leb osla z dlugimi uszami (poczatek w nasadzie szyi, pysk na -Y)."""
    m.beam((0, 0.0, 0.0), (0, -0.06, 0.09), 0.055, 'donkey')
    m.block(0.06, 0.12, 0.058, y=-0.1, z=0.075, col='donkey', bevel=0.012, rx=0.45)
    m.block(0.052, 0.04, 0.046, y=-0.15, z=0.045, col='donkey_dark', bevel=0.01, rx=0.45)
    for sx in (-1, 1):
        m.box(0.014, 0.01, 0.08, x=sx * 0.018, y=-0.06, z=0.11, col='donkey_dark', rx=0.35, ry=sx * 0.35)
    m.cbox(0.064, 0.006, 0.006, y=-0.09, z=0.105, col='black')


def ppl_donkey_leg(m):
    """Noga osla (poczatek w stawie biodra, kopyto na ziemi w z = -0.14)."""
    m.block(0.03, 0.034, 0.12, z=-0.12, col='donkey', bevel=0.008)
    m.block(0.034, 0.038, 0.022, z=-0.14, col='donkey_dark', bevel=0.004)


def ppl_donkey_tail(m):
    """Ogon osla z ciemnym chwostem (poczatek w nasadzie)."""
    m.beam((0, 0, 0), (0, 0.04, -0.08), 0.014, 'donkey')
    m.sphere(0.018, 5, 3, y=0.045, z=-0.095, col='donkey_dark', sz=1.6)


def ppl_boat(m):
    """Lodka przewoznika: poczatek na linii wody w srodku, dziob na -Y; dno widoczne w srodku (pokrywa kadluba
    nizej burt), lawki, dulki po bokach."""
    hull = m.cyl(0.05, 0.05, 10, z=-0.035, col='wood_dark', r_top=0.078, paint=lambda k, j: 'wood')
    rim = m.cyl(0.08, 0.022, 10, z=0.015, col='wood', r_top=0.084, top=False, bottom=False)
    for ob in (hull, rim):
        ob.data.transform(Matrix.Diagonal((1.0, 2.7, 1.0, 1.0)))
    m.cbox(0.15, 0.04, 0.012, z=0.024, col='wood_light')
    m.cbox(0.12, 0.03, 0.012, y=0.13, z=0.02, col='wood_light')
    for sx in (-1, 1):
        m.cbox(0.012, 0.012, 0.025, x=sx * 0.084, y=0.0, z=0.045, col='metal_dark')


def ppl_oar(m):
    """Wioslo: poczatek w dulce, rekojesc do srodka lodzi (-X), pioro na zewnatrz (+X)."""
    m.beam((-0.07, 0, 0), (0.2, 0, 0), 0.011, 'wood_light')
    m.cbox(0.07, 0.006, 0.026, x=0.21, col='wood')


BUILDERS = {
    'ppl_plank': ppl_plank, 'ppl_dig_shovel': ppl_dig_shovel, 'ppl_heap': ppl_heap, 'ppl_stakes': ppl_stakes, 'ppl_shield': ppl_shield,
    'ppl_shield_rim': ppl_shield_rim, 'ppl_cat_arm': ppl_cat_arm, 'ppl_cat_stone': ppl_cat_stone,
    'ppl_cat_wheel': ppl_cat_wheel, 'ppl_donkey_body': ppl_donkey_body,
    'ppl_donkey_head': ppl_donkey_head, 'ppl_donkey_leg': ppl_donkey_leg, 'ppl_donkey_tail': ppl_donkey_tail,
    'ppl_boat': ppl_boat, 'ppl_oar': ppl_oar,
}

if __name__ == '__main__':
    build(BUILDERS, icons=False, smooth=60.0)
