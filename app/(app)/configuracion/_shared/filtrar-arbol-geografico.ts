import { estaDisponible } from "@/lib/repositories/_shared/geografia-activa";
import type {
  CantonArbolDTO,
  DistritoArbolDTO,
  ProvinciaArbolDTO,
} from "@/lib/types/geografia-nodo";
import { normalizeName } from "@/lib/utils/normalize";

// FICHA 374 (design §7.2 y §7.5) — EL FILTRO DEL ARBOL GEOGRAFICO, EN UN SOLO SITIO.
//
// DE DONDE SALE. Es el `useMemo` de filtrado que vivia dentro de `GeografiaSelector.tsx`
// (`:144-168`), promovido a modulo PURO —sin React— porque desde esta ficha lo usan DOS
// pantallas: el selector de Tarifas y la administracion del catalogo. Extraerlo tambien lo hace
// comprobable sin montar nada.
//
// LO QUE CAMBIA AL EXTRAERLO, y es un arreglo, no una reescritura: su `norm()` privado
// (`GeografiaSelector.tsx:18-23`) era la TERCERA copia de una normalizacion que ya existia dos
// veces, y ademas NO colapsaba los espacios internos —el `trim` se lo ponia el llamador—, asi que
// «san  jose» con doble espacio no encontraba «San José». Aqui se usa `normalizeName`
// (`lib/utils/normalize.ts`), que es la MISMA funcion con la que `resolveGeo` indexa el catalogo:
// buscar en la pantalla y resolver una carga masiva dejan de ser dos reglas distintas.
//
// LO QUE SE AÑADE: el filtro de estado de R58/R59.

/** Las tres opciones del filtro de estado (R58). Vocabulario cerrado. */
export const FILTROS_ESTADO_GEOGRAFICO = ["todos", "activos", "retirados"] as const;

export type FiltroEstadoGeografico = (typeof FILTROS_ESTADO_GEOGRAFICO)[number];

export interface FiltrosArbolGeografico {
  /** Texto libre. Se compara NORMALIZADO: sin mayusculas, sin acentos y sin espacios sobrantes. */
  texto: string;
  /**
   * El estado, evaluado sobre la disponibilidad EFECTIVA (`estaDisponible`) y NO sobre el flag
   * propio: quien busca lo retirado quiere ver tambien el distrito que cayo por su canton.
   */
  estado: FiltroEstadoGeografico;
}

/** `true` si el nodo pasa el filtro de estado. `todos` no filtra nada. */
function casaEstado(disponible: boolean, estado: FiltroEstadoGeografico): boolean {
  if (estado === "todos") return true;
  return estado === "activos" ? disponible : !disponible;
}

/**
 * Filtra el arbol por texto Y por estado (R59: se componen con AND).
 *
 * LAS DOS REGLAS DE SUPERVIVENCIA, que son las mismas que ya tenia el filtro de texto:
 *
 *  1. **Un ascendiente que casa por texto arrastra a toda su rama.** Buscar «Puntarenas» muestra
 *     la provincia entera; no hace falta que cada distrito lleve el texto.
 *  2. **Un padre sobrevive si el o alguno de sus descendientes casa.** Sin esto, un distrito
 *     retirado bajo un canton activo quedaria ESCONDIDO justo en el filtro «Retirados», que es el
 *     unico sitio desde el que alguien iria a buscarlo.
 *
 * Con `{ texto: "", estado: "todos" }` devuelve el arbol tal cual: es el caso por defecto de la
 * pantalla y no debe costar ni una copia de mas.
 */
export function filtrarArbolGeografico(
  arbol: readonly ProvinciaArbolDTO[],
  filtros: FiltrosArbolGeografico,
): ProvinciaArbolDTO[] {
  const consulta = normalizeName(filtros.texto);
  const { estado } = filtros;
  if (consulta === "" && estado === "todos") return [...arbol];

  const casaTexto = (nombre: string): boolean =>
    consulta === "" || normalizeName(nombre).includes(consulta);

  const provincias: ProvinciaArbolDTO[] = [];

  for (const provincia of arbol) {
    const textoProvincia = casaTexto(provincia.nombre);
    const cantones: CantonArbolDTO[] = [];

    for (const canton of provincia.cantones) {
      // El texto se hereda hacia abajo (regla 1); el estado NO se hereda: cada nodo responde por
      // su propia disponibilidad efectiva.
      const textoCanton = textoProvincia || casaTexto(canton.nombre);
      const distritos: DistritoArbolDTO[] = canton.distritos.filter(
        (distrito) =>
          (textoCanton || casaTexto(distrito.nombre)) &&
          casaEstado(
            estaDisponible({
              provincia: provincia.activo,
              canton: canton.activo,
              distrito: distrito.activo,
            }),
            estado,
          ),
      );

      const cantonCasa =
        textoCanton &&
        casaEstado(
          estaDisponible({ provincia: provincia.activo, canton: canton.activo }),
          estado,
        );

      if (cantonCasa || distritos.length > 0) cantones.push({ ...canton, distritos });
    }

    const provinciaCasa =
      textoProvincia && casaEstado(estaDisponible({ provincia: provincia.activo }), estado);

    if (provinciaCasa || cantones.length > 0) provincias.push({ ...provincia, cantones });
  }

  return provincias;
}
