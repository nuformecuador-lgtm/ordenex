import type { IOrdenNotaRepository } from "@/lib/interfaces/repositories/IOrdenNotaRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IHabilitarNovedadService } from "@/lib/interfaces/services/IHabilitarNovedadService";
import type { IOrdenNotaService } from "@/lib/interfaces/services/IOrdenNotaService";
import type {
  HabilitarNovedadInput,
  HabilitarNovedadServiceResult,
} from "@/lib/types/novedad-habilitar";
import { rescatarOrdenAyuda } from "@/lib/services/rescate-ayuda";

/**
 * «HABILITAR» una novedad desde `/novedades` (pedido humano 2026-08-18).
 *
 * DOS EFECTOS, UNA SOLA PUERTA — el molde exacto de `SolicitudAyudaService.solicitar`, en el otro
 * sentido. La nota obligatoria se publica en el hilo de la feature 227 y la orden pierde la
 * bandera de ayuda que la mantenia en `/novedades`. Si `publicar` no acepta —rol sin hilo, orden
 * de otra tienda, orden fuera de `devuelta`, nota vacia tras recortar— aqui no se apaga nada y se
 * devuelve su mismo resultado, sin traducirlo ni enriquecerlo.
 *
 * FEATURE 239 (T3.1, R23): eran DOS banderas. `gestion_aprobada` se retiro, y con ella la unica
 * via por la que «habilitar» podia sacar una devolucion de la pantalla **sin detener su reloj de
 * SLA** - a los 5 dias el cron la escalaba a `rechazada` y la cobraba, sin aviso.
 *
 * FEATURE 235 (T2.2, R8/P10) - Y AHORA NO QUEDA NINGUNA BANDERA. `habilitarNovedad` (el `update`
 * ciego a `ayuda = false`) desaparece del repositorio y este servicio pasa a llamar AL PUNTO UNICO
 * DE RESCATE (`rescatarOrdenAyuda`), el MISMO que usa «Recuperar» del lado del mensajero. R8 lo
 * pide con esas palabras: un solo punto de escritura, y que sea el que usen los dos lados. Lo que
 * antes era «apagar una marca» es ahora una TRANSICION `ayuda_tienda -> en_reparto`, guardada por
 * el estado y registrada en el historial con el actor real (la tienda) y su familia propia.
 *
 * ⚠️ SOBRE UNA NOVEDAD QUE **NO** ESTA EN AYUDA, EL RESCATE ES UN NO-OP, Y ESO ES LO CORRECTO.
 * La guarda de estado del punto unico rechaza cualquier orden fuera de `ayuda_tienda`, asi que
 * pulsar «Habilitar» sobre una devolucion anclada publica la nota y NO mueve el estatus - que es
 * exactamente lo que hacia antes (la bandera ya estaba apagada) y lo que la 239 dejo dicho: la
 * devolucion se ve mientras siga en `devuelta`, se pulse lo que se pulse. QUE «habilitar» deba
 * ademas moverla, y adonde, es la pregunta que la puerta humana del 2026-08-19 asigno a la ficha
 * 240. Por eso el resultado que se devuelve sigue siendo el de la NOTA: la nota es la puerta y es
 * lo que la pantalla necesita para refrescar el hilo.
 *
 * ⚠️ FEATURE 236 (T5.5 — D8, firmada el 2026-08-19, R25) — EL NO-OP DEJA DE SER MUDO. Hasta hoy el
 * resultado del rescate se descartaba entero, y con el la unica forma que la pantalla tenia de
 * saber si habia pasado algo. Consecuencia real: si el mensajero recuperaba la orden un segundo
 * antes, la tienda leia «Orden habilitada» sobre una orden que nadie movio, y la fila desaparecia
 * hasta la siguiente recarga. Ahora se propaga como `rescatada`, un booleano y nada mas: NO se
 * traduce el `forbidden` opaco del rescate a un motivo (el punto unico no dice cual de sus cinco
 * puertas cerro, y adivinarlo aqui seria inventarlo), y NO se convierte en un fallo — la nota se
 * publico de verdad, asi que sigue siendo `ok`.
 *
 * POR QUE NO SE COMPRUEBA EL ROL NI EL ESTATUS AQUI. Los comprueba ya `OrdenNotaService.publicar`:
 * limita el hilo a `{ adminTienda, mensajero }` y aplica la ventana de cada rol
 * (`lib/types/ventana-hilo-notas.ts`). Repetirlo seria una segunda tabla de permisos que el dia que
 * divergiera dejaria habilitar ordenes que el hilo no deja comentar.
 *
 * La arista conocida y aceptada, la misma que documenta `SolicitudAyudaService`: un `mensajero`
 * asignado podria «habilitar» si la orden estuviera en SU ventana - y en ese caso el efecto es
 * rescatar la ayuda que el mismo pidio, que es literalmente lo que hace «Recuperar». No hay
 * escalado: nadie toca una orden que no fuera ya suya.
 */
export class HabilitarNovedadService implements IHabilitarNovedadService {
  constructor(
    private readonly notas: Pick<IOrdenNotaService, "publicar">,
    private readonly repo: Pick<IOrdenRepository, "findEstatusIdByValue" | "transicionarAyuda">,
    /**
     * Feature 235: el punto unico de rescate autoriza por su cuenta (no publica nada, asi que no
     * puede colarse por `publicar`), y para eso necesita el MISMO repositorio del hilo y la MISMA
     * funcion de autorizacion que usa `OrdenNotaService`. Aqui no se escribe ninguna regla nueva.
     */
    private readonly notaRepo: Pick<IOrdenNotaRepository, "findOrdenParaHilo">,
  ) {}

  async habilitar(
    input: HabilitarNovedadInput,
    actor: Actor,
  ): Promise<HabilitarNovedadServiceResult> {
    // La nota ES el cuerpo. Va con el actor de la sesion; el autor jamas viaja en el input (R5 de
    // la 227).
    const publicada = await this.notas.publicar(
      { ordenId: input.ordenId, cuerpo: input.nota },
      actor,
    );

    // `forbidden` / `validation_error` se propagan TAL CUAL: son la respuesta del hilo y esta capa
    // no tiene nada mejor que decir. Y sobre todo, NO se mueve nada.
    if (publicada.status !== "ok") return publicada;

    // R8 - EL PUNTO UNICO DE RESCATE, el mismo que llama «Recuperar». Sobre una orden que no esta
    // en `ayuda_tienda` devuelve `forbidden` y es un no-op deliberado (ver el JSDoc de la clase).
    // Idempotente por construccion: un segundo «Habilitar» encuentra la orden ya en `en_reparto`,
    // la guarda de estado lo rechaza y no se escribe historial (R9).
    const rescate = await rescatarOrdenAyuda(
      { notaRepo: this.notaRepo, ordenRepo: this.repo },
      input.ordenId,
      actor,
    );

    // 236/D8/R25: el resultado sigue siendo el de la NOTA — lo unico que se le añade es SI la orden
    // se movio, para que la pantalla no pueda afirmar que la devolvio cuando no la devolvio.
    return { ...publicada, rescatada: rescate.status === "ok" };
  }
}
