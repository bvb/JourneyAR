// Paths to external tools and source materials used by the asset pipeline.
// Override any of them with environment variables on another machine.
import ffmpegStatic from 'ffmpeg-static';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const FFMPEG = process.env.FFMPEG ?? ffmpegStatic;

// Every source the app's data and assets are made from: the original app (APK), the scans of
// the tracked book pages, the app icons as given (favicons for the browsers) and the picture
// shown before the camera starts (the icons and the picture are published by
// tools/assets/ui-assets.mjs).
export const ORIGINAL_SOURCES = path.join(ROOT, 'original-sources');
export const BOOK_PAGES = path.join(ORIGINAL_SOURCES, 'book-ar-pages');
export const FAVICON_SOURCE = path.join(ORIGINAL_SOURCES, 'favicon');
export const BACKGROUND_SOURCE = path.join(ORIGINAL_SOURCES, 'journey-art1600.jpg');
export const AR_ASSETS = path.join(ROOT, 'journey-ar', 'assets');
export const PIPELINE_OUT = path.join(ROOT, 'tools', '.out');
// The original app and what tools/apk/read-apk.py reads from it (UnityPy, Python venv).
export const ORIGINAL_APK =
  process.env.ORIGINAL_APK ?? path.join(ORIGINAL_SOURCES, 'Journey-AR-Viewer.1.0.apk');
export const APK_OUT = path.join(PIPELINE_OUT, 'apk');
export const PYTHON_VENV = path.join(PIPELINE_OUT, 'pyenv');
export const PYTHON =
  process.env.JOURNEY_PYTHON ??
  path.join(PYTHON_VENV, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');

/** Scan of a book page in original-sources/book-ar-pages, by page id (for example "page90"). */
export function pageImage(page) {
  return path.join(BOOK_PAGES, `Artbook_Journey-${page}.jpg`);
}

// Physical page size of the artbook, landscape orientation.
export const PAGE_SIZE_MM = { width: 303, height: 226 };

// Normalized pages (shared by NFT generation and the virtual camera): the whole page, scaled to
// NORMALIZED_PAGE_WIDTH and cropped symmetrically to the page proportions.
export const NORMALIZED_PAGES = path.join(ROOT, 'pages-for-nft');
export const NORMALIZED_PAGE_WIDTH = 1700;

/** Pixel height of a page image of the given width with the physical page proportions. */
export function pageHeightFor(width) {
  return Math.round((width * PAGE_SIZE_MM.height) / PAGE_SIZE_MM.width);
}

/** Resolution (dots per inch) of a page image of the given pixel width. */
export function pageDpi(width) {
  return width / (PAGE_SIZE_MM.width / 25.4);
}
