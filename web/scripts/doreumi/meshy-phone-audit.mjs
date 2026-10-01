/** Actual rendered phone pose versus every deformed skin triangle.
 * Run with: node --import ./tests/register-alias.mjs scripts/doreumi/meshy-phone-audit.mjs ...
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as THREE from 'three';
import { loadDoreumiAsset } from './rig-utils.mjs';
import { measureSkinBox } from './meshy-skin-box.mjs';
import { PHONE_PALM_CONTACTS } from '../../src/lib/doreumi/motion-phone-contact.ts';
import { createDoreumiContextProps } from '../../src/lib/doreumi/motion-context-props.ts';

const args = new Map(process.argv.slice(2).map(value => { const i = value.indexOf('='); return [value.slice(2, i), value.slice(i + 1)]; }));
const manifestFile = args.get('manifest'), modelFile = args.get('model'), output = args.get('output');
const fps = Number(args.get('fps') ?? 120), ids = (args.get('actions') ?? '').split(',').map(Number);
if (!manifestFile || !modelFile || !output || !Number.isFinite(fps) || fps < 30 || fps > 240 || !ids.length || ids.some(id => ![29,50,122,124,312,676,693].includes(id))) throw new Error('Explicit phone candidate, model, IDs, output and bounded FPS are required.');
const read = file => JSON.parse(fs.readFileSync(file)), sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const manifest = read(manifestFile), modelSha256 = sha(modelFile), asset = await loadDoreumiAsset(modelFile);
const sourceRoot = fs.realpathSync('.artifacts/doreumi-meshy'), ledger = read(path.join(sourceRoot, 'ledger.json'));
const contract = read('public/doreumi/rig-contract.json');
const holder = new THREE.Group(); holder.add(asset.scene);
const props = createDoreumiContextProps({ model: asset.scene, parent: holder }), mixer = new THREE.AnimationMixer(asset.scene);
const records = asset.skinned.map(({ object }) => ({ object, points: new Float64Array(object.geometry.attributes.position.count * 3) }));
const report = { version: 2, collisionBasis: 'every-phone-mesh-local-bounds versus exact-deformed-skin-triangles; sphere bounds conservatively included', fps, modelSha256, manifestSha256: sha(manifestFile), runtimeSha256: sha('src/lib/doreumi/motion-context-props.ts'), contactFrameSha256: sha('src/lib/doreumi/motion-phone-contact.ts'), clips: [] };
try {
  for (const id of ids) {
    const entry = manifest.motions.find(entry => entry.actionId === id), evidence = entry?.retargetEvidence;
    if (!entry || evidence?.masterSha256 !== modelSha256 || evidence.phoneContact?.masterSha256 !== modelSha256 || evidence.phoneContact?.palmFrame !== true) throw new Error('Phone audit candidate/master/contact-frame provenance mismatch.');
    const sourceId = entry.derivation?.baseSourceActionId ?? id;
    const batch = ledger.batches.find(batch => batch.actionIds?.includes(sourceId) && batch.file);
    if (!batch) throw new Error('Phone audit acquired donor missing.');
    const sourceFile = fs.realpathSync(path.join(sourceRoot, batch.file));
    if (!sourceFile.startsWith(sourceRoot + path.sep) || !sourceFile.endsWith('.glb') || sha(sourceFile) !== entry.sourceSha256 || evidence.phoneContact.sourceSha256 !== entry.sourceSha256 || entry.targetRigSignature !== contract.rigSignature) throw new Error('Phone audit source/rig provenance mismatch.');
    const file = path.resolve('public', entry.url), clipSha256 = sha(file);
    if (clipSha256 !== entry.convertedSha256) throw new Error('Phone audit clip SHA mismatch.');
    const clip = THREE.AnimationClip.parse(read(file));
    mixer.stopAllAction(); const action = mixer.clipAction(clip).reset().play(); action.setLoop(THREE.LoopOnce, 0); action.clampWhenFinished = true;
    props.setMotion({ sourceActionId: id, props: ['phone'], entryDuration: evidence.entryDuration, exitDuration: evidence.exitDuration });
    const row = { actionId: id, clipSha256, sourceSha256: entry.sourceSha256, visibleFrames: 0, sourceFrames: 0, intersectionFrames: 0, sourceIntersectionFrames: 0, maximumVerticesInside: 0, maximumIntersectingTriangles: 0, maximumGripError: 0, minimumHeadFacingDot: 1, minimumTapGap: null, maximumTapGoalError: 0, tapOutsideDisplayFrames: 0, failures: [] };
    for (let sample = 0; sample <= Math.ceil(clip.duration * fps); sample++) {
      const time = Math.min(sample / fps, clip.duration), sourceTime = time - evidence.entryDuration;
      mixer.setTime(time); holder.updateMatrixWorld(true); asset.skinned.forEach(({ object }) => object.skeleton.update());
      props.update({ time, duration: clip.duration }); holder.updateMatrixWorld(true);
      const phone = holder.getObjectByName('Doreumi_context_phone'); if (!phone?.visible) continue;
      const body = phone.children[0], inverse = body.matrixWorld.clone().invert(), source = sourceTime >= 0 && sourceTime <= evidence.sourceDuration;
      row.visibleFrames++; if (source) row.sourceFrames++;
      let verticesInside = 0, intersectingTriangles = 0; const collisionTriangles = [];
      const parts = body.children.filter(part => part instanceof THREE.Mesh);
      if (parts.length !== 7) throw new Error('Phone physical component set changed; audit requires review.');
      for (const [component, part] of parts.entries()) {
        part.geometry.computeBoundingBox();
        const box = part.geometry.boundingBox?.clone().expandByScalar(-1e-7);
        if (!box || box.isEmpty()) throw new Error('Phone component bounds missing.');
        const componentInverse = part.matrixWorld.clone().invert();
        for (const { object, points } of records) {
        const measured = measureSkinBox(object, componentInverse, box, points);
        verticesInside += measured.verticesInside; intersectingTriangles += measured.intersectingTriangles;
        for (const collision of measured.collisions) if (collisionTriangles.length < 6) {
          const weights = collision.vertices.map(v => Array.from({length:4}, (_,j) => ({bone:object.skeleton.bones[object.geometry.attributes.skinIndex.getComponent(v,j)].name, weight:object.geometry.attributes.skinWeight.getComponent(v,j)})).filter(x=>x.weight>.01));
          collisionTriangles.push({...collision, component, geometry: part.geometry.type, weights});
        }
      }
      }
      const contacts = props.inspect().contacts;
      if (contacts.length !== 1) throw new Error('Visible phone requires exactly one measured palm contact.');
      const contact = contacts[0], rear = new THREE.Vector3(...contact.propPoint).applyMatrix4(inverse);
      const texting = [122, 676].includes(id);
      if (texting ? Math.abs(rear.x - .075) > 1e-6 || Math.abs(rear.z) > 1e-6 || Math.abs(rear.y) > 1e-6 : Math.abs(rear.z + .0175) > 1e-6 || Math.abs(rear.x) > .075 || rear.y < -.105 || rear.y > .145) throw new Error('Phone contact left its rigid case.');
      if (texting && source) {
        const mesh = asset.skinned.find(({ object }) => object.name === 'Doreumi').object;
        let tap = mesh.getVertexPosition(PHONE_PALM_CONTACTS[0].vertex, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse);
        const surfaceTap = evidence.phoneContact.tapContact === 'actual-wrist-skin-support-plane';
        if (surfaceTap) {
          const attrs = mesh.geometry.attributes;
          for (let vertex = 0; vertex < attrs.position.count; vertex++) {
            let weight = 0;
            for (let j = 0; j < 4; j++) if (mesh.skeleton.bones[attrs.skinIndex.getComponent(vertex, j)].name === 'wristL') weight += attrs.skinWeight.getComponent(vertex, j);
            if (weight < .5) continue;
            const point = mesh.getVertexPosition(vertex, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse);
            if (point.z < tap.z) tap = point;
          }
          if (Math.abs(tap.x) > .062 || Math.abs(tap.y - .026) > .098) row.tapOutsideDisplayFrames++;
        }
        const expected = new THREE.Vector3(-.055, 0, .0205 + (surfaceTap ? .0005 : 0) + .012 * Math.sin(2 * Math.PI * sourceTime / evidence.sourceDuration) ** 2);
        row.maximumTapGoalError = Math.max(row.maximumTapGoalError, surfaceTap ? Math.abs(tap.z - expected.z) : tap.distanceTo(expected));
        row.minimumTapGap = Math.min(row.minimumTapGap ?? Infinity, tap.z - .0205);
      }
      row.maximumGripError = Math.max(row.maximumGripError, Math.abs(contact.distance - .017));
      const screen = body.children[1], normal = new THREE.Vector3(0,0,1).transformDirection(screen.matrixWorld);
      const headDirection = asset.scene.getObjectByName('head').getWorldPosition(new THREE.Vector3()).sub(screen.getWorldPosition(new THREE.Vector3())).normalize();
      if (source) row.minimumHeadFacingDot = Math.min(row.minimumHeadFacingDot, normal.dot(headDirection));
      row.maximumVerticesInside = Math.max(row.maximumVerticesInside, verticesInside);
      row.maximumIntersectingTriangles = Math.max(row.maximumIntersectingTriangles, intersectingTriangles);
      if (verticesInside || intersectingTriangles) {
        row.intersectionFrames++; if (source) row.sourceIntersectionFrames++;
        row.failures.push({ time, sourceTime, phase: source ? 'source' : sourceTime < 0 ? 'entry' : 'recovery', verticesInside, intersectingTriangles, collisionTriangles });
      }
    }
    report.clips.push(row); fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ ...row, failures: row.failures.length }));
  }
} finally { props.dispose(); }
if (report.clips.some(row => row.intersectionFrames || row.maximumGripError > 1e-6 || row.maximumTapGoalError > .001 || row.tapOutsideDisplayFrames)) process.exitCode = 1;
