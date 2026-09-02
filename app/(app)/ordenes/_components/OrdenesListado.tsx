"use client";

import { useMemo, useState } from "react";
import useSWR, { useSWRConfig } from "swr";

import {
  BOOLEAN_MARCADO,
  FilterComponent,
  type FilterDef,
  type FilterSelection,
} from "@/components/shared/FilterComponent";
import { BuscadorFiltros } from "@/components/shared/BuscadorFiltros";
import { SegmentedToggle } from "@/components/shared/SegmentedToggle";
import { BLOQUEO_SIN_AVISO } from "@/components/shared/CeldaSeleccion";
import { Skeleton } from "@/components/ui/skeleton";
import type { CatalogoFiltrosOrdenesDTO } from "@/lib/types/filtros-ordenes";
import type { OrderStatusLiteRow } from "@/lib/interfaces/repositories/IOrdenRepository";
import { listarOrderStatus } from "@/lib/actions/order-status";
import { listarMensajerosParaAsignacion } from "@/lib/actions/ordenes-guia";
import type { Column } from "@/components/shared/DataTable";
import { EscanerModal } from "@/components/shared/EscanerModal";
import { BUSQUEDA_MIN_CHARS, type OrdenListItemDTO } from "@/lib/types/orden";
import type { FechasDiaReparto } from "@/lib/utils/dia-reparto-textos";
import type { DireccionOrden } from "@/lib/types/ordenamiento-listado";

import { OrdenesModule, type AccionLote } from "./OrdenesModule";
import { OrdenesCargaMasivaButton } from "./OrdenesCargaMasivaButton";
import { EscanerRecepcionOrigen } from "./EscanerRecepcionOrigen";
import { EscanerRecepcionBodegaCentral } from "./EscanerRecepcionBodegaCentral";
import {
  ordenesColumnsReprogramada,
} from "./ordenes-columns";
import { GenerarGuiaModal } from "./GenerarGuiaModal";
import { AsignarBodegaModal } from "./AsignarBodegaModal";
import { AsignarRecoleccionModal } from "./AsignarRecoleccionModal";
import { QuitarRecoleccionModal } from "./QuitarRecoleccionModal";
import { RutearSateliteModal } from "./RutearSateliteModal";
import { EtiquetasGuiaModal } from "./EtiquetasGuiaModal";
import { DevolverATiendaModal } from "./DevolverATiendaModal";
import { RecuperarABodegaModal } from "./RecuperarABodegaModal";
import { DeshacerAsignacionModal } from "./DeshacerAsignacionModal";
import { EliminarOrdenModal } from "./EliminarOrdenModal";
import { RecuperarOrdenModal } from "./RecuperarOrdenModal";
import {
  CAMBIAR_DIA_ACCION,
  CambiarDiaRepartoModal,
} from "./CambiarDiaRepartoModal";
import {
  construirFiltrosOrdenes,
  CATALOGO_FILTROS_VACIO,
  CLAVE_BUSQUEDA,
  CLAVE_ELIMINADOS,
  CLAVE_ESTADO,
  PLACEHOLDER_BUSQUEDA,
} from "./ordenes-filtros-def";
import {
  DIRECCION_ORDEN_INICIAL,
  ETIQUETA_ORDEN_CREACION,
  OPCIONES_ORDEN_CREACION,
  ordenamientoCreacion,
} from "./ordenamiento-creacion";
// FICHA 355: el control de ESTADO se declara una sola vez y lo montan las dos superficies
// (aquí y la bodega satélite). Ver la cabecera de ese módulo.
import {
  EXCLUDE_ESTADO_DEFAULT,
  estadosOfrecidos,
  filtroEstado,
} from "./filtro-estado-def";
import { seleccionAFilter } from "./seleccion-a-filter";
import type { OrdenesFilterUI } from "./serializar-filtro";

type ModalAbierto =
  | "generar-guia"
  | "asignar-bodega"
  | "asignar-recoleccion" // feature 157
  | "quitar-recoleccion" // feature 157 (ampliacion)
  | "rutear-satelite" // feature 30 (reinstalado el 2026-08-05)
  | "etiquetas"
  | "devolver-tienda"
  | "recuperar-bodega"
  | "deshacer-asignacion"
  | "cambiar-dia-reparto" // feature 262
  | "eliminar" // feature «eliminar orden»
  | "recuperar-eliminada" // pedido humano 2026-08-27: la reversión del borrado
  | null;

async function mensajerosFetcher() {
  const res = await listarMensajerosParaAsignacion();
  if (res.status !== "ok") throw new Error(res.status);
  // ⚠️ FEATURE 271 (T9.4, R32) — `bloqueadosIds` VUELVE A MANDAR, sobre los DOS modales.
  //
  // El 2026-08-18 los cierres abiertos dejaron de bloquear la asignación y este campo se ignoraba
  // aquí a propósito. El 2026-08-23 el humano revirtió esa mitad de la regla: acumular dos cierres
  // —o arrastrar uno que espera a que el mensajero lo reenvíe— bloquea también recibir trabajo
  // nuevo, SIN distinguir reparto de recolección. Así que el conjunto vuelve a viajar a los dos
  // selectores, y es el MISMO que el servidor rechaza: no se re-deriva ni se recorta aquí.
  //
  // LO QUE SIGUE SIN VOLVER, y no es un olvido: el gate por ZONA del checkbox de la tabla. Aquel
  // bloqueaba órdenes por la zona de entrega, no mensajeros por su cierre; el servidor no lo
  // aplica y su sitio no es éste.
  //
  // La key SWR "ordenes:mensajeros" la compartía con la vista legacy
  // `OrdenesRevisionMaestro`, borrada el 2026-07-31: hoy este es el ÚNICO fetcher de esa
  // key. Se deja dicho porque la regla que lo motivó sigue en pie — quien añada otro
  // fetcher bajo la misma key debe devolver esta MISMA forma, o la caché servirá una
  // estructura distinta según quién monte primero (el bug de 2026-07-16).
  return {
    mensajeros: res.mensajeros,
    bloqueadosIds: res.bloqueadosIds ?? [],
    // Pedido humano 2026-08-26: los dados de baja (`inactivo`/`bloqueado`). Mismo trato que
    // `bloqueadosIds` —el conjunto que el servidor rechaza, sin recortar aquí— y por el mismo
    // motivo: el selector tiene que deshabilitar exactamente a quien la escritura va a negar.
    noAsignablesIds: res.noAsignablesIds ?? [],
    // Feature 157 (regla de dedicación): las dos caras de "repartir y recolectar no se
    // mezclan".
    conRepartoIds: res.conRepartoIds ?? [],
    conRecoleccionIds: res.conRecoleccionIds ?? [],
  };
}

// Feature 63/C3 (F1.4-c): `exclude` es por `value` del estado; default
// `["pendiente"]` (borrador transitorio recién sembrado). El backend NO recibe
// `exclude`: `listarOrderStatus()` devuelve el catálogo COMPLETO (R1) y el front
// filtra antes de construir las opciones del filtro (aclaración del humano, R14).
//
// FICHA 355: el valor por defecto vive ahora en `filtro-estado-def.ts`, junto al resto de
// la declaración del control, para que una superficie que lo monte sin pasar `exclude`
// obtenga exactamente lo mismo que maestro/admin.
const DEFAULT_EXCLUDE = [...EXCLUDE_ESTADO_DEFAULT];

/*
 * ── FICHA 355 (2026-09-02): AQUÍ VIVÍAN `VALUES_VIGENTES` Y EL DESPLEGABLE DE ESTADO ─────────
 *
 * El juego de values vigentes, el recorte «catálogo − retirados − exclude» y las seis líneas
 * que declaraban el control se mudan a `./filtro-estado-def.ts`. La central NO cambia de
 * comportamiento: monta la MISMA declaración, con los mismos textos y las mismas opciones.
 *
 * No es una mudanza por orden. La bodega satélite declaraba SU propio filtro de estado —cinco
 * opciones escritas a mano, con sus propias etiquetas («Recibidas» donde aquí dice «En bodega
 * satélite») y sus propios textos— y el humano puso las dos capturas lado a lado. Mientras el
 * control se declarara DENTRO de este componente, la otra superficie no tenía forma de montar
 * el mismo: sólo de copiarlo. El porqué entero está en la cabecera de ese módulo.
 */

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
// Feature 246 (T4.2): «no bajaron fechas de la página». Constante de módulo y no un literal en
// la desestructuración para no crear un objeto nuevo en cada render, que reventaría la
// memorización de cualquier hijo que llegue a compararlas.
const SIN_FECHAS_DIA_REPARTO: FechasDiaReparto = { hoy: "", manana: "" };

const ESTADO_DEVUELTA = "devuelta";
const MOTIVO_DEVUELTA_NO_CENTRAL =
  "Orden de zona satélite: la recupera el admin de la bodega satélite de su zona.";

// Feature 101/R8/R10: único estado que resalta las órdenes prioritarias (liberadas por
// el SLA de la 99). Es la superficie de reasignación de la bodega central; el resalte
// se activa solo cuando el filtro está acotado EXACTAMENTE a este estado, de modo que
// el resto de vistas (otros estados, listado sin filtro) no resalta por prioridad (R10).
const ESTADO_EN_BODEGA = "en_bodega_central";

/**
 * Estado sin acciones por lote: la fila se bloquea pero SIN aviso visible (pedido humano
 * 2026-08-19). El «!» se reservaba para explicar un impedimento; aquí no hay impedimento que
 * explicar, solo un estado que no participa, y repetirlo en media tabla era ruido.
 *
 * IDA Y VUELTA, y conviene que se lea entera: la feature «eliminar orden» (2026-08-26) RETIRÓ
 * esta regla, porque entonces "Eliminar" se ofrecía en cualquier estado y ninguna fila llevaba a
 * una barra vacía. El pedido humano del 2026-08-27 acotó el borrado a las órdenes SIN GESTIÓN, y
 * con eso la población de filas inertes volvió a existir —una `entregada` no se elimina— así que
 * la regla vuelve, ahora derivada de las DOS condiciones (ver `bloqueoSeleccion`).
 */
const MOTIVO_SIN_ACCIONES = BLOQUEO_SIN_AVISO;

// FICHA 355: aquí estaba `labelDe`, la tercera copia del mismo mapa de etiquetas. La
// declaración compartida usa `estatusLabel` (`./estatus-label`), que lee ese mismo
// `ORDER_STATUS_LABELS` y es lo que ya pinta el chip de la tabla.

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
  incluirFiltroMensajero = true,
  permitirDescarga = true,
  puedeReportarIncidente = false,
  puedeCorregirDatos = false,
  puedeEliminar = false,
  puedeVerEliminadas = false,
  fechasDiaReparto = SIN_FECHAS_DIA_REPARTO,
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
   * Declara el filtro por MENSAJERO asignado, encadenado a la zona (elegida una zona, sólo
   * ofrece a sus mensajeros). Es de despacho: lo reciben `maestro`/`admin`; `adminTienda` lo
   * recibe en `false` —no se le entrega el directorio de mensajeros—.
   */
  incluirFiltroMensajero?: boolean;
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
  /**
   * Ficha 312 (E2, design §9.1): ofrece la acción POR FILA "Corregir datos" en el listado. Se
   * pasa tal cual a `OrdenesModule`, que la monta sólo en las filas cuyo estado admite la
   * corrección (R22/R24). Es una acción por ORDEN, no por lote: un lote no tiene un
   * «destinatario» común, así que no entra en `accionesDe`.
   *
   * La enciende la página sólo para `maestro`/`admin`; el `adminTienda` corrige desde las cards
   * de `/novedades` y por eso NO recibe la prop. El servidor revalida rol, pertenencia y estado
   * en cada petición (R25), así que esto decide qué se OFRECE, nunca qué se permite.
   */
  puedeCorregirDatos?: boolean;
  /**
   * Pedido humano (2026-08-27): ofrece ELIMINAR órdenes.
   *
   * Prop propia y no `accionesLote` (que es maestro Y admin) porque el `admin` NO puede borrar:
   * ese estrechamiento se decidió a propósito y sigue en pie. El servidor revalida el rol en la
   * Server Action, así que esta prop decide qué se OFRECE, nunca qué se permite.
   *
   * ⭑ FICHA 358 (2026-09-02): ya no es «sólo el maestro». También el `adminTienda`, acotado a
   * SUS órdenes — la misma regla que la tienda ya tenía por API key. Quién es «lo suyo» no lo
   * decide esta pantalla: lo decide el servidor fila a fila, en el campo `eliminable` del DTO,
   * que sólo viaja `true` sobre órdenes que ese actor puede borrar de verdad. Aquí sólo se
   * pregunta `row.eliminable === true`.
   *
   * ⚠️ Encender esto para un rol SIN `accionesLote` monta la columna de casillas para él. La
   * barra no se le llena de acciones de flujo: `accionesDe` devuelve vacío sin `accionesLote`
   * (ver su guarda), así que lo único que alcanza la selección es «Eliminar».
   */
  puedeEliminar?: boolean;
  /**
   * Pedido humano (2026-08-27), separado de `puedeEliminar` por la FICHA 358: el interruptor
   * «Eliminadas» de la barra —única forma de listar las borradas— y, con él, la acción
   * «Recuperar».
   *
   * SIGUE SIENDO SÓLO DEL `maestro`. Recuperar devuelve la orden a los listados de la tienda
   * dueña y del mensajero asignado, y `RecuperarOrdenService` corta por rol; además `listar`
   * responde `forbidden` —no una lista vacía— a quien pida el interruptor sin serlo. Ofrecérselo
   * a la tienda sería pintar un control que el servidor rechaza.
   */
  puedeVerEliminadas?: boolean;
  /**
   * Feature 246 (T4.2, R29): fechas calendario de «hoy» y «mañana» que la PÁGINA resolvió en el
   * servidor con el día de Costa Rica. Sólo se transportan: hasta `AsignarBodegaModal` (elegir
   * el día al asignar) y, desde la feature 262/F3, hasta `CambiarDiaRepartoModal` (corregirlo
   * después). Las DOS pantallas leen las mismas dos fechas, resueltas una sola vez arriba.
   *
   * POR QUÉ EL DEFECTO SON DOS CADENAS VACÍAS Y NO UNA FECHA CALCULADA AQUÍ: éste es un
   * componente de cliente, y cualquier valor que se inventara saldría del reloj del navegador —
   * lo único que R29 prohíbe. Sin fechas, el selector se lee igual («Hoy» / «Mañana») y sólo
   * pierde la precisión de la fecha; con una fecha inventada, mentiría. Se degrada, no se
   * falsea.
   */
  fechasDiaReparto?: FechasDiaReparto;
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
  // Feature 157 (regla de dedicación): las dos caras de "repartir y recolectar no se
  // mezclan". Cada modal deshabilita la suya, con el motivo a la vista.
  const mensajerosConRepartoIds = mensajerosData?.conRepartoIds ?? [];
  const mensajerosConRecoleccionIds = mensajerosData?.conRecoleccionIds ?? [];
  // FEATURE 271 (T9.4, R32): los bloqueados por cierres. UNA sola lista para los DOS modales —el
  // campo no se llama `bloqueadosParaRepartoIds` por eso—: desde el 2026-08-23 no hay asimetría
  // entre reparto y recolección, y el servidor aplica el mismo predicado en las dos escrituras.
  const mensajerosBloqueadosIds = mensajerosData?.bloqueadosIds ?? [];
  // 2026-08-26: los que no pueden recibir trabajo por su estado de usuario. Lista APARTE de la
  // anterior porque el motivo y la pantalla donde se arregla son otros, y los DOS modales la
  // reciben igual.
  const mensajerosNoAsignablesIds = mensajerosData?.noAsignablesIds ?? [];

  const [modalAbierto, setModalAbierto] = useState<ModalAbierto>(null);
  const [ordenesSeleccionadas, setOrdenesSeleccionadas] = useState<
    OrdenListItemDTO[]
  >([]);

  function abrirGenerarGuia(seleccionadas: OrdenListItemDTO[]) {
    setOrdenesSeleccionadas(seleccionadas);
    setModalAbierto("generar-guia");
  }
  // "Asignar mensajero" desde bodega solo aplica a órdenes GAM (`zonaEsGam === true`):
  // `asignarDesdeBodega` exige origen `en_bodega_central` + zona GAM (R27/R12) y un
  // mensajero de la zona CENTRAL, así que una orden satélite ahí sale `conflict`. Se
  // filtra el snapshot seleccionado antes de abrir, igual que hacen `abrirRutearSatelite`
  // (regla inversa) y `abrirRecuperar`; el service revalida (defensa en profundidad).
  function abrirAsignarBodega(seleccionadas: OrdenListItemDTO[]) {
    setOrdenesSeleccionadas(seleccionadas.filter((o) => o.zonaEsGam === true));
    setModalAbierto("asignar-bodega");
  }
  // Feature 157: quien va a la tienda a recoger el lote.
  function abrirAsignarRecoleccion(seleccionadas: OrdenListItemDTO[]) {
    setOrdenesSeleccionadas(seleccionadas);
    setModalAbierto("asignar-recoleccion");
  }
  // Feature 157 (ampliacion): devolverla al monton de asignables.
  function abrirQuitarRecoleccion(seleccionadas: OrdenListItemDTO[]) {
    setOrdenesSeleccionadas(seleccionadas);
    setModalAbierto("quitar-recoleccion");
  }
  // Feature 30/R13: "Rutear a bodega satélite" solo aplica a órdenes NO-GAM
  // (`zonaEsGam === false`): la GAM ya está en su bodega de destino. Se filtra el
  // snapshot seleccionado antes de abrir, igual que hace `abrirRecuperar` con la regla
  // inversa; el service revalida (defensa en profundidad, R17).
  function abrirRutearSatelite(seleccionadas: OrdenListItemDTO[]) {
    setOrdenesSeleccionadas(seleccionadas.filter((o) => o.zonaEsGam === false));
    setModalAbierto("rutear-satelite");
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
  // Feature 262/F3 (R13): "Cambiar día de reparto" sobre el lote seleccionado (`por_recoger`,
  // `en_reparto` o `ayuda_tienda`, los tres estados donde el día todavía decide algo). SIN
  // filtro por zona, igual que "Deshacer asignación": maestro/admin (`esAccesoTotal`) corrigen
  // órdenes de CUALQUIER zona (design §4.1); el service revalida.
  function abrirCambiarDia(seleccionadas: OrdenListItemDTO[]) {
    setOrdenesSeleccionadas(seleccionadas);
    setModalAbierto("cambiar-dia-reparto");
  }

  // Feature «eliminar orden»: retirar del sistema un registro creado por error. NO se filtra
  // el snapshot por estado ni por zona —a diferencia de `abrirRecuperar` / `abrirRutearSatelite`,
  // cuyas acciones sí tienen un estado de origen—: una orden se elimina esté donde esté. El
  // servidor revalida el ROL (maestro/admin), que es la única guardia real.
  function abrirEliminar(seleccionadas: OrdenListItemDTO[]) {
    setOrdenesSeleccionadas(seleccionadas);
    setModalAbierto("eliminar");
  }

  // Pedido humano (2026-08-27): devolver al sistema una orden borrada. Solo se ofrece con el
  // interruptor «Eliminadas» puesto, y entonces TODAS las filas de la tabla están borradas: no
  // hay snapshot que filtrar. El servidor revalida el rol y que cada orden esté efectivamente
  // borrada (defensa en profundidad).
  function abrirRecuperarEliminada(seleccionadas: OrdenListItemDTO[]) {
    setOrdenesSeleccionadas(seleccionadas);
    setModalAbierto("recuperar-eliminada");
  }

  // Señal de "desmarca todo" para la tabla: la selección vive en `OrdenesModule`, pero
  // quien sabe que una acción por lote se llevó a cabo es esta superficie. Se incrementa
  // junto con la revalidación —el mismo momento— y la tabla limpia sus casillas.
  const [resetSeleccion, setResetSeleccion] = useState(0);

  // Revalida el listado (todas sus combinaciones de estado/página comparten el
  // prefijo de key SWR) y desmarca las filas: las órdenes recién actuadas ya cambiaron
  // de estado, así que dejarlas marcadas solo invita a repetir la acción sobre algo que
  // ya no la admite. El lote en curso viaja en `ordenesSeleccionadas` (snapshot propio),
  // de modo que esto NO rompe el encadenado guía → etiquetas.
  function revalidarTablas() {
    setResetSeleccion((n) => n + 1);
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
  //
  // Nota (2026-08-05): "Rutear a bodega satélite" VOLVIÓ a `en_bodega_central`, que es su
  // origen único desde la feature 156 (R15/R16). Historia, para que no se repita: hasta el
  // 2026-07-31 la ofrecía la vista legacy `OrdenesRevisionMaestro`, y al borrarse ésa la
  // acción se quedó SIN NINGUNA superficie de UI — el backend entero
  // (`rutearABodegaSatelite`, `GuiaAsignacionService.rutearABodegaSatelite`) y
  // `RutearSateliteModal.tsx` seguían vivos, pero nadie podía dispararlos. Se reportó
  // desde PRODUCCIÓN como "desapareció el botón para rutear a satélite". Se remonta aquí,
  // que es la única superficie de la bodega central hoy.
  /**
   * Feature 262/F3 (R13, design §7.1) — la acción de corregir el día, declarada UNA vez y
   * reusada por los TRES estados donde el día de reparto todavía decide algo. Es secundaria
   * (`variant: "outline"`) en los tres: la primaria de `por_recoger` sigue siendo imprimir
   * etiquetas, y `en_reparto` / `ayuda_tienda` no tenían ninguna hasta ahora.
   *
   * Se declara aquí y no dentro de cada `case` para que los tres botones no puedan divergir de
   * etiqueta ni de `key` — la `key` es la que agrupa la acción cuando la selección mezcla
   * estados, así que tres `key` distintas pintarían tres botones iguales.
   */
  const accionCambiarDia: AccionLote = {
    key: "cambiar-dia-reparto",
    label: CAMBIAR_DIA_ACCION,
    variant: "outline",
    onRun: abrirCambiarDia,
  };

  /**
   * Feature «eliminar orden» — la ÚNICA acción por lote que no cuelga de `accionesDe`, y no es
   * un descuido: no tiene estado de origen. Una orden creada por error puede estar en cualquier
   * punto del flujo, así que condicionarla al estado dejaría fuera justo los casos que motivan
   * la ficha. Se añade en `accionesPara`, sobre la selección ENTERA.
   *
   * Secundaria (`variant: "outline"`) a propósito: nunca debe ser el botón que se pulsa por
   * inercia. La confirmación destructiva vive en el modal.
   */
  const accionEliminar: AccionLote = {
    key: "eliminar",
    label: "Eliminar",
    variant: "outline",
    onRun: abrirEliminar,
  };

  /**
   * Pedido humano (2026-08-27) — "Recuperar", la ÚNICA acción del listado de eliminadas. No
   * cuelga de `accionesDe` por la misma razón que su gemela: no tiene estado de origen, y sobre
   * una orden borrada NINGUNA de las acciones del flujo tiene sentido (la orden no está en los
   * listados de nadie). Con el interruptor puesto, ésta es la barra entera.
   */
  const accionRecuperar: AccionLote = {
    key: "recuperar-eliminada",
    label: "Recuperar",
    onRun: abrirRecuperarEliminada,
  };

  function accionesDe(estatusValue: string | undefined): AccionLote[] {
    // FICHA 358 — LA PUERTA DE LAS ACCIONES DE FLUJO, en el único punto por el que salen todas.
    //
    // Hasta hoy `accionesLote` decidía dos cosas a la vez —«hay casillas» y «hay acciones de
    // flujo»— porque siempre coincidían. Al abrirle «Eliminar» a la tienda dejan de coincidir:
    // la tienda necesita casillas y NO puede generar guías, asignar mensajeros ni rutear a
    // satélite. Sin esta guarda, marcar una fila le llenaría la barra de botones que el servidor
    // rechaza, que es exactamente lo que esta pantalla no debe hacer.
    //
    // Va AQUÍ y no en los tres llamadores (`haySeleccionables`, `bloqueoSeleccion`,
    // `accionesPara`) para que no puedan divergir: los tres preguntan por esta función.
    if (!accionesLote) return [];
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
      // Feature 157 (ampliacion): ya tiene mensajero y va en camino. La unica decision que
      // queda al maestro es RETIRARSELA, si ese mensajero no puede ir. Asignar a otro exige
      // pasar por aqui primero: es lo que impide reasignar en bucle.
      case "recolectando":
        return [
          {
            key: "quitar-recoleccion",
            label: "Quitar mensajero",
            variant: "outline",
            onRun: abrirQuitarRecoleccion,
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
          // Feature 262/F3: el caso PRINCIPAL — el lote está en la bodega, marcado para el día
          // que no es.
          accionCambiarDia,
        ];
      // Feature 262/F3 (design §4.2) — los otros dos estados donde el día de reparto TODAVÍA
      // decide algo, y que hasta ahora no tenían ninguna acción por lote en esta pantalla:
      //
      //  - `en_reparto` es la población que la 261 dejó ATRAPADA: el paquete ya está en la mano
      //    del mensajero y, con el día equivocado, no puede gestionarlo. Sin este estado, esta
      //    ficha no rescata el caso que la motivó.
      //  - `ayuda_tienda` es el mismo bloqueo por la otra puerta (261/R28 impide que la tienda
      //    resuelva una orden reservada) y el paquete sigue con el mensajero (235/R1).
      //
      // Los dos YA son opciones del filtro de estado para maestro/admin (`EXCLUDE_POR_ROL` sólo
      // les excluye `pendiente`), así que no hace falta abrir ninguna pantalla ni ningún filtro
      // nuevo para alcanzar la población atrapada.
      case "en_reparto":
      case "ayuda_tienda":
        return [accionCambiarDia];
      case "en_bodega_central":
        return [
          {
            key: "asignar",
            label: "Asignar mensajero",
            onRun: abrirAsignarBodega,
          },
          // Feature 30/R13 + 156/R15: el paquete está en la central y su zona es
          // satélite ⇒ sale hacia la bodega satélite de esa zona. Secundaria, como en la
          // vista legacy que la ofrecía: la acción primaria de este estado sigue siendo
          // asignar mensajero para reparto directo.
          {
            key: "rutear-satelite",
            label: "Rutear a bodega satélite",
            variant: "outline",
            onRun: abrirRutearSatelite,
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
  //
  // FICHA 355: el recorte lo hace `estadosOfrecidos`, compartido con la bodega satélite.
  // Aquí se conservan las FILAS (no las opciones) porque más abajo hace falta traducir el
  // id marcado de vuelta a su `value` para decidir columnas y resalte.
  const estadosDisponibles = useMemo<OrderStatusLiteRow[]>(
    () => estadosOfrecidos(catalogo, exclude),
    [catalogo, exclude],
  );

  // Feature 144: selección agregada de la barra genérica (estado, zona, tienda,
  // geografía y tiempo). El componente es dueño de su estado; aquí solo se guarda lo
  // emitido.
  const [seleccionFiltros, setSeleccionFiltros] = useState<FilterSelection>({});

  // Término del BUSCADOR principal (`BuscadorFiltros`). Vive aparte de la selección
  // agregada porque `FilterComponent` emite SU selección completa en cada cambio: si
  // el término se guardara ahí dentro, marcar una zona lo borraría. Se funde con la
  // selección justo antes de traducirla, más abajo.
  const [terminoBuscador, setTerminoBuscador] = useState("");

  // Claves de los filtros PUESTOS en la barra desde el selector. Arranca vacía: la
  // barra nace con el buscador solo y el usuario pide los filtros que va a usar. Al
  // retirar uno, `FilterComponent` descarta su selección —un filtro sin control en
  // pantalla no puede seguir filtrando—, así que aquí no hay nada que limpiar.
  const [filtrosActivos, setFiltrosActivos] = useState<string[]>([]);

  // Contador de "Limpiar todo". `FilterComponent` es dueño de su selección y no expone
  // forma de vaciarla desde fuera, así que se le cambia la `key` para remontarlo
  // limpio; el estado de aquí se vacía en la misma acción.
  const [resetFiltros, setResetFiltros] = useState(0);

  /**
   * FICHA 356 — dirección del orden por fecha de creación. Arranca donde arranca el contrato
   * (`DIRECCION_ORDEN_INICIAL`, «Más recientes»), así que entrar a la pantalla enseña
   * exactamente el listado de siempre, con el control ya puesto en lo que se está viendo.
   *
   * Vive AQUÍ y no dentro de `OrdenesModule` por la misma razón que la selección de filtros:
   * el control se pinta en la barra, la barra la monta esta superficie y el módulo recibe el
   * resultado ya decidido.
   */
  const [sortDir, setSortDir] = useState<DireccionOrden>(DIRECCION_ORDEN_INICIAL);
  const orden = useMemo(() => ordenamientoCreacion(sortDir), [sortDir]);

  /** Deja la barra como recién abierta: sin valores y sin filtros puestos. */
  function limpiarFiltros() {
    setSeleccionFiltros({});
    // También se retiran los filtros PEDIDOS: "limpiar todo" es volver al punto de
    // partida, y una barra que se queda con cuatro controles vacíos no lo es.
    setFiltrosActivos([]);
    setResetFiltros((n) => n + 1);
    // EL ORDEN NO SE TOCA, y es deliberado (ficha 356). "Limpiar todo" existe para deshacer
    // lo que ESCONDE filas: un filtro o una búsqueda. El orden no oculta ninguna —las mismas
    // órdenes, en otra secuencia—, así que devolverlo a «Más recientes» sería mover algo que
    // el usuario no pidió mover. Además el botón sólo aparece cuando hay filtros o búsqueda
    // puestos: si resetear el orden fuera parte de "limpiar", quien sólo cambió el orden no
    // tendría forma de deshacerlo — el control, que sigue a la vista, ya es esa forma.
  }

  // Ids marcados en el filtro de estado. Vacío = sin filtro (todas las órdenes). Ya no
  // es un estado aparte: el estado es UN filtro más de la barra (misma clave que el
  // `filter` del backend), así que sale de la selección agregada.
  const estadosMarcados = seleccionFiltros[CLAVE_ESTADO] ?? [];

  /**
   * Pedido humano (2026-08-27) — ¿está puesto el interruptor «Eliminadas»? Se lee de la MISMA
   * selección que se traduce al `filter`, no de un estado paralelo: así la barra de acciones y
   * lo que la tabla está pidiendo al servidor no pueden desincronizarse ni por un render.
   *
   * Es lo que decide qué ofrece la barra (recuperar, y nada más) y que ninguna fila se bloquee.
   */
  const verEliminadas =
    (seleccionFiltros[CLAVE_ELIMINADOS] ?? [])[0] === BOOLEAN_MARCADO;

  // FICHA 355: el control de estado, con sus opciones, sus etiquetas y sus textos, tal
  // como lo declara el módulo compartido. `estadosDisponibles` ya aplicó el recorte, así
  // que aquí se le pasa sin volver a excluir nada.
  const declaracionEstado = useMemo(
    () =>
      filtroEstado(estadosDisponibles, { key: CLAVE_ESTADO, exclude: [] }),
    [estadosDisponibles],
  );

  // R55/R56: las declaraciones de la barra salen del catálogo precargado (más la de
  // estado, que sale del catálogo de estatus). Sin catálogo geográfico se declaran
  // igual, pero sin opciones y deshabilitadas (R64): la tabla sigue viva.
  const filtrosBarra = useMemo<FilterDef[]>(() => {
    const declarados = construirFiltrosOrdenes(
      catalogoFiltros ?? CATALOGO_FILTROS_VACIO,
      {
        incluirTienda: incluirFiltroTienda,
        incluirReasignables: incluirFiltroReasignables,
        incluirMensajero: incluirFiltroMensajero,
        // Pedido humano (2026-08-27): el interruptor de las eliminadas se declara a quien puede
        // VERLAS y recuperarlas. A los demás ni se les ofrece —y si lo pidieran a mano, el
        // servidor responde `forbidden`, no una lista vacía.
        //
        // FICHA 358: cuelga de `puedeVerEliminadas` y ya NO de `puedeEliminar`. Desde hoy no son
        // el mismo rol: la tienda borra lo suyo, pero no ve el cementerio ni recupera de él.
        incluirEliminados: puedeVerEliminadas,
      },
    );
    // El BUSCADOR ya no es un control más del panel: lo posee `BuscadorFiltros`, que
    // es la barra permanente de arriba. Se descarta POR SU CLAVE, no por su posición
    // (M7 del review): filtrando por `key` da igual cómo se reordene
    // `construirFiltrosOrdenes`, mientras que quitar "el primero" dejaría fuera a
    // otro filtro el día que cambie ese orden, sin que nada aquí lo delatara.
    const dependenDelCatalogo = declarados.filter((f) => f.key !== CLAVE_BUSQUEDA);
    return [
      // El estado va parametrizado como un filtro más, no por fuera: mismo control,
      // misma limpieza y misma salida agregada que zona, tienda o geografía.
      declaracionEstado,
      // R64: si el catálogo geográfico no cargó, se deshabilitan SUS filtros; el de
      // estado viene de otra fuente y sigue operativo.
      ...dependenDelCatalogo.map((f) =>
        catalogoFiltros === null ? { ...f, disabled: true } : f,
      ),
    ];
  }, [
    catalogoFiltros,
    incluirFiltroTienda,
    incluirFiltroReasignables,
    incluirFiltroMensajero,
    puedeVerEliminadas,
    declaracionEstado,
  ]);

  /** Lo que ofrece el selector: cada filtro declarado, por su clave y su etiqueta. */
  const filtrosOfrecidos = useMemo(
    () => filtrosBarra.map((f) => ({ key: f.key, label: f.label })),
    [filtrosBarra],
  );

  // Solo se montan los filtros PEDIDOS, en el orden en que se declararon (no en el de
  // los clics): así los controles no bailan de sitio según cómo se hayan ido pidiendo.
  const filtrosMontados = useMemo(
    () => filtrosBarra.filter((f) => filtrosActivos.includes(f.key)),
    [filtrosBarra, filtrosActivos],
  );

  // R46/R58/R59: `status_id` (feature 63) y los filtros nuevos se funden en UN solo
  // `filter`. Sin nada seleccionado, el objeto queda vacío y se envía `undefined`, de
  // modo que la entrada de `listarOrdenes` es IDÉNTICA a la previa a esta feature.
  const filter = useMemo<OrdenesFilterUI | undefined>(() => {
    // El término del buscador entra como UN filtro más, bajo su misma clave: se funde
    // aquí —y no en una traducción aparte— para que `seleccionAFilter` siga siendo el
    // único punto que conoce la forma del `filter`.
    const seleccion: FilterSelection =
      terminoBuscador !== ""
        ? { ...seleccionFiltros, [CLAVE_BUSQUEDA]: [terminoBuscador] }
        : seleccionFiltros;
    const compuesto: OrdenesFilterUI = seleccionAFilter(seleccion);
    return Object.keys(compuesto).length > 0 ? compuesto : undefined;
  }, [seleccionFiltros, terminoBuscador]);

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
   * FICHA 358 — ¿esta pantalla tiene selección por casilla, siquiera en principio?
   *
   * Era `accionesLote` a secas, y ahí estaba el defecto reportado: el `adminTienda` no lo recibe
   * (no opera transiciones de flujo), así que la tabla se le montaba SIN columna de casillas y
   * «Eliminar» no tenía cómo alcanzar ninguna fila. Es la mitad de pantalla de «no le aparece el
   * checkbox»; la otra mitad era el campo `eliminable`, que no le viajaba desde el servidor.
   *
   * Las dos condiciones son de naturaleza distinta y por eso van con `||` y no fundidas en una
   * prop nueva: `accionesLote` habilita las acciones del FLUJO, `puedeEliminar` habilita UNA
   * acción que no cuelga de ningún estado. Qué se ofrece luego sobre lo marcado lo deciden
   * `accionesPara` y `bloqueoSeleccion`, fila a fila.
   */
  const haySeleccion = accionesLote || puedeEliminar;

  /**
   * ¿Se monta la columna de checkbox? Solo si alguna orden de la página lleva a algún botón.
   * Filtrado a estados de solo lectura y ya gestionados (p. ej. `rechazada`) la tabla queda
   * limpia, sin una columna de casillas inertes.
   */
  function haySeleccionables(items: OrdenListItemDTO[]): boolean {
    // Pedido humano (2026-08-27): vuelve a haber estados inertes, así que vuelve la pregunta —
    // pero ahora con tres respuestas posibles, no una.
    //   - listado de ELIMINADAS: siempre, la única acción de esa vista es recuperar;
    //   - alguna fila con acción por su estado: como siempre;
    //   - alguna fila con estado eliminable y el rol que puede borrar: "Eliminar" las alcanza.
    // Si no se cumple ninguna, la columna no se monta: casillas que no llevan a ningún botón.
    if (verEliminadas) return items.length > 0;
    if (items.some((row) => accionesDe(row.estatusValue).length > 0)) return true;
    return puedeEliminar && items.some((row) => row.eliminable === true);
  }

  /**
   * Bloqueo del checkbox POR FILA (reglas que conviven, ahora derivadas del estado de
   * la ORDEN y no de una tab activa):
   * - estado sin acciones por lote Y no eliminable: no hay a dónde llevar la selección (la
   *   columna existe porque otras filas de la página sí la tienen).
   * - `devuelta`: solo las de la bodega central (las satélite las recupera el adminSatelite).
   * La primera regla se retiró el 2026-08-26 y volvió el 2026-08-27, ahora con las DOS
   * condiciones; la historia completa está en `MOTIVO_SIN_ACCIONES`, arriba.
   * Pedido humano 2026-08-18: SE RETIRÓ la tercera regla, que bloqueaba los estados de
   * asignación cuando la ZONA de la orden tenía ≥1 mensajero con cierre abierto. El servidor
   * ya no rechaza esa asignación, así que el checkbox tampoco la impide.
   */
  function bloqueoSeleccion(row: OrdenListItemDTO): string | null {
    // Pedido humano (2026-08-27): en el listado de ELIMINADAS no se bloquea ninguna fila. Las
    // reglas de abajo hablan de quién ejecuta una transición del flujo; recuperar no lo es, y el
    // bloqueo de `devuelta` no-central dejaría irrecuperables justo esas órdenes.
    if (verEliminadas) return null;
    const value = row.estatusValue;
    // Fila que no lleva a NINGÚN botón: ni su estado ofrece acción por lote, ni se puede
    // eliminar. Marcarla dejaría la barra vacía. Las dos condiciones se preguntan juntas
    // —y no solo la primera, como antes del 2026-08-26— porque hoy "Eliminar" es una acción
    // más que puede ser la única de la fila.
    if (
      accionesDe(value).length === 0 &&
      !(puedeEliminar && row.eliminable === true)
    ) {
      return MOTIVO_SIN_ACCIONES;
    }
    if (value === ESTADO_DEVUELTA) {
      return row.zonaEsGam === true ? null : MOTIVO_DEVUELTA_NO_CENTRAL;
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

    // Pedido humano (2026-08-27): con «Eliminadas» puesto, la tabla trae EXCLUSIVAMENTE órdenes
    // borradas y la barra ofrece UNA sola cosa. Se sale antes de recorrer `accionesDe` a
    // propósito: una orden borrada no está en el listado de nadie, así que ofrecer sobre ella
    // "generar guía" o "asignar mensajero" sería ofrecer transiciones que el servidor rechaza —y
    // que, de aceptarlas, moverían una orden que oficialmente no existe.
    if (verEliminadas) return [accionRecuperar];

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

    const porEstado = [...porKey.values()].map(({ accion, ordenes }) => {
      const parcial = ordenes.length < seleccionadas.length;
      return {
        ...accion,
        label: parcial ? `${accion.label} (${ordenes.length})` : accion.label,
        // Se ignora lo que la barra pasa (la selección entera) y se usa el subconjunto
        // elegible: es lo que hace que la acción no descarte filas en silencio ni falle.
        onRun: () => accion.onRun(ordenes),
      };
    });

    // "Eliminar" va SIEMPRE la ÚLTIMA, y al final de la barra por la misma razón por la que es
    // secundaria: es la acción que no se debe pulsar por inercia.
    //
    // SOLO sobre las órdenes cuyo ESTADO admite borrarlas (`eliminable`, que resuelve el
    // servidor con el MISMO predicado que autoriza el borrado). Si ninguna de las marcadas lo
    // está, el botón NO APARECE. Se exige `=== true`: un DTO sin el campo (rol que no lo recibe,
    // fixture antiguo) no habilita nada.
    //
    // Ficha 319 (2026-08-28): el campo se llamaba `sinGestion` y el criterio era "nadie la ha
    // gestionado desde que se creó". Se retiró porque generar la guía ya contaba como gestión y
    // dejaba la ventana VACÍA (0 eliminables de 429 vivas en producción). Aquí no se decide
    // nada: la regla vive en `lib/types/order-status-eliminables.ts` y esta pantalla solo la lee.
    const elegiblesEliminar = puedeEliminar
      ? seleccionadas.filter((o) => o.eliminable === true)
      : [];
    if (elegiblesEliminar.length === 0) return porEstado;
    // Con conteo cuando no alcanza a toda la selección, igual que las acciones por estado: sin
    // él, marcar 10 y pulsar "Eliminar" borraría 3 sin decir cuáles.
    const parcial = elegiblesEliminar.length < seleccionadas.length;
    return [
      ...porEstado,
      {
        ...accionEliminar,
        label: parcial
          ? `${accionEliminar.label} (${elegiblesEliminar.length})`
          : accionEliminar.label,
        onRun: () => accionEliminar.onRun(elegiblesEliminar),
      },
    ];
  }

  // La carga masiva y los escáneres viven a nivel del contenedor (no dependen del
  // filtro): son acciones independientes del estado. La carga masiva y la recepción en
  // origen se ofrecen al adminTienda (feature 26); la recepción en bodega central
  // (feature 138) al maestro/admin. `onRecibida={handleSuccess}` revalida el listado
  // (R14), de modo que la orden recibida refleja su nuevo estado.
  //
  // El receptor es una TARJETA (cámara + número de guía), demasiado alta para vivir
  // desplegada encima de la tabla: se abre desde la barra de acciones EN MODAL y se
  // cierra igual. Quien no puede recibir no ve ni el botón.
  // El disparador vive a la IZQUIERDA, donde empieza la lectura de la pagina; la carga
  // masiva sigue a la derecha de la misma fila. Abrir monta la tarjeta y cerrar la
  // desmonta (apaga la camara): el mismo `EscanerModal` compartido que usan las demás
  // superficies de escaneo. El label es el suyo por defecto ("Recibir paquete").
  const header =
    puedeCargarMasiva || puedeEscanearQr || puedeRecibirBodegaCentral ? (
      puedeEscanearQr || puedeRecibirBodegaCentral ? (
        <EscanerModal
          acciones={puedeCargarMasiva ? <OrdenesCargaMasivaButton /> : null}
        >
          {puedeRecibirBodegaCentral ? (
            <EscanerRecepcionBodegaCentral onRecibida={handleSuccess} />
          ) : null}
          {puedeEscanearQr ? (
            <EscanerRecepcionOrigen onRecibida={handleSuccess} />
          ) : null}
        </EscanerModal>
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
          estado incluido (ocho con el buscador de la 169; siete sin tienda). Toda la
          lógica de selección, búsqueda, acotamiento, agrupado, exclusión mutua y poda
          vive en el componente; aquí solo se declara y se traduce lo emitido. */}
      <OrdenesModule
        // La zona de filtros vive DENTRO de la tabla, en la misma línea que el botón
        // de descarga: el buscador manda la barra (guía, remisión, teléfono,
        // destinatario o producto, con el mínimo de caracteres que valida el borde) y
        // el botón "Filtros" ofrece el resto —estado, zona, tienda, geografía y
        // fecha—. Los que el usuario pide se montan DELANTE del campo y siguen siendo
        // la misma barra genérica de siempre: toda la lógica de selección,
        // acotamiento, agrupado y poda vive en `FilterComponent`; aquí solo se declara
        // y se traduce lo emitido.
        filtros={
          <BuscadorFiltros
            // El mismo nombre accesible que tenía como control de la barra: el campo
            // cambió de sitio, no de identidad.
            label="Buscar"
            placeholder={PLACEHOLDER_BUSQUEDA}
            minChars={BUSQUEDA_MIN_CHARS}
            onChange={setTerminoBuscador}
            filtros={filtrosOfrecidos}
            activos={filtrosActivos}
            onActivosChange={setFiltrosActivos}
            // "Limpiar todo" lo pone la barra al final de la fila, no `FilterComponent`
            // en medio: así una sola acción se lleva por delante la búsqueda Y los
            // filtros, que es lo que el usuario espera de ese botón.
            onLimpiarTodo={limpiarFiltros}
            // Basta con tener un filtro PUESTO —aunque esté vacío— para ofrecer la
            // limpieza: retirarlo de la barra también es algo que limpiar.
            hayFiltrosAplicados={
              filtrosActivos.length > 0 ||
              Object.keys(seleccionFiltros).length > 0
            }
          >
            {/* FICHA 356 — el control de ORDEN, dentro de la misma barra y SIEMPRE a la
                vista. Es lo que faltaba: el backend sabía ordenar desde la 352 y no había
                dónde pedirlo («no veo un botón con el cual organizar los datos de las tablas
                por su fecha de creación»).

                Va en la barra y no en la cabecera de la columna «Fecha de creación» porque
                esa columna es la 17.ª de 18: con scroll horizontal está fuera de pantalla
                casi siempre, y en móvil siempre. Un control que hay que buscar arrastrando la
                tabla reproduce el problema que estamos arreglando. La barra, en cambio, es la
                referencia que el humano señaló para «cómo deben verse y comportarse las
                cosas».

                Es el PRIMER hijo, o sea el extremo izquierdo de la fila y delante de los
                filtros que se vayan pidiendo: un sitio fijo, que no baila según qué filtros
                haya puestos. Y es `SegmentedToggle`, el mismo conmutador del portal del
                mensajero y de cierres, con el alto por defecto (`h-8`) que comparten el campo
                de búsqueda y el botón de descarga de esta misma línea. */}
            <SegmentedToggle
              ariaLabel={ETIQUETA_ORDEN_CREACION}
              options={OPCIONES_ORDEN_CREACION}
              valor={sortDir}
              onChange={setSortDir}
            />
            {filtrosMontados.length > 0 ? (
              <FilterComponent
                key={resetFiltros}
                filters={filtrosMontados}
                onChange={setSeleccionFiltros}
              />
            ) : null}
          </BuscadorFiltros>
        }
        filter={filter}
        orden={orden}
        columns={columns}
        mostrarHistorial={mostrarHistorial}
        resetSeleccion={resetSeleccion}
        selectable={haySeleccion ? haySeleccionables : false}
        bloqueoSeleccion={haySeleccion ? bloqueoSeleccion : undefined}
        acciones={haySeleccion ? accionesPara : undefined}
        resaltarPrioridad={valueUnico === ESTADO_EN_BODEGA}
        permitirDescarga={permitirDescarga}
        puedeReportarIncidente={puedeReportarIncidente}
        puedeCorregirDatos={puedeCorregirDatos}
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
          {/* Feature 157: NO se le aplica ningún filtro por ZONA —una recolección la puede
              hacer cualquier mensajero, así que la zona de la orden no dice nada—.
              FEATURE 271 (T9.4, R31/R32): el CIERRE del mensajero elegido sí manda, y desde el
              2026-08-23 igual que en reparto: recolectar en tienda es cobrar, y el dinero que
              cobre no tendría cierre al que ir. Misma lista `bloqueadosIds` que el modal de
              reparto; el service lo revalida igual. */}
          <AsignarRecoleccionModal
            open={modalAbierto === "asignar-recoleccion"}
            ordenes={ordenesSeleccionadas}
            mensajeros={mensajeros ?? []}
            mensajerosConRepartoIds={mensajerosConRepartoIds}
            mensajerosBloqueadosIds={mensajerosBloqueadosIds}
            mensajerosNoAsignablesIds={mensajerosNoAsignablesIds}
            onOpenChange={cerrarModal}
            onSuccess={handleSuccess}
          />
          <QuitarRecoleccionModal
            open={modalAbierto === "quitar-recoleccion"}
            ordenes={ordenesSeleccionadas}
            onOpenChange={cerrarModal}
            onSuccess={handleSuccess}
          />
          <AsignarBodegaModal
            open={modalAbierto === "asignar-bodega"}
            ordenes={ordenesSeleccionadas}
            mensajeros={mensajeros ?? []}
            mensajerosConRecoleccionIds={mensajerosConRecoleccionIds}
            // FEATURE 271 (T9.4, R28/R32): los bloqueados por cierres, la MISMA lista que el
            // modal de recolección.
            mensajerosBloqueadosIds={mensajerosBloqueadosIds}
            mensajerosNoAsignablesIds={mensajerosNoAsignablesIds}
            // Feature 246 (T4.2, R29): las fechas bajan de la página, que las resolvió en el
            // servidor. Este componente sólo las transporta: no las calcula ni las corrige.
            fechasDiaReparto={fechasDiaReparto}
            onOpenChange={cerrarModal}
            onSuccess={encadenarEtiquetas}
          />
          {/* Feature 30 (T16) — remontado el 2026-08-05. NO encadena etiquetas: la
              etiqueta del lote ya se imprimió en la central, y el modal tiene su propia
              fase de manifiesto antes de cerrar. `handleSuccess` cierra y revalida, de
              modo que las órdenes ruteadas pasan a `en_ruta_bodega_satelite`. */}
          <RutearSateliteModal
            open={modalAbierto === "rutear-satelite"}
            ordenes={ordenesSeleccionadas}
            onOpenChange={cerrarModal}
            onSuccess={handleSuccess}
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
          {/* Feature 262/F3 (R13/R17): éxito ⇒ `handleSuccess` cierra y revalida las tablas, de
              modo que el listado vuelve a leer del servidor el día de cada orden. Las fechas
              del selector bajan de la página, que las resolvió con el día de Costa Rica: este
              componente sólo las transporta, igual que hace con `AsignarBodegaModal`. */}
          <CambiarDiaRepartoModal
            open={modalAbierto === "cambiar-dia-reparto"}
            ordenes={ordenesSeleccionadas}
            fechasDiaReparto={fechasDiaReparto}
            onOpenChange={cerrarModal}
            onSuccess={handleSuccess}
          />
          {/* Pedido humano (2026-08-27): la reversión. Éxito ⇒ `handleSuccess` revalida, y la
              orden recuperada desaparece de ESTE listado (que solo muestra borradas) y reaparece
              en el normal, con el estado y el historial que tenía. Se queda en este bloque: sólo
              se alcanza con el interruptor «Eliminadas», que es del `maestro`. */}
          <RecuperarOrdenModal
            open={modalAbierto === "recuperar-eliminada"}
            ordenes={ordenesSeleccionadas}
            onOpenChange={cerrarModal}
            onSuccess={handleSuccess}
          />
        </>
      ) : null}

      {/* Feature «eliminar orden»: éxito ⇒ `handleSuccess` cierra y revalida las tablas, de modo
          que las órdenes eliminadas desaparecen del listado (todas las lecturas filtran
          `deleted_at IS NULL`).

          FICHA 358 — SALE del bloque de `accionesLote` y se monta con `haySeleccion`. Estaba
          dentro porque hasta hoy sólo borraba el `maestro`, que también tiene acciones de lote;
          dejándolo ahí, la tienda vería el botón «Eliminar» y al pulsarlo no se abriría nada —un
          fallo mudo, que es la familia de defectos que más caro sale en este repo. */}
      {haySeleccion ? (
        <EliminarOrdenModal
          open={modalAbierto === "eliminar"}
          ordenes={ordenesSeleccionadas}
          onOpenChange={cerrarModal}
          onSuccess={handleSuccess}
        />
      ) : null}
    </div>
  );
}
