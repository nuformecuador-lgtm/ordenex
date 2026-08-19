import type { GestionResultado } from "@prisma/client";

// Feature 238 (design §2, R1/R3/R5) — EL PUNTO UNICO de «que paquete vuelve fisicamente a
// bodega». Lo leen los tres consumidores sin copia: el REPOSITORIO (el WHERE de la lectura del
// conjunto esperado y el de la escritura de la marca), el SERVICIO (la cobertura exacta) y la
// PANTALLA (que filas pinta la ventana de confirmacion).
//
// MODULO PURO: sin Prisma en runtime (solo el `type` del enum, que se borra en compilacion), sin
// servicios, sin `@/lib/db`, sin `next/*`. Se puede importar desde un Client Component sin
// arrastrar servidor. Mismo molde que `lib/types/gestion-destino.ts` (239).

/**
 * R1/R3/R5 — que resultado de gestion devuelve el PAQUETE a bodega. **Punto unico de la regla.**
 *
 * `Record<GestionResultado, boolean>` es exhaustivo A PROPOSITO: si el enum gana un sexto
 * resultado, esto NO COMPILA hasta que alguien decida si su paquete vuelve. Sin esa red, un
 * resultado nuevo caeria en `undefined` -> falsy -> se excluiria del bloqueo EN SILENCIO, que es
 * justo la forma que tiene este fallo de aparecer: nadie ve el hueco, se ve un cierre que se
 * aprueba sin escanear.
 *
 * `incidente: false` esta DECLARADO CON SU RAZON, no omitido: el paquete perdido, robado o
 * danado NO vuelve — se indemniza (feature 158). Es la decision humana firmada del 2026-08-19
 * (`progress/design_pila_ayuda_tienda.md`, decision 3, y `requirements.md` §PUERTA HUMANA). NO
 * «arreglar» poniendolo a `true`: eso bloquearia el cierre exigiendo escanear un paquete que no
 * existe, y dejaria cierres imposibles de aprobar.
 *
 * POR QUE UN `Record` TOTAL Y NO UNA LISTA. Una lista (`["devuelta","rechazada","reprogramada"]`)
 * expresa lo que entra y CALLA lo que queda fuera; ese silencio es exactamente lo que hace que la
 * exclusion de los incidentes «parezca un olvido» (R34) y lo que deja pasar un resultado nuevo.
 * El `Record` obliga a nombrar los cinco y a poner el `false` con su comentario; la lista se
 * DERIVA de el.
 */
export const RETORNA_A_BODEGA = {
  entregada: false, // se quedo con el cliente
  reprogramada: true, // vuelve a bodega y espera su fecha (liberacion_reprogramada, 46)
  devuelta: true,
  rechazada: true,
  incidente: false, // perdido / robado / danado: no vuelve, se indemniza (158)
} as const satisfies Record<GestionResultado, boolean>;

/**
 * R2 — los resultados cuyo paquete vuelve, DERIVADOS del `Record` de arriba.
 *
 * Se deriva y no se escribe: un segundo literal seria una segunda verdad que puede divergir del
 * `Record` sin que nada lo diga, y la guardia `confirmacion-incidentes-excluidos` existe
 * precisamente para que no aparezca ninguna copia suelta en el arbol.
 */
export const RESULTADOS_QUE_VUELVEN: readonly GestionResultado[] = (
  Object.keys(RETORNA_A_BODEGA) as GestionResultado[]
).filter((r) => RETORNA_A_BODEGA[r]);

/**
 * R1 — ¿el paquete de esta gestion vuelve a bodega?
 *
 * Funcion y no acceso directo al objeto para que el call-site lea como una decision («¿este
 * paquete vuelve?») y no como una consulta a un mapa. Mismo criterio que
 * `estatusDestinoDeResultado` (239).
 */
export function vuelveABodega(resultado: GestionResultado): boolean {
  return RETORNA_A_BODEGA[resultado];
}
