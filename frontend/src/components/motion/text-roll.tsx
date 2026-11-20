// TextRoll.tsx — Motion Primitive: vertical rolling text
'use client';

import React, { useRef } from 'react';
import { motion, useMotionValue, useTransform } from 'motion/react';
import { cn } from '@/lib/utils';

export type TextRollProps = {
  children: string[];
  duration?: number;
  className?: string;
};

export function TextRoll({
  children,
  duration = 2,
  className,
}: TextRollProps) {
  const ref = useRef(null);

  const y = useMotionValue(0);
  const ySpring = useTransform(y, (v) => v);

  const itemHeight = 40; // approx height per item

  return (
    <motion.div
      ref={ref}
      className={cn('relative overflow-hidden h-12', className)}
      style={{
        willChange: 'transform',
      }}
      animate={{
        y: -itemHeight * (children.length - 1),
      }}
      transition={{
        repeat: Infinity,
        type: 'spring',
        stiffness: 100,
        damping: 20,
        duration: duration,
        repeatType: 'mirror',
      }}
    >
      {children.map((text, i) => (
        <motion.div
          key={i}
          className='flex items-center justify-center h-12 whitespace-nowrap text-center'
          style={{ transform: `translateY(${i * itemHeight}px)` }}
        >
          {text}
        </motion.div>
      ))}
    </motion.div>
  );
}
