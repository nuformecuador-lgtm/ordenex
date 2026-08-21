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

  it("la lista esta congelada por CONTENIDO: los 10 de la 155 + `ayuda_tienda` (2026-08-21)", () => {
    // Si esto cambia, alguien movio el contrato publico sin pasar por la puerta humana. Se
    // congela por CONTENIDO, no solo por conteo. El unico alta desde la 155 es `ayuda_tienda`,
    // decidida por el humano el 2026-08-21 (revierte 235/P4); el pre-estado de la 239 SIGUE fuera.
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
        "ayuda_tienda",
      ].sort(),
    );
  });

  it("todos los values emitidos existen en el catalogo vigente (sin fantasmas)", () => {
    for (const value of EVENTOS_PUBLICOS) {
      expect(ORDER_STATUS_SEED as readonly string[]).toContain(value);
    }
  });

  // Decision humana 2026-08-21 — REVIERTE la 235/R39: `ayuda_tienda` entra en el contrato publico.
  it("2026-08-21: `ayuda_tienda` SI es evento publico — el integrador ve la solicitud de ayuda", () => {
    expect(EVENTOS_PUBLICOS.has("ayuda_tienda")).toBe(true);
    expect(esEventoPublico("ayuda_tienda")).toBe(true);
    expect(EVENTOS_PUBLICOS.size).toBe(11);
  });

  it("el value emitido esta DECLARADO en el enum publico del OpenAPI (contrato completo)", async () => {
    // Emitir un estado que el contrato no documenta es lo mismo que no tener contrato: el
    // integrador recibiria un `estado` que su cliente generado no sabe deserializar. El .yaml
    // publicado se verifica aparte, como espejo exacto de este literal
    // (`tests/unit/api/openapi-contrato-en-reparto.test.ts`).
    const { openApiSpec } = await import("@/lib/api/openapi-spec");
    const enumEstado = openApiSpec.components.schemas.OrdenListItem.properties.estado.enum;
    expect(enumEstado).toContain("ayuda_tienda");
  });
});

// =================================================================================================
// DECISION HUMANA 2026-08-21 — REVIERTE la 235/P4 (que a su vez se habia firmado en contra de la
// recomendacion del spec el 2026-08-19).
//
// P4 silenciaba el ciclo de ayuda ENTERO: la ida no emitia porque `ayuda_tienda` no era publico, y
// la vuelta (el rescate) tampoco, por esta lista de familias exentas. Hoy emiten LAS DOS: el
// integrador ve entrar la orden en ayuda y ve salirla. El `en_reparto` repetido sobre la misma
// orden —lo que P4 evitaba— se acepta a proposito.
//
// ⚠️ ESTE BLOQUE SIGUE SIENDO EL QUE TIENE QUE PONERSE ROJO SI ALGUIEN METE UNA FAMILIA AQUI. Lo
// que cambio es la lista esperada (vacia), no el control: cada familia que entre deja de avisar a
// los integradores, y eso se decide en una puerta humana, no en un commit. Y el motivo de que la
// exencion sea POR FAMILIA sigue en pie: implementarla POR ESTADO silenciaria los REINGRESOS
// LEGITIMOS a `en_reparto`, y eso si es una regresion.
// =================================================================================================
describe("2026-08-21 — el ciclo de ayuda emite entero; la exencion por familia queda VACIA", () => {
  it("no hay NINGUNA familia exceptuada", () => {
    // Igualdad literal, no `toContain`: la lista se congela por contenido.
    expect([...ORIGENES_SIN_EVENTO_PUBLICO]).toEqual([]);
    expect(ORIGENES_SIN_EVENTO_PUBLICO).toHaveLength(0);
  });

  it("el RESCATE `ayuda_tienda -> en_reparto` SI se emite (revierte P4)", () => {
    expect(esEventoPublico("en_reparto")).toBe(true);
    expect(esTransicionEmitible("en_reparto", "rescate_ayuda_tienda")).toBe(true);
    expect(esFamiliaSinEventoPublico("rescate_ayuda_tienda")).toBe(false);
  });

  it("la IDA `en_reparto -> ayuda_tienda` tambien se emite", () => {
    expect(esTransicionEmitible("ayuda_tienda", "solicitud_ayuda_tienda")).toBe(true);
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
    "REINGRESO LEGITIMO a `en_reparto` via `%s`: SIGUE emitiendo",
    (familia) => {
      expect(esTransicionEmitible("en_reparto", familia)).toBe(true);
      expect(esFamiliaSinEventoPublico(familia)).toBe(false);
    },
  );

  it("un estado NO publico sigue sin emitir, venga de la familia que venga", () => {
    expect(esTransicionEmitible("sin_gestionar", "corte_sin_gestionar")).toBe(false);
    expect(esTransicionEmitible("devolucion_por_confirmar", "gestion")).toBe(false);
  });
});
