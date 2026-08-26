// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";

// La landing es un Server Component sin datos: no consulta nada, y lo único que espera es su
// propio `searchParams` (el `?guia=` que precarga el rastreo), así que se invoca con `await` y
// sin query. Se importa vía `await import("@/app/page")` para no arrastrar el módulo a otros
// tests del mismo archivo.
describe("app/page.tsx — landing pública (feature 86, R2–R5b)", () => {
  it("R2: la barra superior tiene el logo, las anclas de sección y el enlace «Ingresar» → /login", async () => {
    const { default: LandingPage } = await import("@/app/page");
    render(await LandingPage({}));

    // El logo (wordmark) aparece (barra + pie). El texto va partido en dos
    // spans ("Orden" + "ex" en naranja de marca), así que se matchea el span
    // completo del wordmark por su textContent y su clase base.
    const wordmarks = screen.getAllByText(
      (_content, el) =>
        el?.textContent === "Ordenex" && el.classList.contains("font-heading"),
    );
    expect(wordmarks.length).toBeGreaterThanOrEqual(1);

    const ingresar = screen.getAllByRole("link", { name: /^Ingresar$/ });
    expect(ingresar.length).toBeGreaterThanOrEqual(1);
    ingresar.forEach((el) => expect(el).toHaveAttribute("href", "/login"));

    // Las cuatro anclas de sección salen desde la barra.
    for (const ancla of ["#servicios", "#como-funciona", "#politicas", "#trabaja-con-nosotros"]) {
      expect(screen.getAllByRole("link", { name: new RegExp(".") })
        .some((el) => el.getAttribute("href") === ancla)).toBe(true);
    }
  });

  it("R2b: «Trabajá con nosotros» de la nav baja a la sección de esta página, no a /postulacion", async () => {
    const { default: LandingPage } = await import("@/app/page");
    const { container } = render(await LandingPage({}));

    // Esa sección ofrece tres vías: vehículo y bodega abren un modal aquí mismo
    // y solo «Quiero postularme» va a /postulacion. Enlazar la ruta desde la nav
    // se saltaba las otras dos.
    const nav = container.querySelector("nav")!;
    const trabaja = [...nav.querySelectorAll<HTMLAnchorElement>("a")].find(
      (el) => el.textContent?.trim() === "Trabajá con nosotros",
    );
    const href = trabaja?.getAttribute("href");

    expect(href).toMatch(/^#/);
    expect(href).not.toBe("/postulacion");
    // Y el ancla aterriza en una sección real, con el margen de scroll que la
    // deja bajo la barra pegajosa en vez de tapada por ella.
    const destino = container.querySelector(href!);
    expect(destino).not.toBeNull();
    expect(destino!.classList.contains("scroll-mt-16")).toBe(true);
  });

  it("R2c: los enlaces de sección de la nav van en el mismo orden en que la página compone las secciones", async () => {
    const { default: LandingPage } = await import("@/app/page");
    const { container } = render(await LandingPage({}));

    const nav = container.querySelector("nav")!;
    const anclasNav = [...nav.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')].map(
      (el) => el.getAttribute("href")!.slice(1),
    );
    // Guardia contra el verde vacío: si la nav se quedara sin anclas, comparar
    // dos listas vacías pasaría sin comprobar nada.
    expect(anclasNav.length).toBeGreaterThanOrEqual(4);

    // El orden esperado NO se escribe a mano: se lee del DOM que `app/page.tsx`
    // produce, en orden de documento, quedándose con los destinos que la nav
    // enlaza. Si se reordena la nav sin reordenar la página (o al revés), rojo.
    const ordenDeLaPagina = [...container.querySelectorAll<HTMLElement>("main [id]")]
      .map((el) => el.id)
      .filter((id) => anclasNav.includes(id));

    expect(anclasNav).toEqual(ordenDeLaPagina);
  });

  it("R3: existen las secciones del home y el hero trae titular y cifras", async () => {
    const { default: LandingPage } = await import("@/app/page");
    const { container } = render(await LandingPage({}));

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
    const { container } = render(await LandingPage({}));

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
    const { container } = render(await LandingPage({}));

    expect(container.querySelectorAll('a[href="#"]')).toHaveLength(0);
    expect(container.querySelectorAll("a:not([href])")).toHaveLength(0);
  });

  it("R5b: las anclas internas son <a> nativo y globals.css declara el scroll suave bajo prefers-reduced-motion", async () => {
    const { default: LandingPage } = await import("@/app/page");
    const { container } = render(await LandingPage({}));

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

// El CABLEADO del `?guia=` en la landing: página → nav. Se inspecciona el árbol que devuelve el
// Server Component en vez de renderizarlo, y no es por comodidad: la página monta sus cifras en
// componentes asíncronos que en jsdom no resuelven, así que el diálogo —que base-ui portalea en
// un efecto— no llega a montarse nunca y el DOM no podría decir nada de esto.
//
// Las otras dos mitades sí se miden donde se ven: la NORMALIZACIÓN del parámetro en
// `tests/unit/guia-en-url.test.ts`, y el diálogo abierto con la guía puesta en
// `tests/components/RastreoDialog.test.tsx`.
describe("app/page.tsx — `/?guia=4321` llega hasta la nav", () => {
  /** La `guiaInicial` con la que la página monta su nav. */
  async function guiaDeLaNav(
    searchParams?: Promise<Record<string, string | string[] | undefined>>,
  ): Promise<string | null | undefined> {
    const { default: LandingPage } = await import("@/app/page");
    const { LandingNav } = await import("@/app/_landing/LandingNav");
    const arbol = await LandingPage(searchParams === undefined ? {} : { searchParams });

    const hijos = Children.toArray(
      (arbol as ReactElement<{ children?: ReactNode }>).props.children,
    );
    const nav = hijos.find(
      (hijo): hijo is ReactElement<{ guiaInicial?: string | null }> =>
        isValidElement(hijo) && hijo.type === LandingNav,
    );
    expect(nav, "la landing ya no monta `LandingNav` como hijo directo").toBeDefined();
    return nav!.props.guiaInicial;
  }

  it("una guía válida llega a la nav tal cual", async () => {
    expect(await guiaDeLaNav(Promise.resolve({ guia: "4321" }))).toBe("4321");
  });

  it("lo que no es una guía llega como `null`: la landing se pinta igual y no abre nada", async () => {
    expect(await guiaDeLaNav(Promise.resolve({ guia: "no-es-una-guia" }))).toBeNull();
    expect(await guiaDeLaNav(Promise.resolve({ guia: ["1", "2"] }))).toBeNull();
  });

  it("sin query —el caso normal— la nav recibe `null`", async () => {
    expect(await guiaDeLaNav(Promise.resolve({}))).toBeNull();
    expect(await guiaDeLaNav()).toBeNull();
  });
});
