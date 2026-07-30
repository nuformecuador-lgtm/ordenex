"use client";

import { useMemo, useState } from "react";
import { Inbox } from "lucide-react";
import useSWR from "swr";

import { DataTable } from "@/components/shared/DataTable";
import type { Column, DataTableDescarga } from "@/components/shared/DataTable";
import {
  conBadgePrioridad,
  resaltarFilaPrioridad,
} from "@/components/shared/PrioridadResalte";
import { Pagination } from "@/components/shared/Pagination";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { SelectAllCheckbox } from "@/components/shared/SelectAllCheckbox";
import { ordenesConfig } from "@/lib/config/ordenes";
import { listarOrdenes, listarOrdenesCompleto } from "@/lib/actions/ordenes";
import type { OrdenListItemDTO } from "@/lib/types/orden";
import { messageFromActionError } from "@/lib/utils/action-error-message";

import { ordenesColumns } from "./ordenes-columns";
import {
  COLUMNAS_DESCARGA_ORDENES,
  filaDescargaOrden,
} from "./ordenes-descarga-columnas";
import { serializarFiltro, type OrdenesFilterUI } from "./serializar-filtro";
import { OrdenesCargaMasivaButton } from "./OrdenesCargaMasivaButton";
import { HistorialOrdenSheet } from "./HistorialOrdenSheet";
import { EtiquetaOrdenAccion } from "./EtiquetaOrdenAccion";
import { ReportarIncidenteAccion } from "./ReportarIncidenteAccion";

/**
 * Acción por lote ofrecida en la barra contextual cuando hay filas seleccionadas.
 * `onRun` recibe el snapshot de las órdenes marcadas (el orquestador decide el modal
 * y el filtrado por zona). El estado (tab) decide qué acciones aplican.
 */
export interface AccionLote {
  key: string;
  label: string;
  variant?: "default" | "outline";
  onRun: (seleccionadas: OrdenListItemDTO[]) => void;
}

// R33: opciones firmes acotadas por MAX_PAGE_SIZE del backend; ninguna opción
// ofrecida supera el máximo permitido.
const PAGE_SIZE_OPTIONS = [10, 25, 50].filter(
  (s) => s <= ordenesConfig.MAX_PAGE_SIZE,
);

interface OrdenesPageData {
  items: OrdenListItemDTO[];
  total: number;
  pageSize: number;
}

async function ordenesFetcher(
  page: number,
  pageSize: number,
  filter?: OrdenesFilterUI,
): Promise<OrdenesPageData> {
  // Feature 63/C2 (R15/R19): con `filter` se inyecta el `status_id` a la action
  // (whitelist server-side -> where.estatusId). Feature 144: el mismo `filter`
  // transporta zona/tienda/geografía/tiempo (misma whitelist). Sin `filter`, el
  // input es idéntico al previo (R10/R45, sin regresión).
  const res = await listarOrdenes(filter ? { page, pageSize, filter } : { page, pageSize });
  if (res.status !== "ok") throw new Error("list_failed");
  // items incluyen tiendaNombre; total viene del backend (R25).
  return { items: res.items, total: res.total, pageSize: res.pageSize };
}

// Feature 151 (design §7) — título del dataset: nombre de la hoja, base del nombre de
// archivo (`ordenes-YYYY-MM-DD.xlsx`, R37) y parte del nombre accesible del control.
const TITULO_DESCARGA = "Órdenes";

/**
 * R20 — Mensaje ACCIONABLE del tope: dice el total encontrado, el tope vigente y qué
 * hacer (acotar los filtros). Solo lleva conteos, nunca PII. El tope lo decide y lo
 * aplica el SERVICIO; aquí solo se redacta lo que devolvió.
 */
function mensajeLimite(total: number, limite: number): string {
  return `La descarga supera el máximo de ${limite} filas (hay ${total}). Acota los filtros —por ejemplo, el rango de fechas o el estado— y vuelve a intentarlo.`;
}

// R27 — Cola accionable del resto de fallos: el mensaje canónico del error dice QUÉ
// pasó; esto dice qué hacer a continuación.
const SUFIJO_REINTENTO = "Vuelve a intentarlo; el listado no cambió.";

/**
 * Módulo de órdenes reutilizable: tabla + paginación + carga masiva sobre la
 * action `listarOrdenes` (SWR). Única implementación de tabla/fetch (feature 26,
 * R10). La prop `columns` es de presentación: por defecto muestra las 5 columnas
 * de `/ordenes`; el dashboard del admin de tienda la sustituye por la variante
 * sin "Tienda" (R11). Sin la prop, el comportamiento es idéntico al `/ordenes`
 * previo.
 *
 * Feature 49 (T6.2, R28/R29): con `mostrarHistorial` se añade una columna de acción
 * "Ver historial" por fila que abre el drawer `HistorialOrdenSheet` (datos por props via
 * Server Action). Por defecto `false` para NO alterar el contrato de columnas de otras
 * superficies (p. ej. el dashboard del adminTienda, feature 26).
 */
export function OrdenesModule({
  columns = ordenesColumns,
  puedeCargarMasiva = false,
  mostrarHistorial = false,
  filter,
  selectable = false,
  bloqueoSeleccion,
  acciones,
  resaltarPrioridad = false,
  permitirDescarga = false,
  puedeReportarIncidente = false,
}: {
  columns?: Column<OrdenListItemDTO>[];
  puedeCargarMasiva?: boolean;
  mostrarHistorial?: boolean;
  /**
   * Feature 63/C2 (R15): filtro opcional por estado de orden. Se inyecta a
   * `listarOrdenes` y entra en la key SWR, de modo que cada combinación de
   * estados tiene su propia caché y paginación. `status_id` admite UN id o una
   * LISTA de ids (filtro multi-estado del selector de `/ordenes`, que sustituyó a
   * las tabs por estado); el backend traduce la lista a `IN (...)`. Sin la prop, el
   * módulo se comporta idéntico al listado plano previo (R10/R19, sin regresión).
   *
   * Feature 144 (R30/R58): admite además las claves de zona, tienda, provincia,
   * cantón, distrito y tiempo (`created_preset` / `created_desde` / `created_hasta`),
   * todas de la MISMA lista blanca server-side. El módulo no las interpreta: las
   * pasa tal cual y las serializa para la key de caché.
   */
  filter?: OrdenesFilterUI;
  /**
   * Habilita la columna de checkbox por fila (selección por lote, solo maestro).
   *
   * Admite un PREDICADO sobre las filas de la página: con una sola tabla para varios
   * estados, una vista acotada a estados sin acción por lote (p. ej. `rechazada`)
   * mostraría una columna entera de casillas inertes. El predicado deja decidir "aquí
   * no hay nada que seleccionar" mirando los datos. Es distinto de `bloqueoSeleccion`:
   * ese bloquea filas concretas SIN quitar la columna (el motivo debe poder leerse).
   */
  selectable?: boolean | ((items: OrdenListItemDTO[]) => boolean);
  /**
   * Predicado de bloqueo por fila: devuelve el MOTIVO (texto) si la orden NO puede
   * seleccionarse, o `null` si sí. Cuando devuelve motivo, el checkbox se deshabilita
   * y el texto va en su tooltip. Se usa cuando una acción del estado no aplica a
   * todas las filas (p. ej. la tab `rechazada`: la bodega central solo devuelve a la
   * tienda las órdenes de su zona; las satélite las devuelve el adminSatelite). Sin
   * el predicado, todas las filas son seleccionables.
   */
  bloqueoSeleccion?: (row: OrdenListItemDTO) => string | null;
  /**
   * Acciones por lote disponibles para este listado. Se muestran en una barra
   * contextual SOLO cuando hay ≥1 fila marcada. Sin acciones o sin selección, no se
   * muestra la barra. La columna de checkbox depende de `selectable`.
   *
   * Admite una FUNCIÓN de la selección actual: con un listado de estados mezclados
   * (filtro multi-estado) las acciones aplicables dependen de qué filas se marcaron,
   * no del listado. Se evalúa en cada render con el snapshot de la selección.
   */
  acciones?: AccionLote[] | ((seleccionadas: OrdenListItemDTO[]) => AccionLote[]);
  /**
   * Feature 101/R8: resalta las filas de órdenes con `prioridad === true` (color
   * llamativo + badge "Prioritaria" accesible). Se activa SOLO en la superficie de
   * reasignación de la bodega dueña (`/ordenes` filtrado a `en_bodega_central`, gateado por
   * `OrdenesListado`); por defecto `false`, de modo que el resto de listados (otros
   * estados, sin filtro, dashboard adminTienda, listado plano) no resaltan por prioridad (R10).
   */
  resaltarPrioridad?: boolean;
  /**
   * Feature 151 (R33/R36, design §7): ofrece la descarga del dataset COMPLETO
   * correspondiente a los filtros vigentes. Opt-in y por defecto `false`, de modo que
   * el dashboard del adminTienda y el resto de superficies que montan este módulo no
   * cambian (R24/R38).
   */
  permitirDescarga?: boolean;
  /**
   * Feature 158 (T2.7, Q-H): ofrece la acción POR FILA "Reportar incidente". Opt-in y por
   * defecto `false`, de modo que ninguna superficie previa cambia. La página la enciende sólo
   * para roles de ACCESO TOTAL (maestro/admin); la acción se auto-oculta además en las filas
   * cuyo estado no admite el reporte (R41) y el servidor revalida rol y alcance (R48).
   *
   * NO es una acción por LOTE a propósito: un incidente pide causa, motivo y fotos por orden.
   */
  puedeReportarIncidente?: boolean;
} = {}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(ordenesConfig.DEFAULT_PAGE_SIZE);
  const [seleccionIds, setSeleccionIds] = useState<Set<string>>(new Set());

  function toggleSeleccion(id: string, checked: boolean) {
    setSeleccionIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleTodos(ids: string[], checked: boolean) {
    setSeleccionIds((prev) => {
      const next = new Set(prev);
      if (checked) ids.forEach((id) => next.add(id));
      else ids.forEach((id) => next.delete(id));
      return next;
    });
  }

  // Feature 63/C2 (R17) + Feature 144 (R61): el filtro entra en la key SWR para que
  // la caché y la paginación sean por combinación de filtros. La key debe ser un
  // ESCALAR estable: `serializarFiltro` ordena claves y valores, así que dos
  // selecciones equivalentes (en distinto orden o de distinta identidad de objeto)
  // comparten caché en vez de refetchear en cada render.
  const filterKey = serializarFiltro(filter);
  const { data, error, isLoading } = useSWR(
    ["ordenes:list", filterKey, page, pageSize],
    () => ordenesFetcher(page, pageSize, filter),
  );

  // Al cambiar CUALQUIER filtro, la página actual puede no existir en el nuevo
  // resultado (p. ej. estabas en la 4 y ahora hay 1). Se vuelve a la 1 y se limpia la
  // selección (las filas marcadas ya no están a la vista). Patrón "ajustar estado
  // durante el render": evita el parpadeo de un fetch a la página vieja en un efecto.
  const [filterKeyPrevio, setFilterKeyPrevio] = useState(filterKey);
  if (filterKey !== filterKeyPrevio) {
    setFilterKeyPrevio(filterKey);
    setPage(1);
    setSeleccionIds(new Set());
  }

  const items = data?.items ?? [];

  // ¿Se monta la columna de checkbox? Con un predicado, lo deciden las filas de la
  // página. NO se usa `bloqueoSeleccion` para esto: una página en la que todas las
  // filas están bloqueadas por una condición temporal (zona con cierre abierto) debe
  // seguir mostrando las casillas para que su motivo sea legible.
  const haySeleccion =
    typeof selectable === "function" ? selectable(items) : selectable;

  const columnasEfectivas = useMemo<Column<OrdenListItemDTO>[]>(() => {
    // Feature 101/R8: en la superficie de reasignación (`en_bodega_central`) las columnas de
    // DATOS se decoran para anexar el badge "Prioritaria" a las filas prioritarias.
    // Se decora ANTES de anteponer el checkbox, así el badge cae en la primera columna
    // de datos (Nº Guía), no en la de selección. Sin `resaltarPrioridad`, sin cambio.
    const columnasDatos = resaltarPrioridad ? conBadgePrioridad(columns) : columns;
    // Columna de selección (checkbox) al frente cuando el listado es seleccionable.
    const conSeleccion: Column<OrdenListItemDTO>[] = haySeleccion
      ? [
          {
            id: "seleccionar",
            value: "Seleccionar",
            // Cabecera = checkbox "seleccionar todo" sobre las filas SELECCIONABLES de la
            // página (excluye las bloqueadas por `bloqueoSeleccion`, que no se pueden marcar).
            renderHeader: () => {
              const ids = items
                .filter((row) => (bloqueoSeleccion?.(row) ?? null) === null)
                .map((row) => row.id);
              return (
                <SelectAllCheckbox
                  selectableIds={ids}
                  selectedIds={seleccionIds}
                  onToggleAll={(checked) => toggleTodos(ids, checked)}
                  ariaLabel="Seleccionar todas las órdenes"
                />
              );
            },
            render: (row) => {
              // Motivo de bloqueo (o null): deshabilita el checkbox y lo explica en
              // el tooltip, en vez de dejar seleccionar una orden que la acción del
              // estado va a descartar (lo que dejaba el modal vacío/"bloqueado").
              const motivo = bloqueoSeleccion?.(row) ?? null;
              return (
                <Checkbox
                  checked={seleccionIds.has(row.id)}
                  disabled={motivo !== null}
                  onCheckedChange={(checked) =>
                    toggleSeleccion(row.id, checked === true)
                  }
                  aria-label={
                    motivo
                      ? `No se puede seleccionar la orden ${row.numRemision}: ${motivo}`
                      : `Seleccionar orden ${row.numRemision}`
                  }
                  title={motivo ?? undefined}
                />
              );
            },
          },
          ...columnasDatos,
        ]
      : columnasDatos;

    // La columna de acciones por fila existe si la enciende AL MENOS una de sus dos
    // fuentes: el historial/etiqueta (49/32) o el reporte de incidente (158). Cada pieza
    // se monta por separado, así que encender una no arrastra la otra.
    if (!mostrarHistorial && !puedeReportarIncidente) return conSeleccion;
    return [
      ...conSeleccion,
      {
        id: "acciones",
        value: "Acciones",
        // Acciones por fila del listado: ver historial (drawer) + ver etiqueta
        // (vista previa de QR + datos y descarga del PDF 100×100 mm, feature 32) +
        // reportar incidente (feature 158, sólo en los 5 estados que lo admiten).
        render: (row) => (
          <div className="flex items-center gap-1">
            {mostrarHistorial ? (
              <>
                <HistorialOrdenSheet ordenId={row.id} referencia={row.numRemision} />
                <EtiquetaOrdenAccion orden={row} />
              </>
            ) : null}
            {puedeReportarIncidente ? <ReportarIncidenteAccion orden={row} /> : null}
          </div>
        ),
      },
    ];
  }, [
    columns,
    mostrarHistorial,
    puedeReportarIncidente,
    haySeleccion,
    seleccionIds,
    bloqueoSeleccion,
    items,
    resaltarPrioridad,
  ]);

  // Snapshot de las filas marcadas PRESENTES en la página actual (la selección se
  // acota a lo visible, como en la vista de revisión previa).
  const seleccionadas = items.filter((item) => seleccionIds.has(item.id));
  // Acciones aplicables a la selección actual. Con `acciones` como función, el padre
  // decide qué aplica a ESTAS filas (estados mezclados); con un array, es fijo.
  const accionesActivas =
    typeof acciones === "function" ? acciones(seleccionadas) : (acciones ?? []);
  const hayAcciones =
    haySeleccion && accionesActivas.length > 0 && seleccionadas.length > 0;

  /**
   * Feature 151 (design §7) — configuración de descarga del dataset completo.
   *
   * Se construye EN EL RENDER, no en un memo con dependencias: `obtenerFilas` cierra
   * sobre el `filter` de ESTE render, así que la descarga siempre refleja los filtros
   * aplicados en el momento de pulsar (R33, R36). La tabla recibe una FUNCIÓN, nunca los
   * filtros ni una url (D4): quien conoce el dominio es este módulo.
   *
   * La única vía al dato es la Server Action `listarOrdenesCompleto`, que reusa el mismo
   * servicio que el listado paginado (autorización, acotamiento por rol y tope
   * incluidos). Aquí no se consulta el repositorio ni se duplica la query.
   */
  const descarga: DataTableDescarga | undefined = permitirDescarga
    ? {
        titulo: TITULO_DESCARGA,
        columnas: COLUMNAS_DESCARGA_ORDENES,
        obtenerFilas: async () => {
          const res = await listarOrdenesCompleto(filter ? { filter } : {});
          if (res.status === "limite_excedido") {
            // R20: sin archivo; el mensaje lleva total, tope y qué hacer.
            return {
              status: "error",
              mensaje: mensajeLimite(res.total, res.limite),
            };
          }
          if (res.status !== "ok") {
            // R27: mensaje canónico del error (mismo mapeo que el resto de acciones)
            // + qué hacer. La tabla no traduce códigos: los recibe ya saneados.
            return {
              status: "error",
              mensaje: `${messageFromActionError(res)} ${SUFIJO_REINTENTO}`,
            };
          }
          // R34: una fila por orden del dataset completo, no solo la página visible.
          return { status: "ok", filas: res.items.map(filaDescargaOrden) };
        },
      }
    : undefined;

  return (
    <section className="flex flex-col gap-4">
      {puedeCargarMasiva && (
        <div className="flex justify-end">
          <OrdenesCargaMasivaButton />
        </div>
      )}

      {/* Barra de acciones por lote ("tool"): aparece SOLO con filas marcadas. */}
      {hayAcciones ? (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-2.5 shadow-sm">
          <span className="text-sm font-medium">
            {seleccionadas.length} seleccionada
            {seleccionadas.length === 1 ? "" : "s"}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {accionesActivas.map((accion) => (
              <Button
                key={accion.key}
                type="button"
                size="sm"
                variant={accion.variant ?? "default"}
                onClick={() => accion.onRun(seleccionadas)}
              >
                {accion.label}
              </Button>
            ))}
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={() => setSeleccionIds(new Set())}
          >
            Limpiar
          </Button>
        </div>
      ) : null}

      <DataTable
        columns={columnasEfectivas}
        data={items}
        rowKey="id"
        ariaLabel="Órdenes"
        rowClassName={resaltarPrioridad ? resaltarFilaPrioridad : undefined}
        descarga={descarga}
        isLoading={isLoading}
        error={error ? "No se pudieron cargar las órdenes" : null}
        emptyState={{
          icon: Inbox,
          title: "No hay órdenes",
          description: "Cuando lleguen órdenes, aparecerán aquí.",
        }}
      />
      <Pagination
        page={page}
        pageSize={pageSize}
        total={data?.total ?? 0}
        disabled={isLoading}
        showFirstLast
        siblingCount={1}
        onPageChange={setPage}
        onPageSizeChange={(s) => {
          setPageSize(s);
          setPage(1);
        }}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
      />
    </section>
  );
}
