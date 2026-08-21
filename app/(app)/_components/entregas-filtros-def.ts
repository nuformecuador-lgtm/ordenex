import type { Faceta } from "@/lib/analytics/presentacion";
import type { FilterDef } from "@/components/shared/FilterComponent";
import type { CatalogoFiltrosOrdenesDTO } from "@/lib/types/filtros-ordenes";
import type { MensajeroLiteDTO } from "@/lib/types/orden-guia";
import { ultimosNDiasCalendarioCR } from "@/lib/utils/fecha-cr";

// Los filtros de la barra de ENTREGAS del panel maestro, declarados sobre el mismo
// contrato generico (`FilterDef`) que usa la barra de ordenes.
//
// Los atajos de fecha se IMPORTAN de la declaracion de ordenes en vez de reescribirse:
// el pedido es «los mismos rangos que en ordenes», y dos listas de atajos con los mismos
// numeros se separan sola la primera vez que alguien toque una. Lo importado son datos
// puros y una constante —ninguna dependencia de servidor cruza por aqui—, y la traduccion
// atajo -> rango la sigue haciendo `ultimosNDiasCalendarioCR`, que es la MISMA regla que
// aplica el servidor a `created_preset`.
import {
  ATAJOS_CREACION,
  CLAVE_CREACION,
  GRUPO_CUENTAS_TIENDA,
  GRUPO_INTEGRACIONES,
  SUFIJO_INACTIVA,
} from "@/app/(app)/ordenes/_components/ordenes-filtros-def";

export { ATAJOS_CREACION, CLAVE_CREACION };

/** Clave del filtro de zona en la seleccion agregada. */
export const CLAVE_ZONA = "zona_id";

/** Clave del filtro de provincia en la seleccion agregada. */
export const CLAVE_PROVINCIA = "provincia_id";

/** Clave del filtro de canton en la seleccion agregada. */
export const CLAVE_CANTON = "canton_id";

/** Clave del filtro de distrito en la seleccion agregada. */
export const CLAVE_DISTRITO = "distrito_id";

/** Clave del filtro de tienda en la seleccion agregada. */
export const CLAVE_TIENDA = "tienda_id";

/** Clave del filtro de mensajero en la seleccion agregada. */
export const CLAVE_MENSAJERO = "mensajero_id";

/**
 * Las TRES facetas recortables por rol, con la clave del control que las dibuja.
 *
 * Quien decide cuales se ofrecen NO es este modulo: es `recorteDePresentacion` (feature
 * 133), que razona sobre el ALCANCE resuelto por la 122 y no sobre una tabla rol ->
 * dimension. Aqui solo se traduce su respuesta a claves de filtro. Sin esa traduccion, el
 * adminTienda veria un selector de tienda cuyo unico valor legal es la suya y el
 * adminSatelite uno de zona con la lista vacia — un control que no informa y otro que
 * parece averiado.
 *
 * La cadena geografica NO esta aqui a proposito: no es una faceta del recorte, se ofrece
 * siempre, y lo que la acota es el CATALOGO (el adminSatelite recibe la de su zona).
 */
const CLAVE_POR_FACETA: Readonly<Record<Faceta, string>> = {
  zona: CLAVE_ZONA,
  tienda: CLAVE_TIENDA,
  mensajero: CLAVE_MENSAJERO,
};

/** Las tres, para el caso «no se recorto nada» (maestro/admin). */
const TODAS_LAS_FACETAS: readonly Faceta[] = ["zona", "tienda", "mensajero"];

/**
 * Declara los SIETE filtros de la barra de entregas: fecha, zona, provincia, canton,
 * distrito, tienda y mensajero. Funcion PURA: catalogo -> declaraciones.
 *
 * ⚠ LA CADENA GEOGRAFICA VOLVIO (2026-08-17), y merece explicacion porque este mismo archivo
 * documentaba antes lo contrario. Se habia RETIRADO con razon: la cifra salia de
 * `analytics_daily`, cuyo grano es fecha/zona/tienda/mensajero/estatus/causa y no tiene
 * provincia, canton ni distrito — ofrecer esos tres era prometer un recorte que la cifra
 * ignoraba en silencio. Lo que cambio no es la opinion sino la FUENTE: el conteo de entregas
 * pasa a leerse de la tabla `orden`, que si tiene `provincia_id`, `canton_id` y `distrito_id`
 * como columnas propias. El motivo por el que no estaban desaparecio, asi que vuelven.
 *
 * La cadena se declara con `dependsOn` —canton depende de provincia, distrito de canton—,
 * igual que en la barra de ordenes: la dependencia se DECLARA, no se programa.
 *
 * Sin catalogo, los filtros se declaran IGUAL pero sin opciones: es el mismo fallback de
 * la barra de ordenes (R64 de la 144) — la pantalla sigue viva aunque el catalogo no cargue.
 */
export function construirFiltrosEntregas(
  cat: CatalogoFiltrosOrdenesDTO,
  mensajeros: readonly MensajeroLiteDTO[],
  opts: { ahora?: Date; facetas?: readonly Faceta[] } = {},
): FilterDef[] {
  // `ahora` inyectable para poder fijar los rangos de los atajos en los tests, igual
  // que hace `construirFiltrosOrdenes`.
  const ahora = opts.ahora ?? new Date();

  // Las facetas que el rol NO tiene ofrecidas se caen enteras: ni control montado ni
  // entrada en el selector de «Filtros». Un filtro que no se declara no puede filtrar.
  const ofrecidas = new Set<string>(
    (opts.facetas ?? TODAS_LAS_FACETAS).map((f) => CLAVE_POR_FACETA[f]),
  );
  const esFaceta = (clave: string) =>
    (Object.values(CLAVE_POR_FACETA) as string[]).includes(clave);

  const declarados: FilterDef[] = [
    {
      // UN solo filtro de tiempo, con los atajos DENTRO del propio calendario: es la
      // misma decision (p) de la 144, y aqui ademas los atajos son literalmente los suyos.
      key: CLAVE_CREACION,
      label: "Fecha",
      kind: "dateRange",
      placeholder: "Cualquier fecha",
      options: ATAJOS_CREACION.map((a) => ({
        value: a.value,
        label: a.label,
        defaultRange: ultimosNDiasCalendarioCR(a.dias, ahora),
      })),
    },
    {
      key: CLAVE_ZONA,
      label: "Zona",
      kind: "multi",
      searchPlaceholder: "Buscar zona…",
      options: cat.zonas.map((z) => ({ value: z.id, label: z.nombre })),
    },
    {
      key: CLAVE_PROVINCIA,
      label: "Provincia",
      kind: "multi",
      searchPlaceholder: "Buscar provincia…",
      options: cat.provincias.map((p) => ({ value: p.id, label: p.nombre })),
    },
    {
      key: CLAVE_CANTON,
      label: "Cantón",
      kind: "multi",
      dependsOn: CLAVE_PROVINCIA, // la cadena se declara, no se programa (R56 de la 144)
      searchPlaceholder: "Buscar cantón…",
      options: cat.cantones.map((c) => ({
        value: c.id,
        label: c.nombre,
        parentValue: c.padreId,
      })),
    },
    {
      key: CLAVE_DISTRITO,
      label: "Distrito",
      kind: "multi",
      dependsOn: CLAVE_CANTON,
      searchPlaceholder: "Buscar distrito…",
      options: cat.distritos.map((d) => ({
        value: d.id,
        label: d.nombre,
        parentValue: d.padreId,
      })),
    },
    {
      key: CLAVE_TIENDA,
      label: "Tienda",
      kind: "multi",
      searchPlaceholder: "Buscar tienda…",
      options: cat.tiendas.map((t) => ({
        value: t.id,
        // La cuenta inactiva se distingue en el TEXTO visible: el backend solo entrega
        // banderas, asi que la etiqueta se compone aqui (R51 de la 144).
        label: t.activa ? t.nombre : `${t.nombre}${SUFIJO_INACTIVA}`,
        group: t.esApiKey ? GRUPO_INTEGRACIONES : GRUPO_CUENTAS_TIENDA,
      })),
    },
    {
      // Los mensajeros NO vienen del catalogo geografico: los sirve la misma accion que
      // alimenta los selectores de asignacion de ordenes, y su gate de rol (maestro/admin)
      // coincide exactamente con quien ve este panel.
      key: CLAVE_MENSAJERO,
      label: "Mensajero",
      kind: "multi",
      searchPlaceholder: "Buscar mensajero…",
      options: mensajeros.map((m) => ({ value: m.id, label: m.nombre })),
    },
  ];

  return declarados.filter((f) => !esFaceta(f.key) || ofrecidas.has(f.key));
}
