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

/**
 * La CADENA GEOGRAFICA sola (provincias + cantones + distritos), que es la parte del
 * catalogo que se puede servir ACOTADA a una zona. Existe porque el adminSatelite recibe
 * la geografia de SU zona y nada mas: sin este tipo, el repositorio tendria que devolver
 * tres listas sueltas y el service volveria a componerlas en el mismo orden en dos sitios.
 */
export interface GeografiaFiltrosDTO {
  provincias: OpcionCatalogo[];
  /** `padreId` = provinciaId. */
  cantones: OpcionConPadre[];
  /** `padreId` = cantonId. */
  distritos: OpcionConPadre[];
}

/**
 * Mensajero ofrecido por el filtro de MENSAJERO ASIGNADO (pedido humano 2026-08-25).
 *
 * Lleva su `zonaId` porque el control se encadena a la ZONA igual que el canton se encadena
 * a la provincia (`dependsOn`): elegida una zona, el desplegable solo ofrece a los mensajeros
 * de esa zona. Es NULLABLE en la tabla (`usuario.zona_id`, feature 24/R6) y por eso lo es
 * aqui: un mensajero sin zona asignada existe, y el cliente decide que hacer con el.
 *
 * Se incluyen los mensajeros INACTIVOS a proposito, por la MISMA razon que las cuentas tienda
 * inactivas: siguen siendo el mensajero asignado de ordenes historicas, y excluirlos haria
 * imposible filtrar esas ordenes por quien las llevo.
 */
export interface MensajeroFiltroDTO extends OpcionCatalogo {
  zonaId: string | null;
}

/** Las colecciones del catalogo, cada una en orden determinista (`nombre asc`, R49). */
export interface CatalogoFiltrosOrdenesDTO {
  zonas: OpcionCatalogo[];
  tiendas: CuentaTiendaDTO[];
  /** Mensajeros ofrecidos por el filtro de mensajero asignado; vacio si el rol no lo recibe. */
  mensajeros: MensajeroFiltroDTO[];
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
