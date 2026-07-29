// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ReceptorDesplegable } from "@/app/(app)/ordenes/_components/ReceptorDesplegable";

// El disparador del receptor: pliega y despliega la tarjeta de escaneo. Lo que se fija
// aquí es el CONTRATO (texto del disparador, montaje/desmontaje del panel y las
// acciones que lo acompañan). La animación en sí es CSS (`.collapsible-panel` en
// globals.css) y jsdom no la ejecuta: lo comprobable es que el panel la lleva puesta.

afterEach(() => cleanup());

describe("ReceptorDesplegable", () => {
  it("arranca plegado: el contenido no está montado", () => {
    render(
      <ReceptorDesplegable>
        <p>tarjeta del receptor</p>
      </ReceptorDesplegable>,
    );

    expect(
      screen.getByRole("button", { name: /Recibir paquete/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText("tarjeta del receptor")).toBeNull();
  });

  it("al pulsar despliega el contenido y cambia el texto del disparador", async () => {
    const user = userEvent.setup();
    render(
      <ReceptorDesplegable>
        <p>tarjeta del receptor</p>
      </ReceptorDesplegable>,
    );

    await user.click(screen.getByRole("button", { name: /Recibir paquete/ }));

    expect(screen.getByText("tarjeta del receptor")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Ocultar receptor/ }),
    ).toBeInTheDocument();
  });

  it("el disparador acepta su propio texto cuando no es 'Recibir paquete'", async () => {
    const user = userEvent.setup();
    render(
      <ReceptorDesplegable label="Recibir devolución" labelAbierto="Ocultar">
        <p>tarjeta del receptor</p>
      </ReceptorDesplegable>,
    );

    const disparador = screen.getByRole("button", { name: /Recibir devolución/ });
    await user.click(disparador);

    expect(screen.getByRole("button", { name: /Ocultar/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Recibir paquete/ })).toBeNull();
  });

  it("el panel lleva la clase que lo anima al abrir y cerrar", async () => {
    const user = userEvent.setup();
    render(
      <ReceptorDesplegable>
        <p>tarjeta del receptor</p>
      </ReceptorDesplegable>,
    );

    await user.click(screen.getByRole("button", { name: /Recibir paquete/ }));

    const panel = screen.getByText("tarjeta del receptor").parentElement
      ?.parentElement;
    expect(panel).toHaveClass("collapsible-panel");
  });

  it("las acciones acompañan al disparador y no dependen de que esté abierto", () => {
    render(
      <ReceptorDesplegable acciones={<button type="button">Carga masiva</button>}>
        <p>tarjeta del receptor</p>
      </ReceptorDesplegable>,
    );

    expect(
      screen.getByRole("button", { name: "Carga masiva" }),
    ).toBeInTheDocument();
  });

  it("al cerrar, el contenido se DESMONTA (no queda oculto con la cámara viva)", async () => {
    const user = userEvent.setup();
    render(
      <ReceptorDesplegable>
        <p>tarjeta del receptor</p>
      </ReceptorDesplegable>,
    );

    const disparador = screen.getByRole("button", { name: /Recibir paquete/ });
    await user.click(disparador);
    expect(screen.getByText("tarjeta del receptor")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Ocultar receptor/ }));

    await vi.waitFor(() =>
      expect(screen.queryByText("tarjeta del receptor")).toBeNull(),
    );
  });
});
