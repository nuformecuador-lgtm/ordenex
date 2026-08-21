import { z } from "zod";
import type { ActionError } from "@/lib/types/orden";
import { postulacionRecursoConfig } from "@/lib/config/postulacion-recurso";

// Feature 253 (T2.1, design §10) — FRONTERA CONTRACTUAL de la postulacion de vehiculo o bodega:
// tipos de dominio, el schema zod que validan CLIENTE Y SERVIDOR (R14) y los resultados tipados
// de las tres Server Actions (la publica y las dos del admin).
//
// POR QUE EL SCHEMA VIVE AQUI Y NO EN EL MODAL: hoy `formSchema` esta declarado dentro de
// `app/_landing/PostularRecursoModal.tsx`, asi que el servidor no puede leerlo. Sacarlo a
// `lib/types/` es lo que hace posible R14 —revalidar en el servidor EXACTAMENTE las mismas reglas
// que el cliente— sin escribirlas dos veces y sin que puedan divergir. Es el mismo movimiento que
// la feature 21 ya tiene hecho (`PostulacionForm.tsx` importa `postulacionSchema`).

/** Los dos recursos que la landing ofrece postular. Fuente unica del enum Prisma homonimo. */
export const RECURSO_TIPOS = ["vehiculo", "bodega"] as const;
export type RecursoTipo = (typeof RECURSO_TIPOS)[number];

/**
 * R8-R13/R15 — el objeto que se acepta, campo a campo.
 *
 * ⚠️ Los MENSAJES son los que el modal muestra HOY, palabra por palabra
 * (`PostularRecursoModal.tsx:72-77`): son texto probado en produccion y cambiarlos seria un cambio
 * de producto colado dentro de un arreglo. Los dos mensajes de TOPE son nuevos porque hoy no hay
 * tope; se escriben con el numero interpolado para que la persona sepa cuanto le sobra.
 *
 * El orden de la cadena importa: `.trim()` y `.toLowerCase()` transforman ANTES de que corran
 * `.min()` / `.max()` / `.email()`, asi que « » no pasa el `min(1)` y el correo se valida y se
 * persiste ya normalizado (R12/R20). Cambiar el orden dejaria pasar espacios.
 */
export const postulacionRecursoSchema = z.object({
  // R9: `tipo` NO es texto libre. Un valor inventado cae aqui, antes de que nadie toque la base.
  tipo: z.enum(RECURSO_TIPOS, { message: "Tipo de recurso invalido" }),
  nombre: z
    .string()
    .trim()
    .min(1, "Escribí tu nombre")
    .max(
      postulacionRecursoConfig.NOMBRE_MAX_CHARS,
      `El nombre no puede pasar de ${postulacionRecursoConfig.NOMBRE_MAX_CHARS} caracteres`,
    ),
  telefono: z
    .string()
    .trim()
    .min(7, "Escribí un teléfono de contacto")
    .max(
      postulacionRecursoConfig.TELEFONO_MAX_CHARS,
      `El teléfono no puede pasar de ${postulacionRecursoConfig.TELEFONO_MAX_CHARS} caracteres`,
    ),
  correo: z
    .string()
    .trim()
    .toLowerCase()
    .email("Escribí un correo válido")
    .max(
      postulacionRecursoConfig.CORREO_MAX_CHARS,
      `El correo no puede pasar de ${postulacionRecursoConfig.CORREO_MAX_CHARS} caracteres`,
    ),
  mensaje: z
    .string()
    .trim()
    .min(1, "Contanos brevemente qué tenés")
    .max(
      postulacionRecursoConfig.MENSAJE_MAX_CHARS,
      `El mensaje no puede pasar de ${postulacionRecursoConfig.MENSAJE_MAX_CHARS} caracteres`,
    ),
});

/** Lo que la accion publica recibe YA validado y normalizado. */
export type PostulacionRecursoInput = z.infer<typeof postulacionRecursoSchema>;

/**
 * R5 — desenlaces de la accion PUBLICA. La union es cerrada a proposito: el modal tipa su mapa de
 * textos como `Record<Exclude<PostularRecursoResult["status"], "ok">, string>`, asi que anadir un
 * desenlace nuevo aqui ROMPE EL TYPECHECK hasta que alguien le escriba su texto.
 *
 * NO hay ningun `throw` que cruce la accion (design §4): toda salida es uno de estos cuatro.
 */
export type PostularRecursoResult =
  | { status: "ok" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "rate_limited" }
  | { status: "error" };

/**
 * Lo que el panel del admin ve de una postulacion (R29). `atendidaPor` es el NOMBRE de quien la
 * atendio, no su id: el panel muestra personas, no claves.
 */
export interface PostulacionRecursoDTO {
  id: string;
  tipo: RecursoTipo;
  nombre: string;
  telefono: string;
  correo: string;
  mensaje: string;
  /** ISO-8601. */
  createdAt: string;
  /** ISO-8601, o `null` si sigue pendiente. */
  atendidaAt: string | null;
  atendidaPor: string | null;
}

/**
 * R30/R33 — entrada del listado del admin. `atendidas` es el filtro de las dos pestanas: `false`
 * (pendientes, el default) y `true` (ya atendidas, para que un clic equivocado no las haga
 * inalcanzables). `pageSize` se acota a `PAGE_SIZE_MAX` con un `transform`, igual que la 22: sin la
 * cota, el borde podria pedir la tabla entera.
 */
export const listarPostulacionesRecursoSchema = z.object({
  atendidas: z.boolean().default(false),
  page: z.number().int().positive().default(1),
  pageSize: z
    .number()
    .int()
    .positive()
    .default(postulacionRecursoConfig.PAGE_SIZE_DEFAULT)
    .transform((n) => Math.min(n, postulacionRecursoConfig.PAGE_SIZE_MAX)),
});
export type ListarPostulacionesRecursoInput = z.infer<typeof listarPostulacionesRecursoSchema>;

/** Id de postulacion no vacio en el borde del admin (ZodError -> VALIDATION_ERROR). */
export const postulacionRecursoIdSchema = z.string().min(1);

export type ListarPostulacionesRecursoResult =
  | {
      status: "ok";
      items: PostulacionRecursoDTO[];
      page: number;
      pageSize: number;
      total: number;
    }
  | ActionError;

/** R31/R32: `conflict` = ya estaba atendida; `not_found` = no existe. Son distinguibles. */
export type AtenderPostulacionRecursoResult =
  | { status: "ok"; id: string; atendidaAt: string }
  | ActionError;
