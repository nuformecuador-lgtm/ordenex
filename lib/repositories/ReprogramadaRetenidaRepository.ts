import { Prisma, type PrismaClient } from "@prisma/client";

import type {
  CierreParaRetenidas,
  IReprogramadaRetenidaRepository,
  RetenidaEnRepartoRow,
} from "@/lib/interfaces/repositories/IReprogramadaRetenidaRepository";
// FICHA 454: el predicado unico de «gestion pendiente de confirmar» se IMPORTA como fragmento SQL y
// se COMPONE; no se reescribe. La guardia `gestion-pendiente-unica-fuente` prohibe leer el evento
// de registro en un `where` fuera de ese modulo, y esta es la forma de cumplirlo sin renunciar a
// una sola consulta por lectura.
import {
  ESTATUS_CON_GESTION_PENDIENTE,
  sqlUltimaGestionPendienteLateral,
} from "@/lib/repositories/gestion-pendiente";
import type { CierreDestinoTipo, CierreEstado } from "@/lib/types/cierre";
// La conversion OFICIAL de un `Date` en convencion `@db.Date` (medianoche UTC de la fecha CR) a su
// texto `YYYY-MM-DD`. Ver la cabecera de esa funcion: un `Date` crudo en el `::date` dependeria del
// `TimeZone` de la sesion de Postgres; el texto no.
import { fechaRepartoComoTexto } from "@/lib/utils/dia-reparto";

/** El resultado de gestion que retiene: la reprogramacion. Mismo literal que `RESULTADO_REPROGRAMADA` (371). */
const RESULTADO_REPROGRAMADO = "reprogramado";

type RetenidasPrismaClient = Pick<PrismaClient, "$queryRaw" | "cierreDia" | "usuario">;

/**
 * FICHA 462 (T1.3, design §2.2) — repositorio de las reprogramadas retenidas. SOLO LECTURAS (R8):
 * ni `update`, ni `create`, ni `delete`, ni `$executeRaw`. Lo vigila
 * `tests/unit/guards/reprogramadas-retenidas-solo-lectura.guardia.test.ts` sobre este fuente.
 *
 * Trae HECHOS y no decide nada: quien dice «esta retenida» y «a quien se atribuye» es
 * `ReprogramadasRetenidasService`.
 */
export class ReprogramadaRetenidaRepository implements IReprogramadaRetenidaRepository {
  constructor(private readonly prisma: RetenidasPrismaClient) {}

  /**
   * Forma B (design §1.2): orden VIVA en `en_reparto` cuya gestion pendiente MAS RECIENTE —la que
   * elige la LATERAL de la 454, con sus tres condiciones— es un `reprogramado` con fecha vencida.
   *
   * ⚠️ `<= hoy` Y NO `= hoy`: «de hoy» incluye las vencidas de dias anteriores, el mismo criterio
   * que la liberacion (46/R10-R11). Quitar esta cota contaria las reprogramadas para MAÑANA como
   * retenidas de hoy — mutacion obligatoria del design (§8.2-1), medida contra Postgres.
   *
   * ⚠️ `${hoy}::date` SOBRE EL TEXTO `YYYY-MM-DD`, y no sobre el `Date`: `fecha_reprogramacion` es
   * `@db.Date` y `hoyCR` viene en esa misma convencion (medianoche UTC de la fecha CR, `startOfDayCR`).
   * Usar `inicioDelDiaCREnUtc` aqui seria el off-by-one de seis horas que la 413 documenta.
   */
  async findRetenidasEnReparto(hoyCR: Date): Promise<RetenidaEnRepartoRow[]> {
    const hoy = fechaRepartoComoTexto(hoyCR);
    const gp = sqlUltimaGestionPendienteLateral({
      id: Prisma.sql`"o"."id"`,
      estatusId: Prisma.sql`"o"."estatus_id"`,
    });
    const filas = await this.prisma.$queryRaw<
      {
        orden_id: string;
        zona_id: string;
        mensajero_asignado_id: string | null;
        gestion_id: string;
        cierre_id: string | null;
      }[]
    >(Prisma.sql`
      SELECT "o"."id" AS "orden_id",
             "o"."zona_id" AS "zona_id",
             "o"."mensajero_asignado_id" AS "mensajero_asignado_id",
             "gp"."gestion_id" AS "gestion_id",
             "gp"."cierre_id" AS "cierre_id"
        FROM "orden" "o"
        JOIN "order_status" "s"
          ON "s"."id" = "o"."estatus_id" AND "s"."value" = ${ESTATUS_CON_GESTION_PENDIENTE}
        LEFT JOIN LATERAL (${gp}) "gp" ON TRUE
       WHERE "o"."deleted_at" IS NULL
         AND "gp"."resultado" = ${RESULTADO_REPROGRAMADO}
         AND "gp"."fecha_reprogramacion" <= ${hoy}::date
       ORDER BY "o"."id"`);
    return filas.map((f) => ({
      ordenId: f.orden_id,
      zonaId: f.zona_id,
      mensajeroAsignadoId: f.mensajero_asignado_id,
      gestionId: f.gestion_id,
      cierreId: f.cierre_id,
    }));
  }

  /**
   * UNA consulta para todos los cierres pedidos. Las gestiones se cargan con `where: { anuladaAt:
   * null }` y SOLO su `createdAt`: es el insumo de `derivarJornada` (fuente A), no una segunda
   * correlacion de «la gestion vigente» (la 371 prohibe eso, y aqui no hace falta).
   */
  async findCierresQueRetienen(cierreIds: readonly string[]): Promise<CierreParaRetenidas[]> {
    if (cierreIds.length === 0) return [];
    const filas = await this.prisma.cierreDia.findMany({
      where: { id: { in: [...cierreIds] } },
      select: {
        id: true,
        estado: true,
        destinoTipo: true,
        destinoZonaId: true,
        mensajeroId: true,
        createdAt: true,
        mensajero: { select: { nombre: true } },
        gestiones: { where: { anuladaAt: null }, select: { createdAt: true } },
      },
    });
    return filas.map((c) => ({
      cierreId: c.id,
      estado: c.estado as CierreEstado,
      destinoTipo: c.destinoTipo as CierreDestinoTipo,
      destinoZonaId: c.destinoZonaId,
      mensajeroId: c.mensajeroId,
      mensajeroNombre: c.mensajero.nombre,
      createdAt: c.createdAt,
      gestionesCreatedAt: c.gestiones.map((g) => g.createdAt),
    }));
  }

  /** Nombres del grupo «sin cierre enviado». UNA consulta; `[]` -> `[]` sin consultar. */
  async findMensajeros(ids: readonly string[]): Promise<Array<{ id: string; nombre: string }>> {
    if (ids.length === 0) return [];
    return this.prisma.usuario.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, nombre: true },
    });
  }
}
