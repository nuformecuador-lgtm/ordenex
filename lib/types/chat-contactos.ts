// Feature 308 (design §1.3, R7) — forma NORMALIZADA de un `contacts` de WhatsApp.
//
// Es el UNICO dato de esta feature que se guarda como JSON (`chat_mensaje.contactos_json`):
// `contacts` es una estructura anidada y de aridad variable (N contactos x N telefonos x N
// correos x N direcciones) que solo se lee ENTERA, para pintarla. Normalizarla en columnas
// exigiria tres o cuatro tablas hijas para nada.
//
// INVARIANTE: el JSON NO cruza ninguna frontera como `Json`/`any`. Este esquema se aplica DOS
// veces —al ESCRIBIR (borde del webhook) y al LEER (mapeo del DTO)— con `safeParse`, de modo que
// un JSON historico o corrupto degrada a "sin contactos" en vez de reventar el hilo entero.
//
// PII: el contenido de un contacto compartido es dato personal de un TERCERO. No se loguea nunca
// (R35); solo viaja del webhook a la fila y de la fila a la burbuja del mensajero asignado.
import { z } from "zod";

/**
 * Un dato etiquetado del contacto: `valor` mas el `tipo` que le puso el cliente ("CELL",
 * "HOME", "WORK"...). El tipo es texto libre de Meta: se conserva tal cual para mostrarlo,
 * nunca se interpreta.
 */
const datoEtiquetadoSchema = z.object({
  valor: z.string().min(1),
  tipo: z.string().nullable(),
});

/** Un contacto ya normalizado, con solo los campos que la UI pinta. */
export const chatContactoSchema = z.object({
  /** Nombre visible (`name.formatted_name` de Meta, o la mejor aproximacion disponible). */
  nombre: z.string(),
  telefonos: z.array(datoEtiquetadoSchema),
  correos: z.array(datoEtiquetadoSchema),
  /** Direcciones en una sola linea ya compuesta (Meta las manda troceadas). */
  direcciones: z.array(z.string().min(1)),
  /** Nombre de la organizacion (`org.company`), o `null`. */
  organizacion: z.string().nullable(),
  urls: z.array(z.string().min(1)),
});

/** Lista de contactos de un mensaje `type=contacts`. Vacia no es valida (degrada a `otro`, R8). */
export const chatContactosSchema = z.array(chatContactoSchema).min(1);

export type ChatContactoNormalizado = z.infer<typeof chatContactoSchema>;

/**
 * Lee un `contactos_json` de la base (o cualquier `unknown`) y devuelve la lista tipada, o
 * `null` si no es interpretable. NO lanza: una fila historica o corrupta debe dejar la burbuja
 * sin contactos, no tumbar el listado del hilo (R14).
 */
export function parsearContactosGuardados(raw: unknown): ChatContactoNormalizado[] | null {
  if (raw === null || raw === undefined) return null;
  const parsed = chatContactosSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
