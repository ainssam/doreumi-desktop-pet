import * as THREE from 'three';

export function seasonForMonth(month) {
  const value = Number(month);
  if (value >= 3 && value <= 5) return 'spring';
  if (value >= 6 && value <= 8) return 'summer';
  if (value >= 9 && value <= 11) return 'autumn';
  return 'winter';
}

export function seasonRate(season) {
  return ({ spring: 12, summer: 13, autumn: 10, winter: 14 })[season] ?? 0;
}

export function isFaceSafeParticle(point, faceBounds) {
  const inside = point.x >= faceBounds.minX
    && point.x <= faceBounds.maxX
    && point.y >= faceBounds.minY
    && point.y <= faceBounds.maxY;
  return !inside;
}

function createRainTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  context.translate(64, 64);
  const gradient = context.createLinearGradient(0, -38, 0, 34);
  gradient.addColorStop(0, '#ffffff55');
  gradient.addColorStop(0.58, '#ffffff');
  gradient.addColorStop(1, '#ffffffaa');
  context.fillStyle = gradient;
  context.shadowColor = '#bfe8ff88';
  context.shadowBlur = 7;
  context.beginPath();
  context.moveTo(0, -40);
  context.bezierCurveTo(11, -18, 20, 1, 20, 16);
  context.bezierCurveTo(20, 38, -20, 38, -20, 16);
  context.bezierCurveTo(-20, 1, -11, -18, 0, -40);
  context.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function normalizeTextureUrls(seasons) {
  if (Array.isArray(seasons)) {
    return Object.fromEntries(
      seasons.filter((item) => item.textureUrl).map((item) => [item.id, item.textureUrl]),
    );
  }
  return { ...seasons };
}

export async function createSeasonalEffects(scene, {
  textureUrls,
  faceBounds = { minX: -0.58, maxX: 0.58, minY: 1.1, maxY: 2.2 },
  field = { width: 5.2, top: 3.1, depth: 2.2, floor: 0 },
} = {}) {
  if (!scene) throw new Error('계절 효과 scene이 없습니다.');
  const urls = normalizeTextureUrls(textureUrls ?? {});
  const textureLoader = new THREE.TextureLoader();
  const textures = { summer: createRainTexture() };
  for (const id of ['spring', 'autumn', 'winter']) {
    if (!urls[id]) throw new Error(`${id} 계절 texture URL이 없습니다.`);
    const texture = await textureLoader.loadAsync(urls[id]);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    textures[id] = texture;
  }

  const capacity = 420;
  const particles = [];
  const positions = new Float32Array(capacity * 3);
  const colors = new Float32Array(capacity * 3);
  const sizes = new Float32Array(capacity);
  const opacity = new Float32Array(capacity);
  const angles = new Float32Array(capacity);
  const geometry = new THREE.BufferGeometry();
  for (const [name, array, itemSize] of [
    ['position', positions, 3],
    ['color', colors, 3],
    ['size', sizes, 1],
    ['opacity', opacity, 1],
    ['angle', angles, 1],
  ]) geometry.setAttribute(name, new THREE.BufferAttribute(array, itemSize));
  geometry.setDrawRange(0, 0);
  const glyph = { value: textures.spring };
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    vertexColors: true,
    uniforms: { glyph },
    vertexShader: `
      attribute float size;
      attribute float opacity;
      attribute float angle;
      varying vec3 tint;
      varying float alpha;
      varying float spin;
      void main() {
        tint = color;
        alpha = opacity;
        spin = angle;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = size * min(2.5, 6.5 / max(1.0, -mv.z));
      }
    `,
    fragmentShader: `
      uniform sampler2D glyph;
      varying vec3 tint;
      varying float alpha;
      varying float spin;
      void main() {
        vec2 p = gl_PointCoord - 0.5;
        float c = cos(spin);
        float s = sin(spin);
        vec2 uv = mat2(c, -s, s, c) * p + 0.5;
        vec4 tex = texture2D(glyph, uv);
        if (tex.a * alpha < 0.035) discard;
        vec3 detail = mix(vec3(1.0), tex.rgb, 0.48);
        gl_FragColor = vec4(tint * detail, tex.a * alpha);
      }
    `,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 7;
  scene.add(points);

  const palettes = {
    spring: ['#f19ab7', '#ffd0dc', '#ffffff', '#e982aa'],
    summer: ['#469bd5', '#71b8e6', '#a7d8f4', '#d8efff'],
    autumn: ['#d06a28', '#e59a33', '#a9432d', '#e9b645'],
    winter: ['#ffffff', '#deefff', '#b8dafa'],
  };
  let current = 'none';
  let paused = false;
  let disposed = false;
  let reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let emission = 0;
  let time = 0;
  let last = performance.now();
  let frame = 0;

  function clear() {
    particles.length = 0;
    geometry.setDrawRange(0, 0);
  }

  function spawn() {
    const rain = current === 'summer';
    const snow = current === 'winter';
    const leaf = current === 'autumn';
    const palette = palettes[current];
    const life = rain ? 5.2 + Math.random() * 1.2 : snow ? 8 : leaf ? 6.6 : 5.8;
    const velocity = rain
      ? new THREE.Vector3(-0.035 + Math.random() * 0.025, -0.42 - Math.random() * 0.16, 0)
      : new THREE.Vector3((Math.random() - 0.5) * 0.09, snow ? -0.17 - Math.random() * 0.11 : -0.27 - Math.random() * 0.17, 0);
    const position = new THREE.Vector3(
      (Math.random() - 0.5) * field.width,
      field.top + Math.random() * 0.7,
      (Math.random() - 0.5) * field.depth,
    );
    if (!isFaceSafeParticle(position, faceBounds)) {
      const side = Math.random() < 0.5 ? -1 : 1;
      position.x = side * (Math.max(Math.abs(faceBounds.minX), Math.abs(faceBounds.maxX)) + 0.18 + Math.random() * 0.7);
    }
    particles.push({
      position,
      velocity,
      age: 0,
      life,
      size: rain ? 24 + Math.random() * 12 : snow ? 10 + Math.random() * 8 : leaf ? 12 + Math.random() * 8 : 11 + Math.random() * 7,
      phase: Math.random() * Math.PI * 2,
      spin: rain ? Math.PI - 0.03 + (Math.random() - 0.5) * 0.08 : (Math.random() - 0.5) * 2.5,
      color: new THREE.Color(palette[Math.floor(Math.random() * palette.length)]),
    });
  }

  function update(now) {
    if (disposed) return;
    const dt = paused ? 0 : Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    time += dt;
    if (current === 'none' || reduced) {
      clear();
      frame = requestAnimationFrame(update);
      return;
    }

    emission += dt * seasonRate(current);
    while (emission >= 1 && particles.length < capacity) {
      emission -= 1;
      spawn();
    }
    for (let index = particles.length - 1; index >= 0; index -= 1) {
      const particle = particles[index];
      particle.age += dt;
      if (particle.age >= particle.life || particle.position.y < field.floor) {
        particles.splice(index, 1);
        continue;
      }
      const swayScale = current === 'summer' ? 0.055 : current === 'winter' ? 0.1 : current === 'autumn' ? 0.17 : 0.13;
      particle.position.x += swayScale * Math.sin(time * (current === 'autumn' ? 1.35 : 0.75) + particle.phase) * dt;
      particle.position.addScaledVector(particle.velocity, dt);
      particle.spin += dt * (current === 'autumn' ? 1 : current === 'spring' ? 0.45 : 0.18);
      if (!isFaceSafeParticle(particle.position, faceBounds)) {
        particle.position.x = Math.sign(particle.position.x || 1)
          * (Math.max(Math.abs(faceBounds.minX), Math.abs(faceBounds.maxX)) + 0.14);
      }
    }

    particles.sort((left, right) => left.position.z - right.position.z);
    particles.forEach((particle, index) => {
      const fade = Math.min(1, particle.age / 0.6) * Math.min(1, (particle.life - particle.age) / 0.8);
      positions.set(particle.position.toArray(), index * 3);
      colors.set(particle.color.toArray(), index * 3);
      sizes[index] = particle.size;
      opacity[index] = fade * (current === 'summer' ? 0.72 : 0.82);
      angles[index] = particle.spin;
    });
    geometry.setDrawRange(0, particles.length);
    for (const attribute of Object.values(geometry.attributes)) attribute.needsUpdate = true;
    frame = requestAnimationFrame(update);
  }

  frame = requestAnimationFrame(update);

  return {
    setSeason(id) {
      if (id !== 'none' && !textures[id]) throw new Error(`알 수 없는 계절 연출: ${id}`);
      if (current !== id) {
        current = id;
        if (textures[id]) glyph.value = textures[id];
        clear();
        emission = 0;
      }
      return current;
    },
    setPaused(value) { paused = Boolean(value); },
    setReducedMotion(value) { reduced = Boolean(value); },
    getState() { return { season: current, particles: particles.length, paused, reduced }; },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      scene.remove(points);
      geometry.dispose();
      material.dispose();
      for (const texture of Object.values(textures)) texture.dispose();
    },
  };
}
