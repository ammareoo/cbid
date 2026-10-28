import { useEffect, useRef, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { cn } from '../../lib/utils';

export interface BeamsBackgroundProps {
  className?: string;
  children?: ReactNode;
  intensity?: 'subtle' | 'medium' | 'strong';
}

interface Beam {
  x: number;
  y: number;
  width: number;
  length: number;
  angle: number;
  speed: number;
  opacity: number;
  hue: number;
  pulse: number;
  pulseSpeed: number;
}

/** CBID palette: teal ~192, navy ~208, accent orange ~32 */
function beamHue(): number {
  const r = Math.random();
  if (r < 0.18) return 30 + Math.random() * 6;
  if (r < 0.58) return 186 + Math.random() * 14;
  return 200 + Math.random() * 18;
}

function createBeam(width: number, height: number): Beam {
  const angle = -35 + Math.random() * 10;
  return {
    x: Math.random() * width * 1.5 - width * 0.25,
    y: Math.random() * height * 1.5 - height * 0.25,
    width: 30 + Math.random() * 60,
    length: height * 2.5,
    angle,
    speed: 0.12 + Math.random() * 0.22,
    opacity: 0.1 + Math.random() * 0.14,
    hue: beamHue(),
    pulse: Math.random() * Math.PI * 2,
    pulseSpeed: 0.006 + Math.random() * 0.01,
  };
}

const OPACITY_MAP = { subtle: 0.65, medium: 0.82, strong: 1 } as const;
const MINIMUM_BEAMS = 20;

export function BeamsBackground({ className, children, intensity = 'medium' }: BeamsBackgroundProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const beamsRef = useRef<Beam[]>([]);
  const animationFrameRef = useRef<number>(0);
  const sizeRef = useRef({ width: 0, height: 0 });

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;

    const maybeCtx = canvas.getContext('2d');
    if (!maybeCtx) return;
    const drawCtx: CanvasRenderingContext2D = maybeCtx;

    const updateCanvasSize = () => {
      const width = root.clientWidth;
      const height = root.clientHeight;
      if (width < 1 || height < 1) return;

      sizeRef.current = { width, height };
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      drawCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const totalBeams = Math.round(MINIMUM_BEAMS * 1.5);
      beamsRef.current = Array.from({ length: totalBeams }, () => createBeam(width, height));
    };

    updateCanvasSize();
    const ro = new ResizeObserver(updateCanvasSize);
    ro.observe(root);

    function resetBeam(beam: Beam, index: number) {
      const { width, height } = sizeRef.current;
      const column = index % 3;
      const spacing = width / 3;

      beam.y = height + 100;
      beam.x = column * spacing + spacing / 2 + (Math.random() - 0.5) * spacing * 0.5;
      beam.width = 80 + Math.random() * 90;
      beam.speed = 0.1 + Math.random() * 0.18;
      beam.hue = beamHue();
      beam.opacity = 0.14 + Math.random() * 0.12;
      return beam;
    }

    function drawBeam(context: CanvasRenderingContext2D, beam: Beam) {
      context.save();
      context.translate(beam.x, beam.y);
      context.rotate((beam.angle * Math.PI) / 180);

      const pulsingOpacity =
        beam.opacity * (0.8 + Math.sin(beam.pulse) * 0.2) * OPACITY_MAP[intensity];

      const gradient = context.createLinearGradient(0, 0, 0, beam.length);
      gradient.addColorStop(0, `hsla(${beam.hue}, 72%, 58%, 0)`);
      gradient.addColorStop(0.1, `hsla(${beam.hue}, 72%, 58%, ${pulsingOpacity * 0.5})`);
      gradient.addColorStop(0.4, `hsla(${beam.hue}, 72%, 58%, ${pulsingOpacity})`);
      gradient.addColorStop(0.6, `hsla(${beam.hue}, 72%, 58%, ${pulsingOpacity})`);
      gradient.addColorStop(0.9, `hsla(${beam.hue}, 72%, 58%, ${pulsingOpacity * 0.5})`);
      gradient.addColorStop(1, `hsla(${beam.hue}, 72%, 58%, 0)`);

      context.fillStyle = gradient;
      context.fillRect(-beam.width / 2, 0, beam.width, beam.length);
      context.restore();
    }

    function animate() {
      const { width, height } = sizeRef.current;
      if (!width || !height) {
        animationFrameRef.current = requestAnimationFrame(animate);
        return;
      }

      drawCtx.clearRect(0, 0, width, height);
      drawCtx.filter = 'blur(35px)';

      beamsRef.current.forEach((beam, index) => {
        beam.y -= beam.speed;
        beam.pulse += beam.pulseSpeed;

        if (beam.y + beam.length < -100) {
          resetBeam(beam, index);
        }

        drawBeam(drawCtx, beam);
      });

      animationFrameRef.current = requestAnimationFrame(animate);
    }

    animate();

    return () => {
      ro.disconnect();
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [intensity]);

  return (
    <div ref={rootRef} className={cn('beams-background', className)} aria-hidden="true">
      <canvas ref={canvasRef} className="beams-background__canvas" />
      <motion.div
        className="beams-background__veil"
        animate={{ opacity: [0.04, 0.12, 0.04] }}
        transition={{ duration: 10, ease: 'easeInOut', repeat: Number.POSITIVE_INFINITY }}
      />
      {children}
    </div>
  );
}
