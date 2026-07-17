import type {
  CausaDevueltaVigente,
  IOrdenRepository,
  NovedadOrdenRow,
} from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  INovedadesService,
  ListarNovedadesInput,
  ListarNovedadesServiceResult,
} from "@/lib/interfaces/services/INovedadesService";
import type { NovedadDTO } from "@/lib/types/novedad";

// R3/R5: el UNICO estatus que cuenta como "en devolucion" (F1.4, NO `devuelta_origen` ni
// `rechazada`). Constante del service (patron `OrdenHistorialService.ESTATUS_DEVUELTA`); el
// repo la recibe como parametro (no hardcodea el valor).
const ESTATUS_DEVUELTA = "devuelta";

// R5: unico rol autorizado (paridad con `RecepcionSateliteService.ROL_AUTORIZADO`).
const ROL_AUTORIZADO = "adminTienda";

// Metodos de repo que consume el service (inyeccion por constructor). `Pick` para dobles de
// test sin DB/HTTP (patron `RecepcionSateliteRepo`).
type NovedadesRepo = Pick<
  IOrdenRepository,
  "countDevueltasByTienda" | "findDevueltasByTienda" | "findCausasDevueltaVigentes"
>;

/**
 * Feature 87 (design §2.2) — logica de negocio de la lista de NOVEDADES: las ordenes en
 * `devuelta` de la tienda del adminTienda, con la causa de la ultima gestion `devuelta`
 * vigente. Solo lectura. No conoce HTTP ni Prisma; testeable con dobles sin red/DB.
 */
export class NovedadesService implements INovedadesService {
  constructor(private readonly repo: NovedadesRepo) {}

  async listar(
    input: ListarNovedadesInput,
    actor: Actor,
  ): Promise<ListarNovedadesServiceResult> {
    if (actor.rol !== ROL_AUTORIZADO) return { status: "forbidden" }; // R5

    const { page, pageSize } = input;

    // R2/R3/R4/R22: total de la tienda del actor (acota `tiendaId = actor.usuarioId` en el repo).
    const total = await this.repo.countDevueltasByTienda(actor.usuarioId, ESTATUS_DEVUELTA);

    // R1/R2/R3/R4/R22: la pagina de devueltas de la tienda, ordenada por Orden.createdAt desc
    // (fallback R21). `skip` derivado de la pagina (1-based).
    const skip = (page - 1) * pageSize;
    const rows = await this.repo.findDevueltasByTienda(actor.usuarioId, ESTATUS_DEVUELTA, {
      skip,
      take: pageSize,
    });
    if (rows.length === 0) {
      // R10 lo pinta el front; aqui solo se evita la consulta agregada innecesaria (R8).
      return { status: "ok", items: [], total, page, pageSize };
    }

    // R8: UNA sola consulta agregada para las causas de TODAS las ordenes de la pagina.
    const causas = await this.repo.findCausasDevueltaVigentes(rows.map((r) => r.id)); // R6/R7

    // R21 (estricto): reordena la PAGINA por la fecha de la ultima gestion `devuelta` vigente
    // desc, con la fecha ya traida por `findCausasDevueltaVigentes` (sin query extra). Las
    // ordenes sin gestion vigente caen a `Orden.createdAt` (fallback documentado). Copia antes
    // de ordenar para no mutar el arreglo del repo.
    const ordered = [...rows].sort(
      (a, b) => fechaEfectiva(b, causas).getTime() - fechaEfectiva(a, causas).getTime(),
    );

    // R6/R7/R9: mapea a NovedadDTO; causa = ultima gestion vigente, o null ("sin causa").
    const items: NovedadDTO[] = ordered.map((row) => ({
      id: row.id,
      numGuia: row.numGuia,
      destinatario: row.destinatario,
      telefonoDest: row.telefonoDest,
      causa: causas.get(row.id)?.causa ?? null,
    }));

    return { status: "ok", items, total, page, pageSize };
  }
}

// R21: fecha de recencia de una orden = fecha de su ultima gestion `devuelta` vigente si
// existe; si no (R7), `Orden.createdAt` como fallback documentado.
function fechaEfectiva(
  row: NovedadOrdenRow,
  causas: Map<string, CausaDevueltaVigente>,
): Date {
  return causas.get(row.id)?.fecha ?? row.createdAt;
}
