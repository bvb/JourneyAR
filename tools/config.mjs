// Paths to external tools and source materials used by the asset pipeline.
// Override any of them with environment variables on another machine.
import ffmpegStatic from 'ffmpeg-static';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const UNITY_EXE =
  process.env.UNITY_EXE ?? 'C:/Program Files/Unity/6000.6.8f1/Editor/Unity.exe';
export const BLENDER_EXE =
  process.env.BLENDER_EXE ?? 'C:/Program Files/Blender Foundation/Blender 3.4/blender.exe';
export const FFMPEG = process.env.FFMPEG ?? ffmpegStatic;

// Kept outside git; see .plans/plan.md.
export const UNITY_PROJECT = process.env.UNITY_PROJECT ?? path.join(ROOT, 'unity-data-project');
export const ANDROID_VIEWER =
  process.env.ANDROID_VIEWER ?? path.join(ROOT, 'android-ar-viewer.1.0');
export const BOOK_PAGES = path.join(ROOT, 'book-ar-pages');
export const AR_ASSETS = path.join(ROOT, 'journey-ar', 'assets');
// The app icons as given (favicons for the browsers) and the picture shown before the camera
// starts (book/, outside git); published by tools/assets/ui-assets.mjs.
export const FAVICON_SOURCE = path.join(ROOT, 'assets-favicon');
export const BACKGROUND_SOURCE = path.join(ROOT, 'book', 'journey-art1600.jpg');
export const PIPELINE_OUT = path.join(ROOT, 'tools', '.out');

// The original Vuforia dataset of the Android app: target sizes and target textures.
export const VUFORIA_DATASET = {
  xml: path.join(ANDROID_VIEWER, 'assets', 'QCAR', 'JourneyBook.xml'),
  dat: path.join(ANDROID_VIEWER, 'assets', 'QCAR', 'JourneyBook.dat'),
};

/** Scan of a book page in book-ar-pages, by page id (for example "page90"). */
export function pageImage(page) {
  return path.join(BOOK_PAGES, `Artbook_Journey-${page}-image1.jpg`);
}

// Physical page size of the artbook, landscape orientation.
export const PAGE_SIZE_MM = { width: 303, height: 226 };

// Normalized pages (shared by NFT generation and the virtual camera): the whole page, scaled to
// NORMALIZED_PAGE_WIDTH and cropped symmetrically to the page proportions.
export const NORMALIZED_PAGES = path.join(BOOK_PAGES, 'normalized');
export const NORMALIZED_PAGE_WIDTH = 1700;

/** Pixel height of a page image of the given width with the physical page proportions. */
export function pageHeightFor(width) {
  return Math.round((width * PAGE_SIZE_MM.height) / PAGE_SIZE_MM.width);
}

/** Resolution (dots per inch) of a page image of the given pixel width. */
export function pageDpi(width) {
  return width / (PAGE_SIZE_MM.width / 25.4);
}
