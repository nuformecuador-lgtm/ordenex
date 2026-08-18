// Pedido humano del 2026-08-16 — FILTROS de los listados de cierres del día del admin
// (fecha, bodega destino, mensajero). Módulo del BORDE: solo zod y utilidades de fecha; sin
// Prisma, sin servicios, sin React.
//
// LA DISTINCIÓN QUE SOSTIENE TODO ESTE ARCHIVO, y que no se puede perder de vista al leerlo:
// **un filtro NO es un alcance**. El alcance —qué cierres puede ver este actor— lo resuelve el
// SERVICIO desde la sesión y va SIEMPRE en el `WHERE` (38/R2/R13); estas claves solo RECORTAN
// dentro de lo que el alcance ya dejó pasar. El repositorio las compone con `AND`, nunca en
// lugar del alcance.
//
// Esa frase tiene un antecedente concreto en este repo, y por eso está escrita: hasta hoy el
// schema de estos listados era `paginaInputSchema(...)` a secas, con un `.strict()` cuyo
// comentario nombraba a `destinoZonaId` como LA clave peligrosa —«el alcance de esta pantalla
// es rol + zona DESTINO, así que una clave de alcance que el servicio llegara a leer algún día
// abriría el dinero de la bodega vecina»—. Ese `.strict()` sigue vivo: lo que cambia es que
// ahora hay una lista blanca EXPLÍCITA de cuatro claves de filtro, y `destinoZonaIds` está en
// ella **como recorte y en plural**, no como el escalar de alcance que aquel comentario temía.
// Un `adminSatelite` que pida la zona del vecino no ve la zona del vecino: ve VACÍO, porque su
// alcance ya lo había acotado a la suya y el filtro solo puede quitar filas, nunca añadirlas.
// La guardia `tests/unit/guards/filtros-cierres-alcance.guardia.test.ts` lo fija.

import { z } from "zod";

import { esFechaCalendarioValida } from "@/lib/utils/fecha-cr";

/** Tope de ids por lista. Un filtro es un recorte, no un canal para mandar un dataset. */
export const MAX_IDS_POR_FILTRO = 200;

/** `YYYY-MM-DD` de calendario **de Costa Rica**, que es como el usuario piensa las fechas. */
const fechaCalendario = z
  .string()
  .refine(esFechaCalendarioValida, { message: "La fecha debe tener el formato AAAA-MM-DD" });

/**
 * Una lista de ids OBLIGATORIA. Se declara aparte de `listaDeIds` para que la descarga detallada
 * de gestiones (feature 230) pueda exigirla sin volver a escribir el tope, el `nonempty` ni el
 * `uuid`: alli «ningun mensajero elegido» no es «todos», es un error (R39).
 */
const listaDeIdsRequerida = z.array(z.string().uuid()).max(MAX_IDS_POR_FILTRO).nonempty();

const listaDeIds = listaDeIdsRequerida.optional();

/**
 * Lo que TODO listado de cierres puede recortar: un rango de fechas y una o varias bodegas.
 *
 * `desde`/`hasta` son INCLUSIVOS y se miden sobre la fecha de SOLICITUD, que es por la que
 * estos listados ya se ordenaban y la única que TODOS los cierres tienen: un cierre sin
 * resolver no tiene `resueltoAt`, y filtrar una cola por esa fecha la dejaría siempre vacía.
 */
const camposComunes = {
  desde: fechaCalendario.optional(),
  hasta: fechaCalendario.optional(),
  /**
   * Bodegas por las que recortar. En plural y como recorte: ver la nota de cabecera sobre por
   * qué esto no reabre el alcance. En los cierres del día es la zona DESTINO; en los de bodega,
   * la zona del propio cierre.
   */
  destinoZonaIds: listaDeIds,
};

/**
 * El rango invertido se rechaza en el borde en vez de devolver cero filas en silencio: «no hay
 * cierres» y «pediste del 30 al 1» son cosas distintas, y sin esto se leen igual.
 */
const rangoCoherente = (f: { desde?: string; hasta?: string }) =>
  !(f.desde && f.hasta) || f.desde <= f.hasta;
const MENSAJE_RANGO = {
  path: ["hasta"],
  message: "El rango de fechas está invertido",
};

/**
 * Los filtros de los listados de CIERRES DEL DÍA: los comunes más el mensajero, que es de quien
 * es el cierre. TODOS opcionales: sin ninguno, el listado es exactamente el de antes.
 */
export const filtrosCierresSchema = z
  .object({ ...camposComunes, mensajeroIds: listaDeIds })
  .strict()
  .refine(rangoCoherente, MENSAJE_RANGO);

/**
 * Los filtros de los listados de CIERRES DE BODEGA: los comunes y nada más.
 *
 * SIN MENSAJERO, por pedido humano del 2026-08-16 («en la parte de bodega deja el mismo filtro
 * solo omitiendo el de mensajero») y porque el dato no existiría: un cierre de bodega consolida
 * los cierres del día de VARIOS mensajeros, así que «el mensajero de este cierre» no es una
 * pregunta con respuesta. No es una simplificación de la UI: es que la columna no está.
 *
 * Se declara desde los MISMOS campos comunes y con la MISMA regla de rango, en vez de copiarse:
 * el día que las fechas cambien de criterio, cambian para los cinco listados a la vez.
 */
export const filtrosCierresBodegaSchema = z
  .object(camposComunes)
  .strict()
  .refine(rangoCoherente, MENSAJE_RANGO);

export type FiltrosCierresBodega = z.infer<typeof filtrosCierresBodegaSchema>;

export type FiltrosCierres = z.infer<typeof filtrosCierresSchema>;

/** Los filtros ya validados, tal como los reciben el servicio y el repositorio. */
export const filtrosCierresOpcionalSchema = filtrosCierresSchema.optional();

/**
 * `true` si el objeto no recorta nada. Lo usan la pantalla —para decidir si ofrece «limpiar»—
 * y las pruebas, para afirmar que el camino sin filtros sigue siendo el de antes.
 */
export function sinFiltros(filtros: FiltrosCierres | undefined): boolean {
  if (!filtros) return true;
  return (
    filtros.desde === undefined &&
    filtros.hasta === undefined &&
    filtros.destinoZonaIds === undefined &&
    filtros.mensajeroIds === undefined
  );
}

/**
 * Feature 230 (T1.2, design §3.1, R19/R31/R32/R33/R36/R39) — la lista blanca de la descarga
 * DETALLADA de cierres (la «hoja fundida», una fila por GESTION).
 *
 * **No es `filtrosCierresSchema`, y esa es la decision.** D11 hizo esta descarga INDEPENDIENTE
 * de la barra de filtros: su conjunto lo redacta integramente el dialogo, no el estado de la
 * pantalla. `destinoZonaIds` no tiene ningun papel aqui —el eje de zona ya lo fija el alcance en
 * cada pantalla— y `.strict()` debe RECHAZARLA, no aceptarla y no usarla.
 *
 * Se declara en ESTE modulo y desde SUS primitivas —`listaDeIdsRequerida`, `fechaCalendario`,
 * `rangoCoherente`, `MENSAJE_RANGO`— por el mismo motivo escrito arriba para el schema de
 * bodega: el dia que las fechas cambien de criterio, cambian para todos los listados de cierres
 * a la vez, este incluido.
 *
 * Dos diferencias con sus hermanos, y las dos son requisitos:
 *
 *  - **`mensajeroIds` es OBLIGATORIO y no vacio** (R39, ratificado por el humano el 2026-08-18).
 *    En los listados el mensajero es un recorte opcional; aqui es el conjunto mismo. Confirmar
 *    el dialogo sin nadie elegido no debe llamar al servidor, y si algun cliente lo intenta
 *    muere en el borde y no en una consulta que habria devuelto el alcance entero.
 *  - **`desde`/`hasta` no son un adorno** (R31): sin ellos el conjunto por defecto es TODO el
 *    historico del mensajero, que a grano de gestion choca contra el tope de 5000 casi de
 *    inmediato. Son la mitigacion de producto de ese riesgo, no una comodidad.
 *
 * El ALCANCE, como en todo este modulo, NO viaja aqui: lo resuelve el servicio desde la sesion y
 * lo compone con esto por conjuncion. Un `mensajeroIds` de otra zona no ensancha nada — da CERO
 * filas (R37), indistinguible de «ese mensajero no tiene cierres en el rango» (R38, deliberado).
 *
 * `FiltrosDescargaGestiones` es un SUBCONJUNTO ESTRUCTURAL de `FiltrosCierres`, asi que
 * `filtrosWhere` del repositorio se reusa sin tocarlo.
 */
export const filtrosDescargaGestionesSchema = z
  .object({
    mensajeroIds: listaDeIdsRequerida,
    desde: fechaCalendario.optional(),
    hasta: fechaCalendario.optional(),
  })
  .strict()
  .refine(rangoCoherente, MENSAJE_RANGO);

export type FiltrosDescargaGestiones = z.infer<typeof filtrosDescargaGestionesSchema>;

/** Una opción de los selectores: lo mínimo para pintarla y emitirla. Nunca PII. */
export interface OpcionFiltroCierres {
  id: string;
  nombre: string;
}

/**
 * Un mensajero del selector, con SU zona. El `zonaId` es lo que hace posible el encadenado que
 * pidió el humano: elegir una bodega recorta la lista de mensajeros a los de esa zona. `null`
 * cuando el mensajero no tiene zona asignada (la columna es nullable): se sigue ofreciendo
 * —sus cierres existen— pero no cuelga de ninguna bodega.
 */
export interface OpcionMensajeroFiltro extends OpcionFiltroCierres {
  zonaId: string | null;
}

/**
 * Las opciones que la pantalla ofrece, ya acotadas al alcance del actor y derivadas de los
 * cierres que existen (ver `CierresAdminRepository.findCatalogoFiltros`). Orden determinista
 * por nombre.
 */
export interface CatalogoFiltrosCierresDTO {
  /**
   * Las zonas que pueden SER una bodega: las que tienen `adminSatelite` asignado, más la
   * central (la GAM). Acotadas al alcance del actor.
   */
  zonas: OpcionFiltroCierres[];
  /** TODOS los mensajeros del alcance —activos o no—, cada uno con su zona. */
  mensajeros: OpcionMensajeroFiltro[];
}

/** Catálogo vacío: lo que ve un `adminSatelite` sin zona, sin consultar la base. */
export const CATALOGO_FILTROS_CIERRES_VACIO: CatalogoFiltrosCierresDTO = {
  zonas: [],
  mensajeros: [],
};
