// FICHA 474 (design §4.2, T7.3) — EL PUENTE entre los avisos internos y los envios por WhatsApp.
//
// Molde EXACTO de `conPushWeb` (ficha 410) y cableado en el MISMO sitio: `repoReal()` de
// `notificadores.ts`. Como todos los bindings `notificar<X>Real` resuelven su repositorio por ahi,
// TODOS los productores quedan puenteados de una vez y uno nuevo lo hereda sin acordarse de nada.
// La alternativa —un notificador de WhatsApp inyectado en cada productor— es la que el 2026-08-23
// dejo dos de siete notificadores muertos con la suite verde (alternativa H del design).
//
// `crear(input, tx)`, EN ESTE ORDEN (R26/R50):
//   1. delega; `null` (la dedupe de la campana lo absorbio) -> no hace NADA mas;
//   2. con `tx` (aviso dentro de una transaccion de negocio) -> ni una consulta;
//   3. puerta BARATA y pura (`filaPuenteable`): evento no disponible, fila a un usuario, fila con
//      alcance de tienda/zona o sin entidad -> ni una consulta;
//   4. dentro de `emitirBestEffort`: ¿hay algun envio ENCENDIDO con ese evento? (`SELECT 1` sobre el
//      indice parcial). No -> cero escrituras. Si -> encola UN trabajo por aviso con
//      `dedupe_key = wa_envio_evento:<evento>:<entidadId>`;
//   5. devuelve el id.
//
// NUNCA Meta, destinatarios ni informes en el camino del aviso. Se `await`ea (dentro del
// best-effort) y no se deja como promesa suelta: en Vercel la funcion se congela al responder.
//
// R51: el payload lleva `{ texto, rolFila, creadoAt }` y NADA MAS: ni el `anexo` (nombre de persona)
// ni ningun dato que no este ya en el texto del aviso.
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
import type { IJobRepository } from "@/lib/interfaces/repositories/IJobRepository";
import type { IWhatsappEnvioRepository } from "@/lib/interfaces/repositories/IWhatsappEnvioRepository";
import { emitirBestEffort } from "@/lib/notificaciones/best-effort";
import { filaPuenteable } from "@/lib/whatsapp-envios/eventos";
import { dedupeKeyEvento, MAX_INTENTOS_EVENTO } from "@/lib/whatsapp-envios/encolar";
import type { DatosAviso } from "@/lib/whatsapp-envios/informes/tipos";
import type { NotificacionEvento } from "@/lib/types/notificacion";

/** Nombre de la operacion en el log del best-effort (R50). */
export const OPERACION_PUENTE = "envios_whatsapp_evento";

/** Payload del job `whatsapp_envio_evento`. */
export interface PayloadEventoEnvio {
  evento: string;
  referencia: string;
  notificacionId: string;
  datos: DatosAviso;
}

export interface ConEnviosWhatsappDeps {
  envios: Pick<IWhatsappEnvioRepository, "hayEncendidosConEvento">;
  cola: Pick<IJobRepository, "enqueue">;
  now?: () => Date;
  logger?: ErrorLogger;
}

export function conEnviosWhatsapp(base: INotificacionRepository, deps: ConEnviosWhatsappDeps): INotificacionRepository {
  return new NotificacionRepositoryConEnviosWhatsapp(base, deps);
}

export class NotificacionRepositoryConEnviosWhatsapp implements INotificacionRepository {
  private readonly now: () => Date;
  private readonly logger: ErrorLogger;

  constructor(
    private readonly base: INotificacionRepository,
    private readonly deps: ConEnviosWhatsappDeps,
  ) {
    this.now = deps.now ?? (() => new Date());
    this.logger = deps.logger ?? defaultLogger;
  }

  async crear(input: CrearNotificacionInput, tx?: NotificacionTxClient): Promise<string | null> {
    const id = await this.base.crear(input, tx);
    if (id === null) return null; // 1. la dedupe de la campana mando: el WhatsApp sigue su suerte
    if (tx !== undefined) return id; // 2. dentro de una transaccion de negocio: ni una consulta
    if (!filaPuenteable(input)) return id; // 3. puerta barata, sin consultas

    await emitirBestEffort(OPERACION_PUENTE, () => this.encolar(id, input), this.logger); // 4.
    return id; // 5.
  }

  private async encolar(notificacionId: string, input: CrearNotificacionInput): Promise<void> {
    // R26: con todos los envios apagados, una consulta indexada y CERO escrituras.
    if (!(await this.deps.envios.hayEncendidosConEvento(input.evento))) return;
    const rolFila = input.destinatario.tipo === "rol" ? input.destinatario.rol : "maestro";
    // `filaPuenteable` ya garantizo `entidadId !== null`.
    const referencia = input.entidadId as string;
    const payload: PayloadEventoEnvio = {
      evento: input.evento,
      referencia,
      notificacionId,
      // R51: la FOTO del aviso. Sin anexo: `DatosAviso` ni siquiera tiene el campo.
      datos: { texto: input.descripcion, rolFila, creadoAt: this.now().toISOString() },
    };
    await this.deps.cola.enqueue("whatsapp_envio_evento", { ...payload }, {
      dedupeKey: dedupeKeyEvento(input.evento, referencia),
      maxIntentos: MAX_INTENTOS_EVENTO,
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

  verificarVisible(id: string, actor: NotificacionActor): Promise<"visible" | "no_visible" | "no_existe"> {
    return this.base.verificarVisible(id, actor);
  }

  marcarTodasLeidas(actor: NotificacionActor, desde: Date, ahora: Date): Promise<number> {
    return this.base.marcarTodasLeidas(actor, desde, ahora);
  }

  descartar(notificacionId: string, usuarioId: string, ahora: Date): Promise<void> {
    return this.base.descartar(notificacionId, usuarioId, ahora);
  }
}
