import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  HabilitarNovedadInput,
  HabilitarNovedadServiceResult,
} from "@/lib/types/novedad-habilitar";

// Contrato del servicio de «HABILITAR» una novedad (pedido humano 2026-08-18). Logica de negocio
// pura: no conoce HTTP, ni Next, ni Prisma.
//
// Es un servicio de COMPOSICION, gemelo de `ISolicitudAyudaService.solicitar` y corto por la misma
// razon: la autorizacion entera (rol, pertenencia de la orden y ventana de escritura) ya la
// resuelve `IOrdenNotaService.publicar`, y aqui NO se vuelve a derivar.
export interface IHabilitarNovedadService {
  /**
   * Publica la nota en el hilo de la orden y, SOLO si esa publicacion fue aceptada, apaga las dos
   * banderas de novedad (`ayuda` y `gestion_aprobada`) en un unico UPDATE.
   *
   * El orden importa y es el unico punto delicado: la nota es la que lleva la autorizacion, asi que
   * va PRIMERO; apagar las banderas es consecuencia de que la nota se haya aceptado. El fallo
   * posible es por tanto «nota publicada y banderas sin apagar», que degrada a un mensaje mas en el
   * hilo —visible, no perdido— y se corrige repitiendo la accion. El inverso, una orden retirada de
   * `/novedades` sin que conste por que, es el que NO puede ocurrir.
   *
   * La ventana del `adminTienda` (`devuelta`) hace de guarda de estatus sin escribir ninguna: una
   * orden que esta en `/novedades` por AYUDA y sigue en reparto NO se puede habilitar, que es
   * coherente con que la UI tampoco ofrezca el boton sobre ella (`NovedadAcciones`).
   */
  habilitar(
    input: HabilitarNovedadInput,
    actor: Actor,
  ): Promise<HabilitarNovedadServiceResult>;
}
