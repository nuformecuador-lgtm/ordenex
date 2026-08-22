import type { IFileStorage } from "@/lib/interfaces/external/IFileStorage";
import type { IGestionOrdenRepository } from "@/lib/interfaces/repositories/IGestionOrdenRepository";
import type { IOrdenNotaRepository } from "@/lib/interfaces/repositories/IOrdenNotaRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type {
  GestionDesdeAyudaInput,
  IGestionDesdeAyudaService,
} from "@/lib/interfaces/services/IGestionDesdeAyudaService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { autorizarSobreHilo } from "@/lib/services/OrdenNotaService";
import {
  compensarEvidencias,
  subirEvidenciasCompensadas,
} from "@/lib/services/evidencias-compensadas";
import { estatusDestinoDeResultado } from "@/lib/types/gestion-destino";
import type { GestionarDesdeAyudaResult } from "@/lib/types/gestion-desde-ayuda";
import { estaEnVentanaDeEscritura } from "@/lib/types/ventana-hilo-notas";
import { fechaRepartoComoTexto } from "@/lib/utils/dia-reparto";
// Feature 261 (B16, R15/R32): el texto del bloqueo por reserva sale de la fuente UNICA, no se
// reescribe aqui — la tienda tiene que leer la misma frase que el mensajero.
import { avisoReservaParaOtroDia } from "@/lib/utils/dia-reparto-textos";
// Feature 261 (B16, R31): el MISMO helper de la convencion `@db.Date` que usa la via del
// mensajero. Mismo criterio y mismo dia; `inicioDelDiaCREnUtc` desplazaria el dia seis horas.
import { startOfDayCR } from "@/lib/utils/fecha-cr";

/**
 * Feature 237 (design §6, T5.3) — LA TIENDA RESUELVE UNA ORDEN DESDE LA PESTAÑA DE AYUDA, y esa
 * gestion cuenta como si la hubiera hecho el mensajero: entra en su cierre, suma un intento de
 * entrega y mueve el mismo dinero.
 *
 * ⚠️ ES LA OPERACION MAS DELICADA EN DINERO DE LA PILA DE LA AYUDA, y lo es por DOS IMPORTES
 * DISTINTOS CON DUEÑOS DISTINTOS. Un `rechazada`:
 *
 * 1. dispara el `cobroRechazado` de la 56 —hasta ₡1.000 segun lo medido en produccion el
 *    2026-08-20—, que es INGRESO DE BODEGA y cae en el CIERRE DEL MENSAJERO al que se atribuye
 *    la gestion: NO es un cargo a la tienda, en su billetera no hay apunte por ese concepto;
 * 2. SI le cuesta dinero a la tienda, pero POR OTRA VIA Y DESDE OTRA TARIFA: el flete de
 *    devolucion (`ingreso_flete_devolucion`, hasta ₡2.600 —₡2.200 en GAM— mas IVA 13 %, medido);
 * 3. y suma un intento que adelanta el escalado del cron de SLA (99).
 *
 * ## Por que este servicio existe y no se llama a `MisAsignacionesService.gestionar`
 *
 * Cuatro guardas de aquel metodo lo impiden y NINGUNA es accidental (design §4.1): exige rol
 * `mensajero`; aplica `estaBloqueado` (la guarda de bloqueo total de la 111, que aqui bloquearia a
 * la tienda por un estado del mensajero que no controla); exige que la orden este en `en_reparto`
 * —que sea UN valor y no una lista es lo que hace que una orden en ayuda deje de ser gestionable
 * sin escribir ninguna guarda nueva (235)—; y fija `mensajeroId = actor.usuarioId`, cuando aqui el
 * autor y el atribuido son PERSONAS DISTINTAS. Añadirle un modo o un actor suplantado a un metodo
 * money-critical deja los cuatro candados a un `if` de abrirse, y con un solo juego de tests.
 *
 * ## Sin Next, sin Prisma
 *
 * Recibe todo por interfaz (`docs/architecture.md`): el repositorio del hilo para autorizar, el de
 * ordenes para el catalogo, el de gestion para escribir y el storage para las fotos.
 */
export interface GestionDesdeAyudaDeps {
  /** El MISMO repositorio del hilo y la MISMA autorizacion que usan las notas y el rescate. */
  notaRepo: Pick<IOrdenNotaRepository, "findOrdenParaHilo">;
  ordenRepo: Pick<IOrdenRepository, "findEstatusIdByValue">;
  gestionRepo: Pick<IGestionOrdenRepository, "crearGestionDesdeAyuda">;
  storage: IFileStorage;
}

/** El estatus del que se resuelve. Uno solo, y por eso la comprobacion es una igualdad. */
const ESTATUS_AYUDA = "ayuda_tienda";

/** El unico rol que puede resolver por esta via (R19/R20). */
const ROL_AUTORIZADO = "adminTienda";

// Mensajes ACCIONABLES, con tilde (patron `MSG_*` de `CierresAdminService`). Ninguno nombra datos
// de la orden ni de su destinatario: son textos fijos (R50).
const MSG_FUERA_DE_AYUDA =
  "Esta orden ya no está esperando tu respuesta."; // R23/R25 (texto de D7)
const MSG_SIN_MENSAJERO =
  "Esta orden no tiene mensajero asignado; no se puede resolver desde aquí."; // R8
const MSG_CATALOGO = "Catálogo de estados incompleto; avisá a un administrador."; // fallo cerrado

export class GestionDesdeAyudaService implements IGestionDesdeAyudaService {
  constructor(private readonly deps: GestionDesdeAyudaDeps) {}

  /**
   * FEATURE 261 (B16, R28/R31) — `now` es el reloj inyectable del que sale el dia de Costa Rica
   * en curso. Con default para que el borde siga llamando sin argumentos; los tests lo pasan,
   * porque «el bloqueo caduca solo al llegar el dia» solo se puede probar moviendo el reloj.
   */
  async gestionar(
    input: GestionDesdeAyudaInput,
    actor: Actor,
    now: Date = new Date(),
  ): Promise<GestionarDesdeAyudaResult> {
    // 1) R19/R22 — LA PUERTA DEL HILO, entera y sin reescribirla: rol con hilo, orden viva y
    //    pertenencia (la tienda dueña o el mensajero asignado). Es la MISMA funcion que usan las
    //    notas y el rescate, no una segunda tabla de permisos. Su `false` es OPACO: rol sin hilo,
    //    orden inexistente, borrada o ajena devuelven todos lo mismo, asi que el borde no sirve
    //    para averiguar si una guia existe (R22).
    const acceso = await autorizarSobreHilo(this.deps.notaRepo, input.ordenId, actor);
    if (!acceso.ok) return { status: "forbidden" };

    // 2) 💰 R20 — ESTRECHAR LA VENTANA A LA TIENDA. Es la unica regla que esta feature añade y hay
    //    que justificarla porque este repo evita las segundas tablas de permisos: no es una tabla
    //    nueva, es estrechar la puerta que ya existe, exactamente lo que la 235 firmo en su P9.
    //
    //    El motivo es money-critical y concreto: `ayuda_tienda` esta en la ventana de escritura de
    //    LOS DOS roles (235/R34, para que el hilo no sea mudo), asi que SIN ESTA LINEA un mensajero
    //    podria gestionar por esta puerta y con ello SALTARSE `estaBloqueado` (111/R1) — la guarda
    //    que le impide gestionar, y cobrar, con un cierre sin resolver. Seria un bypass del bloqueo
    //    total por una puerta lateral. Devuelve `forbidden`, no `conflict`: no es un estado
    //    transitorio, es que esta via no es suya.
    if (acceso.rol !== ROL_AUTORIZADO) return { status: "forbidden" };

    // 3) R23 — la orden tiene que estar EN AYUDA. Se comprueba aqui, antes de subir nada, para no
    //    dejar fotos huerfanas en el bucket por el camino previsible. (La guarda del WHERE del
    //    repo es la segunda red, no la primera: ver el paso 8.)
    if (acceso.orden.estatusValue !== ESTATUS_AYUDA) {
      return { status: "conflict", motivo: MSG_FUERA_DE_AYUDA };
    }

    // 4) R21 — y la MISMA ventana que para escribir en el hilo. Hoy es redundante con el paso 3
    //    —`ayuda_tienda` esta en la ventana del adminTienda— y se conserva a proposito, igual que
    //    en `rescatarOrdenAyuda`: quien no puede decir nada sobre la orden tampoco puede
    //    resolverla, y si algun dia la ventana se estrecha, esta via se estrecha CON ella sin que
    //    nadie tenga que acordarse.
    if (!estaEnVentanaDeEscritura(acceso.rol, acceso.orden.estatusValue)) {
      return { status: "forbidden" };
    }

    // 5) 💰 R8 — SIN MENSAJERO ASIGNADO NO HAY A QUIEN ATRIBUIR. `gestion_orden.mensajero_id` es
    //    NOT NULL, pero la razon no es la columna: sin mensajero la gestion no entraria en ningun
    //    cierre, no la cobraria nadie y la orden habria cambiado de estado a cambio de nada. Se
    //    rechaza ANTES de crear cualquier cosa. La solicitud de ayuda NO toca el mensajero
    //    asignado (235/R6), asi que en la practica siempre lo hay; esto es la red de que siga
    //    siendo verdad.
    const mensajeroId = acceso.orden.mensajeroAsignadoId;
    if (mensajeroId === null) {
      return { status: "conflict", motivo: MSG_SIN_MENSAJERO };
    }

    // 💰 5-bis) FEATURE 261 (R28/R29/R31/R32) — LA TIENDA TAMPOCO RESUELVE EL DIA QUE NO ES.
    //
    //    Decision humana P2 (2026-08-22), y su razonamiento se hace propio aqui: si el problema
    //    es que se registre un resultado —y se mueva dinero— en un dia que no es, DA IGUAL QUIEN
    //    LO REGISTRE. La orden llega a `ayuda_tienda` CONSERVANDO su dia de reparto (pedir ayuda
    //    no lo toca, 235/R6), asi que este es el mismo defecto por otra puerta y con otro actor.
    //
    //    POR QUE AQUI Y NO MAS ABAJO: exactamente el motivo que ya escribio el paso 3 —«antes de
    //    subir nada, para no dejar fotos huerfanas en el bucket por el camino previsible»—. Un
    //    rechazo previsible pertenece ANTES del upload. Es literalmente R29: sin evidencia en
    //    Storage, sin fila de gestion, sin transicion y sin fila de historial. La segunda red es
    //    el `where` del `updateMany` (paso 8, R30), que gana la carrera y compensa las fotos.
    //
    //    `conflict` y no `forbidden`: la orden SI es suya; lo que falla es el momento.
    //
    //    ⚠️ NO se reutiliza `MisAsignacionesService.gestionar` para esto (design A11): aquel
    //    metodo existe con cuatro candados que esta via no puede pasar, y abrirle un modo o un
    //    actor suplantado a un metodo money-critical los deja todos a un `if` de abrirse.
    const diaEnCurso = startOfDayCR(now);
    const fechaReparto = acceso.orden.fechaReparto;
    if (fechaReparto !== null && fechaReparto.getTime() > diaEnCurso.getTime()) {
      // R32: el motivo lleva el DIA, con palabras, sin siglas ni nombres de columna, y sale de
      // la MISMA fuente que lee la card del mensajero (R15).
      return {
        status: "conflict",
        motivo: MENSAJES_GESTION_DESDE_AYUDA.reservadaParaOtroDia(
          fechaRepartoComoTexto(fechaReparto),
        ),
      };
    }

    // 6) FALLO CERRADO al resolver el catalogo. Si el seed no tiene alguno de los dos values, la
    //    operacion se rechaza ENTERA sin mover nada: una escritura a medias sobre el estado es
    //    peor que un error visible. Mismo criterio que `rescatarOrdenAyuda` y `CierreDiaService`.
    //
    //    ⚠️ R26 — EL DESTINO SALE DEL MAPA UNICO `ESTATUS_POR_RESULTADO` (239), no de
    //    `findEstatusIdByValue(input.resultado)`. Hasta la 239 el destino se derivaba por
    //    IDENTIDAD DE NOMBRE y funcionaba de casualidad; aquella feature rompio la identidad para
    //    `devuelta`, y volver a la coincidencia de nombres reabre el cobro prematuro que cerro.
    const [estatusAyudaId, estatusDestinoId] = await Promise.all([
      this.deps.ordenRepo.findEstatusIdByValue(ESTATUS_AYUDA),
      this.deps.ordenRepo.findEstatusIdByValue(estatusDestinoDeResultado(input.resultado)),
    ]);
    if (estatusAyudaId === null || estatusDestinoId === null) {
      return { status: "validation_error", fieldErrors: { estatus: [MSG_CATALOGO] } };
    }

    // 7) R15/R16/R17 — las fotos, por el MISMO mecanismo compensado que el camino del mensajero
    //    (modulo `evidencias-compensadas`, extraido en esta ficha). Suben ANTES de la transaccion:
    //    si falla la #k, el modulo retira las k-1 y PROPAGA, asi que no se persiste nada.
    const { paths, evidencias } = await subirEvidenciasCompensadas(this.deps.storage, {
      ordenId: input.ordenId,
      // Prefijo propio: distingue estas fotos de las de una gestion del mensajero o de un
      // incidente sobre la MISMA orden. No se reusa `${resultado}-` para que el path diga de que
      // camino vino.
      prefijo: `ayuda-${input.resultado}-`,
      evidencias: input.evidencias,
    });

    // 8) LA ESCRITURA, con su guarda de estado EN EL WHERE (R24). `null` = la orden dejo de estar
    //    en ayuda entre el paso 3 y aqui (el mensajero la recupero, o el corte de la noche se la
    //    llevo): no hay gestion, no hay historial, y la pantalla NO puede decir que gestiono
    //    (R25). Se COMPENSAN las fotos ya subidas (R16); si no, quedarian huerfanas en el bucket
    //    apuntando a una gestion que no existe.
    let gestionId: string | null;
    try {
      gestionId = await this.deps.gestionRepo.crearGestionDesdeAyuda({
        ordenId: input.ordenId,
        estatusAyudaId,
        estatusDestinoId,
        // 💰 R3: EL MENSAJERO, no el actor. Es lo unico que hace que `crearCierre` la vincule y
        // que el dinero salga solo por los cinco feeds. Con el id de la tienda aqui, la fila no
        // entraria en ningun cierre nunca y seria invisible y gratis.
        mensajeroId,
        // R4: la TIENDA, solo para el historial. Quien decidio el rechazo que se le cobra.
        actorUsuarioId: actor.usuarioId,
        // Feature 261 (R30): el MISMO dia que decidio el paso 5-bis, ahora en el `where` de la
        // escritura. Si la reserva cambio por el camino, `count === 0` -> `null` -> se compensan
        // las fotos y se responde `conflict` por el camino que YA existia.
        diaEnCurso,
        gestion: {
          resultado: input.resultado,
          motivo: input.motivo,
          fechaReprogramacion:
            input.resultado === "reprogramada" ? input.fechaReprogramacion : null,
          evidencias,
        },
      });
    } catch (error) {
      // La transaccion fallo DESPUES de subir -> retirar las N fotos y propagar (R16). El error
      // sube como excepcion, no como resultado de dominio: no es una decision de negocio.
      await compensarEvidencias(this.deps.storage, paths);
      throw error;
    }

    if (gestionId === null) {
      // Feature 261 (R30): este camino cubre ahora DOS carreras —la orden salio de ayuda, o paso
      // a estar reservada para un dia posterior— y devuelve el mismo motivo para las dos. Es
      // deliberado y esta declarado: el repo solo puede decir «0 filas», y escribir un segundo
      // camino de fallo para distinguirlas obligaria a re-leer la fila DENTRO de la transaccion
      // para decidir que mentira contar. Las dos son ciertas en lo que importa —la orden ya no
      // se puede resolver ahora— y el rechazo PREVISIBLE, el que un humano va a ver de verdad,
      // es el del paso 5-bis, que si nombra el dia.
      await compensarEvidencias(this.deps.storage, paths);
      return { status: "conflict", motivo: MSG_FUERA_DE_AYUDA };
    }

    return { status: "ok", ordenId: input.ordenId, resultado: input.resultado };
  }
}

/** Los textos, exportados para que la pantalla y sus tests lean el MISMO string (D7). */
export const MENSAJES_GESTION_DESDE_AYUDA = {
  fueraDeAyuda: MSG_FUERA_DE_AYUDA,
  sinMensajero: MSG_SIN_MENSAJERO,
  catalogo: MSG_CATALOGO,
  /**
   * FEATURE 261 (B16, R15/R32) — el rechazo por reserva. Es una FUNCION y no un `MSG_*` fijo, y
   * la diferencia importa: R32 exige que la pantalla nombre **el dia desde el que podra**, y un
   * literal congelado o no lo diria o mentiria (`fecha_reparto` es un `DATE` libre: un `UPDATE` a
   * mano puede dejar +2, y en esta misma ficha hubo uno en produccion).
   *
   * NO se reescribe el texto aqui: es `avisoReservaParaOtroDia` de `lib/utils/dia-reparto-textos`
   * tal cual, la MISMA frase que lee la card del mensajero. La pantalla y sus tests siguen
   * leyendo de este objeto (D7); lo que se comparte es la fuente, no una copia.
   */
  reservadaParaOtroDia: avisoReservaParaOtroDia,
} as const;
