import type { FilterDef } from "@/components/shared/FilterComponent";
import type { CatalogoFiltrosOrdenesDTO } from "@/lib/types/filtros-ordenes";
import { BUSQUEDA_MIN_CHARS } from "@/lib/types/orden";
import { ultimosNDiasCalendarioCR } from "@/lib/utils/fecha-cr";

import { ATAJOS_CREACION } from "@/app/(app)/ordenes/_components/ordenes-filtros-def";

// Feature 318 / T5.1 (design §5.3, R32/R33/R35/R37) — declaracion de los CUATRO filtros
// de la barra del historico de conversaciones.
//
// Funcion PURA: catalogo -> declaraciones. El componente generico
// (`components/shared/FilterComponent.tsx`) no sabe que es un mensajero ni que es un
// numero de orden; aqui se declara, y en `seleccion-a-filtro.ts` se traduce lo que el
// usuario elige al `filtro` que valida el borde. Es el mismo reparto que en `/ordenes`
// (`ordenes-filtros-def.ts` + `seleccion-a-filter.ts`, R58 de la 144).
//
// Lo que esta barra NO tiene, y es deliberado:
//   - ningun `dependsOn` (design §5.3): el historico no ofrece filtro de ZONA, asi que
//     encadenar el mensajero a un padre que no existe dejaria el control mudo;
//   - ningun interruptor de escritura ni de estado: la pantalla es SOLO LECTURA (R24).

/** Clave del BUSCADOR libre. Viaja ESCALAR al `filtro`, nunca como lista (R36). */
export const CLAVE_BUSQUEDA = "q";

/** Clave del filtro por MENSAJERO duenno del hilo (R33). Lista de ids, tal cual. */
export const CLAVE_MENSAJERO = "mensajero_id";

/** Clave del filtro de FECHA (R34). Posicional `[atajo, desde, hasta]`, como en `/ordenes`. */
export const CLAVE_FECHA = "fecha";

/** Clave del filtro por NUMERO DE ORDEN EXACTO (R35). Escalar. */
export const CLAVE_ORDEN = "orden";

/**
 * Que se puede teclear en el buscador. El placeholder ES la documentacion del control:
 * sin el, nadie sabe que el campo alcanza cuatro datos —y sobre todo, que alcanza al
 * MENSAJERO, que es lo que `orden.busqueda_texto` NO cubre (design §1.2)—.
 *
 * Lo que NO alcanza: el CUERPO de los mensajes (A8). Por eso el texto no dice «buscar en
 * la conversacion», que prometeria algo que esta fuera de alcance.
 */
export const PLACEHOLDER_BUSQUEDA = "Destinatario, guía, remisión o mensajero";

/** Placeholder del filtro de fecha, mismo texto que la barra de ordenes. */
export const PLACEHOLDER_FECHA = "Cualquier fecha";

/** Placeholder del filtro por orden: dice que es EXACTO, porque el servidor no perdona (R35). */
export const PLACEHOLDER_ORDEN = "Número exacto de guía o remisión";

/**
 * Declara los cuatro filtros de la barra del historico.
 *
 * @param cat Catalogo ya autorizado por su service (`obtenerCatalogoFiltrosOrdenes`). De el
 *   solo se lee `mensajeros`: el resto de listas del catalogo son de `/ordenes` y aqui no se
 *   ofrecen. Un catalogo vacio declara la barra IGUAL, con `options: []` (R64 de la 144): la
 *   barra montada y sin opciones se lee como «no hay a quien filtrar», mientras que una barra
 *   que desaparece se lee como «esta pantalla no filtra».
 * @param opts.ahora Instante desde el que se calculan los rangos de los atajos. Inyectable
 *   para poder fijarlos en los tests; en produccion es `new Date()`.
 */
export function construirFiltrosHistorico(
  cat: CatalogoFiltrosOrdenesDTO,
  opts: { ahora?: Date } = {},
): FilterDef[] {
  const ahora = opts.ahora ?? new Date();

  return [
    {
      // R32/R37: PRIMER control de la barra. `minChars` sale de la MISMA constante que
      // valida el borde (`filtroHilosHistoricoSchema.q` en `lib/types/historico-conversaciones.ts`
      // usa `BUSQUEDA_MIN_CHARS`): si el minimo cambiara ahi, el control dejaria de mandar
      // terminos que el servidor ya rechazaba SIN tocar esta linea. Escribir `3` aqui es
      // exactamente la mutacion que R37 prohibe.
      key: CLAVE_BUSQUEDA,
      label: "Buscar",
      kind: "text",
      minChars: BUSQUEDA_MIN_CHARS,
      placeholder: PLACEHOLDER_BUSQUEDA,
    },
    {
      // R33 — seleccion multiple por mensajero. SIN `dependsOn` a proposito (design §5.3):
      // el equivalente de `/ordenes` se encadena a la zona, pero aqui no hay control de zona
      // y encadenar a un padre no declarado no ayuda a nadie.
      key: CLAVE_MENSAJERO,
      label: "Mensajero",
      kind: "multi",
      searchPlaceholder: "Buscar mensajero…",
      // `parentValue` NO se emite: sin `dependsOn`, seria dato muerto en la declaracion.
      options: cat.mensajeros.map((m) => ({ value: m.id, label: m.nombre })),
    },
    {
      // R34 — UN solo control de tiempo, con los atajos dentro del propio calendario.
      // `ATAJOS_CREACION` y `ultimosNDiasCalendarioCR` se IMPORTAN, no se reescriben: dos
      // tablas de atajos gemelas divergirian en silencio (misma leccion que A5 de la 129).
      key: CLAVE_FECHA,
      label: "Fecha",
      kind: "dateRange",
      placeholder: PLACEHOLDER_FECHA,
      options: ATAJOS_CREACION.map((a) => ({
        value: a.value,
        label: a.label,
        defaultRange: ultimosNDiasCalendarioCR(a.dias, ahora),
      })),
    },
    {
      // R35 (P7) — NUMERO EXACTO. `minChars: 1` y no `BUSQUEDA_MIN_CHARS`: una guia puede
      // tener un solo digito y exigirle tres la volveria infiltrable. La IGUALDAD la impone
      // el servidor; el control solo transporta el valor.
      key: CLAVE_ORDEN,
      label: "Orden",
      kind: "text",
      minChars: 1,
      placeholder: PLACEHOLDER_ORDEN,
    },
  ];
}
