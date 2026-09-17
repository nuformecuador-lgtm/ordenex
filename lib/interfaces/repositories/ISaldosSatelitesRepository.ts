import type { PaginaRepositorio, RangoPagina } from "@/lib/utils/rango-pagina";
import type {
  ConsolidacionSateliteDTO,
  ResumenSatelitesDTO,
  SaldoSateliteDTO,
} from "@/lib/types/conciliacion-satelites";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 431 — EL SALDO SIN CONCILIAR DE LAS BODEGAS SATELITE. SOLO LECTURAS.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// ⚠️ ESTE REPOSITORIO NO ESCRIBE NADA, Y ES DELIBERADO. Las dos escrituras de la marca viven en
// `CierresBodegaAdminRepository`, que es donde ya viven TODAS las escrituras de `cierre_bodega`.
// Un segundo escritor de la misma tabla es como aparecen dos guardas que divergen.
//
// ⚠️ EL SALDO ES DERIVADO, NO ALMACENADO (R19). No hay columna ni tabla de saldo: se calcula en
// cada lectura a partir de `cierre_bodega`. Si las diferencias resultan ser el pan de cada dia, el
// ledger propio se anade despues SIN rehacer las pantallas, porque el DTO ya distingue total,
// recibido y diferencia.
//
// ⚠️ LA FORMULA, UNA SOLA VEZ Y SOBRE EFECTIVO (decision del humano sobre Q2, 2026-09-16):
//
//     saldoSinConciliar(zona) = Σ ( total_efectivo − COALESCE(monto_recibido, 0) )
//                               sobre `cierre_bodega` de esa zona con estado <> 'rechazado'
//
// Una sola expresion cubre los tres casos sin un `if` que los separe: sin marcar aporta su
// efectivo integro; marcada completa aporta 0; marcada por menos aporta LA DIFERENCIA (R18, el
// caso de los ₡485.000 de ₡500.000). Los `rechazado` quedan fuera porque el estado esta retirado
// de la pantalla (D2) y en produccion hay CERO; queda declarado como limite.
//
// Money-safe: la resta se hace con `Prisma.Decimal` dentro del repositorio y sale como `.toFixed(2)`.
// Ni `Number`, ni `parseFloat`, ni aritmetica en el navegador (R20).

export interface ISaldosSatelitesRepository {
  /**
   * R17/R21/R23 — UNA PAGINA de la tabla de saldos + el total del conjunto.
   *
   * El conjunto son las bodegas SATELITE (`zona.esCentral = false`), TODAS, tengan o no
   * consolidaciones: una bodega a cero es informacion («no debe nada»), no una fila que sobra.
   */
  findSaldosPaginado(rango: RangoPagina): Promise<PaginaRepositorio<SaldoSateliteDTO>>;
  /**
   * R29 — el MISMO conjunto sin recorte, para la descarga. Mismo criterio y mismo orden que la
   * pagina por construccion: la pagina N es el segmento N de este conjunto.
   */
  findSaldosCompleto(): Promise<SaldoSateliteDTO[]>;
  /**
   * R22/R24 — UNA PAGINA de las consolidaciones de UNA bodega + el total.
   *
   * `soloSinConciliar` recorta a la cola de lo pendiente; ausente o `false` devuelve las dos
   * poblaciones. Las `rechazado` NUNCA entran (D2: el estado se retira de la pantalla).
   */
  findConsolidacionesPaginado(
    zonaId: string,
    rango: RangoPagina,
    soloSinConciliar?: boolean,
  ): Promise<PaginaRepositorio<ConsolidacionSateliteDTO>>;
  /** R29 — el mismo conjunto de la bodega sin recorte, para la descarga. */
  findConsolidacionesCompleto(
    zonaId: string,
    soloSinConciliar?: boolean,
  ): Promise<ConsolidacionSateliteDTO[]>;
  /**
   * ⭑ R20/R23 — las TRES cifras de cabecera de `/wallet/satelites`, ya cuadradas.
   *
   * Existe porque la pantalla NO PUEDE sumarlas (R20: nada de aritmetica de dinero en el
   * navegador) y las tres son sumas sobre el conjunto entero de bodegas. Es la MISMA formula
   * (`saldoDe`) aplicada a tres poblaciones distintas, no tres reglas nuevas.
   */
  findResumen(ahora?: Date): Promise<ResumenSatelitesDTO>;
}
