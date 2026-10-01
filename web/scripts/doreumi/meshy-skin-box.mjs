import { Triangle, Vector3 } from 'three';

/** Exact CPU skinning and triangle/box SAT; vertices outside a box do not prove
 * that the triangle between them misses it. Coordinates are box-local.
 */
export function measureSkinBox(object, inverse, box, points = new Float64Array(object.geometry.attributes.position.count * 3)) {
  const count = object.geometry.attributes.position.count;
  if (points.length !== count * 3) throw new Error('Skin box scratch size mismatch.');
  const point = new Vector3(), triangle = new Triangle(), index = object.geometry.index;
  let verticesInside = 0, intersectingTriangles = 0;
  const collisions = [];
  for (let vertex = 0; vertex < count; vertex++) {
    object.getVertexPosition(vertex, point).applyMatrix4(object.matrixWorld).applyMatrix4(inverse);
    if (![point.x, point.y, point.z].every(Number.isFinite)) throw new Error('Nonfinite skin/box coordinate.');
    point.toArray(points, vertex * 3);
    if (box.containsPoint(point)) verticesInside++;
  }
  const corners = index?.count ?? count;
  for (let i = 0; i + 2 < corners; i += 3) {
    const a = index ? index.getX(i) : i, b = index ? index.getX(i + 1) : i + 1, c = index ? index.getX(i + 2) : i + 2;
    triangle.a.fromArray(points, a * 3); triangle.b.fromArray(points, b * 3); triangle.c.fromArray(points, c * 3);
    if (!box.intersectsTriangle(triangle)) continue;
    intersectingTriangles++;
    if (collisions.length < 6) collisions.push({ vertices: [a,b,c], casePositions: [triangle.a.toArray(), triangle.b.toArray(), triangle.c.toArray()] });
  }
  return { verticesInside, intersectingTriangles, collisions };
}
