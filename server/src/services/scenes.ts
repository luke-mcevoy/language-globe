import { config } from '../config.js';
import type { Station } from '../types.js';

/**
 * Client for the local SDXL-Turbo sidecar (scene-server/), which draws an
 * ambient illustration of whatever the station is talking about. Entirely
 * optional: when the sidecar is not running the feature reports disabled and
 * the UI never shows the card.
 */

interface SidecarGenerateResponse {
  image?: unknown;
  seconds?: unknown;
}

let availabilityCache: { value: boolean; checkedAt: number } | null = null;
const AVAILABILITY_TTL_MS = 15_000;

export async function sceneServerAvailable(): Promise<boolean> {
  const now = Date.now();
  if (availabilityCache && now - availabilityCache.checkedAt < AVAILABILITY_TTL_MS) {
    return availabilityCache.value;
  }
  let value = false;
  try {
    const response = await fetch(new URL('/health', config.sceneServerUrl), {
      signal: AbortSignal.timeout(1_500),
    });
    value = response.ok;
  } catch {
    value = false;
  }
  availabilityCache = { value, checkedAt: now };
  return value;
}

/** For tests. */
export function resetSceneAvailabilityCache(): void {
  availabilityCache = null;
}

export async function generateSceneImage(prompt: string): Promise<{ imageBase64: string; seconds: number }> {
  // Generous timeout: the very first generation after sidecar start compiles
  // Metal kernels and can take ~30s; steady state is 2-4s.
  const response = await fetch(new URL('/generate', config.sceneServerUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, width: 768, height: 512, steps: 2 }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`scene server responded ${response.status}`);
  const payload = (await response.json()) as SidecarGenerateResponse;
  if (typeof payload.image !== 'string' || payload.image.length === 0) {
    throw new Error('scene server returned no image');
  }
  return { imageBase64: payload.image, seconds: typeof payload.seconds === 'number' ? payload.seconds : 0 };
}

/**
 * Prompt used when there is no usable transcript (music stations, or captions
 * that just started): draw the station's vibe from its metadata instead.
 */
export function fallbackScenePrompt(station: Station): string {
  const genre = station.tags.slice(0, 2).join(' ') || (station.kind === 'talk' ? 'talk radio' : 'radio');
  const place = [station.state, station.country].filter(Boolean).join(', ') || 'a far-away city';
  return (
    `Vibrant retro travel-poster illustration of a ${genre} radio night in ${place}, ` +
    'warm glowing colors, stylized, atmospheric, no text, no lettering'
  );
}

/** A transcript shorter than this is not worth sending to the LLM. */
export const MIN_SCENE_TRANSCRIPT_WORDS = 25;
