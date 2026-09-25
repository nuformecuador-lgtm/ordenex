import type { CierreDestinoTipo, CierreEstado } from "@/lib/types/cierre";

// FICHA 462 (T1.3, design §2.2) — contrato del repositorio de las REPROGRAMADAS RETENIDAS.
//
// SOLO LECTURAS, y es un requisito (R8): el conteo no cambia estado, mensajero, fecha, cierre,
// historial ni dinero, y no encola nada. Una guardia lo afirma sobre el fuente sin comentarios
// (`tests/unit/guards/reprogramadas-retenidas-solo-lectura.guardia.test.ts`).
//
// El repositorio trae HECHOS; quien decide «esta retenida» y «a quien se atribuye» es el servicio
// (`ReprogramadasRetenidasService`). La Forma A NO vive aqui: se reusa
// `ILiberacionReprogramadaRepository.findOrdenesLiberables` + `puedeLiberarse` (276), sin predicado
// paralelo.

/**
 * Forma B (design §1.2): una orden `en_reparto` cuya gestion PENDIENTE de confirmar mas reciente es
 * un `reprogramado` con `fecha_reprogramacion <= hoyCR`. Una fila por orden, por construccion: la
 * LATERAL de `gestion-pendiente.ts` toma UNA gestion por orden.
 */
export interface RetenidaEnRepartoRow {
  ordenId: string;
  zonaId: string;
  mensajeroAsignadoId: string | null;
  gestionId: string;
  /** `null` = la gestion todavia no entro en ningun cierre (grupo «sin cierre enviado», R5). */
  cierreId: string | null;
}

/**
 * Lo MINIMO de un cierre para ATRIBUIR y ACOTAR una retenida: su estado (un `aprobado` no retiene)
 * y su destino PERSISTIDOS (el eje del alcance, `CierresAdminService.resolveAlcance`). Sin
 * relaciones: es lo unico que la CIFRA (`contar`, campana y push) necesita saber de un cierre.
 *
 * 462/H2 (2026-09-25): existe para que el sondeo de la campana no cargue nombres de mensajero ni
 * fechas de gestiones que no va a mostrar (medido: 10 -> 7 consultas por sondeo).
 */
export interface DestinoDeCierre {
  cierreId: string;
  estado: CierreEstado;
  destinoTipo: CierreDestinoTipo;
  destinoZonaId: string;
}

/**
 * Lo que la LISTA (franja, marca) necesita de UN cierre que retiene: lo de `DestinoDeCierre` mas su
 * mensajero con nombre (para la franja) y las fechas con las que `derivarJornada` (271) resuelve la
 * jornada EN LOTE, sin consulta por fila.
 */
export interface CierreParaRetenidas extends DestinoDeCierre {
  mensajeroId: string;
  mensajeroNombre: string;
  createdAt: Date;
  /** `created_at` de sus gestiones NO anuladas (insumo de `derivarJornada`, fuente A). */
  gestionesCreatedAt: readonly Date[];
}

export interface IReprogramadaRetenidaRepository {
  /**
   * Forma B (§1.2). UNA consulta (`$queryRaw`) que COMPONE `sqlUltimaGestionPendienteLateral` del
   * modulo unico de la 454; el predicado de «pendiente» no se reescribe aqui. `hoyCR` entra en la
   * convencion `@db.Date` (`startOfDayCR(now)`): «de hoy» incluye las vencidas de dias anteriores.
   */
  findRetenidasEnReparto(hoyCR: Date): Promise<RetenidaEnRepartoRow[]>;
  /**
   * Los cierres pedidos, con estado, destino, mensajero y las fechas de sus gestiones. UNA consulta
   * para todos los ids (nunca una por cierre). Con `[]` devuelve `[]` sin consultar.
   */
  findCierresQueRetienen(cierreIds: readonly string[]): Promise<CierreParaRetenidas[]>;
  /**
   * Los MISMOS cierres, pero solo estado y destino (sin mensajero ni gestiones): UNA consulta sin
   * relaciones, para la cifra de `contar`. Con `[]` devuelve `[]` sin consultar. Tiene que devolver
   * exactamente los ids que `findCierresQueRetienen` devolveria (misma tabla, mismo `where`).
   */
  findDestinoDeCierres(cierreIds: readonly string[]): Promise<DestinoDeCierre[]>;
  /**
   * Nombres de los mensajeros del grupo «sin cierre enviado». UNA consulta para todos los ids. Con
   * `[]` devuelve `[]` sin consultar.
   */
  findMensajeros(ids: readonly string[]): Promise<Array<{ id: string; nombre: string }>>;
}
