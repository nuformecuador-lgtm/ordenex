import { z } from "zod";
import type {
  CatalogoFiltrosSateliteDTO,
  RecepcionSateliteDTO,
} from "@/lib/interfaces/services/IRecepcionSateliteService";
import type { MensajeroLiteRow } from "@/lib/interfaces/repositories/IOrdenRepository";
import { recepcionSateliteConfig } from "@/lib/config/recepcion-satelite";
import type { ListarPaginadoResult } from "@/lib/types/listado-paginado";
import { paginaInputSchema } from "@/lib/types/pagina-input";
import { ESTADOS_BODEGA_SATELITE } from "@/lib/utils/estados-bodega-satelite";

// Feature 33 — validacion de borde (zod) de la recepcion por QR y tipos de
// resultado expuestos por las Server Actions. El schema se usa en la action; los
// resultados de dominio (forbidden/sin_zona/zona_ajena/…) los devuelve el service
// sin excepcion, la action solo agrega `unauthenticated`.

// R16: el QR codifica la URL `/paquete/<numGuia>`; el escaner extrae el `num_guia`
// (Int UNIQUE de `orden`, secuencia `orden_num_guia_seq`) y lo manda aqui. Se exige
// entero positivo; un valor ilegible/no numerico (el escaner ya lo resuelve a null)
// -> ZodError -> validation_error "codigo invalido" ANTES del service, sin tocar datos.
export const recibirSchema = z.object({
  numGuia: z.number().int().positive(),
});
export type RecibirActionInput = z.infer<typeof recibirSchema>;

// Feature 63 — borde de la recepcion EN LOTE ("Aceptar/Recibir todas"): lista NO vacia
// de ids de orden (mismo formato que `recibir`, texto no vacio). Un input invalido ->
// ZodError -> validation_error ANTES del service, sin tocar datos.
export const recibirLoteSchema = z.object({
  ordenIds: z.array(z.string().trim().min(1)).min(1),
});
export type RecibirLoteActionInput = z.infer<typeof recibirLoteSchema>;

/**
 * Feature 170 — FASE 2 (T K.1, R40/R44/R45) — borde del listado «Órdenes de la bodega»
 * paginado: `page`/`pageSize` (de `paginaInputSchema`, con el tamaño del dominio) mas los
 * TRES filtros que hasta ahora vivian en el navegador.
 *
 * **La lista blanca es la defensa de R44, y por eso esta escrita en tres capas:**
 *  - `.strict()` — un `zonaId`/`usuarioId` colado muere aqui con `validation_error` en vez de
 *    viajar hasta un servicio que hoy lo ignora y mañana podria no ignorarlo. El alcance sale
 *    SIEMPRE del actor de la sesion, nunca de la peticion. MEDIDO: `.extend()` HEREDA el
 *    `.strict()` de `paginaInputSchema`, asi que esta llamada es redundante hoy; se deja
 *    escrita porque la barrera es de este listado y no debe depender de que el schema base
 *    nunca se afloje.
 *  - `z.enum(ESTADOS_BODEGA_SATELITE)` — el filtro de estado solo admite los cinco estados de
 *    ESTA pantalla. Sin el, un `estados: ["entregada"]` seria una entrada valida cuyo unico
 *    freno estaria en el servicio.
 *  - canton y distrito son NOMBRES, no ids: son exactamente los `value` que el catalogo de
 *    T K.2 ofrece, que es lo que el filtro de cliente comparaba.
 */
export const listarOrdenesBodegaPaginadoSchema = paginaInputSchema(recepcionSateliteConfig)
  .extend({
    estados: z.array(z.enum(ESTADOS_BODEGA_SATELITE)).optional(),
    cantones: z.array(z.string().trim().min(1)).optional(),
    distritos: z.array(z.string().trim().min(1)).optional(),
  })
  .strict();

export type ListarOrdenesBodegaPaginadoActionInput = z.infer<
  typeof listarOrdenesBodegaPaginadoSchema
>;

// --- Resultados expuestos por las Server Actions (agregan `unauthenticated`) ---

/**
 * Feature 170 — FASE 2 (T K.1): la pagina tal como la recibe el cliente. Union de error
 * ESTRECHO a proposito (el contrato de T H.2 lo admite como parametro): este listado no
 * produce `not_found` ni `conflict`, y declararlos obligaria a la pantalla a manejar ramas
 * que nunca llegan.
 */
export type ListarOrdenesBodegaPaginadoResult = ListarPaginadoResult<
  RecepcionSateliteDTO,
  | { status: "forbidden" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" }
>;

/** Feature 170 — FASE 2 (T K.2, R46): opciones de canton y distrito del conjunto del actor. */
export type ObtenerCatalogoFiltrosSateliteResult =
  | { status: "ok"; catalogo: CatalogoFiltrosSateliteDTO }
  | { status: "forbidden" }
  | { status: "unauthenticated" };

export type ListarRecepcionSateliteResult =
  | {
      status: "ok";
      porRecibir: RecepcionSateliteDTO[];
      recibidas: RecepcionSateliteDTO[];
      // Feature 139/T2.5/R21: ordenes `por_devolver` de la zona del adminSatelite,
      // elegibles para "Enviar a central" (por lote). REEMPLAZA el viejo scope `rechazada`
      // (feature 48). El campo viaja tal cual desde el service result (la action solo
      // reenvia); acotado server-side por zona.
      porDevolver: RecepcionSateliteDTO[];
      // Feature 139/T2.5/R21: ordenes `devolviendo_a_bodega_central` de la zona (en transito
      // a la central), INFORMATIVAS. Alineado con `ListarRecepcionSateliteServiceResult.ok`:
      // el service ya lo devuelve y la action lo reenvia verbatim (sin remapear).
      enTransitoACentral: RecepcionSateliteDTO[];
      // Feature 100/T4.1/R12: ordenes `devuelta` de la zona del adminSatelite,
      // elegibles para "Recuperar a bodega". Viaja tal cual desde el service result
      // (la action solo reenvia); acotado server-side por zona.
      devueltas: RecepcionSateliteDTO[];
      // Feature 149/T6.3/R35: ordenes `por_recoger` de la zona del adminSatelite (asignadas a un
      // mensajero que aun no las recogio), elegibles para "Deshacer asignacion" (por lote). Viaja
      // tal cual desde el service result (la action solo reenvia); acotado server-side por zona.
      // R36: las `en_ruta_bodega_satelite` NO entran aqui (siguen en `porRecibir`, sin accion).
      asignadas: RecepcionSateliteDTO[];
      zonaNombre: string | null;
      sinZona: boolean;
    }
  | { status: "forbidden" } // R3
  | { status: "unauthenticated" }; // R3

export type RecibirResult =
  | { status: "ok"; ordenId: string; estado: "en_bodega_satelite" }
  | { status: "forbidden" }
  | { status: "sin_zona" }
  | { status: "zona_ajena" }
  | { status: "estado_invalido"; estado: string }
  | { status: "ya_recibida" }
  | { status: "no_encontrada" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "conflict" }
  | { status: "unauthenticated" }; // R16 / R3 (borde)

// Feature 63 — resultado expuesto por `recibirLote` (agrega `unauthenticated` del
// borde; el resto son resultados de dominio del service). Espejo de
// `RecibirLoteServiceResult`.
export type RecibirLoteResult =
  | { status: "ok"; recibidas: number }
  | { status: "forbidden" }
  | { status: "sin_zona" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" };

// --- Feature 34: asignacion satelite a mensajeros de la zona ---

// R15/R19: borde de la asignacion. `ordenIds` no vacio de uuids, `mensajeroId`
// uuid; un input invalido -> ZodError -> validation_error ANTES del service, sin
// tocar datos. El `orden.id` es un uuid (ver Orden.id en schema.prisma).
export const asignarSateliteSchema = z.object({
  ordenIds: z.array(z.string().uuid()).min(1),
  mensajeroId: z.string().uuid(),
});
export type AsignarSateliteActionInput = z.infer<typeof asignarSateliteSchema>;

// R7/R19: resultado expuesto por `asignarDesdeSatelite` (agrega `unauthenticated`
// del borde; el resto son resultados de dominio del service). Espejo de
// `AsignarSateliteServiceResult`.
export type AsignarSateliteResult =
  | { status: "ok"; resultados: { ordenId: string; estado: "por_recoger" }[] }
  | { status: "forbidden" }
  | { status: "sin_zona" }
  // Feature 41/R18: bodega bloqueada (regla estricta R17). La causa (porMensajeros /
  // porCierreBodega) permite al frontend mostrar el mensaje accionable diferenciado (R22).
  | { status: "bodega_bloqueada"; causa: { porMensajeros: boolean; porCierreBodega: boolean } }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "conflict"; detalle: { ordenId: string; motivo: string }[] }
  | { status: "unauthenticated" };

// R2/R5/R6: resultado del loader de mensajeros de la zona del actor para el modal.
// `forbidden` si el rol no es adminSatelite; sin zona -> lista vacia (R6).
export type ListarMensajerosSateliteResult =
  | { status: "ok"; mensajeros: MensajeroLiteRow[] }
  | { status: "forbidden" }
  | { status: "unauthenticated" };
