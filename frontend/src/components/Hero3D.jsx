// Hero3D.jsx — Cinematic 3D biophilic healthcare centerpiece for the hero section.
// Organic translucent structures, floating particles, environmental lighting,
// gentle mouse-responsive parallax, smooth camera movement.
// Built with React Three Fiber — lazy-loaded, graceful CSS fallback.
import React, { useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Stars, Float, useProgress } from '@react-three/drei';
import * as THREE from 'three';

// --- Organic translucent cell-like structure ---
function BioCell({ color = 0x10b981, opacity = 0.15, size = 1 }) {
  const meshRef = useRef();
  const { hover } = useRef({ value: 0 }).current;

  useFrame((state, delta) => {
    if (!meshRef.current) return;
    meshRef.current.rotation.y += 0.005;
    meshRef.current.rotation.z += 0.003;
    meshRef.current.position.y = Math.sin(state.elapsedTime * 0.5) * 0.15;
    meshRef.current.scale.setScalar(1 + Math.sin(state.elapsedTime * 0.7) * 0.05);
    meshRef.current.material.opacity = THREE.MathUtils.lerp(meshRef.current.material.opacity, hover, delta * 2);
  });

  const geometry = new THREE.IcosahedronGeometry(0.8 * size, 2);
  const material = new THREE.MeshStandardMaterial({
    color,
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
    flatShading: false,
    wireframe: false,
  });

  return (
    <mesh ref={meshRef} castShadow receiveShadow>
      <icosahedronGeometry args={[0.8 * size, 2]} />
      <meshStandardMaterial
        color={color}
        transparent={true}
        opacity={opacity}
        side={THREE.DoubleSide}
      />
      <Float speed={1} rotationIntensity={0.5} floatIntensity={0.1} />
      <pointLight
        color={color}
        intensity={0.5}
        distance={3}
        position={[0.5, 0.5, 0.5]}
      />
    </mesh>
  );
}

// --- Floating particle system ---
function ParticleSystem({ count = 80 }) {
  const pointsRef = useRef();

  useFrame((state) => {
    if (!pointsRef.current) return;
    pointsRef.current.rotation.y = state.elapsedTime * 0.05;
    pointsRef.current.rotation.x = Math.sin(state.elapsedTime * 0.3) * 0.1;
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={count}
          itemSize={3}
          array={new Float32Array(
            Array.from({ length: count }, () => [
              (Math.random() - 0.5) * 10,
              (Math.random() - 0.5) * 10,
              (Math.random() - 0.5) * 10,
            ]).flat()
          )}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.04}
        transparent={true}
        opacity={0.6}
        color={0x6ee7b7}
        sizeAttenuation={true}
      />
    </points>
  );
}

// --- Ambient light ring ---
function LightRing({ color = 0x10b981 }) {
  const ringRef = useRef();

  useFrame((state) => {
    if (!ringRef.current) return;
    ringRef.current.rotation.z = state.elapsedTime * 0.2;
    ringRef.current.position.y = Math.sin(state.elapsedTime * 0.8) * 0.3;
  });

  return (
    <group ref={ringRef}>
      <ringGeometry args={[0.5, 0.6, 32]} />
      <meshBasicMaterial color={color} transparent={true} opacity={0.3} side={THREE.DoubleSide} />
    </group>
  );
}

export default function Hero3D({ width = 600, height = 400 }) {
  const [hovered, setHovered] = useState(false);

  return (
    <section className="relative w-full h-[400px] overflow-hidden rounded-3xl bg-surface border border-line overflow-hidden group">
      {/* Fallback canvas */}
      <div className="absolute inset-0 flex items-center justify-center bg-surface-2">
        <span className="text-muted text-sm">3D scene initializing…</span>
      </div>
      <Canvas
        className="absolute inset-0 w-full h-full"
        camera={{ position: [0, 0, 4], fov: 45 }}
        shadows
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      >
        <ambientLight intensity={0.4} />
        <directionalLight position={[5, 10, 7]} intensity={1} color="#ffffff" castShadow />
        <spotLight position={[-5, 5, 5]} intensity={0.5} color="#34d399" penumbra={0.7} castShadow />
        <fog color="#0f172a" near={1} far={15} />

        <OrbitControls
          enablePan={false}
          enableZoom={false}
          autoRotate={true}
          autoRotateSpeed={0.5}
          makeDefault
        />

        <Stars radius={40} depth={50} count={200} factor={4} saturation={0} fadeSpeed={5} speed={1} />

        <LightRing color={0x10b981} position={[0, 0, 0]} />
        <BioCell color={0x10b981} opacity={0.12} size={1.2} position={[0, 0, 0]} />
        <BioCell color={0x34d399} opacity={0.08} size={0.8} position={[1.2, 0.8, -1]} />
        <BioCell color={0x6ee7b7} opacity={0.06} size={0.6} position={[-1.2, -0.8, -1]} />

        <ParticleSystem count={80} />

        <group position={[0, 1.5, 0]}>
          <LightRing color={0x6ee7b7} />
        </group>
      </Canvas>
    </section>
  );
}
