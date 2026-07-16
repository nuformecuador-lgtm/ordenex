import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 69 (R1/R2/R24/R25/R26/R27) — cobertura ESTATICA de la migracion `*_cierre_detail`
// (patron gasto-fijo-plantilla-migration: lee migration.sql/down.sql por regex). No hay
// Postgres en la suite: el round-trip real up->down->up lo verifica el implementer
// (`pnpm db:migrate` / `pnpm db:rollback`, evidencia en progress/impl_69-cierre-detail.md).
//
// Lo que este test protege es que el SQL escrito a mano no se desvie del diseño: el grano
// (R2), la tarifa congelada (R8), la RLS sin policies (R25), el backfill (R26/R27) y — el
// punto mas fragil — que el LATERAL del backfill siga coincidiendo con el WHERE del resolver
// (decision (g)).

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

const migrationDir = migrationDirFor("_cierre_detail");
const upSql = fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8");

// Las aserciones de AUSENCIA (p.ej. "el WHERE no menciona `status`") tienen que correr sobre
// el SQL EJECUTABLE, no sobre la prosa: los comentarios de esta migracion explican justamente
// lo que NO esta (decision (g)), y buscarlo en el texto crudo daria un falso positivo.
function sinComentarios(sql: string): string {
  return sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");
}

const upExec = sinComentarios(upSql);
const downExec = sinComentarios(downSql);

describe("UP — tabla cierre_detail (R1)", () => {
  it("R1: crea la tabla con id TEXT NOT NULL + pkey", () => {
    expect(upSql).toMatch(/CREATE TABLE "cierre_detail"/);
    expect(upSql).toMatch(/"id" TEXT NOT NULL/);
    expect(upSql).toMatch(/CONSTRAINT "cierre_detail_pkey" PRIMARY KEY \("id"\)/);
  });

  it("R6: congela las columnas money-critical (entradas de la formula)", () => {
    expect(upSql).toMatch(/"monto_cobrar" DECIMAL\(12,2\),/);
    expect(upSql).toMatch(/"cobra_comision" BOOLEAN NOT NULL,/);
    expect(upSql).toMatch(/"zona_id" TEXT NOT NULL,/);
    expect(upSql).toMatch(/"tienda_id" TEXT NOT NULL,/);
    expect(upSql).toMatch(/"es_central" BOOLEAN NOT NULL,/);
  });

  it("R8: congela los 7 valores de tarifa + tarifa_id (montos 12,2 / porcentajes 5,2)", () => {
    expect(upSql).toMatch(/"tarifa_id" TEXT,/);
    // Montos: DECIMAL(12,2).
    expect(upSql).toMatch(/"tarifa_valor_flete" DECIMAL\(12,2\),/);
    expect(upSql).toMatch(/"tarifa_valor_flete_gam" DECIMAL\(12,2\),/);
    expect(upSql).toMatch(/"tarifa_valor_flete_devuelto" DECIMAL\(12,2\),/);
    expect(upSql).toMatch(/"tarifa_valor_flete_devuelto_gam" DECIMAL\(12,2\),/);
    // Porcentajes 0..100: DECIMAL(5,2).
    expect(upSql).toMatch(/"tarifa_comision_cod" DECIMAL\(5,2\),/);
    expect(upSql).toMatch(/"tarifa_iva_flete" DECIMAL\(5,2\),/);
    expect(upSql).toMatch(/"tarifa_iva_comision_cod" DECIMAL\(5,2\),/);
  });

  it("R9: las 8 columnas de tarifa son NULLABLE (tienda sin tarifa => gap, no bloqueo)", () => {
    // Ninguna columna `tarifa_*` puede ser NOT NULL o el gap (c) bloquearia el cierre.
    expect(upExec).not.toMatch(/"tarifa_[a-z_]*" (TEXT|DECIMAL\(\d+,\d+\)) NOT NULL/);
  });

  it("R7: congela los descriptivos, con num_guia SIN UNIQUE (es copia, no identidad)", () => {
    expect(upSql).toMatch(/"num_guia" INTEGER,/);
    expect(upSql).toMatch(/"num_remision" TEXT NOT NULL,/);
    expect(upSql).toMatch(/"destinatario" TEXT NOT NULL,/);
    expect(upSql).toMatch(/"direccion" TEXT,/);
    expect(upSql).toMatch(/"producto" TEXT NOT NULL,/);
    expect(upSql).toMatch(/"tienda_nombre" TEXT NOT NULL,/);
    expect(upSql).toMatch(/"zona_nombre" TEXT NOT NULL,/);
    expect(upSql).toMatch(/"provincia_nombre" TEXT NOT NULL,/);
    expect(upSql).toMatch(/"canton_nombre" TEXT NOT NULL,/);
    expect(upSql).toMatch(/"distrito_nombre" TEXT,/); // unico FK nullable de la orden
    expect(upExec).not.toMatch(/"num_guia"[^,]*UNIQUE/i);
  });

  it("R10: fila INMUTABLE — sin updated_at ni deleted_at", () => {
    expect(upExec).not.toMatch(/"updated_at"/);
    expect(upExec).not.toMatch(/"deleted_at" TIMESTAMP/);
    expect(upSql).toMatch(/"created_at" TIMESTAMP\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/);
  });

  it("R2: el GRANO — UNIQUE (cierre_id, orden_id)", () => {
    expect(upSql).toMatch(
      /CREATE UNIQUE INDEX "cierre_detail_cierre_id_orden_id_key" ON "cierre_detail"\("cierre_id", "orden_id"\);/,
    );
  });

  it("crea el indice por orden_id (trazar en que cierres aparecio una orden)", () => {
    expect(upSql).toMatch(
      /CREATE INDEX "cierre_detail_orden_id_idx" ON "cierre_detail"\("orden_id"\);/,
    );
  });

  it("crea las 5 FKs, todas ON DELETE RESTRICT ON UPDATE CASCADE", () => {
    const fks = [
      ["cierre_id", "cierre_dia"],
      ["orden_id", "orden"],
      ["zona_id", "zona"],
      ["tienda_id", "usuario"],
      ["tarifa_id", "tarifas"],
    ] as const;
    for (const [col, tabla] of fks) {
      expect(upSql).toMatch(
        new RegExp(
          `ADD CONSTRAINT "cierre_detail_${col}_fkey"\\s*\\n?\\s*FOREIGN KEY \\("${col}"\\) REFERENCES "${tabla}"\\("id"\\) ON DELETE RESTRICT ON UPDATE CASCADE;`,
        ),
      );
    }
    expect(upSql.match(/ADD CONSTRAINT "cierre_detail_\w+_fkey"/g)).toHaveLength(5);
  });

  it("R25: habilita RLS SIN policies (solo service role)", () => {
    expect(upSql).toMatch(/ALTER TABLE "cierre_detail" ENABLE ROW LEVEL SECURITY;/);
    expect(upExec).not.toMatch(/CREATE POLICY/i);
  });

  it("es ADITIVA: no altera tablas existentes ni crea enums", () => {
    expect(upExec).not.toMatch(/ALTER TABLE "orden"/);
    expect(upExec).not.toMatch(/ALTER TABLE "gestion_orden"/);
    expect(upExec).not.toMatch(/ALTER TABLE "cierre_dia"/);
    expect(upExec).not.toMatch(/ALTER TABLE "tarifas"/);
    expect(upExec).not.toMatch(/CREATE TYPE/i);
    expect(upExec).not.toMatch(/DROP (TABLE|COLUMN)/i);
  });
});

describe("UP — backfill de los cierres existentes (R26/R27)", () => {
  it("R26: el UP contiene el INSERT .. SELECT de backfill", () => {
    expect(upSql).toMatch(/INSERT INTO "cierre_detail"/);
    expect(upSql).toMatch(/SELECT\s+gen_random_uuid\(\)/);
    expect(upSql).toMatch(/FROM "gestion_orden" g/);
  });

  it("R2: el backfill mantiene el grano ORDEN (DISTINCT cierre_id, orden_id)", () => {
    expect(upSql).toMatch(/SELECT DISTINCT g\."cierre_id", g\."orden_id"/);
  });

  it("R5: el backfill excluye gestiones anuladas (mismo criterio que crearCierre)", () => {
    expect(upSql).toMatch(/WHERE g\."cierre_id" IS NOT NULL AND g\."anulada_at" IS NULL/);
  });

  it("R27: no excluye ningun cierre — todo cierre existente queda con detalle", () => {
    // El unico WHERE del subselect es el de arriba (cierre no nulo + gestion vigente).
    // Cualquier filtro por estado del cierre dejaria cierres sin detalle y reabriria la
    // necesidad de un fallback (R14).
    expect(upExec).not.toMatch(/WHERE[^;]*"estado"/);
    expect(upExec).not.toMatch(/cd\."estado"|c\."estado"/);
  });

  it("R9: LEFT JOIN LATERAL sobre tarifas => tienda sin tarifa deja tarifa_* en NULL", () => {
    expect(upSql).toMatch(/LEFT JOIN LATERAL \(/);
    expect(upSql).toMatch(/ORDER BY ta\."created_at" DESC/);
    expect(upSql).toMatch(/LIMIT 1/);
    expect(upSql).toMatch(/\) t ON TRUE/);
  });

  it("(g)/R22: el LATERAL replica el WHERE del resolver y NO filtra tarifas.status", () => {
    // El WHERE del LATERAL debe coincidir AL CARACTER con el del resolver
    // (`TarifaVigentePorTiendaRepository`: tiendaId + deletedAt: null). Si alguien anade
    // `status = 'activo'` aqui sin anadirlo alla (o al reves), un cierre backfilleado y uno
    // nuevo liquidarian DISTINTO para los mismos datos. Testear la ausencia es deliberado
    // (decision (g), override del humano; design §6.1).
    expect(upSql).toMatch(/WHERE ta\."tienda_id" = o\."tienda_id" AND ta\."deleted_at" IS NULL/);
    expect(upExec).not.toMatch(/ta\."status"/);
    expect(upExec).not.toMatch(/'activo'/);
  });

  it("R20: el backfill resuelve la tarifa por TIENDA, no por zona (el PR #64 dropeo zona_id)", () => {
    expect(upExec).not.toMatch(/ta\."zona_id"/);
  });

  it("R26: es idempotente (ON CONFLICT DO NOTHING) — se re-corre tras un rollback", () => {
    expect(upSql).toMatch(/ON CONFLICT \("cierre_id", "orden_id"\) DO NOTHING;/);
  });

  it("el distrito entra por LEFT JOIN (unico FK nullable: un JOIN perderia filas)", () => {
    expect(upSql).toMatch(/LEFT JOIN "distrito" d ON d\."id" = o\."distrito_id"/);
    // Los demas son NOT NULL en `orden`: JOIN normal.
    expect(upSql).toMatch(/JOIN "provincia" p\s+ON p\."id" = o\."provincia_id"/);
    expect(upSql).toMatch(/JOIN "canton" c\s+ON c\."id" = o\."canton_id"/);
  });
});

describe("DOWN — revierte exactamente el UP (R24)", () => {
  it("R24: DROP TABLE IF EXISTS cierre_detail (arrastra unique, indice, FKs y RLS)", () => {
    expect(downSql).toMatch(/DROP TABLE IF EXISTS "cierre_detail";/);
  });

  it("no toca otras tablas ni policies (la migracion era ADITIVA)", () => {
    expect(downExec).not.toMatch(/"orden"|"gestion_orden"|"cierre_dia"|"tarifas"/);
    expect(downExec).not.toMatch(/CREATE POLICY/i);
    expect(downExec).not.toMatch(/DROP TYPE/i);
  });
});

describe("estructura de la carpeta de migracion", () => {
  it("R24: contiene migration.sql y down.sql", () => {
    expect(fs.existsSync(path.join(migrationDir, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(migrationDir, "down.sql"))).toBe(true);
  });

  it("tiene timestamp posterior a las migraciones previas", () => {
    const dirs = fs
      .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    const thisDir = dirs.find((d) => d.endsWith("_cierre_detail"))!;
    expect(thisDir).toBe(dirs[dirs.length - 1]);
  });
});
