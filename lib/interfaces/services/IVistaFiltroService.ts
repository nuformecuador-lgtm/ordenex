import type {
  EliminarVistaFiltroResult,
  ListarVistasFiltroResult,
  SuperficieVista,
  VistaFiltroPayload,
  VistaFiltroResult,
} from "@/lib/types/vista-filtro";

// FICHA 453 (design §6, T2.1) — contrato del servicio de LAS VISTAS DE FILTROS: las reglas.
//
// Aqui viven la propiedad (R2), el tope (R13), las reglas del nombre (R9/R10/R11), «no hay nada que
// guardar» (R12) y la lectura defensiva del documento (R8). Nada de HTTP, nada de cookies, nada de
// Prisma: el repositorio entra por constructor.
//
// ⚠️ NO HAY NINGUNA OPERACION DE «APLICAR», Y ESO ES EL DISEÑO (R16). Aplicar una vista no escribe
// nada, y la forma mas barata de garantizarlo es que no exista el metodo con el que se podria
// escribir. Solo guardar, actualizar, renombrar y borrar tocan la base.
//
// ⚠️ `usuarioId` ES SIEMPRE EL PRIMER PARAMETRO Y SALE DE LA SESION (R3). No es parte de la entrada
// del borde: los schemas son `.strict()` y uno inyectado da `validation_error`.

export interface GuardarVistaFiltroInput {
  superficie: SuperficieVista;
  nombre: string;
  filtro: VistaFiltroPayload;
}

export interface RenombrarVistaFiltroInput {
  id: string;
  nombre: string;
}

export interface ActualizarVistaFiltroInput {
  id: string;
  filtro: VistaFiltroPayload;
}

export interface IVistaFiltroService {
  /**
   * Las vistas de esta persona en esta superficie, por nombre.
   *
   * R8 — cada documento se valida AL LEER: uno que no parsea sale con `filtro: null` (ilegible) y
   * la vista sigue apareciendo, para poder renombrarla o borrarla. Nunca se devuelve a medias.
   */
  listar(usuarioId: string, superficie: SuperficieVista): Promise<ListarVistasFiltroResult>;

  /** R9–R13 — nombre, «nada que guardar», tope y duplicado. */
  guardar(usuarioId: string, input: GuardarVistaFiltroInput): Promise<VistaFiltroResult>;

  /** R14 — renombrar, con las mismas reglas de nombre de R9–R11. */
  renombrar(usuarioId: string, input: RenombrarVistaFiltroInput): Promise<VistaFiltroResult>;

  /** R15 — reemplaza el filtro guardado, conserva el nombre y aplica R12. */
  actualizar(usuarioId: string, input: ActualizarVistaFiltroInput): Promise<VistaFiltroResult>;

  /** Borra la vista de ESTA persona. Una ajena responde `not_found`, no `forbidden`. */
  eliminar(usuarioId: string, id: string): Promise<EliminarVistaFiltroResult>;
}
