// Creates the Python environment of tools/apk/read-apk.py (tools/.out/pyenv) and installs
// UnityPy into it. Uses the Python on PATH ("py -3" on Windows) unless PYTHON_FOR_VENV is set.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PYTHON, PYTHON_VENV } from '../config.mjs';

function run(command, args) {
  console.log(`> ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${command} failed (exit code ${result.status})`);
}

if (!existsSync(PYTHON)) {
  const [command, ...prefix] = process.env.PYTHON_FOR_VENV
    ? [process.env.PYTHON_FOR_VENV]
    : process.platform === 'win32'
      ? ['py', '-3']
      : ['python3'];
  run(command, [...prefix, '-m', 'venv', PYTHON_VENV]);
}
const requirements = fileURLToPath(new URL('requirements.txt', import.meta.url));
run(PYTHON, ['-m', 'pip', 'install', '--disable-pip-version-check', '-r', requirements]);
