// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

import { ToastProvider } from "@/providers/ToastProvider";
import { descargarBlob } from "@/components/shared/descargar-blob";
import { buildXlsxRows } from "@/lib/utils/xlsx-template";
import type { DescargaColumna } from "@/lib/types/descarga";
import type { CierreAdminResumen } from "@/lib/interfaces/services/ICierresAdminService";
import type { CierreGestionDescargaDTO } from "@/lib/interfaces/services/ICierresAdminService";
import type { CierreBodegaResumen } from "@/lib/interfaces/services/ICierreBodegaService";
import type { CatalogoFiltrosCierresDTO } from "@/lib/types/filtros-cierres";

// ---------------------------------------------------------------------------
// UN SOLO botón «Descargar» en las dos pantallas de cierres del maestro, con el NIVEL DE
// DETALLE como primera decisión de su selector (pedido humano del 2026-09-05).
//
// Antes había dos botones —«Descargar» (una fila por CIERRE) y «Descargar detallada» (una fila
// por GESTIÓN)— con el mismo verbo y sin decir en qué se diferenciaban. Medido en producción con
// 4 cierres pendientes: 4 filas frente a 118. No es el mismo dato con más columnas: son dos
// granos, y ahora se eligen en un sitio.
//
// Lo que este archivo vigila, y que ningún otro puede ver:
//
//  · QUE SEA UNO. Que el segundo botón no esté, en las dos pantallas y en las dos pestañas.
//  · QUE EL NIVEL MANDE SOBRE LAS COLUMNAS. Elegir «Detalle» cambia el juego que el selector
//    ofrece, y lo que sale en el archivo es el del nivel elegido.
//  · QUE EL DETALLE TAMBIÉN SE REORDENE, y que el orden elegido llegue al ARCHIVO. Ficha 387,
//    pedido del humano del 2026-09-07, que revierte la decisión del 2026-09-05 de dejar esa hoja
//    en solo-ocultar. Se prueba de punta a punta —selector, preferencia, ventana de mensajeros,
//    cabecera del archivo— porque los botones podrían estar pintados sin llegar al generador. Lo
//    que NO cambia es el orden POR DEFECTO: el agrupado del catálogo (14 columnas que siempre
//    traen dato, 17 condicionales), que es lo que recibe quien no toca nada.
//  · QUE LA PREFERENCIA SEA POR NIVEL. Son juegos de columnas distintos (7 y 31): una sola clave
//    haría que ocultar en uno moviera en silencio lo guardado del otro.
//
// Ninguna aserción escribe a mano una lista de encabezados ni un total de columnas: todo se
// DERIVA de los catálogos. Publicar una columna nueva no debe tocar este archivo.
//
// Solo se aísla el codificador binario (`buildXlsxRows`): el recorrido
// `preferencia -> control -> DescargarDatasetButton -> construirDescarga -> buildXlsxRows` es el
// de producción, así que lo que se comprueba son las columnas que de verdad llegan al archivo.
// ---------------------------------------------------------------------------

vi.mock("@/lib/actions/cierres-admin", () => ({
  listarGestionesCierresAdminCompleto: vi.fn(),
  verCierreDetalle: vi.fn(),
  aprobarCierre: vi.fn(),
  rechazarCierre: vi.fn(),
  forzarSolicitudVencido: vi.fn(),
  listarHistoricoCierresAdminPaginado: vi.fn(),
  listarHistoricoCierresAdminCompleto: vi.fn(),
  listarPendientesCierresAdminPaginado: vi.fn(),
  listarPendientesCierresAdminCompleto: vi.fn(),
}));
vi.mock("@/lib/actions/cierre-bodega", () => ({
  listarGestionesCierresBodegaCompleto: vi.fn(),
  verCierreBodegaDetalle: vi.fn(),
  aprobarCierreBodega: vi.fn(),
  rechazarCierreBodega: vi.fn(),
  listarHistoricoCierresBodegaPaginado: vi.fn(),
  listarHistoricoCierresBodegaCompleto: vi.fn(),
  listarPendientesCierresBodegaPaginado: vi.fn(),
  listarPendientesCierresBodegaCompleto: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/cierres-admin",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/shared/descargar-blob", () => ({ descargarBlob: vi.fn() }));
const descargarBlobMock = vi.mocked(descargarBlob);

vi.mock("@/lib/utils/xlsx-template", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils/xlsx-template")>();
  return { ...actual, buildXlsxRows: vi.fn(async () => new ArrayBuffer(8)) };
});
const buildXlsxRowsMock = vi.mocked(buildXlsxRows);

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
  listarGestionesCierresAdminCompleto,
  listarHistoricoCierresAdminCompleto,
  listarHistoricoCierresAdminPaginado,
  listarPendientesCierresAdminCompleto,
  listarPendientesCierresAdminPaginado,
} from "@/lib/actions/cierres-admin";
import {
  listarGestionesCierresBodegaCompleto,
  listarHistoricoCierresBodegaCompleto,
  listarHistoricoCierresBodegaPaginado,
  listarPendientesCierresBodegaCompleto,
  listarPendientesCierresBodegaPaginado,
} from "@/lib/actions/cierre-bodega";
import { paginaInicial } from "@/tests/fixtures/pagina-inicial";
import { CierresAdminModule } from "@/app/(app)/cierres-admin/_components/CierresAdminModule";
import { CierresBodegaAdminModule } from "@/app/(app)/cierres-admin/_components/CierresBodegaAdminModule";
import {
  NIVEL_DETALLE_LABEL,
  NIVEL_LEGEND,
  NIVEL_RESUMEN_LABEL,
  SELECTOR_DISPARADOR,
} from "@/app/(app)/cierres-admin/_components/DescargarCierresButton";
import {
  AMBITO_DESCARGA_GESTIONES_FUNDIDA,
  COLUMNAS_DESCARGA_GESTIONES_FUNDIDA,
} from "@/app/(app)/cierres-admin/_components/cierres-gestiones-fundida-descarga-columnas";
import {
  AMBITO_DESCARGA_CIERRES_HISTORICO,
  AMBITO_DESCARGA_CIERRES_PENDIENTES,
  COLUMNAS_DESCARGA_CIERRES_HISTORICO,
  COLUMNAS_DESCARGA_CIERRES_PENDIENTES,
} from "@/app/(app)/cierres-admin/_components/cierres-admin-descarga-columnas";
import {
  AMBITO_DESCARGA_BODEGA_PENDIENTES,
  COLUMNAS_DESCARGA_BODEGA_PENDIENTES,
} from "@/app/(app)/cierres-admin/_components/cierres-bodega-descarga-columnas";

// --- Datos ----------------------------------------------------------------

const ANA = "11111111-1111-4111-8111-111111111111";
const BETO = "22222222-2222-4222-8222-222222222222";
const ZONA = "33333333-3333-4333-8333-333333333333";

const CATALOGO: CatalogoFiltrosCierresDTO = {
  zonas: [{ id: ZONA, nombre: "Bodega central" }],
  mensajeros: [
    { id: ANA, nombre: "Ana Mensajera", zonaId: ZONA },
    { id: BETO, nombre: "Beto Mensajero", zonaId: ZONA },
  ],
  mensajerosFiltro: [
    { id: ANA, nombre: "Ana Mensajera", zonaId: ZONA },
    { id: BETO, nombre: "Beto Mensajero", zonaId: ZONA },
  ],
};

const TOTALES = {
  efectivo: "1000.10",
  simpe: "0.00",
  transferencia: "0.00",
  general: "1000.10",
};

function cierreAdmin(cierreId: string, over: Partial<CierreAdminResumen> = {}): CierreAdminResumen {
  return {
    cierreId,
    mensajeroId: `m-${cierreId}`,
    mensajeroNombre: "Ana Mensajera",
    estado: "solicitado",
    destinoTipo: "bodega_central",
    destinoZonaId: ZONA,
    destinoZonaNombre: "Bodega central",
    totales: TOTALES,
    totalPagoMensajero: "100.10",
    totalIngresoBodegaRechazos: "5.00",
    pendientePagoMensajero: null,
    solicitadoAt: "2026-07-11T10:00:00.000Z",
    resueltoAt: null,
    motivoRechazo: null,
    ...over,
  };
}

function cierreBodega(
  cierreBodegaId: string,
  over: Partial<CierreBodegaResumen> = {},
): CierreBodegaResumen {
  return {
    cierreBodegaId,
    zonaId: ZONA,
    zonaNombre: "Limón",
    solicitadoPorId: "u1",
    solicitadoPorNombre: "Sara Satélite",
    estado: "solicitado",
    totales: TOTALES,
    totalPagoMensajero: "100.10",
    totalIngresoBodegaRechazos: "5.00",
    cantidadCierres: 3,
    solicitadoAt: "2026-07-11T10:00:00.000Z",
    resueltoAt: null,
    motivoRechazo: null,
    // Feature 393: derivados del snapshot de esta cabecera. 1000.10 - 100.10 - 5.00 = 895.00;
    // el efectivo (1000.10) cubre los dos descuentos (105.10).
    paraLaCentral: "895.00",
    efectivoCubreDescuentos: true,
    ...over,
  };
}

function gestion(): CierreGestionDescargaDTO {
  return {
    mensajeroNombre: "Ana Mensajera",
    cierreSolicitadoAt: "2026-07-11T10:00:00.000Z",
    fechaGestion: "2026-07-11",
    diaReparto: "2026-07-11",
    fechaCreacionOrden: "2026-07-05",
    numGuia: 1001,
    numRemision: "REM-1",
    destinatario: "Ana Pérez",
    direccion: "Calle 1",
    zonaNombre: "San José",
    provinciaNombre: "San José",
    cantonNombre: "Central",
    distritoNombre: null,
    producto: "Caja",
    tiendaNombre: "Tienda X",
    intentosContactoTienda: 2,
    resultado: "entregada",
    montoRecibido: "1000.10",
    pagos: [],
    motivo: null,
    fechaReprogramacion: null,
    esRechazoSla: false,
    causaIncidente: null,
    indemnizacion: null,
    pagoMensajero: "100.10",
    ingresoBodegaRechazo: null,
    ingresoOrdenex: null,
  };
}

const PENDIENTES = [cierreAdmin("c1"), cierreAdmin("c2")];
const HISTORICO = [
  cierreAdmin("c3", { estado: "aprobado", resueltoAt: "2026-07-12T10:00:00.000Z" }),
];
const BODEGA_PENDIENTES = [cierreBodega("b1")];
const BODEGA_RESUELTOS = [
  cierreBodega("b2", { estado: "aprobado", resueltoAt: "2026-07-12T10:00:00.000Z" }),
];

// --- Montaje ---------------------------------------------------------------

function envolver(ui: ReactElement) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>{ui}</ToastProvider>
    </SWRConfig>,
  );
}

function montarCierresAdmin() {
  vi.mocked(listarPendientesCierresAdminPaginado).mockResolvedValue({
    status: "ok",
    page: 1,
    ...paginaInicial(PENDIENTES),
  });
  vi.mocked(listarHistoricoCierresAdminPaginado).mockResolvedValue({
    status: "ok",
    page: 1,
    ...paginaInicial(HISTORICO),
  });
  vi.mocked(listarPendientesCierresAdminCompleto).mockResolvedValue({
    status: "ok",
    items: PENDIENTES,
    total: PENDIENTES.length,
  });
  vi.mocked(listarHistoricoCierresAdminCompleto).mockResolvedValue({
    status: "ok",
    items: HISTORICO,
    total: HISTORICO.length,
  });
  vi.mocked(listarGestionesCierresAdminCompleto).mockResolvedValue({
    status: "ok",
    items: [gestion()],
    total: 1,
  });
  envolver(
    <CierresAdminModule
      pendientes={paginaInicial(PENDIENTES)}
      historico={paginaInicial(HISTORICO)}
      sinZona={false}
      catalogoFiltros={CATALOGO}
    />,
  );
}

function montarCierresBodega() {
  vi.mocked(listarPendientesCierresBodegaPaginado).mockResolvedValue({
    status: "ok",
    page: 1,
    ...paginaInicial(BODEGA_PENDIENTES),
  });
  vi.mocked(listarHistoricoCierresBodegaPaginado).mockResolvedValue({
    status: "ok",
    page: 1,
    ...paginaInicial(BODEGA_RESUELTOS),
  });
  vi.mocked(listarPendientesCierresBodegaCompleto).mockResolvedValue({
    status: "ok",
    items: BODEGA_PENDIENTES,
    total: BODEGA_PENDIENTES.length,
  });
  vi.mocked(listarHistoricoCierresBodegaCompleto).mockResolvedValue({
    status: "ok",
    items: BODEGA_RESUELTOS,
    total: BODEGA_RESUELTOS.length,
  });
  vi.mocked(listarGestionesCierresBodegaCompleto).mockResolvedValue({
    status: "ok",
    items: [gestion()],
    total: 1,
  });
  envolver(
    <CierresBodegaAdminModule
      pendientes={paginaInicial(BODEGA_PENDIENTES)}
      historico={paginaInicial(BODEGA_RESUELTOS)}
      catalogoFiltros={CATALOGO}
    />,
  );
}

// --- El registro de las DOS pantallas que se unifican -----------------------

interface Pantalla {
  /** Nombre de la pantalla, para los mensajes de fallo. */
  readonly nombre: string;
  /** Nombre accesible del botón de descarga cuando el nivel es «Resumen». */
  readonly botonResumen: string;
  /** El ámbito y el catálogo del nivel «Resumen» de la pestaña que abre por defecto. */
  readonly ambitoResumen: string;
  readonly columnasResumen: readonly DescargaColumna[];
  readonly montar: () => void;
}

const PANTALLAS: readonly Pantalla[] = [
  {
    nombre: "Cierres del día",
    botonResumen: "Descargar Cierres pendientes de decisión",
    ambitoResumen: AMBITO_DESCARGA_CIERRES_PENDIENTES,
    columnasResumen: COLUMNAS_DESCARGA_CIERRES_PENDIENTES,
    montar: montarCierresAdmin,
  },
  {
    nombre: "Cierres de bodega",
    botonResumen: "Descargar Cierres de bodega pendientes",
    ambitoResumen: AMBITO_DESCARGA_BODEGA_PENDIENTES,
    columnasResumen: COLUMNAS_DESCARGA_BODEGA_PENDIENTES,
    montar: montarCierresBodega,
  },
];

// --- Utilidades de los casos ----------------------------------------------

/** El nombre accesible del botón cuando el nivel elegido es «Detalle». */
const BOTON_DETALLE = "Descargar detallada por mensajero";
/** El control que produce el archivo detallado, DENTRO de la ventana de mensajeros. */
const BOTON_DETALLE_ARCHIVO = "Descargar Gestiones de cierres";

/**
 * La clave del ámbito, tal y como la arma el control común. Se escribe el prefijo a mano y no
 * se importa `claveDeAmbitoDescarga`: una aserción contra su propia fuente estaría siempre
 * verde, y lo que se afirma aquí es que la clave guardada es ESA y no otra.
 */
function claveDe(ambito: string): string {
  return `ordenex:descarga-columnas:${ambito}`;
}

function encabezadosDe(columnas: readonly DescargaColumna[]): string[] {
  return columnas.map((columna) => columna.encabezado);
}

/** Encabezados que recibió el generador en su ÚLTIMA llamada, en su orden. */
function encabezadosDelArchivo(): string[] {
  const llamada = buildXlsxRowsMock.mock.calls.at(-1);
  expect(
    llamada,
    "no se llegó a generar ningún archivo: no hay cabecera que comparar",
  ).toBeDefined();
  return llamada![0].map((columna) => columna.header);
}

/** Las etiquetas de las casillas del selector, en el orden en que están pintadas. */
function columnasEnElSelector(): string[] {
  return screen.getAllByRole("checkbox").map((casilla) => {
    const id = casilla.getAttribute("aria-labelledby");
    return (id && document.getElementById(id)?.textContent) || "";
  });
}

async function abrirSelector(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: SELECTOR_DISPARADOR }));
  await screen.findByRole("radiogroup", { name: NIVEL_LEGEND });
}

async function elegirNivel(user: ReturnType<typeof userEvent.setup>, etiqueta: string) {
  await user.click(screen.getByRole("radio", { name: etiqueta }));
}

async function cerrarSelector(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard("{Escape}");
  await waitFor(() =>
    expect(screen.queryByRole("radiogroup", { name: NIVEL_LEGEND })).toBeNull(),
  );
}

function guardarPreferencia(
  ambito: string,
  preferencia: { ocultas?: string[]; orden?: string[] },
): void {
  window.localStorage.setItem(claveDe(ambito), JSON.stringify(preferencia));
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  buildXlsxRowsMock.mockResolvedValue(new ArrayBuffer(8));
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("Cierres · un solo botón de descarga con nivel de detalle", () => {
  it("cada pantalla ofrece UN botón y su selector, y el segundo botón ya no existe", async () => {
    for (const pantalla of PANTALLAS) {
      const user = userEvent.setup();
      pantalla.montar();

      // El único botón de descarga de la fila de pestañas es el del nivel de partida.
      expect(
        await screen.findByRole("button", { name: pantalla.botonResumen }),
        `${pantalla.nombre}: sin botón de descarga`,
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: BOTON_DETALLE }),
        `${pantalla.nombre}: el botón «Descargar detallada» sigue en la pantalla`,
      ).toBeNull();
      expect(
        screen.getByRole("button", { name: SELECTOR_DISPARADOR }),
        `${pantalla.nombre}: sin selector`,
      ).toBeInTheDocument();

      // Y abrirlo no descarga nada: es un control paralelo, no un paso del camino.
      await abrirSelector(user);
      expect(buildXlsxRowsMock).not.toHaveBeenCalled();
      expect(descargarBlobMock).not.toHaveBeenCalled();

      cleanup();
      vi.clearAllMocks();
      buildXlsxRowsMock.mockResolvedValue(new ArrayBuffer(8));
    }
  });

  it("el selector arranca en «Resumen» y ofrece las columnas de ese nivel", async () => {
    for (const pantalla of PANTALLAS) {
      const user = userEvent.setup();
      pantalla.montar();
      await screen.findByRole("button", { name: pantalla.botonResumen });
      await abrirSelector(user);

      expect(
        screen.getByRole("radio", { name: NIVEL_RESUMEN_LABEL }),
        `${pantalla.nombre}: «Resumen» no está marcado de partida`,
      ).toHaveAttribute("aria-checked", "true");
      expect(
        columnasEnElSelector(),
        `${pantalla.nombre}: el selector no ofrece las columnas del resumen`,
      ).toEqual(encabezadosDe(pantalla.columnasResumen));

      cleanup();
      vi.clearAllMocks();
      buildXlsxRowsMock.mockResolvedValue(new ArrayBuffer(8));
    }
  });

  it("elegir «Detalle» cambia el juego de columnas ofrecido, y volver a «Resumen» lo devuelve", async () => {
    for (const pantalla of PANTALLAS) {
      const user = userEvent.setup();
      pantalla.montar();
      await screen.findByRole("button", { name: pantalla.botonResumen });
      await abrirSelector(user);

      await elegirNivel(user, NIVEL_DETALLE_LABEL);
      await waitFor(() =>
        expect(
          columnasEnElSelector(),
          `${pantalla.nombre}: el selector no pasó a las columnas de la hoja fundida`,
        ).toEqual(encabezadosDe(COLUMNAS_DESCARGA_GESTIONES_FUNDIDA)),
      );
      // Contraprueba de no-vacuidad: ese juego NO es el del resumen.
      expect(columnasEnElSelector()).not.toEqual(
        encabezadosDe(pantalla.columnasResumen),
      );

      await elegirNivel(user, NIVEL_RESUMEN_LABEL);
      await waitFor(() =>
        expect(columnasEnElSelector()).toEqual(
          encabezadosDe(pantalla.columnasResumen),
        ),
      );

      cleanup();
      vi.clearAllMocks();
      buildXlsxRowsMock.mockResolvedValue(new ArrayBuffer(8));
    }
  });

  it("los DOS niveles ocultan y reordenan: el detalle ya no es la excepción (ficha 387)", async () => {
    // Ficha 387, pedido del humano del 2026-09-07: «en descarga detallada no pusiste el control
    // que ya tenemos en ese componente, que es para ordenar las columnas antes de hacer la
    // descarga». Del 2026-09-05 al 2026-09-07 el detalle se montó con `permitirReordenar={false}`
    // porque su orden agrupado se creyó contrato de legibilidad; el humano lo revirtió sabiéndolo.
    //
    // Se comprueban las DOS mitades. Sin la del resumen, el caso pasaría con un selector que
    // reordenase en el nivel equivocado; sin la del detalle, no probaría la ficha.
    for (const pantalla of PANTALLAS) {
      const user = userEvent.setup();
      pantalla.montar();
      await screen.findByRole("button", { name: pantalla.botonResumen });
      await abrirSelector(user);

      const primeraDelResumen = pantalla.columnasResumen[0]!.encabezado;
      expect(
        screen.getByRole("button", { name: `Bajar ${primeraDelResumen}` }),
        `${pantalla.nombre}: el resumen perdió los controles de reordenar`,
      ).toBeInTheDocument();

      await elegirNivel(user, NIVEL_DETALLE_LABEL);
      const catalogo = encabezadosDe(COLUMNAS_DESCARGA_GESTIONES_FUNDIDA);
      // El ORDEN POR DEFECTO del detalle es el agrupado del catálogo, y eso NO cambia: lo que
      // se revierte es la imposición, no el punto de partida.
      await waitFor(() => expect(columnasEnElSelector()).toEqual(catalogo));

      // Un control de mover por columna y sentido, para las 31. Se afirma el TOTAL y no una
      // fila: un interruptor que solo apagara la primera pasaría un caso de una sola fila.
      expect(
        screen.getAllByRole("button", { name: /^(Subir|Bajar) / }),
        `${pantalla.nombre}: el detalle no ofrece reordenar sus columnas`,
      ).toHaveLength(COLUMNAS_DESCARGA_GESTIONES_FUNDIDA.length * 2);

      // Y ocultar sigue estando: no se cambió una capacidad por la otra.
      const ultima = COLUMNAS_DESCARGA_GESTIONES_FUNDIDA.at(-1)!;
      const casilla = screen.getByRole("checkbox", { name: ultima.encabezado });
      expect(casilla).toHaveAttribute("aria-checked", "true");
      await user.click(casilla);
      await waitFor(() => {
        expect(
          window.localStorage.getItem(claveDe(AMBITO_DESCARGA_GESTIONES_FUNDIDA)),
          `${pantalla.nombre}: desmarcar en el detalle no guardó nada`,
        ).not.toBeNull();
      });
      expect(
        JSON.parse(
          window.localStorage.getItem(claveDe(AMBITO_DESCARGA_GESTIONES_FUNDIDA))!,
        ).ocultas,
      ).toEqual([ultima.clave]);

      cleanup();
      vi.clearAllMocks();
      window.localStorage.clear();
      buildXlsxRowsMock.mockResolvedValue(new ArrayBuffer(8));
    }
  });

  it("el orden elegido en «Detalle» es el de la cabecera del archivo detallado (ficha 387)", async () => {
    // La mitad que de verdad prueba la ficha: los botones podrían estar pintados y no llegar al
    // archivo. El recorrido es el de producción entero —selector → preferencia → ventana de
    // mensajeros → generador—, y solo se aísla el codificador binario.
    //
    // Se mueve la PRIMERA columna un puesto abajo, que es el caso que la decisión revertida
    // prohibía: mete una del bloque «siempre con dato» dentro del orden que se creía intocable.
    for (const pantalla of PANTALLAS) {
      const user = userEvent.setup();
      pantalla.montar();
      await screen.findByRole("button", { name: pantalla.botonResumen });

      const catalogo = encabezadosDe(COLUMNAS_DESCARGA_GESTIONES_FUNDIDA);
      const esperado = [catalogo[1]!, catalogo[0]!, ...catalogo.slice(2)];

      await abrirSelector(user);
      await elegirNivel(user, NIVEL_DETALLE_LABEL);
      await waitFor(() => expect(columnasEnElSelector()).toEqual(catalogo));
      await user.click(screen.getByRole("button", { name: `Bajar ${catalogo[0]}` }));
      await waitFor(() =>
        expect(
          columnasEnElSelector(),
          `${pantalla.nombre}: mover en el detalle no reordenó el selector`,
        ).toEqual(esperado),
      );
      await cerrarSelector(user);

      await user.click(screen.getByRole("button", { name: BOTON_DETALLE }));
      await user.click(await screen.findByRole("button", { name: BOTON_DETALLE_ARCHIVO }));
      await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));

      // Ni una columna de menos: mover no oculta nada (R24). Y en el orden elegido.
      expect(encabezadosDelArchivo(), `${pantalla.nombre}: detalle reordenado`).toEqual(esperado);

      cleanup();
      vi.clearAllMocks();
      window.localStorage.clear();
      buildXlsxRowsMock.mockResolvedValue(new ArrayBuffer(8));
    }
  });

  it("el selector del detalle ya no dice que su orden sea fijo", async () => {
    // El texto que la decisión revertida mostraba al usuario bajo la lista de columnas. Dejarlo
    // sería mentirle en pantalla: se retiró con la prop que lo pintaba. Se busca por su parte
    // invariable —no por la frase entera— para que un retoque de redacción no lo resucite mudo.
    const pantalla = PANTALLAS[0]!;
    const user = userEvent.setup();
    pantalla.montar();
    await screen.findByRole("button", { name: pantalla.botonResumen });
    await abrirSelector(user);
    await elegirNivel(user, NIVEL_DETALLE_LABEL);
    await waitFor(() =>
      expect(columnasEnElSelector()).toEqual(
        encabezadosDe(COLUMNAS_DESCARGA_GESTIONES_FUNDIDA),
      ),
    );
    expect(
      screen.queryByText(/orden de esta hoja es fijo/i),
      "el selector del detalle sigue diciendo que su orden es fijo",
    ).toBeNull();
  });

  it("en «Detalle» el botón abre la ventana de mensajeros y rango, y no descarga sola", async () => {
    for (const pantalla of PANTALLAS) {
      const user = userEvent.setup();
      pantalla.montar();
      await screen.findByRole("button", { name: pantalla.botonResumen });
      await abrirSelector(user);
      await elegirNivel(user, NIVEL_DETALLE_LABEL);
      await cerrarSelector(user);

      // El botón ya no es el del resumen: es el mismo sitio, con el otro grano.
      expect(
        screen.queryByRole("button", { name: pantalla.botonResumen }),
        `${pantalla.nombre}: siguen conviviendo los dos botones`,
      ).toBeNull();
      await user.click(screen.getByRole("button", { name: BOTON_DETALLE }));

      // Pulsarlo NO produce archivo: abre la ventana donde se elige el conjunto.
      const dialogo = await screen.findByRole("dialog");
      expect(buildXlsxRowsMock).not.toHaveBeenCalled();
      expect(dialogo).toHaveTextContent("Mensajeros");
      expect(screen.getByRole("checkbox", { name: "Ana Mensajera" })).toBeChecked();
      expect(screen.getByRole("checkbox", { name: "Beto Mensajero" })).toBeChecked();
      expect(screen.getByLabelText("Desde")).toBeInTheDocument();
      expect(screen.getByLabelText("Hasta")).toBeInTheDocument();

      cleanup();
      vi.clearAllMocks();
      window.localStorage.clear();
      buildXlsxRowsMock.mockResolvedValue(new ArrayBuffer(8));
    }
  });

  it("lo oculto en «Detalle» se cae del archivo detallado, y lo oculto en «Resumen» del suyo", async () => {
    for (const pantalla of PANTALLAS) {
      const ocultaDetalle = COLUMNAS_DESCARGA_GESTIONES_FUNDIDA.at(-1)!;
      const ocultaResumen = pantalla.columnasResumen.at(-1)!;
      guardarPreferencia(AMBITO_DESCARGA_GESTIONES_FUNDIDA, {
        ocultas: [ocultaDetalle.clave],
      });
      guardarPreferencia(pantalla.ambitoResumen, { ocultas: [ocultaResumen.clave] });

      const user = userEvent.setup();
      pantalla.montar();

      // (a) El resumen sale sin la suya, y con todas las demás.
      await user.click(await screen.findByRole("button", { name: pantalla.botonResumen }));
      await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));
      expect(encabezadosDelArchivo(), `${pantalla.nombre}: resumen`).toEqual(
        encabezadosDe(pantalla.columnasResumen).filter(
          (encabezado) => encabezado !== ocultaResumen.encabezado,
        ),
      );

      // (b) El detalle sale sin la suya. Es la comprobación de que las columnas elegidas en el
      // selector llegan de verdad al archivo que produce la ventana de mensajeros.
      await abrirSelector(user);
      await elegirNivel(user, NIVEL_DETALLE_LABEL);
      await cerrarSelector(user);
      await user.click(screen.getByRole("button", { name: BOTON_DETALLE }));
      await user.click(await screen.findByRole("button", { name: BOTON_DETALLE_ARCHIVO }));
      await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(2));

      expect(encabezadosDelArchivo(), `${pantalla.nombre}: detalle`).toEqual(
        encabezadosDe(COLUMNAS_DESCARGA_GESTIONES_FUNDIDA).filter(
          (encabezado) => encabezado !== ocultaDetalle.encabezado,
        ),
      );

      cleanup();
      vi.clearAllMocks();
      window.localStorage.clear();
      buildXlsxRowsMock.mockResolvedValue(new ArrayBuffer(8));
    }
  });

  it("la preferencia es POR NIVEL: ocultar en uno no toca lo guardado del otro", async () => {
    // Son juegos de columnas distintos —siete y veintinueve—, así que comparten pantalla pero
    // no clave. Con una sola, ocultar «Mensajero» en el resumen se llevaría por delante el
    // orden y las ocultas del detalle sin que nada lo dijera.
    const pantalla = PANTALLAS[0]!;
    const user = userEvent.setup();
    pantalla.montar();
    await screen.findByRole("button", { name: pantalla.botonResumen });

    const ocultaResumen = pantalla.columnasResumen.at(-1)!;
    const ocultaDetalle = COLUMNAS_DESCARGA_GESTIONES_FUNDIDA.at(-1)!;

    await abrirSelector(user);
    await user.click(screen.getByRole("checkbox", { name: ocultaResumen.encabezado }));
    await waitFor(() =>
      expect(window.localStorage.getItem(claveDe(pantalla.ambitoResumen))).not.toBeNull(),
    );

    await elegirNivel(user, NIVEL_DETALLE_LABEL);
    await waitFor(() =>
      expect(columnasEnElSelector()).toEqual(
        encabezadosDe(COLUMNAS_DESCARGA_GESTIONES_FUNDIDA),
      ),
    );
    // El detalle NO heredó nada: todas sus columnas siguen marcadas.
    for (const columna of COLUMNAS_DESCARGA_GESTIONES_FUNDIDA) {
      expect(
        screen.getByRole("checkbox", { name: columna.encabezado }),
        `«${columna.encabezado}» llegó desmarcada al detalle`,
      ).toHaveAttribute("aria-checked", "true");
    }
    await user.click(screen.getByRole("checkbox", { name: ocultaDetalle.encabezado }));

    await waitFor(() =>
      expect(
        window.localStorage.getItem(claveDe(AMBITO_DESCARGA_GESTIONES_FUNDIDA)),
      ).not.toBeNull(),
    );
    // Dos claves distintas, cada una con lo suyo, y ninguna tercera.
    expect(
      JSON.parse(window.localStorage.getItem(claveDe(pantalla.ambitoResumen))!).ocultas,
    ).toEqual([ocultaResumen.clave]);
    expect(
      JSON.parse(
        window.localStorage.getItem(claveDe(AMBITO_DESCARGA_GESTIONES_FUNDIDA))!,
      ).ocultas,
    ).toEqual([ocultaDetalle.clave]);
    expect(Object.keys(window.localStorage).sort()).toEqual(
      [claveDe(pantalla.ambitoResumen), claveDe(AMBITO_DESCARGA_GESTIONES_FUNDIDA)].sort(),
    );
  });

  it("el nivel elegido no se pega a la pestaña: cambiar de pestaña sigue en el mismo botón", async () => {
    // La pestaña decide QUÉ resumen se descarga (cola o resueltos); el nivel es del control.
    // Los dos ámbitos del resumen siguen siendo distintos, que es lo que R10 exige.
    const user = userEvent.setup();
    montarCierresAdmin();
    await screen.findByRole("button", { name: "Descargar Cierres pendientes de decisión" });

    await user.click(await screen.findByRole("button", { name: /^Resueltos/ }));
    await screen.findByRole("button", { name: "Descargar Cierres del día resueltos" });
    expect(screen.queryByRole("button", { name: BOTON_DETALLE })).toBeNull();

    await abrirSelector(user);
    expect(columnasEnElSelector()).toEqual(
      encabezadosDe(COLUMNAS_DESCARGA_CIERRES_HISTORICO),
    );
    // Y no es el catálogo de la otra pestaña: son dos juegos y dos ámbitos.
    expect(columnasEnElSelector()).not.toEqual(
      encabezadosDe(COLUMNAS_DESCARGA_CIERRES_PENDIENTES),
    );

    await user.click(
      screen.getByRole("checkbox", {
        name: COLUMNAS_DESCARGA_CIERRES_HISTORICO.at(-1)!.encabezado,
      }),
    );
    await waitFor(() =>
      expect(
        window.localStorage.getItem(claveDe(AMBITO_DESCARGA_CIERRES_HISTORICO)),
      ).not.toBeNull(),
    );
    expect(Object.keys(window.localStorage)).toEqual([
      claveDe(AMBITO_DESCARGA_CIERRES_HISTORICO),
    ]);

    // El detalle sigue disponible desde esta pestaña: su conjunto no depende de cuál esté
    // abierta (D11).
    await elegirNivel(user, NIVEL_DETALLE_LABEL);
    await cerrarSelector(user);
    expect(screen.getByRole("button", { name: BOTON_DETALLE })).toBeInTheDocument();
  });
});
