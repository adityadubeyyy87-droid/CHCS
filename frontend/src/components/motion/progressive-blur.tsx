// ProgressiveBlur.tsx — Motion Primitive: blur image until in view
'use client';

import React, { useRef } from 'react';
import { motion, useInView } from 'motion/react';

export type ProgressiveBlurProps = {
  children: React.ReactNode;
  blurAmount?: number;
  as?: React.ElementType;
  once?: boolean;
};

export function ProgressiveBlur({
  children,
  blurAmount = 20,
  as = 'div',
  once = true,
}: ProgressiveBlurProps) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once, margin: '-10%' });

  const MotionComponent = motion[as as keyof typeof motion];

  return (
    <MotionComponent
      ref={ref}
      initial={{ filter: `blur(${blurAmount}px)` }}
      animate={isInView ? { filter: '0px' } : { filter: `blur(${blurAmount}px)` }}
      transition={{ duration: 0.8, ease: 'easeOut' }}
    >
      {children}
    </MotionComponent>
  );
}
