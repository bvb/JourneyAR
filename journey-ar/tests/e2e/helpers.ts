import type { Page } from '@playwright/test';

// Known console noise: jsartoolkit-nft logs this as an error when a tracker with loaded markers
// is disposed (Stop); it is part of the library's normal teardown.
const KNOWN_ERRORS = [/Error detaching pattern from arhandle/];

/** Collects page errors and console errors (except known library noise) of a page. */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    const text = message.text();
    if (message.type() === 'error' && !KNOWN_ERRORS.some((known) => known.test(text))) {
      errors.push(text);
    }
  });
  return errors;
}

/** A relay room of its own for a test, so parallel WebRTC tests do not meet. */
export function uniqueRoom(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
