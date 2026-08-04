import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import type {
  ICajaBackfillTesoreriaService,
  InformeBackfillCaja,
  ModoBackfillCaja,
} from "@/lib/interfaces/services/ICajaBackfillTesoreriaService";
import {
  CODIGO_ARGUMENTOS,
  CODIGO_PENDIENTES,
  destinoLegible,
  ejecutarBackfillCajaCli,
  type EntornoBackfillCaja,
} from "@/scripts/backfill-caja-tesoreria";

/**
 * Feature 173 / T E.2 (R40, R43, R44) — el ejecutable entero, ejercido SIN base de datos.
 *
 * Lo que de verdad se mide aqui es lo que el ejecutable NO hace:
 *
 *  - **Sin flag no escribe nada.** El modo por defecto es `simular`, y se comprueba contando
 *    con que modo se invoco al servicio, no leyendo el codigo.
 *  - **`--comprobar` no puede decir «al dia» mientras quede uno** (R44). Se barre la salida
 *    ENTERA buscando esas palabras, para que la frase no pueda colarse ni negada ni de pasada.
 *  - **Los documentos se NOMBRAN** (R43): sus ids aparecen en la salida, uno a uno.
 */

const RAIZ = path.join(__dirname, "..", "..", "..");
const rutaDe = (rel: string) => path.join(RAIZ, ...rel.split("/"));

/** Credenciales de mentira, y a proposito feas: si alguna se cuela en la salida, se ve. */
const USUARIO = "usuario_de_prueba";
const CONTRASENA = "contrasena_que_no_debe_salir";
const URL_DE_PRUEBA = `postgresql://${USUARIO}:${CONTRASENA}@db.ejemplo.interno:6543/ordenex_prod`;

const INSTANTE = "2026-12-25T18:30:00.000Z";

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

const PENDIENTE_CIERRE = {
  origen: "cierre_aprobado" as const,
  documentoId: "cierre-a",
  movimiento: {
    tipo: "ingreso" as const,
    categoria: "ingreso_cod_recaudado" as const,
    monto: "12801.00",
    origenTipo: "cierre_dia" as const,
    origenId: "cierre-a",
    fechaMovimiento: new Date("2026-07-05T09:00:00.000Z"),
  },
};

const PENDIENTE_PAGO = {
  origen: "pago_a_tienda" as const,
  documentoId: "pago-1",
  movimiento: {
    tipo: "egreso" as const,
    categoria: "egreso_pago_tienda" as const,
    monto: "15000.50",
    origenTipo: "pago_tienda" as const,
    origenId: "pago-1",
    fechaMovimiento: new Date("2026-07-30T00:00:00.000Z"),
  },
};

interface Arnes {
  readonly salida: string[];
  readonly errores: string[];
  readonly modos: ModoBackfillCaja[];
  readonly serviciosCreados: () => number;
  todo(): string;
}

function arnes(opciones: {
  argv: string[];
  responde?: (modo: ModoBackfillCaja) => InformeBackfillCaja;
  url?: string | undefined;
}): { entorno: EntornoBackfillCaja; arnes: Arnes } {
  const salida: string[] = [];
  const errores: string[] = [];
  const modos: ModoBackfillCaja[] = [];
  let creados = 0;

  const servicio: ICajaBackfillTesoreriaService = {
    async ejecutar(modo: ModoBackfillCaja): Promise<InformeBackfillCaja> {
      modos.push(modo);
      return opciones.responde?.(modo) ?? informe({ modo });
    },
  };

  const entorno: EntornoBackfillCaja = {
    argv: opciones.argv,
    env: { DATABASE_URL: "url" in opciones ? opciones.url : URL_DE_PRUEBA },
    salida: (l) => void salida.push(l),
    errores: (l) => void errores.push(l),
    crearServicio: () => {
      creados += 1;
      return servicio;
    },
  };

  return {
    entorno,
    arnes: {
      salida,
      errores,
      modos,
      serviciosCreados: () => creados,
      todo: () => [...salida, ...errores].join("\n"),
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Importar el modulo no ejecuta nada                                          */
/* -------------------------------------------------------------------------- */

describe("importar el script no ejecuta nada; solo se auto-ejecuta como entrypoint", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("importar el modulo no imprime, no sale del proceso y no toca la base", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitCodeAntes = process.exitCode;
    vi.resetModules();

    const modulo = await import("@/scripts/backfill-caja-tesoreria");

    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(exitCodeAntes);
    expect(typeof modulo.ejecutarBackfillCajaCli).toBe("function");
  });

  it("la auto-ejecucion esta guardada por la comparacion con process.argv[1]", () => {
    const fuente = fs.readFileSync(rutaDe("scripts/backfill-caja-tesoreria.ts"), "utf8");

    expect(fuente).toMatch(/pathToFileURL\(process\.argv\[1\]\)\.href/);
    expect(fuente).toMatch(/if\s*\(isEntrypoint\)/);
  });
});

/* -------------------------------------------------------------------------- */
/* R40 — sin flag NO ESCRIBE NADA                                              */
/* -------------------------------------------------------------------------- */

describe("R40 — sin flag no se escribe nada: el defecto es la simulacion", () => {
  it("sin argumentos, el servicio se invoca en modo `simular` y solo una vez", async () => {
    const { entorno, arnes: a } = arnes({ argv: [] });

    const codigo = await ejecutarBackfillCajaCli(entorno);

    expect(codigo).toBe(0);
    expect(a.modos).toEqual(["simular"]); // la unica invocacion, y no es `aplicar`
  });

  it("lo dice en la primera pantalla, para que nadie crea que escribio", async () => {
    const { entorno, arnes: a } = arnes({ argv: [] });

    await ejecutarBackfillCajaCli(entorno);

    expect(a.todo()).toContain("Modo: simular (por defecto: NO escribe)");
    expect(a.todo()).toContain("este modo NO escribe");
  });

  it("`--aplicar` es el UNICO modo que llega al servicio como escritura", async () => {
    const { entorno, arnes: a } = arnes({
      argv: ["--aplicar"],
      responde: (modo) => informe({ modo, insertadas: 5, pendientes: [PENDIENTE_CIERRE], alDia: false }),
    });

    const codigo = await ejecutarBackfillCajaCli(entorno);

    expect(codigo).toBe(0);
    expect(a.modos).toEqual(["aplicar"]);
    expect(a.todo()).toContain("Filas insertadas: 5");
  });

  it("`--comprobar` invoca en modo comprobacion", async () => {
    const { entorno, arnes: a } = arnes({ argv: ["--comprobar"] });

    await ejecutarBackfillCajaCli(entorno);

    expect(a.modos).toEqual(["comprobar"]);
  });

  it("informa cuantas filas, de que categoria y por que monto total", async () => {
    const { entorno, arnes: a } = arnes({
      argv: [],
      responde: (modo) =>
        informe({
          modo,
          pendientes: [PENDIENTE_CIERRE, PENDIENTE_PAGO],
          alDia: false,
          porCategoria: [
            { tipo: "egreso", categoria: "egreso_pago_tienda", filas: 1, montoTotal: "15000.50" },
            { tipo: "ingreso", categoria: "ingreso_cod_recaudado", filas: 3, montoTotal: "18051.50" },
          ],
        }),
    });

    await ejecutarBackfillCajaCli(entorno);

    expect(a.todo()).toContain("egreso / egreso_pago_tienda: filas=1 monto total=15000.50");
    expect(a.todo()).toContain("ingreso / ingreso_cod_recaudado: filas=3 monto total=18051.50");
    expect(a.todo()).toContain("se insertarian 2 filas y no se ha escrito nada");
  });
});

/* -------------------------------------------------------------------------- */
/* Argumentos                                                                  */
/* -------------------------------------------------------------------------- */

describe("argumentos: se rechazan en alto y sin tocar la base", () => {
  it("una errata (`--aplcar`) aborta y NO se lee como «sin flag»", async () => {
    const { entorno, arnes: a } = arnes({ argv: ["--aplcar"] });

    const codigo = await ejecutarBackfillCajaCli(entorno);

    expect(codigo).toBe(CODIGO_ARGUMENTOS);
    expect(a.modos).toEqual([]);
    expect(a.serviciosCreados()).toBe(0); // ni se abrio la conexion
    expect(a.todo()).toContain("ARGUMENTOS INVALIDOS");
  });

  it("dos modos a la vez abortan: la eleccion no la decide un orden de evaluacion", async () => {
    const { entorno, arnes: a } = arnes({ argv: ["--simular", "--aplicar"] });

    const codigo = await ejecutarBackfillCajaCli(entorno);

    expect(codigo).toBe(CODIGO_ARGUMENTOS);
    expect(a.modos).toEqual([]);
    expect(a.todo()).toContain("MODOS INCOMPATIBLES");
    expect(a.todo()).toContain("no se ha tocado la base");
  });

  it("sin DATABASE_URL aborta antes de invocar nada", async () => {
    const { entorno, arnes: a } = arnes({ argv: ["--aplicar"], url: undefined });

    const codigo = await ejecutarBackfillCajaCli(entorno);

    expect(codigo).toBe(CODIGO_ARGUMENTOS);
    expect(a.modos).toEqual([]);
    expect(a.serviciosCreados()).toBe(0);
  });

  it("ecoa la base de destino SIN usuario ni contrasena", async () => {
    const { entorno, arnes: a } = arnes({ argv: [] });

    await ejecutarBackfillCajaCli(entorno);

    expect(a.salida[0]).toBe("Base de destino: db.ejemplo.interno:6543/ordenex_prod");
    expect(a.todo()).not.toContain(USUARIO);
    expect(a.todo()).not.toContain(CONTRASENA);
  });

  it("`destinoLegible` no imprime nunca una URL ilegible cruda", () => {
    expect(destinoLegible(undefined)).toBeNull();
    expect(destinoLegible("")).toBeNull();
    expect(destinoLegible("no-es-una-url")).toBeNull();
    expect(destinoLegible("postgresql://u:p@host/base")).toBe("host:5432/base");
    // Una contrasena con `@` dentro: el recorte textual ingenuo la habria impreso.
    expect(destinoLegible("postgresql://u:p%40ss@host:5433/base")).toBe("host:5433/base");
  });
});

/* -------------------------------------------------------------------------- */
/* R43 / R44 — la comprobacion                                                 */
/* -------------------------------------------------------------------------- */

describe("R43 — `--comprobar` NOMBRA los documentos que no tienen su movimiento de caja", () => {
  it("cada pendiente sale con su origen, su id, su categoria, su monto y su fecha", async () => {
    const { entorno, arnes: a } = arnes({
      argv: ["--comprobar"],
      responde: (modo) =>
        informe({ modo, pendientes: [PENDIENTE_CIERRE, PENDIENTE_PAGO], alDia: false }),
    });

    await ejecutarBackfillCajaCli(entorno);

    expect(a.todo()).toContain(
      "cierre_aprobado cierre-a -> ingreso/ingreso_cod_recaudado 12801.00 fecha=2026-07-05T09:00:00.000Z",
    );
    expect(a.todo()).toContain(
      "pago_a_tienda pago-1 -> egreso/egreso_pago_tienda 15000.50 fecha=2026-07-30T00:00:00.000Z",
    );
    expect(a.todo()).toContain("sin movimiento de caja (2)");
  });

  it("y dice cuantos documentos miro de cada uno de los TRES origenes", async () => {
    const { entorno, arnes: a } = arnes({
      argv: ["--comprobar"],
      responde: (modo) =>
        informe({
          modo,
          examinados: { cierre_aprobado: 5, pago_a_tienda: 2, anulacion_de_pago_a_tienda: 1 },
        }),
    });

    await ejecutarBackfillCajaCli(entorno);

    expect(a.todo()).toContain("cierres aprobados: 5");
    expect(a.todo()).toContain("pagos a tienda: 2");
    expect(a.todo()).toContain("anulaciones de pago a tienda: 1");
  });
});

describe("R44 — con uno pendiente, `--comprobar` NO dice que el entorno esta al dia", () => {
  it("la salida ENTERA no contiene esas palabras, ni siquiera negadas", async () => {
    const { entorno, arnes: a } = arnes({
      argv: ["--comprobar"],
      responde: (modo) => informe({ modo, pendientes: [PENDIENTE_CIERRE], alDia: false }),
    });

    await ejecutarBackfillCajaCli(entorno);

    const texto = a.todo().toLowerCase();
    expect(texto).not.toContain("al dia");
    expect(texto).not.toContain("al día");
    expect(a.todo()).toContain("PENDIENTE: quedan 1 documentos sin su movimiento de caja");
  });

  it("y sale con un codigo distinto de 0: un olvido tiene que verse en el entorno", async () => {
    const { entorno } = arnes({
      argv: ["--comprobar"],
      responde: (modo) => informe({ modo, pendientes: [PENDIENTE_CIERRE], alDia: false }),
    });

    expect(await ejecutarBackfillCajaCli(entorno)).toBe(CODIGO_PENDIENTES);
  });

  it("sin nada pendiente, dice AL DIA y sale con 0", async () => {
    const { entorno, arnes: a } = arnes({
      argv: ["--comprobar"],
      responde: (modo) =>
        informe({
          modo,
          alDia: true,
          examinados: { cierre_aprobado: 5, pago_a_tienda: 2, anulacion_de_pago_a_tienda: 1 },
        }),
    });

    const codigo = await ejecutarBackfillCajaCli(entorno);

    expect(codigo).toBe(0);
    expect(a.todo()).toContain("AL DIA");
    expect(a.todo()).toContain("No falta ninguno");
  });

  it("`--simular` con pendientes sale en 0: es una vista previa, no un veredicto", async () => {
    const { entorno } = arnes({
      argv: ["--simular"],
      responde: (modo) => informe({ modo, pendientes: [PENDIENTE_CIERRE], alDia: false }),
    });

    expect(await ejecutarBackfillCajaCli(entorno)).toBe(0);
  });

  it("tras `--aplicar` el informe manda correr la comprobacion, que es quien cierra", async () => {
    const { entorno, arnes: a } = arnes({
      argv: ["--aplicar"],
      responde: (modo) =>
        informe({ modo, insertadas: 1, pendientes: [PENDIENTE_CIERRE], alDia: false }),
    });

    await ejecutarBackfillCajaCli(entorno);

    expect(a.todo()).toContain("Corre ahora --comprobar");
    expect(a.todo().toLowerCase()).not.toContain("al dia");
  });
});

/* -------------------------------------------------------------------------- */
/* El script no deriva nada                                                    */
/* -------------------------------------------------------------------------- */

describe("el ejecutable no calcula dinero: solo valida, ecoa y delega", () => {
  it("su fuente no suma, no resta y no convierte montos", () => {
    const fuente = fs
      .readFileSync(rutaDe("scripts/backfill-caja-tesoreria.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/[^\n]*/gm, "$1 ");

    for (const prohibida of [/\bNumber\s*\(/, /\bparseFloat\s*\(/, /\bparseInt\s*\(/, /Decimal/]) {
      expect(fuente, `el script usa ${prohibida}`).not.toMatch(prohibida);
    }
    // Y no nombra ninguna categoria: las trae el informe del servicio.
    expect(fuente).not.toContain("ingreso_cod_recaudado");
    expect(fuente).not.toContain("egreso_pago_tienda");
    expect(fuente).not.toContain("ingreso_reverso_pago_tienda");
  });
});
