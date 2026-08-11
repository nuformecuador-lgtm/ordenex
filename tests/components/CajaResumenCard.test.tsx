// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";

import { CajaResumenCard } from "@/app/(app)/wallet/_components/CajaResumenCard";
import {
  CATEGORIA_LABEL,
  CAJA_RESUMEN_LABEL,
} from "@/app/(app)/wallet/_components/wallet-labels";
import type { CajaResumenDTO } from "@/lib/types/wallet";
import {
  LLAMADAS_PROHIBIDAS_EN_DINERO,
  codigoSinComentarios,
} from "@/tests/fixtures/money-safe";

/**
 * Feature 173 (T G.1) — la tarjeta de las DOS cifras. Cubre R1 (parte UI), R34, R58, R59,
 * R60, R61 (parte tarjeta) y R64 (parte cliente).
 *
 * Lo que esta suite existe para impedir es UN error concreto y ya cometido: leer el número
 * grande de la caja como si fuera lo que Ordenex gana. Por eso casi todas las aserciones son
 * sobre lo que se ve A LA VEZ y sobre las palabras exactas, no sobre la estructura del DOM.
 *
 * El conjunto de prueba tiene dinero de las DOS naturalezas a propósito: `enCaja` (12 000) y
 * `ganancia` (2 000) son DISTINTOS, así que ninguna aserción puede pasar por casualidad
 * confundiendo una cifra con la otra.
 */
const RESUMEN: CajaResumenDTO = {
  entradas: "15000.00",
  salidas: "3000.00",
  enCaja: "12000.00",
  signoEnCaja: "positivo",
  ingresosPropios: "5000.00",
  egresosPropios: "3000.00",
  ganancia: "2000.00",
  signoGanancia: "positivo",
  deTerceros: "10000.00",
  periodoFiltrado: false,
};

/** Vocabulario que NO puede aparecer en esta pantalla: es de contador, no del maestro. */
const JERGA = [
  "balance",
  "contraasiento",
  "neteo",
  "netear",
  "devengo",
  "tesorería",
  "SLA",
  "wallet_movimiento",
  "ingreso_",
  "egreso_",
];

function pintar(overrides: Partial<CajaResumenDTO> = {}) {
  return render(<CajaResumenCard resumen={{ ...RESUMEN, ...overrides }} />);
}

/** El texto COMPLETO de lo pintado, tal y como lo leería una persona. */
function textoEnPantalla(): string {
  return document.body.textContent ?? "";
}

afterEach(() => {
  cleanup();
});

describe("CajaResumenCard — las dos cifras (R1/R58)", () => {
  it("R58: las DOS cifras se ven a la vez, cada una con su nombre y su importe", () => {
    pintar();

    const enCaja = screen.getByRole("region", { name: CAJA_RESUMEN_LABEL.enCaja });
    const ganancia = screen.getByRole("region", { name: CAJA_RESUMEN_LABEL.ganancia });

    // R1: son DOS números distintos, y cada uno está dentro de su propio bloque — no hay
    // forma de leer uno creyendo que es el otro.
    expect(within(enCaja).getByText("₡12.000,00")).toBeInTheDocument();
    expect(within(ganancia).getByText("₡2.000,00")).toBeInTheDocument();
    expect(within(enCaja).queryByText("₡2.000,00")).toBeNull();
    expect(within(ganancia).queryByText("₡12.000,00")).toBeNull();
  });

  it("R58: a la VEZ significa sin abrir nada — ni pestañas, ni desplegables, ni un botón", () => {
    // Es el punto entero de la feature: si una de las dos vive detrás de un clic, hay un
    // instante —el que dura la pantalla recién cargada— en el que solo se ve una.
    const { container } = pintar();

    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.queryAllByRole("tablist")).toHaveLength(0);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(container.querySelectorAll("details, summary")).toHaveLength(0);
    // Y ninguno de los dos bloques está oculto para el lector de pantalla.
    for (const rotulo of [CAJA_RESUMEN_LABEL.enCaja, CAJA_RESUMEN_LABEL.ganancia]) {
      const region = screen.getByRole("region", { name: rotulo });
      expect(region.closest("[hidden], [aria-hidden='true']")).toBeNull();
    }
  });

  it("cada cifra lleva su desglose, y son desgloses DISTINTOS", () => {
    pintar();

    const enCaja = screen.getByRole("region", { name: CAJA_RESUMEN_LABEL.enCaja });
    const ganancia = screen.getByRole("region", { name: CAJA_RESUMEN_LABEL.ganancia });

    // El desglose de cada cifra vive junto a ella (hermanos dentro de la misma columna).
    const columnaCaja = enCaja.parentElement as HTMLElement;
    const columnaGanancia = ganancia.parentElement as HTMLElement;

    expect(within(columnaCaja).getByText(CAJA_RESUMEN_LABEL.entradas)).toBeInTheDocument();
    expect(within(columnaCaja).getByText("₡15.000,00")).toBeInTheDocument();
    expect(within(columnaCaja).getByText(CAJA_RESUMEN_LABEL.salidas)).toBeInTheDocument();
    expect(within(columnaCaja).getByText("₡3.000,00")).toBeInTheDocument();

    expect(
      within(columnaGanancia).getByText(CAJA_RESUMEN_LABEL.ingresosPropios),
    ).toBeInTheDocument();
    expect(within(columnaGanancia).getByText("₡5.000,00")).toBeInTheDocument();
    expect(
      within(columnaGanancia).getByText(CAJA_RESUMEN_LABEL.egresosPropios),
    ).toBeInTheDocument();

    // «Entró» (15 000) NO es «Ingresos de Ordenex» (5 000): el contra-entrega entra en la
    // caja y no en la ganancia. Si la tarjeta pintara el mismo par de importes en los dos
    // desgloses, esta línea lo caza.
    expect(within(columnaGanancia).queryByText("₡15.000,00")).toBeNull();
  });

  it("los signos los da el SERVIDOR: negativo y cero se pintan sin recalcular nada", () => {
    pintar({
      enCaja: "-500.00",
      signoEnCaja: "negativo",
      ganancia: "0.00",
      signoGanancia: "cero",
    });

    const enCaja = screen.getByRole("region", { name: CAJA_RESUMEN_LABEL.enCaja });
    const ganancia = screen.getByRole("region", { name: CAJA_RESUMEN_LABEL.ganancia });

    // El STRING llega con su signo puesto y se pinta tal cual.
    expect(within(enCaja).getByText("-₡500,00")).toBeInTheDocument();
    expect(within(enCaja).getByText("Negativo")).toBeInTheDocument();
    expect(within(ganancia).getByText("₡0,00")).toBeInTheDocument();
    expect(within(ganancia).getByText("En cero")).toBeInTheDocument();
  });
});

describe("CajaResumenCard — la palabra que mentía (R59)", () => {
  it("R59: no aparece en ningún rótulo, importe ni nombre accesible", () => {
    const { container } = pintar();

    expect(textoEnPantalla().toLowerCase()).not.toContain("balance");
    // Tampoco escondida en el árbol de accesibilidad, que para quien usa lector de pantalla
    // ES la pantalla: `aria-label`, `title` y `alt` de todo lo pintado.
    for (const nodo of container.querySelectorAll("[aria-label], [title], [alt]")) {
      const accesible = [
        nodo.getAttribute("aria-label"),
        nodo.getAttribute("title"),
        nodo.getAttribute("alt"),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      expect(accesible).not.toContain("balance");
    }
  });

  it("y tampoco con los filtros puestos, que es cuando cambia de rótulo", () => {
    pintar({ periodoFiltrado: true });
    expect(textoEnPantalla().toLowerCase()).not.toContain("balance");
  });
});

describe("CajaResumenCard — la nota de la diferencia (R60)", () => {
  it("R60: explica en qué se diferencian, nombrando LAS DOS cifras por su nombre", () => {
    pintar();

    const notas = screen.getAllByRole("note");
    const diferencia = notas.find((n) =>
      (n.textContent ?? "").includes(CAJA_RESUMEN_LABEL.ganancia),
    );
    expect(diferencia, "falta la nota de diferencia").toBeDefined();

    const texto = diferencia?.textContent ?? "";
    expect(texto).toContain(`«${CAJA_RESUMEN_LABEL.enCaja}»`);
    expect(texto).toContain(`«${CAJA_RESUMEN_LABEL.ganancia}»`);
    // Dice lo que las diferencia, no que se diferencian: el contra-entrega está en una y no
    // en la otra.
    expect(texto.toLowerCase()).toContain("contra-entrega");
  });

  it("R60: en español llano — sin siglas y sin jerga de contador", () => {
    pintar();

    const notas = screen.getAllByRole("note");
    const diferencia = notas.find((n) =>
      (n.textContent ?? "").includes(CAJA_RESUMEN_LABEL.ganancia),
    );
    const texto = diferencia?.textContent ?? "";

    expect(texto.length).toBeGreaterThan(0);
    // Ninguna sigla: nada de dos o más mayúsculas seguidas.
    expect(texto).not.toMatch(/\b[A-ZÁÉÍÓÚÑ]{2,}\b/);
    for (const palabra of JERGA) {
      expect(texto.toLowerCase(), `la nota dice «${palabra}»`).not.toContain(
        palabra.toLowerCase(),
      );
    }
  });

  it("la pantalla entera habla el mismo idioma: ni jerga ni nombres técnicos del enum", () => {
    pintar({ periodoFiltrado: true });
    const texto = textoEnPantalla().toLowerCase();
    for (const palabra of JERGA) {
      expect(texto, `la tarjeta dice «${palabra}»`).not.toContain(palabra.toLowerCase());
    }
  });
});

describe("CajaResumenCard — la tercera línea y su advertencia (R34 / [P6])", () => {
  it("R34: muestra el dinero de las tiendas y AVISA de que no es lo que se les debe", () => {
    pintar();

    const tercera = screen.getByRole("region", { name: CAJA_RESUMEN_LABEL.deTerceros });
    expect(within(tercera).getByText("₡10.000,00")).toBeInTheDocument();

    const aviso = within(tercera).getByRole("note");
    const texto = aviso.textContent ?? "";
    // Lo que la advertencia tiene que transmitir, y el porqué: esa cifra es MAYOR que la
    // deuda real, porque de ese dinero Ordenex todavía descuenta sus cobros.
    expect(texto).toMatch(/no es lo que se les debe/i);
    expect(texto.toLowerCase()).toContain("flete");
    expect(texto.toLowerCase()).toContain("comisión");
    expect(texto).toMatch(/es más/i);
  });

  it("R34: y lleva al sitio donde la deuda de verdad SÍ está", () => {
    pintar();

    const tercera = screen.getByRole("region", { name: CAJA_RESUMEN_LABEL.deTerceros });
    const enlace = within(tercera).getByRole("link");
    expect(enlace).toHaveAttribute("href", "/wallet/tiendas");
    // El enlace se explica solo: quien lo lee sabe a qué va antes de pulsarlo.
    expect((enlace.textContent ?? "").toLowerCase()).toContain("deuda");
  });

  it("R34: la tercera línea NO se presenta como la deuda con las tiendas", () => {
    pintar();

    const tercera = screen.getByRole("region", { name: CAJA_RESUMEN_LABEL.deTerceros });
    // El rótulo dice lo que la cifra ES —cobrado y no entregado—, no lo que NO es.
    const rotulo = CAJA_RESUMEN_LABEL.deTerceros.toLowerCase();
    expect(rotulo).toContain("cobrado");
    expect(rotulo).not.toMatch(/se (les )?debe/);
    expect(rotulo).not.toContain("deuda");
    // Y la única mención a la deuda dentro del bloque es la que la manda a otra pantalla.
    const menciones = (within(tercera).getByRole("note").textContent ?? "").match(/deuda/gi);
    expect(menciones ?? []).toHaveLength(1);
  });

  it("R61 (parte tarjeta): nombra ese dinero con las MISMAS palabras que el libro", () => {
    // La categoría nueva se llama «Contra-entrega cobrado» en el listado, en el filtro y en
    // la descarga; si la tarjeta lo llamara de otra forma, nadie ataría una cosa con la otra.
    expect(CAJA_RESUMEN_LABEL.deTerceros).toContain(
      CATEGORIA_LABEL.ingreso_cod_recaudado,
    );
    pintar();
    expect(
      screen.getByRole("region", { name: CAJA_RESUMEN_LABEL.deTerceros }),
    ).toBeInTheDocument();
  });
});

describe("CajaResumenCard — el rótulo condicional ([P7])", () => {
  it("[P7]: sin filtros es «Dinero en caja»; con filtros, el neto del periodo", () => {
    pintar({ periodoFiltrado: false });
    expect(
      screen.getByRole("region", { name: CAJA_RESUMEN_LABEL.enCaja }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: CAJA_RESUMEN_LABEL.enCajaPeriodo }),
    ).toBeNull();
    cleanup();

    pintar({ periodoFiltrado: true });
    expect(
      screen.getByRole("region", { name: CAJA_RESUMEN_LABEL.enCajaPeriodo }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: CAJA_RESUMEN_LABEL.enCaja })).toBeNull();
  });

  it("[P7]: cambia el NOMBRE, no el número — y la ganancia no cambia de nombre", () => {
    pintar({ periodoFiltrado: true });

    const periodo = screen.getByRole("region", { name: CAJA_RESUMEN_LABEL.enCajaPeriodo });
    expect(within(periodo).getByText("₡12.000,00")).toBeInTheDocument();
    // La otra cifra se llama igual siempre: filtrar un periodo no le cambia el significado.
    expect(
      screen.getByRole("region", { name: CAJA_RESUMEN_LABEL.ganancia }),
    ).toBeInTheDocument();
  });

  it("[P7]: con filtros añade el aviso de que eso no es el dinero que hay hoy", () => {
    pintar({ periodoFiltrado: false });
    const sinFiltros = screen.getAllByRole("note").length;
    cleanup();

    pintar({ periodoFiltrado: true });
    const conFiltros = screen.getAllByRole("note").map((n) => n.textContent ?? "");
    expect(conFiltros.length).toBe(sinFiltros + 1);
    expect(conFiltros.join(" ")).toMatch(/no es el dinero que hay hoy en la caja/i);
  });

  it("[P7]: la bandera viene del DTO — la tarjeta no la deduce de nada del cliente", () => {
    // Contraprueba estructural: dos DTOs con los MISMOS importes y distinta bandera dan dos
    // rótulos distintos. Y la fuente no consulta filtros, ni URL, ni estado propio: si el día
    // de mañana alguien quisiera adivinar aquí si hay filtros puestos, tendría que importar
    // algo de esta lista.
    const fuente = codigoSinComentarios(
      "app/(app)/wallet/_components/CajaResumenCard.tsx",
    );
    expect(fuente).toContain("periodoFiltrado");
    expect(fuente).not.toMatch(/\buseState\b|\buseEffect\b|\buseSearchParams\b/);
    expect(fuente).not.toMatch(/\bfiltros\b|\bwindow\.location\b|\bdocument\b/);
  });
});

describe("CajaResumenCard — money-safe en el navegador (R64)", () => {
  it("R64: pinta los importes TAL CUAL, con sus céntimos, sin recalcular", () => {
    // Un `DECIMAL(12,2)` de once dígitos no cabe exacto en un `number`: si alguien metiera un
    // `Number(...)` intermedio, este importe volvería redondeado y con los céntimos comidos.
    pintar({
      entradas: "12345678901.99",
      salidas: "1000.10",
      enCaja: "12345677901.89",
      deTerceros: "0.10",
    });

    expect(screen.getByText("₡12.345.678.901,99")).toBeInTheDocument();
    expect(screen.getByText("₡1.000,10")).toBeInTheDocument();
    expect(screen.getByText("₡12.345.677.901,89")).toBeInTheDocument();
    expect(screen.getByText("₡0,10")).toBeInTheDocument();
  });

  it("R64: la tarjeta no tiene forma de operar con dinero", () => {
    const fuente = codigoSinComentarios(
      "app/(app)/wallet/_components/CajaResumenCard.tsx",
    );
    for (const prohibida of LLAMADAS_PROHIBIDAS_EN_DINERO) {
      expect(fuente, `la tarjeta llama a ${prohibida}`).not.toMatch(prohibida);
    }
    // Sin biblioteca de decimales y sin conversión a número, en el cliente solo queda pintar.
    expect(fuente).not.toMatch(/from\s+"@prisma\/client"|from\s+"decimal\.js"/);
    // Y no deriva ninguna de las dos cifras: eso es del servidor (R64), no de la pantalla.
    expect(fuente).not.toMatch(/derivarCaja|derivarBalance/);
  });
});
