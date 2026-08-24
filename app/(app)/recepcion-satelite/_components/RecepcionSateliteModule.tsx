"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";

import { Button } from "@/components/ui/button";
import { DescargarManifiestoButton } from "@/components/shared/DescargarManifiestoButton";
import { Pagination } from "@/components/shared/Pagination";
import { filasDesdeResultado } from "@/components/shared/descarga-resultado";
import { BodegaLiberadasHoy } from "@/components/private/BodegaLiberadasHoy";
import { PorAceptarSection } from "@/app/(app)/_components/PorAceptarSection";
import { useToast } from "@/hooks/useToast";
import { recepcionSateliteConfig } from "@/lib/config/recepcion-satelite";
import type { RecepcionSateliteDTO } from "@/lib/interfaces/services/IRecepcionSateliteService";
import type { CatalogoFiltrosOrdenesDTO } from "@/lib/types/filtros-ordenes";
import type { LiberadaHoyRow } from "@/lib/interfaces/repositories/ILiberacionReprogramadaRepository";
import type { FechasDiaReparto } from "@/lib/utils/dia-reparto-textos";

import { enviarACentral } from "@/lib/actions/envio-devolucion-central";
import {
  listarIdsVigentesBodega,
  listarOrdenesBodegaCompleto,
  listarOrdenesBodegaPaginado,
  recibirLote,
} from "@/lib/actions/recepcion-satelite";
import { recuperarABodega } from "@/lib/actions/resolver-novedad";

import { estatusLabel } from "@/app/(app)/ordenes/_components/estatus-label";
import { envioDevolucionCentralErrorMessage } from "@/app/(app)/ordenes/_components/envio-devolucion-central-error-messages";
import { recuperarBodegaErrorMessage } from "@/app/(app)/ordenes/_components/recuperar-bodega-error-messages";
import { EscanerRecepcion } from "./EscanerRecepcion";
import { SateliteOrderCard } from "./SateliteOrderCard";
import { SateliteOrdenesListado } from "./SateliteOrdenesListado";
import { AsignarSateliteModal } from "./AsignarSateliteModal";
import { DeshacerAsignacionSateliteModal } from "./DeshacerAsignacionSateliteModal";
import { CambiarDiaRepartoSateliteModal } from "./CambiarDiaRepartoSateliteModal";
import { filaDescargaSatelite } from "./satelite-descarga-columnas";
import {
  FILTRO_SATELITE_VACIO,
  serializarFiltroSatelite,
  type FiltroBodegaSatelite,
} from "./satelite-ordenes-filtros";
import {
  BODEGA_BLOQUEADA_TITULO,
  BODEGA_CIERRES_ABIERTOS_DETALLE,
  bodegaBloqueadaLineas,
  bodegaCierresAbiertosTitulo,
  type BodegaBloqueoCausa,
} from "./asignacion-satelite-bloqueo";

// Feature 33 (T12, R6/R7/R8/R9): módulo de la bodega satélite. Recibe de su Server
// Component padre lo que la pantalla necesita ya acotado a la zona del actor (datos
// sensibles por props, sin resolver permisos en el cliente) y el nombre de la zona /
// `sinZona`. Tras cada acción exitosa se relee el estado del servidor.
//
// Feature 170 — FASE 2 (T K.3, R40-R43/R52): el listado «Órdenes de la bodega» deja de
// recibir el conjunto entero por props y pasa a pintar UNA PÁGINA que resuelve el servidor
// (T K.1). Aquí vive la capa de datos de ese listado —los tres filtros vigentes, la página
// pedida, SWR y la descarga del conjunto completo—; `SateliteOrdenesListado` se queda con
// lo suyo: qué filas están marcadas y qué acción de lote se ofrece sobre ellas.
//
// El control de paginación se monta EN ESTE archivo a propósito (precedente de T J.2): la
// guardia de contadores de cabecera (T H.3) mira del archivo que monta `<Pagination>` hacia
// los componentes que importa, nunca hacia arriba.

/** Nombre accesible del control de navegación entre páginas (R43). */
export const PAGINACION_BODEGA_LABEL = "Paginación de las órdenes de la bodega";

/** Mensaje de fallo de la lectura de la página, ya redactado para la tabla. */
const ERROR_CARGA = "No se pudieron cargar las órdenes de la bodega.";

// R40: el tamaño de página sale de la config del dominio (T H.1), nunca de un literal.
const PAGE_SIZE_OPTIONS = [10, 25, 50].filter(
  (s) => s <= recepcionSateliteConfig.MAX_PAGE_SIZE,
);

/** Feature 170 — FASE 2 (T K.3): la página del listado tal como la devuelve el servidor. */
export interface OrdenesBodegaPagina {
  items: RecepcionSateliteDTO[];
  total: number;
  pageSize: number;
}

/**
 * Lee una página del listado. Un resultado que no sea `ok` se lanza para que SWR lo trate
 * como error (la tabla enseña el aviso) en vez de pintar una página vacía que se leería
 * como «no hay órdenes».
 */
async function leerPagina(
  filtro: FiltroBodegaSatelite,
  page: number,
  pageSize: number,
): Promise<OrdenesBodegaPagina> {
  const res = await listarOrdenesBodegaPaginado({ ...filtro, page, pageSize });
  if (res.status !== "ok") throw new Error(res.status);
  return { items: res.items, total: res.total, pageSize: res.pageSize };
}

export interface RecepcionSateliteModuleProps {
  /** Órdenes en `en_ruta_bodega_satelite` de la zona del adminSatelite. */
  porRecibir: RecepcionSateliteDTO[];
  /**
   * Feature 170 — FASE 2 (T K.3, R40/R41): PÁGINA 1 del listado «Órdenes de la bodega»
   * —los cinco estados que el adminSatelite gestiona— resuelta server-side y SIN filtros,
   * más el `total` del conjunto. Alimenta el `fallbackData` de SWR y el «de Y» del
   * contador de cabecera (R42).
   *
   * REEMPLAZA a los cinco arrays por estado (`recibidas`, `asignadas`, `porDevolver`,
   * `enTransitoACentral`, `devueltas`) que este módulo concatenaba: con la tabla paginada
   * seguir recibiéndolos habría dejado el conjunto entero cruzando a la pantalla en cada
   * render, que es justo lo que la FASE 2 viene a quitar.
   */
  ordenesBodega: OrdenesBodegaPagina;
  /**
   * Feature 170 — FASE 2 (T K.2, R46): opciones de la geografía, resueltas server-side y
   * ajenas a la página visible.
   *
   * Pedido humano (2026-08-19): es el catálogo de `/ordenes`, que a este rol le llega acotado
   * a SU zona. `null` si no cargó — la barra se monta igual y la tabla sigue viva (R64).
   */
  catalogoFiltros: CatalogoFiltrosOrdenesDTO | null;
  /** Nombre de la zona del adminSatelite (para el display, R9); `null` si no tiene. */
  zonaNombre: string | null;
  /** `true` si el adminSatelite no tiene zona asignada (R5). */
  sinZona: boolean;
  /**
   * Feature 34 (T8/R5): mensajeros de la zona del adminSatelite para el modal de
   * asignación (ya scoped server-side; el módulo no fetchea datos sensibles).
   */
  mensajeros: { id: string; nombre: string }[];
  /**
   * FEATURE 271 (T9.5, R32): de esos mensajeros, los que el servidor va a RECHAZAR por su cierre.
   * Llega de la MISMA acción que la lista (`listarMensajerosSatelite`), resuelto con el MISMO
   * predicado que aplica la escritura: aquí no se re-deriva ni se filtra nada, sólo se transporta
   * al selector del modal.
   */
  mensajerosBloqueadosIds?: string[];
  /**
   * Feature 41 (R22) + ajuste admin_satelite: bloqueo DERIVADO server-side de la bodega
   * satélite. Si `bloqueada` (todos los mensajeros con cierre O CierreBodega pendiente),
   * se muestra el aviso de bloqueo y se deshabilita "Asignar". Si NO está bloqueada pero
   * `cierresAbiertos > 0`, se muestra un aviso INFORMATIVO (no bloqueante) y se puede
   * seguir asignando a los mensajeros sin cierre. `mensajerosConCierreIds` deshabilita a
   * esos mensajeros en el selector del modal.
   */
  bloqueoBodega: BodegaBloqueoCausa & {
    bloqueada: boolean;
    cierresAbiertos?: number;
    totalMensajeros?: number;
    mensajerosConCierreIds?: string[];
  };
  /**
   * Feature 46 (R15/R16): órdenes liberadas HOY (CR) por el cron para esta bodega
   * satélite (`en_bodega_satelite`), pre-resueltas server-side. Alimentan el aviso
   * derivado "Liberadas hoy (reprogramación)". Vacío = sin aviso.
   */
  liberadasHoy?: LiberadaHoyRow[];
  /**
   * Feature 246 (T4.3, R29): fechas calendario de «hoy» y «mañana» resueltas por la PÁGINA con
   * el día de Costa Rica. Sólo se transportan: hasta `AsignarSateliteModal` (elegir el día al
   * asignar) y, desde la feature 262/F4, hasta `CambiarDiaRepartoSateliteModal` (corregirlo
   * después). Las DOS pantallas leen las mismas dos fechas, resueltas una sola vez arriba.
   *
   * El defecto son dos cadenas vacías por el mismo motivo que en `/ordenes`: éste es código de
   * cliente y cualquier fecha que se inventara aquí saldría del reloj del navegador. Sin fechas
   * el selector se lee igual y sólo pierde precisión; con una fecha inventada, mentiría.
   */
  fechasDiaReparto?: FechasDiaReparto;
}

/** Feature 246: «no bajaron fechas de la página». Constante de módulo, no un literal por render. */
const SIN_FECHAS_DIA_REPARTO: FechasDiaReparto = { hoy: "", manana: "" };

/**
 * Estado legible "en bodega satélite de <zona>" (R9): deriva del `estatusValue`
 * (etiqueta de `estatusLabel`) y del nombre de zona de la orden.
 */
function estadoLegible(orden: RecepcionSateliteDTO, zonaNombre: string | null): string {
  const base = estatusLabel(orden.estatusValue);
  const zona = orden.zonaNombre || zonaNombre;
  return zona ? `${base} de ${zona}` : base;
}

export function RecepcionSateliteModule({
  porRecibir,
  ordenesBodega,
  catalogoFiltros,
  zonaNombre,
  sinZona,
  mensajeros,
  mensajerosBloqueadosIds = [],
  bloqueoBodega,
  liberadasHoy = [],
  fechasDiaReparto = SIN_FECHAS_DIA_REPARTO,
}: RecepcionSateliteModuleProps) {
  const router = useRouter();
  const toast = useToast();
  // Órdenes elegidas para asignar: SNAPSHOT que el listado entrega al pulsar "Asignar".
  // Vive aquí porque es lo que consume el modal de asignación.
  const [ordenesAAsignar, setOrdenesAAsignar] = useState<RecepcionSateliteDTO[]>(
    [],
  );
  const [modalOpen, setModalOpen] = useState(false);
  const [enviandoACentral, setEnviandoACentral] = useState(false);
  const [recuperando, setRecuperando] = useState(false);
  // Feature 149/T6.4 (R35): lote que va al modal de "Deshacer asignación" y estado de ese
  // modal. MISMO patrón que la asignación: el listado entrega el snapshot al pulsar.
  const [ordenesADeshacer, setOrdenesADeshacer] = useState<
    RecepcionSateliteDTO[]
  >([]);
  const [deshacerOpen, setDeshacerOpen] = useState(false);
  // Feature 262/F4 (R13): lote que va al modal de «Cambiar día de reparto» y estado de ese
  // modal. MISMO patrón que los otros dos: el listado entrega el snapshot al pulsar.
  const [ordenesACambiarDia, setOrdenesACambiarDia] = useState<
    RecepcionSateliteDTO[]
  >([]);
  const [cambiarDiaOpen, setCambiarDiaOpen] = useState(false);
  // Feature 148 (T13, R22): ids del ÚLTIMO envío a central que salieron `ok`. El lote
  // vive solo aquí (el service es por-orden, §9.1), así que se conserva para poder
  // ofrecer su manifiesto después del refresco. Vacío = sin descarga que ofrecer (R17).
  const [ultimoEnvioACentral, setUltimoEnvioACentral] = useState<string[]>([]);

  // Pedido humano: "Por recibir" (tarjeta de recepción + lista) solo se pinta si hay algo
  // que recibir y el actor tiene zona; el separador del listado depende de lo mismo.
  const mostrarPorRecibir = !sinZona && porRecibir.length > 0;

  // ---------- Feature 170 — FASE 2 (T K.3): la capa de datos del listado ----------
  // Los tres filtros VIGENTES (los emite la barra del listado), la página pedida y su
  // tamaño. Filtrar cambia el conjunto, así que vuelve a la página 1: la que se estaba
  // viendo puede no existir en el nuevo resultado.
  const [filtro, setFiltro] = useState<FiltroBodegaSatelite>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(ordenesBodega.pageSize);

  // R45/R61: la clave de SWR lleva el filtro serializado a un ESCALAR estable, para que la
  // caché sea por combinación de filtros y dos selecciones equivalentes no refetcheen.
  const filtroKey = serializarFiltroSatelite(filtro);
  const { data, error, mutate } = useSWR(
    ["satelite:bodega", filtroKey, page, pageSize],
    () => leerPagina(filtro, page, pageSize),
    {
      // Lo que el Server Component ya resolvió: página 1, sin filtros, tamaño de origen.
      fallbackData:
        page === 1 &&
        pageSize === ordenesBodega.pageSize &&
        filtroKey === FILTRO_SATELITE_VACIO
          ? ordenesBodega
          : undefined,
    },
  );

  // El esqueleto de carga se muestra sólo cuando NO hay nada que pintar. `isLoading` de SWR
  // sigue siendo `true` mientras revalida aunque haya `fallbackData`, y usarlo tal cual haría
  // que la página 1 —la que el servidor ya resolvió— apareciera como esqueleto antes de
  // enseñar las filas que el usuario veía antes de paginar (T I.2).
  const cargando = data === undefined;

  function cambiarFiltro(nuevo: FiltroBodegaSatelite) {
    setFiltro(nuevo);
    setPage(1);
  }

  /**
   * Feature 184 — Tanda A (T A.5, R18/R19/R21/R22) — cuáles de los identificadores marcados
   * SIGUEN perteneciendo al conjunto filtrado.
   *
   * Vive aquí y baja como callback por lo mismo que `obtenerFilasDescarga`: los filtros
   * vigentes son de este módulo y la selección es del listado. Se construye EN EL RENDER, así
   * que el closure lee el `filtro` de ESTE render y la comprobación se hace sobre el conjunto
   * que el usuario está viendo (R19). El alcance por zona lo impone el servidor: aquí no viaja
   * ninguna clave de alcance (R21).
   *
   * Devuelve `null` en CUALQUIER respuesta que no sea `ok` —incluida la de pasarse del tope de
   * identificadores— y el listado lo trata como «no podar»: la selección queda intacta (R22).
   * El tope lo decide el servidor y no se replica aquí, para que no haya dos números.
   */
  async function comprobarVigencia(ids: string[]): Promise<readonly string[] | null> {
    const res = await listarIdsVigentesBodega({ ...filtro, ids });
    return res.status === "ok" ? res.ids : null;
  }

  /**
   * Relee el estado del servidor tras una acción.
   *
   * `router.refresh()` sigue siendo necesario: vuelve a resolver el Server Component, que es
   * quien trae "Por recibir", el bloqueo de la bodega, las liberadas de hoy y el total del
   * conjunto. Pero YA NO BASTA para la tabla: sus filas las tiene SWR, y sin `mutate()` una
   * orden recién enviada a central seguiría en el listado hasta recargar la página.
   */
  async function releerBodega() {
    router.refresh();
    await mutate();
  }

  // Feature 63: recepción EN LOTE ("Aceptar todas" / "Aceptar" por-orden), análoga
  // al "Recoger" del mensajero. Cablea la Server Action `recibirLote`; tras éxito
  // releé el estado del servidor (patrón feature 33) y da feedback por toast.
  async function aceptarRecepcion(ordenIds: string[]) {
    if (ordenIds.length === 0) return;
    const result = await recibirLote({ ordenIds });
    if (result.status === "ok") {
      toast.success(`${result.recibidas} orden(es) recibida(s).`);
      await releerBodega();
      return;
    }
    toast.error(
      result.status === "sin_zona"
        ? "No tienes una zona asignada para recibir órdenes."
        : "No se pudieron recibir las órdenes.",
    );
  }

  /** Abre el modal de asignación con lo seleccionado en el listado. */
  function abrirAsignacion(ordenes: RecepcionSateliteDTO[]) {
    if (ordenes.length === 0) return;
    setOrdenesAAsignar(ordenes);
    setModalOpen(true);
  }

  /**
   * Feature 100 (T4.1, R12) — recuperación `devuelta → en_bodega_satelite`. Antes era una
   * acción POR FILA; con el listado único pasa a LOTE sobre la selección, con el mismo
   * patrón que el envío a central: bucle `await`, se acumulan los errores para no ocultar
   * un fallo parcial y en cualquier caso se relee el estado del servidor.
   */
  async function recuperarSeleccionadas(seleccionadas: RecepcionSateliteDTO[]) {
    if (seleccionadas.length === 0 || recuperando) return;
    setRecuperando(true);
    let recuperadas = 0;
    const errores: string[] = [];
    for (const orden of seleccionadas) {
      const result = await recuperarABodega({ ordenId: orden.id });
      if (result.status === "ok") recuperadas += 1;
      else errores.push(recuperarBodegaErrorMessage(result.status));
    }
    setRecuperando(false);
    if (recuperadas > 0) {
      toast.success(`${recuperadas} orden(es) recuperada(s) a bodega.`);
    }
    if (errores.length > 0) toast.error(errores[0]);
    await releerBodega();
  }

  /**
   * Feature 158 (T2.7) — «Reportar incidente» POR FILA. El merge del rediseño ux fundió las
   * tablas por sección en UN listado, así que la columna ya no se compone aquí: la monta
   * `SateliteOrdenesListado` y ESTE módulo sólo aporta lo que el listado no puede saber —qué
   * hacer tras el éxito—. La regla de disponibilidad (estado R41 + zona R48) sigue viviendo
   * en `incidente-satelite.ts`, que el listado aplica FILA A FILA; con una tabla única esa
   * decisión por fila es además la única posible.
   *
   * Tras el éxito se RELEE del servidor (patrón de todas las acciones de este módulo): la
   * orden pasa a `incidente` y desaparece del listado.
   */
  function handleIncidenteReportado() {
    void releerBodega();
  }

  function handleSuccess() {
    setOrdenesAAsignar([]);
    setModalOpen(false);
    void releerBodega(); // relee el estado del servidor (patrón feature 33)
  }

  /**
   * Feature 149/T6.4 (R35/R37) — abre el modal de "Deshacer asignación" con lo
   * seleccionado. El cierre de día pendiente de un mensajero NO bloquea esta acción
   * (Q1 CERRADA, R19): a diferencia de "Asignar", no mira `bloqueoBodega`.
   */
  function abrirDeshacer(ordenes: RecepcionSateliteDTO[]) {
    if (ordenes.length === 0) return;
    setOrdenesADeshacer(ordenes);
    setDeshacerOpen(true);
  }

  // R38: éxito ⇒ cierra el modal y RELEE el estado del servidor (la orden desaparece de
  // "Asignadas" y reaparece en "Recibidas").
  function handleDeshacerSuccess() {
    setOrdenesADeshacer([]);
    setDeshacerOpen(false);
    void releerBodega();
  }

  /**
   * Feature 262/F4 (R13/R14) — abre el modal de «Cambiar día de reparto» con lo seleccionado.
   * Como «Deshacer asignación» y a diferencia de «Asignar», NO mira `bloqueoBodega`: un cierre
   * de día pendiente no bloquea la corrección (R14).
   */
  function abrirCambiarDia(ordenes: RecepcionSateliteDTO[]) {
    if (ordenes.length === 0) return;
    setOrdenesACambiarDia(ordenes);
    setCambiarDiaOpen(true);
  }

  /**
   * Éxito ⇒ cierra y RELEE el estado del servidor. La orden NO cambia de estado ni de bodega
   * —sigue en `por_recoger`, con su mismo mensajero—, así que no desaparece del listado: lo que
   * cambia es su día de reparto, y releer es lo que hace que la pantalla deje de mostrar el
   * viejo.
   */
  function handleCambiarDiaSuccess() {
    setOrdenesACambiarDia([]);
    setCambiarDiaOpen(false);
    void releerBodega();
  }

  // ---------- Feature 139/T3.3 (R13/R21) — envío por lote a bodega central ----------
  // R13: "Enviar a central" recorre la selección de `por_devolver` y dispara
  // `enviarACentral({ ordenId })` por cada una (loop await, patrón DevolverATiendaModal),
  // acumulando errores para no ocultar un fallo parcial. Feedback por toast; en cualquier
  // caso se relee el estado del servidor y se limpia la selección.
  async function enviarSeleccionadasACentral(
    seleccionadas: RecepcionSateliteDTO[],
  ) {
    const ids = seleccionadas.map((orden) => orden.id);
    if (ids.length === 0) return;
    setEnviandoACentral(true);
    let enviadas = 0;
    const errores: string[] = [];
    // Feature 148/R22: solo las EFECTIVAMENTE enviadas entran al manifiesto; las que
    // fallaron quedan fuera. No cambia el manejo del resultado de negocio (R25/R27).
    const enviadasIds: string[] = [];
    for (const id of ids) {
      const result = await enviarACentral({ ordenId: id });
      if (result.status === "ok") {
        enviadas += 1;
        enviadasIds.push(id);
      } else errores.push(envioDevolucionCentralErrorMessage(result.status));
    }
    setEnviandoACentral(false);
    setUltimoEnvioACentral(enviadasIds);
    if (enviadas > 0) {
      toast.success(`${enviadas} orden(es) enviada(s) a bodega central.`);
    }
    if (errores.length > 0) toast.error(errores[0]);
    await releerBodega();
  }

  return (
    <div className="flex flex-col gap-8">
      {/* R5: aviso accionable si el adminSatelite no tiene zona asignada. */}
      {sinZona ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          No tienes una zona asignada. Pide a un administrador que te asigne una
          zona para poder recibir órdenes.
        </p>
      ) : null}

      {/* ---------- Sección: Por recibir (en_ruta_bodega_satelite) ---------- */}
      {/* Pedido humano: sin NADA por recibir, ni la tarjeta de recepción ni la lista se
          muestran — no hay guía que resolver, así que solo estorbarían. Con zona sin
          asignar (R5) tampoco: el aviso de arriba explica el porqué. */}
      {mostrarPorRecibir ? (
        <>
          {/* Recepción por guía: MISMA tarjeta que la recogida del mensajero
              (`EscanerGuiaCard`), con los dos caminos — cámara y número tecleado. */}
          <EscanerRecepcion onRecibida={() => void releerBodega()} />
          {/* Feature 63: REUTILIZA la sección compartida "por aceptar" del mensajero:
              banner con contador de nuevas + "Aceptar" por-orden (recibirLote con uno).
              Sin zona no se muestran los botones (solo se listan).
              Pedido humano del 2026-08-19: ya NO hay "Aceptar todas" — la recepción es
              orden por orden o por guía con el escáner. */}
          <PorAceptarSection
            titulo="Por recibir"
            nuevasLabel={(n) => `${n} Órdenes nuevas por recibir`}
            ordenes={porRecibir}
            onAceptarUna={(id) => void aceptarRecepcion([id])}
            textoBotonUna="Aceptar"
            vacio="No hay órdenes por recibir."
            mostrarAcciones={!sinZona}
            listClassName="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
            // Rediseño ux: la card completa la pinta el módulo (`renderItem`), con el
            // MISMO lenguaje visual que las del mensajero. "Aceptar" va al pie de cada
            // card; sin zona asignada (R5) se listan sin acción.
            renderItem={(orden) => (
              <SateliteOrderCard
                orden={orden}
                estadoLegible={estadoLegible(orden, zonaNombre)}
                acciones={
                  sinZona ? null : (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void aceptarRecepcion([orden.id])}
                    >
                      Aceptar
                    </Button>
                  )
                }
              />
            )}
          />
        </>
      ) : null}

      {/* ---------- Listado único de la bodega (pedido humano) ---------- */}
      {/* Las cuatro secciones por estado (Recibidas / Por devolver / En tránsito a
          central / Devueltas) se funden en UN listado con la barra de filtros del admin.
          Las acciones pasan a ser de LOTE sobre la selección, habilitadas según el estado
          común de lo seleccionado (ver `SateliteOrdenesListado`). */}
      {/* El separador solo tiene sentido si ARRIBA hay algo de lo que separarse: sin
          sección "Por recibir" el listado es lo primero de la pantalla. */}
      <section
        className={`flex flex-col gap-3${mostrarPorRecibir ? " border-t pt-6" : ""}`}
      >
        {/* Feature 41 (R22): aviso de bodega BLOQUEADA con causa diferenciada (bloqueo
            duro: todos los mensajeros con cierre O CierreBodega pendiente). */}
        {bloqueoBodega.bloqueada ? (
          <div
            role="alert"
            className="flex flex-col gap-1 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            <span className="font-medium">{BODEGA_BLOQUEADA_TITULO}</span>
            <ul className="list-disc pl-5">
              {bodegaBloqueadaLineas(bloqueoBodega).map((linea) => (
                <li key={linea}>{linea}</li>
              ))}
            </ul>
          </div>
        ) : (bloqueoBodega.cierresAbiertos ?? 0) > 0 ? (
          /* Ajuste admin_satelite: aviso INFORMATIVO (no bloqueante) cuando algunos —no
             todos— los mensajeros tienen un cierre abierto. La asignación sigue activa. */
          <div
            role="status"
            className="flex flex-col gap-1 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning-strong"
          >
            <span className="font-medium">
              {bodegaCierresAbiertosTitulo(bloqueoBodega.cierresAbiertos ?? 0)}
            </span>
            <span>{BODEGA_CIERRES_ABIERTOS_DETALLE}</span>
          </div>
        ) : null}

        {/* Feature 148 (T13, R22): manifiesto del ÚLTIMO envío a central, solo con las
            órdenes que salieron `ok`. Botón EXPLÍCITO (§9.7): ni descarga automática ni
            acción dentro del toast. */}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <DescargarManifiestoButton
            flujo="devolucion_central"
            seleccion={{ ordenIds: ultimoEnvioACentral }}
            label="Descargar manifiesto del último envío"
          />
        </div>

        <SateliteOrdenesListado
          // T A.5: el listado dispara la poda cuando cambia la IDENTIDAD de este array. `[]`
          // es un array nuevo en cada render, pero sólo se usa mientras `data` no ha llegado
          // —o sea, exactamente cuando `cargando` es `true`—, y con la carga en vuelo el
          // listado no comprueba nada. El guard que sostiene R24/R28 es ese, no esta línea.
          ordenes={data?.items ?? []}
          total={data?.total ?? 0}
          // R42: el «de Y» del contador es el total del conjunto SIN filtros que resolvió el
          // Server Component. Nunca sale de las filas de la página.
          totalSinFiltros={ordenesBodega.total}
          catalogo={catalogoFiltros}
          onFiltroChange={cambiarFiltro}
          cargando={cargando}
          errorCarga={error ? ERROR_CARGA : null}
          /**
           * Feature 170 (T K.3, R52) · Feature 184 (T A.4, R1/R2/R3/R6/R11) — la tabla pinta
           * UNA página; el archivo sigue siendo el CONJUNTO COMPLETO con los filtros vigentes,
           * y desde la tanda A lo pide a una lectura DEDICADA a este listado, con los tres
           * filtros ya aplicados en la base (`listarOrdenesBodegaCompleto`).
           *
           * Qué cambió y por qué importa: T K.3 releía `listarRecepcionSatelite()` —los cinco
           * grupos de la zona entera, que además resuelve «Por recibir» y el nombre de zona—
           * y volvía a filtrarlos AQUÍ con `filtrarOrdenesSatelite`. Salía bien, pero bajaba
           * al navegador filas que los filtros descartaban (R11) y dejaba el criterio escrito
           * dos veces, en dos capas y con dos formas de comparar (R16). Ahora el servidor
           * devuelve exactamente las filas del archivo y el tope de 5000 lo decide él (R6):
           * por encima no viaja ni una fila.
           *
           * El callback se construye EN EL RENDER, no en un memo: el closure lee el `filtro`
           * de ESTE render, así que la descarga refleja los filtros aplicados en el momento de
           * pulsar (R3). Baja como callback y no como filtros (design §5, patrón
           * `WalletModule`): la tabla no conoce —ni debe conocer— de dónde sale el conjunto.
           */
          obtenerFilasDescarga={() =>
            filasDesdeResultado(
              listarOrdenesBodegaCompleto({ ...filtro }),
              filaDescargaSatelite,
            )
          }
          /**
           * Feature 184 (T A.5, R18/R19): con qué se poda la selección. Mismo reparto que la
           * descarga —el módulo conoce los filtros vigentes, el listado conoce las marcas—, y
           * la decisión de CUÁNDO preguntar es del listado, que es quien sabe si hay marcas
           * fuera de la página visible (R23).
           */
          comprobarVigencia={comprobarVigencia}
          zonaNombre={zonaNombre}
          puedeAsignar={!bloqueoBodega.bloqueada}
          onAsignar={abrirAsignacion}
          onEnviarACentral={(ordenes) =>
            void enviarSeleccionadasACentral(ordenes)
          }
          onRecuperar={(ordenes) => void recuperarSeleccionadas(ordenes)}
          onDeshacerAsignacion={abrirDeshacer}
          onCambiarDiaReparto={abrirCambiarDia}
          enviandoACentral={enviandoACentral}
          recuperando={recuperando}
          // Feature 158 (T2.7): el listado necesita `sinZona` SÓLO para la regla de
          // disponibilidad del incidente (R48); las demás acciones ya llegan decididas.
          sinZona={sinZona}
          onIncidenteReportado={handleIncidenteReportado}
        />

        {/* R43: control de navegación entre páginas, con nombre accesible propio. */}
        <Pagination
          page={page}
          pageSize={pageSize}
          total={data?.total ?? 0}
          disabled={cargando}
          showFirstLast
          siblingCount={1}
          ariaLabel={PAGINACION_BODEGA_LABEL}
          onPageChange={setPage}
          onPageSizeChange={(s) => {
            setPageSize(s);
            setPage(1);
          }}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
        />
      </section>

      {/* Feature 46 (R15/R16): aviso derivado "Liberadas hoy (reprogramación)" de la
          bodega satélite (en_bodega_satelite). Datos por props; se oculta si no hay. */}
      <BodegaLiberadasHoy liberadas={liberadasHoy} />

      <AsignarSateliteModal
        open={modalOpen}
        ordenes={ordenesAAsignar}
        mensajeros={mensajeros}
        mensajerosBloqueadosIds={mensajerosBloqueadosIds}
        // Feature 246 (T4.3, R29): resueltas por la página, en el servidor. Este módulo sólo
        // las transporta.
        fechasDiaReparto={fechasDiaReparto}
        onOpenChange={setModalOpen}
        onSuccess={handleSuccess}
      />

      {/* Feature 149/T6.4 (R37/R38/R39): motivo obligatorio y traducción de errores viven
          en el modal compartido; aquí solo se le entrega el lote y se relee al terminar. */}
      <DeshacerAsignacionSateliteModal
        open={deshacerOpen}
        ordenes={ordenesADeshacer}
        onOpenChange={setDeshacerOpen}
        onSuccess={handleDeshacerSuccess}
      />

      {/* Feature 262/F4 (R13/R17): el selector sin preselección, el motivo obligatorio y la
          traducción de errores viven en el modal COMPARTIDO con `/ordenes`; aquí sólo se le
          entrega el lote y las dos fechas que resolvió la página, y se relee al terminar. */}
      <CambiarDiaRepartoSateliteModal
        open={cambiarDiaOpen}
        ordenes={ordenesACambiarDia}
        fechasDiaReparto={fechasDiaReparto}
        onOpenChange={setCambiarDiaOpen}
        onSuccess={handleCambiarDiaSuccess}
      />
    </div>
  );
}
