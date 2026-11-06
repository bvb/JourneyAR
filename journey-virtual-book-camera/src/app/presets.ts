import type { CameraPose, FrameSettings } from '../core';

export const POSE_PRESETS: { label: string; pose: CameraPose }[] = [
  {
    label: 'Фронтально 30 см',
    pose: { target: [0, 0], distance: 300, tilt: 0, azimuth: 0, roll: 0 },
  },
  { label: '45°', pose: { target: [0, 0], distance: 400, tilt: 45, azimuth: 0, roll: 0 } },
  {
    label: 'В руке',
    pose: { target: [10, -15], distance: 350, tilt: 25, azimuth: -8, roll: 4 },
  },
  {
    label: 'Вблизи',
    pose: { target: [-70, 40], distance: 180, tilt: 15, azimuth: 0, roll: 0 },
  },
  { label: 'Далеко', pose: { target: [0, 0], distance: 900, tilt: 10, azimuth: 0, roll: 0 } },
  {
    label: 'Вне кадра',
    pose: { target: [600, 0], distance: 300, tilt: 0, azimuth: 0, roll: 0 },
  },
];

export const RESOLUTIONS: Pick<FrameSettings, 'width' | 'height'>[] = [
  { width: 640, height: 480 },
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
  { width: 480, height: 640 },
  { width: 720, height: 1280 },
];
