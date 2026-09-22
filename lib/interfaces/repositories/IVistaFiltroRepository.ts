import type { VistaFiltroPayload } from "@/lib/types/vista-filtro";

// FICHA 453 (design §6, T1.5) — contrato del repositorio de LAS VISTAS DE FILTROS.
//
// SOLO queries Prisma (docs/architecture.md): aqui no hay ninguna regla de negocio. El tope, las
// reglas del nombre, «no hay nada que guardar» y la lectura defensiva del documento viven en
// `VistaFiltroService`.
//
// ⚠️ `usuarioId` VIAJA EN TODAS LAS FIRMAS, INCLUIDAS LAS QUE YA LLEVAN `id`. No es redundancia: es
// lo que hace que la propiedad (R2) sea parte del **`WHERE`** y no de una comprobacion previa que
// alguien pueda saltarse en la siguiente llamada. Un `findFirst` de dueño seguido de un `update`
// por `id` deja abierta la rendija entre las dos consultas y, sobre todo, deja la escritura
// escribiendo por `id` a secas: la siguiente persona que añada un metodo copiara ESA forma.
//
// ⚠️ Y POR ESO SU TEST CORRE CONTRA POSTGRES REAL. Un doble no ve el `WHERE`: en este repo una
// mutacion del `WHERE` paso en verde cuatro veces seguidas con tests de servicio.

/** Una fila tal y como esta guardada. El documento NO se interpreta aqui (R8: eso es del servicio). */
export interface VistaFiltroFila {
  id: string;
  usuarioId: string;
  superficie: string;
  nombre: string;
  /** El JSONB crudo. `unknown` a proposito: quien lo lee TIENE que validarlo antes de usarlo. */
  filtro: unknown;
  version: number;
  actualizadaEn: Date;
}

/**
 * R11 — el nombre duplicado lo detecta EL INDICE UNICO, no una comprobacion previa. El servicio
 * tambien pregunta antes (para poder nombrar el conflicto), pero entre esa pregunta y la escritura
 * cabe otra pestaña: esta rama es la que cierra esa rendija.
 */
export type CreacionVista =
  | { estado: "creada"; fila: VistaFiltroFila }
  | { estado: "nombre_en_uso" };

/**
 * `sin_coincidencia` = el `WHERE` (id + dueño) no caso con ninguna fila: o no existe, o NO ES SUYA.
 * Las dos cosas responden lo mismo a proposito (design §5): distinguirlas confirmaria que ese id
 * existe y es de otra persona, que es una filtracion gratuita sobre un recurso personal.
 */
export type EscrituraVista =
  | { estado: "actualizada"; fila: VistaFiltroFila }
  | { estado: "sin_coincidencia" }
  | { estado: "nombre_en_uso" };

export interface IVistaFiltroRepository {
  /**
   * Las vistas de ESTA persona en ESTA superficie, ordenadas por nombre.
   *
   * El orden es parte del contrato porque es gratis: `(usuario_id, superficie, nombre)` es el
   * indice, asi que ordenar por nombre no cuesta una sola lectura mas.
   */
  listar(usuarioId: string, superficie: string): Promise<VistaFiltroFila[]>;

  /** Cuantas tiene ya. Lo usa el tope (R13), que lo impone el servicio y no la base. */
  contar(usuarioId: string, superficie: string): Promise<number>;

  crear(
    usuarioId: string,
    superficie: string,
    nombre: string,
    filtro: VistaFiltroPayload,
    version: number,
  ): Promise<CreacionVista>;

  /** R14 — renombra SOLO si la fila es de esta persona. El dueño va en el `WHERE`. */
  renombrar(id: string, usuarioId: string, nombre: string): Promise<EscrituraVista>;

  /** R15 — reemplaza el documento guardado y CONSERVA el nombre. El dueño va en el `WHERE`. */
  actualizarFiltro(
    id: string,
    usuarioId: string,
    filtro: VistaFiltroPayload,
    version: number,
  ): Promise<EscrituraVista>;

  /** Filas borradas: `0` si no era suya (o no existia), `1` si se borro. El dueño va en el `WHERE`. */
  eliminar(id: string, usuarioId: string): Promise<number>;
}
