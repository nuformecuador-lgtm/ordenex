// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";

// Ficha 339 (T5.3): la tarjeta monta ahora filas DESPLEGABLES, y el panel de cada una importa
// el borde del detalle. Este archivo mide la TARJETA —rótulos, importes, orden y copy—, no la
// lectura del detalle (eso es `DetalleFilaComposicion.test.tsx`), pero el import se resuelve
// igual al cargar el módulo: sin este doble, `lib/actions/wallet` arrastraría Prisma y la sesión
// a un test de jsdom y el archivo entero se quedaría sin ejecutar.
vi.mock("@/lib/actions/wallet", () => ({
  listarMovimientosDeFilaAction: vi.fn(),
}));

import { ComposicionGananciaCard } from "@/app/(app)/wallet/_components/ComposicionGananciaCard";
import { FILTROS_VACIOS } from "@/app/(app)/wallet/_components/WalletFiltros";
import { CATEGORIA_LABEL, money } from "@/app/(app)/wallet/_components/wallet-labels";
import {
  conceptoPorId,
  nombreEnElLibro,
} from "@/app/(app)/wallet/_components/wallet-conceptos-manuales";
import type {
  CajaResumenDTO,
  ComposicionGananciaDTO,
  DesgloseEgresosDTO,
} from "@/lib/types/wallet";
import {
  WALLET_EGRESO_NOMBRADO_SEED,
  WALLET_INGRESO_PROPIO_SEED,
} from "@/lib/types/wallet";
import {
  LLAMADAS_PROHIBIDAS_EN_DINERO,
  codigoSinComentarios,
} from "@/tests/fixtures/money-safe";

/**
 * Feature 231 (T6.2/T6.4) — «Cómo se compone la ganancia de Ordenex».
 *
 * Esta tarjeta ABSORBE la tarjeta «Egresos» de las features 45 y 158 (D2, firmada por el humano
 * el 2026-08-18): su lista es ahora la columna derecha de aquí, con una fila más para que el
 * total cuadre con `egresosPropios`.
 *
 * Por eso este archivo empieza RE-HOSPEDANDO las aserciones que vivían en
 * `tests/unit/components/wallet-desglose-egresos-card.test.tsx` —las 8 de la 45 (R11/R12) y las
 * 10 de la 158 (R32 y T2.5)—, apuntadas al anfitrión nuevo y con su nombre y su intención
 * intactos. Borrar un componente borra su test y con él la red de features ajenas; este repo ya
 * pagó esa factura en producción una vez y no la vuelve a pagar aquí.
 */

/** El MISMO conjunto de la 45/158: cuatro conceptos que suman 1 250,75. */
const DESGLOSE: DesgloseEgresosDTO = {
  gastoFijo: "300.00",
  gastoVariable: "125.50",
  sueldo: "800.00",
  indemnizacion: "25.25", // feature 158/R32
  total: "1250.75",
};

/**
 * El conjunto de ESTA feature. Los siete ingresos son distintos entre sí y están DESORDENADOS
 * respecto de su magnitud a propósito: el mayor (4 000) es el SEGUNDO y el menor (19,50) el
 * cuarto, así que cualquier orden por importe daría una secuencia distinta de la declarada.
 *
 * No es un detalle del conjunto: con los importes ya ordenados de mayor a menor —como estaban
 * en el primer intento— una tarjeta que ordenara por magnitud pintaba EXACTAMENTE lo mismo y
 * el caso de R28 pasaba en verde con el código roto. Se descubrió matándolo con una mutación.
 *
 * Suman `totalIngresos` (5 709,75) exactamente; los egresos, 1 250,75 + 940 = 2 190,75.
 */
const COMPOSICION: ComposicionGananciaDTO = {
  ingresos: {
    ingreso_flete: "150.00",
    ingreso_flete_devolucion: "4000.00",
    ingreso_comision_cod: "900.00",
    ingreso_iva_flete: "19.50",
    ingreso_iva_flete_devolucion: "520.00",
    ingreso_iva_comision_cod: "30.25",
    ingreso_ajuste: "90.00",
  },
  totalIngresos: "5709.75",
  /**
   * Ficha 339 (T6.3) — las dos cubetas que la ficha SACA del cubo anónimo, con importes
   * distintos entre sí y distintos de todos los demás de la columna.
   *
   * Los 940,00 que la 231 pintaba en «Otros» se REPARTEN aquí: 700,00 de pagos a mensajeros +
   * 45,75 de ajustes + 194,25 que siguen sin clasificar = 940,00 exactos. No es un fixture
   * bonito: es la historia de la ficha escrita como conjunto de prueba, y por eso
   * `totalEgresos` NO se toca (R12). Sacar un concepto del cubo cambia de cubeta un importe;
   * no lo saca de la suma.
   */
  egresos: {
    egreso_pago_mensajero: "700.00",
    egreso_ajuste: "45.75",
  },
  otrosEgresos: "194.25",
  // R9: lo decide el SERVIDOR. Aqui quedan 194,25 sin clasificar, asi que la fila se pinta.
  hayOtrosEgresos: true,
  totalEgresos: "2190.75",
};

const RESUMEN: CajaResumenDTO = {
  entradas: "18000.00",
  salidas: "2190.75",
  enCaja: "15809.25",
  signoEnCaja: "positivo",
  ingresosPropios: "5709.75",
  egresosPropios: "2190.75",
  // 5 709,75 - 2 190,75 = 3 519,00
  ganancia: "3519.00",
  signoGanancia: "positivo",
  deTerceros: "12290.25",
  periodoFiltrado: false,
  porcentajeTiendas: "77.74",
  modoComposicion: "dos_bolsillos",
};

function pintar({
  desglose = DESGLOSE,
  composicion = COMPOSICION,
  resumen = RESUMEN,
}: {
  desglose?: DesgloseEgresosDTO;
  composicion?: ComposicionGananciaDTO;
  resumen?: CajaResumenDTO;
} = {}) {
  return render(
    <ComposicionGananciaCard
      desglose={desglose}
      composicion={composicion}
      resumen={resumen}
      filtros={FILTROS_VACIOS}
    />,
  );
}

/**
 * El conjunto con el que la 45 y la 158 medían: el total de la columna es el suyo, y los DOS
 * conceptos que la 343 saca del cubo están en cero — que es exactamente el conjunto de aquellas
 * features, cuatro conceptos y nada más.
 */
function pintarComoLa158(overrides: Partial<ComposicionGananciaDTO> = {}) {
  return pintar({
    composicion: {
      ...COMPOSICION,
      egresos: { egreso_pago_mensajero: "0.00", egreso_ajuste: "0.00" },
      otrosEgresos: "0.00",
      hayOtrosEgresos: false, // ficha 343 (R7): sin residuo, la fila «Otros» no se pinta
      totalEgresos: DESGLOSE.total,
      ...overrides,
    },
  });
}

function listaEgresos(): HTMLElement {
  return screen.getByRole("group", { name: "Desglose de egresos" });
}

function listaIngresos(): HTMLElement {
  return screen.getByRole("group", { name: "Desglose de ingresos" });
}

/** Los rótulos de una lista, en el orden en que se pintan (el último es el total). */
function rotulos(lista: HTMLElement): string[] {
  return [...lista.querySelectorAll("dt")].map((dt) => dt.textContent ?? "");
}

/**
 * Los pares ROTULO ↔ IMPORTE de una lista, fila a fila.
 *
 * Se leen del contenedor de CADA fila y no de dos `querySelectorAll` paralelos: así el par se
 * afirma DENTRO de su renglón y un intercambio de importes entre dos filas —que dos listas
 * paralelas no distinguirían— cae igual. El último par es el del total.
 */
function pares(lista: HTMLElement): { rotulo: string; importe: string }[] {
  return [...lista.children].map((fila) => ({
    rotulo: (fila.querySelector("dt")?.textContent ?? "").trim(),
    importe: (fila.querySelector("dd")?.textContent ?? "").trim(),
  }));
}

afterEach(() => {
  cleanup();
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// RE-HOSPEDADAS — features 45 y 158. Ni una aserción menos que en el anfitrión anterior.
// ─────────────────────────────────────────────────────────────────────────────────────────

describe("DesgloseEgresosCard — render (R11/R12) [re-hospedado de la 45]", () => {
  it("renderiza los totales por tipo y el total como STRING", () => {
    pintarComoLa158();

    const lista = listaEgresos();
    expect(within(lista).getByText("Gastos fijos")).toBeInTheDocument();
    expect(within(lista).getByText("₡300")).toBeInTheDocument();
    expect(within(lista).getByText("Gastos variables")).toBeInTheDocument();
    expect(within(lista).getByText("₡126")).toBeInTheDocument();
    expect(within(lista).getByText("Sueldos")).toBeInTheDocument();
    expect(within(lista).getByText("₡800")).toBeInTheDocument();
    expect(within(lista).getByText("Total de egresos")).toBeInTheDocument();
    expect(within(lista).getByText("₡1.251")).toBeInTheDocument();
  });
});

describe("Feature 158/R32 — la indemnización es una fila propia y suma al total [re-hospedado]", () => {
  it("pinta la fila 'Indemnizaciones' con su monto TAL CUAL", () => {
    pintarComoLa158();

    const lista = listaEgresos();
    expect(within(lista).getByText("Indemnizaciones")).toBeInTheDocument();
    expect(within(lista).getByText("₡25")).toBeInTheDocument();
  });

  it("el total mostrado es el que llega del servidor (la tarjeta NO suma dinero)", () => {
    // 300.00 + 125.50 + 800.00 + 25.25 = 1250.75. El componente no hace la cuenta: si el
    // servidor mandara otro total, la tarjeta mostraría ESE (money-safe, un solo origen).
    //
    // Feature 230/R20: el total que se pinta es el REDONDEO DEL TOTAL, nunca la suma de los
    // redondeos. Aquí, con `999.99 -> ₡1.000` y las filas sumando ₡1.251, se ve que la tarjeta
    // pinta lo que le mandan aunque no cuadre con las filas de arriba.
    //
    // Feature 231: el total de esta columna ya no es `DesgloseEgresosDTO.total` sino
    // `ComposicionGananciaDTO.totalEgresos` —que incluye «Otros gastos de Ordenex»—, pero la
    // afirmación es la MISMA: el número lo manda el servidor y la pantalla no lo recalcula.
    pintarComoLa158({ totalEgresos: "999.99" });
    expect(within(listaEgresos()).getByText("₡1.000")).toBeInTheDocument();
  });

  it("un monto que no cabe en un `number` se redondea EXACTO (sin parseFloat)", () => {
    pintar({
      desglose: { ...DESGLOSE, indemnizacion: "12345678901.99" },
      composicion: {
        ...COMPOSICION,
        otrosEgresos: "0.00",
        hayOtrosEgresos: false, // ficha 343 (R7)
        totalEgresos: "12345679127.49",
      },
    });

    const lista = listaEgresos();
    // Feature 230: los dos redondean en sentidos opuestos (`,99` sube, `,49` baja) sobre once
    // dígitos, y eso solo sale bien trabajando dígito a dígito. Un `parseFloat`/`Number`
    // intermedio pondría en juego la precisión justo aquí.
    expect(within(lista).getByText("₡12.345.678.902")).toBeInTheDocument();
    expect(within(lista).getByText("₡12.345.679.127")).toBeInTheDocument();
  });
});

describe("Feature 158/T2.5 — el copy del título deja de decir 'administrativos' [re-hospedado]", () => {
  it("la tarjeta ya NO se titula 'Egresos administrativos'", () => {
    const { container } = pintarComoLa158();

    // El rótulo de la columna dice «Egresos», a secas. La indemnización es un egreso
    // OPERATIVO: el rótulo viejo sería falso con esa fila dentro, y encima falso sobre dinero.
    expect(screen.getByText("Egresos")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/Egresos administrativos/);
  });

  it("dice qué entra y qué NO entra en el total, en vez de dejarlo implícito", () => {
    const { container } = pintarComoLa158();

    const descripcion = container.querySelector('[data-slot="card-description"]');
    expect(descripcion?.textContent ?? "").toMatch(/indemnizaci/i);
    // La tarjeta NO es el total de TODO el dinero de la caja. La 158 decía «no incluye los
    // pagos a tiendas ni a mensajeros»; aquí el pago a mensajeros SÍ entra (D2), así que lo
    // que queda fuera —y lo que se dice— es el dinero de las tiendas.
    expect(descripcion?.textContent ?? "").toMatch(/no incluye/i);
    expect(descripcion?.textContent ?? "").toMatch(/tienda|mensajero/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// PROPIAS de la feature 231.
// ─────────────────────────────────────────────────────────────────────────────────────────

describe("ComposicionGananciaCard — las dos columnas y el pie (R22/R23)", () => {
  it("R22: la tarjeta enseña ingresos, egresos y la ganancia en el pie", () => {
    const { container } = pintar();

    // Los dos lados, cada uno con su grupo accesible y su total.
    expect(within(listaIngresos()).getByText("Total de ingresos")).toBeInTheDocument();
    expect(within(listaIngresos()).getByText("₡5.710")).toBeInTheDocument();
    expect(within(listaEgresos()).getByText("Total de egresos")).toBeInTheDocument();
    expect(within(listaEgresos()).getByText("₡2.191")).toBeInTheDocument();

    // Y la resta, en el pie de la tarjeta y no perdida entre las filas.
    const pie = container.querySelector<HTMLElement>('[data-slot="card-footer"]');
    expect(pie, "la tarjeta no tiene pie").not.toBeNull();
    expect(within(pie as HTMLElement).getByText("Ganancia de Ordenex")).toBeInTheDocument();
    expect(within(pie as HTMLElement).getByText("₡3.519")).toBeInTheDocument();
  });

  it("R23: hay una fila por cada categoría de ingreso propio del catálogo", () => {
    pintar();

    const filas = rotulos(listaIngresos());
    // Control de no-vacuidad: el catálogo tiene siete conceptos, no cero.
    expect(WALLET_INGRESO_PROPIO_SEED.length).toBe(7);
    // Las siete filas más la del total: ninguna categoría propia se queda sin enseñar.
    expect(filas).toHaveLength(WALLET_INGRESO_PROPIO_SEED.length + 1);
    for (const categoria of WALLET_INGRESO_PROPIO_SEED) {
      expect(filas, `falta ${categoria}`).toContain(CATEGORIA_LABEL[categoria]);
    }
  });

  it("R22/R23: cada concepto lleva SU importe, no el del vecino", () => {
    // BLOQUEANTE 1 de `progress/review_231.md`: hasta aquí esta suite comprobaba de la columna
    // de ingresos los rótulos, el orden, el número de filas y el TOTAL — y ni un solo importe
    // por concepto. Con eso, una tarjeta que pintara el MISMO importe en las siete filas pasaba
    // en verde: el total lo manda el servidor, así que la resta seguía cuadrando en pantalla y
    // los conceptos mentían. Medido con la mutación
    // `valor={composicion.ingresos[categoria]}` → `valor={composicion.ingresos.ingreso_flete}`.
    //
    // El par rótulo↔importe se afirma FILA A FILA y con los importes escritos a mano —no
    // recalculados con `money()`, que es la función que la pantalla usa y que por tanto no
    // podría contradecir—.
    pintar();

    expect(pares(listaIngresos())).toEqual([
      { rotulo: "Flete", importe: "₡150" },
      { rotulo: "Flete por rechazo", importe: "₡4.000" },
      { rotulo: "Comisión COD", importe: "₡900" },
      { rotulo: "IVA del flete", importe: "₡20" },
      { rotulo: "IVA del flete por rechazo", importe: "₡520" },
      { rotulo: "IVA de la comisión", importe: "₡30" },
      { rotulo: "Ajuste (ingreso)", importe: "₡90" },
      { rotulo: "Total de ingresos", importe: "₡5.710" },
    ]);

    // La columna de egresos, con el mismo rasero: la 45/158 afirmaba rótulo e importe por
    // separado dentro de la misma lista, así que un intercambio entre dos filas sobrevivía.
    //
    // Ficha 339 (T6.3) — ESTE `toEqual` ES EL CONTRATO de la columna, y por eso se actualiza a
    // mano, fila a fila, en vez de sustituirse por una derivación de la propia fuente que lo
    // dejaría siempre verde. Lo que cambia: dos filas nuevas —«Pagos a mensajeros» y «Ajustes
    // (egreso)»— JUSTO ANTES de «Otros», que baja de ₡940 a ₡194 porque lo que se le sacó ya
    // tiene nombre. El total de la columna NO se mueve: sigue siendo ₡2.191 (R12).
    expect(pares(listaEgresos())).toEqual([
      { rotulo: "Gastos fijos", importe: "₡300" },
      { rotulo: "Gastos variables", importe: "₡126" },
      { rotulo: "Sueldos", importe: "₡800" },
      { rotulo: "Indemnizaciones", importe: "₡25" },
      { rotulo: "Pagos a mensajeros", importe: "₡700" },
      { rotulo: "Ajustes (egreso)", importe: "₡46" },
      { rotulo: "Otros gastos de Ordenex", importe: "₡194" },
      { rotulo: "Total de egresos", importe: "₡2.191" },
    ]);
  });

  it("CONTROL: los importes del conjunto son distintos entre sí, ya formateados", () => {
    // Sin esto, el caso de arriba podría estar pasando con dos filas intercambiadas: si dos
    // conceptos valieran lo mismo, ponerle a uno el importe del otro no cambiaría ni un píxel.
    // Es la misma clase de agujero que dejó sobrevivir la mutación del ORDEN (M9).
    //
    // Y el peligro no es teórico desde la feature 230, que pinta el dinero SIN CÉNTIMOS: dos
    // importes distintos en el DTO pueden colapsar en el mismo texto («19.50» y «20.49» se
    // pintan los dos «₡20»). Por eso la colisión se mide DESPUÉS de formatear, no antes.
    //
    // ── POR QUÉ AQUÍ SÍ SE USA `money()`, Y EN EL CASO DE ARRIBA NO ──
    // Arriba los importes van escritos a mano porque el sujeto de la prueba es LA PANTALLA, y
    // comprobarla contra la misma función que la pinta sería una aserción contra su propia
    // fuente. Aquí el sujeto es EL CONJUNTO DE PRUEBA, y lo que se quiere saber es si colisiona
    // *bajo el formateador real*: el formateador es parte del sujeto, no el oráculo.
    //
    // Se DERIVA del fixture y no se escribe a mano a propósito: una lista literal se queda atrás
    // en cuanto alguien toca un importe de `COMPOSICION` —el caso de emparejado se pondría rojo
    // y se actualizaría, y éste seguiría verde afirmando sobre un conjunto que ya no existe—,
    // que es justo cuando el control tiene que hablar.
    const importesIngresos = WALLET_INGRESO_PROPIO_SEED.map((c) =>
      money(COMPOSICION.ingresos[c]),
    );
    expect(importesIngresos).toHaveLength(WALLET_INGRESO_PROPIO_SEED.length);
    expect(new Set(importesIngresos).size).toBe(WALLET_INGRESO_PROPIO_SEED.length);

    // Las SIETE filas de la columna de egresos, en el orden que declara el componente (ficha
    // 339: cuatro conceptos + los dos que salen del cubo + el cubo).
    const importesEgresos = [
      DESGLOSE.gastoFijo,
      DESGLOSE.gastoVariable,
      DESGLOSE.sueldo,
      DESGLOSE.indemnizacion,
      COMPOSICION.egresos.egreso_pago_mensajero,
      COMPOSICION.egresos.egreso_ajuste,
      COMPOSICION.otrosEgresos,
    ].map(money);
    expect(importesEgresos).toHaveLength(7);
    expect(new Set(importesEgresos).size).toBe(importesEgresos.length);

    // Y ninguno coincide con un total, que es el otro modo de que una fila mal cableada pase.
    expect(importesIngresos).not.toContain(money(COMPOSICION.totalIngresos));
    expect(importesEgresos).not.toContain(money(COMPOSICION.totalEgresos));
  });

  it("R25: cada concepto con su etiqueta legible, nunca el enum", () => {
    pintar();

    const filas = rotulos(listaIngresos());
    for (const categoria of WALLET_INGRESO_PROPIO_SEED) {
      expect(filas, `la tarjeta pinta el enum ${categoria}`).not.toContain(categoria);
      expect(CATEGORIA_LABEL[categoria]).not.toBe(categoria);
    }
    // Ningún rótulo tiene pinta de nombre técnico.
    for (const rotulo of filas) expect(rotulo).not.toMatch(/_/);
  });

  it("R28: el orden es el declarado, no el de magnitud", () => {
    pintar();

    const declarado = WALLET_INGRESO_PROPIO_SEED.map((c) => CATEGORIA_LABEL[c]);
    expect(rotulos(listaIngresos()).slice(0, declarado.length)).toEqual(declarado);

    // CONTRAPRUEBA de que la aserción de arriba DISCRIMINA: el importe mayor del conjunto no
    // está el primero ni el último, así que una tarjeta que ordenara por magnitud —de mayor a
    // menor o al revés— daría otra secuencia y la aserción de arriba caería.
    //
    // Sin esta comprobación, un conjunto de prueba que resultara estar ya ordenado por importe
    // dejaría el caso pasando con el código roto. Pasó en el primer intento y lo destapó una
    // mutación; esta línea es lo que impide que vuelva a pasar sin que nadie se entere.
    const importes = WALLET_INGRESO_PROPIO_SEED.map((c) => COMPOSICION.ingresos[c]);
    const mayor = importes.reduce((a, b) => (b.length > a.length ? b : a));
    expect(mayor).toBe("4000.00");
    expect(importes[0]).not.toBe(mayor);
    expect(importes[importes.length - 1]).not.toBe(mayor);

    // Y el orden de la columna de egresos tampoco es el de magnitud: «Otros gastos» (194,25) va
    // DESPUÉS de la indemnización (25,25), porque su sitio está declarado, no calculado.
    //
    // Ficha 339 (R6/T6.3): las dos filas nuevas entran JUSTO ANTES de «Otros» —decisión
    // cerrada—, no al principio de la columna: aparecen donde el dinero se venía mostrando, sin
    // reordenar una tarjeta que la gente ya conoce.
    const egresos = rotulos(listaEgresos());
    expect(egresos).toEqual([
      "Gastos fijos",
      "Gastos variables",
      "Sueldos",
      "Indemnizaciones",
      "Pagos a mensajeros",
      "Ajustes (egreso)",
      "Otros gastos de Ordenex",
      "Total de egresos",
    ]);

    // CONTRAPRUEBA de que esta secuencia DISCRIMINA, igual que la de la columna de ingresos: el
    // importe mayor de la columna (800,00) no está ni el primero ni el último, y el menor
    // (25,25) tampoco, así que un orden por magnitud —en cualquiera de los dos sentidos— daría
    // otra secuencia y la aserción de arriba caería.
    const importesColumnaEgresos = [
      DESGLOSE.gastoFijo,
      DESGLOSE.gastoVariable,
      DESGLOSE.sueldo,
      DESGLOSE.indemnizacion,
      COMPOSICION.egresos.egreso_pago_mensajero,
      COMPOSICION.egresos.egreso_ajuste,
      COMPOSICION.otrosEgresos,
    ];
    const ultimo = importesColumnaEgresos[importesColumnaEgresos.length - 1];
    expect(importesColumnaEgresos[0]).not.toBe("800.00");
    expect(ultimo).not.toBe("800.00");
    expect(importesColumnaEgresos[0]).not.toBe("25.25");
    expect(ultimo).not.toBe("25.25");
  });
});

describe("ComposicionGananciaCard — la columna de egresos cuadra (R26)", () => {
  it("R26: la columna de egresos suma `egresosPropios`", () => {
    pintar();

    const lista = listaEgresos();
    // La fila que D2 añadió: sin ella la resta de la pantalla se equivocaría en el pago a los
    // mensajeros, que no es pequeño. Ficha 339: ese pago ya tiene fila propia, así que aquí
    // queda sólo lo que de verdad sigue sin clasificar (194,25).
    expect(within(lista).getByText("Otros gastos de Ordenex")).toBeInTheDocument();
    expect(within(lista).getByText("₡194")).toBeInTheDocument();

    // El total de la columna es `totalEgresos`, que el servidor garantiza idéntico a
    // `egresosPropios` — NO el `total` del desglose de la 45/158, que solo suma cuatro.
    expect(COMPOSICION.totalEgresos).toBe(RESUMEN.egresosPropios);
    expect(within(lista).getByText("₡2.191")).toBeInTheDocument();
    // Y el de los cuatro conceptos (1 250,75 -> ₡1.251) NO se pinta como total de la columna.
    expect(within(lista).queryByText("₡1.251")).toBeNull();
  });

  it("R23/R26: los dos totales son los del servidor, no una suma de la pantalla", () => {
    // Totales imposibles a propósito: si la tarjeta sumara las filas, pintaría otra cosa.
    pintar({
      composicion: { ...COMPOSICION, totalIngresos: "1.00", totalEgresos: "2.00" },
    });

    expect(within(listaIngresos()).getByText("₡1")).toBeInTheDocument();
    expect(within(listaEgresos()).getByText("₡2")).toBeInTheDocument();
  });
});

describe("ComposicionGananciaCard — el pie y el signo del servidor (R27)", () => {
  it("R27: el pie pinta la ganancia con el signo del servidor", () => {
    // Los MISMOS importes de las dos columnas, con el signo cambiado por el servidor: si la
    // tarjeta lo dedujera de lo que pinta, los dos renders serían idénticos.
    const { container } = pintar();
    const pie = () =>
      container.querySelector<HTMLElement>('[data-slot="card-footer"]') as HTMLElement;
    expect(within(pie()).getByText("Positivo")).toBeInTheDocument();
    cleanup();

    const negativo = pintar({
      resumen: { ...RESUMEN, ganancia: "-3519.00", signoGanancia: "negativo" },
    });
    const pieNegativo = negativo.container.querySelector<HTMLElement>(
      '[data-slot="card-footer"]',
    ) as HTMLElement;
    expect(within(pieNegativo).getByText("Negativo")).toBeInTheDocument();
    // El STRING llega con su signo puesto y se pinta tal cual.
    expect(within(pieNegativo).getByText("-₡3.519")).toBeInTheDocument();
    cleanup();

    const cero = pintar({
      resumen: { ...RESUMEN, ganancia: "0.00", signoGanancia: "cero" },
    });
    const pieCero = cero.container.querySelector<HTMLElement>(
      '[data-slot="card-footer"]',
    ) as HTMLElement;
    expect(within(pieCero).getByText("En cero")).toBeInTheDocument();
    expect(within(pieCero).getByText("₡0")).toBeInTheDocument();
  });
});

describe("ComposicionGananciaCard — qué NO entra (R29)", () => {
  it("R29: dice qué NO entra", () => {
    const { container } = pintar();
    const descripcion = container.querySelector('[data-slot="card-description"]');
    const texto = descripcion?.textContent ?? "";

    // El dinero de las tiendas no es de Ordenex y por eso no está en la ganancia.
    expect(texto).toMatch(/no incluye el dinero de las tiendas/i);
    expect(texto).toMatch(/ganancia/i);
    // Y el copy heredado de la 158 deja de decir lo que ya no es cierto aquí: el pago a los
    // mensajeros SÍ entra, dentro de «Otros gastos de Ordenex» (D2).
    expect(texto).not.toMatch(/ni a mensajeros/i);
  });

  it("R29 (D2): el copy NOMBRA el pago a mensajeros, que ahora sí entra", () => {
    // Menor 7 de `progress/review_231.md`: la descripción enumeraba lo que entra —«fletes,
    // comisiones, impuestos, gastos, sueldos e indemnizaciones»— y se callaba justamente el
    // concepto más grande de los que D2 metió dentro. Una lista parcial de lo que entra induce
    // a error sobre dinero, y la fila que lo contiene se llama «Otros gastos de Ordenex», que
    // tampoco lo nombra.
    const { container } = pintar();
    const texto = container.querySelector('[data-slot="card-description"]')?.textContent ?? "";

    expect(texto).toMatch(/mensajero/i);
    // Y lo nombra como algo que ENTRA, no como una exclusión: la única exclusión del texto es
    // el dinero de las tiendas.
    expect(texto).not.toMatch(/no incluye[^.]*mensajero/i);
    // Control de no-vacuidad de la línea anterior: la exclusión que SÍ existe la caza.
    expect(texto).toMatch(/no incluye[^.]*tienda/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// PROPIAS de la FICHA 343 — «Otros» deja de esconder el gasto más grande.
// ─────────────────────────────────────────────────────────────────────────────────────────

describe("Ficha 339 — cada gasto con su nombre (R1/R2/R3/R5)", () => {
  it("R1: la columna de egresos tiene fila «Pagos a mensajeros» con su importe", () => {
    pintar();

    const lista = listaEgresos();
    // El motivo de la ficha: en producción este concepto era 227.300,00 en nueve movimientos
    // y no aparecía por su nombre en ninguna parte de la tarjeta.
    expect(within(lista).getByText("Pagos a mensajeros")).toBeInTheDocument();
    expect(within(lista).getByText("₡700")).toBeInTheDocument();
  });

  it("R2: la columna de egresos tiene fila «Ajustes (egreso)» con su importe", () => {
    pintar();

    const lista = listaEgresos();
    expect(within(lista).getByText("Ajustes (egreso)")).toBeInTheDocument();
    expect(within(lista).getByText("₡46")).toBeInTheDocument();
  });

  it("R3: el rótulo de los ajustes usa el concepto que el diálogo promete en el libro", () => {
    // El diálogo «Registrar movimiento» le PROMETE al usuario, por `nombreEnElLibro`, que su
    // ajuste se llamará así en el libro. Los dos literales van escritos A MANO —el de la
    // promesa y el del rótulo— porque derivar uno del otro dejaría el caso siempre verde.
    const concepto = conceptoPorId("ajuste_egreso");
    expect(concepto, "el diálogo ya no ofrece registrar un ajuste que resta").toBeDefined();
    expect(nombreEnElLibro(concepto!)).toBe("Ajuste (egreso)");

    pintar();
    const filas = rotulos(listaEgresos());
    // La fila lo rotula con ESE concepto, en la voz plural de sus vecinas de columna
    // («Sueldos», «Indemnizaciones»): quien registró el gasto a mano lo encuentra por su
    // nombre en vez de dentro del cubo anónimo.
    expect(filas).toContain("Ajustes (egreso)");
    // Y lo hace en SU fila, fuera del cubo: quitando el cubo de la tarjeta, el rótulo sigue.
    cleanup();
    pintar({
      composicion: { ...COMPOSICION, otrosEgresos: "0.00", hayOtrosEgresos: false },
    });
    expect(rotulos(listaEgresos())).toContain("Ajustes (egreso)");
  });

  it("R5: ningún rótulo de la columna de egresos es el valor del enum", () => {
    pintar();

    const filas = rotulos(listaEgresos());
    for (const categoria of WALLET_EGRESO_NOMBRADO_SEED) {
      expect(filas, `la tarjeta pinta el enum ${categoria}`).not.toContain(categoria);
    }
    for (const rotulo of filas) expect(rotulo).not.toMatch(/_/);
  });
});

describe("Ficha 339 — «Otros» sólo cuando de verdad queda algo (R7/R8/R9/R10)", () => {
  it("R7: con `hayOtrosEgresos` falso, la fila «Otros gastos de Ordenex» no está en el DOM", () => {
    // Y NO basta con que salga en cero: la fila entera desaparece. Un 0,00 permanente entrena
    // a no mirar esa línea, y el valor de la fila está justo en que aparecer signifique algo.
    pintar({
      composicion: { ...COMPOSICION, otrosEgresos: "0.00", hayOtrosEgresos: false },
    });

    const lista = listaEgresos();
    expect(within(lista).queryByText("Otros gastos de Ordenex")).toBeNull();
    expect(rotulos(lista)).toEqual([
      "Gastos fijos",
      "Gastos variables",
      "Sueldos",
      "Indemnizaciones",
      "Pagos a mensajeros",
      "Ajustes (egreso)",
      "Total de egresos",
    ]);
  });

  it("R8: con `hayOtrosEgresos` verdadero, la fila aparece con su importe", () => {
    pintar();

    const lista = listaEgresos();
    expect(within(lista).getByText("Otros gastos de Ordenex")).toBeInTheDocument();
    expect(within(lista).getByText("₡194")).toBeInTheDocument();
  });

  it("R9: la decisión es del SERVIDOR — la tarjeta no compara importes", () => {
    // La bandera y el importe se contradicen A PROPÓSITO: hay 194,25 sin clasificar y aun así
    // el servidor dice que no hay fila. La pantalla OBEDECE. Si comparara `otrosEgresos` con
    // cero por su cuenta, pintaría la fila y este caso caería — que es exactamente la segunda
    // definición de «esto está en cero» que la ficha prohíbe en el navegador.
    pintar({
      composicion: { ...COMPOSICION, otrosEgresos: "194.25", hayOtrosEgresos: false },
    });
    expect(within(listaEgresos()).queryByText("Otros gastos de Ordenex")).toBeNull();

    cleanup();

    // Y el espejo: la bandera en verdadero con el importe en cero SÍ pinta la fila.
    pintar({
      composicion: { ...COMPOSICION, otrosEgresos: "0.00", hayOtrosEgresos: true },
    });
    expect(
      within(listaEgresos()).getByText("Otros gastos de Ordenex"),
    ).toBeInTheDocument();
  });

  it("R10: la fila «Otros» lleva su pista sobre el dinero sin clasificar", () => {
    pintar();

    const lista = listaEgresos();
    const pista = within(lista).getByText(/todavía no sabe nombrar/i);
    expect(pista).toBeInTheDocument();
    // Dice qué hacer con ella, no sólo que existe.
    expect(pista.textContent ?? "").toMatch(/abrí la fila/i);

    // Y NO es un texto permanente de la columna: sin fila, no hay pista.
    cleanup();
    pintar({
      composicion: { ...COMPOSICION, otrosEgresos: "0.00", hayOtrosEgresos: false },
    });
    expect(within(listaEgresos()).queryByText(/todavía no sabe nombrar/i)).toBeNull();
  });

  it("R11/R12: el total de la columna no se movió al sacar dos conceptos del cubo", () => {
    // Las tres cifras que la ficha promete no mover, escritas a mano: la columna sigue
    // sumando `egresosPropios` y el pie sigue restando lo mismo.
    expect(COMPOSICION.totalEgresos).toBe("2190.75");
    expect(COMPOSICION.totalEgresos).toBe(RESUMEN.egresosPropios);

    pintar();
    expect(within(listaEgresos()).getByText("₡2.191")).toBeInTheDocument();
  });
});

describe("Ficha 339 — lo que la tarjeta dice de sí misma (R41/R42)", () => {
  it("R41: la descripción nombra también los ajustes", () => {
    const { container } = pintar();
    const texto = container.querySelector('[data-slot="card-description"]')?.textContent ?? "";

    // La enumeración completa, concepto a concepto. Es la continuación literal de la
    // corrección que el propio docstring del componente documenta: o se nombra todo, o no se
    // enumera. Con los ajustes teniendo fila propia, callárselos volvería a hacerla parcial.
    for (const concepto of [
      /flete/i,
      /comisi/i,
      /impuesto/i,
      /gasto/i,
      /sueldo/i,
      /indemnizaci/i,
      /mensajero/i,
      /ajuste/i,
    ]) {
      expect(texto, `la descripción no nombra ${concepto}`).toMatch(concepto);
    }
  });

  it("R42: la descripción sigue diciendo que el dinero de las tiendas no entra", () => {
    const { container } = pintar();
    const texto = container.querySelector('[data-slot="card-description"]')?.textContent ?? "";

    expect(texto).toMatch(/no incluye el dinero de las tiendas/i);
    // Y los ajustes entran como algo que SUMA a la enumeración, no como una exclusión nueva.
    expect(texto).not.toMatch(/no incluye[^.]*ajuste/i);
  });
});

describe("ComposicionGananciaCard — money-safe en el navegador (R12)", () => {
  it("R12: ninguna de las fuentes tiene forma de operar con dinero", () => {
    const fuentes = [
      "app/(app)/wallet/_components/ComposicionGananciaCard.tsx",
      "app/(app)/wallet/_components/DesgloseEgresosLista.tsx",
      // Ficha 339: la fila desplegable es ahora parte de la tarjeta y pinta su importe, así
      // que entra en el MISMO barrido. Menos fuentes barridas sería aflojarlo.
      "app/(app)/wallet/_components/FilaComposicion.tsx",
    ];
    // Control de no-vacuidad: el barrido mira archivos que existen y tienen código.
    expect(fuentes).toHaveLength(3);

    for (const ruta of fuentes) {
      const fuente = codigoSinComentarios(ruta);
      expect(fuente.length, `${ruta} está vacío`).toBeGreaterThan(500);
      for (const prohibida of LLAMADAS_PROHIBIDAS_EN_DINERO) {
        expect(fuente, `${ruta} llama a ${prohibida}`).not.toMatch(prohibida);
      }
      expect(fuente, `${ruta} importa una biblioteca de decimales`).not.toMatch(
        /from\s+"@prisma\/client"|from\s+"decimal\.js"/,
      );
      // Tampoco deriva ninguna cifra: eso es del servidor, no de la pantalla.
      expect(fuente).not.toMatch(/derivarCaja|derivarComposicionGanancia/);
    }
  });
});
