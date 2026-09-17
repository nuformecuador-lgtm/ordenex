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
// `gestion_orden(orden_id)` que ya existe.
//
// ⚠ EL `where` YA NO ESTA ESCRITO DOS VECES, y la cabecera lo decia hasta la ficha 441. Aquel
// aviso —«hay DOS implementaciones, la de objetos Prisma en
// `ConteoEntregasRepository.whereDeConsulta` y la de SQL de aqui»— dejo de ser cierto el
// 2026-08-18: desde entonces `ConteoEntregasRepository` DELEGA en este repositorio y solo pliega
// sus buckets en seis, asi que `whereDeConsulta` ya no existe. Este archivo es hoy el UNICO
// sitio donde se escribe el recorte de la vertical, y lo consumen tres lecturas mas
// —`ConteoProductosRepository`, `DineroProductosRepository` y, para el alcance,
// `ConteoCargadasPorDiaRepository` / `CicloVidaRepository` / `ConteoDevolucionesRepository`—.
// Lo que sigue en pie de aquel parrafo:
//   (a) las condiciones se construyen en `condicionesDeConsulta`, funcion PURA y exportada,
//       para poder inspeccionarlas en un test sin base de datos;
//   (b) `tests/unit/analytics/conteo-por-status-sql.test.ts` la cubre faceta por faceta;
//   (c) el recorte por rol es la PRIMERA condicion siempre, y hay un caso que lo exige.
//
// ─── FICHA 441 — LA VENTANA CAE SOBRE LA CARGA, NO SOBRE LA ULTIMA GESTION ──────────────
//
// Hasta el 2026-09-17 la ventana caia sobre `COALESCE(u."created_at", o."created_at")` —la fecha
// de la ULTIMA GESTION, y solo la de creacion si la orden nunca se gestiono—, asi que «ayer»
// significaba «actividad de ayer» y no «cargadas ayer». MEDIDO EN PRODUCCION para el dia
// anterior: 210 ordenes y 49,0 % de efectividad por fecha efectiva, contra 75 ordenes y 14,7 %
// por cohorte de carga. **152 de las 210 se habian cargado antes**: tres cuartas partes de la
// cifra eran arrastre. El humano pidio la segunda lectura.
//
// La ventana se IMPORTA de `ventanaDeCarga` y no se escribe aqui: es la MISMA funcion que usan
// la serie de cargadas por dia y la tabla de cohortes, que ya preguntaban por `o."created_at"`.
// Ver ese archivo para el porque de una sola definicion.
//
// CONSECUENCIA, DELIBERADA: las cuatro lecturas que comparten este `where` —el desglose por
// status, el anillo que lo pliega, la tabla de productos y el dinero por producto— se mueven
// JUNTAS a la cohorte de carga. Esa es la mitad del punto: con una sola ventana, dos paneles de
// la misma pantalla no pueden hablar de dos poblaciones distintas.

import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

import type { ConsultaConteoEntregas, RecorteDeOrdenes } from "@/lib/analytics/entregas-conteo";
import { ventanaDeCarga } from "@/lib/repositories/ventana-de-carga";
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

  // ⚠ FICHA 441 — LA VENTANA CAE SOBRE `o."created_at"`, LA FECHA DE CARGA. Ni una linea de
  // fecha escrita aqui: se IMPORTA `ventanaDeCarga`, la misma que ya usaban la serie de
  // cargadas por dia y la tabla de cohortes. Sin rango no aporta ninguna condicion.
  //
  // LO QUE HABIA ANTES, para que nadie lo reponga sin saber que hace: la ventana comparaba
  // `COALESCE(u."created_at", o."created_at")` —la ULTIMA GESTION VIGENTE, y solo la creacion
  // si nunca se gestiono—. Con eso, una orden cargada en enero y gestionada ayer contaba como
  // orden de AYER. Medido en produccion el 2026-09-17: 152 de las 210 ordenes que el KPI
  // atribuia a «ayer» se habian cargado antes. La mutacion «devolver la ventana al `COALESCE`»
  // la caza `tests/integration/db/conteo-por-status-cohorte.int.test.ts` contra Postgres real,
  // con una orden cargada FUERA de la ventana y gestionada DENTRO — el caso exacto de las 152.
  condiciones.push(...ventanaDeCarga(rango));

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
