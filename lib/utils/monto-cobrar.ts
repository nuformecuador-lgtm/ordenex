/**
 * Feature 299 — EL MONTO A COBRAR ENTRA REDONDEADO AL COLON, Y EL REDONDEO SE DICE.
 *
 * EL DEFECTO QUE CIERRA. La carga aceptaba cualquier `Number(value)` finito >= 0 —decimales
 * incluidos— mientras el desglose de pago de la entrega SOLO admite enteros (decision
 * deliberada de `components/shared/DesglosePagoField.tsx`: el input filtra a digitos). Una
 * orden cargada con centimos no se podia entregar NUNCA: la pantalla pintaba «Diferencia 0»
 * con `money()` (redondeado) y el guard comparaba contra el valor EXACTO. El 2026-08-27 hubo
 * que redondear 14 ordenes A MANO en la base para desbloquear a los mensajeros.
 *
 * LA REGLA, decidida por el humano ese mismo dia: redondear al colon mas cercano AL ENTRAR y
 * AVISAR. Se descartaron rechazar la fila (obliga a la tienda a corregir su archivo cada vez)
 * y redondear a multiplos de 5 (comodo en efectivo, innecesario con SINPE).
 *
 * POR QUE AL ENTRAR Y NO DESPUES: un paso posterior deja una ventana con ordenes incobrables
 * y depende de que alguien se acuerde de ejecutarlo.
 *
 * EL MEDIO SUBE, y no es una eleccion caprichosa: es la MISMA regla que ya aplica
 * `formatMontoString` (`lib/config/moneda.ts`, feature 230) para pintar el dinero sin
 * centimos — half away from zero—. Sobre un monto NO NEGATIVO —el unico que el schema deja
 * pasar— «alejarse del cero» es «subir», que es exactamente lo que hace `Math.round`. Que
 * coincidan importa: lo que se guarda es lo que la pantalla ya venia mostrando, asi que la
 * cifra del resumen y la del cobro dejan de poder discrepar.
 *
 * POR QUE AQUI SI SE OPERA CON UN `number`, cuando el repo tiene tres guardias que prohiben
 * convertir un importe a numero: porque en ESTE camino el monto YA es un `number` por
 * contrato desde la feature 15 (`filaCargaSchema` lo convierte, `CreateOrdenData.montoCobrar`
 * es `number | null` y el repositorio lo mete en un `Prisma.Decimal`). Aqui no se convierte
 * nada: se redondea lo que ya venia convertido, y se redondea A ENTERO, que es la operacion
 * que menos precision puede perder de todas las posibles.
 */

/**
 * Un monto que entro con decimales y se guardo redondeado. Es el AVISO por fila: sin el, el
 * sistema de la tienda y el nuestro dicen numeros distintos y nadie sabe por que.
 */
export interface MontoAjustado {
  /** Lo que mando la tienda, tal cual lo valido el schema (`11898.81`). */
  original: number;
  /** Lo que se persiste, y lo unico que el mensajero podra cobrar (`11899`). */
  aplicado: number;
}

/** Lo que se persiste, mas el aviso si hubo ajuste (`null` cuando no lo hubo). */
export interface MontoNormalizado {
  valor: number | null;
  ajuste: MontoAjustado | null;
}

/** El colon mas cercano; el medio sube (half away from zero sobre un monto no negativo). */
export function redondearMontoCobrar(monto: number): number {
  return Math.round(monto);
}

/**
 * Normaliza el monto de una fila de alta.
 *
 * `null` (columna vacia o ausente) sigue siendo `null`: «sin monto a cobrar» no es un cero ni
 * un ajuste, y esta feature no toca esa rama. Un entero se devuelve TAL CUAL y sin aviso: una
 * carga normal no gana ni un mensaje.
 */
export function normalizarMontoCobrar(monto: number | null): MontoNormalizado {
  if (monto === null) return { valor: null, ajuste: null };
  const aplicado = redondearMontoCobrar(monto);
  if (aplicado === monto) return { valor: aplicado, ajuste: null };
  return { valor: aplicado, ajuste: { original: monto, aplicado } };
}
