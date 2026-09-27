import type { IOrdenNotaRepository } from "@/lib/interfaces/repositories/IOrdenNotaRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { autorizarSobreHilo } from "@/lib/services/OrdenNotaService";
import { estaEnVentanaDeEscritura } from "@/lib/types/ventana-hilo-notas";

/**
 * Feature 235 (T2.2, R8/R9) — EL PUNTO UNICO DE RESCATE: la operacion que devuelve una orden desde
 * `ayuda_tienda` a `en_reparto`.
 *
 * POR QUE ES UNA FUNCION DE MODULO Y NO UN METODO DE UNO DE LOS DOS SERVICIOS. La disparan LOS DOS
 * LADOS —el mensajero con «Recuperar» (`SolicitudAyudaService.recuperar`) y la tienda con
 * «Habilitar» (`HabilitarNovedadService.habilitar`)— y R8 exige literalmente «un solo punto de
 * escritura ... y ese punto DEBE ser el que usen tanto el mensajero como la tienda». Hasta el
 * 2026-08-19 habia DOS apagadores (`desmarcarAyuda` y `habilitarNovedad`) haciendo lo mismo desde
 * dos servicios, que es como una de las dos copias acaba divergiendo.
 *
 * ⚠️ LA GUARDA DE ESTADO VIVE AQUI, EN EL PUNTO UNICO, Y NO EN LOS LLAMADORES. Moverla a uno de
 * los dos dejaria al otro sin ella — es el riesgo #1 del design y por eso hay un test que ataca
 * esta funcion DIRECTAMENTE con una orden fuera de `ayuda_tienda`.
 *
 * IDEMPOTENCIA POR CONSTRUCCION (R9): no hay codigo de idempotencia. Un segundo rescate encuentra
 * la orden ya en `en_reparto`, la guarda de estado la rechaza y no se escribe ni una fila de
 * historial. Y aunque se colara, el `updateMany` del repo esta guardado por el mismo origen.
 *
 * NO SE COMPRUEBA EL BLOQUEO TOTAL DEL MENSAJERO (R25), y es una decision: añadirlo crearia un
 * DEADLOCK con R22 — un mensajero con un cierre `vencido` y una orden en ayuda no podria ni
 * rescatarla (bloqueado) ni cerrar (la orden en ayuda bloquea el cierre). Hoy tampoco se comprueba.
 */

// FICHA 454 (T1.15): aqui vivian `ESTATUS_AYUDA` y `ESTATUS_EN_REPARTO`. El rescate ya no transiciona:
// registra el hecho `ayuda_rescatada` sobre una orden que siguio `en_reparto`.

/** Lo que el rescate necesita, por interfaz. Sin Prisma, sin Next, sin HTTP. */
export interface RescateAyudaDeps {
  /** El MISMO repositorio del hilo y la MISMA autorizacion que usa `OrdenNotaService`. */
  notaRepo: Pick<IOrdenNotaRepository, "findOrdenParaHilo">;
  ordenRepo: Pick<IOrdenRepository, "registrarAyudaResuelta">;
}

/**
 * `forbidden` es OPACO y hereda el del hilo tal cual: rol sin hilo, orden inexistente o ajena,
 * orden SIN ayuda abierta, o actor fuera de su ventana. Todos devuelven lo mismo — el borde no es un
 * oraculo del estado de una guia.
 */
export type RescateAyudaResult = { status: "ok" } | { status: "forbidden" };

export async function rescatarOrdenAyuda(
  deps: RescateAyudaDeps,
  ordenId: string,
  actor: Actor,
): Promise<RescateAyudaResult> {
  // 1. La puerta del hilo, entera y sin reescribirla: rol con hilo, orden viva, pertenencia (la
  //    tienda dueña o el mensajero asignado).
  const acceso = await autorizarSobreHilo(deps.notaRepo, ordenId, actor);
  if (!acceso.ok) return { status: "forbidden" };

  // 2. R9 (235) — GUARDA. FICHA 454 (T1.15): la condicion ya no es el estatus `ayuda_tienda` sino la
  //    ayuda ABIERTA (derivacion unica): la orden sigue `en_reparto`. Rescatar una orden sin ayuda
  //    abierta se rechaza aqui, ANTES de escribir nada; la re-lectura bajo candado del repositorio
  //    es la segunda red.
  if (!acceso.orden.ayudaAbierta) return { status: "forbidden" };

  // 3. Y la misma VENTANA que para escribir en el hilo (con la ayuda abierta, la de los dos roles).
  //    Se conserva a proposito: quien no puede decir nada sobre la orden tampoco puede declarar que
  //    la ayuda ya no hace falta.
  if (!estaEnVentanaDeEscritura(acceso.rol, acceso.orden.estatusValue, acceso.orden.ayudaAbierta)) {
    return { status: "forbidden" };
  }

  // 4. LA UNICA ESCRITURA: el hecho `ayuda_rescatada` —«Recuperar» del mensajero o «Habilitar» de la
  //    tienda, que lo distingue `actor_rol`—, sin transicion (R23). Guardado por «ayuda abierta» bajo
  //    candado; si otra via la cerro entre medias, no escribe nada (como el `updateMany` de la 235).
  await deps.ordenRepo.registrarAyudaResuelta({
    ordenId,
    tipo: "ayuda_rescatada",
    actorUsuarioId: actor.usuarioId,
    actorRol: acceso.rol,
  });

  return { status: "ok" };
}
