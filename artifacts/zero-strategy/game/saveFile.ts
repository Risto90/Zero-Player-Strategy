/**
 * Binary save file: a JSON header plus every zone ring as raw Int32 data.
 *
 * Layout: "ZSV2" | u32 header byte length | header (UTF-8 JSON) | padding to 4 bytes |
 *         u32 ring count | u32 length of each ring | ring data (Int32, little-endian).
 * Inside the header every ring is replaced by {"$r": index}.
 */
/** Little-endian Int32 data; every phone and browser the game runs on is little-endian. */
const MAGIC = [0x5a, 0x53, 0x56, 0x32]; // "ZSV2"

function utf8Encode(text: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    let code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const low = text.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
        i += 1;
      }
    }
    if (code < 0x80) out.push(code);
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    else if (code < 0x10000) out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    else out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
  }
  return Uint8Array.from(out);
}

function utf8Decode(bytes: Uint8Array): string {
  const parts: string[] = [];
  let chunk: number[] = [];
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i];
    let code: number;
    if (b < 0x80) {
      code = b;
      i += 1;
    } else if (b < 0xe0) {
      code = ((b & 31) << 6) | (bytes[i + 1] & 63);
      i += 2;
    } else if (b < 0xf0) {
      code = ((b & 15) << 12) | ((bytes[i + 1] & 63) << 6) | (bytes[i + 2] & 63);
      i += 3;
    } else {
      code = ((b & 7) << 18) | ((bytes[i + 1] & 63) << 12) | ((bytes[i + 2] & 63) << 6) | (bytes[i + 3] & 63);
      i += 4;
    }
    if (code >= 0x10000) {
      code -= 0x10000;
      chunk.push(0xd800 + (code >> 10), 0xdc00 + (code & 1023));
    } else chunk.push(code);
    if (chunk.length >= 4096) {
      parts.push(String.fromCharCode(...chunk));
      chunk = [];
    }
  }
  parts.push(String.fromCharCode(...chunk));
  return parts.join('');
}

export function encodeSave(value: unknown): Uint8Array {
  const rings: Int32Array[] = [];
  const header = JSON.stringify(value, (_key, item: unknown) => {
    if (item instanceof Int32Array) {
      rings.push(item);
      return { $r: rings.length - 1 };
    }
    return item;
  });
  const headerBytes = utf8Encode(header);
  const headerEnd = 8 + headerBytes.length;
  const ringsStart = Math.ceil(headerEnd / 4) * 4;
  let ringInts = 0;
  for (const ring of rings) ringInts += ring.length;
  const total = ringsStart + 4 + rings.length * 4 + ringInts * 4;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  out.set(MAGIC, 0);
  view.setUint32(4, headerBytes.length, true);
  out.set(headerBytes, 8);
  let at = ringsStart;
  view.setUint32(at, rings.length, true);
  at += 4;
  for (const ring of rings) {
    view.setUint32(at, ring.length, true);
    at += 4;
  }
  // Phones and browsers are little-endian, so rings are copied as whole blocks.
  const ints = new Int32Array(out.buffer, at, ringInts);
  let offset = 0;
  for (const ring of rings) {
    ints.set(ring, offset);
    offset += ring.length;
  }
  return out;
}

export function decodeSave<T>(bytes: Uint8Array): T | null {
  if (bytes.length < 12 || MAGIC.some((b, i) => bytes[i] !== b)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLength = view.getUint32(4, true);
  const header = utf8Decode(bytes.subarray(8, 8 + headerLength));
  let at = Math.ceil((8 + headerLength) / 4) * 4;
  const count = view.getUint32(at, true);
  at += 4;
  const lengths: number[] = [];
  for (let i = 0; i < count; i += 1) {
    lengths.push(view.getUint32(at, true));
    at += 4;
  }
  let ringInts = 0;
  for (const length of lengths) ringInts += length;
  const all = new Int32Array(bytes.slice(at, at + ringInts * 4).buffer);
  let offset = 0;
  const rings: Int32Array[] = lengths.map((length) => {
    const ring = all.slice(offset, offset + length);
    offset += length;
    return ring;
  });
  return JSON.parse(header, (_key, item: unknown) => {
    if (item && typeof item === 'object' && '$r' in item) return rings[(item as { $r: number }).$r];
    return item;
  }) as T;
}
