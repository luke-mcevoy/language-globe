import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Globe, { type GlobeMethods } from 'react-globe.gl';
import * as THREE from 'three';
import { subsolarPoint } from '../lib/solar';
import { flagEmoji, localTimeAt } from '../lib/format';
import type { Station } from '../types';

const TEXTURES = {
  day: 'https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg',
  night: 'https://unpkg.com/three-globe/example/img/earth-night.jpg',
  topology: 'https://unpkg.com/three-globe/example/img/earth-topology.png',
  stars: 'https://unpkg.com/three-globe/example/img/night-sky.png',
} as const;

export const KIND_COLORS = {
  talk: '#54e6c3',
  music: '#8d7dff',
  unknown: '#5b7fb5',
} as const;

/** Warm gold overrides the kind color so favorites read as a distinct pin. */
export const FAVORITE_COLOR = '#ffcf6a';
const DEAD_COLOR = '#3a4256';

/**
 * Blends the daytime and night-lights textures across the real terminator.
 * `sunPosition` is the subsolar point in degrees; `globeRotation` is the
 * current camera point-of-view, which the shader needs because globe.gl
 * rotates the globe object rather than the camera.
 */
const dayNightShader = {
  vertexShader: /* glsl */ `
    varying vec3 vNormal;
    varying vec2 vUv;
    void main() {
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      vNormal = normalize(normalMatrix * normal);
      vUv = uv;
    }
  `,
  fragmentShader: /* glsl */ `
    #define PI 3.141592653589793

    uniform sampler2D dayTexture;
    uniform sampler2D nightTexture;
    uniform vec2 sunPosition;
    uniform vec2 globeRotation;
    varying vec3 vNormal;
    varying vec2 vUv;

    float toRad(in float a) { return a * PI / 180.0; }

    vec3 polarToCartesian(in vec2 lngLat) {
      float theta = toRad(90.0 - lngLat.x);
      float phi = toRad(90.0 - lngLat.y);
      return vec3(sin(phi) * cos(theta), cos(phi), sin(phi) * sin(theta));
    }

    void main() {
      float invLon = toRad(globeRotation.x);
      float invLat = -toRad(globeRotation.y);
      mat3 rotX = mat3(1, 0, 0, 0, cos(invLat), -sin(invLat), 0, sin(invLat), cos(invLat));
      mat3 rotY = mat3(cos(invLon), 0, sin(invLon), 0, 1, 0, -sin(invLon), 0, cos(invLon));
      vec3 sunDirection = rotX * rotY * polarToCartesian(sunPosition);

      float intensity = dot(normalize(vNormal), normalize(sunDirection));
      vec4 dayColor = texture2D(dayTexture, vUv);
      vec4 nightColor = texture2D(nightTexture, vUv);

      // Wide-ish blend so dusk reads as a soft band rather than a hard edge.
      float blend = smoothstep(-0.18, 0.22, intensity);
      vec4 surface = mix(nightColor, dayColor, blend);

      // Cool the night side slightly and warm the terminator.
      vec3 dusk = vec3(1.06, 0.86, 0.72);
      float duskAmount = 1.0 - abs(smoothstep(-0.18, 0.22, intensity) * 2.0 - 1.0);
      surface.rgb = mix(surface.rgb, surface.rgb * dusk, duskAmount * 0.45);

      gl_FragColor = surface;
    }
  `,
};

interface GlobeViewProps {
  stations: Station[];
  selected: Station | null;
  playing: Station | null;
  deadStations: ReadonlySet<string>;
  /** Station ids the user has favorited. Rendered gold + slightly larger. */
  favoriteIds: ReadonlySet<string>;
  onSelect: (station: Station) => void;
  /** Set once the textures are decoded, so the app can fade the loader out. */
  onReady?: () => void;
}

interface Size {
  width: number;
  height: number;
}

function useElementSize(): [React.RefObject<HTMLDivElement | null>, Size] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize({ width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, size];
}

export function GlobeView({
  stations,
  selected,
  playing,
  deadStations,
  favoriteIds,
  onSelect,
  onReady,
}: GlobeViewProps) {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const [containerRef, size] = useElementSize();
  const [material, setMaterial] = useState<THREE.ShaderMaterial | null>(null);
  const [hovered, setHovered] = useState<Station | null>(null);

  // Build the shader material once, then keep its sun uniform on real time.
  useEffect(() => {
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    let disposed = false;

    const load = (url: string): Promise<THREE.Texture> =>
      new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject));

    void Promise.all([load(TEXTURES.day), load(TEXTURES.night)])
      .then(([day, night]) => {
        if (disposed) {
          day.dispose();
          night.dispose();
          return;
        }
        day.colorSpace = THREE.SRGBColorSpace;
        night.colorSpace = THREE.SRGBColorSpace;

        const sun = subsolarPoint();
        setMaterial(
          new THREE.ShaderMaterial({
            uniforms: {
              dayTexture: { value: day },
              nightTexture: { value: night },
              sunPosition: { value: new THREE.Vector2(sun.lng, sun.lat) },
              globeRotation: { value: new THREE.Vector2() },
            },
            vertexShader: dayNightShader.vertexShader,
            fragmentShader: dayNightShader.fragmentShader,
          }),
        );
        onReady?.();
      })
      .catch(() => {
        // Without the textures globe.gl still renders its default sphere, so
        // the app degrades to a plain globe instead of a blank screen.
        onReady?.();
      });

    return () => {
      disposed = true;
    };
  }, [onReady]);

  useEffect(() => {
    if (!material) return;
    const tick = () => {
      const sun = subsolarPoint();
      (material.uniforms.sunPosition?.value as THREE.Vector2 | undefined)?.set(sun.lng, sun.lat);
    };
    tick();
    const timer = window.setInterval(tick, 30_000);
    return () => window.clearInterval(timer);
  }, [material]);

  // Idle auto-rotation, paused while a station is selected.
  useEffect(() => {
    const controls = globeRef.current?.controls();
    if (!controls) return;
    controls.autoRotate = selected === null;
    controls.autoRotateSpeed = 0.22;
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.minDistance = 140;
    controls.maxDistance = 620;
  }, [selected, material]);

  // Fly the camera to the selection.
  useEffect(() => {
    if (!selected) return;
    globeRef.current?.pointOfView({ lat: selected.lat, lng: selected.lon, altitude: 1.35 }, 1400);
  }, [selected]);

  const handleZoom = useCallback(
    (pov: { lat: number; lng: number; altitude: number }) => {
      (material?.uniforms.globeRotation?.value as THREE.Vector2 | undefined)?.set(pov.lng, pov.lat);
    },
    [material],
  );

  const maxClicks = useMemo(
    () => stations.reduce((max, station) => Math.max(max, station.clickcount), 1),
    [stations],
  );

  const pointRadius = useCallback(
    (object: object) => {
      const station = object as Station;
      const popularity = Math.log1p(station.clickcount) / Math.log1p(maxClicks);
      const base = 0.16 + popularity * 0.34;
      const scaled = station.id === playing?.id ? base * 1.6 : base;
      // Favorited pins get a small extra bump so they still stand out even
      // when the station is rarely clicked (i.e. would otherwise be tiny).
      return favoriteIds.has(station.id) ? scaled * 1.25 : scaled;
    },
    [favoriteIds, maxClicks, playing],
  );

  const pointColor = useCallback(
    (object: object) => {
      const station = object as Station;
      if (deadStations.has(station.id)) return DEAD_COLOR;
      if (station.id === playing?.id) return '#ffffff';
      // Favorites override the kind color: they are the user's collection, so
      // they should read as "yours" first, "talk/music" second.
      if (favoriteIds.has(station.id)) return FAVORITE_COLOR;
      return KIND_COLORS[station.kind];
    },
    [deadStations, favoriteIds, playing],
  );

  const pointAltitude = useCallback(
    (object: object) => {
      const station = object as Station;
      const popularity = Math.log1p(station.clickcount) / Math.log1p(maxClicks);
      return 0.006 + popularity * 0.05 + (station.id === playing?.id ? 0.03 : 0);
    },
    [maxClicks, playing],
  );

  const pointLabel = useCallback((object: object) => {
    const station = object as Station;
    const place = [station.state, station.country].filter(Boolean).join(', ');
    const tags = station.tags.slice(0, 3).join(' · ');
    return `
      <div class="globe-tooltip">
        <div class="globe-tooltip__name">${escapeHtml(station.name)}</div>
        <div class="globe-tooltip__place">${flagEmoji(station.countryCode)} ${escapeHtml(place)}</div>
        ${tags ? `<div class="globe-tooltip__tags">${escapeHtml(tags)}</div>` : ''}
        <div class="globe-tooltip__meta">
          <span class="globe-tooltip__kind globe-tooltip__kind--${station.kind}">${station.kind}</span>
          <span>${localTimeAt(station.lon)} local</span>
        </div>
      </div>
    `;
  }, []);

  /** One ring for the station that is playing; a fainter one for the selection. */
  const rings = useMemo(() => {
    const data: { lat: number; lng: number; color: string; period: number; maxRadius: number }[] = [];
    if (playing) {
      data.push({ lat: playing.lat, lng: playing.lon, color: '#54e6c3', period: 1400, maxRadius: 4.5 });
    }
    if (selected && selected.id !== playing?.id) {
      data.push({ lat: selected.lat, lng: selected.lon, color: '#8d7dff', period: 2600, maxRadius: 2.6 });
    }
    return data;
  }, [playing, selected]);

  return (
    <div className={`globe-view${hovered ? ' globe-view--hovering' : ''}`} ref={containerRef}>
      {size.width > 0 && (
        <Globe
          ref={globeRef}
          width={size.width}
          height={size.height}
          backgroundImageUrl={TEXTURES.stars}
          bumpImageUrl={TEXTURES.topology}
          {...(material ? { globeMaterial: material } : {})}
          showAtmosphere
          atmosphereColor="#6fb7ff"
          atmosphereAltitude={0.19}
          pointsData={stations}
          pointLat={(object: object) => (object as Station).lat}
          pointLng={(object: object) => (object as Station).lon}
          pointColor={pointColor}
          pointAltitude={pointAltitude}
          pointRadius={pointRadius}
          pointResolution={6}
          pointsTransitionDuration={600}
          pointLabel={pointLabel}
          onPointHover={(object: object | null) => setHovered((object as Station | null) ?? null)}
          onPointClick={(object: object) => onSelect(object as Station)}
          onZoom={handleZoom}
          ringsData={rings}
          ringLat={(object: object) => (object as { lat: number }).lat}
          ringLng={(object: object) => (object as { lng: number }).lng}
          ringColor={(object: object) => {
            const { color } = object as { color: string };
            return (t: number) => `${color}${Math.round((1 - t) * 200).toString(16).padStart(2, '0')}`;
          }}
          ringMaxRadius={(object: object) => (object as { maxRadius: number }).maxRadius}
          ringPropagationSpeed={2}
          ringRepeatPeriod={(object: object) => (object as { period: number }).period}
          animateIn={false}
        />
      )}
    </div>
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
