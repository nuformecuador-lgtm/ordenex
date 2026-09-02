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
import { resolverAlcanceBorradoOrden } from "@/lib/services/alcance-borrado-orden";

// FICHA 320 — BORRADO de una orden propia desde el canal por API key. Logica de negocio pura:
// sin HTTP, sin Prisma, con dobles en los tests.
//
// LAS DOS MITADES DE LA DECISION — Y DESDE LA FICHA 358 SE COMPARTEN LAS DOS:
//   - ESTADO: se comparte desde la 319. `esEstadoEliminable` es la fuente unica, la MISMA que
//     usan `EliminarOrdenService` (que autoriza el borrado en la app) y `OrdenService` (que
//     decide si la pantalla ofrece el boton). Aqui no hay copia, ni `Set` propio, ni `includes`
//     sobre una lista local: si las tres divergieran, el canal aceptaria lo que la app rechaza.
//   - DUEÑO: se comparte desde la 358. Este parrafo decia que la autorizacion NO se compartia
//     «y es la razon de que este servicio exista», porque el de la app cortaba por rol `maestro`
//     y no acotaba por tienda, asi que reusarlo aqui le habria dado a una API key esa capacidad
//     sobre ordenes AJENAS. ESO YA NO ES ASI: el 2026-09-02 el humano abrio el borrado por
//     pantalla a la tienda acotado a lo suyo, y con eso los dos caminos necesitaban la misma
//     frase —«el dueño es `actor.usuarioId`»—. En vez de escribirla dos veces, vive en
//     `resolverAlcanceBorradoOrden` y los dos preguntan alli.
//
// LO QUE **SIGUE** SIENDO DISTINTO, y por lo que este servicio no desaparece: el GRANO (una orden
// contra un lote), los ESTADOS DE SALIDA (404/409 uniformes contra un `conflict` con detalle por
// orden, porque un 404 que distinga delata la existencia de ordenes ajenas) y que aqui el dueño
// es OBLIGATORIO —por este canal no pasa ningun actor «sin frontera», y si pasara se rechaza—.
//
// LO QUE ESTO REVIERTE (dicho, no escondido): la feature «eliminar orden» firmo el 2026-08-27 que
// solo el `maestro` borra. El humano lo revirtio EN PARTE el 2026-08-28 para el canal API, a
// sabiendas: en los cuatro estados eliminables el paquete esta quieto —no esta en ningun cierre
// ni en la ruta de ningun mensajero— y la key identifica al autor. El motivo completo esta en
// `IApiOrdenEliminacionService`. La 358 completo esa reversion llevandola a la pantalla.

/** Subconjunto del repositorio que consume este service (DI por interfaz, no la superficie entera). */
export type EliminacionApiRepo = Pick<
  IOrdenRepository,
  "findParaEliminacionApi" | "softDeleteViaApi"
>;

export class ApiOrdenEliminacionService implements IApiOrdenEliminacionService {
  constructor(private readonly repo: EliminacionApiRepo) {}

  async eliminar(actor: Actor, ordenId: string): Promise<ApiOrdenEliminacionResult> {
    // 0. QUIEN ES EL DUEÑO, preguntado a la fuente unica (ficha 358) en vez de derivarlo aqui
    //    con un `actor.usuarioId` escrito a mano. Este canal EXIGE un actor acotado a una tienda:
    //    «denegado» y «todas» se rechazan los dos con el 404 uniforme del canal.
    //
    //    Que «todas» (el `maestro`) tambien se rechace no es un descuido: por aqui no entra —el
    //    borde autentica por API key y `ApiKeyAuthService` emite siempre rol `apiKey`—, y si
    //    alguien cableara este servicio en otro sitio, un actor sin frontera tendria que elegir
    //    un dueño que nadie le dio. Falla CERRADO, y con el mismo estado que todo lo demas de
    //    este endpoint, para no abrir un canal lateral que distinga casos.
    //
    //    El comportamiento observable NO cambia respecto a la 320: para `apiKey` el dueño sigue
    //    siendo `actor.usuarioId`, y cualquier otro rol ya obtenia `not_found` (su `usuarioId` no
    //    es la `tienda_id` de ninguna orden). Lo que cambia es de donde sale la regla.
    const alcance = resolverAlcanceBorradoOrden(actor);
    if (alcance.alcance !== "propias") return { status: "not_found" };
    const ownerId = alcance.ownerId;

    // 1. Lectura ACOTADA AL OWNER en el `where` (no un `if` posterior). `null` = no existe, ya
    //    borrada o de otra tienda: los tres colapsan en el mismo `not_found` para no filtrar la
    //    existencia de ordenes ajenas.
    const orden = await this.repo.findParaEliminacionApi(ordenId, ownerId);
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
      ownerId,
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
