import { build } from 'esbuild';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const result = await build({
  entryPoints: ['tests/shortcuts.test.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
});
const directory = await mkdtemp(path.join(tmpdir(), 'youterm-shortcut-tests-'));
try {
  const file = path.join(directory, 'shortcuts.test.cjs');
  await writeFile(file, result.outputFiles[0].text);
  const run = spawnSync(process.execPath, [file], { stdio: 'inherit' });
  if (run.error) throw run.error;
  process.exitCode = run.status ?? 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}
