import { describe, expect, it } from 'vitest';
import { RESUME_SECONDS, ResumeWindow } from '../../src/scenes/resume-window';

describe('ResumeWindow', () => {
  it('continues the page lost last if it comes back within the window', () => {
    const window = new ResumeWindow();
    window.lose('creature', 1000);
    expect(window.resumes('creature', 1000 + RESUME_SECONDS * 1000)).toBe(true);
    expect(window.resumes('creature', 1001 + RESUME_SECONDS * 1000)).toBe(false);
  });

  it('starts over for another page, or after another page was lost', () => {
    const window = new ResumeWindow();
    expect(window.resumes('creature', 0)).toBe(false);
    window.lose('creature', 1000);
    expect(window.resumes('landscape', 1500)).toBe(false);
    window.lose('landscape', 1600);
    expect(window.resumes('creature', 1700)).toBe(false);
  });
});
