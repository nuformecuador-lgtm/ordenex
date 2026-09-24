import { describe, it, expect } from "vitest";
import { RolValue } from "@prisma/client";

import {
  EXCLUDE_POR_ROL,
  ESTADOS_FLUJO_DEVOLUCION,
} from "@/app/(app)/ordenes/exclude-por-rol";
import { estadosOfrecidos } from "@/app/(app)/ordenes/_components/filtro-estado-def";
import { ORDER_STATUS_SEED } from "@/lib/types/order-status";

// Feature 139 (T3.4, R19/R20) — `OrdenesListado` deriva las opciones del filtro por estado del catálogo `order_status`
// MENOS `EXCLUDE_POR_ROL[rol]`. Estos tests blindan que NINGÚN estado del flujo de
// devolución de rechazadas quede excluido, para maestro/admin (R19) ni para adminTienda
// (R20, gate F1.4-Q4: ve TODOS los estados del retorno, incluidos los internos de bodega).

describe("EXCLUDE_POR_ROL — visibilidad de los estados del flujo de devolución (R19/R20)", () => {
  it("R19: maestro y admin excluyen SOLO 'pendiente' (los 4 estados del flujo auto-aparecen)", () => {
    expect(EXCLUDE_POR_ROL[RolValue.maestro]).toEqual(["pendiente"]);
    expect(EXCLUDE_POR_ROL[RolValue.admin]).toEqual(["pendiente"]);
  });

  it("R19: ningún estado del flujo de devolución está excluido para maestro/admin", () => {
    for (const rol of [RolValue.maestro, RolValue.admin]) {
      const excluidos = EXCLUDE_POR_ROL[rol];
      for (const estado of ESTADOS_FLUJO_DEVOLUCION) {
        expect(excluidos).not.toContain(estado);
      }
    }
  });

  it("R20 (gate F1.4-Q4): el adminTienda NO excluye NINGÚN estado del retorno (incluidos los internos de bodega)", () => {
    const excluidos = EXCLUDE_POR_ROL[RolValue.adminTienda];
    // Incluye los internos de bodega (`por_devolver`, `devolviendo_a_bodega_central`)
    // y el tramo tienda (`por_devolver_a_tienda`, `devolviendo_a_tienda`, `devuelta_a_tienda`).
    for (const estado of ESTADOS_FLUJO_DEVOLUCION) {
      expect(excluidos).not.toContain(estado);
    }
    // Cordura: sí sigue excluyendo lo que NO es del flujo de devolución de rechazadas.
    expect(excluidos).toContain("novedad");
    expect(excluidos).toContain("en_bodega_central");
  });
});

// ⏳ 2026-09-23 (FICHA 454, R37): aqui vivian dos bloques —«el pre-estado de la devolucion
// (239/R26)», excluido para el adminTienda, y «el estatus de la ayuda a la tienda (235/R37/R45)»,
// que no se excluia para nadie—. Los dos estados salen del catalogo: el mapa ya no los nombra, y lo
// que protegian se afirma ahora en su forma final: NINGUN rol los ve como opcion del filtro, aunque
// la fila huerfana siga en la tabla `order_status` de una base con historial (produccion).
describe("454/R37 — los dos estados retirados no se ofrecen a NINGUN rol como filtro", () => {
  const RETIRADOS = ["devolucion_por_confirmar", "ayuda_tienda"];
  // Catalogo como lo devolveria una base con historial: las filas huerfanas SIGUEN en la tabla.
  const CATALOGO = [
    ...ORDER_STATUS_SEED.map((value, i) => ({ id: `s-${i}`, value })),
    ...RETIRADOS.map((value) => ({ id: `s-${value}`, value })),
  ];

  it.each([RolValue.maestro, RolValue.admin, RolValue.adminTienda])(
    "%s: ni `devolucion_por_confirmar` ni `ayuda_tienda` aparecen en el desplegable",
    (rol) => {
      const ofrecidos = estadosOfrecidos(CATALOGO, EXCLUDE_POR_ROL[rol]).map((s) => s.value);
      expect(ofrecidos.length).toBeGreaterThan(0); // no-vacuidad
      for (const retirado of RETIRADOS) expect(ofrecidos).not.toContain(retirado);
    },
  );

  it("y el mapa de exclusion ya no los nombra: no hace falta excluir lo que no existe", () => {
    for (const lista of Object.values(EXCLUDE_POR_ROL)) {
      for (const retirado of RETIRADOS) expect(lista).not.toContain(retirado);
    }
    // La exclusion del adminTienda que SI sigue siendo una decision: `devuelta`.
    expect(EXCLUDE_POR_ROL[RolValue.adminTienda]).toContain("novedad");
  });
});
