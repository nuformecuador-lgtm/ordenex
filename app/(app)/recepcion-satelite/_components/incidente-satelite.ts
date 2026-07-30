import { esEstadoReportable } from "@/app/(app)/ordenes/_components/incidente-origenes";

/**
 * Forma mínima que necesita la regla: la cumple `RecepcionSateliteDTO` por estructura.
 * Se declara aquí para no atar el predicado al DTO completo del módulo.
 */
export interface OrdenReportableSatelite {
  estatusValue: string;
  /** Zona de la ORDEN (la que decide el alcance, R48), no la del actor. */
  zonaNombre: string;
}

/**
 * Feature 158 (T2.7, decisión del humano del 2026-07-30) — ¿ofrece la bodega satélite la
 * acción «Reportar incidente» sobre ESTA orden?
 *
 * Tres condiciones, y las tres fallan CERRADO:
 *
 * 1. **Alcance**: un `adminSatelite` sin zona no tiene alcance sobre nada (el service le
 *    responde `forbidden`, R48). Sin zona no se ofrece la acción sobre ninguna orden.
 * 2. **Zona de la ORDEN**: sólo se ofrece sobre las de su zona. El servidor ya acota la
 *    lectura por `zonaId` y **ésa es la guardia real**; aquí se compara lo único que el
 *    cliente tiene —el nombre de zona que viaja en el DTO— para que la UI no ofrezca una
 *    acción que la transacción negaría si por cualquier vía llegara una orden ajena. Es el
 *    mismo criterio con el que R51 apaga la decisión de un incidente propio: el servidor
 *    manda, la UI no invita.
 * 3. **Estado**: uno de los cinco orígenes del conjunto cerrado (R41), derivados del mapa
 *    de la 140 en `incidente-origenes.ts` y no tecleados aquí.
 *
 * En esta superficie sólo dos de los cinco están presentes de verdad (`en_bodega_satelite` y
 * `por_recoger`); los de la central no aparecen, y el predicado los rechazaría igual si
 * apareciesen porque la zona no casaría.
 */
export function puedeReportarIncidenteSatelite(
  orden: OrdenReportableSatelite,
  zonaActor: string | null,
  sinZona: boolean,
): boolean {
  if (sinZona || zonaActor === null) return false;
  if (orden.zonaNombre !== zonaActor) return false;
  return esEstadoReportable(orden.estatusValue);
}
