import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "models"
BLEND = ROOT / "assets" / "blender"
PALETTE = {
    "lime": (0.58, 0.95, 0.12, 1),
    "plum": (0.19, 0.055, 0.25, 1),
    "purple": (0.36, 0.12, 0.43, 1),
    "aluminum": (0.62, 0.69, 0.72, 1),
    "dark": (0.055, 0.065, 0.075, 1),
    "orange": (1.0, 0.28, 0.045, 1),
    "glass": (0.12, 0.65, 0.72, 1),
    "cream": (0.86, 0.88, 0.69, 1),
    "copper": (0.52, 0.24, 0.11, 1),
    "wood": (0.26, 0.13, 0.17, 1),
    "leaf": (0.18, 0.48, 0.21, 1)
}


def material(name, color, metallic=0.0, roughness=0.55, emission=0.0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = color
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if emission:
        bsdf.inputs["Emission Color"].default_value = color
        bsdf.inputs["Emission Strength"].default_value = emission
    return mat


def reset():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in list(bpy.data.collections):
        if collection.name != "Collection":
            bpy.data.collections.remove(collection)


def collection(name):
    coll = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(coll)
    return coll


def move_to(obj, coll):
    for current in list(obj.users_collection):
        current.objects.unlink(obj)
    coll.objects.link(obj)
    return obj


def finish(obj, name, mat, coll):
    obj.name = name
    if mat:
        obj.data.materials.append(mat)
    move_to(obj, coll)
    return obj


def cube(name, loc, scale, mat, coll, bevel=0.04, rot=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    obj = bpy.context.object
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if rot:
        obj.rotation_euler = rot
    if bevel:
        mod = obj.modifiers.new("Soft handmade edges", "BEVEL")
        mod.width = bevel
        mod.segments = 2
        obj.modifiers.new("Weighted corner normals", "WEIGHTED_NORMAL")
    return finish(obj, name, mat, coll)


def sphere(name, loc, scale, mat, coll, segments=16, rings=8):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, radius=1, location=loc)
    obj = bpy.context.object
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    for poly in obj.data.polygons:
        poly.use_smooth = True
    return finish(obj, name, mat, coll)


def cylinder(name, loc, radius, depth, mat, coll, vertices=16, rot=None, bevel=0.02):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=loc)
    obj = bpy.context.object
    if rot:
        obj.rotation_euler = rot
    if bevel:
        mod = obj.modifiers.new("Worn rim", "BEVEL")
        mod.width = bevel
        mod.segments = 2
        obj.modifiers.new("Weighted normals", "WEIGHTED_NORMAL")
    return finish(obj, name, mat, coll)


def rod(name, a, b, radius, mat, coll, vertices=12):
    a, b = Vector(a), Vector(b)
    obj = cylinder(name, (a + b) / 2, radius, (b - a).length, mat, coll, vertices, bevel=0)
    obj.rotation_euler = (b - a).to_track_quat("Z", "Y").to_euler()
    return obj


def torus(name, loc, major, minor, mat, coll, rot=None):
    bpy.ops.mesh.primitive_torus_add(major_segments=20, minor_segments=8, location=loc, major_radius=major, minor_radius=minor)
    obj = bpy.context.object
    if rot:
        obj.rotation_euler = rot
    return finish(obj, name, mat, coll)


def spring(name, loc, radius, length, turns, mat, coll):
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 1
    curve.bevel_depth = 0.018
    curve.bevel_resolution = 1
    spline = curve.splines.new("POLY")
    count = turns * 12 + 1
    spline.points.add(count - 1)
    for i, point in enumerate(spline.points):
        angle = i / 12 * math.tau
        point.co = (loc[0] + radius * math.cos(angle), loc[1] + radius * math.sin(angle), loc[2] + length * i / (count - 1), 1)
    obj = bpy.data.objects.new(name, curve)
    coll.objects.link(obj)
    obj.data.materials.append(mat)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    obj.select_set(False)
    return obj


def eye(loc, radius, mats, coll, name="Optical eye"):
    cylinder(name + " rim", loc, radius, 0.09, mats["dark"], coll, rot=(math.pi / 2, 0, 0))
    cylinder(name + " lens", (loc[0], loc[1] - 0.055, loc[2]), radius * 0.72, 0.035, mats["glass"], coll, rot=(math.pi / 2, 0, 0))
    sphere(name + " glint", (loc[0] - radius * 0.2, loc[1] - 0.08, loc[2] + radius * 0.22), (radius * 0.16,) * 3, mats["cream"], coll, 8, 4)


def socket(name, loc, mats, coll, rot=None):
    torus(name, loc, 0.105, 0.027, mats["lime"], coll, rot)
    cylinder(name + " bolt", loc, 0.047, 0.06, mats["orange"], coll, 12, rot, 0)


def antenna(loc, mats, coll, height=0.4):
    spring("Vibrating antenna spring", loc, 0.035, height, 4, mats["aluminum"], coll)
    sphere("Antenna tip", (loc[0], loc[1], loc[2] + height), (0.075, 0.075, 0.075), mats["orange"], coll)


def base_body(mats, coll, heavy=False):
    if heavy:
        cube("Broad salvaged torso", (0, 0, 0.72), (1.05, 0.68, 0.72), mats["plum"], coll, 0.11)
        cube("Aluminium breastplate", (0, -0.36, 0.75), (0.78, 0.08, 0.42), mats["aluminum"], coll, 0.05)
        cube("Orange workshop stripe", (0, -0.408, 0.65), (0.72, 0.02, 0.08), mats["orange"], coll, 0.01)
        eye((-0.22, -0.43, 0.92), 0.14, mats, coll)
        eye((0.22, -0.43, 0.92), 0.14, mats, coll)
        for side in (-1, 1):
            cylinder("Heavy rubber wheel", (side * 0.49, 0.02, 0.31), 0.28, 0.2, mats["dark"], coll, rot=(0, math.pi / 2, 0))
            cylinder("Wheel hub", (side * 0.60, 0.02, 0.31), 0.13, 0.025, mats["lime"], coll, rot=(0, math.pi / 2, 0))
            rod("Hydraulic shoulder", (side * 0.48, 0, 0.82), (side * 0.72, 0, 0.65), 0.09, mats["aluminum"], coll)
        antenna((0.3, 0.12, 1.13), mats, coll, 0.28)
    else:
        cube("Light tea-tin torso", (0, 0, 0.64), (0.68, 0.55, 0.62), mats["purple"], coll, 0.12)
        cube("Crooked metal face", (0, -0.30, 0.71), (0.54, 0.06, 0.32), mats["aluminum"], coll, 0.07, (0, 0, -0.04))
        eye((0, -0.35, 0.77), 0.18, mats, coll, "Single curious eye")
        for side in (-1, 1):
            cylinder("Small wheel", (side * 0.33, 0, 0.24), 0.22, 0.15, mats["dark"], coll, rot=(0, math.pi / 2, 0))
            cylinder("Orange hub", (side * 0.42, 0, 0.24), 0.09, 0.02, mats["orange"], coll, rot=(0, math.pi / 2, 0))
            rod("Wire arm", (side * 0.3, 0, 0.69), (side * 0.52, -0.02, 0.52), 0.045, mats["aluminum"], coll)
        antenna((-0.18, 0.05, 0.98), mats, coll, 0.36)
    for x, y, z, rotation in [(-0.57, -0.03, 0.73, (0, math.pi / 2, 0)), (0.57, -0.03, 0.73, (0, math.pi / 2, 0)), (0, 0, 1.12, None), (0, 0.36, 0.72, (math.pi / 2, 0, 0))]:
        socket("Standard luminous mount", (x, y, z), mats, coll, rotation)


def make_chassis(mats):
    reset()
    for name, heavy in [("chassis-light", False), ("chassis-heavy", True)]:
        coll = collection(name)
        base_body(mats, coll, heavy)
        export(coll, name)
    coll = collection("chassis-spider")
    sphere("Spider kettle body", (0, 0, 0.62), (0.5, 0.43, 0.38), mats["plum"], coll)
    cube("Spider face plate", (0, -0.35, 0.69), (0.55, 0.08, 0.3), mats["aluminum"], coll, 0.08)
    eye((-0.15, -0.41, 0.73), 0.11, mats, coll)
    eye((0.15, -0.41, 0.73), 0.11, mats, coll)
    for side in (-1, 1):
        for row in (-1, 0, 1):
            hip = (side * 0.35, row * 0.23, 0.58)
            knee = (side * 0.72, row * 0.31, 0.43)
            foot = (side * 0.84, row * 0.38, 0.08)
            rod("Spider upper leg", hip, knee, 0.045, mats["aluminum"], coll)
            rod("Spider lower leg", knee, foot, 0.035, mats["dark"], coll)
            sphere("Orange leg joint", knee, (0.075,) * 3, mats["orange"], coll, 12, 6)
    antenna((0, 0.1, 0.95), mats, coll, 0.28)
    for x, y, z, rotation in [(-0.48, -0.03, 0.67, (0, math.pi / 2, 0)), (0.48, -0.03, 0.67, (0, math.pi / 2, 0)), (0, 0, 1.0, None), (0, 0.34, 0.67, (math.pi / 2, 0, 0))]:
        socket("Spider standard mount", (x, y, z), mats, coll, rotation)
    export(coll, "chassis-spider")
    for name in ["variant-wheel", "variant-leg", "variant-antenna"]:
        coll = collection(name)
        if name.endswith("wheel"):
            cylinder("Spare rubber wheel", (0, 0, 0), 0.26, 0.16, mats["dark"], coll, rot=(0, math.pi / 2, 0))
            torus("Spare lime hub", (0.1, 0, 0), 0.13, 0.03, mats["lime"], coll, (0, math.pi / 2, 0))
        elif name.endswith("leg"):
            rod("Spare leg A", (-0.3, 0, 0.4), (0, 0, 0.2), 0.055, mats["aluminum"], coll)
            rod("Spare leg B", (0, 0, 0.2), (0.3, 0, 0), 0.04, mats["dark"], coll)
        else:
            antenna((0, 0, 0), mats, coll, 0.55)
        export(coll, name)
    save_source("chassis.blend")


def module_shell(coll, mats, width=0.34):
    cube("Universal connector", (0, 0.07, 0), (width, 0.22, 0.25), mats["dark"], coll, 0.04)
    torus("Standard attachment ring", (0, 0.19, 0), 0.105, 0.025, mats["lime"], coll, (math.pi / 2, 0, 0))


def make_modules(mats):
    reset()
    for name in ["blade", "hammer", "blaster", "mortar", "shield", "repair", "boost", "battery", "armor", "sensor"]:
        coll = collection("module-" + name)
        module_shell(coll, mats)
        if name == "blade":
            cube("Salvaged blade", (0, -0.46, 0), (0.12, 0.8, 0.09), mats["aluminum"], coll, 0.025)
            cube("Blade orange tang", (0, -0.18, 0), (0.22, 0.12, 0.16), mats["orange"], coll)
            for i in range(4):
                cube("Saw tooth", (0.08, -0.35 - i * 0.14, 0), (0.09, 0.07, 0.09), mats["aluminum"], coll, 0.01, (0, 0, 0.4))
        elif name == "hammer":
            rod("Hammer handle", (0, -0.05, 0), (0, -0.68, 0), 0.055, mats["copper"], coll)
            cube("Mallet head", (0, -0.72, 0), (0.58, 0.27, 0.34), mats["aluminum"], coll, 0.06)
            cube("Hammer warning stripe", (0, -0.865, 0), (0.18, 0.02, 0.3), mats["orange"], coll, 0.01)
        elif name == "blaster":
            cylinder("Scrap rivet barrel", (0, -0.36, 0), 0.13, 0.7, mats["purple"], coll, rot=(math.pi / 2, 0, 0))
            torus("Muzzle ring", (0, -0.73, 0), 0.14, 0.035, mats["orange"], coll, (math.pi / 2, 0, 0))
            cylinder("Dark muzzle", (0, -0.75, 0), 0.085, 0.04, mats["dark"], coll, rot=(math.pi / 2, 0, 0))
            spring("Barrel recoil spring", (0.18, -0.12, 0), 0.04, 0.38, 5, mats["aluminum"], coll)
        elif name == "mortar":
            cylinder("Wide mortar tube", (0, -0.28, 0.12), 0.23, 0.56, mats["plum"], coll, rot=(math.pi / 2 - 0.35, 0, 0))
            torus("Mortar lip", (0, -0.56, 0.22), 0.24, 0.04, mats["orange"], coll, (math.pi / 2 - 0.35, 0, 0))
            sphere("Visible shell", (0, -0.43, 0.18), (0.12,) * 3, mats["lime"], coll)
        elif name == "shield":
            sphere("Umbrella shield", (0, -0.3, 0), (0.46, 0.11, 0.52), mats["purple"], coll)
            cube("Shield metal spine", (0, -0.42, 0), (0.09, 0.04, 0.78), mats["aluminum"], coll)
            sphere("Shield lime boss", (0, -0.44, 0), (0.13, 0.055, 0.13), mats["lime"], coll)
        elif name == "repair":
            cylinder("Repair oil tank", (0, -0.18, 0.17), 0.16, 0.46, mats["orange"], coll)
            rod("Repair arm", (0, -0.25, 0), (0, -0.62, 0.18), 0.05, mats["aluminum"], coll)
            torus("Repair wrench jaw", (0, -0.67, 0.23), 0.15, 0.045, mats["lime"], coll, (math.pi / 2, 0, 0))
            cube("Repair cross horizontal", (0, -0.35, 0.18), (0.3, 0.04, 0.08), mats["cream"], coll, 0.01)
            cube("Repair cross vertical", (0, -0.35, 0.18), (0.08, 0.04, 0.3), mats["cream"], coll, 0.01)
        elif name == "boost":
            for side in (-1, 1):
                cylinder("Boost canister", (side * 0.19, -0.2, 0), 0.13, 0.48, mats["purple"], coll, rot=(math.pi / 2, 0, 0))
                torus("Boost nozzle", (side * 0.19, -0.46, 0), 0.13, 0.035, mats["orange"], coll, (math.pi / 2, 0, 0))
            spring("Boost exposed spring", (0, -0.2, 0.18), 0.05, 0.38, 5, mats["aluminum"], coll)
        elif name == "battery":
            for side in (-1, 0, 1):
                cylinder("Battery cell", (side * 0.16, -0.16, 0.08), 0.09, 0.48, mats["lime"], coll)
                cylinder("Battery contact", (side * 0.16, -0.16, 0.34), 0.045, 0.05, mats["aluminum"], coll)
            cube("Battery strap", (0, -0.27, 0.08), (0.54, 0.07, 0.12), mats["plum"], coll, 0.02)
        elif name == "armor":
            for side in (-1, 0, 1):
                cube("Overlapping armor plate", (side * 0.18, -0.22 - abs(side) * 0.04, 0.05), (0.25, 0.09, 0.52), mats["aluminum"], coll, 0.045, (0, 0, side * 0.14))
                sphere("Armor rivet", (side * 0.18, -0.29 - abs(side) * 0.04, 0.2), (0.035,) * 3, mats["orange"], coll, 8, 4)
        elif name == "sensor":
            rod("Sensor stalk", (0, 0, 0), (0, -0.08, 0.36), 0.045, mats["aluminum"], coll)
            sphere("Sensor radar bowl", (0, -0.13, 0.4), (0.29, 0.1, 0.24), mats["plum"], coll)
            eye((0, -0.24, 0.42), 0.13, mats, coll, "Targeting lens")
            for side in (-1, 1):
                rod("Sensor rabbit ear", (side * 0.12, -0.08, 0.5), (side * 0.24, -0.08, 0.76), 0.018, mats["orange"], coll)
        export(coll, "module-" + name)
    save_source("modules.blend")


def bolt_detail(loc, mats, coll, scale=1):
    cylinder("Loose bolt", loc, 0.07 * scale, 0.15 * scale, mats["aluminum"], coll, 6)
    torus("Loose washer", (loc[0], loc[1], loc[2] - 0.07 * scale), 0.1 * scale, 0.025 * scale, mats["dark"], coll)


def arena_base(coll, mats, color="plum"):
    cube("Arena slab", (0, 0, -0.18), (13.6, 10.6, 0.35), mats[color], coll, 0.14)
    for side in (-1, 1):
        cube("Orange safety edge", (0, side * 5.13, 0.015), (12.9, 0.1, 0.04), mats["orange"], coll, 0.01)
        cube("Aluminium edge", (side * 6.63, 0, 0.02), (0.1, 10.0, 0.08), mats["aluminum"], coll, 0.01)


def make_environments(mats):
    reset()
    coll = collection("workshop")
    cube("Workshop tabletop", (0, 0, -0.28), (14, 11, 0.5), mats["wood"], coll, 0.12)
    cube("Back pegboard", (0, 4.7, 2.0), (13, 0.25, 4.2), mats["plum"], coll, 0.08)
    for x in range(-5, 6):
        for z in range(1, 4):
            sphere("Pegboard hole", (x, 4.55, z), (0.035, 0.02, 0.035), mats["dark"], coll, 8, 4)
    for x in (-4.5, -2.8, 3.7):
        cube("Shelf", (x, 4.1, 2.0), (1.3, 1.0, 0.12), mats["aluminum"], coll)
        cylinder("Paint tin", (x, 4.0, 2.42), 0.35, 0.75, mats["lime"] if x < 0 else mats["orange"], coll)
    rod("Hanging wrench", (-1, 4.45, 2.7), (-1, 4.45, 1.6), 0.06, mats["aluminum"], coll)
    torus("Wrench jaw", (-1, 4.45, 2.8), 0.18, 0.045, mats["aluminum"], coll, (math.pi / 2, 0, 0))
    for x in (-4.5, 4.5):
        bolt_detail((x, -3.5, 0.12), mats, coll, 2)
    export(coll, "workshop")
    save_source("workshop.blend")
    reset()
    for kit in ["workbench", "rooftop", "greenhouse"]:
        coll = collection("arena-" + kit)
        arena_base(coll, mats, "wood" if kit == "workbench" else "plum")
        if kit == "workbench":
            cube("Giant ruler", (-5.8, 0, 0.09), (0.38, 8.4, 0.08), mats["aluminum"], coll, 0.02)
            for i in range(15):
                cube("Ruler tick", (-5.55, -3.8 + i * 0.55, 0.15), (0.16 if i % 2 else 0.26, 0.035, 0.025), mats["dark"], coll, 0)
            cube("Bench vise", (4.9, 3.9, 0.55), (1.2, 1.2, 1.0), mats["purple"], coll, 0.08)
            rod("Vise screw", (4.9, 3.1, 0.5), (4.9, 4.5, 0.5), 0.12, mats["aluminum"], coll)
            for x, y in [(-4.8, 3.9), (5.2, -3.8), (-5.0, -4.1)]:
                bolt_detail((x, y, 0.17), mats, coll, 1.8)
        elif kit == "rooftop":
            for x in (-4.8, 4.8):
                cube("Vent unit", (x, 3.8, 0.5), (1.4, 1.4, 1.0), mats["aluminum"], coll, 0.08)
                for y in range(4):
                    cube("Vent grille", (x, 3.05, 0.3 + y * 0.16), (1.1, 0.04, 0.05), mats["dark"], coll, 0)
            rod("Roof pipe", (-5.6, -4.3, 0.35), (5.6, -4.3, 0.35), 0.19, mats["copper"], coll)
            for x in range(-4, 5, 2):
                cube("Hazard dash", (x, -4.3, 0.56), (0.7, 0.25, 0.05), mats["orange"], coll, 0.01, (0, 0, 0.4))
        else:
            for x in (-5.5, 5.5):
                for y in (-4.2, 0, 4.2):
                    rod("Greenhouse frame", (x, y, 0), (x, y, 2.4), 0.07, mats["copper"], coll)
                rod("Greenhouse roof rail", (x, -4.2, 2.4), (x, 4.2, 2.4), 0.07, mats["copper"], coll)
            for x, y in [(-4.7, 3.7), (4.7, 3.7), (-4.8, -3.5), (4.8, -3.5)]:
                cylinder("Mechanical planter", (x, y, 0.28), 0.55, 0.55, mats["copper"], coll)
                for angle in range(5):
                    a = angle * math.tau / 5
                    rod("Salvaged stem", (x, y, 0.5), (x + math.cos(a) * 0.4, y + math.sin(a) * 0.4, 1.25), 0.035, mats["leaf"], coll)
                    sphere("Metal leaf", (x + math.cos(a) * 0.4, y + math.sin(a) * 0.4, 1.25), (0.22, 0.1, 0.35), mats["lime"], coll, 12, 6)
        export(coll, "arena-" + kit)
    for name in ["crate", "gear", "spool"]:
        coll = collection("obstacle-" + name)
        if name == "crate":
            cube("Scrap crate", (0, 0, 0.45), (0.85, 0.85, 0.9), mats["purple"], coll, 0.06)
            for side in (-1, 1):
                cube("Crate strap", (side * 0.28, -0.44, 0.45), (0.08, 0.05, 0.84), mats["aluminum"], coll, 0.01)
        elif name == "gear":
            cylinder("Gear hub", (0, 0, 0.35), 0.48, 0.65, mats["copper"], coll, 20)
            for i in range(10):
                a = i * math.tau / 10
                cube("Gear tooth", (math.cos(a) * 0.52, math.sin(a) * 0.52, 0.35), (0.2, 0.2, 0.6), mats["aluminum"], coll, 0.02, (0, 0, a))
        else:
            cylinder("Cable spool core", (0, 0, 0.42), 0.3, 0.8, mats["dark"], coll)
            for z in (0.08, 0.75):
                cylinder("Cable spool flange", (0, 0, z), 0.48, 0.12, mats["orange"], coll)
            for z in (0.25, 0.4, 0.55):
                torus("Coiled cable", (0, 0, z), 0.32, 0.055, mats["aluminum"], coll)
        export(coll, "obstacle-" + name)
    save_source("arenas.blend")


def export(coll, name):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in coll.objects:
        if obj.type == "MESH":
            obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(OUT / (name + ".glb")), export_format="GLB", use_selection=True, export_apply=True, export_animations=False, export_cameras=False, export_lights=False)


def save_source(name):
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND / name), compress=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", choices=["chassis", "modules", "environments", "all"], default="all")
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    OUT.mkdir(parents=True, exist_ok=True)
    BLEND.mkdir(parents=True, exist_ok=True)
    mats = {name: material(name, color, 0.65 if name in {"aluminum", "copper"} else 0.15, 0.38 if name == "glass" else 0.58, 0.35 if name in {"lime", "glass"} else 0) for name, color in PALETTE.items()}
    if args.only in {"chassis", "all"}:
        make_chassis(mats)
    if args.only in {"modules", "all"}:
        make_modules(mats)
    if args.only in {"environments", "all"}:
        make_environments(mats)
    attachments = {
        "convention": "glTF +Y up, +Z forward, metres; module origin is the mating point",
        "sockets": {
            "light": {"left": [-0.57, 0.73, 0.03], "right": [0.57, 0.73, 0.03], "top": [0, 1.12, 0], "back": [0, 0.72, -0.36]},
            "heavy": {"left": [-0.57, 0.73, 0.03], "right": [0.57, 0.73, 0.03], "top": [0, 1.12, 0], "back": [0, 0.72, -0.36]},
            "spider": {"left": [-0.48, 0.67, 0.03], "right": [0.48, 0.67, 0.03], "top": [0, 1.0, 0], "back": [0, 0.67, -0.34]}
        },
        "moduleRotationY": {"left": 0, "right": 0, "top": 0, "back": 3.141592653589793}
    }
    (OUT / "attachments.json").write_text(json.dumps(attachments, indent=2) + "\n", encoding="utf-8")
    print("Generated", len(list(OUT.glob("*.glb"))), "GLB assets")


if __name__ == "__main__":
    main()
