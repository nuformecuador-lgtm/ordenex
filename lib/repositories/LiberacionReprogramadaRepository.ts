import { type PrismaClient } from "@prisma/client";
import type {
  ILiberacionReprogramadaRepository,
  LiberadaHoyFilter,
  LiberadaHoyRow,
  LiberarOrdenInput,
  OrdenLiberableRow,
} from "@/lib/interfaces/repositories/ILiberacionReprogramadaRepository";
import { appendCambioEstado } from "@/lib/repositories/registrar-cambio-estado";

// Estatus de ORIGEN de la liberacion (una orden reprogramada) y `resultado` de la
// gestion que fija la fecha de reprogramacion (feature 36). Valores de catalogo ya
// sembrados; esta feature NO agrega estados.
const ESTATUS_REPROGRAMADA = "reprogramada";
const RESULTADO_REPROGRAMADA = "reprogramada";

const UN_DIA_MS = 24 * 60 * 60 * 1000;

// Feature 49/#10: `$transaction` para que el UPDATE guardado y el append del historial
// compartan tx (R7). El `tx` del callback expone `ordenHistorialEstado` (choke point).
type LiberacionPrismaClient = Pick<PrismaClient, "orden" | "$transaction">;

/**
 * Feature 46 — repositorio de la liberacion programada. SOLO queries Prisma (sin logica
 * de negocio: quien va a `en_bodega`/`en_bodega_satelite` y los conteos los decide el
 * service). Reutiliza `orden` + `gestion_orden`; no introduce tablas nuevas.
 */
export class LiberacionReprogramadaRepository implements ILiberacionReprogramadaRepository {
  constructor(private readonly prisma: LiberacionPrismaClient) {}

  /**
   * R10/R11: ordenes `reprogramada` + no borradas, con su gestion `reprogramada` mas
   * reciente (orderBy createdAt desc, take 1). Filtra en memoria las que tienen esa
   * fecha vigente `<= hoyCR` (las futuras siguen bloqueadas). `fecha_reprogramacion` es
   * `@db.Date` a medianoche UTC; `hoyCR` viene en la misma convencion (util fecha-cr).
   */
  async findOrdenesLiberables(hoyCR: Date): Promise<OrdenLiberableRow[]> {
    const rows = await this.prisma.orden.findMany({
      where: {
        deletedAt: null, // R10
        estatus: { value: ESTATUS_REPROGRAMADA }, // R10
      },
      select: {
        id: true,
        zonaId: true,
        gestiones: {
          // gestion vigente = la mas reciente. Feature 67 (design §3-#6): `anuladaAt: null`
          // por DEFENSA, sin cambio funcional — una orden en `reprogramada` no puede tener su
          // ultima gestion `reprogramada` anulada (deshacerla la devuelve a `en_reparto`, con
          // lo que ya no casa el filtro de estado de arriba). Explicito > implicito.
          where: { resultado: RESULTADO_REPROGRAMADA, anuladaAt: null },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { fechaReprogramacion: true },
        },
      },
    });

    const liberables: OrdenLiberableRow[] = [];
    for (const r of rows) {
      const fecha = r.gestiones[0]?.fechaReprogramacion ?? null;
      // R11: sin fecha vigente o fecha futura -> permanece bloqueada.
      if (fecha === null || fecha.getTime() > hoyCR.getTime()) continue;
      liberables.push({ id: r.id, zonaId: r.zonaId, fechaReprogramacion: fecha });
    }
    return liberables;
  }

  /**
   * R13/R17: UPDATE guardado por `estatusId = reprogramada` + no borrada. Si la orden ya
   * salio de `reprogramada` (segunda corrida / carrera) afecta 0 filas -> devuelve false
   * (idempotencia derivada del estado). NO toca `num_guia`.
   */
  async liberarOrden(input: LiberarOrdenInput): Promise<boolean> {
    // Feature 49/#10 (R7/R8/R18/R21): UPDATE guardado + append en la MISMA tx. El actor es
    // NULL (la origina el cron/sistema, no una persona) y `origenTipo` = liberacion_reprogramada;
    // origen = `reprogramada` (fijado por la guarda), destino = en_bodega/en_bodega_satelite.
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.orden.updateMany({
        where: {
          id: input.ordenId,
          estatusId: input.estatusReprogramadaId, // R17: guarda de idempotencia/carrera
          deletedAt: null,
        },
        data: {
          estatusId: input.destinoEstatusId, // R12 (destino ya resuelto por el service)
          mensajeroAsignadoId: null, // R13: handoff limpio a la bodega
          asignadoAt: null, // feature 76/LC1 (C3): limpia el timestamp de asignacion (defensivo)
          liberadaReprogramadaAt: input.corridaAt, // R13: marca de auditoria/aviso
        },
      });
      // R8: SOLO si libero (count 1); una segunda corrida idempotente (count 0) no duplica.
      if (result.count > 0) {
        await appendCambioEstado(tx, [
          {
            ordenId: input.ordenId,
            estatusOrigenId: input.estatusReprogramadaId, // R18: origen reprogramada
            estatusDestinoId: input.destinoEstatusId,
            actorUsuarioId: null, // R21: sistema/cron
            origenTipo: "liberacion_reprogramada", // R23
          },
        ]);
      }
      return result.count > 0;
    });
  }

  /**
   * R15/R16: ordenes liberadas HOY (CR) de una bodega. `liberada_reprogramada_at` cae en
   * el dia de `hoyCR` (`[hoyCR, hoyCR + 24h)`; la corrida marca ~06:00Z = 00:00 CR, mismo
   * dia UTC que `hoyCR`) + estatus destino de la bodega + su zona. Excluye borradas.
   */
  async findLiberadasHoy(filter: LiberadaHoyFilter, hoyCR: Date): Promise<LiberadaHoyRow[]> {
    const start = hoyCR;
    const end = new Date(hoyCR.getTime() + UN_DIA_MS);
    const rows = await this.prisma.orden.findMany({
      where: {
        zonaId: filter.zonaId,
        deletedAt: null,
        estatus: { value: filter.estatusValue },
        liberadaReprogramadaAt: { gte: start, lt: end },
      },
      select: {
        id: true,
        numGuia: true,
        numRemision: true,
        destinatario: true,
        liberadaReprogramadaAt: true,
      },
      orderBy: { liberadaReprogramadaAt: "desc" },
    });
    return rows.map((r) => ({
      id: r.id,
      numGuia: r.numGuia,
      numRemision: r.numRemision,
      destinatario: r.destinatario,
      liberadaReprogramadaAt: r.liberadaReprogramadaAt as Date,
    }));
  }
}
