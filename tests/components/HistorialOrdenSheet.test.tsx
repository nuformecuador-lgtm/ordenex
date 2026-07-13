// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { HistorialOrdenSheet } from "@/app/(app)/ordenes/_components/HistorialOrdenSheet";
import type { ObtenerHistorialOrdenResult } from "@/lib/actions/orden-historial";
import type { OrdenHistorialEntradaDTO } from "@/lib/types/orden-historial";

// Feature 49 (T6.2) — drawer "Ver historial". Cubre R28 (la lectura corre en el servidor via
// Server Action; el drawer NO fetchea datos sensibles con fetch a la API) y R29 (al abrir se
// muestra el timeline; sin visibilidad -> mensaje de acceso). La Server Action se INYECTA por
// prop (patrón de deps de los bordes del repo), sin tocar el borde real.

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ENTRADA: OrdenHistorialEntradaDTO = {
  estatusOrigenValue: "en_reparto",
  estatusDestinoValue: "en_bodega",
  origenTipo: "liberacion_reprogramada",
  actorNombre: null,
  motivo: null,
  createdAt: new Date("2026-01-03T08:00:00Z"),
};

function fakeAction(result: ObtenerHistorialOrdenResult) {
  return vi.fn(async (): Promise<ObtenerHistorialOrdenResult> => result);
}

describe("HistorialOrdenSheet (feature 49, R28/R29)", () => {
  it("cerrado por defecto: no monta el diálogo ni consulta el historial hasta abrir", () => {
    const obtenerHistorial = fakeAction({ status: "ok", entradas: [ENTRADA] });
    render(
      <HistorialOrdenSheet
        ordenId="o1"
        referencia="REM-1"
        obtenerHistorial={obtenerHistorial}
      />,
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(obtenerHistorial).not.toHaveBeenCalled();
  });

  it("R28/R29: al abrir consulta la Server Action (sin fetch a la API) y muestra el timeline", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("fetch no debe usarse"));
    const obtenerHistorial = fakeAction({ status: "ok", entradas: [ENTRADA] });

    render(
      <HistorialOrdenSheet
        ordenId="o1"
        referencia="REM-1"
        obtenerHistorial={obtenerHistorial}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: /Ver historial de la orden/i }),
    );

    const dialog = await screen.findByRole("dialog");
    // Título con la referencia legible.
    expect(within(dialog).getByText("Historial de la orden REM-1")).toBeInTheDocument();
    // Timeline con la etiqueta legible del estado destino (R30) — no el value crudo.
    expect(await within(dialog).findByText("En bodega")).toBeInTheDocument();
    expect(within(dialog).queryByText("en_bodega")).toBeNull();

    // R28: la lectura pasó por la Server Action inyectada, con la ordenId de la fila.
    expect(obtenerHistorial).toHaveBeenCalledTimes(1);
    expect(obtenerHistorial).toHaveBeenCalledWith("o1");
    // R28: nunca se hace fetch a rutas de API del proyecto.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("R29/R27: con 'forbidden' muestra el mensaje de acceso, sin timeline", async () => {
    const user = userEvent.setup();
    const obtenerHistorial = fakeAction({ status: "forbidden" });

    render(
      <HistorialOrdenSheet ordenId="o9" obtenerHistorial={obtenerHistorial} />,
    );

    await user.click(
      screen.getByRole("button", { name: /Ver historial de la orden/i }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(
      await within(dialog).findByText("No tienes acceso al historial de esta orden."),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole("listitem")).toBeNull();
    expect(obtenerHistorial).toHaveBeenCalledWith("o9");
  });
});
