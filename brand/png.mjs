// A minimal RGBA PNG encoder, so rasters can be written straight from the
// sprite grid instead of resampled out of the SVG.
//
// A 14 pixel sprite put through a general purpose rasteriser comes back with
// soft edges wherever the scale is not a whole number, and the socket's 42
// percent alpha makes that failure hard to see at a glance. Painting the pixels
// directly means every output is exact by construction.
//
// No dependencies: Node's zlib produces the deflate stream, and the CRC and
// chunk framing are a few lines each.

import { deflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

const crc32 = (buf) => {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};

const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

/**
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array} rgba  width * height * 4 bytes, non premultiplied
 * @returns {Buffer}
 */
export function encodePng(width, height, rgba) {
  const expected = width * height * 4;
  if (rgba.length !== expected) {
    throw new Error(
      `encodePng: got ${rgba.length} bytes, expected ${expected} for ${width}x${height}`,
    );
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: truecolour with alpha
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  // Filter type 0 on every scanline. The art is large flat runs, so the filter
  // choice buys almost nothing and a fixed one keeps the output deterministic.
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Paints a sprite map onto a canvas at a whole number scale.
 *
 * @param {object} opts
 * @param {string[]} opts.map       rows of single character codes
 * @param {string} opts.transparent the code meaning "no ink"
 * @param {Record<string, {rgb: number[], alpha: number}>} opts.ink  code -> colour
 * @param {number} opts.canvas      output edge in pixels, square
 * @param {number} opts.scale       pixels per sprite cell, whole number
 * @param {number[]|null} opts.ground  rgb to fill behind the sprite, or null for transparent
 */
export function paint({ map, transparent, ink, canvas, scale, ground }) {
  const rows = map.length;
  const cols = map[0].length;
  const artW = cols * scale;
  const artH = rows * scale;
  if (artW > canvas || artH > canvas) {
    throw new Error(`paint: ${cols}x${rows} at ${scale}x does not fit a ${canvas}px canvas`);
  }
  // Whole pixel offsets only. A half pixel offset would put the grid off the
  // pixel lattice and undo the point of painting directly.
  const offX = (canvas - artW) >> 1;
  const offY = (canvas - artH) >> 1;

  const px = new Uint8Array(canvas * canvas * 4);
  if (ground) {
    for (let i = 0; i < canvas * canvas; i++) {
      px[i * 4] = ground[0];
      px[i * 4 + 1] = ground[1];
      px[i * 4 + 2] = ground[2];
      px[i * 4 + 3] = 255;
    }
  }

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const code = map[y][x];
      if (code === transparent) continue;
      const { rgb, alpha } = ink[code];
      const a = Math.round(alpha * 255);
      for (let dy = 0; dy < scale; dy++) {
        const py = offY + y * scale + dy;
        for (let dx = 0; dx < scale; dx++) {
          const i = (py * canvas + offX + x * scale + dx) * 4;
          if (ground) {
            // Composite now, because an opaque avatar must not hand the socket's
            // alpha to a platform that will flatten it against its own colour.
            for (let c = 0; c < 3; c++)
              px[i + c] = Math.round(alpha * rgb[c] + (1 - alpha) * px[i + c]);
            px[i + 3] = 255;
          } else {
            for (let c = 0; c < 3; c++) px[i + c] = rgb[c];
            px[i + 3] = a;
          }
        }
      }
    }
  }
  return { px, offX, offY, artW };
}
