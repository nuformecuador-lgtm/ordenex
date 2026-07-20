"use client";

import { useMemo, useState } from "react";
import useSWR, { useSWRConfig } from "swr";

import { TabsGroup, type TabItem } from "@/components/shared/TabsGroup";
import { Skeleton } from "@/components/ui/skeleton";
import type { OrderStatusLiteRow } from "@/lib/interfaces/repositories/IOrdenRepository";
import { listarOrderStatus } from "@/lib/actions/order-status";
import {
  listarMensajerosParaAsignacion,
  listarZonasBloqueadasPorCierre,
} from "@/lib/actions/ordenes-guia";
import type { Column } from "@/components/shared/DataTable";
import type { OrdenListItemDTO } from "@/lib/types/orden";

import { OrdenesModule, type AccionLote } from "./OrdenesModule";
import { OrdenesCargaMasivaButton } from "./OrdenesCargaMasivaButton";
import { EscanerRecepcionOrigen } from "./EscanerRecepcionOrigen";
import { ORDER_STATUS_LABELS } from "./EstatusBadge";
import {
  ordenesColumnsMensajeroSugerido,
  ordenesColumnsReprogramada,
} from "./ordenes-columns";
import { GenerarGuiaModal } from "./GenerarGuiaModal";
import { AsignarBodegaModal } from "./AsignarBodegaModal";
import { EtiquetasGuiaModal } from "./EtiquetasGuiaModal";
import { DevolverATiendaModal } from "./DevolverATiendaModal";

type ModalAbierto =
  | "generar-guia"
  | "asignar-bodega"
  | "etiquetas"
  | "devolver-tienda"
  | null;

async function mensajerosFetcher() {
  const res = await listarMensajerosParaAsignacion();
  if (res.status !== "ok") throw new Error(res.status);
  // `bloqueadosIds` (mensajeros GAM con cierre abierto) NO se usa en esta vista: el
  // bloqueo del checkbox se deriva por ZONA de la orden (`zonasBloqueadasFetcher`).
  // Se mantiene en el objeto porque la key SWR "ordenes:mensajeros" la comparte
  // OrdenesRevisionMaestro, que sí lo consume (selector de mensajeros del modal):
  // dos fetchers con la misma key deben devolver la MISMA forma.
  return { mensajeros: res.mensajeros, bloqueadosIds: res.bloqueadosIds ?? [] };
}

/**
 * Zonas (central GAM y satélites, misma regla) con AL MENOS 1 mensajero con un cierre
 * abierto (`solicitado`/`vencido`). Alimenta el bloqueo POR ORDEN del checkbox en las
 * tabs cuya acción por lote asigna/rutea: mientras la zona de la orden esté bloqueada
 * no se le puede asignar mensajero, así que no se deja seleccionar.
 */
async function zonasBloqueadasFetcher(): Promise<Set<string>> {
  const res = await listarZonasBloqueadasPorCierre();
  if (res.status !== "ok") throw new Error(res.status);
  return new Set(res.zonasBloqueadasIds);
}

// Feature 63/C3 (F1.4-c): `exclude` es por `value` del estado; default
// `["pendiente"]` (borrador transitorio recién sembrado). El backend NO recibe
// `exclude`: `listarOrderStatus()` devuelve el catálogo COMPLETO (R1) y el front
// filtra antes de mapear a tabs (aclaración del humano, R14).
const DEFAULT_EXCLUDE = ["pendiente"];

// Estados PREVIOS a la asignación de mensajero: muestran "Mensajero sugerido" en
// lugar de "Mensajero" (aún no hay asignado; la asignación es en "Generar guía").
const ESTADOS_MENSAJERO_SUGERIDO = new Set(["en_fulfillment", "en_preparacion"]);

// Estado cuya tab muestra ademas "Liberada el" (la fecha para la que quedo
// reprogramada = el dia en que el cron de liberacion la desbloquea, feature 46).
const ESTADO_REPROGRAMADA = "reprogramada";

// Estado cuya tab bloquea la seleccion de las ordenes NO centrales: "Devolver a la
// tienda" (rechazada -> devuelta_origen) la ejecuta la bodega RESPONSABLE, y para el
// maestro/admin eso es solo la bodega central (zonaEsGam). Las satelite las devuelve
// el adminSatelite de la zona (en /recepcion-satelite), asi que su check se bloquea
// en vez de dejar seleccionarlas y vaciar el modal.
const ESTADO_RECHAZADA = "rechazada";
const MOTIVO_RECHAZADA_NO_CENTRAL =
  "Orden de zona satélite: la devuelve el admin de la bodega satélite de su zona.";

// Estados cuya acción por lote ASIGNA mensajero: ahí el checkbox se bloquea POR
// ORDEN si la zona de esa orden tiene ≥1 mensajero con cierre abierto.
// Derivado de `accionesDe()`: `en_fulfillment`/`en_preparacion` -> "Generar guía"
// (asigna mensajero) y `en_bodega` -> "Asignar mensajero".
// Las tabs que solo imprimen etiquetas (`en_espera_aceptacion`,
// `en_ruta_bodega_satelite`) NO se bloquean: no asignan nada.
// Nota: en `en_bodega` el bloqueo también alcanza a "Imprimir etiquetas" (comparte el
// checkbox); es el precio de una única columna de selección por tab.
const ESTADOS_ASIGNACION = new Set([
  "en_fulfillment",
  "en_preparacion",
  "en_bodega",
]);
const MOTIVO_ZONA_CIERRE_ABIERTO =
  "La bodega de esta zona tiene al menos un cierre de mensajero abierto: resuélvelo para poder asignar la orden.";

// Tab sintético "Todas" (solo maestro): lista las órdenes SIN filtro de estado.
// Su id no colisiona con ningún `order_status.id` (ids de DB), así que sirve de
// value único en TabsGroup y en el set `visited`.
const TODAS_TAB_ID = "__todas__";
const TODAS_TAB_LABEL = "Todas";

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
 * Feature 63/C3 (R12-R19): agrupa las órdenes por estado en tabs para roles ≠
 * mensajero. Deriva las tabs del catálogo `order_status` (SWR sobre
 * `listarOrderStatus()`) menos `exclude` (R14). Cada tab monta un `OrdenesModule`
 * (reuso, R19) con `filter={{status_id}}` propio, de modo que la caché y la
 * paginación son independientes por estado (R15/R17).
 *
 * LAZY LOADING DURO (R16): una tab NUNCA visitada NO monta su `OrdenesModule` y,
 * por ende, NO invoca `listarOrdenes`. El contenido de cada tab se monta SOLO la
 * primera vez que esa tab se activa (set `visited`); no basta con ocultarlo por
 * CSS. Al volver a una tab ya visitada, su `OrdenesModule` sigue montado
 * (`keepMounted`), conservando su estado/paginación y sirviendo de la caché SWR.
 */
export function OrdenesTabs({
  exclude = DEFAULT_EXCLUDE,
  puedeCargarMasiva = false,
  puedeEscanearQr = false,
  mostrarHistorial = false,
  accionesLote = false,
  incluirTodas = false,
  orientation = "horizontal",
}: Readonly<{
  exclude?: string[];
  /**
   * Disposición de las tabs (`TabsGroup`). `vertical` las pone en columna a la
   * izquierda del listado y añade un input para filtrarlas por nombre de estado:
   * con ~13 estados es más rápido que barrer el scroll horizontal. Se usa en la
   * vista del `maestro`; `admin`/`adminTienda` siguen en `horizontal`.
   */
  orientation?: "horizontal" | "vertical";
  puedeCargarMasiva?: boolean;
  /**
   * Ofrece "Escanear con cámara" junto a la carga masiva: el adminTienda escanea el
   * QR de la etiqueta de una orden que vuelve ("En ruta a origen") y la marca como
   * recibida en su tienda (`devuelta_origen` -> `recibido_origen`), sin salir del
   * listado. NO navega (para eso está `/qr`).
   */
  puedeEscanearQr?: boolean;
  mostrarHistorial?: boolean;
  /**
   * Habilita la selección por checkbox + barra de acciones por lote por estado
   * (asignar mensajero, generar guía, imprimir etiquetas, devolver a tienda)
   * dentro de las tabs. Solo para `maestro` (las Server Actions son maestro-only);
   * `admin` (solo-lectura) y `adminTienda` lo reciben en `false`.
   */
  accionesLote?: boolean;
  /**
   * Antepone una tab "Todas" (activa por defecto) que lista las órdenes SIN filtro
   * de estado. Solo la usa el `maestro`: es una vista global de lectura, sin
   * acciones por lote (esas son por estado). Los demás roles no la reciben.
   */
  incluirTodas?: boolean;
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
  function abrirEtiquetas(seleccionadas: OrdenListItemDTO[]) {
    setOrdenesSeleccionadas(seleccionadas);
    setModalAbierto("etiquetas");
  }
  // "Devolver a la tienda" solo aplica a órdenes de la bodega CENTRAL
  // (`zonaEsGam === true`); se filtra antes de abrir (el backend revalida).
  function abrirDevolver(seleccionadas: OrdenListItemDTO[]) {
    setOrdenesSeleccionadas(seleccionadas.filter((o) => o.zonaEsGam === true));
    setModalAbierto("devolver-tienda");
  }

  function cerrarModal(open: boolean) {
    if (!open) setModalAbierto(null);
  }
  function handleSuccess() {
    setModalAbierto(null);
    // Revalida TODAS las tablas por tab (comparten el prefijo de key SWR).
    void mutate(
      (key) => Array.isArray(key) && key[0] === "ordenes:list",
      undefined,
      { revalidate: true },
    );
  }

  // Mapeo estado -> acciones por lote. Sin `accionesLote` no hay acciones (undefined).
  // Nota: "Rutear a bodega satélite" NO se ofrece en esta vista de tabs (se retiró de
  // `en_bodega` por decisión humana). La vista legacy OrdenesRevisionMaestro sí la
  // ofrece, así que la paridad con esa vista ya no es total.
  function accionesDe(estatusValue: string): AccionLote[] {
    switch (estatusValue) {
      case "en_fulfillment":
      case "en_preparacion":
        return [
          { key: "guia", label: "Generar guía", onRun: abrirGenerarGuia },
        ];
      case "en_espera_aceptacion":
        return [
          { key: "etiquetas", label: "Imprimir etiquetas", onRun: abrirEtiquetas },
        ];
      case "en_bodega":
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
        return [
          { key: "etiquetas", label: "Imprimir etiquetas", onRun: abrirEtiquetas },
        ];
      case "rechazada":
        return [
          {
            key: "devolver",
            label: "Devolver a la tienda",
            onRun: abrirDevolver,
          },
        ];
      default:
        return [];
    }
  }

  // R14: tabs = catálogo − exclude (por value), en el orden determinista del
  // catálogo (R5). Se filtra en el front antes de mapear a tabs.
  const tabs = useMemo<OrderStatusLiteRow[]>(
    () => (catalogo ?? []).filter((s) => !exclude.includes(s.value)),
    [catalogo, exclude],
  );

  const [active, setActive] = useState<string | null>(null);
  // R16: solo las tabs efectivamente activadas alguna vez montan su contenido.
  const [visited, setVisited] = useState<Set<string>>(() => new Set());

  // Primera tab disponible = activa por defecto (y por tanto visitada), una vez
  // cargado el catálogo. Con `incluirTodas`, la tab "Todas" va primero y es la
  // activa por defecto. Las demás quedan sin montar hasta ser visitadas.
  const activeValue =
    active ?? (incluirTodas ? TODAS_TAB_ID : tabs[0]?.id) ?? null;

  // Patrón "ajustar estado durante el render" (React): registra la tab activa
  // como visitada de forma persistente, sin un efecto post-paint. Una vez
  // visitada, la tab permanece en `visited` aunque deje de ser la activa, de
  // modo que su `OrdenesModule` sigue montado y conserva su paginación (R17).
  if (activeValue && !visited.has(activeValue)) {
    setVisited((prev) => {
      if (prev.has(activeValue)) return prev;
      const next = new Set(prev);
      next.add(activeValue);
      return next;
    });
  }

  // La carga masiva y el escaneo viven a nivel del contenedor (no por tab): son
  // acciones independientes del estado activo. Se ofrecen solo al adminTienda
  // (feature 26), vía `puedeCargarMasiva` / `puedeEscanearQr`.
  const header =
    puedeCargarMasiva || puedeEscanearQr ? (
      <div className="flex flex-col items-end gap-3">
        <div className="flex flex-wrap items-center justify-end gap-2">
          {puedeEscanearQr ? (
            <EscanerRecepcionOrigen onRecibida={handleSuccess} />
          ) : null}
          {puedeCargarMasiva ? <OrdenesCargaMasivaButton /> : null}
        </div>
      </div>
    ) : null;

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <Skeleton className="h-40 w-full" data-testid="ordenes-tabs-loading" />
      </div>
    );
  }

  if (tabs.length === 0 && !incluirTodas) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <p className="text-sm text-muted-foreground">
          No hay estados disponibles.
        </p>
      </div>
    );
  }

  /**
   * Contenido de una tab. R16 (lazy loading duro): si la tab NUNCA se visitó
   * devuelve `null`, así su `OrdenesModule` no se monta y no invoca `listarOrdenes`.
   */
  function contenidoDe(tab: OrderStatusLiteRow): React.ReactNode {
    if (!visited.has(tab.id)) return null;
    // Selección por checkbox SOLO en estados que tienen alguna acción por
    // lote (evita checkboxes inertes en estados solo-lectura).
    const acc = accionesLote ? accionesDe(tab.value) : [];
    // Columnas por estado: en_fulfillment/en_preparacion muestran
    // "Mensajero sugerido" en vez de "Mensajero"; reprogramada añade
    // "Liberada el" (el día en que el cron la desbloquea).
    let columns: Column<OrdenListItemDTO>[] | undefined;
    if (ESTADOS_MENSAJERO_SUGERIDO.has(tab.value)) {
      columns = ordenesColumnsMensajeroSugerido;
    } else if (tab.value === ESTADO_REPROGRAMADA) {
      columns = ordenesColumnsReprogramada;
    }
    // Bloqueo de selección por tab (dos reglas distintas que conviven):
    // - `rechazada`: bloquea el check de las órdenes NO centrales (el
    //   maestro/admin solo devuelve a la tienda las de la bodega central).
    //   Es la regla MÁS ESPECÍFICA de esa tab (la acción "Devolver a la
    //   tienda" no asigna mensajero), así que se evalúa primero y gana; en
    //   la práctica no se solapan porque `rechazada` no es tab de asignación.
    // - tabs de asignación/ruteo: bloqueo POR ORDEN si la ZONA de esa orden
    //   tiene ≥1 mensajero con cierre abierto. No es global: en la misma tab
    //   conviven órdenes de zona bloqueada (check off) y de zona libre (on).
    let bloqueoSeleccion: ((row: OrdenListItemDTO) => string | null) | undefined;
    if (tab.value === ESTADO_RECHAZADA) {
      bloqueoSeleccion = (o) =>
        o.zonaEsGam === true ? null : MOTIVO_RECHAZADA_NO_CENTRAL;
    } else if (ESTADOS_ASIGNACION.has(tab.value)) {
      const zonas = zonasBloqueadas;
      bloqueoSeleccion = (o) => {
        // Sin datos aún (SWR en vuelo) o sin `zonaId` utilizable: NO se
        // bloquea. No se puede AFIRMAR que la zona esté bloqueada, y el
        // backend revalida la regla al ejecutar la acción (defensa en
        // profundidad); bloquear "por si acaso" castigaría órdenes válidas.
        // (`zonaId` es `string` en el DTO; la guarda es defensiva ante un
        // dato degradado en runtime.)
        if (!zonas || !o.zonaId) return null;
        return zonas.has(o.zonaId) ? MOTIVO_ZONA_CIERRE_ABIERTO : null;
      };
    }
    return (
      <OrdenesModule
        filter={{ status_id: tab.id }}
        columns={columns}
        mostrarHistorial={mostrarHistorial}
        selectable={acc.length > 0}
        bloqueoSeleccion={bloqueoSeleccion}
        acciones={acc}
      />
    );
  }

  /**
   * Contenido de la tab "Todas": `OrdenesModule` SIN `filter` (todas las órdenes,
   * sin acotar por estado), con lazy loading duro como el resto. Es solo-lectura:
   * las acciones por lote son por estado, así que aquí no hay selección.
   */
  function contenidoTodas(): React.ReactNode {
    if (!visited.has(TODAS_TAB_ID)) return null;
    return <OrdenesModule mostrarHistorial={mostrarHistorial} />;
  }

  const statusItems: TabItem[] = tabs.map((tab) => ({
    value: tab.id,
    label: labelDe(tab.value),
    content: contenidoDe(tab),
  }));
  const items: TabItem[] = incluirTodas
    ? [
        { value: TODAS_TAB_ID, label: TODAS_TAB_LABEL, content: contenidoTodas() },
        ...statusItems,
      ]
    : statusItems;

  return (
    <div className="flex flex-col gap-4">
      {header}
      {/* R18: con ~13 tabs el listado sigue usable — `horizontal` scrollea en X;
          `vertical` (maestro) las apila y ofrece el filtro por nombre de estado.
          `keepMounted`: el panel de una tab ya visitada permanece en el DOM al
          cambiar de tab, conservando la paginación de su OrdenesModule (R17). */}
      <TabsGroup
        items={items}
        orientation={orientation}
        value={activeValue ?? undefined}
        onValueChange={setActive}
        keepMounted
        filterPlaceholder="Filtrar estados…"
        emptyFilterMessage="Ningún estado coincide"
        ariaLabel="Órdenes por estado"
      />

      {/* Modales de acción por lote (solo maestro). Montados una vez; `open` por
          `modalAbierto`. */}
      {accionesLote ? (
        <>
          <GenerarGuiaModal
            open={modalAbierto === "generar-guia"}
            ordenes={ordenesSeleccionadas}
            mensajeros={mensajeros ?? []}
            onOpenChange={cerrarModal}
            onSuccess={handleSuccess}
          />
          <AsignarBodegaModal
            open={modalAbierto === "asignar-bodega"}
            ordenes={ordenesSeleccionadas}
            mensajeros={mensajeros ?? []}
            onOpenChange={cerrarModal}
            onSuccess={handleSuccess}
          />
          <EtiquetasGuiaModal
            open={modalAbierto === "etiquetas"}
            ordenes={ordenesSeleccionadas}
            onOpenChange={cerrarModal}
          />
          <DevolverATiendaModal
            open={modalAbierto === "devolver-tienda"}
            ordenes={ordenesSeleccionadas}
            onOpenChange={cerrarModal}
            onSuccess={handleSuccess}
          />
        </>
      ) : null}
    </div>
  );
}
