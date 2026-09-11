import { defaultLogger, type ErrorLogger } from "@/lib/errors";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IRepartoMananaRepository } from "@/lib/interfaces/repositories/IRepartoMananaRepository";
import type {
  IRepartoMananaAvisoService,
  RepartoMananaResumen,
} from "@/lib/interfaces/services/IRepartoMananaAvisoService";
import { emitirBestEffort, notificadorNoOp } from "@/lib/notificaciones/notificadores";
import type { RepartoMananaNotificador } from "@/lib/notificaciones/notificadores";
import { fechaRepartoComoTexto, resolverFechaReparto } from "@/lib/utils/dia-reparto";
import { fechaCalendarioCR, startOfDayCR } from "@/lib/utils/fecha-cr";

// FICHA 413 (T5.1/T5.1b, design §6) — EL PROCESO DE LA TARDE que emite el aviso del reparto de
// mañana.
//
// Decide QUE se avisa: agrupacion, cero, bloqueo y best-effort. No conoce Next.js, ni Prisma, ni
// HTTP, ni transacciones: los dos repositorios y el notificador entran por constructor y el reloj
// por parametro (R37).
//
// LOS CUATRO INVARIANTES QUE SOSTIENE, y donde se prueban:
//   · UN aviso por mensajero y por DIA ANUNCIADO, con el numero FUERA del texto (R5/R22) — la
//     dedupe la da la ENTIDAD (el dia anunciado), no una rama de codigo, y se mide contra Postgres
//     real;
//   · el que tiene CERO no recibe nada (R18), con su `continue` explicito;
//   · el BLOQUEADO por cierres tampoco (R42), con el suyo, y la regla NO se reescribe;
//   · una emision que falla NO se lleva por delante a las demas (R34) — cada una va envuelta.
//
// ---------------------------------------------------------------------------------------------
// ⚠️ LAS DOS FECHAS DE ESTA CORRIDA, Y POR QUE SE DERIVAN CON ESTAS FUNCIONES Y NO CON OTRAS
// ---------------------------------------------------------------------------------------------
// La corrida es a las 19:00 CR, o sea `01:00Z` DEL DIA SIGUIENTE en UTC. Es decir: en el instante
// en que este metodo corre, el reloj UTC YA VA POR EL DIA DE MAÑANA. Cualquier derivacion que use
// campos UTC crudos (`toISOString().slice(0,10)`) daria el dia equivocado en el 100 % de las
// corridas — no en un caso raro, SIEMPRE.
//
//   · `diaEnCurso = startOfDayCR(now)` — la cota contra `orden.fecha_reparto`, que es **`@db.Date`**.
//     `inicioDelDiaCREnUtc` —el helper correcto contra columnas `timestamp`— desplazaria el dia
//     SEIS HORAS. Ver la cabecera de `RepartoMananaRepository`.
//   · `diaAnunciadoISO = fechaRepartoComoTexto(resolverFechaReparto("manana", now))` — y esto no
//     es una conversion cualquiera: `resolverFechaReparto` es LITERALMENTE la funcion con la que
//     la asignacion ESCRIBIO esos `fecha_reparto`, y `fechaRepartoComoTexto` la que los pone en
//     texto para el SQL crudo. Derivar el dia anunciado con otra cosa seria tener dos definiciones
//     de «mañana» en el mismo sistema, que es como se acaba con dos verdades.
//
// `fechaCalendarioCR(now)` es el dia de la CORRIDA (el de HOY en hora de pared CR) y va SOLO al
// resumen, para que quien lea la respuesta del cron sepa que tarde fue. El aviso habla del
// siguiente.

/**
 * Lo unico que este proceso necesita del repositorio de ordenes: el predicado de bloqueo, EN LOTE.
 *
 * ⚠️ `Pick` Y NO `IOrdenRepository` ENTERO, a proposito (patron `CorreccionDiaRepartoRepo` /
 * `DeshacerAsignacionRepo`): de ese repositorio este proceso usa UN metodo, y dejar el tipo ancho
 * haria consultable por descuido todo lo demas.
 */
type CierresRepo = Pick<IOrdenRepository, "findMensajerosBloqueadosPorCierres">;

export class RepartoMananaAvisoService implements IRepartoMananaAvisoService {
  constructor(
    private readonly repo: IRepartoMananaRepository,
    private readonly cierresRepo: CierresRepo,
    /**
     * R36 — EL NOTIFICADOR REAL SE INYECTA EN EL COMPOSITION ROOT. El default es el NO-OP, y no al
     * reves: asi ninguna suite que construya este servicio puede escribir avisos en la base local,
     * que en este repo es COMPARTIDA entre worktrees. Que alguien lo PASE de verdad lo vigila
     * `tests/unit/services/notificacion-notificadores-reales.test.ts` sobre el fuente SIN imports
     * ni comentarios — la unica forma de cazar «importado pero no pasado», que ya dejo dos
     * notificadores muertos en este arbol con la suite entera en verde.
     */
    private readonly notificar: RepartoMananaNotificador = notificadorNoOp,
    private readonly logger: ErrorLogger = defaultLogger,
  ) {}

  async ejecutar(now: Date): Promise<RepartoMananaResumen> {
    const diaEnCurso = startOfDayCR(now);
    const diaAnunciadoISO = fechaRepartoComoTexto(resolverFechaReparto("manana", now));

    const resumen = await this.repo.resumenPorMensajero(diaEnCurso);
    const conReparto = resumen.filter((fila) => fila.total > 0); // R18

    // ⚠️ EN LOTE, Y UNA SOLA VEZ POR CORRIDA (R42, design §6.1). Se le pasan los ids que el
    // `GROUP BY` ya trajo: **una consulta mas por corrida diaria, no por mensajero**. Y la regla
    // NO se reescribe — `findMensajerosBloqueadosPorCierres` ya deriva de `estaBloqueadoPorCierres`
    // (`lib/utils/bloqueo-cierre.ts`), que es la UNICA definicion del bloqueo (271/R10).
    //
    // Si no hay nadie con reparto no se pregunta nada: una consulta con la lista vacia seria una
    // consulta de mas todas las noches en que no haya reparto.
    const bloqueados =
      conReparto.length === 0
        ? new Set<string>()
        : await this.cierresRepo.findMensajerosBloqueadosPorCierres(
            conReparto.map((fila) => fila.mensajeroId),
          );

    let emitidos = 0;
    let saltadosPorBloqueo = 0;
    let fallos = 0;
    for (const fila of conReparto) {
      // R42 — EL BLOQUEADO NO RECIBE ESTE AVISO, y no es regla nueva de esta ficha: el comentario
      // de `findMensajerosBloqueadosPorCierres` dice desde el 2026-08-23 que el bloqueo alcanza
      // «recibir trabajo nuevo, reparto Y recoleccion». Anunciarle su reparto seria prometerle
      // algo que el servidor le va a negar — y ya tiene su aviso propio, el de bloqueo, que si le
      // pide la accion que lo desbloquea. Dos avisos que apuntan a acciones opuestas es peor que
      // uno menos.
      //
      // MUTACION OBLIGATORIA (design §13.10): borrar este `continue` ⇒ 3 emisiones en vez de 2 y
      // `reparto-manana-service.test.ts` ROJO.
      if (bloqueados.has(fila.mensajeroId)) {
        saltadosPorBloqueo += 1;
        continue;
      }
      const ok = await this.emitirYContar(fila.mensajeroId, diaAnunciadoISO);
      if (ok) emitidos += 1;
      else fallos += 1;
    }

    return {
      fecha: fechaCalendarioCR(now),
      diaAnunciado: diaAnunciadoISO,
      mensajerosConReparto: conReparto.length,
      mensajerosBloqueados: saltadosPorBloqueo,
      avisosEmitidos: emitidos,
      fallos,
    };
  }

  /**
   * R34 — envuelve UNA emision: absorbe su fallo, lo deja REGISTRADO con la operacion y su causa
   * (`emitirBestEffort`, nunca un `catch` vacio) y devuelve si salio bien para el resumen.
   *
   * El conteo no lo da `emitirBestEffort` —devuelve `void` a proposito—, asi que el fallo se marca
   * en el camino y se vuelve a lanzar para que el registro siga ocurriendo en un solo sitio. LA
   * CORRIDA MANDA, EL AVISO ES CORTESIA: un mensajero que falle no puede dejar sin aviso a los
   * demas ni tumbar el proceso.
   *
   * R29/R35: el nombre de la operacion NO lleva el id del mensajero ni ningun otro dato — es el
   * mismo literal para todas las emisiones, igual que en los cinco procesos hermanos.
   */
  private async emitirYContar(mensajeroId: string, diaAnunciadoISO: string): Promise<boolean> {
    let exito = true;
    await emitirBestEffort(
      "reparto_manana",
      () =>
        this.notificar({ mensajeroUsuarioId: mensajeroId, diaAnunciadoISO }).catch(
          (error: unknown) => {
            exito = false;
            throw error;
          },
        ),
      this.logger,
    );
    return exito;
  }
}
