// Stores an uploaded image in R2 and returns its key (served at /media/<key>).
const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const MAX_BYTES = 5 * 1024 * 1024;

export async function saveImage(env, file, folder, bucket = env.MEDIA) {
  if (!file || typeof file !== 'object' || !file.size) return null;
  const ext = TYPES[file.type];
  if (!ext) throw new Error(`That file${file.name ? ` (${file.name})` : ''} isn't a picture we can use. Photos must be JPG, PNG, WebP or GIF.`);
  if (file.size > MAX_BYTES) throw new Error(`That photo is too big (${(file.size / 1048576).toFixed(1)} MB). The limit is 5 MB.`);
  const key = `${folder}/${crypto.randomUUID()}.${ext}`;
  await bucket.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  return key;
}
