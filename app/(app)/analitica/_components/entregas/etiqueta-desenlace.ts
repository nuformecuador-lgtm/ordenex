// El `value` del catalogo de desenlaces puesto en algo que se lee en una pantalla.
//
// ─── POR QUE ESTA FUNCION SE MUDO AQUI (ficha 347, F1) ──────────────────────────────────────
//
// Vivia en `ConteoEntregasAnillo.tsx`, que es un componente de cliente y arrastra `recharts`.
// La ficha 347 necesita LA MISMA funcion en dos sitios mas y uno de ellos es
// `analitica-productos-descarga-columnas.ts`, que es un modulo PURO por contrato (sin React,
// sin DOM) y lo EJECUTA la guardia de columnas sensibles en un entorno de node. Importar el
// anillo desde alli habria metido una grafica en un barrido de columnas.
//
// Es una MUDANZA, no un cambio de comportamiento: `ConteoEntregasAnillo` la RE-EXPORTA con su
// nombre de siempre, asi que ninguno de sus consumidores —ni el anillo, ni
// `tests/unit/analytics/conteo-entregas-pliegue.test.ts`— cambia un import. Mismo patron con el
// que `money()` se mudo a `lib/config/moneda.ts`.

import { nombreDeEstado } from "@/lib/types/order-status";
import { BUCKET_OTROS } from "@/lib/types/conteo-entregas";

// ─── FICHA 455 (2026-09-24, design §2.1; R2, R3, R42) ─────────────────────────────────────────
//
// Hasta la 455 esta funcion PLURALIZABA el `value` del catalogo («entregada» → «Entregadas»,
// suponiendo que los cinco desenlaces terminaban en «a») porque `order_status` no tenia nombre
// visible. Con los codigos de la 455 eso producia «Novedads» y «Devolucion_a_origen_por_rechazos».
// Ahora el nombre existe y tiene UNA sola fuente (`nombreDeEstado`): cada desenlace se nombra con
// su nombre visible EXACTO — sin plural, sin minusculas, sin humanizar el codigo (R2/R3). La
// cantidad va al lado, nunca dentro del nombre (ver `desenlaces-de-fila.ts` y `otros-resultados.ts`).

/** El rotulo del cubo `otros` del conteo de entregas: un GRUPO, no un estado (R6). */
export const ETIQUETA_BUCKET_OTROS = "Otros";

/**
 * El nombre visible de un desenlace del catalogo (`entregado`, `novedad`…), o el rotulo del cubo
 * `otros`. Un codigo desconocido se lee «Estado no reconocido», nunca crudo (R10).
 */
export function etiquetaDeDesenlace(valor: string): string {
  return valor === BUCKET_OTROS ? ETIQUETA_BUCKET_OTROS : nombreDeEstado(valor);
}

// FICHA 442 → 455: aqui vivia `etiquetaDeDesenlaceContada` (singular con cantidad 1, plural si no).
// Con un solo nombre por estado (R2: sin plural) la cantidad ya no cambia el nombre y se retira: la
// frase de «En qué terminaron» y la composicion de «Otros resultados» usan `etiquetaDeDesenlace`.
