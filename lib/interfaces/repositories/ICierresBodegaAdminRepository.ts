import type { CierreTotales } from "@/lib/interfaces/services/ICierreDiaService";
import type { CierreGestionDescargaDTO } from "@/lib/interfaces/services/ICierresAdminService";
import type { FiltrosDescargaGestiones } from "@/lib/types/filtros-cierres";
import type { CierreBodegaResumenRow } from "@/lib/interfaces/repositories/ICierreBodegaRepository";
import type { CierreGestionPendienteRow } from "@/lib/interfaces/repositories/ICierreDiaRepository";
import type { PaginaRepositorio, RangoPagina } from "@/lib/utils/rango-pagina";
import type { FiltrosCierresBodega } from "@/lib/types/filtros-cierres";

// Feature 40 — contrato del repositorio de "Cierres de bodega" del maestro (aprobar /
// rechazar). Solo queries Prisma; sin logica de negocio (esa vive en
// CierresBodegaAdminService). El maestro NO se acota por zona (todo va a la central).
// Money-safe: los Decimal se devuelven ya serializados a STRING. Reusa
// CierreGestionPendienteRow + WITH_DETALLE/toPendienteRow de la feature 37 para el
// detalle de gestiones.

// Cabecera de un cierre_dia incluido en un cierre de bodega (para el detalle): el
// mensajero + totales snapshot (STRING). El detalle deriva de sus gestiones.
export interface CierreBodegaDetalleCierreRow {
  cierreDiaId: string;
  mensajeroId: string;
  mensajeroNombre: string;
  totales: CierreTotales; // snapshot del cierre_dia (STRING escala 2)
  totalPagoMensajero: string; // feature 39/R20: snapshot del pago al mensajero del cierre_dia (STRING)
  totalIngresoBodegaRechazos: string; // feature 56/R19: snapshot del ingreso de bodega por rechazos del cierre_dia (STRING)
}

// Datos de la transicion guardada (aprobar/rechazar) de un cierre de bodega.
// `motivoRechazo` = null al aprobar; el motivo (ya validado) al rechazar.
export interface ResolverCierreBodegaInput {
  id: string;
  nuevoEstado: "aprobado" | "rechazado";
  resueltoPor: string;
  motivoRechazo: string | null;
}

// Resultado de la transicion guardada: `updated` (aplicada), `conflict` (existe pero
// ya no esta `solicitado`, R18), `fuera_de_alcance` (no existe, R19).
export type ResolverCierreBodegaResult = "updated" | "conflict" | "fuera_de_alcance";

export interface ICierresBodegaAdminRepository {
  /**
   * R15: todos los cierres de bodega, join a zona/usuario para nombres +
   * _count.cierresDia, orderBy solicitadoAt desc. Totales snapshot -> STRING. Sin
   * filtro de zona (el maestro es global).
   */
  findCierresBodega(): Promise<CierreBodegaResumenRow[]>;
  /**
   * Feature 184 — Tanda E (T E.1, R1/R14/R15/R16): el HISTORICO ENTERO (cierres de bodega ya
   * RESUELTOS), sin recorte. Es el conjunto del que sale el archivo del listado 5.
   *
   * NO es `findCierresBodega`: aquel devuelve la UNION de la cola y el historico, que es
   * justamente el listado compuesto que R1 prohibe releer para producir un archivo. Es
   * `findHistoricoPaginado` sin `skip`/`take` y sin el `count`, con el MISMO `where` y el MISMO
   * `orderBy` por construccion (R16), de modo que la pagina N es el segmento N de este conjunto
   * (R5). UNA sola consulta (R15).
   */
  /**
   * Pedido humano del 2026-08-16 — `filtros` es OPCIONAL (fecha + zona, SIN mensajero: un cierre
   * de bodega consolida los de varios) y RECORTA dentro del alcance, componiendose con `AND` y
   * nunca en lugar de el. Omitirlo deja el criterio IDENTICO al de antes.
   */
  findHistoricoCompleto(filtros?: FiltrosCierresBodega): Promise<CierreBodegaResumenRow[]>;
  /**
   * Feature 184 — Tanda E (T E.1, R1/R14/R15/R16): la COLA ENTERA de cierres de bodega
   * PENDIENTES (`solicitado`), sin recorte. Es el conjunto del que sale el archivo del listado 4.
   *
   * COMPLEMENTO EXACTO del de arriba, con la MISMA constante de estados (`in` aqui, `notIn`
   * alli): los dos conjuntos particionan la tabla igual que las dos paginas.
   */
  findColaCompleta(filtros?: FiltrosCierresBodega): Promise<CierreBodegaResumenRow[]>;
  /**
   * Feature 170 — FASE 2 (T I.1, R40/R41/R44/R51/R54): UNA PAGINA del historico (los cierres
   * de bodega ya RESUELTOS) + el TOTAL del conjunto.
   *
   * Es `findCierresBodega` con dos anadidos: `estado NOT IN <cola>` —el espejo del `else`
   * con que el servicio parte hoy las dos listas (R44)— y el recorte `skip`/`take`. Mismo
   * `orderBy solicitadoAt desc` (R51) y mismas proyecciones. Pagina y total en la MISMA
   * llamada: el `count` es la unica consulta que R54 permite anadir.
   */
  findHistoricoPaginado(
    rango: RangoPagina,
    filtros?: FiltrosCierresBodega,
  ): Promise<PaginaRepositorio<CierreBodegaResumenRow>>;
  /**
   * Feature 170 — FASE 2 (T J.1, R40/R41/R44/R51/R54): UNA PAGINA de la COLA de cierres de
   * bodega PENDIENTES (`solicitado`) + el TOTAL del conjunto, que es el que la cabecera de la
   * pantalla mostrara (R42).
   *
   * COMPLEMENTO EXACTO de `findHistoricoPaginado`: misma proyeccion, mismo orden y la MISMA
   * constante de estados, con `in` en vez de `notIn`.
   */
  findColaPaginada(
    rango: RangoPagina,
    filtros?: FiltrosCierresBodega,
  ): Promise<PaginaRepositorio<CierreBodegaResumenRow>>;
  /**
   * R11: el cierre de bodega (cabecera + totales snapshot) + por cada cierre_dia
   * incluido (WHERE cierre_bodega_id=id) su cabecera y sus gestiones (WITH_DETALLE,
   * reuso 37, WHERE cierre_id=cierre_dia.id). `null` si el cierre de bodega no existe
   * (R19).
   */
  findCierreBodegaConDetalle(id: string): Promise<{
    cierre: CierreBodegaResumenRow;
    cierresDia: {
      resumen: CierreBodegaDetalleCierreRow;
      gestiones: CierreGestionPendienteRow[];
    }[];
  } | null>;
  /**
   * Feature 230 — Tanda 7 (T7.1, R11/R24/R26/R41): TODAS las gestiones de los cierres del dia YA
   * CONSOLIDADOS en un cierre de bodega que casan los recortes del dialogo, a grano de GESTION.
   *
   * `cierre_bodega_id IS NOT NULL` en el WHERE es la traduccion exacta de R24. Sin alcance por
   * zona: este listado es de acceso total y el guard de rol vive en el servicio (R25).
   *
   * MISMA proyeccion, MISMO orden y MISMO compositor que el camino de «cierres del dia» (R26):
   * las dos salidas tienen que producir la misma fila o el mismo mensajero saldria distinto
   * segun desde donde se descargue.
   */
  findGestionesDeCierresBodegaCompleto(
    filtros: FiltrosDescargaGestiones,
  ): Promise<CierreGestionDescargaDTO[]>;
  /**
   * R16-R22: transicion atomica y guardada de `solicitado` -> nuevoEstado, SOLO si el
   * cierre de bodega sigue `solicitado` (updateMany con guardia de estado). Un solo
   * UPDATE de estado + auditoria; NO toca cierre_dia ni otra tabla (R21/R22).
   * Distingue updated/conflict/fuera_de_alcance.
   */
  resolverCierreBodega(input: ResolverCierreBodegaInput): Promise<ResolverCierreBodegaResult>;
}
