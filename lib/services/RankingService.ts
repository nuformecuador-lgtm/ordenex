import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  EditarPremioServiceResult,
  IRankingService,
  ObtenerRankingServiceResult,
} from "@/lib/interfaces/services/IRankingService";
import type { IRankingRepository } from "@/lib/interfaces/repositories/IRankingRepository";
import type { IPremioRankingRepository } from "@/lib/interfaces/repositories/IPremioRankingRepository";
import type { IUserRepository } from "@/lib/interfaces/repositories/IUserRepository";
import type { EditarPremioInput, RankingRowDTO } from "@/lib/types/ranking";
import {
  fechaCalendarioCR,
  inicioDelDiaCREnUtc,
  inicioDelDiaSiguienteCREnUtc,
} from "@/lib/utils/fecha-cr";
import { loadRankingConfig, type RankingConfig } from "@/lib/config/ranking";
import { esAccesoTotal } from "@/lib/auth/acceso-total";

// Rol lector adicional (solo-lectura) ademas del acceso total: el mensajero. El acceso total
// (maestro/admin) VE (editable) y EDITA los premios (R16/R17/R19).
const ROL_LECTOR_SOLO_LECTURA = "mensajero";

// R11: monto valido = no negativo, numerico, con a lo sumo 2 decimales. `null` = sin premio.
const MONTO_RE = /^\d+(\.\d{1,2})?$/;

interface AgregadoMensajero {
  mensajeroId: string;
  nombre: string;
  entregadasHoy: number;
  asignadasHoy: number;
  pctNum: number | null; // porcentaje 0-100 redondeado a 1 decimal; null si asignadasHoy=0 (R3)
  elegiblePodio: boolean; // R7: asignadasHoy >= umbral
}

/**
 * Feature 76 (design §5) — logica de negocio del ranking DIARIO. No conoce HTTP ni Prisma
 * directamente: recibe repos por inyeccion y `now`/config para testeo. Autorizacion por rol
 * (R16/R17/R18/R19). Rango del dia via helper CR (R22), umbral de podio via config (R7/R22),
 * pct redondeado a 1 decimal EN SERVIDOR y serializado a STRING (R2/R12).
 */
export class RankingService implements IRankingService {
  private readonly config: RankingConfig;

  constructor(
    private readonly rankingRepo: IRankingRepository,
    private readonly userRepo: IUserRepository,
    private readonly premioRepo: IPremioRankingRepository,
    config?: RankingConfig,
  ) {
    this.config = config ?? loadRankingConfig();
  }

  async obtenerRanking(actor: Actor, now: Date = new Date()): Promise<ObtenerRankingServiceResult> {
    // R16/R17/R18: acceso total (maestro/admin) y mensajero ven; cualquier otro rol -> forbidden sin datos.
    if (!esAccesoTotal(actor.rol) && actor.rol !== ROL_LECTOR_SOLO_LECTURA) {
      return { status: "forbidden" };
    }

    // Feature 166 — ventana del DIA NATURAL de Costa Rica, half-open [desde, hasta): ambos
    // bordes caen en `...T06:00:00.000Z`, que es las 00:00 de PARED en CR (UTC-6 fijo, sin
    // horario de verano). Es la convencion de la feature 144, la misma que usa la analitica
    // (`lib/analytics/ranges.ts`), de modo que "hoy" significa lo mismo en ambos modulos.
    //
    // NO uses `startOfDayCR` aqui, aunque parezca "el helper del dia de CR" y aunque otros
    // modulos del repo si la usen: `startOfDayCR` devuelve la MEDIANOCHE UTC de la fecha
    // calendario CR, que es la convencion de las columnas `@db.Date` (feature 46, p.ej.
    // `fecha_reprogramacion`). Estas dos cotas, en cambio, se comparan contra columnas
    // `timestamp` reales —`gestion_orden.created_at` y `orden.asignado_at`—, y con aquella
    // convencion la ventana resultante `[00:00Z, 24:00Z)` es en realidad 18:00-18:00 hora
    // CR: una entrega de las 19:00 CR contaba para el dia SIGUIENTE. Ese era el defecto que
    // cerro la ficha 166; volver a `startOfDayCR` (o sumarle 6 h a mano) lo reintroduce.
    const hoyCR = fechaCalendarioCR(now);
    const desde = inicioDelDiaCREnUtc(hoyCR);
    const hasta = inicioDelDiaSiguienteCREnUtc(hoyCR);

    const [mensajeros, entregadas, asignadas, premios] = await Promise.all([
      this.userRepo.listMensajeros(),
      this.rankingRepo.contarEntregadasPorMensajero(desde, hasta),
      this.rankingRepo.contarAsignadasPorMensajero(desde, hasta),
      this.premioRepo.listar(),
    ]);

    const entregadasPorId = new Map(entregadas.map((c) => [c.mensajeroId, c.total]));
    const asignadasPorId = new Map(asignadas.map((c) => [c.mensajeroId, c.total]));

    // Un agregado por mensajero ACTIVO (incluye los de 0 para R3/R6).
    const agregados: AgregadoMensajero[] = mensajeros.map((m) => {
      const entregadasHoy = entregadasPorId.get(m.id) ?? 0;
      const asignadasHoy = asignadasPorId.get(m.id) ?? 0;
      // R2/R12/f: pct = entregadas/asignadas * 100, redondeado a 1 decimal EN SERVIDOR.
      const pctNum =
        asignadasHoy > 0 ? Math.round((entregadasHoy / asignadasHoy) * 1000) / 10 : null; // R3
      return {
        mensajeroId: m.id,
        nombre: m.nombre,
        entregadasHoy,
        asignadasHoy,
        pctNum,
        elegiblePodio: asignadasHoy >= this.config.MIN_ASIGNADAS_PODIO, // R7
      };
    });

    // R4/R5: definidos primero, orden pct desc -> entregadas desc -> nombre asc (determinista
    // y estable); los de pct indefinido (asignadas=0) al final, por nombre asc.
    agregados.sort((a, b) => {
      const aDef = a.pctNum !== null;
      const bDef = b.pctNum !== null;
      if (aDef !== bDef) return aDef ? -1 : 1; // definidos antes que indefinidos
      if (aDef && bDef) {
        if (b.pctNum! !== a.pctNum!) return b.pctNum! - a.pctNum!; // R4: pct desc
        if (b.entregadasHoy !== a.entregadasHoy) return b.entregadasHoy - a.entregadasHoy; // R5
      }
      return a.nombre.localeCompare(b.nombre); // R5: desempate final por nombre asc
    });

    // R14/R15: la posicion i del podio la ocupa el i-esimo mensajero ELEGIBLE (pct definido y
    // asignadas >= umbral); si no hay ocupante, la posicion no se inventa (no aparece en el
    // ranking con posicion). Solo 3 posiciones de premio.
    const premioPorPosicion = new Map<number, string | null>(
      premios.map((p) => [p.posicion, p.monto]),
    );
    let siguientePosicion = 1;

    const ranking: RankingRowDTO[] = agregados.map((a) => {
      let posicion: number | null = null;
      let premio: string | null = null;
      if (a.pctNum !== null && a.elegiblePodio && siguientePosicion <= 3) {
        posicion = siguientePosicion;
        premio = premioPorPosicion.get(posicion) ?? null; // R14: monto del podio; R9: null = sin premio
        siguientePosicion += 1;
      }
      return {
        posicion,
        mensajeroId: a.mensajeroId,
        nombre: a.nombre,
        entregadasHoy: a.entregadasHoy, // R6
        asignadasHoy: a.asignadasHoy, // R6
        pct: a.pctNum === null ? null : a.pctNum.toFixed(1), // R3/R12: null | "96.0" STRING
        premio, // R14: STRING|null
      };
    });

    return {
      status: "ok",
      data: { ranking, premios, esEditable: esAccesoTotal(actor.rol) }, // R16/R17
    };
  }

  async editarPremio(
    actor: Actor,
    input: EditarPremioInput,
  ): Promise<EditarPremioServiceResult> {
    // R16/R19: acceso total (maestro/admin) edita; mensajero/otro -> forbidden sin persistir.
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" };

    // R11: posicion 1|2|3 y monto valido (null | no negativo | <=2 decimales | numerico).
    if (input.posicion !== 1 && input.posicion !== 2 && input.posicion !== 3) {
      return { status: "invalid", message: "Posicion debe ser 1, 2 o 3." };
    }
    if (input.monto !== null && !MONTO_RE.test(input.monto)) {
      return {
        status: "invalid",
        message: "Monto invalido: debe ser un numero no negativo con hasta 2 decimales.",
      };
    }

    // R10: persiste monto Y descripcion (independientes; descripcion es rotulo libre opcional).
    await this.premioRepo.upsertPremio(input.posicion, {
      monto: input.monto,
      descripcion: input.descripcion,
    });
    return { status: "ok" };
  }
}
