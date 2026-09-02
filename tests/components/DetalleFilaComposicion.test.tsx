// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

const detalleMock = vi.fn();
vi.mock("@/lib/actions/wallet", () => ({
  listarMovimientosDeFilaAction: (...a: unknown[]) => detalleMock(...a),
}));

import { ComposicionGananciaCard } from "@/app/(app)/wallet/_components/ComposicionGananciaCard";
import {
  FILTROS_VACIOS,
  type WalletFiltrosValue,
} from "@/app/(app)/wallet/_components/WalletFiltros";
import type {
  CajaResumenDTO,
  ComposicionGananciaDTO,
  DesgloseEgresosDTO,
  WalletMovimientoDTO,
} from "@/lib/types/wallet";
import {
  LLAMADAS_PROHIBIDAS_EN_DINERO,
  codigoSinComentarios,
} from "@/tests/fixtures/money-safe";

/**
 * Ficha 339 (B5) — ABRIR UNA FILA DE LA TARJETA DE LA GANANCIA Y VER LO QUE HAY DENTRO.
 *
 * Cubre R15, R16, R17, R21–R26, R28, R35 y R36, más la mitad de pantalla de R29 y de R31 (la
 * otra mitad, la del `WHERE` y la del `total` que cuenta la base, se mide contra Postgres en
 * `tests/integration/db/composicion-detalle-postgres.test.ts`).
 *
 * SE MIDE DESDE LA TARJETA COMPLETA y no montando el panel suelto. Es deliberado: tres de los
 * requisitos —«cerrada no lee nada», «abrir cuesta UNA lectura» y «dos filas abiertas no se
 * pisan»— son propiedades del CONJUNTO de catorce filas, y un test que montara un solo panel no
 * podría afirmarlas. Además así el caso del fallo (R26) puede comprobar lo que de verdad
 * importa: que la tarjeta entera siga en pie.
 */

const DESGLOSE: DesgloseEgresosDTO = {
  gastoFijo: "300.00",
  gastoVariable: "125.50",
  sueldo: "800.00",
  indemnizacion: "25.25",
  total: "1250.75",
};

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
  egresos: {
    egreso_pago_mensajero: "700.00",
    egreso_ajuste: "45.75",
  },
  otrosEgresos: "194.25",
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
  ganancia: "3519.00",
  signoGanancia: "positivo",
  deTerceros: "12290.25",
  periodoFiltrado: false,
  porcentajeTiendas: "77.74",
  modoComposicion: "dos_bolsillos",
};

/** Nombres accesibles de los controles que abren cada fila (R24). */
const ABRIR_MENSAJEROS = "Ver los movimientos de Pagos a mensajeros";
const ABRIR_AJUSTES = "Ver los movimientos de Ajustes (egreso)";
const ABRIR_OTROS = "Ver los movimientos de Otros gastos de Ordenex";
const ABRIR_FLETE = "Ver los movimientos de Flete";

/** Nombres accesibles de los paneles desplegados. */
const PANEL_MENSAJEROS = "Movimientos de Pagos a mensajeros";
const PANEL_AJUSTES = "Movimientos de Ajustes (egreso)";
const PANEL_OTROS = "Movimientos de Otros gastos de Ordenex";

function movimiento(over: Partial<WalletMovimientoDTO> = {}): WalletMovimientoDTO {
  return {
    id: "mov-1",
    tipo: "egreso",
    categoria: "egreso_pago_mensajero",
    monto: "3333.33",
    origenTipo: "pago_mensajero",
    origenId: "pago-1",
    // Medido en producción: los pagos a mensajeros se escriben SIN descripción (R17).
    descripcion: null,
    registradoPor: null,
    fechaMovimiento: "2026-08-14T10:00:00.000Z",
    dueno: "propio",
    ...over,
  };
}

/** Respuesta `ok` del borde, con el `total` y el `pageSize` que decide el SERVIDOR. */
function pagina(
  movimientos: WalletMovimientoDTO[],
  total: number,
  page = 1,
  pageSize = 10,
) {
  return { status: "ok" as const, data: { movimientos, total, page, pageSize } };
}

function envolver(nodo: ReactElement) {
  // Caché SWR NUEVA por render: sin esto, el resultado de un caso alimentaría al siguiente y
  // «abrir cuesta una lectura» pasaría en verde sin haber leído nada.
  return render(
    <SWRConfig
      value={{
        provider: () => new Map(),
        revalidateOnFocus: false,
        revalidateOnReconnect: false,
      }}
    >
      {nodo}
    </SWRConfig>,
  );
}

function pintar(filtros: WalletFiltrosValue = FILTROS_VACIOS) {
  return envolver(
    <ComposicionGananciaCard
      desglose={DESGLOSE}
      composicion={COMPOSICION}
      resumen={RESUMEN}
      filtros={filtros}
    />,
  );
}

function abrir(nombre: string) {
  return userEvent.click(screen.getByRole("button", { name: nombre }));
}

function panel(nombre: string): HTMLElement {
  return screen.getByRole("region", { name: nombre });
}

/** El input con el que la pantalla pidió la lectura número `n` (0-based). */
function inputDeLlamada(n: number): Record<string, unknown> {
  return detalleMock.mock.calls[n][0] as Record<string, unknown>;
}

beforeEach(() => {
  detalleMock.mockReset();
  detalleMock.mockResolvedValue(pagina([movimiento()], 1));
});

afterEach(() => {
  cleanup();
});

describe("Ficha 339 — abrir una fila (R15/R21/R22)", () => {
  it("R21: con las filas cerradas no se lee nada", async () => {
    pintar();

    // La tarjeta está pintada entera —sus dos columnas y su pie— y no ha costado ni una
    // lectura de detalle. Con catorce filas montando su `useSWR` al pintar, serían catorce.
    expect(screen.getByText("Total de egresos")).toBeInTheDocument();
    expect(detalleMock).not.toHaveBeenCalled();

    // CONTROL DE NO-VACUIDAD: el lector está cableado de verdad; lo que no ha ocurrido es la
    // lectura, no el cableado. Sin esta línea, un componente que no llamara NUNCA al borde
    // dejaría el caso de arriba en verde.
    await abrir(ABRIR_MENSAJEROS);
    await waitFor(() => expect(detalleMock).toHaveBeenCalledTimes(1));
  });

  it("R22: abrir una fila cuesta exactamente UNA lectura, y sólo de esa fila", async () => {
    pintar();

    await abrir(ABRIR_MENSAJEROS);
    await screen.findByRole("region", { name: PANEL_MENSAJEROS });

    expect(detalleMock).toHaveBeenCalledTimes(1);
    expect(inputDeLlamada(0)).toEqual({ fila: "egreso_pago_mensajero", page: 1 });
  });

  it("R15: al abrir una fila se muestran los movimientos que componen su importe", async () => {
    detalleMock.mockResolvedValue(
      pagina(
        [
          movimiento({ id: "m-1", monto: "3333.33" }),
          movimiento({ id: "m-2", monto: "1111.11" }),
        ],
        2,
      ),
    );
    pintar();

    await abrir(ABRIR_MENSAJEROS);

    const dentro = within(await screen.findByRole("region", { name: PANEL_MENSAJEROS }));
    expect(await dentro.findByText("₡3.333,33")).toBeInTheDocument();
    expect(dentro.getByText("₡1.111,11")).toBeInTheDocument();
  });

  it("R23: dos filas abiertas mantienen páginas independientes", async () => {
    detalleMock.mockImplementation(async (input: Record<string, unknown>) => {
      const fila = String(input.fila);
      const page = Number(input.page);
      return pagina([movimiento({ id: `${fila}-p${page}` })], 12, page, 10);
    });
    pintar();

    await abrir(ABRIR_MENSAJEROS);
    await screen.findByRole("region", { name: PANEL_MENSAJEROS });
    await abrir(ABRIR_AJUSTES);
    await screen.findByRole("region", { name: PANEL_AJUSTES });

    // Dos lecturas, una por fila: ninguna se llevó por delante a la otra.
    await waitFor(() => expect(detalleMock).toHaveBeenCalledTimes(2));
    expect(detalleMock.mock.calls.map((c) => (c[0] as { fila: string }).fila)).toEqual([
      "egreso_pago_mensajero",
      "egreso_ajuste",
    ]);

    // Se avanza de página SOLO en la primera.
    const mensajeros = within(panel(PANEL_MENSAJEROS));
    await userEvent.click(mensajeros.getByRole("button", { name: "Página siguiente" }));

    await waitFor(() => expect(detalleMock).toHaveBeenCalledTimes(3));
    expect(inputDeLlamada(2)).toEqual({ fila: "egreso_pago_mensajero", page: 2 });

    // Y la otra sigue donde estaba: su barra dice la primera página, no la segunda.
    await waitFor(() =>
      expect(within(panel(PANEL_MENSAJEROS)).getByText("11-12 de 12")).toBeInTheDocument(),
    );
    expect(within(panel(PANEL_AJUSTES)).getByText("1-10 de 12")).toBeInTheDocument();
  });
});

describe("Ficha 339 — lo que enseña cada movimiento (R16/R17/R36)", () => {
  it("R16: cada movimiento muestra fecha, concepto, detalle e importe", async () => {
    detalleMock.mockResolvedValue(
      pagina(
        [
          movimiento({
            id: "m-1",
            categoria: "egreso_ajuste",
            origenTipo: "manual",
            descripcion: "Faltante al cuadrar la caja",
            monto: "45.75",
            fechaMovimiento: "2026-08-14T10:00:00.000Z",
          }),
        ],
        1,
      ),
    );
    pintar();

    await abrir(ABRIR_AJUSTES);
    const dentro = within(await screen.findByRole("region", { name: PANEL_AJUSTES }));

    // Las cuatro cabeceras, en su sitio.
    for (const columna of ["Fecha", "Concepto", "Detalle", "Importe"]) {
      expect(dentro.getByRole("columnheader", { name: columna })).toBeInTheDocument();
    }

    expect(await dentro.findByText("2026-08-14")).toBeInTheDocument();
    // R5 también aquí: la etiqueta legible del catálogo, nunca el valor del enum.
    expect(dentro.getByText("Ajuste (egreso)")).toBeInTheDocument();
    expect(dentro.getByText(/Faltante al cuadrar la caja/)).toBeInTheDocument();
    expect(dentro.getByText("₡45,75")).toBeInTheDocument();
    expect(dentro.queryByText("egreso_ajuste")).toBeNull();
  });

  it("R17: un movimiento sin descripción muestra su origen legible", async () => {
    // Los nueve pagos a mensajeros de producción llegan con `descripcion: null`. Una columna
    // que sólo mostrara la descripción enseñaría NUEVE RENGLONES EN BLANCO justo en la fila que
    // más falta hace abrir.
    detalleMock.mockResolvedValue(
      pagina([movimiento({ id: "m-1", descripcion: null, origenTipo: "pago_mensajero" })], 1),
    );
    pintar();

    await abrir(ABRIR_MENSAJEROS);
    const dentro = within(await screen.findByRole("region", { name: PANEL_MENSAJEROS }));

    const celdas = await dentro.findAllByRole("cell");
    const textos = celdas.map((c) => (c.textContent ?? "").trim());
    // Ninguna celda muda, y la del detalle dice de dónde viene el movimiento.
    expect(textos).toContain("Pago a mensajero");
    expect(textos.filter((t) => t === "")).toEqual([]);
  });

  it("R36: el detalle no pinta ningún subtotal de la página visible", async () => {
    detalleMock.mockResolvedValue(
      pagina(
        [
          movimiento({ id: "m-1", monto: "3333.33" }),
          movimiento({ id: "m-2", monto: "1111.11" }),
        ],
        2,
      ),
    );
    pintar();

    await abrir(ABRIR_MENSAJEROS);
    const region = await screen.findByRole("region", { name: PANEL_MENSAJEROS });
    const dentro = within(region);
    await dentro.findByText("₡3.333,33");

    // Ni la palabra, ni la cifra: dentro del panel hay EXACTAMENTE tantos importes como
    // movimientos. Un subtotal de página al lado del importe de la fila es una invitación a
    // restarlos, y restar es lo único que el navegador tiene prohibido con dinero.
    expect(dentro.queryByText(/subtotal|total de la p[áa]gina/i)).toBeNull();
    const importes = [...region.querySelectorAll("td")]
      .map((c) => (c.textContent ?? "").trim())
      .filter((t) => t.startsWith("₡"));
    expect(importes).toEqual(["₡3.333,33", "₡1.111,11"]);
  });
});

describe("Ficha 339 — el nombre de cada control y sus estados (R24/R25/R26)", () => {
  it("R24: el control de abrir nombra SU fila, y no hay dos que se llamen igual", () => {
    pintar();

    const controles = screen.getAllByRole("button", { name: /^Ver los movimientos de / });
    // Las catorce filas del catálogo: 7 de ingreso + 6 de egreso + «Otros», que aquí se pinta.
    expect(controles).toHaveLength(14);

    const nombres = controles.map((b) => b.getAttribute("aria-label") ?? "");
    expect(new Set(nombres).size).toBe(14);
    // Y cada nombre CONTIENE el rótulo visible de su fila («Label in Name»).
    expect(nombres).toContain(ABRIR_MENSAJEROS);
    expect(nombres).toContain(ABRIR_AJUSTES);
    expect(nombres).toContain(ABRIR_OTROS);
    expect(nombres).toContain(ABRIR_FLETE);
    // Ninguno es el genérico repetido que R24 prohíbe.
    for (const nombre of nombres) expect(nombre).not.toBe("Ver detalle");
  });

  it("el disclosure anuncia su estado: cerrado, abierto, y qué panel controla", async () => {
    pintar();

    const boton = screen.getByRole("button", { name: ABRIR_MENSAJEROS });
    expect(boton).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(boton);
    expect(boton).toHaveAttribute("aria-expanded", "true");

    const controlado = boton.getAttribute("aria-controls") ?? "";
    expect(controlado).not.toBe("");
    const region = await screen.findByRole("region", { name: PANEL_MENSAJEROS });
    expect(region.id).toBe(controlado);

    // Y se vuelve a cerrar: el panel deja el DOM (R21 sigue valiendo tras abrir y cerrar).
    await userEvent.click(boton);
    expect(boton).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("region", { name: PANEL_MENSAJEROS })).toBeNull();
  });

  it("R25: una fila sin movimientos muestra su estado vacío", async () => {
    detalleMock.mockResolvedValue(pagina([], 0));
    pintar();

    await abrir(ABRIR_OTROS);
    const dentro = within(await screen.findByRole("region", { name: PANEL_OTROS }));

    expect(
      await dentro.findByText(/no hay movimientos de este concepto/i),
    ).toBeInTheDocument();
    // Y la barra no promete páginas que no existen.
    expect(dentro.getByText("Sin resultados")).toBeInTheDocument();
  });

  it("R26: un fallo de lectura se cuenta DENTRO de la fila y la tarjeta sigue en pie", async () => {
    detalleMock.mockResolvedValue({ status: "forbidden" });
    pintar();

    await abrir(ABRIR_MENSAJEROS);
    const dentro = within(await screen.findByRole("region", { name: PANEL_MENSAJEROS }));

    const aviso = await dentro.findByRole("alert");
    expect(aviso.textContent ?? "").toMatch(/no se pudieron cargar los movimientos/i);
    // Ninguna rama de error viaja con movimientos: la tabla no pinta ni una fila de datos.
    expect(dentro.queryByText("₡3.333,33")).toBeNull();

    // Y el resto de la tarjeta —que es lo que la persona vino a leer— sigue completo.
    expect(screen.getByText("Total de egresos")).toBeInTheDocument();
    expect(screen.getByText("₡2.190,75")).toBeInTheDocument();
    expect(screen.getByText("Ganancia de Ordenex")).toBeInTheDocument();
  });
});

describe("Ficha 339 — el detalle pagina y el total lo da el servidor (R28/R31/R29)", () => {
  it("R28: con más movimientos que la página se puede navegar a la siguiente", async () => {
    detalleMock.mockImplementation(async (input: Record<string, unknown>) =>
      pagina([movimiento({ id: `p${String(input.page)}` })], 12, Number(input.page), 10),
    );
    pintar();

    await abrir(ABRIR_MENSAJEROS);
    const dentro = within(await screen.findByRole("region", { name: PANEL_MENSAJEROS }));

    const siguiente = await dentro.findByRole("button", { name: "Página siguiente" });
    expect(siguiente).toBeEnabled();
    await userEvent.click(siguiente);

    await waitFor(() => expect(detalleMock).toHaveBeenCalledTimes(2));
    expect(inputDeLlamada(1)).toEqual({ fila: "egreso_pago_mensajero", page: 2 });
  });

  it("R31: el total que pagina es el del SERVIDOR, no el largo de la página pintada", async () => {
    // TRES movimientos en la página y DOCE en el conjunto. Si la pantalla usara el largo de lo
    // que pinta, la barra diría «1-3 de 3» y el botón de siguiente estaría deshabilitado: nadie
    // podría llegar nunca a los otros nueve.
    detalleMock.mockResolvedValue(
      pagina(
        [
          movimiento({ id: "m-1" }),
          movimiento({ id: "m-2" }),
          movimiento({ id: "m-3" }),
        ],
        12,
      ),
    );
    pintar();

    await abrir(ABRIR_MENSAJEROS);
    const dentro = within(await screen.findByRole("region", { name: PANEL_MENSAJEROS }));

    expect(await dentro.findByText("1-10 de 12")).toBeInTheDocument();
    expect(dentro.queryByText("1-3 de 3")).toBeNull();
    expect(dentro.getByRole("button", { name: "Página siguiente" })).toBeEnabled();
  });

  it("R29: el tamaño de página lo manda la CONFIGURACIÓN, y la pantalla no lo escribe", async () => {
    // El servidor responde con un `pageSize` de 3 —el que le da su configuración— y la barra lo
    // OBEDECE: «1-3 de 7», tres páginas. Con un literal de pantalla diría «1-7 de 7» y no
    // habría segunda página.
    detalleMock.mockResolvedValue(
      pagina([movimiento({ id: "m-1" }), movimiento({ id: "m-2" }), movimiento({ id: "m-3" })], 7, 1, 3),
    );
    pintar();

    await abrir(ABRIR_MENSAJEROS);
    const dentro = within(await screen.findByRole("region", { name: PANEL_MENSAJEROS }));
    expect(await dentro.findByText("1-3 de 7")).toBeInTheDocument();

    // Y la fuente no declara ninguno de los dos números: los toma de la configuración.
    const fuente = codigoSinComentarios(
      "app/(app)/wallet/_components/DetalleFilaComposicion.tsx",
    );
    expect(fuente).toMatch(/composicionDetalleConfig/);
    expect(fuente, "el tamaño de página está escrito como literal").not.toMatch(
      /pageSize\s*[:=]\s*\d/,
    );
  });
});

describe("Ficha 339 — el cliente manda un TOKEN, nunca categorías (design §10-A1)", () => {
  it("el input de una fila es su token y su página, y ninguna lista de categorías", async () => {
    pintar();

    await abrir(ABRIR_OTROS);
    await screen.findByRole("region", { name: PANEL_OTROS });

    // «Otros» es un COMPLEMENTO, y es justo la fila que tentaría a resolverlo en el navegador.
    // El input es EXACTAMENTE el token y la página: no hay por dónde colar el conjunto.
    const input = inputDeLlamada(0);
    expect(input).toEqual({ fila: "otros_egresos", page: 1 });
    expect(Object.keys(input)).not.toContain("categorias");
  });

  it("R20: los filtros vigentes de la wallet bajan al detalle, y sólo ellos", async () => {
    const filtros: WalletFiltrosValue = {
      tipo: "egreso",
      categoria: "egreso_pago_mensajero",
      desde: "2026-08-01",
      hasta: "2026-08-31",
    };
    pintar(filtros);

    await abrir(ABRIR_MENSAJEROS);
    await screen.findByRole("region", { name: PANEL_MENSAJEROS });

    const input = inputDeLlamada(0);
    expect(input).toEqual({
      tipo: "egreso",
      categoria: "egreso_pago_mensajero",
      desde: "2026-08-01",
      hasta: "2026-08-31",
      fila: "egreso_pago_mensajero",
      page: 1,
    });
    // `categoria` (el filtro del usuario, singular) SÍ; `categorias` (el conjunto de la fila,
    // plural) NO: ése lo deriva el servidor con la misma definición que produce el importe.
    expect(Object.keys(input)).not.toContain("categorias");
  });
});

describe("Ficha 339 — money-safe en el navegador (R35)", () => {
  it("R35: ninguna fuente nueva de la tarjeta ni del detalle opera con dinero", () => {
    const fuentes = [
      "app/(app)/wallet/_components/DetalleFilaComposicion.tsx",
      "app/(app)/wallet/_components/FilaComposicion.tsx",
      "app/(app)/wallet/_components/composicion-detalle-labels.ts",
    ];
    // Control de no-vacuidad: el barrido mira archivos que existen y tienen código.
    expect(fuentes).toHaveLength(3);

    for (const ruta of fuentes) {
      const fuente = codigoSinComentarios(ruta);
      expect(fuente.length, `${ruta} está vacío`).toBeGreaterThan(300);
      for (const prohibida of LLAMADAS_PROHIBIDAS_EN_DINERO) {
        expect(fuente, `${ruta} llama a ${prohibida}`).not.toMatch(prohibida);
      }
      expect(fuente, `${ruta} importa una biblioteca de decimales`).not.toMatch(
        /from\s+"@prisma\/client"|from\s+"decimal\.js"/,
      );
      // Y no suma la página: ni un `reduce`, ni un acumulador de importes.
      expect(fuente, `${ruta} acumula importes`).not.toMatch(/\.reduce\s*\(/);
    }
  });
});

/**
 * Ficha 339 (arreglo movil, 2026-08-31) — LA FORMA DE LA TABLA EN UN TELEFONO.
 *
 * EXISTE PORQUE SIN ESTO EL JUEGO DE COLUMNAS DE MOVIL ES CODIGO MUERTO PARA LA SUITE. El
 * polyfill de `matchMedia` de `tests/setup/jest-dom.ts` devuelve siempre `matches: false`, o
 * sea escritorio, asi que los 30 casos de arriba pintan las CUATRO columnas y ninguno llega a
 * pisar `COLUMNS_MOVIL`. Borrarlo entero dejaria la suite en verde.
 *
 * QUE SE AFIRMA, y por que estos literales no son un espejo de la fuente: `₡1.700`, `₡3.400` y
 * `₡10.200` son lo que un humano LEYO en Chromium a 390x844 el 2026-08-31 con el defecto
 * delante —la pantalla decia `₡1.70` y `₡10.20`, dos numeros distintos y creibles— y son el
 * contrato de esta ficha, no una copia de `money`.
 *
 * ⚠️ ENMIENDA DE LA FICHA 359 — AQUI HABIA UNA PROMESA FALSA, Y SE MIDIO. Esta prosa decia:
 * «si alguien vuelve a meter `truncate`, `line-clamp` o una abreviatura de miles en la celda
 * del importe, estos tres caen». NO CAEN. Se aplico la mutacion —cambiar `whitespace-nowrap`
 * por `truncate` en `ImporteCelda`— y los 50 casos de este archivo y de
 * `ComposicionGananciaCard` pasaron EN VERDE: en jsdom `truncate` no toca el `textContent`, y
 * lo que estos tres casos leen es texto. La promesa se cumple desde ahora con el caso
 * ESTRUCTURAL del final del bloque, que si mira las clases.
 *
 * Lo que ESTE test no puede ver, y por eso hay medicion en navegador en `progress/impl_343.md`
 * y en `progress/impl_359.md` §7: jsdom no hace layout, asi que aqui no existen ni el ancho del
 * panel, ni el desborde, ni las flechas de scroll de la `DataTable`. Este caso afirma QUE
 * COLUMNAS se piden y QUE TEXTO sale entero; que ademas quepan se mide en Chromium.
 */
describe("Ficha 339 — el detalle en un teléfono (arreglo móvil)", () => {
  const matchMediaOriginal = window.matchMedia;

  /** Un `matchMedia` que dice «sí» a la consulta de `useIsMobile` (`max-width: 767px`). */
  function fingirTelefono() {
    window.matchMedia = ((consulta: string) =>
      ({
        matches: /max-width:\s*767px/.test(consulta),
        media: consulta,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList) as typeof window.matchMedia;
  }

  afterEach(() => {
    window.matchMedia = matchMediaOriginal;
  });

  it("en móvil la tabla tiene DOS columnas: «Movimiento» e «Importe»", async () => {
    fingirTelefono();
    pintar();

    await abrir(ABRIR_MENSAJEROS);
    const dentro = within(await screen.findByRole("region", { name: PANEL_MENSAJEROS }));

    const cabeceras = (await dentro.findAllByRole("columnheader")).map((th) =>
      th.textContent?.trim(),
    );
    expect(cabeceras).toEqual(["Movimiento", "Importe"]);
  });

  it("el importe se lee ENTERO: `₡1.700`, `₡3.400` y `₡10.200`, sin recortar ni abreviar", async () => {
    fingirTelefono();
    // Los tres importes que se midieron en pantalla, con la escala 2 que cruza la frontera.
    detalleMock.mockResolvedValue(
      pagina(
        [
          movimiento({ id: "m-1", monto: "1700.00" }),
          movimiento({ id: "m-2", monto: "3400.00" }),
          movimiento({ id: "m-3", monto: "10200.00" }),
        ],
        3,
      ),
    );
    pintar();

    await abrir(ABRIR_MENSAJEROS);
    const region = await screen.findByRole("region", { name: PANEL_MENSAJEROS });
    const dentro = within(region);

    // La celda entera, no un `getByText` que pasaria con una subcadena.
    await dentro.findByText("₡1.700");
    const importes = [...region.querySelectorAll("tbody tr")].map((tr) =>
      tr.querySelectorAll("td")[1]?.textContent?.trim(),
    );
    expect(importes).toEqual(["₡1.700", "₡3.400", "₡10.200"]);

    // Y NINGUNO de los números a medias que se leian en pantalla con el defecto.
    expect(dentro.queryByText("₡1.70")).toBeNull();
    expect(dentro.queryByText("₡10.20")).toBeNull();
  });

  it("apilar tres columnas en una no esconde ningún dato (R5/R16/R17)", async () => {
    fingirTelefono();
    detalleMock.mockResolvedValue(
      pagina(
        [
          movimiento({
            id: "m-1",
            categoria: "egreso_ajuste",
            origenTipo: "manual",
            descripcion: "Faltante al cuadrar la caja",
            fechaMovimiento: "2026-08-14T10:00:00.000Z",
            monto: "46.00",
          }),
        ],
        1,
      ),
    );
    pintar();

    await abrir(ABRIR_MENSAJEROS);
    const dentro = within(await screen.findByRole("region", { name: PANEL_MENSAJEROS }));

    // Fecha, concepto y detalle siguen en pantalla: viajan juntos, no desaparecen.
    expect(await dentro.findByText("2026-08-14")).toBeInTheDocument();
    // R5: la etiqueta legible del catálogo, nunca el valor del enum.
    expect(dentro.getByText("Ajuste (egreso)")).toBeInTheDocument();
    expect(dentro.queryByText("egreso_ajuste")).toBeNull();
    // R17: el origen legible y su descripción.
    expect(dentro.getByText(/Faltante al cuadrar la caja/)).toBeInTheDocument();
    expect(dentro.getByText("₡46")).toBeInTheDocument();
  });

  it("en escritorio NO cambia nada: las cuatro columnas de siempre", async () => {
    // El mismo montaje sin fingir teléfono. Es el control de no-vacuidad de los tres de arriba:
    // si `useIsMobile` dejara de mirar la consulta, este caso y el primero no podrían pasar a la vez.
    pintar();

    await abrir(ABRIR_MENSAJEROS);
    const dentro = within(await screen.findByRole("region", { name: PANEL_MENSAJEROS }));

    const cabeceras = (await dentro.findAllByRole("columnheader")).map((th) =>
      th.textContent?.trim(),
    );
    expect(cabeceras).toEqual(["Fecha", "Concepto", "Detalle", "Importe"]);
  });

  /**
   * FICHA 359 — LA CELDA DEL IMPORTE NO PUEDE RECORTAR, y esto SÍ lo mide.
   *
   * Es el caso que cumple la promesa que la prosa de este bloque llevaba haciendo en falso.
   * Se mira el FUENTE y no el DOM porque el defecto es de LAYOUT y jsdom no hace layout: en
   * jsdom, `truncate` (`overflow:hidden` + `text-overflow:ellipsis` + `white-space:nowrap`)
   * deja el `textContent` intacto y los tres casos de arriba en verde. Medido, no supuesto.
   *
   * Las dos clases que se vigilan son EXACTAMENTE las que la ficha 339 identificó como las que
   * sostienen el arreglo, y por eso se afirman por separado:
   *
   *  - `whitespace-nowrap` en la celda del importe: es lo que impide que la cifra se parta por
   *    la mitad y lo que hace que la columna EMPUJE en vez de encogerse. Sin ella, el número no
   *    se ve roto: se ve como OTRO número.
   *  - `wrap-anywhere` en la celda de texto: es lo que le permite encoger, y es la razón por la
   *    que la tabla móvil cabe. La 339 midió que con `nowrap` en la fecha el desborde empeoraba
   *    24 px, así que esta clase es la que compra el sitio del importe.
   *
   * Y ninguna abreviatura: `truncate`, `line-clamp`, `text-ellipsis` ni `overflow-hidden` en el
   * fuente. La misma prohibición que ya está escrita en `cierre-factura.tsx` («un número a
   * medias es un número FALSO, peor que uno que se sale»).
   */
  it("FICHA 359 — la celda del importe no puede recortar ni abreviar (mide las CLASES)", () => {
    const fuente = codigoSinComentarios(
      "app/(app)/wallet/_components/DetalleFilaComposicion.tsx",
    );

    // El `<span>` del importe, aislado: sin esto la aserción pasaría por el
    // `whitespace-nowrap` de la FECHA, que es otra celda y otro oficio.
    const celdaImporte = /function ImporteCelda[\s\S]*?\n}/.exec(fuente)?.[0] ?? "";
    expect(celdaImporte, "`ImporteCelda` desapareció o cambió de forma").toContain("money(monto)");
    expect(
      celdaImporte,
      "la celda del importe perdió `whitespace-nowrap`: la cifra puede partirse o encogerse",
    ).toContain("whitespace-nowrap");

    // La celda de texto conserva lo que le compra el sitio al importe.
    expect(
      fuente,
      "la celda de texto perdió `wrap-anywhere`: deja de encoger y le come el sitio al importe",
    ).toContain("wrap-anywhere");

    // Y ninguna abreviatura, en ninguna parte del fuente.
    for (const prohibida of [/\btruncate\b/, /\bline-clamp/, /\btext-ellipsis\b/, /\boverflow-hidden\b/]) {
      expect(fuente, `el detalle usa ${prohibida}: un importe a medias es un importe FALSO`).not.toMatch(
        prohibida,
      );
    }

    // CONTRAPRUEBA — el detector no está mirando al vacío: sobre el código MUTADO (el mismo
    // cambio que se aplicó y sobrevivió en verde a los 50 casos de arriba) dispara.
    const mutada = celdaImporte.replace("whitespace-nowrap", "truncate");
    expect(mutada).not.toContain("whitespace-nowrap");
    expect(mutada).toMatch(/\btruncate\b/);
    expect(celdaImporte).not.toMatch(/\btruncate\b/);
  });
});
