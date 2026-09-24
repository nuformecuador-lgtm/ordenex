import type { GestionResultado } from "@prisma/client";

import type { OrderStatusValue } from "@/lib/types/order-status";

// Feature 239 (design §2, R3) — LA BISAGRA: el mapa `resultado de gestion -> estado destino`.
//
// Hasta esta feature el destino de una gestion NO se declaraba en ningun sitio: se derivaba por
// IDENTIDAD DE NOMBRE, con `findEstatusIdByValue(input.resultado)`
// (`MisAsignacionesService`). Funcionaba de casualidad, porque los cinco `resultado` del enum
// (`entregada`, `reprogramada`, `devuelta`, `rechazada`, `incidente`) se llaman IGUAL que su
// estado destino en `order_status`. Nunca fue una regla: era una coincidencia sostenida a mano.
//
// La 239 rompe esa coincidencia para UNO de los cinco —`devuelta` deja de ir a `devuelta`— y por
// eso el mapa tiene que existir. Sin el, la unica forma de expresar el cambio seria un `if` en
// mitad del servicio, que es exactamente la clase de regla escondida que este repo persigue.
//
// VIVE EN `lib/types/` Y NO DENTRO DEL SERVICIO a proposito: lo necesitan al menos tres lectores
// (el servicio de gestion, la tabla de estados esperados del deshacer en `CierreDiaService` y
// los tests del inventario de transiciones). Una segunda copia es justo la divergencia que las
// guardias de este repo cazan.
//
// MODULO PURO: sin Prisma (solo el `type` del enum, borrado en compilacion), sin servicios, sin
// `@/lib/db`, sin `next/*`. Se puede importar desde un Client Component sin arrastrar servidor.

/**
 * R3 — destino de cada `resultado` de gestion. **Punto unico de la regla.**
 *
 * Los DOS `satisfies` son DOS redes distintas, y las dos rompen el build:
 *  - `Record<GestionResultado, ...>` exige que **todo** resultado del enum tenga destino
 *    declarado: si manana el enum gana un sexto valor, esto no compila hasta que alguien decida
 *    a donde va. Sin esta red, un resultado nuevo caeria en `undefined` y la orden se quedaria
 *    sin transicionar en silencio.
 *  - `OrderStatusValue` en el valor exige que el destino EXISTA en el catalogo: un typo, o un
 *    estado retirado del seed, tampoco compila.
 *
 * ⏳ 2026-09-23 (FICHA 454, design §6): AQUI DECIA que `devuelta -> devolucion_por_confirmar` era la
 * unica entrada que rompia la identidad de nombre (la 239). Con la 454 NINGUNA gestion transiciona al
 * registrarse: la orden se queda `en_reparto` y la APROBACION DEL CIERRE aplica el destino de ESTE
 * mapa, que pasa a ser el mapa DE APLICACION. Por eso `devuelta` vuelve a la identidad: el pre-estado
 * desaparece, y lo que la 239 protegia (el cobro prematuro) lo protege ahora que la aplicacion solo
 * ocurre al aprobar. El reloj del plazo sigue arrancando en la aprobacion (familia
 * `anclaje_devolucion`, R47).
 */
export const ESTATUS_POR_RESULTADO = {
  entregada: "entregada",
  reprogramada: "reprogramada",
  rechazada: "rechazada",
  incidente: "incidente",
  // FICHA 454: identidad otra vez. Se APLICA solo al aprobar el cierre (no al gestionar).
  devuelta: "devuelta",
} as const satisfies Record<GestionResultado, OrderStatusValue>;

/**
 * R2/R3 — el `value` de `order_status` al que transiciona una gestion con ese `resultado`.
 *
 * Funcion y no acceso directo al objeto para que el call-site lea como una decision («¿a donde
 * va este resultado?») y no como una coincidencia de strings.
 */
export function estatusDestinoDeResultado(resultado: GestionResultado): OrderStatusValue {
  return ESTATUS_POR_RESULTADO[resultado];
}

// ⏳ 2026-09-23 (FICHA 454): aqui vivia `ESTATUS_DEVOLUCION_POR_CONFIRMAR`, el pre-estado de la
// devolucion de la 239. Muere con el estado (T1.1).
