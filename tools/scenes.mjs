// Scenes of the app: export id (Unity target), tracked page in book-ar-pages and the original
// Vuforia target. The daqri page (page166) is left out for now (see .plans/plan.md).
export const SCENES = [
  { id: 'character', page: 'page32', target: 'Character' },
  { id: 'creature', page: 'page52', target: 'Creature' },
  { id: 'landscape', page: 'page63', target: 'Landscape' },
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
