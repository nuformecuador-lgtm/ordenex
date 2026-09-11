// FICHA 410 (design §7/§9, T3.7) — LA POLITICA DEL CANAL: a quien, con que texto y que hacer con
// cada desenlace. Logica pura: ni HTTP, ni Prisma, ni React. Todo entra por constructor.
//
// ---------------------------------------------------------------------------------------------
// EL TRABAJO SOLO LLEVA UN `notificacionId`, Y TODO LO DEMAS SE RESUELVE AQUI (design §7)
// ---------------------------------------------------------------------------------------------
// Ni el texto, ni el destino, ni el destinatario viajan en el payload. Asi un push que se entrega
// un minuto despues no puede llevar un texto obsoleto, y R8 —«si ya lo leyo, no se envia»— es
// comprobable de verdad en vez de ser una promesa escrita en el encolado.
//
// ---------------------------------------------------------------------------------------------
// EL TEXTO ES EL DE LA 409, ENTERO Y SIN TOCAR (R9/R48, design §2 y A7)
// ---------------------------------------------------------------------------------------------
// `presentacionDe` es la funcion pura que la 409 dejo para esto. Aqui NO se concatena, NO se
// recorta y NO se formatea: un segundo juego de literales para el mismo hecho es como la campana y
// el push acaban diciendo cosas distintas de lo mismo, y compararlo en un test contra la funcion
// que lo compone estaria siempre verde.
import type { ErrorLogger } from "@/lib/errors";
import { defaultLogger } from "@/lib/errors";
import type { JobDTO } from "@/lib/interfaces/repositories/IJobRepository";
import type {
  DestinatarioDeAviso,
  IPushNotificacionReader,
} from "@/lib/interfaces/repositories/IPushNotificacionReader";
import type { IPushSuscripcionRepository } from "@/lib/interfaces/repositories/IPushSuscripcionRepository";
import type { IPushSender } from "@/lib/interfaces/external/IPushSender";
import type { IPushWebService } from "@/lib/interfaces/services/IPushWebService";
import type { IVigenciaAvisoAgregado } from "@/lib/interfaces/services/IVigenciaAvisoAgregado";
import { esEventoAgregado } from "@/lib/notificaciones/catalogo-avisos";
import { presentacionDe } from "@/lib/notificaciones/presentacion-aviso";
import { esElegiblePush } from "@/lib/notificaciones/push-elegibles";
import type { NotificacionEvento } from "@/lib/types/notificacion";

/** Lo que viaja CIFRADO hasta el navegador. Cuatro campos, y ninguno es dato del cliente (R48). */
export interface PushCarga {
  readonly titulo: string;
  readonly cuerpo: string;
  readonly destino: string;
  /** Solo alimenta la etiqueta (`tag`) del service worker, para que el mismo tipo reemplace (R41). */
  readonly evento: NotificacionEvento;
}

/** Destino de reserva cuando el aviso es accionable SIN atajo (hoy solo `geocodificacion_caida`). */
const DESTINO_POR_DEFECTO = "/";

export interface PushWebServiceDeps {
  lector: IPushNotificacionReader;
  canal: IPushSuscripcionRepository;
  /**
   * `null` cuando NO hay claves VAPID (R30). Es la unica forma honesta de representar «no hay
   * canal»: un emisor de mentira que dijera `ok` haria creer que el push salio.
   */
  sender: IPushSender | null;
  /**
   * R52 — el conteo de pendientes por (usuario, evento) que entrega la 409. REQUERIDO y sin default
   * no-op: es la familia «el composition root que no inyecta», y aqui un default silencioso
   * apagaria la mitad numerada del requisito sin que nada fallara.
   */
  vigencia: IVigenciaAvisoAgregado;
  now?: () => Date;
  logger?: ErrorLogger;
  /** Nombres de las variables VAPID ausentes, para poder citarlas SIN su valor (R30/R31). */
  piezasAusentes?: () => string[];
}

export class PushWebService implements IPushWebService {
  private readonly now: () => Date;
  private readonly logger: ErrorLogger;

  constructor(private readonly deps: PushWebServiceDeps) {
    this.now = deps.now ?? (() => new Date());
    this.logger = deps.logger ?? defaultLogger;
  }

  async ejecutar(job: JobDTO): Promise<void> {
    const notificacionId = leerNotificacionId(job.payload);
    if (notificacionId === null) {
      // R36: un payload que no se puede interpretar NO va a interpretarse mejor en el intento
      // siguiente. Termina, con su motivo escrito.
      this.registrar(`payload sin notificacionId (job ${job.id})`);
      return;
    }

    // R30: sin claves VAPID el trabajo TERMINA, citando el NOMBRE de la variable ausente y jamas su
    // valor. No lanza: un fallo de configuracion no puede dejar la cola llena de trabajos que se
    // reclaman cada minuto y nunca progresan (R36), ni tumbar los otros nueve tipos del lote.
    if (this.deps.sender === null) {
      const faltan = (this.deps.piezasAusentes ?? (() => []))();
      this.registrar(
        `canal de push sin configurar (falta ${faltan.join(", ") || "la configuracion VAPID"})`,
      );
      return;
    }

    const aviso = await this.deps.lector.leerAviso(notificacionId);
    if (aviso === null) {
      this.registrar(`el aviso ${notificacionId} ya no existe`); // R8
      return;
    }

    // Quien gano el cupo del dia CON ESTE aviso. Si otro aviso del mismo tipo se lo llevo antes,
    // esa persona no vuelve a sonar hoy (R6) — y eso se decide aqui, no en el encolado, porque el
    // trabajo solo trae el id.
    const conCupo = new Set(await this.deps.canal.usuariosConCupoDe(notificacionId));
    if (conCupo.size === 0) {
      this.registrar(`el aviso ${notificacionId} no tiene cupo asignado`);
      return;
    }

    const destinatarios = (await this.deps.lector.destinatariosPendientes(notificacionId)).filter(
      // R24/R25: el alcance es el del predicado de visibilidad, resuelto por el lector. Aqui solo
      // se cruza con el cupo y con la elegibilidad del par (evento, ROL DEL LECTOR).
      (d) => conCupo.has(d.usuarioId) && esElegiblePush(aviso.evento, d.rol),
    );
    if (destinatarios.length === 0) {
      // R8: todos lo leyeron o lo descartaron antes de que el cron llegase. Desenlace FINAL.
      this.registrar(`el aviso ${notificacionId} ya no tiene destinatarios pendientes`);
      return;
    }

    let algunoTransitorio = false;
    for (const destinatario of destinatarios) {
      const carga = await this.componer(aviso, destinatario);
      if (carga === null) continue; // apagado (cifra 0) o sin presentacion: nada que decir
      // R26: un `try` por DESTINATARIO ademas del de por suscripcion. El fallo de uno no puede
      // dejar sin push a los demas.
      if (await this.entregarA(destinatario.usuarioId, carga)) algunoTransitorio = true;
    }

    // R34: solo un desenlace TRANSITORIO hace que la cola reintente. Todo lo demas ya termino.
    if (algunoTransitorio) {
      throw new Error(`push_web: entrega transitoria pendiente de reintento (job ${job.id})`);
    }
  }

  /**
   * R9/R52 — compone el texto del push. `null` = no hay nada que decir.
   *
   * ⚠️ LA MITAD NUMERADA DE R52. Para los dos avisos AGREGADOS se pide a la 409 la CIFRA VIVA
   * acotada al ambito de esa persona, y la presentacion la mete dentro del titulo («5 novedades
   * esperan tu decision»). Para todo lo demas —y tambien cuando el resolutor falla— se pasa `null`
   * y el push sale con el texto PERSISTIDO, en singular y SIN AFIRMAR NINGUNA CANTIDAD. Un push que
   * dice «tenes 1 cierre» cuando hay tres es peor que uno que no cuenta: el primero se lee como un
   * dato y es falso; el segundo se lee como un aviso y es cierto.
   *
   * Y con cifra CERO la presentacion devuelve `null`: el aviso SE APAGO SOLO mientras el trabajo
   * esperaba en la cola, y no se envia nada.
   */
  private async componer(
    aviso: { evento: NotificacionEvento; descripcion: string; anexo: string | null },
    destinatario: DestinatarioDeAviso,
  ): Promise<PushCarga | null> {
    const presentacion = presentacionDe({
      evento: aviso.evento,
      descripcion: aviso.descripcion,
      anexo: aviso.anexo,
      // ⚠️ EL ROL DE QUIEN LEE, no `destinatario_rol`: los avisos del mensajero llegan con esa
      // columna en NULL y sin esto se presentarian como informativos, sin atajo.
      rolLector: destinatario.rol,
      cifraViva: await this.cifraViva(aviso.evento, destinatario),
    });
    if (presentacion === null) return null;
    return {
      titulo: presentacion.titulo,
      // El cuerpo puede ser `null` (aviso sin contexto): entonces el push lleva solo el titulo.
      cuerpo: presentacion.cuerpo ?? "",
      // `geocodificacion_caida` es accionable SIN atajo a proposito (409/R4): no hay pantalla que
      // acerque a arreglar una credencial en la consola del proveedor. El toque lleva a la portada.
      destino: presentacion.destino ?? DESTINO_POR_DEFECTO,
      evento: aviso.evento,
    };
  }

  /** La cifra viva, o `null` si este evento no la lleva o si el resolutor fallo (R52 por defecto). */
  private async cifraViva(
    evento: NotificacionEvento,
    destinatario: DestinatarioDeAviso,
  ): Promise<number | null> {
    if (!esEventoAgregado(evento)) return null;
    try {
      return await this.deps.vigencia.cifra(evento, {
        usuarioId: destinatario.usuarioId,
        rol: destinatario.rol,
        zonaId: destinatario.zonaId,
      });
    } catch (error) {
      // Fallar hacia NO AFIRMAR: el push sale con el texto persistido y sin cantidad. Inventar un
      // numero aqui seria exactamente lo que R52 prohibe.
      this.registrar(`no se pudo resolver la cifra viva de "${evento}"`, error);
      return null;
    }
  }

  /**
   * Entrega a TODAS las suscripciones de ese usuario (R26) y aplica la tabla de desenlaces.
   * Devuelve `true` si alguna quedo TRANSITORIA (y por tanto la cola debe reintentar).
   */
  private async entregarA(usuarioId: string, carga: PushCarga): Promise<boolean> {
    const suscripciones = await this.deps.canal.listarPorUsuarios([usuarioId]);
    // R46: sin suscripcion, ese dispositivo no recibe push y no pasa nada mas. No es un fallo.
    if (suscripciones.length === 0) return false;

    const payload = JSON.stringify(carga);
    let transitorio = false;
    for (const suscripcion of suscripciones) {
      try {
        // El emisor ya se comprobo no nulo en `ejecutar`; el `?? null` es para el estrechado.
        const outcome = await (this.deps.sender as IPushSender).enviar(suscripcion, payload);
        if (outcome.status === "ok") {
          await this.deps.canal.sellarEnvioOk(suscripcion.id, this.now());
          continue;
        }
        if (outcome.status === "caducada") {
          // R33: el navegador la retiro y no volvera. Se BORRA y NO se reintenta jamas. Sin esto
          // la cola acumula basura para siempre, y este repositorio ya tuvo una cola envenenada.
          await this.deps.canal.eliminarPorId(suscripcion.id);
          this.registrar(`suscripcion ${suscripcion.id} caducada: retirada`);
          continue;
        }
        if (outcome.status === "transitorio") {
          transitorio = true;
          this.registrar(`entrega transitoria: ${outcome.detalle}`);
          continue;
        }
        // `rechazada`: el problema es NUESTRO (payload, claves). No se reintenta y la suscripcion
        // NO se borra — castigar a la persona por un bug nuestro la dejaria sin canal.
        this.registrar(`entrega rechazada: ${outcome.detalle}`);
      } catch (error) {
        // R26: que una suscripcion reviente de forma imprevista no puede dejar sin push a las
        // demas. Se registra, se marca transitorio y se sigue con la siguiente.
        transitorio = true;
        this.registrar(`fallo inesperado entregando a la suscripcion ${suscripcion.id}`, error);
      }
    }
    return transitorio;
  }

  /** R28: nada se absorbe en silencio. Sin endpoint, sin claves y sin PII (R23). */
  private registrar(mensaje: string, causa?: unknown): void {
    this.logger.logError(
      causa === undefined ? new Error(`push_web: ${mensaje}`) : new Error(`push_web: ${mensaje}`, { cause: causa }),
    );
  }
}

/** Lee el unico campo del payload. `null` si no viene o no es una cadena. */
function leerNotificacionId(payload: Record<string, unknown>): string | null {
  const valor = payload.notificacionId;
  return typeof valor === "string" && valor.length > 0 ? valor : null;
}
