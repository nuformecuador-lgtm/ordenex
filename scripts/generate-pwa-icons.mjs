import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

async function main() {
  let sharp;
  try {
    sharp = (await import("sharp")).default;
  } catch {
    console.error(
      "sharp is not installed. Install it with: pnpm add -D sharp"
    );
    console.error("Then re-run: node scripts/generate-pwa-icons.mjs");
    process.exit(1);
  }

  const svgPath = resolve(root, "public", "next.svg");
  const iconsDir = resolve(root, "public", "icons");

  const svgBuffer = readFileSync(svgPath, "utf-8");

  const sizes = [
    { size: 192, name: "icon-192.png" },
    { size: 512, name: "icon-512.png" },
  ];

  for (const { size, name } of sizes) {
    const padding = Math.round(size * 0.15);
    const logoSize = size - padding * 2;

    const innerContent = svgBuffer
      .replace(/<svg[^>]*>/, "")
      .replace("</svg>", "")
      .replace(/fill="#000"/g, 'fill="#ffffff"');

    const sharpSvg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        <rect width="${size}" height="${size}" rx="${Math.round(size * 0.15)}" fill="#f26419"/>
        <g transform="translate(${padding}, ${padding}) scale(${logoSize / 394}, ${logoSize / 80})" fill="#ffffff">
          ${innerContent}
        </g>
      </svg>`
    );

    await sharp(sharpSvg)
      .resize(size, size)
      .png()
      .toFile(resolve(iconsDir, name));

    console.log(`Generated ${name} (${size}x${size})`);
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
