"""
Wspolne rekwizyty: czasteczki scen pracy (fx_puff - kula dymu, pary, pylu i kropli; fx_bit - szescian
wiorow, iskier, odpryskow i ziarna; biale - kolor nadaje gra) i stopien schodow przed drzwiami budynkow (stair_step).
Uruchomienie: blender --background --python art/scripts/props.py [-- nazwa ...]
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from lib import build  # noqa: E402


def fx_puff(m):
    """Kula o srednicy 1 (skala instancji = srednica), gladko cieniowana."""
    m.ico(0.5, col='white', sub=2)


def fx_bit(m):
    """Szescian o boku 1 ze srodkiem w poczatku ukladu."""
    m.cbox(1.0, 1.0, 1.0, col='white', jitter=0.0)


def stair_step(m):
    """Stopien schodow przed drzwiami budynku (gra skaluje go do szerokosci drzwi, glebokosci stopnia i wysokosci do
    terenu - client/render/entities.ts): szescian 1 x 1 x 1 z wierzchem w z = 0, kamien jak podmurowka budynkow."""
    m.box(1.0, 1.0, 1.0, z=-1.0, col='stone_step', jitter=0.0)


BUILDERS = {'fx_puff': fx_puff, 'fx_bit': fx_bit, 'stair_step': stair_step}

if __name__ == '__main__':
    build(BUILDERS, icons=False, smooth=60.0)
