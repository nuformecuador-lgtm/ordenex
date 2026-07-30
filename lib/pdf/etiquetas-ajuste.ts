// Ajuste vertical de los campos de la etiqueta de guia: aritmetica pura,
// compartida por los DOS generadores de PDF (el de cliente
// `app/(app)/ordenes/_components/etiquetas-pdf.ts` y el server-side del lote
// `lib/pdf/etiquetas-pdf-lote.ts`), que maquetan la misma etiqueta con libs de
// rasterizado distintas.
//
// El problema que resuelve: el bloque QR + codigo de barras se dibuja en una `y`
// FIJA (pegado al borde inferior), mientras el texto fluye hacia abajo desde la
// cabecera. Cuando el texto necesita mas alto del disponible, jspdf no recorta
// nada: sigue escribiendo y las ultimas lineas quedan DEBAJO del QR (ilegibles,
// y peor: tapan modulos del QR si la impresion es a un solo color). Aqui se
// decide, antes de dibujar, cuantas lineas puede gastar cada campo.
//
// Vive en `lib/` (y no junto a la maqueta de cliente) porque el generador del
// lote corre en Node y no puede importar de `app/`.

/** Marca de corte. ASCII a proposito: "…" cambia la codificacion del literal a UTF-16 en jspdf. */
export const MARCA_CORTE = "...";

/**
 * Reparte `maxTotal` lineas entre los campos, partiendo de las que cada uno
 * necesita (`naturales`) y recortando SIEMPRE al campo mas alto.
 *
 * Recortar al mas alto —y no en orden de aparicion— es lo que evita el peor
 * resultado: con un recorte secuencial, una direccion de cuatro lineas se
 * quedaria entera y los campos del final (producto, monto, tienda) desaparecerian.
 * Ningun campo baja de 1 linea: los nueve datos de la etiqueta siguen presentes.
 */
export function repartirLineas(naturales: number[], maxTotal: number): number[] {
  const asignadas = naturales.map((n) => Math.max(1, n));
  // Si no cabe ni una linea por campo, se devuelve el minimo: el llamador
  // dimensiona la banda de texto para que esto no ocurra, pero mas vale una
  // etiqueta apretada que un bucle infinito.
  if (maxTotal < asignadas.length) return asignadas.map(() => 1);

  let total = asignadas.reduce((a, b) => a + b, 0);
  while (total > maxTotal) {
    // `>=` a proposito: si varios campos empatan en alto, se recorta el ULTIMO.
    // El orden de la etiqueta va de mas a menos importante (destinatario primero,
    // tienda al final), asi que empatar a favor del primero es lo correcto.
    let masAlto = 0;
    for (let i = 1; i < asignadas.length; i++) {
      if (asignadas[i] >= asignadas[masAlto]) masAlto = i;
    }
    asignadas[masAlto] -= 1;
    total -= 1;
  }
  return asignadas;
}

/**
 * Recorta `lineas` a `permitidas` y marca el corte con `MARCA_CORTE` en la
 * ultima linea visible, comiendo caracteres hasta que la marca CABE en
 * `anchoMax` (medido con `medir`, normalmente `doc.getTextWidth`). Sin ese
 * bucle, pegar los puntos desbordaria el ancho de la columna y el texto se
 * saldria por la derecha justo en el caso que estamos arreglando.
 */
export function recortarConElipsis(
  lineas: string[],
  permitidas: number,
  anchoMax: number,
  medir: (texto: string) => number,
): string[] {
  const tope = Math.max(1, permitidas);
  if (lineas.length <= tope) return lineas;

  const cortadas = lineas.slice(0, tope);
  const ultima = cortadas.length - 1;
  let texto = cortadas[ultima].trimEnd();
  while (texto.length > 0 && medir(texto + MARCA_CORTE) > anchoMax) {
    texto = texto.slice(0, -1).trimEnd();
  }
  cortadas[ultima] = texto + MARCA_CORTE;
  return cortadas;
}

/**
 * Cuantas lineas de texto caben entre `yInicio` y `yLimite` (unidades del lienzo
 * base) sabiendo que hay `numCampos - 1` separaciones `fieldGap` entre campos.
 *
 * La geometria exacta: con `n` lineas repartidas en `numCampos` campos, la ultima
 * LINEA BASE cae en `yInicio + (n - 1) * lineHeight + (numCampos - 1) * fieldGap`
 * (la `y` de jspdf es la linea base, no el borde inferior). Se despeja `n` de que
 * eso no pase de `yLimite`; el descendente de esa ultima linea lo absorbe el aire
 * que el llamador deja entre `yLimite` y el borde del QR.
 */
export function lineasDisponibles(
  yInicio: number,
  yLimite: number,
  lineHeight: number,
  fieldGap: number,
  numCampos: number,
): number {
  const alto = yLimite - yInicio - (numCampos - 1) * fieldGap;
  return Math.max(numCampos, Math.floor(alto / lineHeight) + 1);
}
