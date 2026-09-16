import { describe, expect, it } from "vitest";

import { resolverSinpeBodega, type SinpeBodega } from "@/lib/utils/sinpe-bodega";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 429 / T2 — R13 y R15: DE QUE BODEGA SALE EL SINPE.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// Los tres casos que existen, y el cuarto que NO puede existir: el par nunca es vacio, porque
// `orden.zona_id` es NOT NULL y la zona lleva sus dos columnas NOT NULL desde esta ficha.
//
// ⚠️ NUMEROS FICTICIOS. El repositorio es publico: aqui no se escribe ningun SINPE real.

const BODEGA_DEL_MENSAJERO: SinpeBodega = { numero: "80000000", nombre: "Titular de Prueba" };
const BODEGA_DE_LA_ORDEN: SinpeBodega = { numero: "70000000", nombre: "Otro Titular de Prueba" };

describe("429/R13 — manda la bodega del MENSAJERO", () => {
  it("con mensajero de otra bodega, el par es el de SU bodega, no el de la zona de la orden", () => {
    // El fixture tiene las dos DISTINTAS a proposito: con las dos iguales, el caso pasaria
    // aunque el resolvedor devolviera siempre la de la orden.
    expect(BODEGA_DEL_MENSAJERO).not.toEqual(BODEGA_DE_LA_ORDEN);
    expect(
      resolverSinpeBodega({
        zonaDelMensajero: BODEGA_DEL_MENSAJERO,
        zonaDeLaOrden: BODEGA_DE_LA_ORDEN,
      }),
    ).toEqual(BODEGA_DEL_MENSAJERO);
  });

  it("los DOS campos viajan juntos: no se puede acabar con el numero de uno y el nombre de otro", () => {
    // D1: separarlos le daria al cliente el numero de una persona bajo el nombre de otra, y
    // SINPE Movil enseña el titular al teclear el numero — el cliente ve que no coincide y no paga.
    const r = resolverSinpeBodega({
      zonaDelMensajero: BODEGA_DEL_MENSAJERO,
      zonaDeLaOrden: BODEGA_DE_LA_ORDEN,
    });
    expect(r.numero).toBe(BODEGA_DEL_MENSAJERO.numero);
    expect(r.nombre).toBe(BODEGA_DEL_MENSAJERO.nombre);
  });
});

describe("429/R15 — el respaldo es la bodega de la ORDEN, y nunca falta", () => {
  it("sin mensajero asignado (el caso normal de /novedades) usa la zona de la orden", () => {
    expect(
      resolverSinpeBodega({ zonaDelMensajero: null, zonaDeLaOrden: BODEGA_DE_LA_ORDEN }),
    ).toEqual(BODEGA_DE_LA_ORDEN);
  });

  it("mensajero SIN zona (`usuario.zona_id` es nullable) usa la zona de la orden", () => {
    // Es un estado representable y el corte diario ya los cuenta aparte (`mensajerosSinZona`).
    expect(
      resolverSinpeBodega({ zonaDelMensajero: null, zonaDeLaOrden: BODEGA_DE_LA_ORDEN }),
    ).toEqual(BODEGA_DE_LA_ORDEN);
  });

  it("en los tres casos el par NUNCA es cadena vacia", () => {
    const casos: Array<Parameters<typeof resolverSinpeBodega>[0]> = [
      { zonaDelMensajero: BODEGA_DEL_MENSAJERO, zonaDeLaOrden: BODEGA_DE_LA_ORDEN },
      { zonaDelMensajero: null, zonaDeLaOrden: BODEGA_DE_LA_ORDEN },
      { zonaDelMensajero: BODEGA_DEL_MENSAJERO, zonaDeLaOrden: BODEGA_DEL_MENSAJERO },
    ];
    for (const caso of casos) {
      const r = resolverSinpeBodega(caso);
      expect(r.numero).not.toBe("");
      expect(r.nombre).not.toBe("");
    }
  });
});
