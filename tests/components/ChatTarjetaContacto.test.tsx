// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

import { TarjetaContacto } from "@/app/(app)/mis-asignaciones/_components/chat/TarjetaContacto";
import type { ChatContactoNormalizado } from "@/lib/types/chat-contactos";

// Feature 308 (R31, D5) — la tarjeta de un contacto compartido.
//
// Lo que se fija aqui: se ven los datos, CADA dato se copia por separado (el mensajero necesita
// el telefono, no la tarjeta entera) y la confirmacion es PERCEPTIBLE sin depender de una
// animacion: un `role="status"`. En las maquinas del equipo `prefers-reduced-motion: reduce`
// esta activo, asi que una confirmacion animada seria invisible.

const writeText = vi.fn<(texto: string) => Promise<void>>();

const CONTACTO: ChatContactoNormalizado = {
  nombre: "Ana Rojas",
  telefonos: [{ valor: "+50688887777", tipo: "CELL" }],
  correos: [{ valor: "ana@example.com", tipo: "WORK" }],
  direcciones: ["Calle 5, San José"],
  organizacion: "Panadería Rojas",
  urls: ["https://panaderia.example.com"],
};

beforeEach(() => {
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
    writable: true,
  });
});

afterEach(cleanup);

describe("TarjetaContacto (R31)", () => {
  it("R31: muestra nombre, organizacion, telefono, correo, direccion y enlace", () => {
    render(<TarjetaContacto contactos={[CONTACTO]} />);

    expect(screen.getByText("Ana Rojas")).toBeInTheDocument();
    expect(screen.getByText("Panadería Rojas")).toBeInTheDocument();
    expect(screen.getByText("+50688887777")).toBeInTheDocument();
    expect(screen.getByText("ana@example.com")).toBeInTheDocument();
    expect(screen.getByText("Calle 5, San José")).toBeInTheDocument();
    expect(screen.getByText("https://panaderia.example.com")).toBeInTheDocument();
  });

  it("R31: al pulsar Copiar telefono se copia EXACTAMENTE ese valor", async () => {
    render(<TarjetaContacto contactos={[CONTACTO]} />);

    fireEvent.click(screen.getByRole("button", { name: /Copiar teléfono/i }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText).toHaveBeenCalledWith("+50688887777");
  });

  it("R31: cada dato tiene SU boton y copia su propio valor (no la tarjeta entera)", async () => {
    render(<TarjetaContacto contactos={[CONTACTO]} />);

    fireEvent.click(screen.getByRole("button", { name: /Copiar correo/i }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("ana@example.com"));

    fireEvent.click(screen.getByRole("button", { name: /Copiar dirección/i }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("Calle 5, San José"));

    expect(screen.getAllByRole("button", { name: /^Copiar/i })).toHaveLength(4);
  });

  it("R31: la confirmacion aparece en un role=status (perceptible sin animacion)", async () => {
    render(<TarjetaContacto contactos={[CONTACTO]} />);

    // La region viva existe DESDE EL PRIMER RENDER: si naciera con el mensaje, el lector de
    // pantalla no tendria nada que observar y no lo anunciaria.
    const region = screen.getByRole("status");
    expect(region.textContent).toBe("");

    fireEvent.click(screen.getByRole("button", { name: /Copiar teléfono/i }));

    await waitFor(() => expect(region).toHaveTextContent(/copiado/i));
  });

  it("R31: si el portapapeles falla se dice, y NO se anuncia un copiado que no ocurrio", async () => {
    writeText.mockRejectedValue(new Error("denegado"));
    render(<TarjetaContacto contactos={[CONTACTO]} />);

    fireEvent.click(screen.getByRole("button", { name: /Copiar teléfono/i }));

    const region = screen.getByRole("status");
    await waitFor(() => expect(region).toHaveTextContent(/no se pudo copiar/i));
  });

  it("R31: con varios telefonos cada boton copia el suyo", async () => {
    render(
      <TarjetaContacto
        contactos={[
          {
            ...CONTACTO,
            telefonos: [
              { valor: "+50688887777", tipo: "CELL" },
              { valor: "+50622223333", tipo: "HOME" },
            ],
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copiar teléfono +50622223333" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("+50622223333"));
  });
});
