// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

// La landing es un Server Component sin datos: se importa y renderiza directo
// (no hay fetch ni async). Se importa vía `await import("@/app/page")` para no
// arrastrar el módulo a otros tests del mismo archivo.
describe("app/page.tsx — landing pública (feature 86, R2–R5b)", () => {
  it("R2: la barra superior tiene el logo, las anclas de sección y los enlaces «Trabajá con nosotros» → /postulacion e «Ingresar» → /login", async () => {
    const { default: LandingPage } = await import("@/app/page");
    render(LandingPage());

    // El logo (wordmark) aparece (barra + pie). El texto va partido en dos
    // spans ("Orden" + "ex" en naranja de marca), así que se matchea el span
    // completo del wordmark por su textContent y su clase base.
    const wordmarks = screen.getAllByText(
      (_content, el) =>
        el?.textContent === "Ordenex" && el.classList.contains("font-heading"),
    );
    expect(wordmarks.length).toBeGreaterThanOrEqual(1);

    const trabaja = screen.getAllByRole("link", { name: "Trabajá con nosotros" });
    expect(trabaja.length).toBeGreaterThanOrEqual(1);
    trabaja.forEach((el) => expect(el).toHaveAttribute("href", "/postulacion"));

    const ingresar = screen.getAllByRole("link", { name: /^Ingresar$/ });
    expect(ingresar.length).toBeGreaterThanOrEqual(1);
    ingresar.forEach((el) => expect(el).toHaveAttribute("href", "/login"));

    // Las tres anclas de sección salen desde la barra.
    for (const ancla of ["#servicios", "#como-funciona", "#politicas"]) {
      expect(screen.getAllByRole("link", { name: new RegExp(".") })
        .some((el) => el.getAttribute("href") === ancla)).toBe(true);
    }
  });

  it("R3: existen las secciones del home y el hero trae titular y cifras", async () => {
    const { default: LandingPage } = await import("@/app/page");
    const { container } = render(LandingPage());

    for (const id of ["servicios", "como-funciona", "politicas"]) {
      expect(container.querySelector(`#${id}`)).not.toBeNull();
    }

    const titular = container.querySelector("h1");
    expect(titular?.textContent).toContain("Costa Rica");

    // Las tres cifras del hero van en un <dl> de pares etiqueta/valor. Se acota
    // a la sección del titular: la banda de cifras usa otro <dl> más abajo.
    const cifras = titular!.closest("section")!.querySelectorAll("dl dd");
    expect(cifras.length).toBe(3);
  });

  it("R4: reutiliza la paleta de marca (navy/brand) sin hex sueltos de color", async () => {
    const { default: LandingPage } = await import("@/app/page");
    const { container } = render(LandingPage());

    expect(container.querySelector(".bg-navy-deep")).not.toBeNull();
    expect(container.querySelector(".bg-brand")).not.toBeNull();

    // DESIGN.md: los colores salen de los tokens de globals.css, nunca de un
    // hex suelto en una utilidad arbitraria (`text-[#065f46]`, `bg-[#fff]`…).
    // El degradado del hero es la excepción declarada: usa `rgba()` del token
    // de marca dentro de un `radial-gradient`, que no tiene utilidad Tailwind.
    const clasesConHex = [...container.querySelectorAll<HTMLElement>("[class]")]
      .flatMap((el) => [...el.classList])
      .filter((c) => /(?:^|:)(?:bg|text|border|ring|from|via|to)-\[#/.test(c));
    expect(clasesConHex).toEqual([]);
  });

  it("R5: los destinos que la app no sirve se pintan como texto, no como enlaces muertos", async () => {
    const { default: LandingPage } = await import("@/app/page");
    const { container } = render(LandingPage());

    expect(container.querySelectorAll('a[href="#"]')).toHaveLength(0);
    expect(container.querySelectorAll("a:not([href])")).toHaveLength(0);
  });

  it("R5b: las anclas internas son <a> nativo y globals.css declara el scroll suave bajo prefers-reduced-motion", async () => {
    const { default: LandingPage } = await import("@/app/page");
    const { container } = render(LandingPage());

    // El router de Next fuerza `scroll-behavior: auto` mientras navega, así que
    // un <Link> a un ancla anularía el desplazamiento suave. Basta comprobar que
    // todo href que empiece por "#" cuelga de un <a> (Link renderiza <a> también,
    // pero le añade el manejador; lo que se fija aquí es el contrato de la clase
    // CSS y que el ancla exista y apunte a una sección real de la página).
    const anclas = [...container.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')];
    expect(anclas.length).toBeGreaterThan(0);
    anclas.forEach((el) => {
      expect(container.querySelector(el.getAttribute("href")!)).not.toBeNull();
    });

    const css = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");
    expect(css).toMatch(/prefers-reduced-motion:\s*no-preference/);
    expect(css).toMatch(/scroll-behavior:\s*smooth/);
  });
});
