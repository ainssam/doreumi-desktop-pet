// Portable CPU execution of the production stable-camera AST using actual Three projections.
// No browser, assets, credentials, network, database or hosted writes.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as THREE from "three";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const transpile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const catalog = { exports: {} };
vm.runInNewContext(transpile(read("src/lib/doreumi/motion-catalog.ts")), { module: catalog, exports: catalog.exports });
const { doreumiFrame } = catalog.exports;
const runtime = read("src/lib/doreumi/motion-runtime.ts");
const ast = ts.createSourceFile("motion-runtime.ts", runtime, ts.ScriptTarget.Latest, true);
let stableBranch, defaultFit, stableMargins;
const helpers = [];
function visit(node) {
  if (ts.isFunctionDeclaration(node) && ["visibleBounds", "tiltedFrameHalfHeight"].includes(node.name?.text)) helpers.push(node.getText(ast).replace(/^export\s+/, ""));
  if (ts.isIfStatement(node) && node.expression.getText(ast) === "stable") stableBranch = node;
  if (ts.isFunctionDeclaration(node) && node.name?.text === "createDoreumiRenderer") defaultFit = node.parameters.find(param => param.name.getText(ast) === "fitDress");
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "DOREUMI_STABLE_FRAMING") stableMargins = node.initializer;
  ts.forEachChild(node, visit);
}
visit(ast); assert.ok(stableBranch && defaultFit && stableMargins && helpers.length === 2);
// The production helpers the stable branch calls when the preview is tilted (visibleBounds, tiltedFrameHalfHeight).
const helperScope = { THREE };
vm.runInNewContext(`${transpile(helpers.join("\n"))}\nthis.visibleBounds = visibleBounds; this.tiltedFrameHalfHeight = tiltedFrameHalfHeight;`, helperScope);
const stable = vm.runInNewContext(`(${stableMargins.getText(ast)})`);
const source = transpile(stableBranch.getText(ast));
const box = (min = [-1.928, 0.05, -0.8], max = [1.928, 2.5, 0.8]) => new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max));

function fixture({ width = 300, height = 320, fitDress = true, bounds = box(), meshes = [], viewTilt = 0 } = {}) {
  const model = new THREE.Group(); for (const mesh of meshes) model.add(mesh);
  const context = { stable, width, height, fitDress, model, dressItems: [{}], dressFitBounds: bounds, dressRigidMeshes: meshes, dressFitHalfHeight: 0, cameraHalfHeight: 0, cameraCenterY: 0, cameraCenterZ: 0, cameraOffset: 0, cameraTracking: true, doreumiFrame,
    viewTilt, tiltFitBounds: null, tiltFitAction: "", state: { action: "Idle" }, THREE, visibleBounds: helperScope.visibleBounds, tiltedFrameHalfHeight: helperScope.tiltedFrameHalfHeight };
  vm.createContext(context);
  return { context, run() { vm.runInContext(source, context); return context; } };
}
const expectedBase = context => {
  const scaleY = 1 + stable.top + stable.bottom;
  const aspect = (context.width / (1 + 2 * stable.side)) / (context.height / scaleY);
  const standing = doreumiFrame("Idle", aspect);
  return { height: standing.halfHeight * scaleY, centerY: standing.centerY + (stable.top - stable.bottom) * standing.halfHeight };
};
function assertProjectedInside(context, bounds) {
  const camera = new THREE.OrthographicCamera(0, 0, context.cameraHalfHeight, -context.cameraHalfHeight, 0.01, 30);
  camera.left = -context.cameraHalfHeight * context.width / context.height; camera.right = -camera.left;
  const scaleY = 1 + stable.top + stable.bottom, el = context.viewTilt;
  for (let angle = 0; angle < 360; angle += 15) {
    const radians = angle * Math.PI / 180;
    // The runtime's orbit: target is the frame center shifted along the screen up by the box offset; up turns with the tilt.
    const up = new THREE.Vector3(-Math.sin(radians) * Math.sin(el), Math.cos(el), -Math.cos(radians) * Math.sin(el));
    const target = new THREE.Vector3(0, context.cameraCenterY, 0).addScaledVector(up, context.cameraOffset);
    camera.up.copy(up);
    camera.position.set(Math.sin(radians) * Math.cos(el), Math.sin(el), Math.cos(radians) * Math.cos(el)).multiplyScalar(6).add(target);
    camera.lookAt(target); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
      const point = new THREE.Vector3(x, y, z).project(camera);
      // Map the overflowing canvas back into the visible avatar box's coordinates.
      const avatarX = point.x * (1 + 2 * stable.side), avatarY = point.y * scaleY + stable.top - stable.bottom;
      assert.ok(Math.abs(avatarX) <= 0.9000001, `angle ${angle}: horizontal edge ${avatarX}`);
      assert.ok(Math.abs(avatarY) <= 0.9000001, `angle ${angle}: vertical edge ${avatarY}`);
    }
  }
}

test("renderer fitDress defaults off and the host's stable standing size and foot framing stay exact", () => {
  assert.equal(defaultFit.initializer.kind, ts.SyntaxKind.FalseKeyword);
  const h = fixture({ fitDress: false, bounds: box([-100, -100, -100], [100, 100, 100]) });
  const expected = expectedBase(h.context), actual = h.run();
  assert.equal(actual.cameraHalfHeight, expected.height); assert.equal(actual.cameraCenterY + actual.cameraOffset, expected.centerY); assert.equal(actual.cameraTracking, false); assert.equal(actual.cameraCenterZ, 0); assert.equal(actual.dressFitHalfHeight, 0);
});

test("preview camera holds every corner of wide accessories at all 24 viewing angles across narrow and wide aspects", () => {
  for (const [width, height] of [[150, 320], [300, 320], [900, 450], [1500, 400]]) {
    const h = fixture({ width, height }); const actual = h.run();
    assert.ok(Number.isFinite(actual.cameraHalfHeight)); assertProjectedInside(actual, actual.dressFitBounds);
  }
});

test("moving rigid accessories use fresh world transforms and the largest frame does not pulse after they return", () => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.5, 0.1), new THREE.MeshBasicMaterial()); mesh.geometry.computeBoundingBox();
  const h = fixture({ bounds: box([-0.5, 0.5, -0.2], [0.5, 1.5, 0.2]), meshes: [mesh] }); mesh.position.set(0.4, 1.3, 0);
  const before = h.run().cameraHalfHeight; mesh.position.set(3, 2.5, 1); const expanded = h.run().cameraHalfHeight;
  assert.ok(expanded > before); assertProjectedInside(h.context, mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld));
  mesh.position.set(0.4, 1.3, 0); assert.equal(h.run().cameraHalfHeight, expanded); mesh.geometry.dispose(); mesh.material.dispose();
});

test("portrait and landscape resizes keep rotated accessories contained and finite in both directions", () => {
  const h = fixture({ width: 900, height: 450 });
  for (const [width, height] of [[900, 450], [150, 320], [900, 450], [300, 800]]) {
    h.context.width = width; h.context.height = height; h.run();
    assert.ok(Number.isFinite(h.context.cameraHalfHeight)); assertProjectedInside(h.context, h.context.dressFitBounds);
  }
});

test("NaN, infinity and overflowing finite bounds preserve the default finite standing camera", () => {
  for (const bounds of [box([NaN, 0, 0], [1, 1, 1]), box([-1, 0, 0], [Infinity, 1, 1]), box([-1e308, 0, -1e308], [1e308, 1, 1e308])]) {
    const h = fixture({ width: 150, height: 320, bounds }); const expected = expectedBase(h.context), actual = h.run();
    assert.equal(actual.cameraHalfHeight, expected.height); assert.equal(actual.cameraCenterY + actual.cameraOffset, expected.centerY); assert.equal(actual.dressFitHalfHeight, 0);
  }
});

test("invalid zero and negative box aspects never admit an accessory fit into the camera", () => {
  for (const width of [0, -1]) {
    const h = fixture({ width }); const expected = expectedBase(h.context), actual = h.run();
    assert.equal(actual.cameraHalfHeight, expected.height); assert.equal(actual.cameraCenterY + actual.cameraOffset, expected.centerY); assert.equal(actual.dressFitHalfHeight, 0);
  }
});

// 2026-10-06 "360도 돌려서 발바닥 정수리": tilted over the crown or under the soles, every accessory corner stays inside at every turn.
test("tilted preview keeps wide accessories inside at every tilt and turn, and a level view is the standing frame", () => {
  for (const [width, height] of [[150, 320], [300, 320], [900, 450], [1500, 400]]) {
    const level = fixture({ width, height }).run();
    for (let tilt = 15; tilt < 360; tilt += 15) {
      const h = fixture({ width, height, viewTilt: tilt * Math.PI / 180 }); const actual = h.run();
      assert.ok(Number.isFinite(actual.cameraHalfHeight) && actual.cameraHalfHeight >= level.cameraHalfHeight - 1e-9, `tilt ${tilt}: frame never shrinks below standing`);
      assertProjectedInside(actual, actual.dressFitBounds);
    }
  }
});
