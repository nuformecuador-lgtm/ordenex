import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  IntentoContactoInput,
  IntentoContactoServiceResult,
  RecuperarAyudaInput,
  RecuperarAyudaServiceResult,
  SolicitarAyudaInput,
  SolicitarAyudaServiceResult,
} from "@/lib/types/orden-ayuda";

// Contrato del servicio de SOLICITUD DE AYUDA (pedido humano 2026-08-18). Logica de negocio pura:
// no conoce HTTP, ni Next, ni Prisma.
//
// Es un servicio de COMPOSICION, y por eso es tan corto: la autorizacion entera (rol, pertenencia
// de la orden y ventana de escritura) ya la resuelve `IOrdenNotaService.publicar`, y aqui NO se
// vuelve a derivar. Reimplementarla habria creado una segunda tabla de permisos que el dia que
// divergiera dejaria marcar ordenes que el hilo no deja comentar.
export interface ISolicitudAyudaService {
  /**
   * Publica el motivo en el hilo de la orden y, SOLO si esa publicacion fue aceptada, TRANSICIONA
   * la orden `en_reparto -> ayuda_tienda`. El orden importa y es el unico punto delicado de este
   * servicio: la nota es la que lleva la autorizacion, asi que va PRIMERO; la transicion es una
   * consecuencia de que la nota se haya aceptado.
   *
   * FEATURE 235: el efecto era `marcarAyuda` (una bandera booleana) y pasa a ser una transicion
   * GUARDADA por `estatus = en_reparto` en el WHERE. Consecuencias que el llamador debe conocer:
   * la orden deja de ser parada de la ruta y del mapa (R14/R15), deja de ser gestionable (R16),
   * sale del grupo «por gestionar» del portal y entra en su apartado propio YA PARTIDO DESDE EL
   * SERVIDOR (R18), y bloquea la solicitud de cierre por su nombre y no por accidente (R22/R23).
   *
   * Y con la orden movida, DEJA DE SER la gestion en curso del actor: se libera el puntero 1-a-1
   * (`usuario.orden_en_gestion_id`) si apuntaba a ella, para que el mensajero pueda pasar a la
   * siguiente sin cancelar a mano una gestion que ya decidio no continuar.
   *
   * FALLO CERRADO: si el catalogo de estados no resuelve alguno de los dos values, la operacion se
   * rechaza ENTERA con `forbidden` - sin publicar la nota y sin mover nada. Una escritura a medias
   * sobre el estado es peor que un error visible.
   *
   * NO hay transaccion que abarque las escrituras (viven en repositorios distintos). El fallo
   * posible es por tanto «nota publicada y orden sin mover», que degrada a un mensaje mas en el
   * hilo -visible, no perdido- y se corrige repitiendo la solicitud. El inverso («orden en ayuda
   * sin motivo»), que la dejaria encendida en `/novedades` sin decir por que, es el que NO puede
   * ocurrir.
   */
  solicitar(
    input: SolicitarAyudaInput,
    actor: Actor,
  ): Promise<SolicitarAyudaServiceResult>;

  /**
   * «Recuperar»: el RESCATE del lado del mensajero. Transiciona `ayuda_tienda -> en_reparto` y con
   * eso la orden vuelve al listado normal, a la ruta y a la gestion. NO escribe ni borra nada del
   * hilo: los motivos escritos siguen donde estan, porque retirar la solicitud dice «ya no necesito
   * ayuda», no «esto nunca paso».
   *
   * FEATURE 235 (R8): NO implementa nada. Delega en el PUNTO UNICO DE RESCATE
   * (`lib/services/rescate-ayuda.ts`), el mismo al que delega «Habilitar» del lado de la tienda.
   * Antes habia dos apagadores distintos para el mismo hecho.
   *
   * `forbidden` es el mismo resultado opaco del hilo, y ahora cubre un caso mas: la orden que NO
   * esta en el estatus de ayuda (R9). Rol sin hilo, orden ajena, orden inexistente, fuera de la
   * ventana del rol y fuera del estatus devuelven todos lo mismo.
   */
  recuperar(
    input: RecuperarAyudaInput,
    actor: Actor,
  ): Promise<RecuperarAyudaServiceResult>;

  /**
   * «+1 intento de contacto»: suma uno al contador de la orden y devuelve el valor resultante.
   * Solo la TIENDA dueña — es SU registro de gestion, no el del mensajero.
   *
   * ⚠️ NO aplica la ventana de escritura del hilo, y eso es lo unico importante de esta firma. La
   * ventana del `adminTienda` es `devuelta`, y este boton existe precisamente para la orden que
   * esta en `/novedades` por tener AYUDA pedida — es decir, viva en reparto. Aplicarla aqui habria
   * dejado el boton inejercitable justo en el unico caso para el que se pidio.
   */
  registrarIntentoContacto(
    input: IntentoContactoInput,
    actor: Actor,
  ): Promise<IntentoContactoServiceResult>;
}
