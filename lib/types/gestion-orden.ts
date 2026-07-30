import { z } from "zod";
import { GESTION_ALLOWED_MIME, gestionConfig } from "@/lib/config/gestion";
import { METODO_PAGO_SEED } from "@/lib/types/metodo-pago";
import { mananaCalendarioCR } from "@/lib/utils/fecha-cr";
import { CAUSA_DEVOLUCION_SEED } from "@/lib/types/causa-devolucion";
import { CAUSA_INCIDENTE_SEED } from "@/lib/types/causa-incidente";
import { ubicacionSchema } from "@/lib/types/ruta-mensajero";
import type {
  DetalleConflicto,
  MiAsignacionDTO,
  MisAsignacionesKpis,
  RutaResumenDTO,
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

// Feature 119 (R5/R6/R7/R8): la evidencia UNICA pasa a una LISTA de 1..N fotos. Cada foto se
// valida POR ARCHIVO con el `evidenciaSchema` de la 36/75 (R8: una foto invalida invalida el
// envio); la lista exige al menos 1 (R6) y como maximo `MAX_EVIDENCIAS_POR_GESTION` (R7, def 3).
const evidenciasSchema = z
  .array(evidenciaSchema)
  .min(1, "se requiere al menos una foto de evidencia") // R6
  .max(
    gestionConfig.MAX_EVIDENCIAS_POR_GESTION,
    `maximo ${gestionConfig.MAX_EVIDENCIAS_POR_GESTION} fotos de evidencia`,
  ); // R7

// R16: recoger recibe un conjunto NO vacio de ordenIds (lote o de a una).
// Feature 92/R22: + `ubicacion` OPCIONAL. Al ser opcional, ninguna llamada existente se
// rompe: un cliente que no la envie sigue validando igual.
export const recogerSchema = z.object({
  ordenIds: z.array(z.string().min(1)).min(1),
  ubicacion: ubicacionSchema.optional(),
});
export type RecogerActionInput = z.infer<typeof recogerSchema>;

// R19-R21: escoger una orden para gestionarla (fija el bloqueo 1-a-1).
export const escogerSchema = z.object({
  ordenId: z.string().min(1),
});
export type EscogerActionInput = z.infer<typeof escogerSchema>;

// R35: liberar el puntero de bloqueo (cancelar/cerrar sin registrar resultado).
export const liberarSchema = z.object({
  ordenId: z.string().min(1),
});
export type LiberarActionInput = z.infer<typeof liberarSchema>;

/**
 * True si `value` (YYYY-MM-DD) es MAÑANA o posterior en el calendario de Costa Rica
 * (R25: la reprogramacion mas temprana posible es mañana). El dia "de hoy" se resuelve
 * con `fecha-cr` (UTC-6 fijo), NO con los campos UTC de `new Date()`: entre las 18:00 y
 * la medianoche de CR el dia UTC ya es el siguiente, y comparar contra el rechazaba
 * mañana como si fuera hoy (off-by-one). Comparacion lexicografica: `YYYY-MM-DD` ordena
 * igual como texto que como fecha.
 */
export function esFechaFutura(value: string, now: Date = new Date()): boolean {
  // Formato ISO estricto: un dia inexistente ("2026-02-31") da Invalid Date.
  if (Number.isNaN(new Date(`${value}T00:00:00.000Z`).getTime())) return false;
  return value >= mananaCalendarioCR(now);
}

const fechaFuturaSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "fecha invalida")
  .refine(
    (v) => esFechaFutura(v),
    "la fecha debe ser mañana o posterior",
  );

const motivoSchema = z.string().trim().min(1, "motivo requerido");

// Feature 73 (R1/R6): causa TIPIFICADA de la devolucion. La obligatoriedad vive AQUI, en el
// borde (F1.4-b: sin CHECK en la base), y SOLO en la rama `devuelta`. Un valor fuera del
// catalogo o su ausencia producen un error en el campo `causaDevolucion` (R6). NO sustituye
// al `motivo` ni afloja su validacion (R7): son campos APARTE.
const causaDevolucionSchema = z.enum(CAUSA_DEVOLUCION_SEED, { message: "causa requerida" });

// Feature 158 (R9, Q-B): causa TIPIFICADA del INCIDENTE. Lista CERRADA de 3 valores en
// espanol, sin "Otro". La obligatoriedad vive AQUI, en el borde, y SOLO en la rama
// `incidente`. Un valor fuera del catalogo o su ausencia producen un error en el campo
// `causaIncidente`. NO sustituye al `motivo` ni afloja su validacion (R11): son campos APARTE.
const causaIncidenteSchema = z.enum(CAUSA_INCIDENTE_SEED, { message: "causa requerida" });

// R22/R25/R27/R29: entrada de gestion DISCRIMINADA por `resultado` con las
// obligatoriedades por rama (decision F1.4-i). La evidencia (File) va en el mismo
// schema como file-like (obligatoria en entrega/rechazo).
const gestionarUnionSchema = z.discriminatedUnion("resultado", [
  z.object({
    ordenId: z.string().min(1),
    resultado: z.literal("entregada"),
    // >= 0: una entrega SIN cobro (montoCobrar 0/null) recauda 0 y es válida. El
    // servicio revalida que el monto CUADRE con el `montoCobrar` de la orden (R22).
    montoRecibido: z.number().nonnegative("monto invalido"),
    metodoPago: z.enum(METODO_PAGO_SEED),
    // Feature 119 (R5): lista de 1..N fotos (antes una sola). Validacion por archivo (R8).
    evidencias: evidenciasSchema,
    ubicacion: ubicacionSchema.optional(), // feature 92/R22
  }),
  z.object({
    ordenId: z.string().min(1),
    resultado: z.literal("reprogramada"),
    fechaReprogramacion: fechaFuturaSchema,
    motivo: motivoSchema,
    ubicacion: ubicacionSchema.optional(), // feature 92/R22
  }),
  z.object({
    ordenId: z.string().min(1),
    resultado: z.literal("devuelta"),
    // Feature 73/R10: la causa vive SOLO en esta variante. Al ser una discriminatedUnion, un
    // cliente que la envie en `entregada`/`reprogramada`/`rechazada` no la consigue persistir:
    // el campo no existe en el tipo parseado de esas ramas.
    causaDevolucion: causaDevolucionSchema,
    motivo: motivoSchema, // feature 36: se CONSERVA obligatorio (R7)
    // Feature 75: la evidencia (foto) pasa a ser OBLIGATORIA en Devolver, igual que en
    // entrega/rechazo. Feature 119 (R5): ahora es una LISTA de 1..N fotos.
    evidencias: evidenciasSchema,
    ubicacion: ubicacionSchema.optional(), // feature 92/R22
  }),
  z.object({
    ordenId: z.string().min(1),
    resultado: z.literal("rechazada"),
    motivo: motivoSchema,
    // Feature 119 (R5): lista de 1..N fotos (antes una sola).
    evidencias: evidenciasSchema,
    ubicacion: ubicacionSchema.optional(), // feature 92/R22
  }),
  // Feature 158 (R9/R10/R11, Q-B) — QUINTA variante: el paquete esta danado, perdido o
  // robado. NO hay recaudo (`montoRecibido`/`metodoPago` no existen en esta rama), y al ser
  // una `discriminatedUnion` un cliente que los envie NO los consigue persistir: el campo no
  // existe en el tipo parseado de esta rama (mismo blindaje que la causa de la 73).
  z.object({
    ordenId: z.string().min(1),
    resultado: z.literal("incidente"),
    // R9: la causa vive SOLO en esta variante (los 3 valores en espanol, sin "Otro").
    causaIncidente: causaIncidenteSchema,
    // R11: el motivo en texto libre se CONSERVA obligatorio y APARTE de la causa, mismo
    // contrato que la devolucion (73/R7).
    motivo: motivoSchema,
    // R10 (Q-B): evidencia 1..N OBLIGATORIA con independencia de la causa, incluidas
    // `perdido` y `robado`. La objecion («no hay paquete que fotografiar; bloquea al mensajero
    // en la calle») se le planteo al humano y eligio esto igual: es su decision, esta
    // declarada en requirements.md y NO se re-litiga. Se reusa `evidenciasSchema` -> mismos
    // limites por archivo y por lista que el resto de los resultados con foto.
    evidencias: evidenciasSchema,
    ubicacion: ubicacionSchema.optional(), // feature 92/R22
  }),
]);

// Feature 119: el contrato de gestion recibe la LISTA `evidencias` (1..N fotos). Cliente (panel)
// y servidor (Server Action) usan el MISMO schema (R8): el panel envia `evidencias` en su
// `safeParse` y el borde arma `evidencias` con `getAll("evidencia")`, asi que ninguno depende ya
// del campo singular historico (el puente `foldEvidenciaSingular` se retiro al migrar el panel).
export const gestionarSchema = gestionarUnionSchema;
export type GestionarActionInput = z.infer<typeof gestionarSchema>;

// --- Resultados expuestos por la Server Action (agregan `unauthenticated`) ---

export type ListarMisAsignacionesResult =
  | {
      status: "ok";
      porRecoger: MiAsignacionDTO[];
      porGestionar: MiAsignacionDTO[];
      ordenEnGestionId: string | null;
      kpis: MisAsignacionesKpis; // Feature 61
      ruta: RutaResumenDTO; // Feature 92/R27/R28/R30
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
  // Feature 119 (R13): URLs firmadas de las N evidencias (antes una sola `evidenciaUrl`).
  | { status: "ok"; ordenId: string; estado: string; evidenciaUrls?: string[] }
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "conflict"; motivo: string };

// R35: resultado de la action que libera el puntero de bloqueo (idempotente).
export type LiberarResult =
  | { status: "ok" }
  | { status: "forbidden" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" };
