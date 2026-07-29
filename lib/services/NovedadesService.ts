import type {
  CausaDevueltaVigente,
  IOrdenRepository,
  NovedadOrdenRow,
} from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IOrdenHistorialService } from "@/lib/interfaces/services/IOrdenHistorialService";
import type {
  INovedadesService,
  ListarNovedadesInput,
  ListarNovedadesServiceResult,
} from "@/lib/interfaces/services/INovedadesService";
import type { NovedadDTO } from "@/lib/types/novedad";

// R11: unico rol autorizado (paridad con `RecepcionSateliteService.ROL_AUTORIZADO`).
const ROL_AUTORIZADO = "adminTienda";

// Metodos de repo que consume el service (inyeccion por constructor). `Pick` para dobles de
// test sin DB/HTTP (patron `RecepcionSateliteRepo`).
type NovedadesRepo = Pick<
  IOrdenRepository,
  "countDevueltasByTienda" | "findDevueltasByTienda" | "findCausasDevueltaVigentes"
>;

/**
 * Feature 87/89/99 (design §3.5) — logica de negocio de la lista de NOVEDADES: las devoluciones
 * del mensajero de la tienda del adminTienda (ordenes que REPOSAN en estatus `devuelta` bajo la
 * feature 99), con la causa de la ultima gestion `devuelta` vigente. Solo lectura. No conoce HTTP
 * ni Prisma; testeable con dobles sin red/DB.
 */
export class NovedadesService implements INovedadesService {
  constructor(
    private readonly repo: NovedadesRepo,
    // Feature 160 (R11/R12/R26): derivador de intentos EN LOTE, dependencia REQUERIDA.
    private readonly historial: Pick<IOrdenHistorialService, "contarIntentosEnLote">,
  ) {}

  async listar(
    input: ListarNovedadesInput,
    actor: Actor,
  ): Promise<ListarNovedadesServiceResult> {
    if (actor.rol !== ROL_AUTORIZADO) return { status: "forbidden" }; // R11

    const { page, pageSize } = input;

    // R7/R8: total de novedades de la tienda del actor (predicado anclado a `estatus = devuelta`
    // + tienda + no borrada; el repo lo aplica, mismo universo que la pagina, R8).
    const total = await this.repo.countDevueltasByTienda(actor.usuarioId);

    // R7/R8/R9: la pagina de novedades de la tienda, ordenada por Orden.createdAt desc (fallback).
    // `skip` derivado de la pagina (1-based).
    const skip = (page - 1) * pageSize;
    const rows = await this.repo.findDevueltasByTienda(actor.usuarioId, {
      skip,
      take: pageSize,
    });
    if (rows.length === 0) {
      // R10 lo pinta el front; aqui solo se evita la consulta agregada innecesaria (R8).
      return { status: "ok", items: [], total, page, pageSize };
    }

    // R8: UNA sola consulta agregada para las causas de TODAS las ordenes de la pagina.
    const causas = await this.repo.findCausasDevueltaVigentes(rows.map((r) => r.id)); // R6/R7
    // Feature 160 (R12/R15): UNA sola consulta al historial para toda la pagina, sobre las
    // ordenes YA acotadas a la tienda del actor (`findDevueltasByTienda(actor.usuarioId, ...)`).
    const intentos = await this.historial.contarIntentosEnLote(rows.map((r) => r.id));

    // R12 (estricto): reordena la PAGINA por la fecha de la ultima gestion `devuelta` vigente
    // desc, con la fecha ya traida por `findCausasDevueltaVigentes` (sin query extra). Las
    // ordenes sin gestion vigente caen a `Orden.createdAt` (fallback documentado). Copia antes
    // de ordenar para no mutar el arreglo del repo.
    const ordered = [...rows].sort(
      (a, b) => fechaEfectiva(b, causas).getTime() - fechaEfectiva(a, causas).getTime(),
    );

    // R6/R7/R10: mapea a NovedadDTO; causa = ultima gestion vigente, o null ("sin causa").
    const items: NovedadDTO[] = ordered.map((row) => ({
      id: row.id,
      numGuia: row.numGuia,
      destinatario: row.destinatario,
      telefonoDest: row.telefonoDest,
      causa: causas.get(row.id)?.causa ?? null,
      // Feature 160 (R14/R19): `?? 0` — el `0` SIEMPRE se expone.
      intentosEntrega: intentos.get(row.id) ?? 0,
    }));

    return { status: "ok", items, total, page, pageSize };
  }
}

// R12: fecha de recencia de una orden = fecha de su ultima gestion `devuelta` vigente si
// existe; si no (R7), `Orden.createdAt` como fallback documentado.
function fechaEfectiva(
  row: NovedadOrdenRow,
  causas: Map<string, CausaDevueltaVigente>,
): Date {
  return causas.get(row.id)?.fecha ?? row.createdAt;
}
