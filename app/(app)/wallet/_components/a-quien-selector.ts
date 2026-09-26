// FICHA 458-E (TE.2, design §5.2, R54/R59) — el selector «A quién» del libro de la caja (`/wallet`).
// Módulo PURO: rótulos, textos y la traducción opción ↔ filtro. La lectura vive en
// `use-quienes-del-libro-caja.ts`.
//
// Una opción es una TIENDA, un MENSAJERO o un NOMBRE LIBRE anotado a mano (sueldo, gasto, corrección),
// leídos del servidor (`quienesDelLibroCajaAction`) con el MISMO cruce que resuelve el filtro: el
// selector no puede ofrecer algo que el libro no encuentre. El `valor` de la opción es el `aQuien` que
// se manda de vuelta, serializado; `SelectorBuscable` NUNCA pinta el `value` (H6), así que el id de la
// cuenta viaja y no se ve.

import type {
  SelectorBuscableOpcion,
  SelectorBuscableTextos,
} from "@/components/shared/SelectorBuscable";
import { aQuienFiltroSchema, type AQuienFiltro } from "@/lib/types/libro-caja-a-quien";
import type { QuienDelLibroCajaOpcionDTO } from "@/lib/types/wallet-filtros";

/** Qué es cada opción, en palabras (una tienda y un mensajero pueden llamarse igual). */
export const A_QUIEN_CLASE_LABEL: Record<QuienDelLibroCajaOpcionDTO["clase"], string> = {
  tienda: "Tienda",
  mensajero: "Mensajero",
  nombre: "Nombre anotado",
};

/** `4 movimientos` / `1 movimiento`: el cardinal en palabras (nunca dinero). */
function contarMovimientos(n: number): string {
  return n === 1 ? "1 movimiento" : `${n} movimientos`;
}

/** El `value` de la opción: el filtro serializado. Viaja, no se pinta. */
export function valorDeAQuien(aQuien: AQuienFiltro): string {
  return JSON.stringify(aQuien);
}

/**
 * El `value` elegido → el filtro que se manda al libro. Se valida con el MISMO schema del borde: un
 * valor que no sea un `aQuien` no se manda (sería un `validation_error` del servidor).
 */
export function aQuienDeValor(valor: string | null): AQuienFiltro | undefined {
  if (valor === null) return undefined;
  try {
    const r = aQuienFiltroSchema.safeParse(JSON.parse(valor));
    return r.success ? r.data : undefined;
  } catch {
    // Un `value` que no es JSON no lo produjo este módulo: sin filtro, no un filtro inventado.
    return undefined;
  }
}

/** Rótulo: `<nombre> · <Tienda|Mensajero|Nombre anotado> · <n> movimientos`. */
export function opcionesDeAQuien(
  opciones: readonly QuienDelLibroCajaOpcionDTO[],
): SelectorBuscableOpcion[] {
  return opciones.map((o) => ({
    value: valorDeAQuien(o.valor),
    label: `${o.nombre} · ${A_QUIEN_CLASE_LABEL[o.clase]} · ${contarMovimientos(o.movimientos)}`,
  }));
}

/**
 * El nombre del control y su rótulo visible: la MISMA palabra que la columna del libro, así el nombre
 * accesible del disparador («A quién: Todos») empieza por lo que se ve («Label in Name»).
 */
export const A_QUIEN_FILTRO = {
  etiqueta: "A quién",
  rotulo: "A quién",
} as const;

/** Los textos del selector «A quién». */
export const A_QUIEN_SELECTOR_TEXTOS: SelectorBuscableTextos = {
  todos: "Todos",
  buscar: "Buscar a quién",
  buscarMarcador: "Nombre de la tienda, del mensajero o de la persona",
  cargando: "Cargando…",
  error: "No pudimos cargar la lista. Probá de nuevo.",
  vacio: "Nadie con movimientos que coincida.",
  hayMas: "Hay más nombres de los que caben. Escribí parte del nombre para encontrarlo.",
};
