import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { buildManifest as buildV90 } from '../dorms-v90-v60-expression-set/manifest.mjs';
import { sha256 } from '../dorms-v87-integrated-review-showcase/lib/glb-inspector.mjs';
import { validateApproval } from './src/approval.mjs';
import { approvedActions } from './src/action-policy.mjs';
import { PROP_SLOTS } from './src/prop-catalog.mjs';
import { validateBadgeManifest } from './src/badge-catalog.mjs';

export const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const WORKSPACE = path.resolve(ROOT, '../..');

const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const packaged = (...parts) => path.resolve(WORKSPACE, ...parts);

export async function buildManifest() {
  const manifest = await buildV90();
  const expressionApproval = await readJson(path.join(WORKSPACE, 'deliverable/dorms-v90-v60-expression-set/USER-APPROVAL.json'));
  validateApproval(expressionApproval, manifest);
  if (expressionApproval.model.sha256 !== manifest.model.sha256) throw new Error('승인 V60 불일치');
  for (const [name, correction] of Object.entries(manifest.corrections)) {
    if (expressionApproval.corrections[name]?.sha256 !== correction.sha256) throw new Error('승인 보정값 불일치');
  }

  const catalog = await readJson(path.join(WORKSPACE, 'deliverable/dorms-v48-premium-props/props-catalog.json'));
  const slotIds = Object.keys(PROP_SLOTS);
  const actionRecord = await readJson(path.join(ROOT, 'ACTION-APPROVAL.json'));
  const actions = approvedActions(actionRecord, manifest.model.sha256);
  const props = [];

  for (const item of catalog.items) {
    const model = path.resolve(WORKSPACE, 'deliverable/dorms-v48-premium-props', item.generation.file);
    props.push({
      id: item.id,
      label: item.name,
      version: 'V48',
      slot: PROP_SLOTS[item.id] ?? null,
      model,
      modelUrl: `/props/${item.id}.glb`,
      sha256: sha256(await readFile(model)),
      sourceApproval: 'candidate',
      attachmentStatus: slotIds.includes(item.id) ? 'fitting' : 'comparison-only',
      visualReview: item.visualReview,
    });
  }
  for (const [id, label] of [['laptop', '코딩 컴퓨터'], ['book-v3', '책 · 수정 V3']]) {
    const model = packaged('deliverable/dorms-v42-character-rig/props', `${id}.glb`);
    props.push({
      id,
      label,
      version: 'V42',
      slot: 'scene',
      model,
      modelUrl: `/props/${id}.glb`,
      sha256: sha256(await readFile(model)),
      sourceApproval: 'candidate',
      attachmentStatus: 'placement-review',
      visualReview: '기존 사용본 복구; V60 새 조합 검수 필요',
    });
  }

  const propTextureReport = await readJson(path.join(ROOT, 'reports/prop-textures.json'));
  for (const prop of props.filter((item) => item.slot)) {
    const report = propTextureReport[prop.id];
    const runtime = path.join(ROOT, 'data/prop-textures', `${prop.id}.png`);
    if (!report || report.sourceSHA256 !== prop.sha256 || sha256(await readFile(runtime)) !== report.runtimeSHA256) {
      throw new Error(`소품 런타임 텍스처 출처 불일치: ${prop.id}`);
    }
    prop.runtimeTexture = { ...report, runtime };
  }

  const badgeSource = await readJson(path.join(WORKSPACE, 'deliverable/dorms-v97-badge-collection/integration-manifest.json'));
  const badgeEntries = validateBadgeManifest(badgeSource);
  const badgeTextureReport = await readJson(path.join(ROOT, 'reports/badge-textures.json'));
  const badges = [];
  for (const item of badgeEntries) {
    const model = packaged('deliverable/dorms-v97-badge-collection', item.model);
    const actual = sha256(await readFile(model));
    const report = badgeTextureReport[item.id];
    const runtime = path.join(ROOT, 'data/badge-textures', `${item.id}.png`);
    if (actual !== item.sha256) throw new Error(`배지 원본 해시 불일치: ${item.id}`);
    if (!report || report.sourceSHA256 !== actual || sha256(await readFile(runtime)) !== report.runtimeSHA256) {
      throw new Error(`배지 런타임 텍스처 출처 불일치: ${item.id}`);
    }
    badges.push({
      id: item.id,
      label: item.name,
      mission: item.mission,
      color: item.color,
      version: 'V97',
      model,
      modelUrl: `/badges/${item.id}.glb`,
      sha256: actual,
      sourceApproval: 'candidate',
      attachmentStatus: 'review-required',
      runtimeTexture: { ...report, runtime },
    });
  }

  const seasons = [];
  for (const id of ['spring', 'summer', 'autumn', 'winter']) {
    const texture = packaged('deliverable/dorms-seasonal-meshy/textures/runtime', `${id}.png`);
    seasons.push({ id, texture, textureUrl: `/seasons/${id}.png`, sha256: sha256(await readFile(texture)) });
  }

  return {
    ...manifest,
    version: 'V98',
    expressions: manifest.expressions.map((asset) => ({ ...asset, integrationStatus: 'USER_APPROVED' })),
    integrationApprovedCount: 34,
    actions,
    actionApprovedCount: 21,
    props,
    badges,
    badgeCount: 20,
    seasons,
    desktopIntegration: true,
    releaseConnected: true,
    releaseComplete: false,
  };
}
