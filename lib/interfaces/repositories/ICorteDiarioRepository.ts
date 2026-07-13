// Feature 41 — contrato del repositorio del corte diario. Solo queries Prisma; sin
// logica de negocio (esa vive en CorteDiarioService). Identifica a los mensajeros que
// "debian cerrar y no solicitaron" (R7/R10) para que el service les cree un `vencido`.

// Mensajero con actividad del dia sin cerrar. `zonaId` puede ser null (usuario sin zona
// asignada): el service lo OMITE con log (P2), no puede derivar la bodega responsable.
export interface MensajeroSinCierreRow {
  mensajeroId: string;
  zonaId: string | null;
}

export interface ICorteDiarioRepository {
  /**
   * R7/R10: mensajeros con al menos una `gestion_orden` con `cierre_id IS NULL`
   * (actividad del dia sin cerrar) y SIN un cierre `cierre_dia` en estado
   * `solicitado` pendiente (el solicitado ya cumple la obligatoriedad, R10). Devuelve
   * su `zonaId` (usuario.zona_id) para derivar el destino del vencido (R1). Solo query.
   */
  findMensajerosConActividadSinCierre(): Promise<MensajeroSinCierreRow[]>;
}
