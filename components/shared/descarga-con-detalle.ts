/**
 * Ficha 464 (design §5.1) — adaptador de CLIENTE que ENLAZA la hoja de movimientos con la hoja
 * «Detalle por orden» de UNA descarga.
 *
 * Módulo sin React y sin DOM: recibe la respuesta de UNA petición (las filas del libro y su detalle,
 * alineados por el servidor, R36) y devuelve las dos listas de filas que el control de descarga
 * entrega al generador. No suma dinero (R22/R23: el cuadre lo decide el servidor) ni redacta textos
 * de dominio: el texto de cada estado y la proyección de cada orden los pone la superficie.
 *
 * Lo que SÍ decide, y por eso vive una sola vez:
 *  - la numeración «N.º»: correlativa desde 1 en el orden de la hoja, sin número en las líneas que no
 *    son un movimiento (el saldo inicial) (R15);
 *  - que cada fila de detalle lleva el número de SU movimiento en el MISMO archivo (R19), en el orden
 *    de la hoja y, dentro de un movimiento, en el que trae el servidor (R20);
 *  - que el detalle y la hoja hablan del mismo conjunto: un detalle sin fila, o una fila de movimiento
 *    sin su detalle, NO produce archivo (lanza) en vez de dejar un enlace roto (R36).
 */
import type { DescargaFila } from "@/lib/types/descarga";
import type {
  CierreDelLoteDTO,
  DetalleDeMovimientoLoteDTO,
  OrdenDelLoteDTO,
} from "@/lib/types/detalle-en-lote";

/**
 * Lo que la superficie recibe para proyectar UNA orden a una fila de la hoja de detalle: la fila YA
 * proyectada de su movimiento (para que «Fecha» y «Movimiento» sean el MISMO texto, R28), la cabecera
 * de su cierre y la orden.
 */
export interface EntradaFilaDetalle {
  fila: DescargaFila;
  cierre: CierreDelLoteDTO;
  orden: OrdenDelLoteDTO;
}

export interface EnlazarHojasArgs<L> {
  /** Las líneas de la hoja de movimientos, EN SU ORDEN (incluida la del saldo inicial, si la hay). */
  lineas: readonly L[];
  /** `false` ⇒ la línea no es un movimiento (el saldo inicial): sin «N.º» y sin detalle (R15). */
  numerada: (linea: L) => boolean;
  /** El id del movimiento con el que el servidor la enlazó, o `null` si no tiene detalle. Nunca se pinta. */
  idDe: (linea: L) => string | null;
  /** La proyección de HOY de la línea a la hoja de movimientos (R9/R14). */
  filaDe: (linea: L) => DescargaFila;
  /** El detalle de la MISMA respuesta (R36). */
  detalle: readonly DetalleDeMovimientoLoteDTO[];
  /** La proyección de una orden a una fila de la hoja de detalle (sin «N.º», que lo pone esto). */
  filaDetalleDe: (entrada: EntradaFilaDetalle) => DescargaFila;
  /** El texto de la columna de estado de un movimiento (R16/R23). */
  textoEstado: (detalle: DetalleDeMovimientoLoteDTO) => string;
  /** Clave de la columna de enlace («N.º») en las dos hojas. */
  claveEnlace: string;
  /** Clave de la columna de estado («Detalle por orden») en la hoja de movimientos. */
  claveEstado: string;
}

export interface HojasEnlazadas {
  filas: DescargaFila[];
  filasDetalle: DescargaFila[];
}

export function enlazarHojas<L>(args: EnlazarHojasArgs<L>): HojasEnlazadas {
  const porMovimiento = new Map<string, DetalleDeMovimientoLoteDTO>();
  for (const d of args.detalle) {
    if (porMovimiento.has(d.movimientoId)) throw new Error("detalle repetido para un mismo movimiento");
    porMovimiento.set(d.movimientoId, d);
  }

  const usados = new Set<string>();
  const filas: DescargaFila[] = [];
  const filasDetalle: DescargaFila[] = [];
  let numero = 0;

  for (const linea of args.lineas) {
    const base = args.filaDe(linea);
    if (!args.numerada(linea)) {
      filas.push({ [args.claveEnlace]: null, ...base, [args.claveEstado]: null });
      continue;
    }
    numero += 1;
    const id = args.idDe(linea);
    const d = id === null ? undefined : porMovimiento.get(id);
    if (id !== null && d === undefined) throw new Error("un movimiento de la hoja llegó sin su detalle");
    if (id !== null) usados.add(id);
    filas.push({
      [args.claveEnlace]: numero,
      ...base,
      [args.claveEstado]: d === undefined ? null : args.textoEstado(d),
    });
    if (d === undefined || d.modo !== "ordenes") continue;
    for (const orden of d.ordenes) {
      filasDetalle.push({
        [args.claveEnlace]: numero,
        ...args.filaDetalleDe({ fila: base, cierre: d.cierre, orden }),
      });
    }
  }

  if (usados.size !== porMovimiento.size) {
    throw new Error("el detalle habla de un movimiento que no está en la hoja");
  }
  return { filas, filasDetalle };
}
