import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  CatalogoActoresHistorialResult,
  FiltroHistorialAccionInput,
  ListarHistorialAccionesCompletoResult,
  ListarHistorialAccionesResult,
} from "@/lib/types/historial-accion";

/**
 * FICHA 362 (design §4.1) — contrato del servicio de LECTURA del historial de acciones.
 *
 * TRES metodos y ninguno mas, y la ausencia es el diseño: no hay `crear`, `actualizar` ni
 * `borrar`. La escritura del registro NO pasa por un servicio — pasa por `appendAccion`, dentro de
 * la transaccion de quien hace la accion (R9/R13). Un metodo de escritura aqui seria la puerta por
 * la que alguien escribiria auditoria sin la accion que la justifica.
 *
 * La AUTORIZACION vive aqui y solo aqui (`docs/architecture.md`: el repositorio no valida
 * permisos). Se compara contra `ROLES_HISTORIAL_ACCIONES` —maestro-only, Q4 cerrada por el humano
 * el 2026-09-02—, la MISMA constante que leen el item de menu y el gate de la ruta.
 */
export interface IHistorialAccionService {
  /** Una pagina del listado. `forbidden` NO ejecuta ninguna consulta (R18). */
  listar(input: unknown, actor: Actor | null): Promise<ListarHistorialAccionesResult>;
  /**
   * El conjunto ENTERO para la descarga, con el MISMO filtro, el MISMO orden y —sobre todo— el
   * MISMO gate por rol que la pantalla (R30/R33). Superar el tope no trunca: responde
   * `limite_excedido`, que es un error accionable.
   */
  listarCompleto(
    input: unknown,
    actor: Actor | null,
  ): Promise<ListarHistorialAccionesCompletoResult>;
  /** Los actores que aparecen en el registro, para el selector de filtros. Mismo gate. */
  obtenerCatalogoActores(actor: Actor | null): Promise<CatalogoActoresHistorialResult>;
}

/** Reexport para que la accion no tenga que importar dos modulos por lo mismo. */
export type { FiltroHistorialAccionInput };
