// Stores an uploaded image in R2 and returns its key (served at /media/<key>).
const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const MAX_BYTES = 5 * 1024 * 1024;

export async function saveImage(env, file, folder) {
  if (!file || typeof file !== 'object' || !file.size) return null;
  const ext = TYPES[file.type];
  if (!ext) throw new Error('Images must be JPG, PNG, WebP or GIF.');
  if (file.size > MAX_BYTES) throw new Error('That image is too big (5 MB max).');
  const key = `${folder}/${crypto.randomUUID()}.${ext}`;
  await env.MEDIA.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  return key;
}
