export const DEFAULT_PROMPT =
  '请用简体中文为这张图片写一句不超过 50 字的点评，可从构图、光线、内容或氛围等角度切入，语气自然，并指出一个值得注意的细节。只输出一句点评文字，不要多余内容或标点。';

const CACHE_KEY = 'aiSettings';

const ENDPOINT = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
const MODEL = 'glm-4.6v-flash';

export function defaultSettings() {
  return { apiKey: '', prompt: DEFAULT_PROMPT };
}

export async function loadSettings() {
  const def = defaultSettings();
  try {
    const data = await chrome.storage.local.get(CACHE_KEY);
    return Object.assign(def, data[CACHE_KEY] || {});
  } catch (e) {
    return def;
  }
}

export async function saveSettings(s) {
  await chrome.storage.local.set({ [CACHE_KEY]: s });
}

function validateSettings(s) {
  if (!s.apiKey || !s.apiKey.trim()) throw new Error('尚未配置 API Key，请先在「AI 设置」中填写。');
}

async function resizeImage(file) {
  const blob =
    file && file.handle && typeof file.handle.getFile === 'function' ? await file.handle.getFile() : file;
  const bitmap = await createImageBitmap(blob);
  const MAX = 700;
  const scale = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.85);
}

function parseContent(content) {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .filter((p) => p && p.type === 'text')
      .map((p) => p.text || '')
      .join('')
      .trim();
  }
  return '';
}

async function doFetch(apiKey, body) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error('AI 请求失败（HTTP ' + res.status + '）：' + t.slice(0, 200));
  }
  const json = await res.json();
  const content = json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
  const text = parseContent(content);
  if (!text) throw new Error('AI 未返回有效内容。');
  return text;
}

export async function generateComment(file, s) {
  validateSettings(s);
  const dataUrl = await resizeImage(file);
  const body = {
    model: MODEL,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: s.prompt || DEFAULT_PROMPT },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
  };
  return doFetch(s.apiKey, body);
}

export async function testConnection(s) {
  validateSettings(s);
  const body = {
    model: MODEL,
    messages: [{ role: 'user', content: '请只回复这四个字：连接成功' }],
  };
  await doFetch(s.apiKey, body);
  return true;
}