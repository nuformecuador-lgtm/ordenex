import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 135 — cobertura de la migracion NUEVA
// `*_order_status_rename_nomenclatura`. Igual que
// `rename-order-status-migration.test.ts`/`metodo-pago-rename-*`: lee
// migration.sql/down.sql por regex (R2 UP, R3 DOWN). ADEMAS, para R4, PARSEA los
// UPDATE y los aplica a un catalogo en memoria + filas de orden/historial que
// referencian order_status.id, verificando que el id se preserva, que orden/historial
// NO se reescriben y que los conteos quedan estables (la reversion es un round-trip
// exacto). Los literales viejos que aparecen aqui son parte de la traza UP/DOWN por
// diseno (allowlist del guard de censo R13).

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

const migrationDir = migrationDirFor("_order_status_rename_nomenclatura");
const upSql = fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8");

function stripComments(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

// Mapeo canonico del gate (antiguo -> nuevo), 6 renames.
const RENAMES: Array<[string, string]> = [
  ["en_reparto", "en_ruta"],
  ["en_espera_aceptacion", "por_recoger"],
  ["en_bodega", "en_bodega_central"],
  ["en_ruta_bodega_principal", "en_ruta_bodega_central"],
  ["devuelta_origen", "devolviendo_a_tienda"],
  ["recibido_origen", "devuelta_a_tienda"],
];

// Parsea `UPDATE "order_status" SET "value" = '<a>' WHERE "value" = '<b>';` -> [b, a]
// (par WHERE-antiguo -> SET-nuevo, i.e. lo que la sentencia transforma).
function parseUpdates(sql: string): Array<{ from: string; to: string }> {
  const re =
    /UPDATE\s+"order_status"\s+SET\s+"value"\s*=\s*'([^']+)'\s+WHERE\s+"value"\s*=\s*'([^']+)'\s*;/g;
  return [...stripComments(sql).matchAll(re)].map((m) => ({ from: m[2], to: m[1] }));
}

describe("UP — 6 UPDATE del rename (R2)", () => {
  it("R2: hace los 6 UPDATE antiguo -> nuevo del mapeo del gate", () => {
    for (const [from, to] of RENAMES) {
      const re = new RegExp(
        `UPDATE\\s+"order_status"\\s+SET\\s+"value"\\s*=\\s*'${to}'\\s+WHERE\\s+"value"\\s*=\\s*'${from}';`,
      );
      expect(upSql).toMatch(re);
    }
  });

  it("R2: son exactamente 6 UPDATE, sin ALTER TYPE / recrear tabla / tocar id", () => {
    const stmts = parseUpdates(upSql);
    expect(stmts).toHaveLength(6);
    expect(stripComments(upSql)).not.toMatch(/ALTER TYPE/i);
    expect(stripComments(upSql)).not.toMatch(/CREATE TABLE/i);
    expect(stripComments(upSql)).not.toMatch(/DROP TABLE/i);
    expect(stripComments(upSql)).not.toMatch(/"id"/);
  });

  it("R11: el WHERE por igualdad EXACTA no menciona los vecinos satelite", () => {
    // en_bodega (exacto) NO debe expresarse como LIKE ni tocar en_bodega_satelite.
    expect(upSql).not.toMatch(/LIKE/i);
    expect(upSql).not.toMatch(/WHERE "value" = 'en_bodega_satelite'/);
    expect(upSql).not.toMatch(/WHERE "value" = 'en_ruta_bodega_satelite'/);
  });
});

describe("DOWN — inverso exacto (R3)", () => {
  it("R3: hace los 6 UPDATE inversos nuevo -> antiguo", () => {
    for (const [from, to] of RENAMES) {
      const re = new RegExp(
        `UPDATE\\s+"order_status"\\s+SET\\s+"value"\\s*=\\s*'${from}'\\s+WHERE\\s+"value"\\s*=\\s*'${to}';`,
      );
      expect(downSql).toMatch(re);
    }
  });

  it("R3: el DOWN es simetrico al UP (6 UPDATE, sin recrear tabla)", () => {
    const stmts = parseUpdates(downSql);
    expect(stmts).toHaveLength(6);
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
      { id: "os-1", value: "en_reparto" },
      { id: "os-2", value: "en_espera_aceptacion" },
      { id: "os-3", value: "en_bodega" },
      { id: "os-4", value: "en_ruta_bodega_principal" },
      { id: "os-5", value: "devuelta_origen" },
      { id: "os-6", value: "recibido_origen" },
      // vecinos que el WHERE exacto NO debe tocar (R11):
      { id: "os-7", value: "en_bodega_satelite" },
      { id: "os-8", value: "en_ruta_bodega_satelite" },
      { id: "os-9", value: "entregada" },
    ];
  }

  it("tras el UP, cada fila renombrada conserva su id y toma el nuevo value", () => {
    const catalog = seedCatalog();
    applyUpdates(catalog, parseUpdates(upSql));

    const byId = new Map(catalog.map((r) => [r.id, r.value]));
    expect(byId.get("os-1")).toBe("en_ruta");
    expect(byId.get("os-2")).toBe("por_recoger");
    expect(byId.get("os-3")).toBe("en_bodega_central");
    expect(byId.get("os-4")).toBe("en_ruta_bodega_central");
    expect(byId.get("os-5")).toBe("devolviendo_a_tienda");
    expect(byId.get("os-6")).toBe("devuelta_a_tienda");
    // R11: vecinos intactos.
    expect(byId.get("os-7")).toBe("en_bodega_satelite");
    expect(byId.get("os-8")).toBe("en_ruta_bodega_satelite");
    expect(byId.get("os-9")).toBe("entregada");
    // conteo estable (no crea/borra filas).
    expect(catalog).toHaveLength(9);
  });

  it("las FKs orden.estatus_id / historial.*_id (por id) no cambian y sus conteos son estables", () => {
    const catalog = seedCatalog();
    // orden e historial referencian order_status por id (no por value):
    const ordenes = [
      { id: "o1", estatusId: "os-3" }, // en_bodega -> en_bodega_central
      { id: "o2", estatusId: "os-1" }, // en_reparto -> en_ruta
    ];
    const historial = [
      { id: "h1", estatusOrigenId: "os-1", estatusDestinoId: "os-3" },
      { id: "h2", estatusOrigenId: "os-5", estatusDestinoId: "os-6" },
    ];
    const ordenesAntes = JSON.parse(JSON.stringify(ordenes));
    const historialAntes = JSON.parse(JSON.stringify(historial));

    applyUpdates(catalog, parseUpdates(upSql));

    // Ninguna FK (por id) se toca; los conteos son estables.
    expect(ordenes).toEqual(ordenesAntes);
    expect(historial).toEqual(historialAntes);
    expect(ordenes).toHaveLength(2);
    expect(historial).toHaveLength(2);
    // ...y siguen "leyendose" con el nuevo value via el catalogo:
    const value = (id: string) => catalog.find((r) => r.id === id)?.value;
    expect(value(ordenes[0].estatusId)).toBe("en_bodega_central");
    expect(value(ordenes[1].estatusId)).toBe("en_ruta");
  });

  it("R3: UP seguido de DOWN es un round-trip exacto (mismos id, mismos value historicos)", () => {
    const catalog = seedCatalog();
    const antes = JSON.parse(JSON.stringify(catalog));

    applyUpdates(catalog, parseUpdates(upSql));
    applyUpdates(catalog, parseUpdates(downSql));

    expect(catalog).toEqual(antes);
  });
});

describe("estructura de la carpeta de migracion", () => {
  it("contiene migration.sql y down.sql, con timestamp posterior a la migracion del seed completo", () => {
    expect(fs.existsSync(path.join(migrationDir, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(migrationDir, "down.sql"))).toBe(true);
    const dirName = path.basename(migrationDir);
    const seedDir = fs
      .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .find((name) => name.endsWith("_seed_order_status_completo"));
    expect(seedDir).toBeDefined();
    expect(dirName > (seedDir as string)).toBe(true);
  });
});
