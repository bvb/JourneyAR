import type { FilterConfig } from '@webarkit/jsartoolkit-nft/client';

/** Tracking settings that can be changed with URL parameters (for debugging and tests). */
export interface TrackingOptions {
  /** Assumed horizontal field of view of the camera, degrees (`?fov=`). */
  horizontalFov: number;
  /** Pose filter (`?filter=native|none|oneeuro`). */
  filter: FilterConfig;
}

/** A typical phone main camera; the virtual camera uses the same by default. */
export const DEFAULT_HORIZONTAL_FOV = 63;

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
    horizontalFov: fov > 10 && fov < 170 ? fov : DEFAULT_HORIZONTAL_FOV,
    filter,
  };
}
