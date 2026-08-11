// Feature 179 (T1.2, design §4) — LA CLAVE DE CACHE DEL DOMINIO FINANCIERO.
//
// Modulo PURO: sin Next, sin Prisma, sin `process.env` y sin efectos al importarse.
//
// ─── Por que se COMPONE `claveDeConsulta` y no se copia (R5) ────────────────────────────────
// `claveDeConsulta` (128, `lib/analytics/cache-clave.ts`, que esta feature NO edita) ya incluye
// el `metricaId`, el rango RESUELTO (nunca el preset), el alcance con su id y el filtro ya
// recortado y normalizado — que es, campo a campo, lo que R5 pide. Ademas ya tiene sus tests y
// su guardia de exhaustividad de `AlcanceDatos`
// (`tests/unit/analytics/cache-clave-alcance.guardia.test.ts`).
//
// Una segunda definicion de la clave seria una segunda definicion de «que consultas son la
// misma», y esas divergen sin que nada falle: el dia que alguien anada una quinta variante de
// alcance, la copia de aqui la ignoraria en silencio y dos actores distintos compartirian
// entrada. Eso no da una cifra rara: **filtra dinero entre alcances**.
//
// ─── Por que el ALCANCE en la clave es SEGURIDAD y no rendimiento (R5) ──────────────────────
// Se hereda entero el criterio de R6 de la 128. Una clave que no distingue el alcance no falla:
// responde rapido y mal. Un `adminSatelite` de la zona Z recibiria la entrada que se cacheo
// para un `admin` global — el tablero financiero de todo el pais, servido por la puerta de la
// cache, sin excepcion y sin senal.
//
// ─── Por que hay PREFIJO DE DOMINIO, y por que no es cosmetico ──────────────────────────────
// Hoy los ids de metrica no se repiten entre `operativa` y `financiera`, asi que una colision
// seria imposible. Pero apoyarse en eso es apoyarse en una propiedad del CATALOGO (feature 135)
// para sostener la separacion entre una entrada que guarda `CuboRollup[]` y otra que guarda un
// `ResultadoFinanciero`. Si algun dia coincidieran, el fallo no seria una cifra rara: seria un
// DTO con la FORMA equivocada servido desde cache. El prefijo cuesta cuatro caracteres.

import { claveDeConsulta } from "@/lib/analytics/cache-clave";
import type { ConsultaAnalitica } from "@/lib/analytics/consulta";
import type { DimensionAnalitica } from "@/lib/analytics/types";

/**
 * Espacio de nombres del dominio financiero.
 *
 * Toda clave de `claveDeConsulta` empieza por `m=` (su primer componente es la metrica), asi que
 * ninguna clave operativa puede empezar por este prefijo: la separacion no depende de que los
 * ids de metrica de los dos dominios sigan siendo distintos.
 *
 * NO es el tag: el tag sale del catalogo (`TAG_FINANCIERA`) y sirve para invalidar. Esto es un
 * prefijo de CLAVE y vive en otro plano; escribir aqui el tag ataria dos cosas que se cambian
 * por motivos distintos.
 */
const PREFIJO_DOMINIO = "fin:";

/**
 * El dominio financiero no admite desagregacion pedida por el consumidor: el grano de cada
 * vista lo fija el catalogo y lo decide el servicio. La lista vacia se pasa EXPLICITAMENTE en
 * vez de dejar el parametro opcional: asi, el dia que la financiera gane granos, quien los
 * anada tiene que pasar por aqui.
 */
const SIN_GRANOS: readonly DimensionAnalitica[] = [];

/**
 * La clave de cache de una consulta financiera.
 *
 * R5 — incluye `metricaId`, rango resuelto, alcance resuelto (tipo + id) y filtro recortado
 * normalizado, todo por composicion; y va en su propio espacio de nombres.
 */
export function claveFinanciera(consulta: ConsultaAnalitica): string {
  return `${PREFIJO_DOMINIO}${claveDeConsulta(consulta, SIN_GRANOS)}`;
}
