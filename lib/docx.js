/*
 * Plain text from a Word .docx file, one line per paragraph.
 *
 * A .docx is a zip. We read word/document.xml out of it and keep the text of each paragraph.
 * Uses the platform's DecompressionStream, so it needs no packages and runs in
 * Cloudflare Workers and Node 18+.
 */

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readZipEntry(buf, wanted) {
  const bytes = new Uint8Array(buf);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // End of central directory record: search back from the end (it may be followed by a comment).
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a Word (.docx) file');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) break;
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    if (name === wanted) {
      const lNameLen = view.getUint16(localOffset + 26, true);
      const lExtraLen = view.getUint16(localOffset + 28, true);
      const start = localOffset + 30 + lNameLen + lExtraLen;
      const data = bytes.subarray(start, start + compSize);
      if (method === 0) return data;
      if (method === 8) return inflateRaw(data);
      throw new Error('Unsupported compression in Word file');
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error('Not a Word (.docx) file');
}

const decodeXml = s => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&amp;/g, '&');

export function documentXmlToText(xml) {
  const body = xml.replace(/<w:del\b[\s\S]*?<\/w:del>/g, ''); // skip tracked deletions
  const paragraphs = body.split(/<\/w:p>/);
  const out = [];
  for (const para of paragraphs) {
    let line = '';
    const tokens = para.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>|<w:cr\/>/g);
    for (const t of tokens) {
      if (t[1] !== undefined) line += decodeXml(t[1]);
      else if (t[0] === '<w:tab/>') line += ' ';
      else line += '\n';
    }
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export async function docxToText(arrayBuffer) {
  const xmlBytes = await readZipEntry(arrayBuffer, 'word/document.xml');
  return documentXmlToText(new TextDecoder().decode(xmlBytes));
}
