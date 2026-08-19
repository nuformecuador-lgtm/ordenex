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
import { estaEnVentanaDeEscritura } from "@/lib/types/ventana-hilo-notas";

/**
 * SOLICITUD DE AYUDA de un mensajero sobre la orden que esta gestionando (pedido humano
 * 2026-08-18).
 *
 * DOS EFECTOS, UNA SOLA PUERTA. El motivo se publica como nota del hilo de la feature 227 y la
 * orden queda marcada con `orden.ayuda`, que es lo que la hace aparecer en `/novedades` para su
 * tienda. La puerta es la del hilo y solo esa: si `publicar` no acepta —rol que no es mensajero,
 * orden ajena, orden fuera de `en_reparto`, motivo vacio tras recortar— aqui no se marca nada y se
 * devuelve su mismo resultado, sin traducirlo ni enriquecerlo.
 *
 * POR QUE NO SE COMPRUEBA EL ROL AQUI. Se escribio primero un `if (actor.rol !== "mensajero")` de
 * guarda y se quito: era una SEGUNDA tabla de permisos. `OrdenNotaService` ya limita el hilo a
 * `{ adminTienda, mensajero }` y la ventana del mensajero a `en_reparto` sobre orden asignada a el
 * (`lib/types/ventana-hilo-notas.ts`). La unica diferencia real seria el adminTienda, que podria
 * publicar en el hilo de una orden en `devuelta` y de paso marcarla como «con ayuda» —y que la
 * tienda encienda su propia bandera es inofensivo, no un escalado: la orden ya es suya y ya la ve.
 * Preferir esa arista a duplicar la regla es deliberado; si algun dia el negocio quiere reservar la
 * marca al mensajero, el sitio es la ventana de la 227, no un `if` suelto aqui.
 */
export class SolicitudAyudaService implements ISolicitudAyudaService {
  constructor(
    private readonly notas: Pick<IOrdenNotaService, "publicar">,
    private readonly repo: Pick<
      IOrdenRepository,
      "marcarAyuda" | "desmarcarAyuda" | "incrementarIntentoContacto"
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
    // El motivo ES el cuerpo de la nota. Va con el actor de la sesion; el autor jamas viaja en
    // el input (R5 de la 227).
    const publicada = await this.notas.publicar(
      { ordenId: input.ordenId, cuerpo: input.motivo },
      actor,
    );

    // `forbidden` / `validation_error` se propagan TAL CUAL: son la respuesta del hilo y esta
    // capa no tiene nada mejor que decir. Y sobre todo, NO se marca la orden.
    if (publicada.status !== "ok") return publicada;

    // Idempotente por construccion (`ayuda = true`): pedir ayuda dos veces deja la orden marcada
    // una vez y el hilo con dos motivos, que es exactamente lo que paso.
    await this.repo.marcarAyuda(input.ordenId);

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
    // Va DESPUES de la marca y no dentro de una transaccion con ella (son repositorios distintos).
    // El unico fallo posible deja la orden marcada y todavia en gestion, que es un estado que el
    // propio mensajero deshace con «Cancelar gestion»; el inverso —soltar el puntero sin haber
    // marcado— es el que no puede ocurrir.
    await this.gestionRepo.liberarOrdenEnGestion(actor.usuarioId, input.ordenId);

    return publicada;
  }

  async recuperar(
    input: RecuperarAyudaInput,
    actor: Actor,
  ): Promise<RecuperarAyudaServiceResult> {
    // Misma puerta que el hilo: rol con hilo, orden viva, pertenencia. Un `forbidden` opaco.
    const acceso = await autorizarSobreHilo(this.notaRepo, input.ordenId, actor);
    if (!acceso.ok) return { status: "forbidden" };

    // Y la misma VENTANA que para escribir en el hilo. Es lo coherente: quien no puede decir nada
    // sobre la orden tampoco puede declarar que la ayuda ya no hace falta. Para el mensajero eso
    // significa `en_reparto`, que es exactamente donde vive el boton «Recuperar».
    if (!estaEnVentanaDeEscritura(acceso.rol, acceso.orden.estatusValue, acceso.orden.ayuda)) {
      return { status: "forbidden" };
    }

    // Idempotente: recuperar una orden que ya no estaba marcada la deja igual.
    await this.repo.desmarcarAyuda(input.ordenId);

    return { status: "ok" };
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

    // ⚠️ AQUI NO SE COMPRUEBA LA VENTANA DE ESCRITURA, a diferencia de `recuperar`, y es una
    // decision y no un olvido. La ventana del `adminTienda` es `devuelta`; este boton se pinta
    // sobre la orden que aparece en `/novedades` por tener AYUDA pedida, que sigue EN REPARTO.
    // Comprobar la ventana habria concedido un permiso inejercitable: el boton visible siempre, y
    // siempre rechazado. La ventana protege el HILO, que es evidencia conversacional; esto es un
    // contador de gestos propios de la tienda sobre su propia orden.
    //
    // Tampoco se exige `ayuda = true`. El contador es CUMULATIVO y sobrevive a que la solicitud se
    // retire (ver `NovedadDTO.intentosContacto`), asi que atarlo al flag lo convertiria en estado
    // en vez de historial — y ademas haria fallar el clic que llega justo despues de que el
    // mensajero pulse «Recuperar», por un intento que de verdad ocurrio.
    const intentosContacto = await this.repo.incrementarIntentoContacto(input.ordenId);

    return { status: "ok", intentosContacto };
  }
}
