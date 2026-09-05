"use client";

import {
  Fragment,
  isValidElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ChevronLeft, ChevronRight, type LucideIcon } from "lucide-react";

import { DescargarDatasetButton } from "@/components/shared/DescargarDatasetButton";
import { EmptyState } from "@/components/shared/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  DescargaColumna,
  DescargaFila,
  DescargaTipo,
} from "@/lib/types/descarga";
import { cn } from "@/lib/utils";

/** Nº de filas placeholder mostradas mientras carga (estado skeleton). */
const SKELETON_ROW_COUNT = 5;

/**
 * Anchos por columna del skeleton: estables columna a columna (no aleatorios por
 * fila) para que las celdas placeholder se lean como columnas reales, no ruido.
 */
const SKELETON_WIDTHS = ["w-16", "w-24", "w-20", "w-28", "w-14"] as const;

/**
 * Definición de una columna de la tabla genérica.
 *
 * `render` admite tres formas (contrato R3):
 *  - función `(row) => ReactNode`: contenido custom (R6).
 *  - string / `keyof T`: clave de acceso al dato de la fila, `row[render]` (R7).
 *  - ausente/undefined: valor por la clave por defecto `column.id`, `row[id]` (R8).
 */
export interface Column<T> {
  /** Identificador único de columna. También clave de acceso por defecto y key de React. */
  id: string;
  /** Etiqueta de cabecera mostrada en el `<th scope="col">`. */
  value: string;
  /** Cómo renderizar la celda. Ver descripción del contrato arriba. */
  render?: ((row: T) => ReactNode) | keyof T | string;
  /**
   * Cabecera custom opcional. Si se define, sustituye al texto `value` dentro del
   * `<th>` (p. ej. un checkbox "seleccionar todo"). `value` sigue siendo el nombre
   * accesible/fallback de la columna, así que déjalo siempre poblado.
   */
  renderHeader?: () => ReactNode;
  /**
   * Ancho MÍNIMO de la columna, como longitud CSS (`"8rem"`, `"120px"`). Opcional:
   * sin ella la columna se comporta exactamente como antes (ancho automático según
   * contenido). Se aplica al `<th>` vía `style`, no como clase, porque el valor es
   * un dato de la columna y Tailwind no puede generar clases dinámicas.
   *
   * Con `border-collapse` y layout automático, el `min-width` del `<th>` gobierna
   * toda la columna: no hace falta repetirlo en cada `<td>`. Si la suma de mínimos
   * excede el ancho disponible, la tabla desborda y aparece el scroll horizontal
   * (comportamiento deseado: antes las columnas se estrujaban).
   */
  minWidth?: string;
  /**
   * Alineación horizontal de la columna (cabecera + celdas). Opcional y OPT-IN: sin
   * ella la columna no recibe NINGUNA clase de alineación y hereda el `text-left` de
   * la tabla, es decir, se comporta EXACTAMENTE como antes. Esta tabla la usan hoy 30
   * listados: la prop no puede mover el render por defecto de ninguno.
   *
   * Existe por las columnas de DINERO. Un importe alineado a la izquierda deja las
   * unidades a distinta altura en cada fila (`₡80.00` / `₡12500.00`), así que comparar
   * dos filas obliga a leer cifra a cifra; a la derecha las unidades quedan en la misma
   * columna y la magnitud se lee de un vistazo. Es la convención de cualquier libro
   * contable, y por eso el valor útil es `"right"` (`"left"` está para poder declararlo
   * explícito cuando conviva con columnas alineadas).
   *
   * Se aplica también a la celda del SKELETON —y ahí el placeholder se empuja con
   * `ml-auto`, porque es un bloque con ancho propio y `text-align` no lo movería— para
   * que la columna no salte de lado cuando terminan de llegar los datos.
   */
  align?: "left" | "right";
}

/**
 * Estado vacío estructurado de la tabla. Espejo de `EmptyStateProps` (sin
 * `className`): el `DataTable` es dueño del layout del vacío y solo expone el
 * contenido (icono/título/descripción/acción) para que todas las listas hereden
 * el mismo `EmptyState`.
 */
export interface DataTableEmptyState {
  /** Icono lucide opcional. */
  icon?: LucideIcon;
  /** Título que enseña el estado/próximo paso. */
  title: ReactNode;
  /** Descripción opcional con la guía del próximo paso. */
  description?: ReactNode;
  /** CTA opcional (normalmente un `<Button>`). */
  action?: ReactNode;
}

/**
 * Resultado de la obtención de filas del dataset completo (feature 151, design.md §5).
 * El `mensaje` de error llega YA saneado y accionable desde el consumidor (R27): la
 * tabla no traduce códigos de error ni conoce sus causas.
 */
export type DescargaFilasResult =
  | { status: "ok"; filas: DescargaFila[] }
  | { status: "error"; mensaje: string };

/**
 * Configuración OPT-IN de la descarga del dataset completo (R29).
 *
 * La tabla NO recibe ni interpreta filtros, urls ni parámetros de consulta: recibe una
 * FUNCIÓN (`obtenerFilas`) sobre la que el consumidor cierra sus propios filtros, más
 * los datos de presentación del archivo. Así la tabla sigue siendo genérica sobre `T` y
 * sin dominio (D4). Si al cablear una tabla nueva hiciera falta ampliar este contrato,
 * es señal de que el diseño falló, no permiso para meter dominio aquí (design.md §8).
 */
export interface DataTableDescarga {
  /** Nombre de la hoja y base del nombre de archivo. También el nombre accesible. */
  titulo: string;
  /** Columnas del EXPORT, declaradas aparte de `Column<T>` y con valor crudo (D5). */
  columnas: DescargaColumna[];
  /** Obtiene el dataset completo. Es el ÚNICO punto que conoce filtros y acciones. */
  obtenerFilas: () => Promise<DescargaFilasResult>;
  /** R28: más de uno ⇒ el usuario elige; ausente o uno solo ⇒ descarga directa. */
  formatos?: DescargaTipo[];
  /**
   * Ficha 314 (R33, R35) — ÁMBITO de la preferencia de columnas de esta descarga. AUSENTE ⇒
   * sin selector y salen todas las columnas declaradas, que es lo que hacen hoy las 24 tablas
   * restantes; encender la siguiente cuesta una línea en su módulo.
   *
   * Es un `string` a secas y no un descriptor: `columnas` ya viaja aquí, así que un descriptor
   * duplicaría el catálogo y abriría la puerta a que las dos copias divergieran. El ámbito es
   * un IDENTIFICADOR, y quien lee el almacenamiento es el control común.
   */
  ambitoColumnas?: string;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  /**
   * Origen de la key de fila. Por defecto usa `row.id`; si no existe, el índice.
   * Nunca usa el índice cuando hay un identificador de fila disponible.
   */
  rowKey?: keyof T | ((row: T) => string);
  /** Texto del `<caption>` de la tabla (R14). También da nombre accesible (R16). */
  caption?: string;
  /** Nombre accesible cuando no se usa `caption` (R16). */
  ariaLabel?: string;
  /** Estado de carga (R12). */
  isLoading?: boolean;
  /** Mensaje de error ya saneado por el consumidor (R13). */
  error?: string | null;
  /**
   * Mensaje del estado vacío (R11). Se usa como TÍTULO del `EmptyState` cuando
   * no se pasa `emptyState` estructurado (retrocompatible: una lista que solo
   * daba `emptyMessage` sigue mostrando ese texto como título).
   */
  emptyMessage?: string;
  /**
   * Estado vacío estructurado: icono + título que ENSEÑA el próximo paso +
   * descripción + CTA opcionales. Toda lista basada en `DataTable` hereda así
   * un vacío consistente (`EmptyState`). Si se omite, se cae a `emptyMessage`
   * como título. `emptyState.title` tiene prioridad sobre `emptyMessage`.
   */
  emptyState?: DataTableEmptyState;
  /**
   * Contenido desplegable de una fila. Al pasarlo, la tabla antepone una columna con un
   * botón de expandir por fila y el contenido aparece en una fila propia debajo. Devolver
   * `null` para una fila concreta la deja sin desplegar (sin botón).
   *
   * La tabla NO decide qué va adentro: sigue siendo data-driven y sin dominio (R1).
   */
  renderExpanded?: (row: T) => ReactNode;
  /**
   * Nombre accesible del botón de expandir de cada fila. Debe identificar SU fila, no ser
   * un genérico "Ver detalle" repetido N veces.
   */
  expandAriaLabel?: (row: T) => string;
  /**
   * Clase(s) opcional(es) por fila de DATOS, derivadas de la propia fila. Se
   * combinan con la clase base del `<tr>` vía `cn("border-b", rowClassName?.(row))`,
   * de modo que la última clase gana (twMerge). Retrocompatible: sin la prop el
   * `<tr>` conserva exactamente `border-b` (comportamiento previo). Solo afecta a
   * las filas de datos; los estados skeleton/vacío/error/expandido no la reciben.
   * La tabla sigue sin conocer dominio (R1): recibe el mapeo fila→clase por prop.
   */
  rowClassName?: (row: T) => string | undefined;
  /**
   * Descarga del dataset completo (feature 151, R24). OPT-IN: sin esta prop la tabla
   * se comporta EXACTAMENTE igual que antes y no renderiza control alguno; con ella
   * antepone el control de descarga encima de la tabla (gate P4). La descarga no toca
   * la página, la selección ni las filas visibles (R31): vive fuera del `<table>` y no
   * llama a ningún setter de la tabla.
   */
  descarga?: DataTableDescarga;
  /**
   * Barra de filtros del consumidor, colocada en la MISMA línea que el control de
   * descarga, encima de la tabla. OPT-IN: sin la prop la tabla se comporta
   * exactamente igual que antes.
   *
   * Es un `ReactNode` opaco a propósito (D4): la tabla NO conoce los filtros, no los
   * lee y no los cablea — sigue recibiendo `data` ya filtrada. Lo único que aporta es
   * el SITIO. Si algún día hiciera falta pasarle la selección o las claves para que
   * hiciera algo con ellas, es señal de que el diseño falló, no permiso para meter
   * dominio aquí.
   */
  filtros?: ReactNode;
}

/** Chevron del botón de expandir; rota al abrir. Decorativo (el botón ya tiene nombre). */
function ExpandIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
      className={cn("size-4 transition-transform", open && "rotate-90")}
    >
      <path
        d="M6 4l4 4-4 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Coacciona un valor arbitrario de la fila a un `ReactNode` renderizable sin
 * exponer objetos crudos (evita "[object Object]") ni lanzar. Se usa solo en el
 * camino de acceso por clave (render string / clave por defecto), donde el valor
 * es de tipo desconocido por definición.
 */
function toRenderableNode(value: unknown): ReactNode {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "bigint") return value.toString();
  if (isValidElement(value)) return value;
  // Booleanos, símbolos, objetos y funciones no se muestran como texto crudo.
  return null;
}

/** Resuelve el contenido de una celda según el contrato de `render` (R6–R8). */
function resolveCell<T>(column: Column<T>, row: T): ReactNode {
  const { render, id } = column;
  if (typeof render === "function") {
    return render(row);
  }
  // Camino de acceso por clave: render string (R7) o clave por defecto = id (R8).
  const key = typeof render === "string" ? render : id;
  // Cast acotado: `row` es un registro de datos; leemos por clave string. El
  // valor resultante se trata como `unknown` y se coacciona con toRenderableNode,
  // por lo que ningún `any` cruza el borde público.
  const value = (row as Record<string, unknown>)[key];
  return toRenderableNode(value);
}

/**
 * Clase de alineación de una columna, o `undefined` si no la declara. Devolver
 * `undefined` (y no `"text-left"`) es lo que hace la prop retrocompatible: la celda
 * de una columna sin `align` queda con el mismo `className` de siempre.
 */
function alignClass<T>(column: Column<T>): string | undefined {
  if (column.align === "right") return "text-right";
  if (column.align === "left") return "text-left";
  return undefined;
}

/** Deriva una key de React estable para una fila (R10). */
function resolveRowKey<T>(
  rowKey: DataTableProps<T>["rowKey"],
  row: T,
  index: number,
): string {
  if (typeof rowKey === "function") {
    return rowKey(row);
  }
  if (rowKey !== undefined) {
    const value = (row as Record<string, unknown>)[rowKey as string];
    if (value !== null && value !== undefined) return String(value);
  }
  const id = (row as { id?: unknown }).id;
  if (id !== null && id !== undefined) return String(id);
  return String(index);
}

/**
 * Tabla genérica, data-driven y UI pura. No conoce ningún dominio: recibe las
 * columnas normalizadas (`Column<T>[]`) y las filas (`T[]`) por props (R1).
 */
export function DataTable<T>({
  columns,
  data,
  rowKey,
  caption,
  ariaLabel,
  isLoading = false,
  error = null,
  emptyMessage = "No hay registros",
  emptyState,
  renderExpanded,
  expandAriaLabel,
  rowClassName,
  descarga,
  filtros,
}: DataTableProps<T>) {
  // Filas desplegadas, por key de fila. Vive acá (y no en el consumidor) porque es estado
  // de PRESENTACIÓN de la tabla; el consumidor solo dice QUÉ se despliega.
  const [expandidas, setExpandidas] = useState<ReadonlySet<string>>(new Set());
  const expandible = renderExpanded !== undefined;

  // --- Flechas de scroll horizontal ---
  // Solo aparecen cuando la tabla desborda su contenedor. Cada flecha se
  // deshabilita cuando no hay más scroll en su dirección (inicio → izquierda off,
  // fin → derecha off). Van centradas verticalmente en el CUERPO de la tabla (no
  // sobre la cabecera: por eso el offset con el alto del <thead>) y fijas a los
  // bordes del viewport de scroll, no a las columnas.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const theadRef = useRef<HTMLTableSectionElement | null>(null);
  const [scrollNav, setScrollNav] = useState({
    scrollable: false,
    canLeft: false,
    canRight: false,
  });
  const [headerHeight, setHeaderHeight] = useState(0);

  const actualizarScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    const maxScroll = scrollWidth - clientWidth;
    // Tolerancia de 1px: evita parpadeo por redondeo subpíxel.
    setScrollNav({
      scrollable: maxScroll > 1,
      canLeft: scrollLeft > 1,
      canRight: scrollLeft < maxScroll - 1,
    });
    if (theadRef.current) setHeaderHeight(theadRef.current.offsetHeight);
  }, []);

  useEffect(() => {
    actualizarScroll();
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    // Recalcula ante cambios de tamaño del viewport y del contenido de la tabla
    // (columnas/datos/carga cambian el ancho y por tanto si hay scroll).
    const ro = new ResizeObserver(actualizarScroll);
    ro.observe(el);
    const table = el.querySelector("table");
    if (table) ro.observe(table);
    return () => ro.disconnect();
  }, [actualizarScroll, data, columns, isLoading, error]);

  const desplazar = useCallback((dir: 1 | -1) => {
    const el = scrollRef.current;
    if (!el) return;
    // Paso ≈ 80% del ancho visible. behavior: "smooth" para el desplazamiento suave.
    el.scrollTo({
      left: el.scrollLeft + dir * el.clientWidth * 0.8,
      behavior: "smooth",
    });
  }, []);

  function toggle(key: string) {
    setExpandidas((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  // Precedencia de estados: error > carga > vacío > datos. La columna del botón (si la hay)
  // también ocupa ancho: sin sumarla, los estados vacío/carga no cubren la tabla entera.
  const colSpan = columns.length + (expandible ? 1 : 0);
  let body: ReactNode;

  if (error) {
    body = (
      <tr>
        <td colSpan={colSpan} className="px-3 py-6 text-center">
          <span role="alert" className="text-sm text-destructive">
            {error}
          </span>
        </td>
      </tr>
    );
  } else if (isLoading) {
    // Estado de carga como FILAS SKELETON (no el texto "Cargando…"): mantiene la
    // forma de la tabla mientras llegan los datos. Las filas placeholder son
    // puramente visuales (`aria-hidden`); el estado se anuncia a lectores de
    // pantalla con una única región `role="status"` (sr-only).
    body = (
      <>
        <tr>
          <td colSpan={colSpan} className="p-0">
            <span role="status" className="sr-only">
              Cargando
            </span>
          </td>
        </tr>
        {Array.from({ length: SKELETON_ROW_COUNT }).map((_, rowIndex) => (
          <tr key={`skeleton-${rowIndex}`} aria-hidden="true" className="border-b">
            {expandible ? (
              <td className="px-3 py-2 align-middle">
                <Skeleton className="size-5 rounded" />
              </td>
            ) : null}
            {columns.map((column, columnIndex) => (
              <td
                key={column.id}
                className={cn("px-3 py-2 align-middle", alignClass(column))}
              >
                <Skeleton
                  className={cn(
                    "h-4",
                    SKELETON_WIDTHS[columnIndex % SKELETON_WIDTHS.length],
                    // El placeholder es un bloque con ancho propio: `text-align` no
                    // lo mueve. Sin esto la columna alineada a la derecha saltaría de
                    // lado al pasar de la carga a los datos.
                    column.align === "right" && "ml-auto",
                  )}
                />
              </td>
            ))}
          </tr>
        ))}
      </>
    );
  } else if (data.length === 0) {
    // Estado vacío consistente vía `EmptyState`. Retrocompatible: si el consumidor
    // solo dio `emptyMessage`, se muestra como título; `emptyState.title` (si viene)
    // tiene prioridad y habilita icono/descripción/CTA que enseñan el próximo paso.
    body = (
      <tr>
        <td colSpan={colSpan} className="p-0">
          <EmptyState
            icon={emptyState?.icon}
            title={emptyState?.title ?? emptyMessage}
            description={emptyState?.description}
            action={emptyState?.action}
          />
        </td>
      </tr>
    );
  } else {
    body = data.map((row, index) => {
      const key = resolveRowKey(rowKey, row, index);
      const expandido = renderExpanded?.(row) ?? null;
      const abierta = expandidas.has(key);
      return (
        <Fragment key={key}>
          {/* Zebra striping: fila de dato en índice par (0, 2, 4…) con un fondo
              naranja tenue → la raya empieza en la PRIMERA fila. */}
          <tr className={cn("border-b", index % 2 === 0 && "bg-brand/5", rowClassName?.(row))}>

            {expandible ? (
              <td className="px-3 py-2 align-middle">
                {expandido === null ? null : (
                  <button
                    type="button"
                    onClick={() => toggle(key)}
                    aria-expanded={abierta}
                    aria-controls={`${key}-expandido`}
                    aria-label={expandAriaLabel?.(row)}
                    className="inline-flex items-center justify-center rounded p-1 text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <ExpandIcon open={abierta} />
                  </button>
                )}
              </td>
            ) : null}
            {columns.map((column) => (
              <td
                key={column.id}
                className={cn("px-3 py-2 align-middle", alignClass(column))}
              >
                {resolveCell(column, row)}
              </td>
            ))}
          </tr>
          {expandido !== null && abierta ? (
            <tr id={`${key}-expandido`} className="border-b bg-muted/30">
              <td colSpan={colSpan} className="px-3 py-3">
                {expandido}
              </td>
            </tr>
          ) : null}
        </Fragment>
      );
    });
  }

  return (
    // Wrapper relativo: ancla las flechas de scroll a los bordes de la tabla.
    <div className="relative w-full max-w-full">
      {/* Cabecera de la tabla: los filtros del consumidor a la izquierda y el control
          de descarga (R24) al final de la MISMA línea. Ninguno de los dos existe si
          el consumidor no los declaró; con `justify-end`, la descarga sola sigue
          quedando a la derecha exactamente como antes.

          Los `filtros` son un `ReactNode` OPACO: la tabla los coloca, no los mira. No
          sabe qué filtros son, ni los lee, ni los cablea — sigue recibiendo `data` ya
          filtrada (R1). Lo único que aporta es el sitio, que es justamente lo que el
          consumidor no puede darse a sí mismo sin duplicar esta fila.

          `items-start` y no `items-center`: una barra de filtros puede ser más ALTA
          que el botón (reserva sitio para sus avisos bajo los controles). Centrada,
          el botón de descarga se descolgaría hacia la mitad de esa altura en vez de
          quedar a la altura de los controles, que es su fila. */}
      {filtros || descarga ? (
        <div className="mb-2 flex flex-wrap items-start justify-end gap-2">
          {/* FICHA 356 — ANCHO MÍNIMO, y no `min-w-0`. Medido en Chromium a 390 px: con
              `min-w-0` esta caja se quedaba en 180 px (342 de fila − 154 del control de
              descarga − el hueco) mientras sus hijos NO pueden encogerse por debajo de su
              contenido —el campo de búsqueda declara `min-w-[250px]`, el disparador de un
              filtro `min-w-56` (224 px)—. El resultado no era una fila apretada: era una fila
              que se DESBORDA hacia la derecha y se mete DEBAJO del botón de descarga. Estaba
              pasando ya: el control de «Estado» puesto llegaba a x=248 dentro de una caja que
              acaba en 204. No se veía porque caía en la segunda línea, sobre espacio vacío; el
              conmutador de orden de la 356, que es el primer hijo, cayó en la MISMA línea que
              la descarga y la tapó 93 px.

              Con un mínimo, la fila hace lo que ya declaraba (`flex-wrap`): cuando no caben los
              dos, la descarga baja a su propia línea y la barra se queda el ancho completo. El
              mínimo es 18rem = 288 px, el ancho del hijo más ancho de esta barra, así que o hay
              sitio de sobra o se parte la línea; no hay franja intermedia en la que algo se
              solape. El `min()` lo acota al 100 % del contenedor para que una tabla montada en
              una caja más estrecha que eso no herede un mínimo mayor que su propio ancho.

              En escritorio no cambia NADA: a 1440 px la fila mide ~1130 y los dos caben. */}
          {filtros ? (
            <div className="min-w-[min(100%,18rem)] flex-1">{filtros}</div>
          ) : null}
          {descarga ? (
            <DescargarDatasetButton
              titulo={descarga.titulo}
              columnas={descarga.columnas}
              obtenerFilas={descarga.obtenerFilas}
              formatos={descarga.formatos}
              ambitoColumnas={descarga.ambitoColumnas}
            />
          ) : null}
        </div>
      ) : null}
      {/* Contenedor con scroll horizontal: cuando la tabla excede el ancho
          disponible, desborda DENTRO de este contenedor en vez de empujar la
          página. Requiere que los ancestros flex (p. ej. SidebarInset) permitan
          encogerse (`min-w-0`), si no el overflow nunca se activa.
          El marco (borde + esquinas redondeadas) va en un contenedor APARTE con
          `overflow-hidden`: así la barra de scroll horizontal queda recortada
          DENTRO del marco en vez de asomar por debajo del borde.

          `sm:px-10` CUANDO HAY SCROLL — EL CARRIL DE LAS FLECHAS. Ver el
          comentario extenso de las flechas, más abajo: los 40 px de cada lado
          son el sitio PROPIO de cada flecha, y por eso ninguna se dibuja ya
          sobre una celda. El padding va aquí, en el marco, y no en el viewport
          de scroll: un `padding-left` DENTRO de un contenedor que desplaza se va
          con el contenido al primer scroll y el hueco desaparece justo cuando
          hace falta. Aquí no desplaza nada: el carril es fijo.

          `sm:` Y NO A SECAS: por debajo de 640 px no hay carril porque no hay
          flechas (ver abajo). El carril y las flechas son la misma decisión y
          tienen que encenderse juntos, o se reservarían 80 px para un control
          que no se pinta.

          Sin desborde no hay flechas y no hay padding: una tabla que cabe se
          pinta byte por byte como antes. El estado no oscila —el padding solo
          ESTRECHA el viewport, así que «desborda» nunca puede volverse falso por
          haberlo aplicado— aunque sí tiene histéresis en la franja en la que el
          contenido cabe sin carril y no cabe con él: ahí el estado depende de
          por dónde se entró, y como los dos son estables no parpadea. */}
      <div
        data-slot="datatable-marco"
        className={cn(
          "w-full max-w-full overflow-hidden rounded-lg border border-asfalto-2",
          scrollNav.scrollable && "sm:px-10",
        )}
      >
        <div
          ref={scrollRef}
          data-slot="datatable-scrollport"
          onScroll={actualizarScroll}
          className="w-full max-w-full overflow-x-auto scroll-smooth"
        >
          <table
            aria-label={ariaLabel}
            className={cn("w-full border-collapse text-left text-sm")}
          >
            {caption ? (
              <caption className="mb-2 text-sm text-muted-foreground">
                {caption}
              </caption>
            ) : null}
            <thead ref={theadRef}>
              <tr className="border-b">
                {/* Cabecera de la columna del botón: sin texto visible, pero con nombre para
                    que la tabla no quede con una columna anónima para un lector de pantalla. */}
                {expandible ? (
                  <th scope="col" className="px-3 py-2">
                    <span className="sr-only">Desglose</span>
                  </th>
                ) : null}
                {columns.map((column) => (
                  <th
                    key={column.id}
                    scope="col"
                    className={cn(
                      "px-3 py-2 text-xs font-bold text-muted-foreground",
                      alignClass(column),
                    )}
                    style={
                      column.minWidth ? { minWidth: column.minWidth } : undefined
                    }
                  >
                    {column.renderHeader ? column.renderHeader() : column.value}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>{body}</tbody>
          </table>
        </div>
      </div>

      {/* Flechas de scroll: solo si la tabla desborda. Cada una se deshabilita en
          su extremo (inicio → izquierda off, fin → derecha off). Van en tiras
          absolutas a cada borde de la tabla (no de las columnas); el botón usa
          position: sticky para quedar al 50% de la pantalla mientras la tabla
          está a la vista, clamped dentro de la tira, que arranca bajo el <thead>
          para no tapar la cabecera.

          ⚠ EL CARRIL, Y POR QUÉ EXISTE — fallo MUDO que estuvo en producción.

          Estas dos tiras están por ENCIMA de la tabla (`z-20`) y el botón tiene
          `pointer-events-auto`. Mientras se dibujaban sobre las celdas, la flecha
          HABILITADA se quedaba con el clic que iba al contenido de debajo. Medido
          en Chromium contra el dev server, `/configuracion/api` a 1280×900 con la
          barra lateral desplegada, con un clic de RATÓN real sobre el centro del
          botón «Editar webhook» (x=1222, y=302):

            el clic lo recibió  → «Desplazar la tabla a la derecha»
            scrollLeft          → 0 → 271
            modal esperado      → NO abrió

          El segundo clic sí funcionaba, porque para entonces la tabla ya estaba
          en el extremo y la flecha se había deshabilitado (y `disabled` trae
          `pointer-events-none`). Ese es el patrón entero: no falla, APARENTA.
          Nadie abre una incidencia por «he tenido que pulsar dos veces». Y no era
          una pantalla: el solape medía 36 px —el ancho exacto de la flecha—
          contra la primera y la última columna en TODAS las tablas que desbordan,
          y `DataTable` lo montan 35 pantallas. La ficha 339 ya lo había visto en
          `/wallet` desde un móvil y lo resolvió allí, en su consumidor.

          EL ARREGLO: las flechas dejan de ser una capa sobre el contenido y pasan
          a tener SITIO PROPIO. El marco reserva 40 px a cada lado (`px-10`, ver
          arriba) y el botón cabe justo dentro: `ml-1`/`mr-1` (4 px) + `size-9`
          (36 px) = 40 px. No hay celda debajo de una flecha, así que ya no hay
          clic que robar ni texto que tapar, y no depende de acertar con qué había
          debajo. La contrapartida está medida y es la que hay: el viewport de
          scroll pierde 80 px, o sea que una tabla que desborda desborda 80 px
          más. Se paga solo cuando hay desborde.

          ⚠ SI TOCAS ESTOS NÚMEROS: el carril (`sm:px-10` del marco) tiene que
          seguir siendo ≥ margen + tamaño del botón, o la flecha vuelve a asomar
          sobre la primera/última columna y vuelve el fallo mudo. Lo fija
          `tests/components/DataTableCarrilFlechas.test.tsx`.

          ⚠ NADA DE ESTO EXISTE POR DEBAJO DE `sm` (640 px) — `hidden sm:flex`.
          El carril no es gratis: son 80 px de viewport de scroll, y eso en un
          teléfono es una mordida, no un detalle. Medido en Chromium contra el
          dev server, con la tabla de `/ordenes`:

            1440 px → ancho útil 1134 → 1054  (−80, un 7 %)
             390 px → ancho útil  340 →  260  (−80, un 23 %)

          En táctil ese control además no lo pulsa nadie: se desliza el dedo. Y
          antes de quitarlo se comprobó que deslizar FUNCIONA de verdad —quitar
          la flecha sin eso dejaría la tabla inalcanzable en el móvil, que es
          mucho peor que perder 80 px—. Medido con eventos táctiles reales por
          CDP (`Input.dispatchTouchEvent`: touchStart + 12 touchMove + touchEnd,
          NO `sp.scrollLeft = n`, que solo probaría que el DOM acepta la
          asignación), en 390×844 y 768×1024 sobre `/ordenes`,
          `/configuracion/api` y `/configuracion`: los 6 casos desplazan en los
          dos sentidos (`scrollLeft` 0 → 205 → 60) con `touch-action: auto` y
          `overflow-x: auto`. Testigo negativo: un `tap` sin arrastre deja el
          `scrollLeft` en 0 en los 6.

          `hidden` y no un `useMediaQuery`: `display: none` saca la flecha
          también del árbol de accesibilidad y del tabulador, que es lo que
          corresponde a un control que no está. Y no hay que hidratar nada para
          decidirlo.

          El anillo de foco es el mismo del resto de controles de la tabla: sin él
          la flecha era alcanzable con el tabulador pero no se veía dónde estaba
          el foco. */}
      {scrollNav.scrollable ? (
        <>
          <div
            data-slot="datatable-carril-izquierda"
            className="pointer-events-none absolute left-0 z-20 hidden items-start sm:flex"
            style={{ top: headerHeight, bottom: 0 }}
          >
            <button
              type="button"
              onClick={() => desplazar(-1)}
              disabled={!scrollNav.canLeft}
              aria-label="Desplazar la tabla a la izquierda"
              className="pointer-events-auto sticky top-1/2 ml-1 flex size-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-neutral-900 bg-neutral-900 text-white shadow-md backdrop-blur-sm transition outline-none hover:bg-neutral-800 focus-visible:ring-3 focus-visible:ring-ring/50 dark:border-white dark:bg-white dark:text-black dark:hover:bg-white/85 disabled:pointer-events-none disabled:opacity-30"
            >
              <ChevronLeft className="size-5" aria-hidden="true" />
            </button>
          </div>
          <div
            data-slot="datatable-carril-derecha"
            className="pointer-events-none absolute right-0 z-20 hidden items-start justify-end sm:flex"
            style={{ top: headerHeight, bottom: 0 }}
          >
            <button
              type="button"
              onClick={() => desplazar(1)}
              disabled={!scrollNav.canRight}
              aria-label="Desplazar la tabla a la derecha"
              className="pointer-events-auto sticky top-1/2 mr-1 flex size-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-neutral-900 bg-neutral-900 text-white shadow-md backdrop-blur-sm transition outline-none hover:bg-neutral-800 focus-visible:ring-3 focus-visible:ring-ring/50 dark:border-white dark:bg-white dark:text-black dark:hover:bg-white/85 disabled:pointer-events-none disabled:opacity-30"
            >
              <ChevronRight className="size-5" aria-hidden="true" />
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
