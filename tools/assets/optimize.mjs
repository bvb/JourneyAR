// Size optimization of a scene exported from Unity, for the app (used by publish.mjs).
//
// The scenes are rendered from the Unity material extras (journey-ar/src/scenes/
// unity-materials.ts), which name textures by glTF index, and the app finds nodes by name (the
// pinch node, the UV-scrolling renderers with their primitives). So the optimization keeps the
// document's structure: textures, nodes and their transforms stay as they are, and only the data
// gets smaller:
// - identical accessors and meshes are shared (dedup) and the data left unused is dropped (only
//   geometry: textures are referenced from the extras, which prune cannot see); animation
//   keyframes that a linear interpolation reproduces are dropped (resample);
// - vertex attributes other than positions are quantized (KHR_mesh_quantization): normals and
//   tangents to 12 bits, texture coordinates in [0, 1] to 14 bits, vertex colours to 16 bits
//   (they are linear and turned to gamma in the app: 8 bits would band in the dark). Positions
//   stay 32-bit floats: quantizing them moves meshes into new child nodes, which the app's node
//   lookups do not expect;
// - all geometry and animation data is compressed losslessly with EXT_meshopt_compression
//   (vertex and index codecs; decoded in the app by three.js' MeshoptDecoder);
// - PNG textures become WebP (EXT_texture_webp): lookup ramps losslessly, the others at high
//   quality with exact alpha. JPEG textures stay as they are.
// Writing the document, gltf-transform keeps the images (in order) but writes glTF textures only
// for the textures that standard material slots use; the extras are then pointed again at the
// same images (restoreTextureRefs).
import { PropertyType } from '@gltf-transform/core';
import {
  EXTMeshoptCompression,
  EXTTextureWebP,
  KHRMeshQuantization,
} from '@gltf-transform/extensions';
import { dedup, prune, quantize, reorder, resample } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { patchGlbJson, readGlbJson } from './glb.mjs';

/** Textures used as lookup tables (gradients sampled by angle or height): kept lossless. */
const LOSSLESS_TEXTURES = /ramp/i;
const WEBP_QUALITY = 90;

export const QUANTIZATION = {
  // Positions are left out (see above).
  pattern: /^(NORMAL|TANGENT|TEXCOORD_\d+|COLOR_\d+)$/,
  quantizeNormal: 12,
  quantizeTexcoord: 14,
  quantizeColor: 16,
};

/**
 * The optimized GLB of an exported scene: `document` is the export (read from `exported`, the
 * GLB bytes) and is changed in place. Returns the bytes and the textures turned to WebP.
 */
export async function optimizeModel(io, document, exported) {
  const { textures } = await optimizeScene(document);
  const written = await io.writeBinary(document);
  const original = readGlbJson(exported);
  return { bytes: patchGlbJson(written, (json) => restoreTextureRefs(json, original)), textures };
}

/** Optimizes the scene document in place; returns what changed, for the log. */
export async function optimizeScene(document) {
  await MeshoptEncoder.ready;
  await document.transform(
    dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.MESH], keepUniqueNames: true }),
    prune({
      propertyTypes: [PropertyType.ACCESSOR, PropertyType.MESH, PropertyType.PRIMITIVE],
      keepAttributes: true,
      keepIndices: true,
      keepLeaves: true,
      keepSolidTextures: true,
    }),
    resample(),
    reorder({ encoder: MeshoptEncoder, target: 'size' }),
    quantize({ ...QUANTIZATION, cleanup: false }),
  );
  // quantize() declares the extension only when positions are quantized; quantized normals and
  // tangents need it too.
  document.createExtension(KHRMeshQuantization).setRequired(true);
  // The meshopt index codec takes 16- or 32-bit indices; the export writes 8-bit ones too.
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const indices = primitive.getIndices();
      if (indices && indices.getArray().BYTES_PER_ELEMENT === 1) {
        indices.setArray(new Uint16Array(indices.getArray()));
      }
    }
  }
  const textures = await compressTextures(document);
  document
    .createExtension(EXTMeshoptCompression)
    .setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  return { textures };
}

/** PNG textures to WebP, each only if it gets smaller. */
async function compressTextures(document) {
  const converted = [];
  for (const texture of document.getRoot().listTextures()) {
    if (texture.getMimeType() !== 'image/png') continue;
    const name = texture.getName();
    const image = texture.getImage();
    const lossless = LOSSLESS_TEXTURES.test(name);
    // The pixels as stored: no colour management (the app samples them raw, gamma workflow).
    const webp = await sharp(image, { ignoreIcc: true })
      .webp(
        lossless
          ? { lossless: true, exact: true, effort: 6 }
          : {
              quality: WEBP_QUALITY,
              alphaQuality: 100,
              exact: true,
              smartSubsample: true,
              effort: 6,
            },
      )
      .toBuffer();
    if (webp.byteLength >= image.byteLength) continue;
    texture.setImage(new Uint8Array(webp)).setMimeType('image/webp');
    converted.push({ name, lossless, from: image.byteLength, to: webp.byteLength });
  }
  if (converted.length > 0) document.createExtension(EXTTextureWebP).setRequired(true);
  return converted;
}

const sourceOf = (texture) => texture?.source ?? texture?.extensions?.EXT_texture_webp?.source;

/**
 * Points the material extras' texture indices (written by the Unity exporter for the export's
 * glTF textures) at glTF textures of the same images in `json`, adding the textures that are
 * missing. The images must be the export's, in the same order.
 */
export function restoreTextureRefs(json, original) {
  const names = (images) => (images ?? []).map((image) => image.name);
  if (JSON.stringify(names(json.images)) !== JSON.stringify(names(original.images))) {
    throw new Error('Optimized scene: the images are not those of the export');
  }
  json.textures ??= [];
  const byImage = new Map();
  json.textures.forEach((texture, index) => {
    const source = sourceOf(texture);
    if (source !== undefined && !byImage.has(source)) byImage.set(source, index);
  });
  const textureOf = (image) => {
    let index = byImage.get(image);
    if (index === undefined) {
      const webp = json.images[image].mimeType === 'image/webp';
      index =
        json.textures.push(
          webp ? { extensions: { EXT_texture_webp: { source: image } } } : { source: image },
        ) - 1;
      byImage.set(image, index);
    }
    return index;
  };
  for (const material of json.materials ?? []) {
    for (const value of Object.values(material.extras?.properties ?? {})) {
      if (!value || typeof value !== 'object' || !('index' in value) || value.index === null)
        continue;
      const image = sourceOf(original.textures?.[value.index]);
      if (image === undefined) throw new Error(`Texture ${value.index} of the export has no image`);
      value.index = textureOf(image);
    }
  }
}
