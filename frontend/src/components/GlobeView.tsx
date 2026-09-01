import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Globe, { type GlobeMethods } from 'react-globe.gl';
import * as THREE from 'three';
import { flagEmoji, localTimeAt } from '../lib/format';
import type { FriendListening, Station } from '../types';

const TEXTURES = {
  day: 'https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg',
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

interface GlobeViewProps {
  stations: Station[];
  selected: Station | null;
  playing: Station | null;
  deadStations: ReadonlySet<string>;
  /** Station ids the user has favorited. Rendered gold + slightly larger. */
  favoriteIds: ReadonlySet<string>;
  /** Followed users who are live — gold-ringed pins with a username label. */
  friendsListening?: FriendListening[];
  onSelect: (station: Station) => void;
  /** Set once the textures are decoded, so the app can fade the loader out. */
  onReady?: () => void;
  /**
   * Fired when the browser kills the WebGL context (GPU process restart,
   * update-pending Chrome, mobile tab eviction). The parent should remount
   * this component with a fresh key — otherwise the globe stays black until
   * the user reloads the page.
   */
  onContextLost?: () => void;
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

interface FriendPin {
  stationId: string;
  lat: number;
  lon: number;
  usernames: string[];
}

export function GlobeView({
  stations,
  selected,
  playing,
  deadStations,
  favoriteIds,
  friendsListening = [],
  onSelect,
  onReady,
  onContextLost,
}: GlobeViewProps) {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const stationsRef = useRef(stations);
  stationsRef.current = stations;
  const [containerRef, size] = useElementSize();
  const [material, setMaterial] = useState<THREE.MeshBasicMaterial | null>(null);
  const [hovered, setHovered] = useState<Station | null>(null);
  const onContextLostRef = useRef(onContextLost);
  onContextLostRef.current = onContextLost;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const canvas = container.querySelector('canvas');
    if (!canvas) return;
    const handleLost = (event: Event) => {
      event.preventDefault();
      onContextLostRef.current?.();
    };
    canvas.addEventListener('webglcontextlost', handleLost);
    return () => canvas.removeEventListener('webglcontextlost', handleLost);
  }, [containerRef, material, size.width]);

  // Always-daylight globe: an unlit material with the day texture, so no part
  // of the Earth is ever in shadow regardless of the real time of day.
  useEffect(() => {
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    let disposed = false;

    loader.load(
      TEXTURES.day,
      (day) => {
        if (disposed) {
          day.dispose();
          return;
        }
        day.colorSpace = THREE.SRGBColorSpace;
        setMaterial(new THREE.MeshBasicMaterial({ map: day }));
        onReady?.();
      },
      undefined,
      () => {
        // Without the texture globe.gl still renders its default sphere, so
        // the app degrades to a plain globe instead of a blank screen.
        onReady?.();
      },
    );

    return () => {
      disposed = true;
    };
  }, [onReady]);

  const friendStationIds = useMemo(
    () => new Set(friendsListening.map((friend) => friend.stationId)),
    [friendsListening],
  );

  const friendPins = useMemo(() => {
    const grouped = new Map<string, FriendPin>();
    for (const friend of friendsListening) {
      const existing = grouped.get(friend.stationId);
      if (existing) {
        existing.usernames.push(friend.username);
      } else {
        grouped.set(friend.stationId, {
          stationId: friend.stationId,
          lat: friend.lat,
          lon: friend.lon,
          usernames: [friend.username],
        });
      }
    }
    return [...grouped.values()];
  }, [friendsListening]);

  // Idle auto-rotation, paused while a station is selected or a friend pin is up.
  useEffect(() => {
    const controls = globeRef.current?.controls();
    if (!controls) return;
    controls.autoRotate = selected === null && friendPins.length === 0;
    controls.autoRotateSpeed = 0.22;
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.minDistance = 140;
    controls.maxDistance = 620;
  }, [friendPins.length, selected, material]);

  // Fly the camera to the selection.
  useEffect(() => {
    if (!selected) return;
    globeRef.current?.pointOfView({ lat: selected.lat, lng: selected.lon, altitude: 1.35 }, 1400);
  }, [selected]);

  // If the globe is idle, glance at a friend who just started listening so
  // their gold pin is on-camera instead of hidden on the far side.
  const glance = friendPins[0];
  const glanceKey = glance ? `${glance.stationId}:${glance.lat}:${glance.lon}` : '';
  const glanceRef = useRef(glance);
  glanceRef.current = glance;

  useEffect(() => {
    const target = glanceRef.current;
    if (selected || playing || !target) return;
    globeRef.current?.pointOfView({ lat: target.lat, lng: target.lon, altitude: 1.45 }, 1400);
  }, [glanceKey, playing, selected]);

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
      // Favorited / friend-listening pins get a small extra bump so they still
      // stand out even when the station is rarely clicked.
      return favoriteIds.has(station.id) || friendStationIds.has(station.id) ? scaled * 1.25 : scaled;
    },
    [favoriteIds, friendStationIds, maxClicks, playing],
  );

  const pointColor = useCallback(
    (object: object) => {
      const station = object as Station;
      if (deadStations.has(station.id)) return DEAD_COLOR;
      if (station.id === playing?.id) return '#ffffff';
      // Favorites and live friend stations share the gold pin pathway.
      if (favoriteIds.has(station.id) || friendStationIds.has(station.id)) return FAVORITE_COLOR;
      return KIND_COLORS[station.kind];
    },
    [deadStations, favoriteIds, friendStationIds, playing],
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

  /** Playing / selection rings, plus a gold pulse at each friend station. */
  const rings = useMemo(() => {
    const data: { lat: number; lng: number; color: string; period: number; maxRadius: number }[] = [];
    if (playing) {
      data.push({ lat: playing.lat, lng: playing.lon, color: '#54e6c3', period: 1400, maxRadius: 4.5 });
    }
    if (selected && selected.id !== playing?.id) {
      data.push({ lat: selected.lat, lng: selected.lon, color: '#8d7dff', period: 2600, maxRadius: 2.6 });
    }
    for (const pin of friendPins) {
      if (pin.stationId === playing?.id || pin.stationId === selected?.id) continue;
      data.push({ lat: pin.lat, lng: pin.lon, color: FAVORITE_COLOR, period: 1800, maxRadius: 3.4 });
    }
    return data;
  }, [friendPins, playing, selected]);

  const friendHtmlElement = useCallback((object: object) => {
    const pin = object as FriendPin;
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'friend-pin';
    el.dataset.testid = 'friend-pin';
    el.dataset.username = pin.usernames.join(',');
    el.setAttribute('aria-label', `Tune to ${pin.usernames.join(', ')}'s station`);
    el.innerHTML = `
      <span class="friend-pin__ring" aria-hidden="true"></span>
      <span class="friend-pin__label">${pin.usernames.map(escapeHtml).join(', ')}</span>
    `;
    el.addEventListener('click', (event) => {
      event.stopPropagation();
      const station = stationsRef.current.find((candidate) => candidate.id === pin.stationId);
      if (station) onSelectRef.current(station);
    });
    return el;
  }, []);

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
          htmlElementsData={friendPins}
          htmlLat={(object: object) => (object as FriendPin).lat}
          htmlLng={(object: object) => (object as FriendPin).lon}
          htmlAltitude={0.018}
          htmlElement={friendHtmlElement}
          htmlTransitionDuration={0}
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
