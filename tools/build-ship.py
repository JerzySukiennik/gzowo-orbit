"""Generate the ship hull.

Run headless:
    /Applications/Blender.app/Contents/MacOS/Blender --background --python tools/build-ship.py

The nose stops just ahead of the bridge windscreen instead of closing over it. Hiding the
whole hull while the camera was aboard was the cheap way to stop the pilot facing the
inside of their own ship, and it cost the player any sight of the ship they are flying.
"""

import bpy
import math
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Ship space maps to Blender as (x, -z, y): nose along +Y, up along +Z. The bridge
# windscreen sits at ship z = -58, which is Blender y = +58.
WINDSCREEN_Y = 58.0
BRIDGE_BACK_Y = 42.0  # ship z = -42: where the glazed bridge begins
LENGTH = 120.0
HULL_LENGTH = 100.0  # the glazed bridge module adds the remaining 20 m at the front
SPAN_SQUEEZE = 0.76


def reset():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for block in (bpy.data.meshes, bpy.data.materials):
        for item in list(block):
            block.remove(item)


def material(name, colour, metallic, roughness, emission=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    node = mat.node_tree.nodes['Principled BSDF']
    node.inputs['Base Color'].default_value = (*colour, 1.0)
    node.inputs['Metallic'].default_value = metallic
    node.inputs['Roughness'].default_value = roughness
    if emission:
        node.inputs['Emission Color'].default_value = (0.35, 0.7, 1.0, 1.0)
        node.inputs['Emission Strength'].default_value = emission
    return mat


def build():
    reset()
    mats = {
        'hull': material('hull', (0.62, 0.64, 0.66), 0.25, 0.48),
        'panel': material('panel', (0.16, 0.17, 0.19), 0.35, 0.55),
        'engine': material('engine', (0.34, 0.35, 0.37), 0.9, 0.32),
        'glow': material('glow', (0.35, 0.62, 1.0), 0.0, 0.35, 3.0),
        'gear': material('gear', (0.28, 0.29, 0.31), 0.75, 0.4),
    }

    def finish(obj, mat, bevel=0.0, segments=2):
        obj.data.materials.append(mats[mat])
        if bevel > 0:
            modifier = obj.modifiers.new('bevel', 'BEVEL')
            modifier.width = bevel
            modifier.segments = segments
            modifier.limit_method = 'ANGLE'
            modifier.angle_limit = math.radians(40)
        return obj

    def tube(name, radius_x, radius_z, length, y, mat, bevel=0.0, vertices=16):
        bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=1, depth=1, location=(0, y, 0))
        obj = bpy.context.object
        obj.name = name
        obj.rotation_euler = (math.radians(90), 0, 0)
        obj.scale = (radius_x, radius_z, length / 2)
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        return finish(obj, mat, bevel)

    def box(name, size, location, rotation=(0, 0, 0), mat='hull', bevel=0.6):
        bpy.ops.mesh.primitive_cube_add(size=2, location=location)
        obj = bpy.context.object
        obj.name = name
        obj.scale = size
        obj.rotation_euler = rotation
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        return finish(obj, mat, bevel)

    # Wide enough to contain the rooms. The cargo hold is 23 m across in the layout the
    # collision uses, and a 12 m hull meant every room poked out through the skin.
    tube('hull_body', 17.5, 8.6, 92.0, -4.0, 'hull', 1.6)

    # The hull stops where the BRIDGE begins. The bridge is a glazed nose module built by
    # the interior script, so from the seat you see its frame and the world beyond, and
    # from outside the ship has a glass face. Anything further forward here ends up
    # 40 cm in front of the pilot's eyes, which is how the first attempt failed.
    bpy.ops.mesh.primitive_cone_add(vertices=16, radius1=1, radius2=0.86, depth=1, location=(0, 36.0, 0))
    nose = bpy.context.object
    nose.name = 'hull_nose'
    nose.rotation_euler = (math.radians(-90), 0, 0)
    nose.scale = (17.5, 8.6, 6.0)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    finish(nose, 'hull', 0.8)

    # A collar around the aperture, so the open end reads as a frame rather than a cut.
    bpy.ops.mesh.primitive_torus_add(location=(0, 41.0, 0), major_radius=1, minor_radius=0.07, major_segments=24, minor_segments=8)
    collar = bpy.context.object
    collar.name = 'nose_collar'
    collar.rotation_euler = (math.radians(90), 0, 0)
    collar.scale = (16.4, 8.2, 16.4)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    finish(collar, 'panel')

    tube('hull_tail', 15.4, 7.6, 16.0, -52.0, 'panel', 0.8)

    for side in (-1, 1):
        box(f'wing_{side}', (26.0, 17.0, 1.1), (side * 30.0, -12.0, -1.5),
            (0, math.radians(side * 4.0), math.radians(-side * 22.0)), 'hull', 0.8)
        box(f'wingtip_{side}', (1.4, 9.0, 2.6), (side * 52.0, -22.0, 1.0),
            (0, 0, math.radians(-side * 22.0)), 'panel', 0.5)
        box(f'stab_{side}', (1.1, 11.0, 9.0), (side * 9.5, -44.0, 9.0),
            (math.radians(side * 26.0), 0, 0), 'panel', 0.5)

    for i, (x, y, z) in enumerate([(-13.5, -34.0, -5.5), (13.5, -34.0, -5.5), (-34.0, -22.0, -4.0), (34.0, -22.0, -4.0)]):
        bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=4.6, depth=22.0, location=(x, y, z))
        nacelle = bpy.context.object
        nacelle.name = f'nacelle_{i}'
        nacelle.rotation_euler = (math.radians(90), 0, 0)
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        finish(nacelle, 'engine', 0.5)

        bpy.ops.mesh.primitive_cone_add(vertices=16, radius1=4.0, radius2=6.2, depth=7.0, location=(x, y - 14.0, z))
        bell = bpy.context.object
        bell.name = f'bell_{i}'
        bell.rotation_euler = (math.radians(90), 0, 0)
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        finish(bell, 'engine', 0.3)

        bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=3.4, depth=0.8, location=(x, y - 17.0, z))
        throat = bpy.context.object
        throat.name = f'throat_{i}'
        throat.rotation_euler = (math.radians(90), 0, 0)
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        finish(throat, 'glow')

    for i, (x, y) in enumerate([(0.0, 34.0), (-22.0, -26.0), (22.0, -26.0)]):
        bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=1.5, depth=13.0, location=(x, y, -10.5))
        finish(bpy.context.object, 'gear', 0.2)
        bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=4.2, depth=1.4, location=(x, y, -16.6))
        finish(bpy.context.object, 'gear', 0.3)
        box(f'brace_{i}', (0.7, 0.7, 6.0), (x * 0.82 + 1.2, y, -8.0), (0, math.radians(22), 0), 'gear', 0.2)

    bpy.ops.object.select_all(action='SELECT')
    bpy.context.view_layer.objects.active = bpy.context.selected_objects[0]
    bpy.ops.object.join()
    ship = bpy.context.object
    ship.name = 'gzowo_ranger'
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode='OBJECT')

    # No uniform rescale. The hull is built at true size and the glazed bridge module
    # adds the rest of the 120 m at the front; scaling the hull to 120 on its own pushed
    # the nose straight back over the pilot every time.
    ship.scale = (SPAN_SQUEEZE, 1.0, 1.0)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bpy.context.scene.cursor.location = (0.0, 0.0, 0.0)
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
    return ship


def main():
    ship = build()
    ys = [v.co.y for v in ship.data.vertices]
    d = ship.dimensions
    print(f'SHIP width {d.x:.1f}  length {d.y:.1f}  height {d.z:.1f}  nose reaches {max(ys):.1f}')
    assert max(ys) < BRIDGE_BACK_Y + 1.5, f'hull reaches {max(ys):.1f}, into the bridge at {BRIDGE_BACK_Y}'
    assert abs((max(ys) - min(ys)) - HULL_LENGTH) < 2.0, f'hull is {max(ys) - min(ys):.1f} m, expected {HULL_LENGTH}'

    out = os.path.join(ROOT, 'assets', 'ship.glb')
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_apply=True, export_yup=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, 'tools', 'ship.blend'))
    print(f'TRIANGLES {sum(len(p.vertices) - 2 for p in ship.data.polygons)}  BYTES {os.path.getsize(out)}')


main()
