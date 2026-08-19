// El puerto de lectura del dinero POR DIA. Contrato NEUTRAL: sin Prisma y sin Next, para que
// la derivacion y el servicio se ejerciten sin `DATABASE_URL`.

import type { WalletMovimientoCategoria, WalletMovimientoTipo } from "@/lib/types/wallet";

/**
 * Fila del agregado `GROUP BY (dia CR, categoria, tipo) + SUM(monto)` sobre el libro de la caja.
 *
 * Es la ENTRADA de `derivarFinanzasDiarias`, y viene DESGLOSADA por categoria y tipo a
 * proposito: la particion propio/terceros —y por tanto la ganancia— es una decision de negocio
 * que vive en `NATURALEZA_POR_CATEGORIA`, no en el SQL. Si el repositorio devolviera ya los
 * cuatro numeros, esa clasificacion estaria escrita dos veces: en la caja y aqui.
 */
export interface AgregadoDiarioCajaRow {
  /** Dia calendario de Costa Rica, `YYYY-MM-DD`. */
  readonly fecha: string;
  readonly categoria: WalletMovimientoCategoria;
  readonly tipo: WalletMovimientoTipo;
  /** SUMA de `monto` de esa terna, STRING de escala 2. Siempre positiva: el signo lo da `tipo`. */
  readonly total: string;
}

export interface IFinanzasDiarioRepository {
  /**
   * Suma el libro de la caja por dia calendario CR, categoria y tipo, dentro de la ventana
   * SEMIABIERTA `[desde, hasta)`.
   *
   * La ventana llega como INSTANTES ya resueltos y no como fechas: quien decide que es «hoy» en
   * Costa Rica es `lib/analytics/ranges.ts` a traves del servicio, y construir aqui una fecha
   * reintroduciria el off-by-one de seis horas del que ese modulo avisa.
   *
   * Devuelve SOLO las ternas con movimiento; los dias vacios no producen filas.
   */
  sumarPorDia(desde: Date, hasta: Date): Promise<readonly AgregadoDiarioCajaRow[]>;
}
