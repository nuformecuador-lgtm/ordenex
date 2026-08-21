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

/** El estatus del que se rescata. */
const ESTATUS_AYUDA = "ayuda_tienda";
/** El estatus al que se vuelve: la orden regresa a la calle, con su mismo mensajero. */
const ESTATUS_EN_REPARTO = "en_reparto";

/** Lo que el rescate necesita, por interfaz. Sin Prisma, sin Next, sin HTTP. */
export interface RescateAyudaDeps {
  /** El MISMO repositorio del hilo y la MISMA autorizacion que usa `OrdenNotaService`. */
  notaRepo: Pick<IOrdenNotaRepository, "findOrdenParaHilo">;
  ordenRepo: Pick<IOrdenRepository, "findEstatusIdByValue" | "transicionarAyuda">;
}

/**
 * `forbidden` es OPACO y hereda el del hilo tal cual: rol sin hilo, orden inexistente o ajena,
 * orden que NO esta en el estatus de ayuda, actor fuera de su ventana, o catalogo incompleto. Los
 * cinco devuelven lo mismo — el borde no es un oraculo del estado de una guia.
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

  // 2. R9 — GUARDA DE ESTADO. Rescatar una orden que no esta en el estatus de ayuda no es un
  //    no-op silencioso: se rechaza aqui, ANTES de tocar nada, para que no haya ninguna
  //    transicion registrada. (La guarda del WHERE del repo es la segunda red, no la primera.)
  if (acceso.orden.estatusValue !== ESTATUS_AYUDA) return { status: "forbidden" };

  // 3. Y la misma VENTANA que para escribir en el hilo. Hoy es redundante con el paso 2 —
  //    `ayuda_tienda` esta en la ventana de los DOS roles— y se conserva a proposito: quien no
  //    puede decir nada sobre la orden tampoco puede declarar que la ayuda ya no hace falta, y si
  //    algun dia la ventana se estrecha, el rescate se estrecha CON ella sin que nadie lo recuerde.
  if (!estaEnVentanaDeEscritura(acceso.rol, acceso.orden.estatusValue)) {
    return { status: "forbidden" };
  }

  // 4. FALLO CERRADO al resolver el catalogo (design §3.3): si el seed no tiene alguno de los dos
  //    values, la operacion se rechaza ENTERA sin mover nada. Una escritura a medias sobre el
  //    estado es peor que un error visible. Mismo criterio que `MSG_CATALOGO` de `CierreDiaService`.
  const [origenId, destinoId] = await Promise.all([
    deps.ordenRepo.findEstatusIdByValue(ESTATUS_AYUDA),
    deps.ordenRepo.findEstatusIdByValue(ESTATUS_EN_REPARTO),
  ]);
  if (origenId === null || destinoId === null) return { status: "forbidden" };

  // 5. LA UNICA ESCRITURA. Guardada por el estado de origen y con su append en la misma tx.
  //    `actorUsuarioId` es quien la provoco (R10): el mensajero o la tienda, segun quien llame.
  await deps.ordenRepo.transicionarAyuda({
    ordenId,
    estatusOrigenId: origenId,
    estatusDestinoId: destinoId,
    actorUsuarioId: actor.usuarioId,
    origenTipo: "rescate_ayuda_tienda",
  });

  return { status: "ok" };
}
