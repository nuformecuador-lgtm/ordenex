import { describe, it, expect } from "vitest";
import { INFORMES_WHATSAPP, VARIABLES_COMUNES } from "@/lib/whatsapp-envios/informes/catalogo";
import { esEventoDisponible } from "@/lib/whatsapp-envios/eventos";

// Ficha 474 (T3.1, R46) — recorre el catalogo REAL. Un informe mal declarado rompe ESTE test, no
// una ejecucion en produccion.

const FORMATO = /^[a-z0-9_]+$/;

describe("474/R46 — catalogo de informes", () => {
  const informes = [...INFORMES_WHATSAPP.values()];

  it("nace con los dos informes de esta ficha", () => {
    expect([...INFORMES_WHATSAPP.keys()].sort()).toEqual(["aviso_interno", "prueba_envio"]);
  });

  it("la clave del mapa es la clave del informe, sin duplicados y con formato [a-z0-9_]+", () => {
    const claves = informes.map((i) => i.clave);
    expect(new Set(claves).size).toBe(claves.length);
    for (const [k, i] of INFORMES_WHATSAPP) {
      expect(k).toBe(i.clave);
      expect(i.clave).toMatch(FORMATO);
    }
  });

  it("cada informe declara nombre, descripcion, schema con defaults validos y descriptores", () => {
    for (const i of informes) {
      expect(i.nombre.trim()).not.toBe("");
      expect(i.descripcion.trim()).not.toBe("");
      expect(i.parametros.safeParse(i.parametrosPorDefecto).success).toBe(true);
      expect(Array.isArray(i.descriptores)).toBe(true);
      for (const d of i.descriptores) {
        expect((i.parametrosPorDefecto as Record<string, unknown>)[d.campo]).not.toBeUndefined();
      }
    }
  });

  it("variables: clave unica, formato, nombre/descripcion/ejemplo no vacios", () => {
    for (const i of informes) {
      const claves = i.variables.map((v) => v.clave);
      expect(new Set(claves).size).toBe(claves.length);
      for (const v of i.variables) {
        expect(v.clave).toMatch(FORMATO);
        expect(v.nombre.trim()).not.toBe("");
        expect(v.descripcion.trim()).not.toBe("");
        expect(v.ejemplo.trim()).not.toBe("");
      }
    }
  });

  it("R53: ningun informe declara una variable comun (destinatario_nombre)", () => {
    const comunes = new Set(VARIABLES_COMUNES.map((v) => v.clave));
    expect(comunes.has("destinatario_nombre")).toBe(true);
    for (const i of informes) {
      for (const v of i.variables) expect(comunes.has(v.clave)).toBe(false);
    }
  });

  it("R14/R49: los eventos de cada informe son todos DISPONIBLES", () => {
    for (const i of informes) {
      for (const e of i.eventos) expect(esEventoDisponible(e)).toBe(true);
    }
  });

  it("enmienda R16: aviso_interno NO es apto para adminTienda", () => {
    expect(INFORMES_WHATSAPP.get("aviso_interno")?.aptoParaAdminTienda).toBe(false);
  });

  it("R6: prueba_envio genera documento; aviso_interno no", () => {
    expect(INFORMES_WHATSAPP.get("prueba_envio")?.generaDocumento).toBe(true);
    expect(INFORMES_WHATSAPP.get("aviso_interno")?.generaDocumento).toBe(false);
  });
});
