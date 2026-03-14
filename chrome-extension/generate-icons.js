// Generate ClipMark extension icons as PNG files
// Run: node generate-icons.js

const fs = require('fs');
const path = require('path');

// Simple PNG generator for solid-color icons with a pin symbol
// Creates minimal valid PNGs using raw pixel data

function createPNG(width, height, pixels) {
  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type (RGBA)
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const ihdrChunk = makeChunk('IHDR', ihdr);

  // IDAT chunk - raw pixel data with zlib
  const zlib = require('zlib');
  const rawData = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    rawData[y * (1 + width * 4)] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const pi = (y * width + x) * 4;
      const ri = y * (1 + width * 4) + 1 + x * 4;
      rawData[ri] = pixels[pi];     // R
      rawData[ri + 1] = pixels[pi + 1]; // G
      rawData[ri + 2] = pixels[pi + 2]; // B
      rawData[ri + 3] = pixels[pi + 3]; // A
    }
  }
  const compressed = zlib.deflateSync(rawData);
  const idatChunk = makeChunk('IDAT', compressed);

  // IEND chunk
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeB = Buffer.from(type, 'ascii');
  const crcData = Buffer.concat([typeB, data]);

  // CRC32
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < crcData.length; i++) {
    crc ^= crcData[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  crc ^= 0xFFFFFFFF;
  const crcB = Buffer.alloc(4);
  crcB.writeUInt32BE(crc >>> 0, 0);

  return Buffer.concat([len, typeB, data, crcB]);
}

function drawIcon(size) {
  const pixels = new Uint8Array(size * size * 4);

  const emerald = [16, 185, 129]; // #10b981
  const white = [255, 255, 255];

  // Fill with emerald background (rounded square)
  const radius = Math.floor(size * 0.18);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;

      // Check if inside rounded rect
      let inside = true;
      if (x < radius && y < radius) {
        inside = Math.sqrt((radius - x) ** 2 + (radius - y) ** 2) <= radius;
      } else if (x >= size - radius && y < radius) {
        inside = Math.sqrt((x - (size - radius - 1)) ** 2 + (radius - y) ** 2) <= radius;
      } else if (x < radius && y >= size - radius) {
        inside = Math.sqrt((radius - x) ** 2 + (y - (size - radius - 1)) ** 2) <= radius;
      } else if (x >= size - radius && y >= size - radius) {
        inside = Math.sqrt((x - (size - radius - 1)) ** 2 + (y - (size - radius - 1)) ** 2) <= radius;
      }

      if (inside) {
        pixels[i] = emerald[0];
        pixels[i + 1] = emerald[1];
        pixels[i + 2] = emerald[2];
        pixels[i + 3] = 255;
      } else {
        pixels[i + 3] = 0; // transparent
      }
    }
  }

  // Draw a simple pin/bookmark shape in white
  const cx = Math.floor(size / 2);
  const cy = Math.floor(size * 0.38);
  const pinR = Math.floor(size * 0.22);
  const stemW = Math.max(2, Math.floor(size * 0.06));
  const stemH = Math.floor(size * 0.25);

  // Pin head (circle)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      if (dist <= pinR) {
        const i = (y * size + x) * 4;
        if (pixels[i + 3] > 0) { // only draw on non-transparent
          pixels[i] = white[0];
          pixels[i + 1] = white[1];
          pixels[i + 2] = white[2];
        }
      }
    }
  }

  // Hollow center of pin head
  const innerR = Math.floor(pinR * 0.5);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      if (dist <= innerR) {
        const i = (y * size + x) * 4;
        if (pixels[i + 3] > 0) {
          pixels[i] = emerald[0];
          pixels[i + 1] = emerald[1];
          pixels[i + 2] = emerald[2];
        }
      }
    }
  }

  // Pin stem (line going down)
  const stemTop = cy + pinR - 1;
  const stemBottom = stemTop + stemH;
  for (let y = stemTop; y <= Math.min(stemBottom, size - 1); y++) {
    for (let x = cx - Math.floor(stemW / 2); x <= cx + Math.floor(stemW / 2); x++) {
      if (x >= 0 && x < size && y >= 0 && y < size) {
        const i = (y * size + x) * 4;
        if (pixels[i + 3] > 0) {
          pixels[i] = white[0];
          pixels[i + 1] = white[1];
          pixels[i + 2] = white[2];
        }
      }
    }
  }

  // Pin point (small triangle at bottom)
  const pointSize = Math.max(2, Math.floor(size * 0.08));
  for (let dy = 0; dy < pointSize; dy++) {
    const pw = Math.floor(stemW * (1 - dy / pointSize));
    for (let dx = -pw; dx <= pw; dx++) {
      const px = cx + dx;
      const py = stemBottom + dy;
      if (px >= 0 && px < size && py >= 0 && py < size) {
        const i = (py * size + px) * 4;
        if (pixels[i + 3] > 0) {
          pixels[i] = white[0];
          pixels[i + 1] = white[1];
          pixels[i + 2] = white[2];
        }
      }
    }
  }

  return createPNG(size, size, pixels);
}

// Generate icons
const sizes = [16, 48, 128];
const outDir = path.join(__dirname, 'icons');

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

for (const size of sizes) {
  const png = drawIcon(size);
  const outPath = path.join(outDir, `icon-${size}.png`);
  fs.writeFileSync(outPath, png);
  console.log(`✅ Generated ${outPath} (${png.length} bytes)`);
}

console.log('Done!');
