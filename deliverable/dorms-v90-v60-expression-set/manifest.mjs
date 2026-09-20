import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { inspectGlb, sha256 } from '../dorms-v87-integrated-review-showcase/lib/glb-inspector.mjs';

export const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const WORKSPACE = path.resolve(ROOT, '../..');
export const V86 = path.join(WORKSPACE, 'deliverable/dorms-v86-approved-expression-set');
export const V89 = path.join(WORKSPACE, 'deliverable/dorms-v89-v60-neutral-face');

function localAssetPath(relativePath) {
  if (typeof relativePath !== 'string' || path.isAbsolute(relativePath)) {
    throw new Error('Portable relative expression path required');
  }
  const resolved = path.resolve(V86, relativePath);
  if (!resolved.startsWith(`${V86}${path.sep}`)) throw new Error('Expression path escapes V86 assets');
  return resolved;
}

export async function buildManifest() {
  const registry = JSON.parse(await readFile(path.join(V86, 'APPROVED-MANIFEST.json'), 'utf8'));
  if (registry.assets.length !== 34) throw new Error('Expected 34 approved expressions');

  const model = await inspectGlb(path.join(WORKSPACE, 'deliverable/dorms-v60-final-shoulder/models/basic.glb'));
  if (model.sha256 !== '00969b87595ee949d44fbe3f738ad028ee466c215cd64c825268bc01a2ec17d2') {
    throw new Error('V60 changed');
  }

  const basis = JSON.parse(await readFile(path.join(V89, 'reports/geometry-validation.json'), 'utf8'));
  if (!basis.pass) throw new Error('V89 correction failed');

  const pins = {
    'neutral-position-delta': '20e8b80c7f5f3d2c62db8aa41b60511c4a52190a6d93b0f65af177c8d739f540',
    'neutral-normal-delta': '48dcad24ead205fd43194efa9897d7a1fcc91261ba93da91eebf11c832670799',
  };
  const corrections = {};
  for (const name of Object.keys(pins)) {
    const file = path.join(V89, 'data', `${name}.bin`);
    corrections[name] = { path: file, sha256: sha256(await readFile(file)) };
    if (corrections[name].sha256 !== pins[name]) throw new Error(`V89 correction changed: ${name}`);
  }

  const assets = [];
  let topologyContract;
  for (const source of registry.assets) {
    const modelPath = localAssetPath(source.model);
    const texturePath = localAssetPath(source.texture);
    const qa = Object.fromEntries(Object.entries(source.qa).map(([angle, item]) => [angle, {
      ...item,
      path: localAssetPath(item.path),
    }]));
    const inspection = await inspectGlb(modelPath);
    const textureHash = sha256(await readFile(texturePath));
    if (!source.userApproved || inspection.sha256 !== source.modelSHA256 || textureHash !== source.textureSHA256) {
      throw new Error(`Approval/hash mismatch: ${source.id}`);
    }
    if (['thinking', 'oo'].includes(source.id) && source.version !== 'V84') {
      throw new Error(`V84 required: ${source.id}`);
    }
    const currentTopology = JSON.stringify([inspection.positionFingerprints, inspection.uvFingerprints]);
    topologyContract ??= currentTopology;
    if (currentTopology !== topologyContract) throw new Error(`Expression topology differs: ${source.id}`);

    const label = source.id === 'relieved' ? '기쁨' : source.id === 'shy' ? '부끄러움' : source.label;
    assets.push({
      ...source,
      model: modelPath,
      texture: texturePath,
      qa,
      label,
      modelUrl: `/assets/${source.id}/model.glb`,
      textureUrl: `/assets/${source.id}/texture.png`,
      referenceUrl: `/assets/${source.id}/reference.png`,
      topologyVerified: true,
      integrationStatus: 'REVIEW_REQUIRED',
    });
  }

  return {
    version: 'V90',
    checkedAt: new Date().toISOString(),
    model,
    geometry: basis,
    corrections,
    expressions: assets,
    count: assets.length,
    sourceApprovedCount: 34,
    integrationApprovedCount: 0,
    newMeshyRequests: 0,
    creditsConsumed: 0,
    releaseConnected: false,
    basisFeedback: '괜찮은데? 이런 식으로 쭉 진행하면 될듯?',
    scope: 'V89 correction fixed; 34 approved static expressions transferred to V60 for review',
  };
}

if (process.argv.includes('--audit')) {
  const manifest = await buildManifest();
  await mkdir(path.join(ROOT, 'reports'), { recursive: true });
  await writeFile(path.join(ROOT, 'reports/source-audit.json'), JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify({
    count: manifest.count,
    topologyVerified: manifest.expressions.every((asset) => asset.topologyVerified),
    corrections: manifest.corrections,
    releaseConnected: false,
  }, null, 2));
}
