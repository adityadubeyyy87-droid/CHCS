// SpinningText.tsx — Motion Primitive: rotating text animation
'use client';

import React from 'react';
import { motion } from 'motion/react';
import { cn } from '@/lib/utils';

export type SpinningTextProps = {
  children: string;
  className?: string;
  duration?: number;
  reverse?: boolean;
};

export function SpinningText({
  children,
  className,
  duration = 3,
  reverse = false,
}: SpinningTextProps) {
  const chars = children.split('');

  return (
    <motion.div
      className={cn('relative inline-flex', className)}
      style={{ transformStyle: 'preserve-3d' }}
    >
      {chars.map((char, i) => (
        <motion.span
          key={i}
          className='inline-block'
          style={{
            display: 'inline-block',
            transform: `rotateY(${reverse ? -i : i} * ${360 / chars.length}deg) translateZ(60px)`,
          }}
        >
          {char}
        </motion.span>
      ))}
      <motion.div
        className='absolute inset-0'
        style={{
          transform: 'rotateX(65deg) translateZ(-60px)',
          background: 'rgba(0,0,0,0.3)',
          mixBlendMode: 'multiply',
        }}
      />
    </motion.div>
  );
}
