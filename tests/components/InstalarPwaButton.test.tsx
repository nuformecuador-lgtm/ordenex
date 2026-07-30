// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { InstalarPwaButton } from "@/components/shared/InstalarPwaButton";

// Feature 164 — botón de instalar la PWA. El evento `beforeinstallprompt` es propietario de
// Chromium y jsdom no lo emite: se simula despachando un `Event` con la forma que el
// navegador entrega (`prompt` + `userChoice`), que es exactamente la superficie que consume
// el hook.

interface OfertaFalsa extends Event {
  prompt: ReturnType<typeof vi.fn>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function crearOferta(
  outcome: "accepted" | "dismissed" = "accepted",
): OfertaFalsa {
  const evento = new Event("beforeinstallprompt", {
    cancelable: true,
  }) as OfertaFalsa;
  evento.prompt = vi.fn(() => Promise.resolve());
  evento.userChoice = Promise.resolve({ outcome });
  return evento;
}

/** Despacha la oferta del navegador y deja que React procese la actualización. */
async function ofrecerInstalacion(oferta = crearOferta()) {
  await act(async () => {
    window.dispatchEvent(oferta);
  });
  return oferta;
}

const boton = () => screen.queryByRole("button", { name: "Instalar la aplicación" });

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

describe("InstalarPwaButton", () => {
  it("no se pinta mientras el navegador no ofrezca instalar", () => {
    render(<InstalarPwaButton />);

    // Nunca un botón que no lleva a ninguna parte: sin oferta no hay control.
    expect(boton()).not.toBeInTheDocument();
  });

  it("aparece cuando el navegador ofrece instalar", async () => {
    render(<InstalarPwaButton />);

    await ofrecerInstalacion();

    expect(boton()).toBeInTheDocument();
  });

  it("impide el aviso propio del navegador, para no duplicar la oferta", async () => {
    render(<InstalarPwaButton />);

    const oferta = await ofrecerInstalacion();

    expect(oferta.defaultPrevented).toBe(true);
  });

  it("al pulsarlo abre el diálogo nativo de instalación", async () => {
    const user = userEvent.setup();
    render(<InstalarPwaButton />);
    const oferta = await ofrecerInstalacion();

    await user.click(boton()!);

    expect(oferta.prompt).toHaveBeenCalledTimes(1);
  });

  it("tras usar la oferta el botón desaparece: el evento es de un solo uso", async () => {
    const user = userEvent.setup();
    render(<InstalarPwaButton />);
    await ofrecerInstalacion();

    await user.click(boton()!);

    await waitFor(() => expect(boton()).not.toBeInTheDocument());
  });

  it("si el usuario rechaza, tampoco se le insiste en la misma sesión", async () => {
    const user = userEvent.setup();
    render(<InstalarPwaButton />);
    await ofrecerInstalacion(crearOferta("dismissed"));

    await user.click(boton()!);

    await waitFor(() => expect(boton()).not.toBeInTheDocument());
  });

  it("si el diálogo nativo falla, no propaga el error ni deja el botón colgado", async () => {
    const user = userEvent.setup();
    render(<InstalarPwaButton />);
    const oferta = crearOferta();
    oferta.prompt = vi.fn(() => Promise.reject(new Error("ya consumido")));
    await ofrecerInstalacion(oferta);

    await expect(user.click(boton()!)).resolves.not.toThrow();
    await waitFor(() => expect(boton()).not.toBeInTheDocument());
  });

  it("cuando la app queda instalada el botón desaparece sin pulsarlo", async () => {
    render(<InstalarPwaButton />);
    await ofrecerInstalacion();
    expect(boton()).toBeInTheDocument();

    await act(async () => {
      window.dispatchEvent(new Event("appinstalled"));
    });

    expect(boton()).not.toBeInTheDocument();
  });

  it("la variante de solo icono conserva el nombre accesible completo", async () => {
    render(<InstalarPwaButton soloIcono />);
    await ofrecerInstalacion();

    const control = boton();
    expect(control).toBeInTheDocument();
    expect(control).not.toHaveTextContent("Instalar");
  });

  it("deja de escuchar al desmontarse: no retiene el evento tras salir", async () => {
    const { unmount } = render(<InstalarPwaButton />);
    const quitar = vi.spyOn(window, "removeEventListener");

    unmount();

    const eventos = quitar.mock.calls.map((c) => c[0]);
    expect(eventos).toContain("beforeinstallprompt");
    expect(eventos).toContain("appinstalled");
  });
});
