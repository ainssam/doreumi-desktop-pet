import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const v86 = path.join(root, 'deliverable/dorms-v86-approved-expression-set');
const manifest = JSON.parse(await readFile(path.join(v86, 'APPROVED-MANIFEST.json'), 'utf8'));
const validation = JSON.parse(await readFile(path.join(v86, 'HASH-VALIDATION.json'), 'utf8'));
assert.equal(manifest.count, 34, 'V86 must contain exactly 34 approved static expressions');
assert.equal(manifest.assets.length, 34);
assert.equal(validation.checks.length, 172, 'approval chain and asset hash count changed');

for (const check of validation.checks) {
  assert.equal(check.pass, true, `recorded approval hash did not pass: ${check.path}`);
  assert.ok(!path.isAbsolute(check.path), `handoff path must be relative: ${check.path}`);
  const file = path.resolve(v86, ...check.path.split('/'));
  const actualPath = await realpath(file);
  assert.ok(actualPath.startsWith(await realpath(v86) + path.sep), `asset path escapes V86 package: ${check.path}`);
  const actual = createHash('sha256').update(await readFile(file)).digest('hex');
  assert.equal(actual, check.sha256, `SHA-256 mismatch: ${check.path}`);
}

for (const asset of manifest.assets) {
  assert.equal(asset.userApproved, true, `${asset.id} is not user-approved`);
  assert.ok(!path.isAbsolute(asset.model));
  assert.ok(!path.isAbsolute(asset.texture));
  for (const [angle, image] of Object.entries(asset.qa)) {
    assert.ok(!path.isAbsolute(image.path), `${asset.id}/${angle} is not portable`);
  }
}
for (const id of ['thinking', 'oo']) {
  assert.equal(manifest.assets.find((asset) => asset.id === id)?.version, 'V84', `${id} must use its V84 revision`);
}
console.log(`Verified V86: ${manifest.assets.length} approved static expressions; ${validation.checks.length}/${validation.checks.length} SHA-256 checks passed.`);
