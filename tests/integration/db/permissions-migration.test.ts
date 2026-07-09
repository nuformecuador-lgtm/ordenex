import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Tests de nivel DB que NO requieren una base real: leen el DDL de la carpeta de
// migracion `*_permissions` y hacen asserts sobre las restricciones que la DB
// impone (unicidad, PK compuesta, FKs, RLS) y sobre la reversibilidad (down.sql).
// La verificacion en caliente contra Supabase real (R13 rechazo con key anon)
// queda DIFERIDA a un entorno con DB, igual que login T004.

const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "..", "db", "migrations");

function permissionsMigrationDir(): string {
  const dir = fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .find((name) => name.endsWith("_permissions"));
  if (!dir) throw new Error("No se encontro la carpeta de migracion *_permissions");
  return path.join(MIGRATIONS_DIR, dir);
}

const migrationDir = permissionsMigrationDir();
const upSql = fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8");

describe("permissions migration.sql (DDL)", () => {
  it("crea las tablas permiso y rol_permiso (R1, R7)", () => {
    expect(upSql).toMatch(/CREATE TABLE "permiso"/);
    expect(upSql).toMatch(/CREATE TABLE "rol_permiso"/);
  });

  it("permiso.created_at tiene DEFAULT CURRENT_TIMESTAMP y existe updated_at (R4, R5)", () => {
    expect(upSql).toMatch(/"created_at" TIMESTAMP\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/);
    expect(upSql).toMatch(/"updated_at" TIMESTAMP\(3\) NOT NULL/);
  });

  it("garantiza unicidad de (method, route) con un UNIQUE INDEX (R6)", () => {
    expect(upSql).toMatch(
      /CREATE UNIQUE INDEX "permiso_method_route_key" ON "permiso"\("method", "route"\)/
    );
  });

  it("la pivote tiene PRIMARY KEY compuesta (rol_id, permiso_id) (R8)", () => {
    expect(upSql).toMatch(
      /CONSTRAINT "rol_permiso_pkey" PRIMARY KEY \("rol_id", "permiso_id"\)/
    );
  });

  it("crea un indice sobre rol_permiso(permiso_id)", () => {
    expect(upSql).toMatch(
      /CREATE INDEX "rol_permiso_permiso_id_idx" ON "rol_permiso"\("permiso_id"\)/
    );
  });

  it("define las dos FKs de rol_permiso hacia rol y permiso con ON DELETE CASCADE (R9)", () => {
    expect(upSql).toMatch(
      /ADD CONSTRAINT "rol_permiso_rol_id_fkey" FOREIGN KEY \("rol_id"\) REFERENCES "rol"\("id"\) ON DELETE CASCADE ON UPDATE CASCADE/
    );
    expect(upSql).toMatch(
      /ADD CONSTRAINT "rol_permiso_permiso_id_fkey" FOREIGN KEY \("permiso_id"\) REFERENCES "permiso"\("id"\) ON DELETE CASCADE ON UPDATE CASCADE/
    );
  });

  it("habilita Row Level Security en ambas tablas sin policies (R12, R13)", () => {
    expect(upSql).toMatch(/ALTER TABLE "permiso" ENABLE ROW LEVEL SECURITY/);
    expect(upSql).toMatch(/ALTER TABLE "rol_permiso" ENABLE ROW LEVEL SECURITY/);
    // Sin policies para anon/authenticated: no debe crear ninguna POLICY.
    expect(upSql).not.toMatch(/CREATE POLICY/i);
  });

  it("NO toca tablas preexistentes (rol, usuario) salvo referenciarlas por FK (R10, R11)", () => {
    // No recrea ni altera columnas de rol/usuario: la unica mencion a "rol" y
    // "usuario" permitida es como destino de la FK / nombre de la pivote.
    expect(upSql).not.toMatch(/CREATE TABLE "rol"\b/);
    expect(upSql).not.toMatch(/CREATE TABLE "usuario"/);
    expect(upSql).not.toMatch(/ALTER TABLE "rol" /);
    expect(upSql).not.toMatch(/ALTER TABLE "usuario"/);
    // Sin INSERT: las tablas quedan vacias tras migrar (R10, R11).
    expect(upSql).not.toMatch(/INSERT INTO/i);
  });
});

describe("permissions down.sql (R14)", () => {
  it("dropea rol_permiso y permiso en orden inverso de dependencia", () => {
    expect(downSql).toMatch(/DROP TABLE IF EXISTS "rol_permiso"/);
    expect(downSql).toMatch(/DROP TABLE IF EXISTS "permiso"/);
    const idxPivote = downSql.indexOf('DROP TABLE IF EXISTS "rol_permiso"');
    const idxPermiso = downSql.indexOf('DROP TABLE IF EXISTS "permiso"');
    expect(idxPivote).toBeLessThan(idxPermiso);
  });

  it("NO toca tablas preexistentes (rol, usuario, tipo_identificacion)", () => {
    // Ignora los comentarios (que si nombran rol/usuario a modo de aclaracion)
    // y valida solo las sentencias ejecutables.
    const sentencias = downSql
      .split("\n")
      .filter((linea) => !linea.trim().startsWith("--"))
      .join("\n");
    expect(sentencias).not.toMatch(/"rol"/);
    expect(sentencias).not.toMatch(/"usuario"/);
    expect(sentencias).not.toMatch(/"tipo_identificacion"/);
  });
});

describe("estado inicial sin seed (R10, R11)", () => {
  it("scripts/seed-catalogos.ts NO inserta permisos ni asociaciones rol_permiso", () => {
    const seed = fs.readFileSync(
      path.join(__dirname, "..", "..", "..", "scripts", "seed-catalogos.ts"),
      "utf8"
    );
    expect(seed).not.toMatch(/permiso/i);
    expect(seed).not.toMatch(/rolPermiso/);
  });
});
