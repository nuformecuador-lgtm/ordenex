import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 67 (F1.4-i, APROBADA) — cobertura ESTATICA de la migracion
// `*_orden_historial_gestion_fk_restrict`: devuelve la FK
// `orden_historial_estado.gestion_orden_id` a `ON DELETE RESTRICT`, en el SQL **y** en el
// modelo Prisma. La verificacion viva (`pg_constraint.confdeltype = 'r'`) + el round-trip la
// ejecuta el implementer contra Postgres y queda en la bitacora.
//
// POR QUE ESTA FEATURE LA TOCA: `gestion_orden_id` es el enlace que sostiene el derivador de
// intentos (47/49), que dispara `rechazada` -> `cobroRechazado` (56) = dinero. La migracion
// 20260714123909 la habia dejado en `ON DELETE SET NULL` (default de Prisma para una relacion
// opcional), asi que un DELETE sobre una gestion vaciaba el enlace EN SILENCIO y orfanaba las
// filas del historial. Es defensa en profundidad: el predicado de `contarPorDestinoVigentes`
// (design §4.2) protege el conteo con o sin esta FK.

const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "..", "db", "migrations");

function migrationDirFor(suffix: string): string {
  const dir = fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .find((name) => name.endsWith(suffix));
  if (!dir) throw new Error(`No se encontro la carpeta de migracion ${suffix}`);
  return path.join(MIGRATIONS_DIR, dir);
}

const migrationDir = migrationDirFor("_orden_historial_gestion_fk_restrict");
const upSql = fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8");
const schemaPrisma = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "db", "schema.prisma"),
  "utf8",
);

// Los comentarios de ambos archivos EXPLICAN la accion contraria (de donde se viene / a donde
// se vuelve), asi que las aserciones de "no contiene X" se hacen sobre el DDL, no sobre la
// prosa. Quita comentarios de linea y colapsa el espacio.
function soloDDL(sql: string): string {
  return sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n")
    .replace(/\s+/g, " ")
    .trim();
}

const upDDL = soloDDL(upSql);
const downDDL = soloDDL(downSql);

describe("Feature 67 · F1.4-i UP — la FK vuelve a ON DELETE RESTRICT", () => {
  it("dropea la constraint vieja y la recrea con ON DELETE RESTRICT", () => {
    expect(upDDL).toMatch(
      /ALTER TABLE "orden_historial_estado" DROP CONSTRAINT IF EXISTS "orden_historial_estado_gestion_orden_id_fkey";/,
    );
    expect(upDDL).toMatch(
      /ADD CONSTRAINT "orden_historial_estado_gestion_orden_id_fkey" FOREIGN KEY \("gestion_orden_id"\) REFERENCES "gestion_orden"\("id"\) ON DELETE RESTRICT ON UPDATE CASCADE;/,
    );
    // El DDL del UP no debe dejar SET NULL en ningun lado (los comentarios si lo mencionan:
    // explican de donde venimos).
    expect(upDDL).not.toMatch(/ON DELETE SET NULL/);
  });

  it("no es destructiva: solo recablea la accion referencial (sin datos, columnas ni RLS)", () => {
    expect(upDDL).not.toMatch(/DROP COLUMN/i);
    expect(upDDL).not.toMatch(/DELETE FROM/i);
    expect(upDDL).not.toMatch(/DROP TABLE/i);
    expect(upDDL).not.toMatch(/CREATE POLICY/i);
    expect(upDDL).not.toMatch(/ROW LEVEL SECURITY/i);
  });
});

describe("Feature 67 · F1.4-i DOWN — restaura ON DELETE SET NULL", () => {
  it("recrea la FK con el ON DELETE SET NULL que dejo la 20260714123909", () => {
    expect(downDDL).toMatch(
      /ALTER TABLE "orden_historial_estado" DROP CONSTRAINT IF EXISTS "orden_historial_estado_gestion_orden_id_fkey";/,
    );
    expect(downDDL).toMatch(
      /ADD CONSTRAINT "orden_historial_estado_gestion_orden_id_fkey" FOREIGN KEY \("gestion_orden_id"\) REFERENCES "gestion_orden"\("id"\) ON DELETE SET NULL ON UPDATE CASCADE;/,
    );
    // El DDL del DOWN revierte a SET NULL: no debe quedar RESTRICT (los comentarios si lo
    // mencionan: explican que defensa se pierde al revertir).
    expect(downDDL).not.toMatch(/ON DELETE RESTRICT/);
  });

  it("documenta el riesgo que vuelve al revertir (design §8)", () => {
    expect(downSql).toMatch(/SET NULL/);
    expect(downSql).toMatch(/design\.md §8|huerfana|orfana/i);
  });
});

describe("Feature 67 · F1.4-i — el cambio esta TAMBIEN en el modelo (sin drift)", () => {
  // El punto de la decision: un RESTRICT escrito SOLO en SQL reintroduce el drift que la
  // 20260714123909 vino a eliminar, y el proximo reconcile lo pisaria en silencio.
  it("schema.prisma declara `onDelete: Restrict` en OrdenHistorialEstado.gestion", () => {
    expect(schemaPrisma).toMatch(
      /gestion\s+GestionOrden\? @relation\(fields: \[gestionOrdenId\], references: \[id\], onDelete: Restrict\)/,
    );
  });

  it("la relacion NO queda sin `onDelete` (que volveria al default SetNull de Prisma)", () => {
    expect(schemaPrisma).not.toMatch(
      /gestion\s+GestionOrden\? @relation\(fields: \[gestionOrdenId\], references: \[id\]\)/,
    );
  });
});

describe("estructura de la carpeta de migracion", () => {
  it("contiene migration.sql y down.sql, y va DESPUES (aparte) de la migracion de anulacion", () => {
    expect(fs.existsSync(path.join(migrationDir, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(migrationDir, "down.sql"))).toBe(true);
    // tasks T11b: NO se mezcla con T1 — es una decision independiente, reversible por separado.
    const anulacion = fs
      .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .find((name) => name.endsWith("_gestion_orden_anulacion"));
    expect(anulacion).toBeDefined();
    expect(path.basename(migrationDir) > (anulacion as string)).toBe(true);
  });
});
