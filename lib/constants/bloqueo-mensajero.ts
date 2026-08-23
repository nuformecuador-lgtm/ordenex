/**
 * Feature 111/R12 + 167/R9 -> FEATURE 271 (2026-08-23) — el aviso accionable del bloqueo del
 * mensajero por cierres sin resolver. Texto separado del componente (i18n-ready).
 *
 * ⚠️ LA REGLA VIGENTE ES LA DE LA FICHA 271, DICTADA POR EL HUMANO EL 2026-08-23, y REVIERTE EN
 * PARTE la regla firmada el 2026-08-20 (feature 241). Con N = cierres sin aprobar
 * (`solicitado` + `vencido` + `rechazado`) y V = cuantos son re-solicitables (`vencido`/`rechazado`):
 *
 *      LIBRE si N <= 1 Y V = 0. En cualquier otro caso BLOQUEADO —para gestionar y cobrar
 *      Y TAMBIEN para recibir trabajo nuevo, sea REPARTO O RECOLECCION—.
 *
 *   · QUE SOBREVIVE de la 241: un cierre `solicitado` a secas NO bloquea. Ese mensajero ya hizo lo
 *     suyo y espera al admin (mediana 8,2 h, p90 22,1 h medidas contra produccion el 2026-08-18);
 *     castigarlo por una demora ajena era la mitad correcta de aquella regla.
 *   · QUE SE REVIERTE: la regla 2 de la 241, que declaraba la asignacion exenta de todo bloqueo.
 *     Desde la 271 acumular dos cierres
 *     —o arrastrar uno re-solicitable— bloquea TAMBIEN recibir trabajo nuevo, y sin distinguir
 *     reparto de recoleccion (Q1, palabras del humano: «un mensajero no puede hacer las dos
 *     gestiones, solo una a la vez»).
 *
 * ⚠️ POR ESO ESTE ARCHIVO YA NO ES UNA CONSTANTE. Prometia al mensajero que la asignacion le
 * seguia llegando,
 * que es FALSO desde la 271, y ademas el aviso tiene que CONTAR cosas (cuantos cierres arrastra y
 * cual toca resolver primero, R43). Un texto que cuenta no puede ser fijo, y mantener dos copias de
 * uno que cuenta es garantizar que divergiran: la copia sin CTA que vivia en `CierreDiaModule.tsx`
 * desaparece y pasa a ser el parametro `conCta` (R52).
 *
 * Consumidores: «Entregas» (`RepartoModule` / `RecogerModule`), «Recolección» (`RecoleccionModule`)
 * —los tres con `conCta: true`— y «Cierre del día» (`CierreDiaModule`, `conCta: false`, porque el
 * mensajero YA esta alli y remitirlo a la pantalla en la que esta seria ruido).
 *
 * NO IMPORTA PRISMA NI EL BORDE: es un modulo puro sobre `BloqueoDetalle` (`lib/utils/bloqueo-cierre.ts`).
 */

import type { BloqueoDetalle } from "@/lib/utils/bloqueo-cierre";
import { fechaLegible } from "@/lib/utils/dia-reparto-textos";

/**
 * La frase del medio, IDENTICA en los tres avisos y en los tres portales (R52). Es la lista de lo
 * que el servidor va a rechazar, y no promete NADA que el servidor acepte a medias: «trabajo nuevo»
 * cubre las dos clases —reparto y recoleccion— sin obligar al mensajero a saber como las llama el
 * sistema.
 *
 * ⚠️ AQUI VIVIAN DOS PROMESAS: que la asignacion seguia llegando, y antes que la recoleccion en
 * tienda seguia permitida. Las dos las RECHAZA el servidor desde la 271. Un aviso que
 * permite mas de lo que el servidor acepta manda al mensajero al mostrador de la tienda a que le
 * digan que no — es el fallo que la 241 documento al reves (alli prohibia de mas).
 */
const NO_PUEDES = "Mientras tanto no puedes entregar, cobrar ni recibir trabajo nuevo.";

/** El puntero de los portales que NO son «Cierre del día»: la unica diferencia admitida (R52). */
const IR_A_CIERRE = "Ve a «Cierre del día» para enviarlo a aprobación.";

/**
 * EL MISMO PUNTERO, SIN OBJETO, para los avisos en los que hay MAS DE UN CIERRE EN JUEGO.
 *
 * ⚠️ POR QUE EXISTE, y salio de mirar la app en el navegador el 2026-08-23 (aprobado por el humano
 * ese mismo dia): con dos cierres, «...para enviarLO a aprobación» colgaba del sintagma mas
 * cercano, que en ese aviso es **«el más antiguo»** —justo el que el mensajero NO puede enviar,
 * porque lo aprueba la bodega—. El pronombre nombraba el cierre equivocado.
 *
 * No se sustituye por otro objeto («envía el que falta») porque **la frase anterior ya dice QUE
 * enviar**: al puntero solo le queda decir DONDE. Repetirlo aqui volveria a poner dos referencias
 * seguidas a cierres distintos, que es de donde nacio la ambigüedad.
 */
const IR_A_CIERRE_SIN_OBJETO = "Ve a «Cierre del día».";

export interface OpcionesAvisoBloqueo {
  /**
   * `true` en los portales «Entregas» y «Recolección»: el mensajero esta en otra pantalla y hay que
   * decirle a donde ir. `false` en «Cierre del día»: el boton lo tiene debajo.
   */
  conCta: boolean;
}

/**
 * R15/R43/R46/R52 — el aviso de bloqueo, compuesto a partir del detalle. Devuelve `""` si el
 * mensajero NO esta bloqueado (no hay nada que avisar).
 *
 * Dice las TRES cosas que R43 exige: (a) que NO puede hacer, (b) CUANTOS cierres arrastra y
 * (c) CUAL toca resolver primero y QUIEN lo resuelve. Sin siglas, sin monto, sin datos de nadie
 * (R45/R46).
 *
 * ⚠️ LA FECHA ES LA DE LA JORNADA, NO LA DEL NACIMIENTO DEL CIERRE (R43 + R57-R60). Va SIEMPRE en
 * aposicion al final —«el más antiguo, el del 21 de agosto»— justamente para que, cuando
 * `jornadaCR` sea `null`, la oracion desaparezca entera y el resto del aviso se lea igual de bien.
 * Nunca en mitad de una frase que la necesite para tener sentido.
 */
export function avisoBloqueo(d: BloqueoDetalle, opciones: OpcionesAvisoBloqueo): string {
  if (!d.bloqueado) return "";

  const n = d.cierresAbiertos;
  const v = d.cierresPorReenviar;
  const aposicion = aposicionDeJornada(d);

  // CASO 3 — las dos cosas a la vez (N >= 2 y V >= 1). Va primero porque es el mas especifico.
  if (n >= 2 && v >= 1) {
    // El puntero de este caso NO lleva objeto: ver `IR_A_CIERRE_SIN_OBJETO`.
    const cta = opciones.conCta ? IR_A_CIERRE_SIN_OBJETO : null;

    // 3-a — TODOS los pendientes estan en SU tejado (V = N; V es subconjunto de N, asi que `v === n`
    // es el tope). Alcanzable con dos `rechazado`, o con `vencido` + `rechazado`.
    //
    // ⚠️ HASTA EL 2026-08-23 ESTE ESTADO CAIA EN EL TEXTO DE ABAJO Y DECIA DOS COSAS FALSAS
    // —encontradas mirando la app, no por un test—: «Envía **el que falta**» en singular con DOS
    // por enviar, y «espera a que **la bodega** apruebe el más antiguo» cuando el mas antiguo es
    // SUYO y la bodega no lo va a aprobar sola: le mandaba a esperar algo que no llega. El texto de
    // abajo solo es cierto MIENTRAS quede algun `solicitado`, y aqui no queda ninguno.
    //
    // La fecha sale de `aResolverPrimero` como en todos los demas y aqui no puede mentir: con
    // `V = N` el abierto mas viejo ES el re-solicitable mas viejo (lo garantiza el repositorio y
    // lo afirma `cierre-bloqueo-nv-sql-real.test.ts`), asi que «el más antiguo» es el mismo cierre
    // por los dos caminos.
    if (v === n) {
      const cuantos = `Tienes ${n} cierres sin resolver y ninguno se ha enviado a aprobación.`;
      const salida = `Envíalos a aprobación, empezando por el más antiguo${aposicion}.`;
      return unir(cuantos, NO_PUEDES, salida, cta);
    }

    // 3-b — MIXTO: quedan `solicitado` (los resuelve la bodega) y algo suyo por enviar.
    //
    // ⚠️ DEUDA DECLARADA, NO OLVIDO (2026-08-23): «espera a que la bodega apruebe el más antiguo»
    // solo es cierto si el abierto MAS VIEJO no es re-solicitable, y ese estado —el mas viejo
    // `rechazado` con un `solicitado` mas nuevo, `N=2, V=1`— SI ES ALCANZABLE: `rechazarCierre`
    // recibe un `cierreId` cualquiera y no exige que sea el mas viejo, asi que un admin que
    // rechace el primero de dos `solicitado` lo produce. Ahi la frase manda a esperar por un
    // cierre que ya es suyo. Se detecta sin dato nuevo —`d.aResolverPrimero.resuelve ===
    // "mensajero"` con `v < n`—, pero el texto de ese caso NO ESTA APROBADO y aqui no se inventa
    // ninguno: queda consultado con el humano. Lo unico que se corrigio es el plural.
    const cuantos = `Tienes ${n} cierres sin resolver y ${v} de ${v === 1 ? "ellos no se ha" : "ellos no se han"} enviado a aprobación.`;
    const envia = v === 1 ? "Envía el que falta" : "Envía los que faltan";
    const salida = `${envia} y espera a que la bodega apruebe el más antiguo${aposicion}.`;
    return unir(cuantos, NO_PUEDES, salida, cta);
  }

  // CASO 2 — algo que reenviar y nada mas (V >= 1, N = 1).
  if (v >= 1) {
    const cta = opciones.conCta ? IR_A_CIERRE : "Envíalo a aprobación con el botón de abajo.";
    return unir("Tienes un cierre sin enviar a aprobación.", NO_PUEDES, cta);
  }

  // CASO 1 — bloqueado por ACUMULAR (N >= 2, V = 0). El mensajero no tiene NADA que hacer, y por
  // eso este es el unico de los tres que no lleva llamado a la accion en ninguno de los portales:
  // inventarle uno seria mandarlo a buscar un boton que no existe (R43).
  return unir(
    `Tienes ${n} cierres esperando aprobación.`,
    NO_PUEDES,
    `Se desbloquea cuando la bodega apruebe el más antiguo${aposicion}.`,
  );
}

/**
 * `, el del 21 de agosto` — o cadena VACIA si no hay jornada fiable (R60). Nunca se inventa una
 * fecha: se omite, y la frase sigue siendo correcta y accionable sin ella.
 */
function aposicionDeJornada(d: BloqueoDetalle): string {
  const jornada = d.aResolverPrimero?.jornadaCR ?? null;
  if (jornada === null) return "";
  const legible = fechaLegible(jornada);
  // `fechaLegible` devuelve la entrada tal cual si no la reconoce: en ese caso tampoco se nombra.
  return legible === jornada ? "" : `, el del ${legible}`;
}

function unir(...partes: (string | null)[]): string {
  return partes.filter((p): p is string => p !== null && p !== "").join(" ");
}
