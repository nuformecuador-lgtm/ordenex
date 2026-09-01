// El desglose POR STATUS: una fila por status con al menos una orden.
//
// ─── POR QUE ESTE VA EN SQL CRUDO Y EL OTRO NO ──────────────────────────────────────────
//
// El bucket de cada orden es «el `resultado` de su ULTIMA gestion vigente, y si nunca se
// gestiono, el `value` de su `order_status`» (decision humana del 2026-08-18). Ese «ultima»
// es un maximo CORRELACIONADO por orden, y el query builder de Prisma no lo expresa:
//
//   - `groupBy` no admite un sub-select correlacionado;
//   - los filtros de relacion (`some`/`none`) no pueden referirse a una fila concreta de la
//     otra tabla, asi que «no hay ninguna gestion posterior A ESTA» no se puede escribir;
//   - `distinct` + `orderBy` en `findMany` no sirve: Prisma no garantiza empujarlo a la base
//     como `DISTINCT ON`, y resolverlo en memoria significa traerse una fila por gestion de
//     todo el rango antes de deduplicar.
//
// Con `LEFT JOIN LATERAL ... LIMIT 1` sale en UNA consulta y se apoya en el indice
// `gestion_orden(orden_id)` que ya existe. Ademas la ventana temporal queda MAS clara aqui
// que en Prisma: la fecha efectiva es literalmente `COALESCE(u.created_at, o.created_at)`, en
// vez de las dos ramas mutuamente excluyentes que `ConteoEntregasRepository` tiene que
// escribir para decir lo mismo sin `MAX()`.
//
// ⚠ COSTE ACEPTADO Y DECLARADO: hay DOS implementaciones del mismo `where` —la de objetos
// Prisma en `ConteoEntregasRepository.whereDeConsulta` y la de SQL de aqui—, y pueden
// DIVERGIR. No se ha encontrado forma de tener una sola sin renunciar a la correccion de uno
// de los dos endpoints. Lo que se hace al respecto:
//   (a) las condiciones se construyen en `condicionesDeConsulta`, funcion PURA y exportada,
//       para poder inspeccionarlas en un test sin base de datos;
//   (b) `tests/unit/analytics/conteo-por-status-sql.test.ts` cubre faceta por faceta las
//       MISMAS preguntas que el test del `where` de Prisma, incluida la del alcance;
//   (c) el recorte por rol es la PRIMERA condicion siempre, y hay un caso que lo exige.
// Si algun dia estos dos endpoints dejan de compartir semantica sera porque alguien toco uno
// y no el otro — y esos tests son lo unico que lo va a decir.

import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

import type { ConsultaConteoEntregas, RecorteDeOrdenes } from "@/lib/analytics/entregas-conteo";
import type { AlcanceDatos } from "@/lib/analytics/alcance";
import type { IConteoPorStatusRepository } from "@/lib/interfaces/repositories/IConteoPorStatusRepository";
import type { ConteoDeStatus } from "@/lib/types/conteo-por-status";

/** Cliente MINIMO consumido (patron `AnaliticaRollupRepository`): una sola consulta cruda. */
type ConteoPorStatusPrismaClient = Pick<PrismaClient, "$queryRaw">;

interface FilaConteo {
  readonly status: string;
  readonly n: number;
}

/**
 * El recorte por ROL, en SQL.
 *
 * ⚠ FRONTERA MULTI-TENANT. Sin policies RLS debajo (Prisma se conecta con credenciales de
 * servicio) esta condicion es la UNICA separacion entre inquilinos de esta consulta: un fallo
 * aqui no da una cifra equivocada, filtra las ordenes de una tienda a otra.
 *
 * Las columnas son las MISMAS que `lib/analytics/alcance-columnas.ts` declara como canonicas
 * (`orden.zona_id`, `orden.tienda_id`): no se elige otra aqui. No se puede reusar `whereOrden`
 * porque devuelve un objeto de Prisma y esto es SQL — ese es exactamente el coste declarado
 * en la cabecera.
 *
 * `switch` EXHAUSTIVO sin `default`: una quinta variante de `AlcanceDatos` no compila, en vez
 * de colarse por una rama permisiva.
 */
export function condicionDeAlcance(alcance: AlcanceDatos): Prisma.Sql {
  switch (alcance.tipo) {
    case "global":
      // `TRUE` y no un fragmento vacio: esto se une con `AND` y un hueco romperia el SQL.
      return Prisma.sql`TRUE`;
    case "zona":
      return Prisma.sql`o."zona_id" = ${alcance.zonaId}`;
    case "tienda":
      return Prisma.sql`o."tienda_id" = ${alcance.tiendaId}`;
    case "mensajero":
      return Prisma.sql`o."mensajero_asignado_id" = ${alcance.mensajeroId}`;
  }
}

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
 * El orden NO es cosmetico: el alcance va PRIMERO para que se lea de un vistazo que la
 * consulta esta recortada por rol antes que por nada que haya pedido el cliente.
 *
 * ⚠ FICHA 345 — EL PARAMETRO SE ENSANCHO A `RecorteDeOrdenes`, y el cuerpo NO se toco. Motivo:
 * la lectura de PRODUCTOS necesita EXACTAMENTE este `where` (mismo universo, mismas facetas,
 * misma ventana) pero viaja en un tipo opaco propio (`ConsultaProductos`), porque su alcance
 * DIVERGE —un `adminSatelite` obtiene `{tipo:"zona"}` en el conteo de entregas y esta PROHIBIDO
 * en productos—. Con el parametro estrecho solo habia dos salidas, y las dos peores: FORJAR el
 * tipo opaco del conteo con un cast dentro del repositorio nuevo (que es literalmente lo que
 * detecta `FORJA_LA_CONSULTA` en `alcance-obligatorio.guardia.test.ts`) o una TERCERA copia de
 * estas condiciones. `RecorteDeOrdenes` es el tipo estructural que las dos consultas preparadas
 * cumplen; la opacidad se sigue exigiendo en la firma de cada metodo de repositorio.
 */
export function condicionesDeConsulta(consulta: RecorteDeOrdenes): Prisma.Sql[] {
  const { filtro, rango, alcance } = consulta;

  const condiciones: Prisma.Sql[] = [
    condicionDeAlcance(alcance),
    // Soft delete: una orden borrada no cuenta en ningun bucket.
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

  // Mensajero: quien REGISTRO la gestion, no `orden.mensajero_asignado_id`. Mismo criterio
  // que el otro endpoint —el asignado es el actual y pudo cambiar tras la entrega— y misma
  // independencia respecto de la fecha: la orden entra si ese mensajero la gestiono alguna
  // vez (vigente), aunque la gestion que fija su bucket sea de otro.
  if (filtro.mensajero_id !== undefined && filtro.mensajero_id.length > 0) {
    condiciones.push(Prisma.sql`EXISTS (
      SELECT 1 FROM "gestion_orden" gm
      WHERE gm."orden_id" = o."id"
        AND gm."anulada_at" IS NULL
        AND gm."mensajero_id" IN (${comoParametros(filtro.mensajero_id)})
    )`);
  }

  // La fecha efectiva: `COALESCE(ultima gestion vigente, orden.created_at)`, la MISMA regla
  // que el otro endpoint. Aqui se lee directa porque el LATERAL ya trajo esa gestion.
  //
  // Ventana SEMIABIERTA `[desde, hasta)`: `resolverRango` devuelve `hasta` como las 00:00 CR
  // del dia SIGUIENTE, justamente para que `hastaFecha` sea inclusiva. Un `<=` aqui meteria
  // el dia siguiente entero.
  //
  // SIN rango no se anade ninguna condicion de fecha: la pantalla no arranca con ventana
  // puesta, y «sin filtrar» tiene que contar todas las ordenes y no las de una semana.
  if (rango !== null) {
    condiciones.push(
      Prisma.sql`COALESCE(u."created_at", o."created_at") >= ${rango.desde}`,
      Prisma.sql`COALESCE(u."created_at", o."created_at") <  ${rango.hasta}`,
    );
  }

  return condiciones;
}

export class ConteoPorStatusRepository implements IConteoPorStatusRepository {
  constructor(private readonly prisma: ConteoPorStatusPrismaClient) {}

  async contarPorStatus(consulta: ConsultaConteoEntregas): Promise<readonly ConteoDeStatus[]> {
    const where = Prisma.join(condicionesDeConsulta(consulta), " AND ");

    // `LEFT JOIN LATERAL` y no un `DISTINCT ON` sobre toda `gestion_orden`: el lateral se
    // evalua por orden YA filtrada y usa el indice `gestion_orden(orden_id)`, en vez de
    // deduplicar el historial entero para luego tirar casi todo.
    //
    // El desempate `created_at DESC, id DESC` NO sobra: dos gestiones de la misma orden pueden
    // compartir `created_at`, y sin el segundo criterio Postgres podria elegir una u otra
    // entre ejecuciones — la misma consulta daria dos desgloses distintos sin que nada hubiera
    // cambiado.
    //
    // `LEFT` y no `INNER`: las ordenes SIN gestion tienen que entrar igual, y son justamente
    // las que caen del lado de `s.value` en el `COALESCE`.
    const filas = await this.prisma.$queryRaw<FilaConteo[]>`
      SELECT COALESCE(u."resultado"::text, s."value") AS status,
             COUNT(*)::int                            AS n
      FROM "orden" o
      JOIN "order_status" s ON s."id" = o."estatus_id"
      LEFT JOIN LATERAL (
        SELECT g."resultado", g."created_at"
        FROM "gestion_orden" g
        WHERE g."orden_id" = o."id"
          AND g."anulada_at" IS NULL
        ORDER BY g."created_at" DESC, g."id" DESC
        LIMIT 1
      ) u ON TRUE
      WHERE ${where}
      GROUP BY 1
      ORDER BY 2 DESC, 1 ASC`;

    // `GROUP BY` no emite filas para los buckets vacios, asi que los status sin ninguna orden
    // no vienen — que es exactamente lo pedido. No hay nada que filtrar aqui.
    return filas.map((f) => ({ status: f.status, conteo: Number(f.n) }));
  }
}
