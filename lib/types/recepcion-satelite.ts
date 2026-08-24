import { z } from "zod";
import { diaRepartoSchema } from "@/lib/types/dia-reparto";
import type { RecepcionSateliteDTO } from "@/lib/interfaces/services/IRecepcionSateliteService";
import type { MensajeroLiteRow } from "@/lib/interfaces/repositories/IOrdenRepository";
import { recepcionSateliteConfig } from "@/lib/config/recepcion-satelite";
import type { ListarCompletoResult } from "@/lib/types/descarga-listado";
import type { ListarPaginadoResult } from "@/lib/types/listado-paginado";
import { paginaInputSchema } from "@/lib/types/pagina-input";
import { conRefinesDeCreacion, ordenFilterBase } from "@/lib/types/orden";
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
 *  - provincia, canton y distrito son IDs (pedido humano 2026-08-19): las mismas claves y los
 *    mismos valores que la barra de `/ordenes`, tomados de `ordenFilterBase`. Antes eran
 *    NOMBRES, derivados de las ordenes cargadas; ahora las opciones salen de la geografia de
 *    la ZONA del actor, que es lo que el catalogo de `/ordenes` ya sabe entregarle acotado.
 */
/**
 * Pedido humano (2026-08-19) — los filtros que esta barra COMPARTE con la de `/ordenes`:
 * geografia (por ID), tiempo de creacion y buscador de texto libre. Se toman del schema de
 * alla (`ordenFilterBase.pick`), no se reescriben: las claves, sus limites (`BUSQUEDA_MIN_CHARS`,
 * `YYYY-MM-DD`, listas no vacias) y su forma son EXACTAMENTE los mismos, asi que las dos
 * superficies no pueden aceptar cosas distintas por «el mismo filtro».
 *
 * `zona_id` y `tienda_id` NO se toman: la zona sale del actor —declararla como filtro seria
 * ofrecer el alcance como entrada— y el adminSatelite no ve el directorio de cuentas tienda.
 */
const FILTROS_COMPARTIDOS = ordenFilterBase.pick({
  provincia_id: true,
  canton_id: true,
  distrito_id: true,
  created_preset: true,
  created_desde: true,
  created_hasta: true,
  q: true,
}).shape;

/**
 * Base SIN los `refine` del tiempo: `.omit()`/`.extend()` solo existen sobre un `ZodObject`,
 * y de esta base cuelgan el schema del conjunto y el de la vigencia. Los dos `refine` se
 * aplican al final, uno por schema (`conRefinesDeCreacion`).
 */
const listarOrdenesBodegaPaginadoBase = paginaInputSchema(recepcionSateliteConfig)
  .extend({
    estados: z.array(z.enum(ESTADOS_BODEGA_SATELITE)).optional(),
    ...FILTROS_COMPARTIDOS,
  })
  .strict();

export const listarOrdenesBodegaPaginadoSchema = conRefinesDeCreacion(
  listarOrdenesBodegaPaginadoBase,
);

export type ListarOrdenesBodegaPaginadoActionInput = z.infer<
  typeof listarOrdenesBodegaPaginadoSchema
>;

/**
 * Feature 184 — Tanda A (T A.3, R3/R17) — el MISMO listado sin recorte por pagina, para la
 * descarga. Se DERIVA del schema de la pagina quitandole `page`/`pageSize`, no se reescribe: si
 * mañana el listado gana un filtro, el conjunto lo gana en la misma linea y los dos caminos no
 * pueden entender cosas distintas por «filtro» (R16).
 *
 * `.strict()` se reescribe aunque `.omit()` lo herede, por el mismo motivo que en el schema de
 * la pagina: la barrera de ALCANCE es de este listado y no debe depender de que el schema base
 * nunca se afloje. Un `zonaId` colado muere aqui, sin llegar al servicio (R4/R17).
 */
const listarOrdenesBodegaCompletoBase = listarOrdenesBodegaPaginadoBase
  .omit({ page: true, pageSize: true })
  .strict();

export const listarOrdenesBodegaCompletoSchema = conRefinesDeCreacion(
  listarOrdenesBodegaCompletoBase,
);

export type ListarOrdenesBodegaCompletoActionInput = z.infer<
  typeof listarOrdenesBodegaCompletoSchema
>;

/**
 * Feature 184 — Tanda A (T A.3, R21/Q2) — la comprobacion de VIGENCIA con la que se poda la
 * seleccion: los mismos filtros del listado mas los identificadores que el cliente tiene
 * marcados fuera de la pagina visible.
 *
 * `ids` es la unica clave nueva y va acotada por los dos lados: `uuid` porque `orden.id` lo es,
 * `.min(1)` porque preguntar por nada no es una pregunta (R23) y `.max(MAX_IDS_VIGENCIA)`
 * porque esta lista acaba en un `IN` de SQL y la propone el cliente (Q2, default 500).
 * Pasarse devuelve `validation_error` y la seleccion NO se toca (R22).
 */
export const listarIdsVigentesBodegaSchema = conRefinesDeCreacion(
  listarOrdenesBodegaCompletoBase
    .extend({
      ids: z
        .array(z.string().uuid())
        .min(1)
        .max(recepcionSateliteConfig.MAX_IDS_VIGENCIA),
    })
    .strict(),
);

export type ListarIdsVigentesBodegaActionInput = z.infer<typeof listarIdsVigentesBodegaSchema>;

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

/**
 * Feature 184 — Tanda A (T A.3, R1/R6/R7): el conjunto filtrado ENTERO tal como lo recibe el
 * cliente. Union de error ANCHO (`ActionError`) y no el estrecho de la pagina: quien lo consume
 * es `filasDesdeResultado`, el adaptador comun de la descarga, que redacta el mensaje de
 * CUALQUIER error de borde en un solo sitio. `limite_excedido` lleva solo conteos, nunca filas.
 */
export type ListarOrdenesBodegaCompletoResult = ListarCompletoResult<RecepcionSateliteDTO>;

/**
 * Feature 184 — Tanda A (T A.3, R18/R21/R22): los identificadores que SIGUEN en el conjunto
 * filtrado, de entre los preguntados.
 *
 * Devuelve los VIGENTES y no los caducados a proposito: el cliente interseca, asi que un fallo
 * —o una respuesta que no llega— no puede leerse nunca como «desmarca todo». Ninguna rama de
 * error lleva datos del identificador ajeno (R21).
 */
export type ListarIdsVigentesBodegaResult =
  | { status: "ok"; ids: string[] }
  | { status: "forbidden" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
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
  // Feature 246 (T3.1, R2/R3/R4/R6, decision D4) — EL MISMO campo que en bodega central, con el
  // MISMO enum y el MISMO default. D4 se firmo asi por una razon operativa: dejar el satelite
  // fuera haria que la regla del sistema dependiera de DESDE QUE BODEGA te asignaron, y eso no se
  // le puede explicar a quien opera. Que las dos superficies importen `diaRepartoSchema` de un
  // unico archivo es lo que impide que un dia acepten vocabularios distintos.
  dia: diaRepartoSchema.default("hoy"),
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
  | {
      status: "ok";
      mensajeros: MensajeroLiteRow[];
      /**
       * FEATURE 271 (R32) — ids de los mensajeros de la zona que el servidor va a RECHAZAR al
       * asignar (regla N/V: `N >= 2` o `V >= 1`). El selector los deshabilita con su motivo, en vez
       * de dejar elegir y toparse con un rechazo al confirmar.
       *
       * ⚠️ ES LA MITAD QUE FALTABA, y esta es la superficie del incidente del 18/08. Opcional
       * (aditivo) para no romper a los consumidores actuales, pero la accion lo emite SIEMPRE.
       */
      bloqueadosIds?: string[];
    }
  | { status: "forbidden" }
  | { status: "unauthenticated" };
