// Feature 321 (T3.6, design §2.5) — servicio del HISTORICO de conversaciones.
//
// AQUI VIVE LA AUTORIZACION, y solo aqui (`docs/architecture.md`: el repositorio no valida
// permisos). Se compara contra `ROLES_HISTORICO_CONVERSACIONES`, la MISMA constante que consume
// el `roles` del item de menu y el gate de la ruta, de modo que las tres capas no pueden
// divergir (R8). Un rol que no esta en esa lista recibe `forbidden` y el repositorio NO se
// llama: el test lo afirma con `not.toHaveBeenCalled()`, que es lo que distingue «no ve nada»
// de «consulta y luego filtra».
//
// LO QUE EL SERVICIO NO HACE, y es deliberado:
//
// - NO acota por mensajero asignado (R10). El `mensajeroId` que viaja en la entrada de mensajes
//   es PARTE DE LA CLAVE DEL HILO (R42), no un scope de sesion; si el servicio lo cruzara con
//   `actor.usuarioId`, el histórico dejaria de ser el histórico.
// - NO escribe NADA (R25). No hay un solo camino desde aqui hasta un `update`: el repositorio
//   recibe un cliente Prisma acotado por tipo a `$queryRaw`. En particular NO se toca
//   `chat_conversacion.mensajero_leido_at`: abrir un hilo desde el histórico no consume los no
//   leidos del mensajero, que es de quien es ese contador.
// - NO recorta el hilo por fecha (R17). Ni siquiera puede: `listarMensajesHistoricoSchema` es
//   `.strict()` y no declara claves de fecha, asi que un `fecha_desde` en esa entrada es
//   `validation_error`, no una clave ignorada en silencio.
import type { RolValue } from "@prisma/client";

import { ROLES_HISTORICO_CONVERSACIONES } from "@/lib/auth/menu-visibility";
import type { IHistoricoConversacionesRepository } from "@/lib/interfaces/repositories/IHistoricoConversacionesRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IHistoricoConversacionesService } from "@/lib/interfaces/services/IHistoricoConversacionesService";
import {
  HILOS_LIMITE_DEFECTO,
  MENSAJES_LIMITE_DEFECTO,
  listarHilosHistoricoSchema,
  listarMensajesHistoricoSchema,
  type ListarHilosHistoricoInput,
  type ListarHilosHistoricoResult,
  type ListarMensajesHistoricoInput,
  type ListarMensajesHistoricoResult,
} from "@/lib/types/historico-conversaciones";

/**
 * `ROLES_HISTORICO_CONVERSACIONES` es una tupla de literales y su `.includes` solo acepta esos
 * literales. Se ensancha el tipo del ARRAY (nunca el de `actor.rol`) en este unico punto, igual
 * que hacen la analitica y la pagina de la ruta.
 */
const ROLES_CON_ACCESO: readonly RolValue[] = ROLES_HISTORICO_CONVERSACIONES;

/** El primer problema del borde, en texto corto y sin ecoar el valor recibido. */
function motivoDe(error: { issues: { path: PropertyKey[]; message: string }[] }): string {
  const primero = error.issues[0];
  if (primero === undefined) return "Entrada invalida";
  const ruta = primero.path.map(String).join(".");
  return ruta === "" ? primero.message : `${ruta}: ${primero.message}`;
}

export class HistoricoConversacionesService implements IHistoricoConversacionesService {
  constructor(private readonly repo: IHistoricoConversacionesRepository) {}

  async listarHilos(
    input: ListarHilosHistoricoInput,
    actor: Actor | null,
  ): Promise<ListarHilosHistoricoResult> {
    if (actor === null) return { status: "unauthenticated" };
    if (!ROLES_CON_ACCESO.includes(actor.rol)) return { status: "forbidden" };

    // R38 — el borde vuelve a validar AQUI aunque la Server Action ya lo hiciera. No es
    // duplicacion ociosa: el servicio se instancia tambien desde tests y desde cualquier
    // llamante futuro, y la garantia «ninguna consulta con entrada invalida» tiene que ser del
    // servicio, no del unico llamante que hoy existe.
    const parsed = listarHilosHistoricoSchema.safeParse(input);
    if (!parsed.success) return { status: "validation_error", motivo: motivoDe(parsed.error) };

    const { filtro, cursor, limite } = parsed.data;
    const pagina = await this.repo.listarHilos({
      filtro: filtro ?? {},
      cursor: cursor ?? null,
      limite: limite ?? HILOS_LIMITE_DEFECTO,
    });

    // R41 — la respuesta del listado no lleva ni un mensaje, y no puede llevarlo: el DTO no
    // declara donde ponerlos. Aqui solo se propaga lo que el repositorio devolvio.
    return { status: "ok", items: pagina.items, siguiente: pagina.siguiente };
  }

  async listarMensajes(
    input: ListarMensajesHistoricoInput,
    actor: Actor | null,
  ): Promise<ListarMensajesHistoricoResult> {
    if (actor === null) return { status: "unauthenticated" };
    if (!ROLES_CON_ACCESO.includes(actor.rol)) return { status: "forbidden" };

    const parsed = listarMensajesHistoricoSchema.safeParse(input);
    if (!parsed.success) return { status: "validation_error", motivo: motivoDe(parsed.error) };

    const { ordenId, mensajeroId, cursor, limite } = parsed.data;

    // La cabecera se pide PRIMERO porque es la que decide si el hilo existe: un par
    // `(orden, mensajero)` inventado —o cuya orden esta borrada (R12)— es `not_found`, no una
    // pagina vacia. La diferencia importa: «no hay nada que ver» y «no existe» no son lo mismo
    // para quien lee, y una pagina vacia de un hilo inexistente invitaria a seguir paginando.
    const cabecera = await this.repo.obtenerCabecera(ordenId, mensajeroId);
    if (cabecera === null) return { status: "not_found" };

    const pagina = await this.repo.listarMensajes({
      ordenId,
      mensajeroId,
      cursor: cursor ?? null,
      limite: limite ?? MENSAJES_LIMITE_DEFECTO,
    });

    return {
      status: "ok",
      mensajes: pagina.mensajes,
      anterior: pagina.anterior,
      cabecera,
    };
  }
}
