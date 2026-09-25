"""
Natura i obiekty mapy: drzewa, pien, skaly, pola zboza, znak geologa, ruina, ogien, slupek graniczny, flaga.
Uruchomienie: blender --background --python art/scripts/nature.py [-- nazwa ...]
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from lib import build  # noqa: E402


def tree_pine(m):
    m.cyl(0.05, 0.35, 5, col='bark')
    m.cone(0.36, 0.55, 7, z=0.28, col='pine_dark')
    m.cone(0.29, 0.5, 7, z=0.58, col='pine')
    m.cone(0.2, 0.42, 7, z=0.88, col='pine')


def tree_leaf(m):
    m.cyl(0.06, 0.5, 5, col='bark', r_top=0.045)
    m.ico(0.34, z=0.78, col='leaf', sub=1, sz=0.9)
    m.ico(0.22, x=0.14, y=-0.08, z=0.62, col='leaf_dark', sub=1)


def stump(m):
    m.cyl(0.08, 0.12, 6, col='bark', r_top=0.07)
    m.cyl(0.066, 0.01, 6, z=0.12, col='wood_light')


def stone(m):
    m.ico(0.26, z=0.1, col='stone', sub=1, sz=0.7)
    m.ico(0.17, x=0.2, y=0.08, z=0.05, col='stone_dark', sub=1, sz=0.8)
    m.ico(0.12, x=-0.18, y=-0.1, z=0.04, col='stone_light', sub=1, sz=0.8)


def field(m):
    m.cyl(0.42, 0.03, 6, col='soil')
    for i, x in enumerate((-0.22, 0, 0.22)):
        m.box(0.09, 0.62 - abs(x), 0.26, x=x, z=0.03, col='wheat_green')


def field_ripe(m):
    m.cyl(0.42, 0.03, 6, col='soil')
    for x in (-0.22, 0, 0.22):
        m.box(0.1, 0.64 - abs(x), 0.34, x=x, z=0.03, col='wheat')
        m.box(0.12, 0.64 - abs(x), 0.04, x=x, z=0.37, col='wheat')


def sign(m):
    m.box(0.03, 0.03, 0.42, col='wood')
    m.box(0.22, 0.02, 0.15, z=0.3, col='cream')


def ruin(m):
    m.box(0.55, 0.45, 0.08, col='stone_dark')
    m.box(0.14, 0.14, 0.22, x=-0.2, y=-0.14, col='coal')
    m.box(0.12, 0.3, 0.14, x=0.2, y=0.05, col='wood_dark', rz=0.4)


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
    'tree_pine': tree_pine, 'tree_leaf': tree_leaf, 'stump': stump, 'stone': stone, 'field': field,
    'field_ripe': field_ripe, 'sign': sign, 'ruin': ruin, 'fire': fire, 'border': border, 'flag': flag,
    'flag_cloth': flag_cloth, 'animal': animal,
}

if __name__ == '__main__':
    build(BUILDERS, icons=False)
    _ = math
