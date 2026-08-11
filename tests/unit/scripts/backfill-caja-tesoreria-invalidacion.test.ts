import { describe, it, expect, vi } from "vitest";
import type { JobTipo } from "@prisma/client";
import type { EnqueueOpts, IJobRepository, JobDTO } from "@/lib/interfaces/repositories/IJobRepository";
import type {
  ICajaBackfillTesoreriaService,
  InformeBackfillCaja,
  ModoBackfillCaja,
} from "@/lib/interfaces/services/ICajaBackfillTesoreriaService";
import {
  ejecutarBackfillCajaCli,
  type EntornoBackfillCaja,
} from "@/scripts/backfill-caja-tesoreria";

// Feature 179 / T3.9 — R26: EL OCTAVO ESCRITOR. El backfill de tesoreria ENCOLA la invalidacion.
//
// ⚠ POR QUE ENCOLA Y NO LLAMA A `revalidateTag`. Este script es un proceso `tsx`, fuera de todo
// request de Next, y `revalidateTag` LANZA ahi (`Invariant: static generation store missing`,
// `node_modules/next/dist/server/web/spec-extension/revalidate.js:104-107`). El fallo aparecería
// en la corrida de mantenimiento y no en el gate, que es donde peor se descubre. D2 (humano,
// 2026-08-10) = (a): se reusa el job `analitica_invalidacion_cache` que la 128 ya tiene, con
// `{ dominio: "financiera" }` en el payload. **Sin migracion**: el valor del enum ya existe.
//
// ESTE ARCHIVO SOLO MIDE EL ENCOLADO —cuando si y cuando no—. Que el job encolado cambie de
// verdad la cifra servida lo mide `tests/unit/analytics/cache-financiera-invalidacion-backfill.
// test.ts` con el DRENADO REAL, que es el que cumple el criterio de «no basta con espiar
// `enqueue`».

const INSTANTE = "2026-12-25T18:30:00.000Z";
const URL_DE_PRUEBA = "postgresql://u:p@db.ejemplo.interno:6543/ordenex_prod";

function informe(parcial: Partial<InformeBackfillCaja> & { modo: ModoBackfillCaja }): InformeBackfillCaja {
  return {
    instante: INSTANTE,
    examinados: { cierre_aprobado: 0, pago_a_tienda: 0, anulacion_de_pago_a_tienda: 0 },
    pendientes: [],
    porCategoria: [],
    insertadas: 0,
    alDia: true,
    ...parcial,
  };
}

interface Encolado {
  tipo: JobTipo;
  payload: Record<string, unknown>;
  opts?: EnqueueOpts;
}

function arnes(opciones: {
  argv: string[];
  informe: InformeBackfillCaja;
  sinCola?: boolean;
  colaExplota?: boolean;
}) {
  const encolados: Encolado[] = [];
  const salida: string[] = [];
  const errores: string[] = [];

  const servicio: ICajaBackfillTesoreriaService = {
    async ejecutar(): Promise<InformeBackfillCaja> {
      return opciones.informe;
    },
  };

  const jobs: IJobRepository = {
    enqueue: vi.fn(async (tipo: JobTipo, payload: Record<string, unknown>, opts?: EnqueueOpts) => {
      if (opciones.colaExplota === true) throw new Error("la cola no responde");
      encolados.push({ tipo, payload, opts });
      return { id: "job-1" } as unknown as JobDTO;
    }),
  } as unknown as IJobRepository;

  const entorno: EntornoBackfillCaja = {
    argv: opciones.argv,
    env: { DATABASE_URL: URL_DE_PRUEBA },
    salida: (l) => void salida.push(l),
    errores: (l) => void errores.push(l),
    crearServicio: () => servicio,
    crearJobs: opciones.sinCola === true ? undefined : () => jobs,
  };

  return { entorno, encolados, salida, errores };
}

describe("R26 · una corrida que INSERTA encola exactamente un job de invalidacion financiera", () => {
  it("con `{ dominio: \"financiera\" }` en el payload y su clave de deduplicacion", async () => {
    const { entorno, encolados } = arnes({
      argv: ["--aplicar"],
      informe: informe({ modo: "aplicar", insertadas: 7, alDia: false }),
    });

    const codigo = await ejecutarBackfillCajaCli(entorno);

    expect(codigo).toBe(0);
    expect(encolados).toHaveLength(1);
    expect(encolados[0].tipo).toBe("analitica_invalidacion_cache");
    expect(encolados[0].payload).toEqual({ dominio: "financiera" });
    // La clave lleva el DOMINIO: sin el, una corrida del backfill operativo y otra de esta en la
    // misma ventana se deduplicarian ENTRE SI (`ON CONFLICT (dedupe_key) DO NOTHING`) y una de
    // las dos invalidaciones desapareceria sin senal.
    expect(encolados[0].opts?.dedupeKey).toContain("financiera");
  });

  it("y lo dice en la salida, para que quien corre el script sepa que falta un minuto", async () => {
    const { entorno, salida } = arnes({
      argv: ["--aplicar"],
      informe: informe({ modo: "aplicar", insertadas: 3, alDia: false }),
    });

    await ejecutarBackfillCajaCli(entorno);

    expect(salida.join("\n")).toMatch(/cache FINANCIERA encolada/);
  });
});

describe("R26 · lo que NO encola", () => {
  it("el modo EN SECO no encola nada", async () => {
    const { entorno, encolados } = arnes({
      argv: ["--simular"],
      informe: informe({ modo: "simular", insertadas: 0, alDia: false }),
    });

    await ejecutarBackfillCajaCli(entorno);

    // `insertadas` es 0 fuera de `aplicar` por contrato (R40/R42): la simulacion no escribe.
    expect(encolados).toEqual([]);
  });

  it("una corrida en `aplicar` que no encontro pendientes tampoco", async () => {
    const { entorno, encolados } = arnes({
      argv: ["--aplicar"],
      informe: informe({ modo: "aplicar", insertadas: 0, alDia: true }),
    });

    await ejecutarBackfillCajaCli(entorno);

    // Vaciar la cache financiera sin haber movido un centimo es coste sin motivo. Es la mutacion
    // simetrica: «encolar siempre» pone rojos estos dos casos.
    expect(encolados).toEqual([]);
  });

  it("`--comprobar` no encola ni cambiando el codigo de salida", async () => {
    const { entorno, encolados } = arnes({
      argv: ["--comprobar"],
      informe: informe({ modo: "comprobar", insertadas: 0, alDia: false, pendientes: [] }),
    });

    await ejecutarBackfillCajaCli(entorno);

    expect(encolados).toEqual([]);
  });
});

describe("R26 · un fallo del encolado no tumba la corrida, pero se AVISA", () => {
  it("sin cola configurada, el aviso dice que el tablero puede quedar viejo", async () => {
    const { entorno, errores } = arnes({
      argv: ["--aplicar"],
      informe: informe({ modo: "aplicar", insertadas: 5, alDia: false }),
      sinCola: true,
    });

    const codigo = await ejecutarBackfillCajaCli(entorno);

    expect(codigo).toBe(0); // el dinero ya se escribio: el codigo habla del backfill
    expect(errores.join("\n")).toMatch(/NO se ha encolado la invalidacion de la cache financiera/);
  });

  it("si la cola explota, la corrida sigue devolviendo su propio codigo y avisa", async () => {
    const { entorno, errores } = arnes({
      argv: ["--aplicar"],
      informe: informe({ modo: "aplicar", insertadas: 5, alDia: false }),
      colaExplota: true,
    });

    const codigo = await ejecutarBackfillCajaCli(entorno);

    expect(codigo).toBe(0);
    expect(errores.join("\n")).toMatch(/no se pudo encolar la invalidacion de la cache financiera/);
  });
});

describe("R21 · el script no importa `next/cache`", () => {
  it("el aislamiento lo vigila `cache-aislamiento.guardia.test.ts`, y aqui esta el motivo", async () => {
    // Si alguien sustituyera el encolado por un `revalidateTag`, este archivo seguiria verde
    // (no comprueba imports) pero el guardia de aislamiento de la 128 se pondria rojo, y la
    // corrida real lanzaria `Invariant: static generation store missing`. El reparto esta dicho
    // aqui para que nadie busque esa asercion en este archivo y concluya que falta.
    const { entorno, encolados } = arnes({
      argv: ["--aplicar"],
      informe: informe({ modo: "aplicar", insertadas: 1, alDia: false }),
    });
    await ejecutarBackfillCajaCli(entorno);
    expect(encolados).toHaveLength(1);
  });
});
