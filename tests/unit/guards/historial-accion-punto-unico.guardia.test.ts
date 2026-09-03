import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { quitarComentarios } from "../../fixtures/sin-comentarios";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 362 / T7.2 (R13) — EL PUNTO UNICO DE ESCRITURA.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// TODA fila de `historial_accion` se escribe por `appendAccion`
// (`lib/repositories/registrar-accion.ts`) y por nadie mas.
//
// POR QUE IMPORTA. Si un repositorio cualquiera pudiera hacer `tx.historialAccion.create(...)`
// por su cuenta, las garantias que sostienen esta ficha dejarian de ser estructurales:
//   - el `lote_id` UNICO por accion (R7) depende de que lo ponga UN sitio, una vez por llamada;
//   - el recorte de la etiqueta a la anchura de la columna, idem;
//   - y sobre todo, la guardia de la T7.1 —que exige `appendAccion` dentro de la transaccion—
//     se volveria ciega: un `create` directo la esquivaria sin romper nada.
//
// LO QUE **SI** ESTA PERMITIDO, y por eso el barrido distingue: LEER la tabla. El repositorio de
// lectura (`HistorialAccionRepository`) la nombra en `findMany` y `count`, que es su trabajo.
//
// La selecciona `pnpm exec vitest run guard` por el nombre del archivo.

const RAIZ = path.resolve(__dirname, "../../..");

/** El unico archivo del arbol autorizado a ESCRIBIR en la tabla. */
const PUNTO_UNICO = "lib/repositories/registrar-accion.ts";

/** El repositorio de LECTURA: la nombra, pero solo para leer. Se comprueba aparte, mas abajo. */
const LECTOR = "lib/repositories/HistorialAccionRepository.ts";

/** Las carpetas que se barren. Son las que pueden contener codigo de servidor. */
const RAICES = ["lib", "app", "components", "hooks", "scripts"];

/** Las formas de ESCRITURA sobre el delegado de Prisma de esta tabla. */
const ESCRITURAS = ["create", "createMany", "update", "updateMany", "delete", "deleteMany", "upsert"];

function archivosDe(dir: string, acc: string[] = []): string[] {
  const abs = path.join(RAIZ, dir);
  for (const entrada of readdirSync(abs)) {
    const rel = path.join(dir, entrada).replace(/\\/g, "/");
    if (statSync(path.join(RAIZ, rel)).isDirectory()) archivosDe(rel, acc);
    else if (/\.(ts|tsx)$/.test(rel)) acc.push(rel);
  }
  return acc;
}

const ARCHIVOS = RAICES.flatMap((r) => archivosDe(r));

function fuente(rel: string): string {
  return quitarComentarios(readFileSync(path.join(RAIZ, rel), "utf8"));
}

/** `true` si el codigo ESCRIBE en el delegado `historialAccion`. */
export function escribeEnLaTabla(codigo: string): boolean {
  return ESCRITURAS.some((metodo) =>
    new RegExp(`historialAccion\\s*\\.\\s*${metodo}\\s*\\(`).test(codigo),
  );
}

describe("362/T7.2 — el detector se prueba a si mismo", () => {
  it("CONTRAPRUEBA: reconoce las siete formas de escritura", () => {
    for (const metodo of ESCRITURAS) {
      expect(escribeEnLaTabla(`await tx.historialAccion.${metodo}({ data });`)).toBe(true);
    }
    expect(escribeEnLaTabla("await tx.historialAccion  .  createMany({ data });")).toBe(true);
  });

  it("CONTRAPRUEBA: NO se dispara con una LECTURA de la misma tabla", () => {
    expect(escribeEnLaTabla("await this.prisma.historialAccion.findMany({ where });")).toBe(false);
    expect(escribeEnLaTabla("await this.prisma.historialAccion.count({ where });")).toBe(false);
  });

  it("anti-vacuidad: el barrido lee de verdad un arbol grande", () => {
    expect(ARCHIVOS.length).toBeGreaterThan(500);
    expect(ARCHIVOS).toContain(PUNTO_UNICO);
    expect(ARCHIVOS).toContain(LECTOR);
  });
});

describe("362/R13 — nadie escribe en `historial_accion` fuera del punto unico", () => {
  it("el punto unico SI escribe (control positivo)", () => {
    // Sin esto, el barrido de abajo podria estar verde porque el detector no encuentra nada.
    expect(escribeEnLaTabla(fuente(PUNTO_UNICO))).toBe(true);
  });

  it("ningun OTRO archivo del arbol escribe en la tabla", () => {
    const infractores = ARCHIVOS.filter(
      (rel) => rel !== PUNTO_UNICO && escribeEnLaTabla(fuente(rel)),
    );
    expect(
      infractores,
      "una escritura fuera de `appendAccion` esquiva el `lote_id` unico por accion (R7) y deja " +
        "ciega a la guardia de atomicidad (T7.1)",
    ).toEqual([]);
  });

  it("el repositorio de LECTURA nombra la tabla pero no la escribe", () => {
    const codigo = fuente(LECTOR);
    // Control positivo: la nombra de verdad (si no, el caso de abajo seria vacio).
    expect(codigo).toContain("historialAccion.findMany");
    expect(codigo).toContain("historialAccion.count");
    expect(escribeEnLaTabla(codigo)).toBe(false);
  });

  it("CONTRAPRUEBA: pegar un `create` en otro repositorio pondria esto rojo", () => {
    const ajeno = fuente("lib/repositories/VehiculoRepository.ts");
    expect(escribeEnLaTabla(ajeno)).toBe(false);
    expect(escribeEnLaTabla(`${ajeno}\nawait tx.historialAccion.create({ data: {} });`)).toBe(true);
  });
});
