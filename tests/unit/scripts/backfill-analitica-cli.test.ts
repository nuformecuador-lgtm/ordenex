import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import {
  AnaliticaRollupError,
  PrimerIntentoIncoherenteError,
  type IAnaliticaRollupService,
  type ResumenCorrida,
} from "@/lib/interfaces/services/IAnaliticaRollupService";
import { ejecutarBackfillCli, destinoLegible, type EntornoCli } from "@/scripts/backfill-analitica";

/**
 * Feature 125 / T3.4 — el CLI entero, ejercido SIN base de datos: argumentos, eco, confirmacion,
 * reporte, verificacion y codigos de salida. Cubre R1, R6, R7, R19, R24, R26-R30.
 *
 * El agregador se cuenta, no se simula a medias: casi todos los casos de aqui afirman «CERO
 * llamadas», que es lo unico que demuestra que una guarda corta ANTES de tocar la base.
 */

/** Credenciales de mentira, y a proposito feas: si alguna se cuela en la salida, se ve. */
const USUARIO = "usuario_de_prueba";
const CONTRASENA = "contrasena_que_no_debe_salir";
const URL_DE_PRUEBA = `postgresql://${USUARIO}:${CONTRASENA}@db.ejemplo.interno:6543/ordenex_prod`;

const AHORA = new Date("2026-08-02T15:00:00.000Z");

interface Arnes {
  readonly salida: string[];
  readonly errores: string[];
  readonly escritos: Map<string, string>;
  readonly llamadas: string[];
  /** Toda la salida (estandar y de error) en un solo texto, para censarla. */
  todo(): string;
}

function arnes(
  opciones: {
    argv: string[];
    archivos?: Record<string, string>;
    responde?: (fecha: string) => Partial<ResumenCorrida> | Error;
    url?: string | undefined;
  },
): { entorno: EntornoCli; arnes: Arnes } {
  const salida: string[] = [];
  const errores: string[] = [];
  const escritos = new Map<string, string>();
  const llamadas: string[] = [];
  const archivos = opciones.archivos ?? {};

  const rollup: IAnaliticaRollupService = {
    async agregarFecha(fecha: string): Promise<ResumenCorrida> {
      llamadas.push(fecha);
      const r = opciones.responde?.(fecha) ?? { filasEscritas: 4, filasRetiradas: 0, ms: 12 };
      if (r instanceof Error) throw r;
      return { fecha, filasEscritas: 0, filasRetiradas: 0, ms: 1, ...r };
    },
  };

  const entorno: EntornoCli = {
    argv: opciones.argv,
    env: { DATABASE_URL: "url" in opciones ? opciones.url : URL_DE_PRUEBA },
    ahora: () => AHORA,
    salida: (l) => void salida.push(l),
    errores: (l) => void errores.push(l),
    leerArchivo: (ruta) => {
      const contenido = archivos[ruta];
      if (contenido === undefined) throw new Error(`ENOENT: ${ruta}`);
      return contenido;
    },
    escribirArchivo: (ruta, contenido) => void escritos.set(ruta, contenido),
    crearRollup: () => rollup,
    dormir: async () => {},
  };

  return {
    entorno,
    arnes: {
      salida,
      errores,
      escritos,
      llamadas,
      todo: () => [...salida, ...errores].join("\n"),
    },
  };
}

const RANGO = ["--desde", "2026-07-20", "--hasta", "2026-07-22"];
const CONFIRMA = ["--confirmar", "2026-07-20..2026-07-22"];

/* -------------------------------------------------------------------------- */
/* R1                                                                          */
/* -------------------------------------------------------------------------- */

describe("R1 · importar el script no ejecuta nada; solo se auto-ejecuta como entrypoint", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("importar el modulo no imprime, no sale del proceso y no toca la base", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitCodeAntes = process.exitCode;
    vi.resetModules();

    const modulo = await import("@/scripts/backfill-analitica");

    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(exitCodeAntes);
    expect(typeof modulo.ejecutarBackfillCli).toBe("function");
  });

  it("la auto-ejecucion esta guardada por la comparacion con process.argv[1]", () => {
    const fuente = fs.readFileSync(rutaDe("scripts/backfill-analitica.ts"), "utf8");
    expect(fuente).toMatch(/pathToFileURL\(process\.argv\[1\]\)\.href/);
    expect(fuente).toMatch(/if\s*\(isEntrypoint\)/);
  });
});

function rutaDe(rel: string): string {
  return path.join(__dirname, "..", "..", "..", ...rel.split("/"));
}

/* -------------------------------------------------------------------------- */
/* R6 / R7                                                                     */
/* -------------------------------------------------------------------------- */

describe("R6 · --desde 2026-07-20 --hasta 2026-07-22 produce un plan de 3 fechas", () => {
  it("el eco anuncia tres fechas y, sin confirmar, sale 0 sin invocar al agregador", async () => {
    const { entorno, arnes: a } = arnes({ argv: RANGO });
    const codigo = await ejecutarBackfillCli(entorno);

    expect(codigo).toBe(0);
    expect(a.todo()).toContain("Fechas: 3");
    expect(a.todo()).toContain("2026-07-20 .. 2026-07-22");
    expect(a.llamadas).toEqual([]);
  });

  it("con confirmacion recorre las tres fechas en orden", async () => {
    const { entorno, arnes: a } = arnes({ argv: [...RANGO, ...CONFIRMA] });
    const codigo = await ejecutarBackfillCli(entorno);

    expect(codigo).toBe(0);
    expect(a.llamadas).toEqual(["2026-07-20", "2026-07-21", "2026-07-22"]);
  });
});

describe("R7 · sin rango, con desde>hasta y con 2026-13-01 sale distinto de 0 y hace 0 llamadas al agregador", () => {
  const casos: ReadonlyArray<{ nombre: string; argv: string[] }> = [
    { nombre: "sin rango ninguno", argv: [] },
    { nombre: "solo --desde", argv: ["--desde", "2026-07-20"] },
    { nombre: "solo --hasta", argv: ["--hasta", "2026-07-20"] },
    { nombre: "desde > hasta", argv: ["--desde", "2026-07-22", "--hasta", "2026-07-20"] },
    { nombre: "mes 13", argv: ["--desde", "2026-13-01", "--hasta", "2026-13-05"] },
    { nombre: "dia 30 de febrero", argv: ["--desde", "2026-02-30", "--hasta", "2026-03-02"] },
    { nombre: "bandera mal escrita", argv: ["--desdee", "2026-07-20", "--hasta", "2026-07-22"] },
  ];

  for (const caso of casos) {
    it(`${caso.nombre}: codigo distinto de 0, motivo impreso y cero llamadas`, async () => {
      const { entorno, arnes: a } = arnes({ argv: [...caso.argv, ...CONFIRMA] });
      const codigo = await ejecutarBackfillCli(entorno);

      expect(codigo).not.toBe(0);
      expect(a.llamadas).toEqual([]);
      expect(a.errores.join("\n").length).toBeGreaterThan(0);
    });
  }

  it("la ausencia de rango NO se interpreta como «toda la base»", async () => {
    const { entorno, arnes: a } = arnes({ argv: [...CONFIRMA] });
    await ejecutarBackfillCli(entorno);
    expect(a.errores.join(" ")).toMatch(/rango es OBLIGATORIO|desde/i);
    expect(a.llamadas).toEqual([]);
  });

  it("el dia CR en curso se rechaza aunque la confirmacion sea correcta", async () => {
    // AHORA es el 2026-08-02 CR: un rango que llega hasta hoy no es recomputable (D3).
    const { entorno, arnes: a } = arnes({
      argv: ["--desde", "2026-08-01", "--hasta", "2026-08-02", "--confirmar", "2026-08-01..2026-08-02"],
    });
    const codigo = await ejecutarBackfillCli(entorno);
    expect(codigo).not.toBe(0);
    expect(a.llamadas).toEqual([]);
    expect(a.errores.join(" ")).toContain("2026-08-02");
  });
});

/* -------------------------------------------------------------------------- */
/* R19                                                                         */
/* -------------------------------------------------------------------------- */

describe("R19 · el reporte escrito se relee y contiene una entrada por fecha, sin ids de zona, tienda, mensajero, estatus ni orden", () => {
  it("el JSON trae cabecera + una entrada por fecha con los cinco campos", async () => {
    const { entorno, arnes: a } = arnes({
      argv: [...RANGO, ...CONFIRMA, "--reporte", "salida/reporte.json"],
      responde: (f) => ({ filasEscritas: f === "2026-07-21" ? 7 : 4, filasRetiradas: 1, ms: 33 }),
    });
    await ejecutarBackfillCli(entorno);

    const crudo = a.escritos.get("salida/reporte.json");
    expect(crudo, "no se escribio el reporte").toBeDefined();
    const reporte = JSON.parse(crudo as string);

    expect(reporte.rango).toEqual({ desde: "2026-07-20", hasta: "2026-07-22" });
    expect(reporte.modo).toBe("escritura");
    expect(reporte.instante).toBe(AHORA.toISOString());
    expect(reporte.entradas).toHaveLength(3);
    expect(reporte.entradas[1]).toEqual({
      fecha: "2026-07-21",
      filasEscritas: 7,
      filasRetiradas: 1,
      ms: 33,
      clasificacion: "procesada",
    });
  });

  it("el reporte no lleva ni un identificador ni ninguna coordenada del rollup", async () => {
    const { entorno, arnes: a } = arnes({
      argv: [...RANGO, ...CONFIRMA, "--reporte", "r.json"],
    });
    await ejecutarBackfillCli(entorno);
    const reporte = JSON.parse(a.escritos.get("r.json") as string);

    const claves = new Set<string>();
    const recorrer = (v: unknown): void => {
      if (Array.isArray(v)) return void v.forEach(recorrer);
      if (v !== null && typeof v === "object") {
        for (const [k, valor] of Object.entries(v)) {
          claves.add(k);
          recorrer(valor);
        }
      }
    };
    recorrer(reporte);
    for (const prohibida of ["zona", "zonaId", "tienda", "tiendaId", "mensajero", "mensajeroId", "estatus", "estatusId", "orden", "ordenId", "id"]) {
      expect([...claves], `el reporte lleva la clave ${prohibida}`).not.toContain(prohibida);
    }
    // Y ningun uuid en el texto, mire donde mire.
    expect(a.escritos.get("r.json")).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i);
  });

  it("sin --reporte no se escribe ningun archivo", async () => {
    const { entorno, arnes: a } = arnes({ argv: [...RANGO, ...CONFIRMA] });
    await ejecutarBackfillCli(entorno);
    expect(a.escritos.size).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* R24 / R26                                                                   */
/* -------------------------------------------------------------------------- */

function reporteDe(desde: string, hasta: string, fechas: string[], filas = 4): string {
  return JSON.stringify({
    rango: { desde, hasta },
    modo: "escritura",
    instante: AHORA.toISOString(),
    entradas: fechas.map((fecha) => ({
      fecha,
      filasEscritas: filas,
      filasRetiradas: 0,
      ms: 10,
      clasificacion: "procesada",
    })),
  });
}

describe("R24 · --verificar sin reporte previo, y con un reporte que no cubre el rango, sale distinto de 0 con 0 llamadas al agregador", () => {
  it("sin --contra aborta antes de invocar el agregador", async () => {
    const { entorno, arnes: a } = arnes({ argv: [...RANGO, ...CONFIRMA, "--verificar"] });
    const codigo = await ejecutarBackfillCli(entorno);

    expect(codigo).not.toBe(0);
    expect(a.llamadas).toEqual([]);
    expect(a.errores.join(" ")).toContain("--contra");
  });

  it("con --contra apuntando a un archivo que no existe aborta antes de invocar el agregador", async () => {
    const { entorno, arnes: a } = arnes({
      argv: [...RANGO, ...CONFIRMA, "--verificar", "--contra", "no-existe.json"],
    });
    expect(await ejecutarBackfillCli(entorno)).not.toBe(0);
    expect(a.llamadas).toEqual([]);
  });

  it("con un reporte que NO cubre todo el rango aborta y dice la primera fecha que falta", async () => {
    const { entorno, arnes: a } = arnes({
      argv: [...RANGO, ...CONFIRMA, "--verificar", "--contra", "previo.json"],
      archivos: { "previo.json": reporteDe("2026-07-20", "2026-07-21", ["2026-07-20", "2026-07-21"]) },
    });
    const codigo = await ejecutarBackfillCli(entorno);

    expect(codigo).not.toBe(0);
    expect(a.llamadas).toEqual([]);
    expect(a.errores.join(" ")).toContain("2026-07-22");
  });

  it("con un reporte que no es JSON, o que no tiene la forma esperada, aborta igual", async () => {
    for (const contenido of ["{no es json", JSON.stringify({ entradas: [] })]) {
      const { entorno, arnes: a } = arnes({
        argv: [...RANGO, ...CONFIRMA, "--verificar", "--contra", "p.json"],
        archivos: { "p.json": contenido },
      });
      expect(await ejecutarBackfillCli(entorno)).not.toBe(0);
      expect(a.llamadas).toEqual([]);
    }
  });

  it("con un reporte que SI cubre el rango, verifica y sale 0 si todo esta estable", async () => {
    const fechas = ["2026-07-20", "2026-07-21", "2026-07-22"];
    const { entorno, arnes: a } = arnes({
      argv: [...RANGO, ...CONFIRMA, "--verificar", "--contra", "previo.json"],
      archivos: { "previo.json": reporteDe("2026-07-20", "2026-07-22", fechas, 4) },
      responde: () => ({ filasEscritas: 4, filasRetiradas: 0, ms: 9 }),
    });
    const codigo = await ejecutarBackfillCli(entorno);

    expect(codigo).toBe(0);
    expect(a.llamadas).toEqual(fechas);
    expect(a.todo()).toContain("[estable]");
  });

  it("una fecha cuyo numero de filas cambio sale con codigo 2", async () => {
    const fechas = ["2026-07-20", "2026-07-21", "2026-07-22"];
    const { entorno, arnes: a } = arnes({
      argv: [...RANGO, ...CONFIRMA, "--verificar", "--contra", "previo.json"],
      archivos: { "previo.json": reporteDe("2026-07-20", "2026-07-22", fechas, 4) },
      responde: (f) => ({ filasEscritas: f === "2026-07-21" ? 5 : 4, filasRetiradas: 0, ms: 9 }),
    });
    expect(await ejecutarBackfillCli(entorno)).toBe(2);
    expect(a.todo()).toContain("[cambiada]");
  });
});

describe("R26 · el eco de --verificar dice que la verificacion escribe", () => {
  it("lo dice antes de la primera invocacion y no se anuncia como solo lectura", async () => {
    const fechas = ["2026-07-20", "2026-07-21", "2026-07-22"];
    const { entorno, arnes: a } = arnes({
      argv: [...RANGO, "--verificar", "--contra", "previo.json"],
      archivos: { "previo.json": reporteDe("2026-07-20", "2026-07-22", fechas) },
    });
    await ejecutarBackfillCli(entorno);

    const texto = a.todo();
    expect(texto).toMatch(/--verificar ESCRIBE/);
    expect(texto).not.toMatch(/solo lectura|s[oó]lo lectura|read.?only/i);
    expect(a.llamadas, "el eco se imprime ANTES de invocar nada").toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* R27 / R28 / R29                                                             */
/* -------------------------------------------------------------------------- */

describe("R27 · el eco trae host, puerto, base, modo, rango, numero de fechas y no comparables, y no imprime la contrasena de la URL de prueba", () => {
  it("las seis cosas estan en el eco, y estan antes de la primera invocacion", async () => {
    const { entorno, arnes: a } = arnes({
      argv: ["--desde", "2026-07-11", "--hasta", "2026-07-15"],
    });
    await ejecutarBackfillCli(entorno);

    const texto = a.todo();
    expect(texto).toContain("db.ejemplo.interno");
    expect(texto).toContain("6543");
    expect(texto).toContain("ordenex_prod");
    expect(texto).toContain("Modo: escritura");
    expect(texto).toContain("2026-07-11 .. 2026-07-15");
    expect(texto).toContain("Fechas: 5");
    expect(texto).toContain("no comparables: 2");
    expect(a.llamadas).toEqual([]);
  });

  it("sin DATABASE_URL aborta antes de invocar el agregador", async () => {
    const { entorno, arnes: a } = arnes({ argv: [...RANGO, ...CONFIRMA], url: undefined });
    expect(await ejecutarBackfillCli(entorno)).not.toBe(0);
    expect(a.llamadas).toEqual([]);
  });

  it("destinoLegible reconstruye host:puerto/base y no devuelve nada de la credencial", () => {
    expect(destinoLegible(URL_DE_PRUEBA)).toBe("db.ejemplo.interno:6543/ordenex_prod");
    // Sin puerto explicito: se asume el de Postgres.
    expect(destinoLegible("postgresql://u:p@localhost/ordenex")).toBe("localhost:5432/ordenex");
    // Una contrasena con `@` dentro es justo lo que rompe cualquier recorte textual.
    expect(destinoLegible("postgresql://u:p%40ss@host.local:5432/base")).toBe("host.local:5432/base");
    expect(destinoLegible("no-es-una-url")).toBeNull();
    expect(destinoLegible(undefined)).toBeNull();
  });
});

describe("R28 · sin confirmacion no hay llamadas al agregador; con confirmacion y rango reintroducido distinto sale distinto de 0 sin llamadas", () => {
  it("sin --confirmar imprime el plan, sale 0 y no invoca nada", async () => {
    const { entorno, arnes: a } = arnes({ argv: RANGO });
    expect(await ejecutarBackfillCli(entorno)).toBe(0);
    expect(a.llamadas).toEqual([]);
    expect(a.todo()).toMatch(/no se ha invocado el agregador/i);
  });

  it("con el rango reintroducido DISTINTO aborta con codigo distinto de 0 y sin llamadas", async () => {
    for (const mal of ["2026-07-20..2026-07-23", "2026-07-19..2026-07-22", "si", "2026-07-20", ""]) {
      const { entorno, arnes: a } = arnes({ argv: [...RANGO, "--confirmar", mal] });
      const codigo = await ejecutarBackfillCli(entorno);
      expect(codigo, `confirmacion "${mal}"`).not.toBe(0);
      expect(a.llamadas, `confirmacion "${mal}"`).toEqual([]);
    }
  });

  it("solo el rango reintroducido LITERALMENTE deja pasar", async () => {
    const { entorno, arnes: a } = arnes({ argv: [...RANGO, ...CONFIRMA] });
    expect(await ejecutarBackfillCli(entorno)).toBe(0);
    expect(a.llamadas).toHaveLength(3);
  });
});

describe("R29 · ninguna salida contiene el usuario ni la contrasena", () => {
  it("ni en el eco, ni en el progreso, ni en el resumen, ni en el reporte, ni en los errores", async () => {
    const casos: string[][] = [
      RANGO,
      [...RANGO, ...CONFIRMA, "--reporte", "r.json"],
      [...RANGO, "--confirmar", "rango-equivocado"],
      [...RANGO, ...CONFIRMA, "--verificar"],
      ["--desde", "malo", "--hasta", "peor"],
    ];
    for (const argv of casos) {
      const { entorno, arnes: a } = arnes({
        argv,
        responde: (f) => new AnaliticaRollupError(f, "escritura", new Error("causa")),
      });
      await ejecutarBackfillCli(entorno);
      const texto = [a.todo(), ...a.escritos.values()].join("\n");
      expect(texto, `argv: ${argv.join(" ")}`).not.toContain(CONTRASENA);
      expect(texto, `argv: ${argv.join(" ")}`).not.toContain(USUARIO);
    }
  });

  it("los archivos de la 125 no llevan ninguna URL de conexion escrita", () => {
    for (const rel of [
      "scripts/backfill-analitica.ts",
      "lib/services/AnaliticaBackfillService.ts",
      "lib/analytics/backfill-rango.ts",
    ]) {
      const fuente = fs.readFileSync(rutaDe(rel), "utf8");
      expect(fuente, rel).not.toMatch(/postgres(?:ql)?:\/\//);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* R30                                                                         */
/* -------------------------------------------------------------------------- */

describe("R30 · por defecto imprime fecha + nombre del error + etapa y no el mensaje crudo; con --verboso imprime el error completo", () => {
  const CUBO = "zona-abc|tienda-def|mensajero-ghi";

  it("por defecto NO aparece la clave del cubo que el mensaje crudo lleva dentro", async () => {
    const { entorno, arnes: a } = arnes({
      argv: [...RANGO, ...CONFIRMA],
      responde: (f) => (f === "2026-07-21" ? new PrimerIntentoIncoherenteError(f, CUBO, 3, 1) : {}),
    });
    const codigo = await ejecutarBackfillCli(entorno);

    expect(codigo).toBe(2);
    const texto = a.todo();
    expect(texto).toContain("2026-07-21");
    expect(texto).toContain("PrimerIntentoIncoherenteError");
    expect(texto, "el mensaje crudo lleva la clave del cubo dentro").not.toContain(CUBO);
  });

  it("imprime la etapa cuando el error la trae", async () => {
    const { entorno, arnes: a } = arnes({
      argv: [...RANGO, ...CONFIRMA],
      responde: (f) =>
        f === "2026-07-21" ? new AnaliticaRollupError(f, "ciclos_cerrados", new Error("x")) : {},
    });
    await ejecutarBackfillCli(entorno);
    expect(a.errores.join("\n")).toContain("etapa=ciclos_cerrados");
  });

  it("con --verboso si aparece el error completo", async () => {
    const { entorno, arnes: a } = arnes({
      argv: [...RANGO, ...CONFIRMA, "--verboso"],
      responde: (f) => (f === "2026-07-21" ? new PrimerIntentoIncoherenteError(f, CUBO, 3, 1) : {}),
    });
    await ejecutarBackfillCli(entorno);
    expect(a.errores.join("\n")).toContain(CUBO);
  });

  it("--verboso no se activa por la omision de ningun otro argumento", async () => {
    // Mismo caso que el primero pero con TODOS los demas argumentos ausentes: sigue callado.
    const { entorno, arnes: a } = arnes({
      argv: [...RANGO, ...CONFIRMA],
      responde: (f) => new PrimerIntentoIncoherenteError(f, CUBO, 3, 1),
    });
    await ejecutarBackfillCli(entorno);
    expect(a.todo()).not.toContain(CUBO);
  });
});

/* -------------------------------------------------------------------------- */
/* R18 / R31 en la superficie del CLI                                          */
/* -------------------------------------------------------------------------- */

describe("el resumen del CLI nombra las fechas fallidas y devuelve el codigo 2", () => {
  it("una fecha fallida aparece por su nombre en el resumen y el codigo es 2", async () => {
    const { entorno, arnes: a } = arnes({
      argv: [...RANGO, ...CONFIRMA],
      responde: (f) => (f === "2026-07-22" ? new Error("revento") : {}),
    });
    expect(await ejecutarBackfillCli(entorno)).toBe(2);
    expect(a.todo()).toMatch(/Fechas FALLIDAS: 2026-07-22/);
  });
});
