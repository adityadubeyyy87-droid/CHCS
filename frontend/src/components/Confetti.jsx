// Confetti.jsx — canvas-based celebration confetti.
// Fires on booking confirmation, waitlist promotion, check-in — the "peak
// end" moment that makes the experience memorable.
import React, { useEffect, useRef } from 'react';

export default function Confetti({ active = true, count = 60 }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const rect = canvas.parentElement?.getBoundingClientRect() || { width: 400, height: 300 };
    canvas.width = rect.width;
    canvas.height = rect.height;

    const particles = [];
    const colors = ['#10b981', '#34d399', '#6ee7b7', '#f59e0b', '#fcd34d', '#60a5fa', '#a7f3d0'];

    for (let i = 0; i < count; i++) {
      particles.push({
        x: rect.width / 2,
        y: rect.height / 2,
        vx: (Math.random() - 0.5) * 20,
        vy: (Math.random() - 0.5) * 20 - 5,
        life: 100 + Math.random() * 100,
        color: colors[Math.floor(Math.random() * colors.length)],
        size: 4 + Math.random() * 6,
        rot: Math.random() * 360,
        rotSpeed: (Math.random() - 0.5) * 10,
      });
    }

    let frame = 0;
    const draw = () => {
      frame++;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      let alive = false;
      for (const p of particles) {
        if (p.life <= 0) continue;
        alive = true;
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.4; // gravity
        p.vx *= 0.96;
        p.life--;
        p.rot += p.rotSpeed;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rot * Math.PI) / 180);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.life / 100;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        ctx.restore();
      }
      if (alive && frame < 250) requestAnimationFrame(draw);
    };
    draw();
  }, [active, count]);

  return (
    <div className="fixed inset-0 z-[150] pointer-events-none">
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
    </div>
  );
}
