// FICHA 410 (design §6, T3.4) — EL UNICO PUNTO DE CABLEADO DEL CANAL DE PUSH.
//
// ---------------------------------------------------------------------------------------------
// POR QUE UN DECORADOR Y NO UN NOTIFICADOR INYECTADO EN CADA PRODUCTOR (alternativa A1)
// ---------------------------------------------------------------------------------------------
// Inyectar uno por productor es lo que este repositorio ya hace para la campana, asi que era la
// opcion «coherente». Y es exactamente la que ya fallo aqui: el 2026-08-23 se midio que de SIETE
// notificadores reales, DOS no los pasaba nadie —incluido el aviso nocturno del corte, el que mas
// se emite— y la suite entera estaba verde. Un productor que se olvida de inyectar no rompe nada:
// simplemente no avisa.
//
// Con DOCE productores y OCHO eventos elegibles, repetir ese patron es garantizar que alguno se
// quede fuera. El decorador tiene UN punto de fallo en vez de doce, y ese punto SE PUEDE VIGILAR:
// `tests/unit/guards/push-cableado-unico.guardia.test.ts` afirma que `repoReal()` devuelve un
// repositorio decorado y que NINGUN binding de produccion construye el suyo por su cuenta (R51).
//
// ---------------------------------------------------------------------------------------------
// LO QUE HACE, EN ORDEN, Y POR QUE ESE ORDEN
// ---------------------------------------------------------------------------------------------
//   1. delega `crear` en el repositorio de verdad; si devolvio `null` (la dedupe del AVISO lo
//      absorbio) NO PASA NADA MAS. El push nunca resucita un aviso deduplicado;
//   2. puerta BARATA por evento: `orden_rechazada` —el evento mas frecuente del sistema— sale por
//      aqui sin gastar una sola consulta;
//   3. resuelve los destinatarios reales y se queda con los que el catalogo declara elegibles
//      PARA SU ROL (R1/R4);
//   4. toma el cupo del dia de cada uno INSERTANDO (R6/R7);
//   5. si al menos uno gano el cupo, encola UN trabajo por AVISO —no por suscripcion ni por
//      destinatario— con `dedupe_key = "push:<notificacionId>"` (R35) y tres intentos.
//
// TODO ENVUELTO EN `emitirBestEffort`: un fallo del canal NO puede tumbar la operacion de negocio
// que acaba de ocurrir (R27/R28), y no es un `catch` vacio — queda registrado con su operacion y su
// causa.
import { defaultLogger, type ErrorLogger } from "@/lib/errors";
import type {
  CrearNotificacionInput,
  INotificacionRepository,
  ListarParaUsuarioInput,
  NotificacionActor,
  NotificacionDestinatario,
  NotificacionRow,
  NotificacionTxClient,
} from "@/lib/interfaces/repositories/INotificacionRepository";
import type { IPushNotificacionReader } from "@/lib/interfaces/repositories/IPushNotificacionReader";
import type { IPushSuscripcionRepository } from "@/lib/interfaces/repositories/IPushSuscripcionRepository";
import type { IJobRepository } from "@/lib/interfaces/repositories/IJobRepository";
import { emitirBestEffort } from "@/lib/notificaciones/best-effort";
import { esElegiblePush, eventoPuedeEmpujar } from "@/lib/notificaciones/push-elegibles";
import type { NotificacionEvento } from "@/lib/types/notificacion";
import { fechaCalendarioCR } from "@/lib/utils/fecha-cr";

/** Nombre de la operacion en el log del best-effort. Sin PII, sin endpoint, sin claves (R23). */
const OPERACION = "push_web";

/** Tres y no cinco: un push que no entro en tres intentos ya llego tarde a algo que tenia plazo. */
export const MAX_INTENTOS_PUSH = 3;

/** `push:<notificacionId>` — un trabajo por aviso, y el segundo intento no crea otro (R35). */
export function dedupeKeyDePush(notificacionId: string): string {
  return `push:${notificacionId}`;
}

/** El payload del trabajo. UN campo y nada mas (design §7): el texto se resuelve AL EJECUTAR. */
export interface PushWebPayload {
  readonly notificacionId: string;
}

export interface ConPushWebDeps {
  lector: IPushNotificacionReader;
  canal: IPushSuscripcionRepository;
  cola: Pick<IJobRepository, "enqueue">;
  /** ¿Hay claves VAPID? Sin canal no se encola nada (R30). Inyectable para el test. */
  hayCanal: () => boolean;
  now?: () => Date;
  logger?: ErrorLogger;
}

/**
 * Envuelve un `INotificacionRepository` para que cada aviso ELEGIBLE que de verdad se inserte deje
 * ademas un trabajo de push en la cola. Delega TODO lo demas sin tocarlo.
 */
export function conPushWeb(
  base: INotificacionRepository,
  deps: ConPushWebDeps,
): INotificacionRepository {
  return new NotificacionRepositoryConPush(base, deps);
}

export class NotificacionRepositoryConPush implements INotificacionRepository {
  private readonly now: () => Date;
  private readonly logger: ErrorLogger;

  constructor(
    private readonly base: INotificacionRepository,
    private readonly deps: ConPushWebDeps,
  ) {
    this.now = deps.now ?? (() => new Date());
    this.logger = deps.logger ?? defaultLogger;
  }

  async crear(input: CrearNotificacionInput, tx?: NotificacionTxClient): Promise<string | null> {
    const id = await this.base.crear(input, tx);
    if (id === null) return null; // la dedupe del AVISO mando: no hay hecho nuevo que transportar

    // ⚠️ DENTRO DE UNA TRANSACCION DE NEGOCIO, NI UNA CONSULTA (R27). El unico productor que pasa
    // `tx` es el del rechazo, que emite dentro de la transaccion del cambio de estado —y
    // `orden_rechazada` ni siquiera es elegible—. Aun asi la puerta se escribe: encolar ahi
    // ataria la operacion de negocio al canal, y un error de sentencia abortaria la transaccion
    // ENTERA, revirtiendo un cambio de estado legitimo por un push.
    if (tx !== undefined) return id;

    // Puerta barata: sin esto, cada `orden_rechazada` —cuatro filas por rechazo— pagaria dos
    // consultas para descubrir que no se pushea.
    if (!eventoPuedeEmpujar(input.evento)) return id;

    await emitirBestEffort(OPERACION, () => this.encolar(id, input.evento), this.logger);
    return id;
  }

  /** Resuelve elegibles, toma su cupo y encola UN trabajo si alguien gano. */
  private async encolar(notificacionId: string, evento: NotificacionEvento): Promise<void> {
    // R30: sin claves VAPID no hay canal. No se encola nada -> no se acumulan trabajos que no
    // pueden progresar (R36). No lanza y no bloquea nada: es la leccion de la ficha 400.
    if (!this.deps.hayCanal()) return;

    const destinatarios = await this.deps.lector.destinatariosPendientes(notificacionId);
    // R1/R4: la elegibilidad es del par (evento, ROL DEL LECTOR). Los avisos del mensajero llegan
    // como fila dirigida a usuario, con `destinatario_rol` en NULL: el rol sale del usuario.
    const elegibles = destinatarios.filter((d) => esElegiblePush(evento, d.rol));
    if (elegibles.length === 0) return;

    const diaCr = fechaCalendarioCR(this.now());
    let alguienGanoElCupo = false;
    for (const destinatario of elegibles) {
      // R6/R7: INSERTANDO. El que gana es el que consigue insertar; el resto es un no-op.
      const gano = await this.deps.canal.tomarCupoDelDia({
        usuarioId: destinatario.usuarioId,
        evento,
        diaCr,
        notificacionId,
      });
      if (gano) alguienGanoElCupo = true;
    }
    // Si el cupo del dia ya estaba gastado para TODOS, el trabajo ni se crea. Es la primera de las
    // tres cotas que impiden que este tipo ahogue la cola (design §7).
    if (!alguienGanoElCupo) return;

    const payload: PushWebPayload = { notificacionId };
    await this.deps.cola.enqueue("push_web", { ...payload }, {
      dedupeKey: dedupeKeyDePush(notificacionId), // R35: una segunda emision no crea otro trabajo
      maxIntentos: MAX_INTENTOS_PUSH, // R34: tope acotado
    });
  }

  // --- Delegacion pura. Ni una regla, ni un filtro, ni un efecto. -----------------------------

  existeNoLeidaPara(
    evento: NotificacionEvento,
    entidadId: string,
    destinatario: NotificacionDestinatario,
    tx?: NotificacionTxClient,
  ): Promise<boolean> {
    return this.base.existeNoLeidaPara(evento, entidadId, destinatario, tx);
  }

  listarParaUsuario(input: ListarParaUsuarioInput): Promise<NotificacionRow[]> {
    return this.base.listarParaUsuario(input);
  }

  verificarVisible(
    id: string,
    actor: NotificacionActor,
  ): Promise<"visible" | "no_visible" | "no_existe"> {
    return this.base.verificarVisible(id, actor);
  }

  /** R44: marcar leido NO produce push ni retira los ya entregados. Delegacion y nada mas. */
  marcarTodasLeidas(actor: NotificacionActor, desde: Date, ahora: Date): Promise<number> {
    return this.base.marcarTodasLeidas(actor, desde, ahora);
  }

  /** R44: descartar tampoco. */
  descartar(notificacionId: string, usuarioId: string, ahora: Date): Promise<void> {
    return this.base.descartar(notificacionId, usuarioId, ahora);
  }
}
