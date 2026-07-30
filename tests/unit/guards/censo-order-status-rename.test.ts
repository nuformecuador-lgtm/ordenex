import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

import { ORDER_STATUS_SEED } from "@/lib/types/order-status";

// Feature 135 (R13) — GUARD de censo case-sensitive de los 6 values ANTIGUOS de
// order_status renombrados por esta feature. Recorre el arbol de fuentes y tests
// (app/, lib/, components/, hooks/, scripts/, tests/, e2e/) y falla si ALGUN archivo
// conserva un value viejo. Es la red que impide que la nomenclatura antigua reaparezca
// en constantes, sets, uniones-literal, datos de test o comentarios.
//
// Los literales antiguos SOLO pueden sobrevivir en:
//   - db/migrations/** (historicas) y el down.sql de esta feature: NO se escanean aqui
//     (db/ no esta en SCAN_DIRS).
//   - los tests de migracion que AFIRMAN esos literales HISTORICOS o la traza UP/DOWN
//     del rename (allowlist de abajo), por R10 (historicas) y R2/R3 (rename).
//   - este mismo archivo, que contiene los patrones de busqueda.
//
// CUIDADO case-sensitive: `en_bodega` se censa por igualdad EXACTA (word boundary),
// sin marcar `en_bodega_satelite`, `en_ruta_bodega_satelite` ni el nuevo
// `en_bodega_central` (R11).
//
// Feature 153 (R15/R16/R17) — SWAP, no duplicado. La 153 REVIERTE uno de los 6 renames de
// la 135: el value vigente vuelve a ser `en_reparto` y el prohibido pasa a ser `en_ruta`.
// Por eso `OLD_VALUES` sigue teniendo 6 entradas: sale `en_reparto`, entra `en_ruta`. Los
// otros cinco values antiguos de la 135 no cambian. `\ben_ruta\b` NO marca a los vecinos
// `en_ruta_bodega_central` / `en_ruta_bodega_satelite`, que siguen vigentes y NO se
// renombraron (`_` es caracter de palabra: no hay frontera tras `en_ruta`).
// La 153 agrega ademas un censo de la ETIQUETA antigua (`"En ruta"` entre comillas, R17),
// que atrapa fixtures que usan el label como si fuera un value y que el censo de values
// no ve; tampoco marca las etiquetas compuestas ("En ruta a bodega central"/"... satelite").
//
// Feature 155 (R33) — se EXTIENDE este guard (no se duplica) con un SEPTIMO value: el estado
// interno de fulfillment en bodega, RETIRADO del catalogo por esa feature (primera baja de la
// historia de `ORDER_STATUS_SEED`). No es un rename como los 6 anteriores: no tiene sucesor.
// Las ordenes que ya estan en bodega nacen ahora en `en_preparacion`, y el backfill de la
// migracion mueve alli las que quedaran vivas.
//
// Detalle que evita un falso positivo (verificado, no supuesto): los nombres de carpeta de
// migracion que terminan en `_en_fulfillment` NO disparan `\ben_fulfillment\b`, porque el
// caracter previo es `_` (caracter de palabra) y por tanto no hay frontera. Por eso los tests
// que solo citan esas RUTAS no necesitan entrada en la allowlist; el caso 155/R33 de abajo lo
// comprueba contra las carpetas reales de `db/migrations`, no de palabra.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const SCAN_DIRS = ["app", "lib", "components", "hooks", "scripts", "tests", "e2e"];
const SCAN_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".sql", ".css", ".json"]);

// 7 values retirados del catalogo (regex case-sensitive, word boundary). El word boundary
// evita falsos positivos: `\ben_bodega\b` no matchea `en_bodega_satelite`/`en_bodega_central`.
const OLD_VALUES: Array<{ label: string; re: RegExp }> = [
  { label: "en_ruta", re: /\ben_ruta\b/ }, // feature 153: sustituye a `en_reparto`, hoy vigente
  { label: "en_espera_aceptacion", re: /\ben_espera_aceptacion\b/ },
  { label: "en_ruta_bodega_principal", re: /\ben_ruta_bodega_principal\b/ },
  { label: "en_bodega", re: /\ben_bodega\b/ },
  { label: "devuelta_origen", re: /\bdevuelta_origen\b/ },
  { label: "recibido_origen", re: /\brecibido_origen\b/ },
  { label: "en_fulfillment", re: /\ben_fulfillment\b/ }, // feature 155/R33: RETIRADO, sin sucesor
];

// Archivos que legitimamente conservan literales antiguos (allowlist, por basename).
// Cada entrada dice POR QUE ese archivo conserva el literal; si el motivo desaparece, la
// entrada se retira (una allowlist sin justificacion es un agujero, no una excepcion).
const ALLOWLIST = new Set([
  "censo-order-status-rename.test.ts", // este guard (contiene los patrones)
  // R10 + 155/R33: afirma los 8 literales HISTORICOS del enum `order_status`, que incluyen
  // el value retirado por la 155. Es la foto del enum ANTES de los ADD VALUE posteriores:
  // se declara fija a proposito (no se deriva del seed vigente), asi que no puede seguir al
  // catalogo cuando este pierde un value.
  "order-status-enum-migration.test.ts",
  "gestion-orden-migration.test.ts", // R10: afirma el ADD VALUE historico 'en_reparto'
  "cierre-detail-migration.test.ts", // R10: referencia el nombre de carpeta historica *_recibido_origen
  "zonas-migration.test.ts", // R10: referencia el nombre de carpeta historica *_recibido_origen
  "orden-num-guia-deferred.test.ts", // R10: afirma el ADD VALUE/INSERT historico 'en_espera_aceptacion'
  "order-status-rename-nomenclatura-migration.test.ts", // R2/R3: traza UP/DOWN del rename de la 135 (contiene `en_ruta`)
  "order-status-en-reparto-migration.test.ts", // 153/R2/R3: traza UP/DOWN del rename en_ruta -> en_reparto
  // 155/R33: cobertura estatica de la migracion historica de la feature 28, que renombro el
  // value PREDECESOR al que la 155 retira. Afirma por regex el UPDATE del UP y el inverso del
  // DOWN, y ambos nombran el literal. Es una migracion ya aplicada: su texto es inmutable, asi
  // que el literal no se puede limpiar de aqui sin dejar de verificar esa migracion. (El otro
  // guard de nomenclatura, el del value predecesor, vigila que ESE no reaparezca.)
  "rename-order-status-migration.test.ts",
  // Feature 149 + 155: la tabla CERRADA de normalizacion `NORMALIZACION_DESTINO` mapea el
  // origen LEIDO DEL HISTORIAL al destino de la reversion, y sus claves son `string`, no
  // `OrderStatusValue`. El value retirado por la 155 sigue apareciendo en filas de
  // `orden_historial_estado` anteriores a esa feature -- es la razon por la que el `DELETE`
  // condicional de su migracion quedo NO-OP y la fila del catalogo sobrevivio huerfana. Una
  // orden asignada ANTES de la 155 que hoy siga en `por_recoger` tiene ese origen en su
  // historial: quitar la entrada la haria fallar CERRADO al deshacer. El literal se queda
  // porque el HISTORIAL es inmutable y sobrevive al catalogo.
  "DeshacerAsignacionService.ts",
  "deshacer-asignacion-service.test.ts", // cubre esa misma fila de la tabla cerrada (origen historico)
]);

// Feature 153 (R17) — censo de la ETIQUETA antigua. Se busca el literal EXACTO entre
// comillas dobles para no marcar las etiquetas compuestas, que siguen vigentes:
// "En ruta a bodega central" y "En ruta a bodega satelite" no cierran comilla tras "ruta".
const OLD_LABEL_RE = /"En ruta"/;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      out.push(...walk(full));
    } else if (SCAN_EXTS.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

describe("R13 — invariante de censo: ningun value antiguo de order_status fuera de la allowlist", () => {
  it("no hay coincidencias case-sensitive de los 7 values retirados en app/, lib/, components/, hooks/, scripts/, tests/, e2e/", () => {
    const offenders: string[] = [];
    for (const rel of SCAN_DIRS) {
      const base = path.join(REPO_ROOT, rel);
      if (!fs.existsSync(base)) continue;
      for (const file of walk(base)) {
        if (ALLOWLIST.has(path.basename(file))) continue;
        const content = fs.readFileSync(file, "utf8");
        const hits = OLD_VALUES.filter((v) => v.re.test(content)).map((v) => v.label);
        if (hits.length > 0) {
          offenders.push(`${path.relative(REPO_ROOT, file)} -> ${hits.join(", ")}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("el censo de en_bodega es por igualdad EXACTA (no marca los vecinos satelite ni el nuevo central)", () => {
    const enBodega = OLD_VALUES.find((v) => v.label === "en_bodega")!.re;
    expect(enBodega.test("en_bodega_satelite")).toBe(false);
    expect(enBodega.test("en_ruta_bodega_satelite")).toBe(false);
    expect(enBodega.test("en_bodega_central")).toBe(false);
    expect(enBodega.test('estatus = "en_bodega"')).toBe(true);
  });

  // Feature 153 (R5/R15/R16): espejo del caso de en_bodega para el value que la 153 prohibe.
  it("el censo de en_ruta es por igualdad EXACTA (no marca en_ruta_bodega_central ni en_ruta_bodega_satelite)", () => {
    const enRuta = OLD_VALUES.find((v) => v.label === "en_ruta")!.re;
    expect(enRuta.test("en_ruta_bodega_central")).toBe(false);
    expect(enRuta.test("en_ruta_bodega_satelite")).toBe(false);
    expect(enRuta.test('estatus = "en_ruta"')).toBe(true);
  });

  // Feature 155 (R33): la 153 hizo un SWAP (6 entradas antes y despues); la 155 es la primera
  // AMPLIACION del censo, asi que el conteo pasa de 6 a 7. Se sigue afirmando la lista
  // completa y en orden para que una entrada no se cuele ni desaparezca sin revisar.
  it("OLD_VALUES tiene 7 entradas: los 6 renames previos mas el value RETIRADO por la 155", () => {
    const labels = OLD_VALUES.map((v) => v.label);
    expect(labels).toHaveLength(7);
    expect(labels).toContain("en_ruta"); // swap de la 153
    expect(labels).not.toContain("en_reparto"); // vigente: es el sucesor
    expect(labels).toEqual([
      "en_ruta",
      "en_espera_aceptacion",
      "en_ruta_bodega_principal",
      "en_bodega",
      "devuelta_origen",
      "recibido_origen",
      "en_fulfillment",
    ]);
  });

  // Feature 155 (R33): el value retirado NO tiene sucesor, asi que el censo debe ser
  // compatible con los values VIGENTES y con los nombres de carpeta de migracion que lo
  // citan. Espejo de los dos casos de igualdad exacta de arriba.
  it("155/R33: el censo del value retirado NO marca a `en_preparacion` ni a ningun nombre de carpeta de migracion", () => {
    const retirado = OLD_VALUES.find((v) => v.label === "en_fulfillment")!.re;
    // Su sucesor de facto (donde nacen y donde caen por backfill las ordenes) no se marca.
    expect(retirado.test("en_preparacion")).toBe(false);
    // Las carpetas REALES de migraciones: el value siempre va tras `_` (caracter de palabra),
    // asi que no hay frontera y ninguna se marca. Se lee del disco para que el dia que alguien
    // cree una carpeta con otra forma, este caso lo diga.
    const carpetas = fs
      .readdirSync(path.join(REPO_ROOT, "db", "migrations"), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    expect(carpetas.filter((n) => retirado.test(n))).toEqual([]);
    // Y la comprobacion no es vacua: hay carpetas que SI nombran el value.
    expect(carpetas.filter((n) => n.endsWith("_en_fulfillment")).length).toBeGreaterThan(1);
    // Pero el value escrito como value SI se marca.
    expect(retirado.test('estatus = "en_fulfillment"')).toBe(true);
  });

  // Feature 155 (R33): el retiro es de verdad, no solo de nomenclatura. El censo vigila el
  // literal; este caso vigila que el catalogo del build no lo reintroduzca por otra puerta.
  it("155/R33: los values del censo son DISJUNTOS del catalogo vigente", () => {
    const vigentes = new Set<string>(ORDER_STATUS_SEED);
    for (const { label } of OLD_VALUES) {
      expect(vigentes.has(label)).toBe(false);
    }
  });
});

// Feature 153 (R17) — censo de la etiqueta antigua "En ruta". Va aparte del censo de values
// porque atrapa un caso que aquel no ve: fixtures que pasan la ETIQUETA donde va un `value`
// (p.ej. `estatusValue: "En ruta"`).
describe("153/R17 — invariante de censo: la etiqueta antigua “En ruta” no sobrevive en el arbol", () => {
  it("no hay ninguna aparicion del literal exacto en app/, lib/, components/, hooks/, scripts/, tests/, e2e/", () => {
    const offenders: string[] = [];
    for (const rel of SCAN_DIRS) {
      const base = path.join(REPO_ROOT, rel);
      if (!fs.existsSync(base)) continue;
      for (const file of walk(base)) {
        if (ALLOWLIST.has(path.basename(file))) continue;
        if (OLD_LABEL_RE.test(fs.readFileSync(file, "utf8"))) {
          offenders.push(path.relative(REPO_ROOT, file));
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("el censo de la etiqueta NO marca las etiquetas compuestas, que siguen vigentes", () => {
    expect(OLD_LABEL_RE.test('"En ruta a bodega central"')).toBe(false);
    expect(OLD_LABEL_RE.test('"En ruta a bodega satélite"')).toBe(false);
    expect(OLD_LABEL_RE.test('"En ruta a bodega <zona>"')).toBe(false);
    expect(OLD_LABEL_RE.test('label: "En ruta"')).toBe(true);
    expect(OLD_LABEL_RE.test('"En reparto"')).toBe(false);
  });
});
