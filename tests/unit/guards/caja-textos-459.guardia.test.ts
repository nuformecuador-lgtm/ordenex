// @vitest-environment jsdom
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { createElement } from "react";

import { CajaResumenCard } from "@/app/(app)/wallet/_components/CajaResumenCard";
import type { CajaResumenDTO } from "@/lib/types/wallet";
import { quitarComentarios } from "@/tests/fixtures/sin-comentarios";

// =================================================================================================
// GUARDIA — FICHA 459 (T A.7, design §3.3 y §12.3) — LOS TEXTOS DE LA CAJA NO MIENTEN
// =================================================================================================
//
// Tres propiedades, cada una con su contraprueba (una guardia que no se ha visto roja no prueba
// nada: en este repo ya pasó una verde con el detector roto).
//
//  1. R24 — el aviso y la pista de la 173 que decían que «De las tiendas» es MÁS que lo que se les
//     debe, y que la cifra principal cuenta el flete, la comisión o el impuesto aparte del
//     contra-entrega, NO existen en ningún archivo de `app/(app)/wallet/**` ni de
//     `app/(app)/analitica/**`. Contraprueba: la fuente de ANTES de esta ficha la pone roja.
//  2. R16 — la tarjeta en estado «flujo» no contiene «Dinero en caja» en ningún texto, pista,
//     aviso ni nombre accesible, en ninguna combinación de signos y modos. Contraprueba: en
//     «saldo» el mismo detector lo encuentra.
//  3. R27 — ningún camino propone un importe de saldo inicial: el diálogo solo le asigna al monto
//     la cadena vacía o lo que la persona teclea, y ni la action ni el servicio del aporte tienen
//     un método o campo de importe «sugerido». Contraprueba: una fuente que rellena el monto la
//     pone roja.

const RAIZ = path.resolve(__dirname, "../../..");

/**
 * Fragmentos del texto viejo. Son FRAGMENTOS y no el texto entero porque la fuente de antes lo
 * partía con `+` entre líneas: la guardia tiene que encontrarlo igual si alguien lo vuelve a pegar.
 */
const TEXTOS_RETIRADOS: readonly string[] = [
  // `CAJA_RESUMEN_AVISO_TERCEROS` de la 173 (R34 de la 173 → prohibido por R24).
  "No es lo que se les debe a las tiendas",
  "porque de este dinero Ordenex todavía",
  // `CAJA_RESUMEN_LABEL.enCajaPista` de la 173.
  "Todo lo que entró y salió, incluido",
  // La pista del KPI de la analítica, gemela de la de arriba.
  "Todo lo que entró menos todo lo que salió, incluido el dinero de las tiendas",
  // El rótulo viejo de «De las tiendas»: el contra-entrega BRUTO.
  "Contra-entrega cobrado y aún no entregado a las tiendas",
];

/** Qué fragmentos retirados aparecen en un texto. */
function retiradosEn(fuente: string): string[] {
  return TEXTOS_RETIRADOS.filter((t) => fuente.includes(t));
}

function archivosDe(dir: string): string[] {
  const salida: string[] = [];
  for (const nombre of readdirSync(dir)) {
    const ruta = path.join(dir, nombre);
    if (statSync(ruta).isDirectory()) salida.push(...archivosDe(ruta));
    else if (/\.(ts|tsx)$/.test(nombre)) salida.push(ruta);
  }
  return salida;
}

/** La fuente de ANTES de esta ficha (`wallet-labels.ts` en `fa2624fb`, copiada tal cual). */
const FUENTE_DE_ANTES = `
export const CAJA_RESUMEN_LABEL = {
  enCaja: "Dinero en caja",
  enCajaPeriodo: "Movimiento neto del periodo",
  enCajaPista: "Todo lo que entró y salió, incluido el dinero de las tiendas",
  deTerceros: "Contra-entrega cobrado y aún no entregado a las tiendas",
} as const;
export const CAJA_RESUMEN_AVISO_TERCEROS =
  "No es lo que se les debe a las tiendas: es más, porque de este dinero Ordenex todavía " +
  "descuenta el flete, la comisión y el impuesto. La deuda exacta de cada tienda está en " +
  "Wallet → Tiendas.";
`;

describe("guardia 459 — R24: los textos retirados no vuelven", () => {
  const archivos = [
    ...archivosDe(path.join(RAIZ, "app", "(app)", "wallet")),
    ...archivosDe(path.join(RAIZ, "app", "(app)", "analitica")),
  ];

  it("el barrido mira algo: los dos árboles tienen archivos y ninguno está vacío", () => {
    expect(archivos.length).toBeGreaterThan(40);
    expect(archivos.some((a) => a.endsWith("wallet-labels.ts"))).toBe(true);
    expect(archivos.some((a) => a.endsWith("cargar-kpis.ts"))).toBe(true);
    for (const a of archivos) expect(readFileSync(a, "utf8").length, a).toBeGreaterThan(0);
  });

  it("ningún archivo de `/wallet` ni de `/analitica` contiene el aviso o la pista viejos", () => {
    const hallazgos = archivos.flatMap((a) =>
      retiradosEn(readFileSync(a, "utf8")).map((t) => `${path.relative(RAIZ, a)}: «${t}»`),
    );
    expect(hallazgos).toEqual([]);
  });

  it("CONTRAPRUEBA: la fuente de antes de la ficha la pone roja", () => {
    expect(retiradosEn(FUENTE_DE_ANTES).length).toBeGreaterThanOrEqual(4);
  });
});

// ── R16 ─────────────────────────────────────────────────────────────────────────────────────

afterEach(cleanup);

const BASE: CajaResumenDTO = {
  entradas: "29059224.00",
  salidas: "38245444.50",
  enCaja: "-9186220.50",
  signoEnCaja: "negativo",
  ingresosPropios: "8070773.47",
  egresosPropios: "12476410.00",
  ganancia: "-4405636.53",
  signoGanancia: "negativo",
  deTerceros: "-4780583.97",
  periodoFiltrado: false,
  porcentajeTiendas: "0.00",
  modoComposicion: "sin_reparto",
  capital: "0.00",
  signoCapital: "cero",
  deOrdenex: "-4405636.53",
  signoDeTerceros: "negativo",
  deTercerosAbsoluto: "4780583.97",
  estado: "flujo",
  flujoDesde: "2026-08-25",
};

/** Texto + todos los nombres accesibles de lo pintado, en minúsculas. */
function todoLoLegible(container: HTMLElement): string {
  const nombres = [...container.querySelectorAll("[aria-label], [title], [alt]")].map((n) =>
    [n.getAttribute("aria-label"), n.getAttribute("title"), n.getAttribute("alt")].join(" "),
  );
  return `${container.textContent ?? ""} ${nombres.join(" ")}`.toLowerCase();
}

describe("guardia 459 — R16: en «flujo» la tarjeta nunca dice «Dinero en caja»", () => {
  it("en ninguna combinación de signo, modo y filtro", () => {
    let combinaciones = 0;
    for (const signoEnCaja of ["positivo", "negativo", "cero"] as const) {
      for (const modoComposicion of ["dos_bolsillos", "solo_tiendas", "solo_ordenex", "sin_reparto"] as const) {
        for (const periodoFiltrado of [false, true]) {
          const { container } = render(
            createElement(CajaResumenCard, {
              resumen: { ...BASE, signoEnCaja, modoComposicion, periodoFiltrado },
            }),
          );
          expect(todoLoLegible(container), `${signoEnCaja}/${modoComposicion}/${periodoFiltrado}`).not.toContain(
            "dinero en caja",
          );
          cleanup();
          combinaciones += 1;
        }
      }
    }
    expect(combinaciones).toBe(24);
  });

  it("CONTRAPRUEBA: en «saldo» el mismo detector sí lo encuentra", () => {
    const { container } = render(
      createElement(CajaResumenCard, { resumen: { ...BASE, estado: "saldo" } }),
    );
    expect(todoLoLegible(container)).toContain("dinero en caja");
  });
});

// ── R27 ─────────────────────────────────────────────────────────────────────────────────────

/** Asignaciones al monto del diálogo que NO son ni la cadena vacía ni lo que teclea la persona. */
function montoRellenadoEn(fuente: string): string[] {
  const codigo = quitarComentarios(fuente);
  return [...codigo.matchAll(/setMonto\(([^)]*)\)/g)]
    .map((m) => m[1].trim())
    .filter((arg) => arg !== '""' && arg !== "e.target.value");
}

/** Un identificador de importe «sugerido», «propuesto» o «precalculado» en el código. */
const IMPORTE_SUGERIDO = /\b\w*(sugerid|propuest|precalcul|estimad)\w*\b/i;

describe("guardia 459 — R27: nadie propone un importe de saldo inicial", () => {
  const DIALOGO = "app/(app)/wallet/_components/RegistrarMovimientoCajaDialog.tsx";

  it("el diálogo solo asigna al monto la cadena vacía o lo tecleado", () => {
    const fuente = readFileSync(path.join(RAIZ, DIALOGO), "utf8");
    // Anti-vacuidad: el diálogo SÍ asigna el monto (si no, la guardia no mediría nada).
    expect(quitarComentarios(fuente)).toMatch(/setMonto\(/);
    expect(montoRellenadoEn(fuente)).toEqual([]);
    // Y el estado del monto arranca vacío.
    expect(quitarComentarios(fuente)).toMatch(/useState\(""\);\s*\n\s*const \[fecha/);
  });

  it("ni la action, ni el servicio, ni el diálogo tienen un importe «sugerido»", () => {
    for (const ruta of [
      DIALOGO,
      "lib/actions/aporte-capital.ts",
      "lib/services/AporteCapitalService.ts",
      "lib/types/aporte-capital.ts",
    ]) {
      const codigo = quitarComentarios(readFileSync(path.join(RAIZ, ruta), "utf8"));
      expect(codigo.length, ruta).toBeGreaterThan(0);
      expect(codigo.match(IMPORTE_SUGERIDO)?.[0] ?? null, ruta).toBeNull();
    }
  });

  it("CONTRAPRUEBA: una fuente que rellena el monto o propone una cifra la pone roja", () => {
    const rellena = `function reset() { setMonto(resumen.enCaja); }`;
    expect(montoRellenadoEn(rellena)).toEqual(["resumen.enCaja"]);
    expect("const montoSugerido = derivar();").toMatch(IMPORTE_SUGERIDO);
  });
});
