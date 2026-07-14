"use client";

import { useMemo, useState } from "react";
import useSWR, { useSWRConfig } from "swr";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import type { OrderStatusLiteRow } from "@/lib/interfaces/repositories/IOrdenRepository";
import { listarOrderStatus } from "@/lib/actions/order-status";
import { listarMensajerosParaAsignacion } from "@/lib/actions/ordenes-guia";
import type { OrdenListItemDTO } from "@/lib/types/orden";

import { OrdenesModule, type AccionLote } from "./OrdenesModule";
import { OrdenesCargaMasivaButton } from "./OrdenesCargaMasivaButton";
import { ORDER_STATUS_LABELS } from "./EstatusBadge";
import { GenerarGuiaModal } from "./GenerarGuiaModal";
import { AsignarBodegaModal } from "./AsignarBodegaModal";
import { RutearSateliteModal } from "./RutearSateliteModal";
import { EtiquetasGuiaModal } from "./EtiquetasGuiaModal";
import { DevolverATiendaModal } from "./DevolverATiendaModal";

type ModalAbierto =
  | "generar-guia"
  | "asignar-bodega"
  | "rutear-satelite"
  | "etiquetas"
  | "devolver-tienda"
  | null;

async function mensajerosFetcher() {
  const res = await listarMensajerosParaAsignacion();
  if (res.status !== "ok") throw new Error(res.status);
  return res.mensajeros;
}

// Feature 63/C3 (F1.4-c): `exclude` es por `value` del estado; default
// `["pendiente"]` (borrador transitorio recién sembrado). El backend NO recibe
// `exclude`: `listarOrderStatus()` devuelve el catálogo COMPLETO (R1) y el front
// filtra antes de mapear a tabs (aclaración del humano, R14).
const DEFAULT_EXCLUDE = ["pendiente"];

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
  mostrarHistorial = false,
  accionesLote = false,
}: {
  exclude?: string[];
  puedeCargarMasiva?: boolean;
  mostrarHistorial?: boolean;
  /**
   * Habilita la selección por checkbox + barra de acciones por lote por estado
   * (asignar mensajero, rutear a bodega satélite, generar guía, imprimir etiquetas,
   * devolver a tienda), restaurando la vista de revisión del maestro dentro de las
   * tabs. Solo para `maestro` (las Server Actions son maestro-only); `admin`
   * (solo-lectura) y `adminTienda` lo reciben en `false`.
   */
  accionesLote?: boolean;
}) {
  const { mutate } = useSWRConfig();
  const { data: catalogo, isLoading } = useSWR(
    "order-status:catalogo",
    catalogoFetcher,
  );

  // Mensajeros para los modales de asignación (solo si hay acciones por lote).
  const { data: mensajeros } = useSWR(
    accionesLote ? "ordenes:mensajeros" : null,
    mensajerosFetcher,
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
  // "Rutear a bodega satélite" solo aplica a órdenes NO-GAM (`zonaEsGam === false`);
  // se filtra el snapshot antes de abrir el modal (el service revalida).
  function abrirRutearSatelite(seleccionadas: OrdenListItemDTO[]) {
    setOrdenesSeleccionadas(seleccionadas.filter((o) => o.zonaEsGam === false));
    setModalAbierto("rutear-satelite");
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

  // Mapeo estado -> acciones por lote (mismo comportamiento que la vista de revisión
  // previa, OrdenesRevisionMaestro). Sin `accionesLote` no hay acciones (undefined).
  function accionesDe(estatusValue: string): AccionLote[] {
    switch (estatusValue) {
      case "en_fulfillment":
      case "en_preparacion":
        return [
          { key: "guia", label: "Generar guía", onRun: abrirGenerarGuia },
          {
            key: "rutear",
            label: "Rutear a bodega satélite",
            variant: "outline",
            onRun: abrirRutearSatelite,
          },
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
            key: "rutear",
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
  // cargado el catálogo. Las demás quedan sin montar hasta ser visitadas.
  const activeValue = active ?? tabs[0]?.id ?? null;

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

  // La carga masiva vive a nivel del contenedor (no por tab): es una acción de
  // creación de órdenes, independiente del estado activo. Se ofrece solo al
  // adminTienda (feature 26), vía `puedeCargarMasiva`.
  const header = puedeCargarMasiva ? (
    <div className="flex justify-end">
      <OrdenesCargaMasivaButton />
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

  if (tabs.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <p className="text-sm text-muted-foreground">
          No hay estados disponibles.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {header}
      <Tabs
        value={activeValue}
        onValueChange={(value) => setActive(value as string)}
      >
        {/* R18: scroll horizontal usable con ~13 tabs (overflow-x-auto en TabsList). */}
        <TabsList aria-label="Órdenes por estado">
          {tabs.map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id}>
              {labelDe(tab.value)}
            </TabsTrigger>
          ))}
        </TabsList>

        {tabs.map((tab) => (
          // keepMounted: una vez montado (visitado) el panel permanece en el DOM
          // para conservar el estado del OrdenesModule (paginación) al cambiar de
          // tab (R17). Su contenido solo se monta si la tab fue visitada (R16).
          <TabsContent key={tab.id} value={tab.id} keepMounted>
            {visited.has(tab.id) ? (
              (() => {
                // Selección por checkbox SOLO en estados que tienen alguna acción por
                // lote (evita checkboxes inertes en estados solo-lectura).
                const acc = accionesLote ? accionesDe(tab.value) : [];
                return (
                  <OrdenesModule
                    filter={{ status_id: tab.id }}
                    mostrarHistorial={mostrarHistorial}
                    selectable={acc.length > 0}
                    acciones={acc}
                  />
                );
              })()
            ) : null}
          </TabsContent>
        ))}
      </Tabs>

      {/* Modales de acción por lote (solo maestro): mismos componentes/acciones que
          la vista de revisión previa. Montados una vez; `open` por `modalAbierto`. */}
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
          <RutearSateliteModal
            open={modalAbierto === "rutear-satelite"}
            ordenes={ordenesSeleccionadas}
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
