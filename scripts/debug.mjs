import { accessSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const env = { ...process.env };
const executable = name => process.platform === 'win32' ? `${name}.exe` : name;
const runnable = file => {
  try { accessSync(file, constants.X_OK); return true; }
  catch { return false; }
};
const cargoBin = path.join(env.CARGO_HOME || path.join(homedir(), '.cargo'), 'bin');
const rustupCargo = path.join(cargoBin, executable('cargo'));
const localNode = path.join(root, '.runtime', 'node_modules', 'node', 'bin', executable('node'));
const node = runnable(localNode) ? localNode : process.execPath;
const cargo = runnable(rustupCargo) ? rustupCargo : executable('cargo');
const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') || 'PATH';

// Integrated terminals can put the system's older Cargo ahead of Rustup.
// Use the matching rustc as well, and prefer this project's local Node.
env[pathKey] = [path.dirname(node), ...(runnable(rustupCargo) ? [cargoBin] : []), env[pathKey] || ''].join(path.delimiter);

const version = spawnSync(cargo, ['--version'], { cwd: root, env, encoding: 'utf8' });
if (version.error) {
  console.error(`Could not start Cargo (${cargo}): ${version.error.message}`);
  process.exit(1);
}
if (version.status !== 0) {
  process.stderr.write(version.stderr || 'Could not determine the active Rust toolchain.\n');
  process.exit(version.status || 1);
}
console.log(`[debug] ${version.stdout.trim()} (${cargo})`);

const run = (command, args) => {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' });
  if (result.error) {
    console.error(`Could not start ${command}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? (result.signal === 'SIGINT' ? 130 : 1));
};

run(node, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build']);
const args = process.argv.slice(2);
if (args[0] === '--build-only') {
  run(cargo, ['build', '--locked', '--manifest-path', 'src-tauri/Cargo.toml']);
} else {
  run(cargo, ['run', '--locked', '--manifest-path', 'src-tauri/Cargo.toml', '--',
    '--port', '3185', '--data-dir', '.cache/debug-profile', ...args]);
}
