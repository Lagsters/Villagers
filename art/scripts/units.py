"""
Jednostki: osadnik skladany z czesci animowanych w kodzie gry (bez szkieletu), rycerz, osiol.
Noga i reka maja poczatek ukladu w stawie (biodro/bark), zeby obracac je wokol osi X.
Plotno tulowia jest biale - kolor gracza nakladany w rendererze.
Uruchomienie: blender --background --python art/scripts/units.py [-- nazwa ...]
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from lib import build  # noqa: E402

HIP = 0.14
SHOULDER = 0.31


def serf_torso(m):
    m.cyl(0.075, 0.19, 6, z=0.13, col='cloth', r_top=0.06)
    m.cyl(0.078, 0.025, 6, z=0.15, col='wood_dark')  # pas


def serf_head(m):
    m.ico(0.055, z=0.375, col='skin', sub=1)
    m.cyl(0.05, 0.03, 6, z=0.4, col='hair', r_top=0.035)


def serf_leg(m):
    # Poczatek w biodrze, noga w dol.
    m.box(0.045, 0.05, 0.12, z=-0.12, col='trousers')
    m.box(0.05, 0.07, 0.03, y=-0.01, z=-0.14, col='boots')


def serf_arm(m):
    m.box(0.035, 0.04, 0.12, z=-0.12, col='cloth')
    m.box(0.035, 0.035, 0.03, z=-0.145, col='skin')


def knight_helmet(m):
    m.cyl(0.062, 0.05, 6, z=0.37, col='metal', r_top=0.05)
    m.cone(0.052, 0.05, 6, z=0.42, col='metal')
    m.box(0.012, 0.05, 0.035, z=0.455, col='red')


def knight_shield(m):
    m.box(0.012, 0.1, 0.12, x=-0.1, z=0.16, col='wood_dark')
    m.box(0.014, 0.05, 0.05, x=-0.103, z=0.195, col='metal')


def knight_sword(m):
    # Przy rece: poczatek w barku, ostrze w dol i do przodu.
    m.box(0.02, 0.02, 0.04, z=-0.16, col='wood_dark')
    m.box(0.06, 0.012, 0.012, z=-0.13, col='metal_dark')
    m.box(0.016, 0.006, 0.17, y=-0.02, z=-0.31, col='white', rx=0.25)


def donkey(m):
    m.box(0.11, 0.26, 0.11, z=0.13, col='donkey')
    m.box(0.07, 0.12, 0.07, y=-0.17, z=0.2, col='donkey', rx=-0.5)
    m.box(0.05, 0.06, 0.05, y=-0.22, z=0.2, col='donkey_dark')
    for x in (-0.02, 0.02):
        m.box(0.015, 0.015, 0.07, x=x, y=-0.16, z=0.27, col='donkey_dark')
        for y in (-0.09, 0.09):
            m.box(0.03, 0.03, 0.13, x=x * 1.8, y=y, col='donkey_dark')
    m.box(0.12, 0.1, 0.06, z=0.24, col='wood')  # juki


def icon_serf(m):
    """Osadnik w calosci - tylko do ikony UI."""
    m.cyl(0.075, 0.19, 6, z=0.13, col='#4f7fcf', r_top=0.06)
    m.ico(0.055, z=0.375, col='skin', sub=1)
    m.cyl(0.05, 0.03, 6, z=0.4, col='hair', r_top=0.035)
    for x in (-0.035, 0.035):
        m.box(0.045, 0.05, 0.13, x=x, col='trousers')
    for x in (-0.09, 0.09):
        m.box(0.035, 0.04, 0.12, x=x, z=0.19, col='#4f7fcf')


def icon_knight(m):
    icon_serf(m)
    knight_helmet(m)
    knight_shield(m)
    m.box(0.016, 0.006, 0.22, x=0.1, y=-0.03, z=0.14, col='white')


BUILDERS = {
    'serf_torso': serf_torso, 'serf_head': serf_head, 'serf_leg': serf_leg, 'serf_arm': serf_arm,
    'knight_helmet': knight_helmet, 'knight_shield': knight_shield, 'knight_sword': knight_sword, 'donkey': donkey,
}
ICON_BUILDERS = {'icon_serf': icon_serf, 'icon_knight': icon_knight}

if __name__ == '__main__':
    build(BUILDERS, icons=False)
    build(ICON_BUILDERS, icons=True)
