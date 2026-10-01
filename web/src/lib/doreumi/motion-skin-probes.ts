import { Matrix4, Mesh, SkinnedMesh, Vector3 } from 'three';

/** Same CPU skinning operations as SkinnedMesh.getVertexPosition, sharing only
 * the bone-world × inverse-bind products that are invariant within one pose.
 * refresh() must follow the model's world-matrix update for every sampled pose.
 */
export function createSkinProbeReader(meshes: readonly SkinnedMesh[]) {
  const matrices = new Map(meshes.map(mesh => [mesh.skeleton, mesh.skeleton.bones.map(() => new Matrix4())]));
  const base = new Vector3(), transformed = new Vector3();
  return {
    refresh() {
      for (const [skeleton, bones] of matrices) {
        for (let index = 0; index < bones.length; index++) {
          bones[index].multiplyMatrices(skeleton.bones[index].matrixWorld, skeleton.boneInverses[index]);
        }
      }
    },
    read(mesh: SkinnedMesh, index: number, target: Vector3) {
      const bones = matrices.get(mesh.skeleton);
      if (!bones) return mesh.getVertexPosition(index, target);
      // Keep current morph influences, bind matrices, and attribute values live.
      // No rest vertex, weight, or deformed result is approximated or frozen.
      Mesh.prototype.getVertexPosition.call(mesh, index, base);
      base.applyMatrix4(mesh.bindMatrix);
      const indices = mesh.geometry.getAttribute('skinIndex'), weights = mesh.geometry.getAttribute('skinWeight');
      target.set(0, 0, 0);
      for (let component = 0; component < 4; component++) {
        const weight = weights.getComponent(index, component);
        if (weight !== 0) target.addScaledVector(transformed.copy(base).applyMatrix4(bones[indices.getComponent(index, component)]), weight);
      }
      return target.applyMatrix4(mesh.bindMatrixInverse);
    },
  };
}
