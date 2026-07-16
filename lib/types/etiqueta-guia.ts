// Feature 32 — Tipos y schemas del backend de "Etiqueta de guia con QR y codigo
// de barras". La etiqueta es un READ derivado de `orden` + geografia + tienda:
// NO hay tabla nueva ni migracion. DTOs propios (no amplian OrdenDTO) para no
// alterar el contrato del CRUD (feature 6/7) ni exponer PII/monto donde hoy no
// se exponen (patron lib/types/orden-guia.ts).
import { z } from "zod";

// Payload por orden imprimible (R1). Solo ordenes con `num_guia` producen etiqueta
// (R2), por eso `numGuia` es `number` garantizado y `barcodeValue` es `string`. El
// QR codifica la URL del paquete (`<origin>/paquete/<numGuia>`), resuelta en la UI a
// partir de `qrValue` (= String(numGuia)). `montoCobrar` es number|null (Decimal->number, R5,
// sin moneda hardcodeada). `distritoNombre` nullable (R4). NUNCA incluye `deletedAt`
// ni campos internos (R6).
export interface EtiquetaGuiaDTO {
  ordenId: string;
  numGuia: number; // garantizado: solo ordenes con guia (R2)
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
  qrValue: string; // = String(numGuia) (R7): el QR codifica /paquete/<numGuia>
  barcodeValue: string; // = String(numGuia) (decision F1.4 (b), R8)
}

// Ordenes solicitadas que NO produjeron etiqueta (R2/R3), para el aviso de UI
// (R11): `sin_guia` = existe pero sin `num_guia` (no tiene QR disponible);
// `no_encontrada` = no existe o esta borrada (`deleted_at` no nulo).
export interface EtiquetaOmitidaDTO {
  ordenId: string;
  motivo: "sin_guia" | "no_encontrada"; // R2 / R3
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

// Borde de la etiqueta resuelta por guia (`/paquete/<numGuia>`): `num_guia` es un
// Int positivo (secuencia `orden_num_guia_seq`); un valor no entero/<=0 -> ZodError
// -> validation_error ANTES del service.
export const etiquetaPorGuiaSchema = z.object({
  numGuia: z.number().int().positive(),
});
export type EtiquetaPorGuiaActionInput = z.infer<typeof etiquetaPorGuiaSchema>;

// Resultado expuesto por `obtenerEtiquetaPorGuia`. `unauthenticated` (R14) y
// `validation_error` (R15) los produce el borde; `ok`/`no_encontrada` (R3) vienen del
// service como resultado de dominio.
export type EtiquetaPorGuiaResult =
  | { status: "ok"; etiqueta: EtiquetaGuiaDTO }
  | { status: "no_encontrada" } // R3
  | { status: "unauthenticated" } // R14
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }; // R15
