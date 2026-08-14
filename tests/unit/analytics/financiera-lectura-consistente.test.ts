import fs from "node:fs";
import { quitarComentarios } from "../../fixtures/sin-comentarios";
import path from "node:path";

import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import type { ActorAnalitica } from "@/lib/analytics/alcance";
import { prepararConsultaAnalitica, type ConsultaAnalitica } from "@/lib/analytics/consulta";
import { trocear } from "@/lib/analytics/cubo-temporal";
import {
  MAX_WAIT_LECTURA_CONSISTENTE_MS,
  TIMEOUT_LECTURA_CONSISTENTE_MS,
} from "@/lib/config/analitica-financiera";
import { CuentasPorPagarAnaliticaRepository } from "@/lib/repositories/CuentasPorPagarAnaliticaRepository";
import { IngresosAnaliticaRepository } from "@/lib/repositories/IngresosAnaliticaRepository";
import { fakePrismaDinero, type LlamadaFake } from "./_fake-prisma-dinero";

// Feature 187 (T2.5) — EL ALCANCE DE LECTURA CONSISTENTE EN LOS DOS REPOSITORIOS: R2 (mitad
// unitaria), R3 y R10.
//
// QUE MIDE ESTE ARCHIVO Y QUE NO, dicho antes de la primera asercion porque aqui la confusion es
// especialmente facil y especialmente cara:
//
//   - AQUI se mide LO QUE EL REPOSITORIO PIDE: que abre una transaccion interactiva, con que nivel
//     de aislamiento, con que tiempos, que TODAS las consultas del alcance salen por el cliente de
//     la transaccion y ninguna por el de fuera, y que dentro no hay ni una escritura.
//   - LO QUE POSTGRES HACE CON ESA PETICION no se puede medir con un fake y no se finge: que
//     `current_setting('transaction_isolation')` valga de verdad `repeatable read` dentro del
//     alcance —y otra cosa fuera— lo mide I1, y que el snapshot sostenga la invariante frente a
//     una escritura confirmada lo mide I2, los dos en
//     `tests/integration/repositories/financiera-lectura-consistente.integration.test.ts`.
//
// «Se llamo a `$transaction`» NO es ninguna de las dos cosas, y por eso cada caso de abajo lleva
// su contra-caso: si el detector dejara de discriminar, este archivo se pone rojo aunque el
// repositorio siga bien.

const MAESTRO: ActorAnalitica = { usuarioId: "u-maestro", rol: "maestro" };
const AHORA = new Date("2026-03-12T15:00:00.000Z");

/** TRES dias de Costa Rica: con un solo cubo, «cada consulta en su sitio» diria menos. */
const RANGO_CRUDO = { rango: "personalizado", desde: "2026-03-09", hasta: "2026-03-11" } as const;

function consultaDe(metricaId: string): ConsultaAnalitica {
  const r = prepararConsultaAnalitica(RANGO_CRUDO, MAESTRO, metricaId, AHORA);
  if (r.status !== "ok") throw new Error(`no se pudo preparar la consulta de ${metricaId}`);
  return r.consulta;
}

/**
 * El fixture. `respuestaCruda` es obligatoria para quien emita `$queryRaw` (el fake lanza sin
 * ella), y devuelve `[]` a proposito: lo que este archivo juzga no es el dinero que sale, sino
 * por donde salieron las consultas. El dinero lo juzgan los cuatro `financiera-*-repo.test.ts`.
 */
function fake() {
  return fakePrismaDinero({
    caja: [
      {
        categoria: "ingreso_flete",
        tipo: "ingreso",
        monto: "10.00",
        fechaMovimiento: new Date("2026-03-09T12:00:00.000Z"),
      },
    ],
    ledgerMensajero: [
      {
        mensajeroId: "m-1",
        categoria: "devengo_entrega",
        tipo: "devengo",
        monto: "5.00",
        fechaMovimiento: new Date("2026-03-09T12:00:00.000Z"),
      },
    ],
    respuestaCruda: () => [],
  });
}

/* -------------------------------------------------------------------------- */
/* 1. R2 (unitario) — el nivel de aislamiento que se PIDE                      */
/* -------------------------------------------------------------------------- */

describe("R2 · los dos repositorios abren la lectura consistente con RepeatableRead", () => {
  it("IngresosAnaliticaRepository abre la transaccion con isolationLevel RepeatableRead", async () => {
    const f = fake();
    const consulta = consultaDe("ingreso_flete");
    await new IngresosAnaliticaRepository(f.cliente).enLecturaConsistente((r) =>
      r.sumarPorCategoria(consulta),
    );

    expect(f.transacciones).toHaveLength(1);
    expect(f.transacciones[0].isolationLevel).toBe("RepeatableRead");
  });

  it("CuentasPorPagarAnaliticaRepository abre la suya con el MISMO nivel, no con otro", async () => {
    // Gemelos, por el mismo motivo que los dos `limitesDeCubo`: arreglar uno y olvidar el otro
    // tiene que ponerse rojo. Se compara contra lo que pidio el primero, no contra un literal
    // repetido, para que cambiar de nivel obligue a cambiar los dos a la vez.
    const fIngresos = fake();
    const fCuentas = fake();
    await new IngresosAnaliticaRepository(fIngresos.cliente).enLecturaConsistente((r) =>
      r.sumarPorCategoria(consultaDe("ingreso_flete")),
    );
    await new CuentasPorPagarAnaliticaRepository(fCuentas.cliente).enLecturaConsistente((r) =>
      r.cuentaPorPagarMensajerosAlCorte(consultaDe("cuenta_por_pagar_mensajero")),
    );

    expect(fCuentas.transacciones[0].isolationLevel).toBe(
      fIngresos.transacciones[0].isolationLevel,
    );
    expect(fCuentas.transacciones[0].isolationLevel).toBe("RepeatableRead");
  });

  it("CONTRA-CASO · sin la opcion el caso cae: el fake registra `undefined`, no un valor por defecto", async () => {
    // Si el fake rellenara `isolationLevel` por su cuenta, el repositorio que se olvidara de
    // pedirlo pasaria los dos casos de arriba. Esto lo impide: un alcance abierto a mano SIN
    // opciones queda registrado como lo que es.
    const f = fake();
    await (f.cliente as unknown as { $transaction: (fn: () => Promise<string>) => Promise<string> })
      .$transaction(async () => "sin opciones");

    expect(f.transacciones).toHaveLength(1);
    expect(f.transacciones[0].isolationLevel).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* 2. R1 — TODAS las consultas del alcance salen por el cliente transaccional  */
/* -------------------------------------------------------------------------- */

/** Las llamadas que salieron por el cliente de FUERA de toda transaccion. */
function fueraDeTodoAlcance(llamadas: readonly LlamadaFake[]): readonly LlamadaFake[] {
  return llamadas.filter((l) => l.transaccion === null);
}

describe("R1 · dentro del alcance no se escapa ni una consulta por el cliente de fuera", () => {
  it("las DOS lecturas de la caja salen por el cliente de la transaccion, y por el mismo", async () => {
    const f = fake();
    const consulta = consultaDe("ingreso_flete");
    const cubos = trocear(consulta.rango);
    await new IngresosAnaliticaRepository(f.cliente).enLecturaConsistente(async (r) => [
      await r.sumarPorCategoria(consulta),
      await r.sumarPorCuboYCategoria(consulta, cubos),
    ]);

    expect(f.llamadas).toHaveLength(2);
    expect(fueraDeTodoAlcance(f.llamadas)).toEqual([]);
    expect(new Set(f.llamadas.map((l) => l.transaccion)).size).toBe(1);
  });

  it("las TRES de la cuenta de mensajeros, igual: un solo alcance para las tres", async () => {
    const f = fake();
    const consulta = consultaDe("cuenta_por_pagar_mensajero");
    const cubos = trocear(consulta.rango);
    await new CuentasPorPagarAnaliticaRepository(f.cliente).enLecturaConsistente(async (r) => [
      await r.cuentaPorPagarMensajerosAlCorte(consulta),
      await r.cuentaPorPagarMensajerosAntesDe(consulta),
      await r.cuentaPorPagarMensajerosPorCubo(consulta, cubos),
    ]);

    expect(f.llamadas).toHaveLength(3);
    expect(fueraDeTodoAlcance(f.llamadas)).toEqual([]);
    expect(new Set(f.llamadas.map((l) => l.transaccion)).size).toBe(1);
  });

  it("CONTRA-CASO · una lectura hecha FUERA del alcance se ve como tal", async () => {
    // Sin esto, «ninguna consulta salio por el cliente de fuera» podria ser cierto porque el fake
    // marque todo como transaccional. Aqui la misma consulta, emitida fuera, sale marcada `null`,
    // que es exactamente el sintoma del bug que la 187 cierra: abrir el alcance y leer al lado.
    const f = fake();
    const consulta = consultaDe("ingreso_flete");
    const repo = new IngresosAnaliticaRepository(f.cliente);
    await repo.sumarPorCategoria(consulta);
    await repo.enLecturaConsistente((r) => r.sumarPorCategoria(consulta));

    expect(f.llamadas).toHaveLength(2);
    expect(fueraDeTodoAlcance(f.llamadas)).toHaveLength(1);
  });

  it("y los alcances no se anidan: el repositorio ligado a la transaccion lo dice en voz alta", async () => {
    const f = fake();
    const repo = new IngresosAnaliticaRepository(f.cliente);
    await expect(
      repo.enLecturaConsistente((interno) => interno.enLecturaConsistente(async () => "x")),
    ).rejects.toThrow(/no se anidan/);
  });
});

/* -------------------------------------------------------------------------- */
/* 3. R3 — dentro del alcance SOLO hay lecturas                                */
/* -------------------------------------------------------------------------- */

/** Las operaciones del cliente Prisma que leen y no escriben. */
const OPERACIONES_DE_LECTURA: ReadonlySet<string> = new Set([
  "groupBy",
  "aggregate",
  "findMany",
  "queryRaw",
]);

/**
 * Devuelve las operaciones del alcance que NO son de lectura. Mira dos cosas, porque con una sola
 * se cuela la mitad: la operacion de Prisma (un `create` no es lectura ni disfrazado) y, para el
 * SQL crudo, el VERBO del texto — `$queryRaw` acepta perfectamente un `DELETE`, y el nombre del
 * metodo no lo delata.
 */
export function escriturasDentroDelAlcance(llamadas: readonly LlamadaFake[]): string[] {
  return llamadas
    .filter((l) => l.transaccion !== null)
    .flatMap((l) => {
      if (!OPERACIONES_DE_LECTURA.has(l.operacion)) {
        return [`${l.modelo}.${l.operacion}: no es una operacion de lectura`];
      }
      if (l.operacion !== "queryRaw") return [];
      const texto = String(l.args.texto ?? "").trim();
      return /^select\b/i.test(texto)
        ? []
        : [`${l.modelo}: SQL crudo que no empieza por SELECT (${texto.slice(0, 40)})`];
    });
}

describe("R3 · dentro de la lectura consistente no se emite ni una escritura", () => {
  it("la caja: sus dos operaciones del alcance son groupBy y un $queryRaw de SELECT", async () => {
    const f = fake();
    const consulta = consultaDe("ingreso_flete");
    await new IngresosAnaliticaRepository(f.cliente).enLecturaConsistente(async (r) => [
      await r.sumarPorCategoria(consulta),
      await r.sumarPorCuboYCategoria(consulta, trocear(consulta.rango)),
    ]);

    expect(f.llamadas.map((l) => l.operacion)).toEqual(["groupBy", "queryRaw"]);
    expect(escriturasDentroDelAlcance(f.llamadas)).toEqual([]);
  });

  it("la cuenta de mensajeros: dos groupBy y un $queryRaw de SELECT, y nada mas", async () => {
    const f = fake();
    const consulta = consultaDe("cuenta_por_pagar_mensajero");
    await new CuentasPorPagarAnaliticaRepository(f.cliente).enLecturaConsistente(async (r) => [
      await r.cuentaPorPagarMensajerosAlCorte(consulta),
      await r.cuentaPorPagarMensajerosAntesDe(consulta),
      await r.cuentaPorPagarMensajerosPorCubo(consulta, trocear(consulta.rango)),
    ]);

    expect(f.llamadas.map((l) => l.operacion)).toEqual(["groupBy", "groupBy", "queryRaw"]);
    expect(escriturasDentroDelAlcance(f.llamadas)).toEqual([]);
  });

  it("CONTRA-CASO · una escritura SEMBRADA dentro del alcance SI se detecta", async () => {
    // La mitad que hace que el caso de arriba signifique algo. Se siembra por la via realista: un
    // `$queryRaw` con un `DELETE`, que Prisma acepta sin rechistar y que ningun tipo impide.
    const f = fake();
    const cliente = f.cliente as unknown as {
      $transaction: (fn: (tx: { $queryRaw: (sql: unknown) => Promise<unknown> }) => Promise<unknown>) => Promise<unknown>;
    };
    await cliente.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`DELETE FROM wallet_movimiento WHERE monto = ${0}`);
      return null;
    });

    const detectadas = escriturasDentroDelAlcance(f.llamadas);
    expect(detectadas).toHaveLength(1);
    expect(detectadas[0]).toContain("no empieza por SELECT");
  });
});

/* -------------------------------------------------------------------------- */
/* 4. R10 — los tiempos salen de la configuracion, y no de un numero suelto    */
/* -------------------------------------------------------------------------- */

describe("R10 · los tiempos del alcance vienen de lib/config/analitica-financiera.ts", () => {
  it("el timeout y el maxWait que se pasan son exactamente los de la config", async () => {
    const f = fake();
    await new IngresosAnaliticaRepository(f.cliente).enLecturaConsistente((r) =>
      r.sumarPorCategoria(consultaDe("ingreso_flete")),
    );

    expect(f.transacciones[0]).toEqual({
      isolationLevel: "RepeatableRead",
      timeout: TIMEOUT_LECTURA_CONSISTENTE_MS,
      maxWait: MAX_WAIT_LECTURA_CONSISTENTE_MS,
    });
  });

  it("los dos repositorios piden los MISMOS tiempos: no hay dos politicas de espera", async () => {
    const fIngresos = fake();
    const fCuentas = fake();
    await new IngresosAnaliticaRepository(fIngresos.cliente).enLecturaConsistente((r) =>
      r.sumarPorCategoria(consultaDe("ingreso_flete")),
    );
    await new CuentasPorPagarAnaliticaRepository(fCuentas.cliente).enLecturaConsistente((r) =>
      r.cuentaPorPagarMensajerosAlCorte(consultaDe("cuenta_por_pagar_mensajero")),
    );

    expect(fCuentas.transacciones[0]).toEqual(fIngresos.transacciones[0]);
  });
});

/* -------------------------------------------------------------------------- */
/* 5. R10, segunda mitad — CENSO: ni un literal de milisegundos en los repos   */
/* -------------------------------------------------------------------------- */

const REPO_ROOT = path.join(__dirname, "..", "..", "..");

const REPOSITORIOS_CON_ALCANCE = [
  "lib/repositories/IngresosAnaliticaRepository.ts",
  "lib/repositories/CuentasPorPagarAnaliticaRepository.ts",
];

/** Un comentario no es codigo: la prosa que EXPLICA de donde salen los 15 s no infringe. */
function soloCodigo(fuente: string): string {
  return quitarComentarios(fuente);
}

/**
 * Cualquier literal numerico de DOS O MAS digitos, con o sin separador `_`.
 *
 * El umbral es dos digitos y no cuatro a proposito: `1500` no es el unico numero peligroso —un
 * `timeout: 15` tambien es una politica de espera escrita donde no toca—, y hoy los dos
 * repositorios no tienen ni un literal de dos digitos en codigo (`toFixed(2)`, `Decimal(0)`,
 * `- 1`, `length === 0`), asi que el censo no amnistia nada ni obliga a tocar nada. Es un
 * endurecimiento puro, que es la unica direccion en la que un guardia se mueve (R31 de la 180).
 */
const LITERAL_LARGO = /\b\d[\d_]*\d\b/;

export function literalDeTiempo(nombre: string, fuente: string): string | null {
  const m = soloCodigo(fuente).match(LITERAL_LARGO);
  return m === null
    ? null
    : `${nombre}: escribe el literal numerico ${m[0]}; los tiempos del alcance viven en lib/config/analitica-financiera.ts (R10)`;
}

describe("R10 · censo de literales de tiempo en los dos repositorios del alcance", () => {
  it("el censo mira archivos de verdad, no rutas fantasma", () => {
    for (const rel of REPOSITORIOS_CON_ALCANCE) {
      const abs = path.join(REPO_ROOT, rel);
      expect(fs.existsSync(abs), rel).toBe(true);
      expect(fs.readFileSync(abs, "utf8")).toContain("enLecturaConsistente");
    }
  });

  it("ninguno de los dos escribe un numero de milisegundos", () => {
    const infractores = REPOSITORIOS_CON_ALCANCE.map((rel) =>
      literalDeTiempo(rel, fs.readFileSync(path.join(REPO_ROOT, rel), "utf8")),
    ).filter((v): v is string => v !== null);
    expect(infractores).toEqual([]);
  });

  it("CONTRA-CASO · el detector caza el timeout escrito a mano, y no marca la prosa que lo explica", () => {
    const legitimo = `
      return this.prisma.$transaction(async (tx) => fn(new R(tx)), {
        isolationLevel: "RepeatableRead",
        timeout: TIMEOUT_LECTURA_CONSISTENTE_MS,
        maxWait: MAX_WAIT_LECTURA_CONSISTENTE_MS,
      });
    `;
    expect(literalDeTiempo("legitimo.ts", legitimo)).toBeNull();

    const infractor = legitimo.replace("TIMEOUT_LECTURA_CONSISTENTE_MS", "15_000");
    expect(infractor).not.toBe(legitimo);
    expect(literalDeTiempo("infractor.ts", infractor)).toContain("15_000");

    const conProsa = `// el timeout son 15_000 ms y vive en la config\n${legitimo}`;
    expect(literalDeTiempo("prosa.ts", conProsa)).toBeNull();
  });
});
