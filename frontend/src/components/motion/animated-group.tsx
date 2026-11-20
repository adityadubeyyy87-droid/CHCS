// AnimatedGroup.tsx — Motion Primitive: staggered animation group
'use client';

import React, { ReactNode } from 'react';
import { motion } from 'motion/react';

export type AnimatedGroupProps = {
  children: ReactNode;
  variants?: {
    hidden: any;
    visible: any;
  };
  transition?: any;
  as?: React.ElementType;
};

export function AnimatedGroup({
  children,
  variants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.1 },
    },
  },
  transition,
  as = 'div',
  ...props
}: AnimatedGroupProps) {
  const MotionComponent = motion[as as keyof typeof motion];

  return (
    <MotionComponent
      initial='hidden'
      animate='visible'
      variants={variants}
      transition={transition}
      {...props}
    >
      {children}
    </MotionComponent>
  );
}

export type AnimatedItemProps = {
  children: React.ReactNode;
  variants?: any;
  transition?: any;
  as?: React.ElementType;
};

export function AnimatedItem({
  children,
  variants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.6 } },
  },
  transition,
  as = 'div',
  ...props
}: AnimatedItemProps) {
  const MotionComponent = motion[as as keyof typeof motion];

  return (
    <MotionComponent
      initial='hidden'
      animate='visible'
      variants={variants}
      transition={transition}
      {...props}
    >
      {children}
    </MotionComponent>
  );
}
