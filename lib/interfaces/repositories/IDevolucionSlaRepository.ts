import type { GestionCausaDevolucion } from "@prisma/client";

// Feature 99 (design §3.4, R5/R15/R16/R17/R18/R19/R20-R25) — contrato del repositorio del cron
// SLA de devoluciones diferidas. SOLO queries Prisma (sin logica de negocio: la ventana, el
// ruteo a bodega y la decision reintento/escalado los decide `DevolucionSlaService`). Reutiliza
// `orden` + `gestion_orden`; no introduce tablas ni RLS nueva.

/**
 * Feature 99/R5 — candidata del cron: una orden en `devuelta` (no borrada) con el ANCLAJE de su
 * ventana SLA DERIVADO de su ULTIMA gestion `devuelta` VIGENTE (`anulada_at IS NULL`): su
 * `causa` (`causa_devolucion`) y su `ancladaAt` (`created_at`). Sin columna `devuelta_at` (Q2).
 * `mensajeroId` = el de esa gestion `devuelta` vigente, al que se atribuye el ingreso de bodega
 * si la orden escala (R22). `causa` null = dato anterior a la feature 73 o anomalia -> el
 * service la omite sin adivinar ventana (R28).
 */
export interface DevueltaSlaRow {
  ordenId: string;
  zonaId: string;
  mensajeroId: string;
  causa: GestionCausaDevolucion | null;
  ancladaAt: Date;
}

// Entrada del reintento (R15): destino de bodega ya resuelto por el service, y el estatus de
// ORIGEN esperado (`devuelta`) como guarda de idempotencia/concurrencia (R24/R25).
export interface LiberarDevueltaSlaInput {
  ordenId: string;
  destinoEstatusId: string; // en_bodega | en_bodega_satelite (resuelto por el service)
  estatusDevueltaId: string; // guarda: solo actua si la orden sigue en `devuelta`
}

// Entrada del escalado (R16/R17) — Option A del dinero (design §3.4).
export interface EscalarDevueltaSlaInput {
  ordenId: string;
  estatusDevueltaId: string; // guarda de idempotencia/concurrencia (R21/R24/R25)
  estatusRechazadaId: string;
  mensajeroId: string; // R22: mensajero de la gestion `devuelta` vigente -> ingreso de bodega
  motivo: string; // motivo de la gestion sintetica ("escalado SLA <causa>")
}

export interface IDevolucionSlaRepository {
  /**
   * R5: ordenes en `devuelta`, NO borradas, con su ULTIMA gestion `devuelta` VIGENTE
   * (`orderBy createdAt desc`, `take 1`, `anulada_at IS NULL`). Deriva `causa` + `ancladaAt` +
   * `mensajeroId` de esa gestion. Filtra en memoria las que NO tienen gestion vigente (patron
   * `findOrdenesLiberables`). Las que si la tienen pero con `causa` null SI se devuelven (el
   * service las omite, R28).
   */
  findDevueltasSla(): Promise<DevueltaSlaRow[]>;
  /**
   * R15/R18/R19/R24/R25: transiciona UNA orden de `devuelta` al destino de bodega y limpia el
   * mensajero, con escritura GUARDADA por `estatus_id = devuelta` + no borrada. El append al
   * historial (`origen_tipo = liberacion_devuelta_sla`, actor NULL) va DENTRO del `if(count>0)`
   * de la MISMA tx. Devuelve `true` si afecto una fila; `false` si ya salio de `devuelta`.
   */
  liberarDevueltaSla(input: LiberarDevueltaSlaInput): Promise<boolean>;
  /**
   * R16/R17/R18/R19/R20-R25 (Option A): transiciona UNA orden de `devuelta` a `rechazada`
   * (guardada por `estatus_id = devuelta`; NO toca el mensajero, paridad con un rechazo
   * directo) y, SOLO si afecto una fila, crea en la MISMA tx una gestion sintetica
   * `resultado = rechazada` (`cierre_id NULL`, del `mensajeroId`) para que el ingreso de bodega
   * lo cobre el snapshot de la 56 sin codigo monetario nuevo; el append
   * (`origen_tipo = escalado_devuelta_sla`, actor NULL) enlaza esa gestion. Reejecucion ->
   * count 0 -> no crea 2.ª gestion (R21). Devuelve `true` si escalo; `false` si ya salio.
   */
  escalarDevueltaSla(input: EscalarDevueltaSlaInput): Promise<boolean>;
}
