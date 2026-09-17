// LA VENTANA DE CARGA: `[desde, hasta)` sobre `orden.created_at`. UNA definicion, tres lecturas.
//
// ─── FICHA 441 — QUE ES Y CONTRA QUE EXISTE ─────────────────────────────────────────────
//
// «Cargadas en el periodo» y «con actividad en el periodo» son dos poblaciones distintas, y la
// diferencia no es de matiz. MEDIDO CONTRA PRODUCCION el 2026-09-17, para el dia anterior:
//
//   | ventana                                   | ordenes | entregadas | efectividad |
//   | ----------------------------------------- | ------- | ---------- | ----------- |
//   | `COALESCE(ultima gestion, o.created_at)`  |   210   |    103     |   49,0 %    |
//   | `o.created_at` (esta)                     |    75   |     11     |   14,7 %    |
//
// 152 de aquellas 210 se cargaron ANTES del dia pedido: tres cuartas partes de la cifra eran
// arrastre. El humano pidio la de abajo: «de las cargadas, cuantas ya se entregaron, ese es el
// verdadero numero».
//
// ⚠ POR QUE ESTO ES UNA FUNCION Y NO DOS LINEAS COPIADAS EN CADA REPOSITORIO. Antes de esta
// ficha el fragmento estaba escrito TRES veces —`ConteoCargadasPorDiaRepository`,
// `CohorteCargaRepository` y, con el `COALESCE` equivocado, `ConteoPorStatusRepository`— y la
// tercera copia es exactamente donde vivia el defecto. Una ventana mal puesta NO ROMPE NADA
// VISIBLE: no hay excepcion, no hay fila de mas, no hay tipo que no compile; salen conteos
// plausibles de una poblacion que no es la que dice el rotulo. Con una sola definicion, mover la
// ventana de una lectura y no de las otras deja de ser algo que pueda pasar por descuido.
//
// ⚠ LO QUE ESTA FUNCION NO ES: la ventana de CICLO DE VIDA. `CicloVidaRepository` acota la
// transicion TERMINAL (`condicionDeVentanaTerminal`, sobre `h."created_at"`) porque contesta «de
// lo que CERRO esta semana, cuanto tardo», y una orden creada en enero y cerrada en agosto cuenta
// alli en AGOSTO. Aqui cuenta en ENERO. Las dos son correctas para su pregunta y NO deben
// converger nunca; por eso aquella no usa esta funcion y no es una omision.
//
// ─── POR QUE VIVE EN `lib/repositories/` Y NO EN `lib/analytics/` ───────────────────────
//
// Porque produce `Prisma.Sql`, y `lib/analytics/` es el modulo FUNDACIONAL que trece features
// importan: alli `@prisma/client` esta PROHIBIDO como import de valor —arrastra el cliente
// generado, que exige `DATABASE_URL` y un `prisma generate` previo— y lo vigila
// `tests/unit/analytics/modulo-puro.guardia.test.ts`. Se intento ponerlo alli primero y ese
// guardia lo rechazo, que es exactamente su trabajo. Aqui, en cambio, esta en compania: la
// vertical ya tiene `condicionDeAlcance` y `condicionesSinFecha` como fragmentos compartidos
// entre repositorios, solo que viviendo dentro del archivo de uno de ellos. Este sale a un
// archivo propio para que no herede el ciclo de importacion de ninguno de los tres.
//
// ─── LA FRONTERA DEL DIA NO SE DECIDE AQUI ──────────────────────────────────────────────
//
// Ni una zona horaria en este archivo. Las COTAS las trae `resolverRango`
// (`inicioDelDiaCREnUtc` / `inicioDelDiaSiguienteCREnUtc`, todo borde en `...T06:00:00.000Z`) y
// aqui solo se comparan. `startOfDayCR` seria la medianoche UTC de la fecha CR: correcta contra
// columnas `@db.Date` y un error de SEIS HORAS contra un `timestamp` como `orden.created_at`.

import { Prisma } from "@prisma/client";

import type { RangoResuelto } from "@/lib/analytics/types";

/**
 * Las condiciones de la ventana de carga, o NINGUNA si no hay rango.
 *
 * Espera el alias `o` para `orden`, que es el que usan las cuatro consultas de la vertical.
 *
 * DOS DECISIONES QUE NO SON DE ESTILO:
 *
 * 1. **SEMIABIERTA `[desde, hasta)`.** `resolverRango` devuelve `hasta` como las 00:00 CR del dia
 *    SIGUIENTE, justamente para que `hastaFecha` sea inclusiva. Un `<=` aqui meteria el dia
 *    siguiente ENTERO en todas las lecturas a la vez.
 *
 * 2. **Sin rango se devuelve la lista VACIA, no un `TRUE`.** Quien construye el `where` une con
 *    `AND` una lista de fragmentos, asi que «ninguna condicion» se expresa no aportando ninguna.
 *    La pantalla no arranca con ventana puesta y «sin filtrar» tiene que contar TODAS las
 *    ordenes (decision del 2026-08-18), no las de una semana.
 *
 * Las cotas viajan como PARAMETROS (`$n`), nunca interpoladas.
 */
export function ventanaDeCarga(rango: RangoResuelto | null): Prisma.Sql[] {
  if (rango === null) return [];

  return [
    Prisma.sql`o."created_at" >= ${rango.desde}`,
    Prisma.sql`o."created_at" <  ${rango.hasta}`,
  ];
}
