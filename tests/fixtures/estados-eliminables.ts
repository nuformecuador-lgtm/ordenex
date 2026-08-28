import { ORDER_STATUS_SEED } from "@/lib/types/order-status";

// FICHA 319 — la LISTA DEL HUMANO, escrita a mano en el lado de los tests.
//
// Se copia a proposito. No se deriva de `ESTADOS_ELIMINABLES` ni de nada de `lib/`: un test que
// comprueba una lista contra la funcion que la produce esta SIEMPRE verde (ya paso en este repo,
// `progress/` lo tiene documentado como «asercion contra su propia fuente»). Si alguien anade
// `en_reparto` a la lista de produccion, este archivo NO se entera solo — y por eso el test cae.
//
// Las palabras entre comillas son las del humano el 2026-08-28.

/** Los CUATRO en los que SI se puede eliminar. */
export const ELIMINABLES_ESPERADOS = [
  "en_preparacion",
  "por_recolectar_en_tienda",
  "recolectando",
  "en_bodega_central",
] as const;

/**
 * Los que NO. Los cuatro primeros son los que el humano nombro uno por uno —y son los que
 * importan, porque es donde un criterio demasiado ancho hace daño de verdad: son estados con el
 * paquete YA en movimiento—; el resto completa el catalogo.
 */
export const NO_ELIMINABLES_ESPERADOS = [
  "en_reparto", // «eso esta en gestion», aunque no tenga ni un intento de entrega
  "en_ruta_bodega_satelite", // «ya se hizo la gestion de enviarse»
  "en_bodega_satelite", // «ya se hizo la gestion de enviarse»
  "en_ruta_bodega_central", // un mensajero lo lleva encima
  // Y todo lo demas: terminales, resultados de gestion y el flujo de devoluciones.
  "entregada",
  "devuelta",
  "devolviendo_a_tienda",
  "reprogramada",
  "por_recoger",
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
