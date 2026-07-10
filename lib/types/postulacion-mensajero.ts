import { z } from "zod";
import { numericIdentifierSchema } from "@/lib/types/auth";
import { strongPasswordSchema } from "@/lib/types/password-policy";
import {
  POSTULACION_ALLOWED_MIME,
  postulacionConfig,
  type PostulacionMimeType,
} from "@/lib/config/postulacion";

// Feature 21 — validacion de borde de la postulacion de mensajero (zod).
// Reutiliza la politica de contrasena fuerte (feature 20, A5), el validador
// numerico de cedula/telefono (feature 1, R8) y el limite de tamano/tipos MIME
// de la config. Los nombres de campo van en snake_case para casar 1:1 con los
// campos del formulario y con las claves de fieldErrors expuestas a la UI.

/** Los 5 tipos de documento exigidos (R3). Coinciden con MensajeroDocumentoTipo. */
export const DOCUMENTO_TIPOS = [
  "cedula_anverso",
  "cedula_reverso",
  "propiedad_anverso",
  "propiedad_reverso",
  "foto_rostro",
] as const;
export type DocumentoTipo = (typeof DOCUMENTO_TIPOS)[number];

/** Forma minima file-like validable en cliente y servidor (R10). */
export interface ArchivoLike {
  type: string;
  size: number;
}

/**
 * Valida tipo MIME y tamano de un documento (R10). Devuelve el mensaje de error
 * o null si es valido. Reutilizable en el cliente (antes de enviar) y en el
 * servidor (revalidacion de borde). No depende del global File.
 */
export function validarArchivo(
  archivo: ArchivoLike | null | undefined,
  maxBytes: number = postulacionConfig.MAX_FILE_BYTES,
): string | null {
  if (!archivo) return "documento requerido";
  if (!(POSTULACION_ALLOWED_MIME as readonly string[]).includes(archivo.type)) {
    return "el documento debe ser una imagen jpeg, png o webp";
  }
  if (archivo.size <= 0) return "documento vacio";
  if (archivo.size > maxBytes) {
    return `el documento no debe superar ${Math.floor(maxBytes / (1024 * 1024))} MB`;
  }
  return null;
}

/** Schema zod de un documento: exige file-like que pase validarArchivo (R10). */
const documentoSchema = z.custom<ArchivoLike>(
  (value) =>
    typeof value === "object" &&
    value !== null &&
    typeof (value as ArchivoLike).type === "string" &&
    typeof (value as ArchivoLike).size === "number" &&
    validarArchivo(value as ArchivoLike) === null,
  { message: "el documento debe ser una imagen jpeg, png o webp de tamano permitido" },
);

/**
 * Schema de los campos de texto + los 5 documentos (R2-R11). La confirmacion de
 * contrasena se verifica con refine (R7); la placa se normaliza a trim+uppercase
 * antes de persistir (R11).
 */
export const postulacionSchema = z
  .object({
    nombre: z.string().trim().min(1, "requerido"),
    primer_apellido: z.string().trim().min(1, "requerido"),
    segundo_apellido: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v && v.length > 0 ? v : undefined)),
    email: z.string().trim().toLowerCase().email("correo invalido"),
    telefono: numericIdentifierSchema(),
    tipo_identificacion_id: z.string().min(1, "requerido"),
    cedula: numericIdentifierSchema(),
    vehiculo_id: z.string().min(1, "requerido"),
    placa: z
      .string()
      .trim()
      .min(1, "requerido")
      .transform((v) => v.toUpperCase()),
    password: strongPasswordSchema,
    confirmacion_password: z.string().min(1, "requerido"),
    cedula_anverso: documentoSchema,
    cedula_reverso: documentoSchema,
    propiedad_anverso: documentoSchema,
    propiedad_reverso: documentoSchema,
    foto_rostro: documentoSchema,
  })
  .refine((data) => data.password === data.confirmacion_password, {
    path: ["confirmacion_password"],
    message: "las contrasenas no coinciden",
  });

export type PostulacionInput = z.infer<typeof postulacionSchema>;

/** Resultado del servicio de postulacion (design §3.1). */
export type PostularMensajeroResult =
  | { status: "ok" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "conflict"; field: "email" | "cedula" }
  | { status: "error" };

/** Resultado de la Server Action: el del servicio + limite de tasa (A4). */
export type PostularMensajeroActionResult =
  | PostularMensajeroResult
  | { status: "rate_limited" };

/** Documento normalizado que consume el servicio: binario + metadatos (R16). */
export interface PostulacionArchivo {
  contentType: PostulacionMimeType;
  bytes: Uint8Array;
}
