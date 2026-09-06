// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  cleanup,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import { useState, type ReactElement } from "react";

import { ToastProvider } from "@/providers/ToastProvider";
import { Modal } from "@/components/shared/Modal";
import { descargarBlob } from "@/components/shared/descargar-blob";
import { buildXlsxRows } from "@/lib/utils/xlsx-template";
import type { DescargaColumna } from "@/lib/types/descarga";
import type { CierreAdminResumen } from "@/lib/interfaces/services/ICierresAdminService";
import type { CatalogoFiltrosCierresDTO } from "@/lib/types/filtros-cierres";
import type {
  CierreBodegaResumen,
  CierreBodegaResumenLite,
} from "@/lib/interfaces/services/ICierreBodegaService";
import type {
  CierreDetalleGestion,
  CierreGrupos,
  CierrePasadoDTO,
  CierreResultado,
  CierreTotales,
  IngresoOrdenexDTO,
} from "@/lib/interfaces/services/ICierreDiaService";

// ---------------------------------------------------------------------------
// Ficha 314 — el selector de columnas, encendido en TODAS las descargas de cierres.
//
// Hasta ahora `ordenes` era el ÚNICO ámbito declarado del árbol: los ~15 botones de cierres ya
// eran el mismo `DescargarDatasetButton`, con el mismo generador y el mismo tope, pero sin lo
// que lo hace parametrizable. Aquí se afirma, sobre los consumidores REALES y para CADA
// superficie, lo que el molde de órdenes (`tests/components/OrdenesDescargaColumnas.test.tsx`)
// afirma para la suya: que el selector está, que desmarcar quita la columna DEL ARCHIVO, que el
// orden elegido es el de la cabecera, y que la preferencia se guarda en la clave de SU ámbito.
//
// Solo se aísla el codificador binario (`buildXlsxRows`): el recorrido
// `preferencia -> DescargarDatasetButton -> construirDescarga -> buildXlsxRows` es el de
// producción, así que lo que se comprueba son las columnas que de verdad llegan al archivo.
//
// NINGÚN caso escribe a mano una lista de encabezados ni afirma un total de columnas: todo se
// DERIVA del catálogo de cada superficie. Publicar una columna nueva no debe tocar este archivo.
//
// Los dos ejes que este archivo vigila y que el de órdenes no podía ver:
//
//  · EL ÁMBITO DEL DETALLE NO DEPENDE DEL MENSAJERO. `DetalleSecciones` monta las mismas cinco
//    secciones una vez POR mensajero incluido en un cierre de bodega, y su título lleva el
//    nombre de quien la firma. Un ámbito derivado del título daría una preferencia distinta por
//    mensajero para el MISMO juego de columnas.
//  · EL SELECTOR DENTRO DE UN MODAL. Las secciones del detalle viven en un `Modal` (focus trap
//    de Base UI) y el popover se rinde en un portal fuera de él. Que abra, que se pueda marcar y
//    que NO cierre el modal se comprueba montando los dos juntos, no razonándolo.
// ---------------------------------------------------------------------------

vi.mock("@/lib/actions/cierres-admin", () => ({
  listarGestionesCierresAdminCompleto: vi.fn(),
  verCierreDetalle: vi.fn(),
  aprobarCierre: vi.fn(),
  rechazarCierre: vi.fn(),
  listarCierresAdmin: vi.fn(),
  listarHistoricoCierresAdminPaginado: vi.fn(),
  listarPendientesCierresAdminPaginado: vi.fn(),
  listarHistoricoCierresAdminCompleto: vi.fn(),
  listarPendientesCierresAdminCompleto: vi.fn(),
  forzarSolicitudVencido: vi.fn(),
}));
vi.mock("@/lib/actions/cierre-bodega", () => ({
  listarGestionesCierresBodegaCompleto: vi.fn(),
  verCierreBodegaDetalle: vi.fn(),
  aprobarCierreBodega: vi.fn(),
  rechazarCierreBodega: vi.fn(),
  solicitarCierreBodega: vi.fn(),
  listarCierresBodegaAdmin: vi.fn(),
  listarConsolidacion: vi.fn(),
  listarHistoricoCierresBodegaPaginado: vi.fn(),
  listarCierresBodegaSolicitadosPaginado: vi.fn(),
  listarPendientesCierresBodegaPaginado: vi.fn(),
  listarConsolidablesPaginado: vi.fn(),
  listarCierresBodegaSolicitadosCompleto: vi.fn(),
  listarConsolidablesCompleto: vi.fn(),
  listarPendientesCierresBodegaCompleto: vi.fn(),
  listarHistoricoCierresBodegaCompleto: vi.fn(),
}));
vi.mock("@/lib/actions/cierre-dia", () => ({
  solicitarCierre: vi.fn(),
  listarCierreDia: vi.fn(),
  deshacerGestion: vi.fn(),
  listarCierresPasadosPaginado: vi.fn(),
  listarCierresPasadosCompleto: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/cierres-admin",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/shared/descargar-blob", () => ({ descargarBlob: vi.fn() }));
const descargarBlobMock = vi.mocked(descargarBlob);

vi.mock("@/lib/utils/xlsx-template", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/utils/xlsx-template")>();
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
  listarCierresAdmin,
  listarHistoricoCierresAdminCompleto,
  listarHistoricoCierresAdminPaginado,
  listarPendientesCierresAdminCompleto,
  listarPendientesCierresAdminPaginado,
} from "@/lib/actions/cierres-admin";
import {
  listarCierresBodegaAdmin,
  listarConsolidacion,
  listarCierresBodegaSolicitadosCompleto,
  listarCierresBodegaSolicitadosPaginado,
  listarConsolidablesCompleto,
  listarConsolidablesPaginado,
  listarHistoricoCierresBodegaCompleto,
  listarHistoricoCierresBodegaPaginado,
  listarPendientesCierresBodegaCompleto,
  listarPendientesCierresBodegaPaginado,
} from "@/lib/actions/cierre-bodega";
import {
  listarCierreDia,
  listarCierresPasadosCompleto,
  listarCierresPasadosPaginado,
} from "@/lib/actions/cierre-dia";
import { paginaInicial } from "@/tests/fixtures/pagina-inicial";
import { SIN_BLOQUEO } from "@/lib/utils/bloqueo-cierre";
import { CierresAdminModule } from "@/app/(app)/cierres-admin/_components/CierresAdminModule";
import { CierresBodegaAdminModule } from "@/app/(app)/cierres-admin/_components/CierresBodegaAdminModule";
import { ConsolidacionBodegaModule } from "@/app/(app)/cierres-admin/_components/ConsolidacionBodegaModule";
import { DetalleSecciones } from "@/app/(app)/cierres-admin/_components/cierre-detalle-shared";
import { CierreDiaModule } from "@/app/(app)/cierre-dia/_components/CierreDiaModule";
import { DescargarGestionesDialog } from "@/app/(app)/cierres-admin/_components/DescargarGestionesDialog";
import { COLUMNAS_DESCARGA_GESTIONES_FUNDIDA } from "@/app/(app)/cierres-admin/_components/cierres-gestiones-fundida-descarga-columnas";
import {
  AMBITO_DESCARGA_CIERRES_HISTORICO,
  AMBITO_DESCARGA_CIERRES_PENDIENTES,
  COLUMNAS_DESCARGA_CIERRES_HISTORICO,
  COLUMNAS_DESCARGA_CIERRES_PENDIENTES,
} from "@/app/(app)/cierres-admin/_components/cierres-admin-descarga-columnas";
import {
  AMBITO_DESCARGA_BODEGA_PENDIENTES,
  AMBITO_DESCARGA_BODEGA_RESUELTOS,
  AMBITO_DESCARGA_BODEGA_SOLICITADOS,
  AMBITO_DESCARGA_CONSOLIDABLES,
  COLUMNAS_DESCARGA_BODEGA_PENDIENTES,
  COLUMNAS_DESCARGA_BODEGA_RESUELTOS,
  COLUMNAS_DESCARGA_BODEGA_SOLICITADOS,
  COLUMNAS_DESCARGA_CONSOLIDABLES,
} from "@/app/(app)/cierres-admin/_components/cierres-bodega-descarga-columnas";
import {
  AMBITO_DESCARGA_GESTIONES_DEVUELTAS,
  AMBITO_DESCARGA_GESTIONES_ENTREGADAS,
  AMBITO_DESCARGA_GESTIONES_INCIDENTES,
  AMBITO_DESCARGA_GESTIONES_RECHAZADAS,
  AMBITO_DESCARGA_GESTIONES_REPROGRAMADAS,
  COLUMNAS_DESCARGA_GESTIONES_DEVUELTAS,
  COLUMNAS_DESCARGA_GESTIONES_ENTREGADAS,
  COLUMNAS_DESCARGA_GESTIONES_INCIDENTES,
  COLUMNAS_DESCARGA_GESTIONES_RECHAZADAS,
  COLUMNAS_DESCARGA_GESTIONES_REPROGRAMADAS,
} from "@/app/(app)/cierres-admin/_components/cierre-gestiones-descarga-columnas";
import {
  AMBITO_DESCARGA_DIA_CIERRES_PASADOS,
  AMBITO_DESCARGA_DIA_DEVUELTAS,
  AMBITO_DESCARGA_DIA_ENTREGADAS,
  AMBITO_DESCARGA_DIA_INCIDENTES,
  AMBITO_DESCARGA_DIA_RECHAZADAS,
  AMBITO_DESCARGA_DIA_REPROGRAMADAS,
  COLUMNAS_DESCARGA_DIA_CIERRES_PASADOS,
  COLUMNAS_DESCARGA_DIA_DEVUELTAS,
  COLUMNAS_DESCARGA_DIA_ENTREGADAS,
  COLUMNAS_DESCARGA_DIA_INCIDENTES,
  COLUMNAS_DESCARGA_DIA_RECHAZADAS,
  COLUMNAS_DESCARGA_DIA_REPROGRAMADAS,
} from "@/app/(app)/cierre-dia/_components/cierre-dia-descarga-columnas";

// --- Datos ---------------------------------------------------------------

const TOTALES: CierreTotales = {
  efectivo: "1000.10",
  simpe: "0.00",
  transferencia: "0.00",
  general: "1000.10",
};

function cierreAdmin(
  over: Partial<CierreAdminResumen> & { cierreId: string },
): CierreAdminResumen {
  return {
    mensajeroId: `m-${over.cierreId}`,
    mensajeroNombre: "Ana Mensajera",
    estado: "solicitado",
    destinoTipo: "bodega_satelite",
    destinoZonaId: "z1",
    destinoZonaNombre: "Limón",
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
  over: Partial<CierreBodegaResumen> & { cierreBodegaId: string },
): CierreBodegaResumen {
  return {
    zonaId: "z1",
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
    ...over,
  };
}

function consolidable(i: number): CierreBodegaResumenLite {
  return {
    cierreDiaId: `cd-${i}`,
    mensajeroId: `m-${i}`,
    mensajeroNombre: `Mensajero ${i}`,
    totales: TOTALES,
    totalPagoMensajero: "100.10",
    totalIngresoBodegaRechazos: "5.00",
  };
}

function ingreso(): IngresoOrdenexDTO {
  return {
    montoCobrar: "1000.10",
    cobraComision: true,
    esCentral: true,
    esZonaEspecial: false,
    fleteOrigen: "normal",
    fleteDevolucionOrigen: "normal",
    flete: "100.00",
    ivaFlete: "13.00",
    fleteDevolucion: null,
    ivaFleteDevolucion: null,
    comisionCod: "50.00",
    ivaComisionCod: "6.50",
    fleteConIva: "113.00",
    fleteDevolucionConIva: null,
    comisionConIva: "56.50",
    total: "169.50",
    tarifa: null,
  };
}

function gestion(
  over: Partial<CierreDetalleGestion> & {
    gestionId: string;
    resultado: CierreResultado;
  },
): CierreDetalleGestion {
  return {
    ordenId: `o-${over.gestionId}`,
    numGuia: 1001,
    numRemision: `REM-${over.gestionId}`,
    destinatario: "Ana Pérez",
    direccion: "Calle 1, casa 2",
    zonaNombre: "Limón",
    provinciaNombre: "Limón",
    cantonNombre: "Central",
    distritoNombre: "Limón",
    producto: "Caja mediana",
    tiendaNombre: "Tienda X",
    montoRecibido: null,
    metodoPago: null,
    pagos: [],
    motivo: null,
    fechaReprogramacion: null,
    evidenciaUrl: null,
    pagoMensajero: "100.10",
    ingresoBodegaRechazo: null,
    tarifaFaltante: false,
    esRechazoSla: false,
    desdeAyudaTienda: false,
    causaIncidente: null,
    indemnizacion: null,
    ...over,
  };
}

/**
 * Grupos con LAS CINCO secciones pobladas. Hace falta que ninguna esté vacía: la pantalla no
 * pinta la sección sin registros, y una sección que no se pinta no tiene selector que probar.
 */
function gruposCompletos(): CierreGrupos {
  return {
    entregada: [
      gestion({
        gestionId: "g1",
        resultado: "entregada",
        montoRecibido: "1000.10",
        metodoPago: "SINPE",
        pagos: [{ metodo: "SINPE", monto: "1000.10" }],
        ingresoOrdenex: ingreso(),
      }),
    ],
    reprogramada: [
      gestion({
        gestionId: "g2",
        resultado: "reprogramada",
        fechaReprogramacion: "2026-07-20",
        motivo: "El cliente pidió otro día",
        ingresoOrdenex: ingreso(),
      }),
    ],
    devuelta: [
      gestion({
        gestionId: "g3",
        resultado: "devuelta",
        motivo: "Dirección inexistente",
        ingresoOrdenex: ingreso(),
      }),
    ],
    rechazada: [
      gestion({
        gestionId: "g4",
        resultado: "rechazada",
        motivo: "Cliente ausente",
        esRechazoSla: true,
        ingresoBodegaRechazo: "5.00",
        ingresoOrdenex: ingreso(),
      }),
    ],
    incidente: [
      gestion({
        gestionId: "g5",
        resultado: "incidente",
        causaIncidente: "robado",
        motivo: "Robo en la parada",
        indemnizacion: "2500.00",
        ingresoOrdenex: ingreso(),
      }),
    ],
  };
}

function cierrePasado(i: number): CierrePasadoDTO {
  return {
    cierreId: `cp-${i}`,
    estado: "aprobado",
    destinoTipo: "bodega_satelite",
    destinoZonaId: "z1",
    totales: TOTALES,
    totalPagoMensajero: "100.10",
    totalIngresoBodegaRechazos: "5.00",
    solicitadoAt: `2026-07-1${i}T10:00:00.000Z`,
  };
}

const PENDIENTES = [
  cierreAdmin({ cierreId: "c1", mensajeroNombre: "Ana Mensajera" }),
  cierreAdmin({
    cierreId: "c2",
    mensajeroNombre: "Beto Mensajero",
    estado: "vencido",
  }),
];
const HISTORICO = [
  cierreAdmin({
    cierreId: "c3",
    mensajeroNombre: "Carla Mensajera",
    estado: "rechazado",
    resueltoAt: "2026-07-12T10:00:00.000Z",
    motivoRechazo: "Falta el depósito",
  }),
];
const BODEGA_PENDIENTES = [cierreBodega({ cierreBodegaId: "b1" })];
const BODEGA_RESUELTOS = [
  cierreBodega({
    cierreBodegaId: "b2",
    estado: "aprobado",
    resueltoAt: "2026-07-12T10:00:00.000Z",
  }),
];
const CONSOLIDABLES = [consolidable(1), consolidable(2)];
const BODEGA_SOLICITADOS = [
  cierreBodega({ cierreBodegaId: "b3", estado: "aprobado" }),
];
const CIERRES_PASADOS = [cierrePasado(1), cierrePasado(2)];

// --- Montaje --------------------------------------------------------------

function envolver(ui: ReactElement) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>{ui}</ToastProvider>
    </SWRConfig>,
  );
}

function renderCierresAdmin() {
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
  vi.mocked(listarHistoricoCierresAdminCompleto).mockResolvedValue({
    status: "ok",
    items: HISTORICO,
    total: HISTORICO.length,
  });
  vi.mocked(listarPendientesCierresAdminCompleto).mockResolvedValue({
    status: "ok",
    items: PENDIENTES,
    total: PENDIENTES.length,
  });
  vi.mocked(listarCierresAdmin).mockResolvedValue({
    status: "ok",
    pendientes: PENDIENTES,
    historico: HISTORICO,
    sinZona: false,
  });
  envolver(
    <CierresAdminModule
      pendientes={paginaInicial(PENDIENTES)}
      historico={paginaInicial(HISTORICO)}
      sinZona={false}
    />,
  );
}

function renderCierresBodega() {
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
  vi.mocked(listarCierresBodegaAdmin).mockResolvedValue({
    status: "ok",
    pendientes: BODEGA_PENDIENTES,
    historico: BODEGA_RESUELTOS,
  });
  envolver(
    <CierresBodegaAdminModule
      pendientes={paginaInicial(BODEGA_PENDIENTES)}
      historico={paginaInicial(BODEGA_RESUELTOS)}
    />,
  );
}

function renderConsolidacion() {
  vi.mocked(listarConsolidablesPaginado).mockResolvedValue({
    status: "ok",
    page: 1,
    ...paginaInicial(CONSOLIDABLES),
  });
  vi.mocked(listarCierresBodegaSolicitadosPaginado).mockResolvedValue({
    status: "ok",
    page: 1,
    ...paginaInicial(BODEGA_SOLICITADOS),
  });
  vi.mocked(listarCierresBodegaSolicitadosCompleto).mockResolvedValue({
    status: "ok",
    items: BODEGA_SOLICITADOS,
    total: BODEGA_SOLICITADOS.length,
  });
  vi.mocked(listarConsolidablesCompleto).mockResolvedValue({
    status: "ok",
    items: CONSOLIDABLES,
    total: CONSOLIDABLES.length,
  });
  vi.mocked(listarConsolidacion).mockResolvedValue({
    status: "ok",
    consolidables: CONSOLIDABLES,
    totalesAgregados: TOTALES,
    totalPagoMensajeroAgregado: "200.20",
    totalIngresoBodegaRechazosAgregado: "10.00",
    totalNetoAgregado: "800.00",
    totalCentralDebeAgregado: "0.00",
    puedesSolicitar: true,
    motivoBloqueo: null,
    cierresBodegaPasados: BODEGA_SOLICITADOS,
    sinZona: false,
  });
  envolver(
    <ConsolidacionBodegaModule
      consolidables={paginaInicial(CONSOLIDABLES)}
      totalesAgregados={TOTALES}
      totalPagoMensajeroAgregado="200.20"
      totalIngresoBodegaRechazosAgregado="10.00"
      totalNetoAgregado="800.00"
      totalCentralDebeAgregado="0.00"
      puedesSolicitar
      motivoBloqueo={null}
      cierresBodegaPasados={paginaInicial(BODEGA_SOLICITADOS)}
      sinZona={false}
    />,
  );
}

function renderCierreDia() {
  vi.mocked(listarCierresPasadosPaginado).mockResolvedValue({
    status: "ok",
    page: 1,
    ...paginaInicial(CIERRES_PASADOS),
  });
  vi.mocked(listarCierresPasadosCompleto).mockResolvedValue({
    status: "ok",
    items: CIERRES_PASADOS,
    total: CIERRES_PASADOS.length,
  });
  vi.mocked(listarCierreDia).mockResolvedValue({
    status: "ok",
    grupos: gruposCompletos(),
    totales: TOTALES,
    totalPagoMensajero: "100.10",
    totalIngresoBodegaRechazos: "5.00",
    puedesSolicitar: true,
    motivoBloqueo: null,
    cierresPasados: CIERRES_PASADOS,
    tieneVencido: false,
    tieneRechazado: false,
  });
  envolver(
    <CierreDiaModule
      grupos={gruposCompletos()}
      totales={TOTALES}
      totalPagoMensajero="100.10"
      puedesSolicitar
      motivoBloqueo={null}
      cierresPasados={paginaInicial(CIERRES_PASADOS)}
      bloqueo={SIN_BLOQUEO}
    />,
  );
}

/** El nombre del mensajero que el detalle anexa al título de cada sección (R13 de la 170). */
const MENSAJERO_DETALLE = "Ana Mensajera";

function renderDetalle(contexto: string | undefined = MENSAJERO_DETALLE) {
  envolver(
    <DetalleSecciones
      grupos={gruposCompletos()}
      onVerEvidencia={() => {}}
      contexto={contexto}
    />,
  );
}

/**
 * El detalle DENTRO de su `Modal`, que es donde vive de verdad (`CierresBodegaAdminModule`).
 * Se monta con el mismo componente de producto —no una imitación— porque lo que se prueba es
 * justamente la convivencia del focus-trap del diálogo con el portal del popover.
 */
function DetalleEnModal() {
  const [abierto, setAbierto] = useState(true);
  return (
    <Modal
      open={abierto}
      onOpenChange={setAbierto}
      title="Detalle del cierre de bodega"
      confirmLabel="Cerrar"
      hideCancel
      onConfirm={() => setAbierto(false)}
    >
      <DetalleSecciones
        grupos={gruposCompletos()}
        onVerEvidencia={() => {}}
        contexto={MENSAJERO_DETALLE}
      />
    </Modal>
  );
}

// --- El registro de superficies -------------------------------------------

interface Superficie {
  /** Nombre visible del control: el botón se llama `Descargar <control>`. */
  readonly control: string;
  /** El identificador de ámbito que su módulo declara. */
  readonly ambito: string;
  /** Su catálogo. De aquí se DERIVA todo lo que los casos esperan. */
  readonly columnas: readonly DescargaColumna[];
  readonly montar: () => void;
  /** Pestaña que hay que abrir para que el listado sea el visible. */
  readonly pestana?: RegExp;
  /**
   * `aria-label` de la sección que contiene el control, cuando la pantalla monta varios. Sin
   * esto, `getByRole` encontraría seis disparadores llamados igual y no diría cuál es cuál.
   */
  readonly region?: string;
}

const SUPERFICIES: readonly Superficie[] = [
  {
    control: "Cierres pendientes de decisión",
    ambito: AMBITO_DESCARGA_CIERRES_PENDIENTES,
    columnas: COLUMNAS_DESCARGA_CIERRES_PENDIENTES,
    montar: renderCierresAdmin,
  },
  {
    control: "Cierres del día resueltos",
    ambito: AMBITO_DESCARGA_CIERRES_HISTORICO,
    columnas: COLUMNAS_DESCARGA_CIERRES_HISTORICO,
    montar: renderCierresAdmin,
    pestana: /^Resueltos/,
  },
  {
    control: "Cierres de bodega pendientes",
    ambito: AMBITO_DESCARGA_BODEGA_PENDIENTES,
    columnas: COLUMNAS_DESCARGA_BODEGA_PENDIENTES,
    montar: renderCierresBodega,
  },
  {
    control: "Cierres de bodega resueltos",
    ambito: AMBITO_DESCARGA_BODEGA_RESUELTOS,
    columnas: COLUMNAS_DESCARGA_BODEGA_RESUELTOS,
    montar: renderCierresBodega,
    pestana: /^Resueltos/,
  },
  {
    control: "Cierres del día a consolidar",
    ambito: AMBITO_DESCARGA_CONSOLIDABLES,
    columnas: COLUMNAS_DESCARGA_CONSOLIDABLES,
    montar: renderConsolidacion,
  },
  {
    control: "Cierres de bodega solicitados",
    ambito: AMBITO_DESCARGA_BODEGA_SOLICITADOS,
    columnas: COLUMNAS_DESCARGA_BODEGA_SOLICITADOS,
    montar: renderConsolidacion,
    pestana: /^Solicitados/,
  },
  {
    control: "Cierres solicitados",
    ambito: AMBITO_DESCARGA_DIA_CIERRES_PASADOS,
    columnas: COLUMNAS_DESCARGA_DIA_CIERRES_PASADOS,
    montar: renderCierreDia,
    region: "Cierres solicitados",
  },
  // Las CINCO secciones del detalle del admin. El título lleva el mensajero; el ámbito NO.
  {
    control: `Entregadas · ${MENSAJERO_DETALLE}`,
    ambito: AMBITO_DESCARGA_GESTIONES_ENTREGADAS,
    columnas: COLUMNAS_DESCARGA_GESTIONES_ENTREGADAS,
    montar: renderDetalle,
    region: "Entregadas",
  },
  {
    control: `Reprogramadas · ${MENSAJERO_DETALLE}`,
    ambito: AMBITO_DESCARGA_GESTIONES_REPROGRAMADAS,
    columnas: COLUMNAS_DESCARGA_GESTIONES_REPROGRAMADAS,
    montar: renderDetalle,
    region: "Reprogramadas",
  },
  {
    control: `Devueltas · ${MENSAJERO_DETALLE}`,
    ambito: AMBITO_DESCARGA_GESTIONES_DEVUELTAS,
    columnas: COLUMNAS_DESCARGA_GESTIONES_DEVUELTAS,
    montar: renderDetalle,
    region: "Devueltas",
  },
  {
    control: `Rechazadas · ${MENSAJERO_DETALLE}`,
    ambito: AMBITO_DESCARGA_GESTIONES_RECHAZADAS,
    columnas: COLUMNAS_DESCARGA_GESTIONES_RECHAZADAS,
    montar: renderDetalle,
    region: "Rechazadas",
  },
  {
    control: `Incidentes · ${MENSAJERO_DETALLE}`,
    ambito: AMBITO_DESCARGA_GESTIONES_INCIDENTES,
    columnas: COLUMNAS_DESCARGA_GESTIONES_INCIDENTES,
    montar: renderDetalle,
    region: "Incidentes",
  },
  // Las CINCO secciones de `/cierre-dia`. Mismo resultado, OTRO catálogo (el mensajero ve
  // menos), y por eso otro ámbito.
  {
    control: "Entregadas",
    ambito: AMBITO_DESCARGA_DIA_ENTREGADAS,
    columnas: COLUMNAS_DESCARGA_DIA_ENTREGADAS,
    montar: renderCierreDia,
    region: "Entregadas",
  },
  {
    control: "Reprogramadas",
    ambito: AMBITO_DESCARGA_DIA_REPROGRAMADAS,
    columnas: COLUMNAS_DESCARGA_DIA_REPROGRAMADAS,
    montar: renderCierreDia,
    region: "Reprogramadas",
  },
  {
    control: "Devueltas",
    ambito: AMBITO_DESCARGA_DIA_DEVUELTAS,
    columnas: COLUMNAS_DESCARGA_DIA_DEVUELTAS,
    montar: renderCierreDia,
    region: "Devueltas",
  },
  {
    control: "Rechazadas",
    ambito: AMBITO_DESCARGA_DIA_RECHAZADAS,
    columnas: COLUMNAS_DESCARGA_DIA_RECHAZADAS,
    montar: renderCierreDia,
    region: "Rechazadas",
  },
  {
    control: "Incidentes",
    ambito: AMBITO_DESCARGA_DIA_INCIDENTES,
    columnas: COLUMNAS_DESCARGA_DIA_INCIDENTES,
    montar: renderCierreDia,
    region: "Incidentes",
  },
];

// --- Utilidades de los casos ---------------------------------------------

/** La clave del ámbito, tal y como la arma el control común (`DescargarDatasetButton`). */
function claveDe(ambito: string): string {
  return `ordenex:descarga-columnas:${ambito}`;
}

const DISPARADOR_SELECTOR = "Elegir columnas de la descarga";

/** El disparador del selector de ESTA superficie, acotado a su sección si comparte pantalla. */
function disparadorDe(superficie: Superficie): HTMLElement {
  const ambito = superficie.region
    ? within(screen.getByRole("region", { name: superficie.region }))
    : screen;
  return ambito.getByRole("button", { name: DISPARADOR_SELECTOR });
}

function botonDescargaDe(superficie: Superficie): HTMLElement {
  const ambito = superficie.region
    ? within(screen.getByRole("region", { name: superficie.region }))
    : screen;
  return ambito.getByRole("button", { name: `Descargar ${superficie.control}` });
}

async function montar(
  user: ReturnType<typeof userEvent.setup>,
  superficie: Superficie,
): Promise<void> {
  superficie.montar();
  if (superficie.pestana) {
    await user.click(await screen.findByRole("button", { name: superficie.pestana }));
  }
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

function encabezadosDe(superficie: Superficie): string[] {
  return superficie.columnas.map((columna) => columna.encabezado);
}

/**
 * La columna que cada caso oculta: la ÚLTIMA del catálogo. Se elige por posición y no por
 * nombre para que valga igual en las diecisiete superficies, y la última porque ninguna de
 * ellas la comparte con la primera —que es la que se afirma que SIGUE saliendo—.
 */
function columnaAOcultar(superficie: Superficie): DescargaColumna {
  return superficie.columnas[superficie.columnas.length - 1]!;
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

describe("Cierres · elección de columnas de la descarga", () => {
  it("el registro cubre las diecisiete superficies y ninguna repite ámbito", () => {
    // Anti-vacuidad del propio archivo: si una superficie se cayera del registro, los casos de
    // abajo —que iteran sobre él— pasarían verdes sin haberla mirado. Y los ámbitos se
    // comparan aquí además de en la guardia porque aquí se sabe QUÉ superficie es cada uno.
    const ambitos = SUPERFICIES.map((s) => s.ambito);
    expect(new Set(ambitos).size).toBe(ambitos.length);
    expect(ambitos).toHaveLength(17);
    for (const superficie of SUPERFICIES) {
      expect(
        superficie.ambito,
        `${superficie.control}: el ámbito viaja dentro de una clave de localStorage`,
      ).toMatch(/^[a-z0-9-]+$/);
      expect(
        superficie.columnas.length,
        `${superficie.control}: catálogo vacío`,
      ).toBeGreaterThan(1);
    }
  });

  it("cada superficie ofrece su selector, y abrirlo no descarga nada", async () => {
    for (const superficie of SUPERFICIES) {
      const user = userEvent.setup();
      await montar(user, superficie);

      expect(
        botonDescargaDe(superficie),
        `${superficie.control}: sin botón de descarga`,
      ).toBeInTheDocument();
      const disparador = disparadorDe(superficie);
      expect(
        disparador,
        `${superficie.control}: sin selector de columnas`,
      ).toBeInTheDocument();

      await user.click(disparador);
      // Se despliega con TODAS las columnas del catálogo marcadas, derivadas de la constante.
      for (const encabezado of encabezadosDe(superficie)) {
        expect(
          screen.getByRole("checkbox", { name: encabezado }),
          `${superficie.control}: falta la casilla «${encabezado}»`,
        ).toHaveAttribute("aria-checked", "true");
      }
      // Y abrirlo NO descarga: es un control PARALELO al botón, no un paso de su camino.
      expect(buildXlsxRowsMock).not.toHaveBeenCalled();
      expect(descargarBlobMock).not.toHaveBeenCalled();

      cleanup();
      vi.clearAllMocks();
      buildXlsxRowsMock.mockResolvedValue(new ArrayBuffer(8));
    }
  });

  it("desmarcar una columna la quita del archivo de ESA superficie", async () => {
    for (const superficie of SUPERFICIES) {
      const oculta = columnaAOcultar(superficie);
      guardarPreferencia(superficie.ambito, { ocultas: [oculta.clave] });

      const user = userEvent.setup();
      await montar(user, superficie);
      await user.click(botonDescargaDe(superficie));
      await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));

      const cabecera = encabezadosDelArchivo();
      expect(
        cabecera,
        `${superficie.control}: «${oculta.encabezado}» seguía en el archivo`,
      ).not.toContain(oculta.encabezado);
      // Y las demás siguen ahí, todas, derivando «todas» de la fuente de verdad.
      expect(cabecera).toEqual(
        encabezadosDe(superficie).filter((e) => e !== oculta.encabezado),
      );

      cleanup();
      vi.clearAllMocks();
      window.localStorage.clear();
      buildXlsxRowsMock.mockResolvedValue(new ArrayBuffer(8));
    }
  });

  it("el orden elegido es el orden de la cabecera del archivo", async () => {
    for (const superficie of SUPERFICIES) {
      const claves = superficie.columnas.map((c) => c.clave);
      const alReves = [...claves].reverse();
      guardarPreferencia(superficie.ambito, { orden: alReves });

      const user = userEvent.setup();
      await montar(user, superficie);
      await user.click(botonDescargaDe(superficie));
      await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));

      const esperado = [...encabezadosDe(superficie)].reverse();
      expect(
        encabezadosDelArchivo(),
        `${superficie.control}: el orden guardado no llegó al archivo`,
      ).toEqual(esperado);
      // Contraprueba de no-vacuidad: ese orden NO es el del catálogo.
      expect(encabezadosDelArchivo()).not.toEqual(encabezadosDe(superficie));

      cleanup();
      vi.clearAllMocks();
      window.localStorage.clear();
      buildXlsxRowsMock.mockResolvedValue(new ArrayBuffer(8));
    }
  });

  it("la preferencia se persiste en la clave de SU ámbito y en ninguna otra", async () => {
    for (const superficie of SUPERFICIES) {
      const oculta = columnaAOcultar(superficie);
      const user = userEvent.setup();
      await montar(user, superficie);

      await user.click(disparadorDe(superficie));
      await user.click(screen.getByRole("checkbox", { name: oculta.encabezado }));

      const clave = claveDe(superficie.ambito);
      await waitFor(() => {
        expect(
          window.localStorage.getItem(clave),
          `${superficie.control}: no escribió en ${clave}`,
        ).not.toBeNull();
      });
      expect(JSON.parse(window.localStorage.getItem(clave)!).ocultas).toEqual([
        oculta.clave,
      ]);
      // Ninguna otra clave del almacenamiento se movió: una sola escritura, la suya.
      expect(Object.keys(window.localStorage)).toEqual([clave]);

      cleanup();
      vi.clearAllMocks();
      window.localStorage.clear();
      buildXlsxRowsMock.mockResolvedValue(new ArrayBuffer(8));
    }
  });

  it("dos superficies de la misma pantalla no comparten preferencia", async () => {
    // R10 visto desde el producto: la cola y el histórico del admin viven en la MISMA pantalla,
    // detrás de dos pestañas. Ocultar una columna en una no puede tocar la otra.
    const cola = SUPERFICIES[0]!;
    const historico = SUPERFICIES[1]!;
    const ocultaEnCola = columnaAOcultar(cola);

    const user = userEvent.setup();
    await montar(user, cola);
    await user.click(disparadorDe(cola));
    await user.click(
      screen.getByRole("checkbox", { name: ocultaEnCola.encabezado }),
    );
    await waitFor(() => {
      expect(window.localStorage.getItem(claveDe(cola.ambito))).not.toBeNull();
    });
    await user.keyboard("{Escape}");

    // Se cambia de pestaña y se descarga el histórico: su cabecera está ENTERA.
    await user.click(await screen.findByRole("button", { name: /^Resueltos/ }));
    await user.click(botonDescargaDe(historico));
    await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));

    expect(encabezadosDelArchivo()).toEqual(encabezadosDe(historico));
    expect(window.localStorage.getItem(claveDe(historico.ambito))).toBeNull();
  });

  it("en el detalle, el ámbito NO depende del mensajero del título", async () => {
    // El detalle de un cierre de BODEGA monta estas mismas secciones una vez por mensajero, y
    // el título lleva su nombre. Si el ámbito se hubiera derivado del título, lo que se oculta
    // en la sección de un mensajero volvería a salir en la del siguiente.
    const seccion = SUPERFICIES.find(
      (s) => s.ambito === AMBITO_DESCARGA_GESTIONES_ENTREGADAS,
    )!;
    const oculta = columnaAOcultar(seccion);
    guardarPreferencia(seccion.ambito, { ocultas: [oculta.clave] });

    const user = userEvent.setup();
    renderDetalle("Zoraida Mensajera"); // OTRO mensajero, otro título, MISMO juego de columnas
    await user.click(
      within(screen.getByRole("region", { name: "Entregadas" })).getByRole(
        "button",
        { name: "Descargar Entregadas · Zoraida Mensajera" },
      ),
    );
    await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));

    expect(encabezadosDelArchivo()).not.toContain(oculta.encabezado);
    expect(encabezadosDelArchivo()).toEqual(
      encabezadosDe(seccion).filter((e) => e !== oculta.encabezado),
    );
  });

  it("dentro del modal del detalle el selector abre, marca y no cierra el diálogo", async () => {
    // El popover se rinde en un PORTAL, fuera del `Dialog.Popup` que atrapa el foco. Si Base UI
    // no encadenara los dos flotantes, el clic dentro del popover contaría como «clic fuera»
    // del diálogo y lo cerraría — dejando al usuario sin el detalle que estaba mirando.
    const user = userEvent.setup();
    envolver(<DetalleEnModal />);

    const seccion = SUPERFICIES.find(
      (s) => s.ambito === AMBITO_DESCARGA_GESTIONES_ENTREGADAS,
    )!;
    const oculta = columnaAOcultar(seccion);
    const region = () => screen.getByRole("region", { name: "Entregadas" });

    await user.click(
      within(region()).getByRole("button", { name: DISPARADOR_SELECTOR }),
    );
    // Abre de verdad: el encabezado del popup y las casillas del catálogo están en el DOM.
    expect(await screen.findByText("Columnas del archivo")).toBeVisible();
    const casilla = screen.getByRole("checkbox", { name: oculta.encabezado });
    expect(casilla).toHaveAttribute("aria-checked", "true");

    await user.click(casilla);

    // El diálogo NO se cerró: su título sigue ahí y la sección también.
    expect(screen.getByText("Detalle del cierre de bodega")).toBeVisible();
    expect(region()).toBeInTheDocument();
    // Y el clic surtió efecto en la preferencia del ámbito.
    await waitFor(() => {
      expect(
        window.localStorage.getItem(claveDe(seccion.ambito)),
      ).not.toBeNull();
    });
    expect(casilla).toHaveAttribute("aria-checked", "false");

    // Y el archivo que sale del modal ya no lleva esa columna.
    await user.keyboard("{Escape}");
    await user.click(
      within(region()).getByRole("button", {
        name: `Descargar ${seccion.control}`,
      }),
    );
    await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));
    expect(encabezadosDelArchivo()).not.toContain(oculta.encabezado);
    // El modal sigue abierto tras descargar (el Escape cerró el popover, no el diálogo).
    expect(screen.getByText("Detalle del cierre de bodega")).toBeVisible();
  });

  it("con preferencia guardada NO cambian ni el nombre de la hoja ni las filas", async () => {
    // El filtro va en las COLUMNAS, nunca en los datos: la fila llega entera —con la clave
    // oculta incluida— y el generador ignora lo que no está declarado. Si algún día el filtro
    // se moviera a los datos, la descarga dejaría de ser «lo que la tabla enseña, entero».
    const superficie = SUPERFICIES[0]!;
    const oculta = columnaAOcultar(superficie);
    guardarPreferencia(superficie.ambito, { ocultas: [oculta.clave] });

    const user = userEvent.setup();
    await montar(user, superficie);
    await user.click(botonDescargaDe(superficie));
    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));

    const [, filas, hoja] = buildXlsxRowsMock.mock.calls[0]!;
    expect(hoja).toBe(superficie.control);
    expect(filas).toHaveLength(PENDIENTES.length);
    expect(filas.map((f) => f.mensajero)).toEqual(
      PENDIENTES.map((c) => c.mensajeroNombre),
    );
    expect(Object.keys(filas[0]!).sort()).toEqual(
      superficie.columnas.map((c) => c.clave).sort(),
    );
  });

  it("la descarga DETALLADA se queda sin selector, y es una decisión escrita", async () => {
    // Las quince descargas de cierres encendieron el suyo; ésta no. Motivo, en el propio
    // componente: el selector es INDIVISIBLE —ofrece ocultar Y reordenar (R21)— y el orden de
    // esta hoja ES su agrupado semántico: diez columnas que siempre traen dato y diecisiete que
    // solo se llenan según el resultado. Intercalarlas deja celdas vacías sin significado, y el
    // daño sería MUDO (la preferencia vive en el navegador; ninguna prueba se pondría roja).
    //
    // Este caso existe para que quitarlo sea un acto deliberado y no un descuido de paso: quien
    // encienda el ámbito aquí tiene que venir a borrarlo, y al hacerlo leerá el motivo.
    const catalogo: CatalogoFiltrosCierresDTO = {
      zonas: [],
      mensajeros: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          nombre: "Ana Mensajera",
          zonaId: null,
        },
      ],
      mensajerosFiltro: [],
    };
    const user = userEvent.setup();
    envolver(
      <DescargarGestionesDialog
        catalogo={catalogo}
        accion={async () => ({
          status: "ok" as const,
          items: [],
          total: 0,
        })}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Descargar detallada por mensajero" }),
    );
    // El diálogo abre y su control de descarga está: lo que no está es el selector.
    expect(
      await screen.findByRole("button", { name: "Descargar Gestiones de cierres" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: DISPARADOR_SELECTOR })).toBeNull();
    // Ni preferencia que aplicar: no hay ámbito, así que salen las 29 declaradas
    // (27 originales + «Fecha de gestión» y «Día de reparto», añadidas el 2026-09-05).
    expect(COLUMNAS_DESCARGA_GESTIONES_FUNDIDA.length).toBeGreaterThan(1);
  });
});
