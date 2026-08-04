// @vitest-environment jsdom
// Feature 170 — FASE 2, T M.1 (R52, R53, R54) — NO-REGRESIÓN TRANSVERSAL de la paginación.
//
// Es el test de CIERRE de la fase. Las tandas I, J, K y L probaron cada listado por dentro;
// aquí se prueba lo que ninguna de ellas podía probar sola: que las TRES propiedades que la
// paginación pone en riesgo siguen siendo ciertas EN TODO EL ÁRBOL, y que un listado nuevo
// —o un cableado que se toque dentro de un año— no pueda escaparse de ellas en silencio.
//
// Las tres propiedades, y por qué cada una necesita este archivo:
//
//  · R53 — los TRES listados del Anexo IV siguen entregándose COMPLETOS. Se declararon sin
//    paginar por una razón (el podio del ranking se quedaría sin ocupante; las vistas agrupadas
//    ocultan la sección vacía y cuentan por grupo). Nada impide que una tanda futura les ponga
//    un control «por coherencia» y rompa esas dos cosas sin que falle ningún test suyo.
//  · R54 — ningún listado paginado hace más consultas POR RENDER que antes, salvo el conteo.
//    Antes de paginar, la pantalla recibía su array por props y NO consultaba nada al pintar.
//    El equivalente hoy es el `fallbackData` de SWR: sin él la pantalla vuelve a pedir al
//    servidor la misma página que el Server Component ya resolvió, en cada render. La tanda I
//    lo midió por mutación y **pasó VERDE** (`impl_170-fase2-tanda-i.md` §16): quitar el
//    `fallbackData` no rompía nada. Ese es exactamente el agujero que esta guardia tapa.
//  · R52 — toda descarga de un listado paginado entrega el DATASET COMPLETO. La degradación
//    es silenciosa por naturaleza: `filasLocales(loQueLaTablaPinta)` era correcto en FASE 1 y,
//    con la tabla paginada, produce un archivo de 25 filas de 300 sin fallar en ninguna parte.
//
// El censo de abajo es la lista declarada, en el idioma de `censo-tablas.ts` y de
// `contadores-cabecera.guardia.test.ts`: se contrasta contra el árbol en los DOS sentidos, así
// que ni un listado nuevo puede colarse sin decidir, ni una entrada puede sobrevivir a su
// archivo.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import type { ReactElement } from "react";

import { ToastProvider } from "@/providers/ToastProvider";
import { descargarBlob } from "@/components/shared/descargar-blob";
import { buildXlsxRows } from "@/lib/utils/xlsx-template";
import type { CierreAdminResumen } from "@/lib/interfaces/services/ICierresAdminService";
import type {
  CierreDetalleGestion,
  CierreGrupos,
  CierreResultado,
  CierreTotales,
} from "@/lib/interfaces/services/ICierreDiaService";
import type { RankingRowDTO, PremioRankingDTO } from "@/lib/types/ranking";
import type { SaldoTiendaResumenDTO } from "@/lib/types/wallet-tienda";
import type { CuentaPorPagarResumenDTO } from "@/lib/types/wallet-mensajero";

// --- Dobles --------------------------------------------------------------

// Los desgloses desplegables se stubbean: aquí se juzgan los listados, no lo que abre una fila.
vi.mock("@/app/(app)/wallet/tiendas/_components/DesgloseMovimientosTienda", () => ({
  DesgloseMovimientosTienda: () => <div data-testid="desglose-tienda-stub" />,
}));
vi.mock("@/app/(app)/wallet/mensajeros/_components/DesglosePagosMensajero", () => ({
  DesglosePagosMensajero: () => <div data-testid="desglose-mensajero-stub" />,
}));

vi.mock("@/lib/actions/ranking", () => ({
  editarPremioAction: vi.fn(),
  obtenerRankingAction: vi.fn(),
}));
vi.mock("@/lib/actions/cierre-dia", () => ({
  solicitarCierre: vi.fn(),
  listarCierreDia: vi.fn(),
  deshacerGestion: vi.fn(),
  listarCierresPasadosPaginado: vi.fn(),
}));
vi.mock("@/lib/actions/cierres-admin", () => ({
  verCierreDetalle: vi.fn(),
  aprobarCierre: vi.fn(),
  rechazarCierre: vi.fn(),
  forzarSolicitudVencido: vi.fn(),
  listarCierresAdmin: vi.fn(),
  listarPendientesCierresAdminPaginado: vi.fn(),
  listarHistoricoCierresAdminPaginado: vi.fn(),
}));
vi.mock("@/lib/actions/wallet-tienda", () => ({
  listarSaldosTiendasAction: vi.fn(),
  listarSaldosTiendasPaginadoAction: vi.fn(),
}));
vi.mock("@/lib/actions/wallet-mensajero", () => ({
  listarCuentasPorPagarCompletoAction: vi.fn(),
  listarCuentasPorPagarPaginadoAction: vi.fn(),
  listarPagosDeMensajeroAction: vi.fn(),
  listarPagosDeMensajeroCompletoAction: vi.fn(),
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
  listarPendientesCierresAdminPaginado,
  listarHistoricoCierresAdminPaginado,
} from "@/lib/actions/cierres-admin";
import { listarCierreDia, listarCierresPasadosPaginado } from "@/lib/actions/cierre-dia";
import {
  listarSaldosTiendasAction,
  listarSaldosTiendasPaginadoAction,
} from "@/lib/actions/wallet-tienda";
import {
  listarCuentasPorPagarCompletoAction,
  listarCuentasPorPagarPaginadoAction,
} from "@/lib/actions/wallet-mensajero";
import { paginaInicial } from "@/tests/fixtures/pagina-inicial";
import { RankingModule } from "@/app/(app)/ranking/_components/RankingModule";
import { RANKING_LABELS } from "@/app/(app)/ranking/_components/ranking-labels";
import { CierreDiaModule } from "@/app/(app)/cierre-dia/_components/CierreDiaModule";
import { DetalleSecciones } from "@/app/(app)/cierres-admin/_components/cierre-detalle-shared";
import {
  CierresAdminModule,
  PAGINACION_PENDIENTES_LABEL,
} from "@/app/(app)/cierres-admin/_components/CierresAdminModule";
import {
  SaldosTiendasTable,
  PAGINACION_SALDOS_LABEL,
} from "@/app/(app)/wallet/tiendas/_components/SaldosTiendasTable";
import {
  CuentasPorPagarTable,
  PAGINACION_CUENTAS_LABEL,
} from "@/app/(app)/wallet/mensajeros/_components/CuentasPorPagarTable";

// ---------------------------------------------------------------------------
// EL CENSO: los 13 del Anexo III y los 3 del Anexo IV
// ---------------------------------------------------------------------------

const RAIZ = path.resolve(__dirname, "../../..");
const ARBOL_UI = "app";

/**
 * Con qué adaptador un listado paginado obtiene el dataset de su archivo (R52). Los dos van al
 * SERVIDOR; lo que los separa es de dónde:
 *
 *  - `conjunto`: relee el listado SIN recorte que la pantalla ya llamaba antes de paginar
 *    (`filasDelConjuntoCompleto`). Es lo que la tanda I dejó cuando estos listados no tenían
 *    un modo «completo» propio, y es la deuda que Q-I5/Q-K4 dejaron declarada.
 *  - `completo`: tiene su `listarXCompleto` dedicado y usa el adaptador de FAMILIA A
 *    (`filasDesdeResultado`), con el tope de filas aplicado en el servidor (R29).
 *
 * Lo que NINGUNO puede ser es `filasLocales(loQueLaTablaPinta)`: con la tabla paginada eso es
 * literalmente «descargar lo que se ve».
 */
type AdaptadorDescarga = "conjunto" | "completo";

interface ListadoPaginado {
  /** Nombre del Anexo III. */
  listado: string;
  /** Archivo que monta el `<Pagination>`, el `<DataTable>` y la descarga de ESE listado. */
  ruta: string;
  /** Tanda de `tasks.md` que lo entregó. */
  tanda: "I" | "J" | "K" | "L";
  adaptador: AdaptadorDescarga;
  /** Constante exportada con el nombre accesible de su control (R43). */
  etiquetaPaginacion: string;
  /**
   * Archivo donde vive el `useSWR` que lee la página, cuando NO es el mismo que monta el
   * control. En este repo hay UNO así —el histórico de cierres del día, que T I.2 sacó a su
   * propio componente presentacional y cuyo lector se quedó en el módulo padre— y se declara
   * en vez de aflojar la guardia: es exactamente el reparto que Q-I6 dejó escrito.
   */
  lector?: string;
}

/**
 * Los TRECE listados del Anexo III, uno por línea, con el archivo donde vive su control.
 *
 * No es documentación: los tests de abajo lo contrastan contra el árbol en los dos sentidos.
 * El ancla es `export const PAGINACION_…_LABEL`, la constante con la que cada listado nombra su
 * control de navegación (R43): hay exactamente trece en `app/`, una por listado del Anexo III,
 * y esa igualdad es lo que hace que un listado paginado nuevo no pueda entrar sin registrarse.
 */
const ANEXO_III: ListadoPaginado[] = [
  {
    listado: "Cierres solicitados por el mensajero",
    ruta: "app/(app)/cierre-dia/_components/CierreDiaModule.tsx",
    tanda: "I",
    adaptador: "conjunto",
    etiquetaPaginacion: "PAGINACION_PASADOS_LABEL",
  },
  {
    listado: "Cierres del día — histórico",
    ruta: "app/(app)/cierres-admin/_components/CierresAdminHistoricoTabla.tsx",
    tanda: "I",
    adaptador: "conjunto",
    etiquetaPaginacion: "PAGINACION_HISTORICO_LABEL",
    lector: "app/(app)/cierres-admin/_components/CierresAdminModule.tsx",
  },
  {
    listado: "Cierres del día pendientes de decisión",
    ruta: "app/(app)/cierres-admin/_components/CierresAdminModule.tsx",
    tanda: "J",
    adaptador: "conjunto",
    etiquetaPaginacion: "PAGINACION_PENDIENTES_LABEL",
  },
  {
    listado: "Cierres de bodega pendientes",
    ruta: "app/(app)/cierres-admin/_components/CierresBodegaAdminModule.tsx",
    tanda: "J",
    adaptador: "conjunto",
    etiquetaPaginacion: "PAGINACION_BODEGA_PENDIENTES_LABEL",
  },
  {
    listado: "Cierres de bodega resueltos",
    ruta: "app/(app)/cierres-admin/_components/CierresBodegaResueltosTabla.tsx",
    tanda: "I",
    adaptador: "conjunto",
    etiquetaPaginacion: "PAGINACION_BODEGA_RESUELTOS_LABEL",
  },
  {
    listado: "Cierres de bodega solicitados",
    ruta: "app/(app)/cierres-admin/_components/CierresBodegaSolicitadosTabla.tsx",
    tanda: "I",
    adaptador: "conjunto",
    etiquetaPaginacion: "PAGINACION_BODEGA_SOLICITADOS_LABEL",
  },
  {
    listado: "Cierres del día a consolidar",
    ruta: "app/(app)/cierres-admin/_components/ConsolidacionBodegaModule.tsx",
    tanda: "J",
    adaptador: "conjunto",
    etiquetaPaginacion: "PAGINACION_CONSOLIDABLES_LABEL",
  },
  {
    listado: "Incidentes pendientes de decisión",
    ruta: "app/(app)/incidentes/_components/IncidentesAdminModule.tsx",
    tanda: "J",
    adaptador: "conjunto",
    etiquetaPaginacion: "PAGINACION_PENDIENTES_LABEL",
  },
  {
    listado: "Incidentes — histórico",
    ruta: "app/(app)/incidentes/_components/IncidentesHistoricoTabla.tsx",
    tanda: "I",
    adaptador: "conjunto",
    etiquetaPaginacion: "PAGINACION_INCIDENTES_LABEL",
  },
  {
    listado: "Órdenes de la bodega satélite",
    ruta: "app/(app)/recepcion-satelite/_components/RecepcionSateliteModule.tsx",
    tanda: "K",
    adaptador: "conjunto",
    etiquetaPaginacion: "PAGINACION_BODEGA_LABEL",
  },
  {
    listado: "Plantillas de gasto fijo",
    ruta: "app/(app)/wallet/_components/GastosFijosPlantillasPanel.tsx",
    tanda: "I",
    adaptador: "conjunto",
    etiquetaPaginacion: "PAGINACION_PLANTILLAS_LABEL",
  },
  {
    listado: "Saldos de tiendas",
    ruta: "app/(app)/wallet/tiendas/_components/SaldosTiendasTable.tsx",
    tanda: "I",
    adaptador: "conjunto",
    etiquetaPaginacion: "PAGINACION_SALDOS_LABEL",
  },
  {
    // El ÚNICO con `listarCompleto` propio, desde T M.1 (cierre de Q-L2). Los otros doce siguen
    // releyendo su listado sin recorte: es la deuda que Q-I5/Q-K4 dejaron escrita, y este campo
    // es lo que hace que se vea cuánta queda.
    listado: "Cuentas por pagar a mensajeros",
    ruta: "app/(app)/wallet/mensajeros/_components/CuentasPorPagarTable.tsx",
    tanda: "L",
    adaptador: "completo",
    etiquetaPaginacion: "PAGINACION_CUENTAS_LABEL",
  },
];

/**
 * Feature 184 (T0.1) — los listados que TODAVÍA obtienen el archivo releyendo su listado sin
 * recorte, DECLARADOS POR NOMBRE y en el orden del Anexo III.
 *
 * Sustituye a las dos afirmaciones agregadas que había aquí (la lista de los `completo` y un
 * `toHaveLength(12)`). Aquellas eran un número y un nombre escritos a mano sobre un reparto que
 * cambia doce veces durante la feature 184: a mitad de la entrega el número miente, y con
 * `.skip` no diría nada. Esta lista se edita UNA vez por tanda, en el MISMO commit que la
 * pantalla, y no puede desviarse del campo `adaptador` —que a su vez se contrasta contra el
 * árbol en los dos sentidos, arriba y abajo—.
 *
 * Cuando quede VACÍA, los trece obtienen su archivo de una lectura dedicada y la deuda de
 * Q-I5/Q-K4 está cerrada.
 */
const PENDIENTES_184: readonly string[] = [
  "Cierres solicitados por el mensajero",
  "Cierres del día — histórico",
  "Cierres del día pendientes de decisión",
  "Cierres de bodega pendientes",
  "Cierres de bodega resueltos",
  "Cierres de bodega solicitados",
  "Cierres del día a consolidar",
  "Incidentes pendientes de decisión",
  "Incidentes — histórico",
  "Órdenes de la bodega satélite",
  "Plantillas de gasto fijo",
  "Saldos de tiendas",
];

interface ListadoSinPaginar {
  /** Nombre del Anexo IV. */
  listado: string;
  /** Archivo que monta su `<DataTable>`. */
  ruta: string;
  /** Por qué paginarlo lo rompe (requirements.md, Anexo IV). Obligatorio: sin motivo es olvido. */
  motivo: string;
}

/** Los TRES listados que el Anexo IV declara SIN paginar, con su motivo. */
const ANEXO_IV: ListadoSinPaginar[] = [
  {
    listado: "Ranking del día",
    ruta: "app/(app)/ranking/_components/RankingModule.tsx",
    motivo:
      "la POSICIÓN y los OCUPANTES del podio se derivan del conjunto completo: en la página 2 " +
      "la tarjeta de premios se quedaría sin ocupante. El conjunto está acotado por el nº de " +
      "mensajeros activos.",
  },
  {
    listado: "Gestiones del cierre del día por resultado (mensajero)",
    ruta: "app/(app)/cierre-dia/_components/CierreDiaModule.tsx",
    motivo:
      "vista AGRUPADA en cuatro listas simultáneas: la sección se OCULTA con su grupo vacío y " +
      "el encabezado lleva el conteo del grupo. Ambas cosas dejan de ser ciertas por página. " +
      "Acotada por la jornada de UN mensajero.",
  },
  {
    listado: "Gestiones de un cierre por resultado (detalle del admin)",
    ruta: "app/(app)/cierres-admin/_components/cierre-detalle-shared.tsx",
    motivo:
      "mismo problema agrupado, dentro de un MODAL de detalle de UN cierre. Acotado por la " +
      "jornada de UN mensajero.",
  },
];

/**
 * `CierreDiaModule` hospeda las DOS cosas: un listado del Anexo III («Cierres solicitados»,
 * paginado) y uno del Anexo IV (las gestiones agrupadas, sin paginar). Es la única excepción a
 * la prohibición de `filasLocales(` en un archivo con `<Pagination>`, y por eso se declara aquí
 * en vez de aflojar el patrón: en ese archivo `filasLocales` es CORRECTO, porque el grupo
 * entero ya llegó por props y releerlo sería una consulta de más (R30).
 */
const CONVIVEN_ANEXO_III_Y_IV = new Set([
  "app/(app)/cierre-dia/_components/CierreDiaModule.tsx",
]);

// --- Lectura del árbol ----------------------------------------------------

/** Quita comentarios: en este repo la prosa nombra los adaptadores y falsearía el scan. */
function sinComentarios(fuente: string): string {
  return fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function listarTsx(dir: string, acc: string[] = []): string[] {
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const completo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) listarTsx(completo, acc);
    else if (entrada.name.endsWith(".tsx")) acc.push(completo);
  }
  return acc;
}

function rutaRelativa(archivo: string): string {
  return path.relative(RAIZ, archivo).split(path.sep).join("/");
}

function fuenteDe(ruta: string): string {
  return sinComentarios(readFileSync(path.join(RAIZ, ruta), "utf8"));
}

/** `export const PAGINACION_X_LABEL` — el ancla del censo: uno por listado del Anexo III (R43). */
const ETIQUETA_PAGINACION = /export const (PAGINACION_[A-Z0-9_]*LABEL)\b/g;

/** Los archivos del árbol que declaran el nombre accesible de un control de paginación. */
function etiquetasDelArbol(): { ruta: string; constante: string }[] {
  return listarTsx(path.join(RAIZ, ARBOL_UI))
    .sort()
    .flatMap((archivo) =>
      [...readFileSync(archivo, "utf8").matchAll(ETIQUETA_PAGINACION)].map((m) => ({
        ruta: rutaRelativa(archivo),
        constante: m[1],
      })),
    );
}

// --- Datos ---------------------------------------------------------------

/**
 * 30 filas: más que el `DEFAULT_PAGE_SIZE` de los SIETE dominios paginados, que es 25 en todos
 * (`tests/unit/config/paginacion-dominios.test.ts`). Si alguien paginara uno de los tres del
 * Anexo IV con la configuración vigente, con este tamaño se vería: faltarían cinco filas.
 */
const FILAS_ANEXO_IV = 30;

const TOTALES: CierreTotales = {
  efectivo: "1000.10",
  simpe: "0.00",
  transferencia: "0.00",
  general: "1000.10",
};

function rankingDe(n: number): RankingRowDTO[] {
  return Array.from({ length: n }, (_, i) => ({
    posicion: i + 1,
    mensajeroId: `m-${String(i).padStart(3, "0")}`,
    nombre: `Mensajero ${String(i).padStart(3, "0")}`,
    entregadasHoy: n - i,
    asignadasHoy: n,
    pct: "80.0",
    premio: null,
  }));
}

const PREMIOS: PremioRankingDTO[] = [
  { posicion: 1, monto: "5000", descripcion: "Bono oro" },
  { posicion: 2, monto: null, descripcion: null },
  { posicion: 3, monto: "1000", descripcion: "Consuelo" },
];

function gestion(i: number, resultado: CierreResultado): CierreDetalleGestion {
  return {
    gestionId: `g-${String(i).padStart(3, "0")}`,
    ordenId: `o-${i}`,
    numGuia: 1000 + i,
    numRemision: `REM-${i}`,
    destinatario: `Destinatario ${String(i).padStart(3, "0")}`,
    direccion: "Calle 1, casa 2",
    zonaNombre: "Limón",
    provinciaNombre: "Limón",
    cantonNombre: "Central",
    distritoNombre: "Limón",
    producto: "Caja mediana",
    tiendaNombre: "Tienda X",
    resultado,
    montoRecibido: resultado === "entregada" ? "1000.10" : null,
    metodoPago: resultado === "entregada" ? "SINPE" : null,
    motivo: null,
    fechaReprogramacion: null,
    evidenciaUrl: null,
    pagoMensajero: "100.10",
    ingresoBodegaRechazo: null,
    tarifaFaltante: false,
    esRechazoSla: false,
    causaIncidente: null,
    indemnizacion: null,
  };
}

function gruposCon(n: number): CierreGrupos {
  return {
    entregada: Array.from({ length: n }, (_, i) => gestion(i, "entregada")),
    reprogramada: [],
    devuelta: [],
    rechazada: [],
    incidente: [],
  };
}

function cierreAdmin(i: number, estado: CierreAdminResumen["estado"]): CierreAdminResumen {
  return {
    cierreId: `c-${String(i).padStart(3, "0")}`,
    mensajeroId: `m-${i}`,
    mensajeroNombre: `Mensajero ${String(i).padStart(3, "0")}`,
    estado,
    destinoTipo: "bodega_satelite",
    destinoZonaId: "z1",
    destinoZonaNombre: "Limón",
    totales: TOTALES,
    totalPagoMensajero: "100.10",
    totalIngresoBodegaRechazos: "5.00",
    // Feature 172 (T C.2): el valor no lo mira esta suite; lo derivan los tests de la 172.
    pendientePagoMensajero: estado === "aprobado" ? "0.00" : null,
    solicitadoAt: "2026-07-11T10:00:00.000Z",
    resueltoAt: null,
    motivoRechazo: null,
  };
}

function tienda(i: number): SaldoTiendaResumenDTO {
  return {
    tiendaId: `t-${String(i).padStart(3, "0")}`,
    tiendaNombre: `Tienda ${String(i).padStart(3, "0")}`,
    saldo: "1000.10",
    signo: "positivo",
  };
}

function mensajero(i: number): CuentaPorPagarResumenDTO {
  return {
    mensajeroId: `u-${String(i).padStart(3, "0")}`,
    mensajeroNombre: `Mensajero ${String(i).padStart(3, "0")}`,
    devengado: "5000.00",
    pagado: "3000.00",
    cuentaPorPagar: "2000.00",
    signo: "positivo",
  };
}

/** El conjunto de cada listado paginado de la muestra: 60 filas, página de 25. */
const TOTAL_CONJUNTO = 60;
const PAGE_SIZE = 25;

const COLA_CIERRES = Array.from({ length: TOTAL_CONJUNTO }, (_, i) =>
  cierreAdmin(i, "solicitado"),
);
const TIENDAS = Array.from({ length: TOTAL_CONJUNTO }, (_, i) => tienda(i));
const MENSAJEROS = Array.from({ length: TOTAL_CONJUNTO }, (_, i) => mensajero(i));

/**
 * Caché de SWR NUEVA por montaje —para que un caso no herede la página del anterior— pero con
 * el `dedupingInterval` POR DEFECTO, a diferencia del resto de la suite.
 *
 * Es deliberado y es el punto de este archivo: R54 habla de CUÁNTAS consultas cuesta un render,
 * y el deduplicado de SWR es parte de lo que hace que ese número sea el que es en producción.
 * Con `dedupingInterval: 0` un re-render de React dispararía una lectura idéntica más y el test
 * mediría el arnés en vez de la pantalla.
 */
function envolver(ui: ReactElement) {
  return render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <ToastProvider>{ui}</ToastProvider>
    </SWRConfig>,
  );
}

/** Doble de una Server Action paginada: recorta de verdad y devuelve el total del conjunto. */
function servirPagina<T>(conjunto: readonly T[]) {
  return async (input: { page?: number; pageSize?: number } = {}) => {
    const page = input?.page ?? 1;
    const pageSize = input?.pageSize ?? PAGE_SIZE;
    const desde = (page - 1) * pageSize;
    return {
      status: "ok" as const,
      items: conjunto.slice(desde, desde + pageSize),
      page,
      pageSize,
      total: conjunto.length,
    };
  };
}

// --- Montaje de la MUESTRA de listados paginados --------------------------

/**
 * Tres de los trece, uno por tanda con la que se puede montar el módulo aislado: la cola de
 * cierres (J), los saldos de tiendas (I) y las cuentas por pagar (L).
 *
 * NO son «los que cabían»: son los que cubren las tres formas distintas de cablear la página en
 * este repo —control en el módulo con dos tablas, control junto a su tabla, y control con
 * búsqueda de servidor—. La bodega satélite (K) se queda fuera de la parte de CONDUCTA porque su
 * módulo pide siete props de dominio y su comportamiento ya lo mide `SatelitePaginacion.test.tsx`
 * fila a fila; la parte ESTÁTICA de este archivo sí la cubre, como a los trece.
 */
interface MuestraPaginada {
  listado: string;
  tanda: string;
  etiquetaPaginacion: string;
  /** Nombre accesible del control de descarga. */
  control: string;
  /** Filas del conjunto completo (lo que el archivo debe traer). */
  total: number;
  montar: () => void;
  /** La Server Action que lee la página: se cuenta para R54. */
  lector: () => ReturnType<typeof vi.fn>;
}

function montarColaCierres() {
  vi.mocked(listarPendientesCierresAdminPaginado).mockImplementation(
    servirPagina(COLA_CIERRES) as never,
  );
  vi.mocked(listarHistoricoCierresAdminPaginado).mockImplementation(
    servirPagina([]) as never,
  );
  vi.mocked(listarCierresAdmin).mockResolvedValue({
    status: "ok",
    pendientes: [...COLA_CIERRES],
    historico: [],
    sinZona: false,
  });
  envolver(
    <CierresAdminModule
      pendientes={paginaInicial(COLA_CIERRES.slice(0, PAGE_SIZE), { total: TOTAL_CONJUNTO })}
      historico={paginaInicial([])}
      sinZona={false}
    />,
  );
}

function montarSaldos() {
  vi.mocked(listarSaldosTiendasPaginadoAction).mockImplementation(servirPagina(TIENDAS) as never);
  vi.mocked(listarSaldosTiendasAction).mockResolvedValue({
    status: "ok",
    tiendas: [...TIENDAS],
  });
  envolver(
    <SaldosTiendasTable
      initialData={paginaInicial(TIENDAS.slice(0, PAGE_SIZE), { total: TOTAL_CONJUNTO })}
    />,
  );
}

function montarCuentas() {
  vi.mocked(listarCuentasPorPagarPaginadoAction).mockImplementation(
    servirPagina(MENSAJEROS) as never,
  );
  vi.mocked(listarCuentasPorPagarCompletoAction).mockResolvedValue({
    status: "ok",
    items: [...MENSAJEROS],
    total: MENSAJEROS.length,
  });
  envolver(
    <CuentasPorPagarTable
      initialData={paginaInicial(MENSAJEROS.slice(0, PAGE_SIZE), { total: TOTAL_CONJUNTO })}
    />,
  );
}

const MUESTRA: MuestraPaginada[] = [
  {
    listado: "Cierres del día pendientes de decisión",
    tanda: "J",
    etiquetaPaginacion: PAGINACION_PENDIENTES_LABEL,
    control: "Descargar Cierres pendientes de decisión",
    total: TOTAL_CONJUNTO,
    montar: montarColaCierres,
    lector: () => vi.mocked(listarPendientesCierresAdminPaginado) as never,
  },
  {
    listado: "Saldos de tiendas",
    tanda: "I",
    etiquetaPaginacion: PAGINACION_SALDOS_LABEL,
    control: "Descargar Saldos de tiendas",
    total: TOTAL_CONJUNTO,
    montar: montarSaldos,
    lector: () => vi.mocked(listarSaldosTiendasPaginadoAction) as never,
  },
  {
    listado: "Cuentas por pagar a mensajeros",
    tanda: "L",
    etiquetaPaginacion: PAGINACION_CUENTAS_LABEL,
    control: "Descargar Cuentas por pagar a mensajeros",
    total: TOTAL_CONJUNTO,
    montar: montarCuentas,
    lector: () => vi.mocked(listarCuentasPorPagarPaginadoAction) as never,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  buildXlsxRowsMock.mockResolvedValue(new ArrayBuffer(8));
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// R53 — los 3 del Anexo IV siguen entregándose completos, sin control de página
// ---------------------------------------------------------------------------

describe("T M.1 · R53 — los 3 listados del Anexo IV siguen completos, sin control de página", () => {
  it("el ranking entrega el conjunto entero y no ofrece navegación entre páginas", async () => {
    envolver(
      <RankingModule ranking={rankingDe(FILAS_ANEXO_IV)} premios={PREMIOS} esEditable={false} />,
    );

    const tabla = screen.getByRole("table", { name: RANKING_LABELS.tablaAria });
    // 30 filas + la de encabezados. Con un control de 25 por página faltarían cinco.
    expect(within(tabla).getAllByRole("row")).toHaveLength(FILAS_ANEXO_IV + 1);
    expect(within(tabla).getByText("Mensajero 029")).toBeInTheDocument();

    // Y la pantalla entera no monta ningún control de navegación: el ranking es la única tabla
    // de datos que tiene, así que aquí «ninguno» es literal.
    expect(screen.queryAllByRole("navigation")).toHaveLength(0);
  });

  it("la vista agrupada del mensajero entrega el grupo entero, y su contador lo dice", () => {
    vi.mocked(listarCierresPasadosPaginado).mockImplementation(servirPagina([]) as never);
    vi.mocked(listarCierreDia).mockResolvedValue({
      status: "ok",
      grupos: gruposCon(FILAS_ANEXO_IV),
      totales: TOTALES,
      totalPagoMensajero: "100.10",
      totalIngresoBodegaRechazos: "5.00",
      puedesSolicitar: true,
      motivoBloqueo: null,
      cierresPasados: [],
      tieneVencido: false,
      tieneRechazado: false,
    });

    envolver(
      <CierreDiaModule
        grupos={gruposCon(FILAS_ANEXO_IV)}
        totales={TOTALES}
        totalPagoMensajero="100.10"
        puedesSolicitar
        motivoBloqueo={null}
        cierresPasados={paginaInicial([])}
        bloqueado={false}
        tieneVencido={false}
        tieneRechazado={false}
      />,
    );

    // La sección de «Entregadas» es la del Anexo IV; la OTRA tabla de este módulo («Cierres
    // solicitados») sí pagina, y por eso la comprobación se acota a la región del grupo.
    const seccion = screen.getByRole("region", { name: "Entregadas" });
    expect(within(seccion).getAllByRole("row")).toHaveLength(FILAS_ANEXO_IV + 1);
    // El contador por grupo, que es lo que paginar volvería mentira: diría «(25)» de 30.
    expect(seccion).toHaveTextContent(`(${FILAS_ANEXO_IV})`);
    expect(within(seccion).queryAllByRole("navigation")).toHaveLength(0);

    // Contraprueba de que la pantalla SÍ sabe paginar cuando toca: su otra tabla lleva control.
    expect(
      screen.getByRole("navigation", { name: "Paginación de los cierres solicitados" }),
    ).toBeInTheDocument();
  });

  it("las secciones del detalle del admin entregan cada grupo entero, sin control", () => {
    envolver(
      <DetalleSecciones grupos={gruposCon(FILAS_ANEXO_IV)} onVerEvidencia={() => {}} />,
    );

    const seccion = screen.getByRole("region", { name: "Entregadas" });
    expect(within(seccion).getAllByRole("row")).toHaveLength(FILAS_ANEXO_IV + 1);
    expect(seccion).toHaveTextContent(`(${FILAS_ANEXO_IV})`);
    expect(screen.queryAllByRole("navigation")).toHaveLength(0);

    // Las secciones con el grupo VACÍO no se pintan: es la otra mitad de lo que paginar rompe
    // (con páginas, una sección vacía podría ser sólo «esta página no trae ninguna»).
    expect(screen.queryByRole("region", { name: "Rechazadas" })).not.toBeInTheDocument();
  });

  it("el censo del Anexo IV son TRES, con motivo, y su descarga no relee nada (R30)", () => {
    // (a) los tres que `requirements.md` declara, ni uno más ni uno menos, cada uno con su
    //     motivo escrito. Un cuarto listado que dejara de paginarse tendría que pasar por aquí.
    expect(ANEXO_IV).toHaveLength(3);
    for (const { listado, ruta, motivo } of ANEXO_IV) {
      expect(existsSync(path.join(RAIZ, ruta)), `${listado}: ${ruta} no existe`).toBe(true);
      expect(motivo.length, `${listado}: sin motivo declarado`).toBeGreaterThan(40);

      // (b) su archivo proyecta el array que YA tiene, sin releer: es Familia B pura y releer
      //     sería una consulta de más por descarga sobre un dataset que ya está en el cliente.
      const fuente = fuenteDe(ruta);
      expect(fuente, `${listado}: su descarga debe salir del array que la tabla pinta`).toMatch(
        /filasLocales\(/,
      );
    }

    // (c) y ninguno figura en el Anexo III: las dos listas son disjuntas por listado. El único
    //     archivo compartido es `CierreDiaModule`, que hospeda uno de cada.
    const paginados = new Set(ANEXO_III.map((l) => l.listado));
    for (const { listado } of ANEXO_IV) {
      expect(paginados.has(listado), `${listado}: declarado en los dos anexos`).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// R54 — ningún listado paginado hace más consultas por render que antes
// ---------------------------------------------------------------------------

describe("T M.1 · R54 — ningún listado paginado consulta de más por render", () => {
  it("los TRECE pre-cargan su página: `useSWR` con `fallbackData`, en todos", () => {
    // La guardia estática, sobre los trece. Antes de paginar, la pantalla recibía su array por
    // props y pintaba SIN consultar nada; el equivalente hoy es que la página 1 que el Server
    // Component ya resolvió alimente el `fallbackData` de SWR. Sin él, cada render vuelve a
    // pedir al servidor lo que ya tiene — y la tanda I midió que quitarlo NO rompía ningún test
    // (`impl_170-fase2-tanda-i.md` §16, la mutación que pasó VERDE).
    expect(ANEXO_III).toHaveLength(13);

    for (const { listado, ruta, lector } of ANEXO_III) {
      expect(fuenteDe(ruta), `${listado}: no monta control de paginación`).toMatch(
        /<Pagination[\s/>]/,
      );
      // El lector es el mismo archivo salvo en el histórico de cierres del día, cuyo módulo
      // padre resuelve las DOS páginas de la pantalla (declarado arriba, Q-I6).
      const fuenteLectora = fuenteDe(lector ?? ruta);
      expect(fuenteLectora, `${listado}: no lee su página del servidor`).toMatch(/\buseSWR\b/);
      expect(
        fuenteLectora,
        `${listado}: sin fallbackData, el primer render cuesta una consulta que antes no costaba (R54)`,
      ).toMatch(/\bfallbackData\b/);
    }

    // Anti-vacuidad del reparto: hoy sólo UNO tiene su lector en otro archivo. Si mañana fueran
    // más, la guardia sigue valiendo, pero alguien tiene que venir a declararlo.
    expect(ANEXO_III.filter((l) => l.lector !== undefined).map((l) => l.listado)).toEqual([
      "Cierres del día — histórico",
    ]);
  });

  it("el censo y el árbol no se despegan: 13 controles declarados, 13 listados", () => {
    // En los dos sentidos, como `cobertura-tablas.guardia`:
    //  (a) todo archivo que declara el nombre de un control de paginación está en el censo —un
    //      listado paginado nuevo obliga a DECIDIR aquí, no aparece en silencio;
    //  (b) todo censado sigue existiendo con SU constante —una entrada huérfana deja de valer
    //      como excusa para las guardias de arriba.
    const enArbol = etiquetasDelArbol();
    const censadas = new Set(ANEXO_III.map((l) => `${l.ruta}::${l.etiquetaPaginacion}`));

    const sinRegistrar = enArbol
      .map((e) => `${e.ruta}::${e.constante}`)
      .filter((clave) => !censadas.has(clave));
    expect(
      sinRegistrar,
      "hay listados paginados sin registrar en tests/components/paginacion/paginacion-transversal.test.tsx",
    ).toEqual([]);

    const clavesArbol = new Set(enArbol.map((e) => `${e.ruta}::${e.constante}`));
    for (const l of ANEXO_III) {
      expect(
        clavesArbol.has(`${l.ruta}::${l.etiquetaPaginacion}`),
        `${l.listado}: ${l.etiquetaPaginacion} ya no está en ${l.ruta}`,
      ).toBe(true);
    }

    // Anti-vacuidad: si el detector dejara de reconocer la constante, esta cuenta lo delata en
    // vez de dejar pasar una lista vacía. Son los 13 del Anexo III y sólo esos.
    expect(enArbol).toHaveLength(13);
  });

  it("la página pre-cargada se pinta sin esperar al servidor, y cada página cuesta UNA lectura", async () => {
    // La CONDUCTA, sobre la muestra, y con el número MEDIDO en vez del que se suponía.
    //
    // Lo que `fallbackData` compra es el PRIMER PINTADO: las filas que el usuario veía antes de
    // paginar están en pantalla sin haber esperado a nadie (por eso las tres aserciones de (a)
    // son SÍNCRONAS, sin `await`: es la forma endurecida que la tanda I adoptó cuando su
    // mutación pasó verde).
    //
    // Lo que NO compra —y esta tanda lo mide en vez de darlo por hecho— es evitar la
    // revalidación: SWR vuelve a pedir esa misma página 1 al montar, aunque la tenga. O sea que
    // la PANTALLA cuesta hoy una lectura de cliente que antes de paginar no costaba, además de
    // la que resuelve el Server Component. R54 se cumple LISTADO A LISTADO en el servidor (una
    // consulta con el conteo dentro, medido en las tandas I/J/K/L), no en el navegador. Queda
    // declarado como Q-M1 en `progress/impl_170-fase2-tanda-m.md`, con su salida propuesta.
    //
    // Lo que sí se exige aquí, y es lo que impide que ese número crezca sin que nadie lo note:
    // exactamente UNA lectura por página visitada, nunca dos.
    for (const caso of MUESTRA) {
      const user = userEvent.setup();
      caso.montar();

      // (a) el primer pintado no espera al servidor: las filas ya están.
      const nav = screen.getByRole("navigation", { name: caso.etiquetaPaginacion });
      expect(
        caso.lector(),
        `${caso.listado} (tanda ${caso.tanda}): el primer pintado esperó al servidor`,
      ).not.toHaveBeenCalled();
      expect(
        screen.getByRole("button", { name: caso.control }),
        `${caso.listado}: la tabla no se pintó`,
      ).toBeInTheDocument();

      // (b) la revalidación de la página ya pre-cargada: UNA, y de la página 1 (Q-M1).
      await waitFor(() =>
        expect(caso.lector(), `${caso.listado}: no revalidó`).toHaveBeenCalledTimes(1),
      );
      expect(
        (caso.lector().mock.calls[0]![0] as { page?: number })?.page ?? 1,
        `${caso.listado}: la revalidación de entrada pidió otra página`,
      ).toBe(1);

      // (c) y navegar cuesta exactamente una lectura más: ni cero (no navegaría) ni dos.
      await user.click(within(nav).getByRole("button", { name: "Ir a la página 2" }));
      await waitFor(() =>
        expect(
          caso.lector(),
          `${caso.listado}: cambiar de página no cuesta exactamente una lectura`,
        ).toHaveBeenCalledTimes(2),
      );
      expect(
        (caso.lector().mock.calls[1]![0] as { page?: number })?.page,
        `${caso.listado}: la segunda lectura no es la de la página 2`,
      ).toBe(2);

      cleanup();
      vi.clearAllMocks();
      buildXlsxRowsMock.mockResolvedValue(new ArrayBuffer(8));
    }
  });
});

// ---------------------------------------------------------------------------
// R52 — toda descarga de un listado paginado entrega el dataset completo
// ---------------------------------------------------------------------------

describe("T M.1 · R52 — toda descarga de un listado paginado entrega el dataset completo", () => {
  it("ninguno de los TRECE proyecta el array de la página: el archivo va al servidor", () => {
    // La degradación que R52 prohíbe no falla en ninguna parte: `filasLocales(data.items)`
    // compila, renderiza y produce un xlsx de 25 filas de 300. Por eso la guardia es estática y
    // por listado, y por eso cada uno declara CON QUÉ adaptador cumple: los doce que releen su
    // listado sin recorte son la deuda que Q-I5/Q-K4 dejaron escrita, y el que tiene
    // `listarCompleto` propio es lo que la tanda M cerró (Q-L2).
    const ADAPTADOR: Record<AdaptadorDescarga, RegExp> = {
      conjunto: /filasDelConjuntoCompleto\(/,
      completo: /filasDesdeResultado\(/,
    };
    // Feature 184 (T0.2) — la MITAD NEGATIVA, que hasta hoy faltaba: el adaptador que un
    // listado declara NO es «el que además usa», es el ÚNICO que usa. Sin esto, una pantalla
    // migrada a medias —que llame a los dos— pasaría verde con cualquiera de las dos
    // declaraciones, y el censo dejaría de decir cuánta deuda queda.
    const CONTRARIO: Record<AdaptadorDescarga, AdaptadorDescarga> = {
      conjunto: "completo",
      completo: "conjunto",
    };

    for (const { listado, ruta, adaptador } of ANEXO_III) {
      const fuente = fuenteDe(ruta);
      expect(fuente, `${listado}: su descarga no va al servidor por el conjunto (R52)`).toMatch(
        ADAPTADOR[adaptador],
      );
      expect(
        fuente,
        `${listado}: se declara «${adaptador}» pero también llama al adaptador «${CONTRARIO[adaptador]}»`,
      ).not.toMatch(ADAPTADOR[CONTRARIO[adaptador]]);

      if (!CONVIVEN_ANEXO_III_Y_IV.has(ruta)) {
        expect(
          fuente,
          `${listado}: proyecta el array que la tabla pinta, o sea «descargar lo que se ve» (R52)`,
        ).not.toMatch(/filasLocales\(/);
      }
    }

    // Feature 184 (T0.1/R30) — el reparto, declarado POR NOMBRE y no por un número escrito a
    // mano: los que siguen releyendo son EXACTAMENTE los de `PENDIENTES_184`, en su orden. Cada
    // tanda borra sus líneas de esa lista en el mismo commit en que cambia su pantalla; si se
    // borra la línea sin migrar la pantalla (o al revés), este caso se pone rojo.
    expect(ANEXO_III.filter((l) => l.adaptador === "conjunto").map((l) => l.listado)).toEqual(
      PENDIENTES_184,
    );
  });

  it("descargar desde la ÚLTIMA página entrega el conjunto, no lo que se ve", async () => {
    // La conducta, y con los números separados a propósito: la tabla enseña 25 de 60, así que un
    // archivo de 25 filas —o de 35, las de la última página— se distingue del bueno.
    for (const caso of MUESTRA) {
      const user = userEvent.setup();
      caso.montar();

      const nav = screen.getByRole("navigation", { name: caso.etiquetaPaginacion });
      await user.click(within(nav).getByRole("button", { name: "Ir a la página 2" }));
      await waitFor(() =>
        expect(screen.getByRole("button", { name: caso.control })).toBeEnabled(),
      );

      await user.click(screen.getByRole("button", { name: caso.control }));
      await waitFor(() =>
        expect(descargarBlobMock, `${caso.listado}: no se produjo archivo`).toHaveBeenCalledTimes(1),
      );

      const [, filas] = buildXlsxRowsMock.mock.calls[0];
      expect(
        filas.length,
        `${caso.listado} (tanda ${caso.tanda}): el archivo trae la página, no el conjunto (R52)`,
      ).toBe(caso.total);
      expect(filas.length, `${caso.listado}: el archivo trae sólo la página visible`).not.toBe(
        PAGE_SIZE,
      );

      cleanup();
      vi.clearAllMocks();
      buildXlsxRowsMock.mockResolvedValue(new ArrayBuffer(8));
    }
  });
});
