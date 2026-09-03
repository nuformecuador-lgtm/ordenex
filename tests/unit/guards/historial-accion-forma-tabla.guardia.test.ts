import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { quitarComentarios } from "../../fixtures/sin-comentarios";
import {
  CATEGORIAS_ACCION,
  CATEGORIA_POR_ACCION,
  HISTORIAL_ACCION_TIPOS,
} from "@/lib/types/historial-accion";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 362 / T7.3 (R2/R17/R39) — LA FORMA DE LA TABLA, Y LO QUE NO TIENE.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// TRES ausencias, y cada una es un requisito:
//
//  1. R2 — LA FILA ES INMUTABLE. El modelo NO tiene `updatedAt` ni `deletedAt`, y el repositorio
//     de lectura NO expone `update`, `delete`, `updateMany` ni `deleteMany`. Una correccion se
//     representa con una accion NUEVA, jamas alterando una fila previa. Un registro de auditoria
//     que se puede editar no es un registro de auditoria.
//
//  2. R17 — LA CATEGORIA NO SE GUARDA, SE DERIVA. Sin columna `categoria`: guardarla seria una
//     segunda fuente de verdad capaz de divergir del mapa que la define (la leccion A5 de la
//     129/133, que este repo ya castiga con guardia). Y el mapa es EXHAUSTIVO sobre el enum.
//
//  3. R39 — NO HAY PURGA. Ningun job borra de esta tabla. 11k-38k filas/año y sin datos de
//     clientes: no hay motivo de proteccion de datos ni de coste. Un registro de auditoria que se
//     borra solo es la peor clase de borrado. Si algun dia hace falta purgar, sera una decision
//     humana con ficha propia, no un job que aparece.
//
// La selecciona `pnpm exec vitest run guard` por el nombre del archivo.

const RAIZ = path.resolve(__dirname, "../../..");
const SCHEMA = "db/schema.prisma";
const MODELO = "model HistorialAccion {";
const INTERFAZ = "lib/interfaces/repositories/IHistorialAccionRepository.ts";
const LECTOR = "lib/repositories/HistorialAccionRepository.ts";

function fuente(rel: string): string {
  return quitarComentarios(readFileSync(path.join(RAIZ, rel), "utf8"));
}

/**
 * El bloque del modelo `HistorialAccion` del schema, recortado por llaves balanceadas. LANZA si
 * el modelo no esta: una guardia que mide la nada calla en vez de fallar.
 *
 * ⚠️ Los comentarios `///` de Prisma se quitan A MANO y no con `quitarComentarios` (que esta
 * pensado para TypeScript): el modelo los usa para documentar POR QUE no hay `updated_at`, y esa
 * frase contiene literalmente `updated_at`. Sin quitarlos, la guardia se pondria roja por su
 * propia documentacion.
 */
export function bloqueDelModelo(schema: string): string {
  const inicio = schema.indexOf(MODELO);
  if (inicio === -1) {
    throw new Error(`no se encontro \`${MODELO}\` en ${SCHEMA}: la guardia mediria la nada`);
  }
  const abre = schema.indexOf("{", inicio);
  let profundidad = 0;
  for (let i = abre; i < schema.length; i++) {
    if (schema[i] === "{") profundidad++;
    else if (schema[i] === "}") {
      profundidad--;
      if (profundidad === 0) {
        return schema
          .slice(abre, i + 1)
          .split("\n")
          .filter((linea) => !/^\s*(\/\/\/|\/\/)/.test(linea))
          .join("\n");
      }
    }
  }
  throw new Error("el modelo `HistorialAccion` no cierra: el recortador esta roto");
}

const SCHEMA_TEXTO = readFileSync(path.join(RAIZ, SCHEMA), "utf8");
const BLOQUE = bloqueDelModelo(SCHEMA_TEXTO);

// ---------------------------------------------------------------------------------------------
// 0 — El recortador, probado
// ---------------------------------------------------------------------------------------------

describe("362/T7.3 — el recortador del modelo se prueba a si mismo", () => {
  it("recorta EL MODELO, no el schema entero, y trae sus columnas", () => {
    expect(BLOQUE.length).toBeGreaterThan(200);
    expect(BLOQUE.length).toBeLessThan(SCHEMA_TEXTO.length / 5);
    for (const columna of ["accion", "entidadTipo", "entidadId", "entidadEtiqueta", "loteId"]) {
      expect(BLOQUE, `falta la columna \`${columna}\``).toContain(columna);
    }
    // Y NO trae el modelo de al lado.
    expect(BLOQUE).not.toContain("model Usuario");
  });

  it("CONTRAPRUEBA: si el modelo desapareciera, LANZA en vez de medir vacio", () => {
    expect(() => bloqueDelModelo("model Otro { id String }")).toThrow(/no se encontro/);
  });

  it("CONTRAPRUEBA: añadir `updated_at` EN MEMORIA se detecta", () => {
    // La mutacion literal de R2, ejercida sobre el texto real.
    const mutado = BLOQUE.replace("createdAt", "updatedAt DateTime @updatedAt\n  createdAt");
    expect(/\bupdatedAt\b/.test(BLOQUE)).toBe(false);
    expect(/\bupdatedAt\b/.test(mutado)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// R2 — la fila es INMUTABLE
// ---------------------------------------------------------------------------------------------

describe("362/R2 — la fila del registro es inmutable", () => {
  it("el modelo NO tiene `updatedAt` ni `deletedAt`", () => {
    expect(/\bupdatedAt\b/.test(BLOQUE), "`updated_at` en un registro append-only").toBe(false);
    expect(/\bdeletedAt\b/.test(BLOQUE), "`deleted_at` en un registro append-only").toBe(false);
  });

  it("la migracion tampoco las crea", () => {
    const dir = path.join(RAIZ, "db/migrations");
    const carpeta = readdirSync(dir).find((d) => d.endsWith("_historial_accion"));
    expect(carpeta, "no existe la migracion de la ficha 362").toBeDefined();
    const sql = readFileSync(path.join(dir, carpeta as string, "migration.sql"), "utf8");
    // Se mira SOLO el `CREATE TABLE`: la cabecera del archivo explica por que NO hay `updated_at`
    // y esa frase contiene el nombre, asi que barrer el archivo entero se pondria rojo por su
    // propia documentacion.
    const desde = sql.indexOf('CREATE TABLE "historial_accion"');
    expect(desde, "no se encontro el `CREATE TABLE`: la guardia mediria la nada").toBeGreaterThan(
      -1,
    );
    const tabla = sql.slice(desde, sql.indexOf(");", desde));
    expect(tabla.length).toBeGreaterThan(200);
    expect(tabla).not.toContain("updated_at");
    expect(tabla).not.toContain("deleted_at");
  });

  it("el contrato de lectura NO declara ninguna operacion que altere una fila", () => {
    const interfaz = fuente(INTERFAZ);
    // El bloque de la interfaz de lectura, recortado: `EntradaAccion` de la ESCRITURA vive en el
    // mismo archivo y no es lo que se vigila aqui.
    const inicio = interfaz.indexOf("interface IHistorialAccionRepository");
    expect(inicio, "desaparecio `IHistorialAccionRepository`").toBeGreaterThan(-1);
    const bloque = interfaz.slice(inicio, interfaz.indexOf("\n}", inicio));
    expect(bloque).toContain("list(");
    for (const prohibido of ["update", "delete", "upsert", "actualizar", "borrar", "eliminar"]) {
      expect(bloque, `el contrato de lectura declara \`${prohibido}\``).not.toMatch(
        new RegExp(`\\b${prohibido}\\w*\\s*\\(`, "i"),
      );
    }
  });

  it("la implementacion del lector tampoco los expone", () => {
    const codigo = fuente(LECTOR);
    const metodos = [...codigo.matchAll(/^\s{2}(?:private\s+)?async\s+(\w+)\(/gm)].map((m) => m[1]);
    expect(metodos.sort()).toEqual(["list", "listAll", "listarActores"]);
  });
});

// ---------------------------------------------------------------------------------------------
// R17 — la categoria se DERIVA, no se guarda
// ---------------------------------------------------------------------------------------------

describe("362/R17 — la categoria no es una columna", () => {
  it("el modelo NO tiene columna `categoria`", () => {
    expect(/\bcategoria\b/i.test(BLOQUE), "guardar la categoria seria una segunda verdad").toBe(
      false,
    );
  });

  it("el mapa `CATEGORIA_POR_ACCION` es EXHAUSTIVO sobre el enum, y sus valores son del union", () => {
    const claves = Object.keys(CATEGORIA_POR_ACCION).sort();
    expect(claves).toEqual([...HISTORIAL_ACCION_TIPOS].sort());
    for (const [tipo, categoria] of Object.entries(CATEGORIA_POR_ACCION)) {
      expect(
        (CATEGORIAS_ACCION as readonly string[]).includes(categoria),
        `\`${tipo}\` tiene una categoria fuera del union`,
      ).toBe(true);
    }
  });

  it("cada tipo cae en EXACTAMENTE UNA categoria, y las tres estan pobladas", () => {
    // «Exactamente una» es propiedad del `Record`; lo que se afirma aqui es que ninguna de las
    // tres esta vacia — una categoria sin tipos seria un filtro que siempre da cero.
    for (const categoria of CATEGORIAS_ACCION) {
      const cuantos = HISTORIAL_ACCION_TIPOS.filter(
        (t) => CATEGORIA_POR_ACCION[t] === categoria,
      ).length;
      expect(cuantos, `la categoria \`${categoria}\` no tiene ni un tipo`).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// R39 — ni purga, ni caducidad, ni archivado
// ---------------------------------------------------------------------------------------------

describe("362/R39 — nada borra del registro, y menos aun un job", () => {
  function archivosDe(dir: string, acc: string[] = []): string[] {
    const abs = path.join(RAIZ, dir);
    if (!existsSync(abs)) return acc;
    for (const entrada of readdirSync(abs)) {
      const rel = path.join(dir, entrada).replace(/\\/g, "/");
      if (statSync(path.join(RAIZ, rel)).isDirectory()) archivosDe(rel, acc);
      else if (/\.(ts|tsx)$/.test(rel)) acc.push(rel);
    }
    return acc;
  }

  it("ningun job ni cron nombra la tabla", () => {
    const jobs = [...archivosDe("lib/services/jobs"), ...archivosDe("app/api/cron")];
    // Anti-vacuidad: el barrido encuentra archivos de verdad.
    expect(jobs.length).toBeGreaterThan(5);
    const infractores = jobs.filter((rel) => /historialAccion|historial_accion/.test(fuente(rel)));
    expect(
      infractores,
      "un job que purga el registro es la peor clase de borrado: el que nadie decidio",
    ).toEqual([]);
  });

  it("ninguna migracion borra filas del registro", () => {
    // Se barre el SQL, no el NOMBRE de la carpeta: ya existe una migracion legitima que se llama
    // `purga_pdf_indices` y no tiene nada que ver con esta tabla. Lo que se prohibe es un
    // `DELETE FROM "historial_accion"` o un `TRUNCATE` sobre ella, venga en la migracion que
    // venga. El `DROP TABLE` del `down.sql` de la propia ficha queda fuera del barrido: revertir
    // una migracion es otra cosa, y su coste esta escrito en ese archivo.
    const dir = path.join(RAIZ, "db/migrations");
    const todas = readdirSync(dir).filter((d) => statSync(path.join(dir, d)).isDirectory());
    expect(todas.length).toBeGreaterThan(100);

    const infractoras: string[] = [];
    for (const carpeta of todas) {
      const archivo = path.join(dir, carpeta, "migration.sql");
      if (!existsSync(archivo)) continue;
      const sql = readFileSync(archivo, "utf8");
      if (/(DELETE\s+FROM|TRUNCATE)\s+(TABLE\s+)?"?historial_accion"?/i.test(sql)) {
        infractoras.push(carpeta);
      }
    }
    expect(infractoras, "una migracion que borra evidencia").toEqual([]);
  });
});
