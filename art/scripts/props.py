"""
Wspolne rekwizyty scen pracy: czasteczki (fx_puff - kula dymu, pary, pylu i kropli; fx_bit - szescian
wiorow, iskier, odpryskow i ziarna). Modele sa biale - kolor nadaje gra (kolor instancji).
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


BUILDERS = {'fx_puff': fx_puff, 'fx_bit': fx_bit}

if __name__ == '__main__':
    build(BUILDERS, icons=False, smooth=60.0)
