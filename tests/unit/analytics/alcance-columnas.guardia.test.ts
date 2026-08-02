import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { whereGestionOrden, whereOrden, whereRollup } from "@/lib/analytics/alcance-columnas";
import type { AlcanceDatos } from "@/lib/analytics/alcance";

// Feature 122 / T5.3 — GUARDIA de COLUMNAS (R5, R7).
//
// Dos confusiones que filtrarian datos entre inquilinos sin que ningun test funcional se
// entere, porque ambas producen un `where` VALIDO que devuelve filas de mas:
//
//   (R5/D9) recortar la zona por `usuario.zona_id` del mensajero que gestiono la fila en
//           vez de por `orden.zona_id`. La zona del mensajero PUEDE diferir de la de la
//           orden; un `adminSatelite` veria ordenes de otras zonas gestionadas por gente
//           de la suya.
//   (R7/D3) recortar el mensajero por `gestion_orden.mensajero_id` en vez de por
//           `orden.mensajero_asignado_id`. La columna existe, es NOT NULL y esta a mano:
//           por eso hace falta un guardia y no un comentario.
//
// El censo se hace por DOS vias que se cubren mutuamente: sobre el FRAGMENTO producido
// (runtime, inmune a como este escrito el codigo) y sobre el TEXTO del modulo (estatico,
// alcanza al codigo que ningun test ejecuta). Ambas se autocomprueban con adaptadores
// infractores escritos a mano.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const DIR_ANALYTICS = path.join(REPO_ROOT, "lib", "analytics");

const ALCANCES: readonly AlcanceDatos[] = [
  { tipo: "global" },
  { tipo: "zona", zonaId: "z1" },
  { tipo: "tienda", tiendaId: "t1" },
  { tipo: "mensajero", mensajeroId: "m1" },
];

function soloCodigo(fuente: string): string {
  return fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

function archivosDeAnalytics(): string[] {
  return fs
    .readdirSync(DIR_ANALYTICS)
    .filter((n) => n.endsWith(".ts"))
    .map((n) => path.join(DIR_ANALYTICS, n));
}

function relativa(archivo: string): string {
  return path.relative(REPO_ROOT, archivo).split(path.sep).join("/");
}

/**
 * La zona del USUARIO usada como columna de recorte. Reconoce las tres formas en que
 * alguien la escribiria: la columna SQL, la relacion Prisma anidada y el atajo por el
 * mensajero de la gestion.
 */
const RE_ZONA_DE_USUARIO = [
  /usuario\s*\.\s*zona_?[Ii]d/,
  /\busuario\s*:\s*\{[^}]*zonaId/,
  /\bmensajero\s*:\s*\{[^}]*zonaId/,
];

/** El mensajero de la GESTION usado como columna de recorte (D3 lo prohibe). */
const RE_MENSAJERO_DE_GESTION = [
  /gestion_orden\s*\.\s*mensajero_id/,
  /gestionOrden\s*\.\s*mensajeroId/,
  /\bmensajero\s*:\s*\{\s*id\s*:/,
];

function infracciones(codigo: string, patrones: readonly RegExp[]): string[] {
  return patrones.filter((p) => p.test(codigo)).map((p) => p.source);
}

/** Claves de recorte que el motor aplicaria sobre la propia tabla (primer nivel). */
function clavesPropias(fragmento: object): string[] {
  return Object.keys(fragmento);
}

describe("R5 · la zona recortada es orden.zona_id, nunca la del usuario (D9)", () => {
  it("el adaptador de orden nombra zonaId de orden y ninguna zona de usuario", () => {
    expect(whereOrden({ tipo: "zona", zonaId: "z1" })).toEqual({ zonaId: "z1" });
    expect(whereRollup({ tipo: "zona", zonaId: "z1" })).toEqual({ zonaId: "z1" });
    expect(whereGestionOrden({ tipo: "zona", zonaId: "z1" })).toEqual({ orden: { zonaId: "z1" } });
  });

  it("censo: ningun archivo de lib/analytics nombra la zona del usuario como recorte", () => {
    const hallazgos = archivosDeAnalytics().flatMap((archivo) => {
      const codigo = soloCodigo(fs.readFileSync(archivo, "utf8"));
      return infracciones(codigo, RE_ZONA_DE_USUARIO).map((p) => `${relativa(archivo)}: ${p}`);
    });
    expect(hallazgos).toEqual([]);
  });

  it("autocomprobacion: el censo detecta un adaptador que recorta por usuario.zonaId", () => {
    const infractores = [
      "return { usuario: { zonaId: alcance.zonaId } };",
      "return { mensajero: { zonaId: alcance.zonaId } };",
      "// SQL a mano\nconst w = `WHERE usuario.zona_id = $1`;",
    ];
    for (const caso of infractores) {
      expect(infracciones(caso, RE_ZONA_DE_USUARIO), caso).not.toEqual([]);
    }
  });

  it("autocomprobacion: el censo NO marca el recorte legitimo por orden.zonaId", () => {
    const legitimos = [
      "return { zonaId: alcance.zonaId };",
      "return { orden: { zonaId: alcance.zonaId } };",
    ];
    for (const caso of legitimos) {
      expect(infracciones(caso, RE_ZONA_DE_USUARIO), caso).toEqual([]);
    }
  });
});

describe("R7 · el mensajero recortado es orden.mensajero_asignado_id, nunca el de la gestion (D3)", () => {
  it("censo: gestion_orden.mensajero_id no aparece como columna de recorte en lib/analytics", () => {
    const hallazgos = archivosDeAnalytics().flatMap((archivo) => {
      const codigo = soloCodigo(fs.readFileSync(archivo, "utf8"));
      return infracciones(codigo, RE_MENSAJERO_DE_GESTION).map((p) => `${relativa(archivo)}: ${p}`);
    });
    expect(hallazgos).toEqual([]);
  });

  it("ningun fragmento producido lleva mensajeroId en el primer nivel de gestion_orden", () => {
    for (const alcance of ALCANCES) {
      expect(clavesPropias(whereGestionOrden(alcance)), JSON.stringify(alcance)).not.toContain(
        "mensajeroId",
      );
    }
  });

  it("el recorte de mensajero viaja SIEMPRE por la relacion orden", () => {
    expect(whereGestionOrden({ tipo: "mensajero", mensajeroId: "m1" })).toEqual({
      orden: { mensajeroAsignadoId: "m1" },
    });
  });

  it("autocomprobacion: el censo detecta un adaptador que recorta por gestion_orden.mensajeroId", () => {
    const infractores = [
      "const w = `WHERE gestion_orden.mensajero_id = $1`;",
      "return prisma.gestionOrden.mensajeroId;",
      "return { mensajero: { id: alcance.mensajeroId } };",
    ];
    for (const caso of infractores) {
      expect(infracciones(caso, RE_MENSAJERO_DE_GESTION), caso).not.toEqual([]);
    }
    // Y la via de runtime: un adaptador que devolviera la columna propia caeria aqui.
    const infractorRuntime = { mensajeroId: "m1" };
    expect(clavesPropias(infractorRuntime)).toContain("mensajeroId");
  });

  it("el censo mira archivos de verdad: lib/analytics tiene los nueve modulos del lote", () => {
    const nombres = archivosDeAnalytics().map((a) => path.basename(a, ".ts"));
    for (const modulo of [
      "types",
      "metrics",
      "ranges",
      "filters",
      "alcance",
      "alcance-columnas",
      "consulta",
      "identidad",
      "auditoria",
    ]) {
      expect(nombres, `falta lib/analytics/${modulo}.ts`).toContain(modulo);
    }
  });
});
