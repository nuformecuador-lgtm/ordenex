// @vitest-environment jsdom
// FICHA 454 (T2.2, R29) — el DETALLE de la orden (drawer «Ver historial») dice lo mismo que su
// fila del listado: «<Resultado> · pendiente de confirmación» o «Ayuda solicitada a la tienda».
// Las dos señales llegan en el `ok` de `obtenerHistorialOrden` (leídas después de autorizar,
// `progress/impl_454_datos.md`); el drawer solo las pinta. La Server Action se inyecta por prop.
// Literales a mano.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { HistorialOrdenSheet } from "@/app/(app)/ordenes/_components/HistorialOrdenSheet";
import type { ObtenerHistorialOrdenResult } from "@/lib/actions/orden-historial";

afterEach(() => cleanup());

type Ok = Extract<ObtenerHistorialOrdenResult, { status: "ok" }>;

function ok(over: Partial<Ok>): Ok {
  return {
    status: "ok",
    entradas: [],
    intentos: 0,
    umbral: 3,
    gestionPendiente: null,
    ayudaAbierta: false,
    ...over,
  };
}

async function abrirCon(resultado: Ok): Promise<HTMLElement> {
  const user = userEvent.setup();
  render(
    <HistorialOrdenSheet
      ordenId="o1"
      referencia="REM-1"
      obtenerHistorial={vi.fn(async () => resultado)}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Ver historial de la orden REM-1" }));
  return screen.findByRole("dialog");
}

describe("454/R29 — el detalle de la orden pinta la nota de la gestión pendiente", () => {
  it("gestión pendiente: «Reprogramada · pendiente de confirmación»", async () => {
    const dialogo = await abrirCon(
      ok({
        gestionPendiente: {
          resultado: "reprogramado",
          registradaAt: "2026-09-23T21:00:00.000Z",
        },
      }),
    );
    expect(
      await within(dialogo).findByText("Reprogramada · pendiente de confirmación"),
    ).toBeInTheDocument();
  });

  it("ayuda abierta: «Ayuda solicitada a la tienda»", async () => {
    const dialogo = await abrirCon(ok({ ayudaAbierta: true }));
    expect(
      await within(dialogo).findByText("Ayuda solicitada a la tienda"),
    ).toBeInTheDocument();
  });

  it("sin señales: ninguna nota", async () => {
    const dialogo = await abrirCon(ok({ intentos: 1 }));
    // La espera es sobre el badge de intentos: prueba que el `ok` ya se pintó.
    expect(await within(dialogo).findByText("Intento 1 de 3")).toBeInTheDocument();
    expect(within(dialogo).queryByText(/pendiente de confirmación/)).toBeNull();
    expect(within(dialogo).queryByText("Ayuda solicitada a la tienda")).toBeNull();
  });
});
