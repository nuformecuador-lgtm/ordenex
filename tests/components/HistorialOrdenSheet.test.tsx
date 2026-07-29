// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { HistorialOrdenSheet } from "@/app/(app)/ordenes/_components/HistorialOrdenSheet";
import { ORDER_STATUS_LABELS } from "@/app/(app)/ordenes/_components/EstatusBadge";
import type { ObtenerHistorialOrdenResult } from "@/lib/actions/orden-historial";
import type { OrdenHistorialEntradaDTO } from "@/lib/types/orden-historial";

// R30: lo que se verifica es "se muestra la ETIQUETA legible del estado, no el
// value crudo". Se aserta contra el mapa de presentación (fuente de verdad) en vez
// de un literal, para que un rebrand de etiquetas no rompa estos tests. Los
// literales del mapa los blinda `tests/components/EstatusLabel.test.ts`.
const LABEL_DESTINO = ORDER_STATUS_LABELS.en_bodega_central;

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
  estatusDestinoValue: "en_bodega_central",
  origenTipo: "liberacion_reprogramada",
  actorNombre: null,
  motivo: null,
  createdAt: new Date("2026-01-03T08:00:00Z"),
};

// Feature 47 (R15/R17): el `ok` de la Server Action expone ahora el conteo de
// intentos DERIVADO (`intentos`) y el `umbral` configurable. Helper para armar el
// `ok` sin repetir el shape en cada caso.
function okResult(
  overrides: Partial<
    Extract<ObtenerHistorialOrdenResult, { status: "ok" }>
  > = {},
): Extract<ObtenerHistorialOrdenResult, { status: "ok" }> {
  return { status: "ok", entradas: [ENTRADA], intentos: 0, umbral: 3, ...overrides };
}

function fakeAction(result: ObtenerHistorialOrdenResult) {
  return vi.fn(async (): Promise<ObtenerHistorialOrdenResult> => result);
}

describe("HistorialOrdenSheet (feature 49, R28/R29)", () => {
  it("cerrado por defecto: no monta el diálogo ni consulta el historial hasta abrir", () => {
    const obtenerHistorial = fakeAction(okResult());
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
    const obtenerHistorial = fakeAction(okResult());

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
    expect(await within(dialog).findByText(LABEL_DESTINO)).toBeInTheDocument();
    expect(within(dialog).queryByText("en_bodega_central")).toBeNull();

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

// Feature 47 (T4.2) — badge "Intento X de N" del conteo de intentos de entrega.
// Cubre R15 (se muestra cuántos intentos lleva la orden), R16 (SOLO cuando hay >= 1
// devolución; con `intentos === 0` no se pinta), R17 (la visibilidad la hereda del
// `ok`; forbidden/not_found no llegan a `ok`, así que no aparece el badge) y R22
// (cada regla mapeada a un test).
describe("HistorialOrdenSheet — badge 'Intento X de N' (feature 47, R15/R16/R17)", () => {
  async function abrir(
    obtenerHistorial: (ordenId: string) => Promise<ObtenerHistorialOrdenResult>,
  ) {
    const user = userEvent.setup();
    render(<HistorialOrdenSheet ordenId="o1" obtenerHistorial={obtenerHistorial} />);
    await user.click(
      screen.getByRole("button", { name: /Ver historial de la orden/i }),
    );
    return screen.findByRole("dialog");
  }

  it("R15/R16: ok con intentos=3 y umbral=3 muestra 'Intento 3 de 3'", async () => {
    const dialog = await abrir(fakeAction(okResult({ intentos: 3, umbral: 3 })));

    expect(await within(dialog).findByText("Intento 3 de 3")).toBeInTheDocument();
    // Accesible por el label del status (R16: etiqueta legible, sin UUIDs).
    expect(
      within(dialog).getByRole("status", { name: /Intentos de entrega/i }),
    ).toBeInTheDocument();
  });

  it("R15/R16: ok con intentos=1 y umbral=3 muestra 'Intento 1 de 3'", async () => {
    const dialog = await abrir(fakeAction(okResult({ intentos: 1, umbral: 3 })));

    expect(await within(dialog).findByText("Intento 1 de 3")).toBeInTheDocument();
    // Sigue mostrando la línea de tiempo (la superficie de la 49 se conserva).
    expect(await within(dialog).findByText(LABEL_DESTINO)).toBeInTheDocument();
  });

  it("R16: ok con intentos=0 NO muestra el badge (orden sin devoluciones)", async () => {
    const dialog = await abrir(fakeAction(okResult({ intentos: 0, umbral: 3 })));

    // El timeline sí aparece; el badge de intentos NO.
    expect(await within(dialog).findByText(LABEL_DESTINO)).toBeInTheDocument();
    expect(within(dialog).queryByText(/^Intento \d+ de \d+$/)).toBeNull();
    expect(
      within(dialog).queryByRole("status", { name: /Intentos de entrega/i }),
    ).toBeNull();
  });

  it("R17: 'forbidden' no muestra el badge (hereda la autorización del ok)", async () => {
    const dialog = await abrir(fakeAction({ status: "forbidden" }));

    await within(dialog).findByText("No tienes acceso al historial de esta orden.");
    expect(within(dialog).queryByText(/^Intento \d+ de \d+$/)).toBeNull();
    expect(
      within(dialog).queryByRole("status", { name: /Intentos de entrega/i }),
    ).toBeNull();
  });

  it("R17: 'not_found' no muestra el badge (hereda la autorización del ok)", async () => {
    const dialog = await abrir(fakeAction({ status: "not_found" }));

    await within(dialog).findByText("Orden no encontrada.");
    expect(within(dialog).queryByText(/^Intento \d+ de \d+$/)).toBeNull();
    expect(
      within(dialog).queryByRole("status", { name: /Intentos de entrega/i }),
    ).toBeNull();
  });
});
