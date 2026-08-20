// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CeldaSeleccion } from "@/components/shared/CeldaSeleccion";

// Pedido humano (2026-08-19): en el DataTable, una fila bloqueada NO pinta checkbox —
// pinta un aviso «!» con el motivo en un tooltip. La regla es del componente y no de un
// listado concreto, así que se prueba aquí: cualquier tabla que pase un motivo la hereda.

const MOTIVO = "Orden de zona satélite: la recupera el admin de su bodega.";

afterEach(cleanup);

describe("CeldaSeleccion — sin bloqueo", () => {
  it("pinta el checkbox y propaga el toggle", async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(
      <CeldaSeleccion
        checked={false}
        onCheckedChange={onCheckedChange}
        ariaLabel="Seleccionar orden REM-1"
      />,
    );

    const casilla = screen.getByRole("checkbox", { name: "Seleccionar orden REM-1" });
    await user.click(casilla);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it("`bloqueo: null` es «se puede marcar», no un bloqueo sin texto", () => {
    render(
      <CeldaSeleccion
        checked
        onCheckedChange={vi.fn()}
        bloqueo={null}
        ariaLabel="Seleccionar orden REM-1"
      />,
    );
    expect(screen.getByRole("checkbox")).toBeInTheDocument();
  });
});

describe("CeldaSeleccion — con bloqueo", () => {
  it("NO pinta checkbox: en su lugar va el aviso, y el motivo es su nombre accesible", () => {
    render(
      <CeldaSeleccion
        checked={false}
        onCheckedChange={vi.fn()}
        bloqueo={MOTIVO}
        ariaLabel="Seleccionar orden REM-2"
      />,
    );

    // La ausencia es la mitad del pedido: una casilla deshabilitada se lee como «esto no
    // funciona», y por eso no basta con comprobar que el aviso está.
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByRole("img", { name: MOTIVO })).toBeInTheDocument();
  });

  it("el motivo se muestra al apuntar, y el aviso es enfocable con el teclado", async () => {
    const user = userEvent.setup();
    render(
      <CeldaSeleccion
        checked={false}
        onCheckedChange={vi.fn()}
        bloqueo={MOTIVO}
        ariaLabel="Seleccionar orden REM-2"
      />,
    );

    const aviso = screen.getByRole("img", { name: MOTIVO });
    aviso.focus();
    expect(aviso).toHaveFocus();

    await user.hover(aviso);
    // El texto aparece en el tooltip (además del nombre accesible del propio icono).
    expect(await screen.findAllByText(MOTIVO)).not.toHaveLength(0);
  });

  it("`bloqueoAriaLabel` nombra la fila; el tooltip sigue diciendo el motivo", () => {
    render(
      <CeldaSeleccion
        checked={false}
        onCheckedChange={vi.fn()}
        bloqueo={MOTIVO}
        ariaLabel="Seleccionar orden REM-2"
        bloqueoAriaLabel={`No se puede seleccionar la orden REM-2: ${MOTIVO}`}
      />,
    );

    // El motivo solo no dice de qué fila habla, y en una tabla de 25 filas eso importa.
    expect(
      screen.getByRole("img", { name: `No se puede seleccionar la orden REM-2: ${MOTIVO}` }),
    ).toBeInTheDocument();
  });

  it("un bloqueo VACÍO no oculta la casilla: sin motivo que dar, no hay nada que explicar", () => {
    render(
      <CeldaSeleccion
        checked={false}
        onCheckedChange={vi.fn()}
        bloqueo=""
        ariaLabel="Seleccionar orden REM-3"
      />,
    );
    expect(screen.getByRole("checkbox")).toBeInTheDocument();
  });
});
