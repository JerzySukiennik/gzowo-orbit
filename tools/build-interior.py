"""Generate the ship interior from the same room layout the collision uses.

Run headless:
    /Applications/Blender.app/Contents/MacOS/Blender --background --python tools/build-interior.py

Keep this in step with src/ship/deck.js. The layout is the contract; if a room moves
there, it has to move here, and the walk test will say so before anyone sees it.
"""

import bpy
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

DECK = dict(floor=0.0, ceiling=3.3, upperFloor=4.6, upperCeiling=7.4, wall=0.35, doorWidth=2.2, doorHeight=2.5)

ROOMS = [
    dict(id='bridge', x=(-8.6, 8.6), z=(-58, -42), level=0),
    dict(id='forward', x=(-2.4, 2.4), z=(-42, -26), level=0),
    dict(id='medbay', x=(-10.5, -2.4), z=(-26, -14), level=0),
    dict(id='mess', x=(2.4, 10.5), z=(-26, -14), level=0),
    dict(id='spine', x=(-2.4, 2.4), z=(-26, 4), level=0),
    dict(id='airlock', x=(2.4, 9.0), z=(-6, 0), level=0),
    dict(id='hold', x=(-11.5, 11.5), z=(4, 24), level=0, ceiling=5.6),
    dict(id='engineering', x=(-8.6, 8.6), z=(24, 38), level=0),
    dict(id='observation', x=(-5.5, 5.5), z=(-20, -6), level=1),
]

DOORS = [
    ('bridge', 'forward', 0), ('forward', 'medbay', -20), ('forward', 'mess', -20),
    ('forward', 'spine', 0), ('spine', 'airlock', -3), ('spine', 'hold', 0),
    ('hold', 'engineering', 0),
]

SEATS = [(0, -52, 0.0), (-4.2, -48, 0.28), (4.2, -48, -0.28), (0, -44.5, math.pi)]

by_id = {r['id']: r for r in ROOMS}
for room in ROOMS:
    room['y0'] = DECK['upperFloor'] if room['level'] == 1 else DECK['floor']
    room['y1'] = DECK['upperCeiling'] if room['level'] == 1 else room.get('ceiling', DECK['ceiling'])


def reset():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for block in (bpy.data.meshes, bpy.data.materials):
        for item in list(block):
            block.remove(item)


def material(name, colour, metallic, roughness, emission=0.0, alpha=1.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    node = mat.node_tree.nodes['Principled BSDF']
    node.inputs['Base Color'].default_value = (*colour, 1.0)
    node.inputs['Metallic'].default_value = metallic
    node.inputs['Roughness'].default_value = roughness
    node.inputs['Alpha'].default_value = alpha
    if emission:
        node.inputs['Emission Color'].default_value = (*colour, 1.0)
        node.inputs['Emission Strength'].default_value = emission
    if alpha < 1.0:
        mat.blend_method = 'BLEND'
    return mat


def build():
    reset()
    mats = {
        'deck': material('deck', (0.22, 0.23, 0.25), 0.2, 0.75),
        'wall': material('wall', (0.52, 0.54, 0.56), 0.15, 0.6),
        'trim': material('trim', (0.14, 0.15, 0.17), 0.45, 0.45),
        'strip': material('strip', (0.55, 0.78, 1.0), 0.0, 0.4, 6.0),
        'seat': material('seat', (0.18, 0.16, 0.15), 0.05, 0.7),
        'window': material('window', (0.05, 0.08, 0.11), 0.1, 0.05, 0.0, 0.1),
    }

    def slab(x0, x1, y0, y1, z0, z1, mat):
        if x1 - x0 <= 1e-4 or y1 - y0 <= 1e-4 or z1 - z0 <= 1e-4:
            return None
        bpy.ops.mesh.primitive_cube_add(size=2, location=((x0 + x1) / 2, (z0 + z1) / 2, (y0 + y1) / 2))
        obj = bpy.context.object
        obj.scale = ((x1 - x0) / 2, (z1 - z0) / 2, (y1 - y0) / 2)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        obj.data.materials.append(mats[mat])
        return obj

    def wall_with_openings(fixed, span0, span1, y0, y1, axis, openings, thickness, mat='wall'):
        cuts = sorted((c - DECK['doorWidth'] / 2, c + DECK['doorWidth'] / 2) for c in openings)
        cursor = span0
        for a, b in cuts:
            a, b = max(span0, a), min(span1, b)
            if b <= a:
                continue
            if axis == 'x':
                slab(cursor, a, y0, y1, fixed - thickness / 2, fixed + thickness / 2, mat)
                slab(a, b, y0 + DECK['doorHeight'], y1, fixed - thickness / 2, fixed + thickness / 2, mat)
            else:
                slab(fixed - thickness / 2, fixed + thickness / 2, y0, y1, cursor, a, mat)
                slab(fixed - thickness / 2, fixed + thickness / 2, y0 + DECK['doorHeight'], y1, a, b, mat)
            cursor = b
        if axis == 'x':
            slab(cursor, span1, y0, y1, fixed - thickness / 2, fixed + thickness / 2, mat)
        else:
            slab(fixed - thickness / 2, fixed + thickness / 2, y0, y1, cursor, span1, mat)

    def openings_on(room, side):
        out = []
        for a, b, at in DOORS:
            if room['id'] not in (a, b):
                continue
            other = by_id[b if a == room['id'] else a]
            if side == 'front' and abs(room['z'][0] - other['z'][1]) < 0.01:
                out.append(at)
            if side == 'back' and abs(room['z'][1] - other['z'][0]) < 0.01:
                out.append(at)
            if side == 'left' and abs(room['x'][0] - other['x'][1]) < 0.01:
                out.append(at)
            if side == 'right' and abs(room['x'][1] - other['x'][0]) < 0.01:
                out.append(at)
        return out

    t = DECK['wall']
    for room in ROOMS:
        x0, x1 = room['x']
        z0, z1 = room['z']
        y0, y1 = room['y0'], room['y1']
        slab(x0 - t, x1 + t, y0 - 0.22, y0, z0 - t, z1 + t, 'deck')
        slab(x0 - t, x1 + t, y1, y1 + 0.18, z0 - t, z1 + t, 'trim')
        if room['id'] != 'bridge':
            wall_with_openings(z0, x0, x1, y0, y1, 'x', openings_on(room, 'front'), t)
        wall_with_openings(z1, x0, x1, y0, y1, 'x', openings_on(room, 'back'), t)
        wall_with_openings(x0, z0, z1, y0, y1, 'z', openings_on(room, 'left'), t)
        wall_with_openings(x1, z0, z1, y0, y1, 'z', openings_on(room, 'right'), t)
        slab((x0 + x1) / 2 - 0.35, (x0 + x1) / 2 + 0.35, y1 - 0.09, y1 - 0.02, z0 + 0.6, z1 - 0.6, 'strip')

    # Bridge windscreen: sill, header, mullions, glass. The pilot has to see out or none
    # of the flying means anything.
    slab(-8.6, 8.6, 0.0, 0.75, -58.175, -57.825, 'wall')
    slab(-8.6, 8.6, 2.95, 3.3, -58.175, -57.825, 'wall')
    for x in (-8.2, -4.2, 0.0, 4.2, 8.2):
        slab(x - 0.12, x + 0.12, 0.75, 2.95, -58.175, -57.825, 'trim')
    slab(-8.0, 8.0, 0.75, 2.95, -58.06, -57.94, 'window')
    slab(10.4, 10.6, 1.0, 2.6, -24.0, -16.0, 'window')
    slab(-5.4, -5.2, 4.9, 6.9, -18.0, -8.0, 'window')

    for x, z, facing in SEATS:
        for obj in (
            slab(x - 0.45, x + 0.45, 0.0, 0.46, z - 0.45, z + 0.45, 'trim'),
            slab(x - 0.55, x + 0.55, 0.46, 0.58, z - 0.6, z + 0.6, 'seat'),
            slab(x - 0.55, x + 0.55, 0.58, 1.5, z + 0.42, z + 0.6, 'seat'),
        ):
            obj.rotation_euler = (0, 0, facing)
        slab(x - 0.7, x + 0.7, 0.75, 1.05, z - 1.5, z - 1.15, 'trim')
        slab(x - 0.62, x + 0.62, 1.02, 1.06, z - 1.48, z - 1.18, 'strip')

    slab(-2.1, -1.95, 0.0, 4.6, -13.5, -9.5, 'trim')
    slab(1.95, 2.1, 0.0, 4.6, -13.5, -9.5, 'trim')
    slab(-2.0, 2.0, -0.12, 0.0, -13.5, -9.5, 'seat')
    ramp = slab(-5.0, 5.0, -0.2, 0.0, 24.0, 33.0, 'deck')
    ramp.rotation_euler = (math.radians(-16), 0, 0)

    bpy.ops.object.select_all(action='SELECT')
    bpy.context.view_layer.objects.active = bpy.context.selected_objects[0]
    bpy.ops.object.join()
    interior = bpy.context.object
    interior.name = 'gzowo_interior'
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode='OBJECT')

    # A join adopts the first object's origin. Zeroing the location afterwards drags the
    # whole deck away from the coordinates the collision uses - 50 m, in the first
    # attempt, which walked fine and rendered a wall in front of the pilot. Put the origin
    # on the world cursor instead, so exported vertices are true ship coordinates.
    bpy.context.scene.cursor.location = (0.0, 0.0, 0.0)
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
    return interior


def main():
    interior = build()
    xs = [v.co.x for v in interior.data.vertices]
    ys = [v.co.y for v in interior.data.vertices]
    zs = [v.co.z for v in interior.data.vertices]
    print(f'INTERIOR x {min(xs):.1f}..{max(xs):.1f}  shipZ {min(ys):.1f}..{max(ys):.1f}  shipY {min(zs):.1f}..{max(zs):.1f}')
    assert min(ys) < -57 and max(ys) > 37, 'interior is not in ship coordinates'

    out = os.path.join(ROOT, 'assets', 'interior.glb')
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_apply=True, export_yup=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, 'tools', 'interior.blend'))
    print(f'TRIANGLES {sum(len(p.vertices) - 2 for p in interior.data.polygons)}  BYTES {os.path.getsize(out)}')


main()
