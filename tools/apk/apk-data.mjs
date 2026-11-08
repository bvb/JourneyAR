// The scene data read from the APK by read-apk.py (tools/.out/apk): serialized objects with
// resolved references, decoded mesh data and the paths of the decoded textures and audio clips.
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ARRAYS = { f32: Float32Array, u32: Uint32Array, u8: Uint8Array };

export class ApkData {
  constructor(dir) {
    this.dir = dir;
    const json = JSON.parse(readFileSync(path.join(dir, 'objects.json'), 'utf8'));
    this.objects = json.objects;
    this.roots = json.roots;
    this.scripts = json.scripts;
    this.renderSettings = json.renderSettings ? this.objects[json.renderSettings].data : null;
    this.unityVersion = json.unityVersion;
    const bin = readFileSync(path.join(dir, 'data.bin'));
    this.bin = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength);
  }

  /** The object a reference ({"$ref": id}) points at: { id, type, data, ... }, or null. */
  get(ref) {
    const id = typeof ref === 'string' ? ref : ref?.$ref;
    if (!id) return null;
    const entry = this.objects[id];
    if (!entry) throw new Error(`Object ${id} was not read from the APK`);
    return { id, ...entry };
  }

  /** A typed array view of data.bin. */
  array(view) {
    if (!view) return null;
    const Type = ARRAYS[view.type];
    return new Type(this.bin, view.offset, view.count * view.size);
  }

  /** Components of a GameObject, in order. */
  components(gameObject) {
    return gameObject.data.m_Component.map((entry) =>
      this.get(Array.isArray(entry) ? entry[1] : (entry.component ?? entry.second)),
    );
  }

  /** The Transform of a GameObject. */
  transform(gameObject) {
    return this.components(gameObject).find((c) => c.type === 'Transform');
  }

  /** Child GameObjects, in order. */
  children(gameObject) {
    return this.transform(gameObject).data.m_Children.map((child) =>
      this.get(this.get(child).data.m_GameObject),
    );
  }

  /** The script class name of a MonoBehaviour. */
  scriptName(behaviour) {
    return this.scripts[behaviour.data.m_Script?.$ref] ?? null;
  }

  path(file) {
    return path.join(this.dir, file);
  }
}
