import { z } from "zod";

// Feature 115 — validacion de borde (zod) + resultado tipado del toggle "gestionar mas
// tarde". Patron `lib/types/gestion-orden.ts`: zod en el borde (Server Action) y resultado
// DISCRIMINADO por `status`. El service devuelve `forbidden`/`not_found` como resultado de
// dominio; el borde agrega `unauthenticated` (R10) y `validation_error` (R9).

// R9: el toggle recibe un valor EXPLICITO de `marcarLuego` (no un flip ciego leido-y-negado),
// para ser idempotente y seguro ante concurrencia ([D2]). `ordenId` no vacio.
export const marcarLuegoSchema = z.object({
  ordenId: z.string().min(1),
  marcarLuego: z.boolean(),
});
export type MarcarLuegoInput = z.infer<typeof marcarLuegoSchema>;

// Resultado expuesto por la Server Action. `ok` refleja el valor persistido; el resto son los
// rechazos de dominio/borde. Espejo de la tabla del design §2.4.
export type MarcarLuegoResult =
  | { status: "ok"; ordenId: string; marcarLuego: boolean }
  | { status: "unauthenticated" } // R10
  | { status: "forbidden" } // R11/R13
  | { status: "not_found" } // R14
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }; // R9
