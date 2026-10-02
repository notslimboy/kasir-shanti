import { useEffect, useRef, useState } from "react";

/**
 * Ukur lebar container dengan sendirinya.
 *
 * Recharts 3 `ResponsiveContainer`有时候 melaporkan 0 lewat ResizeObserver
 * (terutama di dalam grid/flex + headless screenshot), sehingga chart kosong.
 * Mengukur sendiri dan mengoper angka eksplisit ke chart removes ketergantungan
 * pada timing observer.
 */
export function useSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize((prev) =>
        Math.abs(prev.width - r.width) < 1 && Math.abs(prev.height - r.height) < 1
          ? prev
          : { width: r.width, height: r.height },
      );
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  return [ref, size] as const;
}
