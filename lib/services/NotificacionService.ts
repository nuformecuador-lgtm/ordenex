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
  NotificacionEvento,
  NotificarCargaServiceResult,
} from "@/lib/types/notificacion";
// FICHA 409 (T5.3) — EL SERVIDOR DECIDE, EL CLIENTE PINTA. Todo lo que sigue entra aqui para que
// la campana no clasifique, no componga texto, no calcule tiempo y no conozca rutas por evento.
import { accionDeAviso, esEventoAgregado } from "@/lib/notificaciones/catalogo-avisos";
import { presentacionDe } from "@/lib/notificaciones/presentacion-aviso";
import { tiempoRelativo } from "@/lib/utils/tiempo-relativo";
import type { IVigenciaAvisoAgregado } from "@/lib/interfaces/services/IVigenciaAvisoAgregado";
import { defaultLogger, type ErrorLogger } from "@/lib/errors";

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/**
 * FICHA 409 — el resolutor con el que se construye un service que NADIE cableo.
 *
 * ⚠️ NO ES UN NO-OP, Y LA DIFERENCIA ES TODO. Un default que devolviera un numero —`0` o `1`—
 * seria la familia «el composition root que no inyecta» en su peor forma: con `0` los avisos
 * agregados desaparecerian siempre, con `1` no se apagarian NUNCA, y en los dos casos la suite
 * seguiria verde. Este LANZA, con un mensaje que nombra lo que falta; y como `listar` trata
 * cualquier fallo del resolutor MOSTRANDO la fila (R58), el desenlace de un cableado olvidado es
 * un aviso de mas y un error en el log — nunca una campana en blanco ni un aviso zombi silencioso.
 *
 * Quien lo pasa de verdad es `buildService()` de `lib/actions/notificaciones.ts`, y hay un test
 * que afirma que ALGUIEN LO PASA (no que alguien lo importe).
 */
export const vigenciaNoResuelta: IVigenciaAvisoAgregado = {
  async cifra(evento) {
    throw new Error(
      `NotificacionService: nadie inyecto el resolutor de vigencia; "${evento}" no se puede resolver`,
    );
  },
};

export class NotificacionService implements INotificacionService {
  constructor(
    private readonly repo: INotificacionRepository,
    /** Inyectable para tests deterministas de la ventana (F1.4-6) y del instante relativo (R31). */
    private readonly now: () => Date = () => new Date(),
    /**
     * FICHA 409 (design §5) — resuelve la CIFRA VIVA de los avisos agregados. Lo inyecta el
     * composition root; el default LANZA (ver `vigenciaNoResuelta`), nunca devuelve un numero.
     */
    private readonly vigencia: IVigenciaAvisoAgregado = vigenciaNoResuelta,
    private readonly logger: ErrorLogger = defaultLogger,
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

  /**
   * R8/R9/R31/R55/R56/R57/R58 (ficha 409) — el listado deja de ser un buzon y pasa a ser una cola
   * de trabajo. Cada fila sale del servidor con su clase, su titulo, su contexto, su instante en
   * palabras y su atajo YA RESUELTOS, y con ellas viaja `porHacer`.
   *
   * El orden de las cosas importa:
   *   1. se lee la lista como siempre (predicado de la 146, ventana, no descartadas);
   *   2. SI Y SOLO SI hay al menos una fila de evento AGREGADO se piden sus cifras vivas — a lo
   *      sumo DOS consultas de conteo, y NINGUNA para el actor que no tiene avisos agregados;
   *   3. cifra `0` ⇒ la fila NO sale y no cuenta (R55), sin que nadie la lea ni la descarte;
   *   4. cifra `> 0` ⇒ sale y su titulo se compone con ESA cifra (R57), no con la de la emision;
   *   5. si la resolucion FALLA, se registra y la fila SALE (R58): mejor un aviso de mas que una
   *      campana en blanco.
   */
  async listar(actor: Actor): Promise<ListarNotificacionesServiceResult> {
    const filas = await this.repo.listarParaUsuario({
      actor: this.aActorDeNotificacion(actor),
      desde: this.inicioVentana(), // R29
      limite: notificacionesConfig.PAGE_SIZE, // R29
    });
    const cifras = await this.cifrasVivas(
      filas.map((f) => f.evento),
      actor,
    );
    const ahora = this.now();

    const items: NotificacionDTO[] = [];
    let porHacer = 0;
    for (const f of filas) {
      const presentacion = presentacionDe({
        evento: f.evento,
        descripcion: f.descripcion,
        anexo: f.anexo,
        // El rol de quien CONSULTA, que es quien tiene la pelota. No la columna `destinatario_rol`
        // de la fila: `cierre_dia_vencido` le llega al mensajero como fila dirigida A USUARIO, con
        // `destinatario_rol` NULL, y es justo para el para quien ese aviso es accionable.
        rolLector: actor.rol,
        cifraViva: cifras.get(f.evento),
      });
      if (presentacion === null) continue; // R55: agregado con cifra 0 -> ni se ve ni cuenta
      const accionable = accionDeAviso(f.evento, actor.rol).clase === "accionable";
      items.push({
        id: f.id,
        notification_type: f.tipo,
        description: f.descripcion,
        ...(f.anexo === null ? {} : { anexo: f.anexo }),
        read: f.leida, // R30
        createdAt: f.createdAt.toISOString(),
        evento: f.evento,
        accionable,
        titulo: presentacion.titulo,
        detalle: presentacion.cuerpo,
        // R31: el instante relativo se resuelve AQUI, con el reloj inyectable del servicio, y
        // viaja ya en palabras. La campana no lee `Date.now()` (R32).
        cuando: tiempoRelativo(f.createdAt, ahora),
        atajo: atajoDe(f.evento, actor.rol),
      });
      if (accionable) porHacer += 1; // R8: lo VIVO y accionable, sin mirar la lectura (R9)
    }

    // R30: `noLeidas` se cuenta sobre el MISMO conjunto ya filtrado, para que el distintivo
    // de la campana nunca pueda superar lo que la lista muestra.
    return { status: "ok", items, noLeidas: items.filter((i) => !i.read).length, porHacer };
  }

  /**
   * Las cifras vivas de los eventos AGREGADOS presentes en el listado, una consulta por evento
   * (no por fila). El `Map` distingue TRES estados y los tres importan:
   *   · sin entrada  -> el evento no es agregado: no se consulto nada;
   *   · un numero    -> la cifra viva, acotada al ambito del actor (R57);
   *   · `null`       -> LA CONSULTA FALLO. `presentacionDe` lo traduce en «mostrar sin numero»
   *     (R58), jamas en «apagado»: confundirlo con el `0` apagaria avisos vivos cada vez que una
   *     consulta fallara.
   */
  private async cifrasVivas(
    eventos: NotificacionEvento[],
    actor: Actor,
  ): Promise<Map<NotificacionEvento, number | null>> {
    const cifras = new Map<NotificacionEvento, number | null>();
    const agregados = [...new Set(eventos.filter(esEventoAgregado))];
    for (const evento of agregados) {
      try {
        cifras.set(evento, await this.vigencia.cifra(evento, actor));
      } catch (error) {
        // No es un `catch` vacio (docs/conventions.md): queda registrado con su contexto. Y la
        // direccion del error es la segura — el aviso SE MUESTRA (R58).
        this.logger.logError(
          new Error(`vigencia del aviso agregado "${evento}" fallo (se muestra igual)`, {
            cause: error,
          }),
        );
        cifras.set(evento, null);
      }
    }
    return cifras;
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
   * R35: autorizar con el MISMO predicado que lista. (Nota: `atajoDe` vive fuera de la clase,
   * al final del archivo — no necesita estado.) `not_found` si la fila no existe;
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

/**
 * R3/R4/R17/R18 — el atajo del par (evento, rol) tal y como viaja en el DTO: `null` cuando el
 * aviso es informativo (R19: el bloque informativo NUNCA lleva boton) y tambien cuando es
 * accionable pero NO hay pantalla que acerque a resolverlo (R4) — hoy solo `geocodificacion_caida`.
 */
function atajoDe(
  evento: NotificacionEvento,
  rol: Actor["rol"],
): { href: string; etiqueta: string } | null {
  const accion = accionDeAviso(evento, rol);
  if (accion.clase !== "accionable" || accion.atajo === null) return null;
  return { href: accion.atajo.href, etiqueta: accion.atajo.etiqueta };
}
