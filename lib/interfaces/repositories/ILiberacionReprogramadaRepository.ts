// Feature 46 (R10/R12/R13/R15/R17) — contrato del repositorio de la liberacion
// programada de ordenes reprogramadas. SOLO queries Prisma (sin logica de negocio: el
// destino por zona y los conteos los decide el service). Reutiliza `orden` +
// `gestion_orden` (feature 36); no introduce tablas.

// Fila candidata a liberar: id + zona (para derivar la bodega responsable) + la
// `fecha_reprogramacion` vigente (la de la gestion `reprogramada` mas reciente).
//
// FEATURE 276 (T6.1, R12/R14): la fila crece con TRES HECHOS de esa MISMA gestion vigente. Son
// HECHOS, no decisiones: el repositorio los trae y el SERVICIO decide con ellos
// (`docs/architecture.md`). Los tres son dos de las seis condiciones del predicado de intentos
// (`whereIntentosVigentes`) aplicadas a UNA sola gestion, y su combinacion responde la unica
// pregunta que importa: **esta gestion, todavia puede subir el contador de la orden?**
export interface OrdenLiberableRow {
  id: string;
  zonaId: string;
  fechaReprogramacion: Date;
  /**
   * FEATURE 276 (R12) — el cierre al que pertenece la gestion `reprogramada` vigente. `null` = la
   * gestion todavia no entro en ningun cierre (el mensajero no ha cerrado el dia), asi que AUN
   * puede entrar en uno y sumar +1 cuando ese cierre se apruebe.
   */
  gestionCierreId: string | null;
  /**
   * FEATURE 276 (R12/R15) — estado de ese cierre. Solo `"aprobado"` cierra la puerta del contador:
   * `solicitado`, `vencido` y `rechazado` siguen pudiendo llegar a `aprobado` (los dos ultimos por
   * `forzarSolicitudVencido`, que reabre `vencido` y `rechazado`). `null` cuando no hay cierre.
   */
  gestionCierreEstado: string | null;
  /**
   * FEATURE 276 (R12/R14) — la gestion nace de una VISITA REAL? Es decir: alguna de sus filas de
   * `orden_historial_estado` pertenece a `ORIGEN_TIPOS_VISITA_REAL`?
   *
   * `false` para las gestiones SINTETICAS —en particular la `reprogramacion_tienda` de la feature
   * 100, la reprogramacion de escritorio— que NO cuentan como intento y que por tanto NO tienen
   * que esperar a ningun cierre (R14): hacerlas esperar seria pagar latencia (mediana medida 8,2 h,
   * p90 22,1 h) por un invariante que en esa via ya se cumple.
   */
  gestionEsVisitaReal: boolean;
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
   * Feature 160 (R11/R14/R16/R27) + 215 (R6/R20): intentos de entrega de la orden, resueltos en
   * UN solo lote para todo el aviso con el criterio UNICO de `OrdenHistorialService`. Desde la
   * 215 ese criterio es el numero de CIERRES APROBADOS distintos en los que la orden tuvo un
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
   *
   * FEATURE 276 (T6.1): devuelve ADEMAS los tres hechos de esa misma gestion (cierre, estado del
   * cierre y si nace de una visita real). NO decide nada con ellos: el filtro por fecha, el
   * `orderBy` y el `take: 1` se conservan intactos, y quien aplica la regla es el servicio.
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
