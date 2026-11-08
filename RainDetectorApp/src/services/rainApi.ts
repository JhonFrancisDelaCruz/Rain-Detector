import Constants from 'expo-constants';
import { Platform } from 'react-native';

export interface RainReading {
  level: 'DRY' | 'LIGHT' | 'HEAVY' | 'STOPPED';
  value: number;
  delta: number;
  intensity: number;
  muted: boolean;
  updated: string;
  online: boolean;
}

export interface RainApiResponse {
  level?: 'DRY' | 'LIGHT' | 'HEAVY' | 'STOPPED';
  value?: number;
  delta?: number;
  intensity?: number;
  muted?: boolean;
  updated?: string;
  online: boolean;
  error?: string;
}

/**
 * Determine default backend API URL based on platform and Expo network host.
 */
export function getDefaultApiUrl(): string {
  // ✅ Cloud deployment — always use Railway URL
  return 'https://rain-detector-production.up.railway.app';
}

/**
 * Fetch latest sensor reading from GET /api/rain/latest
 */
export async function fetchLatestRain(baseUrl: string): Promise<RainApiResponse> {
  const url = `${baseUrl.replace(/\/+$/, '')}/api/rain/latest`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4000);

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`Server returned HTTP ${res.status}`);
    }

    const data: RainApiResponse = await res.json();
    return data;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Trigger backend simulation endpoint POST /api/rain/simulate
 */
export async function simulateRainReading(baseUrl: string): Promise<{ ok: boolean }> {
  const url = `${baseUrl.replace(/\/+$/, '')}/api/rain/simulate`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    throw new Error(`Simulation failed: HTTP ${res.status}`);
  }

  return res.json();
}
