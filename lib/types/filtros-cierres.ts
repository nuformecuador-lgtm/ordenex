import { z } from "zod";

/**
 * Feature 230 (T1.2, design §3.1) — LISTA BLANCA de la entrada de la descarga DETALLADA de
 * cierres (la «hoja fundida», una fila por gestion).
 *
 * ## Lo que este modulo NO es
 *
 * **No es el filtro de la pantalla, y no puede serlo.** D11 hizo esta descarga INDEPENDIENTE de
 * la barra de filtros: su conjunto lo redacta integramente el dialogo (mensajeros + rango de
 * fechas), no el estado de la pantalla. Por eso no se deriva de la entrada de ningun listado:
 * las claves de aquellos —paginacion, estado, destino— no tienen ningun papel aqui, y `.strict()`
 * debe RECHAZARLAS, no aceptarlas y no usarlas.
 *
 * **Y no es el alcance.** El alcance por rol y zona lo resuelve el SERVICIO desde la SESION
 * (R15), NUNCA viaja en la peticion, y se compone con esto por CONJUNCION. Un `mensajeroIds`
 * de otra zona no ensancha nada: se cruza con el alcance y devuelve CERO filas (R37), que es
 * ademas indistinguible de «ese mensajero no tiene cierres en el rango» (R38, deliberado:
 * distinguirlos filtraria informacion sobre el alcance ajeno).
 *
 * ## Nota de aterrizaje (2026-08-18)
 *
 * `design.md §3.1` situa este schema «junto a las primitivas que este modulo ya tiene». En la
 * rama base de esta feature (`dev`) el modulo **no existia todavia** —los filtros de cierres
 * viven en otra rama sin mergear—, asi que se crea aqui con las MISMAS primitivas que
 * `lib/types/orden.ts:102-107` declara para el listado de ordenes (`idList`, `fechaCalendario`)
 * y con el MISMO `refine` de rango no invertido (`:152-156`). Se copian por VALOR y no por
 * import a proposito: son cuatro lineas y este modulo tiene que poder existir sin arrastrar el
 * schema de 11 claves del listado de ordenes. El dia que las fechas de los cierres cambien de
 * criterio, cambian aqui para los dos bordes de esta feature a la vez.
 */

/**
 * Toda lista de ids es NO VACIA y de ids no vacios (misma regla que la feature 144/R32). La
 * lista vacia NO se admite: significaria «ningun mensajero» y degradaria a «sin filtro» —es
 * decir, a TODO el alcance— si el repositorio la descartara. Falla cerrado.
 */
const listaDeIds = z.array(z.string().min(1)).nonempty();

/**
 * Fecha CALENDARIO `YYYY-MM-DD`, que es lo que emite un `<input type="date">`. El cliente nunca
 * manda instantes ni offsets: los bordes del dia se calculan en el servidor, en horario de
 * Costa Rica (`lib/utils/fecha-cr.ts`).
 */
const fechaCalendario = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato esperado YYYY-MM-DD");

/** R32 — mensaje del rango invertido, en un solo sitio para los dos bordes de la feature. */
export const MENSAJE_RANGO_DESCARGA_GESTIONES = "El rango de fechas esta invertido";

/**
 * Feature 230 (T1.2, R19/R31/R32/R33/R36/R39) — las TRES unicas claves que esta lectura acepta.
 *
 * - `mensajeroIds`: OBLIGATORIO y no vacio. Confirmar el dialogo sin ningun mensajero elegido no
 *   debe llamar al servidor (R39); si algun cliente lo intenta, muere aqui y no en una consulta
 *   que habria devuelto el alcance entero.
 * - `desde` / `hasta`: OPCIONALES e independientes (R31). No son un adorno: sin ellos el
 *   conjunto por defecto es TODO el historico del mensajero, que a grano de gestion choca contra
 *   el tope de 5000 casi de inmediato (design §4, riesgo 1).
 *
 * `.strict()` es la UNICA defensa que impide que una clave arbitraria alcance el servicio: con
 * ella, `destinoZonaIds`, `page` o `pageSize` son `validation_error` en el BORDE (R19), antes de
 * tocar la base y antes de que nadie pueda leerlas como alcance.
 *
 * La comparacion del rango es LEXICOGRAFICA y eso es correcto, no un atajo: `YYYY-MM-DD` es de
 * ancho fijo y de mayor a menor, asi que su orden alfabetico es su orden cronologico.
 */
export const filtrosDescargaGestionesSchema = z
  .object({
    mensajeroIds: listaDeIds,
    desde: fechaCalendario.optional(),
    hasta: fechaCalendario.optional(),
  })
  .strict()
  .refine((f) => !(f.desde && f.hasta) || f.desde <= f.hasta, {
    path: ["hasta"],
    message: MENSAJE_RANGO_DESCARGA_GESTIONES,
  });

export type FiltrosDescargaGestiones = z.infer<typeof filtrosDescargaGestionesSchema>;
