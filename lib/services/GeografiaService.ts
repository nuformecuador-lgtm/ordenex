import type { IGeoRepository } from "@/lib/interfaces/repositories/IGeoRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IVehiculoService";
import type {
  CambiarActivacionGeograficaServiceResult,
  ContarOrdenesSinEntregarServiceResult,
  CrearNodoGeograficoServiceResult,
  IGeografiaService,
  ListarArbolGeograficoServiceResult,
  RenombrarNodoGeograficoServiceResult,
} from "@/lib/interfaces/services/IGeografiaService";
import type {
  CambiarActivacionGeograficaInput,
  CrearNodoGeograficoInput,
  NodoGeograficoInput,
  RenombrarNodoGeograficoInput,
} from "@/lib/types/geografia-nodo";
import { padreDeAlta } from "@/lib/types/geografia-nodo";
import { rechazoDeNombreDeEtiqueta } from "@/lib/utils/nombre-imprimible-etiqueta";
import { normalizeName } from "@/lib/utils/normalize";

// FICHA 374 (design §5.2) — la administracion del catalogo geografico.
//
// Autz: SOLO `maestro`, la misma puerta que el resto de /configuracion. Lectura y escritura
// comparten conjunto: quien ve el catalogo es quien lo administra, y abrir la lectura a mas roles
// seria una decision de producto aparte. La ausencia de sesion (`unauthenticated`) se resuelve
// antes, en la Server Action (R23).
const READ_ROLES = new Set<string>(["maestro"]);
const WRITE_ROLES = new Set<string>(["maestro"]);

/**
 * El SEGUNDO repositorio, por `Pick` de la interfaz de ordenes — patron de
 * `CorregirDatosClienteRepo`.
 *
 * POR QUE ENTRA UN REPOSITORIO DE ORDENES EN UN SERVICIO DE GEOGRAFIA: el conteo de R60 es una
 * lectura de ORDENES y vive donde viven las ordenes. Traerlo aqui por `Pick` deja el acoplamiento
 * escrito y acotado a UN metodo.
 *
 * ⚠️ Un servicio que lo recibe `undefined` COMPILA IGUAL y muere en produccion. Por eso hay un
 * test que comprueba que el composition root lo PASA, no solo que lo importa.
 */
export type GeografiaOrdenesRepo = Pick<IOrdenRepository, "contarSinEntregarPorNodoGeografico">;

export class GeografiaService implements IGeografiaService {
  constructor(
    private readonly repo: IGeoRepository,
    private readonly ordenes: GeografiaOrdenesRepo,
  ) {}

  async listarArbol(actor: Actor): Promise<ListarArbolGeograficoServiceResult> {
    if (!READ_ROLES.has(actor.rol)) return { status: "forbidden" };
    return { status: "ok", provincias: await this.repo.listArbol() };
  }

  /**
   * El alta, en los cuatro pasos donde vive TODA la regla:
   *
   *   1. el rol, ANTES de tocar la base (R24);
   *   2. `findHermanos` — UNA consulta que resuelve las DOS preguntas: `null` significa «el padre
   *      no existe» (R14), y la lista es contra la que se compara el nombre;
   *   3. la comparacion por `normalizeName` (R17). ⚠️ AQUI ESTA LA DIFERENCIA CON VEHICULOS: alli
   *      basta el `trim` + colapso porque el UNIQUE compara literales. Aqui el UNIQUE literal NO
   *      BASTA, porque `resolveGeo` indexa por `normalizeName` —minusculas Y sin acentos—, asi que
   *      «San José» y «San Jose» serian dos filas legales para la base y UNA SOLA COSA AMBIGUA
   *      para la carga masiva: a partir de ahi toda fila que las mencione muere con «distrito
   *      ambiguo en el canton». La base sigue siendo la ultima palabra ante una carrera (R18);
   *   4. el alta, con el nombre recortado y colapsado (R16) pero con SUS mayusculas y SUS acentos.
   *
   * Se comparan los hermanos EN MEMORIA —como mucho 123 filas, el canton mas grande del pais— en
   * vez de con un `findFirst({ where: { nombre } })`, que compararia literales y dejaria pasar
   * justo el caso que esto viene a impedir.
   *
   * Un hermano INACTIVO tambien produce `conflict`: el nombre sigue ocupado para el UNIQUE, y
   * reactivar el viejo despues chocaria con el nuevo.
   */
  async crear(
    input: CrearNodoGeograficoInput,
    actor: Actor,
  ): Promise<CrearNodoGeograficoServiceResult> {
    if (!WRITE_ROLES.has(actor.rol)) return { status: "forbidden" };

    // ⭑ FICHA 392 — el nombre de este nodo SE IMPRIME en la etiqueta (`geografiaLegible` lo une
    // en el dato `ubicacion`), asi que uno que la fuente no cubra tumba el LOTE ENTERO de un
    // golpe. Va ANTES de la primera consulta y por tanto muy antes de escribir: si se rechaza,
    // no se ha leido ni se ha tocado nada.
    const rechazo = rechazoDeNombreDeEtiqueta(input.nombre);
    if (rechazo) return { status: "validation_error", fieldErrors: rechazo };

    const padreId = padreDeAlta(input);
    const hermanos = await this.repo.findHermanos(input.nivel, padreId);
    if (hermanos === null) return { status: "not_found" }; // R14: el padre no existe

    const clave = normalizeName(input.nombre);
    if (hermanos.some((h) => normalizeName(h.nombre) === clave)) {
      return { status: "conflict" }; // R17
    }

    const id = await this.repo.crear(input.nivel, input.nombre, padreId);
    return { status: "ok", id, nivel: input.nivel };
  }

  /**
   * Desactivar o reactivar UN nodo. Los tres desenlaces del repositorio se traducen aqui:
   *
   *   `no_existe`  -> `not_found` (R22), sin escrituras;
   *   `sin_cambio` -> `ok` con el estado pedido (R21): pedir lo que ya esta es exito, y no ha
   *                   escrito ni el `update` ni la fila de registro (R53);
   *   `cambiado`   -> `ok`, y esa es la unica rama que audita (R51/R52).
   */
  async cambiarActivacion(
    input: CambiarActivacionGeograficaInput,
    actor: Actor,
  ): Promise<CambiarActivacionGeograficaServiceResult> {
    if (!WRITE_ROLES.has(actor.rol)) return { status: "forbidden" };

    const desenlace = await this.repo.cambiarActivacion(
      input.nivel,
      input.id,
      input.activo,
      actor.usuarioId,
    );
    if (desenlace === "no_existe") return { status: "not_found" };
    return { status: "ok", nivel: input.nivel, id: input.id, activo: input.activo };
  }

  /**
   * FICHA 375 — el renombrado, en los cuatro pasos donde vive TODA la regla:
   *
   *   1. el rol, ANTES de tocar la base;
   *   2. `findHermanosDeNodo` — UNA consulta que resuelve las DOS preguntas: `null` significa «el
   *      nodo no existe» (`not_found`), y la lista es contra la que se compara el nombre nuevo;
   *   3. la comparacion por `normalizeName`, EXCLUYENDO AL PROPIO NODO. Las dos mitades importan:
   *        - se excluye el nodo porque renombrarlo a su propio nombre —o a una variante que se
   *          normaliza igual, «san jose» -> «San José»— NO es un conflicto: guardar sin cambios
   *          tiene que seguir funcionando;
   *        - se compara NORMALIZADO, y no literal, por lo mismo que el alta: el UNIQUE de la base
   *          compara literales, pero `resolveGeo` indexa por `normalizeName` —minusculas Y sin
   *          acentos—, asi que «San José» y «San Jose» serian dos filas legales para la base y UNA
   *          SOLA COSA AMBIGUA para la carga masiva. Es exactamente el defecto que esta ficha viene
   *          a cerrar: no puede introducirlo por la puerta de al lado;
   *   4. el renombrado, con el nombre recortado y colapsado pero con SUS mayusculas y SUS acentos.
   *
   * Se reusa `normalizeName` —la MISMA funcion con la que indexa la carga masiva— en vez de
   * declarar una segunda normalizacion: dos claves son dos reglas que un dia divergen, y la que
   * divergiera dejaria entrar el duplicado ambiguo sin romper ningun test.
   */
  async renombrar(
    input: RenombrarNodoGeograficoInput,
    actor: Actor,
  ): Promise<RenombrarNodoGeograficoServiceResult> {
    if (!WRITE_ROLES.has(actor.rol)) return { status: "forbidden" };

    // ⭑ FICHA 392 — el renombrado es LA puerta que abrio la 375, y por aqui entra el mismo
    // caracter que la 383 cerro por el lado de la orden. Se comprueba ANTES de leer los hermanos:
    // un nombre que no se puede imprimir no llega a competir por el UNIQUE.
    const rechazo = rechazoDeNombreDeEtiqueta(input.nombre);
    if (rechazo) return { status: "validation_error", fieldErrors: rechazo };

    const hermanos = await this.repo.findHermanosDeNodo(input.nivel, input.id);
    if (hermanos === null) return { status: "not_found" };

    const clave = normalizeName(input.nombre);
    const chocaConOtro = hermanos.some(
      (h) => h.id !== input.id && normalizeName(h.nombre) === clave,
    );
    if (chocaConOtro) return { status: "conflict" };

    const desenlace = await this.repo.renombrar(
      input.nivel,
      input.id,
      input.nombre,
      actor.usuarioId,
    );
    // `no_existe` solo puede llegar aqui por una carrera: el nodo estaba al leer los hermanos y ya
    // no esta al escribir. Se traduce igual que arriba en vez de inventar un desenlace nuevo.
    if (desenlace === "no_existe") return { status: "not_found" };
    return { status: "ok", nivel: input.nivel, id: input.id, nombre: input.nombre };
  }

  /**
   * SOLO LECTURA (R60). No comprueba antes que el nodo exista con una consulta aparte: un nodo
   * inexistente cuelga de cero ordenes, y el conteo lo dice sin pagar un viaje mas. La
   * confirmacion usa el numero para INFORMAR, no para decidir si la operacion procede.
   */
  async contarOrdenesSinEntregar(
    input: NodoGeograficoInput,
    actor: Actor,
  ): Promise<ContarOrdenesSinEntregarServiceResult> {
    if (!READ_ROLES.has(actor.rol)) return { status: "forbidden" };
    const ordenes = await this.ordenes.contarSinEntregarPorNodoGeografico(input.nivel, input.id);
    return { status: "ok", ordenes };
  }
}
