// Feature 144/B2 (design §3.1) — catalogo PRECARGADO de los filtros de `/ordenes`.
//
// Listas PLANAS, no arbol: el encadenamiento provincia -> canton -> distrito lo resuelve
// el cliente con `padreId`, y una lista plana se mapea a las opciones del filtro sin
// recorrer nada. Campos MINIMOS (R54): id, nombre, padre donde aplica y dos banderas
// booleanas en las cuentas tienda. Nada de email/telefono/cedula.

/** Opcion de catalogo: lo minimo para pintar y emitir una opcion (R48). */
export interface OpcionCatalogo {
  id: string;
  nombre: string;
}

/**
 * Opcion con su elemento PADRE (R48): canton -> provincia, distrito -> canton. El
 * cliente lo usa como `parentValue` del contrato de dependencias del componente
 * generico, que no sabe que significa.
 */
export interface OpcionConPadre extends OpcionCatalogo {
  padreId: string;
}

/**
 * Cuenta que puede ser DUEÑA de una orden (`orden.tienda_id` -> `usuario`): por sesion
 * (rol `adminTienda`) o por integracion (rol `apiKey`, feature 88).
 *
 * `esApiKey` y `activa` son BANDERAS, no PII (R54): el mapeo a "grupo aparte" (R51) y al
 * sufijo "(inactiva)" ocurre en la capa de declaracion del cliente. Se incluyen las
 * cuentas INACTIVAS a proposito (decision (e) del spec): siguen siendo dueñas de ordenes
 * historicas, y excluirlas haria invisibles esas ordenes bajo el filtro de tienda.
 */
export interface CuentaTiendaDTO extends OpcionCatalogo {
  esApiKey: boolean;
  activa: boolean;
}

/** Las cinco colecciones del catalogo, cada una en orden determinista (`nombre asc`, R49). */
export interface CatalogoFiltrosOrdenesDTO {
  zonas: OpcionCatalogo[];
  tiendas: CuentaTiendaDTO[];
  provincias: OpcionCatalogo[];
  /** `padreId` = provinciaId. */
  cantones: OpcionConPadre[];
  /** `padreId` = cantonId. */
  distritos: OpcionConPadre[];
}

/** R52/R53: sin sesion -> `unauthenticated`; rol ajeno al listado -> `forbidden`, sin datos. */
export type ObtenerCatalogoFiltrosOrdenesResult =
  | { status: "ok"; catalogo: CatalogoFiltrosOrdenesDTO }
  | { status: "unauthenticated" }
  | { status: "forbidden" };
