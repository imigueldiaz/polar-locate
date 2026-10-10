function utf8Encode(s: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return Uint8Array.from(out);
}

/** Inserts a JPEG COM (0xFFFE) segment with `comment` right after the SOI. */
export function jpegWithComment(jpg: Uint8Array, comment: string): Uint8Array {
  if (jpg.length < 2 || jpg[0] !== 0xff || jpg[1] !== 0xd8) throw new Error('not jpeg');
  let bytes = utf8Encode(comment);
  const max = 65533 - 2;
  if (bytes.length > max) bytes = bytes.subarray(0, max);
  const len = bytes.length + 2;
  const out = new Uint8Array(jpg.length + 4 + bytes.length);
  out[0] = 0xff;
  out[1] = 0xd8;
  out[2] = 0xff;
  out[3] = 0xfe;
  out[4] = (len >> 8) & 0xff;
  out[5] = len & 0xff;
  out.set(bytes, 6);
  out.set(jpg.subarray(2), 6 + bytes.length);
  return out;
}

export function selfCheck(): void {
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const msg = 'Polaris ok';
  const out = jpegWithComment(jpg, msg);
  console.assert(out[0] === 0xff && out[1] === 0xd8, 'soi');
  console.assert(out[2] === 0xff && out[3] === 0xfe, 'com marker');
  console.assert(out.length === jpg.length + 4 + msg.length, `len = ${out.length}`);
  const enc = utf8Encode(msg);
  console.assert(out[4] === 0x00 && out[5] === enc.length + 2, 'segment length');
  let same = true;
  for (let i = 0; i < enc.length; i++) if (out[6 + i] !== enc[i]) same = false;
  console.assert(same, 'comment bytes');
  let tail = true;
  for (let i = 0; i < jpg.length - 2; i++) if (out[6 + enc.length + i] !== jpg[2 + i]) tail = false;
  console.assert(tail, 'tail preserved');
  console.log('trace.selfCheck: ok');
}
