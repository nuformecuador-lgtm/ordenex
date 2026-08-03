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
}));
vi.mock("@/lib/actions/cierre-dia", () => ({
  solicitarCierre: vi.fn(),
  listarCierreDia: vi.fn(),
  deshacerGestion: vi.fn(),
  listarCierresPasadosPaginado: vi.fn(),
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

import {
  listarCierresAdmin,
  listarHistoricoCierresAdminPaginado,
  listarPendientesCierresAdminPaginado,
} from "@/lib/actions/cierres-admin";
import {
  listarCierresBodegaAdmin,
  listarConsolidacion,
  listarCierresBodegaSolicitadosPaginado,
  listarConsolidablesPaginado,
  listarHistoricoCierresBodegaPaginado,
  listarPendientesCierresBodegaPaginado,
} from "@/lib/actions/cierre-bodega";
import { listarCierreDia, listarCierresPasadosPaginado } from "@/lib/actions/cierre-dia";
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
