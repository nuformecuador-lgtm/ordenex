// Feature 99 (design §7) — lectura MINIMA que el handler de entrega necesita de la orden y
// del catalogo de estado. Repo de solo-lectura, separado de `IOrdenRepository` (que es
// enorme): el handler solo necesita resolver el destino y el cuerpo de entrega.
import type { CausaDevolucion } from "@/lib/types/causa-devolucion";

/** Datos para construir el cuerpo de entrega (D3). `estado` es el `value` del destino. */
export interface DatosEntregaOrden {
  /** Owner de la orden = destino del webhook (R24): SIEMPRE se deriva de aqui, no del payload. */
  tiendaId: string;
  numGuia: number | null;
  numRemision: string;
  /** Soft-delete: si no es null, la orden esta borrada -> el job se completa sin entregar (R22). */
  deletedAt: Date | null;
  /** `value` del estatus destino del evento; `null` si el id no resuelve en el catalogo. */
  estado: string | null;
  /**
   * Feature 256 (R1-R5) — causa TIPIFICADA de la devolucion VIGENTE de la orden (gestion con
   * `resultado = 'devuelta'` y `anulada_at IS NULL`, la mas reciente por `created_at`, R8-R10).
   *
   * DOS ORIGENES distintos del `null`, que colapsan a proposito en el mismo valor porque el
   * contrato publico NO distingue «no hubo» de «no se registro» (R4/R5):
   *  1. la orden NO tiene ninguna gestion `devuelta` vigente (nunca la tuvo, o esta anulada);
   *  2. la tiene, pero SIN causa registrada: historico previo a la feature 73, cuyo backfill
   *     se decidio NO hacer (73/R16, `db/schema.prisma:816-822`).
   *
   * Value CRUDO del enum `GestionCausaDevolucion` (R2); la traduccion a etiqueta es cosa de la
   * UI. El tipo se importa de `lib/types/causa-devolucion.ts` —no de `@prisma/client`— para que
   * un cuarto valor del enum rompa el build en UN solo sitio (73, doble candado de exhaustividad).
   *
   * Campo REQUERIDO, no opcional: un `?` dejaria pasar en silencio a quien se olvide de
   * proyectarlo. Se llama `causaDevolucion` en el DTO interno A PROPOSITO; `motivo` es solo el
   * nombre de CABLE del contrato publico (design §2.3) y NO es `gestion_orden.motivo`, el texto
   * libre del mensajero, que no se emite jamas (R22).
   */
  causaDevolucion: CausaDevolucion | null;
}

export interface IWebhookOrdenReader {
  /**
   * R22/R24: datos de la orden `ordenId` y el `value` del `estatusDestinoId`. `null` si la
   * orden no existe. `deletedAt != null` indica orden borrada (el handler completa sin
   * entregar).
   */
  findDatosEntrega(ordenId: string, estatusDestinoId: string): Promise<DatosEntregaOrden | null>;
}
