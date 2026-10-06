// Ficha 474 (design §6.2, R32) — saneado de UN valor de variable antes de mandarlo a Meta.
//
// Meta rechaza los parametros de una plantilla con saltos de linea, tabuladores o mas de cuatro
// espacios seguidos (error 132018). Aqui se colapsa todo a un solo espacio y se recorta: un valor
// que queda vacio es un valor FALTANTE, y el motor lo trata como error nombrando la variable.
// Se aplica a todo valor de informe, al `texto` del aviso y a `destinatario_nombre`.

/** `\r\n|\r|\n|\t` → espacio; cualquier racha de espacios → uno; `trim`. */
export function sanearValor(valor: string): string {
  return valor
    .replace(/\r\n|\r|\n|\t/g, " ")
    .replace(/ {2,}/g, " ")
    .trim();
}

/** `true` si el valor, una vez saneado, no queda vacio. */
export function valorPresente(valor: string | undefined | null): valor is string {
  return typeof valor === "string" && sanearValor(valor) !== "";
}
