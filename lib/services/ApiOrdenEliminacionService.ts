import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type {
  ApiOrdenEliminacionResult,
  IApiOrdenEliminacionService,
} from "@/lib/interfaces/services/IApiOrdenEliminacionService";
import {
  ESTADOS_ELIMINABLES,
  esEstadoEliminable,
} from "@/lib/types/order-status-eliminables";

// FICHA 320 — BORRADO de una orden propia desde el canal por API key. Logica de negocio pura:
// sin HTTP, sin Prisma, con dobles en los tests.
//
// LAS DOS MITADES DE LA DECISION, y por que solo UNA se comparte con la app:
//   - ESTADO: se comparte. `esEstadoEliminable` es la fuente unica de la ficha 319, la MISMA que
//     usan `EliminarOrdenService` (que autoriza el borrado en la app) y `OrdenService` (que
//     decide si la pantalla ofrece el boton). Aqui no hay copia, ni `Set` propio, ni `includes`
//     sobre una lista local: si las tres divergieran, el canal aceptaria lo que la app rechaza.
//   - AUTORIZACION: NO se comparte, y es la razon de que este servicio exista. El de la app corta
//     por ROL (`maestro`) y no acota por tienda, porque el maestro puede borrar cualquier orden.
//     Reusarlo aqui le daria a una API key esa misma capacidad sobre ordenes AJENAS. La frontera
//     de este canal es el DUEÑO, y se aplica donde no se puede saltar: dentro del `where` de las
//     dos sentencias del repositorio.
//
// LO QUE ESTO REVIERTE (dicho, no escondido): la feature «eliminar orden» firmo el 2026-08-27 que
// solo el `maestro` borra. El humano lo revirtio EN PARTE el 2026-08-28 para el canal API, a
// sabiendas: en los cuatro estados eliminables el paquete esta quieto —no esta en ningun cierre
// ni en la ruta de ningun mensajero— y la key identifica al autor. El motivo completo esta en
// `IApiOrdenEliminacionService`.

/** Subconjunto del repositorio que consume este service (DI por interfaz, no la superficie entera). */
export type EliminacionApiRepo = Pick<
  IOrdenRepository,
  "findParaEliminacionApi" | "softDeleteViaApi"
>;

export class ApiOrdenEliminacionService implements IApiOrdenEliminacionService {
  constructor(private readonly repo: EliminacionApiRepo) {}

  async eliminar(actor: Actor, ordenId: string): Promise<ApiOrdenEliminacionResult> {
    // 1. Lectura ACOTADA AL OWNER en el `where` (no un `if` posterior). `null` = no existe, ya
    //    borrada o de otra tienda: los tres colapsan en el mismo `not_found` para no filtrar la
    //    existencia de ordenes ajenas.
    const orden = await this.repo.findParaEliminacionApi(ordenId, actor.usuarioId);
    if (!orden) return { status: "not_found" };

    // 2. EL PREDICADO DE ESTADO, compartido con la app palabra por palabra.
    if (!esEstadoEliminable(orden.estatusValue)) return { status: "conflict" };

    // 3. Escritura que vuelve a exigirlo TODO —id, dueño, viva y estado permitido— en la misma
    //    sentencia. La lista viaja desde la fuente unica: el repositorio no decide que estados
    //    son borrables, solo aplica el filtro que recibe. `0` = la orden dejo de cumplir alguna
    //    condicion entre la lectura y el UPDATE (otra sesion la borro, o cambio de estado): es
    //    una carrera benigna y se responde el mismo `not_found`, sin haber borrado nada.
    const eliminadas = await this.repo.softDeleteViaApi({
      ordenId: orden.id,
      ownerId: actor.usuarioId,
      estadosPermitidos: ESTADOS_ELIMINABLES,
    });
    if (eliminadas === 0) return { status: "not_found" };

    return {
      status: "ok",
      data: {
        numGuia: orden.numGuia,
        numRemision: orden.numRemision,
        estado: orden.estatusValue,
      },
    };
  }
}
