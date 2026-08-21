// EL CENSO DE LAS SUPERFICIES DE ENVÍO PÚBLICAS.
//
// Feature 253 (T8.2, design §9.1) — cada formulario que una persona SIN SESIÓN puede enviar en este
// producto declara aquí **o** la Server Action que produce **o** un motivo escrito de por qué no
// produce ninguna. La guardia `tests/unit/guards/landing-sin-maqueta.guardia.test.ts` lo lee en las
// dos direcciones y contra el árbol de archivos.
//
// ── POR QUÉ ESTE ARCHIVO EXISTE
//
// Hasta la feature 253, `app/_landing/PostularRecursoModal.tsx` validaba, pintaba «Postulación
// enviada» y **no enviaba nada**: dos líneas de `handleSubmit` (`setErrores({})` y
// `setEnviado(true)`) con un `// TODO`. En producción, en la landing pública, a personas que no
// tienen ninguna otra forma de saber que su postulación nunca salió del navegador. La suite entera
// estaba verde, y el verde era correcto: no existía ni un test de ese componente, y la guardia
// anti-maqueta de la 240 tiene su ámbito clavado en una constante —`const PANTALLA =
// "app/(app)/novedades"`—, así que la landing quedaba fuera.
//
// ── POR QUÉ VIVE EN `tests/` Y NO JUNTO A LA PANTALLA, al revés que el catálogo de la 240
//
// Allí el catálogo vive en `app/` porque **producción lo consume**: `ACCIONES_POR_GRUPO` decide qué
// botones se pintan. Aquí nadie lo consumiría: sería un módulo en `app/` que sólo lee un test, es
// decir, exactamente la clase de módulo que `superficie-de-uso.guardia.test.ts` vigila —y habría
// que anotarlo con una excepción, para un archivo que existe sólo por otra guardia—.
//
// Lo que se pierde: sin consumo en producción no hay `satisfies` que rompa el typecheck cuando
// aparezca una superficie nueva. **Lo compensa el frente 5** de la guardia, que censa el ÁRBOL DE
// ARCHIVOS: un componente con formulario de envío bajo una raíz pública al que ninguna entrada
// apunte pone la guardia roja. Para este caso es más fuerte, porque la landing no tiene una unión
// cerrada de botones que alguien tenga que tocar.
//
// ⚠️ **ESTE ARCHIVO SE ESCRIBE EN UN ARCHIVO, NUNCA POR `node -e`.** Ahí `\b` llega como backspace
// y el censo miente en verde. Lección literal de `specs/238/tasks.md` T1.2.

/**
 * D10 FIRMADA — la guardia cubre **toda** la superficie pública, no la mitad. `app/postulacion` es
 * la otra pantalla que alguien sin sesión puede enviar (la feature 21), y dejarla fuera habría sido
 * arreglar un caso y conservar el agujero de proceso.
 */
export const RAICES_PUBLICAS = ["app/_landing", "app/postulacion"] as const;

export type SuperficiePublica =
  | "rastreo"
  | "postularVehiculo"
  | "postularBodega"
  | "postulacionMensajero";

export type ProductorSuperficie =
  | { readonly accionServidor: string; readonly modulo: string }
  /** Motivo >= 20 caracteres y sin relleno. Una excusa sin razón escrita es una allowlist. */
  | { readonly sinOperacion: string };

/**
 * Qué archivo pinta cada superficie. Sirve al frente 5 en sus dos direcciones: un formulario de
 * envío que nadie declara, y una entrada que apunta a un archivo que ya no existe.
 */
export const ARCHIVO_POR_SUPERFICIE: Record<SuperficiePublica, string> = {
  rastreo: "app/_landing/RastreoDialog.tsx",
  postularVehiculo: "app/_landing/PostularRecursoModal.tsx",
  postularBodega: "app/_landing/PostularRecursoModal.tsx",
  postulacionMensajero: "app/postulacion/_components/PostulacionForm.tsx",
};

/**
 * Qué OPERACIÓN produce cada superficie.
 *
 * `postularVehiculo` y `postularBodega` comparten productor **y** archivo, y no es un descuido: son
 * dos puertas a la misma operación, con el `tipo` como dato del formulario (lo fija la tarjeta de
 * la landing, P5). Precedente literal: `reprogramarDesdeAyuda` / `rechazarDesdeAyuda` comparten
 * `gestionarDesdeAyuda` en el catálogo de la 240.
 */
export const PRODUCTOR_POR_SUPERFICIE = {
  rastreo: {
    accionServidor: "consultarRastreoPublico",
    modulo: "lib/actions/rastreo-publico",
  },
  postularVehiculo: {
    accionServidor: "postularRecurso",
    modulo: "lib/actions/postulacion-recurso",
  },
  postularBodega: {
    accionServidor: "postularRecurso",
    modulo: "lib/actions/postulacion-recurso",
  },
  postulacionMensajero: {
    accionServidor: "postularMensajero",
    modulo: "lib/actions/postulacion-mensajero",
  },
} as const satisfies Record<SuperficiePublica, ProductorSuperficie>;

/**
 * Server Actions que un archivo de una raíz pública importa y que **no son un envío de formulario**,
 * con su razón. Es la lista hermana de `NO_SON_ACCIONES_DE_FILA` en la guardia de la 240, y va
 * junto al censo por el mismo motivo: una lista que vive lejos de su detector nadie la poda.
 *
 *  · **`obtenerConteosPublicos`** es una LECTURA que alimenta las cifras del héroe de la landing
 *    (`app/_landing/cifras-publicas.tsx`). No hay formulario, no hay envío y no hay nada que
 *    prometer: no le corresponde una entrada en el censo de superficies de envío.
 */
export const NO_SON_SUPERFICIES_DE_ENVIO = new Set(["obtenerConteosPublicos"]);
