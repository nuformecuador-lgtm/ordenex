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
  /**
   * «Rechazar» (feature 240/R27). Presupone una devolucion ANCLADA: lleva la orden de
   * `devuelta` a `rechazada` por decision de la tienda dueña, con motivo obligatorio.
   *
   * ⚠️ HASTA EL 2026-08-20 ESTA LINEA DECIA «MAQUETA hasta la ficha 240 (avisa por toast, no muta
   * nada)», y era cierto: el boton estuvo dos semanas en la fila avisando por `toast.info` sin
   * producir ninguna operacion. Ya no: su productor es `rechazarNovedad` y esta declarado abajo,
   * en `PRODUCTOR_POR_ACCION`, que es lo que impide que vuelva a quedarse en maqueta sin que nadie
   * lo note.
   */
  | "rechazar"
  /** «+1 intento de contacto» y su contador (`IntentoContactoAccion`). */
  | "intentoContacto"
  /** «Conversación»: abre el hilo de notas de la orden. Lo NUEVO de esta ficha (R27). */
  | "conversacion"
  /**
   * Feature 237 (R1, mitad de pantalla) — «Reprogramar» DESDE LA AYUDA. Abre
   * `GestionarDesdeAyudaModal` en su modo de reprogramar y registra una gestion que cuenta como
   * del mensajero.
   *
   * ⚠️ CLAVE PROPIA, NO `reprogramar`. Ver la nota de la tabla: reutilizar aquella obligaria a
   * `NovedadAcciones` a ramificar POR GRUPO para elegir a que servicio llama, y esa es justo la
   * decision fuera de la tabla que R18/R19 de la 236 prohiben.
   */
  | "reprogramarDesdeAyuda"
  /** Feature 237 (R1, mitad de pantalla) — «Rechazar» DESDE LA AYUDA. Clave propia, idem. */
  | "rechazarDesdeAyuda";

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
 * ⚠️ FEATURE 240 (T5.1, R33/R34, 2026-08-20) — EL PUNTO 12, CERRADO: `habilitar` SALE DE
 * `devolucion`.
 *
 * **Lo que esta nota decia hasta hoy, y ya no aplica:** «`habilitar` EN `devolucion` ES TRADUCCION
 * LITERAL, NO ARREGLO. Es el punto 12 del pedido humano —«Habilitar» aparece justo en las cards que
 * vienen de un cierre, al reves de lo que se pidio— y su dueño es la ficha 240… Lo que esta ficha SI
 * hace es mover el defecto a UNA CELDA DE ESTA TABLA: para la 240, corregirlo pasa a ser borrar una
 * palabra de esta linea».
 *
 * **Que se hizo:** exactamente eso. Se borro la palabra. La celda de `devolucion` pasa de cuatro
 * acciones a TRES y «Habilitar» queda SOLO en el grupo de ayuda (R33/R34), que es donde el pedido
 * humano lo puso desde el principio: habilitar significa devolver a la ruta una orden cuyo paquete
 * SIGUE EN LA MOTO. Sobre una orden en la devolucion anclada el paquete ya volvio a la bodega y ya
 * se escaneo fisicamente al aprobar el cierre (238), asi que «Habilitar» ahi ofrecia deshacer algo
 * que fisicamente no se puede deshacer.
 *
 * **Y NO se toco nada del servidor** (D4, firmada): `HabilitarNovedadResult` sale intacto de esta
 * ficha. El rescate ya era un no-op deliberado fuera del estatus de ayuda, asi que con la celda
 * borrada la pregunta que la 236/D8 difirio —«que debe ADEMAS mover Habilitar»— se cierra por
 * construccion: lo que debe mover es exactamente lo que ya mueve. La coordinacion que aquel
 * comentario dejo firmada queda cerrada sin que ninguna de las dos fichas escriba sobre la otra.
 *
 * ⚠️ FEATURE 237 (T7.1, design §12.1 — R1) — LA AYUDA GANA SUS DOS DESENLACES, CON CLAVES PROPIAS.
 *
 * **Lo que esta linea decia hasta el 2026-08-20, y ya no es cierto:** «`reprogramar` y `rechazar`
 * NO estan en `ayuda` (R23): las dos presuponen una devolucion que sobre una orden en ayuda no
 * existe —el paquete sigue en la moto—, y `ReprogramacionTiendaService` ya rechaza con `conflict`
 * toda orden fuera de `devuelta`, asi que ofrecer el boton solo conseguiria que la tienda
 * descubriera el limite pulsandolo. Gestionar DESDE ayuda es la ficha 237».
 *
 * **Que cambio.** La 237 declaro las dos aristas que faltaban desde `ayuda_tienda` (#65 y #66) y su
 * productor, asi que la tienda ya puede resolver: reprogramar y rechazar, y nada mas (R1). Lo que
 * sigue siendo cierto de la frase de arriba es su MOTIVO, y por eso las claves son OTRAS:
 * `reprogramar` sigue significando «reprogramar una DEVOLUCION» (`ReprogramacionTiendaService`,
 * feature 100) y `rechazar` significa «rechazar una DEVOLUCION ANCLADA» (`RechazoTiendaService`,
 * feature 240 — hasta el 2026-08-20 esta linea decia «sigue siendo la maqueta de la 240», que dejo
 * de ser cierto en cuanto la ficha cablo el boton). Las dos nuevas van a otro servicio, otro modal y
 * otro estado de origen.
 *
 * **Por que claves propias y no las de `devolucion`** (design §12.1, alternativa E descartada): si
 * se reutilizaran, `NovedadAcciones` tendria que RAMIFICAR POR GRUPO para elegir a que servicio
 * llama —uno en la devolucion, otro en la ayuda— y eso es exactamente la decision fuera de la tabla
 * que R18/R19 de la 236 prohiben, con su guardia vigilandolo. Con claves propias cada accion tiene
 * UN handler y la tabla sigue siendo el censo completo.
 *
 * **Y ninguna mas.** `entregada`, `devolucion_por_confirmar` e `incidente` no tienen arista
 * declarada desde la ayuda ni productor, asi que tampoco tienen boton: la tienda no puede declarar
 * entregado un paquete que no vio.
 */
export const ACCIONES_POR_GRUPO = {
  ayuda: [
    "contacto",
    "reprogramarDesdeAyuda",
    "rechazarDesdeAyuda",
    "habilitar",
    "conversacion",
    "intentoContacto",
  ],
  devolucion: ["contacto", "reprogramar", "rechazar"],
} as const satisfies Record<GrupoNovedad, readonly AccionNovedad[]>;

/**
 * **R21 — FALLO CERRADO.** Lo que se ofrece sobre una fila cuyo estado no pertenece a ningun grupo
 * declarado (`grupoDeEstatus` devolvio `null`): **ninguna accion que la resuelva**.
 *
 * Queda `contacto` porque llamar o escribirle al destinatario no resuelve la orden ni presupone
 * nada de su estado — es informacion de contacto que la fila ya trae. Todo lo demas (reprogramar,
 * habilitar, rechazar, los dos desenlaces desde la ayuda de la 237, la conversacion y el contador)
 * se retira.
 *
 * No puede ocurrir con los predicados del servidor —solo lista esos dos estados— y precisamente por
 * eso esta escrito: el dia que un tercer camino traiga una fila por otra via, la pantalla no se
 * inventara botones para ella. Vive AQUI, dentro del catalogo, para que siga habiendo **un solo
 * sitio** donde se decide que se ofrece (R18/R19).
 */
export const ACCIONES_SIN_GRUPO: readonly AccionNovedad[] = ["contacto"];

// =================================================================================================
// ⚠️ FEATURE 240 (T6.1, design §11.1 — R37/R38/R39, D3 firmada) — CADA ACCION DICE QUE OPERACION LA
// PRODUCE. LA GUARDIA CONTRA LA MAQUETA.
// =================================================================================================
//
// **El defecto que cierra, medido y con fechas.** «Rechazar» (rotulado «Devolver» hasta el
// 2026-08-19) estuvo en la fila DESDE EL 2026-08-12 avisando por `toast.info("Esta accion todavia
// no esta disponible.")` y sin mutar nada. Dos semanas. La suite entera estuvo verde, y con razon:
// `superficie-de-uso.guardia.test.ts` tiene tres capas y NINGUNA VE UNA MAQUETA — R-A mira acciones
// sin superficie y `avisarNoDisponible` no era una accion; R-B mira componentes que nadie monta y
// `NovedadAcciones` estaba montado; R-C mira handlers sin quien los llame y aquel SI se referenciaba.
// Lo que faltaba no era una capa mas de alcanzabilidad: era ATAR EL CENSO DE BOTONES AL CENSO DE
// OPERACIONES. El censo de botones es la tabla de arriba (236/R18); el eslabon que faltaba es esto.
//
// **Por que vive AQUI y no en una allowlist de un test.** Por la misma razon que la tabla: es el
// mismo censo. Una lista paralela en `tests/` se desincroniza y nadie la poda; aqui la decision se
// reclama en el sitio donde se declara la accion. Es ademas la convencion que el repo ya adopto para
// `@sin-superficie` («la excepcion va anotada junto al export, no en una allowlist… una excepcion
// que sobrevive a su motivo es basura»).

/**
 * Que produce una accion de la fila: **una Server Action con su modulo**, o el **motivo escrito** de
 * que no produzca ninguna.
 *
 * La union es de dos ramas y no un campo opcional a proposito: un `accionServidor?: string` dejaria
 * «no lo he decidido» y «no produce nada, y aqui esta el porque» escritos IGUAL, que es exactamente
 * el estado en el que vivio la maqueta.
 */
export type ProductorAccion =
  | {
      /** El nombre EXACTO del `export async function` que la accion dispara. */
      readonly accionServidor: string;
      /** Su modulo, relativo a la raiz del repo y SIN extension (`lib/actions/<algo>`). */
      readonly modulo: string;
    }
  | {
      /**
       * El motivo, escrito, de que esta accion no produzca ninguna operacion de servidor. Minimo 20
       * caracteres y sin relleno (`TODO`, `pendiente`, `-`): la guardia lo comprueba. Una excusa de
       * tres letras es la allowlist que no queriamos, con otro nombre.
       */
      readonly sinOperacion: string;
    };

/**
 * **EL CENSO DE OPERACIONES**, indexado por la MISMA union cerrada que la tabla de botones.
 *
 * El `satisfies Record<AccionNovedad, …>` es **R37 entero**: una accion nueva en la union sin su
 * productor **no compila**. Es el mismo mecanismo con el que la 236 hizo imposible añadir un grupo
 * sin decidir su juego de botones — y la razon por la que la decision no se puede omitir es la
 * misma: no hay ningun sitio donde «se me olvido» quede escrito como un hueco silencioso.
 *
 * Lo que la guardia hermana (`tests/unit/guards/novedad-acciones-sin-maqueta.guardia.test.ts`)
 * comprueba sobre cada entrada, y que el typecheck NO puede ver porque son cadenas:
 *
 *  1. **el modulo existe**, lleva `"use server"` y **exporta ese simbolo** (R38);
 *  2. **algun archivo de `app/(app)/novedades/` lo importa** de ese modulo (R38). Este es el frente
 *     que la maqueta no habria pasado: `rechazar` no habria podido citar ninguna accion;
 *  3. **el `sinOperacion` es legible y caduca** (R39).
 */
export const PRODUCTOR_POR_ACCION = {
  /**
   * La UNICA sin operacion de servidor, y por eso lleva escrito el porque. `ContactoButtons` abre
   * `tel:` y `wa.me` con la API del navegador: no hay peticion al servidor ni fila que escribir.
   */
  contacto: {
    sinOperacion:
      "abre el marcador del telefono y WhatsApp del navegador: no muta nada en el servidor",
  },
  reprogramar: {
    accionServidor: "reprogramarNovedad",
    modulo: "lib/actions/resolver-novedad",
  },
  /**
   * 💰 FEATURE 240 — LA ENTRADA QUE ESTA FICHA VIENE A ESCRIBIR. Mientras `rechazar` fue maqueta,
   * aqui no habria podido ir mas que un `sinOperacion`, y ninguna excusa habria sido verdad: la
   * operacion se necesitaba, simplemente no existia.
   */
  rechazar: {
    accionServidor: "rechazarNovedad",
    modulo: "lib/actions/resolver-novedad",
  },
  habilitar: {
    accionServidor: "habilitarNovedad",
    modulo: "lib/actions/habilitar-novedad",
  },
  intentoContacto: {
    accionServidor: "registrarIntentoContactoOrden",
    modulo: "lib/actions/orden-ayuda",
  },
  /**
   * La conversacion ABRE el hilo, y abrirlo es leerlo: `listarNotasOrden` es la lectura que el
   * modal dispara. Publicar y borrar son operaciones DE DENTRO de esa ventana, no de la fila.
   */
  conversacion: {
    accionServidor: "listarNotasOrden",
    modulo: "lib/actions/orden-notas",
  },
  /**
   * Las dos de la 237 comparten productor y no es un descuido: la misma Server Action recibe el
   * `resultado` como dato del formulario, asi que las dos acciones de la fila son dos puertas a la
   * misma operacion. El `modo` lo decide la ventana, no la accion de servidor.
   */
  reprogramarDesdeAyuda: {
    accionServidor: "gestionarDesdeAyuda",
    modulo: "lib/actions/gestion-desde-ayuda",
  },
  rechazarDesdeAyuda: {
    accionServidor: "gestionarDesdeAyuda",
    modulo: "lib/actions/gestion-desde-ayuda",
  },
} as const satisfies Record<AccionNovedad, ProductorAccion>;
