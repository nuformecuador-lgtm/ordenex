// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { usePreferenciaSonido } from "@/hooks/usePreferenciaSonido";
import { CLAVE_SONIDO } from "@/lib/audio/preferencia-sonido";

// Feature 161 — R15/R16. La preferencia se lee como fuente EXTERNA a React
// (`useSyncExternalStore`): estos tests fijan que el componente reacciona a los cambios,
// incluidos los que llegan de otra pestana.

function Sonda() {
  const { activado, establecer } = usePreferenciaSonido();
  return (
    <button type="button" onClick={() => establecer(!activado)}>
      {activado ? "activado" : "silenciado"}
    </button>
  );
}

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("usePreferenciaSonido", () => {
  it("R15: sin preferencia guardada arranca activado", () => {
    render(<Sonda />);

    expect(screen.getByRole("button")).toHaveTextContent("activado");
  });

  it("R15: con la preferencia ya silenciada arranca silenciado", () => {
    window.localStorage.setItem(CLAVE_SONIDO, "off");
    render(<Sonda />);

    expect(screen.getByRole("button")).toHaveTextContent("silenciado");
  });

  it("R16: al establecerla, la vista se actualiza y queda persistida", async () => {
    const user = userEvent.setup();
    render(<Sonda />);

    await user.click(screen.getByRole("button"));

    expect(screen.getByRole("button")).toHaveTextContent("silenciado");
    expect(window.localStorage.getItem(CLAVE_SONIDO)).toBe("off");
  });

  it("R16: un cambio hecho en otra pestana se refleja en esta", () => {
    render(<Sonda />);
    expect(screen.getByRole("button")).toHaveTextContent("activado");

    // Otra pestana silencia: `storage` es el evento que el navegador entrega aqui.
    act(() => {
      window.localStorage.setItem(CLAVE_SONIDO, "off");
      window.dispatchEvent(new Event("storage"));
    });

    expect(screen.getByRole("button")).toHaveTextContent("silenciado");
  });
});
