import { type PrismaClient } from "@prisma/client";
import type {
  DevueltaSlaRow,
  EscalarDevueltaSlaInput,
  IDevolucionSlaRepository,
  LiberarDevueltaSlaInput,
} from "@/lib/interfaces/repositories/IDevolucionSlaRepository";
import { appendCambioEstado } from "@/lib/repositories/registrar-cambio-estado";

// Estatus de ORIGEN del cron (una orden en `devuelta`) y `resultado` de la gestion que ancla la
// ventana. Valores de catalogo ya sembrados (ORDER_STATUS_SEED / gestion_resultado); esta
// feature NO agrega estados.
const ESTATUS_DEVUELTA = "devuelta";
const RESULTADO_DEVUELTA = "devuelta";

// Feature 239 (T3.3, R12) — la familia de historial que MARCA el instante en que la orden entro
// en `devuelta`: la transicion `devolucion_por_confirmar -> devuelta` que escribe la APROBACION
// del cierre. Es el ancla de la ventana de SLA. Se nombra aqui, una vez, en vez de repetir el
// literal en el `where` y en el comentario.
const ORIGEN_ANCLAJE = "anclaje_devolucion";

// Feature 49/#10: `$transaction` para que el UPDATE guardado, el INSERT de la gestion sintetica
// y el append del historial compartan tx (R18/R20). El `tx` del callback expone
// `ordenHistorialEstado` (choke point) y `gestionOrden`.
type DevolucionSlaPrismaClient = Pick<PrismaClient, "orden" | "gestionOrden" | "$transaction">;

/**
 * Feature 99 (design §3.4) — repositorio del cron SLA de devoluciones diferidas. SOLO queries
 * Prisma (sin logica de negocio: la ventana, el ruteo a bodega y la decision reintento/escalado
 * las decide `DevolucionSlaService`). Reutiliza `orden` + `gestion_orden`; no introduce tablas.
 * Toda transicion pasa por el choke point `appendCambioEstado` en su MISMA tx (R18), NUNCA
 * escribe `orden.estatus_id` por fuera.
 */
export class DevolucionSlaRepository implements IDevolucionSlaRepository {
  constructor(private readonly prisma: DevolucionSlaPrismaClient) {}

  /**
   * R5: ordenes en `devuelta` + no borradas, con su gestion `devuelta` VIGENTE mas reciente
   * (`orderBy createdAt desc`, `take 1`, `anulada_at IS NULL`), de la que salen la `causa` y el
   * mensajero. Filtra en memoria las ordenes SIN gestion vigente (patron `findOrdenesLiberables`);
   * las que la tienen con `causa` null SI salen (el service las omite, R28).
   *
   * FEATURE 239 (T3.3, R12/R14/R15) — EL RELOJ. El ancla deja de ser el `created_at` de la
   * gestion y pasa a ser el instante de la TRANSICION a `devuelta`, que es lo mismo que decir el
   * instante en que un admin APROBO el cierre. Los dos hechos que antes se derivaban por caminos
   * distintos —lo que la tienda ve y cuando empieza a correr el plazo— pasan a salir del mismo.
   *
   * DOS proyecciones anidadas, ninguna consulta extra por orden:
   *   - `gestiones`   : causa + mensajero (igual que antes).
   *   - `historialEstados`: la ULTIMA fila de familia `anclaje_devolucion`. `take 1` con
   *     `createdAt desc` implementa R15 — si la orden dio la vuelta entera y volvio a `devuelta`,
   *     gana el anclaje MAS RECIENTE, no el de la vuelta anterior.
   *
   * INDICE: se apoya en `@@index([ordenId, createdAt])` de `orden_historial_estado`; el filtro
   * por familia queda como residual sobre el punado de filas de esa orden. Es deliberado — no hay
   * indice por `origen_tipo` solo, y el mismo truco lo documenta `whereIntentosVigentes`.
   *
   * R13 por construccion: el `where` es `estatus = devuelta`. Una orden en
   * `devolucion_por_confirmar` NO entra en esta lista, asi que el cron no la puede liberar, ni
   * escalar, ni cobrar mientras su cierre siga sin aprobarse.
   */
  async findDevueltasSla(): Promise<DevueltaSlaRow[]> {
    const rows = await this.prisma.orden.findMany({
      where: {
        deletedAt: null, // R5
        estatus: { value: ESTATUS_DEVUELTA }, // R5
      },
      select: {
        id: true,
        zonaId: true,
        gestiones: {
          // gestion vigente = la mas reciente NO anulada (feature 67).
          where: { resultado: RESULTADO_DEVUELTA, anuladaAt: null },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { mensajeroId: true, causaDevolucion: true, createdAt: true },
        },
        // Feature 239 (R12/R15): EL ANCLA. La ultima transicion a `devuelta` de esta orden.
        historialEstados: {
          where: { origenTipo: ORIGEN_ANCLAJE },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { createdAt: true },
        },
      },
    });

    const candidatas: DevueltaSlaRow[] = [];
    for (const r of rows) {
      const g = r.gestiones[0];
      // Sin gestion `devuelta` vigente -> anomalia sin mensajero al que atribuir: se ignora.
      if (!g) continue;
      // Feature 239 (R12/R14) — LAS DOS RAMAS DEL ANCLA, cada una con su NOMBRE. No es un `??`
      // mudo: `origenAncla` viaja en el DTO y el servicio lo cuenta, para que la poblacion legada
      // sea observable y se la pueda ver extinguirse.
      const anclaje = r.historialEstados[0];
      candidatas.push({
        ordenId: r.id,
        zonaId: r.zonaId,
        mensajeroId: g.mensajeroId,
        causa: g.causaDevolucion, // puede ser null (R28: el service la omite)
        // R12: el instante de la transicion a `devuelta` = el instante de la aprobacion.
        // R14 (rama LEGADA): una orden que llego a `devuelta` ANTES de esta feature no tiene esa
        // fila. Su ventana se ancla donde ya estaba anclada —la fecha de su gestion `devuelta`
        // vigente— para no moverle el plazo por debajo a una orden en vuelo (grandfather, P6).
        ancladaAt: anclaje ? anclaje.createdAt : g.createdAt,
        origenAncla: anclaje ? "aprobacion" : "legado",
      });
    }
    return candidatas;
  }

  /**
   * R15/R18/R19/R24/R25: UPDATE guardado por `estatus_id = devuelta` + no borrada; fija el
   * destino de bodega y limpia `mensajero_asignado_id` (+ `asignado_at`). Si la orden ya salio
   * de `devuelta` (2.ª corrida / carrera) afecta 0 filas -> false. El append (actor NULL,
   * `origen_tipo = liberacion_devuelta_sla`) va DENTRO del `if (count > 0)` de la MISMA tx.
   *
   * Feature 101 (R2/R4, gate F1.4-Q5): enciende `prioridad = true` en el MISMO `data` del
   * `updateMany` GUARDADO. Por estar dentro de la guarda por `estatus_id = devuelta`, una orden
   * que ya salio de `devuelta` (count 0) NO se toca -> el flag no cambia (R4, idempotencia).
   * Feature 110: la liberacion de reprogramadas (46/90) y la recuperacion MANUAL (100) TAMBIEN
   * encienden `prioridad` (misma superficie de reasignacion); el unico retorno a bodega que NO la
   * enciende es el escalado a `rechazada` (`escalarDevueltaSla`), que no vuelve a reasignarse (R9).
   */
  async liberarDevueltaSla(input: LiberarDevueltaSlaInput): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.orden.updateMany({
        where: {
          id: input.ordenId,
          estatusId: input.estatusDevueltaId, // R24/R25: guarda de idempotencia/carrera
          deletedAt: null,
        },
        data: {
          estatusId: input.destinoEstatusId, // R15 (destino ya resuelto por el service)
          mensajeroAsignadoId: null, // R15: handoff limpio a la bodega (nuevo intento)
          asignadoAt: null, // limpia el timestamp de asignacion (defensivo, patron 46)
          fechaReparto: null, // feature 246/R9/R10: el dia de reparto SIEMPRE acompana a `asignado_at`
          prioridad: true, // feature 101/R2: liberada por SLA -> reasignacion prioritaria
          // Feature 239 (T3.1): aqui se apagaba `gestion_aprobada` para que la aprobacion del
          // cierre ANTERIOR no siguiera valiendo. Ya no hace falta: la columna se retira y quien
          // decide si una devolucion esta confirmada es el ESTADO. Esta orden SALE de `devuelta`
          // en este mismo `data`, asi que deja de ser novedad y deja de correr su reloj por
          // construccion; si se devuelve otra vez, volvera a entrar en `devolucion_por_confirmar`
          // y hara falta aprobar el cierre NUEVO para que llegue a `devuelta`. Era una de las dos
          // unicas salidas de `devuelta` (de siete) que se acordaba de apagar la marca: ese
          // "acordarse" es justo lo que el estado no puede olvidar.
        },
      });
      // R24/R25: SOLO si transiciono (count 1); una re-corrida/carrera (count 0) no duplica.
      if (result.count > 0) {
        await appendCambioEstado(tx, [
          {
            ordenId: input.ordenId,
            estatusOrigenId: input.estatusDevueltaId, // R18: origen `devuelta` (fijado por la guarda)
            estatusDestinoId: input.destinoEstatusId,
            actorUsuarioId: null, // R19: sistema/cron
            origenTipo: "liberacion_devuelta_sla", // R19
          },
        ]);
      }
      return result.count > 0;
    });
  }

  /**
   * R16/R17/R18/R19/R20-R25 (Option A del dinero): UPDATE guardado por `estatus_id = devuelta`
   * -> `rechazada` (NO toca el mensajero: paridad con un rechazo directo). Si count 0 -> false
   * (ya salio de `devuelta`: R21/R24/R25, sin efectos). Si count 1: crea en la MISMA tx una
   * gestion sintetica `resultado = rechazada` (`cierre_id NULL`, del `mensajeroId` de la gestion
   * `devuelta` vigente, R22) para que el ingreso de bodega por rechazo (56) lo snapshotee el
   * PROXIMO cierre SIN codigo monetario nuevo (R20/R23) y sin descuadrar cierres cerrados; el
   * append (actor NULL, `origen_tipo = escalado_devuelta_sla`) enlaza esa gestion.
   */
  async escalarDevueltaSla(input: EscalarDevueltaSlaInput): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.orden.updateMany({
        where: {
          id: input.ordenId,
          estatusId: input.estatusDevueltaId, // R21/R24/R25: guarda de idempotencia/carrera
          deletedAt: null,
        },
        data: {
          estatusId: input.estatusRechazadaId, // R16/R17: escalado final
          // NO toca `mensajeroAsignadoId` (paridad con un rechazo directo del mensajero, 47/48).
        },
      });
      // R21/R24/R25: la orden ya salio de `devuelta` -> NO crea gestion ni append (sin doble dinero).
      if (result.count === 0) return false;

      // R20/R22/R23 (Option A): gestion sintetica `rechazada` del mensajero atribuido,
      // `cierre_id NULL` -> entra al PROXIMO cierre; `derivarIngresoBodega`/
      // `ingresoBodegaPorResultado` (56) la cobran desde `resultado`, sin aritmetica nueva.
      const gestionSintetica = await tx.gestionOrden.create({
        data: {
          ordenId: input.ordenId,
          mensajeroId: input.mensajeroId, // R22
          resultado: "rechazada", // R20: dispara el snapshot 56 + el feed de wallet 42/69
          motivo: input.motivo,
          cierreId: null, // entra al proximo cierre (sin descuadrar cierres cerrados)
          // sin evidencia ni causa: es un escalado del sistema, no una gestion del mensajero.
        },
        select: { id: true },
      });
      // R18: la transicion pasa por el choke point, en la MISMA tx, enlazando la gestion.
      await appendCambioEstado(tx, [
        {
          ordenId: input.ordenId,
          estatusOrigenId: input.estatusDevueltaId, // R18: origen `devuelta` (fijado por la guarda)
          estatusDestinoId: input.estatusRechazadaId,
          actorUsuarioId: null, // R19: sistema/cron
          origenTipo: "escalado_devuelta_sla", // R19
          gestionOrdenId: gestionSintetica.id,
        },
      ]);
      return true;
    });
  }
}
