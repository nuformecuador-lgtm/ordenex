// @vitest-environment jsdom
// Feature 170 — FASE 2, T J.2 (R42/R43/R50/R52) — las CUATRO colas de riesgo MEDIO
// (`design.md §11.3`) pasan a paginación server-side: cierres del día pendientes, cierres de
// bodega pendientes, cierres del día a consolidar e incidentes pendientes.
//
// Se llaman «de riesgo MEDIO» por una sola cosa: las cuatro muestran `({array.length})` junto
// al título. Bajo paginación ese mismo código pasa a mostrar el tamaño de la página —«Cierres
// pendientes (25)» con 300 esperando decisión— y NO falla en ninguna parte: compila, renderiza
// y miente. Los cuatro riesgos que este archivo cierra:
//
//  1. R42 — que el contador sea el TOTAL del servidor. Se comprueba además en la ÚLTIMA
//     página, que es donde un contador derivado del array se delata sin ambigüedad: allí la
//     página trae 10 filas y el conjunto sigue siendo 60.
//  2. R50 — que cambiar de página no toque los totales de dinero, los avisos de bloqueo ni lo
//     que el usuario tiene tecleado. En «Cierres del día a consolidar» esto es el punto rojo
//     de la tanda: sus CINCO agregados no vienen en la página y dos de ellos ni siquiera son
//     una suma (salen de repartir el efectivo entre los pagos individuales ordenados). Sobre
//     la página 1 la pantalla diría que la central no debe nada cuando debe 500.
//  3. R52 — que la descarga siga entregando el conjunto completo. Al paginar, la forma
//     «natural» de cablearla —proyectar lo que la tabla pinta— la degrada a «descargá lo que
//     se ve» sin que nada falle: el archivo sale, con 25 filas de 60. Se descarga DESDE LA
//     PÁGINA 2, que es donde la degradación es más fácil de no notar.
//  4. R43 — que haya control de navegación y que se pueda ENCONTRAR por rol y nombre. Las
//     cuatro pantallas montan además la tabla que paginó la tanda I: dos controles llamados
//     «Paginación» en la misma pantalla no dicen cuál es cuál.
//
// Cómo está montado: 60 filas por cola, `pageSize` 25 → 3 páginas (la última, de 10). El doble
// de la Server Action paginada RECORTA de verdad, así que navegar cambia las filas; el doble
// del listado sin paginar devuelve las 60, que es lo que la descarga debe entregar.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  within,
  waitFor,
  cleanup,
  fireEvent,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

import { ToastProvider } from "@/providers/ToastProvider";
import { descargarBlob } from "@/components/shared/descargar-blob";
import { buildXlsxRows } from "@/lib/utils/xlsx-template";
// Feature 201: el esperado se DERIVA del mismo dato del doble con el formateador de la app.
// Estas aserciones no miden el formato —miden de qué conjunto sale cada agregado—, así que el
// valor tiene que seguir saliendo de `AGREGADOS`; escribirlo a mano las dejaría envejeciendo
// solas la próxima vez que el importe cambie de aspecto.
import { money } from "@/lib/config/moneda";
import type { CierreAdminResumen } from "@/lib/interfaces/services/ICierresAdminService";
import type {
  CierreBodegaResumen,
  CierreBodegaResumenLite,
} from "@/lib/interfaces/services/ICierreBodegaService";
import type { CierreTotales } from "@/lib/interfaces/services/ICierreDiaService";
import type { IncidenteAdminDTO } from "@/lib/interfaces/services/IIncidenteAdminService";

// --- Dobles ---------------------------------------------------------------

const { paginado, completo, verIncidenteMock } = vi.hoisted(() => ({
  /** Un doble por listado paginado (lo que la tabla pinta). */
  paginado: {
    cierresPendientes: vi.fn(),
    cierresHistorico: vi.fn(),
    bodegaPendientes: vi.fn(),
    bodegaResueltos: vi.fn(),
    consolidables: vi.fn(),
    bodegaSolicitados: vi.fn(),
    incidentesPendientes: vi.fn(),
    incidentesHistorico: vi.fn(),
  },
  /** Un doble por listado SIN recorte (lo que la descarga debe entregar, R52). */
  completo: {
    cierresAdmin: vi.fn(),
    // Feature 184 — Tanda D (T D.3): «Cierres del día pendientes» ya no saca su archivo del
    // listado compuesto (`cierresAdmin`), que arrastraba el histórico entero además de la cola,
    // sino de su lectura DEDICADA. El doble del compuesto se conserva: la pantalla lo seguía
    // usando y su ausencia no puede ser lo que explique que ya no se llame.
    cierresPendientesCompleto: vi.fn(),
    bodegaAdmin: vi.fn(),
    // Feature 184 — Tanda E (T E.3): «Cierres de bodega pendientes» ya no saca su archivo del
    // listado compuesto (`bodegaAdmin`), que arrastraba el histórico entero de la operación
    // además de la cola, sino de su lectura DEDICADA. El doble del compuesto se conserva: la
    // pantalla lo seguía usando y su ausencia no puede ser lo que explique que ya no se llame.
    bodegaPendientesCompleto: vi.fn(),
    consolidacion: vi.fn(),
    // Feature 184 — Tanda B (T B.2): «Cierres del día a consolidar» ya no saca su archivo del
    // listado compuesto (`consolidacion`), sino de su lectura DEDICADA. El doble del compuesto
    // se conserva porque esa pantalla lo sigue usando para lo demás.
    consolidables: vi.fn(),
    incidentes: vi.fn(),
    // Feature 184 — Tanda F (T F.3): «Incidentes pendientes» ya no saca su archivo del listado
    // compuesto (`incidentes`), que arrastraba el histórico entero de resueltos además de la
    // cola, sino de su lectura DEDICADA. El doble del compuesto se conserva: la pantalla lo
    // seguía usando y su ausencia no puede ser lo que explique que ya no se llame.
    incidentesPendientesCompleto: vi.fn(),
  },
  verIncidenteMock: vi.fn(),
}));

vi.mock("@/lib/actions/cierres-admin", () => ({
  verCierreDetalle: vi.fn(),
  aprobarCierre: vi.fn(),
  rechazarCierre: vi.fn(),
  forzarSolicitudVencido: vi.fn(),
  listarCierresAdmin: (...a: unknown[]) => completo.cierresAdmin(...a),
  // Feature 184 — Tanda D (T D.3): la lectura dedicada del listado 3. Sin declararla aquí, el
  // control de descarga de esa cola llama a `undefined` y el archivo no sale.
  listarPendientesCierresAdminCompleto: (...a: unknown[]) =>
    completo.cierresPendientesCompleto(...a),
  listarPendientesCierresAdminPaginado: (...a: unknown[]) =>
    paginado.cierresPendientes(...a),
  listarHistoricoCierresAdminPaginado: (...a: unknown[]) =>
    paginado.cierresHistorico(...a),
}));
vi.mock("@/lib/actions/cierre-bodega", () => ({
  verCierreBodegaDetalle: vi.fn(),
  aprobarCierreBodega: vi.fn(),
  rechazarCierreBodega: vi.fn(),
  solicitarCierreBodega: vi.fn(),
  listarCierresBodegaAdmin: (...a: unknown[]) => completo.bodegaAdmin(...a),
  listarConsolidacion: (...a: unknown[]) => completo.consolidacion(...a),
  // Feature 184 — Tanda E (T E.3): la lectura dedicada del listado 4. Sin declararla aquí, el
  // control de descarga de esa cola llama a `undefined` y el archivo no sale.
  listarPendientesCierresBodegaCompleto: (...a: unknown[]) =>
    completo.bodegaPendientesCompleto(...a),
  listarPendientesCierresBodegaPaginado: (...a: unknown[]) =>
    paginado.bodegaPendientes(...a),
  listarHistoricoCierresBodegaPaginado: (...a: unknown[]) =>
    paginado.bodegaResueltos(...a),
  listarConsolidablesPaginado: (...a: unknown[]) => paginado.consolidables(...a),
  listarCierresBodegaSolicitadosPaginado: (...a: unknown[]) =>
    paginado.bodegaSolicitados(...a),
  // Feature 184 — Tanda B (T B.2): las dos lecturas dedicadas de esta pantalla. Sin declararlas
  // aquí, el control de descarga llama a `undefined` y el archivo no sale.
  listarConsolidablesCompleto: (...a: unknown[]) => completo.consolidables(...a),
  listarCierresBodegaSolicitadosCompleto: vi.fn(),
}));
vi.mock("@/lib/actions/incidentes", () => ({
  verIncidente: (...a: unknown[]) => verIncidenteMock(...a),
  aprobarIncidente: vi.fn(),
  rechazarIncidente: vi.fn(),
  retractarIncidente: vi.fn(),
  reportarIncidente: vi.fn(),
  listarIncidentes: (...a: unknown[]) => completo.incidentes(...a),
  // Feature 184 — Tanda F (T F.3): la lectura dedicada del listado 8. Sin declararla aquí, el
  // control de descarga de esa cola llama a `undefined` y el archivo no sale.
  listarPendientesIncidentesCompleto: (...a: unknown[]) =>
    completo.incidentesPendientesCompleto(...a),
  listarPendientesIncidentesPaginado: (...a: unknown[]) =>
    paginado.incidentesPendientes(...a),
  listarHistoricoIncidentesPaginado: (...a: unknown[]) =>
    paginado.incidentesHistorico(...a),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  // Feature 205 (T6.1): el modulo lee `?cierre=` para abrir un detalle por enlace, asi que
  // el doble de `next/navigation` tiene que exportar tambien estos dos. Cambio del ARNES:
  // ninguna asercion de este archivo se toca.
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

import { CierresAdminModule } from "@/app/(app)/cierres-admin/_components/CierresAdminModule";
import { CierresBodegaAdminModule } from "@/app/(app)/cierres-admin/_components/CierresBodegaAdminModule";
import { ConsolidacionBodegaModule } from "@/app/(app)/cierres-admin/_components/ConsolidacionBodegaModule";
import {
  IncidentesAdminModule,
  MONTO_LABEL,
} from "@/app/(app)/incidentes/_components/IncidentesAdminModule";

// --- Datos ---------------------------------------------------------------

/** Conjunto completo de cada cola y tamaño de página: 60 filas en 3 páginas de 25 + 10. */
const TOTAL = 60;
const PAGE_SIZE = 25;
/** Filas de la ÚLTIMA página: 60 - 2×25. Es donde `items.length` se delata (R42). */
const ULTIMA_PAGINA = TOTAL - 2 * PAGE_SIZE;

const CERO: CierreTotales = {
  efectivo: "0.00",
  simpe: "0.00",
  transferencia: "0.00",
  general: "0.00",
};

/** Etiqueta única y visible de la fila i (1-based), para localizarla en la tabla. */
function etiqueta(i: number): string {
  return String(i).padStart(2, "0");
}

function cierreAdmin(i: number): CierreAdminResumen {
  return {
    cierreId: `c-${i}`,
    mensajeroId: `m-${i}`,
    mensajeroNombre: `Mensajero ${etiqueta(i)}`,
    estado: "solicitado",
    destinoTipo: "bodega_central",
    destinoZonaId: "z1",
    destinoZonaNombre: "Central",
    totales: CERO,
    totalPagoMensajero: "0.00",
    totalIngresoBodegaRechazos: "0.00",
    pendientePagoMensajero: null, // feature 172/T C.2: la cola son cierres no aprobados (R28)
    solicitadoAt: "2026-07-11T10:00:00.000Z",
    resueltoAt: null,
    motivoRechazo: null,
  };
}

function cierreBodega(i: number): CierreBodegaResumen {
  return {
    cierreBodegaId: `b-${i}`,
    zonaId: "z1",
    zonaNombre: "Limón",
    solicitadoPorId: `u-${i}`,
    solicitadoPorNombre: `Satélite ${etiqueta(i)}`,
    estado: "solicitado",
    totales: CERO,
    totalPagoMensajero: "0.00",
    totalIngresoBodegaRechazos: "0.00",
    cantidadCierres: 1,
    solicitadoAt: "2026-07-11T10:00:00.000Z",
    resueltoAt: null,
    motivoRechazo: null,
  };
}

/**
 * Un consolidable con dinero DISTINTO de cero, a propósito: es la única de las cuatro colas
 * que convive con agregados de dinero, y con montos en cero una suma sobre la página visible
 * daría el mismo número que el conjunto y no se notaría nada (§R50).
 */
function consolidable(i: number): CierreBodegaResumenLite {
  return {
    cierreDiaId: `cd-${i}`,
    mensajeroId: `m-${i}`,
    mensajeroNombre: `Mensajero ${etiqueta(i)}`,
    totales: { efectivo: "10.00", simpe: "4.00", transferencia: "0.00", general: "14.00" },
    totalPagoMensajero: "30.00",
    totalIngresoBodegaRechazos: "1.00",
  };
}

/**
 * Los CINCO agregados de dinero de «Cierres del día a consolidar», calculados server-side
 * sobre el CONJUNTO (60 filas), tal como llegan por props desde `listarConsolidacion`.
 *
 * Con los mismos datos, una suma sobre la PÁGINA 1 (25 filas) daría 250.00 de efectivo,
 * 100.00 de SINPE, 350.00 de total general, 750.00 de pago a mensajeros y 25.00 de ingreso por
 * rechazos. El neto y «la central debe» ni siquiera se pueden calcular desde una página,
 * porque salen de repartir el efectivo entre los pagos individuales ordenados. Ninguno de esos
 * números puede aparecer en pantalla.
 */
const AGREGADOS = {
  totales: {
    efectivo: "600.00",
    simpe: "240.00",
    transferencia: "0.00",
    general: "840.00",
  } satisfies CierreTotales,
  pagoMensajero: "1800.00",
  ingresoBodega: "60.00",
  neto: "120.00",
  centralDebe: "500.00",
};
/**
 * Lo que se vería si un agregado se calculara sobre la página visible. NUNCA en pantalla.
 *
 * Se compone con `money` y no con el símbolo a mano: son valores cuya AUSENCIA se afirma, y
 * una ausencia escrita en un formato que la app ya no emite se cumple sola. Derivándolos, la
 * guardia sigue mirando exactamente lo que se pintaría.
 */
const AGREGADOS_DE_LA_PAGINA = [
  money("250.00"),
  money("100.00"),
  money("350.00"),
  money("750.00"),
  money("25.00"),
];

const MOTIVO_BLOQUEO =
  "Hay cierres del día pendientes de decisión; no podés solicitar el cierre de bodega todavía.";

function incidente(i: number): IncidenteAdminDTO {
  return {
    incidenteId: `i-${i}`,
    ordenId: `o-${i}`,
    numGuia: 1000 + i,
    numRemision: `REM-${etiqueta(i)}`,
    destinatario: "Ana Pérez",
    zonaNombre: "Limón",
    estatusValue: "incidente",
    causa: "robado",
    motivo: "Robo en la parada",
    estado: "solicitado",
    indemnizacion: null,
    reportadoPorNombre: "Beto Mensajero",
    resueltoPorNombre: null,
    resueltoAt: null,
    motivoRechazo: null,
    createdAt: "2026-07-11T10:00:00.000Z",
    evidenciaUrls: [],
    esPropio: false,
  };
}

function conjunto<T>(fila: (i: number) => T): T[] {
  return Array.from({ length: TOTAL }, (_, k) => fila(k + 1));
}

// --- Andamiaje -------------------------------------------------------------

interface PaginaOk<T> {
  status: "ok";
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

/**
 * Programa el doble de una Server Action paginada para que RECORTE de verdad el conjunto. Es
 * lo que hace que «ir a la página siguiente» cambie las filas: un doble que devolviera siempre
 * la misma lista dejaría pasar una paginación que no navega a ninguna parte.
 */
function servirPaginas<T>(doble: ReturnType<typeof vi.fn>, todos: T[]) {
  doble.mockImplementation(async (input: { page?: number; pageSize?: number }) => {
    const page = input?.page ?? 1;
    const pageSize = input?.pageSize ?? PAGE_SIZE;
    const desde = (page - 1) * pageSize;
    return {
      status: "ok",
      items: todos.slice(desde, desde + pageSize),
      page,
      pageSize,
      total: todos.length,
    } satisfies PaginaOk<T>;
  });
}

function envolver(ui: ReactElement) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>{ui}</ToastProvider>
    </SWRConfig>,
  );
}

/** Página 1 tal como la pre-carga el Server Component. */
function pagina1<T>(todos: T[]): { items: T[]; total: number; pageSize: number } {
  return { items: todos.slice(0, PAGE_SIZE), total: todos.length, pageSize: PAGE_SIZE };
}

interface Cola {
  /** Nombre de la cola, tal como la conoce el usuario. */
  nombre: string;
  /** Nombre accesible del `<nav>` de paginación de ESTA cola (R43). */
  paginacion: string;
  /** Nombre accesible de la tabla y de la sección que lleva el contador. */
  seccion: string;
  /** Nombre del control de descarga («Descargar …», R13). */
  descarga: string;
  /** Monta la pantalla con sus 60 filas repartidas en 3 páginas. */
  montar: () => void;
  /** Texto visible y único de la fila `i` del conjunto (1-based). */
  textoFila: (i: number) => string;
}

const COLAS: Cola[] = [
  {
    nombre: "Cierres del día pendientes",
    paginacion: "Paginación de los cierres del día pendientes",
    seccion: "Pendientes de decisión",
    descarga: "Cierres pendientes de decisión",
    textoFila: (i) => `Mensajero ${etiqueta(i)}`,
    montar: () => {
      const todos = conjunto(cierreAdmin);
      servirPaginas(paginado.cierresPendientes, todos);
      servirPaginas(paginado.cierresHistorico, []);
      // Feature 184 — Tanda D (T D.3): de aquí sale el archivo (R52), sin recorte.
      completo.cierresPendientesCompleto.mockResolvedValue({
        status: "ok",
        items: todos,
        total: todos.length,
      });
      completo.cierresAdmin.mockResolvedValue({
        status: "ok",
        pendientes: todos,
        historico: [],
        sinZona: false,
      });
      envolver(
        <CierresAdminModule
          pendientes={pagina1(todos)}
          historico={pagina1([])}
          sinZona={false}
        />,
      );
    },
  },
  {
    nombre: "Cierres de bodega pendientes",
    paginacion: "Paginación de los cierres de bodega pendientes",
    seccion: "Cierres de bodega pendientes",
    descarga: "Cierres de bodega pendientes",
    textoFila: (i) => `Satélite ${etiqueta(i)}`,
    montar: () => {
      const todos = conjunto(cierreBodega);
      servirPaginas(paginado.bodegaPendientes, todos);
      servirPaginas(paginado.bodegaResueltos, []);
      // Feature 184 — Tanda E (T E.3): de aquí sale el archivo (R52), sin recorte.
      completo.bodegaPendientesCompleto.mockResolvedValue({
        status: "ok",
        items: todos,
        total: todos.length,
      });
      completo.bodegaAdmin.mockResolvedValue({
        status: "ok",
        pendientes: todos,
        historico: [],
      });
      envolver(
        <CierresBodegaAdminModule
          pendientes={pagina1(todos)}
          historico={pagina1([])}
        />,
      );
    },
  },
  {
    nombre: "Cierres del día a consolidar",
    paginacion: "Paginación de los cierres del día a consolidar",
    seccion: "Cierres del día a consolidar",
    descarga: "Cierres del día a consolidar",
    textoFila: (i) => `Mensajero ${etiqueta(i)}`,
    montar: () => montarConsolidacion(),
  },
  {
    nombre: "Incidentes pendientes",
    paginacion: "Paginación de los incidentes pendientes",
    seccion: "Pendientes de decisión",
    descarga: "Incidentes pendientes",
    textoFila: (i) => `REM-${etiqueta(i)}`,
    montar: () => montarIncidentes(),
  },
];

/** Montaje de «Cierres del día a consolidar», con sus cinco agregados y su gate de bloqueo. */
function montarConsolidacion() {
  const todos = conjunto(consolidable);
  servirPaginas(paginado.consolidables, todos);
  servirPaginas(paginado.bodegaSolicitados, []);
  // T B.2: de aquí sale el archivo — el conjunto de la zona, sin recorte y con la forma que
  // `filasDesdeResultado` traduce.
  completo.consolidables.mockResolvedValue({
    status: "ok",
    items: todos,
    total: todos.length,
  });
  // El compuesto sigue respondiendo (de él salen los cinco agregados de la cabecera): que el
  // archivo ya no salga de él tiene que ser una decisión de la pantalla, no del doble.
  completo.consolidacion.mockResolvedValue({
    status: "ok",
    consolidables: todos,
    totalesAgregados: AGREGADOS.totales,
    totalPagoMensajeroAgregado: AGREGADOS.pagoMensajero,
    totalIngresoBodegaRechazosAgregado: AGREGADOS.ingresoBodega,
    totalNetoAgregado: AGREGADOS.neto,
    totalCentralDebeAgregado: AGREGADOS.centralDebe,
    puedesSolicitar: false,
    motivoBloqueo: MOTIVO_BLOQUEO,
    cierresBodegaPasados: [],
    sinZona: false,
  });
  envolver(
    <ConsolidacionBodegaModule
      consolidables={pagina1(todos)}
      totalesAgregados={AGREGADOS.totales}
      totalPagoMensajeroAgregado={AGREGADOS.pagoMensajero}
      totalIngresoBodegaRechazosAgregado={AGREGADOS.ingresoBodega}
      totalNetoAgregado={AGREGADOS.neto}
      totalCentralDebeAgregado={AGREGADOS.centralDebe}
      puedesSolicitar={false}
      motivoBloqueo={MOTIVO_BLOQUEO}
      cierresBodegaPasados={pagina1([])}
      sinZona={false}
    />,
  );
}

/** Montaje de «Incidentes pendientes». */
function montarIncidentes() {
  const todos = conjunto(incidente);
  servirPaginas(paginado.incidentesPendientes, todos);
  servirPaginas(paginado.incidentesHistorico, []);
  // Feature 184 — Tanda F (T F.3): de aquí sale el archivo (R52), sin recorte.
  completo.incidentesPendientesCompleto.mockResolvedValue({
    status: "ok",
    items: todos,
    total: todos.length,
  });
  // El compuesto sigue programado, y con las dos mitades dentro: que el archivo ya no salga de
  // él tiene que ser una decisión de la pantalla, no que el doble no responda.
  completo.incidentes.mockResolvedValue({
    status: "ok",
    pendientes: todos,
    historico: [],
    sinZona: false,
  });
  verIncidenteMock.mockImplementation(async ({ incidenteId }: { incidenteId: string }) => ({
    status: "ok" as const,
    incidente: todos.find((i) => i.incidenteId === incidenteId) ?? todos[0],
  }));
  envolver(
    <IncidentesAdminModule
      pendientes={pagina1(todos)}
      historico={pagina1([])}
      sinZona={false}
    />,
  );
}

/**
 * El `<nav>` de la cola, localizado por rol y nombre accesible (R43).
 *
 * `tras Modal` incluye los elementos que un modal abierto deja FUERA del árbol accesible
 * (`aria-hidden`): es lo correcto para el lector de pantalla —mientras el diálogo está
 * abierto, lo de detrás no se anuncia— y lo que necesita el caso (c) de R50, que comprueba
 * que la pantalla de detrás sigue montada y con su estado intacto.
 */
function navDe(cola: Cola, trasModal = false): HTMLElement {
  return screen.getByRole("navigation", { name: cola.paginacion, hidden: trasModal });
}

/** La tabla de la cola. */
function tablaDe(cola: Cola, trasModal = false): HTMLElement {
  return screen.getByRole("table", { name: cola.seccion, hidden: trasModal });
}

beforeEach(() => {
  vi.clearAllMocks();
  buildXlsxRowsMock.mockResolvedValue(new ArrayBuffer(8));
});

afterEach(() => {
  cleanup();
});

describe("Riesgo MEDIO · paginación de las 4 colas con contador de cabecera (T J.2)", () => {
  it("las cuatro están cubiertas: ni una se queda fuera del recorrido", () => {
    // Anti-vacuidad: los tests de abajo recorren `COLAS`. Si alguien borrara una entrada,
    // pasarían igual de verdes sin vigilar esa cola. Los nombres son los del riesgo MEDIO de
    // `design.md §11.3`, escritos aquí para que la lista no sea abstracta.
    expect(COLAS.map((c) => c.nombre)).toEqual([
      "Cierres del día pendientes",
      "Cierres de bodega pendientes",
      "Cierres del día a consolidar",
      "Incidentes pendientes",
    ]);
    // Y ningún control se llama igual que otro: cada una de estas pantallas monta ADEMÁS la
    // tabla que paginó la tanda I, así que conviven dos navegaciones (R43).
    expect(new Set(COLAS.map((c) => c.paginacion)).size).toBe(COLAS.length);
  });

  it("el contador de cabecera muestra el total del servidor, no el tamaño de página (R42)", async () => {
    // EL test de esta task. Dos comprobaciones por cola, y la segunda es la que no se puede
    // esquivar: en la ÚLTIMA página la tabla trae 10 filas y el contador tiene que seguir
    // diciendo 60. Un `({items.length})` diría «(25)» en la primera y «(10)» en la última.
    for (const cola of COLAS) {
      const user = userEvent.setup();
      cola.montar();

      const seccion = screen.getByRole("region", { name: cola.seccion });
      expect(within(seccion).getByText(`(${TOTAL})`), cola.nombre).toBeInTheDocument();
      expect(
        within(seccion).queryByText(`(${PAGE_SIZE})`),
        `${cola.nombre}: el contador muestra el tamaño de la página`,
      ).not.toBeInTheDocument();
      // Y la tabla sí pinta una página: el contador no es el número de filas visibles.
      expect(within(tablaDe(cola)).getAllByRole("row"), cola.nombre).toHaveLength(
        1 + PAGE_SIZE,
      );

      await user.click(within(navDe(cola)).getByRole("button", { name: "Última página" }));
      await waitFor(() => {
        expect(
          within(tablaDe(cola)).getAllByRole("row"),
          `${cola.nombre}: la última página`,
        ).toHaveLength(1 + ULTIMA_PAGINA);
        // Y que la página haya LLEGADO, no que esté llegando: en carga el `DataTable` deja un
        // `<tr>` con `role="status"` y filas skeleton que no cuentan como `row`, así que un
        // conteo solo puede cumplirse a mitad de camino.
        expect(
          within(tablaDe(cola)).queryByRole("status"),
          `${cola.nombre}: se midió con la página en carga`,
        ).not.toBeInTheDocument();
      });

      const ultima = screen.getByRole("region", { name: cola.seccion });
      expect(
        within(ultima).getByText(`(${TOTAL})`),
        `${cola.nombre}: el contador cambió al pasar de página`,
      ).toBeInTheDocument();
      expect(
        within(ultima).queryByText(`(${ULTIMA_PAGINA})`),
        `${cola.nombre}: el contador cuenta las filas de la última página`,
      ).not.toBeInTheDocument();

      cleanup();
      vi.clearAllMocks();
      buildXlsxRowsMock.mockResolvedValue(new ArrayBuffer(8));
    }
  });

  it("cada cola navega entre páginas y su control tiene nombre accesible (R43)", async () => {
    for (const cola of COLAS) {
      const user = userEvent.setup();
      cola.montar();

      // El control se localiza por ROL y NOMBRE, nunca por clase: sin nombre accesible, un
      // lector de pantalla anuncia dos «navegación» idénticas en la misma pantalla.
      const nav = await screen.findByRole("navigation", { name: cola.paginacion });
      expect(
        within(nav).getByText(`1-${PAGE_SIZE} de ${TOTAL}`),
        cola.nombre,
      ).toBeInTheDocument();
      expect(within(tablaDe(cola)).getByText(cola.textoFila(1)), cola.nombre).toBeInTheDocument();
      expect(
        within(tablaDe(cola)).queryByText(cola.textoFila(26)),
        `${cola.nombre}: la página 1 no puede traer filas de la 2`,
      ).not.toBeInTheDocument();

      await user.click(within(nav).getByRole("button", { name: "Página siguiente" }));
      await waitFor(() =>
        expect(
          within(tablaDe(cola)).getByText(cola.textoFila(26)),
          cola.nombre,
        ).toBeInTheDocument(),
      );
      expect(
        within(tablaDe(cola)).queryByText(cola.textoFila(1)),
        `${cola.nombre}: la página 2 sigue mostrando filas de la 1`,
      ).not.toBeInTheDocument();
      expect(
        within(nav).getByText(`${PAGE_SIZE + 1}-${2 * PAGE_SIZE} de ${TOTAL}`),
        cola.nombre,
      ).toBeInTheDocument();

      // Y se puede volver: la navegación no es de ida.
      await user.click(within(nav).getByRole("button", { name: "Página anterior" }));
      await waitFor(() =>
        expect(
          within(tablaDe(cola)).getByText(cola.textoFila(1)),
          cola.nombre,
        ).toBeInTheDocument(),
      );

      cleanup();
      vi.clearAllMocks();
      buildXlsxRowsMock.mockResolvedValue(new ArrayBuffer(8));
    }
  });

  it("el usuario ve exactamente las mismas filas que antes en la página 1 (R44)", () => {
    // SIN `await`, y es la mitad del test: las filas tienen que estar en el PRIMER pintado, el
    // mismo en el que estaban antes de paginar. En la tanda I, quitar el `fallbackData` pasó
    // VERDE con un `await` por delante —la pantalla enseñaba un esqueleto y las filas llegaban
    // después de un viaje al servidor por un dato que ya venía en la respuesta—. Aquí no.
    for (const cola of COLAS) {
      cola.montar();

      const tabla = tablaDe(cola);
      expect(within(tabla).getAllByRole("row"), cola.nombre).toHaveLength(1 + PAGE_SIZE);
      for (const i of [1, 2, PAGE_SIZE]) {
        expect(
          within(tabla).getByText(cola.textoFila(i)),
          `${cola.nombre}: falta la fila ${i} de la página 1`,
        ).toBeInTheDocument();
      }
      expect(
        within(tabla).queryByText(cola.textoFila(PAGE_SIZE + 1)),
        `${cola.nombre}: la página 1 trae una fila que no le toca`,
      ).not.toBeInTheDocument();

      // El orden es el del servidor, no uno reconstruido en la pantalla.
      const filas = within(tabla).getAllByRole("row").slice(1);
      expect(filas[0].textContent, cola.nombre).toContain(cola.textoFila(1));
      expect(filas[PAGE_SIZE - 1].textContent, cola.nombre).toContain(
        cola.textoFila(PAGE_SIZE),
      );

      cleanup();
      vi.clearAllMocks();
    }
  });

  it("la descarga sigue entregando el dataset completo (R52)", async () => {
    // Se descarga DESDE LA PÁGINA 2 a propósito: si el archivo saliera de lo que la tabla
    // pinta, traería 25 filas (las 26-50) y parecería correcto a simple vista. Se exigen las
    // 60, empezando por la fila 1 —que en ese momento NO está en pantalla— y terminando en la
    // 60.
    for (const cola of COLAS) {
      const user = userEvent.setup();
      cola.montar();

      await user.click(
        within(navDe(cola)).getByRole("button", { name: "Página siguiente" }),
      );
      await waitFor(() =>
        expect(
          within(tablaDe(cola)).getByText(cola.textoFila(26)),
          cola.nombre,
        ).toBeInTheDocument(),
      );

      await user.click(screen.getByRole("button", { name: `Descargar ${cola.descarga}` }));
      await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));

      const [, filas] = buildXlsxRowsMock.mock.calls[0];
      expect(filas, `${cola.nombre}: el archivo trae la PÁGINA, no el conjunto`).toHaveLength(
        TOTAL,
      );
      const valores = filas.map((f) => Object.values(f).map(String).join(" "));
      expect(valores[0], `${cola.nombre}: la primera fila del archivo`).toContain(
        cola.textoFila(1),
      );
      expect(valores.at(-1), `${cola.nombre}: la última fila del archivo`).toContain(
        cola.textoFila(TOTAL),
      );
      expect(descargarBlobMock).toHaveBeenCalledTimes(1);

      cleanup();
      vi.clearAllMocks();
      buildXlsxRowsMock.mockResolvedValue(new ArrayBuffer(8));
    }
  });

  it("cambiar de página no altera los totales, los avisos de bloqueo ni los formularios (R50)", async () => {
    // Tres cosas, en las dos pantallas donde existen.
    //
    // (a) LOS TOTALES DE DINERO, en «Cierres del día a consolidar». Es el punto rojo de la
    //     tanda: los cinco agregados llegan por props calculados sobre el conjunto completo y
    //     la página no los toca. Se afirman sus valores exactos ANTES y DESPUÉS de paginar, y
    //     además que NINGUNO de los números que produciría una suma sobre la página visible
    //     aparece en pantalla.
    const user = userEvent.setup();
    montarConsolidacion();

    const dineroVisible = () => ({
      general: within(
        screen.getByRole("region", { name: "Totales a consolidar" }),
      ).getByText(money(AGREGADOS.totales.general)),
      neto: within(
        screen.getByRole("region", { name: "Totales a consolidar" }),
      ).getByText(money(AGREGADOS.neto)),
      pago: within(
        screen.getByRole("region", { name: "Pago a mensajeros a consolidar" }),
      ).getByText(money(AGREGADOS.pagoMensajero)),
      ingreso: within(
        screen.getByRole("region", { name: "Ingreso de bodega por rechazos a consolidar" }),
      ).getByText(money(AGREGADOS.ingresoBodega)),
      centralDebe: within(
        screen.getByRole("region", { name: "Central debe" }),
      ).getByText(money(AGREGADOS.centralDebe)),
    });

    expect(dineroVisible().centralDebe).toBeInTheDocument();
    for (const dePagina of AGREGADOS_DE_LA_PAGINA) {
      expect(
        screen.queryByText(dePagina),
        `un agregado salió de la página visible: ${dePagina}`,
      ).not.toBeInTheDocument();
    }

    // (b) EL AVISO DE BLOQUEO: el gate `puedesSolicitar`/`motivoBloqueo` es del conjunto, no
    //     de la página. Si desapareciera al paginar, el botón se habilitaría solo.
    const bloqueo = screen.getByRole("note");
    expect(bloqueo).toHaveTextContent(MOTIVO_BLOQUEO);
    expect(
      screen.getByRole("button", { name: "Solicitar cierre de bodega" }),
    ).toBeDisabled();

    const consolidar = COLAS[2];
    await user.click(
      within(navDe(consolidar)).getByRole("button", { name: "Página siguiente" }),
    );
    await waitFor(() =>
      expect(
        within(tablaDe(consolidar)).getByText(consolidar.textoFila(26)),
      ).toBeInTheDocument(),
    );

    // Los cinco siguen ahí, con el MISMO valor, y el aviso también.
    expect(dineroVisible().general).toBeInTheDocument();
    expect(dineroVisible().neto).toBeInTheDocument();
    expect(dineroVisible().pago).toBeInTheDocument();
    expect(dineroVisible().ingreso).toBeInTheDocument();
    expect(dineroVisible().centralDebe).toBeInTheDocument();
    for (const dePagina of AGREGADOS_DE_LA_PAGINA) {
      expect(
        screen.queryByText(dePagina),
        `tras paginar, un agregado salió de la página visible: ${dePagina}`,
      ).not.toBeInTheDocument();
    }
    expect(screen.getByRole("note")).toHaveTextContent(MOTIVO_BLOQUEO);
    expect(
      screen.getByRole("button", { name: "Solicitar cierre de bodega" }),
    ).toBeDisabled();

    cleanup();
    vi.clearAllMocks();

    // (c) EL FORMULARIO EN CURSO, en «Incidentes pendientes»: el monto de la indemnización ya
    //     tecleado no puede perderse porque la tabla de detrás cambie de página. El control se
    //     acciona con `fireEvent` porque el sub-modal está encima: lo que se prueba es que la
    //     página no reinicia el estado del módulo, no que se pueda pulsar a través del modal.
    const user2 = userEvent.setup();
    montarIncidentes();
    const incidentes = COLAS[3];

    await user2.click(
      screen.getByRole("button", { name: "Ver o decidir el incidente de la orden REM-01" }),
    );
    await screen.findByText("Detalle del incidente");
    await user2.click(screen.getByRole("button", { name: "Aprobar" }));
    const monto = await screen.findByLabelText(MONTO_LABEL);
    await user2.type(monto, "2500.00");
    expect(monto).toHaveValue("2500.00");

    fireEvent.click(
      within(navDe(incidentes, true)).getByRole("button", {
        name: "Página siguiente",
        hidden: true,
      }),
    );
    await waitFor(() =>
      expect(
        within(tablaDe(incidentes, true)).getByText(incidentes.textoFila(26)),
      ).toBeInTheDocument(),
    );

    expect(
      screen.getByLabelText(MONTO_LABEL),
      "el monto tecleado se perdió al cambiar de página",
    ).toHaveValue("2500.00");
    expect(screen.getByText("Detalle del incidente")).toBeInTheDocument();
  });
});
