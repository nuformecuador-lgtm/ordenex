import type { GestionResultado } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { nombreDeResultado, SENAL_PENDIENTE } from "@/lib/types/gestion-resultado";
import {
  CODIGO_VIGENTE_DE_ANTERIOR,
  ESTADO_RETIRADO,
  NOMBRE_ESTADO,
  NOMBRE_NO_RECONOCIDO,
  ORDER_STATUS_SEED,
  codigoVigente,
  esCodigoAnterior,
  esCodigoVigente,
  nombreDeEstado,
  nombrePublicoDeEstado,
} from "@/lib/types/order-status";
import { ESTATUS_POR_RESULTADO } from "@/lib/types/gestion-destino";
import { RETIRADO } from "../../fixtures/codigos-455";

/**
 * FICHA 455 (T1.1, design §1.1-§1.2) — las funciones de la fuente unica.
 * R2/R10/R11 (interno), R34 (publico), R22/R23 (traduccion), R4/R33 (resultado).
 */

describe("455/R2 · R10 · R11 — nombreDeEstado (superficies internas)", () => {
  it("los 20 vigentes dan su nombre exacto", () => {
    for (const codigo of ORDER_STATUS_SEED) expect(nombreDeEstado(codigo)).toBe(NOMBRE_ESTADO[codigo]);
    // Dos anclas literales (no contra su propia fuente): el que cambia de codigo y el que no.
    expect(nombreDeEstado("mensajero_recogiendo_en_bodega")).toBe("Mensajero recogiendo en la bodega");
    expect(nombreDeEstado("en_reparto")).toBe("En reparto");
  });

  it("R11: un retirado se lee con su nombre historico y « (estado retirado)»", () => {
    expect(nombreDeEstado(RETIRADO.devolucionPorConfirmar)).toBe("Devolución por confirmar (estado retirado)");
    expect(nombreDeEstado(RETIRADO.ayudaTienda)).toBe("Ayuda solicitada a la tienda (estado retirado)");
    expect(nombreDeEstado(RETIRADO.enFulfillment)).toBe("En fulfillment (estado retirado)");
    expect(nombreDeEstado(RETIRADO.pendiente)).toBe("Pendiente (estado retirado)");
  });

  it("R10/R3: un codigo desconocido da «Estado no reconocido» y NUNCA el codigo", () => {
    expect(nombreDeEstado("no_existe_455")).toBe("Estado no reconocido");
    expect(NOMBRE_NO_RECONOCIDO).toBe("Estado no reconocido");
    // Un codigo ANTERIOR tampoco se muestra crudo ni se traduce aqui: quien lee un snapshot llama
    // antes a `codigoVigente` (R23).
    for (const anterior of Object.keys(CODIGO_VIGENTE_DE_ANTERIOR)) {
      expect(nombreDeEstado(anterior)).toBe("Estado no reconocido");
    }
    // `toString`, `constructor`… no son estados (el mapa no hereda de Object.prototype).
    expect(nombreDeEstado("toString")).toBe("Estado no reconocido");
  });

  it("vacio o nulo -> «—» (la celda vacia de siempre)", () => {
    expect(nombreDeEstado(null)).toBe("—");
    expect(nombreDeEstado(undefined)).toBe("—");
    expect(nombreDeEstado("")).toBe("—");
  });
});

describe("455/R34 — nombrePublicoDeEstado (rastreo)", () => {
  it("un vigente da su nombre; un retirado, el de su vigente EQUIVALENTE; lo desconocido, R10", () => {
    expect(nombrePublicoDeEstado("novedad")).toBe("Novedad");
    expect(nombrePublicoDeEstado(RETIRADO.devolucionPorConfirmar)).toBe("Novedad");
    expect(nombrePublicoDeEstado(RETIRADO.ayudaTienda)).toBe("En reparto");
    expect(nombrePublicoDeEstado(RETIRADO.enFulfillment)).toBe("En preparación");
    expect(nombrePublicoDeEstado(RETIRADO.pendiente)).toBe("En preparación");
    expect(nombrePublicoDeEstado("no_existe_455")).toBe("Estado no reconocido");
  });

  it("todo equivalente de un retirado es un estado vigente", () => {
    for (const { equivalente } of Object.values(ESTADO_RETIRADO)) expect(esCodigoVigente(equivalente)).toBe(true);
  });
});

describe("455/R22 · R23 — codigoVigente (snapshots y URLs guardadas)", () => {
  it("traduce los 7 anteriores al vigente de la tabla §0.1, y deja pasar todo lo demas", () => {
    const anteriores = Object.keys(CODIGO_VIGENTE_DE_ANTERIOR);
    expect(anteriores).toHaveLength(7);
    for (const a of anteriores) {
      expect(esCodigoAnterior(a)).toBe(true);
      expect(esCodigoVigente(codigoVigente(a))).toBe(true);
    }
    // Los 7 vigentes de destino son EXACTAMENTE los que cambian en §0.1 (literal de contrato).
    expect(anteriores.map(codigoVigente).sort()).toEqual(
      [
        "entregado",
        "novedad",
        "reprogramado",
        "mensajero_recogiendo_en_bodega",
        "devolucion_a_origen_por_rechazo",
        "novedad_interna",
        "por_devolver_a_bodega_central",
      ].sort(),
    );
    expect(codigoVigente("en_reparto")).toBe("en_reparto");
    expect(codigoVigente("novedad")).toBe("novedad");
    expect(codigoVigente("cualquier_cosa")).toBe("cualquier_cosa");
  });
});

describe("455/R4 · R33 — el resultado se llama como su estado destino", () => {
  const CINCO: GestionResultado[] = ["entregado", "reprogramado", "novedad", "devolucion_a_origen_por_rechazo", "incidente"];

  it("R4: el nombre del resultado es el del estado homonimo (§0.2)", () => {
    expect(CINCO.map(nombreDeResultado)).toEqual([
      "Entregado",
      "Reprogramado",
      "Novedad",
      "Devolución a origen por rechazo",
      "Incidente",
    ]);
  });

  it("ESTATUS_POR_RESULTADO es la identidad", () => {
    for (const r of CINCO) expect(ESTATUS_POR_RESULTADO[r]).toBe(r);
  });

  it("R33: la señal pendiente es «<nombre> · pendiente de confirmación»", () => {
    expect(SENAL_PENDIENTE("novedad")).toBe("Novedad · pendiente de confirmación");
    expect(SENAL_PENDIENTE("devolucion_a_origen_por_rechazo")).toBe(
      "Devolución a origen por rechazo · pendiente de confirmación",
    );
  });
});
