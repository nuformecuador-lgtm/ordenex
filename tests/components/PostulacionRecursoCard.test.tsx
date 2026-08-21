// @vitest-environment jsdom
// Feature 253 (T7.1) — la tarjeta de UNA postulación de vehículo o bodega en el panel del admin.
// Cubre R29 (los seis datos) y la mitad presentacional de R31/R33 (quién atendió y cuándo).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PostulacionRecursoCard } from "@/app/(app)/_components/PostulacionRecursoCard";
import type { PostulacionRecursoDTO } from "@/lib/types/postulacion-recurso";

/**
 * Un mensaje LARGO a propósito: R29 pide el mensaje **completo**, y es lo único que describe el
 * vehículo o la bodega. Si alguien mete un `line-clamp` o un `slice`, este caso lo caza.
 */
const MENSAJE_LARGO =
  "Tengo un camión Hino de 4 toneladas, modelo 2019, con cajón cerrado y rampa. " +
  "Está en Heredia centro y puedo trabajar de lunes a sábado, de 6 a. m. a 4 p. m. " +
  "También manejo yo mismo y tengo licencia B3 al día.";

function postulacion(
  overrides: Partial<PostulacionRecursoDTO> = {},
): PostulacionRecursoDTO {
  return {
    id: "p1",
    tipo: "vehiculo",
    nombre: "Ana Solís",
    telefono: "+506 8888-8888",
    correo: "ana.solis@example.com",
    mensaje: MENSAJE_LARGO,
    createdAt: "2026-08-20T15:30:00.000Z",
    atendidaAt: null,
    atendidaPor: null,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe("253/R29 — la tarjeta muestra los seis datos que hacen falta para llamar", () => {
  it("tipo, nombre, teléfono, correo, el mensaje COMPLETO y la fecha en que llegó", () => {
    render(<PostulacionRecursoCard postulacion={postulacion()} onAtender={vi.fn()} />);

    const tarjeta = screen.getByTestId("postulacion-recurso-p1");
    expect(within(tarjeta).getByText("Vehículo")).toBeInTheDocument();
    expect(within(tarjeta).getByText("Ana Solís")).toBeInTheDocument();
    expect(within(tarjeta).getByText("+506 8888-8888")).toBeInTheDocument();
    expect(within(tarjeta).getByText("ana.solis@example.com")).toBeInTheDocument();
    // El mensaje ENTERO, carácter por carácter: nada de recortes.
    expect(within(tarjeta).getByText(MENSAJE_LARGO)).toBeInTheDocument();
  });

  it("la fecha se pinta en la zona de Costa Rica, no en la del dispositivo ni en UTC", () => {
    // 15:30 UTC son las 9:30 a. m. en Costa Rica (UTC-6). Si alguien quita el `timeZone`, esta
    // aserción cambia con la máquina que corra la suite, que es exactamente lo que no queremos.
    render(<PostulacionRecursoCard postulacion={postulacion()} />);

    const fecha = screen.getByText(/20 ago 2026/);
    expect(fecha).toHaveTextContent("9:30");
    // El valor exacto viaja intacto en el atributo, para quien lo lea con una herramienta.
    expect(fecha).toHaveAttribute("datetime", "2026-08-20T15:30:00.000Z");
  });

  it("una bodega se etiqueta como bodega (D1: mezcladas, con el tipo bien visible)", () => {
    render(<PostulacionRecursoCard postulacion={postulacion({ tipo: "bodega" })} />);
    expect(screen.getByText("Bodega")).toBeInTheDocument();
    expect(screen.queryByText("Vehículo")).toBeNull();
  });

  it("el botón «Marcar como atendida» avisa al panel con la postulación entera", async () => {
    const onAtender = vi.fn();
    const user = userEvent.setup();
    const p = postulacion();
    render(<PostulacionRecursoCard postulacion={p} onAtender={onAtender} />);

    await user.click(screen.getByRole("button", { name: "Marcar como atendida" }));
    expect(onAtender).toHaveBeenCalledWith(p);
  });

  it("sin `onAtender` NO se pinta ningún botón: en la pestaña de atendidas no hay nada que hacer", () => {
    render(<PostulacionRecursoCard postulacion={postulacion()} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("R31/R33 — una atendida dice QUIÉN la atendió y CUÁNDO", () => {
    render(
      <PostulacionRecursoCard
        postulacion={postulacion({
          atendidaAt: "2026-08-21T18:00:00.000Z",
          atendidaPor: "Marta Vega",
        })}
      />,
    );

    // Sin esas dos cosas, «atendida» no responde a la única pregunta que se hace al mirar aquí:
    // ¿a esta persona la llamó alguien?
    const linea = screen.getByText(/Atendida por Marta Vega el/);
    expect(linea).toHaveTextContent("21 ago 2026");
    expect(linea).toHaveTextContent("12:00");
  });
});
