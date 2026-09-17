// FICHA 441 — LA JERARQUIA DE UN KPI, DECLARADA EN UN SOLO SITIO.
//
// ─── POR QUE EXISTE ────────────────────────────────────────────────────────────────────
//
// Medido en `/analitica` a 1440 px el 2026-09-17 (artboard `Medido.dc.html`): cinco tarjetas
// con el MISMO peso visual, de modo que «17,4 % de efectividad» se lee igual que «En proceso
// 37». En el codigo la causa estaba dicha: `KpiCard` no tenia ninguna propiedad de enfasis
// —solo `etiqueta`, `valor`, `unidad`, `variacion` y `className`—, asi que la unica manera de
// destacar una tarjeta era colarle clases por `className` desde el llamador.
//
// Eso es lo que este modulo cierra: el enfasis pasa a ser una DECISION DECLARADA del contrato
// (`KpiCardProps.jerarquia`) y no estilo suelto en la pantalla que lo pide. Tres consecuencias
// que se pueden comprobar:
//
//   1. la tarjeta heroe y las de apoyo salen del MISMO catalogo, asi que «bajar de rango» es
//      literalmente elegir otro valor de la union, no escribir clases mas pequenas a mano;
//   2. el heroe de `/analitica` no es un `KpiCard` —lleva dentro la barra de madurez y dos
//      cifras— pero VISTE las mismas clases, porque las importa de aqui. Sin esto serian dos
//      escalas tipograficas que divergen la primera vez que alguien toque una;
//   3. un test puede afirmar el enfasis sin leer un `className` incrustado en el JSX: si el
//      heroe deja de pedir `"heroe"`, su clase desaparece del DOM y el caso se pone rojo.
//
// ─── QUE NO HACE ───────────────────────────────────────────────────────────────────────
//
// **No decide el ancho ni la posicion.** Que el heroe ocupe dos columnas lo pone la REJILLA de
// `page.tsx`, que es el unico nivel que sabe cuantas tarjetas hay en la fila — la misma regla
// que ya obligaba a `KpisEfectividad` a devolver un fragmento y no una rejilla propia.
//
// **No inventa color.** `brand` es el token de marca de `app/globals.css`, el mismo que usan el
// resto de superficies destacadas del producto.

/**
 * El rango de una tarjeta DENTRO de su fila. Union cerrada y no un numero: las clases de
 * Tailwind se compilan estaticamente, asi que una interpolada no existiria en el CSS final.
 *
 * - `normal`: como se pintan los KPI desde la 130. Es el DEFAULT y ninguna pantalla ya montada
 *   cambia de aspecto porque esta prop exista.
 * - `heroe`: EL numero de la pantalla. Cifra a 68 px y borde de marca (diseno aprobado
 *   2026-09-17).
 * - `apoyo`: subordinada A PROPOSITO. Baja la cifra y el rotulo un escalon para que la de al
 *   lado se lea primero; sigue siendo legible, no es letra pequena.
 */
export type JerarquiaKpi = "heroe" | "normal" | "apoyo";

/** El default: lo de siempre. Se exporta para que nadie lo reescriba en cada consumidor. */
export const JERARQUIA_POR_DEFECTO: JerarquiaKpi = "normal";

/**
 * La caja. `heroe` cambia el anillo de `Card` (`ring-1 ring-foreground/10`) por uno de marca de
 * 2 px: es lo que el diseno pide y lo que `tailwind-merge` resuelve solo al componerse por `cn`.
 */
export const CLASES_TARJETA: Record<JerarquiaKpi, string> = {
  heroe: "ring-2 ring-brand",
  normal: "",
  apoyo: "",
};

/** El rotulo. En `apoyo` baja un escalon: es la linea que el ojo NO tiene que leer primero. */
export const CLASES_ROTULO: Record<JerarquiaKpi, string> = {
  heroe: "text-xs font-semibold uppercase tracking-wider text-brand-dark",
  normal: "text-sm text-muted-foreground",
  apoyo: "text-xs text-muted-foreground",
};

/**
 * La cifra. Los tres tamanos son los del diseno aprobado: 68 px el heroe, 22 px el apoyo, y
 * `text-2xl` (24 px) el normal, que es EXACTAMENTE lo que `KpiCard` pintaba antes de esta ficha
 * — por eso ninguna otra pantalla se mueve.
 *
 * EL HEROE BAJA A 52 PX EN PANTALLA ESTRECHA, que es lo que pide el artboard de telefono
 * (`design-analitica/Telefono.dc.html`, 390x844). Medido a 390 px: a 68 px la cifra cabe
 * —la tarjeta ocupa el ancho entero y quedan 262 px utiles—, pero se come el alto del primer
 * golpe de vista, donde ademas tienen que caber la barra de madurez y la segunda cifra.
 */
export const CLASES_CIFRA: Record<JerarquiaKpi, string> = {
  heroe: "text-[52px] font-bold leading-none tracking-tight sm:text-[68px]",
  normal: "text-2xl font-semibold",
  apoyo: "text-[22px] font-semibold",
};
