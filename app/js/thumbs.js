export const THUMB_SIZE = 150;

const cache = new Map();

export function thumbKey(file) {
  return file.path + ':' + file.size + ':' + file.mtime;
}

export function getCachedThumb(key) {
  return cache.has(key) ? cache.get(key) : undefined;
}

export function setCachedThumb(key, dataUrl) {
  cache.set(key, dataUrl);
}

export function invalidateThumbs() {
  cache.clear();
}

export async function generateThumbnail(file, size = THUMB_SIZE) {
  try {
    const bitmap = await createImageBitmap(file, {
      resizeWidth: size * 2,
      resizeHeight: size * 2,
      resizeQuality: 'medium',
    });
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const s = Math.min(bitmap.width, bitmap.height);
    const sx = (bitmap.width - s) / 2;
    const sy = (bitmap.height - s) / 2;
    ctx.drawImage(bitmap, sx, sy, s, s, 0, 0, size, size);
    bitmap.close();
    return canvas.toDataURL('image/jpeg', 0.75);
  } catch (e) {
    return null;
  }
}

const PLACEHOLDER_SVG =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="150" height="150"><rect width="150" height="150" fill="#eef1f5"/><text x="75" y="78" font-size="14" text-anchor="middle" fill="#9aa3af">图片</text></svg>'
  );

export function placeholder() {
  return PLACEHOLDER_SVG;
}