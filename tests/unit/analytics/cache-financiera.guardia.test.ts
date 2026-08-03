import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 128 / T7.1 — GUARDIA DE R15 (D2): EL DINERO NO SE CACHEA.
//
// ⚠ ESTE GUARDIA **SOBREVIVE AL MERGE**. No mide el diff contra `dev`: censa contenido, asi
// que sigue vigente para siempre y no caduca con esta rama.
//
// ─── POR QUE, con nombres y sin cautela abstracta ──────────────────────────────────────────
// La ficha original de la 128 pedia cachear tambien el dominio `financiera` e invalidarlo
// desde la aprobacion de cierres. D2 (humano, 2026-08-03) lo RECHAZO, y este es el motivo
// verificado: los tres ledgers que alimentan la analitica financiera
// —`wallet_movimiento`, `wallet_tienda_movimiento` y `pago_mensajero_movimiento`— los
// escriben, ADEMAS de la aprobacion de cierres, al menos:
//
//   1. `WalletEgresoService`
//   2. `LiquidacionService`
//   3. `GeneracionGastosFijosService`  (cron diario)
//   4. el flujo de indemnizaciones de incidentes
//   5. `aprobarCierre` / `aprobarCierreBodega`
//
// Cachear dinero con SOLO el quinto como invalidador es servir cifras rancias **en silencio**:
// nada se rompe, el numero se queda quieto y no hay senal. Un tablero financiero que miente
// sin avisar es peor que uno lento.
//
// ─── ESTO ES LA FICHA 177, NO UN APENDICE DE LA 128 ────────────────────────────────────────
// Engancharlos es OTRA FEATURE, propuesta en `specs/128-analitica-cache-invalidacion/design.md
// §14`: «analitica: cache financiera + invalidacion por ledger», backend, `depends_on: 128`.
// Cada uno de los cinco escritores necesita su propio test de cinco pasos —consultar, mover
// dinero, comprobar que todavia se sirve el valor viejo, invalidar, comprobar que se sirve el
// nuevo—. Ese PR es el que retira este guardia, y solo ese: retirarlo antes es reintroducir
// justo lo que D2 rechazo.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const EXT = new Set([".ts", ".tsx"]);
const AMBITO = ["lib", "app", "scripts"];

/** El servicio financiero y sus CUATRO repositorios. Ninguno se envuelve con la cache. */
const PIEZAS_FINANCIERAS = [
  "AnaliticaFinancieraService",
  "IngresosAnaliticaRepository",
  "RecaudoAnaliticaRepository",
  "CuentasPorPagarAnaliticaRepository",
  "ConciliacionCierresAnaliticaRepository",
];

/** Las formas de meter algo dentro de la cache de esta feature. */
const DECORA_CON_CACHE = [
  /IAnaliticaCache/,
  /NextAnaliticaCache/,
  /crearAnaliticaCacheDeNext/,
  /decorarRollupConCache/,
  /\.envolver\(/,
  /unstable_cache/,
];

const ESCRITORES_DE_LEDGER =
  "WalletEgresoService, LiquidacionService, GeneracionGastosFijosService (cron diario), el " +
  "flujo de indemnizaciones de incidentes y aprobarCierre / aprobarCierreBodega";

function archivos(dir: string): string[] {
  const abs = path.join(REPO_ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  const salida: string[] = [];
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      salida.push(...archivos(rel));
    } else if (EXT.has(path.extname(e.name))) {
      salida.push(rel);
    }
  }
  return salida;
}

function soloCodigo(fuente: string): string {
  return fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

function esInfractor(codigo: string): boolean {
  const tocaDinero = PIEZAS_FINANCIERAS.some((p) => new RegExp(`\\b${p}\\b`).test(codigo));
  const cachea = DECORA_CON_CACHE.some((p) => p.test(codigo));
  return tocaDinero && cachea;
}

describe("R15 (D2) · ningun archivo envuelve el servicio o los repositorios financieros con la cache", () => {
  it("el dominio `financiera` no se cachea", () => {
    const infractores = AMBITO.flatMap((d) => archivos(d)).filter((rel) =>
      esInfractor(soloCodigo(fs.readFileSync(path.join(REPO_ROOT, rel), "utf8"))),
    );

    expect(
      infractores,
      "D2: el dominio `financiera` NO se cachea mientras no exista invalidacion para los TRES " +
        "ledgers que lo alimentan (wallet_movimiento, wallet_tienda_movimiento y " +
        "pago_mensajero_movimiento). Antes de cachear dinero hay que enganchar a: " +
        `${ESCRITORES_DE_LEDGER}. Cachear con solo la aprobacion de cierres serviria cifras ` +
        "rancias EN SILENCIO. Eso es OTRA FEATURE (design.md §14 de la 128), y es el PR que " +
        "retira este guardia. Archivos infractores: " +
        infractores.join(", "),
    ).toEqual([]);
  });

  it("el censo mira archivos de verdad y las piezas financieras existen", () => {
    expect(archivos("lib").length).toBeGreaterThan(50);
    for (const pieza of PIEZAS_FINANCIERAS) {
      const existe =
        fs.existsSync(path.join(REPO_ROOT, "lib", "services", `${pieza}.ts`)) ||
        fs.existsSync(path.join(REPO_ROOT, "lib", "repositories", `${pieza}.ts`));
      expect(existe, `la pieza financiera ${pieza} ya no existe con ese nombre`).toBe(true);
    }
  });

  it("el censo DISCRIMINA: detectaria el composition root que lo envolviera", () => {
    const infractor = `
      import { AnaliticaFinancieraService } from "@/lib/services/AnaliticaFinancieraService";
      import type { IAnaliticaCache } from "@/lib/interfaces/external/IAnaliticaCache";
      export function construir(cache: IAnaliticaCache) { return cache.envolver("k", [], async () => new AnaliticaFinancieraService()); }
    `;
    expect(esInfractor(soloCodigo(infractor))).toBe(true);

    // Y no marca el borde financiero actual, que nombra el servicio y no lo cachea.
    const bordeActual = soloCodigo(
      fs.readFileSync(path.join(REPO_ROOT, "lib/actions/analitica-financiera.ts"), "utf8"),
    );
    expect(esInfractor(bordeActual)).toBe(false);
  });
});
