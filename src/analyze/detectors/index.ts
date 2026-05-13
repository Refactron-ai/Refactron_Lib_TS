// src/analyze/detectors/index.ts
import type { Detector } from './types.js';
import type { Lang } from '../discovery.js';

const REGISTRY: Detector[] = [];

export function register(detector: Detector): void {
  REGISTRY.push(detector);
}

export function detectorsFor(lang: Lang): Detector[] {
  return REGISTRY.filter((d) => d.lang === lang);
}

export function allDetectors(): Detector[] {
  return [...REGISTRY];
}
