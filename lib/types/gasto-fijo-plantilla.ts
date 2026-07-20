import { z } from "zod";
import { montoPositivoSchema } from "@/lib/types/wallet";
import { fechaCalendarioCR } from "@/lib/utils/fecha-cr";
import type { PeriodicidadUnidad } from "@/lib/utils/periodicidad";

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
  // Feature 84 — periodicidad del ciclo (diaria = 1 dias; semanal = 1 semanas; quincenal =
  // 2 semanas; mensual = 1 meses; y cualquier otra).
  periodicidadUnidad: PeriodicidadUnidad;
  periodicidadCantidad: number;
  fechaCobro: string; // `YYYY-MM-DD`: ancla del ciclo (primer cobro). Date, NO ISO datetime.
  createdAt: string; // ISO
  updatedAt: string; // ISO
};

// ── Schemas zod de borde ──

// Feature 84 — fragmento de periodicidad compartido por crear/actualizar.
//
// TODOS OPCIONALES CON DEFAULT, a proposito: la UI actual (`GastoFijoPlantillaDialog`, feature
// 85) todavia NO envia periodicidad ni fecha de cobro. Con estos defaults la pantalla sigue
// funcionando sin cambios y una plantilla creada hoy se comporta como antes (mensual). Cuando la
// 85 empiece a mandar los campos, el mismo schema los valida sin tocar nada aca.
const periodicidadFields = {
  periodicidadUnidad: z.enum(["dias", "semanas", "meses"]).default("meses"),
  periodicidadCantidad: z.coerce.number().int().min(1, "La cantidad debe ser al menos 1.").default(1),
  // Default = hoy en hora CR (no `new Date()`: `fechaCalendarioCR` evita el off-by-one de UTC).
  // Se evalua por parseo, asi que no se congela al cargar el modulo.
  fechaCobro: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha de cobro debe tener el formato YYYY-MM-DD.")
    .default(() => fechaCalendarioCR()),
};

// R24: crear plantilla = concepto no vacio + monto STRING > 0 (hasta 2 decimales). `activa`
// no se envia (arranca en true por default en la DB/repo).
export const crearGastoFijoPlantillaSchema = z.object({
  concepto: z.string().trim().min(1, "El concepto es obligatorio."),
  monto: montoPositivoSchema,
  ...periodicidadFields,
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
