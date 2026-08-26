import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Indicador de mensajes sin leer del chat — cobertura ESTATICA de la migracion
// `*_chat_conversacion_mensajero_leido` (mismo patron que `chat-mensaje-ubicacion-migration`:
// se leen migration.sql/down.sql por regex). NO requiere Postgres real; aplicar la migracion
// es un paso de despliegue humano porque el `.env` apunta a una base compartida.

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

const migrationDir = migrationDirFor("_chat_conversacion_mensajero_leido");
const upSql = fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8");
const schemaPrisma = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "db", "schema.prisma"),
  "utf8",
);

describe("UP — marca de lectura del hilo por mensajero", () => {
  it("anade `mensajero_leido_at` como TIMESTAMP(3) a chat_conversacion", () => {
    expect(upSql).toMatch(
      /ALTER TABLE "chat_conversacion"\s+ADD COLUMN "mensajero_leido_at" TIMESTAMP\(3\);/,
    );
  });

  it("es NULLABLE y sin DEFAULT: NULL = nunca abrio el hilo, no `leido al desplegar`", () => {
    // Con `DEFAULT now()` el backfill daria por leidos los entrantes YA pendientes de todos
    // los mensajeros vivos, que es justo el aviso que esta columna existe para dar.
    expect(upSql).not.toMatch(/"mensajero_leido_at"[^;]*NOT NULL/);
    expect(upSql).not.toMatch(/"mensajero_leido_at"[^;]*DEFAULT/i);
  });

  it("es ADITIVA: no toca RLS, ni otras tablas, ni borra nada", () => {
    expect(upSql).not.toMatch(/CREATE POLICY/i);
    expect(upSql).not.toMatch(/ROW LEVEL SECURITY/i);
    expect(upSql).not.toMatch(/DROP COLUMN/i);
    expect(upSql).not.toMatch(/CREATE TABLE/i);
    expect(upSql).not.toMatch(/DELETE FROM/i);
    expect(upSql).not.toMatch(/ALTER TABLE "chat_mensaje"/i);
  });
});

describe("DOWN — revierte la columna", () => {
  it("suelta `mensajero_leido_at` de forma idempotente", () => {
    expect(downSql).toMatch(
      /ALTER TABLE "chat_conversacion" DROP COLUMN IF EXISTS "mensajero_leido_at";/,
    );
  });

  it("documenta la perdida de dato asumida (la lectura no deja rastro en otra tabla)", () => {
    expect(downSql).toMatch(/perdida de DATO/i);
  });
});

describe("schema.prisma refleja la migracion (sin drift)", () => {
  it("ChatConversacion declara mensajeroLeidoAt DateTime? mapeada", () => {
    const bloque = schemaPrisma.match(/model ChatConversacion \{([\s\S]*?)\n\}/);
    expect(bloque).not.toBeNull();
    expect((bloque as RegExpMatchArray)[1]).toMatch(
      /mensajeroLeidoAt\s+DateTime\?\s+@map\("mensajero_leido_at"\)/,
    );
  });
});

describe("estructura de la carpeta de migracion", () => {
  it("contiene migration.sql y down.sql, con timestamp posterior a la carpeta previa", () => {
    expect(fs.existsSync(path.join(migrationDir, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(migrationDir, "down.sql"))).toBe(true);
    const dirName = path.basename(migrationDir);
    const previa = fs
      .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((n) => n < dirName)
      .sort()
      .pop();
    expect(previa).toBeDefined();
    expect(dirName > (previa as string)).toBe(true);
  });
});
