// CinematicScene.jsx — the "Sunrise Camp" opening scene.
//
// A physically-flavoured but hand-tuned sunrise: granulated sun surface (fbm),
// limb darkening, layered corona + light shafts, atmospheric sky gradient,
// silhouette camp on the ridge, drifting dust, and a scroll-linked sunrise.
//
// No post-processing dependency: bloom/rays are additive shaders, the
// filmic grade is ACES tone mapping plus CSS grain + vignette in landing.css.
//
// Perf contract:
//   · dpr capped, particle count derived from device class
//   · every shader is cheap (3–4 octave fbm, no loops in fragment beyond octaves)
//   · honour prefers-reduced-motion (no drift, static composition)
//   · WebGL failure falls back to a CSS gradient, never a blank canvas
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { sceneDrive } from '../lib/sceneDrive.js';
import CineFallback from './CineFallback.jsx';

const SUN_X = 9.5;
const SUN_Z = -34;
const SUN_RADIUS = 4.2;
const GROUND_Y = -2.5;

/**
 * One palette shared by the sky dome and the ground plane. They must agree at
 * the horizon or the ground's far edge shows up as a seam across the frame.
 * Values are sRGB hex; THREE.Color converts them into the renderer's working
 * (linear) space, which is what the shaders actually receive.
 */
const PALETTE = {
  top: '#051019',
  mid: '#06262a',
  horizon: '#0b423a',
  sun: '#ffcf8f',
};

/** Sun elevation (world units) as a function of scroll — rises, never sets. */
function sunElevation(scroll) {
  const t = Math.min(1, Math.max(0, scroll));
  const e = t * t * (3 - 2 * t); // smoothstep
  return 4.8 + e * 4.8;
}

/* -------------------------------------------------------------------------- */
/* glsl helpers                                                               */
/* -------------------------------------------------------------------------- */
const NOISE_GLSL = /* glsl */ `
  float cineHash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float cineNoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(cineHash(i + vec3(0.0, 0.0, 0.0)), cineHash(i + vec3(1.0, 0.0, 0.0)), f.x),
          mix(cineHash(i + vec3(0.0, 1.0, 0.0)), cineHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
      mix(mix(cineHash(i + vec3(0.0, 0.0, 1.0)), cineHash(i + vec3(1.0, 0.0, 1.0)), f.x),
          mix(cineHash(i + vec3(0.0, 1.0, 1.0)), cineHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
      f.z);
  }
  float cineFbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * cineNoise(p);
      p *= 2.03;
      a *= 0.5;
    }
    return v;
  }
`;

/* -------------------------------------------------------------------------- */
/* sky dome — vertical atmosphere + sun halo, dithered to kill banding         */
/* -------------------------------------------------------------------------- */
const SKY_VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const SKY_FRAG = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uMid;
  uniform vec3 uHorizon;
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  uniform float uSunI;
  varying vec3 vWorld;

  float sineBand(vec3 d) {
    return 0.5 + 0.5 * sin(d.x * 2.2 + d.z * 0.8);
  }

  void main() {
    vec3 dir = normalize(vWorld - cameraPosition);
    float h = dir.y;

    vec3 col = mix(uHorizon, uMid, smoothstep(-0.02, 0.32, h));
    col = mix(col, uTop, smoothstep(0.16, 0.92, h));

    // faint emerald aurora hugging the horizon (biophilic signature)
    float aurora = exp(-abs(h) * 14.0) * (0.25 + 0.75 * sineBand(dir));
    col += vec3(0.0022, 0.0160, 0.0120) * aurora * 0.55;

    // sun halo — wide warm bleed + tight core
    float d = max(dot(dir, uSunDir), 0.0);
    float wide = pow(d, 6.0);
    float core = pow(d, 110.0);
    col += uSunColor * (wide * 0.15 + core * 0.55) * uSunI;
    col += uSunColor * wide * exp(-abs(h) * 6.0) * 0.20 * uSunI;

    // horizon haze lifts the campsite out of the dark
    col += vec3(0.0040, 0.0125, 0.0105) * exp(-abs(h) * 6.0) * 0.9;
    col += vec3(0.0070, 0.0078, 0.0060) * exp(-abs(h) * 24.0) * 0.5;

    // below-horizon floor so the dome never shows a seam
    col = mix(col, uHorizon * 0.42, 1.0 - smoothstep(-0.22, 0.0, h));

    // ordered-ish dithering
    float n = fract(sin(dot(dir.xy, vec2(12.9898, 78.233))) * 43758.5453);
    col += (n - 0.5) * 0.006;

    gl_FragColor = vec4(col, 1.0);
  }
`;

function Sky() {
  const mat = useRef(null);
  const { camera } = useThree();
  const uniforms = useMemo(() => ({
    uTop: { value: new THREE.Color(PALETTE.top) },
    uMid: { value: new THREE.Color(PALETTE.mid) },
    uHorizon: { value: new THREE.Color(PALETTE.horizon) },
    uSunColor: { value: new THREE.Color(PALETTE.sun) },
    uSunDir: { value: new THREE.Vector3(0, 0.05, -1) },
    uSunI: { value: 1 },
  }), []);
  const sunPos = useMemo(() => new THREE.Vector3(), []);

  useFrame((state) => {
    if (!mat.current) return;
    sunPos.set(SUN_X, sunElevation(sceneDrive.smooth), SUN_Z);
    uniforms.uSunDir.value.copy(sunPos).sub(camera.position).normalize();
  });

  return (
    <mesh renderOrder={-2} frustumCulled={false} scale={[1, 1, 1]}>
      <sphereGeometry args={[180, 32, 20]} />
      <shaderMaterial
        ref={mat}
        uniforms={uniforms}
        vertexShader={SKY_VERT}
        fragmentShader={SKY_FRAG}
        side={THREE.BackSide}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}

/* -------------------------------------------------------------------------- */
/* sun — granulated photosphere with limb darkening                            */
/* -------------------------------------------------------------------------- */
const SUN_VERT = /* glsl */ `
  varying vec3 vNormalW;
  varying vec3 vWorld;
  varying vec3 vLocal;
  void main() {
    vLocal = position;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const SUN_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uHot;
  uniform vec3 uWarm;
  uniform vec3 uDeep;
  varying vec3 vNormalW;
  varying vec3 vWorld;
  varying vec3 vLocal;
  ${NOISE_GLSL}

  void main() {
    vec3 n = normalize(vNormalW);
    vec3 viewDir = normalize(cameraPosition - vWorld);
    float ndv = clamp(dot(n, viewDir), 0.0, 1.0);

    // limb darkening — the edge of a star is cooler and dimmer
    float limb = pow(ndv, 0.42);

    vec3 p = normalize(vLocal) * 2.6;
    float grain = cineFbm(p * 2.0 + vec3(0.0, uTime * 0.010, uTime * 0.016));
    float cells = smoothstep(0.34, 0.82, grain);
    float flicker = cineFbm(p * 6.0 + uTime * 0.05);

    vec3 col = mix(uDeep, uWarm, cells);
    col = mix(col, uHot, clamp(pow(ndv, 3.4) * 0.55 + flicker * 0.18, 0.0, 1.0));
    col *= mix(0.42, 0.94, limb);

    // hot rim so the disc reads as a light source, not a ball
    col += uWarm * pow(1.0 - ndv, 3.0) * 0.30;

    gl_FragColor = vec4(col, 1.0);
  }
`;

function Sun({ ...props }) {
  const group = useRef(null);
  const mat = useRef(null);
  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uHot: { value: new THREE.Color('#fff9e8') },
    uWarm: { value: new THREE.Color('#ffc879') },
    uDeep: { value: new THREE.Color('#ff8a3c') },
  }), []);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (mat.current) mat.current.uniforms.uTime.value = t;
    if (group.current) {
      group.current.position.y = sunElevation(sceneDrive.smooth);
      const s = 1 + sceneDrive.smooth * 0.10;
      group.current.scale.setScalar(s);
    }
  });

  return (
    <group ref={group} position={[SUN_X, sunElevation(0), SUN_Z]} {...props}>
      <mesh>
        <sphereGeometry args={[SUN_RADIUS, 64, 48]} />
        <shaderMaterial
          ref={mat}
          uniforms={uniforms}
          vertexShader={SUN_VERT}
          fragmentShader={SUN_FRAG}
          toneMapped={false}
        />
      </mesh>

      {/* corona + rays, camera-facing additive card */}
      <Corona radius={SUN_RADIUS * 3.6} />
    </group>
  );
}

const CORONA_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uInner;
  uniform vec3 uOuter;
  varying vec2 vUv;
  ${NOISE_GLSL}

  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    if (r > 1.0) discard;

    float ang = atan(p.y, p.x);
    float spokes = 0.5 + 0.5 * sin(ang * 41.0 + uTime * 0.32 + sin(ang * 9.0 + uTime * 0.55) * 1.7);
    float slow = 0.5 + 0.5 * sin(ang * 13.0 - uTime * 0.21);
    float rays = pow(spokes * slow, 2.6);

    float core = exp(-r * 8.8) * 0.50;
    float halo = exp(-r * 3.3) * 0.30;
    float streak = (1.0 - smoothstep(0.10, 0.96, r)) * rays * 0.17;

    float a = core + halo + streak;
    a *= 1.0 - smoothstep(0.72, 1.0, r);

    vec3 col = mix(uInner, uOuter, smoothstep(0.04, 0.62, r));
    gl_FragColor = vec4(col * a, a);
  }
`;

function Corona({ radius }) {
  const mat = useRef(null);
  const mesh = useRef(null);
  const { camera } = useThree();
  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uInner: { value: new THREE.Color('#fff3cf') },
    uOuter: { value: new THREE.Color('#ff9a4a') },
  }), []);

  useFrame((state) => {
    if (mat.current) mat.current.uniforms.uTime.value = state.clock.elapsedTime;
    if (mesh.current) mesh.current.quaternion.copy(camera.quaternion);
  });

  return (
    <mesh ref={mesh} scale={[radius * 2, radius * 2, 1]} renderOrder={-1}>
      <planeGeometry args={[1, 1]} />
      <shaderMaterial
        ref={mat}
        uniforms={uniforms}
        vertexShader={/* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `}
        fragmentShader={CORONA_FRAG}
        transparent
        depthWrite={false}
        depthTest={false}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
      />
    </mesh>
  );
}

/* -------------------------------------------------------------------------- */
/* light shafts — soft volumetric beams raking through the haze                */
/* -------------------------------------------------------------------------- */
const SHAFT_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uStrength;
  uniform vec3 uColor;
  varying vec2 vUv;
  ${NOISE_GLSL}

  void main() {
    float x = abs(vUv.x - 0.5) * 2.0;
    float y = vUv.y;

    float beam = exp(-x * x * 5.5);
    float fall = smoothstep(0.0, 0.55, y) * (1.0 - smoothstep(0.72, 1.0, y));
    float breathe = 0.65 + 0.35 * sin(uTime * 0.32 + vUv.y * 3.0);
    float dust = 0.65 + 0.35 * cineFbm(vec3(vUv.x * 7.0, vUv.y * 3.0 - uTime * 0.03, uTime * 0.02));

    float a = beam * fall * breathe * dust * uStrength;
    gl_FragColor = vec4(uColor * a, a);
  }
`;

function Shaft({ position, rotation, scale, strength, color = '#ffc27a' }) {
  const mat = useRef(null);
  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uStrength: { value: strength },
    uColor: { value: new THREE.Color(color) },
  }), [strength, color]);

  useFrame((state) => {
    if (mat.current) mat.current.uniforms.uTime.value = state.clock.elapsedTime;
  });

  return (
    <mesh position={position} rotation={rotation} scale={scale} renderOrder={-1}>
      <planeGeometry args={[1, 1]} />
      <shaderMaterial
        ref={mat}
        uniforms={uniforms}
        vertexShader={/* glsl */ `
          varying vec2 vUv;
          void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
        `}
        fragmentShader={SHAFT_FRAG}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
      />
    </mesh>
  );
}

/* -------------------------------------------------------------------------- */
/* ground — deep dusk plain with a warm specular smear under the sun           */
/* -------------------------------------------------------------------------- */
function Ground() {
  const uniforms = useMemo(() => ({
    uSunDir: { value: new THREE.Vector3(0, 0.1, -1) },
    uSunColor: { value: new THREE.Color('#ffb877') },
    uHorizon: { value: new THREE.Color(PALETTE.horizon) },
  }), []);
  const mat = useRef(null);
  const { camera } = useThree();
  const sunPos = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    const sun = sunPos.set(SUN_X, sunElevation(sceneDrive.smooth), SUN_Z);
    uniforms.uSunDir.value.copy(sun).sub(camera.position).normalize();
  });

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, GROUND_Y, 0]} receiveShadow>
      <planeGeometry args={[1400, 1400]} />
      <shaderMaterial
        ref={mat}
        uniforms={uniforms}
        vertexShader={/* glsl */ `
          varying vec3 vWorld;
          void main() {
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vWorld = wp.xyz;
            gl_Position = projectionMatrix * viewMatrix * wp;
          }
        `}
        fragmentShader={/* glsl */ `
          uniform vec3 uSunDir;
          uniform vec3 uSunColor;
          uniform vec3 uHorizon;
          varying vec3 vWorld;
          ${NOISE_GLSL}
          void main() {
            float dist = length(vWorld.xz - cameraPosition.xz);

            vec3 nearCol = vec3(0.0046, 0.0142, 0.0136);
            vec3 farCol  = vec3(0.0078, 0.0272, 0.0254);
            vec3 col = mix(nearCol, farCol, smoothstep(2.0, 90.0, dist));

            // drifting ground tone so the plain never reads as a flat fill
            float mottle = cineFbm(vec3(vWorld.xz * 0.055, 0.0));
            col *= 0.86 + mottle * 0.34;

            // warm grazing light on the ridge line
            float ridge = (1.0 - smoothstep(16.0, 70.0, dist)) * 0.35;
            col += uSunColor * ridge * 0.03;

            // long reflection of the sun on haze-moistened ground
            vec3 flatDir = normalize(vec3(uSunDir.x, 0.0, uSunDir.z));
            vec3 fromCam = normalize(vec3(vWorld.x - cameraPosition.x, 0.0, vWorld.z - cameraPosition.z));
            float alignSun = max(dot(fromCam, flatDir), 0.0);
            float smear = pow(alignSun, 26.0)
              * smoothstep(6.0, 26.0, dist)
              * (1.0 - smoothstep(60.0, 170.0, dist));
            col += uSunColor * smear * 0.42;

            // distance haze — the far plain must land exactly on the sky's
            // horizon colour, otherwise the plane's edge is a visible seam.
            float haze = smoothstep(30.0, 260.0, dist);
            col = mix(col, uHorizon * 0.86, haze);

            float n = fract(sin(dot(vWorld.xz, vec2(12.9898, 78.233))) * 43758.5453);
            col += (n - 0.5) * 0.005;

            gl_FragColor = vec4(col, 1.0);
          }
        `}
        toneMapped={false}
      />
    </mesh>
  );
}

/* -------------------------------------------------------------------------- */
/* terrain + camp silhouettes                                                  */
/* -------------------------------------------------------------------------- */
const SHADOW_MAT = {
  color: '#04100e',
  roughness: 0.96,
  metalness: 0.0,
};

const RIDGE_FRAG = /* glsl */ `
  varying vec2 vUv;
  uniform float uHeight;
  uniform float uSeed;
  uniform float uSunUvX;
  uniform vec3 uShade;
  uniform vec3 uRim;
  ${NOISE_GLSL}

  void main() {
    // three octave bands of different width → broad hills, shoulders, texture
    float x = vUv.x * 3.1 + uSeed;
    float n  = cineFbm(vec3(x, uSeed, 0.0));
    float n2 = cineFbm(vec3(x * 2.9, uSeed + 5.0, 0.0));
    float n3 = cineFbm(vec3(vUv.x * 9.0 + uSeed, uSeed + 9.0, 0.0));
    float h = uHeight + (n - 0.5) * 0.300 + (n2 - 0.5) * 0.105 + (n3 - 0.5) * 0.030;

    float below = 1.0 - smoothstep(h - 0.0016, h + 0.0016, vUv.y);
    if (below < 0.01) discard;

    // body: slightly lifted near the crest, falling into the plain
    float depth = clamp((h - vUv.y) / 0.42, 0.0, 1.0);
    vec3 col = mix(uShade * 1.6, uShade * 0.7, depth);

    // warm rim only where the sun is actually behind the crest
    float sunProx = 1.0 - smoothstep(0.0, 0.26, abs(vUv.x - uSunUvX));
    float rim = (1.0 - smoothstep(0.0, 0.0030, abs(vUv.y - h))) * sunProx;
    col = mix(col, uRim, rim * 0.55);

    gl_FragColor = vec4(col, below);
  }
`;

function Ridge({ z, height, seed, shade, rim }) {
  const uniforms = useMemo(() => ({
    uHeight: { value: height },
    uSeed: { value: seed },
    uSunUvX: { value: 0.5 + SUN_X / 220 },
    uShade: { value: new THREE.Color(shade) },
    uRim: { value: new THREE.Color(rim) },
  }), [height, seed, shade, rim]);

  return (
    <mesh position={[0, 10, z]}>
      <planeGeometry args={[220, 60]} />
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={/* glsl */ `
          varying vec2 vUv;
          void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
        `}
        fragmentShader={RIDGE_FRAG}
        transparent
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}

function Tent({ position, scale = 1, rotation = 0 }) {
  return (
    <group position={position} rotation={[0, rotation, 0]} scale={scale}>
      <mesh>
        <coneGeometry args={[1, 1.2, 4]} />
        <meshStandardMaterial {...SHADOW_MAT} />
      </mesh>
      <mesh position={[0, 0.02, 0.44]} rotation={[0.05, 0, 0]}>
        <planeGeometry args={[0.17, 0.34]} />
        <meshBasicMaterial color="#ffb677" transparent opacity={0.42} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.66, 0]}>
        <cylinderGeometry args={[0.012, 0.012, 0.2, 5]} />
        <meshStandardMaterial color="#0a1a16" roughness={0.9} />
      </mesh>
    </group>
  );
}

function Tree({ position, scale = 1 }) {
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0.9, 0]}>
        <cylinderGeometry args={[0.06, 0.09, 1.8, 6]} />
        <meshStandardMaterial {...SHADOW_MAT} />
      </mesh>
      <mesh position={[0, 2.2, 0]}>
        <icosahedronGeometry args={[0.78, 1]} />
        <meshStandardMaterial color="#05130f" roughness={1} flatShading />
      </mesh>
      <mesh position={[0.42, 1.75, 0.1]} scale={0.7}>
        <icosahedronGeometry args={[0.6, 1]} />
        <meshStandardMaterial color="#06170f" roughness={1} flatShading />
      </mesh>
    </group>
  );
}

function Canopy({ position, scale = 1 }) {
  return (
    <group position={position} scale={scale}>
      {/* shallow four-sided tarp roof — reads as a shelter, not a floating slab */}
      <mesh position={[0, 0.62, 0]} rotation={[0, Math.PI / 4, 0]} scale={[1.7, 1, 1.25]}>
        <coneGeometry args={[1.4, 0.34, 4]} />
        <meshStandardMaterial color="#071713" roughness={0.85} flatShading />
      </mesh>
      {[[-0.92, -0.62], [0.92, -0.62], [-0.92, 0.62], [0.92, 0.62]].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.16, z]}>
          <cylinderGeometry args={[0.03, 0.035, 0.95, 5]} />
          <meshStandardMaterial color="#0a201a" roughness={0.9} />
        </mesh>
      ))}
      <mesh position={[0, 0.02, 0]}>
        <boxGeometry args={[0.9, 0.06, 0.4]} />
        <meshStandardMaterial color="#0a201a" roughness={0.8} />
      </mesh>
      {/* warm lamp under the tarp */}
      <mesh position={[0, 0.44, 0.1]}>
        <sphereGeometry args={[0.022, 8, 6]} />
        <meshBasicMaterial color="#ffb066" toneMapped={false} transparent opacity={0.8} />
      </mesh>
    </group>
  );
}

function Person({ position, scale = 1 }) {
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0.62, 0]}>
        <capsuleGeometry args={[0.075, 0.26, 4, 8]} />
        <meshStandardMaterial color="#07130f" roughness={1} />
      </mesh>
      <mesh position={[0, 0.9, 0]}>
        <sphereGeometry args={[0.085, 10, 8]} />
        <meshStandardMaterial color="#08160f" roughness={1} />
      </mesh>
    </group>
  );
}

function Camp() {
  const tents = useMemo(() => ([
    { p: [-8.6, GROUND_Y + 0.72, -19.5], s: 1.2, r: 0.24 },
    { p: [-5.2, GROUND_Y + 0.62, -17.2], s: 1.0, r: -0.18 },
    { p: [2.2, GROUND_Y + 0.64, -18.4], s: 1.06, r: 0.32 },
    { p: [11.8, GROUND_Y + 0.86, -14.5], s: 1.7, r: -0.24 },
    { p: [15.6, GROUND_Y + 0.6, -19.2], s: 0.96, r: 0.3 },
    { p: [18.8, GROUND_Y + 0.5, -20.4], s: 0.84, r: -0.12 },
  ]), []);

  return (
    <group>
      <Ridge z={-44} height={0.410} seed={1.7} shade="#07201b" rim="#c98a4e" />
      <Ridge z={-26.5} height={0.377} seed={4.2} shade="#030c0b" rim="#ffb26b" />
      {tents.map((t, i) => <Tent key={i} position={t.p} scale={t.s} rotation={t.r} />)}
      <Canopy position={[-1.1, GROUND_Y, -15.4]} scale={1.05} />
      <Canopy position={[14.6, GROUND_Y, -15.6]} scale={1.0} />
      <Canopy position={[7.0, GROUND_Y, -24.0]} scale={0.8} />
      <Tree position={[-12.6, GROUND_Y, -21]} scale={1.5} />
      <Tree position={[18.2, GROUND_Y, -22.5]} scale={1.25} />
      <Tree position={[-10.4, GROUND_Y, -25]} scale={1.1} />
      <Tree position={[21.4, GROUND_Y, -26]} scale={1.4} />
      {[
        [-2.9, GROUND_Y, -15.1, 0.95],
        [-1.6, GROUND_Y, -15.7, 1.0],
        [1.9, GROUND_Y, -15.4, 0.92],
        [3.2, GROUND_Y, -16.0, 1.02],
        [-5.5, GROUND_Y, -17.6, 0.9],
      ].map(([x, y, z, s], i) => (
        <Person key={i} position={[x, y, z]} scale={s} />
      ))}
    </group>
  );
}

/* -------------------------------------------------------------------------- */
/* particles — drifting dust + a last handful of stars                          */
/* -------------------------------------------------------------------------- */
function softDiscTexture() {
  if (typeof document === 'undefined') return null;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.65)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

function Dust({ count }) {
  const ref = useRef(null);
  const tex = useMemo(() => softDiscTexture(), []);
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 34;
      arr[i * 3 + 1] = Math.random() * 12 - 3.5;
      arr[i * 3 + 2] = (Math.random() - 0.5) * 26 - 4;
    }
    return arr;
  }, [count]);

  useFrame((state, dt) => {
    if (!ref.current || sceneDrive.reduced) return;
    ref.current.rotation.y += dt * 0.012;
    ref.current.position.y = Math.sin(state.clock.elapsedTime * 0.12) * 0.18;
  });

  return (
    <points ref={ref} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={count} itemSize={3} array={positions} />
      </bufferGeometry>
      <pointsMaterial
        size={0.09}
        map={tex || undefined}
        color="#ffe6bd"
        transparent
        opacity={0.55}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        sizeAttenuation
        toneMapped={false}
      />
    </points>
  );
}

function Stars({ count }) {
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 120 + Math.random() * 40;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * 0.42 * Math.PI; // upper dome only
      arr[i * 3] = Math.sin(phi) * Math.cos(theta) * r;
      arr[i * 3 + 1] = Math.cos(phi) * r * 0.9 + 10;
      arr[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * r;
    }
    return arr;
  }, [count]);

  return (
    <points frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={count} itemSize={3} array={positions} />
      </bufferGeometry>
      <pointsMaterial
        size={0.42}
        color="#cfe9e2"
        transparent
        opacity={0.5}
        depthWrite={false}
        sizeAttenuation
        toneMapped={false}
      />
    </points>
  );
}

/* -------------------------------------------------------------------------- */
/* camera rig — damped scroll dolly + pointer parallax                         */
/* -------------------------------------------------------------------------- */
function Rig() {
  const { camera, size } = useThree();
  const target = useMemo(() => new THREE.Vector3(0, 2.7, -22), []);
  const yaw = useRef(0);
  const fov = useRef(48);

  useFrame((state, dt) => {
    const k = Math.min(1, dt * 3.2);
    if (sceneDrive.reduced) sceneDrive.smooth = 0;
    else sceneDrive.smooth += (sceneDrive.scroll - sceneDrive.smooth) * k;

    const t = state.clock.elapsedTime;
    const reduced = sceneDrive.reduced;
    const s = reduced ? 0 : sceneDrive.smooth;
    const drift = reduced ? 0 : 1;

    const px = reduced ? 0 : sceneDrive.mx;
    const py = reduced ? 0 : sceneDrive.my;

    /* ---- aspect-aware framing ------------------------------------------
       The sun sits at a fixed world angle. On a portrait phone the horizontal
       field of view is narrow enough that it would fall outside the frame, so
       the camera yaws toward it and opens up slightly. The composition is
       tuned, not just cropped.                                              */
    const aspect = size.width / Math.max(1, size.height);
    const portrait = aspect < 1.05;
    const yawWant = portrait ? 4.2 : 0;
    const fovWant = portrait ? 58 : 48;

    yaw.current += (yawWant - yaw.current) * Math.min(1, dt * 2.2);
    fov.current += (fovWant - fov.current) * Math.min(1, dt * 2.2);
    if (Math.abs(camera.fov - fov.current) > 0.01) {
      camera.fov = fov.current;
      camera.updateProjectionMatrix();
    }

    const wantX = yaw.current * 0.55 + px * 1.05;
    const wantY = 2.05 + Math.sin(t * 0.16) * 0.06 * drift + py * 0.42 + s * 1.15;
    const wantZ = (portrait ? 13.4 : 11.2) - s * 2.6;

    camera.position.x += (wantX - camera.position.x) * k * 0.6;
    camera.position.y += (wantY - camera.position.y) * k * 0.6;
    camera.position.z += (wantZ - camera.position.z) * k * 0.6;

    target.set(yaw.current, (portrait ? 0.35 : 2.65) + s * 1.6, -22);
    camera.lookAt(target);
  });

  return null;
}

/* -------------------------------------------------------------------------- */
/* size guard — R3F measures its host once on mount. When the canvas is mounted
   lazily (or inside a Suspense boundary that resolves after layout) that first
   measurement can land on a zero-size host, leaving a 300x150 drawing buffer
   stretched across the viewport. Keep the buffer honest.                     */
/* -------------------------------------------------------------------------- */
function SizeSync() {
  const gl = useThree((s) => s.gl);
  const setSize = useThree((s) => s.setSize);

  useEffect(() => {
    const canvas = gl.domElement;
    // The stage owns the real layout box; R3F's own wrapper can report 0×0 on
    // its first measurement when the canvas mounts inside a Suspense boundary.
    const stage = canvas.closest('.cine-stage') || canvas.parentElement;
    if (!stage) return undefined;

    const sync = () => {
      const w = stage.clientWidth;
      const h = stage.clientHeight;
      if (!w || !h) return;
      const ratio = gl.getPixelRatio();
      if (canvas.width !== Math.round(w * ratio) || canvas.height !== Math.round(h * ratio)) {
        setSize(w, h);
      }
    };

    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(stage);
    window.addEventListener('orientationchange', sync);
    return () => {
      ro.disconnect();
      window.removeEventListener('orientationchange', sync);
    };
  }, [gl, setSize]);

  return null;
}

/* -------------------------------------------------------------------------- */
/* scene assembly                                                              */
/* -------------------------------------------------------------------------- */
function Scene({ quality }) {
  const dust = quality === 'low' ? 140 : 320;
  const stars = quality === 'low' ? 90 : 220;

  return (
    <>
      <SizeSync />
      <Sky />
      <Stars count={stars} />
      <Sun />
      <Shaft position={[-2, -1.4, -24]} rotation={[0, 0.22, 0.34]} scale={[15, 30, 1]} strength={0.10} />
      <Shaft position={[16, -1.0, -23]} rotation={[0, -0.26, -0.4]} scale={[11, 26, 1]} strength={0.08} color="#ffd9a3" />
      <Shaft position={[9.5, -2.4, -25.5]} rotation={[0, 0, 0.06]} scale={[20, 34, 1]} strength={0.06} color="#ffe3b0" />

      <ambientLight intensity={0.22} color="#0d3b34" />
      <hemisphereLight args={['#123c3a', '#030b09', 0.55]} />
      <directionalLight position={[SUN_X, 9, SUN_Z + 6]} intensity={2.4} color="#ffcf9a" />
      <pointLight position={[SUN_X, 2, -24]} intensity={38} distance={46} decay={2} color="#ff9d57" />

      <Ground />
      <Camp />
      <Dust count={dust} />
      <Rig />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* public component                                                            */
/* -------------------------------------------------------------------------- */
export default function CinematicScene({ className = '' }) {
  const [failed, setFailed] = useState(false);
  const [reduced, setReduced] = useState(false);
  const quality = useMemo(() => {
    if (typeof window === 'undefined') return 'high';
    const cores = navigator.hardwareConcurrency || 4;
    const small = window.matchMedia('(max-width: 760px)').matches;
    const saveData = navigator.connection?.saveData;
    return cores <= 4 || small || saveData ? 'low' : 'high';
  }, []);

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    const update = () => {
      sceneDrive.reduced = mq.matches;
      setReduced(mq.matches);
    };
    update();
    mq.addEventListener?.('change', update);
    return () => mq.removeEventListener?.('change', update);
  }, []);

  if (failed) {
    return <CineFallback className={className} />;
  }

  return (
    <div className={`cine-stage ${className}`} aria-hidden="true">
      <SceneErrorBoundary onError={() => setFailed(true)}>
        <Canvas
          dpr={[1, quality === 'low' || reduced ? 1.35 : 1.75]}
          frameloop={reduced ? 'demand' : 'always'}
          camera={{ position: [0, 2.05, 11.2], fov: 48, near: 0.1, far: 500 }}
          gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
          onCreated={({ gl }) => {
            gl.toneMapping = THREE.ACESFilmicToneMapping;
            gl.toneMappingExposure = 1.02;
          }}
          style={{ width: '100%', height: '100%' }}
        >
          <Scene quality={quality} />
        </Canvas>
      </SceneErrorBoundary>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* WebGL failure guard                                                         */
/* -------------------------------------------------------------------------- */
class SceneErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { crashed: false };
  }
  static getDerivedStateFromError() {
    return { crashed: true };
  }
  componentDidCatch() {
    this.props.onError?.();
  }
  render() {
    if (this.state.crashed) return null;
    return this.props.children;
  }
}
