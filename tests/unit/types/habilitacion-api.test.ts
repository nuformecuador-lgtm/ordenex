import { describe, it, expect } from "vitest";
import {
  ESTADOS_HABILITABLES_API,
  esEstadoHabilitableApi,
} from "@/lib/types/habilitacion-api";
import { ESTATUS_POR_GRUPO } from "@/lib/types/novedad-grupo";
import { ORDER_STATUS_SEED } from "@/lib/types/order-status";

// Feature 266 · T2.1 — el conjunto de estados desde los que el canal por API key puede habilitar.
//
// D1 (puerta del 2026-08-23, FIRMADA): son los DOS grupos que `/novedades` ya declara y NINGUNO
// mas. El caso de `reprogramada` se escribe APARTE porque estuvo propuesta como habilitable hasta
// la puerta: sin un caso propio, el dia que alguien la anada «por simetria» no rompera nada.

describe("Feature 266 · T2.1 — ESTADOS_HABILITABLES_API (D1)", () => {
  it("D1: el conjunto es EXACTAMENTE `ayuda_tienda` y `devuelta`, por igualdad", () => {
    expect(ESTADOS_HABILITABLES_API).toEqual(["ayuda_tienda", "devuelta"]);
  });

  it("R13-b: `reprogramada` NO es habilitable, aunque el integrador la llame novedad", () => {
    expect(ESTADOS_HABILITABLES_API as readonly string[]).not.toContain("reprogramada");
    expect(esEstadoHabilitableApi("reprogramada")).toBe(false);
  });

  it("R13/R31: `rechazada`, `incidente`, `sin_gestionar` y `en_reparto` quedan fuera", () => {
    // `en_reparto` esta en la lista a proposito: es el estado en el que queda una orden ya
    // habilitada, y que NO sea habilitable es lo que hace que la segunda llamada devuelva
    // `estado_no_habilitable` en vez de un acuse falso (R31 / D3).
    for (const estado of ["rechazada", "incidente", "sin_gestionar", "en_reparto"]) {
      expect(ESTADOS_HABILITABLES_API as readonly string[]).not.toContain(estado);
      expect(esEstadoHabilitableApi(estado)).toBe(false);
    }
  });

  it("coincide con `Object.values(ESTATUS_POR_GRUPO)`: una sola verdad, no dos literales", () => {
    // ESTE es el caso que hace ruido si alguien reescribe la constante como literales sueltos y
    // las dos declaraciones se separan: el dia que un value cambie en `novedad-grupo.ts`, el
    // endpoint dejaria de habilitar lo que la pantalla llama novedad y nada mas lo diria.
    expect([...ESTADOS_HABILITABLES_API].sort()).toEqual(
      Object.values(ESTATUS_POR_GRUPO).sort(),
    );
  });

  it("cada estado habilitable existe de verdad en el catalogo de estados", () => {
    // El `satisfies readonly OrderStatusValue[]` lo fuerza en compile time; aqui se comprueba en
    // runtime para que el caso no dependa solo del tipo.
    for (const estado of ESTADOS_HABILITABLES_API) {
      expect(ORDER_STATUS_SEED as readonly string[]).toContain(estado);
    }
  });

  it("es lista de INCLUSION: un estado cualquiera del catalogo NO es habilitable por defecto", () => {
    const fuera = (ORDER_STATUS_SEED as readonly string[]).filter(
      (v) => !(ESTADOS_HABILITABLES_API as readonly string[]).includes(v),
    );
    expect(fuera.length).toBeGreaterThan(0);
    for (const estado of fuera) expect(esEstadoHabilitableApi(estado)).toBe(false);
    // Y un value inventado tampoco cuela.
    expect(esEstadoHabilitableApi("estado_que_no_existe")).toBe(false);
  });
});
