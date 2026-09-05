// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { Pagination } from "@/components/shared/Pagination";

/**
 * LA BARRA FLOTA, PERO SOLO SUS CONTROLES SE QUEDAN CON EL CLIC — guardia de un fallo
 * MUDO, de la misma familia que el carril de las flechas de `DataTable`.
 *
 * En modo pegajoso la barra vive en un envoltorio `sticky bottom-0` que ocupa TODO el
 * ancho y flota sobre las filas. Solo una parte pequeña de esa caja es pulsable; el
 * resto es fondo. Mientras el envoltorio capturaba el puntero, ese fondo se quedaba con
 * el clic que iba a la fila de debajo.
 *
 * Medido en Chromium contra el dev server con clics de RATÓN REALES —`page.mouse.click`
 * sobre las coordenadas del botón; `locator.click` NO sirve, porque desplaza el elemento
 * a la vista antes de pulsar y esconde justo este fallo— en 390/768/1024/1280/1440/1920
 * sobre `/ordenes`, `/configuracion/api` y `/configuracion`:
 *
 *   ANTES     26 controles de fila robados, 0 de 26 abrieron lo suyo.
 *             Quién recibía el clic: 19 el fondo del `<nav>`, 4 el hueco entre botones,
 *             1 el texto del rango, 1 el selector de tamaño, 1 «Ir a la página 1».
 *   DESPUÉS   1 robado de las 18 combinaciones, y es el caso IRREDUCIBLE: un botón de
 *             verdad de la barra encima de un botón de verdad de una fila.
 *
 * O sea que 24 de los 26 los robaba algo que ni siquiera era pulsable. La barra SIGUE
 * FLOTANDO —es una decisión de producto, no un accidente—; lo que cambia es que la caja
 * es transparente al puntero y cada control la vuelve a capturar por su cuenta.
 *
 * EL INVARIANTE QUE SE GUARDA AQUÍ: dentro de la caja flotante, capturan el puntero
 * EXACTAMENTE los controles reales habilitados, ni uno más. Se evalúa por herencia sobre
 * el árbol pintado (jsdom no aplica CSS), que es como se comporta `pointer-events`.
 * No es el componente comparado consigo mismo: son decisiones escritas en elementos
 * distintos —el envoltorio, cada botón, el selector— y la guardia comprueba que casan.
 */

/** Elementos con los que un humano interactúa de verdad en la barra. */
const CONTROLES = "button, select";

/**
 * ¿Este elemento se queda con el clic? `pointer-events` se hereda: manda el ancestro
 * más cercano (él incluido) que declare `auto` o `none`. `disabled:pointer-events-none`
 * gana sobre `pointer-events-auto` en el propio elemento porque `&:disabled` tiene más
 * especificidad que una clase suelta.
 */
function capturaElPuntero(el: Element, raiz: Element): boolean {
  let nodo: Element | null = el;
  while (nodo) {
    const clases = (nodo.getAttribute("class") ?? "").split(/\s+/);
    if (
      nodo === el &&
      nodo.hasAttribute("disabled") &&
      clases.includes("disabled:pointer-events-none")
    ) {
      return false;
    }
    if (clases.includes("pointer-events-auto")) return true;
    if (clases.includes("pointer-events-none")) return false;
    if (nodo === raiz) break;
    nodo = nodo.parentElement;
  }
  return true; // sin declaración explícita, el valor inicial de `pointer-events` es `auto`
}

/** El envoltorio flotante: el padre del `<nav>` en modo pegajoso. */
function cajaFlotante(): HTMLElement {
  const nav = screen.getByRole("navigation", { name: "Paginación" });
  const caja = nav.parentElement;
  if (!caja) throw new Error("el <nav> de paginación ya no tiene envoltorio");
  return caja;
}

function pintarBarraCompleta() {
  return render(
    <Pagination
      page={3}
      pageSize={25}
      total={500}
      showFirstLast
      siblingCount={1}
      pageSizeOptions={[25, 50, 100]}
      onPageChange={() => {}}
      onPageSizeChange={() => {}}
    />,
  );
}

afterEach(() => {
  cleanup();
});

describe("Pagination · la barra flota sin robarle el clic a las filas", () => {
  it("sigue flotando pegada al borde inferior: es lo que se quiere de ella", () => {
    pintarBarraCompleta();
    const clases = cajaFlotante().getAttribute("class") ?? "";

    expect(clases).toMatch(/(?:^|\s)sticky(?:\s|$)/);
    expect(clases).toMatch(/(?:^|\s)bottom-0(?:\s|$)/);
  });

  it("la caja flotante NO se queda con el puntero", () => {
    pintarBarraCompleta();
    const caja = cajaFlotante();

    expect(caja.getAttribute("class") ?? "").toMatch(
      /(?:^|\s)pointer-events-none(?:\s|$)/,
    );
    expect(capturaElPuntero(caja, caja)).toBe(false);
  });

  it("dentro de la caja capturan el puntero EXACTAMENTE los controles habilitados", () => {
    pintarBarraCompleta();
    const caja = cajaFlotante();

    // Las `<option>` quedan fuera del recuento: no se pintan sobre la tabla, viven
    // dentro del desplegable nativo del `<select>` y heredan de él. No pueden robar nada.
    const capturan = [...caja.querySelectorAll("*")]
      .filter((el) => el.tagName !== "OPTION")
      .filter((el) => capturaElPuntero(el, caja));
    const esperados = [...caja.querySelectorAll(CONTROLES)].filter(
      (el) => !el.hasAttribute("disabled"),
    );

    // Hay controles que comprobar: si la barra se pintara vacía, esto no probaría nada.
    expect(esperados.length).toBeGreaterThan(3);
    expect(capturan).toEqual(esperados);
  });

  it("lo que no es un control —fondo, huecos, el texto del rango— deja pasar el clic", () => {
    // Son, uno a uno, los ladrones que se midieron en el navegador: el fondo del `<nav>`
    // (19 casos), el grupo con `gap-1` entre botones (4), y el texto del rango (1).
    pintarBarraCompleta();
    const caja = cajaFlotante();
    const nav = screen.getByRole("navigation", { name: "Paginación" });
    const grupo = nav.querySelector("div");
    const rango = screen.getByText("51-75 de 500");

    for (const sospechoso of [nav, grupo, rango]) {
      expect(sospechoso).not.toBeNull();
      expect(capturaElPuntero(sospechoso!, caja)).toBe(false);
    }
  });

  it("un control deshabilitado tampoco se queda con el clic de lo que tenga debajo", () => {
    render(
      <Pagination page={1} pageSize={25} total={500} showFirstLast onPageChange={() => {}} />,
    );
    const caja = cajaFlotante();
    const anterior = screen.getByRole("button", { name: "Página anterior" });

    expect(anterior).toBeDisabled();
    expect(capturaElPuntero(anterior, caja)).toBe(false);
  });

  it("los controles siguen respondiendo: no se apagó la barra por el camino", () => {
    pintarBarraCompleta();

    expect(screen.getByRole("button", { name: "Página siguiente" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Ir a la página 1" })).toBeEnabled();
    expect(screen.getByRole("combobox", { name: "Elementos por página" })).toBeEnabled();
    // Y capturan el puntero, que es justo lo que las hace pulsables dentro de la caja.
    const caja = cajaFlotante();
    for (const nombre of ["Página siguiente", "Ir a la página 1"]) {
      expect(capturaElPuntero(screen.getByRole("button", { name: nombre }), caja)).toBe(
        true,
      );
    }
  });

  it("la guardia distingue: sin la caja transparente, el fondo sí capturaría", () => {
    // Autocomprobación. Si el simulador de herencia se rompiera, los tests de arriba
    // quedarían en verde sin mirar nada — el modo de fallo de esta familia.
    const caja = document.createElement("div");
    caja.className = "sticky bottom-0 z-10"; // como estaba ANTES: sin `pointer-events-none`
    const nav = document.createElement("nav");
    nav.className = "flex items-center gap-3";
    const boton = document.createElement("button");
    boton.className = "pointer-events-auto";
    nav.appendChild(boton);
    caja.appendChild(nav);

    expect(capturaElPuntero(nav, caja)).toBe(true); // el fondo robaba
    expect(capturaElPuntero(boton, caja)).toBe(true);
  });

  it("en modo NO pegajoso no hay caja que estorbe y los controles siguen pulsables", () => {
    const { container } = render(
      <Pagination
        page={2}
        pageSize={25}
        total={500}
        sticky={false}
        onPageChange={() => {}}
      />,
    );

    const nav = screen.getByRole("navigation", { name: "Paginación" });
    expect(nav.parentElement).toBe(container);
    expect(
      capturaElPuntero(screen.getByRole("button", { name: "Página siguiente" }), container),
    ).toBe(true);
  });
});
