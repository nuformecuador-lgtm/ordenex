import type { MetodoPagoValue } from "@prisma/client";

// Feature 36 (R5, decision F1.4-c): fuente unica de verdad del metodo de pago del
// recaudo en una ENTREGA, respaldada por el enum Postgres nativo
// `metodo_pago_value` (patron RolValue/VehiculoValue). OJO: 'SINPE' en mayusculas
// (medio de pago de Costa Rica; Feature 118 corrigio el typo historico del valor),
// coherente con el enum Prisma. La lista literal permite usar el SEED
// como tupla en z.enum (schemas de borde) sin perder la exhaustividad frente al
// enum Prisma:
//  - `satisfies readonly MetodoPagoValue[]` rompe el build si el SEED tiene un
//    valor que el enum NO tiene.
//  - el chequeo de tipo `_EnsureExhaustive` rompe el build si el enum gana un
//    valor que el SEED NO lista.
export const METODO_PAGO_SEED = ["efectivo", "SINPE", "transferencia"] as const satisfies readonly MetodoPagoValue[];

export type MetodoPago = (typeof METODO_PAGO_SEED)[number];

// Exhaustividad frente al enum Prisma: si `MetodoPagoValue` gana un valor que no
// esta en METODO_PAGO_SEED, `Exclude<...>` deja de ser `never` y el build rompe.
type _EnsureExhaustive = Exclude<MetodoPagoValue, MetodoPago> extends never ? true : never;
const _exhaustive: _EnsureExhaustive = true;
void _exhaustive;
