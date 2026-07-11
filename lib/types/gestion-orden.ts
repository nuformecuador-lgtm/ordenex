import { z } from "zod";
import { GESTION_ALLOWED_MIME, gestionConfig } from "@/lib/config/gestion";
import { METODO_PAGO_SEED } from "@/lib/types/metodo-pago";
import type {
  DetalleConflicto,
  MiAsignacionDTO,
} from "@/lib/interfaces/services/IMisAsignacionesService";

// Feature 36 — validacion de borde (zod) del flujo del mensajero. Los schemas se
// usan en la Server Action (borde) y las reglas de foto se reutilizan en cliente
// y servidor (R24). El File real (evidencia) lo lee la action del FormData; aqui
// se valida su forma file-like (tipo/tamano) sin depender del global File.

/** Forma minima file-like validable en cliente y servidor (R24). */
export interface ArchivoLike {
  type: string;
  size: number;
}

/**
 * Valida tipo MIME (imagen) y tamano de la evidencia (R24). Devuelve el mensaje
 * de error o null si es valida. Reutilizable en cliente (antes de enviar) y en
 * servidor (revalidacion de borde). No depende del global File.
 */
export function validarEvidencia(
  archivo: ArchivoLike | null | undefined,
  maxBytes: number = gestionConfig.MAX_FILE_BYTES,
): string | null {
  if (!archivo) return "evidencia requerida";
  if (!(GESTION_ALLOWED_MIME as readonly string[]).includes(archivo.type)) {
    return "la evidencia debe ser una imagen jpeg, png o webp";
  }
  if (archivo.size <= 0) return "evidencia vacia";
  if (archivo.size > maxBytes) {
    return `la evidencia no debe superar ${Math.floor(maxBytes / (1024 * 1024))} MB`;
  }
  return null;
}

/** Schema zod de la evidencia: exige file-like que pase validarEvidencia (R24). */
const evidenciaSchema = z.custom<ArchivoLike>(
  (value) =>
    typeof value === "object" &&
    value !== null &&
    typeof (value as ArchivoLike).type === "string" &&
    typeof (value as ArchivoLike).size === "number" &&
    validarEvidencia(value as ArchivoLike) === null,
  { message: "la evidencia debe ser una imagen jpeg, png o webp de tamano permitido" },
);

// R16: recoger recibe un conjunto NO vacio de ordenIds (lote o de a una).
export const recogerSchema = z.object({
  ordenIds: z.array(z.string().min(1)).min(1),
});
export type RecogerActionInput = z.infer<typeof recogerSchema>;

// R19-R21: escoger una orden para gestionarla (fija el bloqueo 1-a-1).
export const escogerSchema = z.object({
  ordenId: z.string().min(1),
});
export type EscogerActionInput = z.infer<typeof escogerSchema>;

/** True si `value` (YYYY-MM-DD) representa una fecha estrictamente futura (R25). */
export function esFechaFutura(value: string): boolean {
  const fecha = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(fecha.getTime())) return false;
  const hoy = new Date();
  const hoyUtc = Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate());
  return fecha.getTime() > hoyUtc;
}

const fechaFuturaSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "fecha invalida")
  .refine(esFechaFutura, "la fecha debe ser futura");

const motivoSchema = z.string().trim().min(1, "motivo requerido");

// R22/R25/R27/R29: entrada de gestion DISCRIMINADA por `resultado` con las
// obligatoriedades por rama (decision F1.4-i). La evidencia (File) va en el mismo
// schema como file-like (obligatoria en entrega/rechazo).
export const gestionarSchema = z.discriminatedUnion("resultado", [
  z.object({
    ordenId: z.string().min(1),
    resultado: z.literal("entregada"),
    montoRecibido: z.number().positive("monto requerido"),
    metodoPago: z.enum(METODO_PAGO_SEED),
    evidencia: evidenciaSchema,
  }),
  z.object({
    ordenId: z.string().min(1),
    resultado: z.literal("reprogramada"),
    fechaReprogramacion: fechaFuturaSchema,
    motivo: motivoSchema,
  }),
  z.object({
    ordenId: z.string().min(1),
    resultado: z.literal("devuelta"),
    motivo: motivoSchema,
  }),
  z.object({
    ordenId: z.string().min(1),
    resultado: z.literal("rechazada"),
    motivo: motivoSchema,
    evidencia: evidenciaSchema,
  }),
]);
export type GestionarActionInput = z.infer<typeof gestionarSchema>;

// --- Resultados expuestos por la Server Action (agregan `unauthenticated`) ---

export type ListarMisAsignacionesResult =
  | {
      status: "ok";
      porRecoger: MiAsignacionDTO[];
      porGestionar: MiAsignacionDTO[];
      ordenEnGestionId: string | null;
    }
  | { status: "unauthenticated" } // R12
  | { status: "forbidden" }; // R12

export type RecogerResult =
  | { status: "ok"; recogidas: string[] }
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "conflict"; detalle: DetalleConflicto[] };

export type EscogerResult =
  | { status: "ok"; ordenId: string }
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "conflict"; motivo: string };

export type GestionarResult =
  | { status: "ok"; ordenId: string; estado: string; evidenciaUrl?: string }
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "conflict"; motivo: string };
