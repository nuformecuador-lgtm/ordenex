import { z } from "zod";
import { esFechaCalendarioValida, fechaCalendarioCR } from "@/lib/utils/fecha-cr";

// Feature 293 (design §7.3) — contratos I/O del PREMIO DEL RANKING en la cuenta por pagar.
// Frontera Server Action -> cliente. Money-safe (R35): todos los importes cruzan como STRING de
// escala 2; el cliente no recibe `Prisma.Decimal`, no divide y no resta.

/**
 * R9 — el estado del premio de una fila del podio, DERIVADO de los datos y no almacenado aparte.
 * Los seis son excluyentes y se resuelven en este orden:
 *
 *  1. `sin_premio`        — la fila no tiene monto congelado, o es cero (R7).
 *  2. `anulado`           — hay premio registrado Y su compensacion (R32: no se puede re-registrar).
 *  3. `registrado`        — hay premio y no esta anulado.
 *  4. `sin_cierre`        — no hay cierre de ese dia para ese mensajero (R11).
 *  5. `cierre_no_aprobado`— lo hay, pero no esta `aprobado` (R12).
 *  6. `no_registrado`     — todo listo, falta el acto humano.
 *
 * El orden importa: un premio YA registrado se sigue viendo como tal aunque su cierre cambiara de
 * estado despues. Lo que ya se escribio no se re-deriva.
 */
export type PremioPodioEstado =
  | "sin_premio"
  | "sin_cierre"
  | "cierre_no_aprobado"
  | "no_registrado"
  | "registrado"
  | "anulado";

/** Una fila del podio congelado tal como la pinta el panel de premios (R4/R5/R9). */
export interface PremioPodioDTO {
  /** `ranking_snapshot_fila.id`. Es lo UNICO que el cliente devuelve al registrar (R16). */
  filaId: string;
  posicion: number;
  /** Nombre CONGELADO (R4): un renombrado posterior no reescribe la historia. */
  mensajeroNombre: string;
  /** R5: SIEMPRE viajan, aunque sean 0 — es el aviso del podio por orden alfabetico. */
  entregadas: number;
  asignadas: number;
  /** STRING escala 2, o `null` si esa posicion no tenia premio ese dia. */
  premioMonto: string | null;
  premioDescripcion: string | null;
  estado: PremioPodioEstado;
  /** El estado del cierre resuelto, para el texto de R12. `null` si no hay cierre. */
  cierreEstado: string | null;
}

// ── Entradas, validadas con zod EN EL BORDE (design §7.3) ───────────────────────────────────

/**
 * R8 — la fecha debe ser una fecha calendario que EXISTA y NO puede ser posterior a hoy en Costa
 * Rica. Las dos comprobaciones van en el BORDE, antes de consultar o escribir nada.
 *
 * `esFechaCalendarioValida` hace el round-trip que caza `"2026-02-31"` —que un regex de forma
 * aceptaria y que `new Date` rueda en silencio al 3 de marzo—; es el mismo refinamiento que usa
 * `lib/actions/ranking-historico.ts`.
 *
 * La cota superior se compara como STRING contra `fechaCalendarioCR()`: dos fechas `YYYY-MM-DD`
 * se ordenan lexicograficamente igual que cronologicamente, asi que no hace falta convertir a
 * instante —y convertir seria justo donde se cuela el off-by-one de las 6 horas de CR—.
 */
export const listarPremiosDelDiaSchema = z
  .object({
    fecha: z
      .string()
      .refine(esFechaCalendarioValida, { message: "Fecha invalida: se espera YYYY-MM-DD." })
      .refine((f) => f <= fechaCalendarioCR(), {
        message: "La fecha no puede ser posterior a hoy.",
      }),
  })
  .strict();

export type ListarPremiosDelDiaInput = z.infer<typeof listarPremiosDelDiaSchema>;

/** R16 — del cliente solo viene CUAL fila se registra. Ni monto, ni mensajero, ni cierre. */
export const registrarPremioSchema = z
  .object({
    filaId: z.string().trim().min(1, "Falta la fila del podio."),
  })
  .strict();

export type RegistrarPremioInput = z.infer<typeof registrarPremioSchema>;

/**
 * R30 — la anulacion exige MOTIVO. Se recorta y no puede quedar vacio; el borde lo rechaza sin
 * escribir nada, y el motivo acaba en la descripcion del movimiento compensatorio.
 */
export const anularPremioSchema = z
  .object({
    filaId: z.string().trim().min(1, "Falta la fila del podio."),
    motivo: z.string().trim().min(1, "El motivo es obligatorio."),
  })
  .strict();

export type AnularPremioInput = z.infer<typeof anularPremioSchema>;
