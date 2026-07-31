import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 167 / T1.3 (R32) — cobertura ESTATICA de la migracion
// `*_orden_historial_idx_actor_origen_created`, con el patron de
// `orden-indices-filtros-migracion.test.ts`: lee migration.sql, down.sql y schema.prisma y
// verifica su contenido por regex. NO requiere Postgres real (este repo no tiene harness de DB
// viva en la suite; la aplicacion y el rollback REALES se ejecutaron a mano y su salida esta en
// `progress/impl_167-apartado-recoleccion-mensajero.md`, T1.2).
//
// La migracion es SOLO un indice: sin tablas nuevas, sin columnas nuevas => sin RLS nueva, y
// sin valores de enum => sin obligacion de tocar los `down.sql` previos (la trampa de la 154).
//
// El test es DELIBERADAMENTE especifico con el NOMBRE y el ORDEN de las columnas: el nombre
// explicito existe porque el de Prisma por defecto excede los 63 caracteres de Postgres, y el
// orden (igualdad, igualdad, rango) es lo unico que hace que el btree sirva a la consulta de
// «Recolectadas hoy». Un cambio en cualquiera de los dos deja R32 sin cumplir en silencio.

const ROOT = path.join(__dirname, "..", "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");

const SUFIJO = "_orden_historial_idx_actor_origen_created";
const INDICE = "orden_historial_actor_origen_created_idx";
const TABLA = "orden_historial_estado";
const COLUMNAS = ["actor_usuario_id", "origen_tipo", "created_at"] as const;

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
const schema = fs.readFileSync(path.join(ROOT, "db", "schema.prisma"), "utf8");

/**
 * Las sentencias reales del SQL, sin comentarios ni lineas en blanco. Los dos archivos de esta
 * migracion documentan su porque en prosa (por que el nombre explicito, por que sin
 * CONCURRENTLY, que drift se retiro a mano): las aserciones de AUSENCIA tienen que mirar el SQL
 * EJECUTABLE, no el comentario que explica la ausencia, o se contradicen solas.
 */
function sentencias(sql: string): string[] {
  return sql
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("--"));
}

const upStmts = sentencias(upSql).join("\n");
const downStmts = sentencias(downSql).join("\n");

describe("UP — un solo indice sobre orden_historial_estado (R32)", () => {
  it(`crea ${INDICE} con el nombre EXPLICITO (el de Prisma excederia los 63 chars de Postgres)`, () => {
    expect(upStmts).toMatch(new RegExp(`CREATE INDEX "${INDICE}"\\s+ON "${TABLA}"`));
    // El nombre por defecto de Prisma para estas tres columnas mide 66 caracteres: si alguien
    // borrara el `map:` del schema y regenerara, aparecerian estos dos sintomas.
    expect(INDICE.length).toBeLessThanOrEqual(63);
    expect(upStmts).not.toMatch(/orden_historial_estado_actor_usuario_id_origen_tipo/);
  });

  it("las columnas van en el orden igualdad -> igualdad -> rango, y solo esas tres", () => {
    const m = upStmts.match(new RegExp(`ON "${TABLA}"\\(([^)]*)\\)`));
    expect(m, "no se encontro la lista de columnas del CREATE INDEX").not.toBeNull();
    const columnas = m![1]
      .split(",")
      .map((c) => c.trim().replace(/"/g, ""))
      .filter((c) => c.length > 0);
    // toEqual (no arrayContaining): el ORDEN es el requisito, no la pertenencia.
    expect(columnas).toEqual([...COLUMNAS]);
  });

  it("hace UNA sola cosa: una unica sentencia, y es el CREATE INDEX", () => {
    // `prisma migrate dev --create-only` emitio ademas 10 sentencias de drift preexistente
    // (defaults de updated_at, una FK y dos RenameIndex) ajenas a esta feature. Se retiraron a
    // mano; este caso impide que vuelvan a colarse en un regenerado futuro.
    const stmts = sentencias(upSql);
    expect(stmts).toHaveLength(1);
    expect(stmts[0]).toMatch(/^CREATE INDEX /);
  });

  it("NO crea tablas, columnas, constraints ni valores de enum", () => {
    expect(upStmts).not.toMatch(/CREATE TABLE/i);
    expect(upStmts).not.toMatch(/ADD COLUMN/i);
    expect(upStmts).not.toMatch(/DROP COLUMN/i);
    expect(upStmts).not.toMatch(/ADD CONSTRAINT/i);
    expect(upStmts).not.toMatch(/ALTER TYPE/i);
  });

  it("sin tablas nuevas no hay RLS que declarar, y no se deshabilita ninguna", () => {
    expect(upStmts).not.toMatch(/ROW LEVEL SECURITY/i);
    expect(downStmts).not.toMatch(/ROW LEVEL SECURITY/i);
  });

  it("no usa CONCURRENTLY (Prisma corre cada migracion dentro de una transaccion)", () => {
    expect(upStmts).not.toMatch(/CONCURRENTLY/i);
  });
});

describe("DOWN — revierte EXACTAMENTE lo del UP", () => {
  it(`elimina ${INDICE} de forma idempotente`, () => {
    expect(downStmts).toMatch(new RegExp(`DROP INDEX IF EXISTS "${INDICE}"`));
  });

  it("el DOWN no toca nada mas que ese indice", () => {
    const stmts = sentencias(downSql);
    expect(stmts).toHaveLength(1);
    expect(stmts[0]).toMatch(/^DROP INDEX IF EXISTS /);
  });

  it("hay un DROP por cada CREATE del UP", () => {
    const creados = (upStmts.match(/CREATE INDEX/g) ?? []).length;
    const borrados = (downStmts.match(/DROP INDEX/g) ?? []).length;
    expect(creados).toBe(1);
    expect(borrados).toBe(creados);
  });
});

describe("carpeta y schema.prisma", () => {
  it("la carpeta contiene migration.sql y down.sql", () => {
    expect(fs.existsSync(path.join(migrationDir, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(migrationDir, "down.sql"))).toBe(true);
  });

  it("su timestamp es POSTERIOR al de la ultima migracion que existia al escribirla", () => {
    // BASELINE PINNEADO (2026-07-31), mismo razonamiento que
    // `orden-indices-filtros-migracion.test.ts`: el invariante es HISTORICO. Cuando esta
    // migracion se escribio, la carpeta mas reciente del arbol era `20260731130000_*` (el
    // estado `recolectando` de la 157). Comparar contra el arbol VIVO daria falsos rojos con
    // cada migracion posterior, que son posteriores POR DEFINICION.
    const esta = path
      .basename(migrationDir)
      .slice(0, 14);
    expect(esta > "20260731130000").toBe(true);
    // Y la carpeta debe seguir siendo EXACTAMENTE la que se aplico: renombrar una migracion
    // ya aplicada descuadra el registro de `_prisma_migrations`.
    expect(esta).toBe("20260731140000");
  });

  it("schema.prisma y SQL no divergen: el @@index esta declarado con su map explicito", () => {
    const modelo = schema.slice(schema.indexOf("model OrdenHistorialEstado {"));
    const cuerpo = modelo.slice(0, modelo.indexOf(`@@map("${TABLA}")`));
    expect(cuerpo).toMatch(
      new RegExp(
        `@@index\\(\\[actorUsuarioId,\\s*origenTipo,\\s*createdAt\\],\\s*map:\\s*"${INDICE}"\\)`,
      ),
    );
  });

  it("los dos indices previos del modelo siguen declarados (esta migracion no los sustituye)", () => {
    const modelo = schema.slice(schema.indexOf("model OrdenHistorialEstado {"));
    const cuerpo = modelo.slice(0, modelo.indexOf(`@@map("${TABLA}")`));
    expect(cuerpo).toMatch(/@@index\(\[ordenId, createdAt\]\)/);
    expect(cuerpo).toMatch(/@@index\(\[ordenId, estatusDestinoId\]\)/);
  });
});
