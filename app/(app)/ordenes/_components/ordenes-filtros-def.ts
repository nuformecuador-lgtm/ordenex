import type { FilterDef } from "@/components/shared/FilterComponent";
import type { CatalogoFiltrosOrdenesDTO } from "@/lib/types/filtros-ordenes";
import { ultimosNDiasCalendarioCR } from "@/lib/utils/fecha-cr";

// Feature 144 / B3 (design.md §4.1) — TODO lo especifico de ordenes vive aqui.
//
// El componente generico del bloque A no sabe que es una provincia, una cuenta por
// API key ni un atajo de antiguedad: la cadena geografica son dos `dependsOn`, el
// agrupado de tienda son dos strings en `group` y el filtro de tiempo es UNO solo
// (R55, R56). Funcion PURA: catalogo -> declaraciones.

/** Grupos del filtro de tienda (R51, decision (h) del spec). */
export const GRUPO_CUENTAS_TIENDA = "Cuentas tienda";
export const GRUPO_INTEGRACIONES = "Integraciones (API)";

/** Sufijo de las cuentas inactivas, que SI se ofrecen (decision (e), R50/R51). */
export const SUFIJO_INACTIVA = " (inactiva)";

/**
 * Atajos de antiguedad ofrecidos DENTRO del filtro de tiempo (R9). Sus valores siguen
 * siendo los de `CREATED_PRESETS` del contrato server-side, pero ya NO viajan a la
 * salida: el atajo se resuelve AQUI a su rango de fechas calendario de Costa Rica y lo
 * que se emite (y se pinta en el calendario) son `created_desde`/`created_hasta`. El
 * rango se calcula con la misma regla que aplica el servidor a `created_preset`
 * (`inicioDeUltimosNDiasCREnUtc`: N dias calendario incluido hoy).
 */
export const ATAJOS_CREACION = [
  { value: "7d", dias: 7, label: "Últimos 7 días" },
  { value: "15d", dias: 15, label: "Últimos 15 días" },
  { value: "30d", dias: 30, label: "Últimos 30 días" },
  { value: "90d", dias: 90, label: "Últimos 90 días" },
] as const;

/** Clave del filtro de tiempo en la seleccion agregada (posicional `[atajo, desde, hasta]`). */
export const CLAVE_CREACION = "created";

/**
 * Clave del filtro de ESTADO. Es la misma que espera el `filter` de `listarOrdenes`,
 * asi que `seleccionAFilter` la deja pasar tal cual (identidad, como el resto de
 * claves de catalogo).
 */
export const CLAVE_ESTADO = "status_id";

/**
 * Clave del filtro REASIGNABLES. Marcado, el backend devuelve solo las ordenes que
 * esperan que alguien les vuelva a poner mensajero: con prioridad, no reprogramadas y
 * sin mensajero asignado. Desmarcado, el filtro no existe.
 */
export const CLAVE_REASIGNABLES = "reasignables";

/**
 * Declara los SEIS filtros de la barra de ordenes (cinco si el rol no lleva tienda,
 * R62) sobre el contrato del bloque A.
 */
export function construirFiltrosOrdenes(
  cat: CatalogoFiltrosOrdenesDTO,
  opts: { incluirTienda: boolean; ahora?: Date },
): FilterDef[] {
  // `ahora` inyectable para poder fijar los rangos de los atajos en los tests.
  const ahora = opts.ahora ?? new Date();

  const tienda: FilterDef[] = opts.incluirTienda
    ? [
        {
          key: "tienda_id",
          label: "Tienda",
          kind: "multi",
          searchPlaceholder: "Buscar tienda…",
          options: cat.tiendas.map((t) => ({
            value: t.id,
            // R51: la cuenta inactiva se distingue en el TEXTO visible; el backend
            // solo entrega banderas (no textos), asi que la etiqueta se compone aqui.
            label: t.activa ? t.nombre : `${t.nombre}${SUFIJO_INACTIVA}`,
            group: t.esApiKey ? GRUPO_INTEGRACIONES : GRUPO_CUENTAS_TIENDA,
          })),
        },
      ]
    : [];

  return [
    {
      key: "zona_id",
      label: "Zona",
      kind: "multi",
      searchPlaceholder: "Buscar zona…",
      options: cat.zonas.map((z) => ({ value: z.id, label: z.nombre })),
    },
    ...tienda,
    {
      key: "provincia_id",
      label: "Provincia",
      kind: "multi",
      searchPlaceholder: "Buscar provincia…",
      options: cat.provincias.map((p) => ({ value: p.id, label: p.nombre })),
    },
    {
      key: "canton_id",
      label: "Cantón",
      kind: "multi",
      dependsOn: "provincia_id", // R56: la cadena se declara, no se programa
      searchPlaceholder: "Buscar cantón…",
      options: cat.cantones.map((c) => ({
        value: c.id,
        label: c.nombre,
        parentValue: c.padreId,
      })),
    },
    {
      key: "distrito_id",
      label: "Distrito",
      kind: "multi",
      dependsOn: "canton_id",
      searchPlaceholder: "Buscar distrito…",
      options: cat.distritos.map((d) => ({
        value: d.id,
        label: d.nombre,
        parentValue: d.padreId,
      })),
    },
    {
      // UN solo filtro de tiempo (decision (p)): los atajos son ajustes rapidos del
      // rango, dentro del propio calendario.
      key: CLAVE_CREACION,
      label: "Fecha de creación",
      kind: "dateRange",
      placeholder: "Cualquier fecha",
      options: ATAJOS_CREACION.map((a) => ({
        value: a.value,
        label: a.label,
        defaultRange: ultimosNDiasCalendarioCR(a.dias, ahora),
      })),
    },
    {
      // Interruptor: o esta puesto o no esta. El predicado (prioridad + no
      // reprogramada + sin mensajero) lo resuelve el backend; aqui solo se declara.
      key: CLAVE_REASIGNABLES,
      label: "Reasignables",
      kind: "boolean",
    },
  ];
}

/** Catalogo vacio: barra montada pero sin opciones cuando el catalogo no cargo (R64). */
export const CATALOGO_FILTROS_VACIO: CatalogoFiltrosOrdenesDTO = {
  zonas: [],
  tiendas: [],
  provincias: [],
  cantones: [],
  distritos: [],
};
