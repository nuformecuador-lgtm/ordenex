import type { PrismaClient } from "@prisma/client";

// FICHA 371 — LA CORRELACION DE «LA GESTION REPROGRAMADA VIGENTE DE UNA ORDEN», EN UN SOLO SITIO.
//
// ┌───────────────────────────────────────────────────────────────────────────────────────────┐
// │ LA REGLA, y este archivo existe para que tenga UN SITIO donde estar escrita:               │
// │                                                                                            │
// │   La gestion `reprogramada` VIGENTE de una orden es la mas RECIENTE por `created_at` entre  │
// │   las que tienen `resultado = 'reprogramada'` y `anulada_at IS NULL`. Quien necesite         │
// │   elegirla —el cron que libera, la correccion de su fecha, o lo que venga— la elige POR      │
// │   AQUI. No hay una segunda expresion equivalente en el arbol.                                │
// └───────────────────────────────────────────────────────────────────────────────────────────┘
//
// ⚠️ POR QUE SE COMPARTE Y NO SE COPIA. `LiberacionReprogramadaRepository` decide con esta
// correlacion QUE FECHA mira el cron de las 00:00 CR para soltar la orden. La ficha 371 corrige esa
// fecha. Si la correccion escribiera sobre una gestion elegida con su propia expresion, bastaria un
// dia con dos gestiones `reprogramada` vivas —o con la mas nueva anulada— para que las dos
// apuntaran a filas DISTINTAS: se corregiria una fecha que el cron no mira, la orden seguiria
// esperando al dia equivocado y la pantalla diria que quedo arreglada. Es el defecto mas caro de
// esta ficha, y ademas el mudo: las dos consultas devuelven filas plausibles.
//
// Compartiendo el objeto, DIVERGIR NO ES POSIBLE: cambiar el `orderBy` a `asc`, quitar el filtro de
// anuladas o subir el `take` cambia LOS DOS CAMINOS a la vez. Lo vigila ademas
// `tests/unit/guards/correccion-fecha-reprogramacion.guardia.test.ts` (ningun consumidor vuelve a
// escribirla en linea, y nadie mas en `lib/**` correlaciona por su cuenta) y se mide contra
// Postgres real en
// `tests/integration/db/correccion-fecha-reprogramacion.int.test.ts` (los dos caminos eligen LA
// MISMA gestion cuando hay varias).
//
// Modulo de DATOS: solo Prisma. Sin logica de negocio —quien decide que hacer con la gestion
// elegida son los servicios—.

/**
 * `resultado` de la gestion que fija una fecha de reprogramacion (feature 36). Se declara aqui
 * porque forma parte de la correlacion; los repositorios lo importan en vez de re-escribirlo.
 */
export const RESULTADO_REPROGRAMADA = "reprogramada";

/**
 * LA CORRELACION, como argumentos de Prisma listos para expandir con `...`.
 *
 * `anuladaAt: null` estaba en el camino del cron por DEFENSA y sin cambio funcional (feature 67):
 * una orden en `reprogramada` no puede tener su ultima gestion `reprogramada` anulada, porque
 * deshacerla la devuelve a `en_reparto`. En el camino de la CORRECCION deja de ser decorativo: ahi
 * no hay garantia de estado equivalente en el momento de leer, y una gestion anulada no es la que
 * decide nada.
 */
export const GESTION_REPROGRAMADA_VIGENTE = {
  where: { resultado: RESULTADO_REPROGRAMADA, anuladaAt: null },
  orderBy: { createdAt: "desc" },
  take: 1,
} as const;

/** Lo minimo que el cliente Prisma tiene que exponer para resolver la correlacion suelta. */
export type GestionVigenteTxClient = Pick<PrismaClient, "gestionOrden">;

/** La gestion elegida, con lo unico que la correccion necesita de ella. */
export interface GestionReprogramadaVigente {
  id: string;
  /** `@db.Date` a medianoche UTC. `null` = la gestion no fijo fecha (no se corrige: se rechaza). */
  fechaReprogramacion: Date | null;
}

/**
 * La gestion `reprogramada` vigente de UNA orden, o `null` si no tiene ninguna.
 *
 * Es la MISMA eleccion que hace el `select` anidado del cron, expresada como consulta suelta porque
 * ahi se parte de la orden y aqui de un `ordenId` conocido. Los tres argumentos que definen la
 * correlacion —`where`, `orderBy`, `take`— salen del objeto compartido; lo unico que se añade es el
 * `ordenId` que la acota.
 *
 * Acepta el `tx` de una `$transaction`: quien corrige necesita leerla DENTRO de su transaccion.
 */
export async function findGestionReprogramadaVigente(
  tx: GestionVigenteTxClient,
  ordenId: string,
): Promise<GestionReprogramadaVigente | null> {
  const [gestion] = await tx.gestionOrden.findMany({
    ...GESTION_REPROGRAMADA_VIGENTE,
    where: { ...GESTION_REPROGRAMADA_VIGENTE.where, ordenId },
    select: { id: true, fechaReprogramacion: true },
  });
  return gestion ?? null;
}
