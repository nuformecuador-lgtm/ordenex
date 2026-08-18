// EL CONTADOR DE HOY: de las ordenes cargadas en el dia CR en curso, cuantas tienen ya alguna
// gestion vigente y cuantas no.
//
// ─── UNA SOLA CONSULTA, Y ESO ES LA INVARIANTE ──────────────────────────────────────────
//
// Las dos cifras salen de repartir las MISMAS filas con dos `COUNT(*) FILTER (...)`, no de dos
// consultas. Es lo que hace que `sinGestion + conGestion` sea EXACTAMENTE el total de cargadas
// del dia por construccion: con dos consultas, una gestion registrada entre ambas dejaria en
// pantalla dos numeros que no suman lo que dicen sumar — y en un contador de pendientes eso se
// lee como trabajo que aparece o desaparece solo.
//
// ─── QUE SE IGNORA DEL FILTRO, Y POR QUE NO ES UN DESCUIDO ──────────────────────────────
//
//   - LA VENTANA (`consulta.rango`): esta lectura no recibe filtro de fecha. Su ventana es
//     siempre el dia CR en curso, y llega como PARAMETRO desde el servicio, que es quien tiene
//     el reloj. Un contador «de hoy» que obedeciera al selector de fechas dejaria de ser el
//     contador de hoy sin cambiar de rotulo.
//   - EL MENSAJERO: mismo criterio que la serie de cargadas por dia — una orden no la carga un
//     mensajero. Se hereda gratis, porque el recorte comun (`condicionesSinFecha`) ya lo deja
//     fuera.
//
// Lo que NO se ignora: el ALCANCE (frontera multi-tenant, primera condicion siempre) y las cinco
// facetas de recorte. Todo eso se REUSA de `condicionesSinFecha` en vez de reescribirse — que es
// justo lo que evita una cuarta copia del mismo `where` con vida propia.
//
// ─── POR QUE SQL CRUDO ──────────────────────────────────────────────────────────────────
//
// «Tiene al menos una gestion vigente» es una condicion sobre OTRA tabla evaluada por fila, y el
// reparto en dos buckets segun esa condicion no se expresa con `groupBy` de Prisma: haria falta
// una columna por la que agrupar, y no existe. Con `LEFT JOIN LATERAL ... LIMIT 1` sale en UNA
// consulta, se apoya en el indice `gestion_orden(orden_id)` que ya existe y —a diferencia de un
// `EXISTS` dentro del `FILTER`, que Postgres no admite— es la forma que la casa ya usa
// (`ConteoPorStatusRepository`).

import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

import { condicionesSinFecha } from "@/lib/repositories/ConteoCargadasPorDiaRepository";
import type { ConsultaConteoEntregas } from "@/lib/analytics/entregas-conteo";
import type { RangoResuelto } from "@/lib/analytics/types";
import type {
  ConteoHoyCrudo,
  IConteoHoyGestionRepository,
} from "@/lib/interfaces/repositories/IConteoHoyGestionRepository";

/** Cliente MINIMO consumido: una sola consulta cruda. `$queryRawUnsafe` NO esta y no puede
 *  estar — el tipo del cliente es la primera barrera contra la interpolacion de strings. */
type ConteoHoyPrismaClient = Pick<PrismaClient, "$queryRaw">;

interface FilaHoy {
  readonly sin_gestion: number;
  readonly con_gestion: number;
}

/**
 * TODAS las condiciones del `where`, en orden. Funcion PURA y exportada: es donde vive la
 * semantica y se comprueba sin base de datos.
 *
 * El recorte comun se REUSA; lo unico propio es la ventana, y cae sobre `o."created_at"` porque
 * la pregunta es por las ordenes CARGADAS hoy, no por las que hoy tuvieron movimiento.
 *
 * SEMIABIERTA `[desde, hasta)`: `resolverRango` devuelve `hasta` como las 00:00 CR del dia
 * SIGUIENTE, justamente para que `hastaFecha` sea inclusiva. Un `<=` meteria manana entero.
 *
 * Y aqui la ventana NO es opcional: `dia` es siempre un rango real. La rama «sin fecha» que si
 * tienen las otras lecturas no existe en esta, porque un contador de hoy sin dia no es nada.
 */
export function condicionesDeHoy(
  consulta: ConsultaConteoEntregas,
  dia: RangoResuelto,
): Prisma.Sql[] {
  return [
    ...condicionesSinFecha(consulta),
    Prisma.sql`o."created_at" >= ${dia.desde}`,
    Prisma.sql`o."created_at" <  ${dia.hasta}`,
  ];
}

export class ConteoHoyGestionRepository implements IConteoHoyGestionRepository {
  constructor(private readonly prisma: ConteoHoyPrismaClient) {}

  async contarDeHoy(
    consulta: ConsultaConteoEntregas,
    dia: RangoResuelto,
  ): Promise<ConteoHoyCrudo> {
    const where = Prisma.join(condicionesDeHoy(consulta, dia), " AND ");

    // `LIMIT 1` en el lateral: no interesa CUANTAS gestiones tiene la orden ni cual es la
    // ultima —eso es la pregunta del desglose por status—, solo si hay alguna. En cuanto
    // encuentra una, para.
    //
    // `anulada_at IS NULL` es la misma regla de vigencia que el resto de la vertical: una
    // gestion anulada no cuenta como «tocada», porque anularla es exactamente deshacerla.
    //
    // `COALESCE(..., 0)`: sin filas, los `COUNT` de una agregacion sin `GROUP BY` devuelven 0 y
    // la fila SI viene — pero el `COALESCE` deja escrito que dos ceros son una respuesta y no
    // una ausencia, y protege del caso en que alguien anada un `GROUP BY` mas adelante.
    const filas = await this.prisma.$queryRaw<FilaHoy[]>`
      SELECT COALESCE(COUNT(*) FILTER (WHERE u."id" IS NULL), 0)::int     AS sin_gestion,
             COALESCE(COUNT(*) FILTER (WHERE u."id" IS NOT NULL), 0)::int AS con_gestion
      FROM "orden" o
      LEFT JOIN LATERAL (
        SELECT g."id"
        FROM "gestion_orden" g
        WHERE g."orden_id" = o."id"
          AND g."anulada_at" IS NULL
        LIMIT 1
      ) u ON TRUE
      WHERE ${where}`;

    // Una agregacion sin `GROUP BY` devuelve SIEMPRE exactamente una fila; el `?? 0` es la
    // defensa contra un doble que devuelva `[]` en un test, no contra Postgres.
    const fila = filas[0];
    return {
      sinGestion: Number(fila?.sin_gestion ?? 0),
      conGestion: Number(fila?.con_gestion ?? 0),
    };
  }
}
