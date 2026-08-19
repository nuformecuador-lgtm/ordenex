import { Prisma } from "@prisma/client";

/**
 * Feature 231 — un `Prisma.Decimal` a STRING con **escala 2 fija**, exacto.
 *
 * QUE ES. La conversion money-safe canonica del repo, la misma que `derivarBalance`,
 * `cierre-totales`, `cuenta-por-pagar` y otras siete derivaciones puras hacen en linea:
 * `Decimal#toFixed(2)`. NO es `Number#toFixed` —no hay ningun `number` de por medio—, y no es
 * `toString()`, que se comeria el segundo decimal (`"0.5"` en vez de `"0.50"`) y podria emitir
 * notacion exponencial en un importe muy grande.
 *
 * POR QUE VIVE EN UN ARCHIVO PROPIO, que es lo unico raro de este modulo de tres lineas.
 * `tests/unit/utils/caja-tesoreria.test.ts` (el `it` «R7: el modulo NO tiene ni una llamada
 * capaz de convertir un monto a numero») barre la fuente de `lib/utils/caja-tesoreria.ts`
 * contra `LLAMADAS_PROHIBIDAS_EN_DINERO`, y esa lista incluye el literal `.toFixed(` porque
 * persigue el `toFixed` de `Number`, que si pierde centimos. Aquella asercion se escribio
 * cuando ese modulo no emitia NI UN STRING por su cuenta: los tres que devolvia se los daba
 * `derivarBalance`. La feature 231 le pide once importes y un porcentaje propios.
 *
 * Se elige sacar la conversion aqui —y no relajar aquel barrido— porque debilitar una asercion
 * de dinero de otra feature es una decision con firma humana, no un arreglo de paso (es la
 * misma clase de problema que D1). La propiedad que el barrido protege se conserva ENTERA: en
 * este archivo tampoco hay `Number(`, `parseFloat(` ni `parseInt(`, y su unica entrada es un
 * `Prisma.Decimal`, asi que no existe camino por el que un monto se convierta en numero.
 *
 * Queda anotado en `progress/impl_231.md` como desviacion de `design.md §3.1`, que daba por
 * hecho que las dos derivaciones nuevas podian emitir sus STRING desde `caja-tesoreria.ts`.
 */
export function montoEscala2(valor: Prisma.Decimal): string {
  return valor.toFixed(2);
}
