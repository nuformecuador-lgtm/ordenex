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
   * Publica el motivo en el hilo de la orden y, SOLO si esa publicacion fue aceptada, marca
   * `orden.ayuda`. El orden importa y es el unico punto delicado de este servicio: la nota es la
   * que lleva la autorizacion, asi que va PRIMERO; la marca es una consecuencia de que la nota se
   * haya aceptado.
   *
   * Y con la marca escrita, la orden DEJA DE SER la gestion en curso del actor: se libera el
   * puntero 1-a-1 (`usuario.orden_en_gestion_id`) si apuntaba a ella, para que el mensajero pueda
   * pasar a la siguiente sin cancelar a mano una gestion que ya decidio no continuar.
   *
   * NO hay transaccion que abarque las escrituras (viven en repositorios distintos). El fallo
   * posible es por tanto «nota publicada y marca no escrita», que degrada a un mensaje mas en el
   * hilo — visible, no perdido — y se corrige repitiendo la solicitud. El inverso («marcada sin
   * motivo»), que dejaria una orden encendida en `/novedades` sin decir por que, es el que NO
   * puede ocurrir.
   */
  solicitar(
    input: SolicitarAyudaInput,
    actor: Actor,
  ): Promise<SolicitarAyudaServiceResult>;

  /**
   * «Recuperar»: retira la solicitud (apaga `orden.ayuda`) y con eso la orden vuelve al listado
   * normal del mensajero. NO escribe ni borra nada del hilo.
   *
   * Aqui SI hay comprobacion explicita, y no es una duplicacion: no existe ninguna operacion del
   * hilo que se pueda tomar prestada para autorizar esto —retirar la marca no publica nada— asi
   * que se reusa la MISMA funcion de autorizacion (`autorizarSobreHilo`) y la MISMA tabla de
   * ventana (`lib/types/ventana-hilo-notas.ts`), no una regla nueva escrita al lado.
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
