// InView.tsx — Motion Primitive: animate element when it enters viewport
'use client';
import { ReactNode, useRef, useState } from 'react';
import {
  motion,
  useInView,
  Variant,
  Transition,
  UseInViewOptions,
} from 'motion/react';

export type InViewProps = {
  children: ReactNode;
  className?: string;
  variants?: {
    hidden: Variant;
    visible: Variant;
  };
  transition?: Transition;
  viewOptions?: UseInViewOptions;
  as?: React.ElementType;
  once?: boolean;
  style?: React.CSSProperties;
};

const defaultVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

export function InView({
  children,
  className,
  variants = defaultVariants,
  transition = { duration: 0.6, ease: 'easeOut' },
  viewOptions,
  as = 'div',
  once = true,
  style,
}: InViewProps) {
  const ref = useRef(null);
  const isInView = useInView(ref, viewOptions);
  const [hasEntered, setHasEntered] = useState(false);

  const MotionComponent = motion[as as keyof typeof motion];

  return (
    <MotionComponent
      ref={ref}
      className={className}
      style={style}
      initial='hidden'
      // ``once`` must latch: a form that scrolls out of view must not become
      // invisible again (otherwise its controls leave the accessibility tree
      // and appear unclickable). Record the first intersection and keep it.
      animate={(isInView || (once && hasEntered)) ? 'visible' : 'hidden'}
      variants={variants}
      transition={transition}
      onAnimationComplete={() => {
        if (isInView) setHasEntered(true);
      }}
    >
      {children}
    </MotionComponent>
  );
}
