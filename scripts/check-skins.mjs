import { build } from 'esbuild';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Bundle the TypeScript tests with the project's existing build dependency.
const result = await build({
  entryPoints: ['tests/skins.test.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const directory = await mkdtemp(path.join(tmpdir(), 'youterm-skin-tests-'));
try {
  const file = path.join(directory, 'skins.test.mjs');
  await writeFile(file, result.outputFiles[0].text);
  const run = spawnSync(process.execPath, [file], { stdio: 'inherit' });
  if (run.error) throw run.error;
  process.exitCode = run.status ?? 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}
