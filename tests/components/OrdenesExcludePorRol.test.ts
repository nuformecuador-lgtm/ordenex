import { describe, it, expect } from "vitest";
import { RolValue } from "@prisma/client";

import {
  EXCLUDE_POR_ROL,
  ESTADOS_FLUJO_DEVOLUCION,
} from "@/app/(app)/ordenes/exclude-por-rol";

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
    expect(excluidos).toContain("devuelta");
    expect(excluidos).toContain("en_bodega_central");
  });
});

// Feature 239 (T1.7, R26/R19) — este mapa es PARCIAL y NO rompe el build: un estado que no se
// liste AUTO-APARECE como opcion del desplegable de ese rol. La decision de la 239 (P3: durante
// el limbo la tienda no ve nada) solo queda protegida si se afirma aqui.
describe("EXCLUDE_POR_ROL — el pre-estado de la devolucion (239/R26)", () => {
  const PRE_ESTADO = "devolucion_por_confirmar";

  it("R19/R26: el adminTienda NO puede filtrar por el pre-estado (esta excluido, junto a `devuelta`)", () => {
    const excluidos = EXCLUDE_POR_ROL[RolValue.adminTienda];
    expect(excluidos).toContain(PRE_ESTADO);
    // Va con `devuelta` porque son la misma cosa antes y despues de la confirmacion: si el
    // pre-estado se colara en el desplegable, la tienda veria en su filtro justo el estado que
    // la 239 decide que todavia no le corresponde ver.
    expect(excluidos).toContain("devuelta");
  });

  it("R26: maestro y admin SI lo ven (solo excluyen `pendiente`)", () => {
    // Son los que tienen que poder contar la poblacion atascada en el pre-estado (R34).
    expect(EXCLUDE_POR_ROL[RolValue.maestro]).not.toContain(PRE_ESTADO);
    expect(EXCLUDE_POR_ROL[RolValue.admin]).not.toContain(PRE_ESTADO);
  });
});
