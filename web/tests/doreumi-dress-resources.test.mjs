// Runtime resources only: no browser, credentials, HTTP, database or hosted writes.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as THREE from "three";

const fixtureModule = { exports: {} };
const source = ts.transpileModule(readFileSync(new URL("../src/lib/doreumi/motion-dress.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
vm.runInNewContext(source, { module: fixtureModule, exports: fixtureModule.exports, require: name => { assert.equal(name, "three"); return THREE; } });
const { takeOffDressItem } = fixtureModule.exports;

test("removing a rigged garment disposes its own bone texture while preserving shared body bones and the body's skeleton", () => {
  const parent = new THREE.Group(), bone = new THREE.Bone(); parent.add(bone); parent.updateMatrixWorld(true);
  const bodySkeleton = new THREE.Skeleton([bone]); bodySkeleton.computeBoneTexture();
  const garment = new THREE.SkinnedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()); parent.add(garment); garment.bind(new THREE.Skeleton([bone])); garment.skeleton.computeBoneTexture();
  const originalBodyTexture = bodySkeleton.boneTexture;
  let boneTextureDisposals = 0, bodyTextureDisposals = 0;
  garment.skeleton.boneTexture.addEventListener("dispose", () => boneTextureDisposals++);
  originalBodyTexture.addEventListener("dispose", () => bodyTextureDisposals++);
  takeOffDressItem({ id: "fixture-garment", objects: [garment] });
  assert.equal(garment.parent, null); assert.equal(bone.parent, parent);
  assert.equal(boneTextureDisposals, 1); assert.equal(bodyTextureDisposals, 0); assert.equal(bodySkeleton.boneTexture, originalBodyTexture);
  bodySkeleton.dispose();
});

test("removing two rigid meshes releases each shared material and map only once", () => {
  const parent = new THREE.Group(), texture = new THREE.Texture(), material = new THREE.MeshBasicMaterial({ map: texture });
  parent.add(new THREE.Mesh(new THREE.BoxGeometry(), material), new THREE.Mesh(new THREE.BoxGeometry(), material));
  let textures = 0, materials = 0; texture.addEventListener("dispose", () => textures++); material.addEventListener("dispose", () => materials++);
  takeOffDressItem({ id: "fixture-rigid", objects: [parent] });
  assert.equal(textures, 1); assert.equal(materials, 1);
});
