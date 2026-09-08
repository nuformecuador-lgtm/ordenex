import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  ITarifaZonaMensajeroRepository,
  PagoTarifa,
} from "@/lib/interfaces/repositories/ITarifaZonaMensajeroRepository";

// Solo el delegate de tarifa_zona_mensajero (Pick para dobles de test sin DB/red).
type TarifaZonaMensajeroPrismaClient = Pick<PrismaClient, "tarifaZonaMensajero">;

// Money-safe: Decimal -> string escala 2 (nunca number/parseFloat).
function toPagoTarifa(row: {
  cobroEntregado: Prisma.Decimal;
  cobroRechazado: Prisma.Decimal;
}): PagoTarifa {
  return {
    cobroEntregado: row.cobroEntregado.toFixed(2),
    cobroRechazado: row.cobroRechazado.toFixed(2),
  };
}

/**
 * FICHA 398 — SOLO el delegado de `tarifa_zona_mensajero`, para que quien no pueda instanciar este
 * repositorio REUSE la resolucion en vez de reescribirla. Mismo patron y mismo motivo que
 * `GestionOrdenGroupBy` en `OrdenHistorialRepository` (ficha 394).
 */
type TarifaZonaMensajeroDelegate = Pick<
  PrismaClient["tarifaZonaMensajero"],
  "findUnique" | "findFirst"
>;

/**
 * FICHA 398 — LA RESOLUCION DE LA TARIFA, extraida a funcion sobre el DELEGADO.
 *
 * ES EL CUERPO DE `TarifaZonaMensajeroRepository.resolvePagoTarifa`, no una segunda version: el
 * metodo delega aqui, asi que la tarifa que resuelve el snapshot al solicitar el cierre (39) y la
 * que resuelve la correccion de un resultado (398) son literalmente la misma.
 *
 * POR QUE HIZO FALTA: `CierresAdminRepository.corregirResultadoGestionEnCierre` necesita la tarifa
 * DENTRO de su transaccion —el `ingreso_bodega_rechazo` de la gestion corregida sale de ahi— y su
 * `Pick` del cliente no incluye este delegado; añadir una dependencia de constructor obligaria a
 * tocar los ~30 sitios que instancian ese repositorio. Lo que NO se hizo, a proposito: copiar el
 * `findUnique` + fallback alli. Dos resoluciones «iguales» divergen a la primera correccion, y
 * este numero es lo que se le paga a una persona por entregar y lo que la bodega gana por cada
 * rechazo.
 *
 * El contrato es el del metodo, palabra por palabra (39/R1/R2/R3/R8).
 */
export async function resolvePagoTarifaCon(
  delegado: TarifaZonaMensajeroDelegate,
  zonaId: string,
  vehiculoId: string | null,
): Promise<PagoTarifa | null> {
  // R1: con vehiculo, intenta la tarifa exacta (zona, vehiculo) via el unique compuesto.
  if (vehiculoId !== null) {
    const exacta = await delegado.findUnique({
      where: { zonaId_vehiculoId: { zonaId, vehiculoId } },
      select: { cobroEntregado: true, cobroRechazado: true },
    });
    if (exacta !== null) return toPagoTarifa(exacta); // R1
    // R2: sin tarifa especifica -> cae a la tarifa por defecto de la zona.
  }

  // R2/R3: tarifa por defecto de la zona (vehiculo_id IS NULL). El unique NULLS NOT
  // DISTINCT garantiza a lo sumo una; findFirst es determinista.
  const porDefecto = await delegado.findFirst({
    where: { zonaId, vehiculoId: null },
    select: { cobroEntregado: true, cobroRechazado: true },
  });
  return porDefecto !== null ? toPagoTarifa(porDefecto) : null; // R8: null si la zona no tiene tarifa
}

/**
 * Feature 39 — resolver de la tarifa de pago al mensajero. SOLO queries Prisma. Resuelve
 * (zona, vehiculo) con fallback a la tarifa por defecto de la zona (vehiculo_id IS NULL),
 * determinista por el indice unico (zona_id, vehiculo_id) NULLS NOT DISTINCT.
 */
export class TarifaZonaMensajeroRepository implements ITarifaZonaMensajeroRepository {
  constructor(private readonly prisma: TarifaZonaMensajeroPrismaClient) {}

  async resolvePagoTarifa(
    zonaId: string,
    vehiculoId: string | null,
  ): Promise<PagoTarifa | null> {
    // FICHA 398: el cuerpo vive en `resolvePagoTarifaCon` para poder reusarlo sin instanciar esta
    // clase. Delegar (y no duplicar) es lo que impide que existan dos resoluciones de la tarifa.
    return resolvePagoTarifaCon(this.prisma.tarifaZonaMensajero, zonaId, vehiculoId);
  }
}
