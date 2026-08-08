import type { PrismaClient } from "@prisma/client";
import type { CausaIncidente } from "@/lib/types/causa-incidente";
import type { CierreEstado } from "@/lib/types/cierre";
import type { PaginaRepositorio, RangoPagina } from "@/lib/utils/rango-pagina";

// Feature 158 (T1.26/T1.27, camino del ADMIN) — contrato del repositorio de `orden_incidente`.
// Solo queries Prisma; sin logica de negocio (rol, R51 y la derivacion del destino de la
// reversion viven en `IncidenteAdminService`). El ALCANCE por zona SIEMPRE va en el WHERE
// (R48), nunca filtrado en memoria. Money-safe: los Decimal salen ya serializados a STRING.

/**
 * Alcance del actor sobre los incidentes. `zonaId === null` = acceso total (maestro/admin, sin
 * restriccion); un `zonaId` = `adminSatelite` acotado a la zona de la ORDEN (no a la suya
 * declarada en el input: la resuelve el service server-side, patron `CierresAdminService`).
 */
export interface AlcanceIncidente {
  zonaId: string | null;
}

/** Una evidencia a persistir junto al incidente (ya subida al bucket privado). */
export interface EvidenciaIncidenteInput {
  storagePath: string;
  contentType: string;
  indice: number; // 0-based; 0 = portada
}

/**
 * R41/R44 — datos del reporte. Los ids del catalogo de estados llegan YA RESUELTOS por el
 * service (`findEstatusIdByValue`): el repo no re-resuelve catalogo, igual que
 * `LiberacionSinGestionarConfig` (109) o `DevolucionRechazadasConfig` (139).
 */
export interface ReportarIncidenteRepoInput {
  ordenId: string;
  causa: CausaIncidente;
  motivo: string;
  reportadoPor: string;
  /** Los CINCO estados de origen admitidos (R41), como GUARDIA del `updateMany`. */
  origenEstatusIds: readonly string[];
  /** Destino `incidente`. */
  incidenteEstatusId: string;
  /** 1..N (R46). El repo NO valida el minimo: eso es el borde. */
  evidencias: readonly EvidenciaIncidenteInput[];
  /** R48: `null` = acceso total; un id = la orden DEBE ser de esa zona. */
  alcance: AlcanceIncidente;
}

/**
 * `ok` = reportado; `no_aplicable` = la orden no existe, esta borrada, no esta en uno de los
 * cinco estados o esta fuera del alcance (R42/R48: no se distinguen, no se revela nada);
 * `duplicado` = ya hay un incidente VIVO sobre esa orden (R47, lo decide el indice unico
 * parcial de la base, no una comprobacion previa).
 */
export type ReportarIncidenteRepoResult =
  | { status: "ok"; incidenteId: string }
  | { status: "no_aplicable" }
  | { status: "duplicado" };

/**
 * R52/R54/R57 — resolucion del incidente. `reversion` va SOLO cuando el incidente se cierra sin
 * pagar (rechazo o retracto): trae el par (origen, destino) ya derivado y VALIDADO por el
 * service contra el conjunto cerrado de los 5 origenes. Al APROBAR no hay reversion: la orden
 * se queda en `incidente`, que es su estado terminal.
 */
export interface ResolverIncidenteRepoInput {
  incidenteId: string;
  alcance: AlcanceIncidente;
  nuevoEstado: Extract<CierreEstado, "aprobado" | "rechazado">;
  resueltoPor: string;
  /** STRING money-safe -> `Prisma.Decimal` en la impl. Presente SOLO al aprobar (R52). */
  monto: string | null;
  /** Presente SOLO al rechazar con motivo de aprobador; `null` en el retracto del autor (R59). */
  motivoRechazo: string | null;
  /** Presente SOLO cuando la orden vuelve a su origen (rechazo/retracto, R57). */
  reversion?: {
    ordenId: string;
    incidenteEstatusId: string; // estado ACTUAL de la orden (guardia del updateMany)
    destinoEstatusId: string; // derivado del historial y validado (R58)
  };
}

/**
 * `updated` = aplicado; `conflict` = el incidente existe en el alcance pero ya NO esta
 * `solicitado` (R53: reintentar una aprobacion no emite un segundo movimiento) o la orden se
 * movio bajo los pies; `fuera_de_alcance` = no existe o es de otra zona (R48).
 */
export type ResolverIncidenteRepoResult = "updated" | "conflict" | "fuera_de_alcance";

/**
 * Fila cruda de un incidente en el alcance. Montos ya como STRING (money-safe) y marcas de
 * tiempo en ISO. `evidenciaStoragePaths` son paths CRUDOS del bucket privado: el service los
 * firma antes de que salgan de ahi (R46), nunca viajan asi al cliente.
 */
export interface IncidenteAdminRow {
  incidenteId: string;
  ordenId: string;
  numGuia: number | null;
  numRemision: string;
  destinatario: string;
  zonaId: string;
  zonaNombre: string;
  /** Estado ACTUAL de la orden (`incidente` mientras el reporte siga vivo). */
  estatusValue: string;
  causa: CausaIncidente;
  motivo: string;
  estado: CierreEstado;
  indemnizacion: string | null; // STRING 2 dec; null hasta aprobar (R50)
  /**
   * Fix «tope de negocio de la indemnizacion» (2026-08-04) — `orden.monto_cobrar` de la orden
   * incidentada: el TOPE DE NEGOCIO del monto que el aprobador puede capturar (R50).
   *
   * Vive en la FILA DEL REPO y NO en `IncidenteAdminDTO`: es un dato para DECIDIR en el
   * servidor, no para pintar. Money-safe: STRING escala 2; `null` = la orden no declara valor
   * a cobrar (que hace el tope con ese caso lo decide `lib/utils/tope-indemnizacion.ts`).
   */
  ordenMontoCobrar: string | null;
  reportadoPor: string;
  reportadoPorNombre: string;
  resueltoPor: string | null;
  resueltoPorNombre: string | null;
  resueltoAt: string | null; // ISO
  motivoRechazo: string | null;
  createdAt: string; // ISO
  evidenciaStoragePaths: string[];
}

/** Cliente Prisma acotado a lo que este repo necesita (patron `CierresAdminRepository`). */
export type IncidenteAdminPrismaClient = Pick<
  PrismaClient,
  "ordenIncidente" | "orden" | "$transaction"
>;

export interface IIncidenteAdminRepository {
  /**
   * R41-R44/R47 — reporte ATOMICO: transiciona la orden (guardada por los 5 estados de origen,
   * `deletedAt: null` y el alcance), crea el incidente en `solicitado`, inserta sus N evidencias
   * y appendea la transicion por el CHOKE POINT con `origen_tipo = incidente`. Todo en UNA
   * transaccion: si algo falla, NADA queda persistido (R42).
   */
  reportar(input: ReportarIncidenteRepoInput): Promise<ReportarIncidenteRepoResult>;
  /**
   * R52-R54/R57 — resolucion ATOMICA guardada por `estado = 'solicitado'` + alcance. Al APROBAR
   * escribe el monto y emite EN LA MISMA TX el egreso `egreso_indemnizacion` con
   * `origen_tipo = orden_incidente`; al RECHAZAR/RETRACTAR devuelve la orden a su estado de
   * origen por el choke point, sin escribir monto y sin emitir nada (R54).
   */
  resolver(input: ResolverIncidenteRepoInput): Promise<ResolverIncidenteRepoResult>;
  /**
   * R49 — los incidentes del alcance, mas reciente primero. El service los parte en las dos
   * colas (`solicitado` vs. resueltos), igual que `CierresAdminService`.
   */
  findByAlcance(alcance: AlcanceIncidente): Promise<IncidenteAdminRow[]>;
  /**
   * Feature 170 — FASE 2 (T I.1, R40/R41/R44/R51/R54): UNA PAGINA del HISTORICO del alcance
   * (los incidentes ya resueltos) + el TOTAL del conjunto.
   *
   * Es `findByAlcance` con dos anadidos: `estado NOT IN <cola>` —el espejo del `else` con que
   * el servicio parte hoy las dos colas (R44)— y el recorte `skip`/`take`. Mismo alcance por
   * zona de la ORDEN y mismo `orderBy createdAt desc` (R51). El `count` comparte el `where`
   * con la pagina: es la unica consulta que R54 permite anadir y no puede contar otra cosa.
   */
  findHistoricoPaginado(
    alcance: AlcanceIncidente,
    rango: RangoPagina,
  ): Promise<PaginaRepositorio<IncidenteAdminRow>>;
  /**
   * Feature 170 — FASE 2 (T J.1, R40/R41/R44/R51/R54): UNA PAGINA de la COLA de incidentes
   * PENDIENTES de decision del alcance + el TOTAL del conjunto (el de la cabecera, R42).
   *
   * COMPLEMENTO EXACTO de `findHistoricoPaginado`: mismo alcance por zona de la ORDEN, mismo
   * orden y la MISMA constante de estados, con `in` en vez de `notIn`.
   */
  findColaPaginada(
    alcance: AlcanceIncidente,
    rango: RangoPagina,
  ): Promise<PaginaRepositorio<IncidenteAdminRow>>;
  /**
   * Feature 184 — Tanda F (T F.1, R1/R14/R15/R16): el HISTORICO ENTERO del alcance, sin recorte
   * y sin conteo — el conjunto del que sale el ARCHIVO del listado 9.
   *
   * Existe porque `findByAlcance` NO es este conjunto: es este conjunto MAS la cola de la misma
   * pantalla, y producir el archivo con ella lo dejaba saliendo de un listado compuesto (R1).
   * Mismo `where` y mismo `orderBy` que `findHistoricoPaginado`, de una sola declaracion cada
   * uno: la pagina N tiene que ser el segmento N de este conjunto (R5).
   */
  findHistoricoCompleto(alcance: AlcanceIncidente): Promise<IncidenteAdminRow[]>;
  /**
   * Feature 184 — Tanda F (T F.1, R1/R14/R15/R16): la COLA ENTERA de pendientes de decision del
   * alcance, sin recorte y sin conteo — el conjunto del ARCHIVO del listado 8.
   *
   * COMPLEMENTO EXACTO del de arriba (misma constante de estados, `in` en vez de `notIn`), y
   * donde mas se nota: la cola es la mitad pequeña, asi que su archivo arrastraba todo el
   * historico del alcance, que crece sin tope con los dias.
   */
  findColaCompleta(alcance: AlcanceIncidente): Promise<IncidenteAdminRow[]>;
  /** R48/R49 — un incidente SOLO si su orden casa el alcance en el WHERE; si no, `null`. */
  findByIdEnAlcance(
    incidenteId: string,
    alcance: AlcanceIncidente,
  ): Promise<IncidenteAdminRow | null>;
}
