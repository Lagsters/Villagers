"""
Jednostki: osadnik skladany z czesci animowanych w kodzie gry (bez szkieletu), rycerz, osiol.
Noga, reka i narzedzie maja poczatek ukladu w stawie (biodro/bark), zeby obracac je wokol osi X.
Tunika (tulow i rekawy) jest biala - kolor gracza naklada gra; skora i pasek maja wzor PLAIN (bez koloru gracza).
Bryly okragle i cieniowane gladko (SMOOTH); oczy, brwi, usta i rumience rysuje shader gry (wzor FACE na glowie).
Zawody rozpoznaje sie po nakryciu glowy (hat_*, czesc z brodami) i narzedziu w prawej rece (tool_*).
Przod postaci: -Y. Budzet: tulow+glowa+2 nogi+2 rece+czapka+narzedzie <= 400 trojkatow.
Uruchomienie: blender --background --python art/scripts/units.py [-- nazwa ...]
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from mathutils import Matrix  # noqa: E402
from lib import PALETTE, build  # noqa: E402

PALETTE.update({
    'linen': '#e9dfc8', 'hat_brown': '#7a5634', 'hat_green': '#4f7a3a', 'hat_red': '#a8402f', 'hat_yellow': '#d9b43a',
    'hat_blue': '#3f5f8f', 'hat_purple': '#6c4a8a', 'feather': '#e8e2d0', 'beard': '#a44a26', 'beard_grey': '#b8b2a8',
    'hair': '#b0502a', 'eye': '#1c1c1c', 'mask': '#9aa0a6', 'nose': '#eaa47e',
    'hair_brown': '#6e4326', 'hat_cyan': '#62b4cc', 'hat_pink': '#e3b9c4', 'hat_black': '#38383c', 'cap_red': '#c0392b',
    'mask_white': '#ecebe6', 'wellies': '#3c3530',
})

# Prog gladkiego cieniowania postaci: osmiosciany (dlonie, buty, nos) i walce 6-8 segmentow wychodza okragle,
# podstawy walcow (90 stopni) zostaja ostre.
SMOOTH = 75.0

R = math.pi / 2
HAND = -0.15  # dlon wzgledem barku
# Duze glowy (jak na portretach zawodow): glowa i wszystko, co na niej, powiekszone wzgledem szyi.
HEAD_K = 1.35
NECK = (0.0, 0.0, 0.315)


def big(f):
    """Buduje czesci funkcja f i skaluje je wzgledem szyi (glowa, czapki, helm)."""
    def g(m):
        n = len(m.parts)
        r = f(m)
        mat = Matrix.Translation(NECK) @ Matrix.Scale(HEAD_K, 4) @ Matrix.Translation(tuple(-c for c in NECK))
        for ob in m.parts[n:]:
            ob.data.transform(mat)
        return r
    g.__name__ = f.__name__
    return g


# ---------------------------------------------------------------- cialo

# Profil tuniki (promien, wysokosc): dol, pasek, piers, szerokie barki (rece w nich schowane), szyja pod glowa.
TUNIC = ((0.078, 0.125), (0.066, 0.158), (0.066, 0.18), (0.074, 0.245), (0.072, 0.295), (0.032, 0.322))
# Barki: odsuniecie reki od osi postaci (jak ARM_X w client/render/entities.ts) - reka w polowie w tunice.
ARM_X = 0.078


def serf_torso(m, col='cloth'):
    """Tunika z paskiem (bryla obrotowa), od szyi domknieta - bez prześwitu pod glowa."""
    m.lathe(TUNIC, 7, col=col, paint=lambda i: 'wood_dark' if i == 1 else None, plain=lambda i: i == 1)


def serf_head(m):
    """Okragla glowa z twarza (wzor FACE: oczy, brwi, usta, podbrodek), nos w kolorze skory, tyl glowy we wlosach."""
    m.sphere(0.057, 7, 5, z=0.372, col='skin', sz=0.95, face=True,
             paint=lambda c: 'hair_brown' if c.y > 0.012 and c.z > -0.02 else None)
    m.sphere(0.014, 4, 2, y=-0.05, z=0.362, col='skin', sy=0.85)


def serf_leg(m):
    # Poczatek w biodrze: noga w spodniach i kalosz - obly, wydluzony do przodu, z plaska podeszwa.
    m.sphere(0.024, 5, 3, z=-0.065, col='trousers', sz=2.7)
    m.sphere(0.03, 7, 4, y=-0.012, z=-0.142, col='wellies', sy=1.45, sz=1.7, half='flat')


def serf_arm(m, sleeve='cloth'):
    # Poczatek w barku (gora reki schowana w barku tuniki): rekaw tuniki (kolor gracza), nizej naga reka
    # zakonczona dlonia (dlon w z = HAND).
    m.sphere(0.02, 6, 4, z=-0.085, col='skin', sz=3.25, paint=lambda c: sleeve if c.z > 0 else None, plain=lambda c: c.z <= 0)


def mustache(m, col='beard'):
    """Gesty was pod nosem."""
    m.sphere(0.03, 4, 2, y=-0.052, z=0.349, col=col, sx=1.6, sy=0.55, sz=0.42)


def beard(m, col='beard', k=1.0):
    """Zaokraglona broda z wasami pod nosem."""
    m.sphere(0.04 * k, 4, 3, y=-0.04, z=0.327, col=col, sx=0.95, sy=0.55, sz=0.62 * k, rx=0.25)


# ---------------------------------------------------------------- nakrycia glowy (uklad jak glowa)

def hair_dome(m, col):
    """Czupryna: czasza wlosow na czubku i z tylu glowy az do karku; bez dolnej przedniej czesci (twarz odkryta)."""
    m.sphere(0.061, 8, 4, y=0.008, z=0.383, col=col, sz=0.85, keep=lambda c: c.z > 0 or c.y > 0)


def hat_hair(m):
    """Tragarz, narzedziowiec: brazowe wlosy, bez nakrycia."""
    hair_dome(m, 'hair_brown')


def hat_redhair(m):
    """Rolnik, swiniarz: rude wlosy i gesty was."""
    hair_dome(m, 'hair')
    mustache(m)


def hat_redcap(m):
    """Drwal: miekka czerwona czapka i ruda broda."""
    m.sphere(0.064, 8, 4, z=0.385, col='cap_red', sz=0.82, half=True)
    beard(m, k=1.15)


def hat_beanie(m):
    """Rybak, szkutnik: blekitna welniana czapka z pomponem."""
    m.cyl(0.062, 0.042, 8, z=0.388, col='hat_cyan', r_top=0.044, bottom=False)
    m.sphere(0.018, 4, 2, z=0.434, col='white')


def hat_blackhat(m):
    """Tracz: czarny okragly kapelusz i was."""
    m.sphere(0.062, 8, 4, z=0.39, col='hat_black', sz=0.8, half=True)
    m.cyl(0.082, 0.008, 8, z=0.386, col='hat_black', bottom=False)
    mustache(m, 'hair_brown')


def hat_bandana(m):
    """Kamieniarz: rozowa chusta zawiazana z tylu."""
    m.cyl(0.061, 0.042, 8, z=0.392, col='hat_pink', r_top=0.05, bottom=False)
    m.sphere(0.02, 4, 2, y=0.062, z=0.398, col='hat_pink', sy=1.4)


def hat_bald(m):
    """Kowal: lysy, rude wlosy tylko po bokach i z tylu glowy."""
    m.sphere(0.058, 8, 3, y=0.022, z=0.372, col='hair', sz=0.6)


def hat_striped(m):
    """Rzeznik: biala czapka w blekitny pas."""
    m.cyl(0.06, 0.045, 8, z=0.39, col='white', r_top=0.05, bottom=False, bands=[0.015, 0.027],
          paint=lambda k, j: 'hat_cyan' if j == 1 else None)


def hat_cap(m):
    """Tragarz, tracz, studniarz: plaska czapka z daszkiem."""
    m.cyl(0.06, 0.03, 8, z=0.4, col='hat_brown', r_top=0.052, bottom=False)
    m.box(0.07, 0.05, 0.01, y=-0.06, z=0.402, col='hat_brown', rx=-0.15)
    beard(m)


def hat_straw(m):
    """Rolnik, kopacz, hodowcy: slomkowy kapelusz z szerokim rondem."""
    m.cyl(0.11, 0.01, 8, z=0.4, col='wheat', bottom=False)
    m.cyl(0.05, 0.05, 8, z=0.405, col='wheat', r_top=0.042, bottom=False)


def hat_hood(m):
    """Drwal, smolarz, piwowar: spiczasty kaptur z kolnierzem."""
    m.cyl(0.066, 0.05, 8, z=0.37, col='hat_red', r_top=0.06, bottom=False)
    m.cone(0.061, 0.11, 8, z=0.415, col='hat_red', rx=0.35, bottom=False)


def hat_feather(m):
    """Lesnik, mysliwy: zielony kapelusz z piorem."""
    m.cyl(0.085, 0.01, 8, z=0.4, col='hat_green', bottom=False)
    m.cyl(0.052, 0.05, 6, z=0.405, col='hat_green', r_top=0.036, bottom=False)
    m.box(0.012, 0.09, 0.012, x=0.04, y=0.03, z=0.46, col='feather', rx=0.6)


def hat_miner(m):
    """Gornik: szary helm z zolta lampka."""
    m.cyl(0.064, 0.045, 8, z=0.39, col='metal', r_top=0.048, bottom=False)
    m.sphere(0.017, 4, 2, y=-0.058, z=0.415, col='fire_core', sy=0.7)


def hat_brim(m):
    """Rybak: zolty kapelusz przeciwdeszczowy, rondo opadajace z tylu."""
    m.cyl(0.1, 0.012, 8, z=0.395, col='hat_yellow', r_top=0.085, bottom=False)
    m.cyl(0.05, 0.045, 8, z=0.405, col='hat_yellow', r_top=0.04, bottom=False)


def hat_miller(m):
    """Mlynarz: biala miekka czapka i siwy was."""
    m.cyl(0.058, 0.02, 8, z=0.395, col='flour', bottom=False)
    m.ico(0.06, x=0.01, y=0.01, z=0.425, col='flour', sub=0, sz=0.6)
    mustache(m, 'beard_grey')


def hat_chef(m):
    """Piekarz: wysoka czapa kucharska."""
    m.cyl(0.056, 0.035, 8, z=0.395, col='white', bottom=False)
    m.cyl(0.07, 0.06, 8, z=0.43, col='white', r_top=0.075, bottom=False)


def hat_leather(m):
    """Kowale, hutnik, kamieniarz: skorzana czapka i gesta broda."""
    m.cyl(0.059, 0.042, 8, z=0.39, col='wood_dark', r_top=0.05, bottom=False)
    beard(m, k=1.15)


def hat_explorer(m):
    """Geolog: korkowy helm, siwa broda."""
    m.cyl(0.085, 0.01, 8, z=0.395, col='cream', bottom=False)
    m.cyl(0.058, 0.045, 6, z=0.4, col='cream', r_top=0.03, bottom=False)
    beard(m, 'beard_grey', k=1.1)


def hat_mask(m):
    """Hutnik: biala maska ochronna na twarzy z ciemnym wizjerem."""
    m.cyl(0.059, 0.042, 6, z=0.39, col='mask_white', r_top=0.05, bottom=False)
    m.sphere(0.06, 6, 3, y=-0.03, z=0.37, col='mask_white', sx=1.0, sy=0.6, sz=1.1)
    m.box(0.06, 0.012, 0.022, y=-0.066, z=0.374, col='black')


def hat_sailor(m):
    """Przewoznik, szkutnik: chusta zawiazana z tylu."""
    m.cyl(0.059, 0.038, 8, z=0.39, col='hat_blue', r_top=0.05, bottom=False)
    m.box(0.03, 0.04, 0.03, y=0.06, z=0.39, col='hat_blue', rx=0.5)


def hat_kettle(m):
    """Katapulciarz: zelazny kapalin."""
    m.cyl(0.095, 0.01, 8, z=0.395, col='metal', r_top=0.08, bottom=False)
    m.cyl(0.058, 0.045, 8, z=0.4, col='metal', r_top=0.035, bottom=False)


def hat_beret(m):
    """Mincerz: aksamitny beret."""
    m.cyl(0.07, 0.028, 8, x=0.01, z=0.404, col='hat_purple', r_top=0.06, bottom=False)
    m.box(0.01, 0.01, 0.02, x=0.01, z=0.43, col='hat_purple')


# ---------------------------------------------------------------- narzedzia (poczatek w barku, dlon w z = HAND)

def tool_axe(m):
    m.beam((0, 0.01, HAND + 0.03), (0, -0.02, HAND - 0.13), 0.016, 'wood')
    m.box(0.012, 0.055, 0.04, y=-0.04, z=HAND - 0.14, col='metal')


def tool_hammer(m):
    m.beam((0, 0, HAND + 0.02), (0, -0.01, HAND - 0.09), 0.014, 'wood')
    m.box(0.028, 0.06, 0.028, y=-0.012, z=HAND - 0.105, col='metal_dark')


def tool_pick(m):
    m.beam((0, 0.01, HAND + 0.03), (0, -0.02, HAND - 0.14), 0.015, 'wood')
    m.beam((0, 0.05, HAND - 0.12), (0, -0.09, HAND - 0.16), 0.016, 'metal')


def tool_shovel(m):
    m.beam((0, 0.06, HAND + 0.03), (0, -0.16, HAND - 0.06), 0.015, 'wood')
    m.box(0.05, 0.012, 0.06, y=-0.18, z=HAND - 0.09, col='metal', rx=-0.4)


def tool_scythe(m):
    m.beam((0, 0.08, HAND + 0.05), (0, -0.2, HAND - 0.1), 0.014, 'wood')
    m.beam((0, -0.19, HAND - 0.1), (0.13, -0.17, HAND - 0.13), 0.01, 'metal')
    m.box(0.012, 0.04, 0.012, y=-0.03, z=HAND, col='wood')


def tool_rod(m):
    m.beam((0, 0.03, HAND - 0.01), (0, -0.3, HAND + 0.2), 0.01, 'wood')
    m.beam((0, -0.3, HAND + 0.2), (0, -0.31, HAND + 0.02), 0.004, 'white')


def tool_bow(m):
    m.beam((0, -0.02, HAND + 0.12), (0, -0.05, HAND), 0.012, 'wood_dark')
    m.beam((0, -0.05, HAND), (0, -0.02, HAND - 0.12), 0.012, 'wood_dark')
    m.beam((0, -0.015, HAND + 0.12), (0, -0.015, HAND - 0.12), 0.004, 'white')


def tool_saw(m):
    m.box(0.016, 0.03, 0.03, z=HAND - 0.015, col='wood')
    m.box(0.006, 0.16, 0.04, y=-0.09, z=HAND - 0.03, col='metal')


def tool_rolling_pin(m):
    m.cyl(0.016, 0.11, 6, x=-0.055, y=-0.03, z=HAND - 0.01, col='wood_light', ry=R)


def tool_cleaver(m):
    m.beam((0, 0, HAND + 0.01), (0, -0.01, HAND - 0.05), 0.014, 'wood_dark')
    m.box(0.008, 0.06, 0.07, y=-0.025, z=HAND - 0.09, col='metal')


def tool_tongs(m):
    for x in (-0.008, 0.008):
        m.beam((x, 0, HAND + 0.01), (x * 2.5, -0.05, HAND - 0.13), 0.008, 'metal_dark')
    m.box(0.03, 0.03, 0.02, y=-0.05, z=HAND - 0.14, col='fire')


def tool_bucket(m):
    m.cyl(0.035, 0.05, 6, y=-0.01, z=HAND - 0.085, col='wood', r_top=0.04)
    m.beam((0, -0.01, HAND - 0.035), (0, -0.01, HAND + 0.005), 0.006, 'metal_dark')


# ---------------------------------------------------------------- rycerz

def knight_helmet(m):
    """Srebrny helm z wizjerem i zoltym pioropuszem."""
    m.cyl(0.066, 0.085, 8, z=0.33, col='metal', r_top=0.058, bottom=False)
    m.box(0.07, 0.014, 0.012, y=-0.063, z=0.37, col='black')  # wizjer
    m.sphere(0.024, 4, 2, z=0.43, col='gold', sz=1.7)


def knight_shield(m):
    m.box(0.014, 0.11, 0.13, x=-0.105, z=0.14, col='red')
    m.box(0.018, 0.035, 0.035, x=-0.108, z=0.19, col='gold')


def knight_sword(m):
    # Przy rece: poczatek w barku, jelec w dloni, ostrze w dol i do przodu.
    m.box(0.06, 0.014, 0.014, z=HAND - 0.01, col='gold')
    m.box(0.018, 0.006, 0.19, y=-0.03, z=HAND - 0.12, col='white', rx=0.25)


def donkey(m):
    m.box(0.11, 0.26, 0.11, z=0.13, col='donkey')
    m.box(0.07, 0.12, 0.07, y=-0.17, z=0.2, col='donkey', rx=-0.5)
    m.box(0.05, 0.06, 0.05, y=-0.22, z=0.2, col='donkey_dark')
    for x in (-0.02, 0.02):
        m.box(0.015, 0.015, 0.07, x=x, y=-0.16, z=0.27, col='donkey_dark')
        for y in (-0.09, 0.09):
            m.box(0.03, 0.03, 0.13, x=x * 1.8, y=y, col='donkey_dark')
    m.box(0.12, 0.1, 0.06, z=0.24, col='wood')  # juki
    m.box(0.02, 0.02, 0.08, y=0.14, z=0.14, col='donkey_dark', rx=0.5)  # ogon


# ---------------------------------------------------------------- ikony UI i podglad zawodow

# Stawy jak w grze (client/render/entities.ts: HIP, SHOULDER) - do skladania calej postaci w ikonach.
HIP_AT, SHOULDER_AT = 0.14, 0.31


def place(m, f, loc):
    """Buduje czesci funkcja f i przesuwa je do stawu loc."""
    n = len(m.parts)
    f(m)
    for ob in m.parts[n:]:
        ob.location = loc


def figure(m, tunic, hat=None, tool=None):
    """Cala postac w pozie stojacej (do ikon i arkusza podgladow), z tych samych czesci co w grze."""
    serf_torso(m, tunic)
    big(serf_head)(m)
    for x in (-0.035, 0.035):
        place(m, serf_leg, (x, 0, HIP_AT))
    for x in (-ARM_X, ARM_X):
        place(m, lambda mm: serf_arm(mm, tunic), (x, 0, SHOULDER_AT))
    if hat:
        big(hat)(m)
    if tool:
        place(m, tool, (ARM_X, 0, SHOULDER_AT))


def icon_serf(m):
    figure(m, '#4f7fcf', hat_hair)


def icon_knight(m):
    figure(m, '#4f7fcf')
    big(knight_helmet)(m)
    knight_shield(m)
    place(m, knight_sword, (ARM_X, 0, SHOULDER_AT))


HATS = {
    'hat_hair': hat_hair, 'hat_cap': hat_cap, 'hat_straw': hat_straw, 'hat_hood': hat_hood, 'hat_feather': hat_feather,
    'hat_miner': hat_miner, 'hat_brim': hat_brim, 'hat_miller': hat_miller, 'hat_chef': hat_chef, 'hat_leather': hat_leather,
    'hat_explorer': hat_explorer, 'hat_sailor': hat_sailor, 'hat_kettle': hat_kettle, 'hat_beret': hat_beret,
    'hat_mask': hat_mask, 'hat_redhair': hat_redhair, 'hat_redcap': hat_redcap, 'hat_beanie': hat_beanie,
    'hat_blackhat': hat_blackhat, 'hat_bandana': hat_bandana, 'hat_bald': hat_bald, 'hat_striped': hat_striped,
}
HATS = {k: big(f) for k, f in HATS.items()}
TOOLS = {
    'tool_axe': tool_axe, 'tool_hammer': tool_hammer, 'tool_pick': tool_pick, 'tool_shovel': tool_shovel,
    'tool_scythe': tool_scythe, 'tool_rod': tool_rod, 'tool_bow': tool_bow, 'tool_saw': tool_saw,
    'tool_rolling_pin': tool_rolling_pin, 'tool_cleaver': tool_cleaver, 'tool_tongs': tool_tongs, 'tool_bucket': tool_bucket,
}
BUILDERS = {
    'serf_torso': serf_torso, 'serf_head': big(serf_head), 'serf_leg': serf_leg, 'serf_arm': serf_arm,
    'knight_helmet': big(knight_helmet), 'knight_shield': knight_shield, 'knight_sword': knight_sword, 'donkey': donkey,
    **HATS, **TOOLS,
}
ICON_BUILDERS = {'icon_serf': icon_serf, 'icon_knight': icon_knight}

# Podglady zawodow (tylko PNG do przegladu, bez eksportu do gry): nazwa -> (czapka, narzedzie).
PROFESSIONS = {
    'woodcutter': (hat_redcap, tool_axe), 'forester': (hat_feather, tool_shovel), 'miner': (hat_miner, tool_pick),
    'fisher': (hat_beanie, tool_rod), 'hunter': (hat_feather, tool_bow), 'farmer': (hat_redhair, tool_scythe),
    'baker': (hat_chef, tool_rolling_pin), 'butcher': (hat_striped, tool_cleaver), 'smith': (hat_bald, tool_hammer),
    'geologist': (hat_explorer, tool_hammer), 'sawyer': (hat_blackhat, tool_saw), 'weller': (hat_cap, tool_bucket),
    'minter': (hat_beret, tool_tongs), 'sailor': (hat_sailor, None), 'catapulter': (hat_kettle, None), 'generic': (hat_hair, None),
    'smelter': (hat_mask, tool_tongs), 'carrier': (hat_hair, None), 'stonecutter': (hat_bandana, tool_pick),
    'miller': (hat_miller, None), 'toolmaker': (hat_hair, tool_hammer),
}


def preview_builders():
    return {f'pro_{k}': (lambda m, h=h, t=t: figure(m, '#4f7fcf', h, t)) for k, (h, t) in PROFESSIONS.items()}


if __name__ == '__main__':
    if '--pro' in sys.argv:
        from lib import Model, reset, render_preview, selected_names  # noqa: E402
        for name, f in preview_builders().items():
            reset()
            mm = Model(name)
            f(mm)
            render_preview(mm.finish(0.0, smooth=SMOOTH), icon=0)
    else:
        build(BUILDERS, icons=False, smooth=SMOOTH)
        build(ICON_BUILDERS, icons=True, smooth=SMOOTH)
