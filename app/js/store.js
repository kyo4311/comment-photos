const COMMENTS_FILE = 'comments.json';
const VERSION = 1;

export function extractDate(name) {
  const re = /(^|[^\d])((?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01]))(?=$|[^\d])/g;
  let m;
  while ((m = re.exec(name))) return m[2];
  return '';
}

export class CommentsStore {
  constructor(rootHandle) {
    this.rootHandle = rootHandle;
    this.records = {};
    this.fileHandle = null;
    this.dirty = false;
  }

  async load() {
    try {
      this.fileHandle = await this.rootHandle.getFileHandle(COMMENTS_FILE);
      const file = await this.fileHandle.getFile();
      const text = await file.text();
      const data = JSON.parse(text);
      if (data && data.version === VERSION && data.records && typeof data.records === 'object') {
        this.records = data.records;
      } else {
        this.records = {};
      }
    } catch (e) {
      this.records = {};
      this.fileHandle = null;
    }
    this.dirty = false;
  }

  async ensureFile() {
    if (this.fileHandle) return;
    this.fileHandle = await this.rootHandle.getFileHandle(COMMENTS_FILE, { create: true });
    await this.save();
  }

  async save() {
    if (!this.fileHandle) {
      this.fileHandle = await this.rootHandle.getFileHandle(COMMENTS_FILE, { create: true });
    }
    const payload = { version: VERSION, records: this.records };
    const writable = await this.fileHandle.createWritable();
    await writable.write(JSON.stringify(payload, null, 2) + '\n');
    await writable.close();
    this.dirty = false;
  }

  get(path) {
    return this.records[path] || null;
  }

  set(path, fields) {
    const existing = this.records[path];
    const rec = existing || {
      filename: fields.filename || '',
      file_size: fields.file_size || 0,
      file_hash: fields.file_hash || '',
      title: '',
      time: '',
      comment: '',
    };
    rec.filename = fields.filename ?? rec.filename;
    rec.file_size = fields.file_size ?? rec.file_size;
    rec.file_hash = fields.file_hash ?? rec.file_hash;
    if (fields.title !== undefined) rec.title = fields.title;
    if (fields.time !== undefined) rec.time = fields.time;
    if (fields.comment !== undefined) rec.comment = fields.comment;
    if (rec.title === undefined || rec.title === '') rec.title = rec.filename;
    if (rec.time === undefined || rec.time === '') rec.time = extractDate(rec.filename);
    this.records[path] = rec;
    this.dirty = true;
    return rec;
  }

  remove(path) {
    if (this.records[path]) {
      delete this.records[path];
      this.dirty = true;
    }
  }

  rename(oldPath, newPath, updatedFields) {
    const rec = this.records[oldPath];
    if (!rec) return null;
    if (oldPath !== newPath) {
      delete this.records[oldPath];
    }
    rec.filename = updatedFields.filename ?? rec.filename;
    rec.file_size = updatedFields.file_size ?? rec.file_size;
    rec.file_hash = updatedFields.file_hash ?? rec.file_hash;
    this.records[newPath] = rec;
    this.dirty = true;
    return rec;
  }

  count() {
    let n = 0;
    for (const path in this.records) {
      if (this.records[path].comment) n++;
    }
    return n;
  }
}