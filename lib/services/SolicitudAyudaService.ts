import type { IGestionOrdenRepository } from "@/lib/interfaces/repositories/IGestionOrdenRepository";
import type { IOrdenNotaRepository } from "@/lib/interfaces/repositories/IOrdenNotaRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IOrdenNotaService } from "@/lib/interfaces/services/IOrdenNotaService";
import type { ISolicitudAyudaService } from "@/lib/interfaces/services/ISolicitudAyudaService";
import type {
  IntentoContactoInput,
  IntentoContactoServiceResult,
  RecuperarAyudaInput,
  RecuperarAyudaServiceResult,
  SolicitarAyudaInput,
  SolicitarAyudaServiceResult,
} from "@/lib/types/orden-ayuda";
import { autorizarSobreHilo } from "@/lib/services/OrdenNotaService";
import { rescatarOrdenAyuda } from "@/lib/services/rescate-ayuda";

/** Los dos estatus del viaje de IDA. La vuelta la resuelve el punto unico de rescate. */
const ESTATUS_EN_REPARTO = "en_reparto";
const ESTATUS_AYUDA = "ayuda_tienda";

/**
 * SOLICITUD DE AYUDA de un mensajero sobre la orden que esta gestionando (pedido humano
 * 2026-08-18).
 *
 * DOS EFECTOS, UNA SOLA PUERTA. El motivo se publica como nota del hilo de la feature 227 y la
 * orden TRANSICIONA a `ayuda_tienda`, que es lo que la hace aparecer en `/novedades` para su
 * tienda y -desde la feature 235- lo que la saca del optimizador de ruta, del mapa y de la
 * gestion. La puerta es la del hilo y solo esa: si `publicar` no acepta -rol sin hilo, orden
 * ajena, orden fuera de la ventana de SU rol, motivo vacio tras recortar- aqui no se mueve nada y
 * se devuelve su mismo resultado, sin traducirlo ni enriquecerlo.
 *
 * FEATURE 235 (T2.1) - QUE CAMBIO Y QUE NO. La FORMA es la misma (la nota primero, el efecto
 * despues, el puntero de gestion al final); lo que cambia es EL EFECTO: donde habia un
 * `marcarAyuda` -un `update` ciego a una bandera booleana- hay ahora una TRANSICION GUARDADA POR
 * EL ESTADO. Con la bandera, la orden nunca salia de `en_reparto` y cada superficie que debia
 * excluirla tenia que acordarse de leer la columna; no la leia ninguna
 * (`progress/auditoria_ayuda_tienda.md` seccion 2 y 4).
 *
 * P9 (FIRMADA el 2026-08-19: «solo el mensajero ASIGNADO puede pedir ayuda») SE RESUELVE EN LA
 * VENTANA, NO CON UN `if`. Aqui sigue sin comprobarse el rol, y sigue siendo deliberado: seria una
 * SEGUNDA tabla de permisos. La regla se cumple por composicion de dos cosas que ya existen:
 *   (i) `publicar` exige que el actor este en la ventana de SU rol, y `en_reparto` esta en la del
 *       `mensajero` y NO en la del `adminTienda` (`lib/types/ventana-hilo-notas.ts`); y
 *   (ii) `autorizarSobreHilo` exige PERTENENCIA - para el mensajero, ser el asignado.
 * Una tienda que intente pedir ayuda sobre una orden suya en reparto se queda en el paso (i) y ni
 * siquiera llega a publicar. Hasta el 2026-08-19 esa arista era inofensiva («que la tienda encienda
 * su propia bandera no es un escalado»); con un ESTATUS deja de serlo -mover la orden la saca de la
 * ruta, del mapa y de la gestion del mensajero- y por eso P9 se firmo.
 *
 * IDEMPOTENCIA, que cambia respecto de la bandera y hay que decirlo: pedir ayuda DOS VECES publica
 * los dos motivos en el hilo (la ventana del mensajero incluye `ayuda_tienda`, asi que la segunda
 * nota SI se acepta - que es lo que el mensajero suele necesitar: ANADIR contexto) y NO mueve la
 * orden la segunda vez, porque el `updateMany` guardado por `en_reparto` afecta a 0 filas y el
 * append no ocurre.
 */
export class SolicitudAyudaService implements ISolicitudAyudaService {
  constructor(
    private readonly notas: Pick<IOrdenNotaService, "publicar">,
    private readonly repo: Pick<
      IOrdenRepository,
      "findEstatusIdByValue" | "transicionarAyuda" | "incrementarIntentoContacto"
    >,
    /**
     * Solo para `recuperar`, que no publica nada y por tanto no puede autorizarse a traves de
     * `publicar`. Es el MISMO repositorio del hilo y la MISMA funcion de autorizacion que usa
     * `OrdenNotaService`: aqui no se escribe ninguna regla de acceso nueva.
     */
    private readonly notaRepo: Pick<IOrdenNotaRepository, "findOrdenParaHilo">,
    /**
     * Pedido humano 2026-08-18: pedir ayuda SUELTA el puntero 1-a-1 de gestión. Se inyecta el
     * repo que ya lo sabe hacer (`liberarOrdenEnGestion`, feature 36/R35) en vez de escribir
     * aquí otro `update` sobre `usuario`: ese método ya lleva la guarda de concurrencia en el
     * propio WHERE.
     */
    private readonly gestionRepo: Pick<IGestionOrdenRepository, "liberarOrdenEnGestion">,
  ) {}

  async solicitar(
    input: SolicitarAyudaInput,
    actor: Actor,
  ): Promise<SolicitarAyudaServiceResult> {
    // FALLO CERRADO ANTES DE PUBLICAR (design 3.3). Los dos ids del catalogo se resuelven aqui,
    // ANTES de la nota, por una razon concreta: si el seed estuviera incompleto y se resolvieran
    // despues, la nota ya estaria publicada y la orden no se habria movido - el hilo diria «pedi
    // ayuda» sobre una orden que sigue en la ruta. Resolviendo primero, la operacion se rechaza
    // ENTERA: sin nota y sin transicion.
    const [enRepartoId, ayudaId] = await Promise.all([
      this.repo.findEstatusIdByValue(ESTATUS_EN_REPARTO),
      this.repo.findEstatusIdByValue(ESTATUS_AYUDA),
    ]);
    if (enRepartoId === null || ayudaId === null) return { status: "forbidden" };

    // El motivo ES el cuerpo de la nota. Va con el actor de la sesion; el autor jamas viaja en
    // el input (R5 de la 227).
    //
    // R3 - LA NOTA VA PRIMERO, y desde la 235 eso deja de ser una preferencia para ser una
    // necesidad: despues de la transicion la orden cambia de ventana, y aunque hoy `ayuda_tienda`
    // esta en la del mensajero, el orden inverso ataria la nota a una ventana que manana podria
    // estrecharse. Ademas la nota es la que lleva la AUTORIZACION.
    const publicada = await this.notas.publicar(
      { ordenId: input.ordenId, cuerpo: input.motivo },
      actor,
    );

    // R4: `forbidden` / `validation_error` se propagan TAL CUAL - son la respuesta del hilo y esta
    // capa no tiene nada mejor que decir. Y sobre todo, LA ORDEN NO SE MUEVE: sin nota aceptada no
    // hay transicion, ni append, ni nada.
    if (publicada.status !== "ok") return publicada;

    // R2/R6/R10/R13 - LA TRANSICION, guardada por el estado EN EL WHERE y no por un `if` previo.
    // Si la orden ya salio de reparto -el corte la barrio, otra pestana la gestiono- el
    // `updateMany` afecta a 0 filas, NO se hace el append y no queda ningun efecto parcial. El
    // `data` toca solo `estatusId`: el mensajero asignado NO cambia (R6), porque el paquete sigue
    // siendo suyo y sigue en su moto.
    await this.repo.transicionarAyuda({
      ordenId: input.ordenId,
      estatusOrigenId: enRepartoId,
      estatusDestinoId: ayudaId,
      actorUsuarioId: actor.usuarioId,
      origenTipo: "solicitud_ayuda_tienda",
    });

    // Pedido humano 2026-08-18 — Y DEJA DE SER LA GESTION EN CURSO. Pedir ayuda es declarar que
    // con esta orden no se puede seguir ahora; mantenerla ocupando el puntero 1-a-1 dejaria al
    // mensajero sin poder escoger ninguna otra hasta cancelar a mano una gestion que ya decidio
    // no continuar. Al soltarlo, el panel toma la siguiente por si solo.
    //
    // Se libera el puntero DEL ACTOR, y el repo exige en el WHERE que ademas apunte a ESTA orden
    // (`{ id: actor, ordenEnGestionId: orden }`): nunca toca el puntero de otro usuario ni limpia
    // uno que apunte a otra parte. De ahi que sea seguro llamarlo sin preguntar antes si habia
    // gestion en curso — si no la habia, no limpia nada y devuelve `false`.
    //
    // Va DESPUES de la transicion y no dentro de una transaccion con ella (son repositorios
    // distintos). El unico fallo posible deja la orden en `ayuda_tienda` y todavia en gestion, que
    // es un estado que el propio mensajero deshace con «Cancelar gestion» -y que ademas no es
    // gestionable, porque `cargarOrdenGestionable` exige `en_reparto`-; el inverso, soltar el
    // puntero sin haber movido la orden, es el que NO puede ocurrir.
    await this.gestionRepo.liberarOrdenEnGestion(actor.usuarioId, input.ordenId);

    return publicada;
  }

  async recuperar(
    input: RecuperarAyudaInput,
    actor: Actor,
  ): Promise<RecuperarAyudaServiceResult> {
    // R8 - DELEGA EN EL PUNTO UNICO DE RESCATE. Aqui no hay ni una linea de logica propia: la
    // puerta, la guarda de estado y la escritura viven en `rescatarOrdenAyuda`, que es EXACTAMENTE
    // la misma funcion que llama «Habilitar» del lado de la tienda (R8). Antes habia DOS
    // apagadores -`desmarcarAyuda` aqui y `habilitarNovedad` alla- haciendo lo mismo desde dos
    // sitios, que es como una de las dos copias acaba divergiendo.
    //
    // R25: NO se comprueba el bloqueo total del mensajero. Un mensajero con un cierre `vencido`
    // PUEDE rescatar; anadir la guarda crearia un deadlock con R22 (la orden en ayuda le bloquea
    // el cierre, y sin poder rescatarla no podria desbloquearse nunca).
    return rescatarOrdenAyuda(
      { notaRepo: this.notaRepo, ordenRepo: this.repo },
      input.ordenId,
      actor,
    );
  }

  async registrarIntentoContacto(
    input: IntentoContactoInput,
    actor: Actor,
  ): Promise<IntentoContactoServiceResult> {
    // Este contador es de la TIENDA: cuenta los gestos que ELLA hizo para resolver la orden. Que
    // el mensajero no pueda tocarlo no es una regla de acceso duplicada —la puerta sigue siendo la
    // de abajo—, es decir de QUIEN es el numero. Si el mensajero pudiera sumarle, dejaria de
    // significar lo que su etiqueta dice.
    if (actor.rol !== "adminTienda") return { status: "forbidden" };

    // Misma puerta que el hilo: rol con hilo, orden viva, pertenencia (la tienda dueña).
    const acceso = await autorizarSobreHilo(this.notaRepo, input.ordenId, actor);
    if (!acceso.ok) return { status: "forbidden" };

    // ⚠️ AQUI NO SE COMPRUEBA LA VENTANA DE ESCRITURA, a diferencia del rescate, y es una decision
    // y no un olvido. La ventana protege el HILO, que es evidencia conversacional; esto es un
    // contador de gestos propios de la tienda sobre su propia orden.
    //
    // FEATURE 235: la razon original era que la ventana del `adminTienda` era `devuelta` a secas y
    // este boton se pinta sobre la orden que esta en `/novedades` por AYUDA. Desde la 235 esa
    // ventana incluye `ayuda_tienda`, asi que comprobarla ya NO seria un permiso inejercitable —
    // pero se sigue sin comprobar, y ahora por el motivo de fondo: el contador es CUMULATIVO y
    // sobrevive deliberadamente a que la solicitud se retire (ver `NovedadDTO.intentosContacto`).
    // Atarlo al estado lo convertiria en estado en vez de historial, y haria fallar el clic que
    // llega justo despues de que el mensajero pulse «Recuperar», por un intento que de verdad
    // ocurrio.
    const intentosContacto = await this.repo.incrementarIntentoContacto(input.ordenId);

    return { status: "ok", intentosContacto };
  }
}
