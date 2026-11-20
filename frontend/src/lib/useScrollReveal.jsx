// useScrollReveal.jsx — IntersectionObserver hook that adds a 'revealed'
// class when an element enters the viewport, for staggered scroll animations.
import { useEffect, useRef } from 'react';

export default function useScrollReveal({ threshold = 0.12, once = true } = {}) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            el.classList.add('revealed');
            if (once) observer.unobserve(el);
          } else if (!once) {
            el.classList.remove('revealed');
          }
        });
      },
      { threshold, rootMargin: '0px 0px -80px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold, once]);

  return ref;
}
