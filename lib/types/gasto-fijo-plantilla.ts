import { z } from "zod";
import { montoPositivoSchema } from "@/lib/types/wallet";

// Feature 45 (design §1.2/§2.3) — tipos y schemas de borde de la PLANTILLA de gasto fijo
// (configuracion recurrente que el maestro administra; el cron deriva los egresos). Money-safe
// (R12/R24): el `monto` entra/sale como STRING (nunca number). Reutiliza `montoPositivoSchema`
// de la wallet (STRING, > 0, hasta 2 decimales).

// ── Contrato I/O (frontera Server Action -> cliente). Montos SIEMPRE STRING (R12) ──
export type GastoFijoPlantillaDTO = {
  id: string;
  concepto: string;
  monto: string; // Decimal -> STRING 2 dec (R12)
  activa: boolean;
  createdAt: string; // ISO
  updatedAt: string; // ISO
};

// ── Schemas zod de borde ──

// R24: crear plantilla = concepto no vacio + monto STRING > 0 (hasta 2 decimales). `activa`
// no se envia (arranca en true por default en la DB/repo).
export const crearGastoFijoPlantillaSchema = z.object({
  concepto: z.string().trim().min(1, "El concepto es obligatorio."),
  monto: montoPositivoSchema,
});

export type CrearGastoFijoPlantillaInput = z.infer<typeof crearGastoFijoPlantillaSchema>;

// R25: editar concepto/monto de una plantilla existente (identificada por id uuid).
export const actualizarGastoFijoPlantillaSchema = crearGastoFijoPlantillaSchema.extend({
  id: z.string().uuid(),
});

export type ActualizarGastoFijoPlantillaInput = z.infer<
  typeof actualizarGastoFijoPlantillaSchema
>;

// R25: activar/desactivar una plantilla (sin borrado; la desactivacion detiene el cron).
export const setActivaPlantillaSchema = z.object({
  id: z.string().uuid(),
  activa: z.boolean(),
});

export type SetActivaPlantillaInput = z.infer<typeof setActivaPlantillaSchema>;
