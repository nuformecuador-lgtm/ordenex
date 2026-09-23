import { Prisma } from "@prisma/client";

/**
 * FICHA 454 (design §3, T1.3) — EL PREDICADO UNICO DE «GESTION PENDIENTE DE CONFIRMAR».
 *
 * Con la 454 la gestion de calle ya no mueve la orden: la orden se queda `en_reparto` y el estado
 * real se aplica al APROBAR el cierre (§7). Mientras tanto la gestion esta «pendiente», y media
 * aplicacion tiene que saberlo: la guardia de gestionabilidad (no gestionar dos veces), el portal
 * del mensajero (no listarla ni pintarla ni darla como parada), la precondicion del cierre, el
 * corte nocturno (NO barrerla: barrerla puede acabar en un rechazo que COBRA), el traspaso, la
 * correccion de dia y la carga del mensajero.
 *
 * Una gestion esta PENDIENTE si y solo si:
 *   1. NO esta anulada;
 *   2. es una gestion de CALLE del modelo nuevo: tiene su evento `gestion_registrada`. Las
 *      gestiones LEGADAS (registradas antes del despliegue, que ya transicionaron la orden al
 *      registrarse) y las SINTETICAS (escalado, tope, reprogramacion y rechazo de escritorio) no lo
 *      tienen NUNCA, y por eso nunca estan pendientes (design DH);
 *   3. su cierre NO esta aprobado: sin cierre, `solicitado`, `vencido` o `rechazado` (R13, R59).
 *
 * Y una ORDEN tiene gestion pendiente si esta `en_reparto` y tiene al menos una. «En mano» =
 * `en_reparto` sin gestion pendiente.
 *
 * NO MIRA `mensajero_id` A PROPOSITO: si alguna via desconocida moviera de mensajero una orden con
 * gestion pendiente, la direccion segura es BLOQUEAR al nuevo (visible, arreglable) y no dejarle
 * gestionar por segunda vez (dinero doble).
 *
 * PUNTO UNICO: tres formas del MISMO predicado. La guardia
 * `tests/unit/guards/gestion-pendiente-unica-fuente.guardia.test.ts` prohibe mencionar
 * `gestion_registrada` en un `where` fuera de este modulo (y de `ayuda-abierta.ts`, que lo compone).
 *
 * Sin columna mutable en `orden` ni en `gestion_orden` (design DE): la aprobacion, el deshacer y la
 * salida de estado lo cierran por construccion, sin que nadie tenga que acordarse de apagar nada.
 */

/** El valor del catalogo `order_status` donde vive toda gestion pendiente. */
export const ESTATUS_CON_GESTION_PENDIENTE = "en_reparto";

/**
 * La condicion 2 sola, nivel GESTION: es una gestion de CALLE del modelo nuevo (tiene su evento
 * `gestion_registrada`). Exportada para la 6.ª condicion de intentos (design §10, segunda via de
 * inclusion) y para la aplicacion al aprobar (§7.2), que la necesitan SIN las otras dos.
 */
export function whereTieneRegistroDeCalle(): Prisma.GestionOrdenWhereInput {
  return { eventos: { some: { tipo: "gestion_registrada" } } };
}

/** Forma Prisma, nivel GESTION. */
export function whereGestionPendiente(): Prisma.GestionOrdenWhereInput {
  return {
    anuladaAt: null,
    ...whereTieneRegistroDeCalle(),
    OR: [{ cierreId: null }, { cierre: { estado: { not: "aprobado" } } }],
  };
}

/** Forma Prisma, nivel ORDEN: `en_reparto` con al menos una gestion pendiente. */
export function whereOrdenConGestionPendiente(): Prisma.OrdenWhereInput {
  return {
    estatus: { value: ESTATUS_CON_GESTION_PENDIENTE },
    gestiones: { some: whereGestionPendiente() },
  };
}

/**
 * Forma Prisma, nivel ORDEN, NEGADA: la orden NO tiene ninguna gestion pendiente. No dice nada del
 * estado: quien la usa ya filtra por `en_reparto` (la combinacion es «en mano»).
 */
export function whereOrdenSinGestionPendiente(): Prisma.OrdenWhereInput {
  return { gestiones: { none: whereGestionPendiente() } };
}

/**
 * Fragmento SQL crudo: la gestion pendiente EXISTE para la orden cuyo id es `columnaOrdenId`
 * (por defecto `"o"."id"`). Para los repositorios que escriben con `$queryRaw` (corte, traspaso) y
 * para componer la ayuda abierta. MISMO predicado que `whereGestionPendiente`, condicion a
 * condicion (lo mide `tests/integration/db/454/gestion-pendiente-sql-real.test.ts`).
 */
export function sqlExisteGestionPendiente(
  columnaOrdenId: Prisma.Sql = Prisma.sql`"o"."id"`,
): Prisma.Sql {
  return Prisma.sql`EXISTS (
    SELECT 1
      FROM "gestion_orden" "gp"
      LEFT JOIN "cierre_dia" "gpc" ON "gpc"."id" = "gp"."cierre_id"
     WHERE "gp"."orden_id" = ${columnaOrdenId}
       AND "gp"."anulada_at" IS NULL
       AND EXISTS (
         SELECT 1 FROM "orden_evento" "gpe"
          WHERE "gpe"."gestion_orden_id" = "gp"."id"
            AND "gpe"."tipo" = 'gestion_registrada'
       )
       AND ("gp"."cierre_id" IS NULL OR "gpc"."estado" <> 'aprobado')
  )`;
}

/** Fragmento SQL crudo, negado: la orden `"o"` NO tiene gestion pendiente. */
export const SQL_ORDEN_SIN_GESTION_PENDIENTE: Prisma.Sql = Prisma.sql`NOT ${sqlExisteGestionPendiente()}`;
