import * as THREE from 'three';
import type { DoreumiLook } from './seasons';

/** A separate garment follows the exact same bones/weights as the original surface. */
export function createDoreumiWardrobe(model: THREE.Object3D, season: DoreumiLook) {
  const root = new THREE.Group(); root.name = `wardrobe_${season}`;
  if (season === 'everyday') return root;
  // Accessories reuse the outfit ornaments without the garment.
  const garmentOn = season === 'seollal' || season === 'chuseok' || season === 'christmas';
  const hatOn = season === 'christmas' || season === 'santa-hat';
  const flowerOn = season === 'seollal' || season === 'chuseok' || season === 'flower-pin';
  const original: THREE.SkinnedMesh[] = [];
  if (garmentOn) model.traverse(object => { if (object instanceof THREE.SkinnedMesh) original.push(object); });
  const santa = hatOn;
  const cloth = new THREE.MeshStandardMaterial({ color: santa ? 0xb64244 : season === 'chuseok' ? 0xdca25f : 0x83b3a8, roughness: .95, side: THREE.DoubleSide });
  const bottom = new THREE.MeshStandardMaterial({ color: santa ? 0xb64244 : 0x536c83, roughness: .95, side: THREE.DoubleSide });
  const trim = new THREE.MeshStandardMaterial({ color: 0xfff1dd, roughness: 1, side: THREE.DoubleSide });
  const accent = cloth.clone();
  root.userData.materials = [cloth, bottom, trim, accent];
  // Clip on the original rest surface in the fragment shader, so the hem is a
  // smooth cut across triangles rather than a jagged triangle-centroid edge.
  cloth.onBeforeCompile = shader => {
    shader.uniforms.garmentBottom = { value: bottom.color };
    shader.uniforms.garmentTrim = { value: trim.color };
    shader.vertexShader = 'varying vec3 vGarmentRest;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvGarmentRest = position;');
    shader.fragmentShader = 'varying vec3 vGarmentRest;\nuniform vec3 garmentBottom;\nuniform vec3 garmentTrim;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      float gx = abs(vGarmentRest.x), gy = vGarmentRest.y;
      if (gy > .035 || gy < -.91 || (gx > .72 && gy < -.34)) discard;
      diffuseColor.rgb = mix(garmentBottom, diffuseColor.rgb, step(-.62, gy));
      float trimBand = max(step(.66,gx), max(1.-step(-.855,gy), step(.003,gy)));
      ${santa ? 'trimBand = max(trimBand, step(-.66,gy)*(1.-step(-.61,gy)));' : ''}
      diffuseColor.rgb = mix(diffuseColor.rgb, garmentTrim, trimBand);
    `);
  };
  cloth.customProgramCacheKey = () => `doreumi-garment-${season}-v2`;
  for (const mesh of original) {
    const source = mesh.geometry, positions = source.getAttribute('position'), normals = source.getAttribute('normal'), index = source.getIndex();
    if (!index) continue;
    const selected: number[][] = [[], [], []];
    for (let i = 0; i < index.count; i += 3) {
      const ids = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
      const x = ids.reduce((sum, id) => sum + positions.getX(id), 0) / 3;
      const y = ids.reduce((sum, id) => sum + positions.getY(id), 0) / 3;
      // Head/face/spirals and hands stay uncovered. Torso, sleeves and trousers are separate fabric.
      if (y > .10 || y < -.98 || (Math.abs(x) > .79 && y < -.40)) continue;
      const cuff = (Math.abs(x) > .63 && Math.abs(x) < .70) || (y < -.85) || (y > -.24) || (santa && y > -.66 && y < -.61);
      selected[cuff ? 2 : y < -.62 ? 1 : 0].push(...ids);
    }
    const geometry = new THREE.BufferGeometry();
    for (const name of Object.keys(source.attributes)) geometry.setAttribute(name, source.getAttribute(name).clone());
    const clothPositions = geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) clothPositions.setXYZ(i, positions.getX(i) + normals.getX(i) * .012, positions.getY(i) + normals.getY(i) * .012, positions.getZ(i) + normals.getZ(i) * .012);
    for (const name of ['position', 'normal', 'color'] as const) {
      const attributes = source.morphAttributes[name];
      if (attributes) geometry.morphAttributes[name] = attributes.map(attribute => attribute.clone());
    }
    geometry.morphTargetsRelative = source.morphTargetsRelative;
    geometry.setIndex(selected.flat());
    const garment = new THREE.SkinnedMesh(geometry, cloth); garment.name = 'DoreumiGarment';
    garment.position.copy(mesh.position); garment.quaternion.copy(mesh.quaternion); garment.scale.copy(mesh.scale);
    garment.bind(mesh.skeleton, mesh.bindMatrix); garment.bindMode = mesh.bindMode;
    if (mesh.morphTargetInfluences) garment.morphTargetInfluences = [...mesh.morphTargetInfluences];
    root.add(garment);
  }
  const torso = model.getObjectByName('torso'), head = model.getObjectByName('headAccessory');
  const ornaments: THREE.Object3D[] = [];
  function detail(parent: THREE.Object3D | undefined, geometry: THREE.BufferGeometry, surface: THREE.Material, position: [number, number, number]) {
    const object = new THREE.Mesh(geometry, surface); object.position.set(...position); parent?.add(object); ornaments.push(object); return object;
  }
  if (hatOn) {
    const hat = detail(head, new THREE.ConeGeometry(.28, .43, 24), accent, [0, .15, 0]); hat.rotation.z = -.2;
    detail(head, new THREE.TorusGeometry(.25, .055, 8, 32), trim, [0, -.04, 0]).rotation.x = Math.PI / 2;
    detail(head, new THREE.SphereGeometry(.075, 16, 12), trim, [.06, .36, 0]);
  }
  if (season === 'christmas') detail(torso, new THREE.BoxGeometry(.055, .42, .028), trim, [0, .25, .405]);
  if (season === 'seollal' || season === 'chuseok') {
    for (const side of [-1, 1]) {
      const collar = detail(torso, new THREE.BoxGeometry(.045, .25, .024), trim, [side * .068, .31, .405]); collar.rotation.z = side * -.65;
      const ribbon = detail(torso, new THREE.BoxGeometry(.06, .19, .028), bottom, [side * .048, .12, .425]); ribbon.rotation.z = side * .25;
    }
  }
  if (flowerOn) {
    const flower = new THREE.MeshStandardMaterial({ color: season === 'seollal' ? 0xe5b777 : 0xcd7e71, roughness: .8 });
    root.userData.materials.push(flower);
    // Petals sized to read at the 128px on-page size, not only in close-ups.
    for (let i = 0; i < 5; i++) detail(head, new THREE.SphereGeometry(.052, 14, 10), flower, [.13 + Math.cos(i * Math.PI * .4) * .052, -.075 + Math.sin(i * Math.PI * .4) * .052, .02]);
    detail(head, new THREE.SphereGeometry(.036, 12, 8), trim, [.13, -.075, .064]);
  }
  root.userData.ornaments = ornaments;
  return root;
}

export function removeDoreumiWardrobe(root: THREE.Group) {
  const ornaments = root.userData.ornaments as THREE.Object3D[] | undefined;
  const materials = new Set<THREE.Material>((root.userData.materials ?? []) as THREE.Material[]);
  const destroy = (object: THREE.Object3D) => { if (object instanceof THREE.Mesh) { object.geometry.dispose(); for (const surface of Array.isArray(object.material) ? object.material : [object.material]) materials.add(surface); } };
  root.removeFromParent(); root.traverse(destroy);
  for (const ornament of ornaments ?? []) { ornament.removeFromParent(); ornament.traverse(destroy); }
  materials.forEach(surface => surface.dispose());
}
