import fs from "fs";
import path from "path";

import { describe, expect, it } from "vitest";

import {
  BUCKET_POR_ESTATUS,
  ESTATUS_CON_BUCKET_EXPLICITO,
  bucketDeEstatus,
} from "@/lib/types/tablero-dia";
import { ORDER_STATUS_SEED } from "@/lib/types/order-status";

// Feature 192 (B6.2) — R46. GUARDIA del segundo eje.
//
// `order_status` se ha movido SIETE veces (renames de la 135 y la 153, apendices de la
// 139/154, retiro de la 155). Cada uno de esos movimientos, aplicado a esta feature sin
// que nadie se entere, RECLASIFICA ordenes en la pantalla del maestro sin cambiar una
// linea de esta feature. R46 exige que eso salga ROJO, no en silencio.
//
// Dos frentes:
//   1. INVENTARIO CONGELADO del catalogo (19 values, en orden). Un value nuevo, renombrado
//      o retirado lo deja rojo. Es la unica forma de que "gana, pierde o renombra un value"
//      se note: el mapa tiene default `otros`, asi que por si solo absorberia un value
//      nuevo sin quejarse.
//   2. CENSO de declaracion unica: la clasificacion estatus -> bucket vive SOLO en
//      `lib/types/tablero-dia.ts`. Una segunda tabla que divergiera daria dos cifras
//      distintas para la misma orden segun quien la contara.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const SCAN_DIRS = ["app", "lib", "components", "hooks", "scripts", "tests", "e2e"];
const SCAN_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

/**
 * El catalogo tal y como se aprobo esta feature (2026-08-08). NO se deriva de
 * `ORDER_STATUS_SEED`: es la foto contra la que se compara.
 */
const CATALOGO_CONGELADO = [
  "entregada",
  "devuelta",
  "devolviendo_a_tienda",
  "reprogramada",
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
  "por_recolectar_en_tienda",
  "incidente",
  "recolectando",
  // 2026-08-19 (feature 239/T1.8): 20 -> 21 values. El pre-estado de la devolucion entra como
  // APENDICE y NO gana bucket explicito (cae en `otros`, ver `buckets-estatus.test.ts`). Esta
  // foto se actualiza a mano A PROPOSITO: es lo unico que delata un value nuevo, porque el mapa
  // tiene default y lo absorberia en silencio.
  "devolucion_por_confirmar",
] as const;

// Archivos que legitimamente nombran a la vez un bucket y un estatus de la clasificacion.
// Cada entrada dice POR QUE; una allowlist sin justificacion es un agujero, no una
// excepcion.
const ALLOWLIST = new Set([
  "tablero-dia.ts", // la UNICA declaracion (lib/types/tablero-dia.ts)
  "buckets-estatus.test.ts", // afirma la tabla aprobada por el humano (R43-R45)
  "buckets-estatus.guardia.test.ts", // este guardia: contiene los patrones de busqueda
]);

const BUCKETS_RE = /["'](sinRecoger|enReparto)["']/;
const ESTATUS_RE = /["'](por_recoger|recolectando|en_reparto)["']/;

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

describe("R46 — todo value del catalogo tiene bucket asignado", () => {
  it.each(ORDER_STATUS_SEED)("`%s` resuelve a uno de los tres buckets", (value) => {
    expect(["sinRecoger", "enReparto", "otros"]).toContain(bucketDeEstatus(value));
  });

  it("ningun value del catalogo se queda sin clasificar", () => {
    const buckets = new Set<string>(["sinRecoger", "enReparto", "otros"]);
    const sinBucket = ORDER_STATUS_SEED.filter((value) => !buckets.has(bucketDeEstatus(value)));
    expect(sinBucket).toEqual([]);
  });

  it("los values con bucket explicito son un subconjunto REAL del catalogo vigente", () => {
    for (const value of ESTATUS_CON_BUCKET_EXPLICITO) {
      expect(ORDER_STATUS_SEED as readonly string[]).toContain(value);
    }
    expect([...ESTATUS_CON_BUCKET_EXPLICITO].sort()).toEqual(
      Object.keys(BUCKET_POR_ESTATUS).sort(),
    );
  });
});

describe("R46 — el catalogo esta congelado: ganar, perder o renombrar un value deja esto rojo", () => {
  it("`ORDER_STATUS_SEED` es exactamente la foto del 2026-08-08, en el mismo orden", () => {
    expect([...ORDER_STATUS_SEED]).toEqual([...CATALOGO_CONGELADO]);
  });

  // OJO: el spec habla de "19 values sembrados" (design.md §1.bis y el encabezado de
  // `order-status.ts`, escrito cuando la 155 dejo el catalogo en 19). El catalogo REAL
  // tiene 20: la 157 sumo `recolectando` despues de aquel retiro. Se congela el numero
  // REAL, medido contra el seed, no el del texto.
  it("el catalogo tiene 21 values (los 19 tras el retiro de la 155 + `recolectando` de la 157 + `devolucion_por_confirmar` de la 239)", () => {
    expect(ORDER_STATUS_SEED).toHaveLength(21); // 2026-08-19 (239)
    expect(CATALOGO_CONGELADO).toHaveLength(21); // 2026-08-19 (239): +devolucion_por_confirmar
  });

  it("las claves del mapa siguen existiendo en el catalogo (un rename las dejaria huerfanas)", () => {
    for (const clave of Object.keys(BUCKET_POR_ESTATUS)) {
      expect(ORDER_STATUS_SEED as readonly string[]).toContain(clave);
    }
  });
});

describe("R46 — censo: la clasificacion estatus -> bucket se declara en un solo archivo", () => {
  it("ningun otro archivo del arbol declara buckets junto a values de estatus", () => {
    const offenders: string[] = [];

    for (const rel of SCAN_DIRS) {
      const base = path.join(REPO_ROOT, rel);
      if (!fs.existsSync(base)) continue;
      for (const file of walk(base)) {
        if (ALLOWLIST.has(path.basename(file))) continue;
        const contenido = fs.readFileSync(file, "utf8");
        if (BUCKETS_RE.test(contenido) && ESTATUS_RE.test(contenido)) {
          offenders.push(path.relative(REPO_ROOT, file));
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("el censo no es vacuo: reconoce una segunda tabla paralela si alguien la escribe", () => {
    const tablaParalela = `const MAPA = { "por_recoger": "sinRecoger" };`;
    expect(BUCKETS_RE.test(tablaParalela) && ESTATUS_RE.test(tablaParalela)).toBe(true);
  });

  it("el censo no marca el SQL del repositorio, que recibe las listas como parametros", () => {
    // El alias `AS en_reparto` y el campo `enReparto:` del mapeo de filas NO van entre
    // comillas, asi que no disparan el censo. Es deliberado: el SQL no puede llevar la
    // clasificacion escrita a mano (design.md §5, nota 3.bis), pero si sus alias.
    const sql = "COUNT(*) FILTER (WHERE a.estatus = ANY($3)) AS en_reparto";
    const mapeo = "enReparto: Number(row.en_reparto),";
    expect(BUCKETS_RE.test(sql) || ESTATUS_RE.test(sql)).toBe(false);
    expect(BUCKETS_RE.test(mapeo) || ESTATUS_RE.test(mapeo)).toBe(false);
  });

  it("la unica declaracion vive en `lib/types/tablero-dia.ts`", () => {
    const declaracion = fs.readFileSync(
      path.join(REPO_ROOT, "lib", "types", "tablero-dia.ts"),
      "utf8",
    );
    expect(declaracion).toContain("BUCKET_POR_ESTATUS");
    expect(BUCKETS_RE.test(declaracion)).toBe(true);
  });
});
