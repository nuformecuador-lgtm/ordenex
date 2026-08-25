import { describe, it, expect } from "vitest";
import { OrdenHistorialOrigenTipo as PrismaOrdenHistorialOrigenTipo } from "@prisma/client";
import {
  ORDEN_HISTORIAL_ORIGEN_TIPO_SEED,
  ORIGEN_TIPOS_CON_GESTION,
  ORIGEN_TIPOS_VISITA_REAL,
} from "@/lib/types/orden-historial";
import {
  esFamiliaSinEventoPublico,
  esTransicionEmitible,
  ORIGENES_SIN_EVENTO_PUBLICO,
} from "@/lib/types/webhook-eventos";

// Feature 266 · T1.3 + T6.1 — LAS TRES NO-LISTAS de la familia `habilitacion_api`, y su emision.
//
// El caso que protege DINERO es el primero. `ORIGEN_TIPOS_VISITA_REAL` es lista de INCLUSION: si
// alguien mete ahi esta familia «por simetria» con `gestion_tienda_ayuda`, cada habilitacion por
// API sumaria un intento de entrega que nadie hizo —nadie fue a ninguna puerta: el integrador
// pulso un endpoint desde su servidor—, el cron del SLA (99) alcanzaria antes el umbral,
// escalaria antes a `rechazada` y dispararia el `cobroRechazado` (56): dinero real cobrado a la
// tienda antes de tiempo y en silencio.
//
// Los otros dos son de contrato: la fila nace con `gestion_orden_id` NULO, y la familia NO se
// exceptua de la politica de eventos publicos (R27), asi que la rama A emite (R17) — lo cual se
// AFIRMA aqui y no se asume, porque la lista de exencion esta vacia desde la 268 y una exencion
// futura silenciaria el evento sin romper nada mas.

const FAMILIA = "habilitacion_api";

describe("Feature 266 · T1.3 — la familia `habilitacion_api` y sus tres NO-listas", () => {
  it("💰 R26: NO cuenta como visita real, asi que no altera el conteo de intentos de ninguna orden", () => {
    expect(ORIGEN_TIPOS_VISITA_REAL as readonly string[]).not.toContain(FAMILIA);
    // Y la lista sigue siendo EXACTAMENTE la que era: este caso se pone rojo tanto si alguien
    // anade la familia nueva como si ensancha la lista por cualquier otra via.
    expect(ORIGEN_TIPOS_VISITA_REAL).toEqual(["gestion", "gestion_tienda_ayuda"]);
  });

  it("no enlaza gestion: su fila nace con `gestion_orden_id` NULO", () => {
    expect(ORIGEN_TIPOS_CON_GESTION as readonly string[]).not.toContain(FAMILIA);
    expect(ORIGEN_TIPOS_CON_GESTION).toEqual(["gestion", "deshacer_gestion"]);
  });

  it("R27: NO esta exceptuada de la politica de eventos publicos", () => {
    expect(esFamiliaSinEventoPublico(FAMILIA)).toBe(false);
    // La lista de exencion sigue VACIA (268/R5) y esta feature no la toca: con la lista vacia
    // basta con NO anadir la familia ahi, y eso es exactamente lo que se hizo — nada.
    expect(ORIGENES_SIN_EVENTO_PUBLICO).toEqual([]);
  });

  it("D5: `habilitacion_api` esta declarada en el SEED y en el enum Prisma, sin drift", () => {
    expect([...ORDEN_HISTORIAL_ORIGEN_TIPO_SEED] as string[]).toContain(FAMILIA);
    // La direccion codigo -> DB la fuerza el `satisfies` del modulo y la direccion DB -> codigo el
    // `_EnsureExhaustive`: las dos rompen el BUILD. Aqui se comprueba el resultado en runtime.
    expect(Object.values(PrismaOrdenHistorialOrigenTipo)).toContain(FAMILIA);
  });

  it("A3: es una familia PROPIA, distinta de las dos del viaje de la ayuda de la 235", () => {
    // El reuso de `rescate_ayuda_tienda` era la opcion barata (la arista es la misma) y se
    // descarto: `actor_usuario_id` no distingue las vias, porque el usuario dedicado de la key ES
    // la tienda. Si alguien colapsa las familias, este caso lo dice.
    const tipos = [...ORDEN_HISTORIAL_ORIGEN_TIPO_SEED] as string[];
    expect(tipos).toContain("rescate_ayuda_tienda");
    expect(tipos).toContain("solicitud_ayuda_tienda");
    expect(FAMILIA).not.toBe("rescate_ayuda_tienda");
    expect(new Set(tipos).size).toBe(tipos.length); // sin duplicados: el value se anadio una vez
  });
});

describe("Feature 266 · T6.1 — la rama A SI emite evento publico (afirmado, no asumido)", () => {
  it("R17/R27: `esTransicionEmitible('en_reparto', 'habilitacion_api')` es true", () => {
    expect(esTransicionEmitible("en_reparto", FAMILIA)).toBe(true);
  });

  it("la emision se decide por la POLITICA, no por la familia: un destino no publico sigue sin emitir", () => {
    // El espejo del caso de arriba. Si alguien «arreglara» la emision metiendo la familia en
    // alguna lista blanca por familia, este caso se pondria rojo: la politica por ESTADO manda.
    expect(esTransicionEmitible("en_preparacion", FAMILIA)).toBe(false);
    expect(esTransicionEmitible("por_recoger", FAMILIA)).toBe(false);
  });
});
