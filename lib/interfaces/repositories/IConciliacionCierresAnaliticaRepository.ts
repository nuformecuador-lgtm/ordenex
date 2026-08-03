import type { ConsultaAnalitica } from "@/lib/analytics/consulta";
import type { ClaveTotalCierre, FilaConciliacion } from "@/lib/types/analitica-financiera";

// Feature 127 (T A.2) — contrato del repositorio de la CONCILIACION DE CIERRES.
//
// Contesta dos preguntas distintas con dos consultas distintas, y las mantiene separadas
// porque fundirlas es la mutacion que R22 declara:
//
//  1. ¿Cuantos cierres hay en cada estado y cuanto dinero declaran sus snapshots? — por
//     estado y **por nivel** (`cierre_dia` y `cierre_bodega` POR SEPARADO). Un `cierre_bodega`
//     consolida varios `cierre_dia`: sumar los dos niveles cuenta el mismo dinero dos veces.
//  2. ¿Coincide lo que los cierres aprobados declararon con lo que los ledgers registraron?
//     — comparando contra los movimientos con `origen_tipo = cierre_dia` y `origen_id` de
//     **esos** cierres, nunca contra la Σ de todos los movimientos del rango (R23): un ajuste
//     manual dentro de la ventana declararia un descuadre que no existe.
//
// ⟨D2(b)⟩ + ⟨D4(b)⟩ / R25 / R26 / R39 — DOBLE COORDENADA TEMPORAL, DECLARADA POR FILA. Los
// cierres `aprobado` se fechan por `resuelto_at` (el mismo instante en que el feed escribe en
// los ledgers, asi que las dos caras de la conciliacion miran el mismo dia y un descuadre deja
// de poder ser un artefacto de fechado). Los `solicitado`, `vencido` y `rechazado` NO TIENEN
// `resuelto_at`: se fechan por `solicitado_at`, quedan fuera de toda cifra de dinero y
// aparecen aqui —y solo aqui— con su estado. Clavar `fechadoPor` a un valor unico le atribuye
// a una fila una coordenada que su cierre no puede tener.
//
// LA CONSULTA ENTRA ENTERA (R7); no se usa `consulta.alcance` (R9). SOLO CONSULTAS (R30): el
// cuadre, el umbral y la emision por el `ErrorLogger` son del servicio. R14: de un cierre sale
// su `id`, nunca su `mensajero_id`.

/**
 * Un grupo del `groupBy(estado)` sobre uno de los dos niveles de cierre, con sus totales
 * snapshot ya en STRING escala 2 y la coordenada temporal con la que se selecciono.
 *
 * Reutiliza `FilaConciliacion` del contrato de salida a proposito: el repositorio produce
 * exactamente la forma que el DTO publica, sin que el servicio tenga que reetiquetar nada. Si
 * el DTO gana un campo derivado, esta herencia deja de valer y hay que partirlas.
 */
export type GrupoCierrePorEstado = FilaConciliacion;

/** `total_general` snapshot de UN cierre aprobado del rango. STRING escala 2 (S1/R27). */
export interface SnapshotCierreAprobado {
  readonly cierreId: string;
  readonly totalGeneral: string;
}

/** Los tres libros que pueden llevar movimientos con origen en un cierre. */
export type LedgerConciliable =
  | "wallet_movimiento"
  | "wallet_tienda_movimiento"
  | "pago_mensajero_movimiento";

/**
 * Σ `monto` registrada en un ledger con origen en UN cierre concreto.
 *
 * Llega desglosada por libro y por cierre, sin fundir: contra que libro se concilia el
 * `total_general` snapshot es una decision del servicio, no del repositorio, y desglosada se
 * puede tomar; fundida, ya no.
 */
export interface TotalLedgerPorOrigenCierre {
  readonly ledger: LedgerConciliable;
  readonly cierreId: string;
  readonly suma: string;
}

export interface IConciliacionCierresAnaliticaRepository {
  /**
   * Conteo y `total_*` snapshot por `(nivel, estado)`, con la doble coordenada temporal
   * ⟨D2/D4⟩. Cubre los CUATRO estados de `CierreEstado` en los DOS niveles; los grupos sin
   * filas simplemente no aparecen. Orden estable por `(nivel, estado)` (R28).
   */
  contarCierresPorEstado(consulta: ConsultaAnalitica): Promise<readonly GrupoCierrePorEstado[]>;

  /**
   * Los `cierre_dia` **aprobados** cuyo `resuelto_at` cae en `[rango.desde, rango.hasta)`, con
   * su `total_general`. Es el lado SNAPSHOT del cuadre y la fuente de los `origen_id` que
   * alimentan el otro lado. Orden estable por `cierreId` (R28).
   */
  totalesDeCierresAprobados(consulta: ConsultaAnalitica): Promise<readonly SnapshotCierreAprobado[]>;

  /**
   * El lado LEDGER del cuadre: Σ `monto` de los movimientos con `origen_tipo = cierre_dia` y
   * `origen_id ∈ cierreIds`, desglosada por libro y por cierre.
   *
   * `cierreIds` NO es un filtro del cliente: sale de `totalesDeCierresAprobados`, que ya se
   * resolvio con la misma `ConsultaAnalitica`. Se pasa aparte porque es el resultado de la
   * consulta anterior, no una dimension de la peticion. Con la lista vacia devuelve `[]` y no
   * consulta (R10 en espiritu: sin ids que buscar no hay nada que preguntarle a la base).
   * Orden estable por `(ledger, cierreId)` (R28).
   */
  sumarLedgerPorOrigenDeCierre(
    consulta: ConsultaAnalitica,
    cierreIds: readonly string[],
  ): Promise<readonly TotalLedgerPorOrigenCierre[]>;
}

/** Las cuatro claves de total snapshot, reexportadas para quien implemente el repositorio. */
export type { ClaveTotalCierre };
