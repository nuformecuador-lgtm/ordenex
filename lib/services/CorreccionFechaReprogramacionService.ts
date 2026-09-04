import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  CorregirFechaReprogramacionInput,
  CorregirFechaReprogramacionServiceResult,
  ICorreccionFechaReprogramacionService,
} from "@/lib/interfaces/services/ICorreccionFechaReprogramacionService";
import type {
  ICorreccionFechaReprogramacionRepository,
  OrdenParaCorreccionRow,
} from "@/lib/interfaces/repositories/ICorreccionFechaReprogramacionRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import { esAccesoTotal } from "@/lib/auth/acceso-total";
import { esFechaCorreccionValida } from "@/lib/types/gestion-orden";
import {
  liberarTrasCorregirFechaNoOp,
  type LiberarTrasCorregirFecha,
} from "@/lib/services/liberacion-tras-corregir-fecha";
import {
  MSG_CARRERA,
  MSG_CATALOGO_INCOMPLETO,
  MSG_FECHA_INVALIDA,
  MSG_MOTIVO_REQUERIDO,
  MSG_ORDEN_BORRADA,
  MSG_ORDEN_NO_EXISTE,
  MSG_SIN_FECHA,
  MSG_SIN_GESTION,
  MSG_YA_ES_ESA_FECHA,
  msgEstadoNoReprogramada,
} from "@/lib/services/mensajes-correccion-fecha-reprogramacion";

// FICHA 371 — lógica de negocio de «corregir la fecha de una reprogramación ya registrada».
//
// SERVICIO PROPIO, igual que en el molde (262, `CorreccionDiaRepartoService`): la operación cruza
// cosas que hoy viven en servicios con autorización distinta —la gestión la registra el mensajero,
// la liberación la dispara el cron— y meterla en cualquiera de ellos obligaría a abrir con un `if`
// la autorización de un servicio que decide otra cosa.
//
// No conoce HTTP ni Prisma: se instancia con dobles en los tests.

/**
 * EL ÚNICO ESTADO EN EL QUE LA FECHA DE REPROGRAMACIÓN TODAVÍA DECIDE ALGO, y por tanto el único
 * sobre el que se ofrece la corrección.
 *
 * Es exactamente el estado desde el que la liberación saca la orden (`ESTATUS_REPROGRAMADA` en
 * `LiberacionReprogramadaRepository`): mientras la orden está ahí, esa fecha es la que decide cuándo
 * vuelve a circular. En cualquier otro estado ya volvió, y escribir la fecha sería mover un dato
 * muerto.
 *
 * ⚠️ ESTO NO EXCLUYE LAS QUE TIENEN EL CIERRE APROBADO, y es una decisión del humano, no un
 * descuido: 18 de las 31 que esperan hoy lo están, y excluirlas dejaría a la mayoría sin arreglo. El
 * argumento del molde 262 aplica literal — no bloquear por estado del cierre cuando la operación no
 * mueve dinero, y está MEDIDO que una gestión `reprogramada` no lleva importe (0 de 160).
 */
const ESTATUS_REPROGRAMADA = "reprogramada";

/** Métodos de repo que el service consume (inyección por constructor, `Pick` para dobles). */
export type CorreccionFechaOrdenRepo = Pick<IOrdenRepository, "findEstatusIdByValue">;

export class CorreccionFechaReprogramacionService
  implements ICorreccionFechaReprogramacionService
{
  /**
   * El liberador por DEFECTO es el NO-OP (patrón `notificadores.ts` / `liberacion-al-aprobar-cierre`
   * ): un service construido sin cablearlo —típicamente un doble de test— no mueve ni una orden,
   * POR CONSTRUCCIÓN y sin husmear el entorno. El liberador REAL lo inyecta el composition root,
   * que aquí es la Server Action `lib/actions/corregir-fecha-reprogramacion.ts`.
   */
  constructor(
    private readonly repo: ICorreccionFechaReprogramacionRepository,
    private readonly ordenRepo: CorreccionFechaOrdenRepo,
    private readonly liberar: LiberarTrasCorregirFecha = liberarTrasCorregirFechaNoOp,
  ) {}

  async corregir(
    input: CorregirFechaReprogramacionInput,
    actor: Actor,
    now: Date = new Date(),
  ): Promise<CorregirFechaReprogramacionServiceResult> {
    // 1. AUTORIZACIÓN POR ROL, ANTES DE TOCAR DATO ALGUNO. Sólo acceso total (`maestro`/`admin`):
    //    el mensajero avisa, el coordinador corrige. Es el criterio del molde 262, que excluye al
    //    mensajero con motivo escrito —quien se equivocó al elegir el día no puede ser quien
    //    decide, sin más control, a qué día se mueve el paquete—. El rechazo no revela el estado de
    //    ninguna orden: se devuelve ANTES de leer nada, así que un rol sin permiso NO TOCA LA BASE.
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" };

    // 2. LAS DOS REGLAS DEL BORDE, revalidadas aquí con el reloj INYECTABLE. El schema zod de la
    //    Server Action ya las aplica; repetirlas no es duplicar la regla —son las MISMAS funciones
    //    importadas— sino poder ejercerlas de forma determinista y cerrar la puerta a cualquier
    //    llamador que no pase por el borde.
    const motivo = input.motivo.trim();
    if (motivo === "") {
      return { status: "validation_error", fieldErrors: { motivo: [MSG_MOTIVO_REQUERIDO] } };
    }
    if (!esFechaCorreccionValida(input.fecha, now)) {
      return { status: "validation_error", fieldErrors: { fecha: [MSG_FECHA_INVALIDA] } };
    }

    // 3. PRE-CHEQUEO: los hechos de la orden y de su gestión vigente, para poder rechazar NOMBRANDO
    //    el motivo. La eleccción que manda la vuelve a hacer el repositorio dentro de su
    //    transacción.
    const orden = await this.repo.findOrdenParaCorreccion(input.ordenId);
    const rechazo = this.motivoDeRechazo(orden, input.fecha);
    if (rechazo !== null) return { status: "conflict", motivo: rechazo };

    // 4. El catálogo de estados: el repositorio guarda por `estatus_id`, no por `value`. Falta de
    //    seed => `validation_error` (fallo CERRADO), mismo mensaje que el resto de services.
    const estatusReprogramadaId = await this.ordenRepo.findEstatusIdByValue(ESTATUS_REPROGRAMADA);
    if (estatusReprogramadaId === null) {
      return { status: "validation_error", fieldErrors: { estatus: [MSG_CATALOGO_INCOMPLETO] } };
    }

    // 5. LA ESCRITURA, todo-o-nada: fecha + rastro con motivo + fila del historial, en UNA
    //    transacción. `null` = carrera perdida y NADA escrito.
    const aplicada = await this.repo.corregirFecha({
      ordenId: input.ordenId,
      fecha: input.fecha,
      estatusReprogramadaId,
      actorUsuarioId: actor.usuarioId,
      motivo,
    });
    if (aplicada === null) return { status: "conflict", motivo: MSG_CARRERA };

    // 6. LA LIBERACIÓN, FUERA DE LA TRANSACCIÓN Y SÓLO SI (5) CONFIRMÓ.
    //
    //    FUERA, y no por comodidad: la liberación abre su propia transacción y tiene que ver la
    //    fecha YA ESCRITA para decidir. Dentro sería, además, la misma trampa que documenta el
    //    molde 262 — un fallo de sentencia aborta la transacción entera, así que un tropiezo de la
    //    liberación revertiría una corrección legítima.
    //
    //    Y NO ES UNA LIBERACIÓN PARALELA: `liberar` entra por `LiberacionReprogramadaService`, con
    //    su `puedeLiberarse` (la puerta de la 276) intacto. Por eso el desenlace puede ser
    //    `espera_cierre`, y por eso viaja en la respuesta.
    const liberacion = await this.liberar(input.ordenId);

    return {
      status: "ok",
      ordenId: input.ordenId,
      gestionId: aplicada.gestionId,
      fechaAnterior: aplicada.fechaAnterior.toISOString().slice(0, 10),
      fechaNueva: input.fecha,
      liberacion,
    };
  }

  /**
   * El motivo por el que la corrección no procede, o `null` si procede. Devuelve el PRIMER motivo
   * que aplica, en el orden en que el operador lo entiende: existe -> viva -> estado -> tiene
   * gestión -> tiene fecha -> la fecha es otra.
   */
  private motivoDeRechazo(orden: OrdenParaCorreccionRow | null, fecha: string): string | null {
    if (orden === null) return MSG_ORDEN_NO_EXISTE;
    if (orden.deletedAt !== null) return MSG_ORDEN_BORRADA;
    if (orden.estatusValue !== ESTATUS_REPROGRAMADA) {
      return msgEstadoNoReprogramada(orden.estatusValue); // el rechazo NOMBRA el estado
    }
    if (orden.gestionVigenteId === null) return MSG_SIN_GESTION;
    if (orden.fechaReprogramacion === null) return MSG_SIN_FECHA;
    // Comparar las dos fechas COMO TEXTO `YYYY-MM-DD` y no con `getTime()`: `fecha_reprogramacion`
    // es un `@db.Date` que Prisma devuelve como la medianoche UTC de esa fecha, y la corrección
    // llega ya como fecha calendario. Pasar las dos por la misma forma compara FECHAS y no
    // instantes, que es lo que la regla dice.
    if (orden.fechaReprogramacion.toISOString().slice(0, 10) === fecha) return MSG_YA_ES_ESA_FECHA;
    return null;
  }
}
