import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  WALLET_MOVIMIENTO_CATEGORIA_SEED,
  type WalletMovimientoCategoria,
} from "@/lib/types/wallet";
import { CATEGORIA_LABEL, CATEGORIA_OPTIONS } from "@/app/(app)/wallet/_components/wallet-labels";
import type { GestionResultado } from "@prisma/client";

// Feature 158 (R5/R31) — LA RED DE EXHAUSTIVIDAD, verificada en runtime.
//
// El mecanismo real de R5 es el COMPILADOR: un `Record<GestionResultado, …>` o un
// `Record<WalletMovimientoCategoria, …>` al que le falte el valor nuevo rompe el build. Este
// archivo NO lo sustituye — lo COMPLEMENTA con lo que el compilador no puede ver:
//
//   1. que la red no se haya "resuelto" con un `default:`, un `?? ""` o un cast, que es
//      exactamente como se desactiva sin que nadie lo note (design §8: la exhaustividad ES el
//      diseño, y relajarla es lo que hay que impedir);
//   2. que las clasificaciones sean DELIBERADAS y no un relleno vacio.
//
// Verificado por mutacion durante la implementacion: quitar un valor de
// `CAUSA_INCIDENTE_SEED` rompe el BUILD por `_EnsureExhaustive`; quitar la clave `incidente`
// de `ESTADOS_ESPERADOS` o de un `CierreGrupos` tambien.

const LIB = path.join(__dirname, "..", "..", "..", "lib");
const APP = path.join(__dirname, "..", "..", "..", "app");

function leer(...partes: string[]): string {
  return fs.readFileSync(path.join(...partes), "utf8");
}

describe("R5 — los mapas por RESULTADO clasifican `incidente` explicitamente", () => {
  it("`ESTADOS_ESPERADOS` (deshacer) lo declara, y NO con un `default`", () => {
    const src = leer(LIB, "services", "CierreDiaService.ts");
    const mapa = src.slice(
      src.indexOf("const ESTADOS_ESPERADOS"),
      src.indexOf("// Metodos de repo que consume el service"),
    );
    expect(mapa).toMatch(/incidente:\s*\["incidente"\]/);
    expect(mapa).not.toMatch(/default:/);
  });

  it("`buildGestionData` es un switch EXHAUSTIVO: tiene los 5 casos y NINGUN `default`", () => {
    const src = leer(LIB, "services", "MisAsignacionesService.ts");
    const fn = src.slice(src.indexOf("function buildGestionData"));
    const casos: GestionResultado[] = [
      "entregada",
      "reprogramada",
      "devuelta",
      "rechazada",
      "incidente",
    ];
    for (const caso of casos) expect(fn, `falta el case "${caso}"`).toContain(`case "${caso}":`);
    // Un `default` haria que un 6.º resultado futuro se colara SIN decidir que persiste: la
    // ausencia de default es lo que convierte al compilador en la red.
    expect(fn).not.toMatch(/default:/);
  });

  it("los TRES `CierreGrupos` de servicio declaran la clave `incidente`", () => {
    for (const archivo of [
      "CierreDiaService.ts",
      "CierresAdminService.ts",
      "CierresBodegaAdminService.ts",
    ]) {
      const src = leer(LIB, "services", archivo);
      const inicio = src.indexOf("CierreGrupos = {");
      expect(inicio, `${archivo} no construye un CierreGrupos`).toBeGreaterThan(-1);
      const bloque = src.slice(inicio, src.indexOf("}", inicio));
      expect(bloque, `${archivo} no clasifica \`incidente\``).toMatch(/incidente:\s*\[\]/);
    }
  });
});

describe("R5/R31 — la categoria nueva esta clasificada en la wallet", () => {
  it("R31: `CATEGORIA_LABEL` tiene etiqueta legible EN ESPANOL para la indemnizacion", () => {
    expect(CATEGORIA_LABEL.egreso_indemnizacion).toBe("Indemnización por incidente");
    // No es el slug crudo: la etiqueta se escribio, no se derivo del enum.
    expect(CATEGORIA_LABEL.egreso_indemnizacion).not.toBe("egreso_indemnizacion");
  });

  it("R5: el `Record<WalletMovimientoCategoria, string>` esta COMPLETO (las 15)", () => {
    for (const categoria of WALLET_MOVIMIENTO_CATEGORIA_SEED) {
      const etiqueta = CATEGORIA_LABEL[categoria as WalletMovimientoCategoria];
      expect(etiqueta, `sin etiqueta para ${categoria}`).toBeTruthy();
    }
    expect(Object.keys(CATEGORIA_LABEL)).toHaveLength(WALLET_MOVIMIENTO_CATEGORIA_SEED.length);
  });

  it("R31: la categoria aparece como opcion del filtro (se puebla desde el SEED)", () => {
    const opciones = CATEGORIA_OPTIONS.map((o) => o.value);
    expect(opciones).toContain("egreso_indemnizacion");
    const opcion = CATEGORIA_OPTIONS.find((o) => o.value === "egreso_indemnizacion");
    expect(opcion?.label).toBe("Indemnización por incidente");
  });

  it("R5: las etiquetas de resultado de los dos detalles clasifican `incidente`", () => {
    for (const archivo of [
      path.join(APP, "(app)", "cierres-admin", "_components", "cierre-detalle-shared.tsx"),
      path.join(APP, "(app)", "cierre-dia", "_components", "CierreDiaModule.tsx"),
    ]) {
      const src = fs.readFileSync(archivo, "utf8");
      expect(src, `${path.basename(archivo)} sin etiqueta de incidente`).toMatch(
        /incidente:\s*"Incidentes"/,
      );
      expect(src, `${path.basename(archivo)} sin texto de grupo vacio`).toMatch(
        /incidente:\s*"No hay incidentes\."/,
      );
    }
  });
});

describe("R5 — la red no se relaja con casts ni con coalescencias", () => {
  it("ningun modulo nuevo de la feature usa `as any` sobre el resultado o la categoria", () => {
    const nuevos = [
      path.join(LIB, "types", "causa-incidente.ts"),
      path.join(LIB, "services", "WalletIndemnizacionFeedService.ts"),
      path.join(LIB, "interfaces", "services", "IWalletIndemnizacionFeedService.ts"),
    ];
    for (const archivo of nuevos) {
      const src = fs.readFileSync(archivo, "utf8");
      expect(src, `${path.basename(archivo)} usa any`).not.toMatch(/\bas any\b/);
      expect(src, `${path.basename(archivo)}: ts-ignore`).not.toMatch(/@ts-(ignore|expect-error)/);
    }
  });
});
