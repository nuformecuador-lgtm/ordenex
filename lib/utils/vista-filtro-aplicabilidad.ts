import type { FilterDef } from "@/components/shared/FilterComponent";
import type { VistaFiltroPayload } from "@/lib/types/vista-filtro";

// FICHA 453 (design §8, T4.1) — ¿SE PUEDE APLICAR ESTA VISTA ENTERA?
//
// MODULO PURO: entra `(catalogo, filtro)` y sale un veredicto. Sin React, sin dominio, sin red: es
// el corazon de R24–R30 y se puede probar sin renderizar nada.
//
// ══════════════════════════════════════════════════════════════════════════════════════════════
// ⚠️ LO QUE ESTE ARCHIVO EXISTE PARA SEPARAR: «EL CATALOGO NO ESTA» **NO** ES «EL VALOR DESAPARECIO»
// ══════════════════════════════════════════════════════════════════════════════════════════════
// En `/ordenes` el catalogo geografico se resuelve en el servidor y la pagina ya contempla el
// fallo: `app/(app)/ordenes/page.tsx` devuelve `null` y `OrdenesListado` monta los filtros
// DESHABILITADOS Y SIN OPCIONES. El catalogo de estados tiene la misma forma de fallo: su fetcher
// devuelve `[]` cuando la lectura falla.
//
// Si la comprobacion se hiciera en ese instante sin distinguir los dos casos, **TODAS las vistas de
// todo el mundo saldrian «incompletas» a la vez** —y con el aviso de partes perdidas por delante—
// por una lectura que fallo medio segundo antes. Al recargar volverian a estar bien. Nadie sabria
// por que.
//
// Por eso hay DOS cierres, y los dos son necesarios:
//
//   1. El catalogo entra como una UNION EXPLICITA (`CatalogoVistas`): quien llama tiene que DECIR
//      si sus opciones estan resueltas. No se puede pasar «una lista de filtros» a secas, que es
//      justo la firma con la que el error se cuela sin que nadie lo note.
//   2. Aunque quien llama diga «cargado», este modulo se NIEGA a clasificar si el filtro que la
//      vista usa esta DESHABILITADO o se ofrece SIN NINGUNA OPCION: en ese estado, «el valor ya no
//      existe» y «las opciones no llegaron» son indistinguibles, y la respuesta honesta es «ahora
//      no puedo comprobarlo» (R29), no «esta rota».
//
// La direccion del sesgo es deliberada: ante la duda, NO se clasifica y NO se aplica. Una vista
// buena marcada incompleta empuja a la persona a rehacerla —y a perderla—; una vista que hoy no se
// puede comprobar solo cuesta un reintento.

/**
 * El catalogo de la superficie, con su estado DICHO EN VOZ ALTA.
 *
 * `no_disponible` no es «no hay opciones»: es «no se pudo saber». El `motivo` es texto visible, sin
 * jerga (R39).
 */
export type CatalogoVistas =
  | { estado: "cargado"; filtros: FilterDef[] }
  | { estado: "no_disponible"; motivo: string };

/** Constructor del caso bueno: la pantalla declara estos filtros y sus opciones YA llegaron. */
export function catalogoCargado(filtros: FilterDef[]): CatalogoVistas {
  return { estado: "cargado", filtros };
}

/** Constructor del caso «no se pudo saber». El motivo se le enseña a la persona tal cual. */
export function catalogoNoDisponible(motivo: string = MSG_APLICABILIDAD.catalogoCaido): CatalogoVistas {
  return { estado: "no_disponible", motivo };
}

/** Por que una parte de la vista no se puede reponer. */
export type MotivoPerdida =
  /** La pantalla YA NO DECLARA ese filtro (un rol que cambio, un filtro retirado). */
  | "filtro_retirado"
  /** El filtro sigue ahi, pero alguno de los valores guardados ya no esta entre sus opciones. */
  | "valores_desaparecidos"
  /** El filtro es de un tipo que este modulo no sabe comprobar: no se da por bueno, se nombra. */
  | "tipo_desconocido";

export interface PartePerdida {
  /**
   * La clave del filtro. Es para usarla como `key` de React o en un registro, NO para enseñarla:
   * lo que se enseña es `etiqueta` (R25/R39).
   */
  clave: string;
  /** La etiqueta VISIBLE del filtro (`FilterDef.label`), o la clave si la vista la trae y la pantalla no. */
  etiqueta: string;
  motivo: MotivoPerdida;
  /**
   * Cuantos valores guardados ya no existen (solo en `valores_desaparecidos`).
   *
   * ⚠️ NO VIAJAN LOS IDENTIFICADORES, Y ES A PROPOSITO: un valor que ya no esta en el catalogo no
   * tiene etiqueta que enseñar, asi que lo unico que se podria pintar es su id crudo — que es
   * exactamente lo que R25 y R39 prohiben. Con el numero, el aviso dice «Distrito: 2 opciones que
   * ya no existen», que es lo que la persona necesita saber.
   */
  valoresPerdidos: number;
  /** Frase lista para enseñar, sin jerga tecnica (R39). */
  detalle: string;
}

/**
 * El veredicto. Es una union a proposito: `no_comprobable` NO es un caso de `incompleta` con cero
 * partes, y quien consuma esto tiene que tratarlos por separado o no compila.
 */
export type Aplicabilidad =
  /** R29 — no se clasifica, no se aplica, y se dice. */
  | { estado: "no_comprobable"; motivo: string }
  /** R8 — el documento guardado no se puede leer: ni entera ni en parte. */
  | { estado: "ilegible" }
  /** R18/R24 — se puede reponer entera. */
  | { estado: "aplicable_entera"; aplicable: VistaFiltroPayload }
  /** R25–R28 — hay partes perdidas: NO se aplica nada hasta que alguien decida. */
  | { estado: "incompleta"; aplicable: VistaFiltroPayload; perdidas: PartePerdida[] };

export const MSG_APLICABILIDAD = {
  catalogoCaido: "Todavia no se pueden comprobar las vistas: los filtros de esta pantalla no han terminado de cargar.",
  filtroRetirado: (etiqueta: string) => `«${etiqueta}» ya no se puede filtrar en esta pantalla.`,
  valoresDesaparecidos: (etiqueta: string, cuantos: number) =>
    cuantos === 1
      ? `En «${etiqueta}», una de las opciones guardadas ya no existe.`
      : `En «${etiqueta}», ${cuantos} de las opciones guardadas ya no existen.`,
  tipoDesconocido: (etiqueta: string) => `«${etiqueta}» no se puede comprobar en esta version.`,
} as const;

/** Los tipos de control que este modulo sabe comprobar. Espeja los de `FilterComponent`. */
const KINDS_CON_REGLA = new Set<string>(["multi", "single", "dateRange", "boolean", "text"]);

/** Los que dependen de un catalogo de opciones: sin opciones ofrecidas, no se puede comprobar nada. */
const KINDS_CON_CATALOGO = new Set<string>(["multi", "single"]);

/**
 * R24 — ¿se puede aplicar esta vista entera, y si no, que se pierde exactamente?
 *
 * `filtro === null` significa que el documento guardado no es legible (R8): se responde `ilegible`
 * ANTES de mirar el catalogo, porque que un documento se pueda leer no depende de que las opciones
 * hayan cargado. Una vista ilegible no se aplica nunca, pero se sigue pudiendo renombrar y borrar.
 */
export function evaluarVista(
  catalogo: CatalogoVistas,
  filtro: VistaFiltroPayload | null,
): Aplicabilidad {
  if (filtro === null) return { estado: "ilegible" };
  if (catalogo.estado === "no_disponible") {
    return { estado: "no_comprobable", motivo: catalogo.motivo };
  }

  const declarados = new Map(catalogo.filtros.map((f) => [f.key, f]));
  const perdidas: PartePerdida[] = [];
  const seleccion: Record<string, string[]> = {};

  // Las dos piezas que dependen del catalogo: los controles montados y sus valores. El termino no
  // depende de nada, asi que nunca se pierde.
  const claves = new Set<string>([...filtro.activos, ...Object.keys(filtro.seleccion)]);

  for (const clave of claves) {
    const valores = filtro.seleccion[clave] ?? [];
    const def = declarados.get(clave);

    // (1) La pantalla YA NO DECLARA este filtro. No es un catalogo caido: los filtros seguirian
    // declarados (deshabilitados) si lo fuera. Esto es un filtro retirado, o un rol que cambio.
    if (!def) {
      perdidas.push({
        clave,
        etiqueta: clave,
        motivo: "filtro_retirado",
        valoresPerdidos: valores.length,
        detalle: MSG_APLICABILIDAD.filtroRetirado(clave),
      });
      continue;
    }

    // (2) ⚠️ EL CIERRE QUE SEPARA LOS DOS CASOS. Un filtro deshabilitado, o uno de catalogo que se
    // ofrece sin ninguna opcion, no permite distinguir «este valor ya no existe» de «las opciones
    // no llegaron». No se clasifica NADA: se abandona la evaluacion entera (R29).
    const sinOpciones = KINDS_CON_CATALOGO.has(def.kind) && (def.options ?? []).length === 0;
    if (valores.length > 0 && (def.disabled === true || sinOpciones)) {
      return { estado: "no_comprobable", motivo: MSG_APLICABILIDAD.catalogoCaido };
    }

    // (3) Un tipo que no sabemos comprobar no se da por bueno: se nombra.
    if (!KINDS_CON_REGLA.has(def.kind)) {
      perdidas.push({
        clave,
        etiqueta: def.label,
        motivo: "tipo_desconocido",
        valoresPerdidos: valores.length,
        detalle: MSG_APLICABILIDAD.tipoDesconocido(def.label),
      });
      continue;
    }

    const revision = revisarValores(def, valores);
    if (revision.perdidos > 0) {
      perdidas.push({
        clave,
        etiqueta: def.label,
        motivo: "valores_desaparecidos",
        valoresPerdidos: revision.perdidos,
        detalle: MSG_APLICABILIDAD.valoresDesaparecidos(def.label, revision.perdidos),
      });
    }
    if (revision.conservados.length > 0) seleccion[clave] = revision.conservados;
  }

  const aplicable: VistaFiltroPayload = {
    v: filtro.v,
    // R18 — el termino se repone siempre: es texto libre y no depende de ningun catalogo.
    termino: filtro.termino,
    // Un control que la pantalla ya no declara no se puede montar, asi que sale de los activos.
    activos: filtro.activos.filter((clave) => declarados.has(clave)),
    seleccion,
  };

  return perdidas.length === 0
    ? { estado: "aplicable_entera", aplicable }
    : { estado: "incompleta", aplicable, perdidas };
}

/**
 * Los valores de un filtro contra las opciones que se ofrecen HOY (design §8.1).
 *
 * | `kind` | aplicable cuando… | se pierde cuando… |
 * | --- | --- | --- |
 * | `multi` | cada valor esta entre las opciones | uno o mas ya no existen (se conservan los vivos) |
 * | `single` | el valor esta entre las opciones | no esta (el filtro entero se cae) |
 * | `dateRange` | el atajo, si lo hay, sigue ofreciendose; las fechas siempre | el atajo ya no se ofrece |
 * | `boolean`, `text` | siempre | nunca: no dependen de ningun catalogo |
 */
function revisarValores(
  def: FilterDef,
  valores: string[],
): { conservados: string[]; perdidos: number } {
  if (valores.length === 0) return { conservados: [], perdidos: 0 };

  const ofrecidas = new Set((def.options ?? []).map((o) => o.value));

  if (def.kind === "boolean" || def.kind === "text") {
    return { conservados: valores, perdidos: 0 };
  }

  if (def.kind === "multi") {
    // Se conservan los que siguen vivos: una vista con cinco distritos y uno dado de baja sigue
    // valiendo para los otros cuatro. Lo perdido se NOMBRA igual, que es lo que R25 exige.
    const conservados = valores.filter((v) => ofrecidas.has(v));
    return { conservados, perdidos: valores.length - conservados.length };
  }

  if (def.kind === "single") {
    const [valor] = valores;
    return ofrecidas.has(valor)
      ? { conservados: valores, perdidos: 0 }
      : { conservados: [], perdidos: 1 };
  }

  // `dateRange`: la terna es `[atajo, desde, hasta]`. Con atajo, el rango lo declara la opcion, asi
  // que un atajo que ya no se ofrece deja la terna sin forma de reconstruirse; sin atajo, las dos
  // fechas se reponen tal cual y no dependen de nada.
  const [atajo = ""] = valores;
  if (atajo === "") return { conservados: valores, perdidos: 0 };
  return ofrecidas.has(atajo)
    ? { conservados: valores, perdidos: 0 }
    : { conservados: [], perdidos: 1 };
}
