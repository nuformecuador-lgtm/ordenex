// @vitest-environment jsdom
// Feature 170 (T E.1 a T E.5) — descarga de las NUEVE tablas de cierres: cola e histórico de
// cierres del día (admin), cola e histórico de cierres de bodega (maestro), consolidables e
// histórico de la bodega satélite, gestiones e histórico del mensajero, y las secciones por
// resultado del detalle compartido. Cubre R1, R8, R11, R14, R20, R22, R26, R30, R32 y R37.
//
// Lo que más se vigila aquí es R22. Estas pantallas son las ÚNICAS del rollout cuyo dato de
// origen trae URL FIRMADAS de evidencia: un `xlsx` con una de ellas dentro, reenviado por
// correo, es acceso a la foto sin sesión. En el archivo va «Tiene evidencia: Sí/No» y nunca
// el enlace, y hay un test que lo comprueba sobre las filas REALES que se generan.
//
// Feature 184 — Tanda B (T B.2, R1/R2/R7/R8/R10): los dos listados de la consolidación dejan de
// sacar su archivo de `listarConsolidacion()` —cuatro consultas, cinco agregados de dinero y el
// reparto del efectivo, para quedarse con UN campo— y pasan a pedírselo a su lectura dedicada.
// Lo que este archivo gana son los casos que el xlsx por sí solo NO distingue: de qué lectura
// sale el conjunto, que la pantalla no lo vuelva a tocar y que un fallo no produzca archivo.
// Los agregados de la cabecera siguen llegando por props y no cambian (R49/R50 de la 170).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

import { ToastProvider } from "@/providers/ToastProvider";
import { descargarBlob } from "@/components/shared/descargar-blob";
import { buildXlsxRows } from "@/lib/utils/xlsx-template";
import type { CierreAdminResumen } from "@/lib/interfaces/services/ICierresAdminService";
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

// Feature 170 — FASE 2 (T I.2): los cuatro históricos de estas pantallas se pintan desde una
// PÁGINA del servidor y su descarga RELEE el conjunto completo (R52). Por eso aquí hay dos
// dobles por listado: el paginado (lo que se ve) y el compuesto (lo que se descarga).
vi.mock("@/lib/actions/cierres-admin", () => ({
  verCierreDetalle: vi.fn(),
  aprobarCierre: vi.fn(),
  rechazarCierre: vi.fn(),
  listarCierresAdmin: vi.fn(),
  listarHistoricoCierresAdminPaginado: vi.fn(),
  // Feature 170 — FASE 2 (T J.2): la COLA de pendientes también llega paginada.
  listarPendientesCierresAdminPaginado: vi.fn(),
  // Feature 184 — Tanda D (T D.3): las lecturas DEDICADAS de las dos tablas de esta pantalla.
  // El doble de `listarCierresAdmin` se conserva A PROPÓSITO —y programado con las DOS mitades,
  // cola e histórico— porque es el listado compuesto del que salían los dos archivos: sin él,
  // «ya no se relee» no sería una decisión de la pantalla, sería que el doble no responde.
  listarHistoricoCierresAdminCompleto: vi.fn(),
  listarPendientesCierresAdminCompleto: vi.fn(),
  forzarSolicitudVencido: vi.fn(),
}));
vi.mock("@/lib/actions/cierre-bodega", () => ({
  verCierreBodegaDetalle: vi.fn(),
  aprobarCierreBodega: vi.fn(),
  rechazarCierreBodega: vi.fn(),
  solicitarCierreBodega: vi.fn(),
  listarCierresBodegaAdmin: vi.fn(),
  listarConsolidacion: vi.fn(),
  listarHistoricoCierresBodegaPaginado: vi.fn(),
  listarCierresBodegaSolicitadosPaginado: vi.fn(),
  // Feature 170 — FASE 2 (T J.2): las dos COLAS de esta pantalla también llegan paginadas.
  listarPendientesCierresBodegaPaginado: vi.fn(),
  listarConsolidablesPaginado: vi.fn(),
  // Feature 184 — Tanda B (T B.2): las lecturas DEDICADAS de los dos listados de esta pantalla.
  // El doble de `listarConsolidacion` se conserva A PROPÓSITO: que el archivo ya no salga de él
  // es la mitad de lo que R1 pide, y sin el doble no habría forma de afirmar su ausencia.
  listarCierresBodegaSolicitadosCompleto: vi.fn(),
  listarConsolidablesCompleto: vi.fn(),
  // Feature 184 — Tanda E (T E.3): la lectura DEDICADA de la COLA de cierres de bodega. El
  // doble de `listarCierresBodegaAdmin` se conserva A PROPÓSITO —y programado con las DOS
  // mitades, cola e histórico— porque es el listado compuesto del que salían los dos archivos
  // de esa pantalla: sin él, «ya no se relee» no sería una decisión de la pantalla, sería que
  // el doble no responde.
  listarPendientesCierresBodegaCompleto: vi.fn(),
  listarHistoricoCierresBodegaCompleto: vi.fn(),
}));
vi.mock("@/lib/actions/cierre-dia", () => ({
  solicitarCierre: vi.fn(),
  listarCierreDia: vi.fn(),
  deshacerGestion: vi.fn(),
  listarCierresPasadosPaginado: vi.fn(),
  // Feature 184 — Tanda C (T C.2): la lectura DEDICADA del listado 1. El doble de
  // `listarCierreDia` se conserva A PROPÓSITO —y programado con evidencias FIRMADAS— porque es
  // el que firmaba: sin él, «no se vuelve a leer el compuesto» no sería una decisión de la
  // pantalla, sería que el doble no responde.
  listarCierresPasadosCompleto: vi.fn(),
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

// Feature 184 — Tanda B (T B.2, R7): el control de descarga NO pinta el fallo en la tabla, lo
// dice por toast (`DescargarDatasetButton:96`). Para poder afirmar QUÉ dice —y sobre todo qué NO
// dice— el doble del error tiene que ser inspeccionable.
const { errorToastMock } = vi.hoisted(() => ({ errorToastMock: vi.fn() }));
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: errorToastMock,
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
import { CierresAdminModule } from "@/app/(app)/cierres-admin/_components/CierresAdminModule";
import { CierresBodegaAdminModule } from "@/app/(app)/cierres-admin/_components/CierresBodegaAdminModule";
import { ConsolidacionBodegaModule } from "@/app/(app)/cierres-admin/_components/ConsolidacionBodegaModule";
import { DetalleSecciones } from "@/app/(app)/cierres-admin/_components/cierre-detalle-shared";
import { CierreDiaModule } from "@/app/(app)/cierre-dia/_components/CierreDiaModule";

// --- Datos ---------------------------------------------------------------

const TOTALES: CierreTotales = {
  efectivo: "1000.10",
  simpe: "0.00",
  transferencia: "0.00",
  general: "1000.10",
};

/** URL FIRMADA de evidencia: el dato que NO puede acabar en ningún archivo (R22). */
const EVIDENCIA_FIRMADA =
  "https://storage.example/storage/v1/evidencias/foto.jpg?token=secreto";

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
    pendientePagoMensajero: null, // feature 172/T C.2: null = cierre no aprobado (R28)
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

function gestion(
  over: Partial<CierreDetalleGestion> & { gestionId: string; resultado: CierreResultado },
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
    // Feature 212/R31: el DTO gana el desglose y CONSERVA el escalar de arriba.
    pagos: [],
    motivo: null,
    fechaReprogramacion: null,
    evidenciaUrl: null,
    pagoMensajero: "100.10",
    ingresoBodegaRechazo: null,
    tarifaFaltante: false,
    esRechazoSla: false,
    causaIncidente: null,
    indemnizacion: null,
    ...over,
  };
}

function gruposVacios(): CierreGrupos {
  return { entregada: [], reprogramada: [], devuelta: [], rechazada: [], incidente: [] };
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
  cierreAdmin({ cierreId: "c2", mensajeroNombre: "Beto Mensajero", estado: "vencido" }),
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
const BODEGA_SOLICITADOS = [cierreBodega({ cierreBodegaId: "b3", estado: "aprobado" })];

/**
 * Ingreso de Ordenex por orden. Solo el detalle de ADMIN lo trae, y es lo que hace que la
 * fila tenga desglose desplegable — el estado que el test de R37 usa como testigo.
 */
function ingreso(): IngresoOrdenexDTO {
  return {
    montoCobrar: "1000.10",
    cobraComision: true,
    esCentral: true,
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

/** Grupos del detalle: una entrega y un rechazo CON evidencia firmada. */
function gruposConEvidencia(): CierreGrupos {
  return {
    ...gruposVacios(),
    entregada: [
      gestion({
        gestionId: "g1",
        resultado: "entregada",
        montoRecibido: "1000.10",
        metodoPago: "SINPE",
        // Feature 213 (T8): desglose COHERENTE con el escalar ya declarado (R23).
        pagos: [{ metodo: "SINPE", monto: "1000.10" }],
        ingresoOrdenex: ingreso(),
      }),
    ],
    rechazada: [
      gestion({
        gestionId: "g2",
        resultado: "rechazada",
        motivo: "Cliente ausente",
        evidenciaUrl: EVIDENCIA_FIRMADA,
        esRechazoSla: true,
        ingresoBodegaRechazo: "5.00",
      }),
    ],
    incidente: [
      gestion({
        gestionId: "g3",
        resultado: "incidente",
        causaIncidente: "robado",
        motivo: "Robo en la parada",
        evidenciaUrl: EVIDENCIA_FIRMADA,
        indemnizacion: "2500.00",
      }),
    ],
  };
}

const CIERRES_PASADOS = [cierrePasado(1), cierrePasado(2)];

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
  // Feature 184 — Tanda D (T D.3): de aquí salen los dos archivos de esta pantalla — cada uno
  // SU mitad del alcance, sin recorte y con la forma que `filasDesdeResultado` traduce
  // (`ListarCompletoResult`).
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
  // El listado COMPUESTO sigue programado, y con las DOS mitades dentro: es lo que hace que
  // «no se relee» sea observable (si la pantalla lo llamara, respondería).
  vi.mocked(listarCierresAdmin).mockResolvedValue({
    status: "ok",
    pendientes: PENDIENTES,
    historico: HISTORICO,
    sinZona: false,
  });
  return envolver(
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
  // Feature 184 — Tanda E (T E.3): de aquí sale el archivo de la COLA — SU mitad de la
  // operación, sin recorte y con la forma que `filasDesdeResultado` traduce
  // (`ListarCompletoResult`).
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
  // El listado COMPUESTO sigue programado, y con las DOS mitades dentro: es lo que hace que
  // «no se relee» sea observable (si la pantalla lo llamara, respondería).
  vi.mocked(listarCierresBodegaAdmin).mockResolvedValue({
    status: "ok",
    pendientes: BODEGA_PENDIENTES,
    historico: BODEGA_RESUELTOS,
  });
  return envolver(
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
  // Feature 184 — Tanda B (T B.2): de aquí salen los archivos de los dos listados de esta
  // pantalla, sin recorte y con la forma que `filasDesdeResultado` traduce
  // (`ListarCompletoResult`).
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
  return envolver(
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
  // Feature 184 — Tanda C (T C.2): de aquí sale el archivo — el conjunto de ESTE mensajero, sin
  // recorte y con la forma que `filasDesdeResultado` traduce (`ListarCompletoResult`).
  vi.mocked(listarCierresPasadosCompleto).mockResolvedValue({
    status: "ok",
    items: CIERRES_PASADOS,
    total: CIERRES_PASADOS.length,
  });
  vi.mocked(listarCierreDia).mockResolvedValue({
    status: "ok",
    grupos: gruposConEvidencia(),
    totales: TOTALES,
    totalPagoMensajero: "100.10",
    totalIngresoBodegaRechazos: "5.00",
    puedesSolicitar: true,
    motivoBloqueo: null,
    cierresPasados: CIERRES_PASADOS,
    tieneVencido: false,
    tieneRechazado: false,
  });
  return envolver(
    <CierreDiaModule
      grupos={gruposConEvidencia()}
      totales={TOTALES}
      totalPagoMensajero="100.10"
      puedesSolicitar
      motivoBloqueo={null}
      cierresPasados={paginaInicial(CIERRES_PASADOS)}
      bloqueado={false}
      tieneVencido={false}
      tieneRechazado={false}
    />,
  );
}

function renderDetalle() {
  return envolver(
    <DetalleSecciones grupos={gruposConEvidencia()} onVerEvidencia={() => {}} />,
  );
}

/** Las NUEVE tablas de cierres, con el nombre de su control y cuántas filas debe traer. */
const TABLAS = [
  { control: "Cierres pendientes de decisión", montar: renderCierresAdmin, filas: 2 },
  { control: "Cierres del día resueltos", montar: renderCierresAdmin, filas: 1 },
  { control: "Cierres de bodega pendientes", montar: renderCierresBodega, filas: 1 },
  { control: "Cierres de bodega resueltos", montar: renderCierresBodega, filas: 1 },
  { control: "Cierres del día a consolidar", montar: renderConsolidacion, filas: 2 },
  { control: "Cierres de bodega solicitados", montar: renderConsolidacion, filas: 1 },
  { control: "Cierres solicitados", montar: renderCierreDia, filas: 2 },
  // El detalle compartido: UNA descarga por sección (P2 ratificada), no un archivo único.
  { control: "Entregadas", montar: renderDetalle, filas: 1 },
  { control: "Rechazadas", montar: renderDetalle, filas: 1 },
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  buildXlsxRowsMock.mockResolvedValue(new ArrayBuffer(8));
});

afterEach(() => {
  cleanup();
});

describe("Cierres · descarga", () => {
  it("cada tabla de cierres ofrece su control, con nombre accesible propio", async () => {
    // R1/R13. Los nombres son DISTINTOS entre sí a propósito: varias de estas pantallas
    // montan dos tablas a la vez, y dos controles llamados igual no dicen cuál es cuál.
    for (const tabla of TABLAS) {
      tabla.montar();
      expect(
        screen.getByRole("button", { name: `Descargar ${tabla.control}` }),
        `${tabla.control} sin control`,
      ).toBeInTheDocument();
      cleanup();
    }
  });

  it("el archivo trae las filas de SU tabla, en el orden de la pantalla", async () => {
    // R11/R30: Familia B pura. Cada archivo es exactamente el array que su tabla pinta, en
    // el mismo orden, sin releer nada del servidor.
    for (const tabla of TABLAS) {
      const user = userEvent.setup();
      tabla.montar();

      await user.click(screen.getByRole("button", { name: `Descargar ${tabla.control}` }));
      await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));

      const [, filas, titulo] = buildXlsxRowsMock.mock.calls[0];
      expect(filas, `${tabla.control}: filas del archivo`).toHaveLength(tabla.filas);
      expect(titulo).toBe(tabla.control);

      cleanup();
      vi.clearAllMocks();
      buildXlsxRowsMock.mockResolvedValue(new ArrayBuffer(8));
    }

    // Y el orden, comprobado fila a fila en la cola del admin (dos filas distintas).
    const user = userEvent.setup();
    renderCierresAdmin();
    await user.click(
      screen.getByRole("button", { name: "Descargar Cierres pendientes de decisión" }),
    );
    await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));
    const [, filas] = buildXlsxRowsMock.mock.calls[0];
    expect(filas.map((f) => f.mensajero)).toEqual(
      PENDIENTES.map((c) => c.mensajeroNombre),
    );
  });

  it("ninguna URL firmada ni ruta de almacenamiento llega al archivo", async () => {
    // R22. El detalle y el cierre del día son las dos superficies con evidencia FIRMADA.
    // Se descargan las secciones que la tienen y se revisa CADA celda: ni el enlace, ni el
    // token, ni la ruta de almacenamiento. Lo que sí viaja es el «Sí» de que existe.
    const user = userEvent.setup();
    renderDetalle();

    for (const seccion of ["Rechazadas", "Incidentes"]) {
      await user.click(screen.getByRole("button", { name: `Descargar ${seccion}` }));
      await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalled());

      const [columnas, filas] = buildXlsxRowsMock.mock.calls.at(-1)!;
      for (const celda of Object.values(filas[0])) {
        const texto = String(celda ?? "");
        expect(texto, `${seccion}: celda con URL`).not.toMatch(/https?:\/\//i);
        expect(texto, `${seccion}: celda con ruta de almacén`).not.toMatch(
          /(^|\/)(storage|buckets?|evidencias?|uploads?)\//i,
        );
        expect(texto).not.toContain("token=");
      }
      // El dato que SÍ se entrega: hay evidencia, sin regalar el acceso.
      expect(columnas.map((c) => c.header)).toContain("Tiene evidencia");
      expect(filas[0].tieneEvidencia).toBe("Sí");
    }
  });

  it("estados, causas y destinos salen como etiqueta legible, nunca el value del enum", async () => {
    // R8. Un archivo que dijera `bodega_satelite`, `rechazado` o `robado` obligaría a quien
    // lo abre a traducir a mano lo que la pantalla ya traduce.
    const user = userEvent.setup();
    renderCierresAdmin();

    await user.click(
      screen.getByRole("button", { name: "Descargar Cierres del día resueltos" }),
    );
    await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));
    const [, filasHistorico] = buildXlsxRowsMock.mock.calls[0];
    expect(filasHistorico[0].estado).toBe("Rechazado");
    expect(filasHistorico[0].destino).toBe("Bodega satélite · Limón");
    expect(filasHistorico[0].motivo).toBe("Falta el depósito");
    cleanup();
    vi.clearAllMocks();
    buildXlsxRowsMock.mockResolvedValue(new ArrayBuffer(8));

    // La causa del incidente y el origen del rechazo, en el detalle.
    const user2 = userEvent.setup();
    renderDetalle();
    await user2.click(screen.getByRole("button", { name: "Descargar Incidentes" }));
    await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));
    const [, filasIncidente] = buildXlsxRowsMock.mock.calls[0];
    expect(filasIncidente[0].causa).toBe("Paquete robado");
    // La indemnización, money-safe: el STRING tal cual, sin símbolo.
    expect(filasIncidente[0].indemnizacion).toBe("2500.00");

    await user2.click(screen.getByRole("button", { name: "Descargar Rechazadas" }));
    await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(2));
    const [, filasRechazo] = buildXlsxRowsMock.mock.calls[1];
    expect(filasRechazo[0].origenRechazo).toBe("Automático");
  });

  it("el archivo del adminSatelite solo trae los cierres de su zona", async () => {
    // R14/R20: el acotamiento lo pone el SERVIDOR (la página del adminSatelite solo recibe
    // los de su zona). Lo que este test fija es que la descarga no lo amplía por su cuenta:
    // el archivo es exactamente el conjunto recibido, ni una fila más.
    const user = userEvent.setup();
    renderConsolidacion();

    await user.click(
      screen.getByRole("button", { name: "Descargar Cierres del día a consolidar" }),
    );
    await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));

    const [, filas] = buildXlsxRowsMock.mock.calls[0];
    expect(filas).toHaveLength(CONSOLIDABLES.length);
    expect(filas.map((f) => f.mensajero)).toEqual(
      CONSOLIDABLES.map((c) => c.mensajeroNombre),
    );
  });

  // -------------------------------------------------------------------------
  // Feature 184 — Tanda B (T B.2): «Cierres de bodega solicitados» (listado 6)
  // -------------------------------------------------------------------------

  it("el archivo de los cierres de bodega solicitados sale de su lectura DEDICADA, no del listado compuesto (R1/R8)", async () => {
    // Las tres mitades de lo que la tanda B cierra para el listado 6:
    //
    //   (a) montar la pantalla NO ejecuta la lectura del conjunto (R8);
    //   (b) al pulsar se llama a `listarCierresBodegaSolicitadosCompleto` UNA vez, y sin un solo
    //       argumento: este listado no tiene filtros, así que ni `page`, ni `pageSize`, ni
    //       `zonaId` —la única cuya aceptación abriría el dinero de la bodega vecina— pueden
    //       viajar (R4/R17);
    //   (c) y NO se relee `listarConsolidacion`, que además de este histórico devuelve los
    //       consolidables, el gate de bloqueo y los cinco agregados de dinero con su reparto de
    //       efectivo. De todo eso, el archivo usaba UN campo. Ésa era la deuda.
    const user = userEvent.setup();
    renderConsolidacion();

    expect(listarCierresBodegaSolicitadosCompleto).not.toHaveBeenCalled();
    expect(listarConsolidacion).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: "Descargar Cierres de bodega solicitados" }),
    );
    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));

    expect(listarCierresBodegaSolicitadosCompleto).toHaveBeenCalledTimes(1);
    expect(vi.mocked(listarCierresBodegaSolicitadosCompleto).mock.calls[0]).toEqual([]);
    expect(listarConsolidacion).not.toHaveBeenCalled();
    // Y sigue sin pedir páginas: descargar por partes lo que se entrega entero es la otra forma
    // de degradar el archivo.
    expect(listarCierresBodegaSolicitadosPaginado).toHaveBeenCalledTimes(1);
  });

  it("descargar los cierres de bodega solicitados no cuesta los agregados de dinero de la cabecera (R10)", async () => {
    // La mitad de CLIENTE de R10 (la de servidor son los espías de
    // `tests/unit/services/consolidacion-completo.test.ts`): los cinco agregados y el reparto de
    // efectivo los produce `listarConsolidacion`, así que «no calcularlos al descargar» se
    // observa aquí como «no volver a leer el listado que los calcula». Y su otra mitad, la que
    // impide que el ahorro se cobre en la pantalla: los números siguen ahí, iguales, porque
    // llegan por props y esta tanda no los toca (R49/R50 de la 170).
    const user = userEvent.setup();
    renderConsolidacion();

    const numero = (etiqueta: string) =>
      screen.getByRole("region", { name: etiqueta }).textContent;
    const antes = [
      numero("Totales a consolidar"),
      numero("Pago a mensajeros a consolidar"),
      numero("Ingreso de bodega por rechazos a consolidar"),
    ];

    await user.click(
      screen.getByRole("button", { name: "Descargar Cierres de bodega solicitados" }),
    );
    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));

    expect(listarConsolidacion).not.toHaveBeenCalled();
    expect([
      numero("Totales a consolidar"),
      numero("Pago a mensajeros a consolidar"),
      numero("Ingreso de bodega por rechazos a consolidar"),
    ]).toEqual(antes);
  });

  it("la pantalla NO recorta ni reordena el conjunto que devolvió el servidor (R2)", async () => {
    // El caso que discrimina «el servidor entrega el conjunto» de «el servidor lo entrega Y la
    // pantalla lo vuelve a tocar». La tabla pinta UNA fila (su página) y el doble devuelve a
    // propósito DOS, en un orden que cualquier orden de cliente cambiaría (el rechazado antes
    // que el aprobado). El archivo tiene que traer las dos, en ESE orden.
    const user = userEvent.setup();
    renderConsolidacion();

    const otro = cierreBodega({ cierreBodegaId: "b9", estado: "rechazado" });
    vi.mocked(listarCierresBodegaSolicitadosCompleto).mockResolvedValueOnce({
      status: "ok",
      items: [otro, ...BODEGA_SOLICITADOS],
      total: 2,
    });

    await user.click(
      screen.getByRole("button", { name: "Descargar Cierres de bodega solicitados" }),
    );
    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));

    const [, filas] = buildXlsxRowsMock.mock.calls[0];
    expect(filas.map((f) => f.estado)).toEqual(["Rechazado", "Aprobado"]);
  });

  it("un fallo de la lectura del conjunto no produce archivo y el mensaje no lleva datos personales (R7)", async () => {
    const user = userEvent.setup();
    renderConsolidacion();
    vi.mocked(listarCierresBodegaSolicitadosCompleto).mockResolvedValueOnce({
      status: "forbidden",
    });

    await user.click(
      screen.getByRole("button", { name: "Descargar Cierres de bodega solicitados" }),
    );
    // Ancla POSITIVA: se espera a que el aviso SALGA, no a que el archivo no salga —una ausencia
    // se cumple también antes de que la descarga empiece, y eso no ancla nada—.
    await waitFor(() => expect(errorToastMock).toHaveBeenCalledTimes(1));

    const [mensaje] = errorToastMock.mock.calls[0] as [string];
    expect(mensaje).toMatch(/Vuelve a intentarlo/);
    // Accionable, y sin un solo dato del dominio: ni quién solicitó, ni zona, ni montos.
    for (const dato of ["Sara Satélite", "Limón", "1000.10", "b3"]) {
      expect(mensaje).not.toContain(dato);
    }
    expect(descargarBlobMock).not.toHaveBeenCalled();
    expect(buildXlsxRowsMock).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Feature 184 — Tanda B (T B.2): «Cierres del día a consolidar» (listado 7)
  // -------------------------------------------------------------------------

  it("el archivo de los consolidables sale de su lectura DEDICADA, no del listado compuesto (R1/R8)", async () => {
    // El gemelo del listado 6, y con el mismo motivo doblado: `listarConsolidacion` no solo
    // devuelve estas filas, sino que reparte el efectivo entre TODOS los pagos individuales de
    // la zona para producir dos de los cinco agregados. Descargar siete columnas no tiene por
    // qué costar eso (R10; la mitad de servidor son los espías de
    // `tests/unit/services/consolidacion-completo.test.ts`).
    const user = userEvent.setup();
    renderConsolidacion();

    expect(listarConsolidablesCompleto).not.toHaveBeenCalled();
    expect(listarConsolidacion).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: "Descargar Cierres del día a consolidar" }),
    );
    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));

    expect(listarConsolidablesCompleto).toHaveBeenCalledTimes(1);
    // Sin un solo argumento: este listado tampoco tiene filtros, así que ni `page`, ni
    // `pageSize`, ni `zonaId` pueden viajar (R4/R17).
    expect(vi.mocked(listarConsolidablesCompleto).mock.calls[0]).toEqual([]);
    expect(listarConsolidacion).not.toHaveBeenCalled();
    expect(listarConsolidablesPaginado).toHaveBeenCalledTimes(1);
  });

  it("descargar los consolidables no cambia el contador ni los agregados de la cabecera (R10/R26)", async () => {
    // El contador «(N)» de esta sección sale del `total` del servidor y los cinco agregados de
    // dinero llegan por props: cambiar de dónde sale el archivo no puede tocar ninguno de los
    // dos. Es lo que R49/R50 de la 170 fijaron y esta tanda no revisa.
    const user = userEvent.setup();
    renderConsolidacion();

    const seccion = () =>
      screen.getByRole("region", { name: "Cierres del día a consolidar" }).textContent;
    const totales = () =>
      screen.getByRole("region", { name: "Totales a consolidar" }).textContent;
    const antes = [seccion(), totales()];

    await user.click(
      screen.getByRole("button", { name: "Descargar Cierres del día a consolidar" }),
    );
    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));

    expect(listarConsolidacion).not.toHaveBeenCalled();
    expect([seccion(), totales()]).toEqual(antes);
  });

  it("la pantalla NO recorta ni reordena el conjunto de consolidables que devolvió el servidor (R2)", async () => {
    // Mismo discriminador que en el listado 6: el doble devuelve una fila MÁS de las que la
    // tabla pinta y en un orden que un orden alfabético de cliente cambiaría.
    const user = userEvent.setup();
    renderConsolidacion();

    const primero = consolidable(9);
    primero.mensajeroNombre = "Zoe Mensajera";
    vi.mocked(listarConsolidablesCompleto).mockResolvedValueOnce({
      status: "ok",
      items: [primero, ...CONSOLIDABLES],
      total: 3,
    });

    await user.click(
      screen.getByRole("button", { name: "Descargar Cierres del día a consolidar" }),
    );
    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));

    const [, filas] = buildXlsxRowsMock.mock.calls[0];
    expect(filas.map((f) => f.mensajero)).toEqual([
      "Zoe Mensajera",
      ...CONSOLIDABLES.map((c) => c.mensajeroNombre),
    ]);
  });

  it("un fallo de la lectura de los consolidables no produce archivo y el mensaje no lleva datos personales (R7)", async () => {
    const user = userEvent.setup();
    renderConsolidacion();
    vi.mocked(listarConsolidablesCompleto).mockResolvedValueOnce({ status: "forbidden" });

    await user.click(
      screen.getByRole("button", { name: "Descargar Cierres del día a consolidar" }),
    );
    // Ancla POSITIVA: el aviso que SALE, no el archivo que no sale.
    await waitFor(() => expect(errorToastMock).toHaveBeenCalledTimes(1));

    const [mensaje] = errorToastMock.mock.calls[0] as [string];
    expect(mensaje).toMatch(/Vuelve a intentarlo/);
    for (const dato of ["Mensajero 1", "1000.10", "cd-1"]) {
      expect(mensaje).not.toContain(dato);
    }
    expect(descargarBlobMock).not.toHaveBeenCalled();
    expect(buildXlsxRowsMock).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Feature 184 — Tanda C (T C.2): «Cierres solicitados por el mensajero» (listado 1)
  // -------------------------------------------------------------------------

  it("el archivo de los cierres del mensajero sale de su lectura DEDICADA, no del listado compuesto (R1/R8)", async () => {
    // Las tres mitades, como en la tanda B:
    //
    //   (a) montar la pantalla NO ejecuta la lectura del conjunto (R8);
    //   (b) al pulsar se llama a `listarCierresPasadosCompleto` UNA vez y SIN un solo argumento:
    //       este listado no tiene filtros, así que ni `page`, ni `pageSize`, ni —sobre todo—
    //       `mensajeroId` pueden viajar. Es el único listado del Anexo A cuyo alcance es el
    //       propio usuario: una clave de alcance aceptada aquí abriría el histórico de dinero
    //       de OTRO mensajero (R4/R17);
    //   (c) y NO se relee `listarCierreDia`, el listado COMPUESTO de la pantalla.
    const user = userEvent.setup();
    renderCierreDia();

    expect(listarCierresPasadosCompleto).not.toHaveBeenCalled();
    expect(listarCierreDia).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Descargar Cierres solicitados" }));
    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));

    expect(listarCierresPasadosCompleto).toHaveBeenCalledTimes(1);
    expect(vi.mocked(listarCierresPasadosCompleto).mock.calls[0]).toEqual([]);
    expect(listarCierreDia).not.toHaveBeenCalled();
    // Y sigue sin pedir páginas: descargar por partes lo que se entrega entero es la otra forma
    // de degradar el archivo.
    expect(listarCierresPasadosPaginado).toHaveBeenCalledTimes(1);
  });

  it("descargar los cierres del mensajero ya no dispara la relectura que FIRMA las evidencias (R9)", async () => {
    // La mitad de CLIENTE de R9, y es la que este archivo puede medir sin duplicar la del
    // servidor: el espía sobre `createSignedUrls` vive en
    // `tests/unit/services/cierre-dia-pasados-completo.test.ts` y prueba que el camino nuevo no
    // firma; lo que se prueba AQUÍ es que la pantalla dejó de PEDIR el camino que sí firmaba.
    // Las dos mitades hacen falta: un servicio que no firma no sirve de nada si la pantalla
    // sigue llamando al listado compuesto, y ese es justo el estado del que salimos.
    //
    // Por qué el archivo no lo delata: sus ocho columnas salen enteras del `CierrePasadoDTO`,
    // que no tiene campo de evidencia. Firmando y sin firmar el xlsx es idéntico — por eso la
    // deuda llevaba aquí desde la 170 sin que ningún test la viera, y por eso este `expect` no
    // es decorado: si se quita, la relectura puede volver sin que nada falle.
    const user = userEvent.setup();
    renderCierreDia();

    await user.click(screen.getByRole("button", { name: "Descargar Cierres solicitados" }));
    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));

    expect(listarCierreDia).not.toHaveBeenCalled();

    // ANTI-VACUIDAD, en dos pasos, porque «cero llamadas» pasa igual con un doble muerto:
    //  1. la descarga SÍ ocurrió y produjo sus filas —el cero de arriba no es «no pasó nada»—;
    const [, filas] = buildXlsxRowsMock.mock.calls[0];
    expect(filas).toHaveLength(CIERRES_PASADOS.length);
    //  2. y el doble del compuesto está VIVO y trae evidencias FIRMADAS: si la pantalla lo
    //     llamara, respondería. No llamarlo es una decisión de la pantalla, no del arnés.
    const compuesto = await listarCierreDia();
    expect(compuesto.status === "ok" && compuesto.grupos.rechazada[0].evidenciaUrl).toBe(
      EVIDENCIA_FIRMADA,
    );
  });

  it("la pantalla NO recorta ni reordena el conjunto de cierres del mensajero que devolvió el servidor (R2)", async () => {
    // El discriminador entre «el servidor entrega el conjunto» y «lo entrega Y la pantalla lo
    // vuelve a tocar», con los dos números separados a propósito:
    //
    //   · el doble devuelve TREINTA filas y la tabla pinta DOS, así que un archivo de 25 —el
    //     `pageSize` de este dominio— o de 2 se distingue del bueno (recorte);
    //   · y las tres primeras van en un orden que NINGÚN orden de cliente reproduce: ni por
    //     fecha descendente (sería 19, 12, 11) ni ascendente (11, 12, 19) (reordenación).
    //
    // Hacen falta las dos mitades: recortar lo caza además la guardia vieja de R52, pero
    // reordenar NO —el archivo sigue teniendo todas sus filas— y ése es el defecto que Q-I2/Q-L3
    // ya dejaron escrito en este repo.
    const user = userEvent.setup();
    renderCierreDia();

    const relleno = Array.from({ length: 27 }, (_, i) => ({
      ...cierrePasado(1),
      cierreId: `cp-relleno-${i}`,
    }));
    vi.mocked(listarCierresPasadosCompleto).mockResolvedValueOnce({
      status: "ok",
      items: [cierrePasado(2), cierrePasado(9), cierrePasado(1), ...relleno],
      total: 30,
    });

    await user.click(screen.getByRole("button", { name: "Descargar Cierres solicitados" }));
    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));

    const [, filas] = buildXlsxRowsMock.mock.calls[0];
    expect(filas, "el archivo trae la página, no el conjunto").toHaveLength(30);
    expect(filas.slice(0, 3).map((f) => f.fecha)).toEqual([
      "2026-07-12",
      "2026-07-19",
      "2026-07-11",
    ]);
  });

  it("un fallo de la lectura de los cierres del mensajero no produce archivo y el mensaje no lleva datos personales (R7)", async () => {
    const user = userEvent.setup();
    renderCierreDia();
    vi.mocked(listarCierresPasadosCompleto).mockResolvedValueOnce({ status: "forbidden" });

    await user.click(screen.getByRole("button", { name: "Descargar Cierres solicitados" }));
    // Ancla POSITIVA: el aviso que SALE, no el archivo que no sale.
    await waitFor(() => expect(errorToastMock).toHaveBeenCalledTimes(1));

    const [mensaje] = errorToastMock.mock.calls[0] as [string];
    expect(mensaje).toMatch(/Vuelve a intentarlo/);
    // Accionable, y sin un solo dato del dominio: ni montos, ni identificadores, ni la URL
    // firmada que esta pantalla es la única en tener a mano.
    for (const dato of ["1000.10", "cp-1", "secreto", EVIDENCIA_FIRMADA]) {
      expect(mensaje).not.toContain(dato);
    }
    expect(descargarBlobMock).not.toHaveBeenCalled();
    expect(buildXlsxRowsMock).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Feature 184 — Tanda D (T D.3): «Cierres del día — histórico» (listado 2)
  // -------------------------------------------------------------------------

  it("el archivo del histórico de cierres del día sale de su lectura DEDICADA, no del listado compuesto (R1/R8)", async () => {
    // Las tres mitades, como en las tandas B y C:
    //
    //   (a) montar la pantalla NO ejecuta la lectura del conjunto (R8);
    //   (b) al pulsar se llama a `listarHistoricoCierresAdminCompleto` UNA vez y SIN un solo
    //       argumento: este listado no tiene filtros, así que ni `page`, ni `pageSize`, ni
    //       —sobre todo— `destinoZonaId`/`destinoTipo` pueden viajar. Son las dos claves que,
    //       aceptadas aquí, abrirían el dinero de la bodega vecina a un `adminSatelite`
    //       (R4/R17);
    //   (c) y NO se relee `listarCierresAdmin`, el listado COMPUESTO de esta pantalla.
    const user = userEvent.setup();
    renderCierresAdmin();

    expect(listarHistoricoCierresAdminCompleto).not.toHaveBeenCalled();
    expect(listarCierresAdmin).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: "Descargar Cierres del día resueltos" }),
    );
    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));

    expect(listarHistoricoCierresAdminCompleto).toHaveBeenCalledTimes(1);
    expect(vi.mocked(listarHistoricoCierresAdminCompleto).mock.calls[0]).toEqual([]);
    expect(listarCierresAdmin).not.toHaveBeenCalled();
    // Y sigue sin pedir páginas: descargar por partes lo que se entrega entero es la otra forma
    // de degradar el archivo.
    expect(listarHistoricoCierresAdminPaginado).toHaveBeenCalledTimes(1);
  });

  it("descargar el histórico ya no arrastra la COLA: el compuesto trae las dos mitades y ya no se pide (R1)", async () => {
    // LA propiedad de esta tanda, y la que el xlsx por sí solo NO puede distinguir. El listado
    // compuesto (`listarCierresAdmin`) devuelve la cola Y el histórico del alcance; esta
    // descarga se quedaba con UNA de las dos mitades y pagaba las dos. Volver a ese camino y
    // seleccionar `res.historico` produce EXACTAMENTE las mismas filas, en el mismo orden: no
    // hay ninguna celda que cambie. Lo único que lo delata es contar las llamadas — por eso
    // este `expect` no es decorado: si se quita, la relectura puede volver sin que nada falle.
    //
    // La mitad de SERVIDOR (que la lectura dedicada corta por estado en la base y lee 5 filas
    // en vez de 7) vive en `tests/unit/services/cierres-admin-completo.test.ts`.
    const user = userEvent.setup();
    renderCierresAdmin();

    await user.click(
      screen.getByRole("button", { name: "Descargar Cierres del día resueltos" }),
    );
    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));

    expect(listarCierresAdmin).not.toHaveBeenCalled();

    // ANTI-VACUIDAD, en dos pasos, porque «cero llamadas» pasa igual con un doble muerto:
    //  1. la descarga SÍ ocurrió y produjo sus filas —el cero de arriba no es «no pasó nada»—;
    const [, filas] = buildXlsxRowsMock.mock.calls[0];
    expect(filas).toHaveLength(HISTORICO.length);
    //  2. y el doble del compuesto está VIVO y trae LAS DOS MITADES: si la pantalla lo llamara,
    //     respondería con la cola además del histórico. No llamarlo es una decisión de la
    //     pantalla, no del arnés.
    const compuesto = await listarCierresAdmin();
    expect(compuesto.status === "ok" && compuesto.pendientes).toHaveLength(PENDIENTES.length);
    expect(compuesto.status === "ok" && compuesto.historico).toHaveLength(HISTORICO.length);
  });

  it("la pantalla NO recorta ni reordena el histórico de cierres del día que devolvió el servidor (R2)", async () => {
    // El discriminador entre «el servidor entrega el conjunto» y «lo entrega Y la pantalla lo
    // vuelve a tocar», con los dos números separados a propósito:
    //
    //   · el doble devuelve TREINTA filas y la tabla pinta UNA, así que un archivo de 25 —el
    //     `pageSize` de este dominio— o de 1 se distingue del bueno (recorte). Con un fixture
    //     de 3 filas un recorte a la página entera no se vería: la página SERÍA el conjunto;
    //   · y las tres primeras van en un orden que NINGÚN orden de cliente reproduce: ni por
    //     fecha descendente (sería 19, 12, 11) ni ascendente (11, 12, 19) (reordenación).
    const user = userEvent.setup();
    renderCierresAdmin();

    const resuelto = (i: number, dia: string) =>
      cierreAdmin({
        cierreId: `ch-${i}`,
        estado: "aprobado",
        resueltoAt: `2026-07-${dia}T10:00:00.000Z`,
      });
    const relleno = Array.from({ length: 27 }, (_, i) => resuelto(100 + i, "15"));
    vi.mocked(listarHistoricoCierresAdminCompleto).mockResolvedValueOnce({
      status: "ok",
      items: [resuelto(1, "12"), resuelto(2, "19"), resuelto(3, "11"), ...relleno],
      total: 30,
    });

    await user.click(
      screen.getByRole("button", { name: "Descargar Cierres del día resueltos" }),
    );
    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));

    const [, filas] = buildXlsxRowsMock.mock.calls[0];
    expect(filas, "el archivo trae la página, no el conjunto").toHaveLength(30);
    expect(filas.slice(0, 3).map((f) => f.fechaResuelta)).toEqual([
      "2026-07-12",
      "2026-07-19",
      "2026-07-11",
    ]);
  });

  it("un fallo de la lectura del histórico de cierres del día no produce archivo y el mensaje no lleva datos personales (R7)", async () => {
    const user = userEvent.setup();
    renderCierresAdmin();
    vi.mocked(listarHistoricoCierresAdminCompleto).mockResolvedValueOnce({
      status: "forbidden",
    });

    await user.click(
      screen.getByRole("button", { name: "Descargar Cierres del día resueltos" }),
    );
    // Ancla POSITIVA: el aviso que SALE, no el archivo que no sale.
    await waitFor(() => expect(errorToastMock).toHaveBeenCalledTimes(1));

    const [mensaje] = errorToastMock.mock.calls[0] as [string];
    expect(mensaje).toMatch(/Vuelve a intentarlo/);
    // Accionable, y sin un solo dato del dominio: ni quién cerró, ni zona, ni montos, ni el
    // motivo del rechazo —que es texto libre escrito por un administrador—.
    for (const dato of ["Carla Mensajera", "Limón", "1000.10", "c3", "Falta el depósito"]) {
      expect(mensaje).not.toContain(dato);
    }
    expect(descargarBlobMock).not.toHaveBeenCalled();
    expect(buildXlsxRowsMock).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Feature 184 — Tanda D (T D.3): «Cierres del día pendientes» (listado 3)
  // -------------------------------------------------------------------------

  it("el archivo de la cola de cierres del día sale de su lectura DEDICADA, no del listado compuesto (R1/R8)", async () => {
    // El gemelo del histórico, y el que más se ahorra en producción: la cola son los cierres
    // sin resolver —una decena— y el histórico que arrastraba crece sin tope con los días, así
    // que descargar la cola costaba el alcance entero.
    const user = userEvent.setup();
    renderCierresAdmin();

    expect(listarPendientesCierresAdminCompleto).not.toHaveBeenCalled();
    expect(listarCierresAdmin).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: "Descargar Cierres pendientes de decisión" }),
    );
    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));

    expect(listarPendientesCierresAdminCompleto).toHaveBeenCalledTimes(1);
    // Sin un solo argumento: ni `page`, ni `pageSize`, ni `destinoZonaId`/`destinoTipo`, que
    // son las claves que abrirían el dinero de la bodega vecina (R4/R17).
    expect(vi.mocked(listarPendientesCierresAdminCompleto).mock.calls[0]).toEqual([]);
    expect(listarCierresAdmin).not.toHaveBeenCalled();
    expect(listarPendientesCierresAdminPaginado).toHaveBeenCalledTimes(1);
  });

  it("descargar la cola ya no arrastra el HISTÓRICO: el compuesto trae las dos mitades y ya no se pide (R1)", async () => {
    // Misma propiedad que en el histórico y con el mismo motivo para existir: volver al listado
    // compuesto y quedarse con `res.pendientes` produce EXACTAMENTE las mismas filas, en el
    // mismo orden. El xlsx no lo distingue; el recuento de llamadas sí.
    const user = userEvent.setup();
    renderCierresAdmin();

    await user.click(
      screen.getByRole("button", { name: "Descargar Cierres pendientes de decisión" }),
    );
    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));

    expect(listarCierresAdmin).not.toHaveBeenCalled();

    // ANTI-VACUIDAD, en dos pasos:
    //  1. la descarga SÍ ocurrió y produjo sus filas;
    const [, filas] = buildXlsxRowsMock.mock.calls[0];
    expect(filas).toHaveLength(PENDIENTES.length);
    //  2. y el doble del compuesto está VIVO y trae LAS DOS MITADES.
    const compuesto = await listarCierresAdmin();
    expect(compuesto.status === "ok" && compuesto.pendientes).toHaveLength(PENDIENTES.length);
    expect(compuesto.status === "ok" && compuesto.historico).toHaveLength(HISTORICO.length);
  });

  it("la pantalla NO recorta ni reordena la cola de cierres del día que devolvió el servidor (R2)", async () => {
    // El doble devuelve TREINTA filas y la tabla pinta DOS: un archivo de 25 —el `pageSize` del
    // dominio— o de 2 se distingue del bueno. Y las tres primeras van en un orden que ningún
    // orden de cliente reproduce, ni ascendente ni descendente por fecha.
    const user = userEvent.setup();
    renderCierresAdmin();

    const solicitado = (i: number, dia: string) =>
      cierreAdmin({
        cierreId: `cc-${i}`,
        estado: "solicitado",
        solicitadoAt: `2026-07-${dia}T10:00:00.000Z`,
      });
    const relleno = Array.from({ length: 27 }, (_, i) => solicitado(100 + i, "15"));
    vi.mocked(listarPendientesCierresAdminCompleto).mockResolvedValueOnce({
      status: "ok",
      items: [solicitado(1, "12"), solicitado(2, "19"), solicitado(3, "11"), ...relleno],
      total: 30,
    });

    await user.click(
      screen.getByRole("button", { name: "Descargar Cierres pendientes de decisión" }),
    );
    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));

    const [, filas] = buildXlsxRowsMock.mock.calls[0];
    expect(filas, "el archivo trae la página, no el conjunto").toHaveLength(30);
    expect(filas.slice(0, 3).map((f) => f.fecha)).toEqual([
      "2026-07-12",
      "2026-07-19",
      "2026-07-11",
    ]);
  });

  it("un fallo de la lectura de la cola de cierres del día no produce archivo y el mensaje no lleva datos personales (R7)", async () => {
    const user = userEvent.setup();
    renderCierresAdmin();
    vi.mocked(listarPendientesCierresAdminCompleto).mockResolvedValueOnce({
      status: "forbidden",
    });

    await user.click(
      screen.getByRole("button", { name: "Descargar Cierres pendientes de decisión" }),
    );
    // Ancla POSITIVA: el aviso que SALE, no el archivo que no sale.
    await waitFor(() => expect(errorToastMock).toHaveBeenCalledTimes(1));

    const [mensaje] = errorToastMock.mock.calls[0] as [string];
    expect(mensaje).toMatch(/Vuelve a intentarlo/);
    for (const dato of ["Ana Mensajera", "Beto Mensajero", "Limón", "1000.10", "c1"]) {
      expect(mensaje).not.toContain(dato);
    }
    expect(descargarBlobMock).not.toHaveBeenCalled();
    expect(buildXlsxRowsMock).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Feature 184 — Tanda E (T E.3): «Cierres de bodega pendientes» (listado 4)
  // -------------------------------------------------------------------------

  it("el archivo de la cola de cierres de bodega sale de su lectura DEDICADA, no del listado compuesto (R1/R8)", async () => {
    // Las tres mitades, como en las tandas B, C y D:
    //
    //   (a) montar la pantalla NO ejecuta la lectura del conjunto (R8);
    //   (b) al pulsar se llama a `listarPendientesCierresBodegaCompleto` UNA vez y SIN un solo
    //       argumento: este listado no tiene filtros, así que ni `page`, ni `pageSize`, ni
    //       `zonaId` —la única cuya aceptación entregaría el dinero agregado de otra bodega—
    //       pueden viajar (R4/R17);
    //   (c) y NO se relee `listarCierresBodegaAdmin`, el listado COMPUESTO de esta pantalla.
    const user = userEvent.setup();
    renderCierresBodega();

    expect(listarPendientesCierresBodegaCompleto).not.toHaveBeenCalled();
    expect(listarCierresBodegaAdmin).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: "Descargar Cierres de bodega pendientes" }),
    );
    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));

    expect(listarPendientesCierresBodegaCompleto).toHaveBeenCalledTimes(1);
    expect(vi.mocked(listarPendientesCierresBodegaCompleto).mock.calls[0]).toEqual([]);
    expect(listarCierresBodegaAdmin).not.toHaveBeenCalled();
    // Y sigue sin pedir páginas: descargar por partes lo que se entrega entero es la otra forma
    // de degradar el archivo.
    expect(listarPendientesCierresBodegaPaginado).toHaveBeenCalledTimes(1);
  });

  it("descargar la cola de bodega ya no arrastra el HISTÓRICO: el compuesto trae las dos mitades y ya no se pide (R1)", async () => {
    // LA propiedad de esta tanda, y la que el xlsx por sí solo NO puede distinguir. El listado
    // compuesto (`listarCierresBodegaAdmin`) devuelve la cola Y el histórico de TODA la
    // operación; esta descarga se quedaba con una de las dos mitades y pagaba las dos. Volver a
    // ese camino y seleccionar `res.pendientes` produce EXACTAMENTE las mismas filas, en el
    // mismo orden: no hay ninguna celda que cambie. Lo único que lo delata es contar las
    // llamadas — por eso este `expect` no es decorado: si se quita, la relectura puede volver
    // sin que nada falle.
    //
    // Y aquí la asimetría pesa del lado feo: la cola son los cierres sin resolver —una decena—
    // y el histórico que arrastraba crece sin tope con los días.
    //
    // La mitad de SERVIDOR (que la lectura dedicada corta por estado en la base y lee 2 filas
    // en vez de 7) vive en `tests/unit/services/cierres-bodega-admin-completo.test.ts`.
    const user = userEvent.setup();
    renderCierresBodega();

    await user.click(
      screen.getByRole("button", { name: "Descargar Cierres de bodega pendientes" }),
    );
    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));

    expect(listarCierresBodegaAdmin).not.toHaveBeenCalled();

    // ANTI-VACUIDAD, en dos pasos, porque «cero llamadas» pasa igual con un doble muerto:
    //  1. la descarga SÍ ocurrió y produjo sus filas —el cero de arriba no es «no pasó nada»—;
    const [, filas] = buildXlsxRowsMock.mock.calls[0];
    expect(filas).toHaveLength(BODEGA_PENDIENTES.length);
    //  2. y el doble del compuesto está VIVO y trae LAS DOS MITADES: si la pantalla lo llamara,
    //     respondería con el histórico además de la cola. No llamarlo es una decisión de la
    //     pantalla, no del arnés.
    const compuesto = await listarCierresBodegaAdmin();
    expect(compuesto.status === "ok" && compuesto.pendientes).toHaveLength(
      BODEGA_PENDIENTES.length,
    );
    expect(compuesto.status === "ok" && compuesto.historico).toHaveLength(
      BODEGA_RESUELTOS.length,
    );
  });

  it("la pantalla NO recorta ni reordena la cola de cierres de bodega que devolvió el servidor (R2)", async () => {
    // El discriminador entre «el servidor entrega el conjunto» y «lo entrega Y la pantalla lo
    // vuelve a tocar», con los dos números separados a propósito:
    //
    //   · el doble devuelve TREINTA filas y la tabla pinta UNA, así que un archivo de 25 —el
    //     `pageSize` de este dominio— o de 1 se distingue del bueno (recorte). Con el fixture de
    //     una fila, recortar a la página entera no se vería: la página SERÍA el conjunto;
    //   · y las tres primeras van en un orden que NINGÚN orden de cliente reproduce: ni por
    //     fecha descendente (sería 19, 12, 11) ni ascendente (11, 12, 19) (reordenación).
    const user = userEvent.setup();
    renderCierresBodega();

    const pendiente = (i: number, dia: string) =>
      cierreBodega({
        cierreBodegaId: `bp-${i}`,
        solicitadoAt: `2026-07-${dia}T10:00:00.000Z`,
      });
    const relleno = Array.from({ length: 27 }, (_, i) => pendiente(100 + i, "15"));
    vi.mocked(listarPendientesCierresBodegaCompleto).mockResolvedValueOnce({
      status: "ok",
      items: [pendiente(1, "12"), pendiente(2, "19"), pendiente(3, "11"), ...relleno],
      total: 30,
    });

    await user.click(
      screen.getByRole("button", { name: "Descargar Cierres de bodega pendientes" }),
    );
    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));

    const [, filas] = buildXlsxRowsMock.mock.calls[0];
    expect(filas, "el archivo trae la página, no el conjunto").toHaveLength(30);
    expect(filas.slice(0, 3).map((f) => f.fecha)).toEqual([
      "2026-07-12",
      "2026-07-19",
      "2026-07-11",
    ]);
  });

  it("un fallo de la lectura de la cola de cierres de bodega no produce archivo y el mensaje no lleva datos personales (R7)", async () => {
    const user = userEvent.setup();
    renderCierresBodega();
    vi.mocked(listarPendientesCierresBodegaCompleto).mockResolvedValueOnce({
      status: "forbidden",
    });

    await user.click(
      screen.getByRole("button", { name: "Descargar Cierres de bodega pendientes" }),
    );
    // Ancla POSITIVA: el aviso que SALE, no el archivo que no sale.
    await waitFor(() => expect(errorToastMock).toHaveBeenCalledTimes(1));

    const [mensaje] = errorToastMock.mock.calls[0] as [string];
    expect(mensaje).toMatch(/Vuelve a intentarlo/);
    // Accionable, y sin un solo dato del dominio: ni quién solicitó, ni zona, ni montos, ni
    // identificadores. Cada fila de esta cola ES el dinero agregado de una zona entera.
    for (const dato of ["Sara Satélite", "Limón", "1000.10", "b1"]) {
      expect(mensaje).not.toContain(dato);
    }
    expect(descargarBlobMock).not.toHaveBeenCalled();
    expect(buildXlsxRowsMock).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Feature 184 — Tanda E (T E.3): «Cierres de bodega resueltos» (listado 5)
  // -------------------------------------------------------------------------

  it("el archivo del histórico de cierres de bodega sale de su lectura DEDICADA, no del listado compuesto (R1/R8)", async () => {
    // El gemelo de la cola, y la otra mitad del MISMO listado compuesto: aquí lo que se
    // arrastraba era la cola de pendientes.
    //
    //   (a) montar la pantalla NO ejecuta la lectura del conjunto (R8);
    //   (b) al pulsar se llama a `listarHistoricoCierresBodegaCompleto` UNA vez y SIN un solo
    //       argumento (R4/R17);
    //   (c) y NO se relee `listarCierresBodegaAdmin`.
    const user = userEvent.setup();
    renderCierresBodega();

    expect(listarHistoricoCierresBodegaCompleto).not.toHaveBeenCalled();
    expect(listarCierresBodegaAdmin).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: "Descargar Cierres de bodega resueltos" }),
    );
    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));

    expect(listarHistoricoCierresBodegaCompleto).toHaveBeenCalledTimes(1);
    expect(vi.mocked(listarHistoricoCierresBodegaCompleto).mock.calls[0]).toEqual([]);
    expect(listarCierresBodegaAdmin).not.toHaveBeenCalled();
    expect(listarHistoricoCierresBodegaPaginado).toHaveBeenCalledTimes(1);
  });

  it("descargar el histórico de bodega ya no arrastra la COLA: el compuesto trae las dos mitades y ya no se pide (R1)", async () => {
    // Misma propiedad que en la cola y con el mismo motivo para existir: volver al listado
    // compuesto y quedarse con `res.historico` produce EXACTAMENTE las mismas filas, en el
    // mismo orden. El xlsx no lo distingue; el recuento de llamadas sí.
    const user = userEvent.setup();
    renderCierresBodega();

    await user.click(
      screen.getByRole("button", { name: "Descargar Cierres de bodega resueltos" }),
    );
    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));

    expect(listarCierresBodegaAdmin).not.toHaveBeenCalled();

    // ANTI-VACUIDAD, en dos pasos:
    //  1. la descarga SÍ ocurrió y produjo sus filas;
    const [, filas] = buildXlsxRowsMock.mock.calls[0];
    expect(filas).toHaveLength(BODEGA_RESUELTOS.length);
    //  2. y el doble del compuesto está VIVO y trae LAS DOS MITADES.
    const compuesto = await listarCierresBodegaAdmin();
    expect(compuesto.status === "ok" && compuesto.pendientes).toHaveLength(
      BODEGA_PENDIENTES.length,
    );
    expect(compuesto.status === "ok" && compuesto.historico).toHaveLength(
      BODEGA_RESUELTOS.length,
    );
  });

  it("la pantalla NO recorta ni reordena el histórico de cierres de bodega que devolvió el servidor (R2)", async () => {
    // El doble devuelve TREINTA filas y la tabla pinta UNA: un archivo de 25 —el `pageSize` del
    // dominio— o de 1 se distingue del bueno. Y las tres primeras van en un orden que ningún
    // orden de cliente reproduce, ni ascendente ni descendente por fecha.
    const user = userEvent.setup();
    renderCierresBodega();

    const resuelto = (i: number, dia: string) =>
      cierreBodega({
        cierreBodegaId: `br-${i}`,
        estado: "aprobado",
        resueltoAt: `2026-07-${dia}T10:00:00.000Z`,
      });
    const relleno = Array.from({ length: 27 }, (_, i) => resuelto(100 + i, "15"));
    vi.mocked(listarHistoricoCierresBodegaCompleto).mockResolvedValueOnce({
      status: "ok",
      items: [resuelto(1, "12"), resuelto(2, "19"), resuelto(3, "11"), ...relleno],
      total: 30,
    });

    await user.click(
      screen.getByRole("button", { name: "Descargar Cierres de bodega resueltos" }),
    );
    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));

    const [, filas] = buildXlsxRowsMock.mock.calls[0];
    expect(filas, "el archivo trae la página, no el conjunto").toHaveLength(30);
    expect(filas.slice(0, 3).map((f) => f.fechaResuelta)).toEqual([
      "2026-07-12",
      "2026-07-19",
      "2026-07-11",
    ]);
  });

  it("un fallo de la lectura del histórico de cierres de bodega no produce archivo y el mensaje no lleva datos personales (R7)", async () => {
    const user = userEvent.setup();
    renderCierresBodega();
    vi.mocked(listarHistoricoCierresBodegaCompleto).mockResolvedValueOnce({
      status: "forbidden",
    });

    await user.click(
      screen.getByRole("button", { name: "Descargar Cierres de bodega resueltos" }),
    );
    // Ancla POSITIVA: el aviso que SALE, no el archivo que no sale.
    await waitFor(() => expect(errorToastMock).toHaveBeenCalledTimes(1));

    const [mensaje] = errorToastMock.mock.calls[0] as [string];
    expect(mensaje).toMatch(/Vuelve a intentarlo/);
    // Accionable, y sin un solo dato del dominio: ni quién solicitó, ni zona, ni montos, ni
    // identificadores, ni el motivo del rechazo —texto libre escrito por un administrador—.
    for (const dato of ["Sara Satélite", "Limón", "1000.10", "b2"]) {
      expect(mensaje).not.toContain(dato);
    }
    expect(descargarBlobMock).not.toHaveBeenCalled();
    expect(buildXlsxRowsMock).not.toHaveBeenCalled();
  });

  it("descargar no cambia la fila expandida ni el modal abierto", async () => {
    // R37. El control vive FUERA del `<table>` y no llama a ningún setter de la tabla; se
    // comprueba con el estado más frágil de estas pantallas: una fila desplegada.
    const user = userEvent.setup();
    renderDetalle();

    const tabla = screen.getByRole("table", { name: "Entregadas" });
    const expandir = within(tabla).getAllByRole("button", { name: /Desglose de ingreso/ })[0];
    await user.click(expandir);
    expect(expandir).toHaveAttribute("aria-expanded", "true");

    await user.click(screen.getByRole("button", { name: "Descargar Entregadas" }));
    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));

    // Sigue desplegada, y el listado no se ha reordenado ni recortado.
    expect(expandir).toHaveAttribute("aria-expanded", "true");
    expect(within(tabla).getAllByRole("row").length).toBeGreaterThan(1);
  });

  // El tope de 5000 filas de Familia B NO se re-prueba aquí, y se dice por qué: montar
  // 5001 cierres en jsdom hace que estas pantallas rendericen 5001 filas MÁS 5001 tarjetas
  // de la «vista tipo factura», y el test tarda minutos sin afirmar nada que no esté ya
  // afirmado. El tope es del helper compartido (`filasLocales`), tiene sus tests unitarios
  // en `tests/unit/components/descarga-resultado.test.ts` (R26/R27/R28) y su test de
  // componente en `WalletPropsDescarga.test.tsx`; estas nueve tablas lo usan tal cual.
});
