// FICHA 454 (T2.2/T2.4, R29/R31) — EL TEXTO de la nota que acompaña a una orden cuya gestión ya se
// registró pero cuyo cierre del día todavía no se aprobó, y el de la ayuda a la tienda.
//
// DECISIÓN DEL HUMANO (2026-09-23, prevalece sobre la redacción de R29/R31 del spec, que usaba una
// raya): el formato es «<Resultado> · pendiente de confirmación», con PUNTO MEDIO, y es el MISMO en
// todas las superficies (tienda, admin, maestro, satélite, mensajero y rastreo público) para los
// cinco resultados. La ayuda lleva su propia nota: «Ayuda solicitada a la tienda».
//
// POR QUÉ UN MÓDULO Y NO UNA PLANTILLA EN CADA PANTALLA. Cinco superficies escribiendo la misma
// frase a mano son cinco frases: la primera corrección (la 455 renombrará los estados) se quedaría a
// medias. Aquí vive el formato; el NOMBRE del resultado NO se escribe aquí: lo pone quien llama,
// sacándolo de su fuente canónica (`estatusLabel` en las pantallas internas, `ETIQUETA_POR_HITO` en
// el rastreo público, que es el vocabulario que esa superficie ya enseña). Así el nombre cambia en un
// solo sitio y la nota lo sigue sola.
//
// Módulo de PRESENTACIÓN puro: sin React, sin dominio, sin fetch.

/** Separador de la nota. Punto medio con un espacio a cada lado (decisión del humano). */
export const SEPARADOR_NOTA = " · ";

/** La coletilla que marca que el resultado todavía no está confirmado. */
export const COLETILLA_PENDIENTE_CONFIRMACION = "pendiente de confirmación";

/** La nota propia de la ayuda a la tienda (no lleva coletilla: no es un resultado). */
export const NOTA_AYUDA_SOLICITADA = "Ayuda solicitada a la tienda";

/**
 * «<nombreVisible> · pendiente de confirmación». `nombreVisible` es el nombre del resultado tal
 * como la superficie ya lo enseña; este módulo no lo inventa ni lo traduce.
 */
export function textoPendienteConfirmacion(nombreVisible: string): string {
  return `${nombreVisible}${SEPARADOR_NOTA}${COLETILLA_PENDIENTE_CONFIRMACION}`;
}
