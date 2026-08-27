import { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import { GLView, type ExpoWebGLRenderingContext } from 'expo-gl';
import { Renderer, TextureLoader } from 'expo-three';
import ThreeGlobe from 'three-globe';
import * as THREE from 'three';
import { subsolarPoint } from '../lib/solar';
import type { Station } from '../types';

const TEXTURES = {
  day: 'https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg',
  night: 'https://unpkg.com/three-globe/example/img/earth-night.jpg',
  topology: 'https://unpkg.com/three-globe/example/img/earth-topology.png',
} as const;

export const KIND_COLORS = {
  talk: '#54e6c3',
  music: '#8d7dff',
  unknown: '#5b7fb5',
} as const;

/** Warm gold overrides the kind color so favorites read as a distinct pin. */
export const FAVORITE_COLOR = '#ffcf6a';
const DEAD_COLOR = '#3a4256';
const GLOBE_RADIUS = 100;

const dayNightShader = {
  vertexShader: `
    varying vec3 vNormal;
    varying vec2 vUv;
    void main() {
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      vNormal = normalize(normalMatrix * normal);
      vUv = uv;
    }
  `,
  fragmentShader: `
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
      float blend = smoothstep(-0.18, 0.22, intensity);
      vec4 surface = mix(nightColor, dayColor, blend);
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
  onReady: () => void;
}

interface SceneState {
  camera: THREE.PerspectiveCamera;
  globe: ThreeGlobe;
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
  const sceneRef = useRef<SceneState | null>(null);
  const rotationRef = useRef({ x: -0.28, y: 0.25 });
  const distanceRef = useRef(285);
  const lastPinchRef = useRef<number | null>(null);
  const tapStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const latestPropsRef = useRef({ stations, selected, playing, deadStations, favoriteIds, onSelect });
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [error, setError] = useState<string | null>(null);

  latestPropsRef.current = { stations, selected, playing, deadStations, favoriteIds, onSelect };

  const maxClicks = useMemo(
    () => stations.reduce((max, station) => Math.max(max, station.clickcount), 1),
    [stations],
  );

  useEffect(() => {
    const state = sceneRef.current;
    if (!state) return;
    state.globe
      .pointsData(stations)
      .pointLat((object) => (object as Station).lat)
      .pointLng((object) => (object as Station).lon)
      .pointColor((object) => {
        const station = object as Station;
        if (deadStations.has(station.id)) return DEAD_COLOR;
        if (station.id === playing?.id) return '#ffffff';
        // Favorites override the kind color so they read as "yours" first.
        if (favoriteIds.has(station.id)) return FAVORITE_COLOR;
        return KIND_COLORS[station.kind];
      })
      .pointRadius((object) => {
        const station = object as Station;
        const popularity = Math.log1p(station.clickcount) / Math.log1p(maxClicks);
        const base = 0.16 + popularity * 0.34 + (station.id === playing?.id ? 0.24 : 0);
        return favoriteIds.has(station.id) ? base * 1.25 : base;
      })
      .pointAltitude((object) => {
        const station = object as Station;
        const popularity = Math.log1p(station.clickcount) / Math.log1p(maxClicks);
        return 0.006 + popularity * 0.05 + (station.id === playing?.id ? 0.03 : 0);
      })
      .pointResolution(8)
      .pointsTransitionDuration(450)
      .ringsData(ringsFor(selected, playing))
      .ringLat((object) => (object as Ring).lat)
      .ringLng((object) => (object as Ring).lng)
      .ringColor((object: object) => {
        const { color } = object as Ring;
        return (t: number) => `${color}${Math.round((1 - t) * 200).toString(16).padStart(2, '0')}`;
      })
      .ringMaxRadius((object) => (object as Ring).maxRadius)
      .ringPropagationSpeed(2)
      .ringRepeatPeriod((object) => (object as Ring).period);
  }, [deadStations, favoriteIds, maxClicks, playing, selected, stations]);

  useEffect(() => {
    if (!selected) return;
    rotationRef.current = {
      x: THREE.MathUtils.degToRad(-selected.lat),
      y: THREE.MathUtils.degToRad(selected.lon),
    };
  }, [selected]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => {
          const touch = event.nativeEvent.touches[0];
          if (touch) tapStartRef.current = { x: touch.pageX, y: touch.pageY, time: Date.now() };
        },
        onPanResponderMove: (event, gesture) => {
          const touches = event.nativeEvent.touches;
          if (touches.length >= 2) {
            const pinch = distanceBetween(touches[0], touches[1]);
            if (lastPinchRef.current !== null) {
              distanceRef.current = clamp(distanceRef.current - (pinch - lastPinchRef.current) * 0.8, 180, 430);
            }
            lastPinchRef.current = pinch;
            return;
          }
          lastPinchRef.current = null;
          rotationRef.current.y += gesture.dx * 0.0025;
          rotationRef.current.x = clamp(rotationRef.current.x + gesture.dy * 0.0025, -1.2, 1.2);
        },
        onPanResponderRelease: (event, gesture) => {
          lastPinchRef.current = null;
          const start = tapStartRef.current;
          tapStartRef.current = null;
          if (!start || Date.now() - start.time > 350 || Math.hypot(gesture.dx, gesture.dy) > 12) return;
          const location = event.nativeEvent;
          selectNearest(location.locationX, location.locationY, sceneRef.current, latestPropsRef.current, size);
        },
      }),
    [size],
  );

  const handleLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize({ width, height });
  };

  const handleContextCreate = async (gl: ExpoWebGLRenderingContext) => {
    if (size.width === 0 || size.height === 0) return;
    try {
      const renderer = new Renderer({
        gl: gl as unknown as WebGLRenderingContext,
        width: size.width,
        height: size.height,
        clearColor: 0x060a15,
        antialias: true,
      });
      renderer.setSize(size.width, size.height);

      const scene = new THREE.Scene();
      scene.fog = new THREE.Fog(0x060a15, 240, 620);

      const camera = new THREE.PerspectiveCamera(45, size.width / size.height, 0.1, 1200);
      const globe = new ThreeGlobe({ waitForGlobeReady: true, animateIn: false })
        .globeImageUrl(TEXTURES.day)
        .bumpImageUrl(TEXTURES.topology)
        .showAtmosphere(true)
        .atmosphereColor('#6fb7ff')
        .atmosphereAltitude(0.19);

      const material = await buildDayNightMaterial();
      if (material) globe.globeMaterial(material as never);

      scene.add(starField());
      scene.add(new THREE.AmbientLight(0x8fb3ff, 1.7));
      const key = new THREE.DirectionalLight(0xffffff, 1.15);
      key.position.set(180, 120, 220);
      scene.add(key);
      scene.add(globe as unknown as THREE.Object3D);
      sceneRef.current = { camera, globe };
      onReady();

      let frame = 0;
      const render = () => {
        frame = requestAnimationFrame(render);
        if (!latestPropsRef.current.playing) rotationRef.current.y += 0.00055;
        globe.rotation.x = rotationRef.current.x;
        globe.rotation.y = rotationRef.current.y;
        camera.position.set(0, 0, distanceRef.current);
        camera.lookAt(0, 0, 0);
        material?.uniforms.sunPosition.value.set(subsolarPoint().lng, subsolarPoint().lat);
        material?.uniforms.globeRotation.value.set(THREE.MathUtils.radToDeg(rotationRef.current.y), THREE.MathUtils.radToDeg(rotationRef.current.x));
        renderer.render(scene, camera);
        gl.endFrameEXP();
      };
      render();

      return () => cancelAnimationFrame(frame);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not start the globe renderer.');
      onReady();
    }
  };

  return (
    <View style={styles.shell} onLayout={handleLayout} {...panResponder.panHandlers}>
      {size.width > 0 && size.height > 0 && (
        <GLView
          key={`${Math.round(size.width)}x${Math.round(size.height)}`}
          style={StyleSheet.absoluteFill}
          onContextCreate={(gl) => void handleContextCreate(gl)}
        />
      )}
      <View style={styles.vignette} pointerEvents="none" />
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

interface Ring {
  lat: number;
  lng: number;
  color: string;
  period: number;
  maxRadius: number;
}

function ringsFor(selected: Station | null, playing: Station | null): Ring[] {
  const data: Ring[] = [];
  if (playing) data.push({ lat: playing.lat, lng: playing.lon, color: '#54e6c3', period: 1400, maxRadius: 4.5 });
  if (selected && selected.id !== playing?.id) {
    data.push({ lat: selected.lat, lng: selected.lon, color: '#8d7dff', period: 2600, maxRadius: 2.6 });
  }
  return data;
}

async function buildDayNightMaterial(): Promise<THREE.ShaderMaterial | null> {
  const loader = new TextureLoader();
  const load = (url: string) =>
    new Promise<THREE.Texture>((resolve, reject) => loader.load(url, resolve, undefined, reject));
  try {
    const [day, night] = await Promise.all([load(TEXTURES.day), load(TEXTURES.night)]);
    day.colorSpace = THREE.SRGBColorSpace;
    night.colorSpace = THREE.SRGBColorSpace;
    const sun = subsolarPoint();
    return new THREE.ShaderMaterial({
      uniforms: {
        dayTexture: { value: day },
        nightTexture: { value: night },
        sunPosition: { value: new THREE.Vector2(sun.lng, sun.lat) },
        globeRotation: { value: new THREE.Vector2() },
      },
      vertexShader: dayNightShader.vertexShader,
      fragmentShader: dayNightShader.fragmentShader,
    });
  } catch {
    return null;
  }
}

function starField(): THREE.Points {
  const count = 900;
  const vertices = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const radius = 520 + Math.random() * 260;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random() * 2 - 1);
    vertices[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
    vertices[i * 3 + 1] = radius * Math.cos(phi);
    vertices[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  return new THREE.Points(
    geometry,
    new THREE.PointsMaterial({ color: '#c8d7ff', size: 1.4, sizeAttenuation: true, transparent: true, opacity: 0.75 }),
  );
}

function selectNearest(
  x: number,
  y: number,
  state: SceneState | null,
  props: { stations: Station[]; onSelect: (station: Station) => void },
  size: { width: number; height: number },
) {
  if (!state || size.width === 0 || size.height === 0) return;
  let best: { station: Station; distance: number } | null = null;
  for (const station of props.stations) {
    const coords = state.globe.getCoords(station.lat, station.lon, 0.08);
    const rotation = new THREE.Euler(state.globe.rotation.x, state.globe.rotation.y, state.globe.rotation.z);
    const vector = new THREE.Vector3(coords.x, coords.y, coords.z).applyEuler(rotation).project(state.camera);
    if (vector.z < -1 || vector.z > 1) continue;
    const sx = (vector.x + 1) * 0.5 * size.width;
    const sy = (-vector.y + 1) * 0.5 * size.height;
    const distance = Math.hypot(sx - x, sy - y);
    if (!best || distance < best.distance) best = { station, distance };
  }
  if (best && best.distance <= 34) props.onSelect(best.station);
}

function distanceBetween(a: GestureResponderEvent['nativeEvent']['touches'][number], b: GestureResponderEvent['nativeEvent']['touches'][number]) {
  return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: '#060a15',
  },
  vignette: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.08)',
  },
  error: {
    position: 'absolute',
    top: '48%',
    left: 24,
    right: 24,
    color: '#ffb3bf',
    textAlign: 'center',
  },
});
