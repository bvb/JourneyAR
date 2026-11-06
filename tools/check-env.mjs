// Verifies that every external tool and source folder the pipeline needs is in place.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  BLENDER_EXE,
  BOOK_PAGES,
  FFMPEG,
  UNITY_EXE,
  UNITY_PROJECT,
  VUFORIA_DATASET,
} from './config.mjs';

const EXPECTED_UNITY = '6000.6.8f1';
let failed = false;

function report(ok, label, detail) {
  if (!ok) failed = true;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
}

report(true, 'Node', process.version);

report(existsSync(UNITY_EXE), 'Unity editor', UNITY_EXE);

const versionFile = path.join(UNITY_PROJECT, 'ProjectSettings', 'ProjectVersion.txt');
if (existsSync(versionFile)) {
  const version = /m_EditorVersion: (\S+)/.exec(readFileSync(versionFile, 'utf8'))?.[1];
  report(
    version === EXPECTED_UNITY,
    'Unity project version',
    `${version} (expected ${EXPECTED_UNITY})`,
  );
} else {
  report(false, 'Unity project', `${versionFile} not found`);
}

report(existsSync(BLENDER_EXE), 'Blender', BLENDER_EXE);

try {
  const firstLine = execFileSync(FFMPEG, ['-version'], { encoding: 'utf8' }).split('\n')[0];
  report(true, 'ffmpeg', firstLine);
} catch (error) {
  report(false, 'ffmpeg', `${FFMPEG}: ${error.message}`);
}

report(existsSync(BOOK_PAGES), 'Book pages', BOOK_PAGES);
report(
  existsSync(VUFORIA_DATASET.xml) && existsSync(VUFORIA_DATASET.dat),
  'Vuforia dataset of the original app',
  VUFORIA_DATASET.dat,
);

process.exitCode = failed ? 1 : 0;
