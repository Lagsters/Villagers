"""
Wspolna biblioteka skryptow modeli (bpy, tryb --background).

Kazdy model to zbior prostych brył z kolorem w wierzcholkach (jedna paleta dla calej gry, bez tekstur),
laczonych w jeden mesh. Eksport: art/models/<nazwa>.glb, podglad: art/previews/<nazwa>.png,
ikona 64x64: art/icons/<nazwa>.png.

Uklad: 1 jednostka = szerokosc pola mapy. Z w gore, podstawa na z = 0. Budynki modelujemy z wejsciem
na -Y i obracamy o 30 stopni, zeby drzwi patrzyly na flage (pole SE w grze).
"""
import bpy
import bmesh
import math
import os
import sys
from mathutils import Matrix, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
MODELS = os.path.join(ROOT, 'models')
PREVIEWS = os.path.join(ROOT, 'previews')
ICONS = os.path.join(ROOT, 'icons')

# ---------- Paleta (sRGB) ----------
PALETTE = {
    'wall': '#e8dcc0', 'wall_dark': '#cdbf9f', 'plaster': '#f0e6cf',
    'wood': '#9a6b3f', 'wood_dark': '#6e4a2a', 'wood_light': '#c49a64', 'log': '#7a5230', 'bark': '#5b3d22',
    'roof_red': '#b0493a', 'roof_brown': '#7e5436', 'roof_green': '#5f7f3e', 'roof_blue': '#4f6a8f',
    'roof_slate': '#5c6470', 'thatch': '#c9a45a',
    'stone': '#a7a39c', 'stone_dark': '#7d7a74', 'stone_light': '#c4c0b8',
    'metal': '#8e959e', 'metal_dark': '#5a6068', 'gold': '#e8b83a', 'copper': '#b87333',
    'coal': '#2b2b2e', 'iron_ore': '#8a4f3d', 'gold_ore': '#c9a54a',
    'leaf': '#5b8f3a', 'leaf_dark': '#3f6f2e', 'pine': '#2f5f3e', 'pine_dark': '#244a31',
    'grass': '#79a84a', 'soil': '#6b4a2e', 'wheat': '#e3c25a', 'wheat_green': '#8fb04e',
    'water': '#4f86b0', 'fire': '#ff8a2a', 'fire_core': '#ffd65a', 'smoke': '#6a6a6a',
    'skin': '#f0c8a0', 'hair': '#5a3b24', 'cloth': '#ffffff', 'trousers': '#5b4a3c', 'boots': '#3a2f28',
    'donkey': '#8f8578', 'donkey_dark': '#6a6258', 'deer': '#a8703f', 'deer_light': '#d8b58a',
    'pig': '#f0a8a8', 'cream': '#f4ecd8', 'red': '#c0392b', 'white': '#f2f2f2', 'black': '#222222',
    'bread': '#c98a3d', 'fish': '#8fb3cc', 'meat': '#b5483c', 'flour': '#f5f1e6', 'beer': '#d9a441',
}


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def color(name):
    """Kolor z palety (albo hex) jako liniowe RGBA."""
    h = PALETTE.get(name, name).lstrip('#')
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    return (srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b), 1.0)


# ---------- Scena ----------

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


class Model:
    """Buduje model z czesci; kazda czesc to osobny bmesh z jednolitym kolorem."""

    def __init__(self, name):
        self.name = name
        self.parts = []

    def _add(self, bm, col, jitter=0.04):
        me = bpy.data.meshes.new(f'{self.name}_part{len(self.parts)}')
        bm.to_mesh(me)
        bm.free()
        attr = me.color_attributes.new(name='Col', type='FLOAT_COLOR', domain='CORNER')
        base = color(col)
        for poly in me.polygons:
            # Lekka zmiana jasnosci sciany (deterministyczna) - ozywia low-poly.
            k = 1.0 + ((poly.index * 2654435761) % 1000 / 1000 - 0.5) * jitter
            c = (min(1, base[0] * k), min(1, base[1] * k), min(1, base[2] * k), 1.0)
            for li in poly.loop_indices:
                attr.data[li].color = c
        ob = bpy.data.objects.new(me.name, me)
        bpy.context.scene.collection.objects.link(ob)
        self.parts.append(ob)
        return ob

    @staticmethod
    def _xf(bm, x, y, z, rz=0.0, rx=0.0, ry=0.0):
        m = Matrix.Translation((x, y, z)) @ Matrix.Rotation(rz, 4, 'Z') @ Matrix.Rotation(ry, 4, 'Y') @ Matrix.Rotation(rx, 4, 'X')
        bmesh.ops.transform(bm, matrix=m, verts=bm.verts)

    def box(self, w, d, h, x=0.0, y=0.0, z=0.0, col='wall', rz=0.0, rx=0.0, ry=0.0, jitter=0.04):
        """Prostopadloscian w x d x h, podstawa na z."""
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=(w, d, h), verts=bm.verts)
        bmesh.ops.translate(bm, vec=(0, 0, h / 2), verts=bm.verts)
        self._xf(bm, x, y, z, rz, rx, ry)
        return self._add(bm, col, jitter)

    def cyl(self, r, h, seg=6, x=0.0, y=0.0, z=0.0, col='wood', r_top=None, rz=0.0, rx=0.0, ry=0.0, jitter=0.04):
        """Walec/stozek sciety (r_top) o podstawie na z."""
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r, radius2=r if r_top is None else r_top, depth=h)
        bmesh.ops.translate(bm, vec=(0, 0, h / 2), verts=bm.verts)
        self._xf(bm, x, y, z, rz, rx, ry)
        return self._add(bm, col, jitter)

    def cone(self, r, h, seg=6, x=0.0, y=0.0, z=0.0, col='roof_red', rz=0.0, rx=0.0, ry=0.0):
        return self.cyl(r, h, seg, x, y, z, col, r_top=0.0, rz=rz, rx=rx, ry=ry)

    def ico(self, r, x=0.0, y=0.0, z=0.0, col='leaf', sub=1, sx=1.0, sy=1.0, sz=1.0):
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=r)
        bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=bm.verts)
        self._xf(bm, x, y, z)
        return self._add(bm, col)

    def gable(self, w, d, h, x=0.0, y=0.0, z=0.0, col='roof_red', rz=0.0, overhang=0.06):
        """Dach dwuspadowy: kalenica wzdluz osi X, szerokosc w (X), glebokosc d (Y), wysokosc h."""
        bm = bmesh.new()
        hw, hd = w / 2 + overhang, d / 2 + overhang
        v = [bm.verts.new(p) for p in [(-hw, -hd, 0), (hw, -hd, 0), (hw, hd, 0), (-hw, hd, 0), (-hw, 0, h), (hw, 0, h)]]
        for f in [(0, 1, 5, 4), (2, 3, 4, 5), (0, 4, 3), (1, 2, 5), (0, 3, 2, 1)]:
            bm.faces.new([v[i] for i in f])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        self._xf(bm, x, y, z, rz)
        return self._add(bm, col)

    def hip(self, w, d, h, x=0.0, y=0.0, z=0.0, col='roof_red', overhang=0.06):
        """Dach czterospadowy (piramida na prostokacie)."""
        bm = bmesh.new()
        hw, hd = w / 2 + overhang, d / 2 + overhang
        v = [bm.verts.new(p) for p in [(-hw, -hd, 0), (hw, -hd, 0), (hw, hd, 0), (-hw, hd, 0), (0, 0, h)]]
        for f in [(0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4), (0, 3, 2, 1)]:
            bm.faces.new([v[i] for i in f])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        self._xf(bm, x, y, z)
        return self._add(bm, col)

    def wedge(self, w, d, h, x=0.0, y=0.0, z=0.0, col='wood', rz=0.0):
        """Klin (pochylnia): wysoki na +Y."""
        bm = bmesh.new()
        hw, hd = w / 2, d / 2
        v = [bm.verts.new(p) for p in [(-hw, -hd, 0), (hw, -hd, 0), (hw, hd, 0), (-hw, hd, 0), (-hw, hd, h), (hw, hd, h)]]
        for f in [(0, 1, 5, 4), (2, 3, 4, 5), (0, 4, 3), (1, 2, 5), (0, 3, 2, 1)]:
            bm.faces.new([v[i] for i in f])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        self._xf(bm, x, y, z, rz)
        return self._add(bm, col)

    def finish(self, rotate_deg=0.0):
        """Laczy czesci w jeden obiekt, trianguluje i obraca. Zwraca obiekt."""
        bpy.ops.object.select_all(action='DESELECT')
        for p in self.parts:
            p.select_set(True)
        bpy.context.view_layer.objects.active = self.parts[0]
        if len(self.parts) > 1:
            bpy.ops.object.join()
        ob = bpy.context.view_layer.objects.active
        ob.name = self.name
        ob.data.name = self.name
        if rotate_deg:
            ob.data.transform(Matrix.Rotation(math.radians(rotate_deg), 4, 'Z'))
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        bmesh.ops.triangulate(bm, faces=bm.faces)
        bm.to_mesh(ob.data)
        bm.free()
        return ob


def tri_count(ob):
    return len(ob.data.polygons)


def export(ob, name=None):
    """Eksport pojedynczego obiektu do art/models/<nazwa>.glb."""
    name = name or ob.name
    os.makedirs(MODELS, exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    path = os.path.join(MODELS, f'{name}.glb')
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_normals=False,
        export_materials='NONE',
        export_vertex_color='ACTIVE',
        export_active_vertex_color_when_no_material=True,
    )
    return path


def render_preview(ob, name=None, size=256, icon=96):
    """Podglad PNG (i ikona) w stylu gry: kamera z gory pod katem od strony SE, przezroczyste tlo."""
    name = name or ob.name
    scene = bpy.context.scene
    try:
        scene.render.engine = 'BLENDER_WORKBENCH'
    except TypeError:
        pass
    shading = scene.display.shading
    shading.light = 'STUDIO'
    shading.color_type = 'VERTEX'
    shading.show_shadows = False
    shading.show_cavity = False
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.display_settings.display_device = 'sRGB'
    scene.view_settings.exposure = 0.7  # jasniejsze ikony
    # Kamera ortograficzna obejmujaca model.
    bb = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
    center = sum(bb, Vector()) / 8
    radius = max((v - center).length for v in bb)
    cam_data = bpy.data.cameras.new('cam')
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = radius * 1.75
    cam = bpy.data.objects.new('cam', cam_data)
    scene.collection.objects.link(cam)
    direction = Vector((0.45, -0.78, 0.62)).normalized()
    cam.location = center + direction * (radius * 6 + 2)
    cam.rotation_euler = (-direction).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam
    for folder, px in ((PREVIEWS, size), (ICONS, icon)):
        if not px:
            continue
        os.makedirs(folder, exist_ok=True)
        scene.render.resolution_x = px
        scene.render.resolution_y = px
        scene.render.resolution_percentage = 100
        scene.render.filepath = os.path.join(folder, f'{name}.png')
        bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam)


def selected_names(all_names):
    """Nazwy modeli z argumentow po '--' (brak = wszystkie)."""
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    names = [a for a in argv if not a.startswith('-')]
    return [n for n in all_names if not names or n in names]


def build(builders, icons=True):
    """Buduje wybrane modele: builders = {nazwa: funkcja(Model)->rotacja}. Wypisuje liczbe trojkatow."""
    for name in selected_names(list(builders)):
        reset()
        m = Model(name)
        rot = builders[name](m) or 0.0
        ob = m.finish(rot)
        export(ob)
        render_preview(ob, icon=96 if icons else 0)
        print(f'MODEL {name} tris={tri_count(ob)}')
