import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { NotificacionEvento } from "@/lib/types/notificacion";

// FICHA 409 (T5.2, design §5) — COMO SE APAGA SOLO UN AVISO AGREGADO.
//
// Un aviso agregado dice «5 novedades esperan tu decisión». Si la tienda gestiona las cinco, ese
// aviso deja de ser cierto —y un aviso que ya no es cierto es exactamente como se enseña a la
// gente a ignorar la campana—. La fila NO se borra ni se marca: se resuelve su CIFRA VIVA en cada
// lectura, y con cero deja de mostrarse y de contar (R55), sin que nadie lo lea, lo marque ni lo
// descarte. Si vuelve a subir el mismo dia, reaparece sola en el siguiente sondeo y el emisor
// diario NO crea una segunda fila, porque la entidad del dia ya existe (R56).

export interface IVigenciaAvisoAgregado {
  /**
   * Cifra VIVA del aviso agregado, ACOTADA AL AMBITO DEL ACTOR (R57).
   *
   * ⚠️ EL AMBITO SALE DEL ACTOR, NUNCA DE LA ENTRADA DE LA NOTIFICACION. `adminTienda` -> sus
   * novedades; `adminSatelite` -> las represadas de SU zona; `maestro`/`admin` -> las represadas
   * globales. Es lo que hace que el numero del panel sea EL MISMO que el de su pantalla; leerlo
   * del `entidad_id` de la fila daria el numero del dia de la emision, que es justo lo que esta
   * ficha existe para no mostrar.
   *
   * Solo se invoca con eventos AGREGADOS. Con cualquier otro LANZA: llamarla para un evento que no
   * lleva cifra es un error de programacion, y un `0` de cortesia ocultaria un aviso vivo.
   */
  cifra(evento: NotificacionEvento, actor: Actor): Promise<number>;
}
