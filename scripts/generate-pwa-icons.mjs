// Genera los PNG de la PWA a partir de los DOS vectores de marca.
//
// Feature 284 — este script estaba ROTO: leia `public/next.svg`, un archivo que ya no
// existe en el arbol, y pintaba el logotipo de Next sobre un cuadrado naranja. O sea que
// no podia reproducir ni uno de los iconos que la app sirve hoy. Ahora lee las fuentes
// reales del monograma "ex" y emite las cinco imagenes que declaran el manifiesto y el
// `<head>`.
//
// POR QUE DOS VECTORES Y NO UNO (decision del humano, 2026-08-25):
//
//   - `icon-any.svg`      -> esquinas redondeadas (rx=108 sobre 512). Es el icono tal cual
//                            se ve cuando NADIE lo enmascara.
//   - `icon-maskable.svg` -> a sangre (rx=0) y con el monograma recentrado dentro de la
//                            zona segura. Lo recorta la mascara del lanzador (Android) o
//                            iOS, que redondean ELLOS. Un icono ya redondeado dentro de una
//                            mascara redondeada da el doble redondeo que se veia hasta hoy.
//
// El PNG de 180 es la variante A SANGRE: iOS aplica su propia mascara al `apple-touch-icon`
// y espera un cuadrado lleno, no un icono con las esquinas ya recortadas.
//
// LA TRAMPA DE LA TIPOGRAFIA, medida el 2026-08-25 y por eso los vectores llevan TRAZADOS y
// no texto: el vector anterior pedia `font-family: Poppins` y la app carga Poppins con
// `next/font/google`, que la descarga EN EL NAVEGADOR. Al rasterizar aqui, sin Poppins
// instalada en el sistema, el monograma salia en la tipografia de respaldo y NADIE se
// enteraba: el script no falla, el PNG se genera y la letra no es la de la marca. Medido:
// el `icon-512.png` que la app servia hasta hoy coincidia al 99,7 % con un render en
// **Segoe UI** y difiere un 2,3 % del render en Poppins Bold. Ya habia pasado.
//
// Uso: node scripts/generate-pwa-icons.mjs

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

/** Cada salida: de que vector sale y de que tamano. */
const SALIDAS = [
  { fuente: "icon-any.svg", size: 192, name: "icon-192.png" },
  { fuente: "icon-any.svg", size: 512, name: "icon-512.png" },
  { fuente: "icon-maskable.svg", size: 192, name: "icon-192-maskable.png" },
  { fuente: "icon-maskable.svg", size: 512, name: "icon-512-maskable.png" },
  // iOS: 180x180 y a sangre. El `<head>` lo declara como `apple-touch-icon`.
  { fuente: "icon-maskable.svg", size: 180, name: "icon-180.png" },
];

/** Lado al que se rasteriza el vector antes de reescalar. Sobra para 512. */
const LADO_BASE = 1024;

async function main() {
  let sharp;
  try {
    sharp = (await import("sharp")).default;
  } catch {
    console.error("sharp no esta instalado. Instalalo con: pnpm add -D sharp");
    console.error("Y vuelve a correr: node scripts/generate-pwa-icons.mjs");
    process.exit(1);
  }

  const fuentesDir = resolve(root, "public", "icons", "fuente");
  const iconsDir = resolve(root, "public", "icons");

  for (const { fuente, size, name } of SALIDAS) {
    const svg = readFileSync(resolve(fuentesDir, fuente));

    if (/<text[\s>]/.test(svg.toString("utf8"))) {
      // Cinturon: un vector con <text> vuelve a depender de una fuente del sistema y el
      // fallo seria MUDO. Mejor no generar nada que generar un icono con otra letra.
      console.error(
        `${fuente} contiene <text>: el monograma tiene que ir en trazados (<path>).`,
      );
      process.exit(1);
    }

    // `density`: el vector declara 512px de lado, asi que 72 -> 512 y 144 -> 1024.
    await sharp(svg, { density: (72 * LADO_BASE) / 512 })
      .resize(size, size)
      .png()
      .toFile(resolve(iconsDir, name));

    console.log(`Generado ${name} (${size}x${size}) desde ${fuente}`);
  }

  console.log("Listo.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
