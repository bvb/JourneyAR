import type { FilterConfig } from '@webarkit/jsartoolkit-nft/client';
import { type SmoothingSettings, parseSmoothing } from '../tracking/pose-smoother';

/** Tracking settings that can be changed with URL parameters (for debugging and tests). */
export interface TrackingOptions {
  /**
   * Assumed field of view of the camera along the long side of the frame, degrees (`?fov=`):
   * the horizontal one when the phone is held sideways. It does not change when the phone turns.
   */
  fieldOfView: number;
  /** Pose filter of the tracker core (`?filter=native|none|oneeuro`). */
  filter: FilterConfig;
  /** Smoothing of the shown pose (`?smooth=off` or `?smooth=<minCutoff>,<beta>,...`). */
  smoothing: SmoothingSettings | null;
}

/** A typical phone main camera (checked on the user's phone); the virtual camera matches it. */
export const DEFAULT_FIELD_OF_VIEW = 63;

const FILTERS: Record<string, FilterConfig> = {
  native: 'native',
  none: 'none',
  oneeuro: { type: 'oneEuro', minCutOff: 0.0001, beta: 0.01 },
};

export function parseTrackingOptions(search: string): TrackingOptions {
  const params = new URLSearchParams(search);
  const fov = Number(params.get('fov'));
  const filterName = params.get('filter') ?? 'native';
  const filter = FILTERS[filterName];
  if (!filter) {
    throw new Error(
      `Unknown filter "${filterName}". Expected one of: ${Object.keys(FILTERS).join(', ')}`,
    );
  }
  return {
    fieldOfView: fov > 10 && fov < 170 ? fov : DEFAULT_FIELD_OF_VIEW,
    filter,
    smoothing: parseSmoothing(params.get('smooth')),
  };
}
