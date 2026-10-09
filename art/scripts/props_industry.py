"""
Rekwizyty scen pracy gornictwa, hutnictwa, kuzni, mennicy, stoczni i smolarni (prefiks ind_).
Modele w jednostkach budynku (kolo wyciagu, wozek, urobek, kupka, kowadlo, beczka, forma, pien mincerza, zar)
gra rysuje w ukladzie modelu budynku; kleszcze maja poczatek w barku i dlon w z = HAND, jak narzedzia postaci
(art/scripts/units.py); tygiel ma jednostki postaci, pret i stempel - jednostki swiata. Modele biale (ind_box,
ind_load, ind_pile, ind_coin, ind_embers, ind_blank, ind_crucible) barwi gra kolorem instancji: urobek wg kopalni,
zar i zelazo wg temperatury.
Uruchomienie: blender --background --python art/scripts/props_industry.py [-- nazwa ...]
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from lib import build  # noqa: E402

R = math.pi / 2
HAND = -0.15
ARM_X = 0.078


def ind_sheave(m):
    """Kolo linowe wyciagu (jednostki budynku): obrecz z 12 odcinkow, 6 szprych, piasta; os kola wzdluz Y."""
    r, n = 0.075, 12
    for k in range(n):
        a0, a1 = 2 * math.pi * k / n, 2 * math.pi * (k + 1) / n
        p0 = (r * math.cos(a0), 0.0, r * math.sin(a0))
        p1 = (r * math.cos(a1), 0.0, r * math.sin(a1))
        m.beam(p0, p1, 0.016, 'metal_dark')
    for k in range(3):
        a = math.pi * k / 3 + 0.3
        m.beam((-r * math.cos(a), 0.0, -r * math.sin(a)), (r * math.cos(a), 0.0, r * math.sin(a)), 0.011, 'metal')
    m.cyl(0.017, 0.03, 8, y=0.015, col='wood_dark', rx=R)


def ind_cart(m):
    """Podwozie wozka kopalnianego (jednostki budynku): rama na czterech kolach, dlugosc wzdluz X."""
    for sy in (-1, 1):
        m.cbox(0.1, 0.012, 0.012, y=sy * 0.02, z=0.03, col='wood_dark')
        for sx in (-1, 1):
            m.cyl(0.016, 0.008, 8, x=sx * 0.034, y=sy * 0.026 + 0.004, z=0.016, col='metal_dark', rx=R)
    for sx in (-1, 1):
        m.cbox(0.01, 0.06, 0.01, x=sx * 0.034, z=0.016, col='metal_dark')


def ind_tub(m):
    """Skrzynia wozka (jednostki budynku): otwarta, scianki rozchylone, okute, z uchwytami z tylu (+X);
    poczatek na dnie w srodku."""
    w, d, h, t, flare = 0.1, 0.056, 0.045, 0.006, 0.22
    m.cbox(w, d, t, z=t / 2, col='wood')
    for sy in (-1, 1):
        m.cbox(w + 0.01, t, h, y=sy * (d / 2 + math.sin(flare) * h / 2), z=h / 2, col='wood', rx=sy * flare)
    for sx in (-1, 1):
        m.cbox(t, d + 0.014, h, x=sx * (w / 2 + math.sin(flare) * h / 2), z=h / 2, col='wood', ry=-sx * flare)
    for zz in (0.012, h - 0.006):
        for sy in (-1, 1):
            m.cbox(w + 0.016, 0.004, 0.006, y=sy * (d / 2 + math.sin(flare) * zz + 0.004), z=zz, col='metal_dark', rx=sy * flare)
    # Uchwyty z tylu (+X), za ktore pcha gornik.
    for sy in (-1, 1):
        m.beam((0.05, sy * 0.022, 0.036), (0.078, sy * 0.022, 0.048), 0.008, 'wood_dark')


def ind_load(m):
    """Kopka urobku w wozku albo na lopacie (biala - kolor nadaje gra): grudy na kupce, poczatek u podstawy."""
    m.ico(0.042, z=0.0, col='white', sub=1, sx=1.2, sy=0.72, sz=0.55)
    for (x, y, z, r) in ((-0.03, 0.012, 0.012, 0.016), (0.026, -0.01, 0.014, 0.017), (0.0, 0.006, 0.022, 0.015), (0.04, 0.014, 0.004, 0.012)):
        m.ico(r, x=x, y=y, z=z, col='white', sub=0)


def ind_pile(m):
    """Kupka urobku przed kopalnia (jednostki budynku, biala - kolor wg kopalni nadaje gra): kopiec z grudami."""
    m.ico(0.068, col='white', sub=1, sx=1.15, sz=0.58)
    m.ico(0.04, x=0.012, y=-0.075, col='white', sub=1, sz=0.6)
    m.ico(0.034, x=-0.02, y=0.072, col='white', sub=1, sz=0.6)
    for (x, y, z, r) in ((0.06, -0.035, 0.008, 0.016), (-0.07, 0.02, 0.006, 0.014), (0.052, 0.05, 0.006, 0.013),
                         (-0.03, -0.05, 0.02, 0.014), (0.02, 0.02, 0.034, 0.016)):
        m.ico(r, x=x, y=y, z=z, col='white', sub=0)


def ind_anvil(m):
    """Kowadlo na pniu (jednostki budynku): rog ku -Y, lico na wysokosci 0.123, poczatek na ziemi pod pniem."""
    m.cyl(0.04, 0.06, 8, col='log')
    m.cyl(0.037, 0.003, 8, z=0.06, col='wood_light')
    m.box(0.036, 0.05, 0.035, z=0.06, col='metal_dark')
    m.cbox(0.05, 0.12, 0.028, y=0.01, z=0.109, col='metal_dark')
    m.cone(0.021, 0.045, 5, y=-0.05, z=0.109, col='metal_dark', rx=R)
    m.cbox(0.03, 0.018, 0.012, y=0.06, z=0.094, col='metal_dark')


def ind_barrel(m):
    """Beczka z woda do hartowania (jednostki budynku): lustro wody na wysokosci 0.088, poczatek na ziemi."""
    h, r = 0.09, 0.042
    m.cyl(r, h, 8, col='wood', bands=[h * 0.16, h * 0.26, h * 0.7, h * 0.8], bottom=False, top=False,
          paint=lambda k, j: 'metal_dark' if j in (1, 3) else None)
    m.cyl(r * 0.88, 0.004, 8, z=h - 0.006, col='water')
    m.cyl(r, 0.006, 8, z=h - 0.006, col='wood_dark', r_top=r * 1.02)


def ind_mold(m):
    """Kamienna forma na wlewek (jednostki budynku): rowek 0.085 x 0.03, dno rowka na wysokosci 0.026."""
    m.block(0.12, 0.07, 0.03, col='stone_dark', bevel=0.004, open_sides=('-z',))
    m.cbox(0.088, 0.032, 0.006, z=0.029, col='coal')


def ind_stump(m):
    """Pien mincerza (jednostki budynku): kowadelko na srodku (lico 0.118), miska z krazkami zlota ku -X."""
    top = 0.1
    m.cyl(0.056, top, 10, col='log', bottom=False)
    m.cyl(0.052, 0.004, 10, z=top, col='wood_light')
    m.box(0.026, 0.026, 0.018, x=0.004, y=0.006, z=top, col='metal_dark')
    m.cyl(0.02, 0.012, 8, x=-0.034, y=0.008, z=top, col='wood_dark')
    m.cyl(0.016, 0.004, 8, x=-0.034, y=0.008, z=top + 0.01, col='gold')


def ind_box(m):
    """Szescian o boku 1 ze srodkiem w poczatku ukladu (deski lodzi, sztaba, struga metalu - skala i kolor z gry)."""
    m.cbox(1.0, 1.0, 1.0, col='white', jitter=0.0)


def ind_coin(m):
    """Krazek (moneta, lustro roztopionego metalu): promien 0.5, grubosc 0.2, srodek w poczatku ukladu."""
    m.cyl(0.5, 0.2, 10, z=-0.1, col='white', jitter=0.0)


def ind_embers(m):
    """Zar w palenisku (jednostki budynku): grudy wegla na 0.12 x 0.09 - kolor (zar pulsuje) nadaje gra."""
    pts = ((-0.04, -0.025, 0.012), (0.0, -0.03, 0.011), (0.04, -0.022, 0.012), (-0.035, 0.012, 0.013), (0.005, 0.005, 0.016),
           (0.042, 0.016, 0.012), (-0.015, 0.032, 0.01), (0.025, 0.034, 0.011), (-0.05, 0.035, 0.009))
    for i, (x, y, r) in enumerate(pts):
        m.ico(r, x=x, y=y, z=r * 0.5, col='white', sub=0, sz=0.8)


def ind_crucible(m):
    """Tygiel z gliny (jednostki postaci, bialy - gra barwi go wg zaru), poczatek w srodku wysokosci, os pionowa."""
    prof = [(0.02, -0.03), (0.025, -0.02), (0.029, 0.022), (0.032, 0.03), (0.026, 0.03), (0.024, 0.024)]
    m.lathe(prof, 8, col='white', paint=lambda i: 'coal' if i >= 4 else None)


def ind_ctongs(m):
    """Kleszcze do tygla trzymane oburacz (prawa reka i lewa w x = -2 * ARM_X): ramiona zbiegaja sie przed postacia,
    szczeki obejmuja tygiel z bokow (tygiel w skali 1.6 rysuje gra w x = -ARM_X, z = HAND - 0.245)."""
    cx, zc, r = -ARM_X, HAND - 0.245, 0.056
    for s in (-1, 1):
        hx = 0.0 if s > 0 else -2 * ARM_X
        m.beam((hx, 0.0, HAND + 0.02), (cx + s * 0.012, 0.0, HAND - 0.16), 0.012, 'metal_dark')
        m.beam((cx + s * 0.012, 0.0, HAND - 0.16), (cx + s * r, 0.0, zc + 0.03), 0.01, 'metal_dark')
        m.beam((cx + s * r, 0.0, zc + 0.03), (cx + s * r, 0.0, zc - 0.02), 0.01, 'metal_dark')


def ind_tongs(m):
    """Kleszcze kowalskie w lewej rece: z dloni wzdluz reki, szczeki na koncu (z = HAND - 0.15)."""
    for s in (-1, 1):
        m.beam((s * 0.006, 0.0, HAND + 0.02), (s * 0.004, -0.012, HAND - 0.13), 0.008, 'metal_dark')
        m.beam((s * 0.004, -0.012, HAND - 0.13), (s * 0.002, -0.016, HAND - 0.155), 0.007, 'metal_dark')
    m.cbox(0.02, 0.012, 0.01, y=-0.004, z=HAND - 0.06, col='metal')


def ind_blank(m):
    """Rozgrzany pret (bialy - kolor zaru nadaje gra) w jednostkach swiata: lezy wzdluz -Y od poczatku (koniec w kleszczach)."""
    m.cbox(0.012, 0.03, 0.007, y=-0.015, z=0.0, col='white')
    m.cbox(0.014, 0.05, 0.006, y=-0.055, z=0.0, col='white')
    m.cbox(0.01, 0.012, 0.005, y=-0.086, z=0.0, col='white')


def ind_punch(m):
    """Stempel mincerza (jednostki swiata): krotki precik z glowka, poczatek na dole (na monecie)."""
    m.cyl(0.006, 0.04, 6, col='metal')
    m.cyl(0.009, 0.012, 6, z=0.04, col='metal_dark')


BUILDERS = {
    'ind_sheave': ind_sheave, 'ind_cart': ind_cart, 'ind_tub': ind_tub, 'ind_load': ind_load, 'ind_pile': ind_pile, 'ind_anvil': ind_anvil, 'ind_barrel': ind_barrel, 'ind_mold': ind_mold,
    'ind_stump': ind_stump, 'ind_box': ind_box,
    'ind_coin': ind_coin, 'ind_embers': ind_embers, 'ind_crucible': ind_crucible, 'ind_ctongs': ind_ctongs,
    'ind_tongs': ind_tongs, 'ind_blank': ind_blank, 'ind_punch': ind_punch,
}

if __name__ == '__main__':
    build(BUILDERS, icons=False)
