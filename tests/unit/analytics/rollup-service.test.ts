import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { quitarComentarios } from "../../fixtures/sin-comentarios";
import type {
  EntregaVigente,
  EscrituraFecha,
  FilaRollup,
  GrupoCiclo,
  GrupoEstadoStock,
  GrupoGestiones,
  GrupoOrdenesCreadas,
  IAnaliticaRollupRepository,
  MedidasReconciliables,
  ResultadoEscritura,
} from "@/lib/interfaces/repositories/IAnaliticaRollupRepository";
import {
  AnaliticaRollupError,
  PrimerIntentoIncoherenteError,
  ReconciliacionError,
} from "@/lib/interfaces/services/IAnaliticaRollupService";
import {
  AnaliticaRollupService,
  claveDeCubo,
  type ContadorIntentos,
} from "@/lib/services/AnaliticaRollupService";
import { UMBRAL_AVISO_FILAS_CORRIDA } from "@/lib/config/analitica-rollup";

// Feature 124 / T3 — composicion de los cubos, invariantes y reconciliacion, con TABLAS EN
// MEMORIA y sin base de datos (design §2): el bug caro de esta feature no es una consulta
// lenta, es un cubo mal fundido o una coordenada tomada del sitio equivocado.
//
// El doble del repositorio NO es un mock de conveniencia: simula la semantica que el contrato
// promete (upsert por el grano, barrido de rancias por `updated_at`, reconciliacion dentro de
// la transaccion y ROLLBACK si lanza), para que la mutacion «inyectar una fila de
// totalizacion» ABORTE de verdad y se pueda comprobar que la fecha quedo sin escribir.

const FECHA = "2026-07-15";

const ZONA_A = "zona-a";
const ZONA_B = "zona-b";
const TIENDA = "tienda-1";
const MENSA_1 = "mensajero-1";
const MENSA_2 = "mensajero-2";
const ESTATUS_ENTREGADA = "st-entregada";
const ESTATUS_EN_REPARTO = "st-en-reparto";

/* -------------------------------------------------------------------------- */
/* Dobles en memoria                                                           */
/* -------------------------------------------------------------------------- */

interface Guion {
  creadas?: GrupoOrdenesCreadas[];
  stock?: GrupoEstadoStock[];
  gestiones?: GrupoGestiones[];
  entregas?: EntregaVigente[];
  ciclos?: GrupoCiclo[];
  totales?: Partial<MedidasReconciliables>;
  fallaEn?: keyof Pick<
    IAnaliticaRollupRepository,
    | "contarOrdenesCreadas"
    | "contarOrdenesEnEstadoAlCorte"
    | "contarGestionesVigentes"
    | "listarEntregasVigentes"
    | "acumularCiclosCerrados"
    | "totalesDeControl"
  >;
}

const CERO: MedidasReconciliables = {
  ordenesCreadas: 0,
  ordenesEstadoStock: 0,
  entregas: 0,
  devoluciones: 0,
  rechazos: 0,
  reprogramaciones: 0,
  incidentes: 0,
};

interface FilaPersistida {
  readonly fecha: string;
  readonly fila: FilaRollup;
  readonly updatedAt: number;
}

/**
 * Doble del repositorio. `escribirFecha` reproduce el contrato de `design.md §5`: marca de
 * corrida propia, upsert por el grano de 6 columnas (con `NULL` significando «sin asignar» /
 * «sin causa», nunca «ausente»), barrido de las filas de la fecha que esta corrida no
 * reescribio, reconciliacion y ROLLBACK si esta lanza.
 */
class RepoEnMemoria implements IAnaliticaRollupRepository {
  readonly tabla = new Map<string, FilaPersistida>();
  readonly escrituras: EscrituraFecha[] = [];
  private marca = 0;

  constructor(private readonly guion: Guion = {}) {}

  private guarda<T>(metodo: NonNullable<Guion["fallaEn"]>, valor: T): Promise<T> {
    if (this.guion.fallaEn === metodo) {
      return Promise.reject(new Error(`fallo simulado en ${metodo}`));
    }
    return Promise.resolve(valor);
  }

  contarOrdenesCreadas(): Promise<GrupoOrdenesCreadas[]> {
    return this.guarda("contarOrdenesCreadas", this.guion.creadas ?? []);
  }
  contarOrdenesEnEstadoAlCorte(): Promise<GrupoEstadoStock[]> {
    return this.guarda("contarOrdenesEnEstadoAlCorte", this.guion.stock ?? []);
  }
  contarGestionesVigentes(): Promise<GrupoGestiones[]> {
    return this.guarda("contarGestionesVigentes", this.guion.gestiones ?? []);
  }
  listarEntregasVigentes(): Promise<EntregaVigente[]> {
    return this.guarda("listarEntregasVigentes", this.guion.entregas ?? []);
  }
  acumularCiclosCerrados(): Promise<GrupoCiclo[]> {
    return this.guarda("acumularCiclosCerrados", this.guion.ciclos ?? []);
  }
  totalesDeControl(): Promise<MedidasReconciliables> {
    return this.guarda("totalesDeControl", { ...CERO, ...(this.guion.totales ?? {}) });
  }

  async escribirFecha(escritura: EscrituraFecha): Promise<ResultadoEscritura> {
    this.escrituras.push(escritura);
    const respaldo = new Map(this.tabla);
    const marcaCorrida = ++this.marca;
    for (const fila of escritura.filas) {
      this.tabla.set(`${escritura.fecha}|${claveDeCubo(fila)}`, {
        fecha: escritura.fecha,
        fila,
        updatedAt: marcaCorrida,
      });
    }
    let filasRetiradas = 0;
    for (const [k, v] of [...this.tabla]) {
      if (v.fecha === escritura.fecha && v.updatedAt < marcaCorrida) {
        this.tabla.delete(k);
        filasRetiradas++;
      }
    }
    try {
      escritura.verificarReconciliacion(this.sumasDe(escritura.fecha));
    } catch (error) {
      // ROLLBACK: la transaccion aborta y la fecha queda EXACTAMENTE como estaba.
      this.tabla.clear();
      for (const [k, v] of respaldo) this.tabla.set(k, v);
      throw error;
    }
    return { filasEscritas: escritura.filas.length, filasRetiradas };
  }

  private sumasDe(fecha: string): MedidasReconciliables {
    const filas = [...this.tabla.values()].filter((v) => v.fecha === fecha).map((v) => v.fila);
    const total = (f: (x: FilaRollup) => number) => filas.map(f).reduce((a, b) => a + b, 0);
    return {
      ordenesCreadas: total((x) => x.ordenesCreadas),
      ordenesEstadoStock: total((x) => x.ordenesEstadoStock),
      entregas: total((x) => x.entregas),
      devoluciones: total((x) => x.devoluciones),
      rechazos: total((x) => x.rechazos),
      reprogramaciones: total((x) => x.reprogramaciones),
      incidentes: total((x) => x.incidentes),
    };
  }

  filasDe(fecha: string): FilaRollup[] {
    return [...this.tabla.values()].filter((v) => v.fecha === fecha).map((v) => v.fila);
  }
}

class ContadorIntentosFake implements ContadorIntentos {
  llamadas = 0;
  readonly lotes: string[][] = [];
  constructor(private readonly intentos: Record<string, number> = {}) {}
  contarIntentosEnLote(ordenIds: string[]): Promise<Map<string, number>> {
    this.llamadas++;
    this.lotes.push([...ordenIds]);
    const m = new Map<string, number>();
    for (const id of ordenIds) {
      const n = this.intentos[id];
      if (n !== undefined && n > 0) m.set(id, n); // R14 de la 160: los de 0 NO vienen
    }
    return Promise.resolve(m);
  }
}

/** Reloj inyectado que avanza 7 ms por lectura: el `ms` del resumen es observable (R8/R47). */
function relojQueAvanza(paso = 7): () => Date {
  let t = Date.parse("2026-07-16T06:30:00.000Z");
  return () => {
    const ahora = new Date(t);
    t += paso;
    return ahora;
  };
}

function construir(guion: Guion, intentos: Record<string, number> = {}) {
  const repo = new RepoEnMemoria(guion);
  const contador = new ContadorIntentosFake(intentos);
  const avisos: string[] = [];
  const service = new AnaliticaRollupService(repo, contador, {
    now: relojQueAvanza(),
    logger: { warn: (m) => avisos.push(m) },
  });
  return { repo, contador, service, avisos };
}

const gestion = (p: Partial<GrupoGestiones>): GrupoGestiones => ({
  zonaId: ZONA_A,
  tiendaId: TIENDA,
  mensajeroId: MENSA_1,
  estatusId: ESTATUS_ENTREGADA,
  causaDevolucion: null,
  entregas: 0,
  devoluciones: 0,
  rechazos: 0,
  reprogramaciones: 0,
  incidentes: 0,
  ...p,
});

const filaDe = (repo: RepoEnMemoria, pred: (f: FilaRollup) => boolean): FilaRollup => {
  const encontrada = repo.filasDe(FECHA).find(pred);
  if (encontrada === undefined) {
    throw new Error(`no hay fila que cumpla el predicado; hay ${repo.filasDe(FECHA).length}`);
  }
  return encontrada;
};

/* -------------------------------------------------------------------------- */
/* R10, R22, R23, R25 — medidas de orden y sus coordenadas                     */
/* -------------------------------------------------------------------------- */

describe("R10/R25 — `ordenes_creadas` y el cubo sin asignar", () => {
  it("escribe el conteo del grupo con `mensajero_id = NULL`, sin centinela ni descarte", async () => {
    const { repo, service } = construir({
      creadas: [
        {
          zonaId: ZONA_A,
          tiendaId: TIENDA,
          mensajeroId: null,
          estatusId: ESTATUS_EN_REPARTO,
          ordenesCreadas: 3,
        },
      ],
      totales: { ordenesCreadas: 3 },
    });

    const resumen = await service.agregarFecha(FECHA);

    expect(resumen.filasEscritas).toBe(1);
    const fila = filaDe(repo, () => true);
    expect(fila.mensajeroId).toBeNull();
    expect(fila.ordenesCreadas).toBe(3);
    // R15: una fila de medidas de orden nunca lleva causa de devolucion.
    expect(fila.causaDevolucion).toBeNull();
  });

  it("no funde cubos de zonas distintas: cada `GROUP BY` real es una fila (R26/R33)", async () => {
    const { repo, service } = construir({
      creadas: [
        {
          zonaId: ZONA_A,
          tiendaId: TIENDA,
          mensajeroId: MENSA_1,
          estatusId: ESTATUS_EN_REPARTO,
          ordenesCreadas: 2,
        },
        {
          zonaId: ZONA_B,
          tiendaId: TIENDA,
          mensajeroId: MENSA_1,
          estatusId: ESTATUS_EN_REPARTO,
          ordenesCreadas: 5,
        },
      ],
      totales: { ordenesCreadas: 7 },
    });

    await service.agregarFecha(FECHA);

    expect(repo.filasDe(FECHA)).toHaveLength(2);
    expect(filaDe(repo, (f) => f.zonaId === ZONA_A).ordenesCreadas).toBe(2);
    expect(filaDe(repo, (f) => f.zonaId === ZONA_B).ordenesCreadas).toBe(5);
  });
});

describe("R11/R12 — `ordenes_estado_stock` comparte cubo con `ordenes_creadas`", () => {
  it("una orden creada y viva el mismo dia produce UNA fila con las dos medidas", async () => {
    const coord = {
      zonaId: ZONA_A,
      tiendaId: TIENDA,
      mensajeroId: MENSA_1,
      estatusId: ESTATUS_EN_REPARTO,
    };
    const { repo, service } = construir({
      creadas: [{ ...coord, ordenesCreadas: 1 }],
      stock: [{ ...coord, ordenesEstadoStock: 1 }],
      totales: { ordenesCreadas: 1, ordenesEstadoStock: 1 },
    });

    await service.agregarFecha(FECHA);

    expect(repo.filasDe(FECHA)).toHaveLength(1);
    const fila = filaDe(repo, () => true);
    expect(fila.ordenesCreadas).toBe(1);
    expect(fila.ordenesEstadoStock).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* R13-R16, R22, R23 — medidas de gestion                                      */
/* -------------------------------------------------------------------------- */

describe("R13/R15/R16 — las cinco medidas de gestion y la causa de devolucion", () => {
  it("la causa viaja SOLO en la fila de devoluciones: entregar y devolver da DOS filas", async () => {
    const { repo, service } = construir({
      gestiones: [
        gestion({ entregas: 2 }),
        gestion({ devoluciones: 1, causaDevolucion: "not_found" }),
      ],
      totales: { entregas: 2, devoluciones: 1 },
    });

    await service.agregarFecha(FECHA);

    expect(repo.filasDe(FECHA)).toHaveLength(2);
    const conCausa = filaDe(repo, (f) => f.causaDevolucion === "not_found");
    expect(conCausa.devoluciones).toBe(1);
    // Mutacion de R15: propagar la causa a la fila de entregas pondria esto en 2.
    expect(conCausa.entregas).toBe(0);
    const sinCausa = filaDe(repo, (f) => f.causaDevolucion === null);
    expect(sinCausa.entregas).toBe(2);
    expect(sinCausa.devoluciones).toBe(0);
  });

  it("una devolucion SIN causa tipificada produce `NULL`, nunca un cubo «otro»", async () => {
    const { repo, service } = construir({
      gestiones: [gestion({ devoluciones: 1, causaDevolucion: null })],
      totales: { devoluciones: 1 },
    });

    await service.agregarFecha(FECHA);

    const fila = filaDe(repo, () => true);
    expect(fila.causaDevolucion).toBeNull();
    expect(fila.devoluciones).toBe(1);
  });

  it("materializa `incidentes` (cuarto termino del denominador) y no inventa `sin_gestionar`", async () => {
    const { repo, service } = construir({
      gestiones: [gestion({ incidentes: 1, rechazos: 2, reprogramaciones: 3 })],
      totales: { incidentes: 1, rechazos: 2, reprogramaciones: 3 },
    });

    await service.agregarFecha(FECHA);

    const fila = filaDe(repo, () => true);
    expect(fila.incidentes).toBe(1);
    expect(fila.rechazos).toBe(2);
    expect(fila.reprogramaciones).toBe(3);
    expect(Object.keys(fila)).not.toContain("sinGestionar");
  });

  it("zona y tienda son las que trae la gestion desde la ORDEN, no las del mensajero (R22)", async () => {
    // El repositorio devuelve la zona DE LA ORDEN (zona A) aunque el mensajero sea de la B; el
    // servicio no puede reescribirla ni deducirla de ninguna otra parte.
    const { repo, service } = construir({
      gestiones: [gestion({ zonaId: ZONA_A, mensajeroId: MENSA_2, entregas: 1 })],
      entregas: [
        {
          ordenId: "o-1",
          zonaId: ZONA_A,
          tiendaId: TIENDA,
          mensajeroId: MENSA_2,
          estatusId: ESTATUS_ENTREGADA,
        },
      ],
      totales: { entregas: 1 },
    });

    await service.agregarFecha(FECHA);

    const fila = filaDe(repo, () => true);
    expect(fila.zonaId).toBe(ZONA_A);
    expect(fila.mensajeroId).toBe(MENSA_2);
  });

  it("las medidas de orden y las de gestion NO comparten fuente de mensajero (R23)", async () => {
    // Orden desasignada despues de gestionar: el cubo de orden lleva `NULL` y el de gestion
    // lleva el mensajero que actuo. Son DOS filas; fundirlas seria la mutacion de R23.
    const { repo, service } = construir({
      creadas: [
        {
          zonaId: ZONA_A,
          tiendaId: TIENDA,
          mensajeroId: null,
          estatusId: ESTATUS_ENTREGADA,
          ordenesCreadas: 1,
        },
      ],
      gestiones: [gestion({ estatusId: ESTATUS_ENTREGADA, entregas: 1 })],
      entregas: [
        {
          ordenId: "o-1",
          zonaId: ZONA_A,
          tiendaId: TIENDA,
          mensajeroId: MENSA_1,
          estatusId: ESTATUS_ENTREGADA,
        },
      ],
      totales: { ordenesCreadas: 1, entregas: 1 },
    });

    await service.agregarFecha(FECHA);

    expect(repo.filasDe(FECHA)).toHaveLength(2);
    expect(filaDe(repo, (f) => f.mensajeroId === null).ordenesCreadas).toBe(1);
    expect(filaDe(repo, (f) => f.mensajeroId === MENSA_1).entregas).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* R17, R18 — primer intento                                                   */
/* -------------------------------------------------------------------------- */

describe("R17 — `primer_intento_ok` sale del punto unico de la 160, en UNA llamada", () => {
  it("cuenta solo las entregas con 0 intentos previos vigentes, en el cubo de su entrega", async () => {
    const { repo, service } = construir(
      {
        gestiones: [gestion({ entregas: 2 })],
        entregas: [
          {
            ordenId: "o-primera",
            zonaId: ZONA_A,
            tiendaId: TIENDA,
            mensajeroId: MENSA_1,
            estatusId: ESTATUS_ENTREGADA,
          },
          {
            ordenId: "o-tras-devolucion",
            zonaId: ZONA_A,
            tiendaId: TIENDA,
            mensajeroId: MENSA_1,
            estatusId: ESTATUS_ENTREGADA,
          },
        ],
        totales: { entregas: 2 },
      },
      { "o-tras-devolucion": 1 },
    );

    await service.agregarFecha(FECHA);

    const fila = filaDe(repo, () => true);
    expect(fila.entregas).toBe(2);
    expect(fila.primerIntentoOk).toBe(1);
  });

  it("consulta el historial UNA sola vez para todo el lote, con los ids deduplicados", async () => {
    const entrega = (ordenId: string): EntregaVigente => ({
      ordenId,
      zonaId: ZONA_A,
      tiendaId: TIENDA,
      mensajeroId: MENSA_1,
      estatusId: ESTATUS_ENTREGADA,
    });
    const { service, contador } = construir({
      gestiones: [gestion({ entregas: 3 })],
      entregas: [entrega("o-1"), entrega("o-2"), entrega("o-1")],
      totales: { entregas: 3 },
    });

    await service.agregarFecha(FECHA);

    expect(contador.llamadas).toBe(1); // nada de N+1
    expect(contador.lotes[0].sort()).toEqual(["o-1", "o-2"]);
  });

  it("con el dia sin entregas no consulta el historial en absoluto", async () => {
    const { service, contador } = construir({});
    await service.agregarFecha(FECHA);
    expect(contador.llamadas).toBe(0);
  });
});

describe("R18 — `primer_intento_ok <= entregas` se comprueba ANTES de tocar la base", () => {
  it("lanza un error propio con la fecha y el cubo, y no llama a `escribirFecha`", async () => {
    // Entrega atribuida a un cubo en el que Q3 no cuenta ninguna entrega: exactamente el
    // desajuste que el CHECK `analytics_daily_pio_lte_entregas` rechazaria en la base.
    const { repo, service } = construir({
      entregas: [
        {
          ordenId: "o-1",
          zonaId: ZONA_A,
          tiendaId: TIENDA,
          mensajeroId: MENSA_1,
          estatusId: ESTATUS_ENTREGADA,
        },
      ],
    });

    await expect(service.agregarFecha(FECHA)).rejects.toBeInstanceOf(
      PrimerIntentoIncoherenteError,
    );
    expect(repo.escrituras).toHaveLength(0);
    expect(repo.tabla.size).toBe(0);
  });

  it("el mensaje nombra la fecha y los dos numeros, sin PII", async () => {
    const { service } = construir({
      entregas: [
        {
          ordenId: "guia-98765-perez",
          zonaId: ZONA_A,
          tiendaId: TIENDA,
          mensajeroId: MENSA_1,
          estatusId: ESTATUS_ENTREGADA,
        },
      ],
    });

    const error = await service.agregarFecha(FECHA).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PrimerIntentoIncoherenteError);
    const err = error as PrimerIntentoIncoherenteError;
    expect(err.message).toContain(FECHA);
    expect(err.primerIntentoOk).toBe(1);
    expect(err.entregas).toBe(0);
    // Ni ids de orden ni nada que venga del cliente: solo ids de catalogo.
    expect(err.message).not.toMatch(/guia-98765-perez/);
  });
});

/* -------------------------------------------------------------------------- */
/* R19-R21, R32 — tiempo de ciclo y BigInt                                     */
/* -------------------------------------------------------------------------- */

describe("R19/R20/R21 — tiempo de ciclo: numerador y denominador, nunca el promedio", () => {
  it("escribe `seg_ciclo_acum` como BigInt junto a su `seg_ciclo_n`", async () => {
    const { repo, service } = construir({
      ciclos: [
        {
          zonaId: ZONA_A,
          tiendaId: TIENDA,
          mensajeroId: MENSA_1,
          estatusId: ESTATUS_ENTREGADA,
          segCicloAcum: BigInt(432_000),
          segCicloN: 1,
        },
      ],
    });

    await service.agregarFecha(FECHA);

    const fila = filaDe(repo, () => true);
    expect(fila.segCicloAcum).toBe(BigInt(432_000));
    expect(fila.segCicloN).toBe(1);
    expect(Object.keys(fila)).not.toContain("segCicloPromedio");
  });

  it("nunca escribe una fila con `seg_ciclo_n = 0` y `seg_ciclo_acum > 0`", async () => {
    const { repo, service } = construir({
      creadas: [
        {
          zonaId: ZONA_A,
          tiendaId: TIENDA,
          mensajeroId: MENSA_1,
          estatusId: ESTATUS_EN_REPARTO,
          ordenesCreadas: 1,
        },
      ],
      totales: { ordenesCreadas: 1 },
    });

    await service.agregarFecha(FECHA);

    for (const f of repo.filasDe(FECHA)) {
      expect(f.segCicloN > 0 || f.segCicloAcum === BigInt(0)).toBe(true);
    }
  });
});

describe("R32 — el resumen de la corrida no lleva `BigInt`", () => {
  it("`JSON.stringify` del resumen no lanza", async () => {
    const { service } = construir({
      ciclos: [
        {
          zonaId: ZONA_A,
          tiendaId: TIENDA,
          mensajeroId: MENSA_1,
          estatusId: ESTATUS_ENTREGADA,
          segCicloAcum: BigInt("9007199254740993"),
          segCicloN: 4,
        },
      ],
    });

    const resumen = await service.agregarFecha(FECHA);

    expect(() => JSON.stringify(resumen)).not.toThrow();
    expect(JSON.parse(JSON.stringify(resumen))).toEqual({
      fecha: FECHA,
      filasEscritas: 1,
      filasRetiradas: 0,
      ms: expect.any(Number),
    });
    for (const valor of Object.values(resumen)) expect(typeof valor).not.toBe("bigint");
  });
});

/* -------------------------------------------------------------------------- */
/* R33, R34 — contencion de la fila de totalizacion                            */
/* -------------------------------------------------------------------------- */

describe("R33/R34 — la reconciliacion ABORTA la transaccion", () => {
  it("una fila de totalizacion inyectada rompe la igualdad y la fecha queda SIN escribir", async () => {
    // El repositorio devuelve los dos grupos finos... y ademas un tercero con la zona A y la
    // SUMA del dia, que es exactamente la fila de totalizacion que R33 prohibe.
    const { repo, service } = construir({
      creadas: [
        {
          zonaId: ZONA_A,
          tiendaId: TIENDA,
          mensajeroId: MENSA_1,
          estatusId: ESTATUS_EN_REPARTO,
          ordenesCreadas: 2,
        },
        {
          zonaId: ZONA_B,
          tiendaId: TIENDA,
          mensajeroId: MENSA_1,
          estatusId: ESTATUS_EN_REPARTO,
          ordenesCreadas: 5,
        },
        {
          zonaId: ZONA_A,
          tiendaId: TIENDA,
          mensajeroId: MENSA_2, // el «cubo TODOS» disfrazado de coordenada real
          estatusId: ESTATUS_EN_REPARTO,
          ordenesCreadas: 7,
        },
      ],
      totales: { ordenesCreadas: 7 },
    });

    const error = await service.agregarFecha(FECHA).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ReconciliacionError);
    const err = error as ReconciliacionError;
    expect(err.medida).toBe("ordenesCreadas");
    expect(err.fecha).toBe(FECHA);
    expect(err.message).toContain("ordenesCreadas");
    expect(err.message).toContain(FECHA);
    expect(err.sumaEscrita).toBe(14);
    expect(err.totalEsperado).toBe(7);
    // ROLLBACK real: la fecha no quedo escrita ni a medias.
    expect(repo.filasDe(FECHA)).toEqual([]);
  });

  it("caza tambien el doble conteo por JOIN, que es el fallo mas probable", async () => {
    const { repo, service } = construir({
      gestiones: [gestion({ entregas: 4 })], // el JOIN duplico: de verdad hubo 2
      entregas: [],
      totales: { entregas: 2 },
    });

    const error = await service.agregarFecha(FECHA).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ReconciliacionError);
    expect((error as ReconciliacionError).medida).toBe("entregas");
    expect(repo.filasDe(FECHA)).toEqual([]);
  });

  it("cuando todo cuadra, la reconciliacion deja pasar la escritura", async () => {
    const { repo, service } = construir({
      gestiones: [gestion({ entregas: 2, devoluciones: 1 })],
      totales: { entregas: 2, devoluciones: 1 },
    });

    await expect(service.agregarFecha(FECHA)).resolves.toMatchObject({ filasEscritas: 1 });
    expect(repo.filasDe(FECHA)).toHaveLength(1);
  });

  it("comprueba las SIETE medidas, no solo la primera", async () => {
    const { service } = construir({
      gestiones: [gestion({ incidentes: 3 })],
      totales: { incidentes: 1 },
    });

    const error = await service.agregarFecha(FECHA).catch((e: unknown) => e);
    expect((error as ReconciliacionError).medida).toBe("incidentes");
  });
});

/* -------------------------------------------------------------------------- */
/* R27, R29, R35 — idempotencia, rancias y una sola fecha                      */
/* -------------------------------------------------------------------------- */

describe("R27/R29/R35 — recomputo de una fecha", () => {
  it("dos corridas con los mismos datos dejan el mismo conjunto de filas", async () => {
    const guion: Guion = {
      gestiones: [gestion({ entregas: 2 })],
      totales: { entregas: 2 },
    };
    const { repo, service } = construir(guion);

    await service.agregarFecha(FECHA);
    const primera = repo.filasDe(FECHA);
    await service.agregarFecha(FECHA);
    const segunda = repo.filasDe(FECHA);

    expect(segunda).toEqual(primera);
    expect(segunda).toHaveLength(1);
  });

  it("la corrida entrega TODAS las filas de la fecha de golpe, para que el barrido sea completo", async () => {
    // R29 vive en el repositorio (`retirarFilasRancias`), pero depende de que el servicio no
    // escriba por partes: si `escribirFecha` se llamara mas de una vez por corrida, el barrido
    // de la segunda llamada borraria lo que escribio la primera.
    const { repo, service } = construir({
      creadas: [
        {
          zonaId: ZONA_A,
          tiendaId: TIENDA,
          mensajeroId: MENSA_1,
          estatusId: ESTATUS_EN_REPARTO,
          ordenesCreadas: 1,
        },
      ],
      gestiones: [gestion({ entregas: 1 })],
      totales: { ordenesCreadas: 1, entregas: 1 },
    });

    await service.agregarFecha(FECHA);

    expect(repo.escrituras).toHaveLength(1);
    expect(repo.escrituras[0].filas).toHaveLength(2);
  });

  it("solo escribe la fecha pedida: nunca otra (R35)", async () => {
    const { repo, service } = construir({
      gestiones: [gestion({ entregas: 1 })],
      totales: { entregas: 1 },
    });

    await service.agregarFecha(FECHA);

    expect(repo.escrituras.map((e) => e.fecha)).toEqual([FECHA]);
    expect([...repo.tabla.values()].every((v) => v.fecha === FECHA)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* R46, R47 — dia vacio, resumen y volumen                                     */
/* -------------------------------------------------------------------------- */

describe("R46 — el dia sin datos termina con exito y CERO filas", () => {
  it("no escribe una fila «todo a cero»", async () => {
    const { repo, service } = construir({});

    const resumen = await service.agregarFecha(FECHA);

    expect(resumen.filasEscritas).toBe(0);
    expect(repo.filasDe(FECHA)).toEqual([]);
    expect(repo.escrituras[0].filas).toEqual([]);
  });

  it("tampoco escribe un cubo cuyas medidas salieron todas a cero", async () => {
    const { repo, service } = construir({
      creadas: [
        {
          zonaId: ZONA_A,
          tiendaId: TIENDA,
          mensajeroId: MENSA_1,
          estatusId: ESTATUS_EN_REPARTO,
          ordenesCreadas: 0,
        },
      ],
    });

    await service.agregarFecha(FECHA);

    expect(repo.filasDe(FECHA)).toEqual([]);
  });
});

describe("R47 — la corrida SIEMPRE reporta filas escritas, retiradas y milisegundos", () => {
  it("el resumen lleva las tres cifras y la fecha agregada", async () => {
    const { service } = construir({
      gestiones: [gestion({ entregas: 1 })],
      totales: { entregas: 1 },
    });

    const resumen = await service.agregarFecha(FECHA);

    expect(resumen.fecha).toBe(FECHA);
    expect(resumen.filasEscritas).toBe(1);
    expect(resumen.filasRetiradas).toBe(0);
    expect(resumen.ms).toBeGreaterThan(0); // reloj inyectado: 7 ms por lectura
    expect(Object.keys(resumen).sort()).toEqual(["fecha", "filasEscritas", "filasRetiradas", "ms"]);
  });

  it("informa las filas retiradas cuando un cubo desaparece entre corridas", async () => {
    const repo = new RepoEnMemoria({
      gestiones: [gestion({ entregas: 1 })],
      totales: { entregas: 1 },
    });
    const service = new AnaliticaRollupService(repo, new ContadorIntentosFake(), {
      now: relojQueAvanza(),
    });
    await service.agregarFecha(FECHA);

    // Segunda corrida: la gestion se anulo, el cubo ya no se produce.
    const repoVacio = new RepoEnMemoria({});
    // La fila sobrevive de la corrida ANTERIOR, asi que su `updated_at` es anterior a la
    // marca de la corrida nueva: es exactamente una fila RANCIA (R29).
    for (const [k, v] of repo.tabla) repoVacio.tabla.set(k, { ...v, updatedAt: 0 });
    const service2 = new AnaliticaRollupService(repoVacio, new ContadorIntentosFake(), {
      now: relojQueAvanza(),
    });

    const resumen = await service2.agregarFecha(FECHA);

    expect(resumen.filasEscritas).toBe(0);
    expect(resumen.filasRetiradas).toBe(1);
    expect(repoVacio.filasDe(FECHA)).toEqual([]);
  });

  it("no avisa de volumen por debajo del umbral provisional", async () => {
    const { avisos, service } = construir({
      gestiones: [gestion({ entregas: 1 })],
      totales: { entregas: 1 },
    });
    await service.agregarFecha(FECHA);
    expect(avisos).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* R37, R38 — errores con contexto y sin PII                                   */
/* -------------------------------------------------------------------------- */

describe("R38 — el error se propaga con fecha y etapa, y NO se traga", () => {
  const etapas: [NonNullable<Guion["fallaEn"]>, string][] = [
    ["contarOrdenesCreadas", "ordenes_creadas"],
    ["contarOrdenesEnEstadoAlCorte", "ordenes_estado_stock"],
    ["contarGestionesVigentes", "gestiones"],
    ["listarEntregasVigentes", "entregas_vigentes"],
    ["acumularCiclosCerrados", "ciclos_cerrados"],
    ["totalesDeControl", "totales_de_control"],
  ];

  for (const [metodo, etapa] of etapas) {
    it(`un fallo en ${metodo} propaga la etapa \`${etapa}\``, async () => {
      const { service } = construir({ fallaEn: metodo });

      const error = await service.agregarFecha(FECHA).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(AnaliticaRollupError);
      const err = error as AnaliticaRollupError;
      expect(err.etapa).toBe(etapa);
      expect(err.fecha).toBe(FECHA);
      expect(err.message).toContain(FECHA);
      expect((err.cause as Error).message).toContain("fallo simulado");
    });
  }

  it("un fallo de la escritura se propaga con la etapa `escritura`", async () => {
    const repo = new RepoEnMemoria({});
    repo.escribirFecha = () => Promise.reject(new Error("deadlock simulado"));
    const service = new AnaliticaRollupService(repo, new ContadorIntentosFake(), {
      now: relojQueAvanza(),
    });

    const error = await service.agregarFecha(FECHA).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AnaliticaRollupError);
    expect((error as AnaliticaRollupError).etapa).toBe("escritura");
  });

  it("el mensaje no filtra datos de dominio (R37)", async () => {
    const { service } = construir({ fallaEn: "contarGestionesVigentes" });
    const error = (await service.agregarFecha(FECHA).catch((e: unknown) => e)) as Error;
    expect(error.message).toBe(`rollup analitica ${FECHA}: fallo en la etapa gestiones`);
  });
});

/* -------------------------------------------------------------------------- */
/* Guardias de texto sobre el SQL del repositorio                              */
/* -------------------------------------------------------------------------- */

// Las consultas viven en SQL y no se pueden ejercer sin Postgres; los casos con datos
// sembrados son la suite de integracion (design §12). Lo que SI se puede fijar aqui —y hace
// falta, porque son las mutaciones mas baratas de introducir— es que el texto de esas
// consultas conserve las cuatro decisiones que las gobiernan: cota estricta del corte,
// desempate determinista, exclusion de borradas/anuladas y origen de las coordenadas.

const ROOT = path.join(__dirname, "..", "..", "..");
const leer = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const sinComentarios = quitarComentarios;

const FUENTE_REPO = sinComentarios(leer("lib/repositories/AnaliticaRollupRepository.ts"));
const FUENTE_SERVICE = sinComentarios(leer("lib/services/AnaliticaRollupService.ts"));

describe("R24 — el estatus congelado: cota ESTRICTA y desempate determinista", () => {
  it("compara `created_at <` contra el corte, nunca `<=`", () => {
    expect(FUENTE_REPO).toMatch(/h\."created_at" < \$\{corte\}/);
    expect(FUENTE_REPO).not.toMatch(/"created_at"\s*<=/);
  });

  it("desempata por `id DESC` ademas de por `created_at DESC`", () => {
    expect(FUENTE_REPO).toMatch(
      /ORDER BY h\."orden_id", h\."created_at" DESC, h\."id" DESC/,
    );
  });

  it("toma la ULTIMA transicion del dia, no la primera", () => {
    expect(FUENTE_REPO).not.toMatch(/"created_at" ASC/);
  });

  it("no lee `orden.estatus_id` en vivo", () => {
    expect(FUENTE_REPO).not.toMatch(/o\."estatus_id"/);
  });
});

describe("R7/R48 — toda consulta esta acotada por la ventana o por el universo B2", () => {
  it("la ventana es semiabierta: `>= desde` y `< hasta`, nunca `<= hasta`", () => {
    expect(FUENTE_REPO).toMatch(/>= \$\{ventana\.desde\}/);
    expect(FUENTE_REPO).toMatch(/<\s+\$\{ventana\.hasta\}/);
    expect(FUENTE_REPO).not.toMatch(/<= \$\{ventana\.hasta\}/);
  });

  it("no importa `startOfDayCR` (R6)", () => {
    expect(FUENTE_REPO).not.toMatch(/startOfDayCR/);
    expect(FUENTE_SERVICE).not.toMatch(/startOfDayCR/);
  });

  it("el universo del stock excluye los terminales viejos y admite los que cerraron hoy (D2)", () => {
    expect(FUENTE_REPO).toMatch(/s\."value" NOT IN \(\$\{TERMINALES\}\)/);
    expect(FUENTE_REPO).toMatch(/terminal_en_ventana/);
  });

  it("los terminales salen de `ESTADOS_TERMINALES`, no de una lista reescrita", () => {
    expect(FUENTE_REPO).toMatch(
      /import \{ ESTADOS_TERMINALES \} from "@\/lib\/types\/order-status-transiciones"/,
    );
    for (const inventado of ["'entregada'", "'devuelta_a_tienda'"]) {
      expect(FUENTE_REPO.includes(`s."value" = ${inventado}`)).toBe(false);
    }
  });
});

describe("R10/R13/D7 — borradas y anuladas fuera de TODO", () => {
  it("las cinco consultas de dominio filtran `deleted_at IS NULL`", () => {
    const ocurrencias = FUENTE_REPO.match(/"deleted_at" IS NULL/g) ?? [];
    // Q1, Q2, Q3, Q4, Q5 + los tres escalares de Q6 que tocan `orden`.
    expect(ocurrencias.length).toBeGreaterThanOrEqual(7);
  });

  it("las medidas de gestion filtran `anulada_at IS NULL`", () => {
    const ocurrencias = FUENTE_REPO.match(/"anulada_at" IS NULL/g) ?? [];
    expect(ocurrencias.length).toBeGreaterThanOrEqual(3); // Q3, Q4 y los escalares de Q6
  });
});

describe("R22/R23 — de donde sale cada coordenada", () => {
  it("zona y tienda vienen de la ORDEN, y no hay ni una lectura de la zona del usuario", () => {
    expect(FUENTE_REPO).toMatch(/o\."zona_id"\s+AS zona_id/);
    expect(FUENTE_REPO).toMatch(/o\."tienda_id"\s+AS tienda_id/);
    expect(FUENTE_REPO).not.toMatch(/u\."zona_id"|"usuario"|usuario\./);
  });

  it("el mensajero de las medidas de gestion sale de la GESTION", () => {
    expect(FUENTE_REPO).toMatch(/g\."mensajero_id" AS mensajero_id/);
  });

  it("el mensajero de las medidas de orden sale de la ORDEN (nullable = sin asignar)", () => {
    expect(FUENTE_REPO).toMatch(/o\."mensajero_asignado_id"\s+AS mensajero_id/);
  });
});

describe("R17/R26 — lo que el escritor NO contiene", () => {
  it("no reimplementa el criterio de intento con un COUNT propio sobre el historial", () => {
    const historialConCount = /COUNT\([^)]*\)[\s\S]{0,200}orden_historial_estado[\s\S]{0,200}devuelta/i;
    expect(FUENTE_REPO).not.toMatch(historialConCount);
    // El criterio unico se consume desde el servicio, via el contrato de la 160.
    expect(FUENTE_SERVICE).toMatch(/contarIntentosEnLote/);
  });

  it("no hay ningun literal de coordenada (uuid) en el escritor", () => {
    const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    expect(FUENTE_REPO).not.toMatch(uuid);
    expect(FUENTE_SERVICE).not.toMatch(uuid);
  });

  it("no calcula tasas, promedios ni porcentajes (R21)", () => {
    expect(FUENTE_REPO).not.toMatch(/AVG\(|::float|::numeric|porcentaje|promedio/i);
  });
});

describe("R28/R29/R30 — la escritura, en una sola transaccion", () => {
  it("el upsert resuelve el conflicto contra las SEIS columnas del grano", () => {
    expect(FUENTE_REPO).toMatch(
      /ON CONFLICT \("fecha", "zona_id", "tienda_id", "mensajero_id", "estatus_id", "causa_devolucion"\)/,
    );
  });

  it("hay UNA sola transaccion por corrida y ningun lote", () => {
    expect((FUENTE_REPO.match(/\$transaction\(/g) ?? []).length).toBe(1);
    expect(FUENTE_REPO).not.toMatch(/chunk|lote|batchSize/i);
  });

  it("la marca de la corrida es el `now()` de POSTGRES, no el del proceso Node", () => {
    expect(FUENTE_REPO).toMatch(/SELECT now\(\) AS marca/);
    expect(FUENTE_REPO).toMatch(/"updated_at" < \$\{marcaCorrida\}/);
  });

  it("el barrido de rancias esta clavado a la fecha de la corrida", () => {
    expect(FUENTE_REPO).toMatch(
      /DELETE FROM "analytics_daily"\s*\n\s*WHERE "fecha" = \$\{fechaDia\}::date/,
    );
  });

  it("la fecha se materializa con la convencion `@db.Date`, no con `ventana.desde`", () => {
    expect(FUENTE_REPO).toMatch(/fechaComoDate\(escritura\.fecha\)/);
    expect(FUENTE_REPO).not.toMatch(/\$\{ventana\.desde\}::date/);
  });
});

describe("R34 — Q6 no es «la misma consulta sin GROUP BY»", () => {
  it("los escalares no agrupan y no pasan por la CTE del estatus congelado", () => {
    const q6 = FUENTE_REPO.slice(FUENTE_REPO.indexOf("async totalesDeControl"));
    const cuerpo = q6.slice(0, q6.indexOf("async escribirFecha"));
    expect(cuerpo).not.toMatch(/GROUP BY/);
    expect(cuerpo).not.toMatch(/JOIN estatus_al_corte/);
    expect(cuerpo).toMatch(/EXISTS \(/);
  });
});

describe("R47 — la cifra de volumen vive en UN solo archivo", () => {
  it(`ningun modulo del job repite la cifra ${UMBRAL_AVISO_FILAS_CORRIDA}: se importa`, () => {
    // El alcance es el JOB, no todo `lib/`: que otra feature ajena use por casualidad el
    // mismo numero para otra cosa (waypoints de rutas) no es duplicar ESTE umbral. Lo que
    // R47 prohibe es que el escritor lleve la cifra escrita a mano en dos sitios.
    const literal = new RegExp(`\\b${UMBRAL_AVISO_FILAS_CORRIDA}\\b|\\b20_000\\b`);
    const infractores: string[] = [];
    const recorrer = (dir: string) => {
      for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) {
          recorrer(rel);
          continue;
        }
        if (!rel.endsWith(".ts") || rel === "lib/config/analitica-rollup.ts") continue;
        const texto = sinComentarios(leer(rel));
        const esDelJob = /analitica-rollup|AnaliticaRollup|rollup-dia/i.test(rel);
        if (esDelJob && literal.test(texto)) infractores.push(`${rel} (cifra a mano)`);
        // Y quien la use, la IMPORTA: nombrar la constante sin importarla es imposible.
        if (texto.includes("UMBRAL_AVISO_FILAS_CORRIDA") && !texto.includes("lib/config/analitica-rollup")) {
          infractores.push(`${rel} (usa la constante sin importarla)`);
        }
      }
    };
    recorrer("lib");
    expect(infractores).toEqual([]);
  });

  it("la constante esta declarada como provisional y no medida", () => {
    const config = leer("lib/config/analitica-rollup.ts");
    expect(config).toMatch(/PROVISIONAL Y NO MEDIDA/i);
  });
});
