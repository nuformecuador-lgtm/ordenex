import { Prisma } from "@prisma/client";
import { INDEMNIZACION_MONTO_MAX } from "@/lib/types/cierres-admin";

/**
 * TOPE de NEGOCIO del monto de indemnizacion (decision humana del 2026-08-04).
 *
 * ─── El defecto que cierra ────────────────────────────────────────────────────────────────
 * Hasta hoy la unica cota superior del monto era `INDEMNIZACION_MONTO_MAX`, y su propio
 * comentario lo dice por escrito: es el mayor valor representable en un `DECIMAL(12,2)`
 * (`9999999999.99`), puesto para que Postgres no responda `numeric field overflow`. **No es un
 * limite de negocio.** El 2026-08-04 se registro en PRODUCCION una indemnizacion de
 * ₡9.999.999.999,99 por el camino del incidente del admin: paso todas las validaciones porque
 * cabia en la columna.
 *
 * ─── La regla ─────────────────────────────────────────────────────────────────────────────
 * Una indemnizacion compensa un paquete perdido o danado, asi que no puede valer mas que el
 * paquete: el tope de negocio es `orden.monto_cobrar` (`db/schema.prisma`, `Decimal(12,2)`).
 *
 * El limite es **INCLUSIVO**: `monto === valorOrden` se ACEPTA. Compensar exactamente lo que
 * valia el paquete es el caso normal de una perdida total; si el limite fuera exclusivo, la
 * indemnizacion completa seria justo la unica cifra imposible de registrar. Se rechaza solo el
 * ESTRICTAMENTE mayor. Lo fija un test (`tope-indemnizacion.test.ts`).
 *
 * ─── Decision 1: la orden SIN `monto_cobrar` (NULL) ───────────────────────────────────────
 * El tope de negocio NO APLICA y se conserva el tecnico. Es una decision DECLARADA del leader,
 * no un caso olvidado: bloquear esas ordenes impediria indemnizar un paquete legitimo cuyo
 * envio ya estaba pagado, y son una minoria del censo. El coste de la decision es conocido y
 * acotado: sobre esas ordenes la unica cota sigue siendo la de la columna.
 *
 * ─── Decision 2: la orden con `monto_cobrar = 0.00` ───────────────────────────────────────
 * Se trata EXACTAMENTE IGUAL que el NULL: el tope de negocio no aplica.
 *
 * El motivo, y no es simetria estetica: `monto_cobrar` es lo que se cobra AL ENTREGAR (COD).
 * Un `0.00` admite dos lecturas —«envio ya pagado» y «nadie lo relleno»— y la columna no puede
 * distinguirlas: en la misma tabla conviven filas NULL y filas `0.00`, prueba de que el campo
 * no se usa de forma consistente para significar «desconocido». Si se tomara el cero como tope
 * literal, NINGUNA indemnizacion seria posible sobre esas ordenes (el monto debe ser > 0), es
 * decir, el bloqueo total que el leader ya descarto para el NULL, y por el mismo motivo.
 *
 * Consecuencia deliberada: el tope de negocio se aplica **si y solo si la orden declara un
 * valor POSITIVO**. Si algun dia el negocio quiere «cero = no se indemniza», hara falta una
 * senal EXPLICITA distinta del monto COD (una bandera de envio prepagado, por ejemplo): el
 * cero, por si solo, no dice eso.
 *
 * ─── El tope tecnico NO se quita ──────────────────────────────────────────────────────────
 * Sigue siendo la ultima barrera contra el overflow y se evalua SIEMPRE y PRIMERO. No se
 * confia en que «el de negocio ya es mas bajo»: hoy lo es (las dos columnas son `DECIMAL(12,2)`),
 * pero eso es una coincidencia de precision que un `ALTER TABLE` podria romper en silencio. El
 * mensaje devuelto dice cual de los dos topes se supero.
 */

/** Mensaje del tope TECNICO (limite de la columna). */
export const MSG_TOPE_TECNICO = `El monto no puede superar ${INDEMNIZACION_MONTO_MAX}.`;

/** Mensaje del tope de NEGOCIO. Nombra la cifra: sin ella el admin no puede corregir el dato. */
export function msgTopeNegocio(valorOrden: string): string {
  return `El monto no puede superar el valor de la orden (${valorOrden}).`;
}

/**
 * Devuelve el MENSAJE del tope superado, o `null` si el monto cabe en los dos.
 *
 * @param monto              monto capturado, STRING money-safe (nunca `number`, nunca `parseFloat`).
 * @param ordenMontoCobrar   `orden.monto_cobrar` de la orden indemnizada, STRING o `null`.
 *
 * Un `monto` no numerico devuelve `null` A PROPOSITO: no es un problema DE TOPE, y anadirle aqui
 * un mensaje de tope seria enganoso. El regex y el `> 0` de `montoPositivoSchema` (borde) y
 * `montoValido` (service) lo rechazan con el suyo. Mismo criterio que el `catch` del refine de
 * `indemnizacionSchema`.
 */
export function excesoIndemnizacion(monto: string, ordenMontoCobrar: string | null): string | null {
  let m: Prisma.Decimal;
  try {
    m = new Prisma.Decimal(monto.trim());
  } catch {
    return null;
  }

  // 1) TECNICO — siempre, y primero. Es la barrera que no puede saltarse ninguna orden.
  if (m.gt(INDEMNIZACION_MONTO_MAX)) return MSG_TOPE_TECNICO;

  // 2) NEGOCIO — solo si la orden declara un valor POSITIVO (decisiones 1 y 2 de arriba).
  const tope = topeNegocio(ordenMontoCobrar);
  if (tope !== null && m.gt(tope)) return msgTopeNegocio(tope.toFixed(2));

  return null;
}

/**
 * El tope de negocio APLICABLE, o `null` si no aplica (orden sin valor declarado).
 *
 * `null` y `0` toman la MISMA rama, y esta escrito como una sola condicion a proposito: son la
 * misma decision («la orden no declara un valor positivo»), no dos casos que se parecen.
 */
function topeNegocio(ordenMontoCobrar: string | null): Prisma.Decimal | null {
  if (ordenMontoCobrar === null) return null; // decision 1
  let v: Prisma.Decimal;
  try {
    v = new Prisma.Decimal(ordenMontoCobrar);
  } catch {
    // Una orden con un valor ilegible no puede acotar nada. Cae al tecnico, como el NULL:
    // fallar hacia «no hay tope de negocio» es lo mismo que ya decidio el leader para el NULL,
    // y fallar hacia «bloqueado» dejaria la indemnizacion imposible por un dato corrupto.
    return null;
  }
  return v.gt(0) ? v : null; // decision 2: el `0.00` no acota
}
