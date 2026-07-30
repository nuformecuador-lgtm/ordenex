import { describe, it, expect } from "vitest";

import { resolverDestinoCreacion } from "@/lib/services/destino-creacion";
import { ESTADOS_CREACION } from "@/lib/types/order-status-transiciones";
import { ORDER_STATUS_SEED } from "@/lib/types/order-status";

// Feature 155 (T1.2) — el PUNTO UNICO DE DECISION. Cubre R1-R3, R6 y la red de seguridad de
// R31 (los dos estados que la funcion puede devolver pertenecen a `ESTADOS_CREACION`, de modo
// que la guardia de la 140 nunca los rechaza).

describe("155/R2 — rama (a): la tienda YA tiene el paquete en bodega (fulfillment = true)", () => {
  it("la orden nace en en_preparacion", () => {
    expect(resolverDestinoCreacion(true).estatus).toBe("en_preparacion");
  });

  it("NO se le asigna num_guia en la creacion (la genera despues la 156)", () => {
    expect(resolverDestinoCreacion(true).conGuia).toBe(false);
  });

  it("R26: el lote NO emite manifiesto (no hay movimiento fisico que documentar)", () => {
    expect(resolverDestinoCreacion(true).emiteManifiesto).toBe(false);
  });
});

describe("155/R3 — rama (b): el paquete sigue en la tienda (fulfillment = false)", () => {
  it("la orden nace en por_recolectar_en_tienda", () => {
    expect(resolverDestinoCreacion(false).estatus).toBe("por_recolectar_en_tienda");
  });

  it("se le asigna num_guia en el acto", () => {
    expect(resolverDestinoCreacion(false).conGuia).toBe(true);
  });

  it("R24: el lote emite manifiesto", () => {
    expect(resolverDestinoCreacion(false).emiteManifiesto).toBe(true);
  });
});

describe("155/R1/R6 — el flag es el UNICO predicado y la regla vive en UN solo lugar", () => {
  it("la funcion es pura: la misma entrada devuelve siempre el mismo destino", () => {
    expect(resolverDestinoCreacion(true)).toEqual(resolverDestinoCreacion(true));
    expect(resolverDestinoCreacion(false)).toEqual(resolverDestinoCreacion(false));
  });

  it("las dos ramas son distintas en las TRES propiedades (no hay decision parcial)", () => {
    const a = resolverDestinoCreacion(true);
    const b = resolverDestinoCreacion(false);
    expect(a.estatus).not.toBe(b.estatus);
    expect(a.conGuia).not.toBe(b.conGuia);
    expect(a.emiteManifiesto).not.toBe(b.emiteManifiesto);
  });

  it("no hay tercera rama: la funcion solo puede devolver esos dos estados", () => {
    const posibles = [true, false].map((f) => resolverDestinoCreacion(f).estatus);
    expect(new Set(posibles).size).toBe(2);
  });
});

// Red de seguridad contra la 154/140 (R31): si alguien renombra, mueve o retira uno de los dos
// values, este test cae ANTES que produccion — donde el mismo cambio se manifestaria como un
// `TransicionIlegalError` en CADA creacion (la guardia de la 140 falla CERRADO).
describe("155/R31 — los dos destinos posibles son estados de creacion legales", () => {
  for (const fulfillment of [true, false]) {
    it(`fulfillment = ${fulfillment}: su estatus pertenece a ESTADOS_CREACION`, () => {
      expect(ESTADOS_CREACION).toContain(resolverDestinoCreacion(fulfillment).estatus);
    });

    it(`fulfillment = ${fulfillment}: su estatus pertenece al catalogo sembrado`, () => {
      expect(ORDER_STATUS_SEED).toContain(resolverDestinoCreacion(fulfillment).estatus);
    });
  }

  it("R31: ESTADOS_CREACION tiene EXACTAMENTE los dos values que esta funcion produce", () => {
    const producidos = [true, false].map((f) => resolverDestinoCreacion(f).estatus).sort();
    expect([...ESTADOS_CREACION].sort()).toEqual(producidos);
  });
});
