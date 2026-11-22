// HealthViz3D.jsx — compact 3D healthcare data visualization.
// Metrics are supplied by the caller so the chart always reflects the live
// MySQL data loaded by that page. Built with React Three Fiber.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

function BarColumn({ x, h, color, reduce }) {
  const meshRef = useRef(null);
  const [hovered, setHovered] = useState(false);

  useFrame((_state, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const targetScale = h * (hovered ? 1.08 : 1);
    const targetOpacity = hovered ? 1 : 0.78;
    mesh.scale.y = reduce ? targetScale : THREE.MathUtils.lerp(mesh.scale.y, targetScale, delta * 5);
    mesh.material.opacity = reduce
      ? targetOpacity
      : THREE.MathUtils.lerp(mesh.material.opacity, targetOpacity, delta * 5);
    mesh.position.y = mesh.scale.y / 2;
  });

  return (
    <mesh
      ref={meshRef}
      position={[x, h / 2, 0]}
      scale={[1, h, 1]}
      onPointerOver={() => setHovered(true)}
      onPointerOut={() => setHovered(false)}
    >
      <boxGeometry args={[0.6, 1, 0.6]} />
      <meshStandardMaterial color={color} transparent opacity={0.78} roughness={0.35} />
    </mesh>
  );
}

export default function HealthViz3D({
  metrics = [],
  width = '100%',
  height = 300,
  className = '',
}) {
  const [reduce, setReduce] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    const update = () => setReduce(mq.matches);
    update();
    mq.addEventListener?.('change', update);
    return () => mq.removeEventListener?.('change', update);
  }, []);

  const data = useMemo(() => metrics.slice(0, 5), [metrics]);
  const maxVal = Math.max(1, ...data.map((m) => Number(m.value) || 0));
  const description = data.length
    ? `Live health metrics: ${data.map((m) => `${m.label} ${m.display ?? m.value}`).join(', ')}.`
    : 'Health metrics visualization. No data available.';

  if (!data.length) {
    return (
      <section className={`grid place-items-center rounded-2xl border border-line bg-surface ${className}`} style={{ width, height }} role="img" aria-label={description}>
        <p className="muted text-sm">Metrics will appear once data loads.</p>
      </section>
    );
  }

  return (
    <section
      className={`relative overflow-hidden rounded-2xl border border-line bg-surface ${className}`}
      style={{ width, height }}
      role="img"
      aria-label={description}
    >
      <Canvas
        className="absolute inset-0"
        camera={{ position: [0, 3.4, 6], fov: 45 }}
        frameloop={reduce ? 'demand' : 'always'}
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      >
        <ambientLight intensity={0.65} />
        <directionalLight position={[5, 10, 7]} intensity={0.85} />
        <directionalLight position={[-5, 2, 5]} intensity={0.35} color="#6ee7b7" />
        <gridHelper args={[16, 16, 0x6ee7b7, 0x10b981]} position={[0, 0, 0]} />
        {data.map((m, i) => (
          <BarColumn
            key={m.label}
            x={(i - (data.length - 1) / 2) * 1.6}
            h={(Number(m.value) / maxVal) * 2.8}
            color={m.color ?? 0x10b981}
            reduce={reduce}
          />
        ))}
        <OrbitControls enablePan={false} enableZoom={false} makeDefault />
      </Canvas>
    </section>
  );
}
