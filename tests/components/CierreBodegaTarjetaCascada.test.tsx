// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

import type { CierreAdminResumen } from "@/lib/interfaces/services/ICierresAdminService";
import type {
  CierreBodegaResumen,
  CierreBodegaResumenLite,
} from "@/lib/interfaces/services/ICierreBodegaService";
import type { CierrePasadoDTO } from "@/lib/interfaces/services/ICierreDiaService";
import { money, monedaConfig } from "@/lib/config/moneda";
import {
  CASCADA_CENTRAL_TITULO,
  PARA_LA_CENTRAL_LABEL,
  PARA_LA_TIENDA_LABEL,
  NETO_ORDENEX_LABEL,
  GANA_BODEGA_SATELITE_LABEL,
  PARA_LA_CENTRAL_NOTA,
  PARA_LA_CENTRAL_NEGATIVO_NOTA,
  EFECTIVO_NO_CUBRE_NOTA,
} from "@/app/(app)/cierres-admin/_components/cierre-labels";
import { PAGO_MENSAJERO_LABEL } from "@/app/(app)/cierres-admin/_components/cierre-detalle-shared";

/**
 * Feature 393 (F4) — LA TARJETA DEL CIERRE DE BODEGA: donde vive el número que hace falta para
 * operar.
 *
 * ── POR QUÉ AQUÍ Y NO EN EL DETALLE
 * La bodega satélite **sólo ve la tarjeta**: su módulo de consolidación monta el listado de
 * cierres solicitados SIN acción de abrir detalle. Si «Para la central» viviera en el panel, la
 * satélite no lo vería nunca — y es precisamente ella quien descuenta el pago a los mensajeros de
 * lo que le entrega a la central.
 *
 * ── LO QUE SE AFIRMA
 * Que la columna del medio deja de llamarse «Ajustes» (R19), que enseña la cascada entera y que
 * la resta CIERRA leyendo el DOM (R9/R18), que las dos pantallas donde aparece la tarjeta dicen
 * lo MISMO (R38), que las otras tres superficies del mismo comprobante no cambian (R21), que el
 * resultado llega ya derivado y no se calcula aquí (R20), que el negativo se pinta con su signo y
 * su nota (R36), que el aviso del efectivo aparece cuando toca (R37) y que la cascada del margen
 * de Ordenex NO se cuela en la tarjeta (R39).
 *
 * Los importes llevan CÉNTIMOS a propósito.
 */

vi.mock("@/lib/actions/cierre-bodega", () => ({
  listarCierresBodegaSolicitadosPaginado: vi.fn(),
  listarCierresBodegaSolicitadosCompleto: vi.fn(),
  listarHistoricoCierresBodegaPaginado: vi.fn(),
  listarHistoricoCierresBodegaCompleto: vi.fn(),
}));

import {
  listarCierresBodegaSolicitadosPaginado,
  listarHistoricoCierresBodegaPaginado,
} from "@/lib/actions/cierre-bodega";
import {
  CierreBodegaFacturaResumen,
  CierreFacturaResumen,
  CierreFacturaResumenPropio,
  CierreConsolidableFacturaResumen,
} from "@/app/(app)/cierres-admin/_components/cierre-factura";
import { CierresBodegaSolicitadosLista } from "@/app/(app)/cierres-admin/_components/CierresBodegaSolicitadosLista";
import { CierresBodegaResueltosLista } from "@/app/(app)/cierres-admin/_components/CierresBodegaResueltosLista";

// ---------------------------------------------------------------------------
// EL PARSEADOR: lee una cadena PINTADA y devuelve céntimos. Deshace exactamente lo que hace el
// formateador y nada más, para que una cadena mal formada dé un número distinto en vez de
// "arreglarse" por el camino. Independiente a propósito del de `DineroIdentidadesEnPantalla`:
// dos implementaciones que coinciden valen más que una compartida que puede estar mal las dos
// veces.
// ---------------------------------------------------------------------------

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

/** El importe pintado que sigue a un rótulo dentro de la región de la cascada. */
function importeTras(region: HTMLElement, rotulo: string): string {
  const texto = region.textContent ?? "";
  const desde = texto.indexOf(rotulo);
  expect(desde, `el rótulo «${rotulo}» no está en la cascada`).toBeGreaterThanOrEqual(0);
  const hallado = texto.slice(desde + rotulo.length).match(PATRON_IMPORTE);
  expect(hallado, `no hay importe junto a «${rotulo}»`).not.toBeNull();
  return hallado![0];
}

/**
 * Un importe tal y como se LEE, con su operador si lo lleva. El `[+-]?` no es cosmetico: las
 * lineas de una cascada se pintan `-₡14.000,55` y `+₡0`, y un patron que solo aceptara el menos
 * recortaria el mas — devolveria «₡0» y una asercion sobre el operador pasaria por casualidad.
 */
const PATRON_IMPORTE = new RegExp(
  `[+-]?${monedaConfig.simbolo}\\d[\\d${monedaConfig.separadorMiles}]*(?:${monedaConfig.separadorDecimal}\\d\\d)?`,
);

// ---------------------------------------------------------------------------
// Datos. 126.089,17 − 14.000,55 − 250,25 = 111.838,37, con céntimos en los cuatro.
// ---------------------------------------------------------------------------

const ZONA = "33333333-3333-4333-8333-333333333333";

const TOTALES = {
  efectivo: "100000.17",
  simpe: "26089.00",
  transferencia: "0.00",
  general: "126089.17",
};

function cierreBodega(over: Partial<CierreBodegaResumen> = {}): CierreBodegaResumen {
  return {
    cierreBodegaId: "b1b1b1b1-1111-4111-8111-b1b1b1b1b1b1",
    zonaId: ZONA,
    zonaNombre: "Limón",
    solicitadoPorId: "u1",
    solicitadoPorNombre: "Sara Satélite",
    estado: "solicitado",
    totales: TOTALES,
    totalPagoMensajero: "14000.55",
    totalIngresoBodegaRechazos: "250.25",
    cantidadCierres: 3,
    solicitadoAt: "2026-09-01T10:00:00.000Z",
    resueltoAt: null,
    motivoRechazo: null,
    paraLaCentral: "111838.37",
    efectivoCubreDescuentos: true,
    ...over,
  };
}

const SUFIJO = "del cierre de bodega de Limón";

function envolver(ui: ReactElement) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>,
  );
}

/** Despliega la tarjeta y devuelve la región de la cascada «lo que va a la central». */
async function desplegar(sufijo = SUFIJO): Promise<HTMLElement> {
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: `Ver detalles ${sufijo}` }));
  return screen.getByRole("region", { name: CASCADA_CENTRAL_TITULO });
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("393 · F4 — la tarjeta del cierre de bodega cuenta la cascada B", () => {
  it("la columna del medio deja de llamarse «Ajustes» y dice «Lo que va a la central» (R19)", async () => {
    envolver(<CierreBodegaFacturaResumen cierre={cierreBodega()} />);
    const cascada = await desplegar();

    expect(cascada).toBeInTheDocument();
    // «Ajustes» era el rótulo de un bloque que contenía el pago al mensajero y el ingreso de
    // bodega: ninguno de los dos es un ajuste.
    expect(screen.queryByRole("region", { name: "Ajustes" })).toBeNull();
    expect(document.body.textContent).not.toContain("Ajustes");
  });

  it("las CUATRO líneas están, y la resta CIERRA leyendo el DOM (R9/R18)", async () => {
    envolver(<CierreBodegaFacturaResumen cierre={cierreBodega()} />);
    const cascada = await desplegar();

    const total = importeTras(cascada, "Total");
    const pago = importeTras(cascada, PAGO_MENSAJERO_LABEL);
    const bodega = importeTras(cascada, GANA_BODEGA_SATELITE_LABEL);
    const resultado = importeTras(cascada, PARA_LA_CENTRAL_LABEL);

    // Los dos descuentos se LEEN como resta: con su signo delante (R5).
    expect(pago.startsWith("-")).toBe(true);
    expect(bodega.startsWith("-")).toBe(true);

    // Y la cuenta da, con las cadenas tal y como se pintan.
    expect(
      centimos(total) + centimos(pago) + centimos(bodega),
      `en pantalla se lee ${total} ${pago} ${bodega} = ${resultado}, y no da`,
    ).toBe(centimos(resultado));
    // Al céntimo, no al colón: los cuatro importes llevan cola.
    expect(centimos(resultado)).toBe(BigInt(11183837));
  });

  it("la nota dice de qué resta sale, bajo el resultado (R26)", async () => {
    envolver(<CierreBodegaFacturaResumen cierre={cierreBodega()} />);
    const cascada = await desplegar();
    expect(within(cascada).getByText(PARA_LA_CENTRAL_NOTA)).toBeInTheDocument();
  });

  it("la satélite y el maestro ven el MISMO rótulo y el MISMO valor (R38)", async () => {
    // Las dos pantallas donde aparece la tarjeta de un cierre de bodega: la del `adminSatelite`
    // (su listado de solicitados, sin acción de abrir detalle) y la del maestro (el histórico de
    // resueltos). Montan el MISMO comprobante, así que no pueden discrepar — y esto lo mide en
    // vez de razonarlo.
    const fila = cierreBodega();
    vi.mocked(listarCierresBodegaSolicitadosPaginado).mockResolvedValue({
      status: "ok",
      page: 1,
      items: [fila],
      total: 1,
      pageSize: 10,
    });
    vi.mocked(listarHistoricoCierresBodegaPaginado).mockResolvedValue({
      status: "ok",
      page: 1,
      items: [fila],
      total: 1,
      pageSize: 10,
    });

    const pagina = { items: [fila], total: 1, pageSize: 10 };

    const satelite = envolver(<CierresBodegaSolicitadosLista initialData={pagina} />);
    const cascadaSatelite = await desplegar();
    const rotuloSatelite = PARA_LA_CENTRAL_LABEL;
    const valorSatelite = importeTras(cascadaSatelite, PARA_LA_CENTRAL_LABEL);
    satelite.unmount();

    envolver(
      <CierresBodegaResueltosLista initialData={pagina} onAbrir={() => {}} />,
    );
    const cascadaMaestro = await desplegar();
    const valorMaestro = importeTras(cascadaMaestro, PARA_LA_CENTRAL_LABEL);

    expect(within(cascadaMaestro).getByText(rotuloSatelite)).toBeInTheDocument();
    expect(valorMaestro).toBe(valorSatelite);
    expect(valorMaestro).toBe(money("111838.37"));
  });

  it("el resultado LLEGA en la prop: la tarjeta no lo calcula (R20)", async () => {
    // Un canario: `paraLaCentral` que NO es la resta de los totales de su propia fila. Si la
    // tarjeta recalculara en vez de leer el dato del servidor, pintaría 111.838,37.
    envolver(<CierreBodegaFacturaResumen cierre={cierreBodega({ paraLaCentral: "77777.77" })} />);
    const cascada = await desplegar();

    expect(importeTras(cascada, PARA_LA_CENTRAL_LABEL)).toBe(money("77777.77"));
    expect(cascada.textContent).not.toContain(money("111838.37"));
  });

  it("un «Para la central» NEGATIVO se pinta con su signo, en rojo y con su nota (R36)", async () => {
    // No es una hipótesis: medido contra producción el 2026-09-08, 1 de 14 cierres de bodega ya
    // lo tenía negativo. El pago al mensajero es FIJO por entrega e independiente de lo
    // recaudado, así que una jornada mayoritariamente prepagada lo produce por construcción.
    envolver(
      <CierreBodegaFacturaResumen
        cierre={cierreBodega({
          totales: { efectivo: "500.00", simpe: "500.00", transferencia: "0.00", general: "1000.00" },
          totalPagoMensajero: "2000.05",
          totalIngresoBodegaRechazos: "0.00",
          paraLaCentral: "-1000.05",
          efectivoCubreDescuentos: false,
        })}
      />,
    );
    const cascada = await desplegar();

    const resultado = importeTras(cascada, PARA_LA_CENTRAL_LABEL);
    expect(resultado).toBe("-₡1.000,05");
    expect(centimos(resultado)).toBe(BigInt(-100005));
    // Ni recortado a cero, ni en valor absoluto, ni escondido.
    expect(resultado).not.toBe(money("0"));
    expect(resultado).not.toBe(money("1000.05"));
    // Con tono de atención y con la nota que dice qué significa.
    expect(within(cascada).getByText(resultado).className).toContain("text-danger-strong");
    expect(within(cascada).getByText(PARA_LA_CENTRAL_NEGATIVO_NOTA)).toBeInTheDocument();
    // Y el rótulo NO cambia: una cifra, un nombre (D6).
    expect(within(cascada).getByText(PARA_LA_CENTRAL_LABEL)).toBeInTheDocument();
  });

  it("el aviso del EFECTIVO sale con un resultado POSITIVO (R37)", async () => {
    // El caso más frecuente y distinto del negativo: la satélite sí entrega, pero no tiene el
    // efectivo para pagar porque parte de lo recaudado entró por SINPE.
    envolver(
      <CierreBodegaFacturaResumen
        cierre={cierreBodega({
          totales: { efectivo: "10.00", simpe: "126079.17", transferencia: "0.00", general: "126089.17" },
          efectivoCubreDescuentos: false,
        })}
      />,
    );
    const cascada = await desplegar();

    expect(importeTras(cascada, PARA_LA_CENTRAL_LABEL)).toBe(money("111838.37"));
    expect(within(cascada).getByText(EFECTIVO_NO_CUBRE_NOTA)).toBeInTheDocument();
    // Y no se confunde con el otro caso: el resultado es positivo, así que su nota no sale.
    expect(within(cascada).queryByText(PARA_LA_CENTRAL_NEGATIVO_NOTA)).toBeNull();
  });

  it("con el efectivo cubriendo los descuentos, el aviso NO aparece (R37)", async () => {
    envolver(<CierreBodegaFacturaResumen cierre={cierreBodega()} />);
    const cascada = await desplegar();
    expect(within(cascada).queryByText(EFECTIVO_NO_CUBRE_NOTA)).toBeNull();
  });

  it("la tarjeta NO enseña el margen de Ordenex (R39)", async () => {
    // H2: la satélite ve lo suyo; nadie ve un margen que no le toca. Y la tarjeta es la ÚNICA
    // superficie que la satélite alcanza.
    envolver(<CierreBodegaFacturaResumen cierre={cierreBodega()} />);
    await desplegar();

    const texto = document.body.textContent ?? "";
    expect(texto).not.toContain(PARA_LA_TIENDA_LABEL);
    expect(texto).not.toContain(NETO_ORDENEX_LABEL);
    expect(texto).not.toContain("Ingreso bruto");
    expect(texto).not.toContain("Ganancia");
  });
});

describe("393 · F4 — las OTRAS TRES superficies del mismo comprobante, intactas (R21)", () => {
  const TOTALES_MENSAJERO = {
    efectivo: "500.25",
    simpe: "0.00",
    transferencia: "0.00",
    general: "500.25",
  };

  const RESUMEN_ADMIN: CierreAdminResumen = {
    cierreId: "c1c1c1c1-1111-4111-8111-c1c1c1c1c1c1",
    mensajeroId: "m1",
    mensajeroNombre: "Ana Mensajera",
    estado: "solicitado",
    destinoTipo: "bodega_central",
    destinoZonaNombre: "GAM",
    totales: TOTALES_MENSAJERO,
    totalPagoMensajero: "100.10",
    totalIngresoBodegaRechazos: "5.00",
    solicitadoAt: "2026-09-01T10:00:00.000Z",
    resueltoAt: null,
    motivoRechazo: null,
  } as CierreAdminResumen;

  const PROPIO: CierrePasadoDTO = {
    cierreId: "d1d1d1d1-1111-4111-8111-d1d1d1d1d1d1",
    estado: "aprobado",
    destinoTipo: "bodega_central",
    totales: TOTALES_MENSAJERO,
    totalPagoMensajero: "100.10",
    totalIngresoBodegaRechazos: "5.00",
    solicitadoAt: "2026-09-01T10:00:00.000Z",
    resueltoAt: "2026-09-02T10:00:00.000Z",
    motivoRechazo: null,
  } as CierrePasadoDTO;

  const CONSOLIDABLE: CierreBodegaResumenLite = {
    cierreDiaId: "e1e1e1e1-1111-4111-8111-e1e1e1e1e1e1",
    mensajeroId: "m1",
    mensajeroNombre: "Ana Mensajera",
    totales: TOTALES_MENSAJERO,
    totalPagoMensajero: "100.10",
    totalIngresoBodegaRechazos: "5.00",
  };

  // Las tres van como FÁBRICAS y no como elementos ya construidos: un array de JSX en un
  // `it.each` obliga a inventar una `key` que no significa nada, y el elemento se crearía una
  // sola vez para las tres corridas.
  it.each([
    [
      "cierre de mensajero del admin",
      () => <CierreFacturaResumen cierre={RESUMEN_ADMIN} />,
      "del cierre de Ana Mensajera",
    ],
    [
      "cierre propio del mensajero",
      () => <CierreFacturaResumenPropio cierre={PROPIO} />,
      "de tu cierre del 2026-09-01",
    ],
    [
      "cierre_dia consolidable",
      () => <CierreConsolidableFacturaResumen cierre={CONSOLIDABLE} />,
      "del cierre de Ana Mensajera",
    ],
  ])("%s sigue pintando «Ajustes» con sus líneas de siempre", async (_nombre, ui, sufijo) => {
    envolver(ui());
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: `Ver detalles ${sufijo}` }));

    const ajustes = screen.getByRole("region", { name: "Ajustes" });
    expect(ajustes).toBeInTheDocument();
    // Ni el rótulo nuevo ni el resultado de la cascada se cuelan aquí.
    expect(screen.queryByRole("region", { name: CASCADA_CENTRAL_TITULO })).toBeNull();
    expect(document.body.textContent).not.toContain(PARA_LA_CENTRAL_LABEL);
    expect(document.body.textContent).not.toContain(GANA_BODEGA_SATELITE_LABEL);
    // Y sus importes se pintan SIN operador: no son líneas de una cascada.
    expect(ajustes.textContent).toContain(money("100.10"));
    expect(ajustes.textContent).not.toContain(`-${money("100.10")}`);
  });
});
