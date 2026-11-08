# Journey AR

A browser AR companion for the art book _The Art of Journey_. Point a phone, tablet or webcam at
one of six tracked pages and the page comes alive with an animated 3D scene and its music. It
runs in the browser on Android, iPhone and desktop, with nothing to install.

**Open the app: https://bvb.github.io/JourneyAR/**

It is a remake of the 2012 DAQRI app (Unity 3.5 + Vuforia). The 3D scenes, sounds and target
data are converted straight from the original Android app
(`original-sources/Journey-AR-Viewer.1.0.apk`); Unity is not needed. Pages are tracked with
natural feature tracking (jsartoolkit-nft in a web worker), scenes are rendered with three.js.

## Repository layout

| Path                           | Contents                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------ |
| `journey-ar/`                  | The app (Vite + TypeScript + three.js). `assets/` holds the published models, audio, NFT data    |
| `journey-virtual-book-camera/` | Virtual camera for development and tests: the book pages in 3D, streamed into the app            |
| `tools/`                       | Asset pipeline: APK converter, glTF checks, NFT markers, publishing. Paths in `tools/config.mjs` |
| `original-sources/`            | Every source the assets are made from: the original APK, page scans, icons, background picture   |
| `pages-for-nft/`               | Normalized page images, shared by the NFT markers and the virtual camera                         |
| `.github/workflows/pages.yml`  | Publishing on GitHub Pages                                                                       |

The project notes, the plan and the decisions log are in Russian: `CLAUDE.md` and
`.plans/plan.md`.

## Requirements

- **Node.js 26** and **npm 11**.
- **Git LFS**: the original APK is stored in LFS. Run `git lfs install` once before cloning
  (or `git lfs pull` in an existing clone).
- **Python 3** for the APK reader (UnityPy). On Windows the `py` launcher is used, elsewhere
  `python3`; set `PYTHON_FOR_VENV` to use another interpreter.
- **Internet access** on the first build: the npm registry, PyPI (UnityPy) and **github.com**:
  during `npm ci` the `ffmpeg-static` package downloads ffmpeg 6.1.1 from GitHub Releases. If
  GitHub is unreachable, `npm ci` fails. In that case, set `HTTPS_PROXY`, or set
  `FFMPEG_BINARIES_URL` to a mirror with the same layout (`<url>/b6.1.1/ffmpeg-win32-x64.gz`
  and so on).
- For the end-to-end tests only: **Microsoft Edge** and Playwright's Chromium
  (`npx playwright install chromium`).

## Release build

On a fresh clone, one command does everything:

```sh
git clone https://github.com/bvb/JourneyAR.git
cd JourneyAR
npm run build-all
```

`build-all` runs, in order:

1. `npm ci`: installs the exact dependency versions from `package-lock.json`;
2. `npm run apk:setup`: creates the Python environment of the APK reader (`tools/.out/pyenv`);
3. `npm run check-env`: checks ffmpeg, Python with UnityPy, the APK and the sources;
4. `npm run apk:convert` and `npm run gltf:inspect`: converts the scenes from the APK to glTF
   and validates them;
5. `npm run pages:normalize` and `npm run nft:generate`: page scans → normalized pages → NFT
   markers;
6. `npm run assets:publish` and `npm run ui:publish`: optimized models, audio, `scenes.json`,
   icons and the background into `journey-ar/assets`;
7. `npm run check`: typecheck, lint, formatting, unit tests;
8. `npm run build`: production build of the app into `journey-ar/dist/`.

The published assets are committed, and `build-all` reproduces them from `original-sources/`
byte for byte, so `git status` stays clean afterwards. When only the app code has changed,
`npm ci && npm run build` is enough.

### Running the release build

- **Locally:** `npm run preview` serves `journey-ar/dist` at https://localhost:4173. The
  certificate is self-signed: accept the browser warning once.
- **On a phone:** with the phone and the computer on the same network, open
  `https://<computer-IP>:4173` and accept the warning. The firewall must allow incoming
  connections to Node.js.
- **Hosting:** `journey-ar/dist/` is a static site. Put it on any web server with **HTTPS**:
  browsers give camera access only to secure pages. No special headers are needed. For a
  sub-path, build with `npm run build -w journey-ar -- --base=/journey/`. In Git Bash on
  Windows, prefix the command with `MSYS_NO_PATHCONV=1`: otherwise Git Bash turns `/journey/`
  into a Windows path.

### GitHub Pages

The app is published at https://bvb.github.io/JourneyAR/ by the workflow
`.github/workflows/pages.yml`. It runs on every push to `master` and can also be started by
hand on the Actions tab. The workflow:

1. checks out the repository and downloads the Git LFS files. They are kept in the Actions
   cache, because LFS bandwidth is limited, and downloaded again only when they change;
2. runs `npm ci` and `npm run check`;
3. builds the app with the site's base path (`/JourneyAR/`);
4. publishes `journey-ar/dist` on GitHub Pages.

The asset pipeline does not run there: the published assets are committed. GitHub Pages cannot
serve the site straight from the branch, because the binary assets in the branch are LFS
pointers.

Setup, once: **Settings → Pages → Source: GitHub Actions**, with `master` as the default
branch. If a deployment fails with "not allowed to deploy to github-pages", add `master` to
**Settings → Environments → github-pages → Deployment branches**. GitHub Pages serves files
with a 10-minute cache, so after a deployment the site can take a few minutes to update.

Usage: press the round button at the bottom to start the camera and sound, then point the camera
at a tracked page. Pinch to scale a scene, drag to move it, double-tap to reset.

## Development

```sh
npm ci
npm run dev        # the app at https://localhost:5173 (also on the LAN)
npm run dev:vcam   # the virtual camera at https://localhost:5174
```

Without a printed book, the app can take its frames from the virtual camera. These test sources
exist in the dev server only and start with the Start button:

- `https://localhost:5173/?source=canvas`: the virtual camera inside the app, driven by
  `window.__vcam` in the browser console;
- `https://localhost:5173/?source=webrtc`: the stream of an open virtual camera
  (`npm run dev:vcam`; switch pages with keys 1–6, move the camera with the mouse). This also
  works from a phone on the LAN. The app does not know the camera's focal length here and
  assumes 63° along the long side of the frame, the virtual camera's default at any resolution;
  after changing the virtual camera's angle, pass the same angle to the app as `?fov=`;
- `https://localhost:5173/?source=video&src=/__recordings/<name>.webm`: a recording from
  `journey-ar/tests/recordings` (recorded by the virtual camera's Record button).

Debug parameters: `?debug` (page outline and axes; on the daqri page also the outline of its
cube marker), `?fov=<degrees>`,
`?filter=native|none|oneeuro`, `?smooth=off`. A single scene without tracking:
`https://localhost:5173/scene-preview.html?scene=<id>&t=<seconds>`, shown next to the Unity
reference render.

Before a commit, `npm run check` and `npm run e2e` must pass; run `npm run e2e:full` before
calling a larger piece of work done.

### Asset pipeline

```text
original-sources/Journey-AR-Viewer.1.0.apk
  → apk:convert → tools/.out/export/<scene>.glb → gltf:inspect, scenes:compare
  → assets:publish → journey-ar/assets: models/*.glb, audio/*.mp3, scenes.json

original-sources/book-ar-pages/Artbook_Journey-page<N>.jpg
  → pages:normalize → pages-for-nft/<scene>.jpg
  → nft:generate → journey-ar/assets/nft/<scene>/   (check with nft:probe -- --together)

original-sources/favicon/, original-sources/journey-art1600.jpg
  → ui:publish → journey-ar/assets: icons, site.webmanifest, background.jpg, logo.svg
```

Files in `journey-ar/assets` are generated: change them only through these scripts. The one
exception is the `anchor` of a scene in `scenes.json` (the scene's placement on its page), which
can be tuned by hand. `tools/.out/` holds intermediate output and is not committed.

Tool paths can be overridden with environment variables: `FFMPEG` (ffmpeg binary),
`ORIGINAL_APK` (the APK), `JOURNEY_PYTHON` (Python with UnityPy), `PYTHON_FOR_VENV` (Python
used by `apk:setup`).

## npm scripts

Run all commands from the repository root.

### App

| Command             | What it does                                                                     |
| ------------------- | -------------------------------------------------------------------------------- |
| `npm run dev`       | Dev server of the app at https://localhost:5173 (self-signed HTTPS, LAN access)  |
| `npm run dev:vcam`  | Virtual camera at https://localhost:5174: book pages in 3D, recording and WebRTC |
| `npm run build`     | Production build of all workspaces; the app goes to `journey-ar/dist`            |
| `npm run build-all` | Full release build on a clean clone (see [Release build](#release-build))        |
| `npm run preview`   | Serves the production build at https://localhost:4173                            |

### Quality

| Command                  | What it does                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------ |
| `npm run check`          | `typecheck` + `lint` + `format:check` + `test`                                                         |
| `npm run typecheck`      | TypeScript check of all workspaces                                                                     |
| `npm run lint`           | ESLint                                                                                                 |
| `npm run format`         | Formats the code with Prettier                                                                         |
| `npm run format:check`   | Checks the formatting                                                                                  |
| `npm test`               | Unit tests (Vitest) of all workspaces                                                                  |
| `npm run e2e`            | Quick end-to-end suite (Playwright, Edge, about 40 s): one short test per feature                      |
| `npm run e2e:full`       | Full regression (about 5 min, Edge and Chromium): tracking accuracy, every page, audio, gestures       |
| `npm run scenes:compare` | Renders every converted scene in three.js next to the Unity reference render and checks the difference |

### Asset pipeline

| Command                                        | What it does                                                                                                                                              |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check-env`                            | Checks ffmpeg, Python with UnityPy, the APK and the sources in `original-sources/`                                                                        |
| `npm run apk:setup`                            | Creates the Python environment `tools/.out/pyenv` and installs UnityPy into it                                                                            |
| `npm run apk:convert`                          | Converts the scenes of the APK to `tools/.out/export/<scene>.glb` with `export-report.json`; `-- --skip-read` reuses the last APK read                    |
| `npm run gltf:inspect`                         | Validates the exported GLB files (gltf-validator) and checks them against the report                                                                      |
| `npm run gltf:compare -- <dir> [dir]`          | Compares two exports: nodes, meshes, materials, texture pixels, animations; the second defaults to `tools/.out/export`                                    |
| `npm run pages:normalize`                      | Page scans → `pages-for-nft/<scene>.jpg` (1700×1268, symmetric crop to the page proportions)                                                              |
| `npm run nft:generate -- [scene...]`           | NFT markers (`.iset`, `.fset`, `.fset3`) into `journey-ar/assets/nft/<scene>/`: the whole page, or for daqri the cube alone (the original Vuforia target) |
| `npm run nft:probe -- [scene...] [--together]` | Checks the markers without a browser: synthetic frames with a known pose, pose error, detection time, page confusion                                      |
| `npm run assets:publish`                       | Optimizes the GLB files, encodes the audio, writes `scenes.json` into `journey-ar/assets`; `-- --reset-anchors` places the scenes on their pages again    |
| `npm run ui:publish`                           | Icons, web manifest, `background.jpg` and `logo.svg` into `journey-ar/assets`                                                                             |

Typical sequences:

- the scenes changed: `apk:convert` → `gltf:inspect` → `scenes:compare` → `assets:publish`;
- the page scans changed: `pages:normalize` → `nft:generate` → `assets:publish` →
  `nft:probe -- --together`.

## License

The source code is licensed under the [MIT License](LICENSE).

_Journey_, _The Art of Journey_ and the original _Journey AR Viewer_ app (DAQRI, 2012), with
their characters, art, 3D scenes, music, sounds and page images, are the property of their
rights holders. This project uses them with permission. The MIT License does not cover them:
see [NOTICE.md](NOTICE.md) for the files that contain this content. Do not reuse these files
without the permission of the rights holders.

The production build lists the licenses of the bundled libraries in `licenses.txt`: three.js
(MIT) and jsartoolkit-nft (GNU LGPL 3.0).
