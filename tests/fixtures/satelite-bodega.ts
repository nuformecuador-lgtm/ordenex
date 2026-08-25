// Feature 170 — FASE 2 (T K.3): andamiaje del listado «Órdenes de la bodega» del
// `adminSatelite`, que pasó a pintar UNA PÁGINA resuelta en el servidor.
//
// Existe por lo mismo que `pagina-inicial.ts`: seis archivos de la suite montan esa pantalla
// y todos necesitan las dos piezas nuevas —la página que el Server Component pre-carga y el
// catálogo de la geografía, que es del CONJUNTO (R46)—. Escritas a mano en cada uno, el
// catálogo acabaría derivándose de las filas de la página por inercia, y entonces ningún test
// podría distinguir «las opciones del conjunto» de «las de la página visible», que es justo lo
// que R46 separa.
import type { RecepcionSateliteDTO } from "@/lib/interfaces/services/IRecepcionSateliteService";
import type { CatalogoFiltrosOrdenesDTO } from "@/lib/types/filtros-ordenes";
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
 * El catálogo de los filtros tal como le llega al `adminSatelite`: el de `/ordenes`
 * (`obtenerCatalogoFiltrosOrdenes`), que para ese rol viene ACOTADO — la geografía de SU zona,
 * sin zonas y sin cuentas tienda.
 *
 * Pedido humano (2026-08-19): antes se derivaba de las órdenes y sus opciones eran NOMBRES.
 * Ahora son ids, como en `/ordenes`. En producción salen de la N:M de la zona; aquí se derivan
 * de las órdenes que el test monta —que es la geografía de esa zona en el caso de prueba— y se
 * usa el propio nombre como id, para que lo que se lee en el desplegable y lo que viaja al
 * servidor sigan siendo legibles en los asserts.
 */
export function catalogoSatelite(
  ordenes: readonly RecepcionSateliteDTO[],
): CatalogoFiltrosOrdenesDTO {
  const unicos = <T extends { id: string }>(filas: T[]): T[] => [
    ...new Map(filas.map((f) => [f.id, f])).values(),
  ];
  return {
    // El adminSatelite no recibe ni zonas ni cuentas tienda: su barra no declara esos
    // controles, y el servicio tampoco le entrega el dato.
    mensajeros: [],
    zonas: [],
    tiendas: [],
    provincias: unicos(
      ordenes.map((o) => ({ id: o.provinciaNombre, nombre: o.provinciaNombre })),
    ),
    cantones: unicos(
      ordenes.map((o) => ({
        id: o.cantonNombre,
        nombre: o.cantonNombre,
        padreId: o.provinciaNombre,
      })),
    ),
    distritos: unicos(
      ordenes
        .filter((o) => o.distritoNombre !== null)
        .map((o) => ({
          id: o.distritoNombre as string,
          nombre: o.distritoNombre as string,
          padreId: o.cantonNombre,
        })),
    ),
  };
}
