import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testsDir = path.join(root, 'deliverable/dorms-v98-badge-integration/tests');
const files = readdirSync(testsDir).filter((name) => name.endsWith('.test.mjs')).map((name) => path.join(testsDir, name));
const result = spawnSync(process.execPath, ['--test', '--test-isolation=none', ...files], { cwd: root, stdio: 'inherit' });
process.exit(result.status ?? 1);
