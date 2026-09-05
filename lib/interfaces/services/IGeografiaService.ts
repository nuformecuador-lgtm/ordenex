import type { Actor } from "@/lib/interfaces/services/IVehiculoService";
import type {
  CambiarActivacionGeograficaInput,
  CrearNodoGeograficoInput,
  NivelGeografico,
  NodoGeograficoInput,
  ProvinciaArbolDTO,
} from "@/lib/types/geografia-nodo";

// FICHA 374 (design §5.2) — el contrato del servicio que administra el catalogo geografico.
//
// `Actor` se IMPORTA de `IVehiculoService` y no se redeclara: es el mismo objeto de sesion
// (`usuarioId` + `rol`) que resuelve `resolveActorFromSession`, y dos declaraciones del actor
// serian dos definiciones de «quien puede» que un dia divergen. Es lo que ya hacen los demas
// servicios del catalogo.
//
// `unauthenticated` NO aparece en ningun resultado de aqui: lo resuelve la Server Action ANTES de
// instanciar el servicio (R23), igual que en vehiculos.
//
// ⚠️ NINGUN METODO BORRA NI RENOMBRA (R5/R49). Ver el porque en `IGeoRepository`.

export type ListarArbolGeograficoServiceResult =
  | { status: "ok"; provincias: ProvinciaArbolDTO[] }
  | { status: "forbidden" };

export type CrearNodoGeograficoServiceResult =
  | { status: "ok"; id: string; nivel: NivelGeografico }
  /** El nombre ya existe bajo ese padre, comparado por su forma NORMALIZADA (R17). */
  | { status: "conflict" }
  /** El padre indicado no existe (R14). No se crea ninguna fila. */
  | { status: "not_found" }
  | { status: "forbidden" };

export type CambiarActivacionGeograficaServiceResult =
  | { status: "ok"; nivel: NivelGeografico; id: string; activo: boolean }
  /** El nodo indicado no existe (R22). No se modifica ninguna fila. */
  | { status: "not_found" }
  | { status: "forbidden" };

export type ContarOrdenesSinEntregarServiceResult =
  | { status: "ok"; ordenes: number }
  | { status: "not_found" }
  | { status: "forbidden" };

export interface IGeografiaService {
  /** El arbol COMPLETO, activos e inactivos (R26). Solo `maestro`. */
  listarArbol(actor: Actor): Promise<ListarArbolGeograficoServiceResult>;

  /**
   * Alta de un nodo en cualquiera de los tres niveles (R12). El nodo nace ACTIVO (R13), incluso
   * si su padre esta retirado: en ese caso su flag propio es `true` y su disponibilidad efectiva
   * es falsa (R15). No es una inconsistencia, es la cascada evaluandose.
   */
  crear(
    input: CrearNodoGeograficoInput,
    actor: Actor,
  ): Promise<CrearNodoGeograficoServiceResult>;

  /**
   * Desactiva o reactiva UN nodo (R20). Escribe el flag de ESA SOLA FILA y NO toca a ningun
   * descendiente (R8): por eso reactivar devuelve el arbol exactamente como estaba (R9).
   *
   * Pedir el estado en el que el nodo ya esta devuelve `ok` sin escribir nada (R21/R53).
   */
  cambiarActivacion(
    input: CambiarActivacionGeograficaInput,
    actor: Actor,
  ): Promise<CambiarActivacionGeograficaServiceResult>;

  /**
   * SOLO LECTURA — cuantas ordenes SIN ENTREGAR cuelgan del nodo (R60). Alimenta la confirmacion
   * de desactivar y no condiciona la operacion: si falla, la pantalla lo dice y no bloquea (R62).
   */
  contarOrdenesSinEntregar(
    input: NodoGeograficoInput,
    actor: Actor,
  ): Promise<ContarOrdenesSinEntregarServiceResult>;
}
