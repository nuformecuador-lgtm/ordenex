// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { TextoConEnlaces } from "@/app/(app)/mis-asignaciones/_components/chat/TextoConEnlaces";

// Feature 311 (R33/R34) — el texto de la burbuja con sus URL enlazadas.
//
// Lo que se fija aqui: el `<a>` sale con `target="_blank"` y `rel="noopener noreferrer"`, el
// texto de alrededor NO queda dentro del enlace, y una carga con etiquetas HTML se VE como
// texto (nunca se inyecta HTML: R34).

afterEach(cleanup);

describe("TextoConEnlaces (R33/R34)", () => {
  it("R33: el enlace abre en pestaña nueva con rel noopener noreferrer", () => {
    render(<TextoConEnlaces texto="mira https://x.co/a. gracias" />);

    const enlace = screen.getByRole("link", { name: "https://x.co/a" });
    expect(enlace).toHaveAttribute("href", "https://x.co/a");
    expect(enlace).toHaveAttribute("target", "_blank");
    expect(enlace).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("R33: el texto que rodea la URL NO esta dentro del <a>", () => {
    const { container } = render(
      <TextoConEnlaces texto="mira https://x.co/a. gracias" />,
    );

    const enlace = screen.getByRole("link", { name: "https://x.co/a" });
    expect(enlace.textContent).toBe("https://x.co/a");
    // El parrafo entero conserva el mensaje completo, enlace incluido.
    expect(container.textContent).toBe("mira https://x.co/a. gracias");
  });

  it("R34: un esquema javascript: no genera ningun enlace", () => {
    const { container } = render(
      <TextoConEnlaces texto="pincha javascript:alert(1) ya" />,
    );

    expect(screen.queryByRole("link")).toBeNull();
    expect(container.textContent).toBe("pincha javascript:alert(1) ya");
  });

  it("R34: una carga con etiquetas HTML se renderiza como TEXTO, no como elemento", () => {
    const carga = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
    const { container } = render(<TextoConEnlaces texto={carga} />);

    // Ni un solo elemento inyectado: React escapo el contenido por construccion.
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    // Y el mensaje se ve tal cual lo escribio el cliente.
    expect(container.textContent).toBe(carga);
    expect(container.innerHTML).toContain("&lt;img");
  });

  it("R34: la burbuja no inyecta HTML ni siquiera con una URL dentro de la carga", () => {
    // Una URL valida PEGADA a una etiqueta: el enlace se crea, la etiqueta NO.
    const { container } = render(
      <TextoConEnlaces texto={'<b>hola</b> https://x.co/a <i>chao</i>'} />,
    );

    expect(screen.getByRole("link", { name: "https://x.co/a" })).toBeInTheDocument();
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("i")).toBeNull();
    expect(container.textContent).toBe("<b>hola</b> https://x.co/a <i>chao</i>");
  });
});
