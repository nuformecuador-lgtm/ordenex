// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";

import { monedaConfig } from "@/lib/config/moneda";
import type {
  CierreBodegaDetalleCierre,
  CierreBodegaResumen,
} from "@/lib/interfaces/services/ICierreBodegaService";
import type {
  CierreGrupos,
  TotalesIngresoOrdenex,
} from "@/lib/interfaces/services/ICierreDiaService";
import type { ParteDeTienda } from "@/lib/utils/ingreso-ordenex";
import {
  CASCADA_CENTRAL_TITULO,
  CASCADA_DUENO_TITULO,
  DESGLOSE_NO_REPARTIDO_NOTA,
  DESGLOSE_POR_TIENDA_NOTA,
  DESGLOSE_POR_TIENDA_TITULO,
  NETO_ORDENEX_LABEL,
  PARA_LA_CENTRAL_LABEL,
  PARA_LA_TIENDA_LABEL,
  TIENDA_GANA_TOTAL_LABEL,
  TIENDA_PAGO_HOY_LABEL,
  TIENDA_RECAUDADO_LABEL,
} from "@/app/(app)/cierres-admin/_components/cierre-labels";
// `TOTAL_GENERAL_LABEL` se pide donde nació —el módulo del detalle—, igual que hace el archivo de
// la ficha 393: si un día se moviera al módulo puro, este import se pondría rojo y avisaría.
import { TOTAL_GENERAL_LABEL } from "@/app/(app)/cierres-admin/_components/cierre-detalle-shared";

/**
 * 💰 FICHA 396 · TANDA D — EL CIERRE DE BODEGA DICE DE QUÉ TIENDA ES CADA PARTE, EN SUS DOS
 * NIVELES.
 *
 * ── LO PRIMERO, PORQUE CAMBIA CÓMO SE LEE TODO LO DEMÁS
 * **El dinero está BIEN.** `wallet_tienda_movimiento` lleva los movimientos separados por tienda
 * desde siempre, cada uno con sus propias cifras: a nadie se le paga mal, y esta ficha no toca ni
 * una fila del ledger ni una fórmula. Lo que se arregla es la PANTALLA.
 *
 * ── POR QUÉ EN BODEGA ES EL PEOR DE LOS TRES CASOS
 * El detalle del cierre de un mensajero agrega las tiendas de ESE mensajero. El de bodega agrega
 * **N mensajeros × M tiendas** bajo un solo «Para la tienda» — y lo hace DOS veces: una por cada
 * mensajero incluido y otra para toda la bodega.
 *
 * ── LOS TRES UMBRALES, QUE ES LA TRAMPA DE ESTA TANDA
 * El del nivel de cada mensajero se evalúa sobre **las tiendas de ESE mensajero**, no sobre las de
 * la bodega. Una bodega con dos mensajeros que llevaron UNA tienda cada uno no enseña desglose en
 * ningún nivel de mensajero y **sí** en el agregado. Tiene su propio bloque aquí abajo.
 *
 * ── LO QUE SE AFIRMA, Y CÓMO
 * Las cifras se leen DEL DOM y se comparan contra literales escritos a mano; las sumas se hacen
 * sobre las cadenas pintadas, no sobre los datos de entrada. Comparar un número —o un rótulo—
 * contra la función que lo genera está siempre verde, y en este repo ya dejó pasar un tope falso.
 *
 * ── LOS IMPORTES
 * Son los del fixture de la ficha 393 (`CierreBodegaDetalleCascadas.test.tsx`), partidos ahora por
 * tienda. Deliberado: el día de Ana tuvo un rechazo y el de Beto no, así que sólo en las tiendas de
 * Ana difieren «Se le paga hoy» y «Gana en total» — si todas difirieran igual, una derivación con
 * el subconjunto equivocado pasaría desapercibida. Y «Tienda Norte» aparece en LOS DOS mensajeros,
 * que es lo que hace comprobable Q8: una sola fila por tienda en el agregado.
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
// Lectura de lo PINTADO
// ---------------------------------------------------------------------------

/** Un importe tal y como se LEE, con su operador si lo lleva. */
const PATRON_IMPORTE = new RegExp(
  `^[+-]?${monedaConfig.simbolo}\\d[\\d${monedaConfig.separadorMiles}]*(?:${monedaConfig.separadorDecimal}\\d\\d)?$`,
);

/** Céntimos enteros de un importe pintado. `BigInt` y no `Number`: aquí no se pierde un céntimo. */
function centimos(pintado: string): bigint {
  const texto = pintado.trim();
  const negativo = texto.startsWith("-");
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

/** Todos los importes pintados junto a un rótulo dentro de una región, en orden de aparición. */
function importesTras(region: HTMLElement, rotulo: string): string[] {
  const etiquetas = within(region)
    .getAllByText(rotulo)
    // El rótulo vive en un `span` HOJA. Su envoltorio (rótulo + notas) también casaría cuando la
    // línea no lleva notas, y contaría cada línea dos veces.
    .filter((el) => el.children.length === 0);
  expect(etiquetas.length, `el rótulo «${rotulo}» no está en la región`).toBeGreaterThan(0);

  return etiquetas.map((etiqueta) => {
    const fila = etiqueta.closest("div");
    expect(fila, `«${rotulo}» no está dentro de una línea de cascada`).not.toBeNull();
    const importe = (fila!.lastElementChild?.textContent ?? "").trim();
    expect(importe, `no hay importe junto a «${rotulo}»`).toMatch(PATRON_IMPORTE);
    return importe;
  });
}

/** El único importe pintado junto a un rótulo. Falla si hay más de uno: eso sería otra pregunta. */
function importeTras(region: HTMLElement, rotulo: string): string {
  const todos = importesTras(region, rotulo);
  expect(todos.length, `«${rotulo}» aparece ${todos.length} veces en esta región`).toBe(1);
  return todos[0];
}

/**
 * TODOS los importes que se leen dentro de una región. Es lo que hace comprobable R5: una cuarta
 * cifra por tienda se vería aquí aunque nadie supiera cómo se llama.
 */
function todosLosImportes(region: HTMLElement): string[] {
  return within(region)
    .queryAllByText(PATRON_IMPORTE)
    .filter((el) => el.children.length === 0)
    .map((el) => (el.textContent ?? "").trim());
}

/** La cuenta cierra con las CADENAS que se leen, no con los datos de entrada. */
function laCuentaCierra(sumandos: readonly string[], total: string, quien: string): void {
  const suma = sumandos.reduce((acc, s) => acc + centimos(s), BigInt(0));
  expect(suma, `${quien}: se lee ${sumandos.join(" + ")} = ${total}, y no da`).toBe(
    centimos(total),
  );
}

/** ¿`a` está ANTES que `b` en el documento? */
function vaAntes(a: HTMLElement, b: HTMLElement): boolean {
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

// ---------------------------------------------------------------------------
// Datos
// ---------------------------------------------------------------------------

const ZONA = "33333333-3333-4333-8333-333333333333";
const GRUPOS_VACIOS: CierreGrupos = {
  entregada: [],
  reprogramada: [],
  devuelta: [],
  rechazada: [],
  incidente: [],
};

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

/**
 * LAS TIENDAS DE ANA. Su día tuvo un rechazo (500,75 de flete + IVA) y lo trajo NORTE, así que
 * sólo en Norte difieren «Se le paga hoy» y «Gana en total», y difieren en exactamente eso.
 *
 *   Norte  recaudó 50.000,10 · se le pagan 40.000,00 · gana 39.499,25   (difieren en 500,75)
 *   Sur    recaudó 30.000,00 · se le pagan 22.499,75 · gana 22.499,75   (no difieren)
 *   ────────────────────────────────────────────────────────────────────────────────────────
 *   suma           80.000,10              62.499,75        61.999,00    = los de Ana
 */
const ANA_NORTE: ParteDeTienda = {
  tiendaId: "t-norte",
  tiendaNombre: "Tienda Norte",
  recaudado: "50000.10",
  pagoTienda: "40000.00",
  ganaLaTienda: "39499.25",
};
const ANA_SUR: ParteDeTienda = {
  tiendaId: "t-sur",
  tiendaNombre: "Tienda Sur",
  recaudado: "30000.00",
  pagoTienda: "22499.75",
  ganaLaTienda: "22499.75",
};

/**
 * LAS TIENDAS DE BETO. Su día no tuvo ni un rechazo: en las dos coinciden las dos cifras de pago.
 * NORTE vuelve a aparecer —la misma tienda, el mismo id— y es lo que hace comprobable Q8.
 *
 *   Norte  recaudó 26.089,07 · se le pagan 20.454,59 · gana 20.454,59
 *   Este   recaudó 20.000,00 · se le pagan 16.000,00 · gana 16.000,00
 *   ────────────────────────────────────────────────────────────────
 *   suma           46.089,07              36.454,59       36.454,59   = los de Beto
 */
const BETO_NORTE: ParteDeTienda = {
  tiendaId: "t-norte",
  tiendaNombre: "Tienda Norte",
  recaudado: "26089.07",
  pagoTienda: "20454.59",
  ganaLaTienda: "20454.59",
};
const BETO_ESTE: ParteDeTienda = {
  tiendaId: "t-este",
  tiendaNombre: "Tienda Este",
  recaudado: "20000.00",
  pagoTienda: "16000.00",
  ganaLaTienda: "16000.00",
};

/**
 * EL DESGLOSE AGREGADO: UNA fila por tienda a través de los DOS mensajeros (Q8, R20). Norte suma
 * las dos suyas; Sur y Este vienen de un solo mensajero. Ordenado por lo que se le paga, de mayor
 * a menor, como lo emite el servidor (R8).
 *
 *   Norte  76.089,17 · 60.454,59 · 59.953,84   (= 50.000,10+26.089,07 · 40.000+20.454,59 · …)
 *   Sur    30.000,00 · 22.499,75 · 22.499,75
 *   Este   20.000,00 · 16.000,00 · 16.000,00
 *   ─────────────────────────────────────────
 *   suma  126.089,17 · 98.954,34 · 98.453,59   = los agregados de toda la bodega
 */
const AGG_NORTE: ParteDeTienda = {
  tiendaId: "t-norte",
  tiendaNombre: "Tienda Norte",
  recaudado: "76089.17",
  pagoTienda: "60454.59",
  ganaLaTienda: "59953.84",
};
const AGG_SUR: ParteDeTienda = { ...ANA_SUR };
const AGG_ESTE: ParteDeTienda = { ...BETO_ESTE };

/** El día CON rechazo. */
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
  ganaLaTienda: "61999.00",
  partesPorTienda: [ANA_NORTE, ANA_SUR],
  paraLaCentral: "70749.55",
  efectivoCubreDescuentos: true,
};

/** El día SIN rechazo. */
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
  ganaLaTienda: "36454.59",
  partesPorTienda: [BETO_NORTE, BETO_ESTE],
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
  ganaLaTienda: "98453.59",
  partesPorTienda: [AGG_NORTE, AGG_SUR, AGG_ESTE],
  paraLaCentral: "111838.37",
  efectivoCubreDescuentos: true,
};

type DetalleOk = typeof DETALLE_OK;

/**
 * ⚠️ EL CASO QUE SEPARA LOS TRES UMBRALES (R19 vs R20): dos mensajeros que llevaron UNA tienda
 * cada uno. Ninguno de los dos niveles de mensajero enseña desglose —cada uno tiene una sola
 * tienda— y el AGREGADO sí, porque la bodega tiene dos. Los agregados no cambian: Ana entera es
 * Norte y Beto entero es Este.
 */
const UNA_TIENDA_CADA_MENSAJERO: DetalleOk = {
  ...DETALLE_OK,
  cierres: [
    {
      ...DIA_ANA,
      partesPorTienda: [
        {
          tiendaId: "t-norte",
          tiendaNombre: "Tienda Norte",
          recaudado: "80000.10",
          pagoTienda: "62499.75",
          ganaLaTienda: "61999.00",
        },
      ],
    },
    {
      ...DIA_BETO,
      partesPorTienda: [
        {
          tiendaId: "t-este",
          tiendaNombre: "Tienda Este",
          recaudado: "46089.07",
          pagoTienda: "36454.59",
          ganaLaTienda: "36454.59",
        },
      ],
    },
  ],
  partesPorTienda: [
    {
      tiendaId: "t-norte",
      tiendaNombre: "Tienda Norte",
      recaudado: "80000.10",
      pagoTienda: "62499.75",
      ganaLaTienda: "61999.00",
    },
    {
      tiendaId: "t-este",
      tiendaNombre: "Tienda Este",
      recaudado: "46089.07",
      pagoTienda: "36454.59",
      ganaLaTienda: "36454.59",
    },
  ],
};

/**
 * DOS TIENDAS HOMÓNIMAS en el nivel de Ana, con ids distintos. El servidor las permite a
 * propósito —agrupa por el id congelado y no por el nombre (R7)— y aquí no se pueden fundir ni
 * anunciar igual.
 */
const HOMONIMAS: DetalleOk = {
  ...DETALLE_OK,
  cierres: [
    {
      ...DIA_ANA,
      partesPorTienda: [
        { ...ANA_NORTE, tiendaId: "t-uno", tiendaNombre: "Mi Tienda" },
        { ...ANA_SUR, tiendaId: "t-dos", tiendaNombre: "Mi Tienda" },
      ],
    },
    DIA_BETO,
  ],
};

// --- Las regiones, por su nombre accesible ---------------------------------

const DE_BODEGA = "cierre de bodega";
const duenoAgregado = () =>
  screen.getByRole("region", { name: `${CASCADA_DUENO_TITULO} · ${DE_BODEGA}` });
const centralAgregada = () =>
  screen.getByRole("region", { name: `${CASCADA_CENTRAL_TITULO} · ${DE_BODEGA}` });
const duenoDe = (mensajero: string) =>
  screen.getByRole("region", { name: `${CASCADA_DUENO_TITULO} · ${mensajero}` });
const desgloseDe = (contexto: string) =>
  screen.getByRole("region", { name: `${DESGLOSE_POR_TIENDA_TITULO} · ${contexto}` });
const sinDesglose = (contexto: string) =>
  screen.queryByRole("region", { name: `${DESGLOSE_POR_TIENDA_TITULO} · ${contexto}` });

/**
 * La región de UNA tienda dentro de un nivel. El nombre accesible lleva la POSICIÓN además del
 * nombre y del contexto —dos tiendas pueden llamarse igual—, así que se busca por sus dos
 * extremos. No se afloja nada: exige empezar por el nombre de ESA tienda, con el paréntesis de la
 * posición pegado, y terminar en el contexto de ESE nivel.
 */
const nombraA = (nombre: string, contexto: string) => (accesible: string) =>
  accesible.startsWith(`${nombre} (`) && accesible.endsWith(` · ${contexto}`);
const tienda = (nombre: string, contexto: string) =>
  screen.getByRole("region", { name: nombraA(nombre, contexto) });

/** Monta la pantalla, abre el detalle del cierre de bodega pendiente y devuelve el `user`. */
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
  await screen.findByRole("region", { name: `${CASCADA_CENTRAL_TITULO} · ${DE_BODEGA}` });
  return user;
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

// ---------------------------------------------------------------------------

describe("396 · D3 — autocomprobación del lector del DOM", () => {
  it("encuentra las líneas de verdad, y falla cuando le pides una que no está", async () => {
    await abrirDetalle();

    // Si esto saliera vacío, TODAS las cuentas de abajo cerrarían sobre nada.
    expect(importesTras(tienda("Tienda Norte", DE_BODEGA), TIENDA_RECAUDADO_LABEL)).toEqual([
      "₡76.089,17",
    ]);
    expect(() => importesTras(desgloseDe(DE_BODEGA), "Rótulo que no existe")).toThrow();
    expect(centimos("₡60.454,59")).toBe(BigInt(6045459));
    expect(centimos("₡40.000")).toBe(BigInt(4000000));
  });
});

describe("396 · D3 — con dos mensajeros y dos tiendas, el desglose está en LOS DOS niveles", () => {
  it("hay un desglose para toda la bodega y uno por cada mensajero, y son tres regiones", async () => {
    await abrirDetalle();

    expect(desgloseDe(DE_BODEGA)).toBeInTheDocument();
    expect(desgloseDe("Ana Mensajera")).toBeInTheDocument();
    expect(desgloseDe("Beto Mensajero")).toBeInTheDocument();
    expect(desgloseDe(DE_BODEGA)).not.toBe(desgloseDe("Ana Mensajera"));
    expect(desgloseDe("Ana Mensajera")).not.toBe(desgloseDe("Beto Mensajero"));
  });

  it("el AGREGADO trae las TRES tiendas con sus NUEVE cifras, escritas a mano (R20)", async () => {
    await abrirDetalle();

    const norte = tienda("Tienda Norte", DE_BODEGA);
    const sur = tienda("Tienda Sur", DE_BODEGA);
    const este = tienda("Tienda Este", DE_BODEGA);

    expect(importeTras(norte, TIENDA_RECAUDADO_LABEL)).toBe("₡76.089,17");
    expect(importeTras(norte, TIENDA_PAGO_HOY_LABEL)).toBe("₡60.454,59");
    expect(importeTras(norte, TIENDA_GANA_TOTAL_LABEL)).toBe("₡59.953,84");
    expect(importeTras(sur, TIENDA_RECAUDADO_LABEL)).toBe("₡30.000");
    expect(importeTras(sur, TIENDA_PAGO_HOY_LABEL)).toBe("₡22.499,75");
    expect(importeTras(sur, TIENDA_GANA_TOTAL_LABEL)).toBe("₡22.499,75");
    expect(importeTras(este, TIENDA_RECAUDADO_LABEL)).toBe("₡20.000");
    expect(importeTras(este, TIENDA_PAGO_HOY_LABEL)).toBe("₡16.000");
    expect(importeTras(este, TIENDA_GANA_TOTAL_LABEL)).toBe("₡16.000");
  });

  it("cada MENSAJERO trae SUS tiendas, y no las del otro ni las del agregado (R19)", async () => {
    await abrirDetalle();

    // Ana: Norte y Sur, con las cifras de SU día —no las agregadas de Norte—.
    const ana = desgloseDe("Ana Mensajera");
    expect(within(ana).getAllByRole("region")).toHaveLength(2);
    expect(importeTras(tienda("Tienda Norte", "Ana Mensajera"), TIENDA_PAGO_HOY_LABEL)).toBe(
      "₡40.000",
    );
    expect(importeTras(tienda("Tienda Sur", "Ana Mensajera"), TIENDA_PAGO_HOY_LABEL)).toBe(
      "₡22.499,75",
    );
    expect(within(ana).queryByText("Tienda Este")).toBeNull();

    // Beto: Norte y Este, con las suyas.
    const beto = desgloseDe("Beto Mensajero");
    expect(within(beto).getAllByRole("region")).toHaveLength(2);
    expect(importeTras(tienda("Tienda Norte", "Beto Mensajero"), TIENDA_PAGO_HOY_LABEL)).toBe(
      "₡20.454,59",
    );
    expect(importeTras(tienda("Tienda Este", "Beto Mensajero"), TIENDA_PAGO_HOY_LABEL)).toBe(
      "₡16.000",
    );
    expect(within(beto).queryByText("Tienda Sur")).toBeNull();
  });

  it("va DESPUÉS de la cascada que termina en «Para la tienda» y ANTES del ingreso por concepto", async () => {
    await abrirDetalle();

    // Primero la cuenta que cierra, y sólo después de qué tienda es cada parte. Es el mismo sitio
    // relativo que ocupa en el detalle del cierre de mensajero.
    expect(vaAntes(duenoAgregado(), desgloseDe(DE_BODEGA))).toBe(true);
    expect(
      vaAntes(
        desgloseDe(DE_BODEGA),
        screen.getByRole("region", { name: "Ingreso de Ordenex del cierre de bodega" }),
      ),
    ).toBe(true);
    expect(vaAntes(duenoDe("Ana Mensajera"), desgloseDe("Ana Mensajera"))).toBe(true);
    expect(
      vaAntes(
        desgloseDe("Ana Mensajera"),
        screen.getByRole("region", { name: "Ingreso de Ordenex · Ana Mensajera" }),
      ),
    ).toBe(true);
  });
});

describe("396 · D3 · ⚠️ EL CASO QUE SEPARA LOS UMBRALES — R19 vs R20", () => {
  it("dos mensajeros con UNA tienda cada uno: ninguno se desglosa y el agregado SÍ", async () => {
    await abrirDetalle(UNA_TIENDA_CADA_MENSAJERO);

    // El agregado, que tiene DOS tiendas, sí.
    expect(desgloseDe(DE_BODEGA)).toBeInTheDocument();
    expect(
      within(duenoAgregado()).getByText(
        "Es el total de las 2 tiendas de este cierre, sumadas. Abajo, cuánto le toca a cada una.",
      ),
    ).toBeInTheDocument();

    // Y NINGUNO de los dos niveles de mensajero: cada uno tiene una sola tienda. Si el umbral se
    // evaluara sobre las tiendas de la bodega, estas cuatro aserciones caerían.
    expect(
      sinDesglose("Ana Mensajera"),
      "el nivel de Ana se desglosa con las tiendas de la bodega en vez de con las suyas",
    ).toBeNull();
    expect(sinDesglose("Beto Mensajero")).toBeNull();
    expect(within(duenoDe("Ana Mensajera")).queryByText(/Es el total de las/)).toBeNull();
    expect(within(duenoDe("Beto Mensajero")).queryByText(/Es el total de las/)).toBeNull();
  });

  it("y las cascadas de esos dos mensajeros quedan EXACTAMENTE como estaban (R2/R18)", async () => {
    await abrirDetalle(UNA_TIENDA_CADA_MENSAJERO);

    // Ni un rótulo del desglose, ni una nota, en ninguno de los dos niveles de mensajero.
    for (const mensajero of ["Ana Mensajera", "Beto Mensajero"]) {
      const region = duenoDe(mensajero);
      expect(within(region).queryByText(TIENDA_RECAUDADO_LABEL)).toBeNull();
      expect(within(region).queryByText(TIENDA_PAGO_HOY_LABEL)).toBeNull();
      expect(within(region).queryByText(TIENDA_GANA_TOTAL_LABEL)).toBeNull();
    }
    // Y sus importes siguen valiendo lo mismo.
    expect(importeTras(duenoDe("Ana Mensajera"), PARA_LA_TIENDA_LABEL)).toBe("₡62.499,75");
    expect(importeTras(duenoDe("Beto Mensajero"), PARA_LA_TIENDA_LABEL)).toBe("₡36.454,59");
  });

  it("con UNA sola tienda en toda la bodega no aparece NADA nuevo, en ningún nivel", async () => {
    const unaSola: ParteDeTienda = {
      tiendaId: "t-unica",
      tiendaNombre: "Tienda Única",
      recaudado: "126089.17",
      pagoTienda: "98954.34",
      ganaLaTienda: "98453.59",
    };
    await abrirDetalle({
      ...DETALLE_OK,
      cierres: [
        { ...DIA_ANA, partesPorTienda: [{ ...unaSola, recaudado: "80000.10" }] },
        { ...DIA_BETO, partesPorTienda: [{ ...unaSola, recaudado: "46089.07" }] },
      ],
      partesPorTienda: [unaSola],
    });

    expect(sinDesglose(DE_BODEGA)).toBeNull();
    expect(sinDesglose("Ana Mensajera")).toBeNull();
    expect(sinDesglose("Beto Mensajero")).toBeNull();
    expect(screen.queryByText(DESGLOSE_POR_TIENDA_TITULO)).toBeNull();
    expect(screen.queryByText(DESGLOSE_POR_TIENDA_NOTA)).toBeNull();
    expect(screen.queryByText(DESGLOSE_NO_REPARTIDO_NOTA)).toBeNull();
    // Ni siquiera se nombra a la tienda que sí viene en el DTO.
    expect(screen.queryByText("Tienda Única")).toBeNull();
    // Y las tres cifras destacadas de la pantalla siguen exactamente donde y como estaban.
    expect(importeTras(duenoAgregado(), PARA_LA_TIENDA_LABEL)).toBe("₡98.954,34");
    expect(importeTras(duenoAgregado(), NETO_ORDENEX_LABEL)).toBe("₡13.384,78");
    expect(importeTras(centralAgregada(), PARA_LA_CENTRAL_LABEL)).toBe("₡111.838,37");
  });
});

describe("396 · D3 · R10/R11/R12 — la suma de las partes ES el agregado de SU nivel", () => {
  it("lo que se le paga a cada tienda suma el «Para la tienda» de toda la bodega", async () => {
    await abrirDetalle();

    laCuentaCierra(
      [
        importeTras(tienda("Tienda Norte", DE_BODEGA), TIENDA_PAGO_HOY_LABEL),
        importeTras(tienda("Tienda Sur", DE_BODEGA), TIENDA_PAGO_HOY_LABEL),
        importeTras(tienda("Tienda Este", DE_BODEGA), TIENDA_PAGO_HOY_LABEL),
      ],
      importeTras(duenoAgregado(), PARA_LA_TIENDA_LABEL),
      "lo que se le paga a cada tienda de la bodega",
    );
  });

  it("lo recaudado por cada tienda suma el «Total general» de toda la bodega", async () => {
    await abrirDetalle();

    laCuentaCierra(
      [
        importeTras(tienda("Tienda Norte", DE_BODEGA), TIENDA_RECAUDADO_LABEL),
        importeTras(tienda("Tienda Sur", DE_BODEGA), TIENDA_RECAUDADO_LABEL),
        importeTras(tienda("Tienda Este", DE_BODEGA), TIENDA_RECAUDADO_LABEL),
      ],
      importeTras(duenoAgregado(), TOTAL_GENERAL_LABEL),
      "lo recaudado por cada tienda de la bodega",
    );
  });

  it("lo que gana cada tienda suma el agregado del contrato, que esta pantalla NO pinta", async () => {
    // ⚠️ HALLAZGO, y va escrito porque cambia lo que este test puede afirmar: el detalle de
    // bodega no tiene una línea «Gana la tienda» —su cascada de la 393 no la lleva y meterla a
    // media cascada la volvería ilegible—, así que el agregado contra el que suma esta columna
    // viaja en el DTO (`ganaLaTienda`, ficha 396/D1) pero no está en el DOM. El total se escribe
    // A MANO: es el contrato del spec, no la salida de la función que lo genera.
    await abrirDetalle();

    laCuentaCierra(
      [
        importeTras(tienda("Tienda Norte", DE_BODEGA), TIENDA_GANA_TOTAL_LABEL),
        importeTras(tienda("Tienda Sur", DE_BODEGA), TIENDA_GANA_TOTAL_LABEL),
        importeTras(tienda("Tienda Este", DE_BODEGA), TIENDA_GANA_TOTAL_LABEL),
      ],
      "₡98.453,59",
      "lo que gana cada tienda de la bodega",
    );
  });

  it("y en el nivel de CADA MENSAJERO la suma es la de SU propio agregado (R19)", async () => {
    await abrirDetalle();

    laCuentaCierra(
      [
        importeTras(tienda("Tienda Norte", "Ana Mensajera"), TIENDA_PAGO_HOY_LABEL),
        importeTras(tienda("Tienda Sur", "Ana Mensajera"), TIENDA_PAGO_HOY_LABEL),
      ],
      importeTras(duenoDe("Ana Mensajera"), PARA_LA_TIENDA_LABEL),
      "las tiendas de Ana",
    );
    laCuentaCierra(
      [
        importeTras(tienda("Tienda Norte", "Beto Mensajero"), TIENDA_PAGO_HOY_LABEL),
        importeTras(tienda("Tienda Este", "Beto Mensajero"), TIENDA_PAGO_HOY_LABEL),
      ],
      importeTras(duenoDe("Beto Mensajero"), PARA_LA_TIENDA_LABEL),
      "las tiendas de Beto",
    );
  });

  it("en Norte las dos cifras de pago DIFIEREN sólo donde hubo rechazo: son dos preguntas", async () => {
    await abrirDetalle();

    // Ana tuvo un rechazo y lo trajo Norte: la diferencia es exactamente su flete + IVA, 500,75.
    laCuentaCierra(
      [importeTras(tienda("Tienda Norte", "Ana Mensajera"), TIENDA_GANA_TOTAL_LABEL), "₡500,75"],
      importeTras(tienda("Tienda Norte", "Ana Mensajera"), TIENDA_PAGO_HOY_LABEL),
      "Norte en el día de Ana, que sí tuvo un rechazo",
    );
    // El día de Beto no tuvo ninguno: ahí las dos coinciden, y siguen siendo DOS líneas.
    const norteBeto = tienda("Tienda Norte", "Beto Mensajero");
    expect(importeTras(norteBeto, TIENDA_PAGO_HOY_LABEL)).toBe(
      importeTras(norteBeto, TIENDA_GANA_TOTAL_LABEL),
    );
  });
});

describe("396 · D3 · R20/Q8 — una tienda en DOS mensajeros sale UNA sola vez en el agregado", () => {
  it("Norte está en los dos niveles de mensajero y en el agregado es UNA fila", async () => {
    await abrirDetalle();

    // Una sola región de Norte en el desglose agregado…
    const enElAgregado = within(desgloseDe(DE_BODEGA))
      .getAllByRole("region")
      .filter((region) => (region.getAttribute("aria-label") ?? "").startsWith("Tienda Norte ("));
    expect(enElAgregado, "Norte no sale una sola vez en el agregado").toHaveLength(1);
    // …y no hay cruce tienda × mensajero: tres tiendas, no cuatro filas.
    expect(within(desgloseDe(DE_BODEGA)).getAllByRole("region")).toHaveLength(3);

    // Y su fila es la suma de las dos, leída de lo PINTADO en los niveles de abajo.
    laCuentaCierra(
      [
        importeTras(tienda("Tienda Norte", "Ana Mensajera"), TIENDA_PAGO_HOY_LABEL),
        importeTras(tienda("Tienda Norte", "Beto Mensajero"), TIENDA_PAGO_HOY_LABEL),
      ],
      importeTras(tienda("Tienda Norte", DE_BODEGA), TIENDA_PAGO_HOY_LABEL),
      "Norte, que está en los dos mensajeros",
    );
  });
});

describe("396 · D3 · R1 — la marca dice que «Para la tienda» es de VARIAS, y de cuántas", () => {
  it("cada nivel dice SU número: tres en la bodega, dos en cada mensajero", async () => {
    await abrirDetalle();

    // Escritas a mano: comparar la frase contra la función que la genera está siempre verde.
    expect(
      within(duenoAgregado()).getByText(
        "Es el total de las 3 tiendas de este cierre, sumadas. Abajo, cuánto le toca a cada una.",
      ),
    ).toBeInTheDocument();
    for (const mensajero of ["Ana Mensajera", "Beto Mensajero"]) {
      expect(
        within(duenoDe(mensajero)).getByText(
          "Es el total de las 2 tiendas de este cierre, sumadas. Abajo, cuánto le toca a cada una.",
        ),
        `${mensajero} anuncia un número de tiendas que no es el suyo`,
      ).toBeInTheDocument();
    }
  });

  it("la marca está pegada a «Para la tienda» y NO a ninguna otra línea de la cascada", async () => {
    await abrirDetalle();

    const fila = within(duenoAgregado())
      .getAllByText(PARA_LA_TIENDA_LABEL)
      .filter((el) => el.children.length === 0)[0]
      .closest("div");
    expect(
      fila!.textContent,
      "la marca no está en la línea que la necesita",
    ).toContain("Es el total de las 3 tiendas de este cierre");
    // Y la línea sigue diciendo su importe de siempre: la marca se AÑADE, no sustituye (R18).
    expect(importeTras(duenoAgregado(), PARA_LA_TIENDA_LABEL)).toBe("₡98.954,34");
    // «Total general» también se parte por tienda, pero su rótulo no promete una sola: no se
    // marca, igual que en el detalle del cierre de mensajero.
    const filaGeneral = within(duenoAgregado())
      .getAllByText(TOTAL_GENERAL_LABEL)
      .filter((el) => el.children.length === 0)[0]
      .closest("div");
    expect(filaGeneral!.textContent).not.toContain("Es el total de las");
  });
});

describe("396 · D3 · R5 — TRES cifras por tienda, ni una cuarta", () => {
  it("dentro de la región de cada tienda se leen exactamente tres importes, en los dos niveles", async () => {
    await abrirDetalle();

    for (const [nombre, contexto] of [
      ["Tienda Norte", DE_BODEGA],
      ["Tienda Sur", DE_BODEGA],
      ["Tienda Este", DE_BODEGA],
      ["Tienda Norte", "Ana Mensajera"],
      ["Tienda Este", "Beto Mensajero"],
    ] as const) {
      const leidos = todosLosImportes(tienda(nombre, contexto));
      expect(
        leidos,
        `${nombre} · ${contexto} pinta ${leidos.length} importes (${leidos.join(" ")}): R5 permite tres`,
      ).toHaveLength(3);
    }
  });

  it("las dos cifras de pago SE PINTAN LAS DOS: ninguna tienda enseña una sola", async () => {
    await abrirDetalle();

    for (const [nombre, contexto] of [
      ["Tienda Norte", DE_BODEGA],
      ["Tienda Sur", "Ana Mensajera"],
      ["Tienda Este", "Beto Mensajero"],
    ] as const) {
      const region = tienda(nombre, contexto);
      expect(importesTras(region, TIENDA_PAGO_HOY_LABEL)).toHaveLength(1);
      expect(importesTras(region, TIENDA_GANA_TOTAL_LABEL)).toHaveLength(1);
    }
  });
});

describe("396 · D3 · R22 — la misma plata se lee IGUAL que en el detalle del mensajero", () => {
  it("los tres rótulos por tienda son los mismos textos aprobados, también aquí", async () => {
    await abrirDetalle();

    // A mano, nunca derivado de la constante: un renombrado silencioso volvería a fundir las dos
    // preguntas que la ficha 395 acaba de separar un nivel más arriba.
    expect(TIENDA_RECAUDADO_LABEL).toBe("Recaudado de esta tienda");
    expect(TIENDA_PAGO_HOY_LABEL).toBe("Se le paga hoy");
    expect(TIENDA_GANA_TOTAL_LABEL).toBe("Gana en total");
    expect(DESGLOSE_POR_TIENDA_TITULO).toBe("De qué tienda es cada parte");

    const norte = tienda("Tienda Norte", DE_BODEGA);
    expect(within(norte).getByText("Recaudado de esta tienda")).toBeInTheDocument();
    expect(within(norte).getByText("Se le paga hoy")).toBeInTheDocument();
    expect(within(norte).getByText("Gana en total")).toBeInTheDocument();
  });

  it("los cinco rótulos de dinero que nombran a la tienda son cinco textos distintos", async () => {
    await abrirDetalle();

    const todos = [
      TIENDA_RECAUDADO_LABEL,
      TIENDA_PAGO_HOY_LABEL,
      TIENDA_GANA_TOTAL_LABEL,
      PARA_LA_TIENDA_LABEL,
      TOTAL_GENERAL_LABEL,
    ];
    expect(new Set(todos).size, `hay dos rótulos iguales: ${todos.join(" · ")}`).toBe(5);
  });
});

describe("396 · D3 · R17 — lo que NO está repartido, dicho en cada desglose", () => {
  it("las dos notas de cabecera están en los tres desgloses", async () => {
    await abrirDetalle();

    for (const contexto of [DE_BODEGA, "Ana Mensajera", "Beto Mensajero"]) {
      const region = desgloseDe(contexto);
      expect(within(region).getByText(DESGLOSE_NO_REPARTIDO_NOTA)).toBeInTheDocument();
      expect(within(region).getByText(DESGLOSE_POR_TIENDA_NOTA)).toBeInTheDocument();
    }
    // Y dicen lo aprobado, con todas las letras.
    expect(DESGLOSE_NO_REPARTIDO_NOTA).toBe(
      "El pago al mensajero y el ingreso de bodega por rechazos son del cierre completo: no están repartidos entre las tiendas.",
    );
  });

  it("y esos dos importes NO aparecen dentro de ninguna tienda (R16)", async () => {
    await abrirDetalle();

    // El pago al mensajero agregado (14.000,55) y el ingreso de bodega (250,25) siguen siendo del
    // cierre entero: no se reparten ni se cuelan en una cascada de tienda.
    for (const [nombre, contexto] of [
      ["Tienda Norte", DE_BODEGA],
      ["Tienda Norte", "Ana Mensajera"],
    ] as const) {
      const leidos = todosLosImportes(tienda(nombre, contexto));
      expect(leidos).not.toContain("₡14.000,55");
      expect(leidos).not.toContain("₡250,25");
    }
  });
});

describe("396 · D3 — los nombres accesibles son ÚNICOS dentro del modal", () => {
  it("ninguna región del detalle se anuncia igual que otra", async () => {
    await abrirDetalle();

    const nombres = screen
      .getAllByRole("region")
      .map((region) => region.getAttribute("aria-label") ?? "");
    const repetidos = nombres.filter((nombre, i) => nombres.indexOf(nombre) !== i);
    expect(repetidos, `hay regiones que se anuncian igual: ${repetidos.join(" · ")}`).toEqual([]);
  });

  it("la MISMA tienda en dos niveles se anuncia distinto, con su contexto", async () => {
    await abrirDetalle();

    expect(tienda("Tienda Norte", DE_BODEGA).getAttribute("aria-label")).toBe(
      "Tienda Norte (1 de 3) · cierre de bodega",
    );
    expect(tienda("Tienda Norte", "Ana Mensajera").getAttribute("aria-label")).toBe(
      "Tienda Norte (1 de 2) · Ana Mensajera",
    );
    expect(tienda("Tienda Norte", "Beto Mensajero").getAttribute("aria-label")).toBe(
      "Tienda Norte (1 de 2) · Beto Mensajero",
    );
  });

  it("dos tiendas HOMÓNIMAS no se funden Y NO comparten nombre accesible", async () => {
    await abrirDetalle(HOMONIMAS);

    const regiones = screen.getAllByRole("region", { name: nombraA("Mi Tienda", "Ana Mensajera") });
    expect(regiones, "dos tiendas con el mismo nombre se fundieron en una").toHaveLength(2);
    // Cada una con SU dinero: el servidor agrupa por el id congelado, no por el nombre (R7).
    expect(importeTras(regiones[0], TIENDA_PAGO_HOY_LABEL)).toBe("₡40.000");
    expect(importeTras(regiones[1], TIENDA_PAGO_HOY_LABEL)).toBe("₡22.499,75");
    // Y se pueden nombrar por separado: quien navega por landmarks no las ve, las OYE.
    const nombres = regiones.map((region) => region.getAttribute("aria-label"));
    expect(nombres).toEqual([
      "Mi Tienda (1 de 2) · Ana Mensajera",
      "Mi Tienda (2 de 2) · Ana Mensajera",
    ]);
    expect(new Set(nombres).size, `las dos se anuncian igual: ${nombres.join(" · ")}`).toBe(2);
  });
});

describe("396 · D3 · R8 — la pantalla pinta en el orden que le llega, y no reordena", () => {
  it("un desglose agregado que llega de menor a mayor se pinta de menor a mayor", async () => {
    // Fixture DELIBERADAMENTE al revés del criterio del servidor. La pantalla no sabe nada de
    // importes: si aquí saliera Norte primero, es que alguien metió un `sort` en el navegador.
    await abrirDetalle({ ...DETALLE_OK, partesPorTienda: [AGG_ESTE, AGG_SUR, AGG_NORTE] });

    expect(
      vaAntes(tienda("Tienda Este", DE_BODEGA), tienda("Tienda Sur", DE_BODEGA)),
    ).toBe(true);
    expect(
      vaAntes(tienda("Tienda Sur", DE_BODEGA), tienda("Tienda Norte", DE_BODEGA)),
    ).toBe(true);
    // Y la posición del nombre accesible sigue al orden pintado, no al importe.
    expect(tienda("Tienda Este", DE_BODEGA).getAttribute("aria-label")).toBe(
      "Tienda Este (1 de 3) · cierre de bodega",
    );
  });

  it("y el orden normal del servidor —de mayor a menor— se respeta igual", async () => {
    await abrirDetalle();

    expect(
      vaAntes(tienda("Tienda Norte", DE_BODEGA), tienda("Tienda Sur", DE_BODEGA)),
    ).toBe(true);
    expect(
      vaAntes(tienda("Tienda Sur", DE_BODEGA), tienda("Tienda Este", DE_BODEGA)),
    ).toBe(true);
  });
});

describe("396 · D3 · R18 — ni un importe ya visible cambia de valor", () => {
  it("las dos cascadas de la 393 siguen diciendo lo mismo, en los dos niveles", async () => {
    await abrirDetalle();

    expect(importeTras(centralAgregada(), PARA_LA_CENTRAL_LABEL)).toBe("₡111.838,37");
    expect(importeTras(duenoAgregado(), PARA_LA_TIENDA_LABEL)).toBe("₡98.954,34");
    expect(importeTras(duenoAgregado(), NETO_ORDENEX_LABEL)).toBe("₡13.384,78");
    expect(importeTras(duenoDe("Ana Mensajera"), PARA_LA_TIENDA_LABEL)).toBe("₡62.499,75");
    expect(importeTras(duenoDe("Ana Mensajera"), NETO_ORDENEX_LABEL)).toBe("₡8.750,55");
    expect(importeTras(duenoDe("Beto Mensajero"), PARA_LA_TIENDA_LABEL)).toBe("₡36.454,59");
    expect(importeTras(duenoDe("Beto Mensajero"), NETO_ORDENEX_LABEL)).toBe("₡4.634,23");
  });
});

describe("396 · D3 — el desglose no devuelve a esta pantalla un rótulo que la 393 le quitó", () => {
  it("con las tres tiendas pintadas, las cinco cifras sueltas siguen sin aparecer (R24/R34)", async () => {
    await abrirDetalle();

    // La ficha 393 sacó de este detalle cinco tarjetas sueltas que repetían una línea de una
    // cascada, y lo dejó fijado sobre el documento entero. ⚠️ Su fixture NO trae desglose, así
    // que aquella guardia nunca ha visto esta pantalla con el desglose puesto: aquí sí.
    // En particular, reusar «Pago a tienda» —el rótulo del AGREGADO del detalle del MENSAJERO—
    // para la cifra de UNA tienda haría que la misma etiqueta valiera dos cifras distintas según
    // por dónde se entre, que es exactamente el defecto que la 393 cerró y el que esta ficha
    // viene a arreglar. Por eso los rótulos por tienda dicen «Se le paga hoy» y «Gana en total».
    for (const rotulo of [
      "Ingreso bruto",
      "Ganancia",
      "Pago a tienda",
      "Ingreso de bodega por rechazos",
      "Total a pagar a mensajeros",
    ]) {
      expect(
        document.body.textContent,
        `«${rotulo}» vuelve a estar en el detalle de bodega, ahora por el desglose`,
      ).not.toContain(rotulo);
    }
  });
});

describe("396 · D3 — money-safe: la pantalla no hace aritmética de dinero", () => {
  const FUENTES = [
    "app/(app)/cierres-admin/_components/DesglosePorTienda.tsx",
    "app/(app)/cierres-admin/_components/CierresBodegaAdminModule.tsx",
  ] as const;

  it.each(FUENTES)("%s no convierte ni un importe a número", async (ruta) => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const { quitarComentarios } = await import("@/tests/fixtures/sin-comentarios");
    const { LLAMADAS_PROHIBIDAS_EN_DINERO } = await import("@/tests/fixtures/money-safe");

    const codigo = quitarComentarios(
      readFileSync(path.resolve(__dirname, "../..", ruta), "utf8"),
    );
    expect(codigo.length, `${ruta} salió vacío: la guardia no está leyendo nada`).toBeGreaterThan(
      500,
    );
    for (const prohibida of LLAMADAS_PROHIBIDAS_EN_DINERO) {
      expect(codigo, `${ruta} usa ${prohibida.source} sobre un importe`).not.toMatch(prohibida);
    }
  });

  it.each(FUENTES)("%s tampoco ORDENA el desglose: eso lo hizo el servidor", async (ruta) => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const { quitarComentarios } = await import("@/tests/fixtures/sin-comentarios");

    const codigo = quitarComentarios(
      readFileSync(path.resolve(__dirname, "../..", ruta), "utf8"),
    );
    // Ordenar en el navegador exige comparar importes, y comparar importes en el navegador es
    // exactamente lo que R14 prohíbe. El orden llega hecho (R8).
    for (const prohibida of [/\.sort\s*\(/, /\.reverse\s*\(/, /localeCompare\s*\(/]) {
      expect(codigo, `${ruta} usa ${prohibida.source} sobre el desglose`).not.toMatch(prohibida);
    }
  });
});
