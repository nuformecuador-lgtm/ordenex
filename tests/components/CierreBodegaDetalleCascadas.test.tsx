// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";

import { money, monedaConfig } from "@/lib/config/moneda";
import type {
  CierreBodegaDetalleCierre,
  CierreBodegaResumen,
} from "@/lib/interfaces/services/ICierreBodegaService";
import type {
  CierreGrupos,
  TotalesIngresoOrdenex,
} from "@/lib/interfaces/services/ICierreDiaService";
import {
  CASCADA_CENTRAL_TITULO,
  CASCADA_DUENO_TITULO,
  COBRADO_SOBRE_RECAUDADO_LABEL,
  EFECTIVO_NO_CUBRE_NOTA,
  FACTURADO_ORDENEX_LABEL,
  GANA_BODEGA_SATELITE_LABEL,
  GANA_BODEGA_SATELITE_NOTA,
  NETO_ORDENEX_LABEL,
  PARA_LA_CENTRAL_LABEL,
  PARA_LA_CENTRAL_NEGATIVO_NOTA,
  PARA_LA_CENTRAL_NOTA,
  PARA_LA_TIENDA_LABEL,
} from "@/app/(app)/cierres-admin/_components/cierre-labels";
import {
  COMISION_CON_IVA_LABEL,
  FLETE_CON_IVA_LABEL,
  FLETE_DEV_CON_IVA_LABEL,
  PAGO_MENSAJERO_LABEL,
  TOTAL_GENERAL_LABEL,
} from "@/app/(app)/cierres-admin/_components/cierre-detalle-shared";

/**
 * Feature 393 (F6) — EL DETALLE DEL CIERRE DE BODEGA: las dos cascadas, separadas y rotuladas.
 *
 * ── LAS DOS PREGUNTAS, Y POR QUÉ SON DOS
 * Una cascada dice **de quién es el dinero** (lo recaudado se reparte entre la tienda y Ordenex);
 * la otra dice **qué efectivo sale** (de lo recaudado, cuánto le entrega la satélite a la
 * central). Las dos terminan en cifras distintas y las dos son verdad. Mezcladas —que es como
 * estaban— no se lee ninguna.
 *
 * ── LA TRAMPA QUE ESTE ARCHIVO VIGILA
 * `recaudado − lo facturado ≠ para la tienda` en cuanto hay un rechazo: el flete por rechazo se
 * le factura a la tienda pero NO sale de lo recaudado. Por eso existe la línea puente, y por eso
 * el fixture de aquí tiene un `cierre_dia` CON rechazo y otro SIN él.
 *
 * ── LOS IMPORTES
 * Todos con céntimos, y la suma de los dos días es EXACTAMENTE el agregado (así se puede afirmar
 * R16 sin que el fixture lo regale). Con cifras redondas, estas identidades cerrarían igual sin
 * el arreglo y el archivo no probaría nada.
 */

vi.mock("@/lib/actions/cierre-bodega", () => ({
  verCierreBodegaDetalle: vi.fn(),
  aprobarCierreBodega: vi.fn(),
  rechazarCierreBodega: vi.fn(),
  listarPendientesCierresBodegaPaginado: vi.fn(),
  listarPendientesCierresBodegaCompleto: vi.fn(),
  listarHistoricoCierresBodegaPaginado: vi.fn(),
  listarHistoricoCierresBodegaCompleto: vi.fn(),
  listarGestionesCierresBodegaCompleto: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/cierres-admin",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

import {
  listarHistoricoCierresBodegaPaginado,
  listarPendientesCierresBodegaPaginado,
  verCierreBodegaDetalle,
} from "@/lib/actions/cierre-bodega";
import { CierresBodegaAdminModule } from "@/app/(app)/cierres-admin/_components/CierresBodegaAdminModule";
import { paginaInicial } from "@/tests/fixtures/pagina-inicial";

// ---------------------------------------------------------------------------
// Parseador de lo PINTADO (independiente del de `DineroIdentidadesEnPantalla`, a propósito).
// ---------------------------------------------------------------------------

/**
 * Un importe tal y como se LEE, con su operador si lo lleva. El `[+-]?` no es cosmetico: las
 * lineas de una cascada se pintan `-₡14.000,55` y `+₡0`, y un patron que solo aceptara el menos
 * recortaria el mas — devolveria «₡0» y una asercion sobre el operador pasaria por casualidad.
 */
const PATRON_IMPORTE = new RegExp(
  `[+-]?${monedaConfig.simbolo}\\d[\\d${monedaConfig.separadorMiles}]*(?:${monedaConfig.separadorDecimal}\\d\\d)?`,
);

function centimos(pintado: string): bigint {
  const texto = pintado.trim();
  const negativo = texto.startsWith("-");
  // El «+» de una linea que SUMA no cambia el valor; el «-» si. Se quitan los dos para leer el
  // cuerpo, y solo el segundo decide el signo.
  const sinSigno = negativo || texto.startsWith("+") ? texto.slice(1) : texto;
  expect(sinSigno.startsWith(monedaConfig.simbolo), `«${pintado}» no es un importe`).toBe(true);
  const cuerpo = sinSigno.slice(monedaConfig.simbolo.length);
  const corte = cuerpo.indexOf(monedaConfig.separadorDecimal);
  const enteros = corte === -1 ? cuerpo : cuerpo.slice(0, corte);
  const cola = corte === -1 ? "00" : `${cuerpo.slice(corte + 1)}00`.slice(0, 2);
  const valor =
    BigInt(enteros.split(monedaConfig.separadorMiles).join("")) * BigInt(100) + BigInt(cola);
  return negativo ? -valor : valor;
}

/** El importe pintado que sigue a un rótulo dentro de una región. */
function importeTras(region: HTMLElement, rotulo: string): string {
  const texto = region.textContent ?? "";
  const desde = texto.indexOf(rotulo);
  expect(desde, `el rótulo «${rotulo}» no está en la región`).toBeGreaterThanOrEqual(0);
  const hallado = texto.slice(desde + rotulo.length).match(PATRON_IMPORTE);
  expect(hallado, `no hay importe junto a «${rotulo}»`).not.toBeNull();
  return hallado![0];
}

/** La cuenta cierra con las CADENAS que se leen, no con los `Decimal` de origen. */
function laCuentaCierra(sumandos: readonly string[], total: string, quien: string): void {
  const suma = sumandos.reduce((acc, s) => acc + centimos(s), BigInt(0));
  expect(suma, `${quien}: se lee ${sumandos.join(" ")} = ${total}, y no da`).toBe(centimos(total));
}

// ---------------------------------------------------------------------------
// Datos
// ---------------------------------------------------------------------------

/**
 * Los totales del ingreso de Ordenex, completos. Sólo cuatro de los once campos se pintan (los
 * AGRUPADOS con su IVA); los otros siete existen para poder auditar cuánto de cada agrupado es
 * IVA sin volver a recorrer las órdenes. Se rellenan coherentes con el agrupado —el IVA de este
 * país es el 13 %— para que un lector no encuentre un fixture que se contradice a sí mismo, pero
 * ninguna aserción de este archivo los mira: no se pintan.
 */
function totalesIngreso(over: {
  fleteConIva: string;
  comisionConIva: string;
  fleteDevolucionConIva: string;
  total: string;
}): TotalesIngresoOrdenex {
  return {
    montoCobrar: "0.00",
    flete: over.fleteConIva,
    ivaFlete: "0.00",
    fleteDevolucion: over.fleteDevolucionConIva,
    ivaFleteDevolucion: "0.00",
    comisionCod: over.comisionConIva,
    ivaComisionCod: "0.00",
    ...over,
  };
}


const ZONA = "33333333-3333-4333-8333-333333333333";
const GRUPOS_VACIOS: CierreGrupos = {
  entregada: [],
  reprogramada: [],
  devuelta: [],
  rechazada: [],
  incidente: [],
};

const CABECERA: CierreBodegaResumen = {
  cierreBodegaId: "b1b1b1b1-1111-4111-8111-b1b1b1b1b1b1",
  zonaId: ZONA,
  zonaNombre: "Limón",
  solicitadoPorId: "u1",
  solicitadoPorNombre: "Sara Satélite",
  estado: "solicitado",
  totales: {
    efectivo: "100000.17",
    simpe: "26089.00",
    transferencia: "0.00",
    general: "126089.17",
  },
  totalPagoMensajero: "14000.55",
  totalIngresoBodegaRechazos: "250.25",
  cantidadCierres: 2,
  solicitadoAt: "2026-09-01T10:00:00.000Z",
  resueltoAt: null,
  motivoRechazo: null,
  paraLaCentral: "111838.37",
  efectivoCubreDescuentos: true,
};

/** El día CON rechazo: su flete por rechazo es lo que hace que la línea puente importe. */
const DIA_ANA: CierreBodegaDetalleCierre = {
  cierreDiaId: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
  mensajeroId: "m1",
  mensajeroNombre: "Ana Mensajera",
  totales: {
    efectivo: "60000.10",
    simpe: "20000.00",
    transferencia: "0.00",
    general: "80000.10",
  },
  totalPagoMensajero: "9000.30",
  totalIngresoBodegaRechazos: "250.25",
  grupos: GRUPOS_VACIOS,
  totalesIngreso: totalesIngreso({
    fleteConIva: "15000.20",
    comisionConIva: "2500.15",
    fleteDevolucionConIva: "500.75",
    total: "18001.10",
  }),
  ganancia: "9000.80",
  pagoTienda: "62499.75",
  cobradoSobreRecaudado: "17500.35",
  netoOrdenex: "8750.55",
  paraLaCentral: "70749.55",
  efectivoCubreDescuentos: true,
};

/** El día SIN rechazo: su flete por rechazo vale "0.00" y la línea puente TIENE que salir igual. */
const DIA_BETO: CierreBodegaDetalleCierre = {
  cierreDiaId: "bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb",
  mensajeroId: "m2",
  mensajeroNombre: "Beto Mensajero",
  totales: {
    efectivo: "40000.07",
    simpe: "6089.00",
    transferencia: "0.00",
    general: "46089.07",
  },
  totalPagoMensajero: "5000.25",
  totalIngresoBodegaRechazos: "0.00",
  grupos: GRUPOS_VACIOS,
  totalesIngreso: totalesIngreso({
    fleteConIva: "8000.13",
    comisionConIva: "1634.35",
    fleteDevolucionConIva: "0.00",
    total: "9634.48",
  }),
  ganancia: "4634.23",
  pagoTienda: "36454.59",
  cobradoSobreRecaudado: "9634.48",
  netoOrdenex: "4634.23",
  paraLaCentral: "41088.82",
  efectivoCubreDescuentos: true,
};

const DETALLE_OK = {
  status: "ok" as const,
  cierre: CABECERA,
  cierres: [DIA_ANA, DIA_BETO],
  totalesIngreso: totalesIngreso({
    fleteConIva: "23000.33",
    comisionConIva: "4134.50",
    fleteDevolucionConIva: "500.75",
    total: "27635.58",
  }),
  ganancia: "13635.03",
  pagoTienda: "98954.34",
  cobradoSobreRecaudado: "27134.83",
  netoOrdenex: "13384.78",
  paraLaCentral: "111838.37",
  efectivoCubreDescuentos: true,
};

type DetalleOk = typeof DETALLE_OK;

/** Monta la pantalla, abre el detalle del cierre pendiente y devuelve el `user`. */
async function abrirDetalle(detalle: DetalleOk = DETALLE_OK) {
  vi.mocked(listarPendientesCierresBodegaPaginado).mockResolvedValue({
    status: "ok",
    page: 1,
    ...paginaInicial([CABECERA]),
  });
  vi.mocked(listarHistoricoCierresBodegaPaginado).mockResolvedValue({
    status: "ok",
    page: 1,
    ...paginaInicial([]),
  });
  vi.mocked(verCierreBodegaDetalle).mockResolvedValue(detalle);

  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <CierresBodegaAdminModule
        pendientes={paginaInicial([CABECERA])}
        historico={paginaInicial([])}
      />
    </SWRConfig>,
  );

  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Ver / decidir el cierre de bodega de Limón" }),
  );
  await screen.findByRole("region", { name: `${CASCADA_CENTRAL_TITULO} · cierre de bodega` });
  return user;
}

const central = () =>
  screen.getByRole("region", { name: `${CASCADA_CENTRAL_TITULO} · cierre de bodega` });
const dueno = () =>
  screen.getByRole("region", { name: `${CASCADA_DUENO_TITULO} · cierre de bodega` });

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("393 · F6 — las dos cascadas del detalle", () => {
  it("son DOS regiones distintas, con nombres accesibles distintos (R1/R32)", async () => {
    await abrirDetalle();

    expect(central()).toBeInTheDocument();
    expect(dueno()).toBeInTheDocument();
    expect(central()).not.toBe(dueno());
    // Y cada una enseña su rótulo visible, no sólo su nombre accesible.
    expect(within(central()).getByRole("heading", { name: CASCADA_CENTRAL_TITULO })).toBeInTheDocument();
    expect(within(dueno()).getByRole("heading", { name: CASCADA_DUENO_TITULO })).toBeInTheDocument();
  });

  it("ninguna región mezcla el resultado de la otra: son subárboles disjuntos (R2)", async () => {
    await abrirDetalle();

    // ⚠️ R2 prohíbe MEZCLAR las dos cascadas en una misma región, no que una magnitud aparezca en
    // las dos: «Pago al mensajero» y «Gana la bodega satélite» son sustraendos de LAS DOS
    // cascadas a propósito (design §3 y §4) —el mismo dinero contestando dos preguntas
    // distintas—. Lo que no puede pasar es que un RESULTADO se cuele en la cascada que no es.
    expect(central().contains(dueno())).toBe(false);
    expect(dueno().contains(central())).toBe(false);

    expect(within(central()).queryByText(PARA_LA_TIENDA_LABEL)).toBeNull();
    expect(within(central()).queryByText(NETO_ORDENEX_LABEL)).toBeNull();
    expect(within(central()).queryByText(COBRADO_SOBRE_RECAUDADO_LABEL)).toBeNull();
    expect(within(dueno()).queryByText(PARA_LA_CENTRAL_LABEL)).toBeNull();
  });

  it("«Para la tienda» y «Neto de Ordenex» están, y están DESTACADOS (R3)", async () => {
    await abrirDetalle();

    for (const rotulo of [PARA_LA_TIENDA_LABEL, NETO_ORDENEX_LABEL]) {
      const linea = within(dueno()).getByText(rotulo).closest("div");
      expect(linea?.className, `«${rotulo}» no se destaca de las líneas que lo componen`).toContain(
        "border-t",
      );
    }
    expect(importeTras(dueno(), PARA_LA_TIENDA_LABEL)).toBe(money("98954.34"));
    expect(importeTras(dueno(), NETO_ORDENEX_LABEL)).toBe(money("13384.78"));
  });

  it("«Para la central» está, DESTACADO y con la misma cifra que la tarjeta (R4/R23)", async () => {
    await abrirDetalle();

    const linea = within(central()).getByText(PARA_LA_CENTRAL_LABEL).closest("div");
    expect(linea?.className).toContain("border-t");
    // La tarjeta de la cola pinta el mismo `paraLaCentral` de la misma cabecera: el detalle
    // empieza por lo mismo con lo que la tarjeta cierra.
    expect(importeTras(central(), PARA_LA_CENTRAL_LABEL)).toBe(money(CABECERA.paraLaCentral));
  });

  it("«Para la central» lleva su NOTA FIJA también aquí, y en cada día (R26)", async () => {
    // R26 pide la nota en las DOS superficies. Estaba afirmada solo en la tarjeta: medido el
    // 2026-09-08 por el reviewer (MR3), quitar `PARA_LA_CENTRAL_NOTA` de `lineasCascadaCentral`
    // dejaba todo en verde. El número sin la resta de la que sale vuelve a ser un número solo,
    // que es con lo que empezó la ficha.
    await abrirDetalle();

    expect(within(central()).getByText(PARA_LA_CENTRAL_NOTA)).toBeInTheDocument();
    // Y NO es un accidente del agregado: cada `cierre_dia` monta la misma cascada, así que la
    // nota va con ella. Sin esto, la mitad de las cascadas de la pantalla quedaría sin cubrir.
    for (const dia of [DIA_ANA, DIA_BETO]) {
      const suCentral = screen.getByRole("region", {
        name: `${CASCADA_CENTRAL_TITULO} · ${dia.mensajeroNombre}`,
      });
      expect(within(suCentral).getByText(PARA_LA_CENTRAL_NOTA)).toBeInTheDocument();
    }
  });

  it("las TRES restas dan, leyendo las cadenas pintadas (R6/R8/R9)", async () => {
    await abrirDetalle();

    // R6 — lo recaudado − flete − comisión = para la tienda.
    laCuentaCierra(
      [
        importeTras(dueno(), TOTAL_GENERAL_LABEL),
        importeTras(dueno(), FLETE_CON_IVA_LABEL),
        importeTras(dueno(), COMISION_CON_IVA_LABEL),
      ],
      importeTras(dueno(), PARA_LA_TIENDA_LABEL),
      "cascada A · para la tienda",
    );

    // R8 — lo facturado − mensajeros − bodega = neto de Ordenex.
    laCuentaCierra(
      [
        importeTras(dueno(), FACTURADO_ORDENEX_LABEL),
        importeTras(dueno(), PAGO_MENSAJERO_LABEL),
        importeTras(dueno(), GANA_BODEGA_SATELITE_LABEL),
      ],
      importeTras(dueno(), NETO_ORDENEX_LABEL),
      "cascada A · neto de Ordenex",
    );

    // R9 — lo recaudado − mensajeros − bodega = para la central.
    laCuentaCierra(
      [
        importeTras(central(), TOTAL_GENERAL_LABEL),
        importeTras(central(), PAGO_MENSAJERO_LABEL),
        importeTras(central(), GANA_BODEGA_SATELITE_LABEL),
      ],
      importeTras(central(), PARA_LA_CENTRAL_LABEL),
      "cascada B · para la central",
    );
  });

  it("la LÍNEA PUENTE explica la diferencia exacta que el flete por rechazo abre (R7/R10)", async () => {
    await abrirDetalle();

    // Sin la línea puente, la pantalla enseñaría «recaudado − facturado = para la tienda», que
    // NO da: se queda corta por el flete por rechazo, que se factura pero no sale de lo
    // recaudado. Se mide, en vez de razonarse.
    const recaudado = centimos(importeTras(dueno(), TOTAL_GENERAL_LABEL));
    const facturado = centimos(importeTras(dueno(), FACTURADO_ORDENEX_LABEL));
    const tienda = centimos(importeTras(dueno(), PARA_LA_TIENDA_LABEL));
    const fleteRechazo = centimos(importeTras(dueno(), FLETE_DEV_CON_IVA_LABEL));
    expect(recaudado - facturado).not.toBe(tienda);
    expect(tienda - (recaudado - facturado)).toBe(fleteRechazo);

    // Y con la línea puente sí cierra: cobrado + flete por rechazo = lo facturado (R7).
    laCuentaCierra(
      [
        importeTras(dueno(), COBRADO_SOBRE_RECAUDADO_LABEL),
        importeTras(dueno(), FLETE_DEV_CON_IVA_LABEL),
      ],
      importeTras(dueno(), FACTURADO_ORDENEX_LABEL),
      "cascada A · línea puente",
    );
  });

  it("la línea puente sale TAMBIÉN con el flete por rechazo en cero (R10)", async () => {
    await abrirDetalle();

    // El día de Beto no tuvo ni un rechazo. Un cero explícito dice «aquí no hubo rechazos»; su
    // ausencia dejaría al lector deduciéndolo de un hueco.
    const duenoBeto = screen.getByRole("region", {
      name: `${CASCADA_DUENO_TITULO} · Beto Mensajero`,
    });
    expect(within(duenoBeto).getByText(COBRADO_SOBRE_RECAUDADO_LABEL)).toBeInTheDocument();
    expect(within(duenoBeto).getByText(FLETE_DEV_CON_IVA_LABEL)).toBeInTheDocument();
    expect(importeTras(duenoBeto, FLETE_DEV_CON_IVA_LABEL)).toBe(`+${money("0.00")}`);
    // Y con cero, la línea puente y lo facturado coinciden: la cascada sigue cerrando.
    expect(importeTras(duenoBeto, COBRADO_SOBRE_RECAUDADO_LABEL)).toBe(money("9634.48"));
    expect(importeTras(duenoBeto, FACTURADO_ORDENEX_LABEL)).toBe(money("9634.48"));
  });

  it("la nota de «Gana la bodega satélite» dice que NO es un movimiento de caja (R27)", async () => {
    await abrirDetalle();
    expect(within(central()).getByText(GANA_BODEGA_SATELITE_NOTA)).toBeInTheDocument();
    expect(within(dueno()).getByText(GANA_BODEGA_SATELITE_NOTA)).toBeInTheDocument();
  });

  it("cada `cierre_dia` trae SUS dos cascadas, con los MISMOS rótulos (R15/R23)", async () => {
    await abrirDetalle();

    for (const dia of [DIA_ANA, DIA_BETO]) {
      const suCentral = screen.getByRole("region", {
        name: `${CASCADA_CENTRAL_TITULO} · ${dia.mensajeroNombre}`,
      });
      const suDueno = screen.getByRole("region", {
        name: `${CASCADA_DUENO_TITULO} · ${dia.mensajeroNombre}`,
      });
      // Mismos rótulos que el agregado…
      expect(within(suCentral).getByText(PARA_LA_CENTRAL_LABEL)).toBeInTheDocument();
      expect(within(suDueno).getByText(PARA_LA_TIENDA_LABEL)).toBeInTheDocument();
      expect(within(suDueno).getByText(NETO_ORDENEX_LABEL)).toBeInTheDocument();
      // …y las cifras de SU propio nivel, no las del agregado (R15).
      expect(importeTras(suCentral, PARA_LA_CENTRAL_LABEL)).toBe(money(dia.paraLaCentral));
      expect(importeTras(suDueno, NETO_ORDENEX_LABEL)).toBe(money(dia.netoOrdenex));
      laCuentaCierra(
        [
          importeTras(suCentral, TOTAL_GENERAL_LABEL),
          importeTras(suCentral, PAGO_MENSAJERO_LABEL),
          importeTras(suCentral, GANA_BODEGA_SATELITE_LABEL),
        ],
        importeTras(suCentral, PARA_LA_CENTRAL_LABEL),
        `cascada B · ${dia.mensajeroNombre}`,
      );
    }
  });

  it("y la suma de los días da el agregado, AL CÉNTIMO, sin que nadie corrija nada (R16)", async () => {
    await abrirDetalle();

    const porDia = [DIA_ANA, DIA_BETO].map((dia) =>
      importeTras(
        screen.getByRole("region", { name: `${CASCADA_CENTRAL_TITULO} · ${dia.mensajeroNombre}` }),
        PARA_LA_CENTRAL_LABEL,
      ),
    );
    laCuentaCierra(porDia, importeTras(central(), PARA_LA_CENTRAL_LABEL), "Σ días = agregado");
  });

  it("NO queda ninguna tarjeta suelta repitiendo una cifra de una cascada (R24/R34)", async () => {
    await abrirDetalle();

    // Las cinco que estaban aquí antes de esta ficha. Sus componentes siguen existiendo —los
    // monta el detalle del cierre de MENSAJERO— pero esta superficie deja de montarlos.
    for (const rotulo of [
      "Ingreso bruto",
      "Ganancia",
      "Pago a tienda",
      "Ingreso de bodega por rechazos",
      "Total a pagar a mensajeros",
    ]) {
      expect(
        document.body.textContent,
        `«${rotulo}» sigue suelto en el detalle: es una cifra que ya es línea de una cascada`,
      ).not.toContain(rotulo);
    }
    // Y ninguna de sus regiones se quedó montada.
    for (const nombre of [
      "Ingreso bruto del cierre de bodega",
      "Pago a mensajeros del cierre de bodega",
      "Ganancia del cierre de bodega",
      "Ingreso de bodega por rechazos del cierre de bodega",
      "Pago a tienda del cierre de bodega",
    ]) {
      expect(screen.queryByRole("region", { name: nombre }), nombre).toBeNull();
    }
  });

  it("el panel de totales por método sigue EXACTAMENTE igual (R29)", async () => {
    await abrirDetalle();

    const totales = screen.getByRole("region", { name: "Totales del cierre de bodega" });
    expect(within(totales).getByText("Efectivo")).toBeInTheDocument();
    expect(within(totales).getByText("SINPE")).toBeInTheDocument();
    expect(within(totales).getByText("Transferencia")).toBeInTheDocument();
    expect(totales.textContent).toContain(money("100000.17"));
    expect(totales.textContent).toContain(money("26089.00"));
    expect(totales.textContent).toContain(money("126089.17"));
    // efectivo + SINPE + transferencia = general, con las cadenas pintadas.
    laCuentaCierra(
      [money("100000.17"), money("26089.00"), money("0.00")],
      money("126089.17"),
      "totales por método",
    );
  });

  it("el desglose por concepto del ingreso de Ordenex sigue en su sitio", async () => {
    await abrirDetalle();
    const panel = screen.getByRole("region", { name: "Ingreso de Ordenex del cierre de bodega" });
    expect(within(panel).getByText(FLETE_CON_IVA_LABEL)).toBeInTheDocument();
    expect(panel.textContent).toContain(money("27635.58"));
  });
});

describe("393 · F6 — el caso raro, dicho en la pantalla", () => {
  /** El cierre de la jornada prepagada: los descuentos superan lo recaudado. */
  const EN_DEUDA: DetalleOk = {
    ...DETALLE_OK,
    cierre: {
      ...CABECERA,
      totales: {
        efectivo: "500.00",
        simpe: "500.00",
        transferencia: "0.00",
        general: "1000.00",
      },
      totalPagoMensajero: "2000.05",
      totalIngresoBodegaRechazos: "0.00",
      paraLaCentral: "-1000.05",
      efectivoCubreDescuentos: false,
    },
    cierres: [],
    totalesIngreso: totalesIngreso({
      fleteConIva: "300.10",
      comisionConIva: "0.00",
      fleteDevolucionConIva: "0.00",
      total: "300.10",
    }),
    ganancia: "-1699.95",
    pagoTienda: "699.90",
    cobradoSobreRecaudado: "300.10",
    netoOrdenex: "-1699.95",
    paraLaCentral: "-1000.05",
    efectivoCubreDescuentos: false,
  };

  it("un «Para la central» NEGATIVO lleva su signo, su tono y SU NOTA (R36)", async () => {
    await abrirDetalle(EN_DEUDA);

    const pintado = importeTras(central(), PARA_LA_CENTRAL_LABEL);
    expect(pintado).toBe("-₡1.000,05");
    expect(centimos(pintado)).toBe(BigInt(-100005));
    // Ni cero, ni valor absoluto, ni ausente.
    expect(pintado).not.toBe(money("0"));
    expect(pintado).not.toBe(money("1000.05"));
    expect(within(central()).getByText(pintado).className).toContain("text-danger-strong");
    expect(within(central()).getByText(PARA_LA_CENTRAL_NEGATIVO_NOTA)).toBeInTheDocument();
    // El rótulo NO cambia con el signo: una cifra, un nombre (D6).
    expect(within(central()).getByText(PARA_LA_CENTRAL_LABEL)).toBeInTheDocument();
  });

  it("un «Neto de Ordenex» NEGATIVO se pinta con signo y marcado como deuda (R11)", async () => {
    await abrirDetalle(EN_DEUDA);

    const pintado = importeTras(dueno(), NETO_ORDENEX_LABEL);
    expect(pintado).toBe("-₡1.699,95");
    expect(within(dueno()).getByText(pintado).className).toContain("text-danger-strong");
  });

  it("la nota del EFECTIVO aparece sólo cuando el efectivo no cubre los descuentos (R37)", async () => {
    await abrirDetalle(EN_DEUDA);
    expect(within(central()).getByText(EFECTIVO_NO_CUBRE_NOTA)).toBeInTheDocument();

    cleanup();
    vi.clearAllMocks();
    await abrirDetalle();
    expect(within(central()).queryByText(EFECTIVO_NO_CUBRE_NOTA)).toBeNull();
  });
});
