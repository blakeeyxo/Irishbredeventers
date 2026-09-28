import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { docxToText, documentXmlToText } from '../lib/docx.js';

// Minimal zip writer, enough to make a .docx for the test.
function zip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBuf = Buffer.from(name), data = deflateRawSync(Buffer.from(content));
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(content.length, 22); local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20); central.writeUInt32LE(content.length, 24); central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data); centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const xml = `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>
<w:p><w:r><w:t>England</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">4th Master Smart </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>ISH 2013 gelding</w:t></w:r><w:r><w:t xml:space="preserve"> by A &amp; B</w:t></w:r></w:p>
<w:p><w:r><w:t>kept</w:t></w:r><w:del><w:r><w:delText>gone</w:delText></w:r></w:del></w:p>
</w:body></w:document>`;

test('paragraphs become lines, runs join, entities decode', () => {
  assert.equal(documentXmlToText(xml), 'England\n4th Master Smart ISH 2013 gelding by A & B\nkept');
});

test('reads word/document.xml out of a .docx', async () => {
  const buf = zip({ '[Content_Types].xml': '<Types/>', 'word/document.xml': xml });
  const text = await docxToText(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  assert.match(text, /^England\n4th Master Smart ISH 2013 gelding by A & B/);
});

test('rejects files that are not .docx', async () => {
  await assert.rejects(() => docxToText(new TextEncoder().encode('hello').buffer));
});
