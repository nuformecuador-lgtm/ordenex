import { describe, it, expect } from "vitest";
import {
  COLUMNAS_DESCARGA_API_KEYS,
  filaDescargaApiKey,
} from "@/app/(app)/configuracion/api/_components/api-keys-descarga-columnas";
import type { ApiKeyListItemDTO } from "@/lib/types/api-key";

// Feature 170 / T B.3 (R5/R6/R7/R8/R21/R23/R24) — columnas de export del inventario de API
// keys. Es la tabla más sensible de la Tanda B: la mitad de estos tests son sobre lo que NO
// puede salir.

const API_KEY: ApiKeyListItemDTO = {
  id: "9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
  identificador: "Tienda Uno",
  keyPrefix: "ordx_ab12cd3",
  estado: "inactiva",
  usuarioId: "1a2b3c4d-5e6f-4708-9a0b-1c2d3e4f5a6b",
  usuarioEmail: "apikey+tienda-uno@apikey.invalid",
  tiendaDestinoId: null, // feature 302
  tiendaDestinoNombre: null,
  createdAt: new Date("2026-03-15T18:30:00.000Z"),
};

describe("columnas de descarga del inventario de API keys", () => {
  it("declara sus columnas ENUMERADAS, en el orden de la pantalla (R5)", () => {
    expect(COLUMNAS_DESCARGA_API_KEYS.map((c) => c.clave)).toEqual([
      "identificador",
      "prefijo",
      "usuarioDedicado",
      "fechaCreacion",
      "estado",
    ]);
    expect(COLUMNAS_DESCARGA_API_KEYS.map((c) => c.encabezado)).toEqual([
      "Identificador",
      "Prefijo",
      "Usuario dedicado",
      "Fecha de creación",
      "Estado",
    ]);
  });

  it("emite valores CRUDOS: texto, numero o celda vacia, nunca objetos (R7)", () => {
    for (const [clave, celda] of Object.entries(filaDescargaApiKey(API_KEY))) {
      const tipo = celda === null ? "null" : typeof celda;
      expect(["string", "number", "null"], `columna ${clave}`).toContain(tipo);
    }
  });

  it("emite el estado como ETIQUETA LEGIBLE, no como valor interno (R8)", () => {
    const fila = filaDescargaApiKey(API_KEY);
    expect(fila.estado).toBe("Inactiva");
    expect(fila.estado).not.toBe("inactiva");
  });

  it("emite el prefijo TAL CUAL, sin el elipsis de presentacion (R7)", () => {
    const fila = filaDescargaApiKey(API_KEY);
    expect(fila.prefijo).toBe("ordx_ab12cd3");
    expect(String(fila.prefijo)).not.toContain("…");
  });

  it("NUNCA emite el hash, la clave en claro ni el secreto de webhook (R21)", () => {
    // Un DTO contaminado: el listado real no los trae, pero si mañana alguien los añadiera
    // al DTO, la fila NO puede cambiar (las columnas se enumeran a mano, R6).
    const contaminado = {
      ...API_KEY,
      keyHash: "sha256:0f1e2d3c4b5a69788796a5b4c3d2e1f0",
      plainKey: "ordx_ab12cd3_ESTO_ES_EL_SECRETO_ENTERO",
      webhookSecret: "whsec_no_debe_salir_jamas",
    } as ApiKeyListItemDTO;

    const fila = filaDescargaApiKey(contaminado);
    const valores = Object.values(fila).map(String);

    expect(fila).not.toHaveProperty("keyHash");
    expect(fila).not.toHaveProperty("plainKey");
    expect(fila).not.toHaveProperty("webhookSecret");
    expect(valores).not.toContain("sha256:0f1e2d3c4b5a69788796a5b4c3d2e1f0");
    expect(valores).not.toContain("ordx_ab12cd3_ESTO_ES_EL_SECRETO_ENTERO");
    expect(valores).not.toContain("whsec_no_debe_salir_jamas");
    // Y el prefijo que SI sale sigue siendo el prefijo, no el secreto completo.
    expect(fila.prefijo).toBe("ordx_ab12cd3");
  });

  it("no expone identificadores internos: ni el de la key ni el del usuario dedicado (R23)", () => {
    const fila = filaDescargaApiKey(API_KEY);
    expect(fila).not.toHaveProperty("id");
    expect(fila).not.toHaveProperty("usuarioId");
    expect(Object.values(fila)).not.toContain(API_KEY.id);
    expect(Object.values(fila)).not.toContain(API_KEY.usuarioId);
    for (const celda of Object.values(fila)) {
      if (typeof celda === "string") {
        expect(celda).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      }
    }
  });

  it("emite la fecha como dia calendario de Costa Rica, y vacia si es invalida (R7/R24)", () => {
    // 18:30 UTC del 15 de marzo son las 12:30 del 15 en CR: el día NO se corre.
    expect(filaDescargaApiKey(API_KEY).fechaCreacion).toBe("2026-03-15");

    // 23:00 UTC del 15 son las 17:00 del 15 en CR: tampoco.
    const tarde = { ...API_KEY, createdAt: new Date("2026-03-15T23:00:00.000Z") };
    expect(filaDescargaApiKey(tarde).fechaCreacion).toBe("2026-03-15");

    // Fecha ilegible -> celda vacía, nunca "Invalid Date".
    const rota = { ...API_KEY, createdAt: "no-es-una-fecha" as unknown as Date };
    expect(filaDescargaApiKey(rota).fechaCreacion).toBeNull();
  });

  it("un campo nuevo del DTO no aparece en el archivo hasta declararlo (R6)", () => {
    const conCampoNuevo = { ...API_KEY, ultimaIpUsada: "203.0.113.7" } as ApiKeyListItemDTO;

    const fila = filaDescargaApiKey(conCampoNuevo);
    expect(Object.keys(fila).sort()).toEqual(
      COLUMNAS_DESCARGA_API_KEYS.map((c) => c.clave).sort(),
    );
    expect(Object.values(fila)).not.toContain("203.0.113.7");
  });
});
