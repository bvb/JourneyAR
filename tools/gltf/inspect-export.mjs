// Validates the GLB files from the Unity export and checks them against export-report.json,
// which lists what the Unity scene had in each target subtree.
// Usage: node gltf/inspect-export.mjs [exportDir]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import validator from 'gltf-validator';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from '../config.mjs';

const exportDir = process.argv[2] ?? path.join(ROOT, 'tools', '.out', 'export');
const report = JSON.parse(readFileSync(path.join(exportDir, 'export-report.json'), 'utf8'));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

// Half a frame at 30 fps: exported keyframe times may be resampled.
const DURATION_TOLERANCE = 1 / 60;
const SEVERITY = ['error', 'warning', 'info', 'hint'];

let failed = false;

for (const target of report.targets) {
  const file = path.join(exportDir, target.file);
  const bytes = new Uint8Array(readFileSync(file));
  const problems = [];

  const validation = await validator.validateBytes(bytes, { maxIssues: 500 });
  const issues = validation.issues;
  const issueCodes = new Map();
  for (const message of issues.messages) {
    if (message.severity > 1) continue;
    const key = `${SEVERITY[message.severity]} ${message.code}: ${message.message}`;
    issueCodes.set(key, (issueCodes.get(key) ?? 0) + 1);
  }
  if (issues.numErrors > 0) problems.push(`validator: ${issues.numErrors} errors`);

  const document = await io.readBinary(bytes);
  const root = document.getRoot();
  const meshNodes = root.listNodes().filter((node) => node.getMesh());
  const skinnedNodes = meshNodes.filter((node) => node.getSkin());
  const lightNodes = root.listNodes().filter((node) => node.getExtension('KHR_lights_punctual'));

  const meshTriangles = (mesh) =>
    mesh
      .listPrimitives()
      .filter((p) => p.getMode() === 4)
      .reduce((sum, p) => sum + (p.getIndices() ?? p.getAttribute('POSITION')).getCount() / 3, 0);

  let vertices = 0;
  let primitives = 0;
  let coloredPrimitives = 0;
  for (const mesh of root.listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      primitives += 1;
      vertices += primitive.getAttribute('POSITION')?.getCount() ?? 0;
      if (primitive.getAttribute('COLOR_0')) coloredPrimitives += 1;
    }
  }
  // Drawn triangles: a mesh shared by several nodes counts once per node, as in Unity.
  const triangles = meshNodes.reduce((sum, node) => sum + meshTriangles(node.getMesh()), 0);

  const animations = root.listAnimations().map((animation) => ({
    name: animation.getName(),
    channels: animation.listChannels().length,
    duration: Math.max(0, ...animation.listSamplers().map((s) => s.getInput()?.getMax([])[0] ?? 0)),
  }));

  // Compare with what Unity had.
  const plainMeshNodes = meshNodes.length - skinnedNodes.length;
  if (plainMeshNodes !== target.meshRenderers) {
    problems.push(`mesh nodes ${plainMeshNodes} != Unity mesh renderers ${target.meshRenderers}`);
  }
  if (skinnedNodes.length !== target.skinnedMeshRenderers) {
    problems.push(
      `skinned nodes ${skinnedNodes.length} != Unity skinned renderers ${target.skinnedMeshRenderers}`,
    );
  }
  if (lightNodes.length !== target.lights) {
    problems.push(`light nodes ${lightNodes.length} != Unity lights ${target.lights}`);
  }
  if (triangles !== target.triangles) {
    problems.push(`triangles ${triangles} != Unity triangles ${target.triangles}`);
  }

  // Only clips that move transforms in Unity can (and must) become glTF animations.
  const notes = [];
  for (const clip of target.clips) {
    if (clip.boundTransformCurves === 0 && clip.otherBoundCurves.length === 0) {
      notes.push(
        `clip ${clip.node}/${clip.name}: none of its ${clip.curves} curves bind (no-op in Unity too)`,
      );
    }
    if (clip.otherBoundCurves.length > 0) {
      notes.push(
        `clip ${clip.node}/${clip.name}: non-transform curves not exportable to glTF: ` +
          clip.otherBoundCurves.join(', '),
      );
    }
  }
  const unmatched = [...animations];
  for (const clip of target.clips.filter((c) => c.boundTransformCurves > 0)) {
    const index = unmatched.findIndex(
      (a) => Math.abs(a.duration - clip.length) <= DURATION_TOLERANCE && a.channels > 0,
    );
    if (index === -1) {
      problems.push(
        `clip ${clip.node}/${clip.name} (${clip.length.toFixed(2)}s) has no matching animation`,
      );
    } else {
      unmatched.splice(index, 1);
    }
  }
  for (const extra of unmatched) {
    problems.push(
      `animation ${extra.name} (${extra.duration.toFixed(2)}s) has no matching Unity clip`,
    );
  }

  const sizeKb = (statSync(file).size / 1024).toFixed(0);
  console.log(
    `\n=== ${target.id} (${target.root}, ${target.trackable}) — ${target.file}, ${sizeKb} KB`,
  );
  console.log(
    `nodes ${root.listNodes().length}, mesh nodes ${meshNodes.length} (skinned ${skinnedNodes.length}), ` +
      `skins ${root.listSkins().length}, meshes ${root.listMeshes().length}, primitives ${primitives} ` +
      `(${coloredPrimitives} with vertex colors), vertices ${vertices}, triangles ${triangles}`,
  );
  console.log(
    `materials ${root.listMaterials().length}, textures ${root.listTextures().length}, ` +
      `lights ${lightNodes.length}, extensions: ${root
        .listExtensionsUsed()
        .map((e) => e.extensionName)
        .join(', ')}`,
  );
  for (const a of animations) {
    console.log(`animation "${a.name}": ${a.duration.toFixed(2)}s, ${a.channels} channels`);
  }
  console.log(
    `validator: ${issues.numErrors} errors, ${issues.numWarnings} warnings, ${issues.numInfos} infos`,
  );
  for (const [key, count] of issueCodes) console.log(`  ${count}× ${key}`);
  for (const note of notes) console.log(`NOTE ${note}`);
  if (problems.length === 0) {
    console.log('OK — matches the Unity scene');
  } else {
    failed = true;
    for (const problem of problems) console.log(`PROBLEM ${problem}`);
  }
}

process.exitCode = failed ? 1 : 0;
