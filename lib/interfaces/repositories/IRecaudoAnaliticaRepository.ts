import type { WalletTiendaMovimientoTipo } from "@prisma/client";
import type { ConsultaAnalitica } from "@/lib/analytics/consulta";

// Feature 127 (T A.2) — contrato del repositorio del COD RECAUDADO.
//
// ⟨D6(a)⟩ / R19 / R38 — DOS METODOS SEPARADOS, y esa separacion es el contrato, no un detalle
// de implementacion. El catalogo declara `cod_recaudado` con granos fecha × tienda ×
// metodo_pago, y ese cubo NO EXISTE en las fuentes permitidas:
//   - el metodo de pago solo vive en `cierre_dia.total_efectivo / total_simpe /
//     total_transferencia` (`db/schema.prisma:864-866`), y un cierre es de un MENSAJERO
//     (`:860`), no de una tienda;
//   - el ledger de tienda no tiene columna de metodo (`:1129-1150`).
// Cruzarlos exigiria bajar a `orden`/`gestion_orden`, que es justo lo que esta feature tiene
// prohibido. Asi que se sirven dos PROYECCIONES legales con ids distintos, y no suman entre
// si: una es lo que el mensajero entrego, la otra lo acreditado a tiendas, y un mismo cierre
// puede contener ordenes de varias tiendas. Un metodo unico que devolviera "la cifra" es
// exactamente la mutacion que R19 declara: el doble del dinero real.
//
// LA CONSULTA ENTRA ENTERA (R7) y no se usa `consulta.alcance` (R9): financiera concedida ⇒
// alcance global. SOLO CONSULTAS (R30): la suma con signo y el formateo del DTO son del
// servicio.

/** Los tres cubos de metodo que el snapshot del cierre sabe distinguir. */
export type MetodoPagoCierre = "efectivo" | "simpe" | "transferencia";

/**
 * Σ de uno de los tres `total_*` sobre los cierres del rango. STRING escala 2 (S1/R27).
 *
 * OJO con el vocabulario: la columna real es `total_simpe` y el catalogo escribe "SINPE" en
 * la descripcion. Aqui manda la columna; la etiqueta de presentacion es problema de la 132/134
 * (pregunta abierta 3 del spec).
 */
export interface TotalPorMetodoCierre {
  readonly metodo: MetodoPagoCierre;
  readonly suma: string;
}

/**
 * Σ `monto` del ledger de tienda agrupada por `(tienda_id, tipo)`. El desglose por `tipo`
 * existe para el `neto` con signo de ⟨D1⟩/R37; el `tiendaId` es el cubo de la vista.
 */
export interface AgregadoTiendaLedger {
  readonly tiendaId: string;
  readonly tipo: WalletTiendaMovimientoTipo;
  readonly suma: string;
}

export interface IRecaudoAnaliticaRepository {
  /**
   * Vista `cod_recaudado__por_metodo`: Σ de `total_efectivo`, `total_simpe` y
   * `total_transferencia` sobre los `cierre_dia` **aprobados** cuyo `resuelto_at` cae en
   * `[rango.desde, rango.hasta)` ⟨D2(b)⟩ R26.
   *
   * Los cierres `solicitado`, `vencido` y `rechazado` NO aportan importe (R25): su dinero
   * todavia no existe, y contarlo aqui lo haria aparecer dos veces el dia que se aprueben.
   * Esos cierres se ven —con su estado y su conteo— en `conciliacion_cierres`, y solo ahi.
   */
  porMetodoDeCierresResueltos(consulta: ConsultaAnalitica): Promise<readonly TotalPorMetodoCierre[]>;

  /**
   * Vista `cod_recaudado__por_tienda`: Σ `monto` de `wallet_tienda_movimiento` con categoria
   * `cod_recaudado` y `fecha_movimiento ∈ [rango.desde, rango.hasta)`, agrupada por tienda.
   *
   * La categoria sale del catalogo (`consulta.metrica.definicion.categorias`), no de un
   * literal escrito aqui (R17). Orden estable por `tienda_id` (R28).
   */
  porTiendaDeLedger(consulta: ConsultaAnalitica): Promise<readonly AgregadoTiendaLedger[]>;
}
