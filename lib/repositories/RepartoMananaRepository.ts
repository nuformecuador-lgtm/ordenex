import type { Prisma, PrismaClient } from "@prisma/client";

import type {
  IRepartoMananaRepository,
  RepartoMananaDeMensajero,
} from "@/lib/interfaces/repositories/IRepartoMananaRepository";
import { ESTADOS_REPARTO_MENSAJERO } from "@/lib/constants/reparto-mensajero-estados";

// FICHA 413 (T3.2, design §3) — EL REPOSITORIO DEL AVISO. SOLO queries Prisma.
//
// ---------------------------------------------------------------------------------------------
// EL PREDICADO, Y POR QUE ES EXACTAMENTE ESE
// ---------------------------------------------------------------------------------------------
//
//   mensajero_asignado_id = <mensajero>
//   AND deleted_at IS NULL
//   AND estatus.value IN (por_recoger, en_reparto, ayuda_tienda)
//   AND fecha_reparto > startOfDayCR(now)
//
// ⚠️ LOS ESTADOS NO SE ESCRIBEN AQUI (R2). Se IMPORTA `ESTADOS_REPARTO_MENSAJERO`, que es la MISMA
// lista que el portal del mensajero usa para pintar `/mis-asignaciones`. Si este archivo
// escribiera la suya, el dia que el portal ganara un cuarto estatus el aviso contaria uno menos y
// NADA se pondria rojo — y la regla que gobierna toda esta ficha es la que dejo escrita la 409:
//
//   > Si el aviso dijera «5» y la pantalla enseñara 4, el aviso queda desacreditado el primer dia.
//
// Duplicar la lista aqui pone ROJA `tests/unit/guards/estados-reparto-mensajero-unica-fuente
// .guardia.test.ts`. Es la mutacion obligatoria de R2.
//
// ⚠️ LA COTA ES `startOfDayCR` Y **NO** `inicioDelDiaCREnUtc`, Y AQUI LA TRAMPA VA AL REVES DE LO
// QUE SUELE AVISARSE EN ESTE REPO. `orden.fecha_reparto` es **`@db.Date`** (`db/schema.prisma`),
// no `timestamp`: `startOfDayCR` devuelve la medianoche UTC de la fecha CALENDARIO de CR, que es
// la MISMA convencion con la que se escribe esa columna. `inicioDelDiaCREnUtc` —la cota correcta
// contra columnas `timestamp` como `asignado_at` o `gestion_orden.created_at`— esta seis horas mas
// tarde y aqui METERIA en «lo de mañana» las ordenes de HOY desde las 18:00 CR y dejaria FUERA las
// de mañana en esa misma franja. Seis horas que no se ven a ojo. R3 lo mata con un reloj fijo a
// las 23:50 CR (`2026-09-12T05:50:00Z`), contra Postgres real.
//
// El propio arbol lo dice en las dos direcciones: `lib/utils/fecha-cr.ts` lista `orden
// .fecha_reparto` entre los CONSUMIDORES DECLARADOS de `startOfDayCR`, y `lib/utils/
// dia-reparto.ts` avisa de que el otro helper «NO sirve para esto». El portal del mensajero, la
// reserva de la 261 y el corte diario ya usan este mismo.
//
// ⚠️ Y NO HAY UN TERCER HELPER QUE INVENTAR. Como `DIA_REPARTO = ["hoy","manana"]`
// (`lib/types/dia-reparto.ts`), «reservada para un dia posterior al de hoy» **ES** «reservada para
// mañana»: se usa la comparacion `>` que ya existe (`estaReservadaParaOtroDia` en
// `MisAsignacionesService`) y no una igualdad contra una fecha calculada aparte. Una comparacion
// menos que pueda equivocarse. La guardia `dia-reparto-tokens.guardia.test.ts` vigila ese
// supuesto: el dia que alguien añada «pasado mañana», se pone roja y obliga a revisar el titulo
// del aviso —que dice «mañana»— antes de que la app mienta.
//
// `>` y NO `>=`: una orden reservada para HOY no esta reservada para «otro dia», es de hoy y se
// trabaja. Y por eso el aviso CADUCA SOLO: al pasar la medianoche CR, `startOfDayCR(now)` avanza y
// las ordenes del dia anunciado dejan de ser «posteriores» sin que nadie ejecute nada (R21).

/** Lo unico que este repositorio necesita del cliente: la tabla `orden`. */
type RepartoMananaPrismaClient = Pick<PrismaClient, "orden">;

export class RepartoMananaRepository implements IRepartoMananaRepository {
  constructor(private readonly prisma: RepartoMananaPrismaClient) {}

  /**
   * R1/R4 — el resumen por mensajero, con `GROUP BY mensajero_asignado_id`.
   *
   * `mensajeroAsignadoId: { not: null }` no es decoracion: sin el, las ordenes sin asignar
   * caerian en un grupo `null` que no corresponde a ningun mensajero. Y R18 sale de aqui gratis —
   * un mensajero sin reparto de mañana no produce fila—, aunque el servicio lleva ademas su
   * `continue` explicito por si un doble devolviera un `total: 0`.
   */
  async resumenPorMensajero(diaEnCurso: Date): Promise<RepartoMananaDeMensajero[]> {
    const filas = await this.prisma.orden.groupBy({
      by: ["mensajeroAsignadoId"],
      where: { ...this.whereRepartoManana(diaEnCurso), mensajeroAsignadoId: { not: null } },
      _count: { _all: true },
    });
    return filas
      .filter((f): f is typeof f & { mensajeroAsignadoId: string } => f.mensajeroAsignadoId !== null)
      .map((f) => ({ mensajeroId: f.mensajeroAsignadoId, total: f._count._all }));
  }

  /** R13/R41 — la cifra VIVA de un mensajero. UNA consulta, el MISMO `where`. */
  contarReservadasParaOtroDia(mensajeroId: string, diaEnCurso: Date): Promise<number> {
    return this.prisma.orden.count({
      where: { ...this.whereRepartoManana(diaEnCurso), mensajeroAsignadoId: mensajeroId },
    });
  }

  /**
   * EL PREDICADO, EN UN SOLO SITIO. Los dos metodos publicos lo comparten, asi que el resumen del
   * cron y la cifra viva del panel NO PUEDEN describir poblaciones distintas (R2, segunda mitad).
   *
   * Ver la cabecera de este archivo para las dos decisiones que viven aqui: de donde salen los
   * estados y por que la cota es `startOfDayCR`.
   */
  private whereRepartoManana(diaEnCurso: Date): Prisma.OrdenWhereInput {
    return {
      deletedAt: null,
      estatus: { value: { in: [...ESTADOS_REPARTO_MENSAJERO] } },
      fechaReparto: { gt: diaEnCurso },
    };
  }
}
