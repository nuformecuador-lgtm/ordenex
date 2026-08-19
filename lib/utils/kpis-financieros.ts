import { Prisma } from "@prisma/client";

/**
 * Suma una lista de importes que ya vienen como STRING de los ledgers.
 *
 * Funcion PURA y money-safe (R7 de la caja): `Prisma.Decimal` dentro, STRING de escala 2
 * fuera, `number` en NINGUNA parte. Un `.reduce((a, b) => a + Number(b))` sobre montos es
 * exactamente el bug que toda la capa de dinero de este repo esta escrita para impedir: con
 * mil saldos de dos decimales, el binario acaba devolviendo céntimos que no existen.
 *
 * LOS SIGNOS YA VIENEN DENTRO. `derivarSaldoTienda` y `derivarCuentaPorPagar` devuelven el
 * saldo con su signo (`"-123.45"` para la tienda que DEBE), asi que sumar es sumar: aqui no se
 * consulta el campo `signo` ni se cambia ningun signo. Si esta funcion mirase el signo estaria
 * decidiendo por segunda vez algo que el ledger ya decidio.
 *
 * Una lista vacia suma `"0.00"`, no `""` ni `null`: cero tiendas por pagar es una respuesta.
 */
export function sumarMontos(montos: readonly string[]): string {
  return montos
    .reduce((suma, monto) => suma.add(new Prisma.Decimal(monto)), new Prisma.Decimal(0))
    .toFixed(2);
}
