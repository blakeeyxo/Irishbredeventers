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

// A phone crop of a photo is stored next to it as <key>-phone.<ext> (the sites ask for that on phones, and get the
// photo itself when there is no phone crop).
export const phoneKeyOf = key => String(key).replace(/(\.[a-z]+)$/i, '-phone$1');
export async function savePhoneImage(env, key, file, bucket = env.MEDIA) {
  if (!key || !file || typeof file !== 'object' || !file.size) return;
  if (!TYPES[file.type]) throw new Error('The phone crop isn\'t a picture we can use.');
  if (file.size > MAX_BYTES) throw new Error('The phone crop is too big. The limit is 5 MB.');
  await bucket.put(phoneKeyOf(key), await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
}
