import { z } from "zod";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 458-E (TE.2, R59; design §6) — el filtro «A quién» del libro de la caja.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// Archivo HOJA a proposito: lo importa `lib/types/wallet.ts` (el filtro del libro) y no importa nada
// del dominio, para no cerrar un ciclo `wallet.ts → … → wallet.ts`.
//
// Dos formas, las de design §6:
//   · `{ tipo: "tienda" | "mensajero", id }` — la CUENTA a la que se le pago o de la que vino el
//     dinero, resuelta con la MISMA tabla de origenes que «A quién» (design §3.4,
//     `LibroCajaAutoriaService`).
//   · `{ nombre }` — el nombre libre anotado a mano en un sueldo, un gasto o una correccion (458-B,
//     `wallet_anotacion.contraparte_nombre`). Se compara sin mayusculas ni espacios de los bordes.
// El id viaja y nunca se pinta (H6): lo da el selector (`quienesDelLibroCajaAction`), no la persona.

/**
 * Tope del nombre libre del filtro: el MISMO que el del campo «A quién» al registrar
 * (`PAGO_POR_CUENTA_BENEFICIARIO_MAX`, 120). No se importa de alli porque ese modulo importa
 * `wallet.ts` (ciclo); `tests/unit/types/libro-caja-a-quien.test.ts` afirma que son iguales.
 */
export const A_QUIEN_NOMBRE_MAX = 120;

export const A_QUIEN_CUENTA_SEED = ["tienda", "mensajero"] as const;
export type AQuienCuentaTipo = (typeof A_QUIEN_CUENTA_SEED)[number];

export const aQuienFiltroSchema = z.union([
  z.object({ tipo: z.enum(A_QUIEN_CUENTA_SEED), id: z.string().uuid() }).strict(),
  z.object({ nombre: z.string().trim().min(1).max(A_QUIEN_NOMBRE_MAX) }).strict(),
]);

export type AQuienFiltro = z.infer<typeof aQuienFiltroSchema>;
