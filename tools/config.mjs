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
export const BOOK_PAGES = path.join(ROOT, 'book-ar-pages');
export const AR_ASSETS = path.join(ROOT, 'journey-ar', 'assets');

// Physical page size of the artbook, landscape orientation.
export const PAGE_SIZE_MM = { width: 303, height: 226 };
