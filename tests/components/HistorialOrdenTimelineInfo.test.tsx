// @vitest-environment jsdom
// FICHA 456 (T3.3, design §5.1 fila 4/§8; R9, R10, R12, R15) — la línea de tiempo: origen y destino
// de cada transición con su botón; el evento registrado con botón en su resultado; el corregido, en
// el anterior y en el nuevo; la ayuda con el de la nota. «Creación» y un retirado, sin botón.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

import { HistorialOrdenTimeline } from "@/app/(app)/ordenes/_components/HistorialOrdenTimeline";
import type { OrdenHistorialEntradaDTO } from "@/lib/types/orden-historial";

afterEach(() => cleanup());

const nombres = (el: HTMLElement) =>
  within(el)
    .queryAllByRole("button")
    .map((b) => b.getAttribute("aria-label"));

const T = new Date("2026-09-23T15:00:00Z");

function transicion(origen: string | null, destino: string): OrdenHistorialEntradaDTO {
  return {
    clase: "transicion",
    estatusOrigenValue: origen,
    estatusDestinoValue: destino,
    actorNombre: "Ana",
    motivo: null,
    createdAt: T,
  } as OrdenHistorialEntradaDTO;
}

function evento(tipo: string, resultado: string | null, anterior: string | null = null): OrdenHistorialEntradaDTO {
  return {
    clase: "evento_orden",
    tipo,
    resultado,
    resultadoAnterior: anterior,
    actorNombre: "Carlos",
    actorRol: "mensajero",
    createdAt: T,
  } as OrdenHistorialEntradaDTO;
}

function filas(entradas: OrdenHistorialEntradaDTO[]) {
  render(<HistorialOrdenTimeline entradas={entradas} />);
  return within(screen.getByRole("list", { name: "Línea de tiempo de la orden" })).getAllByRole("listitem");
}

describe("456 · línea de tiempo", () => {
  it("R9 — transición: botón en el origen y en el destino", () => {
    const [f] = filas([transicion("en_bodega_central", "en_reparto")]);
    expect(nombres(f)).toEqual(["Qué significa «En bodega central»", "Qué significa «En reparto»"]);
  });

  it("R15 — «Creación» y un origen retirado van sin botón; el destino, con él", () => {
    const [c, r] = filas([transicion(null, "en_preparacion"), transicion("devolucion_por_confirmar", "novedad")]);
    expect(within(c).getByText("Creación")).toBeTruthy();
    expect(nombres(c)).toEqual(["Qué significa «En preparación»"]);
    expect(within(r).getByText("Devolución por confirmar (estado retirado)")).toBeTruthy();
    expect(nombres(r)).toEqual(["Qué significa «Novedad»"]);
  });

  it("R10 — gestión registrada: botón en su resultado; corregida: en el anterior y en el nuevo", () => {
    const [reg, cor] = filas([
      evento("gestion_registrada", "entregado"),
      evento("gestion_corregida", "devolucion_a_origen_por_rechazo", "entregado"),
    ]);
    expect(within(reg).getByText("Resultado: Entregado")).toBeTruthy();
    expect(nombres(reg)).toEqual(["Qué significa «Entregado»"]);
    expect(within(cor).getByText("De Entregado a Devolución a origen por rechazo")).toBeTruthy();
    expect(nombres(cor)).toEqual(["Qué significa «Entregado»", "Qué significa «Devolución a origen por rechazo»"]);
  });

  it("R12 — la ayuda solicitada lleva el botón de la nota; su cierre no", () => {
    const [ida, vuelta] = filas([evento("ayuda_solicitada", null), evento("ayuda_rescatada", null)]);
    expect(within(ida).getByText("Ayuda solicitada a la tienda")).toBeTruthy();
    expect(nombres(ida)).toEqual(["Qué significa «Ayuda solicitada a la tienda»"]);
    expect(nombres(vuelta)).toEqual([]);
  });
});
