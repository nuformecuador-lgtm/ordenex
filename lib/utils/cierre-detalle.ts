import type { Prisma, PrismaClient } from "@prisma/client";
import type { TarifaVigente } from "@/lib/interfaces/repositories/ITarifaVigentePorTiendaRepository";

/**
 * Feature 69 (design §4.1/§4.2) — lectura COMPARTIDA del snapshot `cierre_detail` por los dos
 * feeds de wallet (42 caja principal y 43 ledger por tienda).
 *
 * Vive aqui, y no duplicado en cada feed, porque los dos derivan de EXACTAMENTE las mismas
 * entradas congeladas: si un dia divergieran, la caja y el ledger de la tienda liquidarian
 * distinto el mismo cierre y el descuadre seria invisible.
 *
 * Es solo lectura + proyeccion: la FORMULA sigue viviendo en `ingreso-ordenex.ts` (R21, sin
 * cambios). Aqui no se calcula dinero, se recuerda.
 */

// Cliente de tx que necesitan los feeds tras la 69: el snapshot + las gestiones (que aportan
// el `resultado`/`montoRecibido`, que son de la GESTION, no de la orden). `orden`, `zona` y
// `tarifas` YA NO se consultan al aprobar (R12/R13): ese era el bug.
export type CierreDetalleTxClient = Pick<PrismaClient, "cierreDetail" | "gestionOrden">;

// Proyeccion del snapshot: las entradas de la formula + la tarifa congelada.
export const DETALLE_SELECT = {
  ordenId: true,
  montoCobrar: true,
  cobraComision: true,
  esCentral: true,
  tiendaId: true,
  tarifaId: true,
  tarifaValorFlete: true,
  tarifaValorFleteGam: true,
  tarifaValorFleteDevuelto: true,
  tarifaValorFleteDevueltoGam: true,
  tarifaComisionCod: true,
  tarifaIvaFlete: true,
  tarifaIvaComisionCod: true,
} as const;

export type CierreDetalleRow = Prisma.CierreDetailGetPayload<{ select: typeof DETALLE_SELECT }>;

/**
 * Feature 69/R14 — falta la fila de detalle congelado de una orden del cierre.
 *
 * Es un error DURO a proposito (decision (a)): NO hay fallback a datos vivos. El backfill de
 * la migracion (R26/R27) garantiza que todo cierre existente tiene su detalle, asi que esto
 * no deberia ocurrir; si ocurre, preferimos una aprobacion ABORTADA Y VISIBLE a un descuadre
 * silencioso en un libro append-only. Un fallback dejaria vivo para siempre el camino de
 * lectura que esta feature vino a matar, y ningun test podria demostrar que no se toma.
 */
export class CierreDetalleFaltanteError extends Error {
  constructor(
    readonly cierreId: string,
    readonly ordenId: string,
  ) {
    super(
      `cierre_detail: falta el detalle congelado de la orden ${ordenId} en el cierre ${cierreId}. ` +
        `La aprobacion se aborta: sin snapshot no se puede liquidar sin arriesgar un descuadre (feature 69/R14).`,
    );
    this.name = "CierreDetalleFaltanteError";
  }
}

/**
 * Reconstruye la `TarifaVigente` (los 7 campos que consume la formula) desde la fila
 * congelada. `null` si `tarifa_id IS NULL`: la tienda no tenia tarifa vigente al SOLICITAR
 * (gap R9, decision (c)) -> `derivarIngresoOrden` ya lo maneja devolviendo conceptos 0.00 sin
 * lanzar (`ingreso-ordenex.ts:58`). El gap se PRESERVA tal cual: la 69 no lo abre ni lo cierra.
 * Money-safe: Decimal -> STRING escala 2, nunca number/parseFloat (R11).
 */
export function tarifaDe(d: CierreDetalleRow): TarifaVigente | null {
  if (d.tarifaId === null) return null;
  // Las 8 columnas de tarifa se congelan todas o ninguna (R8), asi que con `tarifa_id`
  // presente el resto no puede ser null. El `?? "0"` no es una politica: es el estrechamiento
  // del tipo (Decimal | null) sin introducir un fallback silencioso.
  return {
    valorFlete: (d.tarifaValorFlete ?? "0").toString(),
    valorFleteGam: (d.tarifaValorFleteGam ?? "0").toString(),
    valorFleteDevuelto: (d.tarifaValorFleteDevuelto ?? "0").toString(),
    valorFleteDevueltoGam: (d.tarifaValorFleteDevueltoGam ?? "0").toString(),
    comisionCod: (d.tarifaComisionCod ?? "0").toString(),
    ivaFlete: (d.tarifaIvaFlete ?? "0").toString(),
    ivaComisionCod: (d.tarifaIvaComisionCod ?? "0").toString(),
  };
}

/**
 * Lee el snapshot del cierre indexado por `ordenId`. Los feeds lo cruzan en memoria con las
 * gestiones: el GRANO se respeta — `cierre_detail` aporta lo de la ORDEN y `gestion_orden` el
 * `resultado` (que es de la GESTION). Una orden con 2 gestiones vigentes en el cierre aporta
 * 2 entradas que COMPARTEN la misma fila congelada; eso es justo lo que hace correcto el
 * grano ORDEN (design §4.1).
 */
export async function leerDetallePorOrden(
  cierreId: string,
  tx: CierreDetalleTxClient,
): Promise<Map<string, CierreDetalleRow>> {
  const filas = await tx.cierreDetail.findMany({
    where: { cierreId },
    select: DETALLE_SELECT,
  });
  return new Map(filas.map((d) => [d.ordenId, d]));
}

/** R14: la fila del detalle de esa orden, o error duro (sin fallback a datos vivos). */
export function detalleDe(
  byOrden: Map<string, CierreDetalleRow>,
  cierreId: string,
  ordenId: string,
): CierreDetalleRow {
  const d = byOrden.get(ordenId);
  if (d === undefined) throw new CierreDetalleFaltanteError(cierreId, ordenId);
  return d;
}
