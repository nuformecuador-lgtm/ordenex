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

// R3: estatus que CIERRAN la novedad (retiran la orden de la lista aunque tenga gestion de
// devolucion vigente). Decision #1 del gate, verificada contra `ORDER_STATUS_SEED`. `rechazada`
// (escalado) y `en_bodega`/`en_bodega_satelite` (reintento) NO cierran (siguen como novedad).
// Constante del service (el repo la recibe como parametro `cerrados` y solo aplica el `notIn`,
// sin hardcodear valores de catalogo).
const ESTATUS_CERRADOS = ["entregada", "devuelta_origen", "recibido_origen"];

// R11: unico rol autorizado (paridad con `RecepcionSateliteService.ROL_AUTORIZADO`).
const ROL_AUTORIZADO = "adminTienda";

// Metodos de repo que consume el service (inyeccion por constructor). `Pick` para dobles de
// test sin DB/HTTP (patron `RecepcionSateliteRepo`).
type NovedadesRepo = Pick<
  IOrdenRepository,
  "countDevueltasByTienda" | "findDevueltasByTienda" | "findCausasDevueltaVigentes"
>;

/**
 * Feature 87/89 (design §2.2) — logica de negocio de la lista de NOVEDADES: las devoluciones
 * del mensajero de la tienda del adminTienda (ordenes con gestion de devolucion VIGENTE y aun
 * ABIERTAS, estatus fuera de `ESTATUS_CERRADOS`), con la causa de la ultima gestion `devuelta`
 * vigente. Solo lectura. No conoce HTTP ni Prisma; testeable con dobles sin red/DB.
 */
export class NovedadesService implements INovedadesService {
  constructor(private readonly repo: NovedadesRepo) {}

  async listar(
    input: ListarNovedadesInput,
    actor: Actor,
  ): Promise<ListarNovedadesServiceResult> {
    if (actor.rol !== ROL_AUTORIZADO) return { status: "forbidden" }; // R11

    const { page, pageSize } = input;

    // R1-R9: total de novedades de la tienda del actor (acota `tiendaId = actor.usuarioId` y
    // pasa el mismo conjunto `cerrados` que la pagina, R8).
    const total = await this.repo.countDevueltasByTienda(actor.usuarioId, ESTATUS_CERRADOS);

    // R1-R9/R12: la pagina de novedades de la tienda, ordenada por Orden.createdAt desc
    // (fallback R12). `skip` derivado de la pagina (1-based).
    const skip = (page - 1) * pageSize;
    const rows = await this.repo.findDevueltasByTienda(actor.usuarioId, ESTATUS_CERRADOS, {
      skip,
      take: pageSize,
    });
    if (rows.length === 0) {
      // R10 lo pinta el front; aqui solo se evita la consulta agregada innecesaria (R8).
      return { status: "ok", items: [], total, page, pageSize };
    }

    // R8: UNA sola consulta agregada para las causas de TODAS las ordenes de la pagina.
    const causas = await this.repo.findCausasDevueltaVigentes(rows.map((r) => r.id)); // R6/R7

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
