import type { GestionResultado } from "@prisma/client";

// Feature 276 (design §4, R3/R7) — EL PUNTO UNICO DE LA REGLA DEL TOPE DE INTENTOS.
//
// La regla entera es una frase: **al alcanzar el umbral, la orden no vuelve a circulacion.** Este
// modulo contiene esa frase y NADA MAS: ni el umbral, ni la configuracion, ni una consulta.
//
// MODULO PURO, con el mismo contrato que `lib/types/gestion-destino.ts`: sin Prisma en runtime
// (solo el `type` del enum, borrado en compilacion), sin servicios, sin `@/lib/db`, sin `next/*`.
// Se puede importar desde un Client Component sin arrastrar servidor — y eso es un REQUISITO, no
// una comodidad: la UI (R8) y la guarda del servidor (R1) tienen que leer la MISMA lista, porque
// si divergen la pantalla ofrece un boton que el servidor rechaza.
//
// ⚠️ EL UMBRAL NO VIVE AQUI Y NO PUEDE VIVIR AQUI (R10, y 160/R20 con test de contrato en
// `tests/unit/components/intentos-entrega.test.tsx`): entra por PARAMETRO. Si este modulo
// importara `reintentosConfig`, cualquier componente que use `permitidoEnElTope` se llevaria la
// configuracion al navegador. `tests/unit/types/tope-intentos.test.ts` lee este fichero y falla si
// aparece el nombre `MIN_INTENTOS_ENTREGA` o `reintentosConfig`.

/**
 * R1/R2/R3 — LISTA DE INCLUSION de los `resultado` de gestion que SIGUEN admitidos cuando la
 * orden esta en el tope. Los que no estan aqui quedan prohibidos: hoy `reprogramada` y `devuelta`,
 * que son exactamente los dos desenlaces que devuelven la orden a circulacion.
 *
 * ⚠️ LISTA BLANCA, JAMAS LISTA NEGRA, y es un requisito (R3) con la misma razon —y la misma
 * forma— que `RESULTADOS_QUE_CUENTAN_COMO_INTENTO`: con lista negra, un `resultado` FUTURO del
 * enum quedaria admitido SOLO y podria devolver a circulacion una orden que ya agoto sus intentos,
 * en silencio. Con lista blanca, lo que hace un resultado nuevo por defecto es **quedar bloqueado
 * en el tope**, que es la direccion segura del error.
 *
 * `satisfies readonly GestionResultado[]` rompe el build si el enum pierde uno de estos valores.
 *
 * Los tres, y por que cada uno:
 *   - `entregada`  — la entrega lograda es el desenlace que se busca; nunca se prohibe.
 *   - `rechazada`  — es el desenlace terminal, y el que la orden en el tope necesita poder tener.
 *   - `incidente`  — decision 3 del humano (2026-08-24): NO es un desenlace de entrega (paquete
 *                    dañado/perdido/robado), asi que el tope no lo toca. «Reportar incidente»
 *                    sigue visible en el panel del mensajero.
 */
export const RESULTADOS_PERMITIDOS_EN_EL_TOPE = [
  "entregada",
  "rechazada",
  "incidente",
] as const satisfies readonly GestionResultado[];

export type ResultadoPermitidoEnElTope = (typeof RESULTADOS_PERMITIDOS_EN_EL_TOPE)[number];

/**
 * R1 — `true` si la gestion que se registre AHORA sobre esa orden es la que ALCANZA el umbral (o
 * si ya lo paso).
 *
 * `intentosVigentes >= umbral - 1`, y el `>=` es deliberado (nunca `===`): los datos heredados
 * pueden estar POR ENCIMA del umbral —la ficha nace de una orden con 3 intentos que seguia
 * circulando— y esos tambien tienen que quedar bloqueados. Con `===` una orden con `umbral`
 * intentos se escaparia por el hueco.
 *
 * El `umbral` entra por parametro: quien lo llama lo resuelve de `reintentosConfig` (R7).
 */
export function alcanzaElTope(intentosVigentes: number, umbral: number): boolean {
  return intentosVigentes >= umbral - 1;
}

/**
 * R1/R3 — `true` si ese `resultado` se admite estando en el tope. Pertenencia a la lista de
 * INCLUSION, no negacion de una lista de prohibidos.
 */
export function permitidoEnElTope(resultado: GestionResultado): boolean {
  return (RESULTADOS_PERMITIDOS_EN_EL_TOPE as readonly GestionResultado[]).includes(resultado);
}
