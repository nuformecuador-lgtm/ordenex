import { Prisma } from "@prisma/client";

import { ESTATUS_CON_GESTION_PENDIENTE, sqlExisteGestionPendiente } from "./gestion-pendiente";

/**
 * FICHA 454 (design §4.1, T1.3) — LA DERIVACION UNICA DE «AYUDA ABIERTA».
 *
 * Desde la 454 la ayuda a la tienda deja de ser el estado `ayuda_tienda`: la orden sigue
 * `en_reparto` y la ayuda es un HECHO (`orden_evento`). «Ayuda abierta» no se guarda en ninguna
 * parte; se DERIVA:
 *
 *   ayuda_abierta(o) ⇔ o.estatus = en_reparto
 *                    ∧ ¬ orden_con_gestion_pendiente(o)
 *                    ∧ e := ULTIMO orden_evento de o con tipo ∈ {ayuda_solicitada, ayuda_rescatada,
 *                          ayuda_habilitada_api}   (orden: created_at desc, id desc)
 *                    ∧ e.tipo = ayuda_solicitada
 *                    ∧ ¬∃ h ∈ orden_historial_estado(o) : h.created_at > e.created_at
 *
 * LO QUE LA CIERRA SIN QUE NADIE TENGA QUE ACORDARSE (la razon de la D1 de la 236: `orden.ayuda`
 * fugo porque una salida olvido apagarlo):
 *   - Recuperar / Habilitar / habilitar por API → evento de cierre explicito (su proposito).
 *   - La tienda gestiona desde la ayuda (237) → nace una gestion pendiente.
 *   - Corte nocturno, aprobacion, CUALQUIER transicion posterior → fila de historial posterior (y,
 *     casi siempre, estado ≠ `en_reparto`). Tambien si la orden vuelve mas tarde a `en_reparto`:
 *     la fila de historial de ese nuevo ciclo es posterior a la solicitud (R26).
 *   - Traspaso y cambio de dia NO la cierran: no escriben historial (R28, paridad con hoy).
 *
 * «Estrictamente posterior» es a proposito: la migracion M3 escribe el rastro de historial y el
 * evento de ayuda de una orden que estaba en `ayuda_tienda` con el MISMO instante, y la ayuda tiene
 * que quedar ABIERTA (R38).
 *
 * PUNTO UNICO: forma SQL (una expresion booleana sobre un alias de `orden`) y forma de ids para
 * componer un `where` de Prisma (`id: { in }`). Prisma no puede expresar «el ULTIMO evento» con un
 * filtro relacional, por eso no hay `Prisma.OrdenWhereInput` directo. La guardia
 * `tests/unit/guards/ayuda-abierta-unica-fuente.guardia.test.ts` prohibe mencionar
 * `ayuda_solicitada` en un `where` fuera de este modulo.
 */

/** Los tres tipos de evento de la ayuda: el ULTIMO decide. */
const TIPOS_AYUDA = Prisma.sql`('ayuda_solicitada', 'ayuda_rescatada', 'ayuda_habilitada_api')`;

function columnas(alias: string): { id: Prisma.Sql; estatusId: Prisma.Sql } {
  if (!/^[a-z_][a-z0-9_]*$/.test(alias)) throw new Error(`alias SQL invalido: ${alias}`);
  return { id: Prisma.raw(`"${alias}"."id"`), estatusId: Prisma.raw(`"${alias}"."estatus_id"`) };
}

/**
 * Expresion SQL booleana: la orden con alias `alias` (por defecto `"o"`) tiene ayuda ABIERTA.
 */
export function sqlAyudaAbierta(alias = "o"): Prisma.Sql {
  const o = columnas(alias);
  return Prisma.sql`(
    EXISTS (
      SELECT 1 FROM "order_status" "aa_s"
       WHERE "aa_s"."id" = ${o.estatusId} AND "aa_s"."value" = ${ESTATUS_CON_GESTION_PENDIENTE}
    )
    AND NOT ${sqlExisteGestionPendiente(o.id)}
    AND EXISTS (
      SELECT 1
        FROM (
          SELECT "aa_e"."tipo", "aa_e"."created_at"
            FROM "orden_evento" "aa_e"
           WHERE "aa_e"."orden_id" = ${o.id}
             AND "aa_e"."tipo" IN ${TIPOS_AYUDA}
           ORDER BY "aa_e"."created_at" DESC, "aa_e"."id" DESC
           LIMIT 1
        ) "aa_ult"
       WHERE "aa_ult"."tipo" = 'ayuda_solicitada'
         AND NOT EXISTS (
           SELECT 1 FROM "orden_historial_estado" "aa_h"
            WHERE "aa_h"."orden_id" = ${o.id}
              AND "aa_h"."created_at" > "aa_ult"."created_at"
         )
    )
  )`;
}

/** Lo minimo que hace falta para ejecutar la consulta: el `$queryRaw` de un cliente o de una tx. */
export interface ClienteSqlAyuda {
  $queryRaw<T = unknown>(query: Prisma.Sql): Prisma.PrismaPromise<T>;
}

/**
 * Los ids de las ordenes con ayuda ABIERTA que ademas cumplen `filtro` (una condicion SQL sobre el
 * alias `"o"`; por defecto, ninguna). Es la forma de componer la derivacion con un `where` de Prisma:
 * `{ id: { in: await idsConAyudaAbierta(cliente, filtro) } }`.
 */
export async function idsConAyudaAbierta(
  cliente: ClienteSqlAyuda,
  filtro: Prisma.Sql = Prisma.sql`TRUE`,
): Promise<string[]> {
  const filas = await cliente.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT "o"."id" FROM "orden" "o"
     WHERE ${filtro}
       AND ${sqlAyudaAbierta("o")}`);
  return filas.map((f) => f.id);
}

/** De `ordenIds`, las que tienen ayuda ABIERTA. Lista vacia → sin consulta. */
export async function conAyudaAbiertaDe(
  cliente: ClienteSqlAyuda,
  ordenIds: readonly string[],
): Promise<Set<string>> {
  if (ordenIds.length === 0) return new Set();
  return new Set(
    await idsConAyudaAbierta(cliente, Prisma.sql`"o"."id" IN (${Prisma.join([...ordenIds])})`),
  );
}
