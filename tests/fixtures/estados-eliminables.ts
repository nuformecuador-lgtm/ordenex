import { ORDER_STATUS_SEED } from "@/lib/types/order-status";

// FICHA 319 — la LISTA DEL HUMANO, escrita a mano en el lado de los tests.
//
// Se copia a proposito. No se deriva de `ESTADOS_ELIMINABLES` ni de nada de `lib/`: un test que
// comprueba una lista contra la funcion que la produce esta SIEMPRE verde (ya paso en este repo,
// `progress/` lo tiene documentado como «asercion contra su propia fuente»). Si alguien anade
// `en_reparto` a la lista de produccion, este archivo NO se entera solo — y por eso el test cae.
//
// Las palabras entre comillas son las del humano el 2026-08-28.

/**
 * Los SIETE en los que SI se puede eliminar. Cuatro son de la ficha 319 (2026-08-28) y los tres
 * ultimos entran con el pedido humano del 2026-09-04, que amplia la lista A CAMBIO de exigir
 * CERO INTENTOS DE ENTREGA. El orden es el mismo que el de produccion a proposito: el test que
 * los compara usa `toEqual` sobre el array, asi que tambien fija el orden y un reordenamiento
 * accidental se ve.
 *
 * ⚠️ ESTA LISTA YA NO ES EL CRITERIO COMPLETO. Un estado de aqui SOLO es eliminable si ademas la
 * orden tiene cero intentos; los `it.each` que la consumen siembran ese cero explicitamente.
 */
export const ELIMINABLES_ESPERADOS = [
  "en_preparacion",
  "por_recolectar_en_tienda",
  "recolectando",
  "en_bodega_central",
  "en_ruta_bodega_central",
  "en_ruta_bodega_satelite",
  "por_recoger",
] as const;

/**
 * Los que NO. Los dos primeros son los que el humano nombro uno por uno el 2026-09-04 al ampliar
 * la lista —y son los que importan, porque marcan la frontera exacta que se pidio—; el resto
 * completa el catalogo.
 *
 * QUE SE MOVIO EL 2026-09-04, para que se vea el cambio y no haya que deducirlo: salieron de
 * aqui `en_ruta_bodega_central`, `en_ruta_bodega_satelite` y `por_recoger`. Los dos `en_ruta_*`
 * se rechazaban el 2026-08-28 por estar el paquete en movimiento; hoy la segunda mitad del
 * criterio (cero intentos de entrega) cubre lo que aquel motivo protegia. La asimetria que queda
 * es deliberada: `en_ruta_bodega_satelite` SI, `en_bodega_satelite` NO.
 */
export const NO_ELIMINABLES_ESPERADOS = [
  "en_reparto", // «eso esta en gestion»: va con el mensajero RUMBO AL CLIENTE. Se mantiene.
  "en_bodega_satelite", // ya ATERRIZO en la satelite, el ultimo eslabon antes del cliente
  // Y todo lo demas: terminales, resultados de gestion y el flujo de devoluciones.
  "entregada",
  "devuelta",
  "devolviendo_a_tienda",
  "reprogramada",
  "rechazada",
  "devuelta_a_tienda",
  "sin_gestionar",
  "por_devolver",
  "devolviendo_a_bodega_central",
  "por_devolver_a_tienda",
  "incidente",
  "devolucion_por_confirmar",
  "ayuda_tienda",
] as const;

/**
 * Los dos conjuntos de arriba CUBREN el catalogo entero y no se solapan. Se afirma aqui, una
 * vez, para que cada suite que los use herede la garantia: sin esto, un `value` nuevo del
 * catalogo podria quedarse sin decision y todos los `it.each` seguirian verdes por omision.
 */
export function catalogoCubiertoPorLasDosListas(): {
  cubiertos: string[];
  catalogo: string[];
  solapados: string[];
} {
  const cubiertos = [...ELIMINABLES_ESPERADOS, ...NO_ELIMINABLES_ESPERADOS];
  const enAmbos = new Set<string>(ELIMINABLES_ESPERADOS);
  return {
    cubiertos: [...cubiertos].sort(),
    catalogo: [...ORDER_STATUS_SEED].sort(),
    solapados: NO_ELIMINABLES_ESPERADOS.filter((v) => enAmbos.has(v)),
  };
}
