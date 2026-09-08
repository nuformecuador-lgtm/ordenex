// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";

import { monedaConfig } from "@/lib/config/moneda";
import type {
  CierreAdminResumen,
  CierreDetalleAdminServiceResult,
} from "@/lib/interfaces/services/ICierresAdminService";
import type {
  CierreGrupos,
  TotalesIngresoOrdenex,
} from "@/lib/interfaces/services/ICierreDiaService";
import type { CierreEstado } from "@/lib/types/cierre";
import {
  CASCADA_DUENO_TITULO,
  CASCADA_FACTURA_TIENDA_TITULO,
  CASCADA_NETO_ORDENEX_TITULO,
  COBRADO_SOBRE_RECAUDADO_LABEL,
  COBRADO_SOBRE_RECAUDADO_NOTA,
  FACTURADO_ORDENEX_LABEL,
  FLETE_DEV_CON_IVA_LABEL,
  FLETE_RECHAZO_AUN_NO_COBRADO_NOTA,
  FLETE_RECHAZO_NO_DEDUCIBLE_NOTA,
  FLETE_RECHAZO_NO_SE_COBRARA_NOTA,
  FLETE_RECHAZO_YA_COBRADO_NOTA,
  GANA_LA_TIENDA_LABEL,
  GANA_LA_TIENDA_NEGATIVO_NOTA,
  GANA_LA_TIENDA_NOTA,
  NETO_ORDENEX_LABEL,
  NETO_ORDENEX_NEGATIVO_NOTA,
  PAGO_TIENDA_HOY_NOTA,
} from "@/app/(app)/cierres-admin/_components/cierre-labels";
// Los cuatro rótulos que ESTA ficha reusa sin tocarlos siguen viviendo donde nacieron, en el
// módulo del detalle. Se piden de ahí a propósito: si un día se movieran al módulo puro, el
// import de arriba seguiría verde y éste se pondría rojo, que es el aviso que se quiere.
import {
  INGRESO_BODEGA_RECHAZOS_LABEL,
  PAGO_MENSAJERO_LABEL,
  PAGO_TIENDA_LABEL,
  TOTAL_GENERAL_LABEL,
} from "@/app/(app)/cierres-admin/_components/cierre-detalle-shared";

/**
 * 💰 FICHA 395 — EL DETALLE DEL CIERRE DE MENSAJERO DICE QUÉ PLATA ES PARA QUIÉN.
 *
 * ── EL DEFECTO QUE MATA ESTE ARCHIVO
 * La pantalla enseñaba «Pago a tienda ₡225.176,33» y «Total Ordenex ₡70.946,67» sueltos e
 * invitaba a restarlos. **Esa resta no da.** El humano se confundió con su propia pantalla y lo
 * dijo así: «si yo me confundo, no quiero imaginar los operarios».
 *
 * ── LOS IMPORTES SON LOS DE SU CAPTURA
 * 285.275,00 · 70.946,67 · 60.098,67 · 10.848,00 · 225.176,33 · 214.328,33. Con estas cifras la
 * confusión es reproducible: `225.176,33 − 70.946,67` NO es lo que la tienda gana, y
 * `225.176,33 − 10.848,00` SÍ. Los importes llevan céntimos a propósito —el resto de fixturas de
 * este repo redondean, y con cifras redondas varias de estas identidades cerrarían igual sin el
 * arreglo—.
 *
 * ── LO QUE SE AFIRMA, Y CÓMO
 * Las cuentas se comprueban sobre las CADENAS QUE SE LEEN DEL DOM, no sobre los `Decimal` de
 * origen: comparar el número contra la función que lo genera está siempre verde (precedente
 * escrito en `DineroIdentidadesEnPantalla`). Lo mismo con el orden: se mide la posición real de
 * las regiones en el documento, porque **el orden es el arreglo**.
 */

vi.mock("@/lib/actions/cierres-admin", () => ({
  listarGestionesCierresAdminCompleto: vi.fn(),
  verCierreDetalle: vi.fn(),
  aprobarCierre: vi.fn(),
  rechazarCierre: vi.fn(),
  listarCierresAdmin: vi.fn(),
  forzarSolicitudVencido: vi.fn(),
  listarHistoricoCierresAdminPaginado: vi.fn(),
  listarPendientesCierresAdminPaginado: vi.fn(),
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
  listarHistoricoCierresAdminPaginado,
  listarPendientesCierresAdminPaginado,
  verCierreDetalle,
} from "@/lib/actions/cierres-admin";
import { CierresAdminModule } from "@/app/(app)/cierres-admin/_components/CierresAdminModule";
import { paginaInicial } from "@/tests/fixtures/pagina-inicial";

// ---------------------------------------------------------------------------
// Lectura de lo PINTADO
// ---------------------------------------------------------------------------

/**
 * Un importe tal y como se LEE, con su operador si lo lleva. El `[+-]?` no es cosmético: las
 * líneas de una cascada se pintan `-₡70.946,67` y `+₡10.848`, y un patrón que sólo aceptara el
 * menos recortaría el más.
 */
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

/**
 * TODOS los importes pintados junto a un rótulo dentro de una región, en orden de aparición.
 *
 * Devuelve una lista y no un importe suelto porque la línea puente aparece DOS VECES en la misma
 * cascada —una como sumando de lo facturado y otra como sustraendo de lo recaudado— y ahí está
 * justamente lo que hay que poder afirmar. Se llega al importe por la ESTRUCTURA de la línea (la
 * etiqueta, su fila, el último hijo), no por una clase de Tailwind, que es lo que se renombra
 * sin avisar.
 */
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

/** La cuenta cierra con las CADENAS que se leen, no con los `Decimal` de origen. */
function laCuentaCierra(sumandos: readonly string[], total: string, quien: string): void {
  const suma = sumandos.reduce((acc, s) => acc + centimos(s), BigInt(0));
  expect(suma, `${quien}: se lee ${sumandos.join(" ")} = ${total}, y no da`).toBe(centimos(total));
}

/** ¿`a` está ANTES que `b` en el documento? */
function vaAntes(a: HTMLElement, b: HTMLElement): boolean {
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

// ---------------------------------------------------------------------------
// Datos
// ---------------------------------------------------------------------------

const GRUPOS_VACIOS: CierreGrupos = {
  entregada: [],
  reprogramada: [],
  devuelta: [],
  rechazada: [],
  incidente: [],
};

/**
 * Los once campos del ingreso de Ordenex. Sólo se pintan los AGRUPADOS (cada concepto con su
 * IVA); los otros se rellenan coherentes para que la fixtura no se contradiga a sí misma, pero
 * ninguna aserción de este archivo los mira.
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

function resumen(over: Partial<CierreAdminResumen> = {}): CierreAdminResumen {
  return {
    cierreId: "c395",
    mensajeroId: "m395",
    mensajeroNombre: "Ana Mensajera",
    estado: "vencido",
    destinoTipo: "bodega_central",
    destinoZonaId: "z1",
    destinoZonaNombre: "GAM",
    totales: {
      efectivo: "200275.00",
      simpe: "60000.00",
      transferencia: "25000.00",
      general: "285275.00",
    },
    totalPagoMensajero: "45000.55",
    totalIngresoBodegaRechazos: "1200.25",
    pendientePagoMensajero: null,
    solicitadoAt: "2026-09-01T10:00:00.000Z",
    resueltoAt: null,
    motivoRechazo: null,
    ...over,
  };
}

type DetalleOk = Extract<CierreDetalleAdminServiceResult, { status: "ok" }>;

/**
 * EL CIERRE DE LA CAPTURA: recaudó 285.275,00, Ordenex le facturó 70.946,67 (60.098,67 sobre lo
 * recaudado + 10.848,00 de flete por rechazo), hoy se le pagan 225.176,33 y en total gana
 * 214.328,33. Estado `vencido`, que es el de la captura: el cargo del flete por rechazo TODAVÍA
 * no se ha hecho.
 */
const CON_RECHAZO: DetalleOk = {
  status: "ok",
  cierre: resumen(),
  grupos: GRUPOS_VACIOS,
  totalesIngreso: totalesIngreso({
    fleteConIva: "48250.17",
    comisionConIva: "11848.50",
    fleteDevolucionConIva: "10848.00",
    total: "70946.67",
  }),
  desgloseIngresoBodegaRechazos: { sla: "1200.25", manual: "0.00", total: "1200.25" },
  ganancia: "25946.12",
  pagoTienda: "225176.33",
  cobradoSobreRecaudado: "60098.67",
  netoOrdenex: "24745.87",
  ganaLaTienda: "214328.33",
  fleteRechazoYaCobradoATienda: false,
  ordenesSinGestion: [],
  sinGestionRegistrado: true,
};

/**
 * SIN un solo rechazo: el flete por rechazo vale "0.00" y la línea puente TIENE que salir igual.
 * Aquí lo que gana la tienda y lo que se le paga coinciden EXACTAMENTE, y aun así son dos líneas
 * distintas: si un día divergen, la pantalla ya sabe decirlo.
 */
const SIN_RECHAZO: DetalleOk = {
  status: "ok",
  cierre: resumen({
    totales: {
      efectivo: "100000.40",
      simpe: "60000.00",
      transferencia: "0.00",
      general: "160000.40",
    },
    totalPagoMensajero: "9000.10",
    totalIngresoBodegaRechazos: "0.00",
  }),
  grupos: GRUPOS_VACIOS,
  totalesIngreso: totalesIngreso({
    fleteConIva: "20000.15",
    comisionConIva: "4000.25",
    fleteDevolucionConIva: "0.00",
    total: "24000.40",
  }),
  desgloseIngresoBodegaRechazos: { sla: "0.00", manual: "0.00", total: "0.00" },
  ganancia: "15000.30",
  pagoTienda: "136000.00",
  cobradoSobreRecaudado: "24000.40",
  netoOrdenex: "15000.30",
  ganaLaTienda: "136000.00",
  fleteRechazoYaCobradoATienda: false,
  ordenesSinGestion: [],
  sinGestionRegistrado: true,
};

/**
 * PUROS RECHAZOS: no se recaudó nada y aun así Ordenex facturó el flete por rechazo. La tienda
 * GANA un negativo y el neto de Ordenex también lo es. Ninguno de los dos se recorta a cero: un
 * cero diría algo falso.
 */
const NEGATIVOS: DetalleOk = {
  status: "ok",
  cierre: resumen({
    estado: "aprobado",
    totales: { efectivo: "0.00", simpe: "0.00", transferencia: "0.00", general: "0.00" },
    totalPagoMensajero: "5000.20",
    totalIngresoBodegaRechazos: "900.30",
    resueltoAt: "2026-09-02T10:00:00.000Z",
    pendientePagoMensajero: "0.00",
  }),
  grupos: GRUPOS_VACIOS,
  totalesIngreso: totalesIngreso({
    fleteConIva: "0.00",
    comisionConIva: "0.00",
    fleteDevolucionConIva: "3400.75",
    total: "3400.75",
  }),
  desgloseIngresoBodegaRechazos: { sla: "900.30", manual: "0.00", total: "900.30" },
  ganancia: "-1599.45",
  pagoTienda: "0.00",
  cobradoSobreRecaudado: "0.00",
  netoOrdenex: "-2499.75",
  ganaLaTienda: "-3400.75",
  fleteRechazoYaCobradoATienda: true,
  ordenesSinGestion: [],
  sinGestionRegistrado: true,
};

const DE = "cierre de Ana Mensajera";
const particion = () =>
  screen.getByRole("region", { name: `${CASCADA_DUENO_TITULO} · ${DE}` });
const factura = () =>
  screen.getByRole("region", { name: `${CASCADA_FACTURA_TIENDA_TITULO} · ${DE}` });
const neto = () =>
  screen.getByRole("region", { name: `${CASCADA_NETO_ORDENEX_TITULO} · ${DE}` });

/** Monta la pantalla, abre el detalle del cierre pendiente y espera a la partición. */
async function abrirDetalle(detalle: DetalleOk = CON_RECHAZO) {
  const cola = paginaInicial([detalle.cierre]);
  vi.mocked(listarPendientesCierresAdminPaginado).mockResolvedValue({
    status: "ok",
    page: 1,
    ...cola,
  });
  vi.mocked(listarHistoricoCierresAdminPaginado).mockResolvedValue({
    status: "ok",
    page: 1,
    ...paginaInicial([]),
  });
  vi.mocked(verCierreDetalle).mockResolvedValue(detalle);

  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <CierresAdminModule pendientes={cola} historico={paginaInicial([])} sinZona={false} />
    </SWRConfig>,
  );

  const user = userEvent.setup();
  // Un `vencido` NO ofrece «Ver / decidir» (feature 111/R15): sólo se puede mirar. Los dos
  // botones abren el MISMO detalle, y el fixture por defecto es el `vencido` de la captura.
  const abrir =
    detalle.cierre.estado === "vencido"
      ? `Ver el cierre de ${detalle.cierre.mensajeroNombre}`
      : "Ver / decidir";
  await user.click(await screen.findByRole("button", { name: abrir }));
  await screen.findByRole("region", { name: `${CASCADA_DUENO_TITULO} · ${DE}` });
  return user;
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

// ---------------------------------------------------------------------------

describe("395 — autocomprobación del lector del DOM", () => {
  it("el lector encuentra las líneas de verdad, y falla cuando le pides una que no está", async () => {
    await abrirDetalle();

    // Si esto saliera vacío o devolviera basura, TODAS las cuentas de abajo cerrarían sobre
    // nada y el verde no significaría nada.
    expect(importesTras(particion(), TOTAL_GENERAL_LABEL)).toEqual(["₡285.275"]);
    // La línea puente aparece DOS veces en la misma cascada, y el lector las ve las dos.
    expect(importesTras(factura(), COBRADO_SOBRE_RECAUDADO_LABEL)).toHaveLength(2);
    expect(() => importesTras(particion(), "Rótulo que no existe")).toThrow();
    // Y el parseador distingue el operador del signo: `+₡10.848` suma, `-₡70.946,67` resta.
    expect(centimos("+₡10.848")).toBe(BigInt(1084800));
    expect(centimos("-₡70.946,67")).toBe(BigInt(-7094667));
  });
});

describe("395 — PRIMERO la partición: el orden es el arreglo", () => {
  it("las tres cascadas son regiones distintas, con nombre accesible propio", async () => {
    await abrirDetalle();

    expect(particion()).toBeInTheDocument();
    expect(factura()).toBeInTheDocument();
    expect(neto()).toBeInTheDocument();
    expect(particion()).not.toBe(factura());
    expect(factura()).not.toBe(neto());
  });

  it("la partición se pinta ANTES que el desglose de lo facturado y que el neto", async () => {
    await abrirDetalle();

    expect(
      vaAntes(particion(), factura()),
      "el desglose de lo facturado se pinta antes que la partición. El orden ES el arreglo: la " +
        "pantalla volvería a empezar por el número que confunde.",
    ).toBe(true);
    expect(vaAntes(factura(), neto())).toBe(true);
  });

  it("la partición se pinta ANTES que la tarjeta «Pago a tienda» del comprobante", async () => {
    await abrirDetalle();

    // Esa tarjeta es la que el humano leyó primero y le hizo restar mal. Lo primero que se lee
    // al abrir el detalle tiene que ser de quién es el dinero.
    const tarjeta = screen.getByRole("region", { name: PAGO_TIENDA_LABEL });
    expect(vaAntes(particion(), tarjeta)).toBe(true);
  });

  it("la partición es UNA resta de tres líneas, y cierra con lo que se lee", async () => {
    await abrirDetalle();
    const region = particion();

    const recaudado = importeTras(region, TOTAL_GENERAL_LABEL);
    const facturado = importeTras(region, FACTURADO_ORDENEX_LABEL);
    const gana = importeTras(region, GANA_LA_TIENDA_LABEL);

    expect(recaudado).toBe("₡285.275");
    expect(facturado).toBe("-₡70.946,67");
    expect(gana).toBe("₡214.328,33");
    laCuentaCierra([recaudado, facturado], gana, "la partición");
  });
});

describe("395 — «Gana la tienda» y «Pago a tienda» son DOS preguntas, no un descuadre", () => {
  it("son dos cifras distintas, cada una con la nota que la separa de la otra", async () => {
    await abrirDetalle();

    const gana = importeTras(particion(), GANA_LA_TIENDA_LABEL);
    const pago = importeTras(factura(), PAGO_TIENDA_LABEL);
    expect(gana).not.toBe(pago);

    expect(within(particion()).getByText(GANA_LA_TIENDA_NOTA)).toBeInTheDocument();
    expect(within(factura()).getByText(PAGO_TIENDA_HOY_NOTA)).toBeInTheDocument();
  });

  it("la diferencia entre las dos es EXACTAMENTE el flete por rechazo, y se lee en pantalla", async () => {
    await abrirDetalle();

    const pago = importeTras(factura(), PAGO_TIENDA_LABEL);
    const gana = importeTras(particion(), GANA_LA_TIENDA_LABEL);
    const flete = importesTras(factura(), FLETE_DEV_CON_IVA_LABEL)[0];

    // `pago − flete = gana`. Es la cuenta que el humano tuvo que deducir solo, y que ahora está
    // escrita: `+₡10.848` se lee como sumando de lo facturado, así que aquí se le da la vuelta.
    expect(flete).toBe("+₡10.848");
    laCuentaCierra([gana, flete], pago, "lo que se le paga hoy frente a lo que gana");
  });
});

describe("395 — el desglose de lo que Ordenex factura, y por qué hoy se paga otra cifra", () => {
  it("la línea puente más el flete por rechazo dan lo facturado", async () => {
    await abrirDetalle();
    const region = factura();

    const [puenteSumando] = importesTras(region, COBRADO_SOBRE_RECAUDADO_LABEL);
    const flete = importesTras(region, FLETE_DEV_CON_IVA_LABEL)[0];
    const facturado = importeTras(region, FACTURADO_ORDENEX_LABEL);

    expect(puenteSumando).toBe("₡60.098,67");
    laCuentaCierra([puenteSumando, flete], facturado, "lo que Ordenex facturó");
  });

  it("lo recaudado menos la línea puente da el pago de hoy", async () => {
    await abrirDetalle();
    const region = factura();

    const recaudado = importeTras(region, TOTAL_GENERAL_LABEL);
    const puenteSustraendo = importesTras(region, COBRADO_SOBRE_RECAUDADO_LABEL)[1];
    const pago = importeTras(region, PAGO_TIENDA_LABEL);

    expect(puenteSustraendo).toBe("-₡60.098,67");
    expect(pago).toBe("₡225.176,33");
    laCuentaCierra([recaudado, puenteSustraendo], pago, "el pago a la tienda de hoy");
  });

  it("la línea puente sale IGUAL cuando el flete por rechazo es cero: no es condicional", async () => {
    await abrirDetalle(SIN_RECHAZO);
    const region = factura();

    // Las DOS apariciones siguen ahí. Sin ellas la cascada enseñaría «recaudado − facturado =
    // pago a tienda», que es la resta que no da en cuanto hay un rechazo.
    const puente = importesTras(region, COBRADO_SOBRE_RECAUDADO_LABEL);
    expect(puente).toEqual(["₡24.000,40", "-₡24.000,40"]);
    expect(within(region).getByText(COBRADO_SOBRE_RECAUDADO_NOTA)).toBeInTheDocument();

    laCuentaCierra(
      [puente[0], importesTras(region, FLETE_DEV_CON_IVA_LABEL)[0]],
      importeTras(region, FACTURADO_ORDENEX_LABEL),
      "sin rechazos, lo que Ordenex facturó",
    );
    laCuentaCierra(
      [importeTras(region, TOTAL_GENERAL_LABEL), puente[1]],
      importeTras(region, PAGO_TIENDA_LABEL),
      "sin rechazos, el pago de hoy",
    );
  });

  it("sin rechazos, lo que gana y lo que se le paga coinciden, y siguen siendo dos líneas", async () => {
    await abrirDetalle(SIN_RECHAZO);

    expect(importeTras(particion(), GANA_LA_TIENDA_LABEL)).toBe("₡136.000");
    expect(importeTras(factura(), PAGO_TIENDA_LABEL)).toBe("₡136.000");
  });
});

describe("395 — lo que le queda a Ordenex", () => {
  it("facturado − pago al mensajero − ingreso de bodega da el neto, y cierra", async () => {
    await abrirDetalle();
    const region = neto();

    const facturado = importeTras(region, FACTURADO_ORDENEX_LABEL);
    const mensajero = importeTras(region, PAGO_MENSAJERO_LABEL);
    const bodega = importeTras(region, INGRESO_BODEGA_RECHAZOS_LABEL);
    const resultado = importeTras(region, NETO_ORDENEX_LABEL);

    expect(facturado).toBe("₡70.946,67");
    expect(mensajero).toBe("-₡45.000,55");
    expect(bodega).toBe("-₡1.200,25");
    expect(resultado).toBe("₡24.745,87");
    laCuentaCierra([facturado, mensajero, bodega], resultado, "el neto de Ordenex");
  });
});

describe("395 — los negativos salen CON SU SIGNO, nunca recortados", () => {
  it("lo que gana la tienda sale negativo, con su signo y con su explicación", async () => {
    await abrirDetalle(NEGATIVOS);
    const region = particion();

    const gana = importeTras(region, GANA_LA_TIENDA_LABEL);
    expect(gana).toBe("-₡3.400,75");
    // Ni recortado a cero ni en valor absoluto: las dos formas de mentir sobre este número.
    expect(gana).not.toBe("₡0");
    expect(gana).not.toBe("₡3.400,75");
    laCuentaCierra(
      [importeTras(region, TOTAL_GENERAL_LABEL), importeTras(region, FACTURADO_ORDENEX_LABEL)],
      gana,
      "la partición con la tienda en negativo",
    );

    // Va explicado, no presentado como un fallo de la pantalla: ni alerta ni mensaje de error.
    expect(within(region).getByText(GANA_LA_TIENDA_NEGATIVO_NOTA)).toBeInTheDocument();
    expect(within(region).queryAllByRole("alert")).toEqual([]);
  });

  it("el neto de Ordenex negativo sale con su signo, con su nota, y su cuenta cierra", async () => {
    await abrirDetalle(NEGATIVOS);
    const region = neto();

    const resultado = importeTras(region, NETO_ORDENEX_LABEL);
    expect(resultado).toBe("-₡2.499,75");
    laCuentaCierra(
      [
        importeTras(region, FACTURADO_ORDENEX_LABEL),
        importeTras(region, PAGO_MENSAJERO_LABEL),
        importeTras(region, INGRESO_BODEGA_RECHAZOS_LABEL),
      ],
      resultado,
      "el neto de Ordenex en negativo",
    );
    expect(within(region).getByText(NETO_ORDENEX_NEGATIVO_NOTA)).toBeInTheDocument();
  });

  it("el resultado negativo va en el tono de atención que ya usan los cierres de bodega", async () => {
    await abrirDetalle(NEGATIVOS);

    // Coherencia con el precedente de la 393 (`CascadaDinero`, R11/R36): el tono es del
    // RESULTADO, no de un sustraendo cualquiera.
    const fila = within(particion())
      .getAllByText(GANA_LA_TIENDA_LABEL)
      .filter((el) => el.children.length === 0)[0]
      .closest("div");
    expect(fila!.lastElementChild).toHaveClass("text-danger-strong");
  });
});

describe("395 — el tiempo verbal del cargo del flete por rechazo (la trampa)", () => {
  it("cierre VENCIDO: dice que TODAVÍA no se ha cargado, nunca que ya se cargó", async () => {
    // Éste es el cierre de la captura del humano. El cargo se escribe al APROBAR, así que aquí
    // «se le cargó» sería mentira.
    await abrirDetalle(CON_RECHAZO);
    const region = factura();

    expect(within(region).getByText(FLETE_RECHAZO_AUN_NO_COBRADO_NOTA)).toBeInTheDocument();
    expect(within(region).queryByText(FLETE_RECHAZO_YA_COBRADO_NOTA)).toBeNull();
    expect(within(region).queryByText(FLETE_RECHAZO_NO_SE_COBRARA_NOTA)).toBeNull();
    // Y la nota de siempre —por qué ese flete no sale de lo recaudado— sigue estando.
    expect(within(region).getByText(FLETE_RECHAZO_NO_DEDUCIBLE_NOTA)).toBeInTheDocument();
  });

  it("cierre APROBADO con rechazos: dice que YA se cargó", async () => {
    await abrirDetalle(NEGATIVOS);
    const region = factura();

    expect(within(region).getByText(FLETE_RECHAZO_YA_COBRADO_NOTA)).toBeInTheDocument();
    expect(within(region).queryByText(FLETE_RECHAZO_AUN_NO_COBRADO_NOTA)).toBeNull();
  });

  it("cierre RECHAZADO: dice que ese cargo no se hizo ni se va a hacer", async () => {
    await abrirDetalle({
      ...CON_RECHAZO,
      cierre: resumen({ estado: "rechazado", motivoRechazo: "Faltan evidencias" }),
      fleteRechazoYaCobradoATienda: false,
    });
    const region = factura();

    expect(within(region).getByText(FLETE_RECHAZO_NO_SE_COBRARA_NOTA)).toBeInTheDocument();
    expect(within(region).queryByText(FLETE_RECHAZO_YA_COBRADO_NOTA)).toBeNull();
    expect(within(region).queryByText(FLETE_RECHAZO_AUN_NO_COBRADO_NOTA)).toBeNull();
  });

  it("cierre SOLICITADO con rechazos: todavía no, porque todavía no se aprueba", async () => {
    await abrirDetalle({
      ...CON_RECHAZO,
      cierre: resumen({ estado: "solicitado" }),
      fleteRechazoYaCobradoATienda: false,
    });

    expect(within(factura()).getByText(FLETE_RECHAZO_AUN_NO_COBRADO_NOTA)).toBeInTheDocument();
  });

  it("sin flete por rechazo NO se escribe ninguna de las tres: no hay cargo del que hablar", async () => {
    await abrirDetalle(SIN_RECHAZO);
    const region = factura();

    for (const nota of [
      FLETE_RECHAZO_YA_COBRADO_NOTA,
      FLETE_RECHAZO_AUN_NO_COBRADO_NOTA,
      FLETE_RECHAZO_NO_SE_COBRARA_NOTA,
    ]) {
      expect(within(region).queryByText(nota), `sobra «${nota}» junto a un ₡0`).toBeNull();
    }
  });

  it("un cierre APROBADO sin un solo rechazo tampoco habla de ningún cargo", async () => {
    await abrirDetalle({
      ...SIN_RECHAZO,
      cierre: resumen({
        estado: "aprobado",
        totales: SIN_RECHAZO.cierre.totales,
        totalPagoMensajero: SIN_RECHAZO.cierre.totalPagoMensajero,
        totalIngresoBodegaRechazos: "0.00",
        resueltoAt: "2026-09-02T10:00:00.000Z",
        pendientePagoMensajero: "0.00",
      }),
      fleteRechazoYaCobradoATienda: false,
    });

    expect(within(factura()).queryByText(FLETE_RECHAZO_YA_COBRADO_NOTA)).toBeNull();
    expect(within(factura()).queryByText(FLETE_RECHAZO_AUN_NO_COBRADO_NOTA)).toBeNull();
  });
});

describe("395 — los rótulos NO se confunden entre sí", () => {
  it.each([
    ["GANA_LA_TIENDA_LABEL", GANA_LA_TIENDA_LABEL, "Gana la tienda"],
    ["PAGO_TIENDA_LABEL", PAGO_TIENDA_LABEL, "Pago a tienda"],
    ["CASCADA_FACTURA_TIENDA_TITULO", CASCADA_FACTURA_TIENDA_TITULO, "Lo que Ordenex le factura a la tienda"],
    ["CASCADA_NETO_ORDENEX_TITULO", CASCADA_NETO_ORDENEX_TITULO, "Lo que le queda a Ordenex"],
  ])("%s dice exactamente lo aprobado", (_nombre, constante, literal) => {
    // A MANO, nunca derivado de la constante: comparar un rótulo con la función que lo genera
    // está siempre verde, y un renombrado silencioso de «Gana la tienda» a «Pago a tienda»
    // volvería a fundir las dos preguntas que esta ficha vino a separar.
    expect(constante).toBe(literal);
  });

  it("los tres estados del cargo dicen tres cosas distintas, y ninguna en el tiempo del otro", () => {
    const tres = [
      FLETE_RECHAZO_YA_COBRADO_NOTA,
      FLETE_RECHAZO_AUN_NO_COBRADO_NOTA,
      FLETE_RECHAZO_NO_SE_COBRARA_NOTA,
    ];
    expect(new Set(tres).size).toBe(3);
    expect(FLETE_RECHAZO_YA_COBRADO_NOTA).toBe(
      "Ya se le cargó al saldo de la tienda: ese cargo se hace al aprobar el cierre.",
    );
    expect(FLETE_RECHAZO_AUN_NO_COBRADO_NOTA).toBe(
      "Todavía no se le ha cargado al saldo de la tienda: ese cargo se hace al aprobar el cierre.",
    );
    expect(FLETE_RECHAZO_NO_SE_COBRARA_NOTA).toBe(
      "Este cierre se rechazó, así que ese cargo no se le hizo a la tienda ni se le va a hacer.",
    );
  });
});

describe("395 — money-safe: la pantalla no hace aritmética de dinero", () => {
  const FUENTES = [
    "app/(app)/cierres-admin/_components/CascadasCierreMensajero.tsx",
    "app/(app)/cierres-admin/_components/cierre-labels.ts",
  ] as const;

  it.each(FUENTES)("%s no convierte ni un importe a número", async (ruta) => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const { quitarComentarios } = await import("@/tests/fixtures/sin-comentarios");
    const { LLAMADAS_PROHIBIDAS_EN_DINERO } = await import("@/tests/fixtures/money-safe");

    const codigo = quitarComentarios(
      readFileSync(path.resolve(__dirname, "../..", ruta), "utf8"),
    );
    expect(codigo.length, `${ruta} salió vacío: el censo no está leyendo nada`).toBeGreaterThan(
      500,
    );
    for (const prohibida of LLAMADAS_PROHIBIDAS_EN_DINERO) {
      expect(codigo, `${ruta} usa ${prohibida.source} sobre un importe`).not.toMatch(prohibida);
    }
  });
});

/**
 * Un cierre `vencido` es el de la captura y por eso es el fixture por defecto — pero el botón que
 * lo abre no se llama igual que el de un `solicitado`. Este caso deja constancia de que el
 * detalle se abre por LAS DOS vías y que las cascadas salen igual en las dos: si un día el
 * `vencido` dejara de tener detalle, esto se pondría rojo aquí y no en producción.
 */
describe("395 — las cascadas salen igual se abra el detalle por donde se abra", () => {
  it("un cierre solicitado las trae, y un vencido también", async () => {
    await abrirDetalle({ ...CON_RECHAZO, cierre: resumen({ estado: "solicitado" }) });
    expect(particion()).toBeInTheDocument();
    cleanup();
    await abrirDetalle(CON_RECHAZO);
    expect(particion()).toBeInTheDocument();
  });
});
