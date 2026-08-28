import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildRecurrencias } from "@/app/api/cron/procesar-jobs/route";
import {
  SIEMBRAS_RECURRENTES,
  auditarCoberturaDeSiembra,
  type HuecoDeSiembra,
} from "@/scripts/siembra-jobs-recurrentes";
import {
  ejecutarPasoDeBaseDeDatos,
  type EfectosDelPaso,
  type EntornoDelPaso,
} from "@/scripts/migrate-deploy";
import type {
  EnqueueOpts,
  IJobRepository,
  JobDTO,
} from "@/lib/interfaces/repositories/IJobRepository";
import type { JobTipo } from "@prisma/client";

// GUARDIA DE LA FICHA 313 — TODO JOB RECURRENTE TIENE SIEMBRA, Y LA SIEMBRA CUELGA DEL DESPLIEGUE.
//
// EL INCIDENTE QUE LA MOTIVA, medido contra la base de PRODUCCION el 2026-08-28. Un job
// recurrente se re-agenda SOLO DESPUES de cada corrida, asi que la serie necesita una PRIMERA
// fila. Los dos scripts que la siembran (`scripts/seed-jobs-liberar-reprogramadas.ts`, de la
// feature 90, y `scripts/seed-jobs-analitica-rollup-diario.ts`, de la 124) existian, estaban
// bien escritos y hasta tenian tests — pero NO estaban en ningun paso del despliegue y nunca se
// corrieron contra produccion. Sin primera fila no hay segunda:
//
//   - `jobs`: 0 filas de `liberar_reprogramadas` y 0 de `analitica_rollup_diario`;
//   - 0 transiciones `liberacion_reprogramada` en TODA la historia de la base;
//   - 40 ordenes atrapadas en `reprogramada` con el mensajero del dia anterior puesto,
//     invisibles al filtro de reasignables: un operador que no podia trabajar;
//   - el rollup diario no se escribio NUNCA, y eso no lo reporto nadie.
//
// Ningun test se puso rojo. El build salio verde dos dias. La unica senal fue humana.
//
// QUE VIGILA ESTA GUARDIA, en cuatro frentes, y por que este reparto:
//
//   1. COBERTURA. Todo tipo con recurrencia registrada en `buildRecurrencias()` tiene su
//      entrada en `SIEMBRAS_RECURRENTES`, y al reves. Es el censo que nadie tenia: los tests
//      de registro (`procesar-jobs-registro`, `jobs-registro`) comprueban que el tipo esta
//      enganchado al DRENADOR, que es otra cosa — el drenador no puede procesar una fila que
//      no existe.
//   2. EQUIVALENCIA SIEMBRA <-> RECURRENCIA. La siembra encola EXACTAMENTE el mismo trabajo
//      (mismo `run_after`, misma `dedupe_key`) que la recurrencia re-agendaria para esa
//      corrida. Es lo que hace que sembrar en cada despliegue sea inofensivo: la clave choca
//      y `enqueue` hace `ON CONFLICT DO NOTHING`. Si los dos productores usaran claves
//      distintas quedarian DOS filas haciendo el mismo trabajo el mismo dia.
//   3. ENGANCHE EJECUTABLE. `ejecutarPasoDeBaseDeDatos` —lo que corre `pnpm run build` via
//      `scripts/migrate-deploy.ts`— llama a la siembra despues de migrar, no la llama cuando
//      la base no es suya, y mata el build si la siembra falla. Se EJECUTA con dobles: no se
//      lee el archivo esperando encontrar una llamada, que es justo la clase de comprobacion
//      que en agosto habria pasado en verde (los seeds estaban ahi; nadie los llamaba).
//   4. LA CADENA HASTA VERCEL. El unico eslabon que ningun test puede ejecutar es el
//      `pnpm run build` de Vercel: ese se comprueba por texto sobre `package.json`.
//
// QUE NO PUEDE COMPROBAR ESTA GUARDIA, dicho aqui para que nadie la lea como mas de lo que es:
// no hay base de produccion delante. NO afirma que la fila exista hoy en `jobs`, ni que el
// ultimo despliegue corriera, ni que `DATABASE_URL` del build apunte a donde debe, ni que el
// cron de Vercel drene la cola. Afirma la CADENA ESTRUCTURAL: tipo recurrente -> siembra
// declarada -> siembra invocada por el paso de despliegue -> paso invocado por el build. Lo
// que fallo en agosto fue un eslabon de esa cadena, no la base.
//
// AUTOCOMPROBACION (obligatoria, `docs/verification.md`): cada frente lleva su control
// positivo, incluido el caso de la GUARDIA VACIA —censo sin nada que mirar— que en esta
// familia es el modo de fallo tipico. Una guardia que no se sabe romper no protege nada.

/* -------------------------------------------------------------------------- */
/* Frente 1 — cobertura: todo recurrente tiene siembra                        */
/* -------------------------------------------------------------------------- */

/** Raiz del repo: esta guardia lee `package.json` y comprueba rutas declaradas. */
const RAIZ = path.join(__dirname, "..", "..", "..");

const TIPOS_RECURRENTES: readonly string[] = [...buildRecurrencias().keys()];
const TIPOS_SEMBRADOS: readonly string[] = SIEMBRAS_RECURRENTES.map((s) => s.tipo);

/** Resumen legible de un hueco, para que el rojo diga que falta sin abrir el codigo. */
function describir(hueco: HuecoDeSiembra): string {
  return hueco.clase === "censo_vacio"
    ? `${hueco.clase}: ${hueco.detalle}`
    : `${hueco.clase} (${hueco.tipo}): ${hueco.detalle}`;
}

describe("313 · frente 1 — todo job recurrente tiene su siembra registrada", () => {
  it("no hay ningun tipo recurrente sin siembra (ni siembra sin recurrencia)", () => {
    const huecos = auditarCoberturaDeSiembra(TIPOS_RECURRENTES, TIPOS_SEMBRADOS);
    expect(
      huecos.map(describir),
      "un tipo recurrente sin siembra NO falla en ninguna parte: la cola se queda vacia y el " +
        "trabajo simplemente no ocurre. Anade la siembra a SIEMBRAS_RECURRENTES " +
        "(scripts/siembra-jobs-recurrentes.ts).",
    ).toEqual([]);
  });

  it("los dos censos siguen encontrando algo que mirar", () => {
    // ANTI-VACUIDAD. Si `buildRecurrencias` se renombra o el registro se vacia, el frente 1
    // pasaria a comparar dos listas vacias y seguiria verde para siempre.
    expect(TIPOS_RECURRENTES.length, "el censo de recurrencias salio vacio").toBeGreaterThan(0);
    expect(TIPOS_SEMBRADOS.length, "el registro de siembras salio vacio").toBeGreaterThan(0);
    // Y los dos que hay hoy, por su nombre: si desaparecen, que sea con un rojo delante.
    expect([...TIPOS_RECURRENTES].sort()).toEqual([
      "analitica_rollup_diario",
      "liberar_reprogramadas",
    ]);
  });

  it("cada siembra declara que se rompe si no corre (el motivo no se borra con el codigo)", () => {
    for (const siembra of SIEMBRAS_RECURRENTES) {
      expect(siembra.siNoCorre.length, `${siembra.tipo} sin motivo declarado`).toBeGreaterThan(20);
      expect(
        fs.existsSync(path.join(RAIZ, siembra.script)),
        `${siembra.tipo} apunta a un script que no existe: ${siembra.script}`,
      ).toBe(true);
    }
  });
});

describe("313 · frente 1 (control positivo) — el censo SABE ponerse rojo", () => {
  it("censo vacio = ROJO, no aprobado", () => {
    const huecos = auditarCoberturaDeSiembra([], []);
    expect(huecos.map((h) => h.clase)).toEqual(["censo_vacio", "censo_vacio"]);
  });

  it("una recurrencia NUEVA sin siembra sale como hueco", () => {
    // Exactamente lo que pasaria manana si alguien registra un tipo recurrente y se olvida de
    // sembrarlo: hoy eso no lo veia nadie.
    const huecos = auditarCoberturaDeSiembra(
      [...TIPOS_RECURRENTES, "geocodificacion"],
      TIPOS_SEMBRADOS,
    );
    expect(huecos.map((h) => h.clase)).toEqual(["sin_siembra"]);
    expect(huecos[0].clase === "sin_siembra" && huecos[0].tipo).toBe("geocodificacion");
  });

  it("retirar la siembra de un recurrente que YA existe sale como hueco", () => {
    // La mutacion de la ficha, hecha sobre los censos reales: se quita `liberar_reprogramadas`
    // del registro (el tipo cuyas 40 ordenes se quedaron atrapadas) y esto tiene que enrojecer.
    const sinLiberar = TIPOS_SEMBRADOS.filter((t) => t !== "liberar_reprogramadas");
    const huecos = auditarCoberturaDeSiembra(TIPOS_RECURRENTES, sinLiberar);
    expect(huecos.map((h) => h.clase)).toEqual(["sin_siembra"]);
    expect(huecos[0].clase === "sin_siembra" && huecos[0].tipo).toBe("liberar_reprogramadas");
  });

  it("una siembra huerfana (tipo que dejo de ser recurrente) tambien sale", () => {
    const huecos = auditarCoberturaDeSiembra([], ["liberar_reprogramadas"]);
    expect(huecos.map((h) => h.clase)).toEqual(["censo_vacio", "siembra_huerfana"]);
  });
});

/* -------------------------------------------------------------------------- */
/* Frente 2 — la siembra encola el MISMO trabajo que la recurrencia            */
/* -------------------------------------------------------------------------- */

/** Dos instantes distintos que caen en la MISMA ventana de corrida para los dos tipos. */
const AHORA = new Date("2026-08-02T16:00:00.000Z");
const MAS_TARDE = new Date("2026-08-03T02:00:00.000Z");

interface Encolado {
  tipo: JobTipo;
  payload: Record<string, unknown>;
  opts: EnqueueOpts;
}

/** Repo de mentira: registra el encolado y devuelve una fila plausible. Sin conexion. */
function repoQueRegistra(encolados: Encolado[]): IJobRepository {
  return {
    enqueue: async (tipo: JobTipo, payload: Record<string, unknown>, opts: EnqueueOpts = {}) => {
      encolados.push({ tipo, payload, opts });
      return {
        id: `job-${tipo}`,
        tipo,
        payload,
        estado: "pending",
        intentos: 0,
        maxIntentos: 5,
        runAfter: opts.runAfter ?? AHORA,
        lockedAt: null,
        lastError: null,
        dedupeKey: opts.dedupeKey ?? null,
        createdAt: AHORA,
        updatedAt: AHORA,
      } satisfies JobDTO;
    },
  } as unknown as IJobRepository;
}

describe("313 · frente 2 — la siembra encola lo mismo que re-agendaria la recurrencia", () => {
  for (const siembra of SIEMBRAS_RECURRENTES) {
    it(`${siembra.tipo}: mismo run_after y misma dedupe_key que su recurrencia`, async () => {
      const encolados: Encolado[] = [];
      await siembra.sembrar(repoQueRegistra(encolados), AHORA);

      expect(encolados).toHaveLength(1);
      expect(encolados[0].tipo).toBe(siembra.tipo);
      // Payload vacio: el handler deriva la fecha de `now`. Y sin PII en la cola.
      expect(encolados[0].payload).toEqual({});

      const recurrencia = buildRecurrencias().get(siembra.tipo);
      expect(recurrencia, `${siembra.tipo} sin recurrencia registrada`).toBeDefined();
      const siguiente = recurrencia!.siguiente(AHORA);

      expect(
        encolados[0].opts.dedupeKey,
        "sin `dedupeKey` el ON CONFLICT no aplica y cada despliegue anadiria una fila nueva",
      ).toBe(siguiente.dedupeKey);
      expect(encolados[0].opts.runAfter?.toISOString()).toBe(siguiente.runAfter.toISOString());
    });

    it(`${siembra.tipo}: sembrar dos veces en la misma ventana repite la clave (idempotencia)`, async () => {
      // La idempotencia REAL la da `ON CONFLICT ("dedupe_key") DO NOTHING` en
      // `JobRepository.enqueue`, y se demuestra contando filas contra Postgres en los tests de
      // integracion citados en el frente 4. Lo que se afirma aqui es su premisa: que las dos
      // siembras presentan la MISMA clave. Si la clave dependiera del instante de la siembra,
      // el `ON CONFLICT` no saltaria y cada despliegue encolaria otra corrida.
      const primera: Encolado[] = [];
      const segunda: Encolado[] = [];
      await siembra.sembrar(repoQueRegistra(primera), AHORA);
      await siembra.sembrar(repoQueRegistra(segunda), MAS_TARDE);

      expect(segunda[0].opts.dedupeKey).toBe(primera[0].opts.dedupeKey);
      expect(segunda[0].opts.runAfter?.toISOString()).toBe(
        primera[0].opts.runAfter?.toISOString(),
      );
      expect(typeof primera[0].opts.dedupeKey).toBe("string");
      expect(primera[0].opts.dedupeKey).not.toBe("");
    });
  }
});

/* -------------------------------------------------------------------------- */
/* Frente 3 — el paso de despliegue EJECUTA la siembra                        */
/* -------------------------------------------------------------------------- */

class SalidaDelProceso extends Error {
  constructor(readonly codigo: number) {
    super(`process.exit(${codigo})`);
  }
}

interface Corrida {
  pasos: string[];
  lineas: string[];
  errores: string[];
  salida: number | null;
}

/**
 * Corre el paso REAL (`ejecutarPasoDeBaseDeDatos`) con todos sus efectos sustituidos por
 * dobles, y devuelve lo que hizo. Nada toca la base ni lanza el CLI de Prisma.
 */
async function correrPaso(
  env: EntornoDelPaso,
  fallos: { migrar?: boolean; sembrar?: boolean } = {},
): Promise<Corrida> {
  const corrida: Corrida = { pasos: [], lineas: [], errores: [], salida: null };
  const efectos: Partial<EfectosDelPaso> = {
    env,
    aplicarMigraciones: () => {
      corrida.pasos.push("migrar");
      if (fallos.migrar) throw new Error("migrate deploy fallo");
    },
    sembrar: async () => {
      corrida.pasos.push("sembrar");
      if (fallos.sembrar) throw new Error("la base rechazo el INSERT");
      return [
        {
          tipo: "liberar_reprogramadas" as JobTipo,
          creada: true,
          runAfter: AHORA,
          dedupeKey: "liberar_reprogramadas:2026-08-03",
        },
      ];
    },
    log: (linea) => corrida.lineas.push(linea),
    error: (linea) => corrida.errores.push(linea),
    salir: (codigo) => {
      corrida.salida = codigo;
      throw new SalidaDelProceso(codigo);
    },
  };

  try {
    await ejecutarPasoDeBaseDeDatos(efectos);
  } catch (error) {
    if (!(error instanceof SalidaDelProceso)) throw error;
  }
  return corrida;
}

const ENV_PRODUCCION: EntornoDelPaso = {
  VERCEL_ENV: "production",
  DIRECT_URL: "postgresql://u:p@aws-1-us-east-2.pooler.supabase.com:5432/postgres",
};

describe("313 · frente 3 — el paso de base de datos del build SIEMBRA", () => {
  it("en produccion migra y DESPUES siembra", async () => {
    const corrida = await correrPaso(ENV_PRODUCCION);
    expect(
      corrida.pasos,
      "este es el eslabon que faltaba: los seeds existian y NADIE los llamaba.",
    ).toEqual(["migrar", "sembrar"]);
    expect(corrida.salida).toBeNull();
  });

  it("en un preview con base propia (MIGRATE_ON_PREVIEW=true) tambien siembra", async () => {
    const corrida = await correrPaso({
      ...ENV_PRODUCCION,
      VERCEL_ENV: "preview",
      MIGRATE_ON_PREVIEW: "true",
    });
    expect(corrida.pasos).toEqual(["migrar", "sembrar"]);
  });

  it("si la base NO es suya (build local, preview sin flag) no migra NI siembra", async () => {
    for (const env of [
      { ...ENV_PRODUCCION, VERCEL_ENV: undefined },
      { ...ENV_PRODUCCION, VERCEL_ENV: "preview", MIGRATE_ON_PREVIEW: undefined },
    ]) {
      const corrida = await correrPaso(env);
      expect(corrida.pasos).toEqual([]);
      expect(corrida.lineas.join("\n")).toContain("siembra de jobs recurrentes OMITIDA");
    }
  });

  it("si la migracion falla, NO siembra (la tabla `jobs` podria no existir) y sale con 1", async () => {
    const corrida = await correrPaso(ENV_PRODUCCION, { migrar: true });
    expect(corrida.pasos).toEqual(["migrar"]);
    expect(corrida.salida).toBe(1);
  });

  it("si la SIEMBRA falla, el build MUERE con un motivo legible", async () => {
    // Fallar ruidosamente es la decision de la ficha: el fallo original fue mudo dos dias.
    const corrida = await correrPaso(ENV_PRODUCCION, { sembrar: true });
    expect(corrida.pasos).toEqual(["migrar", "sembrar"]);
    expect(corrida.salida).toBe(1);
    expect(corrida.errores.join("\n")).toContain("FALLO la siembra");
  });

  it("el log de la siembra no filtra credenciales ni PII", async () => {
    const corrida = await correrPaso(ENV_PRODUCCION);
    const todo = corrida.lineas.join("\n");
    expect(todo).not.toContain("postgresql://");
    expect(todo).toContain("liberar_reprogramadas");
  });
});

/* -------------------------------------------------------------------------- */
/* Frente 4 — la cadena hasta el build de Vercel, y la prueba de idempotencia  */
/* -------------------------------------------------------------------------- */

/** ¿Ese `scripts.build` ejecuta el paso de base de datos? Pura: se puede probar en falso. */
function elBuildCorreElPaso(scriptBuild: string): boolean {
  return scriptBuild.includes("scripts/migrate-deploy.ts");
}

/** ¿Ese archivo de test ejercita a ese sembrador contra Postgres? Pura, por el mismo motivo. */
function pruebaLaIdempotenciaDe(rutaRelativa: string, sembrador: string): boolean {
  const absoluta = path.join(RAIZ, rutaRelativa);
  if (!fs.existsSync(absoluta)) return false;
  const fuente = fs.readFileSync(absoluta, "utf8");
  return fuente.includes(sembrador) && fuente.includes("contarJobs");
}

describe("313 · frente 4 — el build de Vercel corre el paso, y alguien mide el ON CONFLICT", () => {
  it("`pnpm run build` ejecuta scripts/migrate-deploy.ts", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(RAIZ, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(
      elBuildCorreElPaso(pkg.scripts.build),
      "si el build deja de correr este script, las migraciones Y la siembra dejan de correr " +
        "en el despliegue, sin que ningun otro test lo note.",
    ).toBe(true);
  });

  it("(control positivo) el detector del build sabe decir que NO", () => {
    expect(elBuildCorreElPaso("prisma generate && next build")).toBe(false);
  });

  it("la idempotencia de cada siembra esta medida contra Postgres real, contando filas", () => {
    // Que sembrar dos veces no duplique NO se puede afirmar sin base: `ON CONFLICT DO NOTHING`
    // es del motor. Esta guardia solo exige que la prueba que SI lo mide siga existiendo.
    const pruebas: Array<[string, string]> = [
      [
        "tests/integration/db/siembra-liberar-reprogramadas-idempotente.test.ts",
        "seedJobLiberarReprogramadas",
      ],
      [
        "tests/integration/db/job-tipo-analitica-rollup-migration.test.ts",
        "seedJobAnaliticaRollupDiario",
      ],
    ];
    for (const [ruta, sembrador] of pruebas) {
      expect(pruebaLaIdempotenciaDe(ruta, sembrador), `${ruta} ya no prueba ${sembrador}`).toBe(
        true,
      );
    }
    // Y hay una prueba por siembra registrada: si se anade un tipo, falta la suya.
    expect(pruebas).toHaveLength(SIEMBRAS_RECURRENTES.length);
  });

  it("(control positivo) el detector de la prueba sabe decir que NO", () => {
    expect(pruebaLaIdempotenciaDe("tests/integration/db/no-existe.test.ts", "loQueSea")).toBe(
      false,
    );
    expect(
      pruebaLaIdempotenciaDe(
        "tests/unit/api/procesar-jobs-registro.test.ts",
        "seedJobLiberarReprogramadas",
      ),
      "ese archivo existe pero NO ejercita la siembra: si diera true, el detector estaria " +
        "conforme con cualquier test que pase por ahi cerca.",
    ).toBe(false);
  });
});
