// Verifies that every external tool and source the pipeline needs is in place.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  BACKGROUND_SOURCE,
  BOOK_PAGES,
  FAVICON_SOURCE,
  FFMPEG,
  ORIGINAL_APK,
  PYTHON,
  pageImage,
} from './config.mjs';
import { SCENES } from './scenes.mjs';
import { readVuforiaTargets } from './assets/vuforia.mjs';

let failed = false;

function report(ok, label, detail) {
  if (!ok) failed = true;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
}

report(true, 'Node', process.version);

try {
  const firstLine = execFileSync(FFMPEG, ['-version'], { encoding: 'utf8' }).split('\n')[0];
  report(true, 'ffmpeg', firstLine);
} catch (error) {
  report(false, 'ffmpeg', `${FFMPEG}: ${error.message}`);
}

try {
  const version = execFileSync(PYTHON, ['-I', '-c', 'import UnityPy; print(UnityPy.__version__)'], {
    encoding: 'utf8',
  }).trim();
  report(true, 'Python with UnityPy', `${PYTHON}, UnityPy ${version}`);
} catch {
  report(false, 'Python with UnityPy', `${PYTHON} — run npm run apk:setup`);
}

if (existsSync(ORIGINAL_APK)) {
  try {
    const targets = readVuforiaTargets(ORIGINAL_APK);
    report(true, 'Original APK', `${ORIGINAL_APK}, ${targets.length} Vuforia targets`);
  } catch (error) {
    report(false, 'Original APK', `${ORIGINAL_APK}: ${error.message}`);
  }
} else {
  report(false, 'Original APK', `${ORIGINAL_APK} not found`);
}

const missingPages = SCENES.map((scene) => pageImage(scene.page)).filter(
  (file) => !existsSync(file),
);
report(
  missingPages.length === 0,
  'Book page scans',
  missingPages.length ? `missing ${missingPages.join(', ')}` : BOOK_PAGES,
);
report(existsSync(FAVICON_SOURCE), 'App icons', FAVICON_SOURCE);
report(existsSync(BACKGROUND_SOURCE), 'Background picture', BACKGROUND_SOURCE);

process.exitCode = failed ? 1 : 0;
