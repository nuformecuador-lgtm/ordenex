// Feature 365 — LA PIEZA QUE IMPIDE QUE LA RED DE ERRORES SEA UNA MORDAZA.
//
// ## El problema que resuelve, medido en el propio Next 16.2.10
//
// Hasta esta ficha la app no tenia NI UN `error.tsx`. Eso es malo para quien mira la pantalla
// (se queda en blanco) pero, sin querer, era bueno para el diagnostico: sin limite explicito,
// React entrega el fallo a la frontera INTERNA de Next, y esta lo trata como NO capturado.
// El camino esta escrito en `node_modules/next/dist/client/react-client-callbacks/
// error-boundary-callbacks.js`:
//
//   onCaughtError(...)  ->  si el limite es el interno (`isImplicitErrorBoundary`)
//                           -> onUncaughtError(...) -> reportGlobalError(err)
//   reportGlobalError   =   `reportError` del navegador, o `console.error` si no existe
//                           (`react-client-callbacks/report-global-error.js`)
//
// `reportError` no es un `console.error` con otro nombre: emite un evento `error` en `window`,
// o sea el MISMO canal por el que se entera cualquier monitor de errores del navegador. Es la
// senal fuerte.
//
// En cuanto se anade un `error.tsx` PROPIO, ese mismo archivo se va por la otra rama: el limite
// deja de ser implicito y en produccion queda
//
//   } else { devToolErrorMod.originConsoleError(thrownValue); }   // console.error a secas
//
// O sea: poner la red DEGRADA la senal del lado cliente de «evento global» a «linea de consola».
// Nadie lo nota, porque la pantalla mejora. Esa es exactamente la forma de fallo que esta ficha
// venia a evitar: convertir un fallo ruidoso en uno mudo.
//
// Esta funcion devuelve la senal a su sitio: la frontera vuelve a emitir por `reportError`, tal
// como haria la app SIN la red. La red pasa a sumar (pantalla usable) sin restar (diagnostico).
//
// ## Lo que esta funcion NO es
//
// NO es el canal del error del SERVIDOR, y conviene no confundirlos. Un fallo de render de un
// Server Component ya se registra en el servidor ANTES de que ninguna frontera lo vea
// (`server/app-render/create-error-handler.js` -> `onReactServerRenderError` ->
// `instrumentation.onRequestError` + el log del proceso), y `error.tsx` no puede silenciarlo:
// ni se ejecuta en ese camino. Verificado a mano contra `next dev` en la ficha 365; ver
// `progress/impl_365.md`. Lo que llega al cliente en ese caso es una copia REDACTADA (mensaje
// generico + `digest`), asi que re-emitirla no filtra nada y sirve de correlacion con la linea
// del servidor.
//
// ## Por que no se exporta desde `lib/errors/index.ts`
//
// Ese barril lo importa codigo de servidor (Server Actions, Route Handlers). Esta funcion es de
// navegador y su unico consumidor es la capa de presentacion; colgarla del barril invitaria a
// llamarla desde el servidor, donde `reportError` no existe y el registro correcto es otro.

/**
 * Errores ya re-emitidos, por IDENTIDAD del objeto.
 *
 * El de-duplicado es por identidad y NO por mensaje a proposito: React entrega SIEMPRE el mismo
 * objeto mientras la frontera siga montada (`getDerivedStateFromError` lo guarda en el estado),
 * asi que «mismo objeto» es «misma ocurrencia» y «otra ocurrencia» trae objeto nuevo aunque el
 * mensaje coincida. Sin esto, un re-render de la pantalla de error —o el doble efecto de React
 * en modo estricto— multiplicaria la misma linea en el registro.
 *
 * `WeakSet` para no retener el error (ni su stack, ni lo que el stack capture) mas alla de su vida.
 */
const YA_REEMITIDOS = new WeakSet<object>();

/** Firma minima de `globalThis.reportError`, que TypeScript no declara en el lib de Node. */
type ConReportError = { reportError?: (error: unknown) => void };

/**
 * Vuelve a emitir un error capturado por una frontera de React para que NO se pierda del
 * registro. Prefiere `reportError` (evento `error` de `window`: lo ve un monitor del navegador,
 * y es lo mismo que hace Next para los errores sin capturar) y cae a `console.error` donde no
 * exista —Node, y jsdom antiguo—, que sigue dejando rastro.
 *
 * Devuelve `true` si emitio y `false` si el error ya se habia emitido antes.
 */
export function reemitirEnCliente(error: unknown): boolean {
  if (typeof error === "object" && error !== null) {
    if (YA_REEMITIDOS.has(error)) return false;
    YA_REEMITIDOS.add(error);
  }

  const reportar = (globalThis as ConReportError).reportError;
  if (typeof reportar === "function") {
    reportar(error);
    return true;
  }

  console.error(error);
  return true;
}
