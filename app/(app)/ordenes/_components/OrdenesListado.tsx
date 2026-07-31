"use client";

import { useMemo, useState } from "react";
import useSWR, { useSWRConfig } from "swr";

import {
  FilterComponent,
  type FilterDef,
  type FilterSelection,
} from "@/components/shared/FilterComponent";
import { Skeleton } from "@/components/ui/skeleton";
import type { CatalogoFiltrosOrdenesDTO } from "@/lib/types/filtros-ordenes";
import type { OrderStatusLiteRow } from "@/lib/interfaces/repositories/IOrdenRepository";
import { listarOrderStatus } from "@/lib/actions/order-status";
import { ORDER_STATUS_SEED } from "@/lib/types/order-status";
import {
  listarMensajerosParaAsignacion,
  listarZonasBloqueadasPorCierre,
} from "@/lib/actions/ordenes-guia";
import type { Column } from "@/components/shared/DataTable";
import type { OrdenListItemDTO } from "@/lib/types/orden";

import { OrdenesModule, type AccionLote } from "./OrdenesModule";
import { OrdenesCargaMasivaButton } from "./OrdenesCargaMasivaButton";
import { EscanerRecepcionOrigen } from "./EscanerRecepcionOrigen";
import { EscanerRecepcionBodegaCentral } from "./EscanerRecepcionBodegaCentral";
import { ReceptorDesplegable } from "./ReceptorDesplegable";
import { ORDER_STATUS_LABELS } from "./EstatusBadge";
import {
  ordenesColumnsReprogramada,
} from "./ordenes-columns";
import { GenerarGuiaModal } from "./GenerarGuiaModal";
import { AsignarBodegaModal } from "./AsignarBodegaModal";
import { AsignarRecoleccionModal } from "./AsignarRecoleccionModal";
import { EtiquetasGuiaModal } from "./EtiquetasGuiaModal";
import { DevolverATiendaModal } from "./DevolverATiendaModal";
import { RecuperarABodegaModal } from "./RecuperarABodegaModal";
import { DeshacerAsignacionModal } from "./DeshacerAsignacionModal";
import {
  construirFiltrosOrdenes,
  CATALOGO_FILTROS_VACIO,
  CLAVE_ESTADO,
} from "./ordenes-filtros-def";
import { seleccionAFilter } from "./seleccion-a-filter";
import type { OrdenesFilterUI } from "./serializar-filtro";

type ModalAbierto =
  | "generar-guia"
  | "asignar-bodega"
  | "asignar-recoleccion" // feature 157
  | "etiquetas"
  | "devolver-tienda"
  | "recuperar-bodega"
  | "deshacer-asignacion"
  | null;

async function mensajerosFetcher() {
  const res = await listarMensajerosParaAsignacion();
  if (res.status !== "ok") throw new Error(res.status);
  // `bloqueadosIds` = mensajeros con cierre abierto. El bloqueo del CHECKBOX se sigue
  // derivando por ZONA de la orden (`zonasBloqueadasFetcher`); estos ids alimentan el
  // SELECTOR de los modales de asignación, para no ofrecer a alguien a quien el service
  // va a rechazar. La key SWR "ordenes:mensajeros" la comparte OrdenesRevisionMaestro,
  // así que ambos fetchers deben devolver la MISMA forma.
  return {
    mensajeros: res.mensajeros,
    bloqueadosIds: res.bloqueadosIds ?? [],
    // Feature 157 (regla de dedicación): las dos caras de "repartir y recolectar no se
    // mezclan". Ambos fetchers comparten la key SWR, así que devuelven la MISMA forma.
    conRepartoIds: res.conRepartoIds ?? [],
    conRecoleccionIds: res.conRecoleccionIds ?? [],
  };
}

/**
 * Zonas (central GAM y satélites, misma regla) con AL MENOS 1 mensajero con un cierre
 * abierto (`solicitado`/`vencido`). Alimenta el bloqueo POR ORDEN del checkbox en las
 * órdenes cuya acción por lote asigna/rutea: mientras la zona de la orden esté
 * bloqueada no se le puede asignar mensajero, así que no se deja seleccionar.
 */
async function zonasBloqueadasFetcher(): Promise<Set<string>> {
  const res = await listarZonasBloqueadasPorCierre();
  if (res.status !== "ok") throw new Error(res.status);
  return new Set(res.zonasBloqueadasIds);
}

// Feature 63/C3 (F1.4-c): `exclude` es por `value` del estado; default
// `["pendiente"]` (borrador transitorio recién sembrado). El backend NO recibe
// `exclude`: `listarOrderStatus()` devuelve el catálogo COMPLETO (R1) y el front
// filtra antes de construir las opciones del filtro (aclaración del humano, R14).
const DEFAULT_EXCLUDE = ["pendiente"];

/**
 * Values que el código RECONOCE hoy. La tabla `order_status` conserva values ya
 * RETIRADOS del seed: su migración de retiro solo borra la fila si nadie la referencia,
 * y el historial pasado —inmutable— la referencia para siempre (caso del estado interno
 * de fulfillment en bodega, retirado por la feature 155). Esa fila sobrevive huérfana y
 * ninguna orden viva puede volver a tenerla, así que ofrecerla como filtro es ofrecer un
 * estado que nunca devuelve nada. El catálogo de la BD manda sobre los ids;
 * `ORDER_STATUS_SEED` manda sobre QUÉ existe.
 */
const VALUES_VIGENTES: ReadonlySet<string> = new Set(ORDER_STATUS_SEED);

// Estado cuyo listado muestra ademas "Liberada el" (la fecha para la que quedo
// reprogramada = el dia en que el cron de liberacion la desbloquea, feature 46).
const ESTADO_REPROGRAMADA = "reprogramada";

// Feature 139/R9: `rechazada` YA NO ofrece salida manual ("Devolver a la tienda" se
// retiró). Su única salida es la APROBACIÓN DEL CIERRE (backend), que la deja en
// `por_devolver` (satélite) o `por_devolver_a_tienda` (central): espera pasiva, sin
// acción por lote.

// Feature 100/T4.2: estado que ofrece "Recuperar a bodega"
// (devuelta -> en_bodega_central). La ejecuta la bodega RESPONSABLE: para maestro/admin
// eso es SOLO la bodega central (zonaEsGam). Las devueltas de zona satélite las recupera
// el adminSatelite de la zona (en /recepcion-satelite), así que su check se bloquea en
// vez de dejar seleccionarlas y vaciar el modal (R15).
const ESTADO_DEVUELTA = "devuelta";
const MOTIVO_DEVUELTA_NO_CENTRAL =
  "Orden de zona satélite: la recupera el admin de la bodega satélite de su zona.";

// Feature 101/R8/R10: único estado que resalta las órdenes prioritarias (liberadas por
// el SLA de la 99). Es la superficie de reasignación de la bodega central; el resalte
// se activa solo cuando el filtro está acotado EXACTAMENTE a este estado, de modo que
// el resto de vistas (otros estados, listado sin filtro) no resalta por prioridad (R10).
const ESTADO_EN_BODEGA = "en_bodega_central";

// Estados cuya acción por lote ASIGNA mensajero: ahí el checkbox se bloquea POR
// ORDEN si la zona de esa orden tiene ≥1 mensajero con cierre abierto.
// Feature 156/R28: el único apartado que asigna por lote es la BODEGA CENTRAL
// ("Asignar mensajero"). `en_preparacion` salió del conjunto porque su acción
// ("Generar guía") ya no decide mensajero: solo numera y mueve a la bodega central,
// así que un cierre abierto en la zona no impide numerar.
// Los estados que solo imprimen etiquetas (`por_recoger`,
// `en_ruta_bodega_satelite`) NO se bloquean: no asignan nada.
// Nota: en `en_bodega_central` el bloqueo también alcanza a "Imprimir etiquetas"
// (comparte el checkbox); es el precio de una única columna de selección.
const ESTADOS_ASIGNACION = new Set(["en_bodega_central"]);
const MOTIVO_ZONA_CIERRE_ABIERTO =
  "La bodega de esta zona tiene al menos un cierre de mensajero abierto: resuélvelo para poder asignar la orden.";

// Motivo del bloqueo del checkbox en órdenes cuyo estado no tiene ninguna acción por
// lote (p. ej. `rechazada`, `entregada`): con una sola tabla para todos los estados,
// marcarlas no llevaría a ninguna acción, así que se bloquean y se explica por qué.
const MOTIVO_SIN_ACCIONES =
  "Este estado no tiene acciones por lote disponibles.";

/** Etiqueta legible del estado; cae al `value` crudo si no hay label conocido. */
function labelDe(value: string): string {
  return (ORDER_STATUS_LABELS as Record<string, string>)[value] ?? value;
}

async function catalogoFetcher(): Promise<OrderStatusLiteRow[]> {
  const res = await listarOrderStatus();
  if (res.status !== "ok") return [];
  return res.estatus;
}

/**
 * Listado de órdenes de `/ordenes` para roles ≠ mensajero: UNA tabla normal
 * (`OrdenesModule`) más un filtro de SELECCIÓN MÚLTIPLE por estado. Sustituye a las
 * tabs por estado: el filtro se deriva del mismo catálogo `order_status` (SWR sobre
 * `listarOrderStatus()`) menos `exclude` (R14), pero permite combinar varios estados
 * en una sola vista en vez de forzar una tab por estado.
 *
 * Sin estados marcados, el listado NO filtra (equivale a la antigua tab "Todas").
 * Con estados marcados, se envía `filter.status_id` como LISTA y el backend resuelve
 * `IN (...)`; la caché y la paginación de SWR son por combinación de estados.
 *
 * Acciones por lote: como una misma tabla puede mezclar estados, las acciones se
 * derivan de la SELECCIÓN (intersección de las acciones de los estados marcados), no
 * de una tab activa. Las filas cuyo estado no tiene acción por lote no son
 * seleccionables (checkbox bloqueado con su motivo).
 */
export function OrdenesListado({
  exclude = DEFAULT_EXCLUDE,
  puedeCargarMasiva = false,
  puedeEscanearQr = false,
  puedeRecibirBodegaCentral = false,
  mostrarHistorial = false,
  accionesLote = false,
  catalogoFiltros = null,
  incluirFiltroTienda = true,
  incluirFiltroReasignables = true,
  permitirDescarga = true,
  puedeReportarIncidente = false,
}: Readonly<{
  exclude?: string[];
  puedeCargarMasiva?: boolean;
  /**
   * Ofrece "Escanear con cámara" junto a la carga masiva: el adminTienda escanea el
   * QR de la etiqueta de una orden que vuelve ("En ruta a origen") y la marca como
   * recibida en su tienda (`devolviendo_a_tienda` -> `devuelta_a_tienda`), sin salir del
   * listado. NO navega (para eso está `/qr`).
   */
  puedeEscanearQr?: boolean;
  /**
   * Feature 138 (R12/R16): ofrece el receptor de la BODEGA CENTRAL (escaneo por
   * cámara + entrada manual de guía) en el encabezado, junto al resto de acciones a
   * nivel del contenedor. Cierra el callejón `en_ruta_bodega_central` transicionando
   * a `en_bodega_central`. Solo para maestro/admin (`esAccesoTotal`); el service
   * revalida server-side. `adminTienda` y otros roles NO lo reciben.
   */
  puedeRecibirBodegaCentral?: boolean;
  mostrarHistorial?: boolean;
  /**
   * Habilita la selección por checkbox + barra de acciones por lote (asignar
   * mensajero, generar guía, imprimir etiquetas, enviar a la tienda, recuperar a
   * bodega). Solo para roles de acceso total (`maestro`/`admin`); `adminTienda` lo
   * recibe en `false`.
   */
  accionesLote?: boolean;
  /**
   * Feature 144 (R47/R64): catálogo de los filtros (zonas, cuentas tienda y
   * geografía) resuelto EN EL SERVIDOR durante la carga de la página y bajado por
   * props, de modo que los filtros están operativos sin una petición posterior ni
   * una consulta por cada selección. `null` = no se pudo resolver: la barra se monta
   * DESHABILITADA y el listado sigue funcionando sin esos filtros (R64).
   */
  catalogoFiltros?: CatalogoFiltrosOrdenesDTO | null;
  /**
   * Feature 144 (R62): declara el filtro de tienda. Los roles acotados a su propia
   * tienda (`adminTienda`) NO lo reciben: filtrar por tienda no les añade nada y el
   * backend pisa cualquier `tienda_id` con la suya.
   */
  incluirFiltroTienda?: boolean;
  /**
   * Declara el interruptor "Reasignables" (prioridad + no reprogramada + sin
   * mensajero). Es un filtro de despacho: solo sirve a quien reasigna mensajeros
   * (`maestro`/`admin`). `adminTienda` lo recibe en `false`.
   */
  incluirFiltroReasignables?: boolean;
  /**
   * Feature 151 (R33): ofrece la descarga del dataset COMPLETO acotado a los filtros
   * vigentes de la barra. Por defecto `true`: ésta ES la superficie del listado de
   * órdenes, y quien ve el listado descarga lo que ese listado ya le muestra (gate P5;
   * el acotamiento por rol lo impone el mismo servicio). Se deja como prop para poder
   * apagarla en una superficie concreta sin tocar el módulo.
   */
  permitirDescarga?: boolean;
  /**
   * Feature 158 (T2.7, Q-H): ofrece la acción POR FILA "Reportar incidente" en el listado.
   * Se pasa tal cual a `OrdenesModule`, que la monta sólo en las filas cuyo estado admite el
   * reporte. Es una acción por ORDEN, no por lote: no entra en `accionesDe`.
   */
  puedeReportarIncidente?: boolean;
}>) {
  const { mutate } = useSWRConfig();
  const { data: catalogo, isLoading } = useSWR(
    "order-status:catalogo",
    catalogoFetcher,
  );

  // Mensajeros para los modales de asignación (solo si hay acciones por lote).
  const { data: mensajerosData } = useSWR(
    accionesLote ? "ordenes:mensajeros" : null,
    mensajerosFetcher,
  );
  const mensajeros = mensajerosData?.mensajeros;
  // Feature 157: los bloqueados por cierre SÍ se usan aquí — el selector de la recolección
  // los deshabilita para no ofrecer a alguien a quien el service va a rechazar.
  const mensajerosBloqueadosIds = mensajerosData?.bloqueadosIds ?? [];
  // Feature 157 (regla de dedicación): las dos caras de "repartir y recolectar no se
  // mezclan". Cada modal deshabilita la suya, con el motivo a la vista.
  const mensajerosConRepartoIds = mensajerosData?.conRepartoIds ?? [];
  const mensajerosConRecoleccionIds = mensajerosData?.conRecoleccionIds ?? [];

  // Zonas bloqueadas por cierre (≥1 mensajero con cierre abierto), central y satélites
  // por igual. Solo se pide si hay acciones por lote (sin checkbox no hay qué bloquear).
  const { data: zonasBloqueadas } = useSWR(
    accionesLote ? "ordenes:zonas-bloqueadas" : null,
    zonasBloqueadasFetcher,
  );

  const [modalAbierto, setModalAbierto] = useState<ModalAbierto>(null);
  const [ordenesSeleccionadas, setOrdenesSeleccionadas] = useState<
    OrdenListItemDTO[]
  >([]);

  function abrirGenerarGuia(seleccionadas: OrdenListItemDTO[]) {
    setOrdenesSeleccionadas(seleccionadas);
    setModalAbierto("generar-guia");
  }
  function abrirAsignarBodega(seleccionadas: OrdenListItemDTO[]) {
    setOrdenesSeleccionadas(seleccionadas);
    setModalAbierto("asignar-bodega");
  }
  // Feature 157: quien va a la tienda a recoger el lote.
  function abrirAsignarRecoleccion(seleccionadas: OrdenListItemDTO[]) {
    setOrdenesSeleccionadas(seleccionadas);
    setModalAbierto("asignar-recoleccion");
  }
  function abrirEtiquetas(seleccionadas: OrdenListItemDTO[]) {
    setOrdenesSeleccionadas(seleccionadas);
    setModalAbierto("etiquetas");
  }
  // Feature 139/R15: "Enviar a la tienda" desde `por_devolver_a_tienda`
  // (`por_devolver_a_tienda → devolviendo_a_tienda`). La autz es maestro/admin central
  // DIRECTA (no por zona): estas órdenes están, por construcción, físicamente en la
  // central (las de zona satélite llegan aquí solo tras la recepción central), así que
  // NO se filtra por `zonaEsGam`. El backend revalida (rol central).
  function abrirEnviarTienda(seleccionadas: OrdenListItemDTO[]) {
    setOrdenesSeleccionadas(seleccionadas);
    setModalAbierto("devolver-tienda");
  }
  // "Recuperar a bodega" (feature 100) solo aplica a órdenes `devuelta` de la bodega
  // CENTRAL (`zonaEsGam === true`); se filtra antes de abrir (el backend revalida, R15).
  function abrirRecuperar(seleccionadas: OrdenListItemDTO[]) {
    setOrdenesSeleccionadas(seleccionadas.filter((o) => o.zonaEsGam === true));
    setModalAbierto("recuperar-bodega");
  }
  // Feature 149/T6.2 (R34): "Deshacer asignación" sobre el lote seleccionado
  // (`por_recoger` o `en_ruta_bodega_satelite`). SIN filtro por zona: el maestro/admin
  // (`esAccesoTotal`) deshace órdenes de CUALQUIER zona (R3); el service revalida.
  function abrirDeshacer(seleccionadas: OrdenListItemDTO[]) {
    setOrdenesSeleccionadas(seleccionadas);
    setModalAbierto("deshacer-asignacion");
  }

  // Revalida el listado (todas sus combinaciones de estado/página comparten el
  // prefijo de key SWR).
  function revalidarTablas() {
    void mutate(
      (key) => Array.isArray(key) && key[0] === "ordenes:list",
      undefined,
      { revalidate: true },
    );
  }

  // Cierre de los modales de acción (generar-guía / asignar / devolver): vuelve a
  // "sin modal". EXCEPCIÓN (feature 95): tras un éxito de guía/asignación,
  // `encadenarEtiquetas` ya dejó `modalAbierto="etiquetas"` y el Modal de origen,
  // por su `closeOnConfirm` por defecto, dispara este `onOpenChange(false)` JUSTO
  // DESPUÉS del `onSuccess`. Si lo limpiara, mataría el encadenado; por eso, si el
  // estado ya es "etiquetas", se respeta. El propio modal de etiquetas cierra con
  // `cerrarEtiquetas`, no con esta función, así que no colisiona con la guarda.
  function cerrarModal(open: boolean) {
    if (!open) setModalAbierto((prev) => (prev === "etiquetas" ? prev : null));
  }

  // Cierre del modal de etiquetas (fin del flujo encadenado, feature 95): SIEMPRE
  // limpia y NO re-encadena. Es una función aparte justamente para poder cerrar
  // "etiquetas" sin chocar con la guarda de `cerrarModal`.
  function cerrarEtiquetas(open: boolean) {
    if (!open) setModalAbierto(null);
  }

  // Éxito de una acción por lote que NO encadena (devolver a tienda; escaneo de
  // recepción): cierra y revalida.
  function handleSuccess() {
    setModalAbierto(null);
    revalidarTablas();
  }

  // Feature 95: éxito de "Generar guía" / "Asignar mensajero" → revalida las tablas
  // (num_guia/estado recién asignados) Y encadena la vista previa + descarga de las
  // etiquetas del MISMO lote (`ordenesSeleccionadas`), en vez de solo cerrar.
  function encadenarEtiquetas() {
    revalidarTablas();
    setModalAbierto("etiquetas");
  }

  // Mapeo estado -> acciones por lote.
  // Nota: "Rutear a bodega satélite" NO se ofrece en esta vista (se retiró de
  // `en_bodega_central` por decisión humana). La vista legacy OrdenesRevisionMaestro sí la
  // ofrece, así que la paridad con esa vista ya no es total.
  function accionesDe(estatusValue: string | undefined): AccionLote[] {
    switch (estatusValue) {
      // Feature 155/R32: el estado interno de fulfillment en bodega salió del
      // catálogo y con él su `case`. `en_preparacion` queda como único origen de
      // "Generar guía"; un value fuera del catálogo cae al `default` (sin acciones
      // por lote), que es la degradación segura.
      // Feature 157: el paquete sigue EN LA TIENDA. La accion es decidir QUIEN va a
      // recogerlo; la orden no cambia de estado hasta que ese mensajero lo confirme
      // escaneando. Nacen con `num_guia` (feature 155), asi que la etiqueta ya existe.
      case "por_recolectar_en_tienda":
        return [
          {
            key: "asignar-recoleccion",
            label: "Asignar mensajero para recolección",
            onRun: abrirAsignarRecoleccion,
          },
          {
            key: "etiquetas",
            label: "Imprimir etiquetas",
            variant: "outline",
            onRun: abrirEtiquetas,
          },
        ];
      case "en_preparacion":
        return [{ key: "guia", label: "Generar guía", onRun: abrirGenerarGuia }];
      case "por_recoger":
        // Feature 149/R34: caso (a) — la orden sigue en la bodega, sin recoger.
        return [
          { key: "etiquetas", label: "Imprimir etiquetas", onRun: abrirEtiquetas },
          {
            key: "deshacer",
            label: "Deshacer asignación",
            variant: "outline",
            onRun: abrirDeshacer,
          },
        ];
      case "en_bodega_central":
        return [
          {
            key: "asignar",
            label: "Asignar mensajero",
            onRun: abrirAsignarBodega,
          },
          {
            key: "etiquetas",
            label: "Imprimir etiquetas",
            variant: "outline",
            onRun: abrirEtiquetas,
          },
        ];
      case "en_ruta_bodega_satelite":
        // Feature 149/R34: caso (b) — ruteada a la satélite pero aún NO recibida. Solo la
        // ofrece esta superficie (maestro/admin): la satélite no la ve (R36).
        return [
          { key: "etiquetas", label: "Imprimir etiquetas", onRun: abrirEtiquetas },
          {
            key: "deshacer",
            label: "Deshacer asignación",
            variant: "outline",
            onRun: abrirDeshacer,
          },
        ];
      case "por_devolver_a_tienda":
        // Feature 139/R15: envío por lote a la tienda de origen
        // (por_devolver_a_tienda -> devolviendo_a_tienda). Reusa el modal
        // `DevolverATiendaModal` (relabelado) + la Server Action `devolverATienda`.
        return [
          {
            key: "enviar-tienda",
            label: "Enviar a la tienda",
            onRun: abrirEnviarTienda,
          },
        ];
      case "devuelta":
        // Feature 100/T4.2 (R12): recuperar a bodega las devueltas de la zona central.
        return [
          { key: "recuperar", label: "Recuperar a bodega", onRun: abrirRecuperar },
        ];
      default:
        return [];
    }
  }

  // R14: opciones del filtro = catálogo − retirados − exclude (por value), en el orden
  // determinista del catálogo (R5). Se filtra en el front.
  const estadosDisponibles = useMemo<OrderStatusLiteRow[]>(
    () =>
      (catalogo ?? []).filter(
        (s) => VALUES_VIGENTES.has(s.value) && !exclude.includes(s.value),
      ),
    [catalogo, exclude],
  );

  // Feature 144: selección agregada de la barra genérica (estado, zona, tienda,
  // geografía y tiempo). El componente es dueño de su estado; aquí solo se guarda lo
  // emitido.
  const [seleccionFiltros, setSeleccionFiltros] = useState<FilterSelection>({});

  // Ids marcados en el filtro de estado. Vacío = sin filtro (todas las órdenes). Ya no
  // es un estado aparte: el estado es UN filtro más de la barra (misma clave que el
  // `filter` del backend), así que sale de la selección agregada.
  const estadosMarcados = seleccionFiltros[CLAVE_ESTADO] ?? [];

  const opciones = useMemo(
    () =>
      estadosDisponibles.map((s) => ({ value: s.id, label: labelDe(s.value) })),
    [estadosDisponibles],
  );

  // R55/R56: las declaraciones de la barra salen del catálogo precargado (más la de
  // estado, que sale del catálogo de estatus). Sin catálogo geográfico se declaran
  // igual, pero sin opciones y deshabilitadas (R64): la tabla sigue viva.
  const filtrosBarra = useMemo<FilterDef[]>(
    () => [
      // El estado va parametrizado como un filtro más, no por fuera: mismo control,
      // misma limpieza y misma salida agregada que zona, tienda o geografía.
      {
        key: CLAVE_ESTADO,
        label: "Estado",
        kind: "multi",
        placeholder: "Todos",
        searchPlaceholder: "Filtrar estados…",
        emptyMessage: "Ningún estado coincide",
        options: opciones,
      },
      // R64: si el catálogo geográfico no cargó, se deshabilitan SUS filtros; el de
      // estado viene de otra fuente y sigue operativo.
      ...construirFiltrosOrdenes(catalogoFiltros ?? CATALOGO_FILTROS_VACIO, {
        incluirTienda: incluirFiltroTienda,
        incluirReasignables: incluirFiltroReasignables,
      }).map((f) => (catalogoFiltros === null ? { ...f, disabled: true } : f)),
    ],
    [catalogoFiltros, incluirFiltroTienda, incluirFiltroReasignables, opciones],
  );

  // R46/R58/R59: `status_id` (feature 63) y los filtros nuevos se funden en UN solo
  // `filter`. Sin nada seleccionado, el objeto queda vacío y se envía `undefined`, de
  // modo que la entrada de `listarOrdenes` es IDÉNTICA a la previa a esta feature.
  const filter = useMemo<OrdenesFilterUI | undefined>(() => {
    const compuesto: OrdenesFilterUI = seleccionAFilter(seleccionFiltros);
    return Object.keys(compuesto).length > 0 ? compuesto : undefined;
  }, [seleccionFiltros]);

  // Si el filtro está acotado a EXACTAMENTE un estado, ese estado decide las columnas
  // ("Liberada el") y el resalte de prioridad. Con varios estados mezclados —o sin
  // filtro— no hay un estado que mande, así que se usan las columnas por defecto y no
  // se resalta.
  const valueUnico =
    estadosMarcados.length === 1
      ? estadosDisponibles.find((s) => s.id === estadosMarcados[0])?.value
      : undefined;

  let columns: Column<OrdenListItemDTO>[] | undefined;
  if (valueUnico === ESTADO_REPROGRAMADA) {
    columns = ordenesColumnsReprogramada;
  }

  /**
   * ¿Se monta la columna de checkbox? Solo si alguna orden de la página está en un
   * estado con acción por lote. Filtrado a estados de solo lectura (p. ej. `rechazada`)
   * la tabla queda limpia, sin una columna de casillas inertes.
   */
  function haySeleccionables(items: OrdenListItemDTO[]): boolean {
    return items.some((row) => accionesDe(row.estatusValue).length > 0);
  }

  /**
   * Bloqueo del checkbox POR FILA (reglas que conviven, ahora derivadas del estado de
   * la ORDEN y no de una tab activa):
   * - estado sin acciones por lote: no hay a dónde llevar la selección (la columna
   *   existe porque otras filas de la página sí la tienen).
   * - `devuelta`: solo las de la bodega central (las satélite las recupera el adminSatelite).
   * - estados de asignación: si la ZONA de esa orden tiene ≥1 mensajero con cierre abierto.
   * Nota (139/R15): `por_devolver_a_tienda` NO se bloquea por zona: su acción "Enviar a la
   * tienda" es maestro/admin central directa y estas órdenes están siempre físicamente en
   * la central (incluidas las de origen satélite ya recibidas).
   */
  function bloqueoSeleccion(row: OrdenListItemDTO): string | null {
    const value = row.estatusValue;
    if (accionesDe(value).length === 0) return MOTIVO_SIN_ACCIONES;
    if (value === ESTADO_DEVUELTA) {
      return row.zonaEsGam === true ? null : MOTIVO_DEVUELTA_NO_CENTRAL;
    }
    if (value && ESTADOS_ASIGNACION.has(value)) {
      // Sin datos aún (SWR en vuelo) o sin `zonaId` utilizable: NO se bloquea. No se
      // puede AFIRMAR que la zona esté bloqueada, y el backend revalida la regla al
      // ejecutar la acción (defensa en profundidad); bloquear "por si acaso"
      // castigaría órdenes válidas.
      if (!zonasBloqueadas || !row.zonaId) return null;
      return zonasBloqueadas.has(row.zonaId) ? MOTIVO_ZONA_CIERRE_ABIERTO : null;
    }
    return null;
  }

  /**
   * Acciones ofrecidas para la selección actual = UNIÓN (por `key`) de las acciones de
   * los estados presentes, cada una acotada al SUBCONJUNTO de órdenes al que aplica.
   *
   * Antes era la INTERSECCIÓN, y eso dejaba la barra vacía en el caso más natural: marcar
   * "seleccionar todo" sobre una página con estados mezclados no ofrecía NADA, porque casi
   * ningún par de estados comparte acción. El usuario veía todo marcado y ningún botón.
   *
   * Con la unión, cada acción se ejecuta solo sobre las filas que la admiten —el resto ni
   * se toca— y el botón lo dice: cuando no alcanza a toda la selección, lleva el conteo
   * ("Generar guía (5)"). Con un solo estado no hay conteo, porque no hay nada que aclarar.
   *
   * El orden es el de aparición: primero las acciones del primer estado encontrado. Así la
   * barra no baila entre renders aunque cambie la selección.
   */
  function accionesPara(seleccionadas: OrdenListItemDTO[]): AccionLote[] {
    if (seleccionadas.length === 0) return [];

    const porKey = new Map<
      string,
      { accion: AccionLote; ordenes: OrdenListItemDTO[] }
    >();
    for (const orden of seleccionadas) {
      for (const accion of accionesDe(orden.estatusValue)) {
        const entrada = porKey.get(accion.key);
        if (entrada) entrada.ordenes.push(orden);
        else porKey.set(accion.key, { accion, ordenes: [orden] });
      }
    }

    return [...porKey.values()].map(({ accion, ordenes }) => {
      const parcial = ordenes.length < seleccionadas.length;
      return {
        ...accion,
        label: parcial ? `${accion.label} (${ordenes.length})` : accion.label,
        // Se ignora lo que la barra pasa (la selección entera) y se usa el subconjunto
        // elegible: es lo que hace que la acción no descarte filas en silencio ni falle.
        onRun: () => accion.onRun(ordenes),
      };
    });
  }

  // La carga masiva y los escáneres viven a nivel del contenedor (no dependen del
  // filtro): son acciones independientes del estado. La carga masiva y la recepción en
  // origen se ofrecen al adminTienda (feature 26); la recepción en bodega central
  // (feature 138) al maestro/admin. `onRecibida={handleSuccess}` revalida el listado
  // (R14), de modo que la orden recibida refleja su nuevo estado.
  //
  // El receptor es una TARJETA (cámara + número de guía), demasiado alta para vivir
  // desplegada encima de la tabla: se abre desde la barra de acciones y se cierra
  // igual. Quien no puede recibir no ve ni el botón.
  // El receptor y su disparador viven a la IZQUIERDA, donde empieza la lectura de la
  // pagina; la carga masiva sigue a la derecha de la misma fila. El disparador despliega
  // la tarjeta con animacion y la desmonta al cerrar (apaga la camara).
  const header =
    puedeCargarMasiva || puedeEscanearQr || puedeRecibirBodegaCentral ? (
      puedeEscanearQr || puedeRecibirBodegaCentral ? (
        <ReceptorDesplegable
          acciones={puedeCargarMasiva ? <OrdenesCargaMasivaButton /> : null}
        >
          {puedeRecibirBodegaCentral ? (
            <EscanerRecepcionBodegaCentral onRecibida={handleSuccess} />
          ) : null}
          {puedeEscanearQr ? (
            <EscanerRecepcionOrigen onRecibida={handleSuccess} />
          ) : null}
        </ReceptorDesplegable>
      ) : (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <OrdenesCargaMasivaButton />
        </div>
      )
    ) : null;

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <Skeleton className="h-40 w-full" data-testid="ordenes-listado-loading" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {header}

      {/* Feature 144 (R55, R63): barra genérica con TODOS los filtros declarados —
          estado incluido (siete; seis sin tienda). Toda la lógica de selección,
          búsqueda, acotamiento, agrupado, exclusión mutua y poda vive en el
          componente; aquí solo se declara y se traduce lo emitido. */}
      <FilterComponent
        filters={filtrosBarra}
        onChange={setSeleccionFiltros}
        showClearAll
      />

      <OrdenesModule
        filter={filter}
        columns={columns}
        mostrarHistorial={mostrarHistorial}
        selectable={accionesLote ? haySeleccionables : false}
        bloqueoSeleccion={accionesLote ? bloqueoSeleccion : undefined}
        acciones={accionesLote ? accionesPara : undefined}
        resaltarPrioridad={valueUnico === ESTADO_EN_BODEGA}
        permitirDescarga={permitirDescarga}
        puedeReportarIncidente={puedeReportarIncidente}
      />

      {/* Modales de acción por lote (solo acceso total). Montados una vez; `open` por
          `modalAbierto`. */}
      {accionesLote ? (
        <>
          {/* Feature 156/R30: "Generar guía" NO requiere la lista de mensajeros
              (ya no asigna); el `useSWR` de mensajeros sigue existiendo solo para
              `AsignarBodegaModal`. */}
          <GenerarGuiaModal
            open={modalAbierto === "generar-guia"}
            ordenes={ordenesSeleccionadas}
            onOpenChange={cerrarModal}
            onSuccess={encadenarEtiquetas}
          />
          {/* Feature 157: NO se le aplica el bloqueo por zona con cierre abierto que sí
              guarda a `AsignarBodegaModal`. Esa regla protege la asignación de reparto,
              atada a la zona de ENTREGA de la orden; una recolección la puede hacer
              cualquier mensajero (decisión del humano), así que su zona no dice nada. El
              cierre del mensajero ELEGIDO sí se respeta: lo revalida el service, y aquí
              se le deshabilita en el selector. */}
          <AsignarRecoleccionModal
            open={modalAbierto === "asignar-recoleccion"}
            ordenes={ordenesSeleccionadas}
            mensajeros={mensajeros ?? []}
            mensajerosBloqueadosIds={mensajerosBloqueadosIds}
            mensajerosConRepartoIds={mensajerosConRepartoIds}
            onOpenChange={cerrarModal}
            onSuccess={handleSuccess}
          />
          <AsignarBodegaModal
            open={modalAbierto === "asignar-bodega"}
            ordenes={ordenesSeleccionadas}
            mensajeros={mensajeros ?? []}
            mensajerosConRecoleccionIds={mensajerosConRecoleccionIds}
            onOpenChange={cerrarModal}
            onSuccess={encadenarEtiquetas}
          />
          <EtiquetasGuiaModal
            open={modalAbierto === "etiquetas"}
            ordenes={ordenesSeleccionadas}
            onOpenChange={cerrarEtiquetas}
          />
          <DevolverATiendaModal
            open={modalAbierto === "devolver-tienda"}
            ordenes={ordenesSeleccionadas}
            onOpenChange={cerrarModal}
            onSuccess={handleSuccess}
          />
          <RecuperarABodegaModal
            open={modalAbierto === "recuperar-bodega"}
            ordenes={ordenesSeleccionadas}
            onOpenChange={cerrarModal}
            onSuccess={handleSuccess}
          />
          {/* Feature 149/T6.2 (R38): éxito ⇒ `handleSuccess` cierra y revalida las tablas,
              de modo que las órdenes revertidas desaparecen de `por_recoger` /
              `en_ruta_bodega_satelite` y aparecen en su bodega. */}
          <DeshacerAsignacionModal
            open={modalAbierto === "deshacer-asignacion"}
            ordenes={ordenesSeleccionadas}
            onOpenChange={cerrarModal}
            onSuccess={handleSuccess}
          />
        </>
      ) : null}
    </div>
  );
}
