// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { Pagination } from "@/components/shared/Pagination";

/**
 * LA BARRA DE PAGINACIÓN NO ES UNA CAPA SOBRE EL CONTENIDO — guardia de un fallo MUDO,
 * de la misma familia que el carril de las flechas de `DataTable`.
 *
 * La barra se pintaba dentro de un envoltorio `sticky bottom-0 z-10 bg-background/70
 * backdrop-blur-md`: mientras su sitio natural al pie de la lista caía por debajo del
 * viewport, se pegaba al borde inferior de la pantalla y las filas pasaban por debajo.
 * Con `pointer-events` normales, eso es una capa que se queda con el clic de los botones
 * que le toquen debajo.
 *
 * Medido en Chromium contra el dev server con clics de RATÓN REALES —`page.mouse.click`
 * sobre las coordenadas del botón; `locator.click` NO sirve, porque desplaza el elemento
 * a la vista antes de pulsar y esconde justo este fallo— en 390/768/1024/1280/1440/1920
 * sobre `/ordenes`, `/configuracion/api` y `/configuracion`:
 *
 *   controles robados   → 26, en 13 de las 16 pantallas medidas
 *   abrieron lo suyo    → 0 de 26
 *   quién recibía el clic → `nav[aria-label="Paginación"]`, su fondo, y en un caso
 *                           `button:Ir a la página 1` — o sea que además CAMBIABA DE PÁGINA
 *   solape con la tabla → 64 px (108 px a 390, donde la barra va a dos líneas)
 *
 * Ejemplos: `Editar` / `Inactivar` / `Restablecer contraseña` de la última fila visible de
 * `/configuracion` a 1280×800, y `Ver historial de la orden …` en `/ordenes` a 1440×900.
 *
 * Tras el arreglo, las mismas 16 pantallas dan **0 robados** y **0 px de solape** (el
 * único clic que seguía sin llegar lo interceptaba `<nextjs-portal>`, el indicador de
 * herramientas de Next, que no existe en un build de producción: ocultándolo, 0 de 18).
 *
 * EL INVARIANTE QUE SE GUARDA AQUÍ: el control no se saca del flujo. No declara
 * `sticky`/`fixed`/`absolute` ni se apila con `z-*`, y devuelve UN SOLO elemento (el
 * `<nav>`), sin envoltorio ni centinela. jsdom no maqueta, así que no se puede medir un
 * solape: lo que se comprueba es que no existe el mecanismo con el que se producía.
 */

/** Utilidades de posicionamiento que sacarían la barra del flujo. */
const FUERA_DE_FLUJO = /(?:^|\s)(?:[a-z0-9]+:)?(sticky|fixed|absolute)(?:\s|$)/;
/** Cualquier `z-10`, `z-50`… Apilarse solo tiene sentido para ponerse ENCIMA de algo. */
const APILADA = /(?:^|\s)(?:[a-z0-9]+:)?z-\w+(?:\s|$)/;

/** Todos los elementos que el control pinta, incluida su raíz. */
function pintados(container: HTMLElement): Element[] {
  return [...container.querySelectorAll("*")];
}

afterEach(() => {
  cleanup();
});

describe("Pagination · la barra no flota sobre el contenido", () => {
  it("devuelve un solo elemento: el <nav>, sin envoltorio pegajoso ni centinela", () => {
    const { container } = render(<Pagination page={1} pageSize={25} total={500} />);

    expect(container.childNodes).toHaveLength(1);
    expect(container.firstElementChild).toBe(
      screen.getByRole("navigation", { name: "Paginación" }),
    );
  });

  it("ningún elemento de la barra se saca del flujo ni se apila por encima", () => {
    const { container } = render(
      <Pagination
        page={3}
        pageSize={25}
        total={500}
        showFirstLast
        siblingCount={1}
        pageSizeOptions={[25, 50]}
        onPageChange={() => {}}
        onPageSizeChange={() => {}}
      />,
    );

    for (const el of pintados(container)) {
      const clases = el.getAttribute("class") ?? "";
      expect(clases).not.toMatch(FUERA_DE_FLUJO);
      expect(clases).not.toMatch(APILADA);
    }
  });

  it("tampoco en la variante compacta, que es la que usan tarjetas y diálogos", () => {
    const { container } = render(
      <Pagination page={1} pageSize={10} total={100} compacta onPageChange={() => {}} />,
    );

    expect(container.childNodes).toHaveLength(1);
    for (const el of pintados(container)) {
      expect(el.getAttribute("class") ?? "").not.toMatch(FUERA_DE_FLUJO);
    }
  });

  it("la guardia distingue: una barra sacada del flujo sí la haría saltar", () => {
    // Autocomprobación. Sin esto, un cambio que rompiera los selectores dejaría los tres
    // tests de arriba en verde sin mirar nada — el modo de fallo de esta familia.
    const { container } = render(
      <Pagination
        page={1}
        pageSize={25}
        total={500}
        className="sticky bottom-0 z-10"
        onPageChange={() => {}}
      />,
    );
    const clases = container.firstElementChild!.getAttribute("class") ?? "";
    expect(clases).toMatch(FUERA_DE_FLUJO);
    expect(clases).toMatch(APILADA);
  });

  it("la barra sigue siendo un <nav> con nombre y con sus controles (no se perdió nada)", () => {
    render(
      <Pagination
        page={2}
        pageSize={25}
        total={500}
        showFirstLast
        siblingCount={1}
        onPageChange={() => {}}
      />,
    );

    const nav = screen.getByRole("navigation", { name: "Paginación" });
    expect(nav).toBeInTheDocument();
    expect(screen.getByText("26-50 de 500")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Primera página" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Página siguiente" })).toBeEnabled();
  });
});
