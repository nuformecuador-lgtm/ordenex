// Feature 99 (design §7) — lectura MINIMA que el handler de entrega necesita de la orden y
// del catalogo de estado. Repo de solo-lectura, separado de `IOrdenRepository` (que es
// enorme): el handler solo necesita resolver el destino y el cuerpo de entrega.

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
}

export interface IWebhookOrdenReader {
  /**
   * R22/R24: datos de la orden `ordenId` y el `value` del `estatusDestinoId`. `null` si la
   * orden no existe. `deletedAt != null` indica orden borrada (el handler completa sin
   * entregar).
   */
  findDatosEntrega(ordenId: string, estatusDestinoId: string): Promise<DatosEntregaOrden | null>;
}
