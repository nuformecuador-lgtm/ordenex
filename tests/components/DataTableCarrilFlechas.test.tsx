// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { DataTable, type Column } from "@/components/shared/DataTable";

/**
 * EL CARRIL DE LAS FLECHAS DE SCROLL — guardia de un fallo MUDO que llegó a producción.
 *
 * Las dos flechas de `DataTable` se pintan por encima de la tabla (`z-20`) y son
 * pulsables. Mientras se dibujaban SOBRE las celdas, la flecha habilitada se quedaba
 * con el clic que iba al contenido de debajo. Medido en Chromium contra el dev server,
 * `/configuracion/api` a 1280x900, con un clic de RATÓN REAL (`page.mouse.click`, no
 * `locator.click`: este último desplaza el elemento a la vista antes de pulsar y
 * esconde justo este fallo) sobre el centro del botón «Editar webhook»:
 *
 *   el clic lo recibió → «Desplazar la tabla a la derecha»
 *   scrollLeft         → 0 -> 271
 *   modal esperado     → NO abrió
 *
 * El segundo clic sí funcionaba (para entonces la flecha ya estaba deshabilitada), así
 * que el defecto no rompe nada: APARENTA. El solape medía 36 px —el ancho exacto de la
 * flecha— contra la primera y la última columna de TODAS las tablas que desbordan, y
 * `DataTable` lo montan 35 pantallas.
 *
 * EL INVARIANTE QUE SE GUARDA AQUÍ: cuando la tabla desborda, el marco reserva un
 * carril lateral AL MENOS tan ancho como la huella de la flecha (margen + tamaño). Si
 * el carril se queda corto, la flecha vuelve a asomar sobre la primera/última columna y
 * vuelve el fallo mudo. Se comprueba como DESIGUALDAD entre dos medidas leídas del DOM
 * renderizado —el padding del marco por un lado, el margen y el tamaño del botón por
 * otro— y no contra la constante del componente: comparar el componente consigo mismo
 * estaría siempre verde.
 *
 * jsdom no maquetá: `scrollWidth`/`clientWidth` valen 0 y la tabla nunca se cree que
 * desborda. Por eso se sustituyen los dos getters antes de renderizar; es la única
 * forma de que las flechas lleguen a existir en este entorno.
 */

/** Escala de espaciado de Tailwind: cada paso son 4 px (`p-1` = 0.25rem = 4 px). */
const PASO_TAILWIND_PX = 4;

/** Lee una clase de espaciado/tamaño (`px-10`, `ml-1`, `size-9`) y la pasa a píxeles. */
function medidaDeClase(el: Element, prefijo: string): number | null {
  const clases = el.getAttribute("class") ?? "";
  const m = new RegExp(`(?:^|\\s)${prefijo}-(\\d+)(?:\\s|$)`).exec(clases);
  return m ? Number(m[1]) * PASO_TAILWIND_PX : null;
}

/** Padding horizontal efectivo del marco: `pl`/`pr` mandan sobre `px`; sin nada, 0. */
function carril(marco: Element, lado: "l" | "r"): number {
  return medidaDeClase(marco, `p${lado}`) ?? medidaDeClase(marco, "px") ?? 0;
}

/** Huella de una flecha: lo que ocupa de borde a borde, margen incluido. */
function huella(flecha: Element, margen: "ml" | "mr"): number {
  const tamano = medidaDeClase(flecha, "size");
  if (tamano === null) {
    throw new Error(
      "La flecha ya no declara su tamaño con `size-N`: hay que actualizar esta guardia.",
    );
  }
  return (medidaDeClase(flecha, margen) ?? 0) + tamano;
}

type Fila = { id: string; nombre: string };

const COLUMNAS: Column<Fila>[] = [
  { id: "nombre", value: "Nombre" },
  { id: "acciones", value: "Acciones", render: () => <button type="button">Editar</button> },
];

const DATOS: Fila[] = [
  { id: "1", nombre: "Ana" },
  { id: "2", nombre: "Beto" },
];

/**
 * Fija el desborde horizontal que jsdom no puede calcular. `ancho` es el viewport de
 * scroll y `contenido` lo que mide la tabla dentro: si el segundo es mayor, desborda.
 */
function fingirDesborde(ancho: number, contenido: number) {
  const previos = ["clientWidth", "scrollWidth"].map((prop) => ({
    prop,
    descriptor: Object.getOwnPropertyDescriptor(HTMLDivElement.prototype, prop),
  }));
  Object.defineProperty(HTMLDivElement.prototype, "clientWidth", {
    configurable: true,
    get: () => ancho,
  });
  Object.defineProperty(HTMLDivElement.prototype, "scrollWidth", {
    configurable: true,
    get: () => contenido,
  });
  return () => {
    for (const { prop, descriptor } of previos) {
      if (descriptor) Object.defineProperty(HTMLDivElement.prototype, prop, descriptor);
      else delete (HTMLDivElement.prototype as unknown as Record<string, unknown>)[prop];
    }
  };
}

let restaurar: (() => void) | null = null;

afterEach(() => {
  cleanup();
  restaurar?.();
  restaurar = null;
});

function marcoYFlechas() {
  const marco = document.querySelector('[data-slot="datatable-marco"]');
  if (!marco) throw new Error("no se encontró el marco de la tabla");
  return {
    marco,
    izquierda: screen.getByRole("button", { name: "Desplazar la tabla a la izquierda" }),
    derecha: screen.getByRole("button", { name: "Desplazar la tabla a la derecha" }),
  };
}

describe("DataTable · carril de las flechas de scroll", () => {
  it("con desborde, el carril del marco es al menos tan ancho como la flecha, a cada lado", () => {
    restaurar = fingirDesborde(800, 1400);
    render(<DataTable columns={COLUMNAS} data={DATOS} ariaLabel="Tabla" />);

    const { marco, izquierda, derecha } = marcoYFlechas();

    const carrilIzq = carril(marco, "l");
    const carrilDer = carril(marco, "r");
    const huellaIzq = huella(izquierda, "ml");
    const huellaDer = huella(derecha, "mr");

    // El carril existe...
    expect(carrilIzq).toBeGreaterThan(0);
    expect(carrilDer).toBeGreaterThan(0);
    // ...y la flecha cabe entera dentro de él, así que no queda celda debajo.
    expect(carrilIzq).toBeGreaterThanOrEqual(huellaIzq);
    expect(carrilDer).toBeGreaterThanOrEqual(huellaDer);
  });

  it("sin desborde no hay flechas ni carril: una tabla que cabe no pierde ancho", () => {
    restaurar = fingirDesborde(800, 800);
    render(<DataTable columns={COLUMNAS} data={DATOS} ariaLabel="Tabla" />);

    const marco = document.querySelector('[data-slot="datatable-marco"]');
    expect(marco).not.toBeNull();
    expect(
      screen.queryByRole("button", { name: /Desplazar la tabla/ }),
    ).not.toBeInTheDocument();
    expect(carril(marco!, "l")).toBe(0);
    expect(carril(marco!, "r")).toBe(0);
  });

  it("las flechas viven FUERA del marco recortado, y el scrollport dentro", () => {
    // `position: sticky` se pega a su scrollport más cercano. El marco lleva
    // `overflow-hidden`, así que es un scrollport: meter las flechas dentro las
    // despegaría de la ventana y volverían a viajar con la tabla (ficha 348).
    restaurar = fingirDesborde(800, 1400);
    render(<DataTable columns={COLUMNAS} data={DATOS} ariaLabel="Tabla" />);

    const { marco, izquierda, derecha } = marcoYFlechas();
    const scrollport = document.querySelector('[data-slot="datatable-scrollport"]');

    expect(scrollport).not.toBeNull();
    expect(marco.contains(scrollport!)).toBe(true);
    expect(marco.contains(izquierda)).toBe(false);
    expect(marco.contains(derecha)).toBe(false);
  });

  it("las flechas siguen siendo alcanzables con el teclado y enseñan el foco", () => {
    restaurar = fingirDesborde(800, 1400);
    render(<DataTable columns={COLUMNAS} data={DATOS} ariaLabel="Tabla" />);

    const { izquierda, derecha } = marcoYFlechas();
    for (const flecha of [izquierda, derecha]) {
      expect(flecha).not.toHaveAttribute("tabindex", "-1");
      expect(flecha.getAttribute("class")).toMatch(/focus-visible:ring/);
    }
    // En el extremo inicial solo la derecha puede desplazar; la izquierda queda
    // deshabilitada, que es lo que ya hacía y lo que la saca del paso del cursor.
    expect(izquierda).toBeDisabled();
    expect(derecha).toBeEnabled();
  });
});
