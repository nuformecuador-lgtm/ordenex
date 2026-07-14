// Feature 32 — Tipos y schemas del backend de "Etiqueta de guia con QR y codigo
// de barras". La etiqueta es un READ derivado de `orden` + geografia + tienda:
// NO hay tabla nueva ni migracion. DTOs propios (no amplian OrdenDTO) para no
// alterar el contrato del CRUD (feature 6/7) ni exponer PII/monto donde hoy no
// se exponen (patron lib/types/orden-guia.ts).
import { z } from "zod";

// Payload por orden etiquetable (R1). La etiqueta se genera para TODA orden
// existente, tenga o no `num_guia`: `numGuia` es `number | null` (null = aun sin
// guia asignada) y `barcodeValue` es `string | null` (null si no hay guia -> la UI
// omite el codigo de barras). El QR (`qrValue = ordenId`) SIEMPRE esta disponible,
// por eso funciona incluso sin guia (decision del usuario). `montoCobrar` es
// number|null (Decimal->number, R5, sin moneda hardcodeada). `distritoNombre`
// nullable (R4). NUNCA incluye `deletedAt` ni campos internos (R6).
export interface EtiquetaGuiaDTO {
  ordenId: string;
  numGuia: number | null; // null = orden sin guia asignada aun
  numRemision: string;
  destinatario: string;
  telefonoDest: string;
  direccion: string | null;
  producto: string;
  montoCobrar: number | null; // R5: sin moneda hardcodeada
  tiendaNombre: string;
  zonaNombre: string;
  provinciaNombre: string;
  cantonNombre: string;
  distritoNombre: string | null; // R4
  qrValue: string; // = ordenId (decision F1.4 (a), R7): siempre presente
  barcodeValue: string | null; // = String(numGuia) o null si aun no hay guia
}

// Ordenes solicitadas que NO produjeron etiqueta (R3), para el aviso de UI (R11):
// `no_encontrada` = no existe o esta borrada (`deleted_at` no nulo). Ya NO se omite
// por falta de guia: la etiqueta ahora se genera incluso sin `num_guia`.
export interface EtiquetaOmitidaDTO {
  ordenId: string;
  motivo: "no_encontrada"; // R3
}

// R15: lista NO vacia de identificadores de orden con formato valido.
export const generarEtiquetasSchema = z.object({
  ordenIds: z.array(z.string().min(1)).min(1),
});
export type GenerarEtiquetasActionInput = z.infer<typeof generarEtiquetasSchema>;

// Resultado discriminado y tipado del borde (Server Action). `unauthenticated`
// (R14) y `validation_error` (R15) los produce el borde; `ok`/`forbidden` (R13)
// vienen del service como resultado de dominio.
export type GenerarEtiquetasResult =
  | { status: "ok"; etiquetas: EtiquetaGuiaDTO[]; omitidas: EtiquetaOmitidaDTO[] }
  | { status: "unauthenticated" } // R14
  | { status: "forbidden" } // R13
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }; // R15
