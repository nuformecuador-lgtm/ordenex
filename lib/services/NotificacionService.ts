// Feature 146 (design §3) — logica de negocio de la campana: ventana de 30 dias, limite,
// derivacion de `read`/`noLeidas` y autorizacion por el MISMO predicado que lista (R35). No
// conoce Next.js ni Prisma: el repositorio entra por constructor.
import type {
  INotificacionRepository,
  NotificacionActor,
} from "@/lib/interfaces/repositories/INotificacionRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { INotificacionService } from "@/lib/interfaces/services/INotificacionService";
import { notificacionesConfig } from "@/lib/config/notificaciones";
import { emitirCargaMasivaTerminada } from "@/lib/notificaciones/emitir";
import type {
  CargaTerminadaInput,
  ListarNotificacionesServiceResult,
  MarcarNotificacionServiceResult,
  MarcarTodasServiceResult,
  NotificacionDTO,
  NotificarCargaServiceResult,
} from "@/lib/types/notificacion";

const MS_POR_DIA = 24 * 60 * 60 * 1000;

export class NotificacionService implements INotificacionService {
  constructor(
    private readonly repo: INotificacionRepository,
    /** Inyectable para tests deterministas de la ventana (F1.4-6). */
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * El actor de sesion trae `zonaId` desde la feature 146/A3, pero el tipo lo declara
   * opcional (cambio aditivo). Normalizar aqui —y solo aqui— evita que el `undefined` de un
   * actor construido a mano se cuele en el predicado y haga visible lo que no debe.
   */
  private aActorDeNotificacion(actor: Actor): NotificacionActor {
    return { usuarioId: actor.usuarioId, rol: actor.rol, zonaId: actor.zonaId ?? null };
  }

  /** Inicio de la ventana de consulta (F1.4-6): no hay purga, se acota la CONSULTA. */
  private inicioVentana(): Date {
    return new Date(this.now().getTime() - notificacionesConfig.VENTANA_DIAS * MS_POR_DIA);
  }

  async listar(actor: Actor): Promise<ListarNotificacionesServiceResult> {
    const filas = await this.repo.listarParaUsuario({
      actor: this.aActorDeNotificacion(actor),
      desde: this.inicioVentana(), // R29
      limite: notificacionesConfig.PAGE_SIZE, // R29
    });
    const items: NotificacionDTO[] = filas.map((f) => ({
      id: f.id,
      notification_type: f.tipo,
      description: f.descripcion,
      ...(f.anexo === null ? {} : { anexo: f.anexo }),
      read: f.leida, // R30
      createdAt: f.createdAt.toISOString(),
    }));
    // R30: `noLeidas` se cuenta sobre el MISMO conjunto ya filtrado, para que el distintivo
    // de la campana nunca pueda superar lo que la lista muestra.
    return { status: "ok", items, noLeidas: items.filter((i) => !i.read).length };
  }

  async marcarLeida(id: string, actor: Actor): Promise<MarcarNotificacionServiceResult> {
    const acceso = await this.autorizar(id, actor);
    if (acceso !== "ok") return acceso;
    await this.repo.marcarLeida(id, actor.usuarioId, this.now()); // R31/R37
    return { status: "ok" };
  }

  async descartar(id: string, actor: Actor): Promise<MarcarNotificacionServiceResult> {
    const acceso = await this.autorizar(id, actor);
    if (acceso !== "ok") return acceso;
    await this.repo.descartar(id, actor.usuarioId, this.now()); // R33/R37
    return { status: "ok" };
  }

  async marcarTodasLeidas(actor: Actor): Promise<MarcarTodasServiceResult> {
    const marcadas = await this.repo.marcarTodasLeidas(
      this.aActorDeNotificacion(actor),
      this.inicioVentana(),
      this.now(),
    );
    return { status: "ok", marcadas }; // R32
  }

  async notificarCargaTerminada(
    input: CargaTerminadaInput,
    actor: Actor,
  ): Promise<NotificarCargaServiceResult> {
    // R39: el destinatario es SIEMPRE el actor. No existe parametro para designarlo, asi que
    // un usuario no puede sembrar avisos en la campana de otro. La idempotencia por `loteId`
    // la resuelve la dedupe del emisor (guardia + indice unico), de modo que una segunda
    // invocacion de la misma carga es un no-op y aun asi responde `ok`.
    await emitirCargaMasivaTerminada(this.repo, {
      usuarioId: actor.usuarioId,
      creadas: input.creadas,
      total: input.total,
      loteId: input.loteId,
    });
    return { status: "ok" };
  }

  /**
   * R35: autorizar con el MISMO predicado que lista. `not_found` si la fila no existe;
   * `forbidden` si existe pero no le es visible — y en ninguno de los dos casos se crea fila
   * de lectura.
   */
  private async autorizar(
    id: string,
    actor: Actor,
  ): Promise<"ok" | { status: "not_found" } | { status: "forbidden" }> {
    const visibilidad = await this.repo.verificarVisible(id, this.aActorDeNotificacion(actor));
    if (visibilidad === "no_existe") return { status: "not_found" };
    if (visibilidad === "no_visible") return { status: "forbidden" };
    return "ok";
  }
}
