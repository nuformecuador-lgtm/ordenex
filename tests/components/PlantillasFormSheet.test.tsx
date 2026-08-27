// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import { FormSheet } from "@/app/(app)/configuracion/plantillas/_components/FormSheet";

// Feature 288 — `FormSheet`: envoltura de `Sheet` para los formularios de plantillas.
// Replica la conducta de `Modal` con `closeOnConfirm={false}`: el ancho por props, el
// footer que no cierra solo tras confirmar, y el anti-doble-submit.

afterEach(() => {
  cleanup();
});

function Wrapper({
  onConfirm,
  anchoPorcentaje,
  anchoMinimoPx,
}: {
  onConfirm: () => void | Promise<void>;
  anchoPorcentaje?: number;
  anchoMinimoPx?: number;
}) {
  const [open, setOpen] = useState(true);
  return (
    <FormSheet
      open={open}
      onOpenChange={setOpen}
      title="Título de prueba"
      confirmLabel="Confirmar"
      onConfirm={onConfirm}
      anchoPorcentaje={anchoPorcentaje}
      anchoMinimoPx={anchoMinimoPx}
    >
      <p>Contenido</p>
    </FormSheet>
  );
}

// El ancho por props (`max(<pct>vw, <px>px)`) se cubre en
// `PlantillasFormSheetAncho.test.tsx`: jsdom/cssstyle no reconoce la función CSS
// `max()` como valor válido de `width` y descarta la asignación en el DOM real
// (queda en ""), así que ese archivo mockea `SheetContent` para capturar el objeto
// `style` tal cual lo arma `FormSheet`, sin pasar por la validación de jsdom.

describe("FormSheet — footer", () => {
  it("Cancelar no llama a onConfirm y dispara onOpenChange(false)", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <FormSheet
        open={true}
        onOpenChange={onOpenChange}
        title="Título de prueba"
        confirmLabel="Confirmar"
        onConfirm={onConfirm}
      >
        <p>Contenido</p>
      </FormSheet>,
    );
    await screen.findByText("Título de prueba");

    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("Confirmar no cierra solo: onConfirm resuelve ok y el sheet sigue abierto", async () => {
    const user = userEvent.setup();
    let resolveConfirm: () => void = () => {};
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveConfirm = resolve;
        }),
    );
    render(<Wrapper onConfirm={onConfirm} />);
    await screen.findByText("Título de prueba");

    await user.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    resolveConfirm();
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());

    // El sheet sigue montado/abierto: el cierre lo decide el padre, no `FormSheet`.
    expect(screen.getByText("Título de prueba")).toBeInTheDocument();
  });

  it("anti-doble-submit: dos clicks seguidos con onConfirm diferido llaman una sola vez", async () => {
    const user = userEvent.setup();
    let resolveConfirm: () => void = () => {};
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveConfirm = resolve;
        }),
    );
    render(<Wrapper onConfirm={onConfirm} />);
    await screen.findByText("Título de prueba");

    const boton = screen.getByRole("button", { name: "Confirmar" });
    await user.click(boton);
    await user.click(boton);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    resolveConfirm();
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });
});
