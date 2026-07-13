// Feature 42 (design §2.1, F1.4-Q1) — contrato del resolver de la TARIFA VIGENTE por
// zona, usado al alimentar la caja desde un cierre aprobado. Solo query Prisma (sin
// logica de negocio: el mapeo resultado->conceptos vive en el util puro
// lib/utils/ingreso-ordenex.ts). Money-safe: montos y porcentajes se devuelven ya
// serializados a STRING (el util los reconvierte a Prisma.Decimal para operar).

// Tarifa vigente de una zona (feature 18/54, tabla `tarifas`). MONTOS: valorFlete[Gam],
// valorFleteDevuelto[Gam]. PORCENTAJES (0..100): comisionCod, ivaFlete, ivaComisionCod.
export interface TarifaVigentePorZona {
  valorFlete: string; // MONTO -> STRING 2 dec
  valorFleteGam: string; // MONTO (variante central/GAM)
  valorFleteDevuelto: string; // MONTO
  valorFleteDevueltoGam: string; // MONTO (variante central/GAM)
  comisionCod: string; // PORCENTAJE 0..100
  ivaFlete: string; // PORCENTAJE 0..100
  ivaComisionCod: string; // PORCENTAJE 0..100
}

export interface ITarifaVigentePorZonaRepository {
  /**
   * Resuelve la tarifa vigente (NO borrada, `deletedAt IS NULL`) de una zona.
   * - `null` si la zona no tiene ninguna tarifa capturada/vigente (gap de datos, R9).
   * - SUPUESTO documentado: si la zona tiene varias tarifas no borradas, se elige la mas
   *   reciente (`orderBy createdAt desc`, first). La 18 es un CRUD multi-fila con `nombre`;
   *   no existe hoy un flag de "vigente" unica -> "la ultima capturada" es la resolucion
   *   determinista adoptada por la 42 (F1.4-Q1).
   */
  resolveTarifaPorZona(zonaId: string): Promise<TarifaVigentePorZona | null>;
}
