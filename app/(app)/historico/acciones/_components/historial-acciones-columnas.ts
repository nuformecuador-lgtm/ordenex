import type { Column } from "@/components/shared/DataTable";
import { ROL_LABELS } from "@/lib/auth/rol-label";
import { money } from "@/lib/config/moneda";
import {
  CATEGORIA_LABELS,
  ENTIDAD_LABELS,
  type HistorialAccionDTO,
} from "@/lib/types/historial-accion";

// FICHA 362 / T5.4 (design §5.3, R34–R37) — las DIEZ columnas de la tabla del registro.
//
// Son las MISMAS diez de la descarga (design §4.6) y en el mismo orden, a proposito: si la
// pantalla y el archivo dijeran cosas distintas, quien audita tendria dos versiones de un
// mismo hecho y ninguna forma de saber cual vale.
//
// LO QUE ESTE MODULO NO HACE, y es la mitad importante:
//
//   · NO re-deriva `accionLabel` ni `entidadEtiqueta`. Vienen ya resueltos y CONGELADOS
//     desde el servidor (R3/R4): la etiqueta de la fila es la que era el dia del hecho, y
//     recalcularla aqui a partir del tipo la volveria a atar al presente — que es
//     exactamente lo que un registro de auditoria no puede hacer. La entidad puede ni
//     existir ya.
//   · NO convierte `monto` a numero. Es un STRING de escala 2 y `money()` lo formatea
//     partiendo el STRING (R6). Un `Number()` en este camino es la mutacion que caza
//     `historial-accion-money-safe.guardia`.
//   · NO deja `actorNombre` en blanco cuando es `null`: eso significa que la accion la hizo
//     el SISTEMA (un cron, un job), y una celda vacia se lee como «falta el dato» (R36).

/**
 * Formateo FIJO a la zona de Costa Rica (R35). No depende de la zona del navegador ni de la
 * del servidor que renderiza: una fila escrita a las 23:30 de CR tiene que aparecer en el
 * dia de CR, y no en el siguiente. Es el mismo formateador que usa la linea de tiempo de la
 * orden (`HistorialOrdenTimeline`) y el separador de dia del historico.
 */
const FECHA_HORA = new Intl.DateTimeFormat("es-CR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Costa_Rica",
});

/** Lo que se pinta cuando una celda no tiene valor. La raya larga de las tablas de dinero. */
export const SIN_DATO = "—";

/**
 * R36 — la accion sin actor es del SISTEMA. Se escribe con todas sus letras y no con un
 * guion ni con un identificador: «Sistema» es un dato, «—» es la ausencia de uno.
 */
export const ACTOR_SISTEMA = "Sistema";

/** Nombre accesible de la tabla, y titulo del archivo que descarga. */
export const TITULO_HISTORIAL_ACCIONES = "Registro de acciones";

/**
 * ISO -> fecha y hora de Costa Rica. Una fecha ilegible se pinta como ausencia en vez de
 * como `Invalid Date`: el borde nunca deberia mandarla, y si la manda, la fila sigue siendo
 * legible en sus otras nueve columnas.
 */
export function fechaCR(iso: string): string {
  const fecha = new Date(iso);
  return Number.isNaN(fecha.getTime()) ? SIN_DATO : FECHA_HORA.format(fecha);
}

/** R36 — quien hizo la accion, o «Sistema». Nunca en blanco, nunca un identificador. */
export function actorLegible(fila: HistorialAccionDTO): string {
  return fila.actorNombre ?? ACTOR_SISTEMA;
}

/** El rol CONGELADO del actor (R3), traducido. `null` = fue el sistema: no hay rol que dar. */
export function rolLegible(fila: HistorialAccionDTO): string {
  return fila.actorRol === null ? SIN_DATO : ROL_LABELS[fila.actorRol];
}

/**
 * Las diez columnas, en el orden de `design.md §4.6`.
 *
 * ⚠️ LOS `minWidth` NO SON DECORACION. Con `border-collapse` y layout automatico, el minimo
 * del `<th>` gobierna la columna entera; sin ellos, diez columnas se estrujan hasta partir
 * palabras. El minimo de cada columna sale de LA FRASE que tiene que caber, no de su palabra
 * mas larga: «Rechazó un cierre del día» necesita sitio para leerse de un vistazo, y
 * dimensionar por «Rechazó» dejaria cinco lineas de una palabra. (Ficha medida: dos veces se
 * pago por dimensionar columnas de frases por su palabra mas larga.)
 *
 * Y por el mismo motivo aqui NO se usa `wrap-anywhere`: baja el `min-content` de la celda a
 * UN CARACTER y autoriza a partir palabras por cualquier sitio, con lo que la tabla deja de
 * desbordar pero a cambio se vuelve ilegible. Cuando la suma de minimos no cabe, lo correcto
 * es que la tabla scrollee en horizontal DENTRO de su contenedor, que es lo que `DataTable`
 * ya hace.
 */
export const columnasHistorialAcciones: Column<HistorialAccionDTO>[] = [
  {
    id: "fecha",
    value: "Cuándo",
    minWidth: "11rem",
    render: (fila) => fechaCR(fila.fecha),
  },
  {
    id: "actor",
    value: "Quién",
    minWidth: "10rem",
    render: actorLegible,
  },
  {
    id: "rol",
    value: "Rol",
    minWidth: "8rem",
    render: rolLegible,
  },
  {
    id: "categoria",
    value: "Categoría",
    minWidth: "9rem",
    render: (fila) => CATEGORIA_LABELS[fila.categoria],
  },
  {
    // R34 «qué». `accionLabel` viene CONGELADO del servidor; aquí no se traduce nada.
    id: "accion",
    value: "Qué",
    minWidth: "14rem",
    render: (fila) => fila.accionLabel,
  },
  {
    id: "entidadTipo",
    value: "Tipo",
    minWidth: "9rem",
    render: (fila) => ENTIDAD_LABELS[fila.entidadTipo],
  },
  {
    // R34 «sobre qué». `entidadEtiqueta` viene CONGELADA y nunca vacía: sobrevive al borrado
    // físico de la entidad, que es la mitad del valor de este registro.
    id: "entidad",
    value: "Sobre qué",
    minWidth: "12rem",
    render: (fila) => fila.entidadEtiqueta,
  },
  {
    // R37 — el formato de dinero de la casa, alineado a la derecha como el resto de columnas
    // de importe del repo: con las unidades a la misma altura, dos filas se comparan de un
    // vistazo en vez de cifra a cifra.
    id: "monto",
    value: "Importe",
    align: "right",
    minWidth: "8rem",
    render: (fila) => money(fila.monto),
  },
  {
    id: "anterior",
    value: "Valor anterior",
    minWidth: "10rem",
    render: (fila) => fila.valorAnterior ?? SIN_DATO,
  },
  {
    id: "nuevo",
    value: "Valor nuevo",
    minWidth: "10rem",
    render: (fila) => fila.valorNuevo ?? SIN_DATO,
  },
];
