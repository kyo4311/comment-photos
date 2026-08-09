const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif']);

function extname(name) {
  const idx = name.lastIndexOf('.');
  return idx < 0 ? '' : name.slice(idx).toLowerCase();
}

export function isImageFile(name) {
  return IMAGE_EXT.has(extname(name));
}

export async function scanImages(rootHandle, onProgress) {
  const files = [];
  let count = 0;

  async function walk(dirHandle, pathParts) {
    for await (const entry of dirHandle.values()) {
      if (entry.kind === 'file') {
        const name = entry.name;
        if (!isImageFile(name)) continue;
        const file = await entry.getFile();
        files.push({
          handle: entry,
          path: pathParts.length ? pathParts.join('/') + '/' + name : name,
          name,
          size: file.size,
          mtime: file.lastModified,
        });
        count++;
        if (onProgress && count % 20 === 0) onProgress(count);
      } else if (entry.kind === 'directory') {
        await walk(entry, [...pathParts, entry.name]);
      }
    }
  }

  await walk(rootHandle, []);
  if (onProgress) onProgress(count);
  return files;
}