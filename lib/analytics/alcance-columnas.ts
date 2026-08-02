// Feature 122 (T3.1) — ADAPTADORES: del alcance resuelto al fragmento de `where`.
//
// Este es el UNICO archivo de la 122 que nombra columnas, a proposito (design.md §2):
// asi la pregunta "¿quien decide que columna encarna el recorte de zona?" tiene UNA
// respuesta y un guardia puede leerla (`alcance-columnas.guardia.test.ts`, R5/R7).
//
// Las tres columnas canonicas son FIJAS y sin variantes por metrica (D3):
//   zona      => `orden.zona_id`                  (NOT NULL, db/schema.prisma:469)
//   tienda    => `orden.tienda_id`                (FK a `usuario`, :468/:505)
//   mensajero => `orden.mensajero_asignado_id`    (:478, "unica fuente de verdad")
//
// Lo que este archivo NO usa, aunque este a mano y sea NOT NULL:
// `gestion_orden.mensajero_id` (`db/schema.prisma:651`). Recortar gestiones por su
// propio actor daria un recorte DISTINTO al de la orden y romperia D3/R7/R24. Los TRES
// recortes de `gestion_orden` —zona, tienda y mensajero— pasan por la relacion `orden`.
// La asimetria (una tabla con columna propia de mensajero que se recorta por la
// relacion) es intencional: es exactamente lo que D3 compro.
//
// `import type { Prisma }` es la unica concesion al cliente generado y el guardia de la
// 135 la autoriza explicitamente: desaparece en compilacion, no exige `DATABASE_URL` y a
// cambio el compilador verifica CADA nombre de columna. Escribir `zona_id` en vez de
// `zonaId` deja de ser un recorte silenciosamente vacio para ser un error de build.
//
// R25 — aqui NO hay, y no debe haber, adaptador para `wallet_movimiento`,
// `wallet_tienda_movimiento`, `pago_mensajero_movimiento`, `cierre_dia` ni
// `cierre_bodega`: para toda metrica financiera el alcance es `total` o `prohibido`
// (`lib/analytics/metrics.ts`), nunca `acotado`. Un adaptador de dinero significaria que
// alguien abrio un recorte financiero sin disenarlo. El guardia
// `alcance-dinero.guardia.test.ts` lo vigila por los dos lados.

import type { Prisma } from "@prisma/client";
import type { AlcanceDatos } from "@/lib/analytics/alcance";

/**
 * Fragmento de `where` para la tabla `orden`.
 *
 * `global` => `{}` (fragmento vacio), y eso SOLO se produce cuando la metrica declara
 * `total` para el rol: el resolutor no emite `global` por ninguna otra via.
 */
export function whereOrden(alcance: AlcanceDatos): Prisma.OrdenWhereInput {
  switch (alcance.tipo) {
    case "global":
      return {};
    case "zona":
      return { zonaId: alcance.zonaId };
    case "tienda":
      return { tiendaId: alcance.tiendaId };
    case "mensajero":
      return { mensajeroAsignadoId: alcance.mensajeroId };
  }
}

/**
 * Fragmento de `where` para `gestion_orden`.
 *
 * Los tres recortes pasan por la relacion `orden` (R24). No es una preferencia de
 * estilo: `gestion_orden` no tiene columnas de zona ni de tienda
 * (`db/schema.prisma:648-694`: solo `orden_id` y `mensajero_id`), y su `mensajero_id`
 * NO es la fuente de verdad del mensajero de una orden (D3).
 */
export function whereGestionOrden(alcance: AlcanceDatos): Prisma.GestionOrdenWhereInput {
  if (alcance.tipo === "global") return {};
  return { orden: whereOrden(alcance) };
}

/**
 * Fragmento de `where` para el rollup diario `analytics_daily`.
 *
 * Devuelve un objeto plano y no `Prisma.AnalyticsDailyWhereInput` porque la tabla NO
 * EXISTE todavia: la crea la feature 123 y tipar contra un modelo inexistente no
 * compilaria. Las claves son las MISMAS que ya usa `orden` (camelCase de Prisma) para
 * que el dia que la 123 aterrice el cambio sea de tipo, no de vocabulario
 * (aviso dirigido en `design.md §7`).
 */
export function whereRollup(alcance: AlcanceDatos): Record<string, string> {
  switch (alcance.tipo) {
    case "global":
      return {};
    case "zona":
      return { zonaId: alcance.zonaId };
    case "tienda":
      return { tiendaId: alcance.tiendaId };
    case "mensajero":
      return { mensajeroAsignadoId: alcance.mensajeroId };
  }
}
