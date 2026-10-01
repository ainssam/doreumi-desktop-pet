import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, BufferGeometry, Float32BufferAttribute, Matrix4, Mesh, Vector3 } from 'three';
import { measureSkinBox } from '../scripts/doreumi/meshy-skin-box.mjs';
const box = new Box3(new Vector3(-.1,-.1,-.1),new Vector3(.1,.1,.1));
function mesh(points, indexed = false) {
 const geometry = new BufferGeometry(); geometry.setAttribute('position',new Float32BufferAttribute(points,3));
 if(indexed)geometry.setIndex([0,1,2]);return new Mesh(geometry);
}
test('detects a face passing through the case even though all three skin vertices are outside',()=>{
 for(const indexed of [false,true]){const object=mesh([-1,-1,0, 1,-1,0, 0,1,0],indexed),result=measureSkinBox(object,new Matrix4(),box);
 assert.equal(result.verticesInside,0);assert.equal(result.intersectingTriangles,1);assert.deepEqual(result.collisions[0].vertices,[0,1,2]);}
});
test('honors mesh and case transforms, without testing unrelated world coordinates',()=>{
 const object=mesh([-1,-1,0, 1,-1,0, 0,1,0]);object.position.set(7,4,2);object.updateMatrixWorld(true);
 assert.equal(measureSkinBox(object,new Matrix4(),box).intersectingTriangles,0);
 assert.equal(measureSkinBox(object,new Matrix4().makeTranslation(-7,-4,-2),box).intersectingTriangles,1);
});
test('rejects malformed scratch or nonfinite skin coordinates',()=>{
 const object=mesh([-1,-1,0, 1,-1,0, 0,1,0]);assert.throws(()=>measureSkinBox(object,new Matrix4(),box,new Float64Array(3)),/scratch/);
 object.geometry.attributes.position.setX(0,NaN);assert.throws(()=>measureSkinBox(object,new Matrix4(),box),/Nonfinite/);
});
