import { METODO_PAGO_SEED, type MetodoPago } from "@/lib/types/metodo-pago";
import type { SelectOption } from "@/components/ui/select";

// Feature 36 (R22, F1.4-i): etiquetas legibles del método de pago del recaudo.
// La fuente de verdad de los valores es METODO_PAGO_SEED (enum Postgres nativo);
// aquí solo se presenta cada valor. Añadir un valor al enum rompe el build por el
// Record exhaustivo (no silencioso).
export const METODO_PAGO_LABEL: Record<MetodoPago, string> = {
  efectivo: "Efectivo",
  SIMPE: "SIMPE",
  transferencia: "Transferencia",
};

/** Opciones del select de método de pago (entrega). */
export const METODO_PAGO_OPTIONS: SelectOption[] = METODO_PAGO_SEED.map(
  (value) => ({ value, label: METODO_PAGO_LABEL[value] }),
);
