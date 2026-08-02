// Feature 170 — FASE 2 (T K.3): andamiaje del listado «Órdenes de la bodega» del
// `adminSatelite`, que pasó a pintar UNA PÁGINA resuelta en el servidor.
//
// Existe por lo mismo que `pagina-inicial.ts`: seis archivos de la suite montan esa pantalla
// y todos necesitan las dos piezas nuevas —la página que el Server Component pre-carga y el
// catálogo de cantón/distrito del CONJUNTO (R46)—. Escritas a mano en cada uno, el catálogo
// acabaría derivándose de las filas de la página por inercia, y entonces ningún test podría
// distinguir «las opciones del conjunto» de «las de la página visible», que es justo lo que
// R46 separa.
import {
  derivarCantones,
  derivarDistritos,
} from "@/lib/utils/filtro-canton-distrito";
import type {
  CatalogoFiltrosSateliteDTO,
  RecepcionSateliteDTO,
} from "@/lib/interfaces/services/IRecepcionSateliteService";
import type { OrdenesBodegaPagina } from "@/app/(app)/recepcion-satelite/_components/RecepcionSateliteModule";

/** Tamaño de página por defecto del dominio (`lib/config/recepcion-satelite.ts`). */
export const PAGE_SIZE_SATELITE = 25;

/**
 * La página 1 tal como la pre-carga el Server Component: `items` y, por defecto, el total
 * del propio array (el caso «cabe entera en una página»). `total` se fija aparte cuando el
 * conjunto es mayor que la página.
 */
export function paginaBodega(
  items: RecepcionSateliteDTO[],
  overrides: { total?: number; pageSize?: number } = {},
): OrdenesBodegaPagina {
  return {
    items,
    total: overrides.total ?? items.length,
    pageSize: overrides.pageSize ?? PAGE_SIZE_SATELITE,
  };
}

/**
 * El catálogo que la Server Action de T K.2 devuelve para un conjunto de órdenes: las mismas
 * funciones puras que usa el servicio, aplicadas al CONJUNTO que se le pase (no a una
 * página). Un test que quiera comprobar R46 le pasa el conjunto entero y monta la pantalla
 * con una página recortada.
 */
export function catalogoSatelite(
  ordenes: readonly RecepcionSateliteDTO[],
): CatalogoFiltrosSateliteDTO {
  const cantones = derivarCantones(ordenes);
  return {
    cantones,
    distritos: cantones.flatMap((canton) =>
      derivarDistritos(ordenes, canton.value).map((distrito) => ({
        ...distrito,
        parentValue: canton.value,
      })),
    ),
  };
}
