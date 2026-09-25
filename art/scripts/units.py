"""
Jednostki: osadnik skladany z czesci animowanych w kodzie gry (bez szkieletu), rycerz, osiol.
Noga, reka i narzedzie maja poczatek ukladu w stawie (biodro/bark), zeby obracac je wokol osi X.
Tulow (tunika) jest bialy - kolor gracza nakladany w rendererze; rekawy lniane, dlonie w kolorze skory.
Zawody rozpoznaje sie po nakryciu glowy (hat_*, czesc z brodami) i narzedziu w prawej rece (tool_*).
Przod postaci: -Y. Budzet: tulow+glowa+2 nogi+2 rece+czapka+narzedzie <= 300 trojkatow.
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
    'hair': '#b0502a', 'eye': '#1c1c1c', 'mask': '#9aa0a6',
})

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

def serf_torso(m):
    m.cyl(0.075, 0.19, 7, z=0.13, col='cloth', r_top=0.058)  # tunika
    m.cyl(0.079, 0.024, 7, z=0.155, col='wood_dark')  # pas


def serf_head(m):
    m.cyl(0.054, 0.09, 8, z=0.33, col='skin', r_top=0.049)
    m.box(0.022, 0.026, 0.026, y=-0.06, z=0.352, col='skin')  # duzy nos
    for x in (-0.022, 0.022):  # oczy
        m.box(0.013, 0.01, 0.015, x=x, y=-0.05, z=0.377, col='eye')


def serf_leg(m):
    # Poczatek w biodrze, noga w dol.
    m.box(0.046, 0.05, 0.12, z=-0.12, col='trousers')
    m.box(0.052, 0.074, 0.032, y=-0.012, z=-0.142, col='boots')


def serf_arm(m):
    m.box(0.036, 0.042, 0.12, z=-0.12, col='linen')
    m.box(0.032, 0.034, 0.032, z=-0.148, col='skin')


# ---------------------------------------------------------------- nakrycia glowy (uklad jak glowa)

def hat_hair(m):
    m.cyl(0.058, 0.032, 6, z=0.392, col='hair', r_top=0.044)
    m.box(0.1, 0.03, 0.05, y=0.036, z=0.352, col='hair')
    m.box(0.07, 0.03, 0.045, y=-0.04, z=0.305, col='beard', rx=0.2)


def hat_cap(m):
    """Tragarz, tracz, studniarz: plaska czapka z daszkiem."""
    m.cyl(0.06, 0.03, 6, z=0.4, col='hat_brown', r_top=0.052)
    m.box(0.07, 0.05, 0.01, y=-0.06, z=0.402, col='hat_brown', rx=-0.15)
    m.box(0.07, 0.03, 0.045, y=-0.04, z=0.305, col='beard', rx=0.2)


def hat_straw(m):
    """Rolnik, kopacz, hodowcy: slomkowy kapelusz z szerokim rondem."""
    m.cyl(0.11, 0.01, 8, z=0.4, col='wheat')
    m.cyl(0.05, 0.05, 6, z=0.405, col='wheat', r_top=0.042)


def hat_hood(m):
    """Drwal, smolarz, piwowar: spiczasty kaptur z kolnierzem."""
    m.cyl(0.066, 0.05, 6, z=0.37, col='hat_red', r_top=0.06)
    m.cone(0.061, 0.11, 6, z=0.415, col='hat_red', rx=0.35)


def hat_feather(m):
    """Lesnik, mysliwy: zielony kapelusz z piorem."""
    m.cyl(0.085, 0.01, 6, z=0.4, col='hat_green')
    m.cyl(0.052, 0.05, 5, z=0.405, col='hat_green', r_top=0.036)
    m.box(0.012, 0.09, 0.012, x=0.04, y=0.03, z=0.46, col='feather', rx=0.6)


def hat_miner(m):
    """Gornik: skorzany helm z lampka i broda."""
    m.cyl(0.062, 0.045, 6, z=0.39, col='wood_dark', r_top=0.045)
    m.box(0.03, 0.022, 0.028, y=-0.06, z=0.41, col='fire_core')
    m.box(0.07, 0.03, 0.05, y=-0.042, z=0.31, col='beard', rx=0.2)


def hat_brim(m):
    """Rybak: zolty kapelusz przeciwdeszczowy, rondo opadajace z tylu."""
    m.cyl(0.1, 0.012, 8, z=0.395, col='hat_yellow', r_top=0.085)
    m.cyl(0.05, 0.045, 5, z=0.405, col='hat_yellow', r_top=0.04)


def hat_miller(m):
    """Mlynarz, rzeznik: biala miekka czapka."""
    m.cyl(0.058, 0.02, 5, z=0.395, col='flour')
    m.ico(0.06, x=0.01, y=0.01, z=0.425, col='flour', sub=0, sz=0.6)


def hat_chef(m):
    """Piekarz: wysoka czapa kucharska."""
    m.cyl(0.056, 0.035, 6, z=0.395, col='white')
    m.cyl(0.07, 0.06, 6, z=0.43, col='white', r_top=0.075)


def hat_leather(m):
    """Kowale, hutnik, kamieniarz: skorzana czapka i gesta broda."""
    m.cyl(0.059, 0.035, 6, z=0.39, col='wood_dark', r_top=0.05)
    m.box(0.075, 0.032, 0.06, y=-0.04, z=0.305, col='beard', rx=0.15)


def hat_explorer(m):
    """Geolog: korkowy helm, siwa broda."""
    m.cyl(0.085, 0.01, 5, z=0.395, col='cream')
    m.cyl(0.058, 0.045, 5, z=0.4, col='cream', r_top=0.03)
    m.box(0.07, 0.03, 0.06, y=-0.04, z=0.305, col='beard_grey', rx=0.15)


def hat_mask(m):
    """Hutnik: skorzana czapka i uniesiona maska ochronna."""
    m.cyl(0.059, 0.035, 6, z=0.39, col='wood_dark', r_top=0.05)
    m.box(0.08, 0.02, 0.07, y=-0.06, z=0.4, col='mask', rx=-0.5)


def hat_sailor(m):
    """Przewoznik, szkutnik: chusta zawiazana z tylu."""
    m.cyl(0.059, 0.03, 6, z=0.39, col='hat_blue', r_top=0.05)
    m.box(0.03, 0.04, 0.03, y=0.06, z=0.39, col='hat_blue', rx=0.5)


def hat_kettle(m):
    """Katapulciarz: zelazny kapalin."""
    m.cyl(0.095, 0.01, 8, z=0.395, col='metal', r_top=0.08)
    m.cyl(0.058, 0.045, 6, z=0.4, col='metal', r_top=0.035)


def hat_beret(m):
    """Mincerz: aksamitny beret."""
    m.cyl(0.07, 0.025, 7, x=0.01, z=0.402, col='hat_purple', r_top=0.06)
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
    m.cyl(0.066, 0.075, 6, z=0.33, col='metal', r_top=0.06)  # helm garnczkowy
    m.cone(0.061, 0.045, 6, z=0.405, col='metal')
    m.box(0.07, 0.014, 0.012, y=-0.062, z=0.37, col='black')  # wizjer


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

def figure(m, tunic, hat=None, tool=None, arm_r=0.0):
    """Cala postac w pozie stojacej (do ikon i arkusza podgladow)."""
    m.cyl(0.075, 0.19, 7, z=0.13, col=tunic, r_top=0.058)
    m.cyl(0.079, 0.024, 7, z=0.155, col='wood_dark')
    big(serf_head)(m)
    for x in (-0.035, 0.035):
        m.box(0.046, 0.05, 0.12, x=x, z=0.02, col='trousers')
        m.box(0.052, 0.074, 0.032, x=x, y=-0.012, col='boots')
    for x in (-0.09, 0.09):
        m.box(0.036, 0.042, 0.12, x=x, z=0.19, col='linen')
        m.box(0.032, 0.034, 0.032, x=x, z=0.163, col='skin')
    if hat:
        big(hat)(m)
    if tool:
        n = len(m.parts)
        tool(m)
        # Przesuniecie narzedzia do prawego barku.
        for ob in m.parts[n:]:
            ob.location = (0.09, 0, 0.31)


def icon_serf(m):
    figure(m, '#4f7fcf', hat_cap)


def icon_knight(m):
    figure(m, '#4f7fcf')
    big(knight_helmet)(m)
    knight_shield(m)
    n = len(m.parts)
    knight_sword(m)
    for ob in m.parts[n:]:
        ob.location = (0.09, 0, 0.31)


HATS = {
    'hat_hair': hat_hair, 'hat_cap': hat_cap, 'hat_straw': hat_straw, 'hat_hood': hat_hood, 'hat_feather': hat_feather,
    'hat_miner': hat_miner, 'hat_brim': hat_brim, 'hat_miller': hat_miller, 'hat_chef': hat_chef, 'hat_leather': hat_leather,
    'hat_explorer': hat_explorer, 'hat_sailor': hat_sailor, 'hat_kettle': hat_kettle, 'hat_beret': hat_beret,
    'hat_mask': hat_mask,
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
    'woodcutter': (hat_hood, tool_axe), 'forester': (hat_feather, tool_shovel), 'miner': (hat_miner, tool_pick),
    'fisher': (hat_brim, tool_rod), 'hunter': (hat_feather, tool_bow), 'farmer': (hat_straw, tool_scythe),
    'baker': (hat_chef, tool_rolling_pin), 'butcher': (hat_miller, tool_cleaver), 'smith': (hat_leather, tool_hammer),
    'geologist': (hat_explorer, tool_hammer), 'sawyer': (hat_cap, tool_saw), 'weller': (hat_cap, tool_bucket),
    'minter': (hat_beret, tool_tongs), 'sailor': (hat_sailor, None), 'catapulter': (hat_kettle, None), 'generic': (hat_hair, None),
    'smelter': (hat_mask, tool_tongs), 'carrier': (hat_cap, None),
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
            render_preview(mm.finish(0.0), icon=0)
    else:
        build(BUILDERS, icons=False)
        build(ICON_BUILDERS, icons=True)
