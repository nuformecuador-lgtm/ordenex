import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import type { PrismaClient } from "@prisma/client";

import { HAY_BASE_DE_DATOS, crearPrismaDeTest } from "./_postgres-real";

// Feature 238 (T3.1, R20/R21/R43) — la migracion `*_gestion_orden_confirmacion_fisica`.
//
// DOS mitades, y las dos hacen falta:
//
//  1. COBERTURA ESTATICA por regex sobre `migration.sql` / `down.sql` (patron
//     `gestion-orden-causa-devolucion-migration.test.ts`, la hermana literal sobre la MISMA
//     tabla): protege la FORMA de los dos .sql para que un cambio posterior no los desalinee en
//     silencio.
//  2. LA FORMA REAL EN LA BASE, cuando hay una alcanzable: que la columna EXISTA, sea NULLABLE y
//     no tenga DEFAULT no es algo que una regex demuestre — lo demuestra `information_schema`.
//
// El round-trip up -> down -> pendiente -> up lo corrio la fase backend contra el Postgres local
// y esta registrado en `progress/impl_238.md` (con la salida real de `pnpm run db:rollback`).

const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "..", "db", "migrations");
const SUFIJO = "_gestion_orden_confirmacion_fisica";

function migrationDirFor(suffix: string): string {
  const dir = fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .find((name) => name.endsWith(suffix));
  if (!dir) throw new Error(`No se encontro la carpeta de migracion ${suffix}`);
  return path.join(MIGRATIONS_DIR, dir);
}

/**
 * Quita los comentarios `--` para que las aserciones NEGATIVAS («no hay CHECK», «no toca RLS»)
 * miren SENTENCIAS y no prosa: los comentarios de esta migracion citan justamente las palabras
 * prohibidas al explicar por que NO se usan, y sin esto un `not.toMatch` daria falso positivo.
 */
function soloSentencias(sql: string): string {
  return sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
}

const migrationDir = migrationDirFor(SUFIJO);
const upSql = soloSentencias(fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8"));
const downSql = soloSentencias(fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8"));
const schemaPrisma = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "db", "schema.prisma"),
  "utf8",
);

describe("Feature 238 · UP — una columna nullable y nada mas (R17/R20/R21)", () => {
  it("R17: anade `confirmada_fisica_at` a gestion_orden como TIMESTAMP(3)", () => {
    expect(upSql).toMatch(
      /ALTER TABLE "gestion_orden" ADD COLUMN "confirmada_fisica_at" TIMESTAMP\(3\);/,
    );
  });

  it("R20: es NULLABLE y SIN default -> el historico queda en NULL y no se backfillea", () => {
    expect(upSql).not.toMatch(/"confirmada_fisica_at"[^;]*NOT NULL/);
    expect(upSql).not.toMatch(/"confirmada_fisica_at"[^;]*DEFAULT/);
    // No se inventa una confirmacion para las gestiones ya aprobadas: no hay ninguna cierta que
    // inventar, y poder distinguirlas del confirmado es justo lo que R20 pide.
    expect(upSql).not.toMatch(/UPDATE "gestion_orden"/i);
    expect(upSql).not.toMatch(/INSERT INTO/i);
  });

  it("SIN CHECK: la obligatoriedad vive en el servicio (cobertura exacta), no en la base", () => {
    expect(upSql).not.toMatch(/CHECK/i);
    expect(upSql).not.toMatch(/ADD CONSTRAINT/i);
  });

  it("SIN indice: no hay ninguna consulta declarada que filtre por esta columna", () => {
    expect(upSql).not.toMatch(/CREATE INDEX/i);
    expect(upSql).not.toMatch(/CREATE UNIQUE INDEX/i);
  });

  it("es ADITIVA — no altera ni borra columnas, datos ni indices preexistentes", () => {
    expect(upSql).not.toMatch(/DROP COLUMN/i);
    expect(upSql).not.toMatch(/ALTER COLUMN/i);
    expect(upSql).not.toMatch(/DROP TABLE/i);
    expect(upSql).not.toMatch(/DELETE FROM/i);
    expect(upSql).not.toMatch(/DROP INDEX/i);
  });

  it("NO toca RLS — `gestion_orden` conserva la suya (habilitada, sin policies)", () => {
    expect(upSql).not.toMatch(/CREATE POLICY/i);
    expect(upSql).not.toMatch(/DROP POLICY/i);
    expect(upSql).not.toMatch(/ROW LEVEL SECURITY/i);
  });

  it("no crea enums, ni estados, ni valores de origen del historial", () => {
    // El estado es binario (NULL / NOT NULL) porque D2 se firmo SIN faltantes declarados. Si esa
    // decision se invirtiera, esto pasaria a ser un enum y su down tendria que recrear el tipo.
    expect(upSql).not.toMatch(/CREATE TYPE/i);
    expect(upSql).not.toMatch(/ALTER TYPE/i);
    expect(upSql).not.toMatch(/order_status/i);
    expect(upSql).not.toMatch(/orden_historial_origen_tipo/i);
  });

  it("R41: no toca ninguna tabla de dinero", () => {
    for (const tabla of ["wallet_movimiento", "wallet_tienda_movimiento", "pago_mensajero_movimiento", "cierre_dia", "cierre_detail"]) {
      expect(upSql).not.toContain(tabla);
    }
  });
});

describe("Feature 238 · DOWN — reversible (R43, OBLIGATORIO)", () => {
  it("suelta la columna, con `IF EXISTS` (rollback idempotente)", () => {
    expect(downSql).toMatch(
      /ALTER TABLE "gestion_orden" DROP COLUMN IF EXISTS "confirmada_fisica_at";/,
    );
  });

  it("revierte EXACTAMENTE la sentencia del UP, ni una mas", () => {
    const sentencias = downSql.split("\n").filter((l) => l.trim() !== "");
    expect(sentencias).toHaveLength(1);
  });

  it("R43: el down NO toca ninguna otra columna, ni RLS, ni datos de otras tablas", () => {
    expect(downSql).not.toMatch(/CREATE POLICY/i);
    expect(downSql).not.toMatch(/ROW LEVEL SECURITY/i);
    expect(downSql).not.toMatch(/UPDATE "orden"/i);
    expect(downSql).not.toMatch(/DELETE FROM/i);
    // R43 se cumple porque el codigo anterior NUNCA leyo esta columna: la base revertida es
    // exactamente la que ese codigo espera. La perdida de las marcas esta declarada en el propio
    // down y es el mismo trato que la 158 da a los montos.
    expect(downSql).not.toMatch(/DROP COLUMN IF EXISTS "indemnizacion"/i);
  });
});

describe("Feature 238 · schema.prisma refleja la migracion (sin drift)", () => {
  it("GestionOrden declara `confirmadaFisicaAt` OPCIONAL y mapeada a la columna", () => {
    expect(schemaPrisma).toMatch(/confirmadaFisicaAt\s+DateTime\?\s+@map\("confirmada_fisica_at"\)/);
  });

  it("NO declara `confirmadaFisicaPor` (quien confirmo es `cierre_dia.resuelto_por`)", () => {
    // D1, firmada: una segunda copia de «quien» es una segunda verdad que puede divergir.
    expect(schemaPrisma).not.toMatch(/confirmadaFisicaPor/);
    expect(schemaPrisma).not.toMatch(/confirmada_fisica_por/);
  });

  it("la columna no tiene `@default` ni `@@index` propios", () => {
    const modelo = schemaPrisma.match(/model GestionOrden \{([\s\S]*?)\n\}/);
    expect(modelo).not.toBeNull();
    const cuerpo = (modelo as RegExpMatchArray)[1];
    expect(cuerpo).not.toMatch(/confirmadaFisicaAt[^\n]*@default/);
    expect(cuerpo).not.toMatch(/@@index\(\[confirmadaFisicaAt\]\)/);
  });
});

describe("estructura de la carpeta de migracion", () => {
  it("contiene migration.sql y down.sql, con timestamp posterior a la ultima previa", () => {
    expect(fs.existsSync(path.join(migrationDir, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(migrationDir, "down.sql"))).toBe(true);
    // Posterior a `20260819160000_orden_retiro_ayuda`, la ultima aplicada en `dev` cuando esta
    // feature empezo. Un timestamp anterior se aplicaria fuera de orden en una base que ya tenga
    // aquella, o no se aplicaria nunca.
    expect(path.basename(migrationDir) > "20260819160000_orden_retiro_ayuda").toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// La forma REAL en la base. Sin base alcanzable se SALTA (se ve en la salida); no se disfraza de
// verde con un `return` dentro del caso.
// ---------------------------------------------------------------------------------------------

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("Feature 238 · la columna, tal como quedo en Postgres (R20)", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("R17/R20: existe, es NULLABLE y no tiene DEFAULT", async () => {
    const filas = (await prisma.$queryRawUnsafe(
      `SELECT data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_name = 'gestion_orden' AND column_name = 'confirmada_fisica_at'`,
    )) as Array<{ data_type: string; is_nullable: string; column_default: string | null }>;

    expect(filas, "la migracion no esta aplicada en esta base").toHaveLength(1);
    expect(filas[0].is_nullable).toBe("YES");
    expect(filas[0].column_default).toBeNull();
    expect(filas[0].data_type).toMatch(/timestamp/);
  });

  it("R20: las gestiones ANTERIORES a la feature quedan en NULL (no hay backfill)", async () => {
    const filas = (await prisma.$queryRawUnsafe(
      `SELECT count(*) FILTER (WHERE "confirmada_fisica_at" IS NOT NULL) AS con_marca,
              count(*)                                                   AS total
         FROM "gestion_orden"
        WHERE "created_at" < TIMESTAMP '2026-08-19 00:00:00'`,
    )) as Array<{ con_marca: bigint; total: bigint }>;

    // Toda gestion creada ANTES del dia de esta feature tiene que estar sin marca: la migracion
    // no inventa confirmaciones. Si la base no tuviera ninguna fila previa, el caso seria vacuo
    // —por eso se afirma tambien que las hay—.
    expect(Number(filas[0].total), "esta base no tiene gestiones previas que comprobar").toBeGreaterThan(0);
    expect(Number(filas[0].con_marca)).toBe(0);
  });

  it("no se creo ningun indice sobre la columna", async () => {
    const filas = (await prisma.$queryRawUnsafe(
      `SELECT indexdef FROM pg_indexes
        WHERE tablename = 'gestion_orden' AND indexdef LIKE '%confirmada_fisica_at%'`,
    )) as unknown[];
    expect(filas).toEqual([]);
  });
});
