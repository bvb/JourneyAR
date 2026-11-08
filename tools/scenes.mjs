// Scenes of the app: export id (Unity target), tracked page in original-sources/book-ar-pages and the original
// Vuforia target.
// `pinchMax` replaces the original upper pinch limit (relative to the initial size);
// `pinchPivot` names the nodes whose common centre the pinch scales about (by default the pinch
// node's own origin, as in the original); `pinch` gives the pinch settings of a scene that had
// no PinchScale. `uvScrolls` add texture scrolling the export cannot express (published as
// AnimatedUVs components, which the app plays): node, its material index, offset per second.
// `removeNodes` are left out of the published scene (with their children).
// `marker: 'target'` makes the NFT marker from the original Vuforia target's place on the page
// (as the original app tracked it) instead of the whole page.
export const SCENES = [
  { id: 'character', page: 'page32', target: 'Character' },
  { id: 'creature', page: 'page52', target: 'Creature' },
  // Up to 3 times (the original: 1.43) about the small models inside the sphere (the ruins and
  // the two travellers on the sand), to look at them.
  {
    id: 'landscape',
    page: 'page63',
    target: 'Landscape',
    pinchMax: 3,
    pinchPivot: ['head', 'segments', 'stones', 'wall', 'Journeyer_FBX'],
  },
  { id: 'architecture', page: 'page90', target: 'Architecture' },
  { id: 'sequence', page: 'page131', target: 'Sequence' },
  // The DAQRI page. The original did not scale it; here it scales like the others, from its root.
  // Its sky scrolled with a legacy Animation (SkyScroll, played automatically in the 2012 build:
  // _MainTex.offset.x of the sky's first material from 0 to 1 in 35 s, looping; the clip's second
  // curve names a node that does not exist). Without the "Tap here to visit us online" text: its
  // link (TouchRay to daqri.com) is gone with the company. Tracked by the cube alone, like the
  // original (its Vuforia target): the rest of the page is white paper and text.
  {
    id: 'daqri',
    page: 'page166',
    target: 'daqri',
    marker: 'target',
    pinch: { node: 'DaqriBeach_Prefab', min: 1, max: 2 },
    uvScrolls: [{ node: 'BeachSkyOverlay_FBX', materialIndex: 0, rate: [1 / 35, 0] }],
    removeNodes: ['TapHereTextMesh_FBX'],
  },
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
