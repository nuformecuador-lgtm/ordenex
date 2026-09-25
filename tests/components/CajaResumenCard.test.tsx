// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";

import { CajaResumenCard } from "@/app/(app)/wallet/_components/CajaResumenCard";
import {
  CAJA_COMPOSICION_MENSAJE,
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
  // Feature 231 (R9/R10): 10 000 / 12 000 x 100 = 83.333… -> "83.33".
  porcentajeTiendas: "83.33",
  modoComposicion: "dos_bolsillos",
  // Ficha 459 (T A.1): los campos nuevos del contrato; capital 0.
  capital: "0.00",
  signoCapital: "cero",
  deOrdenex: "2000.00",
  signoDeTerceros: "positivo",
  deTercerosAbsoluto: "10000.00",
  // Ficha 459 (T A.8) — las suites de la 173/231 de este archivo hablan de «Dinero en caja», y
  // ese rótulo SOLO existe con un saldo inicial vigente (R18). Por eso el conjunto base va en
  // estado «saldo», a conciencia (listado en `progress/impl_459_frontend.md`); el estado
  // «flujo» —el de producción hoy— tiene su propia suite al final.
  estado: "saldo",
  flujoDesde: "2026-08-25",
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
    expect(within(enCaja).getByText("₡12.000")).toBeInTheDocument();
    expect(within(ganancia).getByText("₡2.000")).toBeInTheDocument();
    expect(within(enCaja).queryByText("₡2.000")).toBeNull();
    expect(within(ganancia).queryByText("₡12.000")).toBeNull();
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
    expect(within(columnaCaja).getByText("₡15.000")).toBeInTheDocument();
    expect(within(columnaCaja).getByText(CAJA_RESUMEN_LABEL.salidas)).toBeInTheDocument();
    expect(within(columnaCaja).getByText("₡3.000")).toBeInTheDocument();

    expect(
      within(columnaGanancia).getByText(CAJA_RESUMEN_LABEL.ingresosPropios),
    ).toBeInTheDocument();
    expect(within(columnaGanancia).getByText("₡5.000")).toBeInTheDocument();
    expect(
      within(columnaGanancia).getByText(CAJA_RESUMEN_LABEL.egresosPropios),
    ).toBeInTheDocument();

    // «Entró» (15 000) NO es «Ingresos de Ordenex» (5 000): el contra-entrega entra en la
    // caja y no en la ganancia. Si la tarjeta pintara el mismo par de importes en los dos
    // desgloses, esta línea lo caza.
    expect(within(columnaGanancia).queryByText("₡15.000")).toBeNull();
  });

  // ── Feature 231 (T4.3, R6) ──
  it("Entró, Salió y el conteo siguen en la tarjeta", () => {
    // El rediseño de la 231 refunde los tres tiles de la 200 en UNA tarjeta. Lo que no puede
    // pasar por el camino es que un dato DESAPAREZCA de la pantalla: los tres siguen aquí,
    // ahora como datos secundarios de la cifra grande y dentro de su misma columna.
    render(<CajaResumenCard resumen={RESUMEN} movimientos={7} />);

    const columnaCaja = screen.getByRole("region", { name: CAJA_RESUMEN_LABEL.enCaja })
      .parentElement as HTMLElement;

    expect(within(columnaCaja).getByText(CAJA_RESUMEN_LABEL.entradas)).toBeInTheDocument();
    expect(within(columnaCaja).getByText("₡15.000")).toBeInTheDocument();
    expect(within(columnaCaja).getByText(CAJA_RESUMEN_LABEL.salidas)).toBeInTheDocument();
    expect(within(columnaCaja).getByText("₡3.000")).toBeInTheDocument();
    // El conteo NO es dinero: entero pelado, sin símbolo de moneda.
    expect(within(columnaCaja).getByText(CAJA_RESUMEN_LABEL.movimientos)).toBeInTheDocument();
    expect(within(columnaCaja).getByText("7")).toBeInTheDocument();
    expect(within(columnaCaja).queryByText("₡7")).toBeNull();

    // Sin el conteo (la tarjeta lo recibe opcional) los otros dos siguen estando.
    cleanup();
    pintar();
    const soloDos = screen.getByRole("region", { name: CAJA_RESUMEN_LABEL.enCaja })
      .parentElement as HTMLElement;
    expect(within(soloDos).getByText(CAJA_RESUMEN_LABEL.entradas)).toBeInTheDocument();
    expect(within(soloDos).getByText(CAJA_RESUMEN_LABEL.salidas)).toBeInTheDocument();
    expect(within(soloDos).queryByText(CAJA_RESUMEN_LABEL.movimientos)).toBeNull();
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
    expect(within(enCaja).getByText("-₡500")).toBeInTheDocument();
    expect(within(enCaja).getByText("Negativo")).toBeInTheDocument();
    expect(within(ganancia).getByText("₡0")).toBeInTheDocument();
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
    // Dice lo que las diferencia, no que se diferencian: el dinero de las tiendas está en una y
    // no en la otra. Ficha 459 (design §3.3): el texto nuevo lo dice así y añade el capital.
    expect(texto.toLowerCase()).toContain("también el que es de las tiendas");
    expect(texto.toLowerCase()).toContain("el saldo inicial o los aportes");
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

// Ficha 459 (T A.8, R23/R24) — los tres casos de R34 de la 173 se REESCRIBEN: desde esta ficha
// «De las tiendas» YA ES lo que Ordenex les debe (la derivación descuenta flete, comisión e
// impuesto), así que la advertencia «no es lo que se les debe: es más» pasó a ser FALSA y R24
// prohíbe decirla. Lo que se afirma ahora es su sustituto.
describe("CajaResumenCard — «De las tiendas» (R34 de la 173 → R23/R24 de la 459)", () => {
  it("R23: rotula la cifra como lo que Ordenex les debe y explica que son los saldos netos", () => {
    pintar();

    const tercera = screen.getByRole("region", { name: CAJA_RESUMEN_LABEL.deTerceros });
    expect(within(tercera).getByText("₡10.000")).toBeInTheDocument();
    expect(CAJA_RESUMEN_LABEL.deTerceros).toBe("Lo que Ordenex les debe a las tiendas");

    const texto = within(tercera).getByRole("note").textContent ?? "";
    expect(texto).toBe(
      "Es la suma de los saldos de todas las tiendas, ya descontados el flete, la comisión y el impuesto. Los cobros de un costo a una tienda bajan su saldo sin pasar por la caja. El detalle de cada tienda está en Wallet → Tiendas.",
    );
    // R24: ni «es más» ni «no es lo que se les debe».
    expect(texto).not.toMatch(/es más/i);
    expect(texto).not.toMatch(/no es lo que se les debe/i);
  });

  it("R34: y lleva al sitio donde la deuda de verdad SÍ está", () => {
    pintar();

    const tercera = screen.getByRole("region", { name: CAJA_RESUMEN_LABEL.deTerceros });
    const enlace = within(tercera).getByRole("link");
    expect(enlace).toHaveAttribute("href", "/wallet/tiendas");
    // El enlace se explica solo: quien lo lee sabe a qué va antes de pulsarlo.
    expect((enlace.textContent ?? "").toLowerCase()).toContain("deuda");
  });

  it("R23: si es negativo, dice en palabras que las tiendas le deben a Ordenex, y cuánto", () => {
    // El ABSOLUTO lo manda el servidor (`deTercerosAbsoluto`): el navegador no le quita el signo
    // a nada (R28). Los dos importes se pintan: la cifra con su signo y la frase sin él.
    pintar({
      deTerceros: "-4780583.97",
      signoDeTerceros: "negativo",
      deTercerosAbsoluto: "4780583.97",
    });
    const tercera = screen.getByRole("region", { name: CAJA_RESUMEN_LABEL.deTerceros });
    expect(within(tercera).getByText("-₡4.780.583,97")).toBeInTheDocument();
    expect(
      within(tercera).getByText("Las tiendas le deben a Ordenex ₡4.780.583,97."),
    ).toBeInTheDocument();
    cleanup();

    // Con la cifra positiva la frase no existe.
    pintar();
    expect(screen.queryByText(/Las tiendas le deben a Ordenex/)).toBeNull();
  });

  it("la única mención a la deuda del bloque es el enlace a la otra pantalla", () => {
    pintar();
    const tercera = screen.getByRole("region", { name: CAJA_RESUMEN_LABEL.deTerceros });
    const menciones = (within(tercera).getByRole("note").textContent ?? "").match(/deuda/gi);
    expect(menciones ?? []).toHaveLength(0);
    expect(within(tercera).getByRole("link").textContent ?? "").toMatch(/deuda/);
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
    expect(within(periodo).getByText("₡12.000")).toBeInTheDocument();
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
  it("R64: pinta once dígitos EXACTO, sin recalcular nada en el navegador", () => {
    // Un `DECIMAL(12,2)` de once dígitos no cabe exacto en un `number`, y ahí es donde se ve
    // si el camino trabaja dígito a dígito. FICHA 359 — el conjunto de prueba es el mismo y lo
    // exigente cambia de forma: con la 230 era el ACARREO (`,99` y `,89` subían y tenía que
    // caer en el dígito correcto de once); ahora es CONSERVAR esos dos últimos dígitos sin
    // mover ninguno de los once de delante.
    pintar({
      entradas: "12345678901.99",
      salidas: "1000.10",
      enCaja: "12345677901.89",
      deTerceros: "0.10",
      // Ficha 459: el capital se pinta también; en este caso no puede ser `0.00`, porque la
      // última línea afirma que ningún importe de la tarjeta se lee «₡0».
      capital: "5.00",
      signoCapital: "positivo",
    });

    expect(screen.getByText("₡12.345.678.901,99")).toBeInTheDocument();
    expect(screen.getByText("₡1.000,10")).toBeInTheDocument();
    expect(screen.getByText("₡12.345.677.901,89")).toBeInTheDocument();
    // ✅ FICHA 359 — la consecuencia A2 de la 230, dada de baja. Esta línea decía: «`0.10` de
    // terceros se lee `₡0`, consecuencia aceptada por el humano». Un importe que existe
    // pintado como cero es exactamente la contradicción que esta ficha mata; hoy se lee.
    expect(screen.getByText("₡0,10")).toBeInTheDocument();
    expect(screen.queryByText("₡0")).toBeNull();
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

// ═══ Ficha 459 (T A.8, design §3.1–§3.4) — la tarjeta dice lo que la app sabe ═══════════════

/** Todo el texto y todos los nombres accesibles de lo pintado, en minúsculas. */
function textoYNombresAccesibles(container: HTMLElement): string {
  const nombres = [...container.querySelectorAll("[aria-label], [title], [alt]")].map((n) =>
    [n.getAttribute("aria-label"), n.getAttribute("title"), n.getAttribute("alt")].join(" "),
  );
  return `${container.textContent ?? ""} ${nombres.join(" ")}`.toLowerCase();
}

const FLUJO: Partial<CajaResumenDTO> = { estado: "flujo", flujoDesde: "2026-08-25" };

describe("Ficha 459 — estado «flujo»: sin saldo inicial (R15/R16/R17/R22)", () => {
  it("R15: la cifra se llama «Flujo de dinero registrado», dice desde cuándo y que no es el banco", () => {
    pintar(FLUJO);

    const region = screen.getByRole("region", { name: "Flujo de dinero registrado" });
    expect(within(region).getByText("₡12.000")).toBeInTheDocument();
    expect(
      within(region).getByText(
        "Lo que entró menos lo que salió desde el 25 de agosto de 2026. No es el saldo del banco: la app no sabe con cuánto dinero empezó Ordenex.",
      ),
    ).toBeInTheDocument();
  });

  it("R16: «Dinero en caja» no aparece en ningún texto ni nombre accesible de la tarjeta", () => {
    const { container } = pintar(FLUJO);
    expect(textoYNombresAccesibles(container)).not.toContain("dinero en caja");

    // Contraprueba: el detector SÍ lo encuentra cuando está (estado «saldo»).
    cleanup();
    const saldo = pintar({ estado: "saldo" });
    expect(textoYNombresAccesibles(saldo.container)).toContain("dinero en caja");
  });

  it("R16: tampoco con la cifra negativa, ni con «De las tiendas» negativo", () => {
    const { container } = pintar({
      ...FLUJO,
      enCaja: "-9186220.50",
      signoEnCaja: "negativo",
      deTerceros: "-4780583.97",
      signoDeTerceros: "negativo",
      deTercerosAbsoluto: "4780583.97",
      modoComposicion: "solo_ordenex",
    });
    expect(textoYNombresAccesibles(container)).not.toContain("dinero en caja");
  });

  it("R17: negativa y sin filtros, una línea explica que falta el dinero previo a la app", () => {
    pintar({ ...FLUJO, enCaja: "-9186220.50", signoEnCaja: "negativo" });
    const region = screen.getByRole("region", { name: "Flujo de dinero registrado" });
    expect(within(region).getByText("-₡9.186.220,50")).toBeInTheDocument();
    expect(
      within(region).getByText(
        "Sale negativo porque parte de los pagos se hicieron con dinero que Ordenex ya tenía antes de usar la app, y ese dinero no está registrado aquí.",
      ),
    ).toBeInTheDocument();
    cleanup();

    // Positiva: no hay línea.
    pintar(FLUJO);
    expect(screen.queryByText(/Sale negativo porque/)).toBeNull();
  });

  it("R22: en «flujo» no se pinta la barra ni ninguno de sus mensajes", () => {
    for (const modo of ["dos_bolsillos", "solo_tiendas", "solo_ordenex", "sin_reparto"] as const) {
      const { container } = pintar({ ...FLUJO, modoComposicion: modo });
      expect(screen.queryByRole("img"), `${modo}: barra pintada en flujo`).toBeNull();
      for (const mensaje of Object.values(CAJA_COMPOSICION_MENSAJE)) {
        if (mensaje !== null) expect(container.textContent ?? "").not.toContain(mensaje);
      }
      // Y el bloque de Ordenex no se tiñe por un modo que no se enseña.
      const ordenex = container.querySelector<HTMLElement>("[data-bolsillo='ordenex']");
      expect(ordenex?.dataset.superficie).toBe("neutra");
      cleanup();
    }
  });

  it("con el libro vacío (`flujoDesde` null) la pista dice que todavía no hay movimientos", () => {
    pintar({ estado: "flujo", flujoDesde: null, enCaja: "0.00", signoEnCaja: "cero" });
    const region = screen.getByRole("region", { name: "Flujo de dinero registrado" });
    expect(within(region).getByText("Todavía no hay movimientos registrados.")).toBeInTheDocument();
  });
});

describe("Ficha 459 — estado «saldo»: con un saldo inicial vigente (R18/R19/R22)", () => {
  it("R18: la cifra se llama «Dinero en caja» y explica el saldo inicial", () => {
    pintar({ estado: "saldo" });
    const region = screen.getByRole("region", { name: "Dinero en caja" });
    expect(
      within(region).getByText(
        "El saldo inicial registrado más todo lo que entró menos todo lo que salió desde entonces, incluido el dinero de las tiendas.",
      ),
    ).toBeInTheDocument();
  });

  it("R19: negativa y sin filtros, avisa que no puede serlo", () => {
    pintar({ estado: "saldo", enCaja: "-100.00", signoEnCaja: "negativo" });
    const region = screen.getByRole("region", { name: "Dinero en caja" });
    const aviso = within(region).getByText(
      "El dinero en caja no puede ser negativo. Revisá el saldo inicial y los pagos registrados.",
    );
    // Es una alarma (no puede pasar), no una explicación: tono de peligro.
    expect(aviso.className).toContain("text-danger-strong");
    expect(screen.queryByText(/Sale negativo porque/)).toBeNull();
  });

  it("R22: en «saldo» se pintan la barra y sus mensajes", () => {
    pintar({ estado: "saldo", modoComposicion: "solo_tiendas" });
    expect(screen.getByRole("img")).toBeInTheDocument();
    expect(screen.getByText(CAJA_COMPOSICION_MENSAJE.solo_tiendas as string)).toBeInTheDocument();
  });
});

describe("Ficha 459 — con filtros, en los dos estados (R20)", () => {
  it("R20: «Movimiento neto del periodo» en «flujo» y en «saldo», sin líneas de negativo", () => {
    for (const estado of ["flujo", "saldo"] as const) {
      const { container } = pintar({
        estado,
        periodoFiltrado: true,
        enCaja: "-50.00",
        signoEnCaja: "negativo",
      });
      expect(
        screen.getByRole("region", { name: "Movimiento neto del periodo" }),
        estado,
      ).toBeInTheDocument();
      expect(container.querySelector("[data-aviso='negativo']"), estado).toBeNull();
      // Ni la pista del flujo ni la del saldo: describen el libro entero, no un periodo.
      expect(container.textContent ?? "").not.toContain("desde el 25 de agosto");
      expect(container.textContent ?? "").not.toContain("El saldo inicial registrado más");
      cleanup();
    }
  });

  it("R20 + R22: con filtros, la barra sigue la regla del estado", () => {
    pintar({ estado: "flujo", periodoFiltrado: true });
    expect(screen.queryByRole("img")).toBeNull();
    cleanup();
    pintar({ estado: "saldo", periodoFiltrado: true });
    expect(screen.getByRole("img")).toBeInTheDocument();
  });
});

describe("Ficha 459 — el capital de Ordenex junto a la ganancia (R25)", () => {
  it("R25: región propia «Saldo inicial y aportes», con su cifra y su pista, y la ganancia igual", () => {
    pintar({ ...FLUJO, capital: "250000.33", signoCapital: "positivo" });
    const capital = screen.getByRole("region", { name: "Saldo inicial y aportes" });
    expect(within(capital).getByText("₡250.000,33")).toBeInTheDocument();
    expect(within(capital).getByText("Dinero de Ordenex que no es ganancia.")).toBeInTheDocument();
    // La ganancia conserva rótulo y valor, y su región no contiene el capital.
    const ganancia = screen.getByRole("region", { name: "Ganancia de Ordenex" });
    expect(within(ganancia).getByText("₡2.000")).toBeInTheDocument();
    expect(within(ganancia).queryByText("₡250.000,33")).toBeNull();
    // El capital va DENTRO del bolsillo de Ordenex.
    expect(capital.closest("[data-bolsillo='ordenex']")).not.toBeNull();
  });
});

describe("Ficha 459 — la nota de la diferencia usa el rótulo vigente (design §3.3)", () => {
  it("en «flujo» nombra «Flujo de dinero registrado»; en «saldo», «Dinero en caja»", () => {
    pintar(FLUJO);
    expect(
      screen.getByText(
        "«Flujo de dinero registrado» cuenta todo el dinero, también el que es de las tiendas. «Ganancia de Ordenex» es solo lo que Ordenex gana menos lo que gasta: no incluye el dinero de las tiendas ni el saldo inicial o los aportes.",
      ),
    ).toBeInTheDocument();
    cleanup();
    pintar({ estado: "saldo" });
    expect(screen.getByText(/^«Dinero en caja» cuenta todo el dinero/)).toBeInTheDocument();
  });
});
