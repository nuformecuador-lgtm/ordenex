import { describe, expect, it } from "vitest";

import {
  EVENTOS_PUBLICOS,
  ORIGENES_SIN_EVENTO_PUBLICO,
  esEventoPublico,
  esFamiliaSinEventoPublico,
  esTransicionEmitible,
} from "@/lib/types/webhook-eventos";
import { ORDER_STATUS_SEED } from "@/lib/types/order-status";
import { ORDEN_HISTORIAL_ORIGEN_TIPO_SEED } from "@/lib/types/orden-historial";
import { TRANSICIONES } from "@/lib/types/order-status-transiciones";

// Feature 239 (T1.7, R26/R27, P2 FIRMADA el 2026-08-19) — la politica de eventos publicos es un
// `Set` PARCIAL: no rompe el build, asi que un value nuevo se queda fuera EN SILENCIO. La unica
// forma de que la decision sea auditable es afirmarla, incluido el caso NEGATIVO.
//
// La decision: el pre-estado NO es evento publico. El vocabulario que ve el integrador no gana
// un valor nuevo — anadirlo le obligaria a manejar un estado que no sabe interpretar—. Lo que
// cambia es CUANDO llega `devuelta`: antes al gestionar el mensajero, ahora al aprobar el cierre.
//
// ⏳ 2026-08-22 (FEATURE 268) — este archivo se puso rojo A PROPOSITO y se ACTUALIZA con la
// decision escrita al lado; nunca se relaja a un aserto de tamano (R18, alternativa A6 descartada:
// un `size` no detecta un intercambio —un value entra y otro sale— y convierte la puerta humana en
// un contador). La 268 revierte 235/P4: entran `ayuda_tienda` (la IDA del ciclo de ayuda) e
// `incidente`, y la exencion por familia queda VACIA, de modo que el rescate vuelve a emitir. Las
// dos mitades del ciclo van juntas o no van.

const PRE_ESTADO = "devolucion_por_confirmar";

describe("EVENTOS_PUBLICOS — el pre-estado NO entra en el contrato publico (239/P2/R27)", () => {
  it("R27/P2: `devolucion_por_confirmar` NO es evento publico", () => {
    // 268/R4: se CONSERVA intacto. La 268 amplia el vocabulario, pero el pre-estado NO entra «por
    // simetria»: la decision 239/P2 sigue firmada y en pie.
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

  it("la lista es EXACTAMENTE estos 13 values (los 12 de la 268 + `en_preparacion`)", () => {
    // Congelada por CONTENIDO (R18), no por conteo. Si esto cambia, alguien toco el contrato
    // publico sin pasar por la puerta humana. El `size` de abajo ACOMPANA a la igualdad; jamas la
    // sustituye.
    //
    // ⏳ 2026-08-31 — este aserto se puso rojo A PROPOSITO, igual que en la 268, y se ACTUALIZA con
    // la decision escrita al lado: entra `en_preparacion`, el evento de NACIMIENTO de las ordenes de
    // fulfillment. Sigue sin relajarse a un aserto de tamano (alternativa A6, descartada en la 268):
    // un `size` no detecta un intercambio —un value entra y otro sale— y convierte la puerta humana
    // en un contador.
    expect([...EVENTOS_PUBLICOS].sort()).toEqual(
      [
        // Los DIEZ vigentes antes de la 268. R3: el cambio es estrictamente ADITIVO y ninguno de
        // estos puede salir — ningun integrador deja de recibir un evento que hoy recibe.
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
        // Los DOS que trae la 268.
        "ayuda_tienda", // R1
        "incidente", // R2
        // El que trae el parche del 2026-08-31.
        "en_preparacion",
      ].sort(),
    );
    expect(EVENTOS_PUBLICOS.size).toBe(13);
  });

  it("`en_preparacion` SI es evento publico, y es de NACIMIENTO: no hay arista hacia el", () => {
    // Las dos mitades de la decision del 2026-08-31, afirmadas juntas.
    //
    // (1) Emite. Cierra el silencio de la rama de fulfillment: hasta hoy esa orden no producia
    //     NINGUN evento hasta llegar a `en_bodega_central` al emitirse la guia.
    expect(EVENTOS_PUBLICOS.has("en_preparacion")).toBe(true);
    expect(esEventoPublico("en_preparacion")).toBe(true);

    // (2) Y emite UNA sola vez por orden, no porque lo diga una politica sino porque el grafo de
    //     transiciones no declara NINGUNA arista hacia `en_preparacion` (R28): es estado inicial y
    //     nada mas. Esto es lo que hace que el alta no pueda generar reingresos repetidos, y por eso
    //     se afirma aqui: si alguien abre esa arista, este test lo delata en el mismo commit.
    for (const [origen, aristas] of Object.entries(TRANSICIONES)) {
      const destinos = (aristas as readonly { to: string }[]).map((a) => a.to);
      expect(destinos, `${origen} no debe declarar una arista hacia en_preparacion`).not.toContain(
        "en_preparacion",
      );
    }
  });

  it("todos los values emitidos existen en el catalogo vigente (sin fantasmas)", () => {
    // R17: se conserva tal cual. Los dos values de la 268 ya existen en el SEED (sin migracion).
    for (const value of EVENTOS_PUBLICOS) {
      expect(ORDER_STATUS_SEED as readonly string[]).toContain(value);
    }
  });

  // ⏳ 2026-08-22 — AQUI DECIA, y ya no es cierto: «235/R39: `ayuda_tienda` NO es evento publico —
  // el vocabulario no crece por esta feature», con `EVENTOS_PUBLICOS.size === 10`. El caso se
  // INVIERTE en vez de borrarse, para que quede rastro de que 235/P4 se revirtio a proposito
  // (268/R1/R2) y no por descuido.
  it("268/R1/R2 (invierte 235/R39): `ayuda_tienda` e `incidente` SI son eventos publicos", () => {
    expect(EVENTOS_PUBLICOS.has("ayuda_tienda")).toBe(true);
    expect(esEventoPublico("ayuda_tienda")).toBe(true);
    expect(EVENTOS_PUBLICOS.has("incidente")).toBe(true);
    expect(esEventoPublico("incidente")).toBe(true);
  });
});

// =================================================================================================
// FEATURE 235 — P4, FIRMADA EN CONTRA DE LA RECOMENDACION DEL SPEC (2026-08-19).
//
// ⏳ 2026-08-22 (FEATURE 268/R5/R6/R9) — AQUI DECIA, y ya no es cierto: «El humano NO acepta que un
// integrador reciba `en_reparto` DOS VECES sobre la misma orden (...). De ahi esta excepcion»; y
// «ESTE BLOQUE ES EL QUE TIENE QUE PONERSE ROJO SI ALGUIEN AMPLIA LA EXCEPCION A OTRA FAMILIA».
//
// La 268 REVIERTE 235/P4: la lista de familias exceptuadas queda VACIA y el rescate vuelve a
// emitir. Lo que NO cambia —y por eso este bloque se reescribe en vez de borrarse— es el
// MECANISMO: la constante, su restriccion de tipo, `esFamiliaSinEventoPublico` y
// `esTransicionEmitible` siguen existiendo con la misma firma (R6, alternativa A2 descartada). Es
// el unico sitio donde una exencion futura puede escribirse POR FAMILIA; sin el, la implementacion
// natural seria por ESTADO destino, que es justo la regresion que 235 documento y prohibio.
//
// ⚠️ EL BLOQUE SIGUE SIENDO EL QUE SE PONE ROJO SI ALGUIEN ANADE UNA FAMILIA AQUI: la lista se fija
// por IGUALDAD (R18), asi que ensancharla —reducir el contrato publico— cuesta una decision.
// =================================================================================================
describe("268 — la exencion por familia queda VACIA, pero el MECANISMO sigue en pie", () => {
  it("268/R5: la lista de familias exceptuadas esta VACIA", () => {
    // Igualdad literal, no `toContain`. Es el CONTRATO: cada familia que entre aqui deja de
    // avisar a los integradores, y eso se decide en una puerta humana, no en un commit.
    expect([...ORIGENES_SIN_EVENTO_PUBLICO]).toEqual([]);
    expect(ORIGENES_SIN_EVENTO_PUBLICO).toHaveLength(0);
  });

  it("268/R6: el mecanismo de exencion por familia sigue exportado y con su comportamiento", () => {
    // No basta con que la lista este vacia: el punto es que el MECANISMO no se borro (A2). Se
    // afirman las dos piezas por separado, con su comportamiento observable de siempre.
    expect(typeof esFamiliaSinEventoPublico).toBe("function");
    expect(typeof esTransicionEmitible).toBe("function");
    // Con la lista vacia NINGUNA familia esta exceptuada: ni la que lo estuvo (`rescate_...`) ni
    // ninguna otra, ni un origen cualquiera que no exista en el catalogo.
    expect(esFamiliaSinEventoPublico("rescate_ayuda_tienda")).toBe(false);
    expect(esFamiliaSinEventoPublico("familia_que_no_existe")).toBe(false);
    for (const familia of ORDEN_HISTORIAL_ORIGEN_TIPO_SEED) {
      expect(esFamiliaSinEventoPublico(familia)).toBe(false);
    }
    // Y `esTransicionEmitible` sigue diciendo `false` cuando el destino NO es publico, venga de
    // la familia que venga: la politica por ESTADO no se ha tocado.
    //
    // ⏳ 2026-08-31 — el primer ejemplo era `en_preparacion`, que YA NO SIRVE: desde el parche de
    // hoy es evento publico. Se sustituye por otro interno de ruteo satelite, que es lo que el caso
    // quiere ejercitar (un destino no publico), no `en_preparacion` en particular.
    expect(esTransicionEmitible("en_bodega_satelite", "gestion")).toBe(false);
    expect(esTransicionEmitible("por_recoger", "recoleccion")).toBe(false);
  });

  // 268/R7 — MIENTRAS la lista este vacia, `esTransicionEmitible` es EQUIVALENTE a
  // `esEventoPublico` para TODA familia declarada. Se recorre el SEED entero a proposito: si
  // manana alguien ensancha la exencion sin pasar por la puerta, este caso cae junto al de
  // igualdad de arriba.
  it("268/R7: `esTransicionEmitible(estado, familia) === esEventoPublico(estado)` para TODA familia", () => {
    const ESTADOS_MUESTRA = [
      // publicos (incluidos los dos que trae la 268)
      "en_reparto",
      "entregada",
      "ayuda_tienda",
      "incidente",
      "devuelta_a_tienda",
      // NO publicos
      "en_preparacion",
      "por_recoger",
      "sin_gestionar",
      "devolucion_por_confirmar",
      "en_bodega_satelite",
    ] as const;

    expect(ORDEN_HISTORIAL_ORIGEN_TIPO_SEED.length).toBeGreaterThan(0);
    for (const familia of ORDEN_HISTORIAL_ORIGEN_TIPO_SEED) {
      for (const estado of ESTADOS_MUESTRA) {
        expect(esTransicionEmitible(estado, familia)).toBe(esEventoPublico(estado));
      }
    }
  });

  // ⏳ 2026-08-22 — AQUI DECIA, y ya no es cierto: «el RESCATE no se emite, aunque su estado destino
  // SI sea publico». El caso se INVIERTE (268/R9): la VUELTA del ciclo de ayuda vuelve a emitir,
  // porque emitir solo la IDA dejaria al integrador viendo entrar la orden en ayuda y no verla
  // salir nunca. El `en_reparto` REPETIDO es el coste aceptado por escrito (R10), soportable
  // porque la clave de idempotencia lleva el instante y los dos eventos tienen `eventoId` distinto.
  it("268/R9 (invierte 235/P4): el RESCATE SI se emite", () => {
    expect(esEventoPublico("en_reparto")).toBe(true);
    expect(esTransicionEmitible("en_reparto", "rescate_ayuda_tienda")).toBe(true);
    expect(esFamiliaSinEventoPublico("rescate_ayuda_tienda")).toBe(false);
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
      // 268/R12: se conserva TAL CUAL. Vaciar la exencion no puede alterar ninguno de estos casos.
      expect(esTransicionEmitible("en_reparto", familia)).toBe(true);
      expect(esFamiliaSinEventoPublico(familia)).toBe(false);
    },
  );

  // ⏳ 2026-08-22 — AQUI DECIA, y ya no es cierto: «la IDA tampoco emite, pero por OTRA razon: su
  // estado destino no es publico (...) si algun dia `ayuda_tienda` entrara en `EVENTOS_PUBLICOS`,
  // este caso caeria y obligaria a decidir si la ida debe emitirse». Ese dia es hoy y la decision
  // esta tomada: la IDA emite (268/R1/R8).
  it("268/R8 (invierte 235): la IDA `-> ayuda_tienda` SI emite", () => {
    expect(esTransicionEmitible("ayuda_tienda", "solicitud_ayuda_tienda")).toBe(true);
    expect(esFamiliaSinEventoPublico("solicitud_ayuda_tienda")).toBe(false);
  });

  it("un estado NO publico sigue sin emitir, venga de la familia que venga", () => {
    // 268/R13: el corte de la noche (`ayuda_tienda -> sin_gestionar`) sigue en silencio.
    expect(esTransicionEmitible("sin_gestionar", "corte_sin_gestionar")).toBe(false);
    expect(esTransicionEmitible("devolucion_por_confirmar", "gestion")).toBe(false);
  });
});
