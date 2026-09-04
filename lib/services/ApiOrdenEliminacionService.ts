import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type {
  ApiOrdenEliminacionResult,
  IApiOrdenEliminacionService,
} from "@/lib/interfaces/services/IApiOrdenEliminacionService";
import type { IOrdenHistorialService } from "@/lib/interfaces/services/IOrdenHistorialService";
import {
  ESTADOS_ELIMINABLES,
  esOrdenEliminable,
} from "@/lib/types/order-status-eliminables";
import { resolverAlcanceBorradoOrden } from "@/lib/services/alcance-borrado-orden";

// FICHA 320 — BORRADO de una orden propia desde el canal por API key. Logica de negocio pura:
// sin HTTP, sin Prisma, con dobles en los tests.
//
// LAS DOS MITADES DE LA DECISION — Y DESDE LA FICHA 358 SE COMPARTEN LAS DOS:
//   - PREDICADO DE LA ORDEN: se comparte desde la 319. `esOrdenEliminable` es la fuente unica,
//     la MISMA que usan `EliminarOrdenService` (que autoriza el borrado en la app) y
//     `OrdenService` (que decide si la pantalla ofrece el boton). Aqui no hay copia, ni `Set`
//     propio, ni `includes` sobre una lista local: si las tres divergieran, el canal aceptaria
//     lo que la app rechaza. Nacio siendo solo el ESTADO; desde el 2026-09-04 son el estado
//     (siete valores) Y cero intentos de entrega, y las dos mitades siguen viajando juntas.
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
// sabiendas: en los estados eliminables el paquete esta quieto —no esta en ningun cierre
// ni en la ruta de ningun mensajero— y la key identifica al autor. El motivo completo esta en
// `IApiOrdenEliminacionService`. La 358 completo esa reversion llevandola a la pantalla.

/** Subconjunto del repositorio que consume este service (DI por interfaz, no la superficie entera). */
export type EliminacionApiRepo = Pick<
  IOrdenRepository,
  "findParaEliminacionApi" | "softDeleteViaApi"
>;

/**
 * ⭑ PEDIDO HUMANO 2026-09-04 — el conteo de INTENTOS DE ENTREGA, la segunda mitad del criterio.
 *
 * Se pide con el metodo EN LOTE aunque aqui el lote sea siempre de UNA orden, y es deliberado:
 * es el mismo metodo que usa el camino de la pantalla, asi que los dos canales no pueden
 * responder numeros distintos sobre la misma orden. `contarIntentos` (el singular) daria el
 * mismo numero hoy —comparten predicado por la 215/R6— pero serian dos caminos que mantener
 * sincronizados sin ninguna ganancia.
 *
 * NO es el criterio que la ficha 319 retiro: aquel contaba transiciones del historial (y lo
 * rompia imprimir la etiqueta), este cuenta cierres aprobados con gestion vigente. La cabecera
 * de `order-status-eliminables.ts` lo desarrolla.
 */
export type EliminacionApiHistorial = Pick<IOrdenHistorialService, "contarIntentosEnLote">;

export class ApiOrdenEliminacionService implements IApiOrdenEliminacionService {
  constructor(
    private readonly repo: EliminacionApiRepo,
    private readonly intentos: EliminacionApiHistorial,
  ) {}

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

    // 2. EL PREDICADO, compartido con la app palabra por palabra. Desde el 2026-09-04 son DOS
    //    mitades —estado (siete valores) e intentos de entrega en cero— y las dos se preguntan
    //    en la MISMA funcion, que es lo que impide que este canal acepte lo que la pantalla
    //    rechaza sobre la misma orden.
    //
    //    LOS DOS MOTIVOS COLAPSAN EN UN SOLO `conflict`, a diferencia de la pantalla, que los
    //    distingue. No es un descuido: los estados de salida de este canal son uniformes por
    //    decision de la 320 (404/409), y un 409 que dijera CUAL de las dos mitades fallo le
    //    daria al integrador informacion sobre la operacion interna de la orden que el 404
    //    uniforme del canal se cuida de no filtrar.
    const intentos = (await this.intentos.contarIntentosEnLote([orden.id])).get(orden.id) ?? 0;
    if (!esOrdenEliminable(orden.estatusValue, intentos)) return { status: "conflict" };

    // 3. Escritura que vuelve a exigirlo TODO —id, dueño, viva y estado permitido— en la misma
    //    sentencia. La lista viaja desde la fuente unica: el repositorio no decide que estados
    //    son borrables, solo aplica el filtro que recibe. `0` = la orden dejo de cumplir alguna
    //    condicion entre la lectura y el UPDATE (otra sesion la borro, o cambio de estado): es
    //    una carrera benigna y se responde el mismo `not_found`, sin haber borrado nada.
    //
    //    ⚠️ LA SEGUNDA MITAD DEL CRITERIO **NO** BAJA A ESTE `where`, y se dice en vez de
    //    esconderse. Los intentos no son una columna de `orden`: son un conteo derivado sobre
    //    gestiones y cierres (215), asi que exigirlos aqui significaria un `NOT EXISTS`
    //    correlacionado dentro del UPDATE, y este repositorio no decide criterios —solo aplica
    //    el filtro que recibe—. La ventana que queda es la que va de la lectura al UPDATE, y
    //    para colarse por ella haria falta que un cierre se APROBARA con una gestion vigente de
    //    esta orden en esos milisegundos. Se acepta: el conteo es monotono creciente (215/R32),
    //    asi que el error posible es siempre el mismo —borrar una orden que acaba de ganar su
    //    primer intento— y nunca el contrario.
    const eliminadas = await this.repo.softDeleteViaApi({
      ordenId: orden.id,
      ownerId,
      estadosPermitidos: ESTADOS_ELIMINABLES,
      // FICHA 362 (R3): la cuenta dedicada de la API key. Su rol `apiKey` queda congelado en la
      // fila y es lo que distingue este canal del borrado por pantalla.
      actorUsuarioId: ownerId,
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
