import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import type { PrismaClient } from "@prisma/client";
import { HAY_BASE_DE_DATOS, crearPrismaDeTest } from "./_postgres-real";

// Feature 311 — A2/A3.T (R13). La migracion `*_chat_mensaje_media_reacciones`.
//
// A DIFERENCIA de la 121 (que se cubrio por REGEX sobre el .sql), aqui se aplica el DDL DE
// VERDAD en un esquema desechable y se pregunta al catalogo de Postgres. Motivo: lo que hay que
// demostrar es que las nueve columnas existen y son NULLABLE y que los ocho valores estan en el
// enum — hechos del motor. Una regex demuestra que el archivo dice eso, no que Postgres lo haga
// (y `ADD VALUE IF NOT EXISTS` + el recasteo del down son justo donde eso se rompe).
//
// El esquema temporal se crea y se suelta aqui; `public` y `_prisma_migrations` NO se tocan.
// Sin base alcanzable, los tests de catalogo se SALTAN (la suite tiene que ser verde en una
// maquina sin Postgres) y quedan las aserciones estaticas, que no necesitan motor.

const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "..", "db", "migrations");
const SUFIJO = "_chat_mensaje_media_reacciones";

function migrationDirFor(suffix: string): string {
  const dir = fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .find((name) => name.endsWith(suffix));
  if (!dir) throw new Error(`No se encontro la carpeta de migracion ${suffix}`);
  return path.join(MIGRATIONS_DIR, dir);
}

const migrationDir = migrationDirFor(SUFIJO);
const upSql = fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8");
const schemaPrisma = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "db", "schema.prisma"),
  "utf8",
);

/** El .sql sin sus lineas de comentario: lo que Postgres realmente ejecuta. */
const SOLO_DDL = upSql
  .split("\n")
  .filter((l) => !l.trimStart().startsWith("--"))
  .join("\n");

const VALORES_NUEVOS = [
  "imagen",
  "audio",
  "video",
  "documento",
  "sticker",
  "reaccion",
  "contactos",
  "sistema",
];

const VALORES_PREVIOS = ["texto", "plantilla", "otro", "ubicacion"];

const COLUMNAS_NUEVAS = [
  "media_id",
  "media_mime",
  "media_nombre",
  "media_tamano_bytes",
  "reaccion_a_wa_message_id",
  "reaccion_emoji",
  "contactos_json",
  "sistema_telefono_anterior",
  "sistema_telefono_nuevo",
];

// ---------------------------------------------------------------------------
// Catalogo REAL de Postgres (up + down aplicados en un esquema desechable)
// ---------------------------------------------------------------------------

const ESQUEMA = "f311_migracion_test";

type ColumnaRow = { column_name: string; is_nullable: string; data_type: string };
type EnumRow = { enumlabel: string };

describe.skipIf(!HAY_BASE_DE_DATOS)(
  "Feature 311 · la migracion aplicada DE VERDAD (R13)",
  () => {
    let prisma: PrismaClient;

    /** Columnas de `chat_mensaje` en el esquema desechable, segun information_schema. */
    async function columnas(): Promise<ColumnaRow[]> {
      return await prisma.$queryRawUnsafe<ColumnaRow[]>(
        `SELECT column_name, is_nullable, data_type
           FROM information_schema.columns
          WHERE table_schema = '${ESQUEMA}' AND table_name = 'chat_mensaje'`,
      );
    }

    /** Valores del enum `chat_mensaje_tipo` del esquema desechable, segun pg_enum. */
    async function valoresEnum(): Promise<string[]> {
      const rows = await prisma.$queryRawUnsafe<EnumRow[]>(
        `SELECT e.enumlabel
           FROM pg_enum e
           JOIN pg_type t ON t.oid = e.enumtypid
           JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE n.nspname = '${ESQUEMA}' AND t.typname = 'chat_mensaje_tipo'
          ORDER BY e.enumsortorder`,
      );
      return rows.map((r) => r.enumlabel);
    }

    /** Aplica un .sql sentencia a sentencia con el search_path en el esquema desechable. */
    async function aplicar(sql: string): Promise<void> {
      // El DDL de la migracion referencia los objetos SIN cualificar, asi que basta el
      // search_path para dirigirlo al esquema desechable. `ADD VALUE` no puede ir dentro de una
      // transaccion junto a un uso del valor, por eso cada sentencia va suelta.
      const sentencias = sql
        .split("\n")
        .filter((l) => !l.trimStart().startsWith("--"))
        .join("\n")
        .split(";")
        .map((s) => s.trim())
        .filter((s) => s !== "");
      for (const s of sentencias) {
        await prisma.$executeRawUnsafe(`SET search_path TO "${ESQUEMA}"`);
        await prisma.$executeRawUnsafe(s);
      }
    }

    beforeAll(async () => {
      prisma = crearPrismaDeTest();
      await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${ESQUEMA}" CASCADE`);
      await prisma.$executeRawUnsafe(`CREATE SCHEMA "${ESQUEMA}"`);
      await prisma.$executeRawUnsafe(`SET search_path TO "${ESQUEMA}"`);
      // Estado PREVIO a la feature: el enum con sus cuatro valores y lo minimo de la tabla que
      // la migracion toca. No se replica el modelo entero: la migracion no lo necesita.
      await prisma.$executeRawUnsafe(
        `CREATE TYPE "${ESQUEMA}"."chat_mensaje_tipo" AS ENUM ('texto', 'plantilla', 'otro', 'ubicacion')`,
      );
      await prisma.$executeRawUnsafe(
        `CREATE TABLE "${ESQUEMA}"."chat_mensaje" (
           id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
           conversacion_id uuid NOT NULL,
           tipo "${ESQUEMA}"."chat_mensaje_tipo" NOT NULL,
           cuerpo text
         )`,
      );
    });

    afterAll(async () => {
      await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${ESQUEMA}" CASCADE`);
      await prisma.$disconnect();
    });

    it("UP: pg_enum contiene los ocho valores nuevos y conserva los cuatro previos", async () => {
      await aplicar(upSql);
      const valores = await valoresEnum();

      for (const v of VALORES_NUEVOS) expect(valores).toContain(v);
      // `otro` SIGUE existiendo: es el sumidero de las degradaciones (R3/R6/R8/R11).
      for (const v of VALORES_PREVIOS) expect(valores).toContain(v);
      expect(valores).toHaveLength(12);
    });

    it("UP: las nueve columnas existen y son NULLABLE", async () => {
      const cols = await columnas();
      const porNombre = new Map(cols.map((c) => [c.column_name, c]));

      for (const nombre of COLUMNAS_NUEVAS) {
        const col = porNombre.get(nombre);
        expect(col, `falta la columna ${nombre}`).toBeDefined();
        expect(col?.is_nullable, `${nombre} deberia ser nullable`).toBe("YES");
      }
      expect(porNombre.get("contactos_json")?.data_type).toBe("jsonb");
      expect(porNombre.get("media_tamano_bytes")?.data_type).toBe("integer");
    });

    it("UP: crea el indice PARCIAL de reacciones", async () => {
      const rows = await prisma.$queryRawUnsafe<{ indexdef: string }[]>(
        `SELECT indexdef FROM pg_indexes
          WHERE schemaname = '${ESQUEMA}' AND indexname = 'chat_mensaje_reaccion_idx'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].indexdef).toContain("WHERE");
      expect(rows[0].indexdef).toContain("reaccion_a_wa_message_id");
    });

    it("DOWN: revierte el enum a cuatro valores y borra las nueve columnas", async () => {
      await aplicar(downSql);

      expect(await valoresEnum()).toEqual(VALORES_PREVIOS);

      const nombres = (await columnas()).map((c) => c.column_name);
      for (const nombre of COLUMNAS_NUEVAS) expect(nombres).not.toContain(nombre);

      const indices = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
        `SELECT indexname FROM pg_indexes
          WHERE schemaname = '${ESQUEMA}' AND indexname = 'chat_mensaje_reaccion_idx'`,
      );
      expect(indices).toHaveLength(0);
    });
  },
);

// ---------------------------------------------------------------------------
// Aserciones estaticas (no necesitan motor): forma del .sql y ausencia de drift
// ---------------------------------------------------------------------------

describe("Feature 311 · forma de la migracion (A2/A3)", () => {
  it("declara los ocho valores con IF NOT EXISTS y documenta el GOTCHA 55P04", () => {
    for (const v of VALORES_NUEVOS) {
      expect(upSql).toContain(`ALTER TYPE "chat_mensaje_tipo" ADD VALUE IF NOT EXISTS '${v}';`);
    }
    expect(upSql).toMatch(/55P04/);
  });

  it("es ADITIVA: no toca RLS, no crea tablas y no reinterpreta el historico (R14/R15)", () => {
    // Se juzga el DDL, no los comentarios: el .sql DOCUMENTA que no hay `bytea` ni backfill, y
    // esa documentacion no puede hacer fallar la comprobacion que la respalda.
    const upSql = SOLO_DDL;
    expect(upSql).not.toMatch(/CREATE POLICY/i);
    expect(upSql).not.toMatch(/ROW LEVEL SECURITY/i);
    expect(upSql).not.toMatch(/CREATE TABLE/i);
    expect(upSql).not.toMatch(/DROP COLUMN/i);
    // Sin backfill: ninguna fila existente se reescribe (design §1.5).
    expect(upSql).not.toMatch(/^\s*UPDATE\s/im);
    expect(upSql).not.toMatch(/^\s*DELETE\s/im);
    // R15: ninguna columna guarda el binario.
    expect(upSql).not.toMatch(/BYTEA/i);
  });

  it("el down documenta la irreversibilidad del enum y su precondicion", () => {
    expect(downSql).toMatch(/IRREVERSIBILIDAD PARCIAL/i);
    expect(downSql).toMatch(/PRECONDICION/i);
    const match = downSql.match(/CREATE TYPE "chat_mensaje_tipo" AS ENUM \(([\s\S]*?)\);/);
    expect(match).not.toBeNull();
    const valores = [...(match as RegExpMatchArray)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(valores).toEqual(VALORES_PREVIOS);
  });
});

describe("Feature 311 · schema.prisma refleja la migracion (sin drift)", () => {
  const bloqueEnum = schemaPrisma.match(/enum ChatMensajeTipo \{([\s\S]*?)\n\}/);
  const bloqueModelo = schemaPrisma.match(/model ChatMensaje \{([\s\S]*?)\n\}/);

  it("el enum ChatMensajeTipo declara los ocho valores nuevos", () => {
    expect(bloqueEnum).not.toBeNull();
    for (const v of VALORES_NUEVOS) {
      expect((bloqueEnum as RegExpMatchArray)[1]).toMatch(new RegExp(`\\b${v}\\b`));
    }
  });

  it("el modelo declara las nueve columnas mapeadas y opcionales", () => {
    expect(bloqueModelo).not.toBeNull();
    const cuerpo = (bloqueModelo as RegExpMatchArray)[1];
    for (const columna of COLUMNAS_NUEVAS) {
      expect(cuerpo).toMatch(new RegExp(`\\?\\s+@map\\("${columna}"\\)`));
    }
  });

  it("declara el indice de reacciones con `map:` explicito (o el down quedaria mudo)", () => {
    expect((bloqueModelo as RegExpMatchArray)[1]).toContain(
      'map: "chat_mensaje_reaccion_idx"',
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
