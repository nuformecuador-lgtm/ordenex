import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  IRechazosSlaTiendaService,
  ListarRechazosSlaTiendaInput,
  ListarRechazosSlaTiendaServiceResult,
} from "@/lib/interfaces/services/IRechazosSlaTiendaService";
import type { RechazoSlaTiendaDTO } from "@/lib/types/rechazo-sla-tienda";

// R13: unico rol autorizado (paridad con `NovedadesService.ROL_AUTORIZADO`). Un adminTienda ve
// SIEMPRE su propia tienda (`actor.usuarioId` ES el tiendaId, misma identidad que /novedades).
const ROL_AUTORIZADO = "adminTienda";

// Metodos de repo que consume el service (inyeccion por constructor). `Pick` para dobles de test
// sin DB/HTTP (patron `NovedadesService`).
type RechazosSlaTiendaRepo = Pick<
  IOrdenRepository,
  "countRechazadasSlaByTienda" | "findRechazadasSlaByTienda"
>;

/**
 * Feature 102 (design §5.2) — logica de negocio de la superficie de RECHAZOS POR SLA de la tienda:
 * las ordenes que el cron SLA (99) escalo de `devuelta` a `rechazada`, con su monto de 56, acotadas
 * a la tienda del adminTienda. SOLO LECTURA (R16): no mueve dinero ni muta nada. No conoce HTTP ni
 * Prisma; testeable con dobles sin red/DB. Patron `NovedadesService`.
 */
export class RechazosSlaTiendaService implements IRechazosSlaTiendaService {
  constructor(private readonly repo: RechazosSlaTiendaRepo) {}

  async listar(
    input: ListarRechazosSlaTiendaInput,
    actor: Actor,
  ): Promise<ListarRechazosSlaTiendaServiceResult> {
    if (actor.rol !== ROL_AUTORIZADO) return { status: "forbidden" }; // R13: cualquier otro rol

    const { page, pageSize } = input;

    // R12/R15: total de rechazos por SLA de la tienda del actor (predicado central en el repo;
    // mismo universo que la pagina). El acotamiento a la tienda va SIEMPRE por `actor.usuarioId`.
    const total = await this.repo.countRechazadasSlaByTienda(actor.usuarioId);

    // R12/R14/R15: la pagina, ordenada por `Orden.createdAt` desc. `skip` derivado de la pagina.
    const skip = (page - 1) * pageSize;
    const rows = await this.repo.findRechazadasSlaByTienda(actor.usuarioId, {
      skip,
      take: pageSize,
    });

    // R14: passthrough money-safe (el repo ya serializo el monto a STRING escala 2 / null).
    const items: RechazoSlaTiendaDTO[] = rows.map((row) => ({
      id: row.id,
      numGuia: row.numGuia,
      numRemision: row.numRemision,
      destinatario: row.destinatario,
      monto: row.monto,
    }));

    return { status: "ok", items, total, page, pageSize };
  }
}
