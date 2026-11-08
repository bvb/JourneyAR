// Reads the image targets of the original Vuforia (QCAR) dataset straight from the original
// app's APK: target sizes from the XML config and the grayscale target textures
// (<name>.tex.jpg) stored in the .dat zip archive.
import { openZip } from '../apk/zip.mjs';

const DATASET = 'assets/QCAR/JourneyBook';

/**
 * Targets of the app's Vuforia dataset: [{ name, size: [width, height], texture: Buffer (JPEG) }].
 * `size` is in Unity units (the targets are 200 wide).
 */
export function readVuforiaTargets(apkPath) {
  const apk = openZip(apkPath);
  const xml = apk.read(`${DATASET}.xml`).toString('utf8');
  const dat = openZip(apk.read(`${DATASET}.dat`));
  const targets = [];
  for (const match of xml.matchAll(/<ImageTarget\s+size="([\d.]+) ([\d.]+)"\s+name="([^"]+)"/g)) {
    const [, width, height, name] = match;
    if (!dat.has(`${name}.tex.jpg`))
      throw new Error(`No texture for target ${name} in ${DATASET}.dat`);
    targets.push({
      name,
      size: [Number(width), Number(height)],
      texture: dat.read(`${name}.tex.jpg`),
    });
  }
  return targets;
}
