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

/** Punto de corte de una clase de Tailwind: `null` = siempre, `"sm"` = a partir de 640 px. */
type Corte = string | null;

/**
 * Lee una clase de espaciado/tamaño (`px-10`, `sm:px-10`, `ml-1`, `size-9`) y devuelve
 * los píxeles Y a partir de qué punto de corte se aplican. El punto de corte importa
 * tanto como el número: un carril sin `sm:` se cobra los 80 px también en el móvil.
 */
function medidaDeClase(
  el: Element,
  prefijo: string,
): { px: number; corte: Corte } | null {
  const clases = el.getAttribute("class") ?? "";
  const m = new RegExp(`(?:^|\\s)(?:([a-z0-9]+):)?${prefijo}-(\\d+)(?:\\s|$)`).exec(clases);
  return m ? { px: Number(m[2]) * PASO_TAILWIND_PX, corte: m[1] ?? null } : null;
}

/** Padding horizontal efectivo del marco: `pl`/`pr` mandan sobre `px`; sin nada, 0. */
function carrilCompleto(marco: Element, lado: "l" | "r"): { px: number; corte: Corte } {
  return (
    medidaDeClase(marco, `p${lado}`) ??
    medidaDeClase(marco, "px") ?? { px: 0, corte: null }
  );
}

/** Solo los píxeles del carril (lo que usan las guardias de anchura). */
function carril(marco: Element, lado: "l" | "r"): number {
  return carrilCompleto(marco, lado).px;
}

/** Huella de una flecha: lo que ocupa de borde a borde, margen incluido. */
function huella(flecha: Element, margen: "ml" | "mr"): number {
  const tamano = medidaDeClase(flecha, "size");
  if (tamano === null) {
    throw new Error(
      "La flecha ya no declara su tamaño con `size-N`: hay que actualizar esta guardia.",
    );
  }
  return (medidaDeClase(flecha, margen)?.px ?? 0) + tamano.px;
}

/**
 * ¿A partir de qué punto de corte se PINTA este carril? Se lee de las utilidades de
 * `display`: `hidden` esconde, y `<corte>:flex` (o `<corte>:block`…) enciende. Sin
 * `hidden` se pinta siempre (`null`); con `hidden` y sin nada que lo encienda, nunca.
 */
function corteDeVisibilidad(carrilEl: Element): Corte | "nunca" {
  const clases = (carrilEl.getAttribute("class") ?? "").split(/\s+/);
  const escondido = clases.includes("hidden");
  const enciende = clases
    .map((c) => /^([a-z0-9]+):(flex|block|inline-flex|grid)$/.exec(c))
    .find((m) => m !== null);
  if (!escondido) return null;
  return enciende ? enciende[1] : "nunca";
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

/**
 * EL CARRIL NO SE COBRA EN EL MÓVIL.
 *
 * El carril cuesta 80 px de viewport de scroll cuando la tabla desborda. Medido en
 * Chromium contra el dev server con la tabla de `/ordenes`: a 1440 px el ancho útil
 * pasaba de 1134 a 1054 (−7 %), pero a 390 px pasaba de 340 a 260, **un 23 % de la
 * pantalla**, y a cambio de un control que en táctil no pulsa nadie porque se desliza
 * el dedo. Que deslizar funciona está medido aparte con eventos táctiles reales
 * (`Input.dispatchTouchEvent` por CDP): los 6 casos de 390×844 y 768×1024 desplazan en
 * los dos sentidos, `scrollLeft` 0 → 205 → 60.
 *
 * jsdom no aplica CSS, así que aquí no se puede medir un ancho: lo que se guarda es el
 * CONTRATO DE CLASES, y el invariante interesante NO es «la clase dice sm» (eso sería
 * comparar el componente consigo mismo), sino que **el punto de corte del hueco y el de
 * la flecha coinciden**. Son dos decisiones escritas en dos elementos distintos, y las
 * dos formas de desalinearlas son sendos defectos:
 *   · hueco siempre + flecha desde `sm` → el móvil paga 80 px por un control que no está;
 *   · hueco desde `sm` + flecha siempre → vuelve el solape que el carril vino a arreglar.
 */
describe("DataTable · el carril de las flechas no se cobra por debajo de `sm`", () => {
  it("con desborde, ni el hueco ni la flecha se pintan por debajo de `sm`", () => {
    restaurar = fingirDesborde(390, 1400);
    render(<DataTable columns={COLUMNAS} data={DATOS} ariaLabel="Tabla" />);

    const marco = document.querySelector('[data-slot="datatable-marco"]')!;
    const carriles = [
      ...document.querySelectorAll('[data-slot^="datatable-carril-"]'),
    ];
    expect(carriles).toHaveLength(2);

    // El hueco existe, pero solo a partir de un punto de corte.
    for (const lado of ["l", "r"] as const) {
      const { px, corte } = carrilCompleto(marco, lado);
      expect(px).toBeGreaterThan(0);
      expect(corte).not.toBeNull();
    }
    // Y la tira de la flecha arranca escondida y se enciende en un punto de corte.
    for (const tira of carriles) {
      expect(corteDeVisibilidad(tira)).not.toBeNull();
      expect(corteDeVisibilidad(tira)).not.toBe("nunca");
    }
  });

  it("el hueco y la flecha se encienden en el MISMO punto de corte", () => {
    restaurar = fingirDesborde(390, 1400);
    render(<DataTable columns={COLUMNAS} data={DATOS} ariaLabel="Tabla" />);

    const marco = document.querySelector('[data-slot="datatable-marco"]')!;
    const izquierda = document.querySelector('[data-slot="datatable-carril-izquierda"]')!;
    const derecha = document.querySelector('[data-slot="datatable-carril-derecha"]')!;

    expect(carrilCompleto(marco, "l").corte).toBe(corteDeVisibilidad(izquierda));
    expect(carrilCompleto(marco, "r").corte).toBe(corteDeVisibilidad(derecha));
  });

  it("a partir de ese punto de corte la flecha sigue cabiendo entera en su hueco", () => {
    // El arreglo del móvil no puede aflojar la guardia de arriba: donde el carril se
    // pinta, sigue siendo al menos tan ancho como la huella de la flecha.
    restaurar = fingirDesborde(800, 1400);
    render(<DataTable columns={COLUMNAS} data={DATOS} ariaLabel="Tabla" />);

    const { marco, izquierda, derecha } = marcoYFlechas();
    expect(carril(marco, "l")).toBeGreaterThanOrEqual(huella(izquierda, "ml"));
    expect(carril(marco, "r")).toBeGreaterThanOrEqual(huella(derecha, "mr"));
  });
});
