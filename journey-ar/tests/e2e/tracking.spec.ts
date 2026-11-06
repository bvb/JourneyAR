import { type Page, expect, test } from '@playwright/test';

// Tracking against the ground truth: the app runs the embedded virtual camera (?source=canvas)
// with its exact focal length, and compares the tracker pose with the virtual camera pose.
// Thresholds follow the plan (detection within 1.5 s, position error within 5 % of the page
// width, i.e. 15 mm) with tighter limits where the synthetic frames allow.

const SCENES = ['character', 'creature', 'landscape', 'architecture', 'sequence'];

/**
 * Time limits are for Edge, the primary browser. The headless Chromium build renders the
 * virtual camera much slower (latency ~450 ms against ~130 ms in Edge on the same machine), so
 * its time limits are looser; accuracy limits are the same everywhere.
 */
function timeScale(projectName: string): number {
  return projectName === 'chromium' ? 3 : 1;
}

interface StaticMetrics {
  scene: string;
  detectMs: number;
  translationMm: number;
  angleDeg: number;
  jitterMm: number;
  lossMs: number;
  otherScenes: string[];
}

interface MotionMetrics {
  trackedShare: number;
  /** Error against the ground truth pose the tracked frame was most likely rendered with. */
  translationMm: number;
  angleDeg: number;
  /** How far back that pose was: the latency from rendering to the tracking result. */
  lagMs: number;
  /** Error against the current pose (accuracy and latency together), for information. */
  currentTranslationMm: number;
  /** The same for the pose shown on screen (smoothed): error at the best match and its lag. */
  shownTranslationMm: number;
  shownLagMs: number;
}

async function startTracking(page: Page, filter = 'native'): Promise<void> {
  await page.goto(`/?source=canvas&filter=${filter}`);
  await page.getByRole('button', { name: 'Старт' }).click();
  await page.waitForFunction(() => window.__journey?.tracking.ready === true, null, {
    timeout: 60_000,
  });
}

/** Installs helpers in the page: waiting, pose errors (page -> camera matrices, mm). */
async function installHelpers(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    w['waitUntil'] = (condition: () => boolean, timeout = 5000) =>
      new Promise<boolean>((resolve) => {
        const start = performance.now();
        const check = () => {
          if (condition()) resolve(true);
          else if (performance.now() - start > timeout) resolve(false);
          else requestAnimationFrame(check);
        };
        check();
      });
    w['poseError'] = (pose: number[], truth: number[]) => {
      const translation = Math.hypot(
        pose[12]! - truth[12]!,
        pose[13]! - truth[13]!,
        pose[14]! - truth[14]!,
      );
      // Rotation angle of R_pose * R_truth^T from the trace (column-major 3x3 blocks).
      let trace = 0;
      for (let r = 0; r < 3; r += 1) {
        for (let c = 0; c < 3; c += 1) trace += pose[c * 4 + r]! * truth[c * 4 + r]!;
      }
      const angle = (Math.acos(Math.min(1, Math.max(-1, (trace - 1) / 2))) * 180) / Math.PI;
      return { translation, angle };
    };
  });
}

function measureStatic(page: Page, scene: string): Promise<StaticMetrics> {
  return page.evaluate(async (id) => {
    const w = window as unknown as {
      waitUntil(condition: () => boolean, timeout?: number): Promise<boolean>;
      poseError(p: number[], t: number[]): { translation: number; angle: number };
    };
    const vcam = window.__vcam!;
    const tracking = window.__journey!.tracking;
    const median = (values: number[]) => [...values].sort((a, b) => a - b)[values.length >> 1]!;

    await vcam.setPage(null);
    await w.waitUntil(() => tracking.scene === null);
    vcam.setPose({ target: [0, 0], distance: 380, tilt: 20, azimuth: 0, roll: 0 });
    const firstEvent = tracking.events.length;
    const shown = performance.now();
    await vcam.setPage(id);
    await w.waitUntil(() => tracking.scene === id);
    const found = tracking.events.slice(firstEvent).find((e) => e.type === 'found');
    const detectMs = found ? found.time - shown : Infinity;

    // Static camera: 30 tracked frames.
    const poses: number[][] = [];
    let processed = tracking.processed;
    while (poses.length < 30 && tracking.scene === id) {
      await w.waitUntil(() => tracking.processed > processed, 1000);
      processed = tracking.processed;
      if (tracking.pose) poses.push(tracking.pose);
    }
    const truth = vcam.getGroundTruth().modelView;
    const errors = poses.map((pose) => w.poseError(pose, truth));
    const mean = [12, 13, 14].map((i) => poses.reduce((s, p) => s + p[i]!, 0) / poses.length);
    const jitter = Math.sqrt(
      poses.reduce(
        (s, p) => s + [12, 13, 14].reduce((d, i, k) => d + (p[i]! - mean[k]!) ** 2, 0),
        0,
      ) / poses.length,
    );

    const hidden = performance.now();
    const beforeLoss = tracking.events.length;
    await vcam.setPage(null);
    await w.waitUntil(() => tracking.scene === null, 2000);
    const lost = tracking.events.slice(beforeLoss).find((e) => e.type === 'lost');
    const otherScenes = tracking.events
      .slice(firstEvent)
      .filter((e) => e.scene !== id)
      .map((e) => e.scene);
    return {
      scene: id,
      detectMs,
      translationMm: median(errors.map((e) => e.translation)),
      angleDeg: median(errors.map((e) => e.angle)),
      jitterMm: jitter,
      lossMs: lost ? lost.time - hidden : Infinity,
      otherScenes,
    };
  }, scene);
}

/**
 * A 4 s orbit around the page. The tracker result belongs to a frame rendered a little earlier
 * (capture, video, worker), so each result is compared with the closest pose of the last
 * 600 ms: that gives the accuracy, and how far back it was gives the latency.
 */
function measureMotion(page: Page): Promise<MotionMetrics> {
  return page.evaluate(async () => {
    const w = window as unknown as {
      waitUntil(condition: () => boolean, timeout?: number): Promise<boolean>;
      poseError(p: number[], t: number[]): { translation: number; angle: number };
    };
    const vcam = window.__vcam!;
    const tracking = window.__journey!.tracking;
    const median = (values: number[]) => [...values].sort((a, b) => a - b)[values.length >> 1]!;
    vcam.setPose({ target: [0, 0], distance: 420, tilt: 15, azimuth: -30, roll: 0 });
    await vcam.setPage('architecture');
    await w.waitUntil(() => tracking.scene === 'architecture');
    const history: { time: number; pose: number[] }[] = [];
    const best: { translation: number; angle: number; lag: number }[] = [];
    const shown: { translation: number; lag: number }[] = [];
    const bestMatch = (pose: number[], at: number) => {
      const errors = history
        .filter((h) => at - h.time < 1500)
        .map((h) => ({ ...w.poseError(pose, h.pose), lag: at - h.time }));
      errors.sort((a, b) => a.translation - b.translation);
      return errors[0]!;
    };
    const current: number[] = [];
    let frames = 0;
    let processed = tracking.processed;
    const start = performance.now();
    for (;;) {
      const now = performance.now();
      const k = Math.min((now - start) / 4000, 1);
      vcam.setPose({ azimuth: -30 + 60 * k, tilt: 15 + 20 * k, distance: 420 - 100 * k });
      history.push({ time: now, pose: vcam.getGroundTruth().modelView });
      await new Promise(requestAnimationFrame);
      if (tracking.processed > processed) {
        processed = tracking.processed;
        frames += 1;
        const pose = tracking.pose;
        if (pose) {
          const at = performance.now();
          const candidates = history.filter((h) => at - h.time < 600);
          const errors = candidates.map((h) => ({
            ...w.poseError(pose, h.pose),
            lag: at - h.time,
          }));
          errors.sort((a, b) => a.translation - b.translation);
          best.push(errors[0]!);
          current.push(w.poseError(pose, vcam.getGroundTruth().modelView).translation);
        }
      }
      const shownPose = window.__journey!.tracking.shownPose;
      if (shownPose && performance.now() - start > 500)
        shown.push(bestMatch(shownPose, performance.now()));
      if (k >= 1) break;
    }
    return {
      trackedShare: best.length / frames,
      translationMm: median(best.map((e) => e.translation)),
      angleDeg: median(best.map((e) => e.angle)),
      lagMs: median(best.map((e) => e.lag)),
      currentTranslationMm: median(current),
      shownTranslationMm: median(shown.map((e) => e.translation)),
      shownLagMs: median(shown.map((e) => e.lag)),
    };
  });
}

test('detects, tracks and loses every page like the ground truth says', async ({ page }, info) => {
  const slow = timeScale(info.project.name);
  test.setTimeout(90_000);
  await startTracking(page);
  await installHelpers(page);
  const results: StaticMetrics[] = [];
  for (const scene of SCENES) results.push(await measureStatic(page, scene));
  await info.attach('static-metrics', {
    body: JSON.stringify(results, null, 2),
    contentType: 'application/json',
  });
  console.table(results.map((r) => ({ ...r, otherScenes: r.otherScenes.join(' ') })));
  for (const r of results) {
    expect.soft(r.detectMs, `${r.scene} detection`).toBeLessThan(1500 * slow);
    expect.soft(r.translationMm, `${r.scene} position error`).toBeLessThan(10);
    expect.soft(r.angleDeg, `${r.scene} angle error`).toBeLessThan(2);
    expect.soft(r.jitterMm, `${r.scene} jitter`).toBeLessThan(2);
    expect.soft(r.lossMs, `${r.scene} loss`).toBeLessThan(500 * slow);
    expect.soft(r.otherScenes, `${r.scene} confused with`).toEqual([]);
  }
});

// The native filter of the core: with the library's default OneEuro settings the rotation
// lags by about 12 degrees on this orbit (measured 2026-11-06), so OneEuro is not the default.
test('keeps tracking a moving camera', async ({ page }, info) => {
  const slow = timeScale(info.project.name);
  test.setTimeout(60_000);
  await startTracking(page);
  await installHelpers(page);
  const metrics = await measureMotion(page);
  await info.attach('motion-metrics', {
    body: JSON.stringify(metrics),
    contentType: 'application/json',
  });
  console.log('motion:', JSON.stringify(metrics));
  expect(metrics.trackedShare).toBeGreaterThan(0.9);
  expect(metrics.translationMm).toBeLessThan(10);
  expect(metrics.angleDeg).toBeLessThan(2);
  expect(metrics.lagMs).toBeLessThan(500 * slow);
  // The shown pose is smoothed: it lags more, but stays on the page.
  expect(metrics.shownTranslationMm).toBeLessThan(10);
  expect(metrics.shownLagMs).toBeLessThan(1000 * slow);
});

// A phone turned upright: the frames become portrait. The tracker keeps running on a landscape
// frame (the portrait one drawn rotated), so its camera is the phone camera turned by 90
// degrees about the view axis: x' = y, y' = -x.
test('keeps tracking when the camera turns to portrait', async ({ page }) => {
  test.setTimeout(60_000);
  await startTracking(page);
  await installHelpers(page);
  const result = await page.evaluate(async () => {
    const w = window as unknown as {
      waitUntil(condition: () => boolean, timeout?: number): Promise<boolean>;
      poseError(p: number[], t: number[]): { translation: number; angle: number };
    };
    const vcam = window.__vcam!;
    const tracking = window.__journey!.tracking;
    vcam.setPose({ target: [0, 0], distance: 400, tilt: 20, azimuth: 0, roll: 0 });
    await vcam.setPage('architecture');
    const landscape = await w.waitUntil(() => tracking.scene === 'architecture');

    // Same lens, held upright: the long side keeps its 63 degrees.
    vcam.setFrame({ width: 480, height: 640, fov: 63 });
    const switched = performance.now();
    await w.waitUntil(() => window.__journey!.videoSize?.[1] === 640);
    // Tracking again on portrait frames, then ten more frames for the pose to settle.
    const afterSwitch = tracking.processed;
    await w.waitUntil(
      () => tracking.processed > afterSwitch && tracking.scene === 'architecture',
      15_000,
    );
    const settled = tracking.processed + 10;
    await w.waitUntil(() => tracking.processed >= settled, 15_000);
    const portrait = tracking.scene === 'architecture' && tracking.pose !== null;
    const truth = vcam.getGroundTruth().modelView;
    const turned = [...truth];
    for (let c = 0; c < 4; c += 1) {
      turned[c * 4] = truth[c * 4 + 1]!;
      turned[c * 4 + 1] = -truth[c * 4]!;
    }
    const error = tracking.pose ? w.poseError(tracking.pose, turned) : null;
    const lostSince = tracking.events.filter((e) => e.time > switched && e.type === 'lost').length;
    return { landscape, portrait, error, lostSince };
  });
  expect(result.landscape).toBe(true);
  expect(result.portrait).toBe(true);
  expect(result.error!.translation).toBeLessThan(10);
  expect(result.error!.angle).toBeLessThan(2);
});
