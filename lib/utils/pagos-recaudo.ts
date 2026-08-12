import type { MetodoPago } from "@/lib/types/metodo-pago";

// Feature 208 (R11/R12/R14/R30) — util PURO del desglose del recaudo al cliente.
//
// ⛔ Este archivo NO importa `@prisma/client` NI nada que arrastre runtime de servidor: lo usa
// `lib/types/gestion-orden.ts`, que VIAJA AL BUNDLE DEL NAVEGADOR (`GestionarOrdenPanel.tsx`
// valida con el MISMO `gestionarSchema`). Por eso la comprobacion de la suma del BORDE se hace
// en CENTIMOS ENTEROS y no con `Prisma.Decimal`: la aritmetica `Decimal` empieza donde ya
// empieza hoy —el servicio (R18) y el repositorio (R20)—.
//
// Cero `parseFloat` y cero suma de floats (R30): sumar `0.1 + 0.2` da `0.30000000000000004` y
// una entrega de 8.000 partida en dos metodos dejaria de cuadrar por un centavo fantasma.

/** Una linea del desglose: un metodo y su monto YA SUMADO (D2: un metodo, como mucho una vez). */
export interface LineaPago {
  metodo: MetodoPago;
  monto: number;
}

/**
 * Monto en centimos ENTEROS. `Math.round` (no `Math.trunc`) porque el float que llega del
 * borde puede ser `8000.000000000001`: truncar perderia el centavo, redondear lo recupera.
 */
export function aCentimos(v: number): number {
  return Math.round(v * 100);
}

/**
 * R11: la suma de las lineas iguala EXACTAMENTE el total. Se compara en centimos enteros,
 * asi que la igualdad es exacta y no "casi". Lista vacia suma 0.
 */
export function sumaCuadra(pagos: readonly { monto: number }[], total: number): boolean {
  const suma = pagos.reduce((acc, p) => acc + aCentimos(p.monto), 0);
  return suma === aCentimos(total);
}

/**
 * Convierte CUALQUIERA de las dos formas de entrada en la lista canonica que viaja hacia
 * adentro (R12/R14):
 *
 * - `montoRecibido = 0` -> `[]`, SEA CUAL SEA la forma recibida. Es el caso «orden SIN cobro»
 *   que hoy el panel disfraza de `efectivo` (`GestionarOrdenPanel.tsx:331`): con desglose son
 *   CERO lineas, no una linea de efectivo/0 (R14).
 * - `pagos` presente -> se devuelve tal cual (el borde ya lo valido).
 * - solo `metodoPago` (forma ESCALAR historica) -> UNA linea `(metodoPago, montoRecibido)` (R12).
 *
 * Helper PURO y testeable a proposito, NO una rama escondida dentro de la Server Action: es
 * exactamente el punto que la 209 borrara cuando cierre la puerta de compatibilidad.
 */
export function normalizarPagos(input: {
  montoRecibido: number;
  metodoPago?: MetodoPago | null;
  pagos?: readonly LineaPago[];
}): LineaPago[] {
  if (aCentimos(input.montoRecibido) === 0) return []; // R14
  if (input.pagos !== undefined) return input.pagos.map((p) => ({ ...p })); // R11
  if (input.metodoPago) return [{ metodo: input.metodoPago, monto: input.montoRecibido }]; // R12
  return [];
}
