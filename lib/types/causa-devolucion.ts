import type { GestionCausaDevolucion } from "@prisma/client";

// Feature 73 (R1/R2, decisiones F1.4-d/F1.4-g): fuente UNICA de verdad de la causa
// tipificada de una devolucion, respaldada por el enum Postgres nativo
// `gestion_causa_devolucion` (patron METODO_PAGO_SEED de la 36). Lista CERRADA de 3
// valores: sin "Otro" y sin reservar futuros. La lista literal permite usar el SEED
// como tupla en z.enum (schema de borde) sin perder la exhaustividad frente al enum
// Prisma:
//  - `satisfies readonly GestionCausaDevolucion[]` rompe el build si el SEED tiene un
//    valor que el enum NO tiene.
//  - el chequeo de tipo `_EnsureExhaustive` rompe el build si el enum gana un valor
//    que el SEED NO lista.
// Ese doble candado es lo que impide que Prisma, zod y la UI diverjan en silencio (R2).
// Los valores van en INGLES (F1.4-g, decision consciente del humano); las etiquetas en
// espanol viven en la capa de presentacion (R3, `causa-devolucion-options.ts`).
export const CAUSA_DEVOLUCION_SEED = [
  "not_found",
  "wrong_number",
  "wrong_address",
] as const satisfies readonly GestionCausaDevolucion[];

export type CausaDevolucion = (typeof CAUSA_DEVOLUCION_SEED)[number];

// Exhaustividad frente al enum Prisma: si `GestionCausaDevolucion` gana un valor que no
// esta en CAUSA_DEVOLUCION_SEED, `Exclude<...>` deja de ser `never` y el build rompe.
type _EnsureExhaustive = Exclude<GestionCausaDevolucion, CausaDevolucion> extends never ? true : never;
const _exhaustive: _EnsureExhaustive = true;
void _exhaustive;
