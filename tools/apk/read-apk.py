"""Reads the scenes of the original app straight from its APK with UnityPy.

The APK is the 2012 Android build (Unity 3.5.5f3). Everything reachable from the image target
roots (IT_*) and the root lights of the main scene is written to <out>/ for tools/apk/convert.mjs:

- objects.json: the serialized objects (type trees) by id "<file>:<path id>", with object
  references replaced by {"$ref": id}; the roots; the scene's RenderSettings and the class name
  of every MonoScript. Bulky binary fields are left out and written as below.
- data.bin: decoded mesh data (vertices, normals, tangents, UVs, colours, skin weights and
  triangle lists per submesh; triangle strips converted like Unity does), referenced from the
  mesh objects as {"offset", "count", "type", "size"} views.
- textures/<id>.png: decoded textures (top row first); ARGB4444 ones with their channels back
  in order (see fix_argb4444).
- audio/<name>.<ext>: the audio clips as stored (MP3 or WAV).

Usage: python -I read-apk.py <apk> <out dir>
"""

import json
import math
import os
import struct
import sys

import UnityPy
from UnityPy.helpers.MeshHelper import MeshHandler

# Unity 3.5 TextureFormat.ARGB4444.
ARGB4444 = 2
# AudioClip.m_Type of Unity 3.5: the stored data is a file of this format.
AUDIO_EXTENSIONS = {13: "mp3", 20: "wav", 14: "ogg"}
# Type tree fields not written to objects.json (decoded into data.bin, textures/ or audio/).
BULKY_FIELDS = {
    "Mesh": {"m_VertexData", "m_IndexBuffer", "m_CompressedMesh", "m_Skin", "m_Vertices",
             "m_UV", "m_UV1", "m_Tangents", "m_Normals", "m_Colors", "m_CollisionTriangles",
             "m_CollisionVertexCount"},
    "Texture2D": {"image data", "m_StreamData"},
    "AudioClip": {"m_AudioData"},
}
# References not followed: the parent (it would climb to the whole scene).
SKIPPED_REFERENCES = {"m_Father"}

# The build's type trees of MonoBehaviours hold only the base fields, so the script fields are
# read from the raw data with these layouts (the serialized fields of the classes in
# Assembly-CSharp.dll, in order). Only the scripts on the scene objects that are exported.
SCRIPT_LAYOUTS = {
    "PinchScale": [("zoomModifier", "float"), ("ScaleMin", "float"), ("ScaleMax", "float"),
                   ("SnapBack", "bool")],
    "AnimatedUVs_Ancestor": [("materialIndex", "int"), ("uvAnimationRate", "Vector2"),
                             ("textureName", "string")],
    "AnimatedUVs_Tower": [("materialIndex", "int"), ("uvAnimationRate", "Vector2"),
                          ("textureName", "string")],
    "TouchRay": [("url", "string")],
    # Vuforia: TrackableBehaviour, DataSetTrackableBehaviour, ImageTargetBehaviour fields.
    "ImageTargetBehaviour": [("mTrackableType", "int"), ("mTrackableName", "string"),
                             ("mPreviousScale", "Vector3"), ("mPreserveChildSize", "bool"),
                             ("mInitializedInEditor", "bool"), ("mDataSetPath", "string"),
                             ("mStorageType", "int"), ("mAspectRatio", "float")],
}


class RawReader:
    """Little-endian reader of Unity serialized data (strings and bools aligned to 4 bytes)."""

    def __init__(self, data):
        self.data = bytes(data)
        self.pos = 0

    def align(self):
        self.pos = (self.pos + 3) & ~3

    def unpack(self, fmt):
        values = struct.unpack_from("<" + fmt, self.data, self.pos)
        self.pos += struct.calcsize("<" + fmt)
        return values

    def read(self, kind):
        if kind == "int":
            return self.unpack("i")[0]
        if kind == "float":
            return self.unpack("f")[0]
        if kind == "bool":
            value = self.unpack("B")[0] != 0
            self.align()
            return value
        if kind == "string":
            (length,) = self.unpack("i")
            value = self.data[self.pos:self.pos + length].decode("utf8")
            self.pos += length
            self.align()
            return value
        if kind == "pptr":
            return dict(zip(("m_FileID", "m_PathID"), self.unpack("ii")))
        if kind == "Vector2":
            return dict(zip("xy", self.unpack("ff")))
        if kind == "Vector3":
            return dict(zip("xyz", self.unpack("fff")))
        raise ValueError(kind)


def object_key(reader):
    return f"{os.path.basename(reader.assets_file.name).lower()}:{reader.path_id}"


class ApkReader:
    def __init__(self, apk, out):
        self.env = UnityPy.load(apk)
        self.out = out
        self.by_key = {object_key(obj): obj for obj in self.env.objects}
        self.objects = {}
        self.pending = []
        self.data = bytearray()

    def ref_key(self, reader, pointer):
        path_id = pointer.get("m_PathID", 0)
        if not path_id:
            return None
        file_id = pointer.get("m_FileID", 0)
        if file_id == 0:
            name = os.path.basename(reader.assets_file.name).lower()
        else:
            name = os.path.basename(reader.assets_file.externals[file_id - 1].path).lower()
        key = f"{name}:{path_id}"
        return key if key in self.by_key else None

    def resolve_refs(self, reader, value, field=None):
        """Replaces object references with {"$ref": id} and queues the referenced objects."""
        if isinstance(value, dict):
            if set(value) == {"m_FileID", "m_PathID"}:
                key = self.ref_key(reader, value)
                if key and field not in SKIPPED_REFERENCES:
                    self.pending.append(key)
                return {"$ref": key} if key else None
            return {k: self.resolve_refs(reader, v, k) for k, v in value.items()}
        if isinstance(value, (list, tuple)):
            return [self.resolve_refs(reader, v, field) for v in value]
        if isinstance(value, (bytes, bytearray)):
            return None
        if isinstance(value, float) and not math.isfinite(value):
            # JSON has no infinity (step tangents of animation curves): "inf" / "-inf".
            return str(value)
        return value

    def view(self, values, kind, size):
        """Appends a flat list of numbers to data.bin; returns its view."""
        fmt = {"f32": "f", "u32": "I", "u8": "B"}[kind]
        flat = [x for item in values for x in item] if size > 1 else list(values)
        while len(self.data) % 4:
            self.data.append(0)
        offset = len(self.data)
        self.data += struct.pack(f"<{len(flat)}{fmt}", *flat)
        return {"offset": offset, "count": len(flat) // size, "type": kind, "size": size}

    def decode_mesh(self, reader):
        mesh = reader.read()
        handler = MeshHandler(mesh)
        handler.process()
        decoded = {"vertexCount": handler.m_VertexCount}
        if handler.m_Vertices:
            decoded["positions"] = self.view(handler.m_Vertices, "f32", 3)
        if handler.m_Normals:
            decoded["normals"] = self.view([n[:3] for n in handler.m_Normals], "f32", 3)
        if handler.m_Tangents:
            decoded["tangents"] = self.view(handler.m_Tangents, "f32", 4)
        if handler.m_UV0:
            decoded["uv0"] = self.view(handler.m_UV0, "f32", 2)
        if handler.m_UV1:
            decoded["uv1"] = self.view(handler.m_UV1, "f32", 2)
        if handler.m_Colors:
            decoded["colors"] = self.view(handler.m_Colors, "f32", 4)
        if handler.m_BoneWeights:
            decoded["weights"] = self.view(handler.m_BoneWeights, "f32", 4)
            decoded["joints"] = self.view(handler.m_BoneIndices, "u32", 4)
        decoded["submeshes"] = [
            self.view([i for triangle in triangles for i in triangle], "u32", 1)
            for triangles in handler.get_triangles()
        ]
        return decoded

    def decode_texture(self, reader, key, tree):
        image = reader.read().image.convert("RGBA")
        if tree.get("m_TextureFormat") == ARGB4444:
            image = fix_argb4444(image)
        name = f"textures/{key.replace(':', '_').replace(' ', '_')}.png"
        os.makedirs(os.path.join(self.out, "textures"), exist_ok=True)
        image.save(os.path.join(self.out, name))
        return name

    def save_audio(self, tree, raw):
        extension = AUDIO_EXTENSIONS.get(tree.get("m_Type"))
        if extension is None:
            raise ValueError(f"AudioClip {tree.get('m_Name')}: unknown type {tree.get('m_Type')}")
        name = f"audio/{tree['m_Name']}.{extension}"
        os.makedirs(os.path.join(self.out, "audio"), exist_ok=True)
        with open(os.path.join(self.out, name), "wb") as file:
            file.write(bytes(raw))
        return name

    def read_monobehaviour(self, reader):
        """Base fields and, for the scripts in SCRIPT_LAYOUTS, the script fields."""
        raw = RawReader(reader.get_raw_data())
        tree = {"m_GameObject": raw.read("pptr"), "m_Enabled": raw.read("bool"),
                "m_Script": raw.read("pptr"), "m_Name": raw.read("string")}
        script_key = self.ref_key(reader, tree["m_Script"])
        class_name = self.by_key[script_key].read_typetree().get("m_ClassName") if script_key else None
        layout = SCRIPT_LAYOUTS.get(class_name)
        if layout is None:
            tree["unknownLayout"] = True
            return tree
        for name, kind in layout:
            tree[name] = raw.read(kind)
        if raw.pos != len(raw.data):
            raise ValueError(f"{class_name}: read {raw.pos} of {len(raw.data)} bytes")
        return tree

    def dump(self, key):
        if key in self.objects:
            return
        reader = self.by_key[key]
        kind = reader.type.name
        tree = self.read_monobehaviour(reader) if kind == "MonoBehaviour" else reader.read_typetree()
        raw_audio = tree.get("m_AudioData") if kind == "AudioClip" else None
        skipped = BULKY_FIELDS.get(kind, set())
        entry = {
            "type": kind,
            "data": self.resolve_refs(reader, {k: v for k, v in tree.items() if k not in skipped}),
        }
        if kind == "Mesh":
            entry["decoded"] = self.decode_mesh(reader)
        elif kind == "Texture2D":
            entry["png"] = self.decode_texture(reader, key, tree)
        elif kind == "AudioClip":
            entry["file"] = self.save_audio(tree, raw_audio)
        self.objects[key] = entry

    def run(self):
        roots = []
        render_settings = None
        for obj in self.env.objects:
            if obj.type.name == "RenderSettings":
                render_settings = object_key(obj)
            if obj.type.name != "Transform":
                continue
            transform = obj.read_typetree()
            if transform["m_Father"].get("m_PathID"):
                continue
            game_object = self.by_key[self.ref_key(obj, transform["m_GameObject"])]
            tree = game_object.read_typetree()
            types = [
                self.by_key[self.ref_key(game_object, component_pointer(c))].type.name
                for c in tree["m_Component"]
            ]
            if tree["m_Name"].startswith("IT_") or "Light" in types:
                roots.append(object_key(game_object))
        self.pending = list(roots) + ([render_settings] if render_settings else [])
        while self.pending:
            self.dump(self.pending.pop())
        scripts = {
            key: entry["data"].get("m_ClassName")
            for key, entry in self.objects.items()
            if entry["type"] == "MonoScript"
        }
        os.makedirs(self.out, exist_ok=True)
        with open(os.path.join(self.out, "data.bin"), "wb") as file:
            file.write(self.data)
        result = {
            "source": "Journey-AR-Viewer.1.0.apk",
            "unityVersion": str(next(iter(self.by_key.values())).version),
            "roots": sorted(roots),
            "renderSettings": render_settings,
            "scripts": scripts,
            "objects": self.objects,
        }
        with open(os.path.join(self.out, "objects.json"), "w", encoding="utf8") as file:
            json.dump(result, file, ensure_ascii=False, separators=(",", ":"))
        kinds = {}
        for entry in self.objects.values():
            kinds[entry["type"]] = kinds.get(entry["type"], 0) + 1
        print(f"{len(roots)} roots, {len(self.objects)} objects: "
              + ", ".join(f"{v} {k}" for k, v in sorted(kinds.items())))


def component_pointer(entry):
    if isinstance(entry, (list, tuple)):
        return entry[1]
    return entry.get("component") or entry.get("second")


def fix_argb4444(image):
    """The build stores ARGB4444 textures in the GLES channel order and UnityPy reads them with
    the channels shifted (its blue is the alpha): RGBA <- (A, R, G, B)."""
    r, g, b, a = image.split()
    from PIL import Image

    return Image.merge("RGBA", (a, r, g, b))


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("Usage: python -I read-apk.py <apk> <out dir>")
    ApkReader(sys.argv[1], sys.argv[2]).run()
