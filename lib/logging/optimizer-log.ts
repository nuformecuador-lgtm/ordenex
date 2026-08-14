// Feature 92 — TRAZA DE DIAGNOSTICO del optimizador de rutas, con el prefijo `optimizer***:`
// en TODAS las lineas para poder aislarla con un solo filtro (`vercel logs | grep optimizer`).
//
// ⚠️ ESTE MODULO ES UN OVERRIDE CONSCIENTE DE R14, PEDIDO POR EL HUMANO PARA DIAGNOSTICAR ⚠️
//
// El resto de la feature tiene una invariante dura: NADA de PII ni de credencial sale por un
// log. Esta traza la rompe a proposito en un punto concreto —imprime las COORDENADAS de
// origen y de las paradas, que identifican domicilios de destinatarios— porque sin las
// entradas reales no se puede distinguir "el proveedor devolvio un orden raro" de "le
// enviamos un modelo raro". Consecuencias que hay que tener presentes:
//
//   · En Vercel estas lineas quedan en el log del despliegue, accesible a quien tenga acceso
//     al proyecto. Es exportacion de dato personal a un tercero (Vercel) fuera de la base.
//   · APAGARLA cuando el diagnostico termine: `RUTA_DEBUG_LOG=0` en el entorno.
//
// LO QUE NO SE IMPRIME, NI CON LA TRAZA ENCENDIDA: el `access_token`, el token OIDC de
// Vercel, la clave privada PEM y el JSON de la assertion. De un token solo se dice SI llego
// y CUANTOS caracteres mide — que es todo lo que sirve para depurar. Un token en un log es
// una credencial reutilizable por quien lo lea; una coordenada, al menos, no abre sesion.

/** Prefijo comun. Cualquier linea de esta feature empieza asi, sin excepcion. */
const PREFIJO = "optimizer***:";

/**
 * La traza esta ENCENDIDA por defecto y se apaga con `RUTA_DEBUG_LOG=0`. Al reves de lo
 * habitual, porque se anadio para diagnosticar un problema abierto: el default util es el
 * que responde a la pregunta que se esta investigando.
 *
 * ⚠️ NO MIRES AQUI SI ESTAS EN UN TEST. Hubo una version de esta funcion que devolvia
 * `false` cuando detectaba `VITEST`, y la tumbo una GUARDIA del repo
 * (`notificacion-notificadores-reales.test.ts`) que prohibe a `lib/` y `app/` cambiar de
 * comportamiento segun el entorno de test — con razon: un modulo que se comporta distinto
 * bajo test hace que los tests dejen de hablar del codigo real. El silencio en la suite se
 * consigue poniendo `RUTA_DEBUG_LOG=0` desde `tests/setup/jest-dom.ts`, que es codigo de
 * test y puede saber que es un test.
 */
function activo(): boolean {
  return process.env.RUTA_DEBUG_LOG !== "0";
}

/**
 * Una linea de traza. `datos` es opcional y se imprime como objeto (no se serializa a
 * string): la consola de Node y la de Vercel lo expanden mejor que un JSON aplastado.
 */
export function optlog(paso: string, datos?: Record<string, unknown>): void {
  if (!activo()) return;
  if (datos === undefined) {
    console.log(`${PREFIJO} ${paso}`);
    return;
  }
  console.log(`${PREFIJO} ${paso}`, datos);
}

/**
 * Una linea de traza para un FALLO. Va por `console.error` para que el nivel del log de
 * Vercel lo distinga, pero conserva el mismo prefijo para que el filtro siga siendo uno.
 *
 * Del error se imprime el NOMBRE y el MENSAJE, no el objeto entero: los mensajes de esta
 * feature ya vienen saneados de sus clases de error, pero un error de una libreria
 * (`google-auth-library`, `fetch`) puede traer la peticion completa colgada de una
 * propiedad, y ahi es donde aparecen las cabeceras con el Bearer.
 */
export function opterror(paso: string, error: unknown, datos?: Record<string, unknown>): void {
  if (!activo()) return;
  const detalle =
    error instanceof Error
      ? { error: error.name, mensaje: error.message }
      : { error: String(error) };
  console.error(`${PREFIJO} ${paso}`, { ...detalle, ...datos });
}

/**
 * Describe un token SIN revelarlo. Es lo unico que esta traza dice de una credencial.
 * `longitud` sirve para distinguir "no llego token" de "llego uno vacio" de "llego uno
 * plausible" (un access_token de Google ronda los 200-1000 caracteres).
 */
export function describirToken(token: string | null | undefined): Record<string, unknown> {
  if (token === null || token === undefined) return { token: "AUSENTE" };
  return { token: "PRESENTE", longitud: token.length };
}

/** Cronometro para medir cada llamada externa. Devuelve los ms transcurridos. */
export function cronometro(): () => number {
  const inicio = Date.now();
  return () => Date.now() - inicio;
}
