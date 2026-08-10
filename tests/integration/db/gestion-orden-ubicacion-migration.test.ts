import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 193 (T A.4) — cobertura ESTATICA de la migracion `*_gestion_orden_ubicacion`.
// Mismo patron que `orden-busqueda-producto-migration.test.ts`: lee los .sql y el
// schema.prisma y los verifica por regex, sin Postgres real.
//
// Lo que este archivo protege, y es su razon de existir:
//
//  - R3 — que el UP no lleve NI UN `UPDATE`. Es la unica forma de garantizar que las
//    gestiones anteriores quedan en NULL. Un backfill "razonable" (el centroide de la zona,
//    la bodega) colado aqui produciria un dato que PARECE medido y no lo es, y ningun test
//    de runtime lo distinguiria despues.
//  - R2 — que las columnas nazcan NULLABLE y sin CHECK. Si alguien "endurece" esto en la
//    base, las filas historicas de R3 se vuelven ilegales y la migracion deja de aplicar.
//  - R12 — que la DENEGACION no exista como valor del enum. Esa ausencia ES el mecanismo
//    del bloqueo: si un dia alguien la anade "por completitud", el bloqueo del permiso
//    denegado se cae en silencio, sin que falle ningun otro test.
//  - Que el DOWN revierta lo tres cosas en el orden correcto (el tipo el ultimo).

const ROOT = path.join(__dirname, "..", "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");
const SUFIJO = "_gestion_orden_ubicacion";

const carpeta = fs
  .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort()
  .find((n) => n.endsWith(SUFIJO));
if (!carpeta) throw new Error(`No se encontro la carpeta de migracion ${SUFIJO}`);
const migrationDir = path.join(MIGRATIONS_DIR, carpeta);

const upSql = fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8");
const schemaPrisma = fs.readFileSync(path.join(ROOT, "db", "schema.prisma"), "utf8");

/** El SQL sin comentarios ni lineas en blanco: la prosa de estos archivos nombra a proposito
 *  las palabras que el test busca (UPDATE, CHECK, la denegacion), y sin limpiar primero el
 *  test se leeria a si mismo y fallaria por su propia documentacion. */
function sinComentarios(sql: string): string {
  return sql
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("--"))
    .join("\n");
}

const upLimpio = sinComentarios(upSql);
const downLimpio = sinComentarios(downSql);

/** Los 4 valores del enum, y NINGUNO mas. La denegacion NO esta, y es deliberado (R12). */
const VALORES_AUSENCIA = [
  "timeout",
  "no_disponible",
  "no_soportado",
  "contexto_inseguro",
] as const;

describe("Feature 193 — migracion de la ubicacion en gestion_orden", () => {
  describe("UP", () => {
    it("R5: crea el enum con EXACTAMENTE los cuatro fallos tecnicos", () => {
      const bloque = upLimpio.match(
        /CREATE TYPE "gestion_ubicacion_ausencia" AS ENUM\s*\(([^)]*)\)/i,
      );
      expect(bloque, "no se encontro el CREATE TYPE del enum").not.toBeNull();

      const valores = [...bloque![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
      expect(valores.sort()).toEqual([...VALORES_AUSENCIA].sort());
    });

    it("R12: la DENEGACION del permiso NO es un valor del enum", () => {
      // El bloqueo del permiso denegado es ESTRUCTURAL: se apoya en que este valor no exista.
      // Anadirlo "por completitud" tumbaria el bloqueo sin romper ningun otro test, asi que
      // la guardia vive aqui.
      const bloque = upLimpio.match(
        /CREATE TYPE "gestion_ubicacion_ausencia" AS ENUM\s*\(([^)]*)\)/i,
      );
      expect(bloque![1]).not.toMatch(/deneg|denied|permiso|permission/i);
    });

    it("R1/R4: anade las tres columnas, las coords como DECIMAL(10,7)", () => {
      expect(upLimpio).toMatch(
        /ALTER TABLE "gestion_orden" ADD COLUMN "ubicacion_lat" DECIMAL\(10,\s*7\)/i,
      );
      expect(upLimpio).toMatch(
        /ALTER TABLE "gestion_orden" ADD COLUMN "ubicacion_lng" DECIMAL\(10,\s*7\)/i,
      );
      expect(upLimpio).toMatch(
        /ALTER TABLE "gestion_orden" ADD COLUMN "ubicacion_ausencia" "gestion_ubicacion_ausencia"/i,
      );
    });

    it("R2: ninguna columna nace NOT NULL ni con DEFAULT", () => {
      // Un NOT NULL aqui haria imposible aplicar la migracion sobre una tabla con filas, y un
      // DEFAULT reescribiria la tabla entera (bloqueo sobre una tabla que crece con cada
      // entrega). Ambas cosas se comprueban sobre las sentencias de ADD COLUMN, no sobre todo
      // el archivo.
      const addColumns = upLimpio
        .split("\n")
        .filter((l) => /ADD COLUMN/i.test(l));
      expect(addColumns).toHaveLength(3);
      for (const linea of addColumns) {
        expect(linea, linea).not.toMatch(/NOT NULL/i);
        expect(linea, linea).not.toMatch(/DEFAULT/i);
      }
    });

    it("R3: el UP no backfillea NI UNA fila", () => {
      expect(upLimpio).not.toMatch(/\bUPDATE\b/i);
      expect(upLimpio).not.toMatch(/\bINSERT\b/i);
      expect(upLimpio).not.toMatch(/\bDELETE\b/i);
    });

    it("R2/R6: la coherencia de las tres columnas NO se atornilla con un CHECK", () => {
      // Decision de design §2: la regla (lat,lng,NULL) | (NULL,NULL,motivo) vive en zod. Un
      // CHECK en la base romperia las filas historicas que R3 manda dejar intactas.
      expect(upLimpio).not.toMatch(/CHECK\s*\(/i);
    });

    it("no toca RLS ni policies: no hay tabla nueva", () => {
      expect(upLimpio).not.toMatch(/ROW LEVEL SECURITY/i);
      expect(upLimpio).not.toMatch(/CREATE POLICY/i);
      expect(upLimpio).not.toMatch(/CREATE TABLE/i);
    });
  });

  describe("DOWN", () => {
    it("suelta las tres columnas y el tipo", () => {
      expect(downLimpio).toMatch(/DROP COLUMN IF EXISTS "ubicacion_lat"/i);
      expect(downLimpio).toMatch(/DROP COLUMN IF EXISTS "ubicacion_lng"/i);
      expect(downLimpio).toMatch(/DROP COLUMN IF EXISTS "ubicacion_ausencia"/i);
      expect(downLimpio).toMatch(/DROP TYPE IF EXISTS "gestion_ubicacion_ausencia"/i);
    });

    it("suelta el TIPO despues de las columnas, o el rollback aborta", () => {
      // Mientras una columna use el enum, `DROP TYPE` falla. El orden no es cosmetico.
      const posTipo = downLimpio.search(/DROP TYPE/i);
      const posUltimaColumna = downLimpio.search(
        /DROP COLUMN IF EXISTS "ubicacion_lat"/i,
      );
      expect(posTipo).toBeGreaterThan(posUltimaColumna);
    });
  });

  describe("schema.prisma concuerda con el SQL", () => {
    it("declara el enum con los mismos cuatro valores", () => {
      const bloque = schemaPrisma.match(/enum GestionUbicacionAusencia \{([^}]*)\}/);
      expect(bloque, "no se encontro el enum en schema.prisma").not.toBeNull();
      for (const valor of VALORES_AUSENCIA) {
        expect(bloque![1]).toMatch(new RegExp(`\\b${valor}\\b`));
      }
      expect(bloque![1]).toMatch(/@@map\("gestion_ubicacion_ausencia"\)/);
    });

    it("declara las tres columnas OPCIONALES y con el decimal correcto", () => {
      expect(schemaPrisma).toMatch(
        /ubicacionLat\s+Decimal\?\s+@map\("ubicacion_lat"\)\s+@db\.Decimal\(10,\s*7\)/,
      );
      expect(schemaPrisma).toMatch(
        /ubicacionLng\s+Decimal\?\s+@map\("ubicacion_lng"\)\s+@db\.Decimal\(10,\s*7\)/,
      );
      expect(schemaPrisma).toMatch(
        /ubicacionAusencia\s+GestionUbicacionAusencia\?\s+@map\("ubicacion_ausencia"\)/,
      );
    });
  });
});
