import { boundedMotionText, MOTION_CLIP_MAX_BYTES } from '../src/lib/doreumi/motion-library.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as THREE from 'three';

const source = ts.createSourceFile('runtime.ts', fs.readFileSync(new URL('../src/lib/doreumi/motion-runtime.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
let declaration: ts.FunctionDeclaration | undefined;
function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'loadAction') declaration = node;
  ts.forEachChild(node, visit);
}
visit(source);
assert.ok(declaration, 'The renderer must expose its actual lazy loading path');

test('a transient registry failure can retry, concurrent requests share work, and success is cached', async () => {
  let registryCalls = 0, assetCalls = 0;
  const registered: string[] = [];
  const data = THREE.AnimationClip.toJSON(new THREE.AnimationClip('source', 1, [new THREE.QuaternionKeyframeTrack('head.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1])]));
  const context = vm.createContext({
    THREE, signal: new AbortController().signal, disposed: false, boundedMotionText, MOTION_CLIP_MAX_BYTES,
    motion: { hasClip: (id: string) => registered.includes(id), registerClip: (clip: THREE.AnimationClip) => registered.push(clip.name) },
    fetchMotionLibrary: async () => {
      registryCalls++;
      if (registryCalls === 1) throw new Error('transient503');
      return { version: 1, motions: [27, 28].map(id => ({ id: `meshy:${id}`, url: `/doreumi/motions/meshy-${id}.json` })) };
    },
    fetch: async () => { assetCalls++; return { ok: true, headers: new Headers(), json: async () => data, text: async () => JSON.stringify(data) }; },
  });
  const load = vm.runInContext(ts.transpile(`let library, libraryRequest; const clipRequests = new Map(); ${declaration!.getText(source)}; loadAction;`, { target: ts.ScriptTarget.ES2022 }), context) as (id: string) => Promise<void>;
  const failed = await Promise.allSettled([load('meshy:27'), load('meshy:27')]);
  assert.ok(failed.every(item => item.status === 'rejected')); assert.equal(registryCalls, 1); assert.equal(assetCalls, 0);
  await Promise.all([load('meshy:27'), load('meshy:27')]);
  assert.equal(registryCalls, 2); assert.equal(assetCalls, 1); assert.deepEqual(registered, ['meshy:27']);
  await load('meshy:28'); await load('meshy:27');
  assert.equal(registryCalls, 2); assert.equal(assetCalls, 2); assert.deepEqual(registered, ['meshy:27', 'meshy:28']);
});
