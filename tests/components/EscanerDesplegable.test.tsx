// @vitest-environment jsdom
import { useEffect } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { EscanerDesplegable } from "@/components/shared/EscanerDesplegable";

// El disparador de la tarjeta de escaneo: la pliega y la despliega. Lo que se fija aquí es
// el CONTRATO (texto del disparador, montaje/desmontaje del panel y las acciones que lo
// acompañan). La animación en sí es CSS (`.collapsible-panel` en globals.css) y jsdom no la
// ejecuta: lo comprobable es que el panel la lleva puesta.
//
// Este archivo viene de `ReceptorDesplegable.test.tsx`: el componente se promovió a
// `components/shared/` el 2026-07-31 para que TODAS las superficies de escaneo compartan el
// mismo envoltorio, y perdió el nombre y los textos por defecto de `/ordenes` («receptor»
// es vocabulario de esa pantalla; en `/recoleccion` no se recibe, se recolecta).

afterEach(() => cleanup());

describe("EscanerDesplegable", () => {
  it("arranca plegado: el contenido no está montado", () => {
    render(
      <EscanerDesplegable label="Recibir paquete" labelAbierto="Ocultar escáner">
        <p>tarjeta de escaneo</p>
      </EscanerDesplegable>,
    );

    expect(
      screen.getByRole("button", { name: /Recibir paquete/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText("tarjeta de escaneo")).toBeNull();
  });

  it("al pulsar despliega el contenido y cambia el texto del disparador", async () => {
    const user = userEvent.setup();
    render(
      <EscanerDesplegable label="Recibir paquete" labelAbierto="Ocultar escáner">
        <p>tarjeta de escaneo</p>
      </EscanerDesplegable>,
    );

    await user.click(screen.getByRole("button", { name: /Recibir paquete/ }));

    expect(screen.getByText("tarjeta de escaneo")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Ocultar escáner/ }),
    ).toBeInTheDocument();
  });

  it("cada superficie nombra su propio acto en el disparador", async () => {
    const user = userEvent.setup();
    render(
      <EscanerDesplegable
        label="Recolectar en tienda"
        labelAbierto="Ocultar escáner"
      >
        <p>tarjeta de escaneo</p>
      </EscanerDesplegable>,
    );

    // Los textos NO tienen valor por defecto a propósito: `/recoleccion` no puede heredar
    // en silencio el "Recibir paquete" de `/ordenes`, que nombra otro acto.
    const disparador = screen.getByRole("button", {
      name: /Recolectar en tienda/,
    });
    await user.click(disparador);

    expect(
      screen.getByRole("button", { name: /Ocultar escáner/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Recibir paquete/ })).toBeNull();
  });

  it("el panel lleva la clase que lo anima al abrir y cerrar", async () => {
    const user = userEvent.setup();
    render(
      <EscanerDesplegable label="Recibir paquete" labelAbierto="Ocultar escáner">
        <p>tarjeta de escaneo</p>
      </EscanerDesplegable>,
    );

    await user.click(screen.getByRole("button", { name: /Recibir paquete/ }));

    const panel = screen.getByText("tarjeta de escaneo").parentElement
      ?.parentElement;
    expect(panel).toHaveClass("collapsible-panel");
  });

  it("las acciones acompañan al disparador y no dependen de que esté abierto", () => {
    render(
      <EscanerDesplegable
        label="Recibir paquete"
        labelAbierto="Ocultar escáner"
        acciones={<button type="button">Carga masiva</button>}
      >
        <p>tarjeta de escaneo</p>
      </EscanerDesplegable>,
    );

    expect(
      screen.getByRole("button", { name: "Carga masiva" }),
    ).toBeInTheDocument();
  });

  it("al cerrar, el contenido se DESMONTA (no queda oculto con la cámara viva)", async () => {
    const user = userEvent.setup();
    render(
      <EscanerDesplegable label="Recibir paquete" labelAbierto="Ocultar escáner">
        <p>tarjeta de escaneo</p>
      </EscanerDesplegable>,
    );

    const disparador = screen.getByRole("button", { name: /Recibir paquete/ });
    await user.click(disparador);
    expect(screen.getByText("tarjeta de escaneo")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Ocultar escáner/ }));

    await vi.waitFor(() =>
      expect(screen.queryByText("tarjeta de escaneo")).toBeNull(),
    );
  });

  it("cerrar corre el CLEANUP del hijo: es lo que apaga la cámara", async () => {
    const user = userEvent.setup();
    const apagarCamara = vi.fn();
    // Doble mínimo de `QrScanner`: lo que apaga la cámara de verdad es el cleanup de su
    // efecto, y ese solo corre si el panel se DESMONTA. Si algún día el desplegable pasara
    // a ocultar el panel por CSS, el contenido seguiría vivo y este caso lo delataría —
    // que es exactamente el defecto que el desplegable vino a cerrar.
    function CamaraFalsa() {
      useEffect(() => apagarCamara, []);
      return <span>cámara</span>;
    }

    render(
      <EscanerDesplegable label="Recibir paquete" labelAbierto="Ocultar escáner">
        <CamaraFalsa />
      </EscanerDesplegable>,
    );

    // Plegado de entrada: la cámara ni siquiera llegó a montarse.
    expect(screen.queryByText("cámara")).toBeNull();

    await user.click(screen.getByRole("button", { name: /Recibir paquete/ }));
    expect(screen.getByText("cámara")).toBeInTheDocument();
    expect(apagarCamara).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /Ocultar escáner/ }));

    await vi.waitFor(() => expect(apagarCamara).toHaveBeenCalled());
    expect(screen.queryByText("cámara")).toBeNull();
  });
});
