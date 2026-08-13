// Feature 46 (R10/R12/R13/R15/R17) — contrato del repositorio de la liberacion
// programada de ordenes reprogramadas. SOLO queries Prisma (sin logica de negocio: el
// destino por zona y los conteos los decide el service). Reutiliza `orden` +
// `gestion_orden` (feature 36); no introduce tablas.

// Fila candidata a liberar: id + zona (para derivar la bodega responsable) + la
// `fecha_reprogramacion` vigente (la de la gestion `reprogramada` mas reciente).
export interface OrdenLiberableRow {
  id: string;
  zonaId: string;
  fechaReprogramacion: Date;
}

// Entrada del UPDATE guardado por orden (idempotente por estado de origen).
export interface LiberarOrdenInput {
  ordenId: string;
  // Estatus destino ya resuelto (en_bodega_central | en_bodega_satelite).
  destinoEstatusId: string;
  // Estatus de ORIGEN esperado (`reprogramada`): guarda de idempotencia/carrera.
  estatusReprogramadaId: string;
  // Instante unico de la corrida (marca de auditoria/aviso, R13).
  corridaAt: Date;
}

// Filtro del aviso derivado (R15/R16): bodega = zona + estatus destino de esa bodega.
export interface LiberadaHoyFilter {
  zonaId: string;
  estatusValue: string; // en_bodega_central (central) | en_bodega_satelite (satelite)
}

// Fila proyectada para el aviso "liberadas hoy" de la bodega (sin PII sensible extra).
export interface LiberadaHoyRow {
  id: string;
  numGuia: number | null;
  numRemision: string;
  destinatario: string;
  liberadaReprogramadaAt: Date;
  /**
   * Feature 160 (R11/R14/R16/R27) + 213 (R6/R20): intentos de entrega de la orden, resueltos en
   * UN solo lote para todo el aviso con el criterio UNICO de `OrdenHistorialService`. Desde la
   * 213 ese criterio es el numero de CIERRES APROBADOS distintos en los que la orden tuvo un
   * resultado de gestion vigente `rechazada`/`devuelta`/`reprogramada`; ya no se deriva de los
   * destinos de las transiciones del historial.
   *
   * NO lo emite el repositorio (esta fila es una proyeccion de `orden`): lo mergea el borde que
   * arma el aviso (`listarLiberadasHoy`), con `?? 0`. Opcional (`?`) por el patron aditivo del
   * repo: no rompe fixtures/mocks que construyen la fila sin el.
   */
  intentosEntrega?: number;
}

export interface ILiberacionReprogramadaRepository {
  /**
   * R10/R11: ordenes en estatus `reprogramada`, NO borradas, cuya gestion
   * `reprogramada` MAS RECIENTE tiene `fecha_reprogramacion <= hoyCR` (CR). Excluye las
   * de fecha futura (permanecen bloqueadas).
   */
  findOrdenesLiberables(hoyCR: Date): Promise<OrdenLiberableRow[]>;
  /**
   * R13/R17: transiciona UNA orden al destino, limpia `mensajero_asignado_id` y fija
   * `liberada_reprogramada_at = corridaAt`, con escritura GUARDADA por
   * `estatus_id = reprogramada` + no borrada (concurrencia/idempotencia: una segunda
   * corrida afecta 0 filas). Devuelve `true` si afecto una fila.
   */
  liberarOrden(input: LiberarOrdenInput): Promise<boolean>;
  /**
   * R15/R16: ordenes liberadas HOY (CR) de una bodega = `liberada_reprogramada_at` en el
   * dia de `hoyCR` + estatus destino + zona. Alimenta el aviso derivado (sin tabla de
   * notificaciones). NO incluye borradas.
   */
  findLiberadasHoy(filter: LiberadaHoyFilter, hoyCR: Date): Promise<LiberadaHoyRow[]>;
}
