"""Create an original, textured standard biped used only to receive motion.

This donor is never a product asset and never replaces Doreumi's geometry.
Run with Blender --background --python this_file -- --out /ignored/cache/donor
"""
import argparse
import json
import math
import pathlib
import sys

import bpy
from mathutils import Vector


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', required=True)
    parser.add_argument('--pose', choices=['a', 't'], default='a')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    out = pathlib.Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    pieces = []

    def ellipsoid(name, location, scale, target=pieces):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=16, location=location)
        obj = bpy.context.object
        obj.name = name
        obj.scale = scale
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        target.append(obj)
        return obj

    def limb(name, start, end, radius_start, radius_end):
        a, b = Vector(start), Vector(end)
        bpy.ops.mesh.primitive_cone_add(vertices=24, radius1=radius_start,
                                      radius2=radius_end, depth=(b - a).length,
                                      location=(a + b) / 2)
        obj = bpy.context.object
        obj.name = name
        obj.rotation_mode = 'QUATERNION'
        obj.rotation_quaternion = (b - a).to_track_quat('Z', 'Y')
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        pieces.append(obj)
        ellipsoid(name + '_start', a, (radius_start,) * 3)
        ellipsoid(name + '_end', b, (radius_end,) * 3)

    ellipsoid('Pelvis', (0, 0, .96), (.17, .115, .15))
    ellipsoid('Waist', (0, 0, 1.12), (.135, .095, .19))
    ellipsoid('Chest', (0, 0, 1.34), (.205, .12, .22))
    limb('Neck', (0, 0, 1.48), (0, 0, 1.59), .064, .06)
    ellipsoid('Head', (0, -.008, 1.675), (.112, .111, .14))
    ellipsoid('Nose', (0, -.115, 1.68), (.025, .035, .029))
    for suffix, side in [('L', 1), ('R', -1)]:
        shoulder = (side * .188, 0, 1.435)
        elbow = (side * .483, 0, 1.435) if args.pose == 't' else (side * .405, 0, 1.235)
        wrist = (side * .763, 0, 1.435) if args.pose == 't' else (side * .565, -.01, 1.005)
        limb('UpperArm' + suffix, shoulder, elbow, .077, .056)
        limb('Forearm' + suffix, elbow, wrist, .056, .036)
        if args.pose == 't':
            ellipsoid('Palm' + suffix, (side * .818, -.009, 1.435), (.080, .034, .047))
            ellipsoid('Thumb' + suffix, (side * .813, -.020, 1.385), (.042, .030, .024))
        else:
            ellipsoid('Palm' + suffix, (side * .600, -.009, .950), (.047, .034, .080))
            ellipsoid('Thumb' + suffix, (side * .550, -.020, .954), (.024, .030, .042))
        hip = (side * .102, 0, .94)
        knee = (side * .107, -.012, .535)
        ankle = (side * .111, 0, .125)
        limb('Thigh' + suffix, hip, knee, .091, .063)
        limb('Shin' + suffix, knee, ankle, .063, .041)
        ellipsoid('Foot' + suffix, (side * .111, -.063, .067), (.065, .123, .060))

    bpy.ops.object.select_all(action='DESELECT')
    for piece in pieces:
        piece.select_set(True)
    bpy.context.view_layer.objects.active = pieces[0]
    bpy.ops.object.join()
    body = bpy.context.object
    body.name = 'OriginalMotionDonor'
    body.data.remesh_voxel_size = .011
    bpy.ops.object.voxel_remesh()
    smooth = body.modifiers.new('JoinSurface', 'SMOOTH')
    smooth.factor = .55
    smooth.iterations = 4
    bpy.ops.object.modifier_apply(modifier=smooth.name)
    bpy.ops.object.shade_smooth()
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(island_margin=.03)
    bpy.ops.object.mode_set(mode='OBJECT')

    image = bpy.data.images.new('MotionDonorBaseColor', width=64, height=64)
    image.generated_color = (.52, .63, .68, 1)
    image.filepath_raw = str(out / 'donor-base-color.png')
    image.file_format = 'PNG'
    image.save()
    image.pack()
    mat = bpy.data.materials.new('MotionDonorTextured')
    mat.use_nodes = True
    texture = mat.node_tree.nodes.new('ShaderNodeTexImage')
    texture.image = image
    shader = mat.node_tree.nodes.get('Principled BSDF')
    mat.node_tree.links.new(texture.outputs['Color'], shader.inputs['Base Color'])
    shader.inputs['Roughness'].default_value = .75
    body.data.materials.clear()
    body.data.materials.append(mat)

    eyes = []
    for side in [-1, 1]:
        ellipsoid('Eye', (side * .037, -.109, 1.708), (.011, .006, .012), eyes)
    eye_mat = bpy.data.materials.new('EyeInk')
    eye_mat.diffuse_color = (.025, .030, .035, 1)
    eye_mat.use_nodes = True
    eye_mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value = (.025, .030, .035, 1)
    for eye in eyes:
        eye.data.materials.append(eye_mat)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in [body, *eyes]:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.export_scene.gltf(filepath=str(out / 'donor.glb'), export_format='GLB',
                              use_selection=True, export_animations=False,
                              export_yup=True, export_texcoords=True)
    metadata = {'version': 1, 'purpose': 'motion_transport_only',
                'license': 'Original procedural mesh authored for this project',
                'heightMeters': 1.82, 'gltfForward': '+Z',
                'bodyFaces': len(body.data.polygons),
                'productGeometry': False}
    if args.pose == 't':
        metadata['restPose'] = 'T'
    (out / 'donor.json').write_text(json.dumps(metadata, indent=2) + '\n')

    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 16
    scene.render.resolution_x = 600
    scene.render.resolution_y = 760
    scene.render.resolution_percentage = 100
    scene.world.color = (.35, .35, .35)
    bpy.ops.object.light_add(type='AREA', location=(-3, -4, 5))
    bpy.context.object.data.energy = 500
    bpy.context.object.data.shape = 'DISK'
    bpy.context.object.data.size = 4
    bpy.ops.object.camera_add(location=(0, -5, .93))
    camera = bpy.context.object
    camera.rotation_euler = (Vector((0, 0, .93)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
    camera.data.type = 'ORTHO'
    camera.data.ortho_scale = 2.55 if args.pose == 't' else 2.15
    scene.camera = camera
    scene.render.filepath = str(out / 'donor-front.png')
    bpy.ops.render.render(write_still=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(out / 'donor.blend'))
    print(json.dumps(metadata))


if __name__ == '__main__':
    main()
