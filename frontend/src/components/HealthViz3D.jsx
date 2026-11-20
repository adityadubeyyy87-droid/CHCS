// HealthViz3D.jsx — 3D healthcare data visualization for analytics dashboard.
// Floating bar-style columns representing patient metrics, with smooth
// transitions and hover states. Built with React Three Fiber.
import React, { useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

const METRICS = [
  { label: 'Registered', value: 1248, color: 0x10b981 },
  { label: 'Attendance', value: 85.3, color: 0x34d399 },
  { label: 'Promotions', value: 37, color: 0x6ee7b7 },
  { label: 'Waitlist', value: 14, color: 0xf59e0b },
  { label: 'No-Show', value: 14.7, color: 0xf87171 },
];

function BarColumn({ x, y, z, h, color, index, hovered }) {
  const meshRef = useRef();

  useFrame((state, delta) => {
    if (!meshRef.current) return;
    const targetScaleY = hovered ? h * 1.2 : h;
    meshRef.current.scale.y = THREE.MathUtils.lerp(meshRef.current.scale.y, targetScaleY, delta * 4);
    meshRef.current.material.opacity = THREE.MathUtils.lerp(meshRef.current.material.opacity, hovered ? 1 : 0.7, delta * 4);
    meshRef.current.position.y = h / 2;
  });

  return (
    <mesh
      ref={meshRef}
      position={[x, h / 2, z]}
      onPointerOver={() => (hovered = true)}
      onPointerOut={() => (hovered = false)}
    >
      <boxGeometry args={[0.6, h, 0.6]} />
      <meshStandardMaterial color={color} transparent={true} opacity={0.7} />
    </mesh>
  );
}

export default function HealthViz3D({ width = 400, height = 300 }) {
  const maxVal = Math.max(...METRICS.map((m) => m.value));

  return (
    <section className="relative w-full h-[300px] rounded-3xl bg-surface border border-line overflow-hidden">
      <Canvas
        className="absolute inset-0 w-full h-full"
        camera={{ position: [0, 4, 6], fov: 45 }}
        shadows
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      >
        <ambientLight intensity={0.5} />
        <directionalLight position={[5, 10, 7]} intensity={0.8} color="#ffffff" castShadow />
        <directionalLight position={[-5, -5, 5]} intensity={0.4} color="#34d399" castShadow />

        <OrbitControls enablePan={false} enableZoom={true} autoRotate={false} makeDefault />

        {/* Grid floor */}
        <gridHelper args={[20, 20, 0x6ee7b7, 0x10b981]} position={[0, -0.01, 0]} />
        <gridMaterial transparent={true} opacity={0.1} />

        {/* Bar columns */}
        {METRICS.map((m, i) => {
          const x = (i - 2) * 1.6;
          const h = (m.value / maxVal) * 3;
          return (
            <BarColumn
              key={m.label}
              x={x}
              y={0}
              z={0}
              h={h}
              color={m.color}
              index={i}
            />
          );
        })}

        {/* Floor label plane */}
        <mesh position={[0, -0.02, 4]} rotation={[Math.PI / 2, 0, 0]}>
          <planeGeometry args={[10, 10]} />
          <meshBasicMaterial color={0x10b981} transparent={true} opacity={0.05} side={THREE.DoubleSide} />
        </mesh>
      </Canvas>
    </section>
  );
}
