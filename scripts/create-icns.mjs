import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [iconsetDirectory, outputFile] = process.argv.slice(2);
if (!iconsetDirectory || !outputFile) {
  throw new Error("Usage: node create-icns.mjs <iconset-directory> <output-file>");
}

const entries = [
  ["icp4", "icon_16x16.png"],
  ["ic11", "icon_16x16@2x.png"],
  ["icp5", "icon_32x32.png"],
  ["ic12", "icon_32x32@2x.png"],
  ["icp6", "icon_32x32@2x.png"],
  ["ic07", "icon_128x128.png"],
  ["ic13", "icon_128x128@2x.png"],
  ["ic08", "icon_256x256.png"],
  ["ic14", "icon_256x256@2x.png"],
  ["ic09", "icon_512x512.png"],
  ["ic10", "icon_512x512@2x.png"],
];

const chunks = entries.map(([type, filename]) => {
  const image = readFileSync(join(iconsetDirectory, filename));
  const header = Buffer.alloc(8);
  header.write(type, 0, 4, "ascii");
  header.writeUInt32BE(image.length + 8, 4);
  return Buffer.concat([header, image]);
});

const body = Buffer.concat(chunks);
const header = Buffer.alloc(8);
header.write("icns", 0, 4, "ascii");
header.writeUInt32BE(body.length + 8, 4);
writeFileSync(outputFile, Buffer.concat([header, body]));
