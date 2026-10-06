import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as THREE from "three";

function loadSource(path, extra = {}) {
  const fixtureModule = { exports: {} };
  const source = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, { module: fixtureModule, exports: fixtureModule.exports, require: name => {
    assert.equal(name, "three"); return THREE;
  }, ...extra }, { filename: path });
  return fixtureModule.exports;
}
const items = loadSource("src/lib/doreumi/items.ts");
const slots = { hat: ["head"], cap: ["head"], shirt: ["top"], pants: ["bottom"], suit: ["top", "bottom"], wand: ["hand"], bat: ["hand"], glasses: ["face"] };
const slotsOf = id => slots[id];
const plain = value => JSON.parse(JSON.stringify(value));
const close = (a, b, why) => assert.ok(a.distanceTo(b) < 1e-6, `${why}: ${a.toArray()} vs ${b.toArray()}`);

test("legacy hand preserves the original left/right bone, canonical slots win and subsequent writes use new keys", () => {
  for (const [bone, target] of [["palmL", "leftHand"], ["wristR", "rightHand"], ["torso", "rightHand"]]) {
    assert.deepEqual(plain(items.canonicalWorn({ hand: "wand", head: "hat" }, () => items.naturalHand(bone))), { head: "hat", [target]: "wand" });
  }
  assert.deepEqual(plain(items.canonicalWorn({ hand: "wand", leftHand: "bat" }, () => "leftHand")), { leftHand: "bat" });
});
test("the same hand item can be worn twice and each hand replaces or removes independently", () => {
  const both = items.wearItem(items.wearItem({ head: "hat" }, "wand", ["hand"], slotsOf, "leftHand"), "wand", ["hand"], slotsOf, "rightHand");
  assert.deepEqual(plain(both), { head: "hat", leftHand: "wand", rightHand: "wand" });
  assert.deepEqual(plain(items.wearItem(both, "bat", ["hand"], slotsOf, "leftHand")), { head: "hat", leftHand: "bat", rightHand: "wand" });
  assert.deepEqual(plain(items.takeOffItem(both, "wand", "leftHand")), { head: "hat", rightHand: "wand" });
  assert.equal(items.slotFitsItem("leftHand", ["top"]), false);
  assert.equal(items.slotFitsItem("rightHand", ["hand"]), true);
  assert.equal(items.normalizeSlots(["leftHand"]), null, "Catalog/request categories retain hand");
});
test("normal outfit replacement keeps both independent hands", () => {
  const next = items.wearItem({ leftHand: "wand", rightHand: "bat", top: "suit", bottom: "suit" }, "shirt", ["top"], slotsOf);
  assert.deepEqual(plain(next), { leftHand: "wand", rightHand: "bat", top: "shirt" });
});
test("dress identity changes when hand, asset, attachment or skin binding changes", () => {
  const item = { id: "wand", slots: ["hand"], asset: "/wand.glb", bone: "palmR", rigged: false, hand: "rightHand" };
  const key = items.dressKey({ items: [item], colors: {} });
  for (const change of [{ hand: "leftHand" }, { asset: "/new.glb" }, { bone: "wristR" }, { rigged: true }]) assert.notEqual(items.dressKey({ items: [{ ...item, ...change }], colors: {} }), key);
  assert.notEqual(items.dressKey({ items: [item, { ...item, hand: "leftHand" }], colors: {} }), key);
});
test("unowned fitting-room choices accumulate without mutating the saved wardrobe and reset to its exact contents", () => {
  const saved = Object.freeze({ head: "hat", top: "shirt", bottom: "pants", rightHand: "bat" });
  let trials = [];
  for (const trial of [{ id: "cap" }, { id: "glasses" }, { id: "wand", hand: "leftHand" }, { id: "wand", hand: "rightHand" }]) trials = items.tryOnItem(trials, trial, slotsOf);
  assert.deepEqual(plain(items.tryOnWorn(saved, trials, slotsOf)), { head: "cap", top: "shirt", bottom: "pants", face: "glasses", leftHand: "wand", rightHand: "wand" });
  assert.deepEqual(plain(items.tryOnWorn(saved, [], slotsOf)), saved);
  assert.deepEqual(saved, { head: "hat", top: "shirt", bottom: "pants", rightHand: "bat" });
});
test("a fitting-room choice replaces only overlapping placements, including entire two-piece outfits", () => {
  let trials = [{ id: "hat" }, { id: "shirt" }, { id: "pants" }, { id: "wand", hand: "leftHand" }];
  trials = items.tryOnItem(trials, { id: "suit" }, slotsOf);
  assert.deepEqual(plain(trials), [{ id: "hat" }, { id: "wand", hand: "leftHand" }, { id: "suit" }]);
  trials = items.tryOnItem(trials, { id: "shirt" }, slotsOf);
  assert.deepEqual(plain(items.tryOnWorn({}, trials, slotsOf)), { head: "hat", leftHand: "wand", top: "shirt" });
  trials = items.tryOnItem(trials, { id: "cap" }, slotsOf);
  assert.equal(trials.some(trial => trial.id === "hat"), false);
});
test("closing one selected hand trial leaves its twin and successful saves rebase other drafts onto fresh state", () => {
  const trials = [{ id: "wand", hand: "leftHand" }, { id: "wand", hand: "rightHand" }, { id: "cap" }];
  assert.deepEqual(plain(items.removeTryOn(trials, "wand", "leftHand")), [{ id: "wand", hand: "rightHand" }, { id: "cap" }]);
  const fresh = { leftHand: "wand", head: "hat", face: "glasses" };
  const remaining = items.remainingTryOns(trials, fresh, slotsOf);
  assert.deepEqual(plain(remaining), [{ id: "wand", hand: "rightHand" }, { id: "cap" }]);
  assert.deepEqual(plain(items.tryOnWorn(fresh, remaining, slotsOf)), { leftHand: "wand", rightHand: "wand", head: "cap", face: "glasses" });
  assert.deepEqual(plain(items.tryOnWorn(fresh, [], slotsOf)), fresh);
});

function bodyModel() {
  const model = new THREE.Group(), torso = new THREE.Bone(), left = new THREE.Bone(), right = new THREE.Bone();
  torso.name = "torso"; left.name = "palmL"; right.name = "palmR";
  left.position.set(-0.8, -0.5, 0.06); right.position.set(0.8, -0.5, 0.06);
  torso.add(left, right); model.add(torso); model.updateMatrixWorld(true);
  const body = new THREE.SkinnedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
  body.name = "Doreumi"; model.add(body); body.bind(new THREE.Skeleton([torso, left, right]));
  return { model, body, left, right };
}
function rigidScene(centered = false) {
  const scene = new THREE.Group(), mesh = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 0.08), new THREE.MeshBasicMaterial());
  mesh.position.set(0.1, 0.25, 0.05); scene.add(mesh);
  if (centered) scene.position.set(0.2, -0.095, 0.44);
  return scene;
}
function riggedScene({ nonIndexed = false, extraBadMesh = false } = {}) {
  const scene = new THREE.Group(), torso = new THREE.Bone(), right = new THREE.Bone();
  torso.name = "torso"; right.name = "palmR"; right.position.set(0.8, -0.5, 0.06); torso.add(right); scene.add(torso); scene.updateMatrixWorld(true);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([0.8, -0.5, 0.06, 0.95, -0.5, 0.06, 0.8, -0.3, 0.06], 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  geometry.setAttribute("tangent", new THREE.Float32BufferAttribute([1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1], 4));
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  if (!nonIndexed) geometry.setIndex([0, 1, 2]);
  const garment = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial()); scene.add(garment); garment.bind(new THREE.Skeleton([torso, right]));
  if (extraBadMesh) { const bad = new THREE.Bone(); bad.name = "unknownJoint"; scene.add(bad); const mesh = new THREE.SkinnedMesh(geometry.clone(), new THREE.MeshBasicMaterial()); scene.add(mesh); mesh.bind(new THREE.Skeleton([bad])); }
  return scene;
}
function engine(sceneOf) {
  let parses = 0;
  const code = loadSource("src/lib/doreumi/motion-dress.ts", { fetch: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) }) });
  const loader = { async parseAsync() { parses++; return { scene: sceneOf() }; } };
  return { ...code, loader, get parses() { return parses; } };
}
test("rigid originals keep their authored anchor, while opposite hands mirror local X and follow their own moving bones", async () => {
  const h = engine(() => rigidScene()), { model, left, right } = bodyModel();
  const item = { id: "wand", asset: "/wand", slots: ["hand"], bone: "palmR", rigged: false };
  const r = await h.wearDressItem(h.loader, model, { ...item, hand: "rightHand" });
  const l = await h.wearDressItem(h.loader, model, { ...item, hand: "leftHand" });
  assert.equal(r.objects[0].parent, right); assert.equal(l.objects[0].parent, left);
  const meshR = r.objects[0].children[0], meshL = l.objects[0].children[0];
  for (const angle of [0, 0.4, -0.7]) {
    left.rotation.z = angle; right.rotation.z = -angle; model.updateMatrixWorld(true);
    close(meshR.getWorldPosition(new THREE.Vector3()), right.localToWorld(new THREE.Vector3(0.1, 0.25, 0.05)), "Right grip follows its bone");
    close(meshL.getWorldPosition(new THREE.Vector3()), left.localToWorld(new THREE.Vector3(-0.1, 0.25, 0.05)), "Left grip follows its bone with X reflection");
  }
  h.takeOffDressItem(l); assert.equal(l.objects[0].parent, null); assert.equal(r.objects[0].parent, right);
});
test("legacy left-authored rigid items retain original geometry on left and mirror onto right", async () => {
  const h = engine(() => rigidScene()), { model, left, right } = bodyModel();
  for (const hand of ["leftHand", "rightHand"]) {
    const loaded = await h.wearDressItem(h.loader, model, { id: hand, asset: `/${hand}`, bone: "palmL", hand });
    model.updateMatrixWorld(true);
    close(loaded.objects[0].children[0].getWorldPosition(new THREE.Vector3()), (hand === "leftHand" ? left : right).localToWorld(new THREE.Vector3(hand === "leftHand" ? 0.1 : -0.1, 0.25, 0.05)), "Authored left item preserves its natural side");
  }
});
test("old torso-authored hand items put their central grip directly at either palm", async () => {
  const h = engine(() => rigidScene(true)), { model, left, right } = bodyModel();
  for (const hand of ["leftHand", "rightHand"]) {
    const loaded = await h.wearDressItem(h.loader, model, { id: hand, asset: `/${hand}`, bone: "torso", hand });
    model.updateMatrixWorld(true);
    close(new THREE.Box3().setFromObject(loaded.objects[0]).getCenter(new THREE.Vector3()), (hand === "leftHand" ? left : right).getWorldPosition(new THREE.Vector3()), "Central grip meets palm");
  }
});
for (const nonIndexed of [false, true]) test(`rigged ${nonIndexed ? "non-indexed" : "indexed"} hand items remap weighted bones, inverse binds, winding and tangents`, async () => {
  const h = engine(() => riggedScene({ nonIndexed })), { model, left, right } = bodyModel();
  const loaded = await h.wearDressItem(h.loader, model, { id: "skin", asset: "/skin", bone: "palmR", rigged: true, hand: "leftHand" });
  const garment = loaded.objects[0]; assert.equal(garment.skeleton.bones[1], left); assert.notEqual(garment.skeleton.bones[1], right);
  const p = garment.geometry.getAttribute("position"), index = garment.geometry.index;
  const triangle = [0, 1, 2].map(i => new THREE.Vector3().fromBufferAttribute(p, index ? index.getX(i) : i));
  assert.ok(new THREE.Vector3().subVectors(triangle[1], triangle[0]).cross(new THREE.Vector3().subVectors(triangle[2], triangle[0])).z > 0, "Reflection preserves front-facing winding");
  assert.equal(garment.geometry.getAttribute("tangent").getW(0), -1);
  for (const angle of [0, 0.6, -0.3]) {
    left.rotation.z = angle; right.rotation.z = -angle; model.updateMatrixWorld(true); garment.skeleton.update();
    for (let i = 0; i < p.count; i++) {
      const original = new THREE.Vector3().fromBufferAttribute(p, i), local = original.clone().sub(new THREE.Vector3(-0.8, -0.5, 0.06));
      close(garment.applyBoneTransform(i, original.clone()), left.localToWorld(local), "Skinned vertex follows selected hand without bind offset");
    }
  }
});
test("a malformed later rigged mesh rejects the whole item before any garment attaches", async () => {
  const h = engine(() => riggedScene({ extraBadMesh: true })), { model } = bodyModel();
  await assert.rejects(h.wearDressItem(h.loader, model, { id: "bad", asset: "/bad", rigged: true, hand: "leftHand" }), /joint mismatch/);
  assert.equal(model.children.some(child => child.name.startsWith("DoreumiItem_")), false);
});
test("attachment lookup ignores earlier item subtrees with fake body joint names", async () => {
  const h = engine(() => rigidScene()), { model, left } = bodyModel();
  const fake = new THREE.Group(); fake.name = "DoreumiItem_fake"; const bone = new THREE.Bone(); bone.name = "palmL"; fake.add(bone); model.add(fake);
  const loaded = await h.wearDressItem(h.loader, model, { id: "real", asset: "/real", bone: "palmR", hand: "leftHand" });
  assert.equal(loaded.objects[0].parent, left);
});
