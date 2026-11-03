import React, { useEffect, useRef, useState } from 'react';

let chartLibraryPromise;

const loadChartLibrary = () => {
  if (!chartLibraryPromise) chartLibraryPromise = import('recharts');
  return chartLibraryPromise;
};

export default function DeferredChart({ children, fallback, className = 'h-full w-full' }) {
  const containerRef = useRef(null);
  const [nearViewport, setNearViewport] = useState(false);
  const [chartLibrary, setChartLibrary] = useState(null);

  useEffect(() => {
    const target = containerRef.current;
    if (!target || typeof IntersectionObserver === 'undefined') {
      setNearViewport(true);
      return undefined;
    }

    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      observer.disconnect();
      setNearViewport(true);
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!nearViewport) return undefined;
    let active = true;
    loadChartLibrary().then(module => {
      if (active) setChartLibrary(module);
    }).catch(() => {
      // Keep the reserved chart area stable if the optional chunk is unavailable.
    });
    return () => { active = false; };
  }, [nearViewport]);

  return (
    <div ref={containerRef} className={className} aria-busy={!chartLibrary}>
      {chartLibrary ? children(chartLibrary) : fallback}
    </div>
  );
}
