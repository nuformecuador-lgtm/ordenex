import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

import { quitarComentarios } from "@/tests/fixtures/sin-comentarios";

// =================================================================================================
// GUARDIA — FICHA 459 (recorrido F1) — NINGUNA FECHA DE LA WALLET SE RECORTA EN UTC
// =================================================================================================
//
// Las fechas de la wallet viajan como ISO en UTC. Recortarlas con `.slice(0, 10)` da el día UTC:
// todo lo registrado después de las 18:00 de Costa Rica salía fechado al día SIGUIENTE en el
// libro de la caja, en los desgloses de /wallet/tiendas y /mi-wallet y en sus descargas. El día
// se saca con `fechaDiaMovimientoCR` (`lib/utils/fecha-dia-iso.ts`), que delega en
// `fechaCalendarioCR`. Tampoco vale `fechaDiaISO(<x>.fechaMovimiento)`: es el mismo recorte.
//
// Alcance: todo `app/(app)/wallet/**` y `app/(app)/mi-wallet/**`, sin comentarios. Con su
// contraprueba: el detector encuentra las formas de ANTES.

const RAIZ = path.resolve(__dirname, "../../..");
const CARPETAS = ["app/(app)/wallet", "app/(app)/mi-wallet"];

/** Las formas prohibidas: un recorte de 10 caracteres o `fechaDiaISO` sobre un campo de fecha. */
const PROHIBIDAS: readonly RegExp[] = [
  /\.(?:slice|substring|substr)\(\s*0\s*,\s*10\s*\)/,
  /fechaDiaISO\(\s*[\w.?]*\b(?:fecha\w*|\w+At)\s*\)/,
];

function archivosDe(dir: string): string[] {
  const salida: string[] = [];
  for (const nombre of readdirSync(dir)) {
    const ruta = path.join(dir, nombre);
    if (statSync(ruta).isDirectory()) salida.push(...archivosDe(ruta));
    else if (/\.(ts|tsx)$/.test(nombre)) salida.push(ruta);
  }
  return salida;
}

/** Líneas de código (sin comentarios) que recortan una fecha en UTC. */
function recortesEn(fuente: string): string[] {
  return quitarComentarios(fuente)
    .split("\n")
    .filter((linea) => PROHIBIDAS.some((re) => re.test(linea)))
    .map((linea) => linea.trim());
}

describe("GUARDIA 459/F1 — la wallet no recorta fechas en UTC", () => {
  it("contraprueba: el detector encuentra las formas de antes de la ficha", () => {
    expect(recortesEn("render: (m) => m.fechaMovimiento.slice(0, 10),")).toHaveLength(1);
    expect(recortesEn("const fecha = movimiento.fechaMovimiento.slice(0, 10);")).toHaveLength(1);
    expect(recortesEn("fecha: fechaDiaISO(movimiento.fechaMovimiento),")).toHaveLength(1);
    expect(recortesEn("consolidada: c.solicitadoAt.substring(0, 10),")).toHaveLength(1);
    expect(recortesEn("return fechaDiaISO(cierre.fecha);")).toHaveLength(1);
    // Lo que SÍ se puede escribir no salta.
    expect(recortesEn("render: (m) => fechaDiaMovimientoCR(m.fechaMovimiento),")).toEqual([]);
    // Y en un comentario no cuenta.
    expect(recortesEn("// antes: m.fechaMovimiento.slice(0, 10)")).toEqual([]);
  });

  it("ningún archivo de /wallet ni de /mi-wallet corta una fecha así", () => {
    const hallazgos: string[] = [];
    let revisados = 0;
    for (const carpeta of CARPETAS) {
      for (const ruta of archivosDe(path.join(RAIZ, carpeta))) {
        revisados += 1;
        for (const linea of recortesEn(readFileSync(ruta, "utf8"))) {
          hallazgos.push(`${path.relative(RAIZ, ruta)}: ${linea}`);
        }
      }
    }
    // Sin archivos que mirar la guardia sería verde por vacía.
    expect(revisados).toBeGreaterThan(50);
    expect(hallazgos).toEqual([]);
  });
});
