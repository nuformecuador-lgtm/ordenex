// @vitest-environment jsdom
// Feature 170 — FASE 2, T I.2 (R43/R44/R52) — los SIETE listados de riesgo BAJO
// (`design.md §11.3`) pasan a paginación server-side: cierres del día histórico, cierres de
// bodega resueltos, cierres de bodega solicitados, cierres solicitados del mensajero,
// incidentes histórico, saldos de tiendas y plantillas de gasto fijo.
//
// Los tres riesgos que este archivo cierra, y que NINGÚN test de servicio puede cerrar:
//
//  1. R43 — que haya un control de navegación y que se pueda ENCONTRAR: por rol y nombre, no
//     por clase CSS. Siete tablas repartidas en cinco pantallas, y en dos de ellas conviven
//     varias: un control llamado «Paginación» siete veces no dice cuál es cuál.
//  2. R52 — que la descarga SIGA entregando el conjunto completo. Es el riesgo caro: la FASE 1
//     entregó la descarga del dataset entero, y al paginar la tabla la forma «natural» de
//     cablearla —proyectar lo que la tabla pinta— la degrada a «descargá lo que se ve» sin que
//     nada falle: el archivo sale, con 25 filas de 60. Aquí se descarga DESDE LA PÁGINA 2, que
//     es donde la degradación sería más evidente y a la vez más fácil de no notar.
//  3. R44 — que el usuario vea EXACTAMENTE las mismas filas que antes en la página 1. El
//     acotamiento por rol se prueba en el servicio (T I.1); lo que se prueba aquí es que la
//     pantalla pinta la página que el servidor le dio, entera y en su orden, sin recortarla,
//     reordenarla ni completarla por su cuenta.
//
// Cómo está montado: un conjunto de 60 filas por listado, `pageSize` 25 → 3 páginas. El doble
// de la Server Action paginada RECORTA de verdad ese conjunto (no devuelve una lista fija), así
// que navegar cambia las filas; el doble del listado sin paginar devuelve las 60, que es lo que
// la descarga debe entregar.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

import { ToastProvider } from "@/providers/ToastProvider";
import { descargarBlob } from "@/components/shared/descargar-blob";
import { buildXlsxRows } from "@/lib/utils/xlsx-template";
// Feature 201: el texto esperado de la fila se DERIVA del mismo importe que arma el doble
// (`totales.general`), con el formateador de la app. Lo que mide es QUÉ fila salió en cada
// página, no cómo se escribe un importe.
import { money } from "@/lib/config/moneda";
import type { CierreAdminResumen } from "@/lib/interfaces/services/ICierresAdminService";
import type { CierreBodegaResumen } from "@/lib/interfaces/services/ICierreBodegaService";
import type {
  CierreGrupos,
  CierrePasadoDTO,
  CierreTotales,
} from "@/lib/interfaces/services/ICierreDiaService";
import type { IncidenteAdminDTO } from "@/lib/interfaces/services/IIncidenteAdminService";
import type { SaldoTiendaResumenDTO } from "@/lib/types/wallet-tienda";
import type { GastoFijoPlantillaDTO } from "@/lib/types/gasto-fijo-plantilla";

// --- Dobles ---------------------------------------------------------------

const { paginado, completo } = vi.hoisted(() => ({
  /** Un doble por listado paginado (lo que la tabla pinta). */
  paginado: {
    cierresHistorico: vi.fn(),
    cierresPendientes: vi.fn(),
    bodegaPendientes: vi.fn(),
    consolidables: vi.fn(),
    incidentesPendientes: vi.fn(),
    bodegaResueltos: vi.fn(),
    bodegaSolicitados: vi.fn(),
    cierresPasados: vi.fn(),
    incidentesHistorico: vi.fn(),
    saldos: vi.fn(),
    plantillas: vi.fn(),
  },
  /** Un doble por listado SIN recorte (lo que la descarga debe entregar, R52). */
  completo: {
    cierresAdmin: vi.fn(),
    // Feature 184 — Tanda D (T D.3): «Cierres del día — histórico» ya no saca su archivo del
    // listado compuesto (`cierresAdmin`), que traía la cola además del histórico, sino de su
    // lectura DEDICADA. El doble del compuesto se conserva: la pantalla lo seguía usando y su
    // ausencia no puede ser lo que explique que ya no se llame.
    cierresHistoricoCompleto: vi.fn(),
    bodegaAdmin: vi.fn(),
    // Feature 184 — Tanda E (T E.3): «Cierres de bodega resueltos» ya no saca su archivo del
    // listado compuesto (`bodegaAdmin`), que traía la cola además del histórico, sino de su
    // lectura DEDICADA. El doble del compuesto se conserva: la pantalla lo seguía usando y su
    // ausencia no puede ser lo que explique que ya no se llame.
    bodegaHistoricoCompleto: vi.fn(),
    consolidacion: vi.fn(),
    // Feature 184 — Tanda B (T B.2): «Cierres de bodega solicitados» ya no saca su archivo del
    // listado compuesto (`consolidacion`), sino de su lectura DEDICADA. El doble del compuesto
    // se conserva porque esa pantalla lo sigue usando para lo demás.
    bodegaSolicitados: vi.fn(),
    cierreDia: vi.fn(),
    // Feature 184 — Tanda C (T C.2): «Cierres solicitados del mensajero» tampoco saca su archivo
    // del listado compuesto (`cierreDia`) —el que firmaba las URL de evidencia— sino de su
    // lectura DEDICADA. El doble del compuesto se conserva: la pantalla lo seguía usando y su
    // ausencia no puede ser lo que explique que ya no se llame.
    cierresPasadosCompleto: vi.fn(),
    incidentes: vi.fn(),
    // Feature 184 — Tanda F (T F.3): «Incidentes — histórico» ya no saca su archivo del listado
    // compuesto (`incidentes`), que traía la cola de pendientes además del histórico, sino de
    // su lectura DEDICADA. El doble del compuesto se conserva: la pantalla lo seguía usando y
    // su ausencia no puede ser lo que explique que ya no se llame.
    incidentesHistoricoCompleto: vi.fn(),
    saldos: vi.fn(),
    // Feature 184 — Tanda G (T G.2): «Saldos de tiendas» y «Plantillas de gasto fijo» sacan su
    // archivo de su lectura DEDICADA. Aquí el doble viejo NO traía otra mitad —los dos listados
    // devuelven las mismas filas—, así que se conserva por el mismo motivo de siempre: que ya no
    // se llame tiene que ser una decisión de la pantalla, no que el doble no responda.
    saldosCompleto: vi.fn(),
    plantillas: vi.fn(),
    plantillasCompleto: vi.fn(),
  },
}));

vi.mock("@/lib/actions/cierres-admin", () => ({
  verCierreDetalle: vi.fn(),
  aprobarCierre: vi.fn(),
  rechazarCierre: vi.fn(),
  forzarSolicitudVencido: vi.fn(),
  listarCierresAdmin: (...a: unknown[]) => completo.cierresAdmin(...a),
  // Feature 184 — Tanda D (T D.3): la lectura dedicada del listado 2. Sin declararla aquí, el
  // control de descarga de esa tabla llama a `undefined` y el archivo no sale.
  listarHistoricoCierresAdminCompleto: (...a: unknown[]) =>
    completo.cierresHistoricoCompleto(...a),
  listarHistoricoCierresAdminPaginado: (...a: unknown[]) =>
    paginado.cierresHistorico(...a),
  // Feature 170 — FASE 2 (T J.2): las cuatro COLAS de riesgo MEDIO también paginan. Aquí se
  // programan VACÍAS: este archivo habla de los siete listados de riesgo BAJO, y sin el doble
  // la cola de la misma pantalla se quedaría en un esqueleto de carga permanente.
  listarPendientesCierresAdminPaginado: (...a: unknown[]) =>
    paginado.cierresPendientes(...a),
}));
vi.mock("@/lib/actions/cierre-bodega", () => ({
  verCierreBodegaDetalle: vi.fn(),
  aprobarCierreBodega: vi.fn(),
  rechazarCierreBodega: vi.fn(),
  solicitarCierreBodega: vi.fn(),
  listarCierresBodegaAdmin: (...a: unknown[]) => completo.bodegaAdmin(...a),
  listarConsolidacion: (...a: unknown[]) => completo.consolidacion(...a),
  // Feature 184 — Tanda B (T B.2): la lectura dedicada del listado 6. Sin declararla aquí, el
  // control de descarga de esa tabla llama a `undefined` y el archivo no sale.
  listarCierresBodegaSolicitadosCompleto: (...a: unknown[]) =>
    completo.bodegaSolicitados(...a),
  // Feature 184 — Tanda E (T E.3): la lectura dedicada del listado 5. Sin declararla aquí, el
  // control de descarga de esa tabla llama a `undefined` y el archivo no sale.
  listarHistoricoCierresBodegaCompleto: (...a: unknown[]) =>
    completo.bodegaHistoricoCompleto(...a),
  listarHistoricoCierresBodegaPaginado: (...a: unknown[]) =>
    paginado.bodegaResueltos(...a),
  listarCierresBodegaSolicitadosPaginado: (...a: unknown[]) =>
    paginado.bodegaSolicitados(...a),
  listarPendientesCierresBodegaPaginado: (...a: unknown[]) =>
    paginado.bodegaPendientes(...a),
  listarConsolidablesPaginado: (...a: unknown[]) => paginado.consolidables(...a),
}));
vi.mock("@/lib/actions/cierre-dia", () => ({
  solicitarCierre: vi.fn(),
  deshacerGestion: vi.fn(),
  listarCierreDia: (...a: unknown[]) => completo.cierreDia(...a),
  listarCierresPasadosPaginado: (...a: unknown[]) => paginado.cierresPasados(...a),
  // Feature 184 — Tanda C (T C.2): la lectura dedicada del listado 1. Sin declararla aquí, el
  // control de descarga de esa tabla llama a `undefined` y el archivo no sale.
  listarCierresPasadosCompleto: (...a: unknown[]) => completo.cierresPasadosCompleto(...a),
}));
vi.mock("@/lib/actions/incidentes", () => ({
  verIncidente: vi.fn(),
  aprobarIncidente: vi.fn(),
  rechazarIncidente: vi.fn(),
  retractarIncidente: vi.fn(),
  reportarIncidente: vi.fn(),
  listarIncidentes: (...a: unknown[]) => completo.incidentes(...a),
  // Feature 184 — Tanda F (T F.3): la lectura dedicada del listado 9. Sin declararla aquí, el
  // control de descarga de esa tabla llama a `undefined` y el archivo no sale.
  listarHistoricoIncidentesCompleto: (...a: unknown[]) =>
    completo.incidentesHistoricoCompleto(...a),
  listarHistoricoIncidentesPaginado: (...a: unknown[]) =>
    paginado.incidentesHistorico(...a),
  listarPendientesIncidentesPaginado: (...a: unknown[]) =>
    paginado.incidentesPendientes(...a),
}));
vi.mock("@/lib/actions/wallet-tienda", () => ({
  listarSaldosTiendasAction: (...a: unknown[]) => completo.saldos(...a),
  // Feature 184 — Tanda G (T G.2): la lectura dedicada del listado 12. Sin declararla aquí, el
  // control de descarga de esa tabla llama a `undefined` y el archivo no sale.
  listarSaldosTiendasCompletoAction: (...a: unknown[]) => completo.saldosCompleto(...a),
  listarSaldosTiendasPaginadoAction: (...a: unknown[]) => paginado.saldos(...a),
  listarMovimientosDeTiendaAction: vi.fn(),
  listarMovimientosDeTiendaCompletoAction: vi.fn(),
}));
vi.mock("@/lib/actions/gasto-fijo-plantilla", () => ({
  crearPlantillaAction: vi.fn(),
  actualizarPlantillaAction: vi.fn(),
  setActivaPlantillaAction: vi.fn(),
  listarPlantillasAction: (...a: unknown[]) => completo.plantillas(...a),
  // Feature 184 — Tanda G (T G.2): la lectura dedicada del listado 11. Ídem.
  listarPlantillasCompletoAction: (...a: unknown[]) => completo.plantillasCompleto(...a),
  listarPlantillasPaginadoAction: (...a: unknown[]) => paginado.plantillas(...a),
}));

// El desglove por fila de saldos tiene su propia lectura y sus propios tests: se stubbea para
// que este archivo hable solo de la paginación de la tabla que lo contiene.
vi.mock("@/app/(app)/wallet/tiendas/_components/DesgloseMovimientosTienda", () => ({
  DesgloseMovimientosTienda: () => <div data-testid="desglose-stub" />,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
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
import { CierreDiaModule } from "@/app/(app)/cierre-dia/_components/CierreDiaModule";
import { IncidentesAdminModule } from "@/app/(app)/incidentes/_components/IncidentesAdminModule";
import { SaldosTiendasTable } from "@/app/(app)/wallet/tiendas/_components/SaldosTiendasTable";
import { GastosFijosPlantillasPanel } from "@/app/(app)/wallet/_components/GastosFijosPlantillasPanel";

// --- Datos ---------------------------------------------------------------

/** Conjunto completo de cada listado y tamaño de página: 60 filas en 3 páginas de 25. */
const TOTAL = 60;
const PAGE_SIZE = 25;

const TOTALES: CierreTotales = {
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
    estado: "aprobado",
    destinoTipo: "bodega_central",
    destinoZonaId: "z1",
    destinoZonaNombre: "Central",
    totales: TOTALES,
    totalPagoMensajero: "0.00",
    totalIngresoBodegaRechazos: "0.00",
    pendientePagoMensajero: "0.00", // feature 172/T C.2: aprobado y sin nada que liquidar
    solicitadoAt: "2026-07-11T10:00:00.000Z",
    resueltoAt: "2026-07-12T10:00:00.000Z",
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
    estado: "rechazado",
    totales: TOTALES,
    totalPagoMensajero: "0.00",
    totalIngresoBodegaRechazos: "0.00",
    cantidadCierres: 1,
    solicitadoAt: "2026-07-11T10:00:00.000Z",
    resueltoAt: "2026-07-12T10:00:00.000Z",
    motivoRechazo: `Motivo ${etiqueta(i)}`,
  };
}

function cierrePasado(i: number): CierrePasadoDTO {
  return {
    cierreId: `cp-${i}`,
    estado: "aprobado",
    destinoTipo: "bodega_central",
    destinoZonaId: "z1",
    totales: { ...TOTALES, general: `${1000 + i}.00` },
    totalPagoMensajero: "0.00",
    totalIngresoBodegaRechazos: "0.00",
    solicitadoAt: "2026-07-11T10:00:00.000Z",
  };
}

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
    estado: "aprobado",
    indemnizacion: "100.00",
    reportadoPorNombre: "Beto Mensajero",
    resueltoPorNombre: "Maestra Ordenex",
    resueltoAt: "2026-07-12T10:00:00.000Z",
    motivoRechazo: null,
    createdAt: "2026-07-11T10:00:00.000Z",
    evidenciaUrls: [],
    esPropio: false,
  };
}

function saldoTienda(i: number): SaldoTiendaResumenDTO {
  return {
    tiendaId: `t-${i}`,
    tiendaNombre: `Tienda ${etiqueta(i)}`,
    saldo: "10.00",
    signo: "positivo",
  };
}

function plantilla(i: number): GastoFijoPlantillaDTO {
  return {
    id: `p-${i}`,
    concepto: `Concepto ${etiqueta(i)}`,
    monto: "10.00",
    activa: true,
    periodicidadUnidad: "meses",
    periodicidadCantidad: 1,
    fechaCobro: "2026-07-01",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
  };
}

function conjunto<T>(fila: (i: number) => T): T[] {
  return Array.from({ length: TOTAL }, (_, k) => fila(k + 1));
}

function gruposVacios(): CierreGrupos {
  return { entregada: [], reprogramada: [], devuelta: [], rechazada: [], incidente: [] };
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
 * Programa el doble de una Server Action paginada para que RECORTE de verdad el conjunto.
 * Es lo que hace que «ir a la página siguiente» cambie las filas: un doble que devolviera
 * siempre la misma lista dejaría pasar una paginación que no navega a ninguna parte.
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

interface Listado {
  /** Nombre del listado, tal como lo conoce el usuario. */
  nombre: string;
  /** Nombre accesible del `<nav>` de paginación (R43). */
  paginacion: string;
  /** Nombre accesible de la tabla. */
  tabla: string;
  /** Nombre del control de descarga («Descargar …», R13). */
  descarga: string;
  /** Monta la pantalla con sus 60 filas repartidas en 3 páginas. */
  montar: () => void;
  /** Texto visible y único de la fila `i` del conjunto (1-based). */
  textoFila: (i: number) => string;
}

const LISTADOS: Listado[] = [
  {
    nombre: "Cierres del día — histórico",
    paginacion: "Paginación del histórico de cierres del día",
    tabla: "Histórico",
    descarga: "Cierres del día resueltos",
    textoFila: (i) => `Mensajero ${etiqueta(i)}`,
    montar: () => {
      const todos = conjunto(cierreAdmin);
      servirPaginas(paginado.cierresHistorico, todos);
      servirPaginas(paginado.cierresPendientes, []);
      // Feature 184 — Tanda D (T D.3): de aquí sale el archivo (R52), sin recorte.
      completo.cierresHistoricoCompleto.mockResolvedValue({
        status: "ok",
        items: todos,
        total: todos.length,
      });
      completo.cierresAdmin.mockResolvedValue({
        status: "ok",
        pendientes: [],
        historico: todos,
        sinZona: false,
      });
      envolver(
        <CierresAdminModule
          pendientes={pagina1([])}
          historico={pagina1(todos)}
          sinZona={false}
        />,
      );
    },
  },
  {
    nombre: "Cierres de bodega resueltos",
    paginacion: "Paginación de los cierres de bodega resueltos",
    tabla: "Cierres de bodega resueltos",
    descarga: "Cierres de bodega resueltos",
    textoFila: (i) => `Satélite ${etiqueta(i)}`,
    montar: () => {
      const todos = conjunto(cierreBodega);
      servirPaginas(paginado.bodegaResueltos, todos);
      servirPaginas(paginado.bodegaPendientes, []);
      // Feature 184 — Tanda E (T E.3): de aquí sale el archivo (R52), sin recorte.
      completo.bodegaHistoricoCompleto.mockResolvedValue({
        status: "ok",
        items: todos,
        total: todos.length,
      });
      completo.bodegaAdmin.mockResolvedValue({
        status: "ok",
        pendientes: [],
        historico: todos,
      });
      envolver(
        <CierresBodegaAdminModule
          pendientes={pagina1([])}
          historico={pagina1(todos)}
        />,
      );
    },
  },
  {
    nombre: "Cierres de bodega solicitados",
    paginacion: "Paginación de los cierres de bodega solicitados",
    tabla: "Cierres de bodega solicitados",
    descarga: "Cierres de bodega solicitados",
    textoFila: (i) => `Motivo ${etiqueta(i)}`,
    montar: () => {
      const todos = conjunto(cierreBodega);
      servirPaginas(paginado.bodegaSolicitados, todos);
      servirPaginas(paginado.consolidables, []);
      // T B.2: de aquí sale el archivo — el conjunto de la zona, sin recorte y con la forma
      // que `filasDesdeResultado` traduce.
      completo.bodegaSolicitados.mockResolvedValue({
        status: "ok",
        items: todos,
        total: todos.length,
      });
      // El compuesto sigue respondiendo (la pantalla lo usa para sus agregados): que el archivo
      // ya no salga de él tiene que ser una decisión de la pantalla, no del doble.
      completo.consolidacion.mockResolvedValue({
        status: "ok",
        consolidables: [],
        totalesAgregados: TOTALES,
        totalPagoMensajeroAgregado: "0.00",
        totalIngresoBodegaRechazosAgregado: "0.00",
        totalNetoAgregado: "0.00",
        totalCentralDebeAgregado: "0.00",
        puedesSolicitar: false,
        motivoBloqueo: null,
        cierresBodegaPasados: todos,
        sinZona: false,
      });
      envolver(
        <ConsolidacionBodegaModule
          consolidables={pagina1([])}
          totalesAgregados={TOTALES}
          totalPagoMensajeroAgregado="0.00"
          totalIngresoBodegaRechazosAgregado="0.00"
          totalNetoAgregado="0.00"
          totalCentralDebeAgregado="0.00"
          puedesSolicitar={false}
          motivoBloqueo={null}
          cierresBodegaPasados={pagina1(todos)}
          sinZona={false}
        />,
      );
    },
  },
  {
    nombre: "Cierres solicitados del mensajero",
    paginacion: "Paginación de los cierres solicitados",
    tabla: "Cierres solicitados",
    descarga: "Cierres solicitados",
    textoFila: (i) => money(`${1000 + i}.00`),
    montar: () => {
      const todos = conjunto(cierrePasado);
      servirPaginas(paginado.cierresPasados, todos);
      // T C.2: de aquí sale el archivo — el conjunto de ESTE mensajero, sin recorte y con la
      // forma que `filasDesdeResultado` traduce.
      completo.cierresPasadosCompleto.mockResolvedValue({
        status: "ok",
        items: todos,
        total: todos.length,
      });
      // El compuesto sigue respondiendo: que el archivo ya no salga de él tiene que ser una
      // decisión de la pantalla, no del doble.
      completo.cierreDia.mockResolvedValue({
        status: "ok",
        grupos: gruposVacios(),
        totales: TOTALES,
        totalPagoMensajero: "0.00",
        totalIngresoBodegaRechazos: "0.00",
        puedesSolicitar: false,
        motivoBloqueo: null,
        cierresPasados: todos,
        tieneVencido: false,
        tieneRechazado: false,
      });
      envolver(
        <CierreDiaModule
          grupos={gruposVacios()}
          totales={TOTALES}
          totalPagoMensajero="0.00"
          puedesSolicitar={false}
          motivoBloqueo={null}
          cierresPasados={pagina1(todos)}
          bloqueado={false}
          tieneVencido={false}
          tieneRechazado={false}
        />,
      );
    },
  },
  {
    nombre: "Incidentes — histórico",
    paginacion: "Paginación del histórico de incidentes",
    tabla: "Histórico",
    descarga: "Incidentes resueltos",
    textoFila: (i) => `REM-${etiqueta(i)}`,
    montar: () => {
      const todos = conjunto(incidente);
      servirPaginas(paginado.incidentesHistorico, todos);
      servirPaginas(paginado.incidentesPendientes, []);
      // Feature 184 — Tanda F (T F.3): de aquí sale el archivo (R52), sin recorte.
      completo.incidentesHistoricoCompleto.mockResolvedValue({
        status: "ok",
        items: todos,
        total: todos.length,
      });
      // El compuesto sigue programado: que el archivo ya no salga de él tiene que ser una
      // decisión de la pantalla, no que el doble no responda.
      completo.incidentes.mockResolvedValue({
        status: "ok",
        pendientes: [],
        historico: todos,
        sinZona: false,
      });
      envolver(
        <IncidentesAdminModule
          pendientes={pagina1([])}
          historico={pagina1(todos)}
          sinZona={false}
        />,
      );
    },
  },
  {
    nombre: "Saldos de tiendas",
    paginacion: "Paginación de los saldos por tienda",
    tabla: "Saldos de tiendas",
    descarga: "Saldos de tiendas",
    textoFila: (i) => `Tienda ${etiqueta(i)}`,
    montar: () => {
      const todos = conjunto(saldoTienda);
      servirPaginas(paginado.saldos, todos);
      // Feature 184 — Tanda G (T G.2): de aquí sale el archivo (R52), sin recorte.
      completo.saldosCompleto.mockResolvedValue({
        status: "ok",
        items: todos,
        total: todos.length,
      });
      completo.saldos.mockResolvedValue({ status: "ok", tiendas: todos });
      envolver(<SaldosTiendasTable initialData={pagina1(todos)} />);
    },
  },
  {
    nombre: "Plantillas de gasto fijo",
    paginacion: "Paginación de las plantillas de gasto fijo",
    tabla: "Plantillas de gasto fijo",
    descarga: "Plantillas de gasto fijo",
    textoFila: (i) => `Concepto ${etiqueta(i)}`,
    montar: () => {
      const todos = conjunto(plantilla);
      servirPaginas(paginado.plantillas, todos);
      // Feature 184 — Tanda G (T G.2): de aquí sale el archivo (R52), sin recorte.
      completo.plantillasCompleto.mockResolvedValue({
        status: "ok",
        items: todos,
        total: todos.length,
      });
      completo.plantillas.mockResolvedValue({ status: "ok", plantillas: todos });
      envolver(<GastosFijosPlantillasPanel initialData={pagina1(todos)} />);
    },
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  buildXlsxRowsMock.mockResolvedValue(new ArrayBuffer(8));
});

afterEach(() => {
  cleanup();
});

describe("Riesgo BAJO · paginación server-side de los 7 listados (T I.2)", () => {
  it("los siete están cubiertos: ni uno se queda fuera del recorrido", () => {
    // Anti-vacuidad: los tres tests de abajo recorren `LISTADOS`. Si alguien borrara una
    // entrada, pasarían igual de verdes sin vigilar ese listado. Los nombres son los del
    // riesgo BAJO de `design.md §11.3`, escritos aquí para que la lista no sea abstracta.
    expect(LISTADOS.map((l) => l.nombre)).toEqual([
      "Cierres del día — histórico",
      "Cierres de bodega resueltos",
      "Cierres de bodega solicitados",
      "Cierres solicitados del mensajero",
      "Incidentes — histórico",
      "Saldos de tiendas",
      "Plantillas de gasto fijo",
    ]);
    // Y ningún control de paginación se llama igual que otro: en `cierres-admin` conviven
    // tres, y «Paginación» a secas no diría cuál es cuál (R43).
    expect(new Set(LISTADOS.map((l) => l.paginacion)).size).toBe(LISTADOS.length);
  });

  it("cada listado navega entre páginas y el control tiene nombre accesible (R43)", async () => {
    for (const listado of LISTADOS) {
      const user = userEvent.setup();
      listado.montar();

      // El control se localiza por ROL y NOMBRE, nunca por clase: si no tiene nombre
      // accesible, un lector de pantalla anuncia siete «navegación» idénticas.
      const nav = await screen.findByRole("navigation", { name: listado.paginacion });
      expect(
        within(nav).getByText(`1-${PAGE_SIZE} de ${TOTAL}`),
        listado.nombre,
      ).toBeInTheDocument();

      const tabla = screen.getByRole("table", { name: listado.tabla });
      expect(within(tabla).getByText(listado.textoFila(1)), listado.nombre).toBeInTheDocument();
      expect(
        within(tabla).queryByText(listado.textoFila(26)),
        `${listado.nombre}: la página 1 no puede traer filas de la 2`,
      ).not.toBeInTheDocument();

      await user.click(within(nav).getByRole("button", { name: "Página siguiente" }));

      // La página 2 trae SUS filas y ninguna de la 1.
      await waitFor(() =>
        expect(
          within(screen.getByRole("table", { name: listado.tabla })).getByText(
            listado.textoFila(26),
          ),
          listado.nombre,
        ).toBeInTheDocument(),
      );
      expect(
        within(screen.getByRole("table", { name: listado.tabla })).queryByText(
          listado.textoFila(1),
        ),
        `${listado.nombre}: la página 2 sigue mostrando filas de la 1`,
      ).not.toBeInTheDocument();
      expect(
        within(nav).getByText(`${PAGE_SIZE + 1}-${2 * PAGE_SIZE} de ${TOTAL}`),
        listado.nombre,
      ).toBeInTheDocument();

      // Y se puede volver: la navegación no es de ida.
      await user.click(within(nav).getByRole("button", { name: "Página anterior" }));
      await waitFor(() =>
        expect(
          within(screen.getByRole("table", { name: listado.tabla })).getByText(
            listado.textoFila(1),
          ),
          listado.nombre,
        ).toBeInTheDocument(),
      );

      cleanup();
      vi.clearAllMocks();
      buildXlsxRowsMock.mockResolvedValue(new ArrayBuffer(8));
    }
  });

  it("la descarga sigue entregando el dataset completo, no la página (R52)", async () => {
    // EL test crítico de esta task. Se descarga DESDE LA PÁGINA 2 a propósito: si el archivo
    // saliera de lo que la tabla pinta, traería 25 filas (las 26-50) y parecería correcto a
    // simple vista. Se exigen las 60, empezando por la fila 1 —que en ese momento NO está en
    // pantalla— y terminando en la 60.
    for (const listado of LISTADOS) {
      const user = userEvent.setup();
      listado.montar();

      const nav = await screen.findByRole("navigation", { name: listado.paginacion });
      await user.click(within(nav).getByRole("button", { name: "Página siguiente" }));
      await waitFor(() =>
        expect(
          within(screen.getByRole("table", { name: listado.tabla })).getByText(
            listado.textoFila(26),
          ),
          listado.nombre,
        ).toBeInTheDocument(),
      );

      await user.click(
        screen.getByRole("button", { name: `Descargar ${listado.descarga}` }),
      );
      await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));

      const [, filas] = buildXlsxRowsMock.mock.calls[0];
      expect(filas, `${listado.nombre}: el archivo trae la PÁGINA, no el conjunto`).toHaveLength(
        TOTAL,
      );
      // Y son las del conjunto ENTERO, en su orden: la primera fila del archivo es la fila 1
      // del listado, que en ese momento no está en pantalla.
      const valores = filas.map((f) => Object.values(f).map(String).join(" "));
      expect(valores[0], `${listado.nombre}: la primera fila del archivo`).toContain(
        etiquetaDeArchivo(listado, 1),
      );
      expect(valores.at(-1), `${listado.nombre}: la última fila del archivo`).toContain(
        etiquetaDeArchivo(listado, TOTAL),
      );
      expect(descargarBlobMock).toHaveBeenCalledTimes(1);

      cleanup();
      vi.clearAllMocks();
      buildXlsxRowsMock.mockResolvedValue(new ArrayBuffer(8));
    }
  });

  it("el usuario ve exactamente las mismas filas que antes en la página 1 (R44)", () => {
    // Al entrar, la pantalla pinta la página que el servidor pre-cargó: las 25 primeras del
    // conjunto, TODAS, en su orden, y ninguna más. Ni recorta de más, ni completa por su
    // cuenta, ni reordena. El acotamiento por rol se prueba en el servicio (T I.1); lo que se
    // fija aquí es que la pantalla no reinterpreta lo que recibe.
    //
    // SIN `await`, y es la mitad del test: las filas tienen que estar en el PRIMER pintado,
    // el mismo en el que estaban antes de paginar. Esperar a que resuelva una lectura daría
    // por bueno perder la página pre-cargada y enseñar un esqueleto mientras el navegador va
    // y vuelve al servidor por un dato que ya venía en la respuesta.
    for (const listado of LISTADOS) {
      listado.montar();

      const tabla = screen.getByRole("table", { name: listado.tabla });
      // Una fila de encabezado + las 25 de la página.
      expect(within(tabla).getAllByRole("row"), listado.nombre).toHaveLength(1 + PAGE_SIZE);

      for (const i of [1, 2, PAGE_SIZE]) {
        expect(
          within(tabla).getByText(listado.textoFila(i)),
          `${listado.nombre}: falta la fila ${i} de la página 1`,
        ).toBeInTheDocument();
      }
      expect(
        within(tabla).queryByText(listado.textoFila(PAGE_SIZE + 1)),
        `${listado.nombre}: la página 1 trae una fila que no le toca`,
      ).not.toBeInTheDocument();

      // El orden es el del servidor, no uno reconstruido en la pantalla.
      const filas = within(tabla).getAllByRole("row").slice(1);
      expect(filas[0].textContent, listado.nombre).toContain(listado.textoFila(1));
      expect(filas[PAGE_SIZE - 1].textContent, listado.nombre).toContain(
        listado.textoFila(PAGE_SIZE),
      );

      cleanup();
      vi.clearAllMocks();
    }
  });

  // El contador de la cola de estas pantallas se afirmaba AQUÍ mientras la cola no paginaba
  // («sigue contando el conjunto entero», R42). La tanda J la paginó: ese número sale ahora
  // del `total` del servidor y se afirma en
  // `ColasPaginacion.test.tsx::el contador de cabecera muestra el total del servidor, no el
  // tamaño de página (R42)`, que además lo comprueba en la ÚLTIMA página —donde un contador
  // derivado del array se delataría—. No se pierde cobertura: la sustituta es más estricta.

  it("Q-I3: la vista tipo factura sigue a la tabla del histórico, no al conjunto entero", async () => {
    // Decisión de T I.2 sobre la previsualización de comprobantes de `CierresAdminModule`,
    // que concatenaba `[...pendientes, ...historico]`. Al paginar, muestra la cola completa
    // más la PÁGINA visible: la frase que define la sección es «los mismos cierres de
    // arriba», y alimentarla del conjunto entero sería la única razón por la que el histórico
    // completo seguiría cruzando a la pantalla. CAMBIA lo que el usuario ve, y por eso está
    // escrito aquí y en la bitácora.
    const user = userEvent.setup();
    const todos = conjunto(cierreAdmin);
    servirPaginas(paginado.cierresHistorico, todos);
    servirPaginas(paginado.cierresPendientes, []);
    envolver(
      <CierresAdminModule
        pendientes={pagina1([])}
        historico={pagina1(todos)}
        sinZona={false}
      />,
    );

    const factura = await screen.findByRole("region", { name: "Vista tipo factura" });
    // Hay una tarjeta por cierre de la página, no por cierre del conjunto.
    expect(
      within(factura).getAllByRole("button", { name: /Ver el comprobante del cierre/ }),
    ).toHaveLength(PAGE_SIZE);
    expect(within(factura).getByText(/Mensajero 01/)).toBeInTheDocument();
    expect(within(factura).queryByText(/Mensajero 26/)).not.toBeInTheDocument();

    // Y al cambiar de página, la previsualización cambia con ella.
    const nav = screen.getByRole("navigation", {
      name: "Paginación del histórico de cierres del día",
    });
    await user.click(within(nav).getByRole("button", { name: "Página siguiente" }));

    await waitFor(() =>
      expect(
        within(screen.getByRole("region", { name: "Vista tipo factura" })).getByText(
          /Mensajero 26/,
        ),
      ).toBeInTheDocument(),
    );
    expect(
      within(screen.getByRole("region", { name: "Vista tipo factura" })).queryByText(
        /Mensajero 01/,
      ),
    ).not.toBeInTheDocument();
  });
});

/**
 * Texto por el que se reconoce la fila `i` DENTRO DEL ARCHIVO. Casi siempre es el mismo que en
 * pantalla; sólo el histórico del mensajero difiere, porque en el archivo los montos van sin
 * el símbolo de colón (money-safe: la celda es un número, no una etiqueta).
 */
function etiquetaDeArchivo(listado: Listado, i: number): string {
  return listado.nombre === "Cierres solicitados del mensajero"
    ? `${1000 + i}.00`
    : listado.textoFila(i);
}
