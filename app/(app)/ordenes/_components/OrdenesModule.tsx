"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Inbox, SearchX } from "lucide-react";
import useSWR from "swr";

import { DataTable } from "@/components/shared/DataTable";
import type { Column, DataTableDescarga } from "@/components/shared/DataTable";
import {
  conBadgePrioridad,
  resaltarFilaPrioridad,
} from "@/components/shared/PrioridadResalte";
import { Pagination } from "@/components/shared/Pagination";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CeldaSeleccion } from "@/components/shared/CeldaSeleccion";
import { SelectAllCheckbox } from "@/components/shared/SelectAllCheckbox";
import { filasDesdeResultado } from "@/components/shared/descarga-resultado";
import { ordenesConfig } from "@/lib/config/ordenes";
import { listarOrdenes, listarOrdenesCompleto } from "@/lib/actions/ordenes";
import type { OrdenListItemDTO } from "@/lib/types/orden";

import { ordenesColumns } from "./ordenes-columns";
import {
  AMBITO_DESCARGA_ORDENES,
  COLUMNAS_DESCARGA_ORDENES,
  filaDescargaOrden,
} from "./ordenes-descarga-columnas";
import { serializarFiltro, type OrdenesFilterUI } from "./serializar-filtro";
import { OrdenesCargaMasivaButton } from "./OrdenesCargaMasivaButton";
import { HistorialOrdenSheet } from "./HistorialOrdenSheet";
import { EtiquetaOrdenAccion } from "./EtiquetaOrdenAccion";
import { ReportarIncidenteAccion } from "./ReportarIncidenteAccion";
import { CorregirDatosClienteAccion } from "./CorregirDatosClienteAccion";

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
//
// Feature 170 (T0.3): `mensajeLimite` y `SUFIJO_REINTENTO` vivían aquí; se PROMOVIERON
// sin editar su texto a `components/shared/descarga-resultado`, que es de donde los leen
// ahora las 25 tablas.
const TITULO_DESCARGA = "Órdenes";

/**
 * Feature 169/R40 — vacío CON búsqueda activa. El mensaje de siempre ("No hay órdenes /
 * cuando lleguen, aparecerán aquí") es literalmente falso buscando: sí hay órdenes, lo
 * que no hay es coincidencias con ESE texto, y quien lo lea puede concluir que el
 * listado se rompió en vez de revisar lo que tecleó. Se le devuelve su término —para que
 * vea el error de dedo— y qué hacer con él.
 */
function vacioConBusqueda(termino: string): { title: string; description: string } {
  return {
    title: "Sin coincidencias",
    description: `Ninguna orden coincide con «${termino}». Revisa el texto o limpia la búsqueda.`,
  };
}

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
 *
 * OJO (React Compiler): el parámetro de props NO lleva valor por defecto (`= {}`). React
 * siempre invoca los componentes con un objeto de props, así que ese default era
 * inalcanzable, pero hacía que el compilador dejase de ver las props como CONGELADAS: al
 * llamar a `selectable(...)` / `bloqueoSeleccion(...)` daba por hecho que esos valores
 * podían cambiar después, así que ningún `useMemo` que los declare como dependencia era
 * preservable y abortaba la compilación del componente entero
 * (`react-hooks/preserve-manual-memoization`). Todas las props siguen siendo opcionales:
 * `<OrdenesModule />` sin ninguna es válido.
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
  puedeCorregirDatos = false,
  filtros,
  resetSeleccion = 0,
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
   *
   * Feature 169 (R38/R39/R40): admite `q`, el término de búsqueda, como ESCALAR. Es la
   * única clave que el módulo sí mira —para el estado vacío (R40)—; para todo lo demás
   * sigue siendo opaca y entra en la key de caché como cualquier otra.
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
  /**
   * Ficha 312 (E2, design §9.1): ofrece la acción POR FILA "Corregir datos" (destinatario,
   * teléfono, producto y notas). Opt-in y por defecto `false`, de modo que ninguna superficie
   * previa cambia. La página la enciende sólo para roles de ACCESO TOTAL (maestro/admin) —el
   * `adminTienda` corrige desde las cards de `/novedades`, no desde aquí— y la acción se
   * auto-oculta además en las filas cuyo estado no admite la corrección (R22/R24).
   *
   * NO es una acción por LOTE a propósito: un lote no tiene un «destinatario» común.
   */
  puedeCorregirDatos?: boolean;
  /**
   * Barra de filtros de la superficie, que la tabla coloca en la misma línea que el
   * control de descarga. Solo se pasa a través: este módulo tampoco la mira. Quien
   * arma los filtros y traduce lo seleccionado a `filter` es la superficie de arriba.
   */
  filtros?: ReactNode;
  /**
   * Señal de "la selección ya se consumió": cada vez que este número cambia, se
   * desmarcan TODAS las filas. Quien ejecuta las acciones por lote vive arriba (es
   * quien sabe cuándo una terminó bien), pero la selección vive aquí; en vez de
   * exponer un handle imperativo, la superficie incrementa un contador y este módulo
   * la limpia. Tras una acción por lote las filas marcadas ya cambiaron de estado:
   * dejarlas marcadas invita a repetir la acción sobre órdenes que ya no la admiten.
   */
  resetSeleccion?: number;
}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(ordenesConfig.DEFAULT_PAGE_SIZE);
  /**
   * Selección ACUMULADA entre páginas (pedido humano): si marcas 2 en la página 1 y una
   * más en la 2, la barra de acciones dice 3, no 1.
   *
   * Es un `Map id -> fila` y no un `Set` de ids porque las acciones reciben las FILAS
   * (`acciones(seleccionadas)`), y las de páginas que ya no están montadas no se pueden
   * recuperar de `items`. Se guarda la fila tal como estaba al marcarla; la selección se
   * limpia al cambiar de filtro y con "Limpiar".
   */
  const [seleccion, setSeleccion] = useState<ReadonlyMap<string, OrdenListItemDTO>>(
    new Map(),
  );
  const seleccionIds = useMemo(() => new Set(seleccion.keys()), [seleccion]);

  function toggleSeleccion(row: OrdenListItemDTO, checked: boolean) {
    setSeleccion((prev) => {
      const next = new Map(prev);
      if (checked) next.set(row.id, row);
      else next.delete(row.id);
      return next;
    });
  }

  function toggleTodos(filas: OrdenListItemDTO[], checked: boolean) {
    setSeleccion((prev) => {
      const next = new Map(prev);
      for (const row of filas) {
        if (checked) next.set(row.id, row);
        else next.delete(row.id);
      }
      return next;
    });
  }

  // Feature 63/C2 (R17) + Feature 144 (R61): el filtro entra en la key SWR para que
  // la caché y la paginación sean por combinación de filtros. La key debe ser un
  // ESCALAR estable: `serializarFiltro` ordena claves y valores, así que dos
  // selecciones equivalentes (en distinto orden o de distinta identidad de objeto)
  // comparten caché en vez de refetchear en cada render.
  const filterKey = serializarFiltro(filter);

  // Feature 169/R40: término de búsqueda VIGENTE, si lo hay. Viaja como escalar
  // (`seleccion-a-filter.ts`); un valor de otra forma se ignora en vez de pintarse.
  const terminoBuscado = typeof filter?.q === "string" ? filter.q : undefined;
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
    setSeleccion(new Map());
  }

  // Ejecutada una acción por lote, la superficie incrementa `resetSeleccion` y aquí se
  // desmarca todo. Mismo patrón de "ajustar estado durante el render" que el reset por
  // cambio de filtro, y por el mismo motivo: sin efecto ni parpadeo intermedio.
  const [resetSeleccionPrevio, setResetSeleccionPrevio] = useState(resetSeleccion);
  if (resetSeleccion !== resetSeleccionPrevio) {
    setResetSeleccionPrevio(resetSeleccion);
    setSeleccion(new Map());
  }

  // Identidad estable de la página: `data?.items ?? []` fabrica un array NUEVO en cada
  // render mientras SWR no tiene datos, y esa identidad inestable se propaga a los
  // `useMemo` que dependen de ella (columnas, motivos de bloqueo), que se recalculaban
  // siempre. Con memo propio, `items` sólo cambia cuando cambia la respuesta.
  const items = useMemo<OrdenListItemDTO[]>(() => data?.items ?? [], [data]);

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
              const filas = items.filter(
                (row) => (bloqueoSeleccion?.(row) ?? null) === null,
              );
              return (
                <SelectAllCheckbox
                  selectableIds={filas.map((row) => row.id)}
                  selectedIds={seleccionIds}
                  // Asimétrico A PROPÓSITO (pedido humano): marcar "todas" solo puede
                  // añadir las filas de ESTA página (de las otras no se tienen los
                  // datos), pero DESMARCAR limpia la selección ENTERA — incluidas las
                  // marcadas en otras páginas. Si no, quedaban marcas invisibles
                  // contando en la barra de acciones y no había forma de quitarlas
                  // salvo volver página por página.
                  onToggleAll={(checked) =>
                    checked ? toggleTodos(filas, true) : setSeleccion(new Map())
                  }
                  ariaLabel="Seleccionar todas las órdenes"
                />
              );
            },
            render: (row) => {
              // Motivo de bloqueo (o null): con motivo NO se pinta checkbox, sino el aviso
              // «!» que lo explica (pedido humano 2026-08-19). Antes era una casilla gris
              // con el motivo en el `title` nativo: dejaba de parecer «esto no aplica» y
              // pasaba a parecer «los checkbox no funcionan», que es el reporte que llegó.
              const motivo = bloqueoSeleccion?.(row) ?? null;
              return (
                <CeldaSeleccion
                  checked={seleccionIds.has(row.id)}
                  onCheckedChange={(checked) => toggleSeleccion(row, checked)}
                  bloqueo={motivo}
                  ariaLabel={`Seleccionar orden ${row.numRemision}`}
                  bloqueoAriaLabel={
                    motivo
                      ? `No se puede seleccionar la orden ${row.numRemision}: ${motivo}`
                      : undefined
                  }
                />
              );
            },
          },
          ...columnasDatos,
        ]
      : columnasDatos;

    // La columna de acciones por fila existe si la enciende AL MENOS una de sus TRES
    // fuentes: el historial/etiqueta (49/32), el reporte de incidente (158) o la corrección de
    // los datos del cliente (312). Cada pieza se monta por separado, así que encender una no
    // arrastra las otras.
    if (!mostrarHistorial && !puedeReportarIncidente && !puedeCorregirDatos) return conSeleccion;
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
            {/* Ficha 312 (R22): la fila la ofrece sólo si la página la encendió Y el estado la
                admite. Lo segundo lo decide el propio disparador, que no renderiza nada cuando
                no aplica. */}
            {puedeCorregirDatos ? <CorregirDatosClienteAccion orden={row} /> : null}
          </div>
        ),
      },
    ];
  }, [
    columns,
    mostrarHistorial,
    puedeReportarIncidente,
    puedeCorregirDatos,
    haySeleccion,
    seleccionIds,
    bloqueoSeleccion,
    items,
    resaltarPrioridad,
  ]);

  /**
   * Filas marcadas, de TODAS las páginas recorridas (pedido humano). Las de la página
   * actual se toman de `items` —así reflejan el dato recién refrescado por SWR— y a ellas
   * se suman las que se marcaron en otras páginas, tal como estaban al marcarlas.
   */
  const seleccionadas = useMemo<OrdenListItemDTO[]>(() => {
    const enPagina = new Set(items.map((item) => item.id));
    return [
      ...items.filter((item) => seleccion.has(item.id)),
      ...[...seleccion.values()].filter((row) => !enPagina.has(row.id)),
    ];
  }, [items, seleccion]);

  /**
   * Motivos por los que NINGUNA fila de la página se puede marcar. El tooltip del
   * checkbox ya explica cada fila, pero una página entera de casillas grises no se lee
   * como "hay una condición que lo impide", sino como "los checkbox no funcionan" — que
   * es justo el reporte que llegó con el filtro "Reasignables" y una zona con cierre
   * abierto. Con filas mixtas no se avisa: ahí el usuario sí puede marcar algo y el
   * tooltip basta.
   */
  const motivosPaginaBloqueada = useMemo<string[]>(() => {
    if (!haySeleccion || !bloqueoSeleccion || items.length === 0) return [];
    const motivos = items.map((row) => bloqueoSeleccion(row));
    if (motivos.some((m) => m === null)) return [];
    return [...new Set(motivos.filter((m): m is string => m !== null))];
  }, [haySeleccion, bloqueoSeleccion, items]);
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
        // Ficha 314: enciende el selector de columnas de esta descarga. Es un IDENTIFICADOR de
        // ámbito y nada más — aquí no se lee ni se escribe almacenamiento; de eso se encarga
        // el control común, que es quien conoce la clave.
        ambitoColumnas: AMBITO_DESCARGA_ORDENES,
        // Feature 170 (T0.3): el bloque que traducía el resultado a filas —tope, error
        // accionable y proyección— vivía aquí inline. Ahora es `filasDesdeResultado`,
        // el MISMO adaptador que usan las otras 24 tablas: sin cambio funcional, y sin
        // dos caminos que puedan divergir. R34: una fila por orden del dataset
        // completo, no solo la página visible.
        obtenerFilas: () =>
          filasDesdeResultado(
            listarOrdenesCompleto(filter ? { filter } : {}),
            filaDescargaOrden,
          ),
      }
    : undefined;

  return (
    <section className="flex flex-col gap-4">
      {puedeCargarMasiva && (
        <div className="flex justify-end">
          <OrdenesCargaMasivaButton />
        </div>
      )}

      {/* Por qué no se puede marcar nada en esta página (motivo a la vista, no solo en
          el tooltip de cada casilla). */}
      {motivosPaginaBloqueada.length > 0 ? (
        <Alert variant="default">
          <AlertDescription>
            {motivosPaginaBloqueada.length === 1 ? (
              motivosPaginaBloqueada[0]
            ) : (
              <ul className="list-disc pl-4">
                {motivosPaginaBloqueada.map((motivo) => (
                  <li key={motivo}>{motivo}</li>
                ))}
              </ul>
            )}
          </AlertDescription>
        </Alert>
      ) : null}

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
            onClick={() => setSeleccion(new Map())}
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
        filtros={filtros}
        isLoading={isLoading}
        error={error ? "No se pudieron cargar las órdenes" : null}
        emptyState={
          // R40: el vacío de una BÚSQUEDA no es el vacío del listado. `DataTable` no se
          // toca: ya recibe el estado vacío por props (R42).
          terminoBuscado
            ? { icon: SearchX, ...vacioConBusqueda(terminoBuscado) }
            : {
                icon: Inbox,
                title: "No hay órdenes",
                description: "Cuando lleguen órdenes, aparecerán aquí.",
              }
        }
      />
      {/* La barra flota sobre el borde inferior mientras su sitio real queda fuera de
          pantalla: eso lo hace `Pagination` por sí sola, igual que en el resto de tablas. */}
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
