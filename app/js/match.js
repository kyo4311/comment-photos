import { fileHash } from './hash.js';

const hashCache = new Map();

export function clearHashCache() {
  hashCache.clear();
}

export async function getHash(fileEntry) {
  const key = fileEntry.path;
  const cached = hashCache.get(key);
  if (cached) return cached;
  const file = await fileEntry.handle.getFile();
  const hash = await fileHash(file);
  hashCache.set(key, hash);
  return hash;
}

export async function matchFiles(files, store, onProgress) {
  const byKey = new Map(Object.entries(store.records));
  const results = files.map((file) => ({
    file,
    record: null,
    source: 'none',
    renamedFrom: null,
  }));

  const findByIdentity = (f) => {
    for (const [key, rec] of byKey) {
      if (rec.filename === f.name && rec.file_size === f.size) {
        return { key, rec };
      }
    }
    return null;
  };

  for (const r of results) {
    const hit = findByIdentity(r.file);
    if (!hit) continue;
    r.record = hit.rec;
    r.source = 'quick';
    byKey.delete(hit.key);
    if (hit.key !== r.file.path) {
      r.renamedFrom = hit.key;
    }
  }

  const needHash = results.filter((r) => !r.record);
  let hashed = 0;
  const totalToHash = needHash.length;
  const allRecords = [...byKey.entries()];

  for (const r of needHash) {
    let hash = '';
    try {
      hash = await getHash(r.file);
    } catch (e) {
      hash = '';
    }
    if (hash) {
      for (const [key, rec] of allRecords) {
        if (rec.file_hash === hash) {
          r.record = rec;
          r.source = 'hash';
          byKey.delete(key);
          if (key !== r.file.path) {
            r.renamedFrom = key;
          }
          break;
        }
      }
    }
    if (!r.record) r.source = 'new';
    hashed++;
    if (onProgress) onProgress(hashed, totalToHash);
  }

  const renamed = results.filter((r) => r.renamedFrom);
  for (const r of renamed) {
    store.rename(r.renamedFrom, r.file.path, {
      filename: r.file.name,
      file_size: r.file.size,
    });
  }

  let needSave = renamed.length > 0;
  const backfill = results.filter((r) => r.record && !r.record.file_hash);
  for (const r of backfill) {
    try {
      const hash = await getHash(r.file);
      if (hash) {
        r.record.file_hash = hash;
        needSave = true;
      }
    } catch (e) {}
  }
  if (needSave) {
    await store.save();
  }

  return results;
}