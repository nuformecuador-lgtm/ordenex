import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 159 (R1, R2, R3) — cobertura ESTATICA de la migracion
// `*_drop_orden_mensajero_sugerido` (patron `orden-indices-filtros-migracion` /
// `zonas-migration`): lee `migration.sql`, `down.sql` y `schema.prisma` y verifica
// su contenido por regex. NO requiere Postgres real.
//
// ALCANCE HONESTO: esto blinda el TEXTO de los dos archivos —los nombres de objeto,
// el ORDEN de las sentencias y que ninguna toque `mensajero_asignado_id`—, que es lo
// que un editor descuidado puede romper sin que nada se entere. NO demuestra que la
// migracion corra: el round-trip real (`db:migrate` -> `db:rollback` -> `db:migrate`)
// contra una base con valores no nulos sigue SIN ejecutarse (ver
// `progress/impl_159_cierre.md`). R3 se cubre aqui solo en su parte estatica: que la
// migracion no contiene ninguna sentencia que pudiera alterar el mensajero asignado.

const ROOT = path.join(__dirname, "..", "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");
const SUFFIX = "_drop_orden_mensajero_sugerido";

const COLUMNA = "mensajero_sugerido_id";
const INDICE = "orden_mensajero_sugerido_id_idx";
const FK = "orden_mensajero_sugerido_id_fkey";

function migrationDirFor(suffix: string): string {
  const dir = fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .find((name) => name.endsWith(suffix));
  if (!dir) throw new Error(`No se encontro la carpeta de migracion ${suffix}`);
  return path.join(MIGRATIONS_DIR, dir);
}

const migrationDir = migrationDirFor(SUFFIX);
const upSql = fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8");
const schema = fs.readFileSync(path.join(ROOT, "db", "schema.prisma"), "utf8");

/**
 * Sentencias SQL reales de un archivo de migracion: sin lineas de comentario y sin
 * blancos. Se trabaja sobre esto —no sobre el texto crudo— para que la cabecera
 * explicativa no cuente como sentencia ni desordene los asserts de orden.
 */
function sentencias(sql: string): string[] {
  return sql
    .split(/\r?\n/)
    .filter((l) => !/^\s*--/.test(l))
    .join("\n")
    .split(";")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 0);
}

const upStmts = sentencias(upSql);
const downStmts = sentencias(downSql);

describe("UP — retira FK, indice y columna, EN ESE ORDEN (R1)", () => {
  it("son exactamente tres sentencias", () => {
    expect(upStmts).toHaveLength(3);
  });

  it("1ª: elimina la FK, de forma idempotente", () => {
    expect(upStmts[0]).toBe(`ALTER TABLE "orden" DROP CONSTRAINT IF EXISTS "${FK}"`);
  });

  it("2ª: elimina el indice, de forma idempotente", () => {
    expect(upStmts[1]).toBe(`DROP INDEX IF EXISTS "${INDICE}"`);
  });

  it("3ª: elimina la columna, de forma idempotente", () => {
    expect(upStmts[2]).toBe(`ALTER TABLE "orden" DROP COLUMN IF EXISTS "${COLUMNA}"`);
  });

  it("el orden es obligatorio: la columna se dropea DESPUES de lo que depende de ella", () => {
    // Postgres rechaza dropear una columna con FK/indice vivos apuntando a ella si el
    // DROP no es CASCADE. Invertir el orden rompe la migracion en produccion.
    const posColumna = upStmts.findIndex((s) => s.includes("DROP COLUMN"));
    const posIndice = upStmts.findIndex((s) => s.includes("DROP INDEX"));
    const posFk = upStmts.findIndex((s) => s.includes("DROP CONSTRAINT"));
    expect(posFk).toBeLessThan(posIndice);
    expect(posIndice).toBeLessThan(posColumna);
    // Y no se toma el atajo destructivo.
    expect(upSql).not.toMatch(/CASCADE/i);
  });
});

describe("R3 — la migracion no toca dato alguno, ni el mensajero ASIGNADO", () => {
  it("ninguna sentencia menciona `mensajero_asignado_id`", () => {
    // Sobre las SENTENCIAS, no sobre el texto crudo: la cabecera del UP cita esa
    // columna a proposito, para explicar por que la sugerida sobra.
    for (const stmt of [...upStmts, ...downStmts]) {
      expect(stmt).not.toMatch(/mensajero_asignado_id/);
    }
  });

  it("el UP no ejecuta ningun DML (no reescribe filas)", () => {
    // Solo DDL: aplicar sobre una base con valores no nulos no puede cambiar el
    // contenido de ninguna otra columna.
    for (const stmt of upStmts) {
      expect(stmt).not.toMatch(/^(UPDATE|DELETE|INSERT)\b/i);
    }
    expect(upSql).not.toMatch(/\bUPDATE\s+"?orden"?/i);
  });

  it("no crea ni borra tablas, ni toca RLS", () => {
    expect(upSql).not.toMatch(/CREATE TABLE|DROP TABLE/i);
    expect(upSql).not.toMatch(/ROW LEVEL SECURITY/i);
    expect(downSql).not.toMatch(/ROW LEVEL SECURITY/i);
  });
});

describe("DOWN — restituye la ESTRUCTURA en orden inverso (R2)", () => {
  it("son exactamente tres sentencias", () => {
    expect(downStmts).toHaveLength(3);
  });

  it("1ª: repone la columna TEXT nullable con su nombre exacto", () => {
    expect(downStmts[0]).toBe(
      `ALTER TABLE "orden" ADD COLUMN IF NOT EXISTS "${COLUMNA}" TEXT`,
    );
    // Nullable: nunca NOT NULL (las filas existentes no tienen valor que poner).
    expect(downStmts[0]).not.toMatch(/NOT NULL/);
  });

  it("2ª: repone el indice con su nombre exacto", () => {
    expect(downStmts[1]).toBe(
      `CREATE INDEX IF NOT EXISTS "${INDICE}" ON "orden"("${COLUMNA}")`,
    );
  });

  it("3ª: repone la FK hacia `usuario` con ON DELETE SET NULL ON UPDATE CASCADE", () => {
    expect(downStmts[2]).toBe(
      `ALTER TABLE "orden" ADD CONSTRAINT "${FK}" FOREIGN KEY ("${COLUMNA}") ` +
        `REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
    );
  });

  it("el orden del DOWN es el INVERSO del UP", () => {
    const posColumna = downStmts.findIndex((s) => s.includes("ADD COLUMN"));
    const posIndice = downStmts.findIndex((s) => s.includes("CREATE INDEX"));
    const posFk = downStmts.findIndex((s) => s.includes("ADD CONSTRAINT"));
    expect(posColumna).toBeLessThan(posIndice);
    expect(posIndice).toBeLessThan(posFk);
  });

  it("hay una sentencia del DOWN por cada una del UP", () => {
    expect(downStmts).toHaveLength(upStmts.length);
  });

  it("Q5: la cabecera declara que restituye estructura y NO datos", () => {
    // El criterio de honestidad del gate: nadie debe creer que el rollback es
    // completo. Si alguien borra el aviso, este assert lo dice.
    const cabecera = downSql
      .split(/\r?\n/)
      .filter((l) => /^\s*--/.test(l))
      .join("\n");
    expect(cabecera).toMatch(/NO restaura los DATOS/i);
    expect(cabecera).toMatch(/NULL/);
  });
});

describe("carpeta, schema.prisma y registro de la migracion", () => {
  it("la carpeta contiene migration.sql y down.sql", () => {
    expect(fs.existsSync(path.join(migrationDir, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(migrationDir, "down.sql"))).toBe(true);
  });

  it("R4: `schema.prisma` no declara la columna, ni el indice, ni la relacion", () => {
    const modelo = schema.slice(schema.indexOf("model Orden {"));
    const cuerpo = modelo.slice(0, modelo.indexOf('@@map("orden")'));
    expect(cuerpo).not.toMatch(/mensajeroSugerido/);
    expect(cuerpo).not.toMatch(/@@index\(\[mensajeroSugeridoId\]\)/);
    // El lado inverso, en `Usuario`.
    expect(schema).not.toMatch(/ordenesMensajeria/);
    // Lo que SI sigue declarado: el mensajero asignado (R21/fuera de alcance).
    expect(cuerpo).toMatch(/mensajeroAsignadoId/);
  });

  it("la carpeta esta registrada en el invariante de orden de las migraciones previas", () => {
    // Mismo patron que `notificacion-migration.test.ts`: una migracion apendida al
    // final debe excluirse de los tests que verifican "ninguna previa es posterior",
    // o los deja en rojo. Sin este assert, borrar la exclusion pasa inadvertido.
    for (const archivo of ["zonas-migration.test.ts", "notificacion-migration.test.ts"]) {
      const texto = fs.readFileSync(path.join(__dirname, archivo), "utf8");
      expect(texto).toMatch(new RegExp(`!d\\.endsWith\\("${SUFFIX}"\\)`));
    }
  });

  it("su timestamp NO es anterior al de ninguna migracion previa", () => {
    // Se compara el TIMESTAMP (prefijo), no el nombre completo: dentro del mismo
    // lote hay tres carpetas con el mismo timestamp y el orden alfabetico del slug
    // no dice nada del orden de aplicacion.
    const ts = (d: string) => d.slice(0, 14);
    const dirs = fs
      .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    const esta = dirs.find((d) => d.endsWith(SUFFIX))!;

    // BASELINE PINNEADO, y es deliberado. El invariante que importa es HISTORICO: cuando
    // esta migracion se escribio, la carpeta mas reciente del arbol era `20260728120000_*`,
    // asi que no nacio ANTES que ninguna que ya existiera.
    //
    // Compararlo contra el arbol VIVO convierte el assert en una denylist que hay que
    // ampliar cada vez que otra feature apenda una migracion posterior: ya obligo a excluir
    // las DOS de la 154, y volvio a romper con la de la 155 al integrar dev. Esas
    // migraciones son IRRELEVANTES para el invariante -- son posteriores por definicion.
    // Pinneado deja de dar falsos rojos y sigue cazando lo unico que de verdad lo violaria:
    // que alguien RENOMBRE esta carpeta a un timestamp anterior.
    const MAX_AL_ESCRIBIRLA = "20260728120000";
    // `>=`, no `>`: empatar en timestamp con otra carpeta del mismo lote es
    // tolerable (deuda del repo); nacer ANTES que una previa no lo es.
    expect(ts(esta) >= MAX_AL_ESCRIBIRLA).toBe(true);
    // Y la carpeta debe seguir siendo EXACTAMENTE la que se aplico: renombrar una migracion
    // ya aplicada descuadra el registro de `_prisma_migrations`.
    expect(ts(esta)).toBe(MAX_AL_ESCRIBIRLA);
  });
});
