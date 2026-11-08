// Minimal zip reader (APK files, the Vuforia .dat inside): the central directory is read at once,
// entries are inflated only when asked for.
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

/** Entries of a zip archive (a file path or its bytes): { names, has(name), read(name) }. */
export function openZip(source) {
  const bytes = typeof source === 'string' ? readFileSync(source) : Buffer.from(source);
  const eocd = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('Not a zip archive');
  const count = bytes.readUInt16LE(eocd + 10);
  let offset = bytes.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let i = 0; i < count; i += 1) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error('Bad zip central directory');
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    entries.set(bytes.toString('utf8', offset + 46, offset + 46 + nameLength), {
      method: bytes.readUInt16LE(offset + 10),
      compressedSize: bytes.readUInt32LE(offset + 20),
      localOffset: bytes.readUInt32LE(offset + 42),
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return {
    names: [...entries.keys()],
    has: (name) => entries.has(name),
    read(name) {
      const entry = entries.get(name);
      if (!entry) throw new Error(`No ${name} in the archive`);
      const start =
        entry.localOffset +
        30 +
        bytes.readUInt16LE(entry.localOffset + 26) +
        bytes.readUInt16LE(entry.localOffset + 28);
      const data = bytes.subarray(start, start + entry.compressedSize);
      if (entry.method === 0) return Buffer.from(data);
      if (entry.method === 8) return inflateRawSync(data);
      throw new Error(`Unsupported zip compression ${entry.method} for ${name}`);
    },
  };
}
