import type {
  IOrdenNotaRepository,
  OrdenNotaRow,
  OrdenParaHilo,
} from "@/lib/interfaces/repositories/IOrdenNotaRepository";
import type { IOrdenNotaService } from "@/lib/interfaces/services/IOrdenNotaService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  BorrarNotaInput,
  BorrarNotaServiceResult,
  ListarNotasInput,
  ListarNotasServiceResult,
  OrdenNotaDTO,
  PublicarNotaInput,
  PublicarNotaServiceResult,
} from "@/lib/types/orden-nota";
import {
  esRolConHilo,
  estaEnVentanaDeEscritura,
  type RolConHilo,
} from "@/lib/types/ventana-hilo-notas";

/**
 * Feature 227 (T2.6, design §2.2) — logica de negocio del HILO de notas por orden.
 *
 * Recibe el repositorio por constructor (DI por interfaz): no importa Prisma, ni `next/headers`,
 * ni nada de HTTP, y se construye entero con dobles. Es la UNICA capa que autoriza: la tabla
 * lleva RLS habilitada SIN policies (R26), asi que aqui no hay red de seguridad debajo.
 *
 * Lo que este archivo NO hace, y es deliberado: no lee ni escribe `orden.notas`, la nota de la
 * TIENDA (R25). Son dos cosas distintas que solo se parecen en el nombre.
 */
export class OrdenNotaService implements IOrdenNotaService {
  constructor(private readonly repo: IOrdenNotaRepository) {}

  async listar(input: ListarNotasInput, actor: Actor): Promise<ListarNotasServiceResult> {
    const acceso = await this.autorizar(input.ordenId, actor);
    if (!acceso.ok) return { status: "forbidden" };

    // R15: la lectura NO aplica ventana. La novedad acota la escritura, no la lectura: un hilo
    // escrito mientras la orden estaba `devuelta` se sigue leyendo entero cuando la orden ya
    // esta en `en_reparto` o en un estatus terminal.
    //
    // R28: UNA sola llamada de lectura del hilo (el repo la resuelve en una consulta con el
    // indice `(orden_id, created_at)`), nunca una por nota. La llamada anterior es la de
    // AUTORIZACION, que es otra cosa y sucede una sola vez por operacion.
    const filas = await this.repo.listarPorOrden(input.ordenId);

    return {
      status: "ok",
      notas: filas.map((fila) => proyectarNota(fila, actor.usuarioId)),
      // R19/R14: «el actor esta dentro de SU ventana», no «la orden esta en devuelta». La UI no
      // re-deriva la regla: pinta compositor y controles de borrado segun este booleano.
      puedeEscribir: estaEnVentanaDeEscritura(acceso.rol, acceso.orden.estatusValue, acceso.orden.ayuda),
    };
  }

  async publicar(input: PublicarNotaInput, actor: Actor): Promise<PublicarNotaServiceResult> {
    const acceso = await this.autorizar(input.ordenId, actor);
    if (!acceso.ok) return { status: "forbidden" };

    // R14/D1: ventana ASIMETRICA por rol. `adminTienda` solo en `devuelta`, `mensajero` solo en
    // `en_reparto`. Fuera de SU ventana el actor no publica, aunque el otro rol si este dentro
    // de la suya. Fuera de ambas (`entregada`, `reprogramada`, `rechazada`, ...) no publica
    // nadie. Un `forbidden` opaco: el borde no dice por que (R10).
    if (!estaEnVentanaDeEscritura(acceso.rol, acceso.orden.estatusValue, acceso.orden.ayuda)) {
      return { status: "forbidden" };
    }

    // R6: un cuerpo que queda VACIO al recortar no es una nota. El recorte vive aqui y no en zod
    // porque "   " es un string valido de longitud 3 para el schema (que solo mide el tope, R7,
    // sobre el texto CRUDO) y un no-mensaje para el negocio. Y no se crea NINGUNA fila.
    const cuerpo = input.cuerpo.trim();
    if (cuerpo.length === 0) {
      return { status: "validation_error", fieldErrors: { cuerpo: ["El cuerpo no puede estar vacio."] } };
    }

    // R1/R5: fila NUEVA, sin tocar ninguna previa. El `autorId` y el `rolAutor` salen SIEMPRE
    // del actor autenticado, JAMAS del input: un `autorId` que llegue en la entrada ni siquiera
    // sobrevive al schema, y aqui tampoco tendria por donde entrar. El `rolAutor` se congela
    // ahora (R4): si mañana este usuario cambia de rol, el hilo seguira diciendo con que
    // sombrero se escribio.
    const fila = await this.repo.crear({
      ordenId: input.ordenId,
      autorId: actor.usuarioId,
      rolAutor: acceso.rol,
      cuerpo,
    });

    return { status: "ok", nota: proyectarNota(fila, actor.usuarioId) };
  }

  async borrar(input: BorrarNotaInput, actor: Actor): Promise<BorrarNotaServiceResult> {
    const acceso = await this.autorizar(input.ordenId, actor);
    if (!acceso.ok) return { status: "forbidden" };

    // R35: la ventana de BORRADO es EXACTAMENTE la de escritura del rol. Fuera de ella las
    // notas quedan congeladas para ese actor, incluidas las SUYAS: con la orden en `en_reparto`
    // la tienda ya no puede borrar lo que escribio, y con la orden en `devuelta` el mensajero
    // tampoco. Es lo que convierte el hilo en evidencia y no en un relato editable.
    if (!estaEnVentanaDeEscritura(acceso.rol, acceso.orden.estatusValue, acceso.orden.ayuda)) {
      return { status: "forbidden" };
    }

    // R31/R32: borrado LOGICO con el `autorId` en el WHERE del propio UPDATE. Nadie borra una
    // nota ajena — ni la contraparte del hilo ni `maestro`, que ni siquiera llega hasta aqui
    // (R12/P9: no hay moderacion).
    const marcadas = await this.repo.marcarBorrada(input.notaId, input.ordenId, actor.usuarioId);

    // R33: `count = 0` puede significar que la nota no existe, que es de otro autor, que es de
    // otra orden o que ya estaba borrada. Los cuatro casos devuelven el MISMO resultado tipado y
    // sin efectos: el borde no es un oraculo de existencia.
    return marcadas === 1 ? { status: "ok" } : { status: "forbidden" };
  }

  /**
   * Pasos 1-3 del design §2.2, IDENTICOS para las tres operaciones. Devuelve la orden ya cargada
   * (para no consultarla dos veces) y el rol ESTRECHADO a los dos que tienen hilo.
   *
   * Que sea una sola funcion es el punto: tres copias de la misma secuencia divergen, y la que
   * diverge es la que abre el agujero.
   */
  private async autorizar(
    ordenId: string,
    actor: Actor,
  ): Promise<AccesoAlHilo> {
    return autorizarSobreHilo(this.repo, ordenId, actor);
  }
}

/** Resultado de la autorizacion: la orden ya cargada y el rol ESTRECHADO a los dos con hilo. */
export type AccesoAlHilo =
  | { ok: true; rol: RolConHilo; orden: OrdenParaHilo }
  | { ok: false };

/**
 * Los pasos 1-3 del design §2.2 de la feature 227, como funcion de MODULO.
 *
 * Era un metodo privado y se extrajo (2026-08-18) porque la SOLICITUD DE AYUDA necesita
 * exactamente esta misma puerta —rol con hilo, orden viva, pertenencia— para poder RETIRAR una
 * solicitud, que es una operacion sobre la orden y no sobre el hilo, asi que no puede colarse por
 * `publicar`. La alternativa era una segunda copia de la secuencia en `SolicitudAyudaService`, y
 * el docstring de aqui abajo ya decia por que eso es justo lo que no se hace: «tres copias de la
 * misma secuencia divergen, y la que diverge es la que abre el agujero».
 *
 * Sigue siendo la UNICA implementacion; `OrdenNotaService.autorizar` delega en ella y no cambio
 * ni un paso.
 */
export async function autorizarSobreHilo(
  repo: Pick<IOrdenNotaRepository, "findOrdenParaHilo">,
  ordenId: string,
  actor: Actor,
): Promise<AccesoAlHilo> {
  // 1. R12: solo `adminTienda` y `mensajero`. `maestro`, `admin`, `adminSatelite` y `apiKey`
  //    caen aqui en las TRES operaciones: no hay vista de supervision (decision P8).
  if (!esRolConHilo(actor.rol)) return { ok: false };

  // 2. R10: la orden inexistente y la borrada logicamente producen el MISMO resultado que la
  //    orden ajena. Comprobarlo antes de la pertenencia y devolver lo mismo es lo que impide
  //    usar el borde para averiguar si una guia existe.
  const orden = await repo.findOrdenParaHilo(ordenId);
  if (!orden || orden.deletedAt !== null) return { ok: false };

  // 3. Pertenencia, con el mecanismo que YA usa el modulo de novedades: `orden.tiendaId` es FK
  //    a `usuario`, luego el `usuarioId` del adminTienda ES el identificador de su tienda
  //    (R9). Para el mensajero, `orden.mensajeroAsignadoId` es la unica fuente de verdad desde
  //    la feature 159 (R11). En ambos casos sale del ACTOR, nunca de un dato del input.
  const propietario =
    actor.rol === "adminTienda"
      ? orden.tiendaId === actor.usuarioId
      : orden.mensajeroAsignadoId === actor.usuarioId;
  if (!propietario) return { ok: false };

  return { ok: true, rol: actor.rol, orden };
}

/**
 * R34 — la proyeccion al DTO, AISLADA y pura porque es el unico punto del codigo que puede
 * equivocarse y exponer el texto de una nota borrada.
 *
 * Una fila con `deletedAt !== null` viaja como `{ eliminada: true, cuerpo: "" }` CONSERVANDO su
 * autor, su rol y su hora: el hueco se pinta en su posicion cronologica, con quien lo escribio y
 * cuando (decision P3b: el otro lado ve «nota eliminada», no un silencio). El cuerpo NO cruza el
 * borde; enviarlo y ocultarlo en la UI seria dejarlo a un `view-source` de distancia.
 *
 * `esPropia` se calcula aqui, con el actor, para que el DTO no tenga que publicar `autorId`
 * (R16). `createdAt` sale como ISO-8601 porque un `Date` no cruza la frontera RSC.
 */
export function proyectarNota(fila: OrdenNotaRow, actorUsuarioId: string): OrdenNotaDTO {
  const eliminada = fila.deletedAt !== null;
  return {
    id: fila.id,
    cuerpo: eliminada ? "" : fila.cuerpo,
    autorNombre: fila.autor.nombre,
    rolAutor: fila.rolAutor,
    createdAt: fila.createdAt.toISOString(),
    esPropia: fila.autorId === actorUsuarioId,
    eliminada,
  };
}
