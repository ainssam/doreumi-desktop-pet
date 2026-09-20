import path from 'node:path';

function add(table, url, filePath, contentType) {
  table.set(url, { path: path.resolve(filePath), contentType });
}

export function createRouteTable({ workspaceRoot, v87Root, catalog }) {
  const table = new Map();
  add(table, '/', path.join(v87Root, 'index.html'), 'text/html; charset=utf-8');
  add(table, '/index.html', path.join(v87Root, 'index.html'), 'text/html; charset=utf-8');
  add(table, '/styles.css', path.join(v87Root, 'styles.css'), 'text/css; charset=utf-8');
  add(table, '/assets/v60.glb', catalog.model.path, 'model/gltf-binary');
  add(table, '/assets/v60-spiral-mask.bin', catalog.model.spiralMaskPath, 'application/octet-stream');
  for (const item of catalog.expressions) {
    add(table, item.modelUrl, item.modelPath, 'model/gltf-binary');
    add(table, item.textureUrl, item.texturePath, 'image/png');
  }
  for (const item of catalog.props) {
    add(table, item.modelUrl, item.modelPath, 'model/gltf-binary');
  }
  for (const item of catalog.seasons) {
    if (item.textureUrl && item.texturePath) add(table, item.textureUrl, item.texturePath, 'image/png');
  }
  add(
    table,
    '/vendor/build/three.module.js',
    path.join(workspaceRoot, 'node_modules', 'three', 'build', 'three.module.js'),
    'text/javascript; charset=utf-8',
  );
  return table;
}

export function resolveRoute(table, requestPath) {
  const rawPath = String(requestPath).split('?')[0];
  let decoded;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return null;
  }
  if (!decoded.startsWith('/') || decoded.includes('..') || decoded.includes('\\')) return null;
  return table.get(decoded) ?? null;
}

export function resolveSafePrefix(requestPath, urlPrefix, rootPath) {
  const rawPath = String(requestPath).split('?')[0];
  let decoded;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return null;
  }
  if (!decoded.startsWith(urlPrefix) || decoded.includes('..') || decoded.includes('\\')) return null;
  const relative = decoded.slice(urlPrefix.length);
  if (!relative || path.isAbsolute(relative)) return null;
  const root = path.resolve(rootPath);
  const target = path.resolve(root, relative);
  const relation = path.relative(root, target);
  if (relation.startsWith('..') || path.isAbsolute(relation)) return null;
  return target;
}

export function evidencePath(v87Root, relativePath) {
  if (path.isAbsolute(relativePath)) throw new Error('V87 evidence 절대경로는 허용되지 않습니다.');
  const root = path.resolve(v87Root, 'evidence');
  const target = path.resolve(root, relativePath);
  const relation = path.relative(root, target);
  if (relation.startsWith('..') || path.isAbsolute(relation)) {
    throw new Error(`V87 evidence 밖 경로 차단: ${relativePath}`);
  }
  return target;
}

export function sanitizeToken(value, fallback = 'untitled') {
  const normalized = String(value ?? '')
    .normalize('NFKD')
    .replace(/_/gu, '-')
    .replace(/[^a-zA-Z0-9-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .replace(/-+/gu, '-')
    .toLowerCase();
  return normalized || fallback;
}

export function contentTypeFor(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return ({
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.glb': 'model/gltf-binary',
    '.bin': 'application/octet-stream',
    '.webm': 'video/webm',
  })[extension] ?? 'application/octet-stream';
}
