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
} from "@/app/(app)/ordenes/_components/ordenes-filtros-def";

export { ATAJOS_CREACION, CLAVE_CREACION };

/** Clave del filtro de mensajero en la seleccion agregada. */
export const CLAVE_MENSAJERO = "mensajero_id";

/**
 * Declara los SEIS filtros de la barra de entregas: fecha, zona, la cadena geografica
 * (provincia -> canton -> distrito) y mensajero. Funcion PURA: catalogo -> declaraciones.
 *
 * El ORDEN no es el del pedido al pie de la letra (fecha, zona, canton, distrito,
 * provincia, mensajero): la provincia va ANTES que el canton, y el canton antes que el
 * distrito, porque los dos ultimos dependen del anterior (`dependsOn`) y un hijo ofrecido
 * por encima de su padre se monta vacio y sin decir por que. Los seis filtros pedidos
 * estan; lo que cambia es que la cadena se declara en el sentido en que se usa.
 *
 * Sin catalogo, los filtros se declaran IGUAL pero sin opciones: es el mismo fallback de
 * la barra de ordenes (R64 de la 144) — la pantalla sigue viva aunque el catalogo no cargue.
 */
export function construirFiltrosEntregas(
  cat: CatalogoFiltrosOrdenesDTO,
  mensajeros: readonly MensajeroLiteDTO[],
  opts: { ahora?: Date } = {},
): FilterDef[] {
  // `ahora` inyectable para poder fijar los rangos de los atajos en los tests, igual
  // que hace `construirFiltrosOrdenes`.
  const ahora = opts.ahora ?? new Date();

  return [
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
      key: "zona_id",
      label: "Zona",
      kind: "multi",
      searchPlaceholder: "Buscar zona…",
      options: cat.zonas.map((z) => ({ value: z.id, label: z.nombre })),
    },
    {
      key: "provincia_id",
      label: "Provincia",
      kind: "multi",
      searchPlaceholder: "Buscar provincia…",
      options: cat.provincias.map((p) => ({ value: p.id, label: p.nombre })),
    },
    {
      key: "canton_id",
      label: "Cantón",
      kind: "multi",
      dependsOn: "provincia_id", // la cadena se declara, no se programa
      searchPlaceholder: "Buscar cantón…",
      options: cat.cantones.map((c) => ({
        value: c.id,
        label: c.nombre,
        parentValue: c.padreId,
      })),
    },
    {
      key: "distrito_id",
      label: "Distrito",
      kind: "multi",
      dependsOn: "canton_id",
      searchPlaceholder: "Buscar distrito…",
      options: cat.distritos.map((d) => ({
        value: d.id,
        label: d.nombre,
        parentValue: d.padreId,
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
}
