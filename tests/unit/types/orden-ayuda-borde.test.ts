import { describe, expect, it } from "vitest";

import {
  MOTIVO_AYUDA_MAX,
  intentoContactoSchema,
  recuperarAyudaSchema,
  solicitarAyudaSchema,
} from "@/lib/types/orden-ayuda";
import { CUERPO_MAX } from "@/lib/types/orden-nota";

// FEATURE 235 (T2.4, R5) — EL BORDE REVALIDA EL TOPE DEL MOTIVO, Y NO DEPENDE DE LA INTERFAZ.
//
// POR QUE HACIA FALTA ESTE ARCHIVO. El schema ya existia y ya era correcto (`min(1).max(...)`), asi
// que no hay codigo nuevo que probar. Lo que faltaba era LA ASERCION: R5 dice que el tope se
// revalida EN EL BORDE DEL SERVIDOR y que el sistema NO debe depender de la interfaz para hacerlo
// cumplir. Mientras eso solo estuviera escrito en el spec, un `maxLength` del textarea podia
// parecer suficiente y el dia que alguien relajara el schema «porque el modal ya lo controla»
// nada se habria puesto rojo.
//
// El modal NO es una defensa: un POST a la Server Action no pasa por el, y ni siquiera hace falta
// mala fe — basta con una pestaña vieja abierta despues de un despliegue.
//
// SE PRUEBA EL SCHEMA, NO EL SERVICE, y es deliberado: el objeto de R5 es el borde. Que el service
// tampoco acepte un motivo vacio tras recortar lo miden sus propios casos
// (`solicitud-ayuda-service.test.ts`), y ese recorte es otra regla (R6 de la 227).

const ORDEN = "11111111-1111-4111-8111-111111111111";

describe("235/R5 — `solicitarAyudaSchema`: el motivo se acota en el BORDE", () => {
  it("el tope NO es propio: es EL MISMO de una nota del hilo, por construccion", () => {
    // Un tope propio aqui seria una segunda fuente de verdad que el dia que divergiera dejaria
    // pasar en el borde un texto que el service de notas rechazaria despues, dejando la orden sin
    // mover y al mensajero sin saber por que.
    expect(MOTIVO_AYUDA_MAX).toBe(CUERPO_MAX);
  });

  it("un motivo de EXACTAMENTE el tope se acepta (el limite es inclusivo)", () => {
    const r = solicitarAyudaSchema.safeParse({
      ordenId: ORDEN,
      motivo: "x".repeat(MOTIVO_AYUDA_MAX),
    });
    expect(r.success).toBe(true);
  });

  it("un motivo de tope + 1 se RECHAZA en el borde, sin llegar al servicio", () => {
    const r = solicitarAyudaSchema.safeParse({
      ordenId: ORDEN,
      motivo: "x".repeat(MOTIVO_AYUDA_MAX + 1),
    });
    expect(r.success).toBe(false);
  });

  it("el motivo VACIO se rechaza: una solicitud sin motivo es una marca muda", () => {
    // No es una solicitud degradada: la tienda veria la orden en `/novedades` sin saber que le
    // pasa. Por eso el `min(1)` esta aqui y no solo en el service.
    expect(solicitarAyudaSchema.safeParse({ ordenId: ORDEN, motivo: "" }).success).toBe(false);
  });

  it("un `ordenId` que no es uuid se rechaza en el borde", () => {
    expect(
      solicitarAyudaSchema.safeParse({ ordenId: "no-es-uuid", motivo: "algo" }).success,
    ).toBe(false);
  });

  it("el ACTOR nunca viaja en el input: un `autorId` colado no sobrevive al schema", () => {
    const r = solicitarAyudaSchema.safeParse({
      ordenId: ORDEN,
      motivo: "algo",
      autorId: "u-otro",
    });
    expect(r.success).toBe(true);
    // Zod objeto no-estricto DESCARTA lo que no declara: lo que llega al service es solo lo
    // declarado, asi que el autor lo fija la sesion y no la entrada.
    expect(r.success && Object.keys(r.data).sort()).toEqual(["motivo", "ordenId"]);
  });
});

describe("235 — los otros dos bordes de esta feature", () => {
  it("`recuperarAyudaSchema` solo admite la orden, y como uuid", () => {
    expect(recuperarAyudaSchema.safeParse({ ordenId: ORDEN }).success).toBe(true);
    expect(recuperarAyudaSchema.safeParse({ ordenId: "x" }).success).toBe(false);
    const r = recuperarAyudaSchema.safeParse({ ordenId: ORDEN, actor: "u-maestro" });
    expect(r.success && Object.keys(r.data)).toEqual(["ordenId"]);
  });

  it("`intentoContactoSchema` idem: quien lo registra sale de la sesion", () => {
    expect(intentoContactoSchema.safeParse({ ordenId: ORDEN }).success).toBe(true);
    expect(intentoContactoSchema.safeParse({}).success).toBe(false);
  });
});
