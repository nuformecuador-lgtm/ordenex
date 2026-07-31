import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 141 (R1-R14) — cobertura ESTATICA de la migracion `*_carga_orden_carga_id`
// (patron `orden-prioridad-migration` / `zonas-migration`): lee migration.sql, down.sql y
// schema.prisma y los verifica por regex. NO requiere Postgres real. Cubre:
//   R1/R2/R6/R7 — tabla `carga` con sus columnas y la FK a `usuario`.
//   R3          — sin `batch_url` ni `status` (D2/D3).
//   R4/R5       — `orden.carga_id` y `orden.download_url` NULLABLE, con indice y FK RESTRICT.
//   R8/R9/R10   — `name` nullable y unicidad POR USUARIO (los NULL conviven).
//   R11         — sin backfill (ningun UPDATE sobre `orden`).
//   R12         — RLS habilitada en `carga`, sin policies.
//   R13         — down.sql revierte EXACTAMENTE lo que crea el UP.
//   R14         — `num_guia` intacto (ni el UP ni el DOWN lo mencionan).
// NOTA: la migracion se modifico EN SITIO (gate F1.4-10) para meter `name` y su indice en
// este mismo par de archivos, dando por hecho que no estaba aplicada en ninguna base. NO era
// cierto: produccion ya la habia aplicado en su version previa (2026-07-27 14:53Z, cuando
// preview y produccion compartian base) y Prisma no reejecuta lo ya registrado, asi que la
// columna nunca llego alli. Lo cierra `*_carga_name_reparacion`, cubierta al final del fichero.

const ROOT = path.join(__dirname, "..", "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");

function migrationDirFor(suffix: string): string {
  const dir = fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .find((name) => name.endsWith(suffix));
  if (!dir) throw new Error(`No se encontro la carpeta de migracion ${suffix}`);
  return path.join(MIGRATIONS_DIR, dir);
}

const migrationDir = migrationDirFor("_carga_orden_carga_id");
const upSql = fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8");
const schema = fs.readFileSync(path.join(ROOT, "db", "schema.prisma"), "utf8");

/**
 * SQL sin comentarios `--`: las aserciones NEGATIVAS (no hay batch_url, no hay status, no
 * hay backfill, no se toca num_guia) miran lo que la migracion EJECUTA, no lo que documenta
 * en prosa (los comentarios citan esos nombres justamente para explicar por que no estan).
 */
function sinComentarios(sql: string): string {
  return sql
    .split("\n")
    .filter((linea) => !linea.trimStart().startsWith("--"))
    .join("\n");
}

const upEjecutable = sinComentarios(upSql);
const downEjecutable = sinComentarios(downSql);

describe("Feature 141 · UP — tabla `carga` (R1/R2/R6/R7/R8/R9)", () => {
  it("R1: crea la tabla en SINGULAR con id, fecha_carga, download_url y total_files", () => {
    expect(upSql).toMatch(/CREATE TABLE "carga" \(/);
    expect(upSql).toMatch(/"id"\s+TEXT NOT NULL/);
    expect(upSql).toMatch(/"fecha_carga"\s+TIMESTAMP\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/);
    expect(upSql).toMatch(/CONSTRAINT "carga_pkey" PRIMARY KEY \("id"\)/);
    // La tabla es `carga`, nunca `cargas` (convencion del repo: orden, usuario...).
    expect(upEjecutable).not.toMatch(/CREATE TABLE "cargas"/);
  });

  it("R2: usuario_carga es NOT NULL con FK a usuario(id) ON DELETE RESTRICT", () => {
    expect(upSql).toMatch(/"usuario_carga"\s+TEXT NOT NULL/);
    expect(upSql).toMatch(
      /CONSTRAINT "carga_usuario_carga_fkey" FOREIGN KEY \("usuario_carga"\)[\s\S]*REFERENCES "usuario"\("id"\) ON DELETE RESTRICT/,
    );
  });

  it("R8: `name` es TEXT NULLABLE (dato opcional del usuario)", () => {
    expect(upSql).toMatch(/"name"\s+TEXT,/);
    expect(upSql).not.toMatch(/"name"\s+TEXT NOT NULL/);
  });

  it("R9: crea el indice UNICO COMPUESTO (usuario_carga, name), no uno global sobre name", () => {
    expect(upSql).toMatch(
      /CREATE UNIQUE INDEX "carga_usuario_carga_name_key" ON "carga"\("usuario_carga", "name"\)/,
    );
    // R10: unicidad POR USUARIO; nunca un unico global sobre `name` solo.
    expect(upEjecutable).not.toMatch(/CREATE UNIQUE INDEX "[a-z_]+" ON "carga"\("name"\)/);
    // Tampoco un indice unico PARCIAL (design §1.1: no aporta y complica el DOWN).
    expect(upEjecutable).not.toMatch(/carga_usuario_carga_name_key[\s\S]*WHERE/);
  });

  it("R6: download_url es TEXT NULLABLE (nace sin valor)", () => {
    expect(upSql).toMatch(/"download_url"\s+TEXT,/);
    expect(upSql).not.toMatch(/"download_url"\s+TEXT NOT NULL/);
  });

  it("R7: total_files es INTEGER NOT NULL (tamano TOTAL del lote)", () => {
    expect(upSql).toMatch(/"total_files"\s+INTEGER NOT NULL DEFAULT 0/);
  });

  it("crea los indices de consulta natural (usuario_carga, fecha_carga)", () => {
    expect(upSql).toMatch(/CREATE INDEX "carga_usuario_carga_idx" ON "carga"\("usuario_carga"\)/);
    expect(upSql).toMatch(/CREATE INDEX "carga_fecha_carga_idx"\s+ON "carga"\("fecha_carga"\)/);
  });

  it("R3: NO define batch_url, ni status, ni un enum nuevo de estado de carga", () => {
    expect(upEjecutable).not.toMatch(/batch_url/i);
    expect(upEjecutable).not.toMatch(/status/i);
    expect(upEjecutable).not.toMatch(/CREATE TYPE/i);
  });

  it("R12: habilita RLS en `carga` y NO define ninguna policy", () => {
    expect(upSql).toMatch(/ALTER TABLE "carga" ENABLE ROW LEVEL SECURITY/);
    expect(upEjecutable).not.toMatch(/CREATE POLICY/i);
    expect(upEjecutable).not.toMatch(/DISABLE ROW LEVEL SECURITY/i);
  });
});

describe("Feature 141 · UP — columnas nuevas de `orden` (R4/R5/R11/R14)", () => {
  it("R4: agrega carga_id TEXT NULLABLE con indice y FK a carga(id) ON DELETE RESTRICT", () => {
    expect(upSql).toMatch(/ALTER TABLE "orden" ADD COLUMN "carga_id" TEXT;/);
    expect(upSql).not.toMatch(/ADD COLUMN "carga_id" TEXT NOT NULL/);
    expect(upSql).toMatch(/CREATE INDEX "orden_carga_id_idx" ON "orden"\("carga_id"\)/);
    expect(upSql).toMatch(
      /ADD CONSTRAINT "orden_carga_id_fkey" FOREIGN KEY \("carga_id"\)[\s\S]*REFERENCES "carga"\("id"\) ON DELETE RESTRICT/,
    );
  });

  it("R5: agrega download_url TEXT NULLABLE a `orden`", () => {
    expect(upSql).toMatch(/ALTER TABLE "orden" ADD COLUMN "download_url" TEXT;/);
    expect(upSql).not.toMatch(/ADD COLUMN "download_url" TEXT NOT NULL/);
  });

  it("R11: sin backfill — ningun UPDATE ni INSERT sobre las ordenes existentes", () => {
    expect(upEjecutable).not.toMatch(/UPDATE\s+"?orden"?/i);
    expect(upEjecutable).not.toMatch(/INSERT\s+INTO/i);
  });

  it("R14: no toca num_guia (columna, secuencia, indice ni funcion)", () => {
    expect(upEjecutable).not.toMatch(/num_guia/i);
    expect(downEjecutable).not.toMatch(/num_guia/i);
  });
});

describe("Feature 141 · DOWN — revierte exactamente (R13)", () => {
  it("suelta la FK, el indice y las dos columnas de `orden`, y despues la tabla `carga`", () => {
    expect(downSql).toMatch(/ALTER TABLE "orden" DROP CONSTRAINT IF EXISTS "orden_carga_id_fkey"/);
    expect(downSql).toMatch(/DROP INDEX IF EXISTS "orden_carga_id_idx"/);
    expect(downSql).toMatch(/ALTER TABLE "orden" DROP COLUMN IF EXISTS "download_url"/);
    expect(downSql).toMatch(/ALTER TABLE "orden" DROP COLUMN IF EXISTS "carga_id"/);
    expect(downSql).toMatch(/DROP TABLE IF EXISTS "carga"/);
  });

  it("el DOWN suelta la tabla DESPUES de las columnas que la referencian (orden correcto)", () => {
    expect(downSql.indexOf('DROP COLUMN IF EXISTS "carga_id"')).toBeLessThan(
      downSql.indexOf('DROP TABLE IF EXISTS "carga"'),
    );
  });

  it("R13: el DROP TABLE arrastra el indice unico compuesto (no hace falta soltarlo aparte)", () => {
    expect(downEjecutable).toMatch(/DROP TABLE IF EXISTS "carga"/);
    // No se suelta el indice por separado: moriria con la tabla; y no debe quedar huerfano
    // ningun DROP INDEX de `carga` que fallara si la tabla ya no existe.
    expect(downEjecutable).not.toMatch(/DROP INDEX IF EXISTS "carga_/);
  });

  it("el DOWN no toca ninguna otra columna de `orden` ni RLS de otras tablas", () => {
    const dropped = [...downSql.matchAll(/DROP COLUMN IF EXISTS "([a-z_]+)"/g)].map((m) => m[1]);
    expect(dropped.sort()).toEqual(["carga_id", "download_url"]);
    expect(downEjecutable).not.toMatch(/ROW LEVEL SECURITY/i);
  });

  it("la carpeta contiene migration.sql y down.sql, con timestamp posterior a la que la precede", () => {
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

describe("Feature 141 · schema.prisma refleja la migracion (sin drift) (R1-R9)", () => {
  const bloqueCarga = schema.match(/model Carga \{([\s\S]*?)\n\}/)?.[1] ?? "";
  const bloqueOrden = schema.match(/model Orden \{([\s\S]*?)\n\}/)?.[1] ?? "";

  it("el modelo Carga mapea a la tabla `carga` y declara sus campos", () => {
    expect(bloqueCarga).not.toBe("");
    expect(bloqueCarga).toMatch(/@@map\("carga"\)/);
    expect(bloqueCarga).toMatch(/fechaCarga\s+DateTime\s+@default\(now\(\)\)\s+@map\("fecha_carga"\)/);
    expect(bloqueCarga).toMatch(/usuarioCarga\s+String\s+@map\("usuario_carga"\)/);
    expect(bloqueCarga).toMatch(/downloadUrl\s+String\?\s+@map\("download_url"\)/);
    expect(bloqueCarga).toMatch(/totalFiles\s+Int\s+@default\(0\)\s+@map\("total_files"\)/);
    expect(bloqueCarga).toMatch(/usuario Usuario @relation\("CargaUsuario"[\s\S]*onDelete: Restrict\)/);
  });

  it("R8/R9: el modelo Carga declara `name String?` y el @@unique([usuarioCarga, name])", () => {
    expect(bloqueCarga).toMatch(/name\s+String\?/);
    expect(bloqueCarga).toMatch(/@@unique\(\[usuarioCarga, name\]\)/);
    // Nunca `@unique` a secas sobre el campo (seria unicidad GLOBAL, alternativa E descartada).
    expect(bloqueCarga).not.toMatch(/name\s+String\?\s+@unique/);
  });

  it("R3: el modelo Carga NO declara status ni batchUrl", () => {
    expect(bloqueCarga).not.toMatch(/status/i);
    expect(bloqueCarga).not.toMatch(/batchUrl|batch_url/i);
  });

  it("R4/R5: el modelo Orden declara cargaId/downloadUrl nullable, la relacion y el indice", () => {
    expect(bloqueOrden).toMatch(/cargaId\s+String\?\s+@map\("carga_id"\)/);
    expect(bloqueOrden).toMatch(/downloadUrl\s+String\?\s+@map\("download_url"\)/);
    expect(bloqueOrden).toMatch(
      /carga\s+Carga\?\s+@relation\("OrdenCarga", fields: \[cargaId\], references: \[id\], onDelete: Restrict\)/,
    );
    expect(bloqueOrden).toMatch(/@@index\(\[cargaId\]\)/);
  });

  it("R2: Usuario expone el lado inverso de la relacion (cargasRealizadas)", () => {
    const bloqueUsuario = schema.match(/model Usuario \{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(bloqueUsuario).toMatch(/cargasRealizadas\s+Carga\[\]\s+@relation\("CargaUsuario"\)/);
  });
});

// La reparacion que alcanza a la base que aplico la version PREVIA de la 141 (sin `name`).
// Su valor entero esta en ser idempotente: la misma migracion tiene que ser no-op en una
// base creada desde cero y correctiva en la que se quedo corta. Un `ADD COLUMN` pelado aqui
// tumbaria el build de cualquier entorno sano.
describe("Reparacion · `*_carga_name_reparacion` es idempotente", () => {
  const reparacionDir = migrationDirFor("_carga_name_reparacion");
  const reparacionUp = fs.readFileSync(path.join(reparacionDir, "migration.sql"), "utf8");
  const reparacionDown = fs.readFileSync(path.join(reparacionDir, "down.sql"), "utf8");
  const reparacionUpEjecutable = sinComentarios(reparacionUp);

  it("corre DESPUES de la 141 (si corriera antes, la tabla aun no existiria)", () => {
    expect(path.basename(reparacionDir) > path.basename(migrationDir)).toBe(true);
  });

  it("R8: anade `name` con IF NOT EXISTS y sin NOT NULL", () => {
    expect(reparacionUpEjecutable).toMatch(
      /ALTER TABLE "carga" ADD COLUMN IF NOT EXISTS "name" TEXT;/,
    );
    expect(reparacionUpEjecutable).not.toMatch(/"name" TEXT NOT NULL/);
  });

  it("R9/R10: recrea el unico compuesto (usuario_carga, name) con IF NOT EXISTS", () => {
    expect(reparacionUpEjecutable).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS "carga_usuario_carga_name_key" ON "carga"\("usuario_carga", "name"\)/,
    );
  });

  it("no destruye nada: ni DROP, ni backfill, ni cambios en otras tablas", () => {
    expect(reparacionUpEjecutable).not.toMatch(/DROP/i);
    expect(reparacionUpEjecutable).not.toMatch(/UPDATE\s+"?carga"?/i);
    expect(reparacionUpEjecutable).not.toMatch(/ALTER TABLE "orden"/);
  });

  it("el DOWN es un no-op: no puede saber si la columna vino de aqui o de la 141", () => {
    expect(sinComentarios(reparacionDown).trim()).toBe("");
  });
});
