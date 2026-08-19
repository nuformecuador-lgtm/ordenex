"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import useSWR, { useSWRConfig } from "swr";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/shared/Modal";
import { Pagination } from "@/components/shared/Pagination";
import { SegmentedToggle } from "@/components/shared/SegmentedToggle";
import { DescargarDatasetButton } from "@/components/shared/DescargarDatasetButton";
import type { DataTableDescarga } from "@/components/shared/DataTable";
import { filasDesdeResultado } from "@/components/shared/descarga-resultado";
import { useToast } from "@/hooks/useToast";
import { cierreConfig } from "@/lib/config/cierre";
import {
  verCierreDetalle,
  aprobarCierre,
  rechazarCierre,
  forzarSolicitudVencido,
  listarHistoricoCierresAdminPaginado,
  listarGestionesCierresAdminCompleto,
  listarPendientesCierresAdminCompleto,
  listarPendientesCierresAdminPaginado,
} from "@/lib/actions/cierres-admin";
import type { CierreAdminResumen } from "@/lib/interfaces/services/ICierresAdminService";
import type {
  CatalogoFiltrosCierresDTO,
  FiltrosCierres,
} from "@/lib/types/filtros-cierres";
import {
  CATALOGO_FILTROS_CIERRES_VACIO,
  sinFiltros,
} from "@/lib/types/filtros-cierres";
import type {
  CierreDetalleGestion,
  CierreGrupos,
  TotalesIngresoOrdenex,
} from "@/lib/interfaces/services/ICierreDiaService";
import { montoValido } from "@/app/(app)/wallet/_components/wallet-labels";
// Feature 158 (m5 del review): el tope del monto se IMPORTA del borde del servidor, no se
// reescribe. Sale de la precisión de la columna (`DECIMAL(12,2)` → 9999999999.99); si algún
// día cambia, un literal duplicado aquí se quedaría desalineado en silencio y volvería el
// mismo callejón: el cliente habilitando un monto que la transacción no puede escribir.
import { INDEMNIZACION_MONTO_MAX } from "@/lib/types/cierres-admin";
// Feature 158/R34: la etiqueta visible de la causa sale del catálogo derivado del SEED (mismo
// módulo que usa el panel del mensajero para capturarla). El admin decide el monto MIRANDO la
// causa: no puede ser un slug crudo ni, peor, no estar.
import { CAUSA_INCIDENTE_LABEL } from "@/app/(app)/mis-asignaciones/_components/causa-incidente-options";
// `moneyTope` lo usan los mensajes de la indemnizacion (feature 230 de `dev`); los tres
// simbolos de tabla que `dev` importaba aqui se fueron con la tira de comprobantes.
import { money, moneyTope } from "./cierre-detalle-shared";
import {
  CierreFacturaResumen,
  CierreFacturaDetalle,
} from "./cierre-factura";
import { DescargarGestionesDialog } from "./DescargarGestionesDialog";
import { ListaComprobantes } from "./ListaComprobantes";
import { FiltrosCierresBarra } from "./FiltrosCierresBarra";
import { PanelConmutado } from "./PanelConmutado";
import { destinoCierre } from "./cierre-labels";
// Feature 205 (T6.1): el nombre del parámetro que hace direccionable un cierre. Sale del
// módulo compartido y no de un literal acá, porque quien construye el enlace vive en OTRA
// pantalla (`/wallet/mensajeros`) y renombrarlo en un solo lado dejaría el enlace mudo.
import { PARAM_CIERRE } from "./cierre-enlace";
import {
  CierresAdminHistoricoLista,
  descargaHistoricoCierres,
  type CierresAdminHistoricoPagina,
} from "./CierresAdminHistoricoLista";
import {
  COLUMNAS_DESCARGA_CIERRES_PENDIENTES,
  filaDescargaCierrePendiente,
} from "./cierres-admin-descarga-columnas";
// Feature 172 (TANDA E): el pago al mensajero. Tres piezas, ninguna con lógica de dominio
// propia — el pendiente lo deriva el servidor (T C.2) y el rol lo decide el servicio (R1/R6).
import { hayPendienteDeLiquidar } from "./PendienteLiquidarBadge";
import {
  PagoMensajeroSeccion,
  clavePagosDeCierre,
} from "./PagoMensajeroSeccion";
import { RegistrarPagoMensajeroDialog } from "./RegistrarPagoMensajeroDialog";
import { CorregirPagosDialog } from "./CorregirPagosDialog";

// Feature 38 (T13, R3-R11): módulo cliente de "Cierres del día" del admin. Recibe
// del Server Component padre los cierres del alcance ya resueltos (pendientes de
// decisión + histórico de solo lectura) y `sinZona`. Al abrir un cierre pide el
// detalle por Server Action (evidencias firmadas, R7) y muestra los totales
// snapshot (R8) + las 4 secciones por resultado (reuso del render de la 37, R6).
// Las decisiones (aprobar/rechazar) van por Server Action y refrescan la ruta. Los
// montos llegan como STRING (money-safe, R9): se renderizan tal cual, sin
// `parseFloat`/`Number`. Los helpers de detalle (money/columnas/etiquetas) viven en
// `cierre-detalle-shared` (compartidos con los módulos de cierre de bodega, feat 40).

/**
 * Feature 170 — FASE 2 (T J.2, R40/R41): la PÁGINA de la cola de pendientes, tal como la
 * devuelve el servidor. `total` es el del CONJUNTO —de él sale el contador de cabecera (R42)—
 * y nunca `items.length`.
 */
export interface CierresAdminColaPagina {
  items: CierreAdminResumen[];
  total: number;
  pageSize: number;
}

export interface CierresAdminModuleProps {
  /**
   * Feature 170 — FASE 2 (T J.2, R40/R41): PÁGINA 1 de los cierres `solicitado` del alcance
   * (cola de decisión, R4), ya resuelta server-side, más el `total` del conjunto.
   */
  pendientes: CierresAdminColaPagina;
  /**
   * Feature 170 — FASE 2 (T I.2, R40/R41): PÁGINA 1 del histórico de resueltos (R5), ya
   * resuelta server-side, más el `total` del conjunto. Deja de ser el array entero: ese es
   * justo el que crecía sin techo (design §11.3).
   */
  historico: CierresAdminHistoricoPagina;
  /** `true` si el adminSatelite no tiene zona asignada (R3). */
  sinZona: boolean;
  /**
   * Feature 172 (T E.1/T E.2, [P3]/R6) — `true` si el actor puede REGISTRAR pagos. Lo resuelve
   * el Server Component padre con el MISMO predicado (`esAccesoTotal`) que usa
   * `LiquidacionService` para responder `forbidden`: son las dos mitades del control de
   * acceso, y ninguna basta sola.
   *
   * Existe porque en esta pantalla **aprobar y pagar no son el mismo permiso**: un
   * `adminSatelite` aprueba los cierres de su zona y NO mueve dinero (respuesta P3 del humano).
   * Sin esta prop, la pantalla que aprueba sería la que paga.
   *
   * Opcional y con default `false` — FALLA CERRADO: un montaje que se olvide de pasarla no
   * ofrece pagar a nadie, en vez de ofrecérselo a todos.
   */
  puedeRegistrarPago?: boolean;
  /**
   * Pedido humano (2026-08-19) — permiso de CORREGIR el desglose de pago de una gestión de un
   * cierre abierto. Se resuelve server-side con el MISMO predicado que el servicio
   * (`esAccesoTotal`): maestro y admin, y nadie más.
   *
   * Es otra prop y no `puedeRegistrarPago` aunque hoy coincida el predicado: pagar un cierre
   * aprobado y corregir lo que un mensajero declaró son dos permisos distintos, y fundirlos
   * aquí haría que separarlos mañana exigiera desenredar la pantalla. Opcional y con default
   * `false` — FALLA CERRADO, igual que su vecina.
   */
  puedeCorregirPagos?: boolean;
  /**
   * Pedido humano del 2026-08-16 — opciones de los filtros (bodegas destino y mensajeros), ya
   * acotadas al alcance del actor y resueltas por el Server Component: es una lectura de solo
   * catalogo, no depende del filtro aplicado y no tiene por que costar un viaje del cliente.
   *
   * Opcional con default VACIO: un montaje que se olvide de pasarla ofrece cero opciones —la
   * pantalla sigue funcionando sin filtrar— en vez de romperse.
   */
  catalogoFiltros?: CatalogoFiltrosCierresDTO;
}

/**
 * Feature 172 (T E.1, §8) — la oferta de pago que aparece TRAS APROBAR. Guarda los tres datos
 * que el diálogo necesita porque el detalle ya se cerró cuando se abre: el cierre aprobado
 * desaparece de la cola y `detalle` vuelve a `null`.
 *
 * Es estado EFÍMERO de pantalla, no un estado del cierre (R18): «Ahora no» lo descarta y no
 * persiste nada; el pendiente se vuelve a derivar cada vez que alguien mira el cierre.
 */
interface OfertaPago {
  cierreId: string;
  mensajeroNombre: string;
  /** El pendiente que devolvió `aprobarCierre`, STRING del servidor (R14). */
  pendiente: string;
}

// --- Pedido humano del 2026-08-16: las dos mitades, en pestañas ---
const TAB_PENDIENTES = "pendientes";
const TAB_RESUELTOS = "resueltos";
type TabCierresAdmin = typeof TAB_PENDIENTES | typeof TAB_RESUELTOS;
const TAB_PENDIENTES_LABEL = "Pendientes";
const TAB_RESUELTOS_LABEL = "Resueltos";
/** Nombre accesible del conmutador. Propio: la pantalla anida varios segmentados. */
const TABS_CIERRES_LABEL = "Cierres del día por estado";

/** Nombre visible de la cola: hoja, base del archivo y nombre del control (R12/R13). */
const TITULO_DESCARGA_PENDIENTES = "Cierres pendientes de decisión";
/** Nombre accesible del control de la COLA (R43). La pantalla monta varias tablas paginadas. */
export const PAGINACION_PENDIENTES_LABEL =
  "Paginación de los cierres del día pendientes";
const ERROR_CARGA_PENDIENTES = "No se pudieron cargar los cierres pendientes.";

// R40: el tamaño sale de la config del dominio (T H.1), nunca de un literal de pantalla, y
// las opciones nunca superan el máximo que el borde acepta.
const PAGE_SIZE_OPTIONS = [10, 25, 50].filter((s) => s <= cierreConfig.MAX_PAGE_SIZE);

/**
 * La configuración de descarga de la COLA, para que la monte la fila de las pestañas.
 *
 * Feature 170 (T J.2, R52) — el listado pinta UNA página; el archivo sigue siendo la COLA
 * COMPLETA del alcance del actor, y ese acotamiento lo pone el SERVIDOR desde la sesión: un
 * `adminSatelite` sigue descargando solo los cierres de su zona (R14/R44). Feature 184 — Tanda D
 * (T D.3, R1): sale de la lectura DEDICADA, que corta por estado en la base con el mismo
 * criterio y el mismo orden que la página, y cuyo tope de filas evalúa el servidor (R6).
 *
 * Pedido humano del 2026-08-16 — el archivo sale del MISMO conjunto que el listado enseña,
 * filtros incluidos: «descargar» significa «esto que estoy viendo, entero».
 *
 * El título no repite el del otro listado: dos controles en la misma pantalla necesitan nombres
 * accesibles distintos (R13).
 */
function descargaColaCierres(filtros: FiltrosCierres): DataTableDescarga {
  return {
    titulo: TITULO_DESCARGA_PENDIENTES,
    columnas: COLUMNAS_DESCARGA_CIERRES_PENDIENTES,
    obtenerFilas: () =>
      filasDesdeResultado(
        listarPendientesCierresAdminCompleto({ filtros }),
        filaDescargaCierrePendiente,
      ),
  };
}

/**
 * Feature 170 — FASE 2 (T I.2, R40/R41): una página del histórico. El alcance NO viaja en el
 * input —lo resuelve el servicio desde la sesión, igual que el listado sin paginar (R44)—;
 * aquí solo van el número de página, el tamaño y —desde el pedido humano del 2026-08-16— los
 * FILTROS, que recortan DENTRO de ese alcance y nunca lo ensanchan.
 */
async function leerHistorico(
  page: number,
  pageSize: number,
  filtros: FiltrosCierres,
): Promise<CierresAdminHistoricoPagina> {
  const res = await listarHistoricoCierresAdminPaginado({ page, pageSize, filtros });
  if (res.status !== "ok") throw new Error(res.status);
  return { items: res.items, total: res.total, pageSize: res.pageSize };
}

/** Feature 170 — FASE 2 (T J.2): una página de la COLA, con el mismo criterio que el histórico. */
async function leerPendientes(
  page: number,
  pageSize: number,
  filtros: FiltrosCierres,
): Promise<CierresAdminColaPagina> {
  const res = await listarPendientesCierresAdminPaginado({ page, pageSize, filtros });
  if (res.status !== "ok") throw new Error(res.status);
  return { items: res.items, total: res.total, pageSize: res.pageSize };
}

// --- Feature 158 (R19/R34): captura del monto de indemnización al aprobar. Textos
// separados de la lógica (i18n-ready), como el resto del módulo. ---
const INDEMNIZACION_TITULO = "Indemnizar los incidentes del cierre";
const INDEMNIZACION_DETALLE =
  "Este cierre trae paquetes dañados, perdidos o robados. Indicá cuánto se indemniza por cada uno: al aprobar, la suma sale de la caja principal como un solo egreso.";
const INDEMNIZACION_CONFIRMAR = "Aprobar e indemnizar";
const INDEMNIZACION_MONTO_LABEL = "Monto de la indemnización";
/**
 * Feature 158 (m5 del review) — mensajes POR FILA del monto inválido. Dicen QUÉ corregir, no
 * sólo que está mal: un «monto inválido» deja al admin adivinando si sobra un dígito, si el
 * problema es la coma o si el tope es otro. El máximo se interpola del contrato, no se teclea.
 */
// El tope se pinta agrupado (feature 201) porque es justo lo que el mensaje intenta
// explicar: «no puede superar ₡9.999.999.999» se lee de un vistazo y `₡9999999999.99` hay
// que contarlo con el dedo. El EJEMPLO de entrada (`12500.00`) se queda crudo a propósito:
// eso es lo que hay que teclear en el campo, que no admite separador de miles.
//
// Feature 230: el tope va por `moneyTope` y NO por `money`. Redondear un importe está bien;
// redondear un LÍMITE al alza lo invalida: `money("9999999999.99")` da `₡10.000.000.000`, que
// es lo que el validador de esta misma pantalla rechaza y un dígito más de los «10 dígitos»
// que la frase promete. `moneyTope` descarta la cola y el mensaje queda más estricto que la
// realidad, que es el lado seguro.
const INDEMNIZACION_MONTO_EXCEDE = `El monto no puede superar ${moneyTope(INDEMNIZACION_MONTO_MAX)} (10 dígitos y 2 decimales). Revisá si sobra un dígito.`;
const INDEMNIZACION_MONTO_FORMATO =
  "Escribí un monto mayor que 0, con punto decimal y sin separador de miles (por ejemplo 12500.00).";
/** R34: rótulo de la causa en la fila del incidente (el dato que justifica el monto). */
const INDEMNIZACION_CAUSA_LABEL = "Causa";
/** Causa ausente: no debería pasar (el borde la exige, R9), pero no se inventa un valor. */
const INDEMNIZACION_CAUSA_DESCONOCIDA = "Sin causa registrada";
const INDEMNIZACION_MONTO_AYUDA = `Mayor que 0 y hasta ${moneyTope(INDEMNIZACION_MONTO_MAX)}, con hasta 2 decimales (por ejemplo 12500.00).`;
const INDEMNIZACION_FALTAN =
  "Falta el monto de al menos un incidente, o alguno no es válido. No se puede aprobar así.";

/** Detalle abierto: la cabecera del cierre + sus gestiones agrupadas por resultado. */
interface DetalleAbierto {
  cierre: CierreAdminResumen;
  grupos: CierreGrupos;
  /** Ingreso de Ordenex del cierre por concepto (derivado del snapshot, money-safe). */
  totalesIngreso: TotalesIngresoOrdenex;
  /**
   * Feature 102/R8/R10: desglose del ingreso de bodega por rechazos particionado por origen
   * (SLA del cron 99 / manual del mensajero). `total` = snapshot leído; `sla + manual === total`
   * (server-side). Llega igual al alcance satélite por el mismo camino (`verCierreDetalle`).
   */
  desgloseIngresoBodegaRechazos: { sla: string; manual: string; total: string };
  /** Ingreso bruto menos el pago al mensajero, derivado server-side (puede ser negativo). */
  ganancia: string;
  /** Total general menos flete + IVA y comisión + IVA, derivado server-side (puede ser negativo). */
  pagoTienda: string;
}

/**
 * Feature 205 (T6.1, design §4.1, R39/R40) — abre el detalle del cierre que nombra la URL.
 *
 * **No lee ninguna fila de ninguna tabla**: llama al `abrirDetalle` que ya existía, y ese pide
 * `verCierreDetalle({ cierreId })` POR ID. Es lo que hace que el enlace funcione igual para un
 * cierre de la página 7 del histórico, para uno filtrado fuera de la vista o para uno que ni
 * siquiera está en la página cargada (R40), y es lo que hizo barata esta feature: los tres
 * desenlaces de error —el cierre que no existe o está fuera de alcance, la sesión caída y el
 * fallo genérico— ya estaban escritos ahí (R41).
 *
 * Va en un componente propio, y renderiza `null`, por un motivo mecánico: el efecto tiene que
 * poder depender de `abrirDetalle`, que se declara DESPUÉS del `return` temprano de `sinZona`
 * y por tanto no puede ser dependencia de un hook del módulo. Acá la dependencia es explícita
 * y el disparo queda medido por el `ref`, no por la identidad de la función.
 *
 * **Una vez por navegación** (R40/R45): el `ref` recuerda qué id ya se abrió, así que los
 * re-renders que provoca abrirlo no lo vuelven a abrir. Y cuando el parámetro desaparece —al
 * cerrar el detalle, que lo retira de la URL (R45)— la memoria se borra: volver a navegar al
 * MISMO cierre lo abre de nuevo, que es lo que espera quien pulsa el enlace por segunda vez.
 */
function AbrirCierreDeLaUrl({
  cierreId,
  onAbrir,
}: Readonly<{ cierreId: string | null; onAbrir: (cierreId: string) => void }>) {
  const abiertoPorUrl = useRef<string | null>(null);

  useEffect(() => {
    if (cierreId === null) {
      abiertoPorUrl.current = null;
      return;
    }
    if (abiertoPorUrl.current === cierreId) return;
    abiertoPorUrl.current = cierreId;
    onAbrir(cierreId);
  }, [cierreId, onAbrir]);

  return null;
}

export function CierresAdminModule({
  pendientes,
  historico,
  sinZona,
  puedeRegistrarPago = false,
  puedeCorregirPagos = false,
  catalogoFiltros = CATALOGO_FILTROS_CIERRES_VACIO,
}: Readonly<CierresAdminModuleProps>) {
  const router = useRouter();
  const pathname = usePathname();
  // Feature 205 (T6.1, R39/R40): `?cierre=<uuid>` abre el detalle de ESE cierre. Se lee la
  // URL y no un estado propio, que es lo que hace la dirección compartible y recargable.
  const searchParams = useSearchParams();
  const toast = useToast();
  const { mutate } = useSWRConfig();

  // Detalle del cierre abierto (null = modal cerrado).
  const [detalle, setDetalle] = useState<DetalleAbierto | null>(null);
  // Evidencia (URL firmada, R7) en el visor; null = cerrado.
  const [evidencia, setEvidencia] = useState<string | null>(null);
  // Pedido humano (2026-08-19): la gestión cuyo desglose se está corrigiendo; `null` = diálogo
  // cerrado. Va aquí, con el resto de los hooks, y no junto al bloque que lo usa: los hooks se
  // llaman todos, siempre y en el mismo orden.
  const [corrigiendo, setCorrigiendo] = useState<CierreDetalleGestion | null>(null);
  // Sub-modal de rechazo (R11): true = abierto.
  const [rechazando, setRechazando] = useState(false);
  // Motivo del rechazo (obligatorio, R11) + su error de validación.
  const [motivo, setMotivo] = useState("");
  const [motivoError, setMotivoError] = useState<string | null>(null);
  // Feature 111/R16 (VÁLVULA DE ESCAPE): cierre `vencido` pendiente de confirmar el
  // destrabe; null = modal cerrado. Acción de EXCEPCIÓN, separada de aprobar/rechazar.
  const [destrabar, setDestrabar] = useState<CierreAdminResumen | null>(null);
  // Feature 158/R34: sub-modal de captura de los montos de indemnización; true = abierto.
  // Sólo se abre si el cierre TIENE incidentes; sin ellos se aprueba directo (R36).
  const [indemnizando, setIndemnizando] = useState(false);
  // Monto por `gestionId`, tal cual lo teclea el admin: STRING de extremo a extremo
  // (money-safe, R24). NUNCA se parsea a number acá; el borde y el repo lo tratan como
  // texto/Decimal.
  const [montos, setMontos] = useState<Record<string, string>>({});
  // Errores por gestión que devuelve el SERVIDOR (`fieldErrors` con clave = gestionId,
  // `CierresAdminService.validarCoberturaIndemnizaciones`). Se pintan por fila.
  const [montoErrores, setMontoErrores] = useState<Record<string, string>>({});
  // Feature 172/T E.1 (§8): oferta de pago tras aprobar; null = no se está ofreciendo nada.
  const [ofertaPago, setOfertaPago] = useState<OfertaPago | null>(null);

  /**
   * Pedido humano del 2026-08-16 — los filtros de la pantalla (fecha, bodega destino,
   * mensajero). UNO para los DOS listados: ver la cabecera de `FiltrosCierresBarra`.
   *
   * Va en la CLAVE de los dos `useSWR`, no en un `useEffect` que revalide: así cada
   * combinación (página, tamaño, filtros) es su propia entrada de caché y volver a un filtro ya
   * visto no dispara una lectura. Y por eso mismo el `fallbackData` del Server Component sólo
   * se usa SIN filtros: con un filtro puesto, la página 1 pre-cargada es la del conjunto SIN
   * filtrar, y servirla sería enseñar cierres que el filtro excluye.
   */
  const [filtros, setFiltros] = useState<FiltrosCierres>({});

  /**
   * Pedido humano del 2026-08-16 — las dos mitades de esta pantalla (la cola de decisión y el
   * histórico) pasan a ser PESTAÑAS en vez de dos secciones apiladas. Arranca en «Pendientes»:
   * es la que tiene trabajo que hacer; el histórico se consulta, no se atiende.
   */
  const [tab, setTab] = useState<TabCierresAdmin>(TAB_PENDIENTES);

  /**
   * Cambiar un filtro devuelve LOS DOS listados a su página 1. Sin esto, quien estuviera en la
   * página 7 pediría la página 7 de un conjunto recién recortado —que casi siempre no existe— y
   * vería un listado vacío con el contador diciendo que hay filas.
   */
  function aplicarFiltros(next: FiltrosCierres) {
    setFiltros(next);
    setHistoricoPage(1);
    setPendientesPage(1);
  }

  // Feature 170 — FASE 2 (T I.2, R40/R43): página visible del histórico. Vive AQUÍ y no en
  // `CierresAdminHistoricoLista` por el motivo de Q-I3: la página se pide UNA vez y quien la
  // pinta la recibe. Hasta el 2026-08-16 eran dos lecturas de los mismos cierres —la tabla y la
  // «Vista tipo factura»— y pedirla dos veces las habría dejado enseñando cosas distintas; hoy
  // la lectura es una sola, y el reparto se conserva porque es también el que mantiene el
  // contador de la cola fuera del archivo que pagina (guardia de T H.3).
  // `fallbackData` es la página que ya resolvió el Server Component: al entrar no hay
  // segunda lectura, y los comprobantes son EXACTAMENTE los de antes (R44).
  const [historicoPage, setHistoricoPage] = useState(1);
  const [historicoPageSize, setHistoricoPageSize] = useState(historico.pageSize);
  const { data: historicoData, error: historicoError } = useSWR(
    ["cierres-admin:historico", historicoPage, historicoPageSize, filtros],
    () => leerHistorico(historicoPage, historicoPageSize, filtros),
    {
      fallbackData:
        historicoPage === 1 &&
        historicoPageSize === historico.pageSize &&
        sinFiltros(filtros)
          ? historico
          : undefined,
    },
  );
  const historicoPagina: CierresAdminHistoricoPagina = historicoData ?? {
    items: [],
    total: 0,
    pageSize: historicoPageSize,
  };

  // R44: el esqueleto de carga se muestra sólo cuando NO hay nada que pintar. `isLoading` de
  // SWR sigue siendo `true` mientras revalida aunque haya `fallbackData`, y usarlo tal cual
  // haría que la página 1 —la que el Server Component ya resolvió— apareciera como esqueleto
  // antes de enseñar las filas que el usuario veía antes de paginar.
  const historicoCargando = historicoData === undefined;

  // Feature 170 — FASE 2 (T J.2, R40/R42/R43): página visible de la COLA. Vive AQUÍ, en el
  // módulo, y no en un componente hijo: es la decisión de Q-I6 que T I.2 dejó abierta y T J.1
  // recomendó medida. Con el control en este archivo, la guardia de T H.3 ve la pantalla como
  // paginada y se pone roja mientras el contador de abajo salga de un array; con el control en
  // un hijo, la guardia deja de mirar hacia arriba y el contador podría quedarse mintiendo.
  const [pendientesPage, setPendientesPage] = useState(1);
  const [pendientesPageSize, setPendientesPageSize] = useState(pendientes.pageSize);
  const { data: pendientesData, error: pendientesError } = useSWR(
    ["cierres-admin:pendientes", pendientesPage, pendientesPageSize, filtros],
    () => leerPendientes(pendientesPage, pendientesPageSize, filtros),
    {
      fallbackData:
        pendientesPage === 1 &&
        pendientesPageSize === pendientes.pageSize &&
        sinFiltros(filtros)
          ? pendientes
          : undefined,
    },
  );
  const colaPendientes: CierresAdminColaPagina = pendientesData ?? {
    items: [],
    total: 0,
    pageSize: pendientesPageSize,
  };
  const pendientesCargando = pendientesData === undefined;

  // R3: adminSatelite sin zona → aviso accionable, sin tablas de acción.
  if (sinZona) {
    return (
      <p
        role="alert"
        className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
      >
        No tenés una zona asignada; contactá a tu administrador.
      </p>
    );
  }

  // Feature 158/R19/R34: las gestiones `incidente` del cierre abierto. Salen del MISMO
  // detalle que ya se pidió al servidor (`grupos.incidente`), no de una consulta aparte:
  // el conjunto que la UI pide indemnizar es exactamente el que el service exige cubrir.
  const incidentes: CierreDetalleGestion[] = detalle?.grupos.incidente ?? [];
  // R34: no se puede confirmar mientras falte o sea inválido algún monto. Mismo criterio
  // que el servidor (`montoValido` de la wallet: > 0, hasta 2 decimales, sin `parseFloat`) —
  // incluido el TOPE (m5): sin él la UI habilitaba «Confirmar» con un monto de 11 dígitos que
  // el servidor rechaza después, y ese rechazo llega bajo la clave `indemnizaciones` (no por
  // gestión), así que no se pintaba en ninguna celda: el admin veía que algo falló y no dónde.
  const todosLosMontosValidos =
    incidentes.length > 0 &&
    incidentes.every((g) => montoValido(montos[g.gestionId] ?? "", INDEMNIZACION_MONTO_MAX));

  /**
   * Mensaje accionable de un monto tecleado que NO pasa la validación de cliente. `undefined`
   * si el campo está vacío (ahí el aviso general del sub-modal ya dice que falta) o si es
   * válido. Distingue el tope del formato: son dos correcciones distintas.
   */
  function errorDeMonto(valor: string): string | undefined {
    const limpio = valor.trim();
    if (limpio === "" || montoValido(limpio, INDEMNIZACION_MONTO_MAX)) return undefined;
    // Bien formado pero por encima del tope → el problema es el tamaño, no la sintaxis.
    return montoValido(limpio) ? INDEMNIZACION_MONTO_EXCEDE : INDEMNIZACION_MONTO_FORMATO;
  }

  /** Abre el detalle de un cierre (pide las gestiones + evidencias firmadas). */
  async function abrirDetalle(cierreId: string) {
    // Un fallo INESPERADO de la action (que lanza ante un `AppErrorCode` que no sabe
    // traducir) rechazaba esta promesa sin que nadie la escuchara: el modal no abria y no
    // aparecia ningun mensaje, que es como se ve "el boton no funciona". El toast no
    // arregla la causa, pero convierte el silencio en algo que se puede reportar.
    let result: Awaited<ReturnType<typeof verCierreDetalle>>;
    try {
      result = await verCierreDetalle({ cierreId });
    } catch {
      toast.error("No se pudo abrir el detalle del cierre. Intentá de nuevo.");
      return;
    }
    if (result.status === "ok") {
      setDetalle({
        cierre: result.cierre,
        grupos: result.grupos,
        totalesIngreso: result.totalesIngreso,
        desgloseIngresoBodegaRechazos: result.desgloseIngresoBodegaRechazos,
        ganancia: result.ganancia,
        pagoTienda: result.pagoTienda,
      });
      return;
    }
    if (result.status === "no_encontrada") {
      toast.error("El cierre ya no está disponible. Actualizando la lista.");
      refrescarListas();
      return;
    }
    if (result.status === "unauthenticated") {
      toast.error("Tu sesión expiró. Iniciá sesión de nuevo.");
      return;
    }
    toast.error("No se pudo abrir el detalle del cierre. Intentá de nuevo.");
  }

  /**
   * Feature 205 (T6.1, R45) — saca `?cierre=` de la dirección, conservando el resto de
   * parámetros. Sin esto, recargar la pantalla volvería a abrir el detalle que se acaba de
   * cerrar, y el usuario no tendría forma de salir de él salvo editando la URL a mano.
   *
   * `replace` y no `push`: cerrar un modal no es un paso de navegación que el botón «atrás»
   * deba deshacer. Y no se hace nada si el parámetro no está: el detalle abierto desde la
   * tabla no toca la URL, así que cerrarlo tampoco.
   */
  function limpiarCierreDeLaUrl() {
    if (searchParams.get(PARAM_CIERRE) === null) return;
    const parametros = new URLSearchParams(
      [...searchParams.entries()].filter(([clave]) => clave !== PARAM_CIERRE),
    );
    const cadena = parametros.toString();
    router.replace(cadena ? `${pathname}?${cadena}` : pathname, { scroll: false });
  }

  function cerrarDetalle() {
    limpiarCierreDeLaUrl();
    setDetalle(null);
    setRechazando(false);
    setMotivo("");
    setMotivoError(null);
    // Feature 158: cerrar el detalle descarta también la captura en curso; el siguiente
    // cierre que se abra arranca con sus propias filas y sin montos heredados.
    setIndemnizando(false);
    setMontos({});
    setMontoErrores({});
  }

  /**
   * Pedido humano del 2026-08-19 — tras aceptar / rechazar / destrabar, LA LISTA tiene que
   * enterarse. `router.refresh()` a secas no bastaba: sólo vuelve a resolver el Server
   * Component, y sus páginas entran acá como `fallbackData`, que SWR usa una vez y nunca
   * vuelve a mirar. Con datos ya en caché, el cierre resuelto seguía sentado en la cola hasta
   * recargar a mano.
   *
   * Se revalidan TODAS las claves de los dos listados —cualquier página, cualquier
   * combinación de filtros—, no sólo la visible: una decisión mueve la fila de la cola al
   * histórico y recorre la paginación de ambos, así que dejar el resto de páginas en caché
   * sería volver a la misma mentira una página más allá.
   */
  function refrescarListas() {
    void mutate(
      (clave) =>
        Array.isArray(clave) &&
        (clave[0] === "cierres-admin:pendientes" ||
          clave[0] === "cierres-admin:historico"),
    );
    router.refresh();
  }

  /** Traduce un resultado de dominio de error a feedback accionable + refresco. */
  function manejarErrorDecision(
    status:
      | "conflict"
      | "no_encontrada"
      | "forbidden"
      | "unauthenticated"
      | "validation_error",
  ) {
    if (status === "conflict") {
      toast.error("Este cierre ya fue resuelto por otro administrador.");
    } else if (status === "no_encontrada") {
      toast.error("El cierre ya no está disponible.");
    } else if (status === "forbidden") {
      toast.error("No tenés permiso para resolver este cierre.");
    } else if (status === "unauthenticated") {
      toast.error("Tu sesión expiró. Iniciá sesión de nuevo.");
    } else {
      toast.error("No se pudo resolver el cierre. Intentá de nuevo.");
    }
    cerrarDetalle();
    refrescarListas();
  }

  /**
   * R10 + feature 158/R22/R36: aprueba el cierre abierto. `indemnizaciones` sólo viaja
   * cuando el cierre TIENE incidentes; sin ellos se manda el MISMO payload de la 38
   * (`{ cierreId }`), así el camino sin incidentes no cambia ni un byte (R36).
   */
  async function confirmarAprobacion(
    indemnizaciones?: { gestionId: string; monto: string }[],
  ) {
    if (!detalle) return;
    const result = await aprobarCierre(
      indemnizaciones === undefined
        ? { cierreId: detalle.cierre.cierreId }
        : { cierreId: detalle.cierre.cierreId, indemnizaciones },
    );
    if (result.status === "ok") {
      // El cierre YA está aprobado y el mensajero, libre (feature 111): esta rama solo puede
      // AÑADIR cosas, nunca condicionar lo anterior (R17/R18). Se declara el éxito, se cierra
      // el detalle y se refresca la ruta EXACTAMENTE como antes de la 172; lo del pago va
      // después y es aparte.
      const { cierreId, mensajeroNombre } = detalle.cierre;
      // Feature 172 (T C.2): el pendiente lo derivó el SERVIDOR al aprobar. La pantalla no lo
      // calcula (R14) y no lo guarda en ningún sitio: si no se paga, se vuelve a derivar.
      const pendiente = result.pendientePagoMensajero;

      toast.success("Cierre aprobado correctamente.");
      cerrarDetalle();
      refrescarListas();

      // R16 — se OFRECE registrar el pago si queda algo pendiente y el actor puede pagar.
      // [P3]/R6: un `adminSatelite` aprueba y aquí no ve nada; el flujo termina como hoy y la
      // deuda queda abierta y visible para quien tiene la caja (R26).
      if (puedeRegistrarPago && hayPendienteDeLiquidar(pendiente)) {
        setOfertaPago({ cierreId, mensajeroNombre, pendiente });
      }
      return;
    }
    // Feature 158/R19-R21: el servidor valida la cobertura EXACTA de los montos y devuelve
    // un error POR GESTIÓN. Se pintan en su fila y el sub-modal SIGUE ABIERTO: cerrarlo
    // obligaría a recapturar todo lo ya tecleado.
    if (result.status === "validation_error") {
      setMontoErrores(
        Object.fromEntries(
          Object.entries(result.fieldErrors).map(([campo, mensajes]) => [
            campo,
            mensajes[0] ?? INDEMNIZACION_FALTAN,
          ]),
        ),
      );
      return;
    }
    manejarErrorDecision(result.status);
  }

  /**
   * Feature 158/R34: pulsa "Aprobar" en el detalle. Con incidentes abre el sub-modal de
   * captura; sin incidentes aprueba directo, exactamente como hasta ahora (R36).
   */
  function pedirAprobacion() {
    if (incidentes.length === 0) {
      void confirmarAprobacion();
      return;
    }
    setMontoErrores({});
    setIndemnizando(true);
  }

  /** Feature 158/R34: confirma la aprobación CON los montos capturados. */
  async function confirmarAprobacionConMontos() {
    if (!todosLosMontosValidos) return; // R34: el botón ya está deshabilitado; doble candado.
    await confirmarAprobacion(
      incidentes.map((g) => ({ gestionId: g.gestionId, monto: montos[g.gestionId].trim() })),
    );
  }

  /** R11: rechaza el cierre abierto con motivo obligatorio. */
  async function confirmarRechazo() {
    if (!detalle) return;
    const motivoLimpio = motivo.trim();
    if (motivoLimpio.length === 0) {
      setMotivoError("El motivo de rechazo es obligatorio.");
      return; // R11: sin motivo NO se envía
    }
    const result = await rechazarCierre({
      cierreId: detalle.cierre.cierreId,
      motivo: motivoLimpio,
    });
    if (result.status === "ok") {
      toast.success("Cierre rechazado correctamente.");
      cerrarDetalle();
      refrescarListas();
      return;
    }
    if (result.status === "validation_error") {
      const primero = Object.values(result.fieldErrors)[0]?.[0];
      setMotivoError(primero ?? "El motivo de rechazo es obligatorio.");
      return;
    }
    manejarErrorDecision(result.status);
  }

  /**
   * Feature 111/R16 (VÁLVULA DE ESCAPE, emergencia): destraba un `vencido` ABANDONADO
   * transicionándolo `vencido → solicitado` en nombre del mensajero. Es la EXCEPCIÓN al
   * flujo normal (para cuando el mensajero nunca lo solicita y quedan bloqueados él y su
   * bodega). Tras destrabar, el cierre queda `solicitado` y se resuelve por la vía normal
   * (aprobar/rechazar), que registra la auditoría (R17). NO recalcula montos (R21).
   */
  async function confirmarDestrabar() {
    const cierre = destrabar;
    if (!cierre) return;
    const result = await forzarSolicitudVencido({ cierreId: cierre.cierreId });
    if (result.status === "ok") {
      toast.success(
        "Cierre vencido destrabado; quedó como solicitado para aprobación.",
      );
      setDestrabar(null);
      refrescarListas();
      return;
    }
    if (result.status === "conflict") {
      toast.error("El cierre ya no está vencido (otro proceso lo resolvió).");
    } else if (result.status === "no_encontrada") {
      toast.error("El cierre ya no está disponible.");
    } else if (result.status === "forbidden") {
      toast.error("No tenés permiso para destrabar este cierre.");
    } else if (result.status === "unauthenticated") {
      toast.error("Tu sesión expiró. Iniciá sesión de nuevo.");
    } else {
      toast.error("No se pudo destrabar el cierre. Intentá de nuevo.");
    }
    setDestrabar(null);
    refrescarListas();
  }

  const cierreAbierto = detalle?.cierre ?? null;
  // Feature 172 (T E.2, R19/R28): la sección «Pago al mensajero» solo existe en un cierre
  // APROBADO y solo para quien puede pagar ([P3]/R6). En cualquier otro estado no se muestra
  // ni se ofrece nada relativo al pago — y, como el componente ni se monta, tampoco se pide su
  // lista de comprobantes.
  const ofrecerPagoEnDetalle = puedeRegistrarPago && cierreAbierto?.estado === "aprobado";
  // Feature 111/R15 (Q1-B): la vía NORMAL aprobar/rechazar aplica SOLO a `solicitado`.
  // Un `vencido` YA NO es resoluble por la vía normal (revierte la 41 R20): su único
  // camino normal es que el mensajero lo solicite (→ `solicitado`); la excepción es la
  // válvula de escape del admin (R16). El histórico sigue siendo solo lectura.
  const esResoluble = cierreAbierto?.estado === "solicitado";
  /**
   * Pedido humano (2026-08-19): el desglose se corrige mientras el cierre está ABIERTO — la
   * plata todavía no está aprobada—. NO es `esResoluble`: un `vencido` es un cierre abierto que
   * el mensajero nunca solicitó, y su desglose es tan corregible como el de un `solicitado`.
   * El servidor exige lo mismo; esto solo decide si se ofrece.
   */
  const ofrecerCorreccionPagos =
    puedeCorregirPagos &&
    (cierreAbierto?.estado === "solicitado" || cierreAbierto?.estado === "vencido");

  return (
    // `gap-4` y no `gap-8` (pedido humano del 2026-08-16): entre la barra de filtros y las
    // pestañas había el mismo hueco que entre dos secciones distintas, y no lo son —el filtro
    // acota justo lo que las pestañas reparten—. Se separan como lo que son: una cabecera.
    <div className="flex flex-col gap-4">
      {/* Feature 205 (T6.1, R39/R40): el cierre que nombra la URL se abre al llegar. No pinta
          nada; solo dispara la MISMA lectura por id que usa la tabla. */}
      <AbrirCierreDeLaUrl
        cierreId={searchParams.get(PARAM_CIERRE)}
        onAbrir={abrirDetalle}
      />

      {/* ---------- Filtros (pedido humano del 2026-08-16) ----------
          UNA barra para los dos listados de abajo. Deshabilitada mientras alguna de las dos
          páginas está en vuelo: cambiar un filtro a mitad de una lectura dispararía una
          segunda con la primera todavía viva. */}
      <FiltrosCierresBarra
        catalogo={catalogoFiltros}
        onChange={aplicarFiltros}
        disabled={pendientesCargando || historicoCargando}
      />

      {/* ---------- Pestañas: pendientes / resueltos (pedido humano del 2026-08-16) ----------
          El conteo va DENTRO de cada pestaña, y no es adorno: al esconder la mitad que no se
          mira, sin el número la pestaña apagada no diría si hay trabajo esperando. Los dos
          salen del `total` del SERVIDOR (R42), nunca de `items.length`. */}
      {/* Pedido humano del 2026-08-16: la descarga va ALINEADA con las pestañas, en su misma
          fila y al otro extremo, en vez de en una fila propia encima de la lista. Se monta la
          de la pestaña ACTIVA: solo hay un archivo que pedir en cada momento, y así el botón
          no aparece dos veces (una por panel). */}
      {/* `pb-1` (pedido humano del 2026-08-16): el grupo segmentado se estaba viendo cortado
          por abajo. Su borde y su anillo de foco se salen del alto nominal del botón, y sin
          este respiro el contenedor de la fila los recorta. */}
<div className="flex flex-wrap items-center justify-between gap-2 pb-1">
        <SegmentedToggle
          options={[
            {
              valor: TAB_PENDIENTES,
              etiqueta: TAB_PENDIENTES_LABEL,
              conteo: colaPendientes.total,
            },
            {
              valor: TAB_RESUELTOS,
              etiqueta: TAB_RESUELTOS_LABEL,
              conteo: historicoPagina.total,
            },
          ]}
          valor={tab}
          onChange={setTab}
          ariaLabel={TABS_CIERRES_LABEL}
        />
        <div className="flex flex-wrap items-center gap-2">
          <DescargarDatasetButton
            {...(tab === TAB_PENDIENTES
              ? descargaColaCierres(filtros)
              : descargaHistoricoCierres(filtros))}
          />
          {/* Feature 230 (T5.1, R1/R23): la descarga DETALLADA, junto a la general y en las DOS
              pestañas. Son dos controles distintos y no dos modos del mismo: la general es una
              fila por CIERRE y sale de lo que la pestaña enseña, filtros incluidos; ésta es una
              fila por GESTIÓN y su conjunto lo redacta su propio diálogo, sin heredar nada de la
              barra (D11, R34/R35). Por eso NO se le pasa `filtros`.

              Desde aquí se cubre la GAM: en esta pantalla el maestro solo ve los cierres con
              destino `bodega_central`, y los de las bodegas satélite le llegan únicamente
              consolidados, por el control gemelo de `CierresBodegaAdminModule`. Los dos
              conjuntos son DISJUNTOS y su unión es el total (design §2.6). */}
          <DescargarGestionesDialog
            catalogo={catalogoFiltros}
            accion={listarGestionesCierresAdminCompleto}
            disabled={pendientesCargando || historicoCargando}
          />
        </div>
      </div>

      <PanelConmutado activo={tab === TAB_PENDIENTES} ariaLabel={TAB_PENDIENTES_LABEL}>
      {/* ---------- Pendientes de decisión (R4) ---------- */}
      {/* SIN ENCABEZADO VISIBLE (pedido humano del 2026-08-16): la pestaña de arriba ya dice
          «Pendientes», y repetirlo dos centímetros más abajo no añade nada. El `aria-label` SÍ
          se queda: la sección sigue necesitando un nombre para quien no ve la pantalla, y es
          por él por el que la localizan los tests y el E2E.

          EL CONTADOR NO SE PIERDE, se mudó: vive en la pestaña (`conteo`), y sigue saliendo del
          TOTAL del servidor. Con `items.length` diría «(25)» habiendo 300 cierres esperando
          decisión, y no fallaría nada: compilaría, renderizaría y mentiría. Lo vigila
          `tests/unit/descarga/contadores-cabecera.guardia.test.ts`. */}
      <section
        aria-label="Pendientes de decisión"
        className="flex flex-col gap-3"
      >
        {/* Pedido humano del 2026-08-16: la cola se lee como COMPROBANTES, no como tabla.
            Cada cierre es la misma hoja compacta que ya usaba la previsualización, con su
            botonera y su desglose desplegable; la tabla que estaba aquí desaparece, y con
            ella la duplicidad de tener los mismos cierres dos veces en la pantalla. */}
        <ListaComprobantes
          ariaLabel="Pendientes de decisión"
          items={colaPendientes.items}
          clave={(c) => c.cierreId}
          isLoading={pendientesCargando}
          error={pendientesError ? ERROR_CARGA_PENDIENTES : null}
          emptyMessage="No hay cierres pendientes de decisión."
          render={(c) => (
            <CierreFacturaResumen
              cierre={c}
              acciones={
                <AccionesCola
                  cierre={c}
                  abrir={abrirDetalle}
                  pedirDestrabar={setDestrabar}
                />
              }
            />
          )}
        />

        <Pagination
          page={pendientesPage}
          pageSize={pendientesPageSize}
          total={colaPendientes.total}
          disabled={pendientesCargando}
          showFirstLast
          siblingCount={1}
          ariaLabel={PAGINACION_PENDIENTES_LABEL}
          onPageChange={setPendientesPage}
          onPageSizeChange={(s) => {
            setPendientesPageSize(s);
            setPendientesPage(1);
          }}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
        />
      </section>

      </PanelConmutado>

      <PanelConmutado activo={tab === TAB_RESUELTOS} ariaLabel={TAB_RESUELTOS_LABEL}>
      {/* ---------- Histórico (solo lectura, R5) ----------
          Feature 170 — FASE 2 (T I.2): el listado y su control viven en su propio componente;
          la página la pide este módulo (ver el comentario del `useSWR`). */}
      <CierresAdminHistoricoLista
        pagina={historicoPagina}
        page={historicoPage}
        isLoading={historicoCargando}
        hayError={Boolean(historicoError)}
        onPageChange={setHistoricoPage}
        onPageSizeChange={(s) => {
          setHistoricoPageSize(s);
          setHistoricoPage(1);
        }}
        onAbrir={abrirDetalle}
      />

      </PanelConmutado>

      {/* Los modales viven FUERA de los dos paneles: el detalle se abre desde cualquiera de las
          dos pestañas y no puede quedar escondido con la que no se está mirando. */}
      {/* ---------- Detalle del cierre (R6-R8) ---------- */}
      <Modal
        open={detalle !== null}
        onOpenChange={(next) => {
          if (!next) cerrarDetalle();
        }}
        title="Detalle del cierre"
        description={
          cierreAbierto
            ? `${cierreAbierto.mensajeroNombre} · ${destinoCierre(cierreAbierto)}`
            : undefined
        }
        // Sin ancho propio: el default del Modal (75% de la pantalla) es el que corresponde
        // a un detalle con tablas anchas.
        confirmLabel="Cerrar"
        hideCancel
        onConfirm={cerrarDetalle}
      >
        {detalle ? (
          <div className="flex max-h-[70vh] flex-col gap-6 overflow-y-auto pr-1">
            {/* El detalle es UNA sola lectura: el comprobante. Reemplazó a los paneles
                sueltos + las 4 tablas por resultado (R6-R8) sin perder ningún dato: los
                totales snapshot, el ingreso de Ordenex, la liquidación y las gestiones
                (ahora en pestañas, con su desglose por fila) viven todos ahí dentro. */}
            <CierreFacturaDetalle
              cierre={detalle.cierre}
              grupos={detalle.grupos}
              totalesIngreso={detalle.totalesIngreso}
              desgloseIngresoBodegaRechazos={
                detalle.desgloseIngresoBodegaRechazos
              }
              ganancia={detalle.ganancia}
              pagoTienda={detalle.pagoTienda}
              onVerEvidencia={setEvidencia}
              // Ausente cuando no se puede corregir: la hoja vuelve a ser de solo lectura sin
              // que la fila tenga que saber nada de roles ni de estados.
              onCorregirPagos={ofrecerCorreccionPagos ? setCorrigiendo : undefined}
            />

            {/* Pedido humano (2026-08-19): el editor del desglose, el MISMO que usa el
                mensajero. Tras corregir se RELEE el detalle del servidor —los totales del
                cierre los recalculó él en la misma transacción— y se refrescan las listas,
                porque el total del cierre también cambia de balde en la tabla. */}
            <CorregirPagosDialog
              gestion={corrigiendo}
              onOpenChange={(open) => {
                if (!open) setCorrigiendo(null);
              }}
              onCorregido={async () => {
                if (cierreAbierto) await abrirDetalle(cierreAbierto.cierreId);
                refrescarListas();
              }}
            />

            {/* ---------- Feature 172 (T E.2, R19/R27/R28/R49): pago al mensajero ----------
                El SEGUNDO camino del pago: un cierre aprobado se puede liquidar en cualquier
                momento posterior desde su propio detalle. Tras registrar —o anular (T F.5)—
                el pendiente se vuelve a LEER del servidor (`abrirDetalle`); no se recalcula
                en el cliente. `puedeAnular` sale del MISMO permiso que pagar (R81). */}
            {ofrecerPagoEnDetalle && cierreAbierto ? (
              <PagoMensajeroSeccion
                cierreId={cierreAbierto.cierreId}
                mensajeroNombre={cierreAbierto.mensajeroNombre}
                pendiente={cierreAbierto.pendientePagoMensajero}
                puedeAnular={puedeRegistrarPago}
                onRegistrado={async () => {
                  await abrirDetalle(cierreAbierto.cierreId);
                  refrescarListas();
                }}
              />
            ) : null}

            {/* Acciones: solo en un cierre `solicitado` (feature 111/R15); histórico y
                `vencido` = sin decisión aquí (el `vencido` se destraba desde la cola, R16). */}
            {esResoluble ? (
              <section
                aria-label="Decisión del cierre"
                className="flex flex-wrap justify-end gap-3 border-t pt-4"
              >
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => {
                    setMotivo("");
                    setMotivoError(null);
                    setRechazando(true);
                  }}
                >
                  Rechazar
                </Button>
                <Button type="button" onClick={pedirAprobacion}>
                  Aprobar
                </Button>
              </section>
            ) : null}
          </div>
        ) : null}
      </Modal>

      {/* ---------- Sub-modal de rechazo con motivo obligatorio (R11) ---------- */}
      <Modal
        open={rechazando}
        onOpenChange={(next) => {
          if (!next) {
            setRechazando(false);
            setMotivoError(null);
          }
        }}
        title="Rechazar cierre"
        description="Indicá el motivo del rechazo. El mensajero lo verá para corregir."
        confirmLabel="Rechazar cierre"
        confirmVariant="destructive"
        onConfirm={confirmarRechazo}
        closeOnConfirm={false}
      >
        <div className="flex flex-col gap-2">
          <label htmlFor="motivo-rechazo" className="text-sm font-medium">
            Motivo del rechazo
          </label>
          <textarea
            id="motivo-rechazo"
            value={motivo}
            onChange={(e) => {
              setMotivo(e.target.value);
              if (motivoError) setMotivoError(null);
            }}
            rows={4}
            aria-required="true"
            aria-invalid={motivoError !== null}
            aria-describedby={motivoError ? "motivo-rechazo-error" : undefined}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {motivoError ? (
            <p
              id="motivo-rechazo-error"
              role="alert"
              className="text-sm text-destructive"
            >
              {motivoError}
            </p>
          ) : null}
        </div>
      </Modal>

      {/* ---------- Sub-modal de captura de indemnizaciones (feature 158/R19/R34) ----------
          Espejo del sub-modal de rechazo: se abre DESDE el detalle, con un dato extra
          obligatorio antes de confirmar. Una fila por incidente; el confirmar queda
          deshabilitado mientras falte o sea inválido algún monto, con el mismo criterio
          (`montoValido`) que revalida el servidor. Los montos son STRING de punta a punta. */}
      <Modal
        open={indemnizando}
        onOpenChange={(next) => {
          if (!next) {
            setIndemnizando(false);
            setMontoErrores({});
          }
        }}
        title={INDEMNIZACION_TITULO}
        description={INDEMNIZACION_DETALLE}
        confirmLabel={INDEMNIZACION_CONFIRMAR}
        confirmDisabled={!todosLosMontosValidos}
        onConfirm={confirmarAprobacionConMontos}
        closeOnConfirm={false}
      >
        <div className="flex flex-col gap-4">
          {incidentes.map((g) => {
            const inputId = `indemnizacion-${g.gestionId}`;
            // El error del servidor manda (llegó de una decisión real); si no lo hay, se pinta
            // el del cliente, que es el que caza el tope ANTES de intentar aprobar.
            const error = montoErrores[g.gestionId] ?? errorDeMonto(montos[g.gestionId] ?? "");
            return (
              <div
                key={g.gestionId}
                className="flex flex-col gap-1.5 rounded-lg border border-border p-3"
              >
                <p className="text-sm font-medium">
                  {g.numRemision} · {g.destinatario}
                </p>
                <p className="text-xs text-muted-foreground">
                  {`Nº Guía ${g.numGuia ?? "—"} · ${g.tiendaNombre}`}
                  {g.motivo ? ` · ${g.motivo}` : ""}
                </p>
                {/* R34: la CAUSA, destacada y no escondida en la línea de contexto. Es el dato
                    que justifica el monto: no es lo mismo indemnizar un paquete raspado que uno
                    robado, y el admin lo decide mirando esto. */}
                <p className="text-sm">
                  <span className="text-muted-foreground">{INDEMNIZACION_CAUSA_LABEL}: </span>
                  <span className="font-medium">
                    {g.causaIncidente
                      ? CAUSA_INCIDENTE_LABEL[g.causaIncidente]
                      : INDEMNIZACION_CAUSA_DESCONOCIDA}
                  </span>
                </p>
                <Label htmlFor={inputId}>{INDEMNIZACION_MONTO_LABEL}</Label>
                <Input
                  id={inputId}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0.00"
                  value={montos[g.gestionId] ?? ""}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? `${inputId}-error` : `${inputId}-ayuda`}
                  onChange={(e) => {
                    const valor = e.target.value;
                    setMontos((prev) => ({ ...prev, [g.gestionId]: valor }));
                    // Teclear limpia el error del servidor de ESA fila (no el de las otras).
                    setMontoErrores((prev) => {
                      if (!prev[g.gestionId]) return prev;
                      const rest = { ...prev };
                      delete rest[g.gestionId];
                      return rest;
                    });
                  }}
                />
                {error ? (
                  <p id={`${inputId}-error`} role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                ) : (
                  <p id={`${inputId}-ayuda`} className="text-xs text-muted-foreground">
                    {INDEMNIZACION_MONTO_AYUDA}
                  </p>
                )}
              </div>
            );
          })}
          {/* El motivo del bloqueo se dice con TEXTO, no sólo con un botón apagado. */}
          {todosLosMontosValidos ? null : (
            <p role="note" className="text-sm text-muted-foreground">
              {INDEMNIZACION_FALTAN}
            </p>
          )}
        </div>
      </Modal>

      {/* ---------- Confirmación de la VÁLVULA DE ESCAPE (feature 111/R16) ----------
          Acción de EXCEPCIÓN, diferenciada de aprobar/rechazar: destraba un `vencido`
          abandonado en nombre del mensajero. El copy lo deja claro. */}
      <Modal
        open={destrabar !== null}
        onOpenChange={(next) => {
          if (!next) setDestrabar(null);
        }}
        title="Destrabar cierre vencido abandonado"
        description={
          destrabar
            ? `Acción de excepción. Enviarás a aprobación el cierre vencido de ${destrabar.mensajeroNombre} en su nombre, porque no lo solicitó. Después deberás aprobarlo o rechazarlo por la vía normal. No se recalculan los montos ya registrados.`
            : undefined
        }
        confirmLabel="Destrabar (excepción)"
        confirmVariant="destructive"
        onConfirm={confirmarDestrabar}
        closeOnConfirm={false}
      />

      {/* ---------- Feature 172 (T E.1, §8/R16/R17/R18): se pregunta AL APROBAR ----------
          Se monta cuando `aprobarCierre` respondió `ok` con pendiente > 0 y el actor puede
          pagar. Va FUERA del modal de detalle a propósito: cuando aparece, el cierre ya está
          aprobado y su detalle cerrado.

          LO QUE ESTE BLOQUE NO HACE, y es lo que decide si la tanda vale algo: no puede
          revertir la aprobación. No hay una sola llamada aquí que toque el cierre — ni al
          cerrarse con «Ahora no» (se descarta el estado local y ya), ni cuando el pago falla
          (el diálogo se queda abierto con su clave y el aviso dice que el cierre sigue
          aprobado). Si el pago pudiera tumbar la aprobación, el cierre volvería a
          `solicitado`, que BLOQUEA al mensajero (feature 111): se quedaría sin trabajar al día
          siguiente por un trámite administrativo ajeno a él. */}
      {ofertaPago ? (
        <RegistrarPagoMensajeroDialog
          open
          onOpenChange={(next) => {
            // R17: cerrar —con «Ahora no», con Escape o con el overlay— no persiste nada.
            if (!next) setOfertaPago(null);
          }}
          cierreId={ofertaPago.cierreId}
          mensajeroNombre={ofertaPago.mensajeroNombre}
          pendiente={ofertaPago.pendiente}
          trasAprobar
          onRegistrado={async () => {
            // Refresco DIRIGIDO de los comprobantes de ESE cierre (R33) + la ruta, para que
            // el listado vuelva a traer el pendiente derivado por el servidor (R26).
            await mutate(clavePagosDeCierre(ofertaPago.cierreId));
            refrescarListas();
          }}
        />
      ) : null}

      {/* ---------- Visor de evidencia (URL firmada, R7) ---------- */}
      <Modal
        open={evidencia !== null}
        onOpenChange={(next) => {
          if (!next) setEvidencia(null);
        }}
        title="Evidencia de la gestión"
        confirmLabel="Cerrar"
        hideCancel
        onConfirm={() => setEvidencia(null)}
      >
        {evidencia ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={evidencia}
            alt="Evidencia fotográfica de la gestión"
            className="max-h-[60vh] w-full rounded-md object-contain"
          />
        ) : null}
      </Modal>
    </div>
  );
}

/**
 * Botonera de un cierre de la cola (R4). Es la que vivía en la columna «Acciones» de la
 * tabla, TAL CUAL —mismos rótulos y mismos nombres accesibles—: ahora que la tabla no existe,
 * estos botones ya no compiten con nadie por el nombre y recuperan el suyo, sin el sufijo
 * «desde el comprobante» que la previsualización necesitaba para no duplicarlos.
 *
 * Feature 111/R15/R16: un `solicitado` es resoluble por la vía normal ("Ver / decidir" abre el
 * detalle con aprobar/rechazar). Un `vencido` NO lo es; solo en él se ofrece la acción
 * DIFERENCIADA de excepción "Destrabar cierre vencido" (con confirmación).
 */
function AccionesCola({
  cierre,
  abrir,
  pedirDestrabar,
}: Readonly<{
  cierre: CierreAdminResumen;
  abrir: (cierreId: string) => void;
  pedirDestrabar: (c: CierreAdminResumen) => void;
}>) {
  if (cierre.estado !== "vencido") {
    return (
      <Button type="button" size="sm" onClick={() => abrir(cierre.cierreId)}>
        Ver / decidir
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        aria-label={`Ver el cierre de ${cierre.mensajeroNombre}`}
        onClick={() => abrir(cierre.cierreId)}
      >
        Ver
      </Button>
      <Button
        type="button"
        size="sm"
        variant="destructive"
        onClick={() => pedirDestrabar(cierre)}
        aria-label={`Destrabar cierre vencido abandonado de ${cierre.mensajeroNombre}`}
      >
        Destrabar cierre vencido
      </Button>
    </div>
  );
}
