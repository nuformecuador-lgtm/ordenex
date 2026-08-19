// El CICLO DE VIDA de una orden: de su creacion a su ultima transicion terminal.
//
// ─── ESTA DEFINICION NO ES NUEVA, Y ESO ES LO IMPORTANTE ────────────────────────────────
//
// El reloj arranca en `orden.created_at` y para en la ULTIMA transicion a un
// `ESTADOS_TERMINALES` (`entregada`, `devuelta_a_tienda`, `incidente`) de
// `orden_historial_estado`. Es, literalmente, la consulta Q5 de `AnaliticaRollupRepository`
// —la que alimenta la metrica `tiempo_ciclo` del catalogo— con el `where` de esta vertical en
// vez del de una ventana de rollup.
//
// Se copio el CRITERIO, a conciencia, y no por comodidad: escribir aqui una variante —empezar
// en la primera asignacion, o parar en la PRIMERA transicion terminal en vez de la ultima—
// habria dado dos «tiempos de ciclo» distintos en el mismo producto, y nadie sabria cual
// mirar. Las tres decisiones que se heredan, con su porque:
//
//   - `DISTINCT ON (orden_id) ... ORDER BY created_at DESC, id DESC` — la ULTIMA transicion
//     terminal, no la primera. El caso que esto resuelve es real: una orden entra a terminal,
//     alguien la revierte y vuelve a entrar. Con la primera, el reloj pararia en un cierre que
//     se deshizo; y el `DISTINCT ON` ademas garantiza UNA contribucion por orden, nunca dos.
//     El desempate por `id` no sobra: dos transiciones pueden compartir `created_at`, y sin el
//     Postgres podria elegir una u otra entre ejecuciones.
//   - la VENTANA cae sobre la transicion TERMINAL, no sobre la creacion de la orden. Una orden
//     creada en enero y cerrada en agosto cuenta en agosto. Atribuyendo por creacion, el mes
//     en curso saldria siempre artificialmente rapido: solo habrian cerrado las faciles.
//   - los terminales se IMPORTAN de `ESTADOS_TERMINALES` y no se escriben aqui: si manana
//     entra un cuarto, esta consulta lo recoge sola.
//
// ⚠ LO QUE NO SE HEREDA es el `estatus_al_corte` del rollup: alli hace falta porque el cubo se
// desagrega por estatus. Aqui no hay desagregacion, asi que se omite — y omitirlo es lo
// correcto, no una simplificacion: ese CTE recorre el historial entero de cada orden.
//
// ─── COSTE DECLARADO ────────────────────────────────────────────────────────────────────
//
// Es la QUINTA escritura del recorte por facetas de esta vertical. Igual que en las otras: el
// recorte por ROL se REUSA —`condicionDeAlcance` se importa—, las condiciones se construyen en
// `condicionesDeCiclo`, funcion PURA y exportada, y el alcance es SIEMPRE la primera. La
// condicion de FECHA es distinta a proposito y no debe converger nunca: aqui cae sobre la
// transicion terminal, que es el evento que se esta fechando.

import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

import { condicionDeAlcance } from "@/lib/repositories/ConteoPorStatusRepository";
import { ESTADOS_TERMINALES } from "@/lib/types/order-status-transiciones";
import type { ConsultaConteoEntregas } from "@/lib/analytics/entregas-conteo";
import type {
  CicloCrudo,
  ICicloVidaRepository,
} from "@/lib/interfaces/repositories/ICicloVidaRepository";

/** Cliente MINIMO consumido (patron del resto de la vertical): una sola consulta cruda. */
type CicloVidaPrismaClient = Pick<PrismaClient, "$queryRaw">;

interface FilaCiclo {
  readonly seg: string | number | null;
  readonly n: number;
}

/**
 * Los `value` TERMINALES del catalogo, como lista SQL. Se importan del dominio y NO se
 * reescriben: mismo criterio —y misma linea— que `AnaliticaRollupRepository`.
 */
const TERMINALES = Prisma.join([...ESTADOS_TERMINALES]);

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
 * Las condiciones que se aplican sobre la ORDEN ya emparejada con su cierre. Funcion PURA y
 * exportada: es donde vive la semantica y se comprueba sin base de datos.
 *
 * La ventana NO esta aqui: va dentro del CTE, sobre `h.created_at`, porque es lo que
 * selecciona QUE cierres entran — y aplicarla fuera del `DISTINCT ON` cambiaria el resultado
 * (se elegiria la ultima transicion de todos los tiempos y luego se descartaria si cae fuera,
 * en vez de la ultima DENTRO de la ventana).
 */
export function condicionesDeCiclo(consulta: ConsultaConteoEntregas): Prisma.Sql[] {
  const { filtro, alcance } = consulta;

  const condiciones: Prisma.Sql[] = [
    // El recorte por ROL, primero y siempre. Frontera multi-tenant.
    condicionDeAlcance(alcance),
    Prisma.sql`o."deleted_at" IS NULL`,
  ];

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

  // Mensajero: quien REGISTRO alguna gestion vigente de la orden, igual que en las lecturas
  // cuyo universo es la orden. `orden.mensajero_asignado_id` seria el asignado ACTUAL, que
  // pudo cambiar despues del cierre.
  if (filtro.mensajero_id !== undefined && filtro.mensajero_id.length > 0) {
    condiciones.push(Prisma.sql`EXISTS (
      SELECT 1 FROM "gestion_orden" gm
      WHERE gm."orden_id" = o."id"
        AND gm."anulada_at" IS NULL
        AND gm."mensajero_id" IN (${comoParametros(filtro.mensajero_id)})
    )`);
  }

  return condiciones;
}

/**
 * La ventana del CTE: sobre la transicion terminal. Sin rango no se anade nada y entran todos
 * los cierres registrados — «sin filtrar» significa todo, tambien aqui.
 */
export function condicionDeVentanaTerminal(consulta: ConsultaConteoEntregas): Prisma.Sql {
  const { rango } = consulta;
  if (rango === null) return Prisma.sql`TRUE`;
  // Semiabierta `[desde, hasta)`: `resolverRango` devuelve `hasta` como las 00:00 CR del dia
  // SIGUIENTE, para que `hastaFecha` sea inclusiva.
  return Prisma.sql`h."created_at" >= ${rango.desde} AND h."created_at" < ${rango.hasta}`;
}

export class CicloVidaRepository implements ICicloVidaRepository {
  constructor(private readonly prisma: CicloVidaPrismaClient) {}

  async acumularCiclos(consulta: ConsultaConteoEntregas): Promise<CicloCrudo> {
    const where = Prisma.join(condicionesDeCiclo(consulta), " AND ");
    const ventana = condicionDeVentanaTerminal(consulta);

    // `SUM(...)::bigint` llega como STRING por el driver cuando el tipo es `bigint`, y como
    // `null` si no hubo ninguna fila. Las dos cosas se normalizan abajo: un `Number(null)` es
    // `0`, que aqui es correcto —cero filas, cero segundos— pero conviene que sea explicito y
    // no un accidente de coercion.
    const filas = await this.prisma.$queryRaw<FilaCiclo[]>`
      WITH ultimo_terminal AS (
        SELECT DISTINCT ON (h."orden_id")
               h."orden_id"   AS orden_id,
               h."created_at" AS cerrado_at
        FROM "orden_historial_estado" h
        JOIN "order_status" s ON s."id" = h."estatus_destino_id"
        WHERE s."value" IN (${TERMINALES})
          AND ${ventana}
        ORDER BY h."orden_id", h."created_at" DESC, h."id" DESC
      )
      SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (u.cerrado_at - o."created_at"))::bigint), 0)::bigint AS seg,
             COUNT(*)::int AS n
      FROM ultimo_terminal u
      JOIN "orden" o ON o."id" = u.orden_id
      WHERE ${where}`;

    const fila = filas[0];
    if (!fila) return { segundosAcum: 0, n: 0 };
    return { segundosAcum: Number(fila.seg ?? 0), n: Number(fila.n) };
  }
}
