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
import type { ParteDeTienda } from "@/lib/utils/ingreso-ordenex";
import {
  CASCADA_DUENO_TITULO,
  CASCADA_FACTURA_TIENDA_TITULO,
  CASCADA_NETO_ORDENEX_TITULO,
  DESGLOSE_NO_REPARTIDO_NOTA,
  DESGLOSE_POR_TIENDA_NOTA,
  DESGLOSE_POR_TIENDA_TITULO,
  GANA_LA_TIENDA_LABEL,
  PAGO_TIENDA_HOY_NOTA,
  TIENDA_GANA_TOTAL_LABEL,
  TIENDA_PAGO_HOY_LABEL,
  TIENDA_RECAUDADO_LABEL,
  totalDeVariasTiendasNota,
} from "@/app/(app)/cierres-admin/_components/cierre-labels";
// `PAGO_TIENDA_LABEL` se pide donde nació —el módulo del detalle—, igual que hace el archivo de
// la ficha 395: si un día se moviera al módulo puro, este import se pondría rojo y avisaría.
import { PAGO_TIENDA_LABEL } from "@/app/(app)/cierres-admin/_components/cierre-detalle-shared";

/**
 * 💰 FICHA 396 — «PAGO A TIENDA» DICE DE QUÉ TIENDA ES CADA PARTE.
 *
 * ── LO PRIMERO, PORQUE CAMBIA CÓMO SE LEE TODO LO DEMÁS
 * **El dinero está BIEN.** La wallet reparte por tienda con sus propias cifras desde siempre: a
 * nadie se le paga mal, y esta ficha no toca ni una fila del ledger. Lo que se arregla es la
 * PANTALLA: el cierre es del MENSAJERO, y un mensajero reparte para quien le toque, así que
 * «Pago a tienda» era la SUMA de todas sus tiendas sin decirlo en ninguna parte. Medido en
 * producción el 2026-09-08: de 56 cierres, 39 tienen UNA tienda y 17 tienen DOS.
 *
 * ── LOS IMPORTES SON LOS DE LA CAPTURA DEL HUMANO, PARTIDOS EN DOS TIENDAS
 * Los agregados son EXACTAMENTE los de la ficha 395 —285.275,00 · 70.946,67 · 60.098,67 ·
 * 10.848,00 · 225.176,33 · 214.328,33— y aquí se reparten entre «Tienda Norte» (que sí tuvo un
 * rechazo) y «Tienda Sur» (que no). Es deliberado: si las dos tiendas tuvieran rechazos, o
 * ninguna, la diferencia entre «Se le paga hoy» y «Gana en total» sería la misma en las dos y
 * una derivación con el subconjunto equivocado pasaría desapercibida.
 *
 * ── LO QUE SE AFIRMA, Y CÓMO
 * Las cifras se leen DEL DOM y se comparan contra literales escritos a mano; las sumas se hacen
 * sobre las cadenas pintadas, no sobre los datos de entrada. Comparar un número contra la
 * función que lo genera está siempre verde (precedente escrito en `DineroIdentidadesEnPantalla`),
 * y lo mismo vale para los rótulos: se comparan contra el texto aprobado, no contra su constante.
 *
 * ── POR QUÉ ESTE ARCHIVO TIENE SUS PROPIOS LECTORES DEL DOM
 * `CierreMensajeroDetalleCascadas.test.tsx` (ficha 395) tiene unos casi iguales y no los exporta.
 * Se reescriben aquí en vez de tocar aquel archivo: es la red de una ficha ya cerrada y de dinero
 * en pantalla, y moverle una función para ahorrar treinta líneas es un riesgo peor que la copia.
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
 * TODOS los importes que se leen dentro de una región, sean del rótulo que sean. Es lo que hace
 * comprobable R5: una cuarta cifra por tienda se vería aquí aunque nadie supiera cómo se llama.
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

function resumen(over: Partial<CierreAdminResumen> = {}): CierreAdminResumen {
  return {
    cierreId: "c396",
    mensajeroId: "m396",
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
 * LAS DOS TIENDAS DE LA CAPTURA. Norte tuvo un rechazo (10.848,00 de flete + IVA) y Sur no, así
 * que sólo en Norte difieren «Se le paga hoy» y «Gana en total» — que es lo que hace que una
 * derivación con el subconjunto equivocado se note.
 *
 *   Norte  recaudó 180.000,00 · se le pagan 144.000,00 · gana 133.152,00   (difieren en 10.848)
 *   Sur    recaudó 105.275,00 · se le pagan  81.176,33 · gana  81.176,33   (no difieren)
 *   ───────────────────────────────────────────────────────────────────────────────────────
 *   suma           285.275,00              225.176,33        214.328,33   = los agregados
 */
const NORTE: ParteDeTienda = {
  tiendaId: "t-norte",
  tiendaNombre: "Tienda Norte",
  recaudado: "180000.00",
  pagoTienda: "144000.00",
  ganaLaTienda: "133152.00",
};
const SUR: ParteDeTienda = {
  tiendaId: "t-sur",
  tiendaNombre: "Tienda Sur",
  recaudado: "105275.00",
  pagoTienda: "81176.33",
  ganaLaTienda: "81176.33",
};

/** El cierre de la captura, ahora sabiendo que llevaba órdenes de DOS tiendas. */
const DOS_TIENDAS: DetalleOk = {
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
  // Ya ORDENADO por el servidor: por lo que se le paga, de mayor a menor (R8).
  partesPorTienda: [NORTE, SUR],
  ordenesSinGestion: [],
  sinGestionRegistrado: true,
};

/**
 * UNA SOLA TIENDA: el servidor emite el campo IGUAL, con un elemento cuyas tres cifras son las
 * agregadas. El umbral es de PRESENTACIÓN y vive en la pantalla, así que aquí no se pinta nada.
 */
const UNA_TIENDA: DetalleOk = {
  ...DOS_TIENDAS,
  partesPorTienda: [
    {
      tiendaId: "t-unica",
      tiendaNombre: "Tienda Única",
      recaudado: "285275.00",
      pagoTienda: "225176.33",
      ganaLaTienda: "214328.33",
    },
  ],
};

/**
 * LA TIENDA QUE SÓLO TRAJO RECHAZOS (R9): no recaudó nada y aun así Ordenex le facturó el flete
 * por rechazo, así que GANA un negativo. Entra en el desglose y CUENTA para el umbral — es justo
 * el caso donde el desglose informa de algo que el agregado tapaba.
 *
 *   Norte      recaudó 180.000,00 · se le pagan 144.000,00 · gana 133.152,00
 *   Devuelta   recaudó       0,00 · se le pagan       0,00 · gana  −3.400,75
 *   ───────────────────────────────────────────────────────────────────────
 *   suma               180.000,00              144.000,00       129.751,25
 */
const SOLO_RECHAZOS: ParteDeTienda = {
  tiendaId: "t-dev",
  tiendaNombre: "Tienda Devuelta",
  recaudado: "0.00",
  pagoTienda: "0.00",
  ganaLaTienda: "-3400.75",
};
const CON_TIENDA_EN_NEGATIVO: DetalleOk = {
  ...DOS_TIENDAS,
  cierre: resumen({
    totales: {
      efectivo: "120000.00",
      simpe: "60000.00",
      transferencia: "0.00",
      general: "180000.00",
    },
  }),
  totalesIngreso: totalesIngreso({
    fleteConIva: "30000.00",
    comisionConIva: "6000.00",
    fleteDevolucionConIva: "14248.75",
    total: "50248.75",
  }),
  pagoTienda: "144000.00",
  cobradoSobreRecaudado: "36000.00",
  ganaLaTienda: "129751.25",
  partesPorTienda: [NORTE, SOLO_RECHAZOS],
};

const DE = "cierre de Ana Mensajera";
const particion = () => screen.getByRole("region", { name: `${CASCADA_DUENO_TITULO} · ${DE}` });
const factura = () =>
  screen.getByRole("region", { name: `${CASCADA_FACTURA_TIENDA_TITULO} · ${DE}` });
const neto = () => screen.getByRole("region", { name: `${CASCADA_NETO_ORDENEX_TITULO} · ${DE}` });
const desglose = () =>
  screen.getByRole("region", { name: `${DESGLOSE_POR_TIENDA_TITULO} · ${DE}` });
/**
 * FICHA 396 (D2) — el nombre accesible de la cascada de una tienda lleva, ADEMÁS del nombre y del
 * contexto, su POSICIÓN en el nivel: dos tiendas pueden llamarse igual —el servidor agrupa por el
 * id congelado y no las funde (R7)— y dos regiones que se anuncian igual no se pueden distinguir.
 *
 * Por eso se busca por los DOS extremos en vez de por el literal entero. No se afloja nada: sigue
 * exigiendo que empiece por el nombre de ESA tienda —con el paréntesis de la posición pegado, así
 * que «Tienda Norte» no casa con «Tienda Norte 2»— y que termine en el contexto de ESTE cierre.
 */
const nombraA = (nombre: string) => (accesible: string) =>
  accesible.startsWith(`${nombre} (`) && accesible.endsWith(` · ${DE}`);
const tienda = (nombre: string) => screen.getByRole("region", { name: nombraA(nombre) });

/** Monta la pantalla y abre el detalle del cierre. */
async function abrirDetalle(detalle: DetalleOk = DOS_TIENDAS) {
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

describe("396 — autocomprobación del lector del DOM", () => {
  it("encuentra las líneas de verdad, y falla cuando le pides una que no está", async () => {
    await abrirDetalle();

    // Si esto saliera vacío, TODAS las cuentas de abajo cerrarían sobre nada.
    expect(importesTras(tienda("Tienda Norte"), TIENDA_RECAUDADO_LABEL)).toEqual(["₡180.000"]);
    expect(() => importesTras(desglose(), "Rótulo que no existe")).toThrow();
    expect(centimos("₡133.152")).toBe(BigInt(13315200));
    expect(centimos("-₡3.400,75")).toBe(BigInt(-340075));
  });
});

describe("396 · R4 — con dos tiendas, cada una con su nombre y sus TRES cifras", () => {
  it("las dos tiendas salen, cada una en su propia región con nombre accesible", async () => {
    await abrirDetalle();

    expect(desglose()).toBeInTheDocument();
    expect(tienda("Tienda Norte")).toBeInTheDocument();
    expect(tienda("Tienda Sur")).toBeInTheDocument();
    expect(tienda("Tienda Norte")).not.toBe(tienda("Tienda Sur"));
    // El nombre visible es el de la tienda, no un identificador.
    expect(within(desglose()).getByText("Tienda Norte")).toBeInTheDocument();
    expect(within(desglose()).getByText("Tienda Sur")).toBeInTheDocument();
  });

  it("las SEIS cifras se leen tal cual, escritas a mano", async () => {
    await abrirDetalle();
    const norte = tienda("Tienda Norte");
    const sur = tienda("Tienda Sur");

    expect(importeTras(norte, TIENDA_RECAUDADO_LABEL)).toBe("₡180.000");
    expect(importeTras(norte, TIENDA_PAGO_HOY_LABEL)).toBe("₡144.000");
    expect(importeTras(norte, TIENDA_GANA_TOTAL_LABEL)).toBe("₡133.152");
    expect(importeTras(sur, TIENDA_RECAUDADO_LABEL)).toBe("₡105.275");
    expect(importeTras(sur, TIENDA_PAGO_HOY_LABEL)).toBe("₡81.176,33");
    expect(importeTras(sur, TIENDA_GANA_TOTAL_LABEL)).toBe("₡81.176,33");
  });

  it("en Norte las dos cifras de pago DIFIEREN, y en Sur coinciden: son dos preguntas", async () => {
    await abrirDetalle();

    const norte = tienda("Tienda Norte");
    // La diferencia es exactamente el flete por rechazo + IVA de ESA tienda: 10.848,00.
    laCuentaCierra(
      [importeTras(norte, TIENDA_GANA_TOTAL_LABEL), "₡10.848"],
      importeTras(norte, TIENDA_PAGO_HOY_LABEL),
      "Norte, que sí tuvo un rechazo",
    );
    // Sur no tuvo rechazos: ahí las dos cifras coinciden, y siguen siendo DOS líneas.
    const sur = tienda("Tienda Sur");
    expect(importeTras(sur, TIENDA_PAGO_HOY_LABEL)).toBe(
      importeTras(sur, TIENDA_GANA_TOTAL_LABEL),
    );
  });
});

describe("396 · R5 — TRES cifras por tienda, ni una cuarta", () => {
  it("dentro de la región de cada tienda se leen exactamente tres importes", async () => {
    await abrirDetalle();

    for (const nombre of ["Tienda Norte", "Tienda Sur"]) {
      const leidos = todosLosImportes(tienda(nombre));
      expect(
        leidos,
        `${nombre} pinta ${leidos.length} importes (${leidos.join(" ")}): R5 permite tres`,
      ).toHaveLength(3);
    }
  });
});

describe("396 · R10/R11/R12 — la suma de las partes ES el agregado, leído del DOM", () => {
  it("lo que se le paga a cada tienda suma el «Pago a tienda» del cierre", async () => {
    await abrirDetalle();

    laCuentaCierra(
      [
        importeTras(tienda("Tienda Norte"), TIENDA_PAGO_HOY_LABEL),
        importeTras(tienda("Tienda Sur"), TIENDA_PAGO_HOY_LABEL),
      ],
      importeTras(factura(), PAGO_TIENDA_LABEL),
      "lo que se le paga a cada tienda",
    );
  });

  it("lo que gana cada tienda suma el «Gana la tienda» del cierre", async () => {
    await abrirDetalle();

    laCuentaCierra(
      [
        importeTras(tienda("Tienda Norte"), TIENDA_GANA_TOTAL_LABEL),
        importeTras(tienda("Tienda Sur"), TIENDA_GANA_TOTAL_LABEL),
      ],
      importeTras(particion(), GANA_LA_TIENDA_LABEL),
      "lo que gana cada tienda",
    );
  });

  it("lo recaudado por cada tienda suma el total general del cierre", async () => {
    await abrirDetalle();

    laCuentaCierra(
      [
        importeTras(tienda("Tienda Norte"), TIENDA_RECAUDADO_LABEL),
        importeTras(tienda("Tienda Sur"), TIENDA_RECAUDADO_LABEL),
      ],
      "₡285.275",
      "lo recaudado por cada tienda",
    );
  });
});

describe("396 · R1 — la marca dice que el agregado es de VARIAS tiendas, y de cuántas", () => {
  it("está junto a «Pago a tienda» y junto a «Gana la tienda», y dice DOS", async () => {
    await abrirDetalle();

    // Escrita a mano: comparar la frase contra la función que la genera está siempre verde.
    const marca = "Es el total de las 2 tiendas de este cierre, sumadas. Abajo, cuánto le toca a cada una.";
    expect(within(factura()).getByText(marca)).toBeInTheDocument();
    expect(within(particion()).getByText(marca)).toBeInTheDocument();
    // Y la nota que la 395 puso en esa misma línea sigue ahí: la marca se AÑADE, no sustituye.
    expect(within(factura()).getByText(PAGO_TIENDA_HOY_NOTA)).toBeInTheDocument();
  });

  it("con TRES tiendas la marca dice tres, no un plural genérico", async () => {
    await abrirDetalle({
      ...DOS_TIENDAS,
      partesPorTienda: [NORTE, SUR, { ...SOLO_RECHAZOS, pagoTienda: "0.00" }],
    });

    expect(
      within(factura()).getByText(
        "Es el total de las 3 tiendas de este cierre, sumadas. Abajo, cuánto le toca a cada una.",
      ),
    ).toBeInTheDocument();
  });
});

describe("396 · R2 — con UNA sola tienda no aparece NADA nuevo", () => {
  it("ni el desglose, ni la marca, ni un rótulo por tienda", async () => {
    await abrirDetalle(UNA_TIENDA);

    expect(
      screen.queryByRole("region", { name: `${DESGLOSE_POR_TIENDA_TITULO} · ${DE}` }),
      "el desglose aparece con una sola tienda: la pantalla tenía que quedarse como estaba",
    ).toBeNull();
    expect(screen.queryByText(DESGLOSE_POR_TIENDA_TITULO)).toBeNull();
    expect(screen.queryByText(DESGLOSE_POR_TIENDA_NOTA)).toBeNull();
    expect(screen.queryByText(DESGLOSE_NO_REPARTIDO_NOTA)).toBeNull();
    expect(screen.queryByText(TIENDA_RECAUDADO_LABEL)).toBeNull();
    expect(screen.queryByText(TIENDA_PAGO_HOY_LABEL)).toBeNull();
    expect(screen.queryByText(TIENDA_GANA_TOTAL_LABEL)).toBeNull();
    expect(screen.queryByText(totalDeVariasTiendasNota(1))).toBeNull();
    // Ni siquiera se nombra a la tienda que sí viene en el DTO.
    expect(screen.queryByText("Tienda Única")).toBeNull();
  });

  it("las tres cascadas de la 395 siguen exactamente como estaban", async () => {
    await abrirDetalle(UNA_TIENDA);

    expect(importeTras(particion(), GANA_LA_TIENDA_LABEL)).toBe("₡214.328,33");
    expect(importeTras(factura(), PAGO_TIENDA_LABEL)).toBe("₡225.176,33");
    expect(within(factura()).getByText(PAGO_TIENDA_HOY_NOTA)).toBeInTheDocument();
  });
});

describe("396 · R9 — la tienda que sólo trajo rechazos entra, y cuenta", () => {
  it("aparece con recaudado en cero y lo que gana NEGATIVO, con su signo", async () => {
    await abrirDetalle(CON_TIENDA_EN_NEGATIVO);
    const devuelta = tienda("Tienda Devuelta");

    expect(importeTras(devuelta, TIENDA_RECAUDADO_LABEL)).toBe("₡0");
    expect(importeTras(devuelta, TIENDA_PAGO_HOY_LABEL)).toBe("₡0");
    const gana = importeTras(devuelta, TIENDA_GANA_TOTAL_LABEL);
    expect(gana).toBe("-₡3.400,75");
    // Ni recortado a cero ni en valor absoluto: las dos formas de mentir sobre este número.
    expect(gana).not.toBe("₡0");
    expect(gana).not.toBe("₡3.400,75");
  });

  it("el negativo va en el tono de atención, y no como un fallo de la pantalla", async () => {
    await abrirDetalle(CON_TIENDA_EN_NEGATIVO);
    const devuelta = tienda("Tienda Devuelta");

    const fila = within(devuelta)
      .getAllByText(TIENDA_GANA_TOTAL_LABEL)
      .filter((el) => el.children.length === 0)[0]
      .closest("div");
    expect(fila!.lastElementChild).toHaveClass("text-danger-strong");
    expect(within(devuelta).queryAllByRole("alert")).toEqual([]);
  });

  it("CUENTA para el umbral: sin recaudar nada, dispara el desglose igual", async () => {
    await abrirDetalle(CON_TIENDA_EN_NEGATIVO);

    expect(desglose()).toBeInTheDocument();
    expect(
      within(factura()).getByText(
        "Es el total de las 2 tiendas de este cierre, sumadas. Abajo, cuánto le toca a cada una.",
      ),
    ).toBeInTheDocument();
    // Y su negativo entra en la suma: 133.152,00 − 3.400,75 = 129.751,25.
    laCuentaCierra(
      [
        importeTras(tienda("Tienda Norte"), TIENDA_GANA_TOTAL_LABEL),
        importeTras(tienda("Tienda Devuelta"), TIENDA_GANA_TOTAL_LABEL),
      ],
      importeTras(particion(), GANA_LA_TIENDA_LABEL),
      "con una tienda en negativo",
    );
  });
});

describe("396 · C2 — los dos rótulos de pago son IMPOSIBLES de confundir", () => {
  it.each([
    ["TIENDA_RECAUDADO_LABEL", TIENDA_RECAUDADO_LABEL, "Recaudado de esta tienda"],
    ["TIENDA_PAGO_HOY_LABEL", TIENDA_PAGO_HOY_LABEL, "Se le paga hoy"],
    ["TIENDA_GANA_TOTAL_LABEL", TIENDA_GANA_TOTAL_LABEL, "Gana en total"],
    ["DESGLOSE_POR_TIENDA_TITULO", DESGLOSE_POR_TIENDA_TITULO, "De qué tienda es cada parte"],
  ])("%s dice exactamente lo aprobado", (_nombre, constante, literal) => {
    // A MANO, nunca derivado de la constante: comparar un rótulo con la función que lo genera
    // está siempre verde, y un renombrado silencioso volvería a fundir las dos preguntas.
    expect(constante).toBe(literal);
  });

  it("los cinco rótulos de dinero de esta pantalla son cinco textos distintos", () => {
    const todos = [
      TIENDA_RECAUDADO_LABEL,
      TIENDA_PAGO_HOY_LABEL,
      TIENDA_GANA_TOTAL_LABEL,
      PAGO_TIENDA_LABEL,
      GANA_LA_TIENDA_LABEL,
    ];
    expect(new Set(todos).size, `hay dos rótulos iguales: ${todos.join(" · ")}`).toBe(5);
  });

  it("la frase que separa las dos cifras de pago está en el desglose", async () => {
    await abrirDetalle();

    const nota = within(desglose()).getByText(DESGLOSE_POR_TIENDA_NOTA);
    expect(nota).toBeInTheDocument();
    // Y dice la diferencia con todas las letras, no de forma decorativa.
    expect(DESGLOSE_POR_TIENDA_NOTA).toBe(
      "«Se le paga hoy» y «Gana en total» no son la misma cifra: la diferencia es el flete por rechazo, que a la tienda se le cobra aparte, contra su saldo.",
    );
  });

  it("las dos cifras de pago SE PINTAN LAS DOS: ninguna tienda enseña una sola", async () => {
    await abrirDetalle();

    for (const nombre of ["Tienda Norte", "Tienda Sur"]) {
      const region = tienda(nombre);
      expect(importesTras(region, TIENDA_PAGO_HOY_LABEL)).toHaveLength(1);
      expect(importesTras(region, TIENDA_GANA_TOTAL_LABEL)).toHaveLength(1);
    }
  });
});

describe("396 · R17 — lo que NO está repartido, dicho mientras se enseña el desglose", () => {
  it("con dos tiendas, la nota está", async () => {
    await abrirDetalle();

    expect(within(desglose()).getByText(DESGLOSE_NO_REPARTIDO_NOTA)).toBeInTheDocument();
    expect(DESGLOSE_NO_REPARTIDO_NOTA).toBe(
      "El pago al mensajero y el ingreso de bodega por rechazos son del cierre completo: no están repartidos entre las tiendas.",
    );
  });

  it("y esos dos importes siguen agregados, en la cascada de Ordenex (R16)", async () => {
    await abrirDetalle();

    // Ni el pago al mensajero ni el ingreso de bodega aparecen dentro de ninguna tienda.
    for (const nombre of ["Tienda Norte", "Tienda Sur"]) {
      expect(todosLosImportes(tienda(nombre))).not.toContain("₡45.000,55");
      expect(todosLosImportes(tienda(nombre))).not.toContain("₡1.200,25");
    }
    expect(todosLosImportes(neto())).toContain("-₡45.000,55");
  });
});

describe("396 · R8 — la pantalla pinta en el orden que le llega, y no reordena", () => {
  it("un desglose que llega de menor a mayor se pinta de menor a mayor", async () => {
    // Fixtura DELIBERADAMENTE al revés del criterio del servidor. La pantalla no sabe nada de
    // importes: si aquí saliera Norte primero, es que alguien metió un `sort` en el navegador.
    await abrirDetalle({ ...DOS_TIENDAS, partesPorTienda: [SUR, NORTE] });

    expect(vaAntes(tienda("Tienda Sur"), tienda("Tienda Norte"))).toBe(true);
  });

  it("y el orden normal del servidor —de mayor a menor— se respeta igual", async () => {
    await abrirDetalle();

    expect(vaAntes(tienda("Tienda Norte"), tienda("Tienda Sur"))).toBe(true);
  });
});

describe("396 — dos tiendas HOMÓNIMAS no se funden en una", () => {
  it("salen dos cascadas, cada una con su propio dinero", async () => {
    await abrirDetalle({
      ...DOS_TIENDAS,
      partesPorTienda: [
        { ...NORTE, tiendaId: "t-uno", tiendaNombre: "Mi Tienda" },
        { ...SUR, tiendaId: "t-dos", tiendaNombre: "Mi Tienda" },
      ],
    });

    const regiones = screen.getAllByRole("region", { name: nombraA("Mi Tienda") });
    expect(regiones, "dos tiendas con el mismo nombre se fundieron en una").toHaveLength(2);
    expect(importeTras(regiones[0], TIENDA_PAGO_HOY_LABEL)).toBe("₡144.000");
    expect(importeTras(regiones[1], TIENDA_PAGO_HOY_LABEL)).toBe("₡81.176,33");
  });

  it("y NO comparten nombre accesible: se pueden nombrar por separado", async () => {
    // FICHA 396 (D2) — corrige la decisión de la tanda C, que las dejaba con el mismo nombre
    // «porque también se ven igual». Quien navega por landmarks NO las ve: oye dos veces «Mi
    // Tienda» y no tiene forma de saber cuál trae ₡144.000. Escrito a mano, nunca derivado de la
    // función que lo genera.
    await abrirDetalle({
      ...DOS_TIENDAS,
      partesPorTienda: [
        { ...NORTE, tiendaId: "t-uno", tiendaNombre: "Mi Tienda" },
        { ...SUR, tiendaId: "t-dos", tiendaNombre: "Mi Tienda" },
      ],
    });

    const nombres = screen
      .getAllByRole("region", { name: nombraA("Mi Tienda") })
      .map((region) => region.getAttribute("aria-label"));
    expect(nombres).toEqual([
      "Mi Tienda (1 de 2) · cierre de Ana Mensajera",
      "Mi Tienda (2 de 2) · cierre de Ana Mensajera",
    ]);
    expect(new Set(nombres).size, `las dos se anuncian igual: ${nombres.join(" · ")}`).toBe(2);
  });
});

describe("396 — el sitio del desglose en la pantalla", () => {
  it("va DESPUÉS de la cascada que termina en «Pago a tienda» y ANTES de la de Ordenex", async () => {
    await abrirDetalle();

    // Primero de quién es el dinero y cuánto se le paga; sólo después, de qué tienda es cada
    // parte. Si el desglose fuera antes, la pantalla empezaría por el detalle en vez de por la
    // cuenta que cierra.
    expect(vaAntes(particion(), desglose())).toBe(true);
    expect(vaAntes(factura(), desglose())).toBe(true);
    expect(vaAntes(desglose(), neto())).toBe(true);
  });
});

describe("396 · R26 — la vista del MENSAJERO no cambia", () => {
  it("`CierreDiaModule` no monta las cascadas ni nombra un solo rótulo del desglose", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const { quitarComentarios } = await import("@/tests/fixtures/sin-comentarios");

    const ruta = "app/(app)/cierre-dia/_components/CierreDiaModule.tsx";
    const codigo = quitarComentarios(
      readFileSync(path.resolve(__dirname, "../..", ruta), "utf8"),
    );
    expect(codigo.length, `${ruta} salió vacío: el censo no está leyendo nada`).toBeGreaterThan(
      500,
    );
    // El mensajero comparte el comprobante con el admin, pero no las cascadas de dinero de la
    // empresa: el desglose por tienda vive en `CascadasCierreMensajero`, que ese módulo no monta.
    for (const prohibido of [
      "CascadasCierreMensajero",
      // FICHA 396 (D2) — desde la tanda de bodega el desglose es un archivo propio: si un día
      // alguien lo montara aquí directamente, el nombre del componente lo delata igual.
      "DesglosePorTienda",
      "partesPorTienda",
      "DESGLOSE_POR_TIENDA",
      "DESGLOSE_NO_REPARTIDO",
      "TIENDA_PAGO_HOY_LABEL",
      "TIENDA_GANA_TOTAL_LABEL",
      "TIENDA_RECAUDADO_LABEL",
      "totalDeVariasTiendasNota",
    ]) {
      expect(codigo, `${ruta} nombra «${prohibido}»: eso es el desglose en la vista del mensajero`)
        .not.toContain(prohibido);
    }
  });
});

describe("396 — money-safe: la pantalla no hace aritmética de dinero", () => {
  const FUENTES = [
    "app/(app)/cierres-admin/_components/CascadasCierreMensajero.tsx",
    // FICHA 396 (D2) — el desglose salió a su propio archivo al compartirse con las dos
    // superficies de bodega. La guardia lo sigue: si no, el código que pinta las tres cifras de
    // cada tienda se habría quedado sin vigilar justo al mudarse de casa.
    "app/(app)/cierres-admin/_components/DesglosePorTienda.tsx",
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

  it("el componente tampoco ORDENA el desglose: eso lo hizo el servidor", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const { quitarComentarios } = await import("@/tests/fixtures/sin-comentarios");

    const codigo = quitarComentarios(
      // FICHA 396 (D2) — el archivo que hoy pinta el desglose. Antes era
      // `CascadasCierreMensajero.tsx`; al mudarse, la guardia se muda con él o deja de mirar.
      readFileSync(
        path.resolve(
          __dirname,
          "../..",
          "app/(app)/cierres-admin/_components/DesglosePorTienda.tsx",
        ),
        "utf8",
      ),
    );
    // Ordenar en el navegador exige comparar importes, y comparar importes en el navegador es
    // exactamente lo que R14 prohíbe. El orden llega hecho (R8).
    for (const prohibida of [/\.sort\s*\(/, /\.reverse\s*\(/, /localeCompare\s*\(/]) {
      expect(codigo, `el componente usa ${prohibida.source} sobre el desglose`).not.toMatch(
        prohibida,
      );
    }
  });
});
