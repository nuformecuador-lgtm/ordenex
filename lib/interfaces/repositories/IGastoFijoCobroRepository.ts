import type { PrismaClient } from "@prisma/client";
import type { GastoFijoCobroDTO, GastoFijoCobroEstado } from "@/lib/types/gasto-fijo-cobro";

// Ficha 333 (B4, design §6) — contrato del repositorio de COBROS de gasto fijo. SOLO queries
// Prisma; sin lógica de negocio y sin guardias de rol (eso vive en el servicio).
//
// ⚠️ MONEY-SAFE: el `monto` entra como STRING y sale como STRING (`toFixed(2)`). Ni un `number`
// ni un `parseFloat` en todo el camino (R43).

/**
 * Cliente aceptado por los métodos transaccionales: cualquier cosa que exponga `gastoFijoCobro`
 * —el `tx` de un `$transaction` o el `PrismaClient` completo—. Mismo patrón que `WalletTxClient`.
 */
export type GastoFijoCobroTxClient = Pick<PrismaClient, "gastoFijoCobro">;

/**
 * Fila a insertar cuando el cron genera un cobro pendiente.
 *
 * ⚠️ `origenId` ES LA CLAVE DEL LIBRO y se resuelve UNA sola vez, aquí arriba, en el momento de
 * generar (R8): vale `"<plantillaId>:<periodo>"` con el `periodo` que produce `periodoDe`, y es
 * literalmente la misma cadena que acabará en `wallet_movimiento.origen_id` al aprobar. NO se
 * recalcula nunca más. Cambiar su formato duplica plata (R11).
 *
 * `concepto` y `monto` son COPIAS de la plantilla tomadas en este instante (R7/R16): lo que el
 * maestro apruebe será esto, no lo que la plantilla diga entonces.
 */
export interface CrearCobroPendienteInput {
  plantillaId: string;
  origenId: string;
  periodo: string;
  concepto: string;
  /** STRING > 0 (money-safe) -> `Prisma.Decimal` en la implementación. */
  monto: string;
  /** `YYYY-MM-DD`: día calendario CR de la corrida que lo crea. Va a una columna `DATE`. */
  generadoEl: string;
}

/**
 * Lectura COMPLETA de un cobro, para uso INTERNO del servidor. No es el DTO: lleva `origenId`,
 * `plantillaId` y `movimientoId`, que no cruzan la frontera al cliente (design §6.1). El camino
 * de aprobación necesita los tres.
 */
export interface GastoFijoCobroRegistro {
  id: string;
  plantillaId: string | null;
  /** `"<plantillaId>:<periodo>"` — LA CLAVE DEL LIBRO, congelada al generar. */
  origenId: string;
  periodo: string;
  concepto: string;
  /** STRING con 2 decimales. La COPIA que se cobra (R16). */
  monto: string;
  estado: GastoFijoCobroEstado;
  /** `YYYY-MM-DD`. */
  generadoEl: string;
  decididoPor: string | null;
  /** ISO-8601 o `null` mientras siga `pendiente`. */
  decididoAt: string | null;
  movimientoId: string | null;
}

/** Estados a los que una decisión puede llevar un cobro. `pendiente` no es un destino. */
export type GastoFijoCobroEstadoDecidido = Exclude<GastoFijoCobroEstado, "pendiente">;

export interface IGastoFijoCobroRepository {
  /**
   * R6/R9/R10 — inserta los cobros pendientes de una corrida DENTRO de `tx`, de forma
   * IDEMPOTENTE: `createMany({ skipDuplicates: true })` compila a `ON CONFLICT DO NOTHING`
   * contra `gasto_fijo_cobro_origen_uq`, así que la segunda corrida del mismo día inserta 0
   * filas y NO hay check-then-insert (sin TOCTOU). Devuelve cuántas filas se insertaron.
   *
   * Efecto lateral BUSCADO (R22): como el índice es TOTAL y no parcial, un período ya
   * `rechazado` conserva su `origen_id` y no vuelve a generarse.
   */
  crearPendientes(tx: GastoFijoCobroTxClient, inputs: CrearCobroPendienteInput[]): Promise<number>;
  /**
   * Lee un cobro por id. `null` si no existe (R20).
   *
   * El `tx` va OPCIONAL y AL FINAL (patrón `INotificacionRepository.crear`): dentro de la
   * transacción de aprobación se pasa el `tx` para leer lo que esa misma transacción ve; fuera,
   * se omite y manda el cliente del repositorio.
   */
  obtenerPorId(id: string, tx?: GastoFijoCobroTxClient): Promise<GastoFijoCobroRegistro | null>;
  /**
   * R39/R41 — la COLA: los cobros `pendiente`, del MÁS ANTIGUO al más reciente, recortada a
   * `tope` filas. El número real que la pantalla enseña sale de `contarPendientes`, no del
   * largo de esta lista.
   */
  listarPendientes(tope: number): Promise<GastoFijoCobroDTO[]>;
  /** R29/R30/R41 — cuántos cobros siguen `pendiente`. TODOS, no sólo los de la corrida de hoy. */
  contarPendientes(): Promise<number>;
  /**
   * ⚠️ FICHA 333 (D2/F1, R55) — cuántos cobros `pendiente` tiene UNA plantilla.
   *
   * **No estaba en C1 y se añade en la tanda D porque R55 lo necesita**: es el número que el
   * diálogo de confirmación de borrado lee AL ABRIRSE para poder decir «se cancelarán N cobros
   * pendientes» ANTES de aceptar. Se lee en ESE momento y no se deriva de un listado traído con
   * la página: un número con minutos de antigüedad estaría autorizando un borrado.
   *
   * Es una lectura, no la cancelación: el número que el borrado REPORTA es el que devuelve
   * `cancelarPendientesDePlantilla` en su propia transacción (R56), y los dos pueden diferir
   * legítimamente si alguien decidió un cobro entre medias.
   */
  contarPendientesDePlantilla(plantillaId: string): Promise<number>;
  /**
   * ⚠️ R17/R18 — LA TRANSICIÓN, y es la que serializa a dos humanos. `updateMany` con
   * **`WHERE id = ... AND estado = 'pendiente'`**: bajo `READ COMMITTED` (el nivel por defecto
   * de Postgres y de Prisma) la segunda transacción espera el bloqueo de fila, re-evalúa el
   * `WHERE` tras el commit de la primera, afecta **0 filas** y aborta sin escribir.
   *
   * Devuelve el `count`: `1` = la decisión es tuya; `0` = ya estaba decidido (`ya_decidido`).
   * Quitar `estado = 'pendiente'` del `WHERE` es una de las tres mutaciones de dinero que la
   * ficha obliga a matar.
   */
  marcarDecidido(
    tx: GastoFijoCobroTxClient,
    id: string,
    estado: GastoFijoCobroEstadoDecidido,
    actorId: string,
    ahora: Date,
  ): Promise<number>;
  /**
   * R15/R19 — enlaza el cobro ya `aprobado` con el movimiento del libro que lo salda. Lo ata el
   * CHECK `gasto_fijo_cobro_movimiento_solo_aprobado`: sólo un aprobado puede apuntar al libro.
   */
  enlazarMovimiento(
    tx: GastoFijoCobroTxClient,
    id: string,
    movimientoId: string,
  ): Promise<void>;
  /**
   * R45/R56 — cancela TODOS los cobros que sigan `pendiente` de esa plantilla, dentro de `tx`,
   * y devuelve cuántos canceló REALMENTE. Lo llama el borrado de plantilla desde su misma
   * transacción: o se cancelan y la plantilla desaparece, o no ocurre ninguna de las dos cosas.
   *
   * Si el número cambió entre la confirmación y la ejecución, el borrado sigue adelante y este
   * `count` es el que se reporta (R56): abortar un borrado legítimo porque alguien aprobó un
   * cobro entre medias sería castigar al usuario por una carrera que no puede ver.
   *
   * Y si alguien olvidara llamarlo, la BASE lo impide (R46): con `plantilla_id ON DELETE SET
   * NULL` y el CHECK `gasto_fijo_cobro_pendiente_con_plantilla`, el `DELETE` de una plantilla
   * con pendientes vivos aborta ruidosamente.
   */
  cancelarPendientesDePlantilla(
    tx: GastoFijoCobroTxClient,
    plantillaId: string,
    actorId: string,
    ahora: Date,
  ): Promise<number>;
}
