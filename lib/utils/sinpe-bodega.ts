/**
 * ⭑ FICHA 429 (T2, R13/R15/R16) — DE QUE BODEGA ES EL SINPE QUE VE EL CLIENTE.
 *
 * Modulo PURO y minusculo A PROPOSITO: es la UNICA regla de resolucion del par, y la usan las DOS
 * superficies que escriben mensajes —el envio por servidor (`OrdenEnvioReader.findParaEnvio`) y la
 * composicion en el dispositivo de quien contacta al cliente (`MiAsignacionDTO`)—. Que sea una
 * sola funcion es lo que hace que R16 sea estructural: no hay dos implementaciones que puedan
 * divergir.
 */

/** El par completo. Los dos campos, siempre juntos: separarlos es el defecto que D1 cerro. */
export interface SinpeBodega {
  numero: string;
  nombre: string;
}

/**
 * PRIMERO LA BODEGA DEL MENSAJERO, Y NO ES UNA PREFERENCIA DE ESTILO.
 * `cierre_dia.destino_zona_id` —la zona donde ese dinero se liquida— se deriva de la zona del
 * MENSAJERO (`resolverDestinoCierre`), no de la de la orden, y las dos pueden diferir: la ficha
 * 377 documenta ordenes que conservan su zona anterior porque su paquete ya esta en el estante de
 * otra bodega. Si el mensaje mandara a la bodega de la ORDEN, el cliente transferiria a una bodega
 * que no va a cuadrar ese cobro, y el descuadre seria tan mudo como un numero equivocado.
 *
 * LA DE LA ORDEN ES EL RESPALDO, Y CUBRE EL HUECO ENTERO: `orden.zona_id` es `NOT NULL` (R12 de la
 * feature 24), asi que SIEMPRE hay una. `usuario.zona_id` NO lo es —hay mensajeros sin zona, y el
 * corte diario ya los cuenta aparte (`CorteDiarioService`, `mensajerosSinZona`)—, y una orden
 * puede no tener mensajero asignado (es el caso normal en `/novedades`).
 *
 * NO HAY TERCERA RAMA, y no hace falta: la segunda no puede faltar. Un `?? { numero: "", … }` de
 * seguridad seria exactamente el fallback mudo que esta ficha viene a eliminar.
 *
 * ⚠️ ALTERNATIVA DESCARTADA — la CENTRAL como respaldo. Mantiene el comportamiento de hoy (todos
 * ven el numero de GAM) y por eso parece segura; se descarta porque es PEOR sin ser mas simple: la
 * zona de la orden es, como minimo, la bodega del territorio donde se esta entregando, mientras
 * que la central es un numero que no tiene nada que ver con esa entrega.
 */
export function resolverSinpeBodega(entrada: {
  zonaDelMensajero: SinpeBodega | null;
  zonaDeLaOrden: SinpeBodega;
}): SinpeBodega {
  return entrada.zonaDelMensajero ?? entrada.zonaDeLaOrden;
}
