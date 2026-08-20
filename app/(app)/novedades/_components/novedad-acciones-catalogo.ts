import type { GrupoNovedad } from "@/lib/types/novedad-grupo";

// Feature 236 (T5.1, design §6.2 — R18/R19/R20/R21) — EL PUNTO UNICO donde se decide que acciones
// ofrece una fila de `/novedades`.
//
// EL PROBLEMA QUE CIERRA, MEDIDO. Hasta el 2026-08-19 `NovedadAcciones` lo decidia con CONDICIONES
// SUELTAS repartidas por el componente: `esDevuelta`, `esAyuda`, `puedeHabilitar = esDevuelta ||
// esAyuda`, tres `...(cond ? [x] : [])` dentro del arreglo y un `{esAyuda ? … : null}` al final.
// Ese diseño ya produjo un defecto: «Habilitar» aparece justamente en las cards que vienen de un
// cierre —el punto 12 del pedido humano, AL REVES de lo que pedia— y lo produjo porque NADA OBLIGA
// A LA SEXTA CONDICION: se añade una accion y no hay ningun sitio que reclame la decision para el
// otro grupo. Con la tabla, esa decision no se puede omitir: falta una clave y no compila (R20).
//
// POR QUE VIVE AQUI Y NO EN `components/shared/`. Tiene UN solo consumidor (`NovedadAcciones`), y
// `docs/architecture.md` §«sin sobre-ingenieria» dice que un solo consumidor no se promueve. Su
// hermano de la misma carpeta (`novedades-descarga-columnas.ts`) sigue el mismo criterio.
//
// MODULO PURO: sin React, sin DOM. Lo que declara es QUE se ofrece, no COMO se pinta — el rotulo,
// el icono y el handler de cada accion viven en el componente, que es quien tiene JSX.

/**
 * Las acciones que la fila de `/novedades` puede ofrecer. La union es CERRADA: una accion que no
 * este aqui no se puede meter en la tabla (R20, mitad).
 */
export type AccionNovedad =
  /** «Llamar» + «WhatsApp» (`ContactoButtons`, feature 87/R12/R15/R16). */
  | "contacto"
  /** «Reprogramar» (feature 100/R1). Presupone una devolucion. */
  | "reprogramar"
  /** «Habilitar»: devolver la orden a la ruta (el rescate de la 235, con nota obligatoria, D2). */
  | "habilitar"
  /** «Rechazar»: MAQUETA hasta la ficha 240 (avisa por toast, no muta nada). */
  | "rechazar"
  /** «+1 intento de contacto» y su contador (`IntentoContactoAccion`). */
  | "intentoContacto"
  /** «Conversación»: abre el hilo de notas de la orden. Lo NUEVO de esta ficha (R27). */
  | "conversacion";

/**
 * **LA TABLA.** Que ofrece cada grupo, en el orden en que se pinta.
 *
 * ⚠️ SE INDEXA POR EL MISMO `GrupoNovedad` QUE USA EL SERVIDOR (`ESTATUS_POR_GRUPO`), y eso es R6
 * entero: lo que el servidor lista y lo que la pantalla ofrece **no pueden describir grupos
 * distintos**. Un grupo nuevo en el mapa rompe el `satisfies` de aqui, asi que la decision «y que
 * botones lleva» se reclama en el typecheck y no en produccion.
 *
 * `contacto` ENTRA EN LA TABLA aunque este en los dos grupos. Si se quedara fuera «porque siempre
 * esta», la tabla dejaria de ser el censo de lo que la fila ofrece y volveria a haber una decision
 * fuera de ella: la tabla es TODO el panel de acciones o no sirve para nada (R18).
 *
 * ⚠️ `habilitar` EN `devolucion` ES TRADUCCION LITERAL, NO ARREGLO. Es el punto 12 del pedido
 * humano —«Habilitar» aparece justo en las cards que vienen de un cierre, al reves de lo que se
 * pidio— y **su dueño es la ficha 240** (puerta humana del 2026-08-19, `design.md` §10-E).
 * Adelantarlo aqui mezclaria una ficha de superficie con una de conducta y dejaria a la 240 sin su
 * mitad visible. Lo que esta ficha SI hace es mover el defecto a UNA CELDA DE ESTA TABLA: para la
 * 240, corregirlo pasa a ser borrar una palabra de esta linea.
 *
 * `reprogramar` y `rechazar` NO estan en `ayuda` (R23): las dos presuponen una devolucion que sobre
 * una orden en ayuda no existe —el paquete sigue en la moto—, y `ReprogramacionTiendaService` ya
 * rechaza con `conflict` toda orden fuera de `devuelta`, asi que ofrecer el boton solo conseguiria
 * que la tienda descubriera el limite pulsandolo. Gestionar DESDE ayuda es la ficha 237.
 */
export const ACCIONES_POR_GRUPO = {
  ayuda: ["contacto", "habilitar", "conversacion", "intentoContacto"],
  devolucion: ["contacto", "reprogramar", "habilitar", "rechazar"],
} as const satisfies Record<GrupoNovedad, readonly AccionNovedad[]>;

/**
 * **R21 — FALLO CERRADO.** Lo que se ofrece sobre una fila cuyo estado no pertenece a ningun grupo
 * declarado (`grupoDeEstatus` devolvio `null`): **ninguna accion que la resuelva**.
 *
 * Queda `contacto` porque llamar o escribirle al destinatario no resuelve la orden ni presupone
 * nada de su estado — es informacion de contacto que la fila ya trae. Todo lo demas (reprogramar,
 * habilitar, rechazar, la conversacion y el contador) se retira.
 *
 * No puede ocurrir con los predicados del servidor —solo lista esos dos estados— y precisamente por
 * eso esta escrito: el dia que un tercer camino traiga una fila por otra via, la pantalla no se
 * inventara botones para ella. Vive AQUI, dentro del catalogo, para que siga habiendo **un solo
 * sitio** donde se decide que se ofrece (R18/R19).
 */
export const ACCIONES_SIN_GRUPO: readonly AccionNovedad[] = ["contacto"];
