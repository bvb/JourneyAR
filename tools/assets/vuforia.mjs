// Reads the image targets of the original Vuforia (QCAR) dataset: target sizes from the XML
// config and the grayscale target textures (<name>.tex.jpg) stored in the .dat zip archive.
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

/** Minimal zip reader: returns a Map of entry name -> Buffer. */
function readZip(bytes) {
  const eocd = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('Not a zip archive');
  const count = bytes.readUInt16LE(eocd + 10);
  let offset = bytes.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let i = 0; i < count; i += 1) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error('Bad zip central directory');
    const method = bytes.readUInt16LE(offset + 10);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const localOffset = bytes.readUInt32LE(offset + 42);
    const name = bytes.toString('utf8', offset + 46, offset + 46 + nameLength);
    const dataStart =
      localOffset +
      30 +
      bytes.readUInt16LE(localOffset + 26) +
      bytes.readUInt16LE(localOffset + 28);
    const data = bytes.subarray(dataStart, dataStart + compressedSize);
    if (method === 0) entries.set(name, Buffer.from(data));
    else if (method === 8) entries.set(name, inflateRawSync(data));
    else throw new Error(`Unsupported zip compression ${method} for ${name}`);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/**
 * Targets of a Vuforia dataset: [{ name, size: [width, height], texture: Buffer (JPEG) }].
 * `size` is in Unity units (the targets are 200 wide).
 */
export function readVuforiaTargets(xmlPath, datPath) {
  const xml = readFileSync(xmlPath, 'utf8');
  const entries = readZip(readFileSync(datPath));
  const targets = [];
  for (const match of xml.matchAll(/<ImageTarget\s+size="([\d.]+) ([\d.]+)"\s+name="([^"]+)"/g)) {
    const [, width, height, name] = match;
    const texture = entries.get(`${name}.tex.jpg`);
    if (!texture) throw new Error(`No texture for target ${name} in ${datPath}`);
    targets.push({ name, size: [Number(width), Number(height)], texture });
  }
  return targets;
}
