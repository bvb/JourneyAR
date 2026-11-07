// Reading and patching the JSON chunk of a GLB file.

const MAGIC = 0x46546c67; // 'glTF'
const JSON_CHUNK = 0x4e4f534a; // 'JSON'

function chunks(bytes) {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buffer.readUInt32LE(0) !== MAGIC) throw new Error('Not a GLB file');
  const list = [];
  for (let offset = 12; offset < buffer.length;) {
    const length = buffer.readUInt32LE(offset);
    const type = buffer.readUInt32LE(offset + 4);
    list.push({ type, data: buffer.subarray(offset + 8, offset + 8 + length) });
    offset += 8 + length;
  }
  return list;
}

/** The glTF JSON of a GLB file. */
export function readGlbJson(bytes) {
  const json = chunks(bytes).find((chunk) => chunk.type === JSON_CHUNK);
  if (!json) throw new Error('GLB without a JSON chunk');
  return JSON.parse(json.data.toString('utf8'));
}

/** A copy of a GLB file whose JSON is changed by `patch` (in place); binary chunks as they are. */
export function patchGlbJson(bytes, patch) {
  const list = chunks(bytes);
  const index = list.findIndex((chunk) => chunk.type === JSON_CHUNK);
  const json = JSON.parse(list[index].data.toString('utf8'));
  patch(json);
  let text = Buffer.from(JSON.stringify(json), 'utf8');
  // Chunks are 4-byte aligned; JSON is padded with spaces.
  if (text.length % 4) text = Buffer.concat([text, Buffer.alloc(4 - (text.length % 4), 0x20)]);
  list[index] = { type: JSON_CHUNK, data: text };
  const total = 12 + list.reduce((sum, chunk) => sum + 8 + chunk.data.length, 0);
  const out = Buffer.alloc(total);
  out.writeUInt32LE(MAGIC, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  let offset = 12;
  for (const chunk of list) {
    out.writeUInt32LE(chunk.data.length, offset);
    out.writeUInt32LE(chunk.type, offset + 4);
    chunk.data.copy(out, offset + 8);
    offset += 8 + chunk.data.length;
  }
  return out;
}
