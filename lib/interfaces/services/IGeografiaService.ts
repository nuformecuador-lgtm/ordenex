import type { Actor } from "@/lib/interfaces/services/IVehiculoService";
import type {
  CambiarActivacionGeograficaInput,
  CrearNodoGeograficoInput,
  NivelGeografico,
  NodoGeograficoInput,
  ProvinciaArbolDTO,
  RenombrarNodoGeograficoInput,
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
// ⚠️ NINGUN METODO BORRA (R5): quitar un nodo es DESACTIVARLO. Ver el porque en `IGeoRepository`.
// El RENOMBRADO si existe desde la ficha 375, y solo porque `codigo_dta` le dio al catalogo una
// clave estable: sin ella, renombrar duplicaba el nodo en la siguiente corrida del seed.

export type ListarArbolGeograficoServiceResult =
  | { status: "ok"; provincias: ProvinciaArbolDTO[] }
  | { status: "forbidden" };

export type CrearNodoGeograficoServiceResult =
  | { status: "ok"; id: string; nivel: NivelGeografico }
  /**
   * ⭑ FICHA 392 — el nombre lleva un caracter que la ETIQUETA no puede imprimir.
   *
   * Sale del SERVICIO y no del zod del borde a proposito: la decision de «que es imprimible» se
   * toma con la cobertura de la fuente del PDF, y `lib/types/geografia-nodo.ts` viaja al
   * navegador (mismo criterio que la 383 aplico a `filaCargaSchema`, design §5.1).
   *
   * La forma es la MISMA que ya produce el borde ante un ZodError, asi que la Server Action no
   * cambia una linea y la pantalla lo pinta bajo el campo `nombre` con el codigo que ya tiene.
   */
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
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

export type RenombrarNodoGeograficoServiceResult =
  | { status: "ok"; nivel: NivelGeografico; id: string; nombre: string }
  /**
   * ⭑ FICHA 392 — el nombre NUEVO lleva un caracter que la ETIQUETA no puede imprimir.
   *
   * Esta rama es la que cierra el agujero que abrio la 375: hasta ella el catalogo no se podia
   * renombrar, asi que sus nombres eran los del seed oficial. Desde que se puede renombrar, la
   * unica cosa que separa al catalogo de un caracter no imprimible es esta comprobacion.
   */
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  /** Otro HERMANO ya se llama asi, comparado por su forma NORMALIZADA. Nunca el nodo consigo mismo. */
  | { status: "conflict" }
  /** El nodo indicado no existe. No se modifica ninguna fila. */
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
   * FICHA 375 — cambia el NOMBRE de un nodo. Solo `maestro`.
   *
   * NO toca `codigo_dta`, que es la clave estable: el nombre es una etiqueta y el codigo es la
   * identidad. Esa separacion es lo que hace que el seed no duplique el nodo despues.
   *
   * Renombrarlo a SU PROPIO nombre devuelve `ok` (guardar sin cambios tiene que seguir
   * funcionando); renombrarlo al de un HERMANO devuelve `conflict`, comparado por la clave
   * normalizada —sin mayusculas ni acentos— porque es la que usa `resolveGeo` y el UNIQUE literal
   * de la base dejaria entrar «San Jose» junto a «San José».
   */
  renombrar(
    input: RenombrarNodoGeograficoInput,
    actor: Actor,
  ): Promise<RenombrarNodoGeograficoServiceResult>;

  /**
   * SOLO LECTURA — cuantas ordenes SIN ENTREGAR cuelgan del nodo (R60). Alimenta la confirmacion
   * de desactivar y no condiciona la operacion: si falla, la pantalla lo dice y no bloquea (R62).
   */
  contarOrdenesSinEntregar(
    input: NodoGeograficoInput,
    actor: Actor,
  ): Promise<ContarOrdenesSinEntregarServiceResult>;
}
