import { COBERTURA } from "@/lib/pdf/etiquetas-fuente-cobertura";
import {
  caracterNoCubiertoEn,
  cubreCodePointEn,
  cubreTextoEn,
} from "@/lib/pdf/etiquetas-fuente-registro";

// FICHA 383 — ¿PUEDE LA ETIQUETA IMPRIMIR ESTE TEXTO, Y SI NO, TIENE ARREGLO?
//
// La puerta de ENTRADA de lo que un dia va a ir al papel. La 382 arreglo el mensaje que sale
// cuando el caracter ya esta almacenado —cuatro dias despues, con el lote en la mano—; esto lo
// caza al cargarlo, que es el unico momento en el que alguien tiene la orden delante.
//
// ── UNA SOLA DEFINICION DE «IMPRIMIBLE» (R1) ────────────────────────────────────────────────
// La cobertura es LA MISMA que usa el generador del PDF (`fuenteEtiqueta.cobertura` apunta a esta
// constante). No hay aqui ninguna lista de caracteres permitidos, ni una regexp con rangos a
// mano: el dia que la fuente cambie, las dos decisiones cambian juntas o ninguna. Ya hay
// precedente medido de lo contrario — la 382 empezo contando 38 ordenes afectadas con un filtro
// propio que contaba de mas (`—`, `’`, `™` y el NBSP SI estan en cp1252); el numero real era 1.
//
// ── LA REGLA, POR CODE POINT (R4/R5/R6) ─────────────────────────────────────────────────────
//   cubierto            -> se copia TAL CUAL, jamas se toca
//   no cubierto, y su NFKC si lo esta -> se sustituye por su NFKC
//   no cubierto, y su NFKC tampoco    -> se RECHAZA nombrando el caracter y su code point
//
// POR QUE NO `texto.normalize("NFKC")` A SECAS, que es lo que la ficha pedia literalmente:
// **saca de la fuente caracteres que hoy imprimen bien**. Medido sobre los 219 code points
// cubiertos (T0.1 de esta ficha, `progress/impl_383.md`): NFKC a ciegas deja fuera de cobertura
// NUEVE de ellos —`¨ ¯ ´ µ ¸ ¼ ½ ¾ ˜`—, porque `½` descompone a `1` + U+2044 FRACTION SLASH +
// `2` y U+2044 no esta en la fuente (los rangos saltan de 0x203A a 0x20A1), los espaciadores
// descomponen a «espacio + marca combinante» y `µ` (U+00B5) se convierte en la `μ` griega. Y
// reescribiria ademas otros ocho sin motivo (`™`->`TM`, `…`->`...`, `m²`->`m2`). Con la regla de
// arriba, la transformacion esta demostrablemente ACOTADA a lo que hoy no se puede imprimir.
//
// ── EL `NFC` PREVIO (Q2, decision del leader del 2026-09-07, NO firmada por el humano) ───────
// Un texto en forma DESCOMPUESTA —`"n"` + U+0303, lo que produce macOS al copiar— se lee «ñ» en
// pantalla y sin esto se rechazaria nombrando un U+0303 que quien lo lee no ve por ningun lado.
// `NFC` es CANONICO: no cambia la identidad de ningun caracter, solo la forma de escribirlo. Y
// medido (T0.1c): sobre los 219 code points cubiertos es la IDENTIDAD, los 219, asi que no puede
// tocar un texto que hoy imprime bien ni reabrir el problema del parrafo anterior.
//
// ── QUE NO ES ────────────────────────────────────────────────────────────────────────────────
// No sustituye a `exigirCobertura` (382/R1, 282/R28): esta es una puerta ANTES, no la de despues.
// Un dato ya almacenado —cargado antes de esta ficha, o escrito por una superficie que esta
// ficha no cubre (el nombre de la tienda y los de geografia, ficha 392)— sigue abortando el PDF.
//
// Modulo PURO: sin Prisma, sin HTTP, sin React y sin el programa de fuente al lado (R3 — los
// 22.592 caracteres del artefacto viven en `etiquetas-fuente.ts`, no en la cobertura).

/**
 * El veredicto sobre un texto.
 *
 * `intacto` y `reparado` se distinguen A PROPOSITO en vez de devolver siempre un valor: quien
 * repara TIENE que poder avisar de que lo hizo (R10), y una carga normal no puede ganar ni una
 * clave en su resumen (R21). Con un solo `valor` habria que comparar contra la entrada en cada
 * llamador, y esa comparacion se olvida en el segundo.
 */
export type ResultadoTexto =
  | { estado: "intacto"; valor: string }
  /**
   * `culpable` y `codePoint` son los del PRIMER caracter de la ENTRADA que la fuente no cubria,
   * o sea el que obligo a reparar. Viajan aqui —y no solo en `irreparable`— porque la correccion
   * de datos del cliente NO repara por su cuenta: rechaza NOMBRANDO el caracter y devolviendo el
   * texto bueno como sugerencia (R18). Sin esto, ese mensaje tendria que volver a recorrer el
   * texto con su propia idea de «no cubierto», y ahi es donde nace la segunda definicion.
   */
  | { estado: "reparado"; valor: string; original: string; culpable: string; codePoint: number }
  | { estado: "irreparable"; culpable: string; codePoint: number };

/** Opciones de `evaluarTextoDeEtiqueta`. */
export interface OpcionesTextoDeEtiqueta {
  /**
   * `false` = SOLO veredicto: el texto no se toca y cualquier caracter fuera de cobertura sale
   * como `irreparable` aunque tuviera arreglo.
   *
   * Es lo que necesita `num_remision` (R12/A3): es el identificador que Ordenex COMPARTE con la
   * tienda —el dedup y el round-trip del XLSX de errores se cruzan por el—, no prosa. Repararlo
   * dejaria a los dos sistemas con dos claves distintas para la misma orden, que es peor que
   * rechazar la fila. Por defecto `true`.
   */
  reparar?: boolean;
}

/**
 * R4/R5/R6 — Evalua un texto contra la cobertura de la fuente de la etiqueta.
 *
 * Recorre **por code point** (`for…of`), no por unidad UTF-16: el caso medido en produccion
 * (U+1D560) es un par suplente, y un `split("")` lo partiria en dos mitades sin significado que
 * nadie podria buscar en una tabla Unicode ni reconocer en su propio archivo.
 */
export function evaluarTextoDeEtiqueta(
  texto: string,
  opciones: OpcionesTextoDeEtiqueta = {},
): ResultadoTexto {
  const reparar = opciones.reparar ?? true;
  // Q2: la composicion canonica va ANTES del recorrido, y solo cuando se puede reparar. Con
  // `reparar: false` el texto sale tal cual entro o no sale.
  const base = reparar ? texto.normalize("NFC") : texto;

  let salida = "";
  for (const caracter of base) {
    const codePoint = caracter.codePointAt(0);
    // Inalcanzable con `for…of` (siempre hay al menos una unidad), pero el tipo es
    // `number | undefined` y fingir lo contrario con un `!` es como se cuelan los bugs mudos.
    if (codePoint === undefined) continue;

    // R4 — lo que la fuente YA cubre no se toca JAMAS. Es la guarda entera de la ficha: sin
    // ella, `½` entraria y saldria `1⁄2` y dejaria de imprimirse.
    if (cubreCodePointEn(COBERTURA, codePoint)) {
      salida += caracter;
      continue;
    }

    if (!reparar) return { estado: "irreparable", culpable: caracter, codePoint };

    // R5 — la normalizacion de COMPATIBILIDAD de ESE caracter, no de la cadena. `𝕠` -> `o`,
    // `ﬁ` -> `fi`. Puede producir varios code points, asi que se comprueba el candidato entero.
    const candidato = caracter.normalize("NFKC");
    if (cubreTextoEn(COBERTURA, candidato)) {
      salida += candidato;
      continue;
    }

    // R6 — ni se escribe ni se sustituye por un `?` ni se borra: se RECHAZA nombrandolo. Un
    // emoji, un caracter cirilico o una griega del bloque matematico (`𝛂` -> `α`, que tampoco
    // esta en la fuente) no los vuelve imprimibles ninguna normalizacion.
    return { estado: "irreparable", culpable: caracter, codePoint };
  }

  // R8/R21 — se compara con la ENTRADA, no con `base`: si el `NFC` previo cambio algo, eso es un
  // cambio y hay que decirlo. Un texto imprimible entero sale identico y sin aviso.
  if (salida === texto) return { estado: "intacto", valor: texto };

  // El caracter que obligo a reparar, buscado en la ENTRADA con el MISMO predicado. Se busca
  // aqui y no dentro del bucle porque el `NFC` previo puede haber compuesto la marca culpable
  // antes de que el bucle la viera (`"n"` + U+0303 -> `ñ`): en la entrada sigue estando.
  //
  // No puede ser `null` —un texto reparado tiene por construccion al menos un code point fuera
  // de cobertura en la entrada: o lo sustituyo el NFKC, o era la marca combinante que el NFC
  // compuso, y las marcas combinantes no estan cubiertas—. El `??` es defensivo y no un caso
  // esperado: sin el habria que mentirle al tipo con un `!`.
  const culpable = caracterNoCubiertoEn(COBERTURA, texto) ?? [...texto][0] ?? "";
  return {
    estado: "reparado",
    valor: salida,
    original: texto,
    culpable,
    codePoint: culpable.codePointAt(0) ?? 0,
  };
}
