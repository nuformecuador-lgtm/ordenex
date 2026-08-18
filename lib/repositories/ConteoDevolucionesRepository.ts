// El desglose de DEVOLUCIONES POR CAUSA: una fila por causa con al menos una gestion.
//
// ─── LO QUE SE CUENTA AQUI NO SON ORDENES ───────────────────────────────────────────────
//
// Son GESTIONES vigentes con `resultado = 'devuelta'`. Es la convencion del repo para las
// devoluciones (`lib/analytics/metrics.ts`, D10/R35) y la unica que permite agrupar por causa:
// la causa vive en la GESTION, no en la orden, y una orden devuelta dos veces tiene dos causas
// que pueden ser distintas. Consecuencia declarada: este total no tiene por que coincidir con
// las «devueltas» del anillo, que cuenta ordenes por su ultimo desenlace.
//
// ─── LA FECHA ES OTRA, Y ESO ES DELIBERADO ──────────────────────────────────────────────
//
// Las lecturas de ordenes filtran por la fecha EFECTIVA de la orden
// (`COALESCE(ultima gestion vigente, o.created_at)`) y la de cargadas por dia, por
// `o.created_at`. Aqui la ventana cae sobre `g.created_at`: la fila que se cuenta ES la
// gestion, asi que su fecha es la suya. Filtrar una gestion por la fecha efectiva de su orden
// —que puede ser la de una gestion POSTERIOR— meteria devoluciones fuera del rango pedido y
// dejaria fuera otras que si estan dentro. Mismo criterio que declaro
// `ConteoCargadasPorDiaRepository` para su propia divergencia.
//
// ─── COSTE DECLARADO ────────────────────────────────────────────────────────────────────
//
// Es la CUARTA escritura del mismo recorte por facetas. Lo que se hace al respecto es lo mismo
// que en las otras: el recorte por ROL se REUSA de verdad —`condicionDeAlcance` se importa, no
// se reescribe—, las condiciones se construyen en `condicionesDeDevoluciones`, funcion PURA y
// exportada para inspeccionarla sin base de datos, y el alcance es SIEMPRE la primera
// condicion. Lo que NO se puede reusar es `condicionesDeConsulta`: aquella escribe la fecha
// sobre la orden y aqui va sobre la gestion, que es justo la diferencia que no debe converger.

import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

import { condicionDeAlcance } from "@/lib/repositories/ConteoPorStatusRepository";
import type { ConsultaConteoEntregas } from "@/lib/analytics/entregas-conteo";
import type {
  CausaCruda,
  IConteoDevolucionesRepository,
} from "@/lib/interfaces/repositories/IConteoDevolucionesRepository";
import { CAUSA_SIN_TIPIFICAR } from "@/lib/types/conteo-devoluciones";

/** Cliente MINIMO consumido (patron `ConteoPorStatusRepository`): una sola consulta cruda. */
type ConteoDevolucionesPrismaClient = Pick<PrismaClient, "$queryRaw">;

interface FilaCausa {
  readonly causa: string;
  readonly n: number;
}

/**
 * El resultado que define el universo. Se escribe una vez y se compara contra el enum del
 * esquema en el test, no contra una cadena suelta repetida por el archivo.
 */
const RESULTADO_DEVUELTA = "devuelta";

/** Lista de ids como parametros, nunca interpolada: cada uno entra como `$n`. */
function comoParametros(ids: readonly string[]): Prisma.Sql {
  return Prisma.join(ids.map((id) => Prisma.sql`${id}`));
}

/** `col IN (...)` solo si la dimension se filtro. `null` = sin recorte por esa faceta. */
function enLista(columna: Prisma.Sql, ids: readonly string[] | undefined): Prisma.Sql | null {
  if (ids === undefined || ids.length === 0) return null;
  return Prisma.sql`${columna} IN (${comoParametros(ids)})`;
}

/**
 * TODAS las condiciones del `where`, en orden. Funcion PURA y exportada: es donde vive la
 * semantica y se comprueba sin base de datos.
 *
 * El alias `o` es el de la tabla `orden` unida a la gestion, y NO es cosmetico: es lo que
 * permite reusar `condicionDeAlcance` tal cual, que escribe `o."zona_id"` / `o."tienda_id"`.
 * Recortar la gestion por columnas propias daria un recorte DISTINTO al de la orden, que es
 * exactamente lo que `lib/analytics/alcance-columnas.ts` prohibe: «los TRES recortes de
 * `gestion_orden` pasan por la relacion `orden`».
 */
export function condicionesDeDevoluciones(consulta: ConsultaConteoEntregas): Prisma.Sql[] {
  const { filtro, rango, alcance } = consulta;

  const condiciones: Prisma.Sql[] = [
    // El recorte por ROL, primero y siempre. Frontera multi-tenant.
    condicionDeAlcance(alcance),
    // Una gestion anulada (feature 67) no es una devolucion: es una devolucion DESHECHA.
    Prisma.sql`g."anulada_at" IS NULL`,
    Prisma.sql`g."resultado" = ${RESULTADO_DEVUELTA}::"gestion_resultado"`,
    // La orden borrada no cuenta, aunque su gestion siga en la tabla.
    Prisma.sql`o."deleted_at" IS NULL`,
  ];

  // Las cinco facetas geograficas y de tienda van sobre la ORDEN: la gestion no las tiene.
  const facetas: [Prisma.Sql, readonly string[] | undefined][] = [
    [Prisma.sql`o."zona_id"`, filtro.zona_id],
    [Prisma.sql`o."provincia_id"`, filtro.provincia_id],
    [Prisma.sql`o."canton_id"`, filtro.canton_id],
    [Prisma.sql`o."distrito_id"`, filtro.distrito_id],
    [Prisma.sql`o."tienda_id"`, filtro.tienda_id],
  ];
  for (const [columna, ids] of facetas) {
    const fragmento = enLista(columna, ids);
    if (fragmento) condiciones.push(fragmento);
  }

  // El mensajero, en cambio, SI es columna propia de la gestion, y aqui es ademas la lectura
  // natural: quien registro ESTA devolucion. En las otras lecturas hacia falta un `EXISTS`
  // correlacionado porque la fila contada era la orden; aqui la fila contada es la gestion.
  const mensajero = enLista(Prisma.sql`g."mensajero_id"`, filtro.mensajero_id);
  if (mensajero) condiciones.push(mensajero);

  // La ventana, sobre la fecha de la GESTION (ver la cabecera). Semiabierta `[desde, hasta)`:
  // `resolverRango` devuelve `hasta` como las 00:00 CR del dia SIGUIENTE, para que `hastaFecha`
  // sea inclusiva. Sin rango no se anade condicion: «sin filtrar» cuenta todas las devoluciones.
  if (rango !== null) {
    condiciones.push(
      Prisma.sql`g."created_at" >= ${rango.desde}`,
      Prisma.sql`g."created_at" <  ${rango.hasta}`,
    );
  }

  return condiciones;
}

export class ConteoDevolucionesRepository implements IConteoDevolucionesRepository {
  constructor(private readonly prisma: ConteoDevolucionesPrismaClient) {}

  async contarDevolucionesPorCausa(
    consulta: ConsultaConteoEntregas,
  ): Promise<readonly CausaCruda[]> {
    const where = Prisma.join(condicionesDeDevoluciones(consulta), " AND ");

    // `COALESCE(causa::text, 'sin_causa')`: el `NULL` de `causa_devolucion` tiene significado
    // de dominio —una devolucion anterior a la feature 73, que NO se backfilleo— y sin el
    // centinela `GROUP BY` lo devolveria como una fila con `null` que el DTO tendria que
    // interpretar. Se nombra aqui, una vez, con la constante que ya usa el tipo.
    //
    // `JOIN orden` y no `LEFT JOIN`: `gestion_orden.orden_id` es NOT NULL con FK, asi que no
    // hay gestion huerfana posible; un `LEFT` sugeriria que si y dejaria pasar filas sin
    // recorte de alcance, que es justo lo que no puede ocurrir.
    const filas = await this.prisma.$queryRaw<FilaCausa[]>`
      SELECT COALESCE(g."causa_devolucion"::text, ${CAUSA_SIN_TIPIFICAR}) AS causa,
             COUNT(*)::int                                                AS n
      FROM "gestion_orden" g
      JOIN "orden" o ON o."id" = g."orden_id"
      WHERE ${where}
      GROUP BY 1
      ORDER BY 2 DESC, 1 ASC`;

    return filas.map((f) => ({ causa: f.causa, conteo: Number(f.n) }));
  }
}
