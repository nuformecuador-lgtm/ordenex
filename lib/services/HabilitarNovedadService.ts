import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IHabilitarNovedadService } from "@/lib/interfaces/services/IHabilitarNovedadService";
import type { IOrdenNotaService } from "@/lib/interfaces/services/IOrdenNotaService";
import type {
  HabilitarNovedadInput,
  HabilitarNovedadServiceResult,
} from "@/lib/types/novedad-habilitar";

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
 * SLA** — a los 5 dias el cron la escalaba a `rechazada` y la cobraba, sin aviso.
 *
 * POR QUE NO SE COMPRUEBA EL ROL NI EL ESTATUS AQUI. Los comprueba ya `OrdenNotaService.publicar`:
 * limita el hilo a `{ adminTienda, mensajero }` y la ventana del `adminTienda` a `devuelta`
 * (`lib/types/ventana-hilo-notas.ts`). Repetirlo seria una segunda tabla de permisos que el dia que
 * divergiera dejaria habilitar ordenes que el hilo no deja comentar.
 *
 * La arista conocida y aceptada, la misma que documenta `SolicitudAyudaService`: un `mensajero`
 * asignado podria habilitar si la orden estuviera en SU ventana (`en_reparto`) — pero una orden en
 * `en_reparto` no esta en `/novedades` por devolucion, y si esta ahi por AYUDA su estatus no es
 * `devuelta`, asi que la ventana del `adminTienda` no aplica y la del mensajero si. El efecto en ese
 * caso es apagar la ayuda que el mismo pidio, que es literalmente lo que hace «Recuperar». No hay
 * escalado: nadie toca una orden que no fuera ya suya.
 */
export class HabilitarNovedadService implements IHabilitarNovedadService {
  constructor(
    private readonly notas: Pick<IOrdenNotaService, "publicar">,
    private readonly repo: Pick<IOrdenRepository, "habilitarNovedad">,
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
    // no tiene nada mejor que decir. Y sobre todo, NO se apaga ninguna bandera.
    if (publicada.status !== "ok") return publicada;

    // Idempotente por construccion (las dos a `false`): habilitar dos veces deja la orden fuera del
    // listado una vez y el hilo con dos notas, que es exactamente lo que paso.
    await this.repo.habilitarNovedad(input.ordenId);

    return publicada;
  }
}
