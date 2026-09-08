import {
  mensajeCorreccionCaracterNoImprimible,
  mensajeCorreccionSugerencia,
} from "@/lib/utils/mensaje-caracter-no-imprimible";
import { evaluarTextoDeEtiqueta } from "@/lib/utils/texto-imprimible-etiqueta";

// ⭑ FICHA 392 — LOS NOMBRES DE CATALOGO QUE TERMINAN EN EL PAPEL.
//
// ── EL AGUJERO QUE CIERRA ───────────────────────────────────────────────────────────────────
// La etiqueta no imprime solo datos de la orden: imprime tambien el NOMBRE DE LA TIENDA
// (`etiqueta.tiendaNombre`, de `usuario.nombre`) y los cuatro nombres de la GEOGRAFIA —zona,
// provincia, canton y distrito—, que `geografiaLegible` une en el dato `ubicacion`
// (`lib/pdf/etiquetas-dibujo.ts`, `datosDeEtiqueta`). La ficha 383 puso la puerta sobre los
// campos de la ORDEN y dejo estos fuera A PROPOSITO (su Q3, su asuncion A6), asi que hasta hoy
// un maestro que registrara una tienda «𝕋ienda» —o que renombrara un distrito con un caracter
// no imprimible desde /configuracion/geografia, que la ficha 375 hizo posible— volvia a tumbar
// el LOTE ENTERO de etiquetas. Y peor que antes: el aviso de la 382 apuntaria a una orden cuyos
// datos estan TODOS bien.
//
// ── UNA SOLA DEFINICION DE «IMPRIMIBLE» ─────────────────────────────────────────────────────
// Este modulo NO decide nada por su cuenta: delega ENTERO en `evaluarTextoDeEtiqueta`, que a su
// vez lee `COBERTURA` —la MISMA constante que el generador del PDF, por identidad referencial
// (`etiqueta-fuente-diferida.guardia.test.ts`, 383/R1)—. Una segunda lista de caracteres aqui se
// desalinearia el dia que la fuente cambie, y el fallo volveria sin que nadie lo notase.
//
// Tampoco redacta un mensaje nuevo: reusa los de la 383. La frase de diagnostico —el caracter
// entre aislantes bidi y su `U+XXXX`— es la misma que ya se lee en el modal de la 382 y en la
// correccion de datos del cliente, y sus dos detalles no son decorativos (ver
// `mensaje-caracter-no-imprimible.ts`).
//
// ── LA DECISION: RECHAZA, NO REPARA (decision del backend_dev, 2026-09-08, SIN FIRMAR) ──────
// La 383 dejo abierta su asuncion A2 —si la superficie MANUAL debe reparar o rechazar, al reves
// que la carga masiva—, y esta ficha se topa con la misma pregunta. No se contesta aqui: se
// elige lo que YA HACE el formulario equivalente mas cercano.
//
// Y el mas cercano es la correccion de datos del cliente (`CorregirDatosClienteService`, 383/R18):
// una persona, delante de UN registro, tecleando el nombre en un campo, con la pantalla puesta.
// Alli se RECHAZA devolviendo el texto bueno como sugerencia, y el motivo escrito es que en la
// carga masiva no hay nadie delante de 500 filas mientras que aqui SI lo hay. Un maestro dando de
// alta una tienda o renombrando un distrito esta exactamente en ese caso, y ademas estos nombres
// no son un dato de un tercero que haya que respetar: son catalogo propio, que quien lo escribe
// puede corregir en el acto. Asi Ordenex nunca guarda un nombre que nadie tecleo.
//
// ⚠️ QUEDA COMO PREGUNTA ABIERTA, no como cosa juzgada: si el humano firma A2 al reves —que la
// superficie manual REPARE y avise—, la vuelta atras es cambiar este modulo para devolver el
// valor reparado en vez de un `fieldErrors`, y con el cambian los cinco llamadores a la vez.
// Justamente por eso el rechazo se construye AQUI y no en cada servicio.
//
// Modulo PURO: sin Prisma, sin HTTP, sin React y sin el programa de fuente al lado (383/R3 — los
// 22.592 caracteres del artefacto viven en `etiquetas-fuente.ts`, no en la cobertura).

/**
 * La clave del campo, que es la MISMA en las tres superficies (`usuario.nombre`, `zona.nombre` y
 * el `nombre` de los tres niveles geograficos) y por eso se escribe una vez.
 *
 * Se usa a la vez como clave de `fieldErrors` —lo que hace que la pantalla lo pinte junto al
 * input— y como el campo que el mensaje NOMBRA. Que sean el mismo valor no es cosmetico: si el
 * mensaje dijera «destinatario» y el error colgara de `nombre`, quien lo lee buscaria un campo
 * que no existe en ese formulario.
 */
export const CAMPO_NOMBRE = "nombre";

/**
 * FICHA 392 — ¿Puede la etiqueta imprimir este nombre?
 *
 * Devuelve `null` cuando si (el caso normal: NADA cambia, ni un `fieldErrors` de mas, ni una
 * clave nueva en ninguna respuesta), y el `fieldErrors` listo para el borde cuando no.
 *
 * Devuelve el `fieldErrors` ENTERO, y no solo el mensaje, para que la clave y el campo que el
 * mensaje nombra no puedan divergir en ninguno de los cinco llamadores.
 *
 * Los dos desenlaces del rechazo, heredados de la 383:
 *
 *  · **irreparable** (un emoji, una letra cirilica, una griega del bloque matematico): ninguna
 *    normalizacion lo vuelve imprimible, asi que el mensaje lo NOMBRA con su code point y no
 *    manda reintentar — el caracter va a seguir fuera de la fuente el segundo intento.
 *  · **reparable** (`𝕋` -> `T`, `ﬁ` -> `fi`): el texto bueno viaja como SUGERENCIA dentro del
 *    mensaje. No se guarda: lo teclea quien esta mirando. Y cuando la sugerencia se PINTA igual
 *    que lo tecleado —una `ñ` descompuesta— el mensaje no la repite y dice que hay que volver a
 *    teclear la letra, que es lo unico que funciona (383, revision menor 1).
 */
export function rechazoDeNombreDeEtiqueta(nombre: string): Record<string, string[]> | null {
  const veredicto = evaluarTextoDeEtiqueta(nombre);
  if (veredicto.estado === "intacto") return null;

  const mensaje =
    veredicto.estado === "irreparable"
      ? mensajeCorreccionCaracterNoImprimible(
          CAMPO_NOMBRE,
          veredicto.culpable,
          veredicto.codePoint,
        )
      : mensajeCorreccionSugerencia(
          CAMPO_NOMBRE,
          veredicto.culpable,
          veredicto.codePoint,
          veredicto.valor,
          // El texto TAL COMO se tecleo: el mensaje lo necesita para saber si su sugerencia se
          // distingue de el. Obligatorio a proposito en la 383, y por el mismo motivo aqui.
          veredicto.original,
        );

  return { [CAMPO_NOMBRE]: [mensaje] };
}
