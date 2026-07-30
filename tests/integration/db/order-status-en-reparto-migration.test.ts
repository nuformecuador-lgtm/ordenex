import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 153 — cobertura de la migracion NUEVA `*_order_status_en_reparto`.
// Clon de `order-status-rename-nomenclatura-migration.test.ts` (feature 135): lee
// migration.sql/down.sql por regex (R2 UP, R3 DOWN) y, para R4, PARSEA los UPDATE y los
// aplica a un catalogo en memoria + filas de orden/historial que referencian
// order_status.id, verificando que el id se preserva, que orden/historial NO se reescriben
// y que los conteos quedan estables (la reversion es un round-trip exacto).
//
// El literal `en_ruta` aparece aqui por DISENO: es el value ANTIGUO que la traza UP/DOWN
// tiene que nombrar. Por eso este archivo esta en la ALLOWLIST del guard de censo
// (tests/unit/guards/censo-order-status-rename.test.ts, R16).

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

const migrationDir = migrationDirFor("_order_status_en_reparto");
const upSql = fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8");

function stripComments(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

// Mapeo canonico del gate: UN solo rename (antiguo -> nuevo).
const VALUE_ANTIGUO = "en_ruta";
const VALUE_NUEVO = "en_reparto";

// Parsea `UPDATE "order_status" SET "value" = '<a>' WHERE "value" = '<b>';` -> [b, a]
// (par WHERE-antiguo -> SET-nuevo, i.e. lo que la sentencia transforma).
function parseUpdates(sql: string): Array<{ from: string; to: string }> {
  const re =
    /UPDATE\s+"order_status"\s+SET\s+"value"\s*=\s*'([^']+)'\s+WHERE\s+"value"\s*=\s*'([^']+)'\s*;/g;
  return [...stripComments(sql).matchAll(re)].map((m) => ({ from: m[2], to: m[1] }));
}

describe("UP — UN unico UPDATE del rename (153/R2)", () => {
  it("R2: hace el UPDATE antiguo -> nuevo del mapeo del gate", () => {
    const re = new RegExp(
      `UPDATE\\s+"order_status"\\s+SET\\s+"value"\\s*=\\s*'${VALUE_NUEVO}'\\s+WHERE\\s+"value"\\s*=\\s*'${VALUE_ANTIGUO}';`,
    );
    expect(upSql).toMatch(re);
  });

  it("R2: es exactamente 1 UPDATE, sin ALTER TYPE / recrear tabla / tocar id", () => {
    const stmts = parseUpdates(upSql);
    expect(stmts).toHaveLength(1);
    expect(stmts[0]).toEqual({ from: VALUE_ANTIGUO, to: VALUE_NUEVO });
    expect(stripComments(upSql)).not.toMatch(/ALTER TYPE/i);
    expect(stripComments(upSql)).not.toMatch(/CREATE TABLE/i);
    expect(stripComments(upSql)).not.toMatch(/DROP TABLE/i);
    expect(stripComments(upSql)).not.toMatch(/"id"/);
  });

  it("R2: es idempotente — reaplicado sobre un catalogo ya migrado no cambia nada", () => {
    const catalog: CatalogRow[] = [
      { id: "os-1", value: VALUE_NUEVO },
      { id: "os-2", value: "entregada" },
    ];
    const antes = structuredClone(catalog);
    applyUpdates(catalog, parseUpdates(upSql));
    expect(catalog).toEqual(antes);
  });

  it("R5: el WHERE por igualdad EXACTA no menciona los vecinos en_ruta_bodega_*", () => {
    expect(stripComments(upSql)).not.toMatch(/LIKE/i);
    expect(stripComments(upSql)).not.toMatch(/'en_ruta_bodega_central'/);
    expect(stripComments(upSql)).not.toMatch(/'en_ruta_bodega_satelite'/);
    // El unico value citado en un WHERE es el antiguo, exacto.
    expect(parseUpdates(upSql).map((s) => s.from)).toEqual([VALUE_ANTIGUO]);
  });
});

describe("DOWN — inverso exacto (153/R3)", () => {
  it("R3: hace el UPDATE inverso nuevo -> antiguo", () => {
    const re = new RegExp(
      `UPDATE\\s+"order_status"\\s+SET\\s+"value"\\s*=\\s*'${VALUE_ANTIGUO}'\\s+WHERE\\s+"value"\\s*=\\s*'${VALUE_NUEVO}';`,
    );
    expect(downSql).toMatch(re);
  });

  it("R3: el DOWN es simetrico al UP (1 UPDATE, sin recrear tabla)", () => {
    const stmts = parseUpdates(downSql);
    expect(stmts).toHaveLength(1);
    expect(stmts[0]).toEqual({ from: VALUE_NUEVO, to: VALUE_ANTIGUO });
    expect(stripComments(downSql)).not.toMatch(/ALTER TYPE/i);
    expect(stripComments(downSql)).not.toMatch(/CREATE TABLE/i);
    expect(stripComments(downSql)).not.toMatch(/DROP TABLE/i);
  });
});

// R4: aplica el SQL parseado a un modelo en memoria del catalogo + FKs por id.
interface CatalogRow {
  id: string;
  value: string;
}
function applyUpdates(catalog: CatalogRow[], updates: Array<{ from: string; to: string }>) {
  for (const { from, to } of updates) {
    for (const row of catalog) {
      if (row.value === from) row.value = to; // UPDATE conserva el id de la fila
    }
  }
}

describe("R4 — integridad de FKs por id (UPDATE de catalogo, sin reescritura)", () => {
  function seedCatalog(): CatalogRow[] {
    return [
      { id: "os-1", value: VALUE_ANTIGUO },
      // vecinos que el WHERE exacto NO debe tocar (R5):
      { id: "os-2", value: "en_ruta_bodega_central" },
      { id: "os-3", value: "en_ruta_bodega_satelite" },
      { id: "os-4", value: "en_bodega_central" },
      { id: "os-5", value: "en_bodega_satelite" },
      { id: "os-6", value: "por_recoger" },
      { id: "os-7", value: "entregada" },
      { id: "os-8", value: "sin_gestionar" },
    ];
  }

  it("tras el UP, la fila renombrada conserva su id y toma el nuevo value", () => {
    const catalog = seedCatalog();
    applyUpdates(catalog, parseUpdates(upSql));

    const byId = new Map(catalog.map((r) => [r.id, r.value]));
    expect(byId.get("os-1")).toBe(VALUE_NUEVO);
    // R5: vecinos intactos (value Y posicion).
    expect(byId.get("os-2")).toBe("en_ruta_bodega_central");
    expect(byId.get("os-3")).toBe("en_ruta_bodega_satelite");
    expect(byId.get("os-4")).toBe("en_bodega_central");
    expect(byId.get("os-5")).toBe("en_bodega_satelite");
    expect(byId.get("os-6")).toBe("por_recoger");
    expect(byId.get("os-7")).toBe("entregada");
    expect(byId.get("os-8")).toBe("sin_gestionar");
    // conteo estable (no crea/borra filas).
    expect(catalog).toHaveLength(8);
    // y `value` sigue siendo UNIQUE tras el rename (no colisiona con ninguna otra fila).
    expect(new Set(catalog.map((r) => r.value)).size).toBe(catalog.length);
  });

  it("las FKs orden.estatus_id / historial.*_id (por id) no cambian y sus conteos son estables", () => {
    const catalog = seedCatalog();
    // orden e historial referencian order_status por id (no por value):
    const ordenes = [
      { id: "o1", estatusId: "os-1" }, // en_ruta -> en_reparto
      { id: "o2", estatusId: "os-3" }, // vecino intacto
    ];
    const historial = [
      { id: "h1", estatusOrigenId: "os-6", estatusDestinoId: "os-1" }, // #11 por_recoger -> en_reparto
      { id: "h2", estatusOrigenId: "os-1", estatusDestinoId: "os-7" }, // #12 en_reparto -> entregada
      { id: "h3", estatusOrigenId: "os-1", estatusDestinoId: "os-8" }, // #16 en_reparto -> sin_gestionar
    ];
    const ordenesAntes = structuredClone(ordenes);
    const historialAntes = structuredClone(historial);

    applyUpdates(catalog, parseUpdates(upSql));

    // Ninguna FK (por id) se toca; los conteos son estables.
    expect(ordenes).toEqual(ordenesAntes);
    expect(historial).toEqual(historialAntes);
    expect(ordenes).toHaveLength(2);
    expect(historial).toHaveLength(3);
    // ...y siguen "leyendose" con el nuevo value via el catalogo:
    const value = (id: string) => catalog.find((r) => r.id === id)?.value;
    expect(value(ordenes[0].estatusId)).toBe(VALUE_NUEVO);
    expect(value(ordenes[1].estatusId)).toBe("en_ruta_bodega_satelite");
    expect(value(historial[0].estatusDestinoId)).toBe(VALUE_NUEVO);
    expect(value(historial[1].estatusOrigenId)).toBe(VALUE_NUEVO);
  });

  it("R3: UP seguido de DOWN es un round-trip exacto (mismos id, mismos value historicos)", () => {
    const catalog = seedCatalog();
    const antes = structuredClone(catalog);

    applyUpdates(catalog, parseUpdates(upSql));
    applyUpdates(catalog, parseUpdates(downSql));

    expect(catalog).toEqual(antes);
    expect(catalog).toHaveLength(8);
  });
});

describe("R18 — migracion NUEVA, historicas inmutables", () => {
  it("contiene migration.sql y down.sql y su timestamp ordena DESPUES del rename de la 135", () => {
    expect(fs.existsSync(path.join(migrationDir, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(migrationDir, "down.sql"))).toBe(true);
    const dirName = path.basename(migrationDir);
    const renameDir = path.basename(migrationDirFor("_order_status_rename_nomenclatura"));
    expect(dirName > renameDir).toBe(true);
    // y despues de la ultima migracion existente AL CREARLA. Las carpetas apendidas por
    // features POSTERIORES se descuentan (patron de denylist de `zonas-migration.test.ts`):
    // el invariante es que la 153 no nacio ANTES de lo que ya existia, no que sea la ultima
    // carpeta del repo para siempre.
    const previas = fs
      .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      // feature 154 (catalogo de estados v2): las dos apendidas despues.
      // features 155 (retiro del value de fulfillment) y 149 (origen_tipo
      // deshacer_asignacion): ambas apendidas despues.
      .filter(
        (d) =>
          !d.endsWith("_order_status_v2_por_recolectar_incidente") &&
          !d.endsWith("_orden_historial_origen_recoleccion_tienda_incidente") &&
          !d.endsWith("_order_status_retiro_en_fulfillment") &&
          !d.endsWith("_orden_historial_origen_deshacer_asignacion") &&
          // feature 152 (hotfix de WhatsApp, portado el 2026-07-29): apendida despues.
          !d.endsWith("_chat_mensaje_error_meta"),
      )
      .sort();
    expect(previas[previas.length - 1]).toBe(dirName);
  });

  it("la migracion de la 135 sigue intacta: conserva sus 6 UPDATE originales", () => {
    const renameDir = migrationDirFor("_order_status_rename_nomenclatura");
    const renameUp = fs.readFileSync(path.join(renameDir, "migration.sql"), "utf8");
    const renameDown = fs.readFileSync(path.join(renameDir, "down.sql"), "utf8");
    expect(parseUpdates(renameUp)).toHaveLength(6);
    expect(parseUpdates(renameDown)).toHaveLength(6);
    // El UP de la 135 sigue diciendo en_reparto -> en_ruta (no se reescribio, R18).
    expect(parseUpdates(renameUp)).toContainEqual({ from: "en_reparto", to: "en_ruta" });
    expect(parseUpdates(renameDown)).toContainEqual({ from: "en_ruta", to: "en_reparto" });
  });
});
