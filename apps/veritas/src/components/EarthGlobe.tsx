"use client";

import { useEffect, useRef, useState } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";

export default function EarthGlobe() {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 600, h: 600 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setDims({ w: Math.max(200, width), h: Math.max(200, height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="relative h-full min-h-0 w-full">
      <Globe
        ref={globeRef}
        width={dims.w}
        height={dims.h}
        backgroundColor="#0c0a07"
        globeImageUrl="/earth-night.jpg"
        bumpImageUrl="/earth-topology.png"
        atmosphereColor="#ffb454"
        atmosphereAltitude={0.12}
        onGlobeReady={() => {
          const g = globeRef.current;
          if (!g) return;
          g.controls().autoRotate = true;
          g.controls().autoRotateSpeed = 0.35;
          g.controls().enableDamping = true;
          g.pointOfView({ lat: 20, lng: 15, altitude: 2.2 }, 0);
        }}
      />
    </div>
  );
}
