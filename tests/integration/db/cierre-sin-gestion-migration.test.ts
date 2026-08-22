import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Feature 264 (B2) — cobertura ESTATICA de la migracion `*_cierre_sin_gestion`.
 *
 * Patron `cierre-detail-migration.test.ts`: lee `migration.sql` / `down.sql` y los afirma por
 * regex. El round-trip REAL (up -> down -> up contra Postgres) lo ejecuta el implementer y su
 * salida vive en `progress/impl_264_backend.md`; lo que este archivo protege es que el SQL
 * escrito a mano no se desvie del diseño en las cuatro cosas que, si se desvian, no rompen nada
 * hasta que alguien audita un cierre:
 *
 *   1. **R10** — que la tabla siga SIN una sola columna de dinero. La garantia de que esta lista
 *      no puede mover un total no es disciplina de la capa de arriba: es que no hay nada que
 *      sumar. Si aparece un `DECIMAL` aqui, la garantia se evapora en silencio.
 *   2. **R25/R26** — que el backfill siga acotado a los cierres ABIERTOS. Ampliarlo a `aprobado`
 *      no daria error: produciria vinculos INVENTADOS (la aprobacion ya borro el unico dato del
 *      que derivarlos) y una pantalla de auditoria que afirma cosas falsas con total aplomo.
 *   3. **R27/R29** — que la marca por cierre siga existiendo y siga bajando a `false` fuera de
 *      esos tres estados. Sin ella, «no lo sabemos» se pinta igual que «no hubo ninguna».
 *   4. **R23/R24** — RLS habilitada y el DOWN que revierte de verdad las DOS cosas que el UP
 *      crea (la tabla Y la columna).
 */

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

const migrationDir = migrationDirFor("_cierre_sin_gestion");
const upSql = fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8");

/**
 * Las aserciones de AUSENCIA tienen que correr sobre el SQL EJECUTABLE, no sobre la prosa: los
 * comentarios de esta migracion EXPLICAN justamente lo que no esta («ni `DECIMAL`, ni `monto`…»,
 * «no se inventa ningun vinculo para los `aprobado`»), y buscarlo en el texto crudo daria un
 * falso positivo en cada uno de ellos.
 */
function sinComentarios(sql: string): string {
  return sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");
}

const upExec = sinComentarios(upSql);
const downExec = sinComentarios(downSql);

/** Solo el bloque `CREATE TABLE "cierre_sin_gestion" ( … );`, ya sin comentarios. */
function bloqueCreateTable(): string {
  const desde = upExec.indexOf('CREATE TABLE "cierre_sin_gestion"');
  expect(desde).toBeGreaterThanOrEqual(0);
  const hasta = upExec.indexOf(");", desde);
  expect(hasta).toBeGreaterThan(desde);
  return upExec.slice(desde, hasta + 2);
}

describe("UP — tabla cierre_sin_gestion (R1)", () => {
  it("R1: crea la tabla con id TEXT NOT NULL + pkey", () => {
    expect(upSql).toMatch(/CREATE TABLE "cierre_sin_gestion"/);
    expect(upSql).toMatch(/"id" TEXT NOT NULL/);
    expect(upSql).toMatch(/CONSTRAINT "cierre_sin_gestion_pkey" PRIMARY KEY \("id"\)/);
  });

  it("R11: congela los SEIS descriptivos, con num_guia nullable y SIN UNIQUE (es copia)", () => {
    expect(upSql).toMatch(/"num_guia" INTEGER,/);
    expect(upSql).toMatch(/"num_remision" TEXT NOT NULL,/);
    expect(upSql).toMatch(/"destinatario" TEXT NOT NULL,/);
    expect(upSql).toMatch(/"producto" TEXT NOT NULL,/);
    expect(upSql).toMatch(/"tienda_nombre" TEXT NOT NULL,/);
    expect(upSql).toMatch(/"zona_nombre" TEXT NOT NULL,/);
    // Una orden puede no tener guia: un UNIQUE aqui, ademas, romperia la orden barrida dos veces
    // en dos cierres distintos, que es justo el caso que motiva el grano (cierre, orden).
    expect(bloqueCreateTable()).not.toMatch(/"num_guia"[^,]*UNIQUE/i);
  });

  it("R4/R32: `estatus_origen_id` es NULLABLE — «no consta» es un valor legitimo", () => {
    // NOT NULL obligaria a INVENTARSE un origen para las filas del backfill cuyo historial no lo
    // tenga, que es exactamente lo que R33 prohibe.
    expect(upSql).toMatch(/"estatus_origen_id" TEXT,/);
    expect(bloqueCreateTable()).not.toMatch(/"estatus_origen_id" TEXT NOT NULL/);
  });

  it("fila INMUTABLE — sin updated_at ni deleted_at, con created_at por defecto", () => {
    expect(bloqueCreateTable()).not.toMatch(/"updated_at"/);
    expect(bloqueCreateTable()).not.toMatch(/"deleted_at"/);
    expect(upSql).toMatch(/"created_at" TIMESTAMP\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/);
  });

  it("el GRANO — UNIQUE (cierre_id, orden_id)", () => {
    expect(upSql).toMatch(
      /CREATE UNIQUE INDEX "cierre_sin_gestion_cierre_id_orden_id_key" ON "cierre_sin_gestion"\("cierre_id", "orden_id"\);/,
    );
  });

  it("crea el indice por orden_id (trazar en que cierres se barrio una orden)", () => {
    expect(upSql).toMatch(
      /CREATE INDEX "cierre_sin_gestion_orden_id_idx" ON "cierre_sin_gestion"\("orden_id"\);/,
    );
  });

  it("crea las 3 FKs, todas ON DELETE RESTRICT ON UPDATE CASCADE", () => {
    const fks = [
      ["cierre_id", "cierre_dia"],
      ["orden_id", "orden"],
      ["estatus_origen_id", "order_status"],
    ] as const;
    for (const [col, tabla] of fks) {
      expect(upSql).toMatch(
        new RegExp(
          `ADD CONSTRAINT "cierre_sin_gestion_${col}_fkey"\\s*\\n?\\s*FOREIGN KEY \\("${col}"\\) REFERENCES "${tabla}"\\("id"\\) ON DELETE RESTRICT ON UPDATE CASCADE;`,
        ),
      );
    }
    expect(upSql.match(/ADD CONSTRAINT "cierre_sin_gestion_\w+_fkey"/g)).toHaveLength(3);
    // Ni un SET NULL: convertiria un origen REAL en un «no consta» sin dejar rastro, sobre una
    // fila que el diseño declara inmutable.
    expect(upExec).not.toMatch(/ON DELETE SET NULL/i);
  });

  it("R23: habilita RLS SIN policies (solo service role)", () => {
    expect(upSql).toMatch(/ALTER TABLE "cierre_sin_gestion" ENABLE ROW LEVEL SECURITY;/);
    expect(upExec).not.toMatch(/CREATE POLICY/i);
  });
});

describe("UP — R10: la tabla NO puede tocar dinero", () => {
  // ⭑ ESTE ES EL CASO QUE MATA LA MUTACION M7 (añadir `monto_cobrar DECIMAL(12,2)`).
  // No es una comprobacion de estilo: R19/R20/R22 dicen que estas ordenes no mueven ni un total,
  // y la unica forma de que eso sea IMPOSIBLE en vez de VIGILADO es que no haya donde guardar un
  // importe. Un `DECIMAL` aqui no rompe ningun test de arriba: rompe la garantia.
  const VOCABULARIO_DE_DINERO = [
    "monto",
    "pago",
    "cobro",
    "cobrar",
    "ingreso",
    "tarifa",
    "comision",
    "flete",
    "indemnizacion",
    "recaudo",
    "total",
  ];

  it("R10: ni un DECIMAL en el CREATE TABLE", () => {
    expect(bloqueCreateTable()).not.toMatch(/DECIMAL/i);
    expect(bloqueCreateTable()).not.toMatch(/NUMERIC/i);
    expect(bloqueCreateTable()).not.toMatch(/MONEY/i);
  });

  it("R10: ninguna columna del CREATE TABLE lleva un nombre del vocabulario de dinero", () => {
    const bloque = bloqueCreateTable().toLowerCase();
    const encontradas = VOCABULARIO_DE_DINERO.filter((v) => bloque.includes(v));
    expect(encontradas).toEqual([]);
  });

  it("R10: tampoco hay resultado de gestion ni evidencia (no hay gestion que describir)", () => {
    const bloque = bloqueCreateTable().toLowerCase();
    for (const v of ["resultado", "evidencia", "metodo_pago", "gestion_id"]) {
      expect(bloque).not.toContain(v);
    }
  });
});

describe("UP — la MARCA por cierre (R27/R29)", () => {
  it("R27: añade `sin_gestion_registrado` BOOLEAN NOT NULL DEFAULT true", () => {
    expect(upSql).toMatch(
      /ALTER TABLE "cierre_dia"\s*\n?\s*ADD COLUMN "sin_gestion_registrado" BOOLEAN NOT NULL DEFAULT true;/,
    );
  });

  it("R29: el UPDATE baja la marca a `false` FUERA de los tres estados abiertos", () => {
    expect(upSql).toMatch(
      /UPDATE "cierre_dia" SET "sin_gestion_registrado" = false\s*\n?\s*WHERE "estado" NOT IN \('solicitado','vencido','rechazado'\);/,
    );
  });

  it("R29: el UPDATE es lo UNICO que esta migracion escribe sobre `cierre_dia`", () => {
    // Un `SET` que tocara otra columna del cierre —un total, el estado— convertiria una migracion
    // de auditoria en una que mueve dinero. Se afirma sobre el SQL ejecutable.
    const updates = upExec.match(/UPDATE "cierre_dia" SET [^;]+;/g) ?? [];
    expect(updates).toHaveLength(1);
    expect(updates[0]).not.toMatch(/total_|estado"\s*=|"pago|"ingreso/i);
  });
});

describe("UP — backfill de los cierres ABIERTOS (R25/R26/R33)", () => {
  it("R25: es un solo INSERT … SELECT sobre los TRES estados abiertos", () => {
    expect(upSql).toMatch(/INSERT INTO "cierre_sin_gestion"/);
    expect(upSql).toMatch(/SELECT gen_random_uuid\(\)/);
    expect(upSql).toMatch(/WHERE c\.estado IN \('solicitado','vencido','rechazado'\)/);
    expect(upExec.match(/INSERT INTO "cierre_sin_gestion"/g)).toHaveLength(1);
  });

  // ⭑ ESTE ES EL CASO QUE MATA LA MUTACION M6.
  it("R26: el backfill NO menciona `aprobado` — un vinculo que no consta no se inventa", () => {
    // Para un cierre ya resuelto la liberacion (feature 109) borro `mensajero_asignado_id` y
    // cambio el estatus: no queda dato del que derivar la lista. Meterlo en el WHERE no daria
    // error — le colgaria al cierre viejo las ordenes que su mensajero tenga barridas HOY, que
    // son de OTRO cierre. Una pantalla de auditoria afirmando algo falso con aplomo.
    expect(upExec).not.toMatch(/'aprobado'/);
    expect(upExec).not.toMatch(/aprobado/i);
  });

  it("R25: solo entran ordenes VIVAS y en `sin_gestionar`, resuelto por catalogo", () => {
    expect(upSql).toMatch(/o\.deleted_at IS NULL/);
    // Por `order_status.value`, no por un id hardcodeado: los ids son distintos en cada base.
    expect(upSql).toMatch(/JOIN "order_status" s ON s\.id = o\.estatus_id AND s\.value = 'sin_gestionar'/);
    expect(upSql).toMatch(/o\.mensajero_asignado_id = c\.mensajero_id/);
  });

  // ⭑ R33: el LATERAL recupera el origen REAL, y es `LEFT` a proposito.
  it("R33: LEFT JOIN LATERAL sobre el historial, por `corte_sin_gestionar`, el mas reciente", () => {
    expect(upSql).toMatch(/LEFT JOIN LATERAL \(/);
    expect(upSql).toMatch(/FROM "orden_historial_estado" he/);
    expect(upSql).toMatch(/he\.orden_id = o\.id/);
    expect(upSql).toMatch(/he\.origen_tipo = 'corte_sin_gestionar'/);
    expect(upSql).toMatch(/ORDER BY he\.created_at DESC/);
    expect(upSql).toMatch(/LIMIT 1/);
    expect(upSql).toMatch(/\) h ON TRUE/);
  });

  it("R33: es LEFT, no un JOIN — sin fila de historial la orden entra igual con origen NULL", () => {
    // Un `JOIN` a secas perderia esa orden EN SILENCIO. R33 dice «dejarlo vacio unicamente cuando
    // no conste», no «descartar la orden cuando no conste»: son cosas distintas y solo una es
    // honesta. Se afirma que NINGUN `JOIN LATERAL` de esta migracion carece del `LEFT`.
    expect(upExec).not.toMatch(/(?<!LEFT )JOIN LATERAL/);
  });

  it("R25: es idempotente (ON CONFLICT DO NOTHING) — se re-corre tras un rollback", () => {
    expect(upSql).toMatch(/ON CONFLICT \("cierre_id", "orden_id"\) DO NOTHING;/);
  });

  it("el backfill no escribe ni una columna que no exista en la tabla", () => {
    const columnas = /INSERT INTO "cierre_sin_gestion" \(([^)]+)\)/.exec(upExec)?.[1] ?? "";
    expect(columnas.replace(/\s+/g, " ").trim()).toBe(
      "id, cierre_id, orden_id, num_guia, num_remision, destinatario, producto, tienda_nombre, zona_nombre, estatus_origen_id, created_at",
    );
  });

  it("es ADITIVA: no borra nada ni crea enums", () => {
    expect(upExec).not.toMatch(/DROP (TABLE|COLUMN|TYPE)/i);
    expect(upExec).not.toMatch(/CREATE TYPE/i);
    expect(upExec).not.toMatch(/DELETE FROM/i);
    // Ni una linea sobre las tablas de dinero del cierre.
    expect(upExec).not.toMatch(/ALTER TABLE "cierre_detail"/);
    expect(upExec).not.toMatch(/ALTER TABLE "gestion_orden"/);
    expect(upExec).not.toMatch(/"wallet_movimiento"/);
  });
});

describe("DOWN — revierte exactamente el UP (R24)", () => {
  it("R24: DROP TABLE cierre_sin_gestion (arrastra unique, indice, FKs y RLS)", () => {
    expect(downSql).toMatch(/DROP TABLE IF EXISTS "cierre_sin_gestion";/);
  });

  it("R24: suelta TAMBIEN la columna `sin_gestion_registrado` de `cierre_dia`", () => {
    // La mitad que se olvida. Sin este DROP, revertir dejaria en `cierre_dia` una columna que el
    // schema ya no declara: drift permanente y un `migrate dev` proponiendo borrarla para siempre.
    expect(downSql).toMatch(
      /ALTER TABLE "cierre_dia" DROP COLUMN IF EXISTS "sin_gestion_registrado";/,
    );
  });

  it("R24: no toca ningun dato preexistente (la tabla y la columna nacen en el UP)", () => {
    expect(downExec).not.toMatch(/UPDATE /i);
    expect(downExec).not.toMatch(/DELETE FROM/i);
    expect(downExec).not.toMatch(/"orden"|"gestion_orden"|"cierre_detail"/);
    expect(downExec).not.toMatch(/DROP TYPE/i);
  });
});

describe("estructura de la carpeta de migracion", () => {
  it("R24: contiene migration.sql y down.sql", () => {
    expect(fs.existsSync(path.join(migrationDir, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(migrationDir, "down.sql"))).toBe(true);
  });

  it("tiene timestamp posterior a su predecesora real", () => {
    // Afirma que nace DESPUES de la que ya existia, no que sea la ULTIMA del repo para siempre:
    // eso se rompe en cuanto cualquier feature posterior añade una migracion.
    const dirs = fs
      .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    const thisDir = dirs.find((d) => d.endsWith("_cierre_sin_gestion")) as string;
    const previa = dirs.find((d) => d.endsWith("_notificacion_evento_postulacion_recurso"));
    expect(previa).toBeDefined();
    expect(thisDir > (previa as string)).toBe(true);
  });
});
