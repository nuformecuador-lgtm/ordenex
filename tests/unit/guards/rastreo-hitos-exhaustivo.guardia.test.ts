import { describe, it, expect } from "vitest";

import { ORDER_STATUS_SEED, type OrderStatusValue } from "@/lib/types/order-status";
import {
  ETIQUETA_POR_HITO,
  HITOS_PUBLICOS,
  HITO_POR_DEFECTO,
  HITO_POR_ESTATUS,
  hitoDeEstatus,
  type HitoPublico,
} from "@/lib/types/rastreo-publico";

// Feature 229 — GUARDIA de exhaustividad del mapeo estatus interno -> hito publico
// (T1.3, cubre R16 y R17).
//
// El `satisfies Record<OrderStatusValue, HitoPublico>` del mapa ya rompe el BUILD si alguien
// añade un value al catalogo sin darle hito; esta guardia cubre lo que el compilador no ve:
// que la transcripcion coincide EXACTAMENTE con la tabla firmada en `requirements.md` §D2
// —un mapeo puede estar completo y aun asi decir lo que no se firmo— y que una fila
// huerfana (feature 155) cae en el hito neutral en vez de publicar el value crudo.

/**
 * La tabla firmada del gate (G5-G8), transcrita aqui A MANO y por SEGUNDA VEZ a proposito:
 * si esta lista se derivara del mapa, la guardia diria que el mapa coincide consigo mismo.
 */
const TABLA_FIRMADA: Record<OrderStatusValue, HitoPublico> = {
  en_preparacion: "registrado",
  por_recolectar_en_tienda: "registrado",
  recolectando: "registrado",
  por_recoger: "en_bodega",
  en_bodega_central: "en_bodega",
  en_bodega_satelite: "en_bodega",
  en_ruta_bodega_central: "en_transito",
  en_ruta_bodega_satelite: "en_transito",
  en_reparto: "en_reparto",
  sin_gestionar: "en_reparto",
  entregada: "entregado",
  reprogramada: "reprogramado",
  devuelta: "no_entregado",
  rechazada: "no_entregado",
  incidente: "no_entregado",
  por_devolver: "devolucion_en_curso",
  devolviendo_a_bodega_central: "devolucion_en_curso",
  por_devolver_a_tienda: "devolucion_en_curso",
  devolviendo_a_tienda: "devolucion_en_curso",
  devuelta_a_tienda: "devuelto",
  // Feature 239/R28 (2026-08-19): el pre-estado comparte hito con `devuelta`. Para el
  // destinatario no cambia nada —el paquete no se le entrego—; lo que falta (la confirmacion en
  // bodega) es un tramite interno que el rastreo publico no cuenta.
  devolucion_por_confirmar: "no_entregado",
  // Feature 235/R38 (P3 firmada 2026-08-19): EL MISMO hito que `en_reparto`. Para el destinatario
  // no cambia nada -el paquete sigue con el mensajero- y quien resuelve la incidencia es asunto
  // interno. Como el rastreo COLAPSA rachas del mismo hito, el viaje
  // `en_reparto -> ayuda_tienda -> en_reparto` se ve como UNA sola entrada «En reparto».
  ayuda_tienda: "en_reparto",
};

describe("R16 — el mapeo de hitos cubre el catalogo vigente entero", () => {
  // 2026-08-19 (feature 239): 20 -> 21 values. El añadido es `devolucion_por_confirmar`.
  it("los 21 values del catalogo tienen hito publico asignado y coinciden con la tabla firmada (incluidos recolectando→registrado, incidente→no_entregado y sin_gestionar→en_reparto)", () => {
    const sinHito = ORDER_STATUS_SEED.filter((value) => !(value in HITO_POR_ESTATUS));
    expect(sinHito).toEqual([]);

    for (const value of ORDER_STATUS_SEED) {
      expect(hitoDeEstatus(value)).toBe(TABLA_FIRMADA[value]);
    }

    // Las tres asignaciones con nota propia en el gate, nombradas una a una para que su
    // cambio no pase como "un value mas del bucle".
    expect(hitoDeEstatus("recolectando")).toBe("registrado"); // G6
    expect(hitoDeEstatus("incidente")).toBe("no_entregado"); // G7
    expect(hitoDeEstatus("sin_gestionar")).toBe("en_reparto"); // G8, riesgo aceptado
  });

  it("el mapa no inventa estatus que no esten en el catalogo vigente", () => {
    const catalogo = new Set<string>(ORDER_STATUS_SEED);
    const sobrantes = Object.keys(HITO_POR_ESTATUS).filter((value) => !catalogo.has(value));
    expect(sobrantes).toEqual([]);
  });

  it("todo hito asignado pertenece al vocabulario publico y tiene etiqueta", () => {
    const vocabulario = new Set<string>(HITOS_PUBLICOS);
    for (const hito of Object.values(HITO_POR_ESTATUS)) {
      expect(vocabulario.has(hito)).toBe(true);
      expect(ETIQUETA_POR_HITO[hito]).toBeTruthy();
    }
  });
});

describe("R17 — un estatus fuera del catalogo cae en el hito por defecto y no se publica crudo", () => {
  it("una fila huerfana (el caso real de la feature 155) recibe el hito neutral", () => {
    // `en_fulfillment` salio del seed en la 155 y su fila SOBREVIVE en la base si el
    // historial la referencia: el historial es inmutable.
    expect(hitoDeEstatus("en_fulfillment")).toBe(HITO_POR_DEFECTO);
    expect(hitoDeEstatus("un_estatus_que_no_existe")).toBe(HITO_POR_DEFECTO);
    expect(hitoDeEstatus("")).toBe(HITO_POR_DEFECTO);
  });

  it("el hito por defecto es neutral, tiene etiqueta y NO es el value crudo", () => {
    expect(HITO_POR_DEFECTO).toBe("en_proceso");
    expect(ETIQUETA_POR_HITO[HITO_POR_DEFECTO]).toBe("En proceso");
    expect(new Set<string>(ORDER_STATUS_SEED).has(HITO_POR_DEFECTO)).toBe(false);
  });

  it("nunca devuelve undefined para un value arbitrario", () => {
    for (const value of ["", " ", "ENTREGADA", "entregada ", "algo/raro", "123"]) {
      expect(HITOS_PUBLICOS).toContain(hitoDeEstatus(value));
    }
  });
});

describe("R15/R16 — el texto publico no es vocabulario interno", () => {
  it("ninguna etiqueta publica coincide con un order_status.value del catalogo", () => {
    const catalogo = new Set<string>(ORDER_STATUS_SEED);
    for (const etiqueta of Object.values(ETIQUETA_POR_HITO)) {
      expect(catalogo.has(etiqueta)).toBe(false);
    }
    // OJO, colision CONOCIDA y no accidental: el hito firmado `en_reparto` (G5) se escribe
    // igual que el `order_status.value` `en_reparto`, y su etiqueta "En reparto" normalizada
    // volveria a serlo. Es homonimia del vocabulario firmado, no una fuga: el publico recibe
    // un hito del vocabulario de nueve, que da la casualidad de llamarse igual. Quien escriba
    // la guardia de R15 (T4.3) debe compararlo contra el vocabulario publico, no contra un
    // `includes` ciego del resultado serializado.
    expect(ETIQUETA_POR_HITO.en_reparto).toBe("En reparto");
  });

  it("cada hito del vocabulario publico tiene su etiqueta y no sobra ninguna", () => {
    expect(Object.keys(ETIQUETA_POR_HITO).sort()).toEqual([...HITOS_PUBLICOS].sort());
  });
});
