// Normalized page images (book-ar-pages/normalized/<scene id>.jpg, 1700x1268 for 303x226 mm),
// produced by `npm run pages:normalize`.

export interface PageImage {
  id: string;
  url: string;
}

const urls = import.meta.glob<string>('../../../book-ar-pages/normalized/*.jpg', {
  query: '?url',
  import: 'default',
  eager: true,
});

// Book order (pages 30, 57, 69, 103, 146 and the DAQRI page at the end); keys 1-6 of the
// interface follow it.
const BOOK_ORDER = ['character', 'creature', 'landscape', 'architecture', 'sequence', 'daqri'];

function rank(id: string): number {
  const index = BOOK_ORDER.indexOf(id);
  return index < 0 ? BOOK_ORDER.length : index;
}

export const PAGE_IMAGES: PageImage[] = Object.entries(urls)
  .map(([file, url]) => ({
    id: file
      .split('/')
      .pop()!
      .replace(/\.jpg$/, ''),
    url,
  }))
  .sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));
