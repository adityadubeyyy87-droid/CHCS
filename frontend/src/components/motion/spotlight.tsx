// Spotlight.tsx — Motion Primitive: mouse-following focus ring (no glow).
'use client';

import React, { useRef } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'motion/react';

export type SpotlightProps = {
  children: React.ReactNode;
  className?: string;
  color?: string;
  size?: number;
  intensity?: number;
};

export function Spotlight({
  children,
  className,
  color = 'rgba(16, 185, 129, 0.35)',
  size = 120,
  intensity = 1,
}: SpotlightProps) {
  const ref = useRef<HTMLDivElement>(null);

  const x = useMotionValue(0);
  const y = useMotionValue(0);

  const xSpring = useSpring(x, { damping: 22, stiffness: 300 });
  const ySpring = useSpring(y, { damping: 22, stiffness: 300 });

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!ref.current) return;

    const rect = ref.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    x.set(mouseX);
    y.set(mouseY);
  };

  const handleMouseLeave = () => {
    x.set(-size);
    y.set(-size);
  };

  return (
    <motion.div
      ref={ref}
      className={cn('relative overflow-hidden', className)}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {children}
      <motion.div
        style={{
          x: xSpring,
          y: ySpring,
          width: size,
          height: size,
          border: `1px solid ${color}`,
          borderRadius: '50%',
          background: 'transparent',
          opacity: intensity,
          position: 'absolute',
          pointerEvents: 'none',
          transform: 'translate(-50%, -50%)',
          willChange: 'transform',
        }}
      />
    </motion.div>
  );
}

import { cn } from '@/lib/utils';
