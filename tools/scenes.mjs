// Scenes of the app: export id (Unity target), tracked page in book-ar-pages and the original
// Vuforia target. The daqri page (page166) is left out for now (see .plans/plan.md).
// `pinchMax` replaces the original upper pinch limit (relative to the initial size).
export const SCENES = [
  { id: 'character', page: 'page32', target: 'Character' },
  { id: 'creature', page: 'page52', target: 'Creature' },
  // Up to 4 times (the original: 1.43), to look at the small models inside the sphere.
  { id: 'landscape', page: 'page63', target: 'Landscape', pinchMax: 4 },
  { id: 'architecture', page: 'page90', target: 'Architecture' },
  { id: 'sequence', page: 'page131', target: 'Sequence' },
];

/** Picks scenes by the ids given on the command line (all scenes when none are given). */
export function selectScenes(args) {
  const ids = args.filter((arg) => !arg.startsWith('-'));
  if (ids.length === 0) return SCENES;
  return ids.map((id) => {
    const scene = SCENES.find((s) => s.id === id);
    if (!scene)
      throw new Error(`Unknown scene "${id}"; known: ${SCENES.map((s) => s.id).join(', ')}`);
    return scene;
  });
}
