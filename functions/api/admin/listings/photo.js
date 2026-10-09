// Owner area: replace one For Sale photo with a re-cropped copy. Multipart: photo_id, image (laptop crop),
// image_phone (phone crop). The old files are deleted.
import { json, bad } from '../../../../lib/http.js';
import { withShared } from '../../../../lib/shared-http.js';
import { saveImage, savePhoneImage, phoneKeyOf } from '../../../../lib/images.js';
import { needsListingStorage } from '../../../../lib/listings-http.js';

export const onRequestPost = ({ env, request }) => withShared(env, async db => {
  const missing = needsListingStorage(env);
  if (missing) return bad(missing, 503);
  let form;
  try { form = await request.formData(); } catch { return bad('Something went wrong sending the photo. Please try again.'); }
  const id = Number(form.get('photo_id'));
  const row = Number.isInteger(id) ? await db.prepare('SELECT image_key FROM listing_photo WHERE id = ?').bind(id).first() : null;
  if (!row) return bad('That photo is no longer on the ad.');
  let key;
  try {
    key = await saveImage(env, form.get('image'), 'listings', env.LISTING_MEDIA);
    if (!key) return bad('No photo was sent.');
    await savePhoneImage(env, key, form.get('image_phone'), env.LISTING_MEDIA);
  } catch (e) { return bad(e.message); }
  await db.prepare('UPDATE listing_photo SET image_key = ? WHERE id = ?').bind(key, id).run();
  await env.LISTING_MEDIA.delete([row.image_key, phoneKeyOf(row.image_key)]);
  return json({ ok: true, key });
});
