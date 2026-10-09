"""
Znaczniki miejsc budowy (jak ikony w pierwowzorze): zolta flaga, chata, dom, zamek (duzy budynek)
i kilof (kopalnia). Male, czytelne z gory; renderowane tylko w trybie "Miejsca budowy".
Uruchomienie: blender --background --python art/scripts/markers.py [-- nazwa ...]
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from lib import PALETTE, build  # noqa: E402

PALETTE.update({'mark': '#f2d23c', 'mark_dark': '#c99a1e', 'mark_line': '#6b4a12'})
R = math.pi / 2


def mark_flag(m):
    m.cyl(0.012, 0.22, 5, col='mark_line')
    m.box(0.1, 0.012, 0.065, x=0.05, z=0.15, col='mark')


def mark_small(m):
    m.box(0.13, 0.11, 0.08, col='mark')
    m.gable(0.13, 0.11, 0.06, z=0.08, col='mark_dark', overhang=0.012)
    m.box(0.03, 0.012, 0.05, y=-0.056, col='mark_line')


def mark_medium(m):
    m.box(0.19, 0.13, 0.1, col='mark')
    m.gable(0.19, 0.13, 0.07, z=0.1, col='mark_dark', overhang=0.012)
    m.box(0.035, 0.012, 0.06, y=-0.066, col='mark_line')
    m.box(0.03, 0.03, 0.06, x=0.05, y=0.02, z=0.15, col='mark')


def mark_large(m):
    m.box(0.2, 0.14, 0.1, col='mark')
    for x in (-0.11, 0.11):
        m.cyl(0.04, 0.16, 6, x=x, y=-0.04, col='mark')
        m.cone(0.05, 0.07, 6, x=x, y=-0.04, z=0.16, col='mark_dark')
    for x in (-0.05, 0.0, 0.05):
        m.box(0.025, 0.14, 0.025, x=x, z=0.1, col='mark')
    m.box(0.045, 0.012, 0.06, y=-0.072, col='mark_line')


def mark_mine(m):
    m.ico(0.09, col='mark_dark', sub=1, sz=0.4)
    m.beam((-0.08, 0.0, 0.03), (0.08, 0.0, 0.12), 0.018, 'mark_line')
    m.beam((0.03, 0.0, 0.16), (0.13, 0.0, 0.05), 0.02, 'mark')


BUILDERS = {
    'mark_flag': mark_flag, 'mark_small': mark_small, 'mark_medium': mark_medium,
    'mark_large': mark_large, 'mark_mine': mark_mine,
}

if __name__ == '__main__':
    build(BUILDERS, icons=False)
