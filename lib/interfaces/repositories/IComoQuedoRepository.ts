import type { AgregadoCajaRow } from "@/lib/types/wallet";

/**
 * FICHA 458-B (design §3.7, R58) — las lecturas de «Cómo quedó». SOLO queries. Toda posicion se toma
 * en el orden de los libros (`fecha_movimiento, created_at, id`), comparada EN LA BASE contra la fila
 * de referencia (nunca contra un instante pasado como parametro: la precision no se pierde).
 *
 * La CONTRAPARTIDA de una fila en el otro libro es la del MISMO origen (`origen_tipo`, `origen_id`; el
 * debito de un cobro de Ordenex, por las lineas de caja que lo nombran) escrita MAS CERCA en el tiempo
 * (`created_at`): los dos asientos de un registro se escriben en la misma transaccion, y su
 * contra-asiento, en otra posterior. Asi el pago y su anulacion, que comparten origen, no se confunden.
 */
export interface FilaDeLibroComoQuedo {
  id: string;
  origenTipo: string;
  origenId: string | null;
  /** La tienda o el mensajero de la fila; `null` en la caja. */
  cuentaId: string | null;
}

export interface CuentasDeOrigen {
  /** Por cuenta, su fila contrapartida (la mas cercana). */
  tiendas: { tiendaId: string; filaId: string }[];
  mensajeros: { mensajeroId: string; filaId: string }[];
}

export interface IComoQuedoRepository {
  fila(libro: "caja" | "tienda" | "mensajero", id: string): Promise<FilaDeLibroComoQuedo | null>;
  /** La linea de la caja contrapartida de una fila de una cuenta, o `null` si no la tiene. */
  cajaDeFila(libro: "tienda" | "mensajero", filaId: string): Promise<string | null>;
  /** Las filas de las cuentas contrapartida de una linea de la caja (una por cuenta). */
  cuentasDeFilaCaja(cajaFilaId: string): Promise<CuentasDeOrigen>;
  /** El agregado de la caja hasta esa linea (inclusive). */
  agregadoCajaHasta(cajaFilaId: string): Promise<readonly AgregadoCajaRow[]>;
  /** Creditos y debitos de la tienda hasta esa fila suya (inclusive). */
  saldoTiendaHasta(tiendaId: string, filaId: string): Promise<{ creditos: string; debitos: string }>;
  /** Devengado y pagado del mensajero hasta esa fila suya (inclusive). */
  cuentaMensajeroHasta(mensajeroId: string, filaId: string): Promise<{ devengado: string; pagado: string }>;
}
