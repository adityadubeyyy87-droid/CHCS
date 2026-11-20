// AnimatedNumber.tsx — Motion Primitive: smoothly animates a number from 0 to target
'use client';

import { cn } from '@/lib/utils';
import { motion, useSpring, useTransform } from 'motion/react';

export type AnimatedNumberProps = {
  value: number;
  className?: string;
  springOptions?: { stiffness?: number; damping?: number; mass?: number };
  as?: React.ElementType;
  format?: (value: number) => string;
};

export function AnimatedNumber({
  value,
  className,
  springOptions,
  as = 'span',
  format = (v) => Math.floor(v).toLocaleString(),
}: AnimatedNumberProps) {
  const MotionComponent = motion.create(as as keyof JSX.IntrinsicElements);

  const spring = useSpring(value, {
    stiffness: 300,
    damping: 30,
    mass: 0.5,
    ...springOptions,
  });
  const display = useTransform(spring, (current) => format(current));

  return (
    <MotionComponent className={cn('tabular-nums', className)}>
      {display}
    </MotionComponent>
  );
}
