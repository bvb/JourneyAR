// Types of curves.mjs for the TypeScript unit tests (journey-ar/tests/unit/apk-convert.test.ts).
type CurveValue = number | Record<string, number>;
type CurveSlope = number | string | Record<string, number | string>;

export interface CurveKey {
  time: number;
  value: CurveValue;
  inSlope: CurveSlope;
  outSlope: CurveSlope;
}

export function curveNumber(value: number | string): number;
export function evaluateCurve(keys: CurveKey[], t: number, component?: string | null): number;
export function sampleTimes(length: number, fps: number): number[];
export function dropUnneededKeys(
  times: number[],
  values: number[][],
): { times: number[]; values: number[][] };
