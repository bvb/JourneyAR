// Runs a static editor method of the Unity project in batch mode and reports the result.
// Usage: node unity/run-unity.mjs <Namespace.Class.Method> [extra Unity arguments...]
// The Unity editor must be closed: batch mode cannot open a project that is already open.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, UNITY_EXE, UNITY_PROJECT } from '../config.mjs';

const [method, ...extraArgs] = process.argv.slice(2);
if (!method) {
  console.error('Usage: node unity/run-unity.mjs <Namespace.Class.Method> [extra Unity args]');
  process.exit(2);
}

const logDir = path.join(ROOT, 'tools', '.out', 'logs');
mkdirSync(logDir, { recursive: true });
const logFile = path.join(logDir, `${method.split('.').pop()}.log`);

const args = [
  '-batchmode',
  '-quit',
  '-projectPath',
  UNITY_PROJECT,
  '-executeMethod',
  method,
  '-logFile',
  logFile,
  ...extraArgs,
];

console.log(`Unity ${method}\nlog: ${logFile}`);
const started = Date.now();
const child = spawn(UNITY_EXE, args, { stdio: 'inherit' });

child.on('exit', (code) => {
  const seconds = ((Date.now() - started) / 1000).toFixed(0);
  if (existsSync(logFile)) {
    const notable =
      /\[Journey\]|error CS\d+|Shader error|Exception|another Unity instance|executeMethod|Aborting batchmode/i;
    const lines = [
      ...new Set(
        readFileSync(logFile, 'utf8')
          .split(/\r?\n/)
          .filter((line) => notable.test(line)),
      ),
    ];
    for (const line of lines.slice(0, 80)) console.log(line);
    if (lines.length > 80) console.log(`... ${lines.length - 80} more lines in the log`);
  }
  console.log(`Unity exited with code ${code} after ${seconds}s`);
  process.exitCode = code ?? 1;
});
