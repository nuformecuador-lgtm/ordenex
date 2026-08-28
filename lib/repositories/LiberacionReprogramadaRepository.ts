import { type PrismaClient } from "@prisma/client";
import type {
  ILiberacionReprogramadaRepository,
  LiberadaHoyFilter,
  LiberadaHoyRow,
  LiberarOrdenInput,
  OrdenLiberableRow,
} from "@/lib/interfaces/repositories/ILiberacionReprogramadaRepository";
import { appendCambioEstado } from "@/lib/repositories/registrar-cambio-estado";
// FEATURE 276 (T6.1, R12): la MISMA lista de familias de visita real que usa el predicado unico de
// intentos (`whereIntentosVigentes`). Se IMPORTA, no se copia: dos listas que se desincronizaran
// harian que la puerta del cron y el contador dijeran cosas distintas sobre la misma gestion.
import { ORIGEN_TIPOS_VISITA_REAL } from "@/lib/types/orden-historial";

// Estatus de ORIGEN de la liberacion (una orden reprogramada) y `resultado` de la
// gestion que fija la fecha de reprogramacion (feature 36). Valores de catalogo ya
// sembrados; esta feature NO agrega estados.
const ESTATUS_REPROGRAMADA = "reprogramada";
const RESULTADO_REPROGRAMADA = "reprogramada";

const UN_DIA_MS = 24 * 60 * 60 * 1000;

// Feature 49/#10: `$transaction` para que el UPDATE guardado y el append del historial
// compartan tx (R7). El `tx` del callback expone `ordenHistorialEstado` (choke point).
type LiberacionPrismaClient = Pick<PrismaClient, "orden" | "$transaction">;

/**
 * Feature 46 — repositorio de la liberacion programada. SOLO queries Prisma (sin logica
 * de negocio: quien va a `en_bodega_central`/`en_bodega_satelite` y los conteos los decide el
 * service). Reutiliza `orden` + `gestion_orden`; no introduce tablas nuevas.
 */
export class LiberacionReprogramadaRepository implements ILiberacionReprogramadaRepository {
  constructor(private readonly prisma: LiberacionPrismaClient) {}

  /**
   * R10/R11: ordenes `reprogramada` + no borradas, con su gestion `reprogramada` mas
   * reciente (orderBy createdAt desc, take 1). Filtra en memoria las que tienen esa
   * fecha vigente `<= hoyCR` (las futuras siguen bloqueadas). `fecha_reprogramacion` es
   * `@db.Date` a medianoche UTC; `hoyCR` viene en la misma convencion (util fecha-cr).
   */
  async findOrdenesLiberables(hoyCR: Date): Promise<OrdenLiberableRow[]> {
    return this.buscarLiberables(hoyCR, null);
  }

  /**
   * FICHA 315 — las mismas candidatas, acotadas al cierre que se acaba de aprobar.
   *
   * El `some` sobre `gestion_orden` es el PREFILTRO indexado (`@@index([cierreId])`): reduce el
   * escaneo a las ordenes que tocaron ese cierre. La exactitud la pone la correlacion en memoria
   * de `buscarLiberables` —la gestion VIGENTE tiene que ser la de ESE cierre—, que es donde ya
   * vive el filtro de fecha por la misma razon: la gestion vigente sale de un `take: 1` y Prisma
   * no deja filtrar por ella desde el `where` del padre.
   */
  async findOrdenesLiberablesDeCierre(
    cierreId: string,
    hoyCR: Date,
  ): Promise<OrdenLiberableRow[]> {
    return this.buscarLiberables(hoyCR, cierreId);
  }

  /**
   * El cuerpo COMPARTIDO por las dos consultas de arriba. Se comparte a proposito: si el camino
   * del evento (315) tuviera su propio `select`, su propio `take: 1` o su propio filtro de fecha,
   * seria una segunda regla que puede divergir de la del cron — y la divergencia mas cara aqui es
   * justo la que nadie ve, porque las dos consultas devuelven filas plausibles.
   *
   * `cierreId === null` = la corrida COMPLETA del reloj (46/276), byte a byte la de siempre.
   */
  private async buscarLiberables(
    hoyCR: Date,
    cierreId: string | null,
  ): Promise<OrdenLiberableRow[]> {
    const rows = await this.prisma.orden.findMany({
      where: {
        deletedAt: null, // R10
        estatus: { value: ESTATUS_REPROGRAMADA }, // R10
        // FICHA 315: prefiltro por cierre. Ausente en la corrida del reloj.
        ...(cierreId === null
          ? {}
          : {
              gestiones: {
                some: { cierreId, resultado: RESULTADO_REPROGRAMADA, anuladaAt: null },
              },
            }),
      },
      select: {
        id: true,
        zonaId: true,
        gestiones: {
          // gestion vigente = la mas reciente. Feature 67 (design §3-#6): `anuladaAt: null`
          // por DEFENSA, sin cambio funcional — una orden en `reprogramada` no puede tener su
          // ultima gestion `reprogramada` anulada (deshacerla la devuelve a `en_reparto`, con
          // lo que ya no casa el filtro de estado de arriba). Explicito > implicito.
          where: { resultado: RESULTADO_REPROGRAMADA, anuladaAt: null },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            fechaReprogramacion: true,
            // FEATURE 276 (T6.1, R12/R14/R15) — LOS TRES HECHOS NUEVOS, todos de ESTA MISMA
            // gestion: la vigente mas reciente, la que el `take: 1` ya elegia. El repositorio NO
            // decide nada con ellos; la regla vive en `ejecutarLiberacion`.
            cierreId: true,
            cierre: { select: { estado: true } },
            // LA SONDA DE VISITA REAL. Array vacio = gestion SINTETICA (p. ej. la
            // `reprogramacion_tienda` de la 100, que NO cuenta como intento); con un elemento =
            // nacio de una visita del mensajero y por tanto SI puede subir el contador.
            //
            // ⚠️ RENDIMIENTO — DESVIACION DEL DESIGN §10, MEDIDA Y DECLARADA. Aquel decia repetir
            // el filtro por `orden_id` dentro de la sonda «como hace `whereIntentosVigentes`»,
            // para entrar por `@@index([ordenId, createdAt])`, porque `gestion_orden_id` no tiene
            // indice propio (215/D7 prohibe anadir uno). **Eso no se puede escribir aqui**: es un
            // `select` ANIDADO y Prisma no deja referenciar un campo de la fila padre en el `where`
            // de una relacion. Lo que SI se sostiene es el motivo por el que daba igual: Prisma
            // carga las relaciones con consultas SEPARADAS Y AGRUPADAS
            // (`... WHERE gestion_orden_id IN ($1..$n)`), asi que esta sonda cuesta **UNA consulta
            // por corrida del cron**, no una por orden. No hay N+1 que evitar.
            historialEstados: {
              where: { origenTipo: { in: [...ORIGEN_TIPOS_VISITA_REAL] } },
              take: 1,
              select: { id: true },
            },
          },
        },
      },
    });

    const liberables: OrdenLiberableRow[] = [];
    for (const r of rows) {
      const gestion = r.gestiones[0];
      const fecha = gestion?.fechaReprogramacion ?? null;
      // R11: sin fecha vigente o fecha futura -> permanece bloqueada.
      //
      // 💰 FICHA 315 — ESTA LINEA ES LA QUE IMPIDE EL DEFECTO PEOR. Vale para los dos caminos y
      // por el mismo motivo: la fecha de reprogramacion es un COMPROMISO con el destinatario. Al
      // aprobar un cierre se libera lo que YA VENCIO; lo del 31/08 sigue esperando al calendario.
      if (fecha === null || fecha.getTime() > hoyCR.getTime()) continue;
      // FICHA 315: acotado a un cierre, la gestion VIGENTE tiene que ser la de ESE cierre. El
      // `some` de arriba solo garantiza que ALGUNA gestion lo fuera; si la ultima reprogramada es
      // de otro cierre, la que manda es aquella y esta aprobacion no dice nada sobre ella.
      if (cierreId !== null && (gestion?.cierreId ?? null) !== cierreId) continue;
      liberables.push({
        id: r.id,
        zonaId: r.zonaId,
        fechaReprogramacion: fecha,
        // FEATURE 276: los tres hechos viajan CRUDOS. El `?? null` y el `.length > 0` son
        // traduccion de FORMA, no decision: quien decide es `ejecutarLiberacion`.
        gestionCierreId: gestion?.cierreId ?? null,
        gestionCierreEstado: gestion?.cierre?.estado ?? null,
        gestionEsVisitaReal: (gestion?.historialEstados?.length ?? 0) > 0,
      });
    }
    return liberables;
  }

  /**
   * R13/R17: UPDATE guardado por `estatusId = reprogramada` + no borrada. Si la orden ya
   * salio de `reprogramada` (segunda corrida / carrera) afecta 0 filas -> devuelve false
   * (idempotencia derivada del estado). NO toca `num_guia`.
   *
   * Feature 110 (R1/R4): enciende `prioridad = true` en el MISMO `data` del `updateMany`
   * GUARDADO. Por estar dentro de la guarda por `estatusId = reprogramada`, una orden que ya
   * salio de `reprogramada` (count 0) NO se toca -> el flag no cambia (R3, idempotencia). La
   * reprogramada liberada vuelve a la misma superficie de reasignacion (`en_bodega_central` /
   * `en_bodega_satelite`) que la liberacion por SLA (99/101), por eso sale prioritaria.
   */
  async liberarOrden(input: LiberarOrdenInput): Promise<boolean> {
    // Feature 49/#10 (R7/R8/R18/R21): UPDATE guardado + append en la MISMA tx. El actor es
    // NULL (la origina el cron/sistema, no una persona) y `origenTipo` = liberacion_reprogramada;
    // origen = `reprogramada` (fijado por la guarda), destino = en_bodega_central/en_bodega_satelite.
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.orden.updateMany({
        where: {
          id: input.ordenId,
          estatusId: input.estatusReprogramadaId, // R17: guarda de idempotencia/carrera
          deletedAt: null,
        },
        data: {
          estatusId: input.destinoEstatusId, // R12 (destino ya resuelto por el service)
          mensajeroAsignadoId: null, // R13: handoff limpio a la bodega
          asignadoAt: null, // feature 76/LC1 (C3): limpia el timestamp de asignacion (defensivo)
          fechaReparto: null, // feature 246/R9/R10: el dia de reparto SIEMPRE acompana a `asignado_at`
          liberadaReprogramadaAt: input.corridaAt, // R13: marca de auditoria/aviso
          prioridad: true, // feature 110/R1: liberada de reprogramada -> reasignacion prioritaria
        },
      });
      // R8: SOLO si libero (count 1); una segunda corrida idempotente (count 0) no duplica.
      if (result.count > 0) {
        await appendCambioEstado(tx, [
          {
            ordenId: input.ordenId,
            estatusOrigenId: input.estatusReprogramadaId, // R18: origen reprogramada
            estatusDestinoId: input.destinoEstatusId,
            actorUsuarioId: null, // R21: sistema/cron
            origenTipo: "liberacion_reprogramada", // R23
          },
        ]);
      }
      return result.count > 0;
    });
  }

  /**
   * R15/R16: ordenes liberadas HOY (CR) de una bodega. `liberada_reprogramada_at` cae en
   * el dia de `hoyCR` (`[hoyCR, hoyCR + 24h)`; la corrida marca ~06:00Z = 00:00 CR, mismo
   * dia UTC que `hoyCR`) + estatus destino de la bodega + su zona. Excluye borradas.
   */
  async findLiberadasHoy(filter: LiberadaHoyFilter, hoyCR: Date): Promise<LiberadaHoyRow[]> {
    const start = hoyCR;
    const end = new Date(hoyCR.getTime() + UN_DIA_MS);
    const rows = await this.prisma.orden.findMany({
      where: {
        zonaId: filter.zonaId,
        deletedAt: null,
        estatus: { value: filter.estatusValue },
        liberadaReprogramadaAt: { gte: start, lt: end },
      },
      select: {
        id: true,
        numGuia: true,
        numRemision: true,
        destinatario: true,
        liberadaReprogramadaAt: true,
      },
      orderBy: { liberadaReprogramadaAt: "desc" },
    });
    return rows.map((r) => ({
      id: r.id,
      numGuia: r.numGuia,
      numRemision: r.numRemision,
      destinatario: r.destinatario,
      liberadaReprogramadaAt: r.liberadaReprogramadaAt as Date,
    }));
  }
}
