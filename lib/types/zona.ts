import { z } from "zod";
import { zonasConfig } from "@/lib/config/zonas";

// Feature 24 (redefinida). Zod en el borde. Montos >= 0 (patron tarifa.ts).
const montoSchema = z.number().nonnegative();
const nombreSchema = z.string().min(1);
const idSchema = z.string().min(1);

// Elemento de tarifa_zona_mensajero en el input de crear/actualizar. vehiculoId
// opcional: su obligatoriedad depende de cobroVehiculo (ver reglas abajo).
export const tarifaZonaMensajeroInputSchema = z
  .object({
    cobroEntregado: montoSchema,
    cobroRechazado: montoSchema,
    vehiculoId: idSchema.optional(),
  })
  .strict();
export type TarifaZonaMensajeroInput = z.infer<typeof tarifaZonaMensajeroInputSchema>;

// Campos de una zona COMUNES a crear y a actualizar: datos propios + distritos (N:M) + tarifas
// por mensajero. La marca de zona central NO esta aqui: es el UNICO campo cuya semantica difiere
// entre las dos operaciones (ficha 376/R1-R3, ver abajo).
const zonaFieldsComunes = {
  nombre: nombreSchema,
  cobroVehiculo: z.boolean(),
  // distritoIds: conjunto de distritos que componen la zona (N:M). Al menos uno.
  distritoIds: z.array(idSchema).min(1),
  // tarifas: filas de tarifa_zona_mensajero. Su cardinalidad/forma depende de
  // cobroVehiculo (regla en applyTarifaRules). Default [] para poder omitirlo.
  tarifas: z.array(tarifaZonaMensajeroInputSchema).default([]),
};

// Regla condicional cobroVehiculo <-> tarifas:
// - cobroVehiculo=true: >= 1 tarifa, TODAS con vehiculoId, sin vehiculos repetidos.
// - cobroVehiculo=false: a lo sumo 1 tarifa (la "por defecto" de la zona), SIN vehiculoId.
function applyTarifaRules(
  data: { cobroVehiculo: boolean; tarifas: TarifaZonaMensajeroInput[] },
  ctx: z.RefinementCtx,
): void {
  if (data.cobroVehiculo) {
    if (data.tarifas.length < 1) {
      ctx.addIssue({
        code: "custom",
        path: ["tarifas"],
        message: "con cobroVehiculo=true se requiere al menos una tarifa",
      });
    }
    const vistos = new Set<string>();
    data.tarifas.forEach((t, i) => {
      if (t.vehiculoId === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["tarifas", i, "vehiculoId"],
          message: "vehiculoId es obligatorio con cobroVehiculo=true",
        });
        return;
      }
      if (vistos.has(t.vehiculoId)) {
        ctx.addIssue({
          code: "custom",
          path: ["tarifas", i, "vehiculoId"],
          message: "vehiculoId repetido: una sola tarifa por vehiculo",
        });
      }
      vistos.add(t.vehiculoId);
    });
  } else {
    if (data.tarifas.length > 1) {
      ctx.addIssue({
        code: "custom",
        path: ["tarifas"],
        message: "con cobroVehiculo=false se permite a lo sumo una tarifa",
      });
    }
    data.tarifas.forEach((t, i) => {
      if (t.vehiculoId !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["tarifas", i, "vehiculoId"],
          message: "no se permite vehiculoId con cobroVehiculo=false",
        });
      }
    });
  }
}

/**
 * ⭑ FICHA 376 (R1-R3) — CREAR Y ACTUALIZAR DEJAN DE COMPARTIR ESQUEMA, Y SOLO POR ESTE CAMPO.
 *
 * Hasta hoy `actualizarZonaSchema = crearZonaSchema`, y `esCentral` traia `.default(false)`. La
 * consecuencia medida: un payload de ACTUALIZACION que OMITIA el campo llegaba al servicio como
 * `false` —el `default` lo materializa— y el repositorio lo escribia. La marca se apagaba sin que
 * nadie lo pidiera, y con ella cambiaba la columna de flete de una zona entera.
 *
 * Al CREAR, el `default false` SIGUE SIENDO CORRECTO (R2): una zona nueva sin la marca es
 * exactamente lo que un payload sin el campo esta pidiendo. Al ACTUALIZAR, «ausente» significa
 * «no lo mandé»: `undefined` viaja intacto hasta el `data` de Prisma, que lo interpreta como «no
 * toques esta columna».
 *
 * ⚠️ Y POR QUE NO SE ARREGLA EN EL REPOSITORIO reescribiendo la marca cuando llega `false`:
 * porque entonces seria IMPOSIBLE apagarla nunca, y R3 exige que un `false` EXPLICITO siga siendo
 * una peticion explicita —la que la guarda de R5 rechaza CON UN MOTIVO, que es muy distinto de
 * una peticion que se ignora en silencio—. La diferencia entre «no lo pediste» y «lo pediste y no
 * se puede» tiene que sobrevivir hasta el servidor.
 *
 * Los dos siguen `.strict()` (un campo desconocido es `validation_error`, no un descarte mudo) y
 * los dos aplican `applyTarifaRules`, que solo lee `cobroVehiculo` y `tarifas` y no se toca.
 */
export const crearZonaSchema = z
  .object({
    ...zonaFieldsComunes,
    // feature 54: flag de zona central (renombrado del viejo esGam). 376/R2: el default se queda.
    esCentral: z.boolean().default(false),
  })
  .strict()
  .superRefine(applyTarifaRules);
export type CrearZonaInput = z.infer<typeof crearZonaSchema>;

// Actualizar: reemplazo completo de datos + N:M + tarifas, con UNA excepcion — la marca de zona
// central, que es `optional()` y NO tiene default (376/R1). El `id` viaja aparte en la Server
// Action.
export const actualizarZonaSchema = z
  .object({
    ...zonaFieldsComunes,
    // 376/R1: ausente = «no lo mandé» = no se toca. `null` NO sirve y se rechaza: Prisma
    // intentaria escribir NULL en una columna NOT NULL.
    esCentral: z.boolean().optional(),
  })
  .strict()
  .superRefine(applyTarifaRules);
export type ActualizarZonaInput = z.infer<typeof actualizarZonaSchema>;

// Listado: paginacion + include opcional acotado a ["tarifas"].
export const listarZonasSchema = z
  .object({
    page: z.number().int().positive().default(1),
    pageSize: z
      .number()
      .int()
      .positive()
      .default(zonasConfig.DEFAULT_PAGE_SIZE)
      .transform((n) => Math.min(n, zonasConfig.MAX_PAGE_SIZE)),
    include: z.array(z.enum(["tarifas"])).optional(),
  })
  .strict();
export type ListarZonasInput = z.infer<typeof listarZonasSchema>;

// --- DTOs expuestos por las Server Actions ---

export interface TarifaZonaMensajeroDTO {
  id: string;
  cobroEntregado: number;
  cobroRechazado: number;
  vehiculoId: string | null;
}

export interface ZonaDTO {
  id: string;
  nombre: string;
  cobroVehiculo: boolean;
  distritosCount: number;
  esCentral: boolean; // feature 54: flag de zona central (antes esGam)
  // Presente en crear/actualizar/obtener; en listar solo si include incluye "tarifas".
  tarifas?: TarifaZonaMensajeroDTO[];
}

/**
 * ⭑ FICHA 376 (Q4) — el impacto de mover la marca de zona central, POR ZONA.
 *
 * `ordenesVivas` son las ordenes de esa zona que AUN NO estan congeladas en un cierre y no estan
 * borradas: exactamente las que cambiarian de columna de flete si la marca se moviera
 * (`resolverFlete` elige `valorFleteGam` o `valorFlete` segun `esCentral`, y lo lee VIVO). Las que
 * ya tienen un `cierre_detail` no cuentan: ese snapshot fotografio `es_central` y es INMUTABLE.
 *
 * Dato de SOLO LECTURA que la pantalla pide ANTES de enviar nada, para decir el impacto en la
 * confirmacion. No participa de ningun guardado y no muta nada.
 */
export interface ImpactoZonaCentralDTO {
  zonaId: string;
  ordenesVivas: number;
}

// Aqui vivian `ProvinciaLightDTO`, `CantonLightDTO` y `DistritoCatalogoDTO` (feature 24/R14),
// los DTOs de la navegacion por niveles del catalogo geografico. Se borraron el 2026-08-07 con
// `GeoService`, `IGeoService` y los tres metodos no-Lite de `IGeoRepository`. El catalogo que
// sigue vivo (feature 144) usa `OpcionCatalogo`/`OpcionConPadre` de `lib/types/filtros-ordenes`.

// Aqui vivia el arbol zona -> canton -> distrito indexado por nombre normalizado
// (`ArbolDistritoNode`, `ArbolCantonNode`, `ArbolZonaNode`, `ArbolZonas`). Se borro el
// 2026-08-07 con toda su cadena: la accion `arbolZonas`, `IZonaService.arbol`,
// `ZonaService.arbol` y `ZonaRepository.arbol`. Su unico consumidor fue siempre `ZonaForm`.

// --- Resultados discriminados ---
export type ZonaActionError =
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  | { status: "not_found" }
  | { status: "conflict" }; // borrar una zona referenciada por provincia/orden/tarifas

export type CrearZonaResult = { status: "ok"; zona: ZonaDTO } | ZonaActionError;
export type ObtenerZonaResult = { status: "ok"; zona: ZonaDTO } | ZonaActionError;
// FICHA 366 (R12): actualizar una zona informa, en la MISMA respuesta, cuantas ordenes cambiaron
// de zona por la re-derivacion automatica de ese guardado (0 incluido). `CrearZonaResult` NO lo
// lleva: crear una zona no reconcilia nada (R13).
export type ActualizarZonaResult =
  | { status: "ok"; zona: ZonaDTO; ordenesReconciliadas: number }
  | ZonaActionError;
export type ListarZonasResult =
  | { status: "ok"; items: ZonaDTO[]; page: number; pageSize: number; total: number }
  | ZonaActionError;
/**
 * ⭑ FICHA 376 (R11) — POR QUE EL `conflict` DE BORRAR GANA UN MOTIVO.
 *
 * Hoy `conflict` significa a la vez «hay ordenes apuntando», «hay usuarios apuntando» y «hay una
 * tarifa ya liquidada», y la pantalla dice «la zona esta en uso» para los tres. R10 añade un
 * cuarto rechazo —«es la zona central»— que NO es lo mismo y que exige una salida distinta:
 * borrar las ordenes no desbloquea nada, hay que marcar OTRA zona como central. Meterlo en la
 * misma palabra seria añadir un cuarto significado a la que ya mezcla tres.
 */
export type MotivoConflictoBorrado = "en_uso" | "es_central";

export type BorrarZonaResult =
  | { status: "ok" }
  | { status: "conflict"; motivo: MotivoConflictoBorrado }
  | Exclude<ZonaActionError, { status: "conflict" }>;

/** FICHA 376 (Q4): el desenlace de la consulta de impacto. Solo lectura, `maestro`-only. */
export type ImpactoZonaCentralResult =
  | { status: "ok"; impacto: ImpactoZonaCentralDTO[] }
  | ZonaActionError;

// `GeoActionError` y `ListarProvinciasResult`/`ListarCantonesResult`/`ListarDistritosResult`
// (feature 55/R10) eran los resultados de las Server Actions de `lib/actions/geo.ts`, borradas
// el 2026-08-07. `ZonaActionError`, del que colgaban, SI sigue vivo: lo usan las cinco acciones
// de zonas que quedan.
