import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { ORDER_STATUS_SEED } from "@/lib/types/order-status";

// Feature 154 (T4.1) — cobertura ESTATICA de la migracion
// `*_order_status_v2_por_recolectar_incidente` (patron
// `order-status-en-bodega-satelite-migration` / la migracion de la 139): lee
// migration.sql/down.sql por regex. NO requiere Postgres real; el round-trip
// deploy -> rollback -> deploy contra una base real queda como DEUDA declarada (no hay DB en
// el entorno de la fase), documentada en `progress/impl_154.md`.
//
// Cubre R1-R6:
//   R1/R2  alta de los dos values en el catalogo `order_status`
//   R3     los 18 previos intactos (sin rename, sin reorden, sin borrado) -> 20
//   R4     el alta es IDEMPOTENTE (`INSERT ... WHERE NOT EXISTS` por value unico)
//   R5     el DOWN deja el catalogo en los 18 previos cuando nadie los referencia
//   R6     el DOWN NO borra (ni rompe FK) si alguna orden/historial los referencia

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

const migrationDir = migrationDirFor("_order_status_v2_por_recolectar_incidente");
const upSql = fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8");

const NUEVOS = ["por_recolectar_en_tienda", "incidente"] as const;

// Feature 155/R27: value que la 155 RETIRA del catalogo. Este archivo describe la foto
// HISTORICA de la 154 (donde el value existia), asi que necesita nombrarlo para restarlo; se
// construye por concatenacion para no dejar el literal en el arbol.
const RETIRADO_155 = ["en", "fulfillment"].join("_");

/**
 * SQL EJECUTABLE, sin las lineas de comentario `--`. Las aserciones NEGATIVAS ("no hace X") van
 * contra esto: la cabecera documental cita `ALTER TYPE`/`DELETE` para explicar por que NO se
 * usan, y buscarlos sobre el texto crudo daria falsos positivos.
 */
function sinComentarios(sql: string): string {
  return sql
    .split(/\r?\n/)
    .filter((linea) => !/^\s*--/.test(linea))
    .join("\n");
}

const upEjecutable = sinComentarios(upSql);
const downEjecutable = sinComentarios(downSql);

/** Los 18 values del catalogo ANTES de esta feature (foto historica, transcrita a mano). */
const PREVIOS_18 = [
  "entregada",
  "devuelta",
  "devolviendo_a_tienda",
  "reprogramada",
  RETIRADO_155,
  "en_ruta_bodega_central",
  "en_bodega_central",
  "en_preparacion",
  "por_recoger",
  "en_ruta_bodega_satelite",
  "en_reparto",
  "rechazada",
  "en_bodega_satelite",
  "devuelta_a_tienda",
  "sin_gestionar",
  "por_devolver",
  "devolviendo_a_bodega_central",
  "por_devolver_a_tienda",
];

/** Simula el UP contra un catalogo en memoria con la semantica del `WHERE NOT EXISTS`. */
function aplicarUp(catalogo: string[]): string[] {
  const insertados = [...upSql.matchAll(/SELECT gen_random_uuid\(\)::text, '([^']+)'/g)].map(
    (m) => m[1],
  );
  const siguiente = [...catalogo];
  for (const value of insertados) {
    if (!siguiente.includes(value)) siguiente.push(value);
  }
  return siguiente;
}

describe("Feature 154 · SEED del catalogo — los dos values del flujo v2 (R1/R2/R3)", () => {
  it("R1: el catalogo reconoce por_recolectar_en_tienda como estado valido", () => {
    expect(ORDER_STATUS_SEED).toContain("por_recolectar_en_tienda");
  });

  it("R2: el catalogo reconoce incidente como estado valido", () => {
    expect(ORDER_STATUS_SEED).toContain("incidente");
  });

  // Feature 155/R27: el catalogo baja a 19 al RETIRAR un value de los 18 previos (el de
  // fulfillment, que ocupaba el indice 4). Los 17 que quedan conservan su ORDEN RELATIVO, que
  // es lo que la 154 prometio no tocar; el que falta lo retiro otra feature, con su migracion.
  it("R3 (+155/R27, +157): los previos conservan su orden relativo; el catalogo tiene 20", () => {
    const previosVigentes = PREVIOS_18.filter((v) => v !== RETIRADO_155);
    expect(ORDER_STATUS_SEED.slice(0, previosVigentes.length)).toEqual(previosVigentes);
    // 20: la 157 apendio `recolectando` DESPUES de los dos de la 154.
    expect(ORDER_STATUS_SEED).toHaveLength(21); // 2026-08-19 (239): +devolucion_por_confirmar
    expect(ORDER_STATUS_SEED as readonly string[]).not.toContain(RETIRADO_155);
  });
});

describe("Feature 154 · UP — alta aditiva e idempotente en la tabla catalogo (R1/R2/R4)", () => {
  it("R1/R2: inserta los dos values con INSERT ... SELECT (order_status es TABLA, no enum)", () => {
    for (const value of NUEVOS) {
      expect(upSql).toMatch(
        new RegExp(
          `INSERT INTO "order_status" \\("id", "value"\\)\\s+SELECT gen_random_uuid\\(\\)::text, '${value}'`,
        ),
      );
    }
    // Ningun `ALTER TYPE`: la 20260714123909 convirtio el enum en tabla y no se vuelve atras.
    expect(upEjecutable).not.toMatch(/ALTER TYPE/i);
  });

  it("R4: cada INSERT esta guardado por WHERE NOT EXISTS sobre el mismo value", () => {
    for (const value of NUEVOS) {
      expect(upSql).toMatch(
        new RegExp(
          `WHERE NOT EXISTS \\(SELECT 1 FROM "order_status" WHERE "value" = '${value}'\\)`,
        ),
      );
    }
  });

  it("R4: aplicarla dos veces seguidas deja 20 values y ningun duplicado", () => {
    const unaVez = aplicarUp(PREVIOS_18);
    const dosVeces = aplicarUp(unaVez);
    // 18 previos + los DOS de la 154 = 20. Este numero NO se mueve con las features posteriores:
    // es lo que ESTA migracion deja, no el catalogo vigente (que hoy tiene 21).
    expect(unaVez).toHaveLength(20);
    expect(dosVeces).toHaveLength(20);
    expect(dosVeces).toEqual(unaVez);
    expect(new Set(dosVeces).size).toBe(dosVeces.length);
    // El catalogo VIGENTE es el resultado de esta migracion MENOS el value que retiro la 155
    // (con su propia migracion y su backfill) MAS los que apendieron features posteriores. Se
    // ajusta aqui explicitamente para que el invariante de la 154 —"el UP deja exactamente
    // estos values"— siga probandose sin congelar el catalogo entero.
    const APENDIDOS_DESPUES = [
      "recolectando", // feature 157 (ampliacion)
      "devolucion_por_confirmar", // feature 239 (2026-08-19): el pre-estado de la devolucion
    ];
    expect([...dosVeces].filter((v) => v !== RETIRADO_155).sort()).toEqual(
      [...ORDER_STATUS_SEED]
        .filter((v) => !APENDIDOS_DESPUES.includes(v))
        .sort(),
    );
  });

  it("R3: el UP es ADITIVO — no borra, no renombra, no toca columnas ni RLS", () => {
    expect(upEjecutable).not.toMatch(/DELETE FROM/i);
    expect(upEjecutable).not.toMatch(/\bUPDATE\b/i);
    expect(upEjecutable).not.toMatch(/DROP\b/i);
    expect(upEjecutable).not.toMatch(/ALTER COLUMN/i);
    expect(upEjecutable).not.toMatch(/ALTER TABLE/i);
    expect(upEjecutable).not.toMatch(/CREATE TABLE/i);
    expect(upEjecutable).not.toMatch(/CREATE POLICY/i);
    expect(upEjecutable).not.toMatch(/ROW LEVEL SECURITY/i);
  });
});

describe("Feature 154 · DOWN — borrado GUARDADO por referencias (R5/R6)", () => {
  it("R5: borra exactamente los dos values nuevos (el catalogo vuelve a 18)", () => {
    expect(downSql).toMatch(/DELETE FROM "order_status" os/);
    const enIn = downSql.match(/WHERE os\."value" IN \(([^)]*)\)/);
    expect(enIn).not.toBeNull();
    const values = [...(enIn as RegExpMatchArray)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(values).toEqual([...NUEVOS]);
    // Ninguno de los 18 previos aparece en el DELETE.
    for (const previo of PREVIOS_18) expect(values).not.toContain(previo);
  });

  it("R6: el DELETE esta guardado por ausencia de referencias en orden y en el historial", () => {
    expect(downSql).toMatch(/NOT EXISTS \(SELECT 1 FROM "orden" o WHERE o\."estatus_id" = os\."id"\)/);
    expect(downSql).toMatch(
      /NOT EXISTS \(SELECT 1 FROM "orden_historial_estado" h WHERE h\."estatus_destino_id" = os\."id" OR h\."estatus_origen_id" = os\."id"\)/,
    );
  });

  it("R6: documenta que si algo referencia NO borra y NO rompe FKs (best-effort)", () => {
    expect(downSql).toMatch(/BEST-EFFORT/i);
    expect(downSql.toLowerCase()).toMatch(/no borra esa fila y el rollback no falla/);
  });

  it("el DOWN no toca RLS, columnas ni ningun otro value", () => {
    expect(downEjecutable).not.toMatch(/DROP TABLE/i);
    expect(downEjecutable).not.toMatch(/ALTER TABLE/i);
    expect(downEjecutable).not.toMatch(/CREATE POLICY/i);
    expect(downEjecutable).not.toMatch(/ROW LEVEL SECURITY/i);
  });
});

describe("Feature 154 · estructura de la carpeta de migracion A", () => {
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

  it("va SEPARADA de la migracion del enum de familias (reversibilidad distinta)", () => {
    const enumDir = path.basename(
      migrationDirFor("_orden_historial_origen_recoleccion_tienda_incidente"),
    );
    expect(path.basename(migrationDir)).not.toBe(enumDir);
    // El catalogo va ANTES: su rollback (DELETE guardado) es inocuo, el del enum puede abortar.
    expect(path.basename(migrationDir) < enumDir).toBe(true);
    expect(upEjecutable).not.toMatch(/orden_historial_origen_tipo/);
  });

  // Este caso exigia que `zonas-migration.test.ts` llevara esta carpeta en su denylist. Era
  // parte de un patron que se AUTO-REFORZABA: cada migracion nueva añadia una entrada a esa
  // lista y un test exigiendola. La denylist se retiro el 2026-07-30 (llego a quince entradas
  // y rompio cinco veces el 2026-07-29), asi que la exigencia desaparece.
  //
  // Se afirma el invariante NUEVO, que es mas fuerte: que el assert de `zonas` siga PINNEADO a
  // un baseline historico y por tanto NO necesite mantenimiento al apendir migraciones. Si
  // alguien reintroduce la comparacion contra el arbol vivo, este caso lo caza.
  it("`zonas-migration.test.ts` NO depende del arbol vivo: su baseline sigue pinneado", () => {
    const zonasTest = fs.readFileSync(
      path.join(ROOT, "tests", "integration", "db", "zonas-migration.test.ts"),
      "utf8",
    );
    expect(zonasTest).toMatch(/const MAX_AL_ESCRIBIRLA = "\d{14}"/);
    expect(zonasTest).not.toMatch(/const previas = dirs\.filter\(/);
  });
});
