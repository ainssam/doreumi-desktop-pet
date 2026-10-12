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
    fetchRuntimeMotionLibrary: async () => {
      registryCalls++;
      if (registryCalls === 1) throw new Error('transient503');
      return { version: 1, motions: [27, 28].map(id => ({ id: `meshy:${id}`, url: `/doreumi/motions/meshy-${id}.json` })) };
    },
    fetch: async () => { assetCalls++; return { ok: true, headers: new Headers(), json: async () => data, text: async () => JSON.stringify(data) }; },
  });
  const load = vm.runInContext(ts.transpile(`let library, libraryRequest, fullLibraryRequest; const clipRequests = new Map(); ${declaration!.getText(source)}; loadAction;`, { target: ts.ScriptTarget.ES2022 }), context) as (id: string) => Promise<void>;
  const failed = await Promise.allSettled([load('meshy:27'), load('meshy:27')]);
  assert.ok(failed.every(item => item.status === 'rejected')); assert.equal(registryCalls, 1); assert.equal(assetCalls, 0);
  await Promise.all([load('meshy:27'), load('meshy:27')]);
  assert.equal(registryCalls, 2); assert.equal(assetCalls, 1); assert.deepEqual(registered, ['meshy:27']);
  await load('meshy:28'); await load('meshy:27');
  assert.equal(registryCalls, 2); assert.equal(assetCalls, 2); assert.deepEqual(registered, ['meshy:27', 'meshy:28']);
});

test('the page index serves every clip it lists; any other clip reads the full review registry once', async () => {
  let runtimeCalls = 0, fullCalls = 0;
  const registered: string[] = [], fetched: string[] = [];
  const data = THREE.AnimationClip.toJSON(new THREE.AnimationClip('source', 1, [new THREE.QuaternionKeyframeTrack('head.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1])]));
  const entry = (id: number) => ({ id: `meshy:${id}`, url: `/doreumi/motions/meshy-${id}.json` });
  const context = vm.createContext({
    THREE, signal: new AbortController().signal, disposed: false, boundedMotionText, MOTION_CLIP_MAX_BYTES,
    motion: { hasClip: (id: string) => registered.includes(id), registerClip: (clip: THREE.AnimationClip) => registered.push(clip.name) },
    fetchRuntimeMotionLibrary: async () => { runtimeCalls++; return { version: 1, motions: [entry(27)] }; },
    fetchMotionLibrary: async () => { fullCalls++; return { version: 1, motions: [entry(27), entry(400), entry(401)] }; },
    fetch: async (url: string) => { fetched.push(url); return { ok: true, headers: new Headers(), json: async () => data, text: async () => JSON.stringify(data) }; },
  });
  const load = vm.runInContext(ts.transpile(`let library, libraryRequest, fullLibraryRequest; const clipRequests = new Map(); ${declaration!.getText(source)}; loadAction;`, { target: ts.ScriptTarget.ES2022 }), context) as (id: string) => Promise<void>;
  await load('meshy:27');
  assert.equal(runtimeCalls, 1); assert.equal(fullCalls, 0, 'a listed clip never downloads the full registry');
  await Promise.all([load('meshy:400'), load('meshy:401')]);
  assert.equal(fullCalls, 1, 'concurrent misses share one full registry read');
  await assert.rejects(load('meshy:999'), /not acquired/);
  assert.equal(fullCalls, 1, 'the full registry is read at most once');
  assert.deepEqual(registered, ['meshy:27', 'meshy:400', 'meshy:401']);
  assert.deepEqual(fetched, ['/doreumi/motions/meshy-27.json', '/doreumi/motions/meshy-400.json', '/doreumi/motions/meshy-401.json']);
});

test('first-frame readiness requires an actual model draw on an available graphics context', () => {
  let method: ts.MethodDeclaration | undefined;
  function find(node: ts.Node) {
    if (ts.isMethodDeclaration(node) && node.name.getText(source) === 'renderFirstFrame') method = node;
    ts.forEachChild(node, find);
  }
  find(source); assert.ok(method);
  const code = ts.transpile(`({ ${method.getText(source)} }).renderFirstFrame`, { target: ts.ScriptTarget.ES2022 });
  for (const failure of ['none', 'disposed', 'lost', 'lost-during-draw', 'no-draws', 'no-triangles']) {
    let draws = 0, lost = failure === 'lost';
    const info = { render: { calls: 0, triangles: 0 } };
    const frame = vm.runInNewContext(code, {
      disposed: failure === 'disposed', renderer: { getContext: () => ({ isContextLost: () => lost }), info },
      resize() { draws++; info.render.calls = failure === 'no-draws' ? 0 : 1; info.render.triangles = failure === 'no-triangles' ? 0 : 100; lost = failure === 'lost-during-draw'; },
    });
    if (failure === 'none') assert.doesNotThrow(frame);
    else assert.throws(frame, /Doreumi .+ unavailable/, failure);
    assert.equal(draws, ['disposed', 'lost'].includes(failure) ? 0 : 1, failure);
  }
});

function deferred<T = void>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const avatarCode = ts.transpileModule(fs.readFileSync(new URL('../src/components/doreumi/DoreumiAvatar.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
type RenderNode = { type: string; props: { children?: unknown; ref?: { current: unknown }; style?: { opacity: number }; [key: string]: unknown } };
type HookSlot = { current?: unknown; value?: unknown; deps?: unknown[]; cleanup?: void | (() => void) };

/** Run the actual component and effects with independently controlled model, clothing and texture completion. */
function avatarHarness({ hold = false, frameFails = false } = {}) {
  const model = deferred<typeof renderer>(), clothing = deferred(), texture = deferred();
  const statuses: string[] = [], calls: string[] = [], slots: HookSlot[] = [], effects: (() => void)[] = [];
  const canvas = new EventTarget();
  let index = 0, dirty = true, mounted = true, tree: RenderNode, signal: AbortSignal | undefined, creates = 0, ready = 0;
  const renderer = {
    setViewZoom() {}, setAction() {}, setFacing() {}, setActive() {}, setVisible() {}, setLocomotionRate() {},
    async setDress() { calls.push('dress'); await clothing.promise; },
    async setExpression() { calls.push('expression'); await texture.promise; },
    renderFirstFrame() { calls.push('frame'); if (frameFails) throw new Error('Frame unavailable'); },
    dispose() { calls.push('dispose'); },
  };
  let props = { hold, dress: { items: [] }, onStatusChange: (value: string) => statuses.push(value), onReady: () => { ready++; } };
  const react = {
    forwardRef: (component: unknown) => component,
    useRef(value: unknown) { const i = index++; return slots[i] ??= { current: value }; },
    useState(value: unknown) {
      const i = index++; slots[i] ??= { value };
      return [slots[i].value, (next: unknown) => {
        assert.ok(mounted, 'An abandoned load must not update unmounted state');
        const resolved = typeof next === 'function' ? next(slots[i].value) : next;
        if (!Object.is(resolved, slots[i].value)) { slots[i].value = resolved; dirty = true; }
      }];
    },
    useImperativeHandle() {},
    useEffect(callback: () => void | (() => void), deps: unknown[]) {
      const i = index++, prior = slots[i];
      if (!prior || deps.some((value, j) => !Object.is(value, prior.deps?.[j]))) {
        slots[i] = { deps, cleanup: prior?.cleanup };
        effects.push(() => { if (typeof slots[i].cleanup === 'function') slots[i].cleanup(); slots[i].cleanup = callback(); });
      }
    },
  };
  const context = { exports: {} as { DoreumiAvatar: (props: unknown) => RenderNode }, AbortController,
    console: { warn() {} }, IntersectionObserver: class { observe() {} disconnect() {} },
    require(name: string) {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx: (type: string, props: RenderNode['props']) => ({ type, props }), jsxs: (type: string, props: RenderNode['props']) => ({ type, props }) };
      if (name === '@/lib/doreumi/items') return { dressKey: JSON.stringify };
      if (name === '@/lib/doreumi/motion-runtime') return { createDoreumiRenderer: (_canvas: unknown, nextSignal: AbortSignal) => { creates++; signal = nextSignal; return model.promise; } };
      throw new Error(`Unexpected module ${name}`);
    },
  };
  vm.runInNewContext(avatarCode, context);
  function nodes(node: unknown, result: RenderNode[] = []) {
    if (Array.isArray(node)) { node.forEach(child => nodes(child, result)); return result; }
    if (!node || typeof node !== 'object' || !('type' in node)) return result;
    const element = node as RenderNode; result.push(element); nodes(element.props.children, result); return result;
  }
  function flush() {
    let loops = 0;
    while (dirty && mounted) {
      assert.ok(++loops < 15); dirty = false; index = 0; tree = context.exports.DoreumiAvatar(props);
      nodes(tree).find(node => node.type === 'canvas')!.props.ref!.current = canvas;
      for (const effect of effects.splice(0)) effect();
    }
  }
  flush();
  return {
    model, clothing, texture, renderer, statuses, calls,
    get creates() { return creates; }, get ready() { return ready; }, get signal() { return signal; },
    get status() { return tree.props['data-doreumi-avatar']; },
    get fallback() { return nodes(tree).some(node => node.type === 'img'); },
    get opacity() { return nodes(tree).find(node => node.type === 'canvas')!.props.style!.opacity; },
    async settle() { await new Promise(resolve => setImmediate(resolve)); flush(); },
    release() { props = { ...props, hold: false }; dirty = true; flush(); },
    loseContext() { const event = new Event('webglcontextlost', { cancelable: true }); canvas.dispatchEvent(event); assert.ok(event.defaultPrevented); flush(); },
    restoreContext() { canvas.dispatchEvent(new Event('webglcontextrestored')); flush(); },
    unmount() { for (const slot of slots) if (typeof slot?.cleanup === 'function') slot.cleanup(); mounted = false; },
  };
}

test('held and delayed model, clothing and face loads remain blank until the first 3D frame', async () => {
  const h = avatarHarness({ hold: true }); await h.settle();
  assert.equal(h.creates, 0); assert.equal(h.status, 'loading'); assert.equal(h.fallback, false); assert.equal(h.opacity, 0);
  h.release(); await h.settle(); assert.equal(h.creates, 1);
  h.model.resolve(h.renderer); await h.settle(); assert.deepEqual(h.calls, ['dress']); assert.equal(h.fallback, false);
  h.clothing.resolve(); await h.settle(); assert.deepEqual(h.calls, ['dress', 'expression']); assert.equal(h.status, 'loading'); assert.equal(h.ready, 0);
  h.texture.resolve(); await h.settle();
  assert.deepEqual(h.calls, ['dress', 'expression', 'frame']); assert.deepEqual(h.statuses, ['loading', 'ready']);
  assert.equal(h.ready, 1); assert.equal(h.opacity, 1); assert.equal(h.fallback, false); h.unmount();
});

test('only an actual model or first-frame failure enables the approved fallback', async () => {
  for (const frameFails of [false, true]) {
    const h = avatarHarness({ frameFails }); await h.settle();
    if (frameFails) { h.model.resolve(h.renderer); h.clothing.resolve(); h.texture.resolve(); }
    else h.model.reject(new Error('Asset unavailable'));
    await h.settle(); assert.equal(h.status, 'fallback'); assert.equal(h.fallback, true); assert.equal(h.opacity, 0); assert.equal(h.ready, 0);
    assert.deepEqual(h.statuses, ['loading', 'fallback']); h.unmount();
  }
});

test('context loss aborts a pending appearance load and restoration can recover once', async () => {
  const h = avatarHarness(); await h.settle(); h.model.resolve(h.renderer); h.clothing.resolve(); await h.settle();
  h.loseContext(); assert.equal(h.signal?.aborted, true); assert.equal(h.status, 'fallback');
  h.texture.resolve(); await h.settle(); assert.equal(h.ready, 0); assert.equal(h.calls.includes('frame'), false);
  h.restoreContext(); assert.equal(h.status, 'loading'); assert.equal(h.fallback, false); await h.settle();
  assert.equal(h.creates, 2); assert.equal(h.status, 'ready'); assert.equal(h.ready, 1);
  h.loseContext(); h.restoreContext(); await h.settle(); assert.equal(h.creates, 2); assert.equal(h.status, 'fallback'); h.unmount();
});

test('unmount while the model or appearance is pending never announces readiness', async () => {
  for (const loadedModel of [false, true]) {
    const h = avatarHarness(); await h.settle();
    if (loadedModel) { h.model.resolve(h.renderer); await h.settle(); }
    h.unmount(); h.model.resolve(h.renderer); h.clothing.resolve(); h.texture.resolve(); await h.settle();
    assert.equal(h.ready, 0); assert.equal(h.calls.includes('frame'), false); assert.ok(h.calls.includes('dispose'));
  }
});
