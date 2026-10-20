import { useEffect, useState } from 'preact/hooks';

/** Minimal observable value with a hook. */
export function store<T>(v: T) {
  const subs = new Set<() => void>();
  return {
    get: () => v,
    set(n: T) { v = n; subs.forEach((f) => f()); },
    use(): T {
      const [, bump] = useState(0);
      useEffect(() => {
        const f = () => bump((x) => x + 1);
        subs.add(f);
        return () => { subs.delete(f); };
      }, []);
      return v;
    },
  };
}
