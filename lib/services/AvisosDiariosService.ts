import { defaultLogger, type ErrorLogger } from "@/lib/errors";
import type { IAvisoAgregadoRepository } from "@/lib/interfaces/repositories/IAvisoAgregadoRepository";
import type {
  AvisosDiariosResumen,
  IAvisosDiariosService,
} from "@/lib/interfaces/services/IAvisosDiariosService";
import type { IOrdenHistorialService } from "@/lib/interfaces/services/IOrdenHistorialService";
import { reintentosConfig } from "@/lib/config/reintentos";
import { alcanzaElTope } from "@/lib/types/tope-intentos";
import { fechaCalendarioCR } from "@/lib/utils/fecha-cr";
import type { PlazoNovedades } from "@/lib/notificaciones/emitir";
import {
  emitirBestEffort,
  notificadorNoOp,
  type DevolucionesRepresadasNotificador,
  type NovedadesSinGestionarNotificador,
} from "@/lib/notificaciones/notificadores";

// FICHA 409 (T4.2, design §4.4) — EL PROCESO DIARIO que emite los dos avisos AGREGADOS.
//
// Decide QUE se avisa: agrupacion, umbral, homogeneidad de plazos y best-effort. No conoce
// Next.js, ni Prisma, ni HTTP: el repositorio y los dos notificadores entran por constructor.
//
// LOS TRES INVARIANTES QUE ESTE SERVICIO SOSTIENE, y donde se prueban:
//   · UN aviso por tienda y por dia, con el numero DENTRO (R35/R36) — la dedupe la da la ENTIDAD
//     (`${tiendaId}:${diaCR}`), no una rama de codigo, y se mide contra Postgres real;
//   · UN aviso por AMBITO y por rol (R47/R48/R49) — la zona lleva SU numero, jamas el total;
//   · una emision que falla NO se lleva por delante a las demas (R60) — cada una va envuelta.

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/** Lo unico que este servicio necesita del historial: el conteo de intentos EN LOTE (215/R4). */
type HistorialSvc = Pick<IOrdenHistorialService, "contarIntentosEnLote">;

export class AvisosDiariosService implements IAvisosDiariosService {
  constructor(
    private readonly repo: IAvisoAgregadoRepository,
    private readonly historial: HistorialSvc,
    /**
     * R53 — EL UMBRAL ENTRA POR AQUI Y NO ESTA ESCRITO EN ESTE ARCHIVO. En produccion lo pasa el
     * route handler desde `lib/config/avisos-diarios.ts` (donde vive la medicion que lo justifica);
     * en los tests se inyecta para poder probar los dos lados del corte sin tocar configuracion
     * global.
     */
    private readonly diasRepresamiento: number,
    /**
     * R62 — LOS NOTIFICADORES REALES SE INYECTAN EN EL COMPOSITION ROOT. El default es el NO-OP, y
     * no al reves: asi ninguna suite que construya este servicio puede escribir avisos en la base
     * local, que en este repo es COMPARTIDA entre worktrees. Que alguien los PASE de verdad lo
     * vigila `tests/unit/services/notificacion-notificadores-reales.test.ts` sobre el fuente SIN
     * imports ni comentarios — la unica forma de cazar «importado pero no pasado», que ya dejo dos
     * notificadores muertos en este arbol con la suite entera en verde.
     */
    private readonly notificarNovedades: NovedadesSinGestionarNotificador = notificadorNoOp,
    private readonly notificarRepresadas: DevolucionesRepresadasNotificador = notificadorNoOp,
    private readonly logger: ErrorLogger = defaultLogger,
  ) {}

  async ejecutar(now: Date): Promise<AvisosDiariosResumen> {
    // El dia CR sale de `fechaCalendarioCR`, NUNCA de `toISOString().slice(0,10)`: en UTC, las
    // 19:00 CR ya caen en el dia siguiente y el recordatorio del dia se partiria en dos.
    const diaCR = fechaCalendarioCR(now);
    const fallos = { total: 0 };

    const novedades = await this.emitirAvisosDeNovedades(now, diaCR, fallos);
    const represadas = await this.emitirAvisosDeRepresadas(now, diaCR, fallos);

    return {
      fecha: diaCR,
      tiendasConNovedades: novedades.tiendas,
      avisosNovedadesEmitidos: novedades.emitidos,
      ordenesRepresadas: represadas.ordenes,
      zonasConRepresadas: represadas.zonas,
      avisosRepresadasEmitidos: represadas.emitidos,
      fallos: fallos.total,
    };
  }

  /**
   * R35/R36/R41/R42/R43 — un aviso por tienda con novedades sin gestionar, y NINGUNO para la
   * tienda que no tiene (R43: el `continue` de abajo lo hace explicito aunque el repositorio ya
   * no devuelva esas filas — un doble que devolviera un `total: 0` tampoco puede emitir).
   */
  private async emitirAvisosDeNovedades(
    now: Date,
    diaCR: string,
    fallos: { total: number },
  ): Promise<{ tiendas: number; emitidos: number }> {
    const resumen = await this.repo.resumenNovedadesPorTienda();
    const conNovedades = resumen.filter((tienda) => tienda.total > 0); // R43
    if (conNovedades.length === 0) return { tiendas: 0, emitidos: 0 };

    // UNA sola consulta de intentos para TODA la corrida (215/R4 + 276/T10): las tiendas no pueden
    // discrepar sobre cuantos intentos tiene una orden, porque leen del mismo `Map`.
    const intentos = await this.historial.contarIntentosEnLote(
      conNovedades.flatMap((tienda) => tienda.ordenes.map((o) => o.ordenId)),
    );

    let emitidos = 0;
    for (const tienda of conNovedades) {
      const ok = await this.emitirYContar(
        "novedades_sin_gestionar",
        () =>
          this.notificarNovedades({
            tiendaId: tienda.tiendaId,
            diasMasAntigua: diasEnteros(tienda.masAntiguaAt, now),
            plazo: plazoDelLote(tienda.ordenes, intentos),
            diaCR,
          }),
        fallos,
      );
      if (ok) emitidos += 1;
    }
    return { tiendas: conNovedades.length, emitidos };
  }

  /**
   * R47/R48/R49/R51/R52 — el aviso GLOBAL (maestro + admin) y uno POR ZONA (su `adminSatelite`),
   * cada uno con SU numero y SU antiguedad. La zona con cero no recibe nada (R52).
   *
   * ⚠️ EL NUMERO DE LA ZONA ES EL DE LA ZONA. Usar el total global en el aviso de una zona es la
   * mutacion que el test de este servicio mata: le diria a una bodega que tiene 7 ordenes cuando
   * tiene 3, y el aviso quedaria desacreditado el primer dia.
   */
  private async emitirAvisosDeRepresadas(
    now: Date,
    diaCR: string,
    fallos: { total: number },
  ): Promise<{ ordenes: number; zonas: number; emitidos: number }> {
    // La cota: entran las ancladas en `por_devolver` ANTES de este instante, o sea las que llevan
    // mas de `diasRepresamiento` dias esperando.
    const ancladaAntesDe = new Date(now.getTime() - this.diasRepresamiento * MS_POR_DIA);
    const global = await this.repo.resumenRepresadasGlobal(ancladaAntesDe);
    const porZona = await this.repo.resumenRepresadasPorZona(ancladaAntesDe);

    let emitidos = 0;
    if (global.total > 0 && global.masAntiguaAt !== null) {
      const ok = await this.emitirYContar(
        "devoluciones_represadas",
        () =>
          this.notificarRepresadas({
            ambito: { tipo: "global" },
            diasMasAntigua: diasEnteros(global.masAntiguaAt as Date, now),
            diaCR,
          }),
        fallos,
      );
      if (ok) emitidos += 1;
    }

    const zonasConRepresadas = porZona.filter((zona) => zona.total > 0); // R52
    for (const zona of zonasConRepresadas) {
      const ok = await this.emitirYContar(
        "devoluciones_represadas",
        () =>
          this.notificarRepresadas({
            ambito: { tipo: "zona", zonaId: zona.zonaId },
            diasMasAntigua: diasEnteros(zona.masAntiguaAt, now),
            diaCR,
          }),
        fallos,
      );
      if (ok) emitidos += 1;
    }

    return { ordenes: global.total, zonas: zonasConRepresadas.length, emitidos };
  }

  /**
   * R60 — envuelve UNA emision: absorbe su fallo, lo deja REGISTRADO con la operacion y su causa
   * (`emitirBestEffort`, nunca un `catch` vacio) y lo CUENTA para el resumen.
   *
   * El conteo no lo da `emitirBestEffort` —devuelve `void` a proposito—, asi que el fallo se marca
   * en el camino y se vuelve a lanzar para que el registro siga ocurriendo en un solo sitio. LA
   * CORRIDA MANDA, EL AVISO ES CORTESIA: una tienda o una zona que falle no puede dejar sin aviso
   * a las demas ni tumbar el proceso.
   */
  private async emitirYContar(
    operacion: string,
    emitir: () => Promise<void>,
    fallos: { total: number },
  ): Promise<boolean> {
    let exito = true;
    await emitirBestEffort(
      operacion,
      () =>
        emitir().catch((error: unknown) => {
          exito = false;
          fallos.total += 1;
          throw error;
        }),
      this.logger,
    );
    return exito;
  }
}

/** Dias ENTEROS transcurridos entre el ancla y ahora. Nunca negativo (un ancla futura da 0). */
function diasEnteros(desde: Date, ahora: Date): number {
  const transcurrido = ahora.getTime() - desde.getTime();
  return transcurrido <= 0 ? 0 : Math.floor(transcurrido / MS_POR_DIA);
}

/**
 * R39/R40 — LA DECISION DE SI EL TEXTO PUEDE AFIRMAR UN PLAZO, y es lo mas importante de las nueve
 * preguntas que cerro el humano.
 *
 * El plazo del rechazo automatico DEPENDE DE LA CAUSA: cinco dias para `wrong_address` y
 * `wrong_number`, veinticuatro horas para `not_found`. Y desde la 276 hay una TERCERA salida que
 * no es un plazo: una novedad `wrong_*` que YA alcanzo el tope de intentos escala en la corrida
 * SIGUIENTE, sin esperar sus cinco dias.
 *
 * Homogeneo := TODAS comparten familia de causa **Y** NINGUNA esta en el tope. Si no, el texto
 * habla SIN plazo: prometerle cinco dias a una tienda cuyo lote se resuelve manana seria darle
 * MAS TIEMPO DEL QUE TIENE, y la tienda organiza su trabajo con ese numero.
 *
 * Una causa `null` (gestion vigente sin causa) cuenta como MEZCLA: no se adivina una ventana.
 *
 * El tope se decide con `alcanzaElTope` y `reintentosConfig.MIN_INTENTOS_ENTREGA` — EL MISMO
 * modulo puro y el MISMO umbral que usa `NovedadesService` para pintar `enElTope` y que usa el
 * cron para escalar. Ignorar el tope aqui es una de las nueve mutaciones obligatorias del design.
 */
function plazoDelLote(
  ordenes: ReadonlyArray<{ ordenId: string; causa: string | null }>,
  intentos: ReadonlyMap<string, number>,
): PlazoNovedades {
  const umbral = reintentosConfig.MIN_INTENTOS_ENTREGA;
  const algunaEnElTope = ordenes.some((orden) =>
    alcanzaElTope(intentos.get(orden.ordenId) ?? 0, umbral),
  );
  if (algunaEnElTope) return "mezclado";

  if (ordenes.some((orden) => orden.causa === null)) return "mezclado";
  if (ordenes.every((orden) => orden.causa === "not_found")) return "veinticuatro_horas";
  if (ordenes.every((orden) => orden.causa !== "not_found")) return "cinco_dias";
  return "mezclado";
}
