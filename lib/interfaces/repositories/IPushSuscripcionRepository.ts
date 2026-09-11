// FICHA 410 (design §5, T2.4) — contrato del repositorio del CANAL de push: las suscripciones de
// los dispositivos y el cupo diario. SOLO queries Prisma (docs/architecture.md): la elegibilidad,
// la tabla de desenlaces y la decision de encolar viven en el dominio y en el servicio.
import type { NotificacionEvento } from "@/lib/types/notificacion";

/** Lo que el navegador entrega al suscribirse, mas la etiqueta que compone el cliente. */
export interface RegistrarSuscripcionInput {
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
  /** "Chrome en Android". Opcional: una suscripcion sin etiqueta funciona igual. */
  readonly etiqueta?: string | null;
}

/** Una suscripcion tal y como la necesita el envio. Sin fechas y sin etiqueta: no deciden nada. */
export interface SuscripcionDeUsuario {
  readonly id: string;
  readonly usuarioId: string;
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
}

/** Una toma de cupo: quien, que evento y que jornada. */
export interface TomaDeCupo {
  readonly usuarioId: string;
  readonly evento: NotificacionEvento;
  /** `YYYY-MM-DD`, jornada de Costa Rica (`fechaCalendarioCR`). */
  readonly diaCr: string;
  /** Que aviso gasta el cupo. Es lo que el envio relee para saber a quien le toca hoy. */
  readonly notificacionId: string;
}

export interface IPushSuscripcionRepository {
  /**
   * R16/R17/R18 — UPSERT POR `endpoint`, que es la identidad de la suscripcion. Si el mismo
   * dispositivo vuelve (renovacion, reinstalacion, otra persona inicia sesion) se ACTUALIZA la fila
   * existente y se reescribe su `usuario_id`; nunca se crea una segunda.
   */
  registrar(usuarioId: string, input: RegistrarSuscripcionInput): Promise<void>;

  /**
   * R15/R19 — baja de ESTE dispositivo para ESTE usuario. Acotado por `usuarioId` a proposito: una
   * persona solo puede retirar lo suyo, aunque conozca el endpoint de otra. Devuelve cuantas filas
   * se borraron (0 es un desenlace legitimo: el dispositivo no estaba suscrito).
   */
  eliminarDeUsuario(usuarioId: string, endpoint: string): Promise<number>;

  /**
   * R33 — retirada de una suscripcion MUERTA, por su identificador PROPIO. Se borra por `id` y no
   * por `endpoint` para que el camino del envio no tenga que volver a manejar la credencial.
   */
  eliminarPorId(id: string): Promise<void>;

  /** R26 — todas las suscripciones de esos usuarios. Lista vacia -> `[]` SIN consultar. */
  listarPorUsuarios(usuarioIds: readonly string[]): Promise<SuscripcionDeUsuario[]>;

  /** Sella `ultimo_envio_ok_at`. Diagnostico: nada decide en funcion de este campo. */
  sellarEnvioOk(id: string, ahora: Date): Promise<void>;

  /**
   * R6/R7 — TOMA EL CUPO DEL DIA INSERTANDO. Devuelve `true` si esta llamada gano el cupo y `false`
   * si ya estaba gastado.
   *
   * ⚠️ NO CONSULTA ANTES. La exclusion la da el indice unico `push_envio_dia_cupo`: un `P2002` es
   * «ya salio hoy» y es un no-op, no un error. Sustituir esto por un `SELECT` y luego un `INSERT`
   * deja abierta la rendija por la que dos productores concurrentes mandan DOS push del mismo tipo
   * el mismo dia — y ese fallo no rompe nada: suena dos veces el telefono de otra persona.
   */
  tomarCupoDelDia(toma: TomaDeCupo): Promise<boolean>;

  /**
   * Los usuarios cuyo cupo del dia lo gasto ESTE aviso. Es lo que el envio usa para no mandarle
   * push a quien ya gasto su cupo hoy con OTRO aviso del mismo tipo: el trabajo solo lleva el
   * `notificacionId` (design §7), asi que quien tiene derecho a sonar se relee de la base.
   */
  usuariosConCupoDe(notificacionId: string): Promise<string[]>;
}
