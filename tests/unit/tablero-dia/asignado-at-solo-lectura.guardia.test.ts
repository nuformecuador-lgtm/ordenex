import fs from "fs";
import path from "path";

import { describe, expect, it } from "vitest";

import { ARCHIVOS_BACKEND, REPO_ROOT, arbolDeLaFeature } from "./_arbol-de-la-feature";

// Feature 192 (B8.5) — R59. **GUARDIA DE DINERO, no de estilo.**
//
// `orden.asignado_at` es el DENOMINADOR del ranking diario del mensajero (feature 76/R38,
// ficha 166). El numerador solo cuenta entregas, asi que estampar esa columna en una
// recoleccion —que no es una entrega— BAJA el porcentaje del mensajero sin darle forma de
// subirlo: le toca el pago y el premio para arreglar una pantalla de lectura. El humano
// descarto esa opcion explicitamente (alternativa 14) y eligio el segundo camino por el
// historial.
//
// Esta feature es SOLO LECTURA sobre esa columna. El guardia existe para que un futuro "ya que
// estamos, unifiquemos el criterio en una columna" salga ROJO en vez de salir en produccion.

const ESCRITURAS_SQL = /\b(UPDATE|INSERT|DELETE|MERGE)\b/;
const ESCRITURAS_PRISMA = /\.(update|updateMany|upsert|create|createMany|delete|deleteMany)\s*\(/;

/**
 * Los comentarios se quitan ANTES de censar: este mismo repositorio explica por escrito que
 * no hace ni un `INSERT`, `UPDATE` ni `DELETE`, y un censo que leyera esa frase como una
 * infraccion obligaria a borrar la explicacion para pasar el guardia. Se mide el codigo.
 */
function sinComentarios(texto: string): string {
  return texto
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/^\s*--.*$/gm, "");
}

/**
 * Las UNICAS migraciones del repo que mencionan `asignado_at`, congeladas. Esta feature no
 * añade ninguna (R37: ni migraciones ni indices). Si aparece una cuarta, hay que mirarla a
 * mano antes de tocar esta lista.
 */
const MIGRACIONES_QUE_MENCIONAN_LA_COLUMNA = [
  "20260716120000_orden_asignado_at/down.sql",
  "20260716120000_orden_asignado_at/migration.sql",
  // Solo en un COMENTARIO, y el comentario dice exactamente esto: que no se toca.
  "20260731130000_order_status_recolectando/migration.sql",
];

function migracionesQueMencionanAsignadoAt(): string[] {
  const raiz = path.join(REPO_ROOT, "db", "migrations");
  const salida: string[] = [];
  for (const dir of fs.readdirSync(raiz)) {
    const carpeta = path.join(raiz, dir);
    if (!fs.statSync(carpeta).isDirectory()) continue;
    for (const archivo of fs.readdirSync(carpeta)) {
      if (!archivo.endsWith(".sql")) continue;
      const texto = fs.readFileSync(path.join(carpeta, archivo), "utf8");
      if (texto.includes("asignado_at")) salida.push(`${dir}/${archivo}`);
    }
  }
  return salida.sort();
}

describe("asignado_at es de SOLO LECTURA en toda la feature", () => {
  it("los archivos censados existen: el guardia mira lo que dice mirar", () => {
    for (const ruta of ARCHIVOS_BACKEND) {
      expect(fs.existsSync(path.join(REPO_ROOT, ruta)), `falta ${ruta}`).toBe(true);
    }
  });

  it("ningun archivo de la feature emite una escritura, ni en SQL ni por Prisma (R59)", () => {
    // No se censa "asignadoAt aparece en un payload" sino algo mas fuerte y menos fragil: la
    // feature no escribe NADA. Sin `UPDATE`, sin `INSERT` y sin `.update(`, no hay forma de
    // tocar esa columna ni por descuido ni por "ya que estamos".
    for (const { ruta, texto } of arbolDeLaFeature()) {
      const codigo = sinComentarios(texto);
      expect(ESCRITURAS_SQL.test(codigo), `${ruta} contiene SQL de escritura`).toBe(false);
      expect(ESCRITURAS_PRISMA.test(codigo), `${ruta} llama a un metodo de escritura`).toBe(false);
    }
  });

  it("la feature no añade ninguna migracion que toque la columna (R37/R59)", () => {
    expect(migracionesQueMencionanAsignadoAt()).toEqual(MIGRACIONES_QUE_MENCIONAN_LA_COLUMNA);
  });

  it("el repositorio SI la lee: la columna aparece en un WHERE y en un SELECT", () => {
    const repo = fs.readFileSync(
      path.join(REPO_ROOT, "lib/repositories/TableroDiaRepository.ts"),
      "utf8",
    );
    // Si esto se pusiera rojo, el guardia de arriba se habria vuelto trivial (nadie la usa).
    expect(repo).toContain('"asignado_at"');
  });
});
