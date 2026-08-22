import type { GestionResultado, PrismaClient } from "@prisma/client";
import type {
  DatosEntregaOrden,
  IWebhookOrdenReader,
} from "@/lib/interfaces/repositories/IWebhookOrdenReader";
import type { CausaIncidente } from "@/lib/types/causa-incidente";

// Feature 99 (design §7) — lectura minima de la orden + catalogo de estado para la entrega.
// Solo queries. Separado de `OrdenRepository` para no arrastrar su superficie al handler.

// Feature 256 (R8): `gestion_orden.resultado` de una DEVOLUCION. Mismo molde que
// `RESULTADO_DEVUELTA` de `OrdenRepository.ts:318` y `DevolucionSlaRepository.ts:14`; la
// vigencia se filtra aparte, por `anuladaAt: null` (criterio de la feature 67).
const RESULTADO_DEVUELTA: GestionResultado = "devuelta";

// ⏳ 2026-08-22 (feature 268, R20): `gestion_orden.resultado` de un INCIDENTE del MENSAJERO
// (arista #44, familia `gestion`). Misma vigencia (`anuladaAt: null`) y mismo criterio de
// recencia que la devolucion: es el mismo problema con otro enum.
const RESULTADO_INCIDENTE: GestionResultado = "incidente";

// ⏳ 2026-08-22 (feature 268) — POR QUE UN SOLO BLOQUE `gestiones` CON `resultado: { in: [...] }`
// Y SIN `take: 1`, en vez de los dos bloques acotados que uno esperaria:
// Prisma NO permite proyectar la MISMA relacion dos veces en un `select` (no hay alias), asi que
// «la ultima `devuelta` vigente» y «el ultimo `incidente` vigente» no pueden pedirse como dos
// sub-lecturas con su propio `take: 1`. Y un `take: 1` compartido seria un BUG silencioso: un
// incidente posterior desplazaria a la devolucion vigente y 256/R10 se rompe. Las alternativas
// (un `take: 2` a ojo, o `distinct` sobre la relacion) o pierden filas o dependen de en que orden
// aplica Prisma `distinct` y `take` en una lectura anidada. Se elige la version explicita: la
// BASE sigue haciendo el filtrado por vigencia (`where`) y la ordenacion (`orderBy`) —que es lo
// que 256 protege con tests—, y el codigo solo ELIGE la primera fila de cada resultado, que ya
// viene ordenada. El conjunto leido esta acotado por el `where`: solo gestiones VIGENTES de dos
// resultados de una UNICA orden (en la practica 0-2 filas).
const RESULTADOS_CON_CAUSA: readonly GestionResultado[] = [
  RESULTADO_DEVUELTA,
  RESULTADO_INCIDENTE,
];

// Feature 256 (R12): la relacion anidada NO exige el delegate `gestionOrden`, asi que este
// `Pick` NO cambia y el reader sigue haciendo exactamente 2 llamadas a Prisma. Feature 268:
// `incidentesAdmin` es OTRA relacion anidada de la misma orden -> el `Pick` tampoco cambia.
type WebhookOrdenReaderPrismaClient = Pick<PrismaClient, "orden" | "orderStatus">;

/** Fila proyectada de la gestion de INCIDENTE del mensajero. */
interface GestionIncidente {
  createdAt: Date;
  causaIncidente: CausaIncidente | null;
}

/** Fila proyectada del incidente reportado por el ADMIN (`orden_incidente`). */
interface IncidenteAdmin {
  createdAt: Date;
  causa: CausaIncidente;
}

/**
 * ⏳ 2026-08-22 (feature 268, R20) — PRECEDENCIA entre las dos procedencias del incidente: gana
 * la mas reciente por `createdAt`, sin privilegiar ninguna de las dos fuentes.
 *
 * En la practica solo UNA de las dos existe por orden, porque las aristas de entrada a
 * `incidente` son DISJUNTAS: el mensajero llega por `gestion` desde `en_reparto` (#44) y el admin
 * por la familia `incidente` desde los cinco estados de bodega/recogida (#48-#52), y el admin no
 * crea gestion ninguna (design §7.3). La regla existe para el caso raro —una orden que pasa por
 * los dos caminos en su vida— y para no depender de esa suposicion.
 */
function causaIncidenteVigente(
  gestion: GestionIncidente | undefined,
  admin: IncidenteAdmin | undefined,
): CausaIncidente | null {
  if (gestion === undefined) return admin?.causa ?? null;
  if (admin === undefined) return gestion.causaIncidente;
  return admin.createdAt.getTime() > gestion.createdAt.getTime()
    ? admin.causa
    : gestion.causaIncidente;
}

export class WebhookOrdenReader implements IWebhookOrdenReader {
  constructor(private readonly prisma: WebhookOrdenReaderPrismaClient) {}

  async findDatosEntrega(
    ordenId: string,
    estatusDestinoId: string,
  ): Promise<DatosEntregaOrden | null> {
    const orden = await this.prisma.orden.findUnique({
      where: { id: ordenId },
      select: {
        tiendaId: true,
        numGuia: true,
        numRemision: true,
        deletedAt: true,
        // Feature 256 (R8/R9/R10/R11/R12) + feature 268 (R20): las causas VIGENTES se resuelven
        // DENTRO de esta misma lectura, como relaciones anidadas colgadas de la orden pedida — no
        // hay consulta nueva ni consulta libre a `gestion_orden`. Molde de
        // `DevolucionSlaRepository.ts:71-77`: `orderBy` sobre el `@@index([ordenId])`.
        gestiones: {
          where: { resultado: { in: [...RESULTADOS_CON_CAUSA] }, anuladaAt: null },
          orderBy: { createdAt: "desc" },
          // `resultado` se proyecta porque el bloque es compartido (ver el comentario de
          // RESULTADOS_CON_CAUSA); `createdAt`, para la precedencia entre procedencias. El TEXTO
          // LIBRE `gestion_orden.motivo` sigue SIN proyectarse: no se emite jamas (256/R22).
          select: {
            resultado: true,
            createdAt: true,
            causaDevolucion: true,
            causaIncidente: true,
          },
        },
        // Feature 268 (R20, design §7.3): la SEGUNDA procedencia del incidente. El ADMIN no crea
        // gestion; crea `orden_incidente` con la causa en el MISMO enum. Sin filtro por `estado`
        // a proposito: el flujo de aprobacion/indemnizacion del incidente (158) es ORTOGONAL al
        // estado de la orden, y el evento describe la transicion a `incidente`, no el desenlace
        // administrativo del reporte.
        incidentesAdmin: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { causa: true, createdAt: true },
        },
      },
    });
    // R22: orden inexistente -> `null` -> el handler completa sin entregar.
    if (!orden) return null;

    // El `value` del estatus DESTINO del evento (el que viaja en el payload), no el estatus
    // actual de la orden: el cuerpo describe la transicion que disparo el webhook.
    const estatus = await this.prisma.orderStatus.findUnique({
      where: { id: estatusDestinoId },
      select: { value: true },
    });

    // Primera fila de cada resultado = la mas reciente, porque la BASE ya ordeno por
    // `createdAt desc` y ya excluyo las anuladas.
    const gestionDevuelta = orden.gestiones.find((g) => g.resultado === RESULTADO_DEVUELTA);
    const gestionIncidente = orden.gestiones.find((g) => g.resultado === RESULTADO_INCIDENTE);

    return {
      tiendaId: orden.tiendaId,
      numGuia: orden.numGuia,
      numRemision: orden.numRemision,
      deletedAt: orden.deletedAt,
      estado: estatus?.value ?? null,
      // R4/R5: los dos caminos del `null` (sin gestion vigente / gestion sin causa registrada)
      // colapsan a proposito en el mismo valor; el contrato publico no los distingue.
      causaDevolucion: gestionDevuelta?.causaDevolucion ?? null,
      // 268/R20: la causa del incidente, de cualquiera de las dos procedencias. El repositorio
      // responde SIEMPRE «cual es la causa vigente»; que se publique o no es POLITICA de
      // contrato y vive en `WebhookEstadoService` (criterio heredado de la 256).
      causaIncidente: causaIncidenteVigente(gestionIncidente, orden.incidentesAdmin[0]),
    };
  }
}
