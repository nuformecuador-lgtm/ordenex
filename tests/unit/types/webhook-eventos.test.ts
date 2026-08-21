import { describe, expect, it } from "vitest";

import {
  EVENTOS_PUBLICOS,
  ORIGENES_SIN_EVENTO_PUBLICO,
  esEventoPublico,
  esFamiliaSinEventoPublico,
  esTransicionEmitible,
} from "@/lib/types/webhook-eventos";
import { ORDER_STATUS_SEED } from "@/lib/types/order-status";

// Feature 239 (T1.7, R26/R27, P2 FIRMADA el 2026-08-19) — la politica de eventos publicos es un
// `Set` PARCIAL: no rompe el build, asi que un value nuevo se queda fuera EN SILENCIO. La unica
// forma de que la decision sea auditable es afirmarla, incluido el caso NEGATIVO.
//
// La decision: el pre-estado NO es evento publico. El vocabulario que ve el integrador no gana
// un valor nuevo — anadirlo le obligaria a manejar un estado que no sabe interpretar—. Lo que
// cambia es CUANDO llega `devuelta`: antes al gestionar el mensajero, ahora al aprobar el cierre.

const PRE_ESTADO = "devolucion_por_confirmar";

describe("EVENTOS_PUBLICOS — el pre-estado NO entra en el contrato publico (239/P2/R27)", () => {
  it("R27/P2: `devolucion_por_confirmar` NO es evento publico", () => {
    expect(EVENTOS_PUBLICOS.has(PRE_ESTADO)).toBe(false);
    expect(esEventoPublico(PRE_ESTADO)).toBe(false);
  });

  it("R27: `devuelta` SIGUE siendo evento publico — lo que cambia es CUANDO se emite", () => {
    // El integrador sigue recibiendo el mismo evento con el mismo nombre. La 239 lo retrasa
    // hasta la aprobacion del cierre, que es cuando la orden entra de verdad en `devuelta`
    // (R27). Es un cambio de contrato OBSERVABLE y hay que avisar antes de desplegar (T0.3).
    expect(EVENTOS_PUBLICOS.has("devuelta")).toBe(true);
    expect(esEventoPublico("devuelta")).toBe(true);
  });

  it("la lista NO cambio de tamano con la 239: sigue teniendo los 10 values de la 155", () => {
    // Si esto sube a 11, alguien anadio el pre-estado (o algun otro) al contrato publico sin
    // pasar por la puerta humana. La lista se congela por CONTENIDO, no solo por conteo.
    expect([...EVENTOS_PUBLICOS].sort()).toEqual(
      [
        "por_recolectar_en_tienda",
        "en_ruta_bodega_central",
        "en_bodega_central",
        "en_reparto",
        "entregada",
        "reprogramada",
        "devuelta",
        "rechazada",
        "devolviendo_a_tienda",
        "devuelta_a_tienda",
      ].sort(),
    );
  });

  it("todos los values emitidos existen en el catalogo vigente (sin fantasmas)", () => {
    for (const value of EVENTOS_PUBLICOS) {
      expect(ORDER_STATUS_SEED as readonly string[]).toContain(value);
    }
  });

  // Feature 235 (T1.5, R39): el catalogo gano `ayuda_tienda` y la lista NO se movio.
  it("235/R39: `ayuda_tienda` NO es evento publico — el vocabulario no crece por esta feature", () => {
    expect(EVENTOS_PUBLICOS.has("ayuda_tienda")).toBe(false);
    expect(esEventoPublico("ayuda_tienda")).toBe(false);
    expect(EVENTOS_PUBLICOS.size).toBe(10);
  });
});

// =================================================================================================
// FEATURE 235 — P4, FIRMADA EN CONTRA DE LA RECOMENDACION DEL SPEC (2026-08-19).
//
// El humano NO acepta que un integrador reciba `en_reparto` DOS VECES sobre la misma orden. Como
// `ayuda_tienda` no es evento publico, la IDA ya no se emite; la VUELTA (el rescate) SI se emitiria,
// porque `en_reparto` esta en la politica. De ahi esta excepcion.
//
// ⚠️ ESTE BLOQUE ES EL QUE TIENE QUE PONERSE ROJO SI ALGUIEN AMPLIA LA EXCEPCION A OTRA FAMILIA.
// El requisito 2 de la firma lo pide con esas palabras. Y el motivo esta escrito en el requisito 1:
// implementarla POR ESTADO —o ensancharla a otra familia— silencia los REINGRESOS LEGITIMOS a
// `en_reparto`, y eso si es una regresion.
// =================================================================================================
describe("235/P4 — la excepcion de webhook es POR FAMILIA, y exactamente UNA", () => {
  it("la lista de familias exceptuadas es EXACTAMENTE `rescate_ayuda_tienda`", () => {
    // Igualdad literal, no `toContain`. Es el CONTRATO: cada familia que entre aqui deja de
    // avisar a los integradores, y eso se decide en una puerta humana, no en un commit.
    expect([...ORIGENES_SIN_EVENTO_PUBLICO]).toEqual(["rescate_ayuda_tienda"]);
    expect(ORIGENES_SIN_EVENTO_PUBLICO).toHaveLength(1);
  });

  it("el RESCATE no se emite, aunque su estado destino SI sea publico", () => {
    // Las dos mitades de la afirmacion, para que se vea que la exencion la pone la familia y no
    // el estado: `en_reparto` es publico...
    expect(esEventoPublico("en_reparto")).toBe(true);
    // ...y aun asi esta transicion concreta no se emite.
    expect(esTransicionEmitible("en_reparto", "rescate_ayuda_tienda")).toBe(false);
    expect(esFamiliaSinEventoPublico("rescate_ayuda_tienda")).toBe(true);
  });

  it.each([
    // El caso que da nombre al riesgo: una REPROGRAMADA liberada por el cron vuelve a
    // `en_reparto` y TIENE que avisar. Si la excepcion se implementara por estado, este integrador
    // dejaria de enterarse — la regresion que la firma prohibe expresamente.
    ["liberacion_reprogramada"],
    // El deshacer del mensajero: la orden vuelve a la calle y el integrador tiene que verlo.
    ["deshacer_gestion"],
    // La recogida: es la entrada NORMAL a `en_reparto`. Si esta dejara de emitir, el integrador no
    // se enteraria nunca de que su paquete salio a reparto.
    ["recoleccion"],
    // Y una que ni siquiera toca `en_reparto`, para que no se lea como una lista de reingresos.
    ["gestion"],
  ] as const)(
    "REINGRESO LEGITIMO a `en_reparto` via `%s`: SIGUE emitiendo (la excepcion no se contagia)",
    (familia) => {
      expect(esTransicionEmitible("en_reparto", familia)).toBe(true);
      expect(esFamiliaSinEventoPublico(familia)).toBe(false);
    },
  );

  it("la IDA tampoco emite, pero por OTRA razon: su estado destino no es publico", () => {
    // Se afirma por separado a proposito. Si algun dia `ayuda_tienda` entrara en
    // `EVENTOS_PUBLICOS`, este caso caeria y obligaria a decidir si la ida debe emitirse — en vez
    // de que la excepcion de la vuelta lo tape en silencio.
    expect(esTransicionEmitible("ayuda_tienda", "solicitud_ayuda_tienda")).toBe(false);
    expect(esFamiliaSinEventoPublico("solicitud_ayuda_tienda")).toBe(false);
  });

  it("un estado NO publico sigue sin emitir, venga de la familia que venga", () => {
    expect(esTransicionEmitible("sin_gestionar", "corte_sin_gestionar")).toBe(false);
    expect(esTransicionEmitible("devolucion_por_confirmar", "gestion")).toBe(false);
  });
});
