// BorderTrail.tsx — Motion Primitive: animated border trail on hover
'use client';

import React, { useRef, useState } from 'react';
import { motion, useMotionValue, useTransform } from 'motion/react';

export type BorderTrailProps = {
  children: React.ReactNode;
  className?: string;
  color?: string;
  width?: number;
  duration?: number;
};

export function BorderTrail({
  children,
  className,
  color = '#10b981',
  width = 2,
  duration = 0.3,
}: BorderTrailProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);

  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const show = useMotionValue(0);

  const xSpring = useTransform(x, (v) => v);
  const ySpring = useTransform(y, (v) => v);
  const showSpring = useTransform(show, (v) => v);

  const handleMouseEnter = (e: React.MouseEvent) => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    x.set(e.clientX - rect.left);
    y.set(e.clientY - rect.top);
    setHovered(true);
    show.set(1);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!ref.current || !hovered) return;
    const rect = ref.current.getBoundingClientRect();
    x.set(e.clientX - rect.left);
    y.set(e.clientY - rect.top);
  };

  const handleMouseLeave = () => {
    setHovered(false);
    show.set(0);
  };

  return (
    <motion.div
      ref={ref}
      className={cn('relative group', className)}
      onMouseEnter={handleMouseEnter}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {children}
      <motion.div
        style={{
          x: xSpring,
          y: ySpring,
          opacity: showSpring,
          width: width,
          height: width,
          borderRadius: '50%',
          background: color,
          pointerEvents: 'none',
          position: 'absolute',
          transform: 'translate(-50%, -50%)',
        }}
      />
    </motion.div>
  );
}

import { cn } from '@/lib/utils';
