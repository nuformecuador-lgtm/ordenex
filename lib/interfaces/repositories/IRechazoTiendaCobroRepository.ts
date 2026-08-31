import type { PrismaClient } from "@prisma/client";
import type {
  RechazoTiendaCobroDTO,
  RechazoTiendaCobroEstado,
} from "@/lib/types/rechazo-tienda-cobro";

// 💰 FICHA 337 (segunda mitad) — contrato del repositorio de COBROS POR RECHAZO DESDE NOVEDADES.
// SOLO queries Prisma; sin logica de negocio y sin guardias de rol (eso vive en el servicio).
//
// Espejo de `IGastoFijoCobroRepository` (ficha 333). Se copia la FORMA, no se generaliza aquel
// contrato.
//
// ⚠️ MONEY-SAFE: los importes entran como STRING y salen como STRING (`toFixed(2)`). Ni un
// `number` ni un `parseFloat` en todo el camino. Y NO SE CALCULA NADA: los dos importes llegan
// ya derivados por `derivarIngresoOrden` y este repositorio solo los guarda y los devuelve.

/**
 * Cliente aceptado por los metodos transaccionales: cualquier cosa que exponga
 * `rechazoTiendaCobro` —el `tx` de un `$transaction` o el `PrismaClient` completo—. Mismo patron
 * que `GastoFijoCobroTxClient` y `WalletTxClient`.
 */
export type RechazoTiendaCobroTxClient = Pick<PrismaClient, "rechazoTiendaCobro">;

/**
 * Fila a insertar cuando la tienda rechaza desde novedades.
 *
 * ⚠️ TODO LO DE AQUI VA CONGELADO EN EL INSTANTE DEL RECHAZO, y cada campo por su motivo:
 *
 *  · `gestionId` ES LA CLAVE DE IDEMPOTENCIA (`rechazo_tienda_cobro_gestion_uq`) y ademas es el
 *    `origen_id` con el que se escribiran los dos apuntes al aprobar, bajo
 *    `wallet_movimiento_origen_categoria_uq`. Un rechazo, un cobro, un apunte por concepto.
 *  · `tiendaId` es A QUIEN se le cobra. Congelado por la leccion de la feature 69 (su R13): el
 *    feed del cierre leia `orden.tienda_id` VIVO y re-apuntar la orden movia el dinero de ledger.
 *    Aqui la ventana entre el rechazo y la aprobacion puede durar dias.
 *  · `montoFlete` y `montoIva` son la salida LITERAL de `derivarIngresoOrden` para
 *    `resultado = "rechazada"` con la tarifa que resolvia ENTONCES. Copiarlos es la misma
 *    correccion que R16 de la 333: lo que el administrador aprueba tiene que ser lo que vio.
 *  · `tarifaId` es AUDITORIA (que fila de `tarifas` produjo esos importes), no una entrada de
 *    ninguna formula. `null` cuando la tienda no tenia tarifa vigente.
 */
export interface CrearCobroRechazoTiendaInput {
  /** LA CLAVE. La gestion sintetica `rechazada` que nacio del rechazo de la tienda. */
  gestionId: string;
  ordenId: string;
  /** CONGELADO: a quien se le cobra. */
  tiendaId: string;
  /** STRING > 0 (money-safe) -> `Prisma.Decimal` en la implementacion. */
  montoFlete: string;
  /** STRING >= 0: el `"0.00"` es un valor real (tarifa con IVA de flete al 0 %). */
  montoIva: string;
  /** Auditoria: la fila de `tarifas` que gano la cascada (tienda, zona). `null` = sin tarifa. */
  tarifaId: string | null;
  /** `YYYY-MM-DD`: dia calendario CR del rechazo. Va a una columna `DATE`. */
  generadoEl: string;
}

/**
 * Lectura COMPLETA de un cobro, para uso INTERNO del servidor. No es el DTO: lleva `gestionId`
 * —que es la clave del libro— y `tiendaId`, que no cruzan la frontera al cliente. El camino de
 * aprobacion necesita los dos.
 */
export interface RechazoTiendaCobroRegistro {
  id: string;
  /** LA CLAVE del libro, congelada al generar: es el `origen_id` de los dos apuntes. */
  gestionId: string;
  ordenId: string;
  tiendaId: string;
  /** STRING 2 dec. La COPIA que se cobra. */
  montoFlete: string;
  /** STRING 2 dec. La COPIA que se cobra; `"0.00"` significa «esta tarifa no lleva IVA». */
  montoIva: string;
  tarifaId: string | null;
  estado: RechazoTiendaCobroEstado;
  /** `YYYY-MM-DD`. */
  generadoEl: string;
  decididoPor: string | null;
  /** ISO-8601 o `null` mientras siga `pendiente`. */
  decididoAt: string | null;
}

/** Estados a los que una decision puede llevar un cobro. `pendiente` no es un destino. */
export type RechazoTiendaCobroEstadoDecidido = Exclude<RechazoTiendaCobroEstado, "pendiente">;

export interface IRechazoTiendaCobroRepository {
  /**
   * Da de alta el cobro PENDIENTE, DENTRO de la `tx` que crea la gestion del rechazo, de forma
   * IDEMPOTENTE: `createMany({ skipDuplicates: true })` compila a `ON CONFLICT DO NOTHING` contra
   * `rechazo_tienda_cobro_gestion_uq`, asi que un segundo intento sobre la misma gestion inserta
   * 0 filas y NO hay check-then-insert (sin TOCTOU). Devuelve cuantas filas se insertaron.
   *
   * Va DENTRO de la transaccion del rechazo y no despues: o queda la gestion `rechazada` Y su
   * cobro, o no queda ninguna de las dos cosas. Emitirlo fuera abriria un hueco en el que un
   * rechazo se cobra... nunca, sin que nada lo diga.
   *
   * Efecto lateral BUSCADO: como el indice es TOTAL y no parcial, un cobro ya RECHAZADO conserva
   * su `gestion_id` y no puede volver a darse de alta. El «no» del administrador es durable.
   */
  crearPendiente(
    tx: RechazoTiendaCobroTxClient,
    input: CrearCobroRechazoTiendaInput,
  ): Promise<number>;
  /**
   * Lee un cobro por id. `null` si no existe.
   *
   * El `tx` va OPCIONAL y AL FINAL (patron `IGastoFijoCobroRepository.obtenerPorId`): dentro de
   * la transaccion de aprobacion se pasa el `tx` para leer lo que esa misma transaccion ve;
   * fuera, se omite y manda el cliente del repositorio.
   */
  obtenerPorId(
    id: string,
    tx?: RechazoTiendaCobroTxClient,
  ): Promise<RechazoTiendaCobroRegistro | null>;
  /**
   * La COLA: los cobros `pendiente`, del MAS ANTIGUO al mas reciente, recortada a `tope` filas.
   * El numero real que la pantalla enseña sale de `contarPendientes`, no del largo de esta lista.
   */
  listarPendientes(tope: number): Promise<RechazoTiendaCobroDTO[]>;
  /** Cuantos cobros siguen `pendiente`. TODOS, sin recorte: es el numero que se enseña. */
  contarPendientes(): Promise<number>;
  /**
   * ⚠️ LA TRANSICION, y es la que serializa a dos humanos. `updateMany` con
   * **`WHERE id = ... AND estado = 'pendiente'`**: bajo `READ COMMITTED` (el nivel por defecto de
   * Postgres y de Prisma) la segunda transaccion espera el bloqueo de fila, re-evalua el `WHERE`
   * tras el commit de la primera, afecta **0 filas** y sale sin escribir.
   *
   * Devuelve el `count`: `1` = la decision es tuya; `0` = ya estaba decidida (`ya_decidido`).
   * CERO FILAS NO ES UN ERROR: es «alguien decidio antes».
   *
   * Quitar `estado = 'pendiente'` de este `WHERE` es una de las mutaciones que la ficha obliga a
   * matar con un test de concurrencia real contra Postgres.
   */
  marcarDecidido(
    tx: RechazoTiendaCobroTxClient,
    id: string,
    estado: RechazoTiendaCobroEstadoDecidido,
    actorId: string,
    ahora: Date,
  ): Promise<number>;
}
