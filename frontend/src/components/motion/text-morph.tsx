// TextMorph.tsx — Motion Primitive: morph between different text strings
'use client';

import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { cn } from '@/lib/utils';

export type TextMorphProps = {
  children: string[];
  duration?: number;
  className?: string;
  as?: React.ElementType;
};

export function TextMorph({
  children,
  duration = 3,
  className,
  as = 'span',
}: TextMorphProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [nextIndex, setNextIndex] = useState(0);
  const [isMorphing, setIsMorphing] = useState(false);

  const MotionComponent = motion.create(as as keyof JSX.IntrinsicElements);

  useEffect(() => {
    const timer = setInterval(() => {
      setIsMorphing(true);
      setNextIndex((prev) => (prev + 1) % children.length);
    }, duration * 1000);
    return () => clearInterval(timer);
  }, [children, duration]);

  useEffect(() => {
    if (isMorphing) {
      const timer = setTimeout(() => {
        setCurrentIndex(nextIndex);
        setIsMorphing(false);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [isMorphing, nextIndex]);

  return (
    <motion.div
      className={cn('relative inline-block overflow-hidden', className)}
    >
      <MotionComponent
        className={cn(
          'absolute inset-0 transform-gpu',
          isMorphing ? 'translate-y-[-100%]' : 'translate-y-0'
        )}
        style={{
          transition: isMorphing
            ? 'transform 0.3s ease-out'
            : 'transform 0.6s cubic-bezier(0.23, 1, 0.32, 1)',
        }}
      >
        {children[currentIndex]}
      </MotionComponent>
      {isMorphing && (
        <MotionComponent
          className={cn(
            'absolute inset-0 transform-gpu',
            'translate-y-full'
          )}
          style={{
            transition: 'transform 0.6s cubic-bezier(0.23, 1, 0.32, 1)',
          }}
        >
          {children[nextIndex]}
        </MotionComponent>
      )}
    </motion.div>
  );
}
