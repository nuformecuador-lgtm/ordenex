import type { OrderStatusValue } from "@/lib/types/order-status";

// FICHA 413 (T1.1, design §3.2) — EL UNIVERSO DE «LO QUE ESTE MENSAJERO TIENE ENCIMA», DECLARADO
// UNA VEZ PARA QUE EL PORTAL Y EL AVISO NO PUEDAN CONTAR POBLACIONES DISTINTAS.
//
// La regla que decide todo en la 413 es la que dejo escrita la 409:
//
//   > Si el aviso dijera «5» y la pantalla enseñara 4, el aviso queda desacreditado el primer dia.
//
// Por eso el conteo de `RepartoMananaRepository` NO puede escribir su propia lista de estados: el
// dia que el portal del mensajero gane un cuarto estatus, el aviso contaria uno menos y NADA se
// pondria rojo. Este modulo es esa unica lista, y `estados-reparto-mensajero-unica-fuente.guardia`
// es el aserto que se pone ROJO si el portal y el repositorio dejan de decir lo mismo.
//
// ⚠️ POR QUE `MisAsignacionesService` CONSERVA SUS TRES `const` LOCALES Y NO IMPORTA EL ARRAY.
// Esto NO es una copia olvidada: es una restriccion MEDIDA de una guardia VIGENTE y ajena.
// `tests/unit/guards/carga-del-mensajero.guardia.test.ts` (235/262) lee el FUENTE del portal y
// exige que `findMisAsignaciones(...)` reciba una LISTA LITERAL cuyos elementos sean literales de
// texto o identificadores declarados CON UN LITERAL EN ESE MISMO MODULO (su `valorDe` revienta con
// cualquier otra cosa: un spread, un indice o un import). Pasarle `ESTADOS_REPARTO_MENSAJERO`
// pondria esa guardia ROJA — y esa guardia nacio de dos agujeros reales que costaban dinero.
//
// Asi que el amarre se hace por las DOS vias que si caben, y las dos se ponen rojas solas:
//   1. EN COMPILACION — las tres `const` del portal van ANOTADAS con `EstadoRepartoMensajero`, que
//      se deriva de esta tupla. Quitar un valor de aqui deja el portal SIN COMPILAR.
//   2. EN TEST — la guardia de esta ficha extrae la lista del FUENTE del portal (la misma tecnica
//      que la guardia de la 235, no la constante que el portal importa) y la compara miembro a
//      miembro con esta tupla. Un cuarto estatus en el portal ⇒ ROJA.
// Leer la constante desde el portal para compararla consigo misma habria sido la «asercion contra
// su propia fuente» que este repo ya pago: siempre verde.
//
// EL REPOSITORIO DEL AVISO SI LA IMPORTA, y no puede nombrar ni uno de los tres literales: eso es
// lo que mata la mutacion obligatoria de R2 (duplicar la lista alli).
//
// MODULO PURO: sin Prisma en runtime (solo el `type`, borrado al compilar), sin React, sin
// `next/*`, sin reloj y sin DB.

/**
 * R2 — LOS TRES ESTADOS que el portal del mensajero muestra y que el aviso de «tu reparto de
 * mañana» cuenta. EL MISMO conjunto, por construccion.
 *
 *   · `por_recoger`  — asignada y todavia en bodega. En la practica es el UNICO estado en que
 *     puede estar una orden reservada para mañana, porque la 261 bloquea recogerla y gestionarla
 *     mientras la reserva sea futura. Pero «en la practica» es un razonamiento, no una medida, y
 *     este repo ya pago una *imposibilidad razonada* que Postgres desmintio.
 *   · `en_reparto`   — ya en la mano del mensajero.
 *   · `ayuda_tienda` — pidio ayuda sobre ella y EL PAQUETE SIGUE CON EL (235/R1).
 *
 * `recolectando` sigue FUERA, como lo dejo el corte limpio de la 167/R34: lo que no se lee no
 * puede contaminar los KPIs, el mapa, la ruta ni el corte del dia.
 */
export const ESTADOS_REPARTO_MENSAJERO = [
  "por_recoger",
  "en_reparto",
  "ayuda_tienda",
] as const satisfies readonly OrderStatusValue[];

/**
 * El tipo de un estatus de este universo. Lo usan las anotaciones de las tres `const` del portal:
 * es el amarre de COMPILACION descrito arriba.
 */
export type EstadoRepartoMensajero = (typeof ESTADOS_REPARTO_MENSAJERO)[number];
