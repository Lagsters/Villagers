"""
Rekwizyty scen rzemieslnikow przy budynkach (zywnosc i zwierzeta): mlynarz, piekarz, rzeznik, hodowca swin,
studniarz, piwowar, hodowca oslow. Prefiks crf_.
Jednostki: wiekszosc modeli w jednostkach swiata (1 = szerokosc pola, postac ~0.37 wysokosci), rysowana w skali 1;
crf_winch i crf_sails w jednostkach modelu budynku (rysowane w ukladzie budynku ze skala budynku).
Modele z bialymi czesciami barwi gra (kolor instancji): worek (zboze, maka), bochenek (ciasto, chleb),
zar i jezyk ognia (piec, palenisko), lustro plynu, sznur, nogi zwierzat.
Uruchomienie: blender --background --python art/scripts/props_crafts.py [-- nazwa ...]
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from lib import build  # noqa: E402

R = math.pi / 2
TWINE = '#8c7a5a'


def crf_sack(m):
    """Pelny worek stojacy (biale plotno - kolor nadaje gra), zwiazany pod szyjka; podstawa na z = 0."""
    prof = [(0.036, 0.0), (0.048, 0.012), (0.052, 0.045), (0.049, 0.085), (0.034, 0.112), (0.013, 0.124),
            (0.015, 0.132), (0.023, 0.142)]
    m.lathe(prof, 7, col='white')
    m.cyl(0.016, 0.01, 7, z=0.117, col=TWINE)


def crf_loaf(m):
    """Bochenek z nacieciami (bialy - ciasto albo upieczony chleb wg koloru); podstawa na z = 0."""
    m.sphere(0.03, 8, 5, z=0.017, sx=1.35, sy=0.85, sz=0.62, col='white')
    for k in range(3):
        m.cbox(0.006, 0.032, 0.004, x=-0.02 + 0.02 * k, z=0.034, rz=0.5, col='#c9b9a2', jitter=0.0)


def crf_peel(m):
    """Lopata piekarska: poczatek w tylnym uchwycie, trzonek i plaski pior do przodu (-Y)."""
    m.beam((0, 0.02, 0), (0, -0.25, 0), 0.011, 'wood_light')
    m.block(0.075, 0.07, 0.006, y=-0.282, z=-0.003, col='wood_light', bevel=0.002)
    m.cyl(0.0375, 0.006, 10, y=-0.317, z=-0.003, col='wood_light')


def crf_glow(m):
    """Zar w otworze: plaski luk szerokosci 1 i wysokosci 1.1 (podstawa na z = 0), bialy - kolor nadaje gra."""
    m.cbox(1.0, 0.1, 0.6, z=0.3, col='white', jitter=0.0)
    m.cyl(0.5, 0.1, 12, y=0.05, z=0.6, rx=R, col='white', jitter=0.0)


def crf_flame(m):
    """Jezyk ognia (kropla z ostrym czubkiem): szerokosc 1, wysokosc 1.75, podstawa na z = 0; bialy - kolor nadaje gra."""
    m.sphere(0.5, 8, 4, z=0.5, col='white')
    m.cone(0.47, 1.2, 8, z=0.55, col='white', bottom=False)


def crf_pig(m):
    """Tulow swini bez nog i glowy (nogi crf_leg w stawach (+-0.024, +-0.045, 0.05), glowa crf_pig_head w stawie
    szyi (0, -0.055, 0.085)); przod na -Y, brzuch na z ~ 0.04; ogonek zakrecony."""
    m.sphere(0.045, 8, 5, z=0.075, sx=1.0, sy=1.6, sz=0.85, col='pig')
    m.beam((0, 0.068, 0.09), (0, 0.084, 0.105), 0.008, '#e99a9a')
    m.beam((0, 0.084, 0.105), (0.006, 0.09, 0.094), 0.007, '#e99a9a')


def crf_pig_head(m):
    """Glowa swini z poczatkiem w stawie szyi (gra ja pochyla - rycie, jedzenie, wachanie): ryj, oczy, uszy."""
    m.sphere(0.033, 7, 4, y=-0.02, z=-0.001, sy=1.05, col='pig')
    m.cyl(0.016, 0.022, 7, y=-0.045, z=-0.007, rx=R, col='#e48888')
    for s in (-1, 1):
        m.cbox(0.02, 0.006, 0.024, x=s * 0.019, y=-0.023, z=0.03, rx=0.7, ry=-s * 0.35, col='#e99a9a')
        m.cbox(0.006, 0.006, 0.007, x=s * 0.015, y=-0.049, z=0.011, col='black', jitter=0.0)


def crf_leg(m):
    """Noga zwierzecia (osiol, swinia): poczatek w stawie, kopyto w z = -0.095; biala - kolor nadaje gra."""
    m.cyl(0.013, 0.083, 6, z=-0.083, r_top=0.02, col='white', bottom=False, top=False)
    m.cyl(0.0145, 0.014, 6, z=-0.095, col='#4c4c4c', jitter=0.0)


def crf_donkey(m):
    """Osiol bez nog i glowy (glowa crf_donkey_head w stawie szyi (0, -0.08, 0.15), nogi crf_leg
    w (+-0.03, +-0.065, 0.1)): jasny brzuch, ciemna prega na grzbiecie, ogon z kitka."""
    m.sphere(0.054, 8, 5, z=0.135, sx=1.0, sy=1.8, sz=0.82, col='donkey',
             paint=lambda c: 'cream' if c.z < -0.028 else ('donkey_dark' if c.z > 0.038 else None))
    m.beam((0, 0.088, 0.158), (0, 0.112, 0.094), 0.011, 'donkey_dark')
    m.sphere(0.013, 4, 2, y=0.114, z=0.084, sz=1.7, col='donkey_dark')


def crf_donkey_head(m):
    """Szyja i glowa osla (poczatek w stawie szyi): dlugie uszy, jasny pysk, czerwony kantar."""
    m.cyl(0.032, 0.075, 7, r_top=0.024, rx=0.7, col='donkey', bottom=False)
    m.cbox(0.009, 0.05, 0.018, y=-0.022, z=0.05, rx=0.7, col='donkey_dark')
    m.sphere(0.026, 7, 4, y=-0.078, z=0.072, sx=0.95, sy=1.85, sz=1.0, rx=0.45, col='donkey')
    m.sphere(0.018, 6, 3, y=-0.112, z=0.054, col='cream')
    for s in (-1, 1):
        m.cbox(0.011, 0.007, 0.056, x=s * 0.014, y=-0.05, z=0.118, rx=-0.35, ry=s * 0.3, col='donkey')
        m.cbox(0.006, 0.006, 0.006, x=s * 0.02, y=-0.083, z=0.086, col='black', jitter=0.0)
    m.cbox(0.044, 0.012, 0.009, y=-0.1, z=0.062, rx=0.45, col='red')
    m.cbox(0.045, 0.008, 0.032, y=-0.064, z=0.076, rx=0.45, col='red')


def crf_carcass(m):
    """Tusza wieprzowa lezaca wzdluz -Y od tylu (poczatek w tylnym koncu - skracanie w osi Y), z przodu przekroj."""
    m.cyl(0.033, 0.11, 8, z=0.031, rx=R, col='pig')
    m.cyl(0.027, 0.004, 8, y=-0.11, z=0.031, rx=R, col='meat')
    m.sphere(0.033, 8, 4, z=0.031, sy=0.8, col='pig')
    for s in (-1, 1):
        m.beam((s * 0.014, 0.012, 0.04), (s * 0.018, 0.05, 0.062), 0.014, 'pig')
        m.cbox(0.014, 0.012, 0.012, x=s * 0.018, y=0.052, z=0.064, col='#6a5a50')


def crf_tray(m):
    """Deska rzeznicza z rantem i uchwytami; podstawa na z = 0."""
    m.cbox(0.13, 0.085, 0.008, z=0.004, col='wood_light')
    for s in (-1, 1):
        m.cbox(0.13, 0.008, 0.012, y=s * 0.0385, z=0.012, col='wood')
        m.cbox(0.008, 0.07, 0.012, x=s * 0.061, z=0.012, col='wood')
        m.cbox(0.02, 0.03, 0.008, x=s * 0.074, z=0.012, col='wood')


def basket(m, loaves):
    """Wiklinowy kosz z palakiem (do noszenia chleba), pusty albo z bochenkami; podstawa na z = 0."""
    floor = 0.036 if loaves else 0.012
    m.lathe([(0.04, 0.0), (0.045, 0.015), (0.047, 0.03), (0.05, 0.045), (0.044, 0.045), (0.042, floor), (0.002, floor)], 8,
            col='wood_light', paint=lambda i: {1: 'wood', 4: 'wood_dark', 5: 'wood_dark', 6: 'wood_dark'}.get(i))
    if loaves:
        for (x, y, z) in ((-0.02, -0.01, 0.048), (0.021, 0.006, 0.048), (0.0, 0.016, 0.058)):
            m.sphere(0.024, 6, 4, x=x, y=y, z=z, sx=1.35, sy=0.85, sz=0.62, col='bread')
    pts = [(-0.048, 0, 0.044), (-0.03, 0, 0.088), (0.03, 0, 0.088), (0.048, 0, 0.044)]
    for a, b in zip(pts, pts[1:]):
        m.beam(a, b, 0.008, 'wood')


def crf_basket(m):
    basket(m, True)


def crf_basket_empty(m):
    basket(m, False)


def pail(m, content=None):
    """Drewniane wiadro z okuciami i kablakiem; poczatek w gornym punkcie kablaka (uchwyt)."""
    m.cyl(0.029, 0.05, 8, z=-0.068, r_top=0.034, col='wood', bands=[0.009, 0.016, 0.036, 0.043],
          paint=lambda k, j: 'metal_dark' if j in (1, 3) else None, top=False)
    if content == 'water':
        m.cyl(0.032, 0.003, 8, z=-0.03, col='water')
    elif content == 'feed':
        m.cyl(0.032, 0.003, 8, z=-0.027, col='wheat')
        m.sphere(0.022, 6, 3, z=-0.025, sz=0.45, col='wheat')
    else:
        m.cyl(0.031, 0.003, 8, z=-0.04, col='wood_dark')
    pts = [(-0.034, 0, -0.02), (-0.012, 0, 0.0), (0.012, 0, 0.0), (0.034, 0, -0.02)]
    for a, b in zip(pts, pts[1:]):
        m.beam(a, b, 0.005, 'metal_dark')


def crf_pail(m):
    pail(m)


def crf_pail_water(m):
    pail(m, 'water')


def crf_pail_feed(m):
    pail(m, 'feed')


def crf_paddle(m):
    """Wioslo piwowarskie: poczatek w gornym koncu, trzonek w dol (-Z), pior na koncu."""
    m.beam((0, 0, 0.01), (0, 0, -0.26), 0.01, 'wood_light')
    m.cbox(0.036, 0.008, 0.08, z=-0.29, col='wood_light')
    m.cbox(0.026, 0.012, 0.012, z=0.008, col='wood')


def crf_winch(m):
    """Kolowrot studni (jednostki modelu studni): walek wzdluz X z nawinietym sznurem, os w poczatku ukladu,
    korba na lewym koncu (ramie w gore, raczka na zewnatrz)."""
    m.cyl(0.02, 0.26, 8, x=-0.13, ry=R, col='wood')
    m.cyl(0.024, 0.07, 8, x=-0.095, ry=R, col='cream')
    m.cyl(0.007, 0.05, 5, x=-0.17, ry=R, col='metal_dark')
    m.cyl(0.007, 0.03, 5, x=0.12, ry=R, col='metal_dark')
    m.beam((-0.16, 0, 0), (-0.16, 0, 0.042), 0.01, 'metal_dark')
    m.beam((-0.16, 0, 0.042), (-0.205, 0, 0.042), 0.012, 'wood_dark')


def crf_sails(m):
    """Skrzydla wiatraka (jednostki modelu mlyna): cztery ramiona z piasty w poczatku ukladu, w plaszczyznie XZ
    (os obrotu wzdluz Y), przy kazdym plotno z trzema poprzeczkami z jednej strony ramienia."""
    m.cyl(0.032, 0.05, 8, y=0.03, rx=R, col='wood_dark')
    for k in range(4):
        a = k * R + 0.35
        sa, ca = math.sin(a), math.cos(a)
        px, pz = ca, -sa
        m.beam((0, -0.012, 0), (0.45 * sa, -0.012, 0.45 * ca), 0.022, 'wood_dark')
        m.cbox(0.105, 0.005, 0.32, x=0.27 * sa + 0.064 * px, y=-0.004, z=0.27 * ca + 0.064 * pz, ry=a, col='cream')
        for j in range(3):
            f = 0.15 + j * 0.115
            m.cbox(0.118, 0.008, 0.01, x=f * sa + 0.06 * px, y=-0.01, z=f * ca + 0.06 * pz, ry=a, col='wood')


def crf_rope(m):
    """Sznur (pret 1 x 1 x 1 od z = 0 do 1) - gra skaluje go miedzy dwoma punktami."""
    m.box(1.0, 1.0, 1.0, col='white', jitter=0.0)


def crf_disc(m):
    """Lustro plynu (walec o srednicy 1 i wysokosci 1, podstawa na z = 0) - woda w beczce przy studni."""
    m.cyl(0.5, 1.0, 12, col='white', jitter=0.0)


BUILDERS = {
    'crf_sack': crf_sack, 'crf_loaf': crf_loaf, 'crf_peel': crf_peel, 'crf_glow': crf_glow, 'crf_pig': crf_pig, 'crf_pig_head': crf_pig_head,
    'crf_leg': crf_leg, 'crf_donkey': crf_donkey, 'crf_donkey_head': crf_donkey_head, 'crf_carcass': crf_carcass,
    'crf_tray': crf_tray, 'crf_basket': crf_basket, 'crf_pail': crf_pail, 'crf_pail_water': crf_pail_water,
    'crf_pail_feed': crf_pail_feed, 'crf_paddle': crf_paddle, 'crf_winch': crf_winch, 'crf_rope': crf_rope,
    'crf_disc': crf_disc, 'crf_sails': crf_sails, 'crf_flame': crf_flame,
    'crf_basket_empty': crf_basket_empty,
}

if __name__ == '__main__':
    build(BUILDERS, icons=False, smooth=60.0)
