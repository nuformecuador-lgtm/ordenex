// Feature 135 (T5.1) — esquema zod de los filtros de analitica (design.md §5).
//
// R1 (modulo puro): este archivo importa EXCLUSIVAMENTE `zod`, `./types` y
// `@/lib/utils/fecha-cr` (que es a su vez puro: aritmetica de fecha sin
// dependencias, la misma que ya reutilizan `ranges.ts` y `backfill-rango.ts`).
// Sin `'use server'`, sin `next/headers`, sin `@/lib/db`, sin repositorios ni
// servicios, sin `@prisma/client` y sin efectos al importarse: solo declaraciones
// y funciones puras. Es el UNICO archivo de `lib/analytics/` que importa `zod`.
//
// Se copia el PATRON de `ordenFilterSchema` (`lib/types/orden.ts:98-134`), no el
// objeto (design.md §7, alternativa 4): aquel arrastra `status_id`, la geografia
// (`provincia_id`/`canton_id`/`distrito_id`), `reasignables` y los presets
// `7d/15d/30d/90d`, ninguno de los cuales pertenece al contrato de analitica; y
// ampliarlo obligaria a aflojar sus `refine`, que hoy protegen el listado de
// ordenes. Lo que SI se copia: `.strict()`, listas no vacias de ids no vacios,
// fechas calendario `YYYY-MM-DD` y conflictos cerrados con `.refine`.

import { z } from "zod";
import { esFechaCalendarioValida } from "@/lib/utils/fecha-cr";
import { RANGO_PRESETS, RANGO_TOPE_DIAS } from "./types";

/* -------------------------------------------------------------------------- */
/* Piezas del schema                                                           */
/* -------------------------------------------------------------------------- */

// R21 — patron feature 144/R32: todo filtro de catalogo es una LISTA NO VACIA de
// ids no vacios. No se admite el escalar, ni la lista vacia: una lista vacia
// significaria "ningun valor" y degradaria silenciosamente a "sin filtro" si el
// repositorio la descartara. Falla CERRADO.
const idList = z.array(z.string().min(1, "Id vacio")).nonempty("La lista no puede estar vacia");

// R22 — el cliente NUNCA manda instantes: ni ISO con hora, ni offset, ni huso, ni
// epoch. Manda un preset, o dos fechas CALENDARIO de ancho fijo `YYYY-MM-DD` (lo
// que emite `<input type="date">`); los bordes UTC los calcula `resolverRango`
// server-side, en hora de Costa Rica. El regex esta anclado y es de ancho fijo a
// proposito: `"2026-7-5"` se rechaza igual que `"2026-07-15T10:00:00Z"`.
//
// El regex mide la FORMA, no la EXISTENCIA, y no basta: `"2026-02-31"` la cumple
// y `new Date("2026-02-31T00:00:00.000Z")` no es `Invalid Date` sino el 3 de
// marzo (en V8 solo el MES fuera de rango invalida; el DIA desbordado RUEDA). Sin
// esta comprobacion el par `2026-02-31..2026-03-05` pasaba entero: forma correcta,
// orden lexicografico correcto, ventana de 3 dias bien dentro del tope — y la
// analitica respondia por una ventana DESPLAZADA respecto de la que se pidio, sin
// un solo error. El round-trip es la pieza unica de `@/lib/utils/fecha-cr`.
const fechaCalendario = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Formato esperado YYYY-MM-DD")
  .refine(esFechaCalendarioValida, "La fecha no existe en el calendario");

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/**
 * Dias entre dos fechas calendario contando AMBOS extremos (R29): el mismo dia
 * son 1 dia, no 0. Se resuelve sobre medianoche UTC porque aqui solo se cuenta
 * calendario, no se fija ninguna frontera de dia de Costa Rica (eso es de
 * `ranges.ts`): no hay desfase propio que reimplementar (R14).
 *
 * Devuelve `NaN` si alguna fecha no existe en el calendario (p. ej. `"2026-13-45"`),
 * y el `.refine` del tope lo trata como rechazo: falla cerrado en vez de dejar pasar
 * una ventana de duracion desconocida. Es DEFENSA EN PROFUNDIDAD y ya no la primera
 * red: desde el arreglo del dia rodado, `fechaCalendario` rechaza esas fechas en el
 * campo, antes de llegar aqui. Se conserva porque esta funcion es reutilizable y no
 * debe depender de que su llamador haya validado, pero OJO al medir mutaciones: hoy
 * mutar este `Number.isFinite` no tumba nada por si solo. El caso que SI discrimina
 * la existencia de la fecha es el del campo (`R22`, en `filters.test.ts`).
 */
function diasInclusive(desde: string, hasta: string): number {
  const a = Date.parse(`${desde}T00:00:00.000Z`);
  const b = Date.parse(`${hasta}T00:00:00.000Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.NaN;
  return Math.round((b - a) / MS_POR_DIA) + 1;
}

/* -------------------------------------------------------------------------- */
/* El schema (design.md §5)                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Filtro que acepta TODA la analitica. Lo que NO lleva es tan contrato como lo
 * que lleva: **no hay rol, ni sesion, ni `usuario_id`, ni campo de alcance**
 * (R24). Un filtro valido NO significa acceso concedido; el recorte por rol lo
 * aplica la feature 122 ENCIMA del filtro ya validado. El orden es siempre:
 * parsear -> resolver alcance -> consultar.
 */
export const analiticaFiltroSchema = z
  .object({
    // R20 — obligatorio y de dominio CERRADO: los cuatro valores de RANGO_PRESETS
    // (`dia | semana | mes | personalizado`, D4). Un valor fuera del dominio se
    // rechaza, y la ausencia del campo tambien.
    rango: z.enum(RANGO_PRESETS),
    // D4/R29 — solo con `rango: "personalizado"`; con un preset son un error, no
    // un silencio (ver el segundo `.refine`).
    desde: fechaCalendario.optional(),
    hasta: fechaCalendario.optional(),
    // R21 — dimensiones opcionales.
    zona_id: idList.optional(),
    tienda_id: idList.optional(),
    mensajero_id: idList.optional(),
  })
  // R19/R24 — borde CERRADO: cualquier clave desconocida es un error de
  // validacion. Es lo que hace que `{ rol: "maestro" }` o `{ usuario_id: "u1" }`
  // sean un rechazo y no un vector de escalada.
  .strict()
  // R29 (1) — `personalizado` EXIGE el par de fechas.
  .refine((f) => f.rango !== "personalizado" || (Boolean(f.desde) && Boolean(f.hasta)), {
    path: ["desde"],
    message: "El rango personalizado exige desde y hasta",
  })
  // R29 (2) — y al reves: con un preset, `desde`/`hasta` estan PROHIBIDOS. El
  // borde falla cerrado en vez de inventar una precedencia silenciosa para un
  // cliente que construya el filtro a mano (patron `ordenFilterSchema`).
  .refine((f) => f.rango === "personalizado" || (!f.desde && !f.hasta), {
    path: ["desde"],
    message: "desde y hasta solo valen con el rango personalizado",
  })
  // R29 (3) — rango no invertido. La comparacion lexicografica de `YYYY-MM-DD` es
  // equivalente a la cronologica (formato de ancho fijo, de mayor a menor unidad).
  .refine((f) => !f.desde || !f.hasta || f.desde <= f.hasta, {
    path: ["hasta"],
    message: "El rango de fechas esta invertido",
  })
  // R29 (4) — tope de ventana contando AMBOS extremos. El tope vive en
  // `RANGO_TOPE_DIAS` (`./types`), NUNCA en un literal aqui: ajustarlo debe ser un
  // one-liner con su test, no una caceria de numeros sueltos.
  .refine(
    (f) => {
      if (!f.desde || !f.hasta || f.desde > f.hasta) return true; // lo cierra el refine (3)
      const dias = diasInclusive(f.desde, f.hasta);
      return Number.isFinite(dias) && dias <= RANGO_TOPE_DIAS;
    },
    {
      path: ["hasta"],
      message: `La ventana no puede superar ${RANGO_TOPE_DIAS} dias`,
    },
  );

export type AnaliticaFiltroInput = z.infer<typeof analiticaFiltroSchema>;

/* -------------------------------------------------------------------------- */
/* Parseo con resultado discriminado (R23)                                     */
/* -------------------------------------------------------------------------- */

/**
 * Clave bajo la que se agrupan los errores que no pertenecen a ningun campo
 * concreto. Los cuatro `.refine` declaran su `path`, asi que en la practica solo
 * caeria aqui un error de forma (p. ej. `raw` no es un objeto).
 */
export const CLAVE_ERROR_GENERAL = "_";

export type AnaliticaFiltroResultado =
  | { status: "ok"; filtro: AnaliticaFiltroInput }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };

/**
 * Parsea el filtro SIN lanzar (R23). Devuelve un resultado discriminado y, en el
 * caso de error, `fieldErrors: Record<string, string[]>` — exactamente la forma
 * que ya consume el borde del repo (`ActionError.validation_error`,
 * `lib/types/orden.ts:204-209`).
 *
 * Los errores se derivan de `error.issues` (zod v4) y no de `z.flattenError`
 * porque las claves desconocidas (`unrecognized_keys`) llegan con `path: []` y
 * acabarian en `formErrors`, invisibles para un consumidor que solo pinta
 * `fieldErrors`: aqui cada clave desconocida se reporta bajo SU PROPIO nombre.
 * No se filtra ningun internal: solo el mensaje declarado en el schema.
 */
export function parseAnaliticaFiltro(raw: unknown): AnaliticaFiltroResultado {
  const parsed = analiticaFiltroSchema.safeParse(raw);
  if (parsed.success) {
    return { status: "ok", filtro: parsed.data };
  }

  const fieldErrors: Record<string, string[]> = {};
  const push = (clave: string, mensaje: string) => {
    (fieldErrors[clave] ??= []).push(mensaje);
  };

  for (const issue of parsed.error.issues) {
    if (issue.code === "unrecognized_keys") {
      for (const clave of issue.keys) push(clave, issue.message);
      continue;
    }
    const clave = issue.path.map(String).join(".");
    push(clave === "" ? CLAVE_ERROR_GENERAL : clave, issue.message);
  }

  return { status: "validation_error", fieldErrors };
}
