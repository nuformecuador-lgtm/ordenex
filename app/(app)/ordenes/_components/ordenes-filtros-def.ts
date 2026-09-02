import type { FilterDef } from "@/components/shared/FilterComponent";
import type { CatalogoFiltrosOrdenesDTO } from "@/lib/types/filtros-ordenes";
import { BUSQUEDA_MIN_CHARS } from "@/lib/types/orden";
import { ultimosNDiasCalendarioCR } from "@/lib/utils/fecha-cr";

// Feature 144 / B3 (design.md §4.1) — TODO lo especifico de ordenes vive aqui.
//
// El componente generico del bloque A no sabe que es una provincia, una cuenta por
// API key ni un atajo de antiguedad: la cadena geografica son dos `dependsOn`, el
// agrupado de tienda son dos strings en `group` y el filtro de tiempo es UNO solo
// (R55, R56). Funcion PURA: catalogo -> declaraciones.

/** Grupos del filtro de tienda (R51, decision (h) del spec). */
export const GRUPO_CUENTAS_TIENDA = "Cuentas tienda";
export const GRUPO_INTEGRACIONES = "Integraciones (API)";

/*
 * ── FICHA 351 (2026-09-02): AQUI ESTABA `SUFIJO_INACTIVA = " (inactiva)"`, Y SE RETIRA ────────
 *
 * Su comentario decia: «Sufijo de las cuentas inactivas, que SI se ofrecen (decision (e),
 * R50/R51)». LA DECISION (e) DE LA FEATURE 144 QUEDA REVERTIDA por instruccion del humano del
 * 2026-09-02: «muestra tiendas o mensajeros que tenemos desactivos y eso es informacion que no
 * debe mostrarse». Medido en produccion ese dia, eran 2 de las 4 tiendas del desplegable — la
 * mitad de la lista.
 *
 * El sufijo se va porque YA NO HAY NADA QUE SUFIJAR, no porque estorbe: `listCuentasTienda`
 * excluye ahora a `inactivo`/`bloqueado` (`ESTADOS_USUARIO_NO_ASIGNABLES`), asi que
 * `CuentaTiendaDTO.activa` llega siempre en `true` y la rama del sufijo era codigo inalcanzable
 * que le contaba al lector una regla que el sistema ya no aplica.
 *
 * Lo que la decision (e) protegia NO se pierde, y conviene decirlo porque su argumento era
 * «excluirlas haria invisibles esas ordenes bajo el filtro»: la premisa era falsa.
 * `OrdenRepository.list` no mira el estado del dueño, asi que las ordenes de una tienda dada de
 * baja siguen listandose con su nombre; lo unico que desaparece es poder ACOTAR por ella.
 *
 * `activa` sigue viajando en el DTO (contrato del servidor, con sus tests) y este modulo
 * simplemente ya no la lee: la etiqueta es el nombre a secas.
 */

/**
 * Atajos de antiguedad ofrecidos DENTRO del filtro de tiempo (R9). Sus valores siguen
 * siendo los de `CREATED_PRESETS` del contrato server-side, pero ya NO viajan a la
 * salida: el atajo se resuelve AQUI a su rango de fechas calendario de Costa Rica y lo
 * que se emite (y se pinta en el calendario) son `created_desde`/`created_hasta`. El
 * rango se calcula con la misma regla que aplica el servidor a `created_preset`
 * (`inicioDeUltimosNDiasCREnUtc`: N dias calendario incluido hoy).
 */
export const ATAJOS_CREACION = [
  { value: "7d", dias: 7, label: "Últimos 7 días" },
  { value: "15d", dias: 15, label: "Últimos 15 días" },
  { value: "30d", dias: 30, label: "Últimos 30 días" },
  { value: "90d", dias: 90, label: "Últimos 90 días" },
] as const;

/** Clave del filtro de tiempo en la seleccion agregada (posicional `[atajo, desde, hasta]`). */
export const CLAVE_CREACION = "created";

/**
 * Clave del filtro de ESTADO. Es la misma que espera el `filter` de `listarOrdenes`,
 * asi que `seleccionAFilter` la deja pasar tal cual (identidad, como el resto de
 * claves de catalogo).
 */
export const CLAVE_ESTADO = "status_id";

/**
 * Clave del filtro REASIGNABLES. Marcado, el backend devuelve las ordenes que esperan una
 * decision de despacho: estan en la bodega central y no tienen mensajero, que es el punto
 * desde el que se les asigna uno o se rutean a una bodega satelite. Desmarcado, el filtro
 * no existe.
 */
export const CLAVE_REASIGNABLES = "reasignables";

/**
 * Pedido humano (2026-08-27) — clave del interruptor ELIMINADAS. Marcado, el listado deja de
 * mostrar las ordenes vivas y muestra EXCLUSIVAMENTE las borradas (`deleted_at IS NOT NULL`);
 * desmarcado, el filtro no existe y el listado es el de siempre.
 *
 * Es SUSTITUTIVO y no acumulativo, y por eso el control se llama «Eliminadas» y no «Incluir
 * eliminadas»: mezclarlas con las vivas dejaria en la misma tabla filas sobre las que la barra
 * tendria que ofrecer «Eliminar» y «Recuperar» a la vez, sin que la fila diga en cual de los dos
 * mundos esta. Solo se declara al `maestro`, que es el unico que puede borrar y recuperar.
 */
export const CLAVE_ELIMINADOS = "eliminados";

/**
 * Clave del filtro por MENSAJERO ASIGNADO. Es la misma que espera el `filter` de
 * `listarOrdenes`, asi que `seleccionAFilter` la deja pasar tal cual (identidad, como el
 * resto de claves de catalogo).
 */
export const CLAVE_MENSAJERO = "mensajero_id";

/**
 * Feature 169 — clave del BUSCADOR de texto libre. Es la misma que espera el `filter`
 * de `listarOrdenes`, pero NO viaja como lista: `seleccionAFilter` la traduce a un
 * escalar (es un termino, no un conjunto de ids).
 */
export const CLAVE_BUSQUEDA = "q";

/**
 * Que se puede teclear ahi. El placeholder ES la documentacion del buscador: sin el, el
 * usuario no tiene forma de saber que el campo alcanza cinco datos y no solo la guia.
 * El orden es el de uso esperado en bodega; `producto` va al final porque es el ultimo
 * recurso ("la caja de zapatos de ayer"), no la forma habitual de buscar una orden.
 */
export const PLACEHOLDER_BUSQUEDA = "Guía, remisión, teléfono, destinatario o producto";

/**
 * Declara los NUEVE filtros de la barra de ordenes sobre el contrato del bloque A.
 * Caen claves segun el rol: sin tienda si el rol esta acotado a la suya (R62) y sin
 * REASIGNABLES si el rol no reasigna mensajeros (`adminTienda`).
 *
 * Feature 169/R32: el BUSCADOR va PRIMERO y no cae por rol — el acotamiento por rol lo
 * impone el servicio, no la barra.
 *
 * Pedido humano (2026-08-19): esta misma barra la monta ahora el listado de la bodega
 * satelite, y de ahi sale `incluirZona`. Es la MISMA razon que `incluirTienda`: al rol
 * acotado a UNA zona no se le ofrece elegirla —un selector con un unico valor legal no
 * informa— y su geografia ya llega recortada a esa zona por el catalogo. Que las tres claves
 * caigan por parametro, y no por una copia de esta funcion, es lo que impide que las barras
 * de dos superficies se separen sin que nadie lo note.
 */
export function construirFiltrosOrdenes(
  cat: CatalogoFiltrosOrdenesDTO,
  opts: {
    incluirTienda: boolean;
    incluirReasignables?: boolean;
    incluirZona?: boolean;
    /**
     * Declara el filtro por MENSAJERO asignado. Cae en el rol acotado a su propia tienda
     * por la MISMA razon que el de tienda: el directorio de mensajeros es del personal
     * interno y el catalogo tampoco se lo entrega, asi que el control se quedaria vacio.
     */
    incluirMensajero?: boolean;
    /**
     * Pedido humano (2026-08-27): declara el interruptor «Eliminadas». Solo el `maestro` lo
     * recibe —es el unico que puede eliminar y recuperar—, y el servidor RECHAZA la clave a
     * cualquier otro rol en vez de ignorarla. Por defecto `false`: ninguna superficie previa lo
     * gana por descuido.
     */
    incluirEliminados?: boolean;
    ahora?: Date;
  },
): FilterDef[] {
  // `ahora` inyectable para poder fijar los rangos de los atajos en los tests.
  const ahora = opts.ahora ?? new Date();

  const tienda: FilterDef[] = opts.incluirTienda
    ? [
        {
          key: "tienda_id",
          label: "Tienda",
          kind: "multi",
          searchPlaceholder: "Buscar tienda…",
          options: cat.tiendas.map((t) => ({
            value: t.id,
            // FICHA 351: el NOMBRE A SECAS. Aqui se componia el sufijo «(inactiva)» de R51;
            // ver la nota de la cabecera, donde vivia la constante y donde queda escrito por
            // que la decision (e) de la 144 esta revertida.
            label: t.nombre,
            group: t.esApiKey ? GRUPO_INTEGRACIONES : GRUPO_CUENTAS_TIENDA,
          })),
        },
      ]
    : [];

  const reasignables: FilterDef[] =
    opts.incluirReasignables ?? true
      ? [
          {
            // Interruptor: o esta puesto o no esta. El predicado (prioridad + no
            // reprogramada + sin mensajero) lo resuelve el backend; aqui solo se declara.
            key: CLAVE_REASIGNABLES,
            label: "Reasignables",
            kind: "boolean",
          },
        ]
      : [];

  // Pedido humano (2026-08-25): el filtro por MENSAJERO ASIGNADO, encadenado a la ZONA
  // (`dependsOn`), exactamente igual que el canton lo esta a la provincia. Elegida una zona,
  // el desplegable solo ofrece a los mensajeros de esa zona; sin zona elegida —o con el
  // control de zona no declarado, que es el caso del rol acotado a UNA zona— los ofrece
  // todos, que es lo que el motor de dependencias hace con un padre sin seleccion o no
  // declarado (R24/R27). No hace falta ninguna regla propia aqui.
  //
  // ⚠️ Un mensajero SIN zona asignada (`zona_id` es nullable) no tiene `parentValue`, y el
  // motor no ofrece esas opciones mientras el padre este declarado: no es un olvido, es la
  // consecuencia de encadenar. Si algun dia hay mensajeros sin zona con ordenes asignadas,
  // lo que hay que arreglar es el dato (darles zona), no el encadenado.
  const mensajero: FilterDef[] =
    opts.incluirMensajero ?? true
      ? [
          {
            key: CLAVE_MENSAJERO,
            label: "Mensajero",
            kind: "multi",
            dependsOn: "zona_id",
            searchPlaceholder: "Buscar mensajero…",
            options: cat.mensajeros.map((m) => ({
              value: m.id,
              label: m.nombre,
              // `undefined`, no `null`: el contrato del motor es "sin padre = sin
              // asociacion", y `null` no es ese contrato.
              parentValue: m.zonaId ?? undefined,
            })),
          },
        ]
      : [];

  // Pedido humano (2026-08-27): el interruptor de las ELIMINADAS. Mismo `kind: "boolean"` que
  // «Reasignables» —o esta puesto o no esta—, pero al contrario que aquel NO acota el listado:
  // lo SUSTITUYE. Por defecto NO se declara (`?? false`, al reves que sus vecinos): que una
  // superficie gane por descuido la capacidad de listar lo borrado es lo unico que no puede
  // pasar aqui.
  const eliminados: FilterDef[] =
    opts.incluirEliminados ?? false
      ? [
          {
            key: CLAVE_ELIMINADOS,
            label: "Eliminadas",
            kind: "boolean",
          },
        ]
      : [];

  const zona: FilterDef[] =
    opts.incluirZona ?? true
      ? [
          {
            key: "zona_id",
            label: "Zona",
            kind: "multi",
            searchPlaceholder: "Buscar zona…",
            options: cat.zonas.map((z) => ({ value: z.id, label: z.nombre })),
          },
        ]
      : [];

  return [
    {
      // R32: PRIMER control de la barra. `minChars` sale de la MISMA constante que valida
      // el borde (`lib/types/orden.ts`): si el minimo cambiara ahi, el control dejaria de
      // mandar terminos que el servidor ya rechazaba, sin tocar esta linea.
      key: CLAVE_BUSQUEDA,
      label: "Buscar",
      kind: "text",
      minChars: BUSQUEDA_MIN_CHARS,
      placeholder: PLACEHOLDER_BUSQUEDA,
    },
    ...zona,
    ...mensajero,
    ...tienda,
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
      dependsOn: "provincia_id", // R56: la cadena se declara, no se programa
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
      // UN solo filtro de tiempo (decision (p)): los atajos son ajustes rapidos del
      // rango, dentro del propio calendario.
      key: CLAVE_CREACION,
      label: "Fecha de creación",
      kind: "dateRange",
      placeholder: "Cualquier fecha",
      options: ATAJOS_CREACION.map((a) => ({
        value: a.value,
        label: a.label,
        defaultRange: ultimosNDiasCalendarioCR(a.dias, ahora),
      })),
    },
    ...reasignables,
    // ULTIMO de la barra, detras incluso de «Reasignables»: es el interruptor que cambia el
    // universo entero del listado, no un filtro mas, y no debe quedar a mano de un clic
    // distraido mientras se afina una busqueda.
    ...eliminados,
  ];
}

/** Catalogo vacio: barra montada pero sin opciones cuando el catalogo no cargo (R64). */
export const CATALOGO_FILTROS_VACIO: CatalogoFiltrosOrdenesDTO = {
  zonas: [],
  tiendas: [],
  mensajeros: [],
  provincias: [],
  cantones: [],
  distritos: [],
};
