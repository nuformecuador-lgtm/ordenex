import type { GestionCausaIncidente } from "@prisma/client";

// Feature 158 (R9, decision Q-B del humano del 2026-07-30): fuente UNICA de verdad de la
// causa tipificada de un INCIDENTE, respaldada por el enum Postgres nativo
// `gestion_causa_incidente`. Calcado del patron de `causa-devolucion.ts` (73). Lista CERRADA
// de 3 valores: sin "Otro" y sin reservar futuros. La lista literal permite usar el SEED como
// tupla en `z.enum` (schema de borde) sin perder la exhaustividad frente al enum Prisma:
//  - `satisfies readonly GestionCausaIncidente[]` rompe el build si el SEED tiene un valor
//    que el enum NO tiene.
//  - el chequeo de tipo `_EnsureExhaustive` rompe el build si el enum gana un valor que el
//    SEED NO lista.
// Ese doble candado es lo que impide que Prisma, zod y la UI diverjan en silencio.
//
// IDIOMA — los valores van en ESPANOL, y eso ROMPE A PROPOSITO la coherencia con
// `CAUSA_DEVOLUCION_SEED`, que esta en INGLES. Las dos son decisiones CONSCIENTES del humano,
// tomadas en la puerta F1.4 de su feature (73/F1.4-g y 158/Q-B, `design.md` §0.3): esta
// acompana a `gestion_resultado` y al catalogo `order_status`, que estan en espanol. NO es
// deuda tecnica ni un descuido — no abrir tickets de "consistencia" por esto en ninguna de las
// dos direcciones. Las etiquetas de UI viven en la capa de presentacion, no aqui.
export const CAUSA_INCIDENTE_SEED = [
  "danado",
  "perdido",
  "robado",
] as const satisfies readonly GestionCausaIncidente[];

export type CausaIncidente = (typeof CAUSA_INCIDENTE_SEED)[number];

// Exhaustividad frente al enum Prisma: si `GestionCausaIncidente` gana un valor que no esta
// en CAUSA_INCIDENTE_SEED, `Exclude<...>` deja de ser `never` y el build rompe.
type _EnsureExhaustive = Exclude<GestionCausaIncidente, CausaIncidente> extends never
  ? true
  : never;
const _exhaustive: _EnsureExhaustive = true;
void _exhaustive;
