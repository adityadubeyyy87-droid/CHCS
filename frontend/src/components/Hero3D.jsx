// Hero3D.jsx — emerald diagnostic cell for the sign-in screen.
// A restrained React Three Fiber scene: one translucent cell, three orbiting
// rings and a sparse particle field. Decorative only; the form stays the hero.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Float, Stars } from '@react-three/drei';
import * as THREE from 'three';

const CELL_COLORS = {
  core: '#059669',
  shell: '#10b981',
  mint: '#6ee7b7',
};

function CoreCell({ motion = true }) {
  const group = useRef(null);

  useFrame((state, delta) => {
    if (!group.current || !motion) return;
    const t = state.clock.elapsedTime;
    group.current.rotation.y += delta * 0.18;
    group.current.rotation.x = Math.sin(t * 0.32) * 0.12 + state.pointer.y * 0.08;
    group.current.rotation.z = state.pointer.x * 0.06;
  });

  return (
    <group ref={group}>
      <Float speed={motion ? 1.1 : 0} rotationIntensity={motion ? 0.25 : 0} floatIntensity={motion ? 0.32 : 0}>
        <mesh>
          <icosahedronGeometry args={[0.82, 2]} />
          <meshStandardMaterial
            color={CELL_COLORS.shell}
            transparent
            opacity={0.28}
            roughness={0.28}
            metalness={0.08}
            side={THREE.DoubleSide}
            flatShading
          />
        </mesh>
      </Float>
      <mesh scale={0.62}>
        <icosahedronGeometry args={[0.82, 1]} />
        <meshStandardMaterial
          color={CELL_COLORS.core}
          transparent
          opacity={0.42}
          roughness={0.45}
          emissive={CELL_COLORS.core}
          emissiveIntensity={0.12}
          flatShading
        />
      </mesh>
    </group>
  );
}

function OrbitRing({ radius = 1.28, tube = 0.018, opacity = 0.45, rotation = [0, 0, 0], speed = 0.18, motion = true }) {
  const mesh = useRef(null);

  useFrame((_, delta) => {
    if (!mesh.current || !motion) return;
    mesh.current.rotation.z += delta * speed;
  });

  return (
    <mesh ref={mesh} rotation={rotation}>
      <torusGeometry args={[radius, tube, 8, 96]} />
      <meshBasicMaterial color={CELL_COLORS.mint} transparent opacity={opacity} toneMapped={false} />
    </mesh>
  );
}

function Satellite({ position, scale = 1, motion = true }) {
  const mesh = useRef(null);

  useFrame((state) => {
    if (!mesh.current || !motion) return;
    const t = state.clock.elapsedTime;
    mesh.current.position.y = position[1] + Math.sin(t * 0.8 + position[0]) * 0.08;
    mesh.current.rotation.y = t * 0.24;
  });

  return (
    <mesh ref={mesh} position={position} scale={scale}>
      <icosahedronGeometry args={[0.2, 1]} />
      <meshStandardMaterial
        color={CELL_COLORS.mint}
        transparent
        opacity={0.62}
        roughness={0.35}
        flatShading
      />
    </mesh>
  );
}

function CellParticles({ count = 72, motion = true }) {
  const points = useRef(null);
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 1.5 + Math.random() * 2.1;
      arr[i * 3] = Math.cos(angle) * radius;
      arr[i * 3 + 1] = (Math.random() - 0.5) * 4;
      arr[i * 3 + 2] = Math.sin(angle) * radius * 0.6;
    }
    return arr;
  }, [count]);

  useFrame((state) => {
    if (!points.current || !motion) return;
    points.current.rotation.y = state.clock.elapsedTime * 0.035;
  });

  return (
    <points ref={points}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={count} itemSize={3} array={positions} />
      </bufferGeometry>
      <pointsMaterial
        color={CELL_COLORS.mint}
        size={0.035}
        transparent
        opacity={0.58}
        sizeAttenuation
        depthWrite={false}
        toneMapped={false}
      />
    </points>
  );
}

function Scene({ motion }) {
  return (
    <>
      <ambientLight intensity={0.65} color="#d1fae5" />
      <directionalLight position={[3, 5, 4]} intensity={1.15} color="#ecfdf5" />
      <pointLight position={[-2.4, -1.2, 2]} intensity={1.8} distance={7} color={CELL_COLORS.shell} />

      <Stars radius={22} depth={18} count={motion ? 140 : 60} factor={2.4} saturation={0} fade speed={0.4} />
      <CellParticles count={motion ? 72 : 32} motion={motion} />

      <group scale={1.06}>
        <CoreCell motion={motion} />
        <OrbitRing radius={1.24} opacity={0.5} rotation={[0.42, 0.18, 0]} speed={0.16} motion={motion} />
        <OrbitRing radius={1.52} tube={0.012} opacity={0.34} rotation={[-0.62, 0.1, 0.5]} speed={-0.12} motion={motion} />
        <OrbitRing radius={1.82} tube={0.009} opacity={0.22} rotation={[0.18, -0.42, -0.32]} speed={0.09} motion={motion} />
        <Satellite position={[1.7, 0.32, -0.3]} motion={motion} />
        <Satellite position={[-1.55, -0.48, 0.2]} scale={0.72} motion={motion} />
      </group>
    </>
  );
}

export default function Hero3D({ width = 600, height = 400 }) {
  const [motion, setMotion] = useState(false);

  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!query) return undefined;
    const update = () => setMotion(!query.matches);
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);

  const style = {
    width: '100%',
    maxWidth: typeof width === 'number' ? `${width}px` : width,
    height: typeof height === 'number' ? `${height}px` : height,
  };

  return (
    <section className="relative overflow-hidden rounded-3xl border border-line bg-surface" style={style} aria-hidden="true">
      <div className="hero3d-fallback">
        <span className="hero3d-fallback__grid" />
        <span className="hero3d-fallback__ring hero3d-fallback__ring--outer" />
        <span className="hero3d-fallback__ring hero3d-fallback__ring--mid" />
        <span className="hero3d-fallback__ring hero3d-fallback__ring--inner" />
        <span className="hero3d-fallback__core" />
      </div>
      <Canvas
        className="absolute inset-0 h-full w-full"
        camera={{ position: [0, 0, 5.2], fov: 42, near: 0.1, far: 80 }}
        dpr={[1, 1.5]}
        frameloop={motion ? 'always' : 'demand'}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      >
        <Scene motion={motion} />
      </Canvas>
    </section>
  );
}
