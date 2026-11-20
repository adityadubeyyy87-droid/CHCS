// TextLoop.tsx — Motion Primitive: looping text ticker
'use client';

import React, { useRef } from 'react';
import { motion, useMotionValue, useTransform } from 'motion/react';
import { cn } from '@/lib/utils';

export type TextLoopProps = {
  children: React.ReactNode;
  className?: string;
  speed?: number;
  reverse?: boolean;
};

export function TextLoop({
  children,
  className,
  speed = 30,
  reverse = false,
}: TextLoopProps) {
  const ref = useRef(null);

  const x = useMotionValue(0);
  const xSpring = useTransform(x, (v) => v);

  const handleMouseEnter = () => {
    x.set(-1000);
  };

  return (
    <motion.div
      ref={ref}
      className={cn(
        'relative overflow-hidden',
        className
      )}
      onMouseEnter={handleMouseEnter}
    >
      <motion.div
        className='flex items-center whitespace-nowrap'
        style={{
          x: xSpring,
          willChange: 'transform',
        }}
        animate={{
          x: reverse ? 1000 : -1000,
        }}
        transition={{
          repeat: Infinity,
          type: 'linear',
          duration: speed,
          ease: 'linear',
        }}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}
