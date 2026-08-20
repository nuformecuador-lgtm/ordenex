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
   * Publica la nota en el hilo de la orden y, SOLO si esa publicacion fue aceptada, apaga la
   * bandera `ayuda`.
   *
   * FEATURE 239 (T3.1, R23): antes apagaba DOS banderas; `gestion_aprobada` ya no existe, y con
   * ella desaparece la unica via por la que «Habilitar» podia esconder una devolucion **sin
   * detener su reloj** (a los 5 dias el cron la escalaba y la cobraba, auditoria §2.2). Ahora la
   * devolucion se lista por IGUALDAD DE ESTADO: mientras siga en `devuelta`, sigue visible.
   *
   * El orden importa y es el unico punto delicado: la nota es la que lleva la autorizacion, asi que
   * va PRIMERO; apagar las banderas es consecuencia de que la nota se haya aceptado. El fallo
   * posible es por tanto «nota publicada y banderas sin apagar», que degrada a un mensaje mas en el
   * hilo —visible, no perdido— y se corrige repitiendo la accion. El inverso, una orden retirada de
   * `/novedades` sin que conste por que, es el que NO puede ocurrir.
   *
   * La ventana del `adminTienda` hace de guarda de estatus sin escribir ninguna: sea cual sea el
   * estado, si el actor no puede escribir en el hilo de esa orden tampoco puede habilitarla.
   *
   * ⚠️ 2026-08-19 (feature 235/R34): esa ventana son ahora DOS estados —`devuelta` y
   * `ayuda_tienda`—, asi que la tienda SI puede habilitar una orden con ayuda pedida; de hecho es
   * su desenlace natural, y `NovedadAcciones` ofrece el boton sobre ella (feature 236/R22). Este
   * parrafo decia lo contrario y era un arrastre de cuando la ventana tenia un solo valor.
   *
   * ⚠️ 2026-08-19 (feature 236, T5.5 — D8, R25): `ok` gana `rescatada`. Publicar la nota y mover la
   * orden son DOS cosas, y hasta hoy la segunda se descartaba: la pantalla no tenia forma de saber
   * si el rescate se aplico y afirmaba que si. Ver `HabilitarNovedadServiceResult`.
   */
  habilitar(
    input: HabilitarNovedadInput,
    actor: Actor,
  ): Promise<HabilitarNovedadServiceResult>;
}
