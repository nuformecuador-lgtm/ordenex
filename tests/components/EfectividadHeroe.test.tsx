// @vitest-environment jsdom
//
// FICHA 441 — LA TARJETA HEROE, estado por estado.
//
// Se renderiza con PROPS y sin SWR: el componente recibe la madurez ya evaluada, así que aquí se
// mide lo único que puede equivocarse en la pantalla —qué se escribe en cada estado— sin montar
// una acción de servidor. El enganche con la consulta lo cubre `KpisEfectividad.test.tsx`.
//
// LAS MUTACIONES QUE ESTE ARCHIVO TIENE QUE PONER EN ROJO, cada una con su caso nombrado:
//
//   M1 · la tarjeta del héroe pierde su énfasis (`jerarquia` "heroe" → "normal", o borrar el
//        borde de marca)            → «la cifra viste el rango de héroe…» y «…lleva el borde de marca»
//   M2 · el estado `sin_cerradas` vuelve a pintar «0 %»
//                                    → «con 0 de 27 cerradas no hay porcentaje: hay una frase»
//   M3 · la base chica suelta su cifra
//                                    → «con 3 de 64 con desenlace, la cifra de abajo se calla»
//   M4 · el `null` se degrada a guion en vez de a frase
//                                    → los dos casos de arriba comprueban que NO hay `SIN_MONTO`
//
// Las poblaciones son las MEDIDAS en producción el 2026-09-17, no inventadas: el período del
// diseño (790 / 424 / 265), la zona Puntarenas (27 cargadas, 0 con desenlace) y la zona El Coco
// (64 cargadas, 3 con desenlace).

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { EfectividadHeroe } from "@/app/(app)/analitica/_components/entregas/EfectividadHeroe";
import { formatearValor } from "@/components/private/analytics/formato";
import { CLASES_CIFRA } from "@/components/private/analytics/jerarquia";
import { evaluarMadurezDeCohorte } from "@/lib/analytics/madurez-cohorte";
import { SIN_MONTO } from "@/lib/config/moneda";

/** El reparto tal como lo produce `calcularEfectividad`, ya evaluado. */
function madurez(total: number, entregadas: number, enProceso: number) {
  return evaluarMadurezDeCohorte({ total, entregadas, enProceso });
}

/** `Intl` separa con espacio duro (U+00A0); testing-library normaliza el DOM pero no el esperado. */
const norm = (texto: string) => texto.replace(/\s/g, " ");

/** La tarjeta, para mirarle el borde. */
function tarjeta(container: HTMLElement): HTMLElement {
  const nodo = container.querySelector<HTMLElement>('[data-slot="card"]');
  if (nodo === null) throw new Error("no se pintó ninguna tarjeta");
  return nodo;
}

afterEach(cleanup);

/* -------------------------------------------------------------------------- */
/* El caso normal: las DOS cifras                                              */
/* -------------------------------------------------------------------------- */

describe("El período del diseño: 790 cargadas, 424 entregadas, 265 vivas", () => {
  it("pinta el porcentaje sobre las cargadas y el de las que ya tienen desenlace", () => {
    render(<EfectividadHeroe madurez={madurez(790, 424, 265)} />);

    // 424/790 = 53,7 % — EL número de la pantalla.
    expect(screen.getByText(norm(formatearValor(424 / 790, "porcentaje")))).toBeInTheDocument();
    // ⏳ 2026-09-24 (FICHA 455, R2/R5): el nombre exacto del estado, la cifra al lado.
    expect(screen.getByText("Entregado: 424")).toBeInTheDocument();
    expect(screen.getByText("de las 790 órdenes que entraron")).toBeInTheDocument();
    // 424/525 = 80,8 % sobre las que ya cerraron, con SU sustantivo y no «cerradas».
    expect(
      screen.getByText(
        norm(`${formatearValor(424 / 525, "porcentaje")} de las 525 órdenes con desenlace terminaron entregadas`),
      ),
    ).toBeInTheDocument();
  });

  // La madurez es la mitad del encargo: sin ella, «53,7 %» no se distingue de «53,7 % y ya está
  // todo cerrado», que son dos operaciones completamente distintas.
  it("la barra de madurez parte las cargadas en tres tramos, con sus cifras", () => {
    render(<EfectividadHeroe madurez={madurez(790, 424, 265)} />);

    const leyenda = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(leyenda).toEqual(["Entregado424", "Otro desenlace101", "Todavía en proceso265"]);
    // Y los tres tramos suman las cargadas: 424 + 101 + 265 = 790.
    expect(424 + 101 + 265).toBe(790);
  });

  it("el universo va pegado al rótulo, con el adjetivo que dice de qué cohorte se habla", () => {
    render(<EfectividadHeroe madurez={madurez(790, 424, 265)} />);

    expect(screen.getByText("Efectividad de entrega")).toBeInTheDocument();
    expect(screen.getByText("de 790 órdenes cargadas")).toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------- */
/* M1 — el énfasis                                                             */
/* -------------------------------------------------------------------------- */

describe("El énfasis, que es la mitad de la ficha", () => {
  // ⚠ NO ES UNA ASERCIÓN COSMÉTICA. El defecto medido era exactamente éste: cinco tarjetas con
  // el mismo peso visual, «17,4 % de efectividad» leyéndose igual que «En proceso 37». Si el
  // héroe deja de pedir el rango `"heroe"`, su clase desaparece del DOM y este caso cae.
  it("la cifra viste el rango de héroe, no el de una tarjeta más", () => {
    render(<EfectividadHeroe madurez={madurez(790, 424, 265)} />);

    const cifra = screen.getByText(norm(formatearValor(424 / 790, "porcentaje"))).closest("p");
    expect(cifra).not.toBeNull();
    // Las clases del catálogo, una a una (si el héroe pidiera "normal" o "apoyo", no estarían).
    for (const clase of CLASES_CIFRA.heroe.split(" ")) {
      expect(cifra?.classList.contains(clase), `falta ${clase}`).toBe(true);
    }
    // Y los tamaños LITERALES que pidió el diseño aprobado —52 px en el teléfono, 68 a partir
    // de `sm`—, para que vaciar el catálogo tampoco deje este caso verde por comparar contra
    // una cadena vacía.
    expect(cifra?.classList.contains("text-[52px]")).toBe(true);
    expect(cifra?.classList.contains("sm:text-[68px]")).toBe(true);
    expect(cifra?.classList.contains("text-[22px]"), "viste el rango de apoyo").toBe(false);
  });

  it("la tarjeta lleva el borde de marca y no el anillo de una tarjeta cualquiera", () => {
    const { container } = render(<EfectividadHeroe madurez={madurez(790, 424, 265)} />);

    expect(tarjeta(container).className).toContain("ring-brand");
  });
});

/* -------------------------------------------------------------------------- */
/* M2 — cero con desenlace: NO hay porcentaje, hay frase                       */
/* -------------------------------------------------------------------------- */

describe("Zona Puntarenas: 27 cargadas y ninguna con desenlace (medido)", () => {
  // ⚠ ESTE ES EL CASO QUE DEFIENDE LA FICHA. Un «0,0 %» aquí le dice al encargado que lo hace
  // todo mal; lo que pasa es que no se ha movido nada. Y tampoco vale un guion: un `null` mudo
  // se lee como «no se pudo medir», que es otra cosa.
  it("con 0 de 27 cerradas no hay porcentaje: hay una frase", () => {
    render(<EfectividadHeroe madurez={madurez(27, 0, 27)} />);

    expect(screen.getByText("Ninguna ha terminado todavía")).toBeInTheDocument();
    expect(screen.getByText(/0 de 27 órdenes tienen desenlace/)).toBeInTheDocument();
    // Ni el cero por ciento…
    expect(
      screen.queryByText(/0\s?%/),
      "se pintó «0 %» sobre 27 órdenes que nadie ha fallado",
    ).toBeNull();
    // …ni ningún porcentaje, venga de donde venga.
    expect(screen.queryByText(/%/), "se afirmó un porcentaje sin ninguna orden cerrada").toBeNull();
    // …ni el marcador de dato ausente: un guion se lee como «no se pudo medir».
    expect(screen.queryByText(SIN_MONTO), "el `null` se degradó a guion").toBeNull();
  });

  // La barra SIGUE pintándose: con 27 vivas de 27, es justamente lo que explica la frase.
  it("la madurez se sigue enseñando: 27 vivas de 27", () => {
    render(<EfectividadHeroe madurez={madurez(27, 0, 27)} />);

    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Entregado0",
      "Otro desenlace0",
      "Todavía en proceso27",
    ]);
  });
});

/* -------------------------------------------------------------------------- */
/* M3 — base demasiado chica                                                   */
/* -------------------------------------------------------------------------- */

describe("Zona El Coco: 64 cargadas y sólo 3 con desenlace (medido)", () => {
  // El % sobre cargadas SÍ se escribe (64 ≥ 20). El de abajo no: con 3, cada orden vale 33
  // puntos y la cifra saltaría sola.
  it("con 3 de 64 con desenlace, la cifra de abajo se calla y dice por qué", () => {
    render(<EfectividadHeroe madurez={madurez(64, 2, 61)} />);

    expect(screen.getByText(norm(formatearValor(2 / 64, "porcentaje")))).toBeInTheDocument();
    expect(screen.getByText(/Sólo 3 de 64 órdenes tienen desenlace/)).toBeInTheDocument();
    // 2/3 = 66,7 % — la cifra que NO puede aparecer.
    expect(screen.queryByText(norm(formatearValor(2 / 3, "porcentaje")))).toBeNull();
  });

  // El suelo y la tolerancia se escriben DERIVADOS de `lib/config/efectividad-cohorte.ts`: si
  // alguien ajusta la tolerancia, el texto la sigue sin que nadie lo reescriba.
  it("la frase dice cuántas harían falta, y sale del umbral configurado", () => {
    render(<EfectividadHeroe madurez={madurez(64, 2, 61)} />);

    expect(screen.getByText(/hacen falta 20 para que este porcentaje no baile solo/)).toBeInTheDocument();
  });

  // ⚠ MEDIDO EN LA APP el 2026-09-17, con el recorte de un mensajero: la frase salía «Sólo 8 de
  // 8 órdenes tienen desenlace», que se lee como un descuido — «8 de 8» es todas. Cuando la
  // cohorte entera cerró, lo que falta no es que hayan cerrado pocas: es que son pocas.
  it("con la cohorte entera cerrada no escribe «8 de 8»", () => {
    render(<EfectividadHeroe madurez={madurez(8, 6, 0)} />);

    expect(screen.queryByText(/Sólo 8 de 8/)).toBeNull();
    expect(
      screen.getByText(/Las 8 órdenes tienen desenlace, pero hacen falta 20/),
    ).toBeInTheDocument();
  });

  it("con las CARGADAS por debajo del suelo tampoco se escribe la de arriba: se enseñan las órdenes", () => {
    // 12 cargadas, 4 entregadas, 2 vivas → 10 con desenlace. Ninguna de las dos bases llega a 20.
    render(<EfectividadHeroe madurez={madurez(12, 4, 2)} />);

    // NINGUNA de las dos cifras: ni 4/12 arriba ni 4/10 abajo.
    expect(screen.queryByText(norm(formatearValor(4 / 12, "porcentaje")))).toBeNull();
    expect(screen.queryByText(norm(formatearValor(4 / 10, "porcentaje")))).toBeNull();
    expect(screen.getByText("Entregado: 4 de 12 órdenes")).toBeInTheDocument();
    expect(screen.getByText(/Son muy pocas para un porcentaje/)).toBeInTheDocument();
    expect(screen.queryByText(SIN_MONTO)).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Los estados que no son dato                                                 */
/* -------------------------------------------------------------------------- */

describe("Cargando, error y recorte vacío", () => {
  it("mientras carga no escribe ninguna base ni ninguna cifra", () => {
    render(<EfectividadHeroe madurez={null} cargando />);

    // El rótulo sí —y también en el nombre accesible del estado de carga, de ahí el plural—;
    // el universo no: un «de 0 órdenes cargadas» ahí es una afirmación de negocio que nadie ha
    // hecho todavía (ficha 360).
    expect(screen.getAllByText("Efectividad de entrega").length).toBeGreaterThan(0);
    expect(screen.queryByText(/órdenes cargadas/)).toBeNull();
    expect(screen.queryByText(/%/)).toBeNull();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("un aviso se dice, no se degrada a cero", () => {
    render(<EfectividadHeroe madurez={null} error="No tienes permiso" />);

    expect(screen.getByRole("alert")).toHaveTextContent("No tienes permiso");
    expect(screen.queryByText(/%/)).toBeNull();
    expect(screen.queryByText(/órdenes cargadas/)).toBeNull();
  });

  // ⚠ CON CERO CARGADAS la regla devuelve `sin_cerradas` —es cierto, no hay ninguna cerrada— y
  // «0 de 0 tienen desenlace» no le dice nada a nadie. Lo que pasa es que el recorte está vacío.
  it("sin ninguna orden en el recorte lo dice con esas palabras", () => {
    render(<EfectividadHeroe madurez={madurez(0, 0, 0)} />);

    expect(screen.getByText("No entró ninguna orden")).toBeInTheDocument();
    expect(screen.queryByText(/%/)).toBeNull();
    // La base SÍ se escribe: es justo lo que explica la frase (ficha 360).
    expect(screen.getByText("de 0 órdenes cargadas")).toBeInTheDocument();
    // Y no se pinta una barra de madurez de cero sobre cero.
    expect(screen.queryAllByRole("listitem")).toEqual([]);
  });
});
