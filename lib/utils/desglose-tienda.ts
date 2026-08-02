import { Prisma } from "@prisma/client";
import type { DesgloseTiendaAgregadoRow } from "@/lib/interfaces/repositories/IWalletTiendaMovimientoRepository";
import type {
  DesgloseTiendaDTO,
  WalletTiendaMovimientoCategoria,
} from "@/lib/types/wallet-tienda";

/**
 * Feature 171 (design §2.1/§4.3) — DERIVA la cabecera del desglose de una tienda a partir de
 * los totales agregados por (tipo, categoria) que devuelve el repositorio.
 *
 * Funcion PURA, money-safe: suma y resta con `Prisma.Decimal`, salida STRING escala 2, signo
 * calculado aqui (en el servidor). Espejo estructural de `lib/utils/saldo-tienda.ts`, que se
 * deja intacto.
 */

/** Las TRES cubetas de la cabecera. No hay una cuarta: el saldo se deriva de estas. */
export type CubetaDesglose = "aFavor" | "cargos" | "pagado";

/**
 * R8/R9 — clasificacion EXHAUSTIVA de las categorias del ledger en las tres cubetas.
 *
 * Es un `Record` sobre el union completo a proposito: el dia que el enum de Postgres gane un
 * valor, `WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED` lo obliga a entrar en el union (via el
 * chequeo `_EnsureCategoriaExhaustive` de `lib/types/wallet-tienda.ts`) y ESTE objeto deja de
 * compilar hasta que alguien decida —y escriba— en que importe cae. Un `switch` con `default`
 * o un `Partial<Record<…>>` dejarian que cayera en silencio dentro de «cargos»; asi no.
 * `tests/unit/utils/desglose-tienda.test.ts` recorre el SEED y lo comprueba tambien en
 * runtime, para que la garantia no dependa solo de que alguien ejecute el typecheck.
 *
 * La separacion `pagado` / `cargos` es la decision central de la feature: ambos son debitos,
 * pero uno es «lo que te cobre» y el otro «lo que ya te pague». Ver `DesgloseTiendaDTO`.
 */
export const CUBETA_POR_CATEGORIA: Record<WalletTiendaMovimientoCategoria, CubetaDesglose> = {
  // A favor de la tienda (creditos): el dinero que se recaudo a su nombre.
  cod_recaudado: "aFavor",
  ajuste_credito: "aFavor",
  // Cargos de Ordenex (debitos != pago_tienda): lo que se le cobra por el servicio.
  flete: "cargos",
  flete_devolucion: "cargos",
  comision_cod: "cargos",
  iva_flete: "cargos",
  iva_flete_devolucion: "cargos",
  iva_comision_cod: "cargos",
  ajuste_debito: "cargos",
  // Pagado a la tienda: lo ya entregado. Hoy nadie lo emite (lo hara la 172), pero se lee de
  // la categoria REAL del ledger, no se devuelve un cero fijo (R43).
  pago_tienda: "pagado",
};

/**
 * R7/R8/R10/R23 — suma cada fila agregada en su cubeta y cierra la aritmetica de la cabecera:
 * `saldo = aFavor - cargos - pagado`.
 *
 * La cubeta se decide por `categoria`, NO por `tipo`. Limite aceptado y declarado (design
 * §2.1): la base no tiene un CHECK que ate categoria↔tipo, asi que una fila con
 * `categoria = cod_recaudado` y `tipo = debito` se contaria aqui como credito y en
 * `derivarSaldoTienda` como debito. No se inventa esa restriccion (seria una migracion fuera
 * del pedido, sobre una tabla append-only con datos en produccion): el ledger solo lo escribe
 * el feed del cierre, y el test de R11 compara ambas derivaciones sobre el mismo conjunto para
 * que la divergencia, si algun dia apareciera, salga por ahi.
 *
 * Sin filas (tienda sin movimientos en el conjunto filtrado) devuelve los cuatro importes en
 * "0.00" con signo `cero`, no un hueco.
 */
export function derivarDesgloseTienda(rows: DesgloseTiendaAgregadoRow[]): DesgloseTiendaDTO {
  const acc: Record<CubetaDesglose, Prisma.Decimal> = {
    aFavor: new Prisma.Decimal(0),
    cargos: new Prisma.Decimal(0),
    pagado: new Prisma.Decimal(0),
  };

  for (const row of rows) {
    const cubeta = CUBETA_POR_CATEGORIA[row.categoria];
    acc[cubeta] = acc[cubeta].add(new Prisma.Decimal(row.total));
  }

  // R10: el orden de la cabecera ES la formula leida de izquierda a derecha.
  const saldo = acc.aFavor.sub(acc.cargos).sub(acc.pagado);

  const signo: DesgloseTiendaDTO["signo"] = saldo.gt(0)
    ? "positivo"
    : saldo.lt(0)
      ? "negativo"
      : "cero";

  return {
    aFavor: acc.aFavor.toFixed(2),
    cargos: acc.cargos.toFixed(2),
    pagado: acc.pagado.toFixed(2),
    saldo: saldo.toFixed(2),
    signo,
  };
}
