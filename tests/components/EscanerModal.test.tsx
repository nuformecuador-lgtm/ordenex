// @vitest-environment jsdom
import { useEffect } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { EscanerModal } from "@/components/shared/EscanerModal";

// El disparador de la tarjeta de escaneo: la abre en un MODAL y la cierra. Lo que se fija
// aquí es el CONTRATO (texto del disparador, montaje/desmontaje del contenido y las acciones
// que lo acompañan).
//
// Este archivo viene de `EscanerDesplegable.test.tsx` (y antes de `ReceptorDesplegable`): el
// 2026-08-10 el envoltorio pasó de plegarse en línea a abrirse en modal, y el texto del
// disparador ganó un valor por defecto ("Recibir paquete"). Lo que NO cambió es lo único que
// de verdad importa aquí: cerrar DESMONTA, que es lo que apaga la cámara.

afterEach(() => cleanup());

describe("EscanerModal", () => {
  it("arranca cerrado: el contenido no está montado", () => {
    render(
      <EscanerModal>
        <p>tarjeta de escaneo</p>
      </EscanerModal>,
    );

    expect(
      screen.getByRole("button", { name: /Recibir paquete/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText("tarjeta de escaneo")).toBeNull();
  });

  it("al pulsar abre el modal con el contenido dentro", async () => {
    const user = userEvent.setup();
    render(
      <EscanerModal>
        <p>tarjeta de escaneo</p>
      </EscanerModal>,
    );

    await user.click(screen.getByRole("button", { name: /Recibir paquete/ }));

    const modal = await screen.findByRole("dialog");
    expect(modal).toHaveAccessibleName("Recibir paquete");
    expect(screen.getByText("tarjeta de escaneo")).toBeInTheDocument();
  });

  it("cada superficie puede nombrar su propio acto en el disparador", async () => {
    const user = userEvent.setup();
    render(
      <EscanerModal label="Recolectar en tienda">
        <p>tarjeta de escaneo</p>
      </EscanerModal>,
    );

    // El valor por defecto es "Recibir paquete", el acto de las superficies de recepción.
    // `/recoleccion` no recibe: pasa el suyo y no hereda el vocabulario ajeno.
    expect(screen.queryByRole("button", { name: /Recibir paquete/ })).toBeNull();
    await user.click(
      screen.getByRole("button", { name: /Recolectar en tienda/ }),
    );

    expect(await screen.findByRole("dialog")).toHaveAccessibleName(
      "Recolectar en tienda",
    );
  });

  it("las acciones acompañan al disparador y no dependen de que esté abierto", () => {
    render(
      <EscanerModal acciones={<button type="button">Carga masiva</button>}>
        <p>tarjeta de escaneo</p>
      </EscanerModal>,
    );

    expect(
      screen.getByRole("button", { name: "Carga masiva" }),
    ).toBeInTheDocument();
  });

  it("al cerrar, el contenido se DESMONTA (no queda oculto con la cámara viva)", async () => {
    const user = userEvent.setup();
    render(
      <EscanerModal>
        <p>tarjeta de escaneo</p>
      </EscanerModal>,
    );

    await user.click(screen.getByRole("button", { name: /Recibir paquete/ }));
    expect(await screen.findByText("tarjeta de escaneo")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Cerrar/ }));

    await vi.waitFor(() =>
      expect(screen.queryByText("tarjeta de escaneo")).toBeNull(),
    );
  });

  it("cerrar corre el CLEANUP del hijo: es lo que apaga la cámara", async () => {
    const user = userEvent.setup();
    const apagarCamara = vi.fn();
    // Doble mínimo de `QrScanner`: lo que apaga la cámara de verdad es el cleanup de su
    // efecto, y ese solo corre si el contenido se DESMONTA. Si algún día el modal pasara a
    // quedarse montado (`keepMounted`), el contenido seguiría vivo y este caso lo delataría
    // — que es exactamente el defecto que este envoltorio vino a cerrar.
    function CamaraFalsa() {
      useEffect(() => apagarCamara, []);
      return <span>cámara</span>;
    }

    render(
      <EscanerModal>
        <CamaraFalsa />
      </EscanerModal>,
    );

    // Cerrado de entrada: la cámara ni siquiera llegó a montarse.
    expect(screen.queryByText("cámara")).toBeNull();

    await user.click(screen.getByRole("button", { name: /Recibir paquete/ }));
    expect(await screen.findByText("cámara")).toBeInTheDocument();
    expect(apagarCamara).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /Cerrar/ }));

    await vi.waitFor(() => expect(apagarCamara).toHaveBeenCalled());
    expect(screen.queryByText("cámara")).toBeNull();
  });
});
