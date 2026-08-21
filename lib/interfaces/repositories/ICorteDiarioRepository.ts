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
   *
   * FEATURE 246 (T2.2, R11/R14/R16) — `diaCerrado` es OBLIGATORIO, y que lo sea es el mecanismo.
   *
   * Es la fecha calendario de Costa Rica de la JORNADA QUE ESTA CORRIDA CIERRA (convencion
   * `@db.Date`: medianoche UTC de esa fecha), calculada UNA vez por corrida en
   * `CorteDiarioService.ejecutarCorte`. La rama (b) deja fuera a los mensajeros cuyas unicas
   * ordenes estan RESERVADAS para un dia posterior a ese: no entran en el bucle, asi que no
   * reciben un `vencido` que —desde la 241— los bloquearia para gestionar y cobrar (R14).
   *
   * Sin default a proposito: un parametro opcional dejaria que olvidar cablearlo compilara y el
   * corte se quedara con un criterio silencioso. Con el obligatorio, el olvido rompe el
   * TYPECHECK. Mismo criterio y mismo precedente que `ayudaEstatusId` en la 235.
   */
  findMensajerosConActividadSinCierre(diaCerrado: Date): Promise<MensajeroSinCierreRow[]>;
}
