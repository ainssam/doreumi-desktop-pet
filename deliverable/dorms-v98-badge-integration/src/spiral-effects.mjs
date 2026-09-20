import {SPIRAL_COLORS,resolveSpiralColor} from './spiral-colors.mjs';
import * as THREE from 'three';

export const PALETTE = SPIRAL_COLORS;

export function assertMaskLength(mask, vertexCount) {
  if (mask.length !== vertexCount) {
    throw new Error(`나선 마스크 길이 불일치: ${mask.length} / ${vertexCount}`);
  }
}

export function effectIsActive(id) {
  return ['pink','green','purple','gold','cyan'].includes(id);
}

function asArray(value) {
  return Array.isArray(value) ? value : [value];
}

function createDust(scene) {
  const capacity = 360;
  const particles = [];
  const positions = new Float32Array(capacity * 3);
  const colors = new Float32Array(capacity * 3);
  const sizes = new Float32Array(capacity);
  const opacity = new Float32Array(capacity);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('opacity', new THREE.BufferAttribute(opacity, 1));
  geometry.setDrawRange(0, 0);
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
    vertexShader: `
      attribute float size;
      attribute float opacity;
      varying vec3 tint;
      varying float alpha;
      void main() {
        tint = color;
        alpha = opacity;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = size * min(2.4, 6.0 / max(1.0, -mv.z));
      }
    `,
    fragmentShader: `
      varying vec3 tint;
      varying float alpha;
      void main() {
        vec2 p = gl_PointCoord - 0.5;
        float glow = exp(-dot(p, p) * 22.0);
        float crossStar = max(
          exp(-abs(p.x) * 65.0 - abs(p.y) * 7.0),
          exp(-abs(p.y) * 65.0 - abs(p.x) * 7.0)
        );
        float a = (crossStar + glow * 0.28) * alpha;
        if (a < 0.012) discard;
        gl_FragColor = vec4(tint, a);
      }
    `,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 8;
  scene?.add(points);

  return {
    particles,
    positions,
    colors,
    sizes,
    opacity,
    geometry,
    material,
    points,
    dispose() {
      scene?.remove(points);
      geometry.dispose();
      material.dispose();
    },
  };
}

export function createSpiralEffects(model, scene, {
  mask,
} = {}) {
  if (!model) throw new Error('나선 효과를 적용할 V60 모델이 없습니다.');
  const meshRecords = [];
  const color = { value: new THREE.Color(PALETTE.navy) };
  const target = new THREE.Color(PALETTE.navy);
  const clock = { value: 0 };
  const glow = { value: 0 }, enabled={value:1}, vivid={value:0};

  model.traverse((object) => {
    if (!object.isMesh) return;
    assertMaskLength(mask, object.geometry.attributes.position.count);
    const previousAttribute = object.geometry.getAttribute('spiralMask');
    object.geometry.setAttribute('spiralMask', new THREE.BufferAttribute(mask, 1));
    for (const material of asArray(object.material)) {
      const previousCompile = material.onBeforeCompile;
      const previousCacheKey = material.customProgramCacheKey;
      material.onBeforeCompile = (shader, renderer) => {
        previousCompile?.call(material, shader, renderer);
        shader.uniforms.spiralColor = color;
        shader.uniforms.spiralClock = clock;
        shader.uniforms.spiralGlow = glow;shader.uniforms.spiralEnabled=enabled;shader.uniforms.spiralVivid=vivid;
        shader.vertexShader = `
          attribute float spiralMask;
          varying float vSpiral;
          varying vec3 vRestPosition;
        ` + shader.vertexShader.replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvSpiral = spiralMask;\nvRestPosition = position;',
        );
        shader.fragmentShader = `
          uniform vec3 spiralColor;
          uniform float spiralClock;
          uniform float spiralGlow;uniform float spiralEnabled;uniform float spiralVivid;
          varying float vSpiral;
          varying vec3 vRestPosition;
        ` + shader.fragmentShader
          .replace(
            '#include <map_fragment>',
            '#include <map_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, spiralColor, spiralEnabled*smoothstep(0.05, 0.62, vSpiral));',
          )
          .replace(
            '#include <emissivemap_fragment>',
            `#include <emissivemap_fragment>
            float sparkleA = pow(0.5 + 0.5 * sin(vRestPosition.y * 37.0 + vRestPosition.x * 23.0 - spiralClock * 2.2), 28.0);
            float sparkleB = pow(0.5 + 0.5 * sin(vRestPosition.y * 19.0 - vRestPosition.x * 41.0 + spiralClock * 1.7), 30.0);
            float shimmer = sparkleA * sparkleB;
            totalEmissiveRadiance += mix(spiralColor, vec3(0.55, 0.72, 1.0), 0.12) * spiralGlow * (0.10 + shimmer * 3.4) * smoothstep(0.05, 0.62, vSpiral);`,
          );
        shader.fragmentShader=shader.fragmentShader.replace('#include <colorspace_fragment>', '#include <colorspace_fragment>\nvec3 vividTint=linearToOutputTexel(vec4(spiralColor,1.)).rgb;float lit=max(max(gl_FragColor.r,gl_FragColor.g),gl_FragColor.b);vec3 saturated=max(vividTint,vec3(.012))*clamp(lit,.35,1.);gl_FragColor.rgb=mix(gl_FragColor.rgb,saturated,spiralVivid*spiralEnabled*smoothstep(.05,.62,vSpiral));');
      };
      material.customProgramCacheKey = () => `doreumi-v98-spiral-vivid-${previousCacheKey?.call(material) ?? 'base'}`;
      material.needsUpdate = true;
      meshRecords.push({ object, material, previousAttribute, previousCompile, previousCacheKey });
    }
  });

  const dust = createDust(scene);
  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  let mood = 'navy';
  let active = false;
  let paused = false;
  let disposed = false;
  let emission = 0;
  let last = performance.now();
  let frame = 0;
  const tint = new THREE.Color(PALETTE.navy);

  function spawn() {
    const head = Math.random() < 0.42;
    const origin = new THREE.Vector3(
      center.x + (Math.random() - 0.5) * size.x * (head ? 0.5 : 0.72),
      head ? box.max.y - size.y * 0.13 : center.y - size.y * 0.04,
      center.z + size.z * 0.38 + (Math.random() - 0.5) * size.z * 0.2,
    );
    dust.particles.push({
      position: origin,
      velocity: new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.08 + Math.random() * 0.22, (Math.random() - 0.5) * 0.22),
      age: 0,
      life: 1.1 + Math.random() * 0.8,
      size: 5 + Math.random() * 10,
      phase: Math.random() * Math.PI * 2,
    });
  }

  function update(now) {
    if (disposed) return;
    const dt = paused ? 0 : Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    clock.value += dt;
    color.value.lerp(target, 1 - Math.exp(-dt * 3.2));
    glow.value += ((active ? 0.72 : 0) - glow.value) * (1 - Math.exp(-dt * 3));

    for (let index = dust.particles.length - 1; index >= 0; index -= 1) {
      const particle = dust.particles[index];
      particle.age += dt;
      particle.velocity.y -= 0.16 * dt;
      particle.position.addScaledVector(particle.velocity, dt);
      if (particle.age >= particle.life) dust.particles.splice(index, 1);
    }
    if (active && dt > 0) {
      emission += dt * 52;
      while (emission >= 1 && dust.particles.length < 360) {
        emission -= 1;
        spawn();
      }
    } else {
      emission = 0;
    }

    tint.set(resolveSpiralColor(mood)).lerp(new THREE.Color('#ffffff'), 0.42);
    dust.particles.forEach((particle, index) => {
      dust.positions.set(particle.position.toArray(), index * 3);
      dust.colors.set(tint.toArray(), index * 3);
      dust.sizes[index] = particle.size;
      dust.opacity[index] = Math.sin(Math.PI * particle.age / particle.life)
        * (0.5 + 0.5 * Math.sin(clock.value * 8 + particle.phase) ** 2);
    });
    dust.geometry.setDrawRange(0, dust.particles.length);
    for (const attribute of Object.values(dust.geometry.attributes)) attribute.needsUpdate = true;
    frame = requestAnimationFrame(update);
  }

  frame = requestAnimationFrame(update);

  return {
    setMood(id) {
      resolveSpiralColor(id);
      mood = id;
      target.set(resolveSpiralColor(id));
      color.value.copy(target);
      active = effectIsActive(id);enabled.value=id==='navy'?0:1;vivid.value=active||id==='navy'?0:1;if(!active){glow.value=0;dust.particles.length=0;dust.geometry.setDrawRange(0,0);}
      return { mood, active };
    },
    setActive(value) {
      active = Boolean(value) || effectIsActive(mood);
    },
    setPaused(value) {
      paused = Boolean(value);
    },
    getState() {
      return { mood, active, paused, particles: dust.particles.length, maskLength: mask.length };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      dust.dispose();
      for (const record of meshRecords) {
        if (record.previousAttribute) record.object.geometry.setAttribute('spiralMask', record.previousAttribute);
        else record.object.geometry.deleteAttribute('spiralMask');
        record.material.onBeforeCompile = record.previousCompile;
        record.material.customProgramCacheKey = record.previousCacheKey;
        record.material.needsUpdate = true;
      }
    },
  };
}
