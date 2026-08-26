import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { codePointsCubiertos } from "../tests/unit/pdf/ttf-lector";

// Feature 282 (T3/T24/T25) — Convierte el subconjunto TTF commiteado en el
// modulo TypeScript que consumen los DOS generadores de PDF.
//
//   pnpm exec tsx scripts/fuente-etiqueta-a-base64.ts
//
// Sin dependencias nuevas: `node:fs`, `node:crypto` y el lector de TTF que ya
// usan los tests. Que el lector venga de `tests/` es deliberado: la cobertura
// que este script ESCRIBE y la que el test de R29 COMPRUEBA salen del mismo
// codigo, asi que la unica forma de que diverjan es que alguien edite el modulo
// generado a mano — que es precisamente lo que R29 persigue. La correccion del
// lector en si la sostienen sus tres controles en `ttf-lector.test.ts`.
//
// El SUBCONJUNTO no se genera aqui (eso pediria una dependencia de fuentes en el
// repo): se produce fuera del build y se commitea. El comando exacto queda
// escrito en la cabecera del modulo generado, que es donde alguien lo va a
// buscar dentro de un año.

const RAIZ = path.resolve(__dirname, "..");
const TTF = path.join(RAIZ, "assets", "fuentes", "LiberationSans-etiqueta-subset.ttf");
const DESTINO = path.join(RAIZ, "lib", "pdf", "etiquetas-fuente.ts");

/** Familia con la que se registra en jsPDF y en `document.fonts`. */
const NOMBRE = "LiberationSansEtiqueta";
const ARCHIVO_VFS = "LiberationSans-etiqueta.ttf";
const ESTILO = "normal";

/** Origen del archivo, para la cabecera de procedencia (R17). */
const ORIGEN = {
  fuente: "Liberation Sans Regular",
  version: "2.1.5",
  url: "https://github.com/liberationfonts/liberation-fonts/files/7261482/liberation-fonts-ttf-2.1.5.tar.gz",
  licencia: "SIL Open Font License 1.1 — licenses/LiberationSans-OFL.txt",
  sha256Original: "76d04c18ea243f426b7de1f3ad208e927008f961dc5945e5aad352d0dfde8ee8",
  comandoSubset:
    "python -m fontTools.subset LiberationSans-Regular.ttf " +
    '--unicodes="U+0020-007E,U+00A0-00FF,U+0152-0153,U+0160-0161,U+0178,U+017D-017E,U+0192,U+02C6,U+02DC,U+2013-2014,U+2018-201A,U+201C-201E,U+2020-2022,U+2026,U+2030,U+2039-203A,U+20A1,U+20AC,U+2122" ' +
    "--output-file=assets/fuentes/LiberationSans-etiqueta-subset.ttf " +
    "--no-hinting --drop-tables+=GSUB,GPOS,GDEF,FFTM,kern,gasp --notdef-outline --recalc-bounds",
} as const;

/** Agrupa code points sueltos en rangos inclusivos `[desde, hasta]`. */
function aRangos(codePoints: number[]): Array<[number, number]> {
  const ordenados = [...new Set(codePoints)].sort((a, b) => a - b);
  const out: Array<[number, number]> = [];
  for (const cp of ordenados) {
    const ultimo = out[out.length - 1];
    if (ultimo && cp === ultimo[1] + 1) ultimo[1] = cp;
    else out.push([cp, cp]);
  }
  return out;
}

function hex(cp: number): string {
  return `0x${cp.toString(16).padStart(4, "0")}`;
}

function main(): void {
  const ttf = readFileSync(TTF);
  const base64 = ttf.toString("base64");
  const sha256 = createHash("sha256").update(ttf).digest("hex");
  const rangos = aRangos(codePointsCubiertos(new Uint8Array(ttf)));
  const totalCodePoints = rangos.reduce((n, [a, b]) => n + (b - a + 1), 0);

  const lineasRangos = rangos
    .map(([a, b]) => `  [${hex(a)}, ${hex(b)}],`)
    .join("\n");

  const contenido = `import type { FuenteEmbebida } from "./etiquetas-fuente-registro";

// ARCHIVO GENERADO — NO EDITAR A MANO.
//
//   pnpm exec tsx scripts/fuente-etiqueta-a-base64.ts
//
// Feature 282 — Subconjunto de fuente que se embebe en el PDF de etiquetas para
// que el simbolo de moneda (U+20A1 por defecto) salga IMPRESO. Las 14 fuentes
// estandar de jsPDF solo cubren WinAnsi/cp1252, donde ese code point no existe:
// por eso hasta ahora se imprimia "¡ 8 0" en vez de "₡18.000".
//
// Procedencia (R17):
//   fuente      : ${ORIGEN.fuente}
//   version     : ${ORIGEN.version}
//   origen      : ${ORIGEN.url}
//   licencia    : ${ORIGEN.licencia}
//   sha256 (original completo) : ${ORIGEN.sha256Original}
//   sha256 (subconjunto commiteado, assets/fuentes/LiberationSans-etiqueta-subset.ttf):
//     ${sha256}
//
// Como se regenera el subconjunto (fuera del build, sin dependencias de repo):
//   ${ORIGEN.comandoSubset}
//
// Cobertura: ${totalCodePoints} code points (cp1252 imprimible + U+20A1 + U+20AC).

/** Peso del programa de fuente en bytes. La guardia de R14 lo compara con el real. */
export const PESO_DECLARADO_BYTES = ${ttf.byteLength};

/** Longitud del base64 que viaja en el modulo. Tope de R14: 81920. */
export const PESO_DECLARADO_BASE64 = ${base64.length};

/**
 * Code points cubiertos por el subconjunto, en rangos INCLUSIVOS y ordenados.
 * DERIVADO del propio archivo por el script (R29), nunca escrito a mano.
 */
const COBERTURA: readonly (readonly [number, number])[] = [
${lineasRangos}
];

export const fuenteEtiqueta: FuenteEmbebida = {
  nombre: ${JSON.stringify(NOMBRE)},
  archivoVfs: ${JSON.stringify(ARCHIVO_VFS)},
  estilo: ${JSON.stringify(ESTILO)},
  cobertura: COBERTURA,
  base64:
    ${JSON.stringify(base64)},
};

export default fuenteEtiqueta;
`;

  writeFileSync(DESTINO, contenido, "utf8");
  process.stdout.write(
    [
      `ttf        : ${path.relative(RAIZ, TTF)}`,
      `bytes      : ${ttf.byteLength}`,
      `base64     : ${base64.length} chars`,
      `sha256     : ${sha256}`,
      `cobertura  : ${totalCodePoints} code points en ${rangos.length} rangos`,
      `escrito    : ${path.relative(RAIZ, DESTINO)}`,
      "",
    ].join("\n"),
  );
}

main();
