import { describe, it, expect, vi, afterEach } from "vitest";
import {
  ejecutarCli,
  type BackfillMarcadorClient,
  type EntornoBackfillMarcador,
  type InformeBackfillMarcador,
} from "@/scripts/backfill-marcador-config-geocode";

/**
 * FICHA 400 (`menor-3` de la revisión del 2026-09-09) — EL PUNTO DE ENTRADA DEL BACKFILL,
 * EJERCIDO ENTERO SIN BASE DE DATOS.
 *
 * POR QUE HACE FALTA. `backfillMarcadorConfigGeocode` —el SQL— está probado contra Postgres
 * real (`tests/integration/db/backfill-marcador-config-geocode.test.ts`), pero el envoltorio
 * CLI no lo tocaba nadie, y **es exactamente lo que la task T20 va a invocar contra
 * PRODUCCION**. Lo que aquí se mide es sobre todo lo que el ejecutable NO hace:
 *
 *  - **sin `--apply` no escribe ni pide escribir**: se comprueba con qué `aplicar` se invocó
 *    la operación, no leyendo el código;
 *  - **una errata en el flag no se interpreta como "no escribas"**: `--aply` se RECHAZA con
 *    código != 0 en vez de correr en silencio como si fuera una simulación. Es el modo de
 *    fallo peligroso al revés: quien escribió mal el flag cree que aplicó y no aplicó nada;
 *  - **no se abre ninguna conexión hasta que hace falta** (`crearCliente` es perezoso);
 *  - **la salida dice el NUMERO**, que es lo que hay que poder decirle al humano antes de
 *    tocar producción (memoria del repo: medir el backfill antes de desplegar).
 *
 * Patrón de `tests/unit/scripts/backfill-caja-tesoreria-cli.test.ts`: toda la I/O va
 * inyectada por `EntornoBackfillMarcador`, así que no hace falta ni proceso hijo ni DB.
 */

/** Credenciales feas a propósito: si alguna se colara en la salida, se vería. */
const URL_DE_PRUEBA =
  "postgresql://usuario_de_prueba:contrasena_que_no_debe_salir@db.ejemplo.interno:6543/ordenex_prod";

/**
 * `ejecutarCli` llama a `backfillMarcadorConfigGeocode` con el cliente que le da el entorno.
 * Para observar el `aplicar` sin base de datos se le pasa un cliente que responde a las dos
 * consultas del informe y registra si se llegó a `$executeRaw` (que es LA escritura).
 */
function entornoObservable(opciones: {
  argv: string[];
  candidatas?: number;
  porEstado?: { estado: string; total: number }[];
  filasActualizadas?: number;
}): {
  entorno: EntornoBackfillMarcador;
  salida: string[];
  errores: string[];
  escrituras: number;
  consultas: () => number;
  clientesCreados: () => number;
} {
  const salida: string[] = [];
  const errores: string[] = [];
  const estado = { escrituras: 0, consultas: 0, creados: 0 };

  const cliente: BackfillMarcadorClient = {
    $queryRaw: (async () => {
      estado.consultas += 1;
      // 1.ª consulta: el conteo de candidatas. 2.ª: el desglose por estado.
      return estado.consultas === 1
        ? [{ total: BigInt(opciones.candidatas ?? 0) }]
        : (opciones.porEstado ?? []).map((f) => ({
            estado: f.estado,
            total: BigInt(f.total),
          }));
    }) as BackfillMarcadorClient["$queryRaw"],
    $executeRaw: (async () => {
      estado.escrituras += 1;
      return opciones.filasActualizadas ?? 0;
    }) as BackfillMarcadorClient["$executeRaw"],
  };

  return {
    entorno: {
      argv: opciones.argv,
      salida: (l) => void salida.push(l),
      errores: (l) => void errores.push(l),
      crearCliente: () => {
        estado.creados += 1;
        return cliente;
      },
    },
    salida,
    errores,
    get escrituras() {
      return estado.escrituras;
    },
    consultas: () => estado.consultas,
    clientesCreados: () => estado.creados,
  };
}

describe("400/menor-3 — SIN `--apply` el CLI no escribe ni una fila", () => {
  it("con argv vacío: cero escrituras, y lo dice en la salida", async () => {
    const e = entornoObservable({ argv: [], candidatas: 7 });

    const codigo = await ejecutarCli(e.entorno);

    expect(codigo).toBe(0);
    // LA aserción: `$executeRaw` —la única escritura del script— no se llamó.
    expect(e.escrituras).toBe(0);
    // No-vacuidad: sí se consultó, así que el cero de arriba no es "no corrió nada".
    expect(e.consultas()).toBe(2);
    expect(e.salida.join("\n")).toContain("SOLO LECTURA");
    expect(e.salida.join("\n")).toContain("no se escribio nada");
  });

  it("dice el NUMERO de candidatas, que es lo que hay que poder decirle al humano antes", async () => {
    const e = entornoObservable({ argv: [], candidatas: 42 });

    await ejecutarCli(e.entorno);

    expect(e.salida.join("\n")).toContain("42");
  });

  it("con CERO candidatas —el caso esperado hoy— lo dice sin ambigüedad y sigue sin escribir", async () => {
    const e = entornoObservable({ argv: [], candidatas: 0, porEstado: [] });

    expect(await ejecutarCli(e.entorno)).toBe(0);
    expect(e.escrituras).toBe(0);
    const todo = e.salida.join("\n");
    expect(todo).toContain("candidatas");
    expect(todo).toContain("0");
    expect(todo).toContain("ninguna fila con el texto legado");
  });

  it("imprime el desglose por estado, incluidos los `pending` que se curan solos", async () => {
    const e = entornoObservable({
      argv: [],
      candidatas: 3,
      porEstado: [
        { estado: "failed", total: 3 },
        { estado: "pending", total: 5 },
      ],
    });

    await ejecutarCli(e.entorno);

    const todo = e.salida.join("\n");
    expect(todo).toContain("failed: 3");
    expect(todo).toContain("pending: 5");
  });
});

describe("400/menor-3 — CON `--apply` sí escribe, y lo reporta", () => {
  it("`--apply` llega a la escritura y dice cuántas filas actualizó", async () => {
    const e = entornoObservable({ argv: ["--apply"], candidatas: 4, filasActualizadas: 4 });

    const codigo = await ejecutarCli(e.entorno);

    expect(codigo).toBe(0);
    expect(e.escrituras).toBe(1);
    const todo = e.salida.join("\n");
    expect(todo).toContain("APLICAR");
    expect(todo).toContain("filas actualizadas: 4");
    // Y NO dice lo contrario: el modo de fallo peor sería que imprimiera las dos frases.
    expect(todo).not.toContain("no se escribio nada");
  });
});

describe("400/menor-3 — una errata en el flag se RECHAZA, no se interpreta como simulación", () => {
  it.each(["--aply", "--applY", "-apply", "--apply-todo", "aplicar"])(
    "`%s` -> código 2, sin abrir conexión y sin escribir",
    async (flagMalo) => {
      // El modo de fallo que esto cierra: quien escribe mal el flag creería haber aplicado
      // el backfill, el script correría como simulación, imprimiría un número y saldría con
      // 0. Silencioso y convincente.
      const e = entornoObservable({ argv: [flagMalo] });

      const codigo = await ejecutarCli(e.entorno);

      expect(codigo).toBe(2);
      expect(e.escrituras).toBe(0);
      expect(e.consultas()).toBe(0);
      // Perezoso: ni siquiera se abre la conexión si los argumentos no valen.
      expect(e.clientesCreados()).toBe(0);
      expect(e.errores.join("\n")).toContain("no reconocido");
    },
  );

  it("`--apply` junto a un argumento desconocido también se rechaza (no gana el que se entiende)", async () => {
    const e = entornoObservable({ argv: ["--apply", "--forzar"] });

    expect(await ejecutarCli(e.entorno)).toBe(2);
    expect(e.escrituras).toBe(0);
    expect(e.clientesCreados()).toBe(0);
  });
});

describe("400/menor-3 — la conexión es perezosa y la salida no filtra la credencial", () => {
  it("el cliente se crea UNA vez, y solo cuando los argumentos son válidos", async () => {
    const e = entornoObservable({ argv: [], candidatas: 1 });

    await ejecutarCli(e.entorno);

    expect(e.clientesCreados()).toBe(1);
  });

  it("nada de lo impreso contiene la URL de la base ni su contraseña", async () => {
    const previo = process.env.DATABASE_URL;
    process.env.DATABASE_URL = URL_DE_PRUEBA;
    try {
      const e = entornoObservable({ argv: ["--apply"], candidatas: 2, filasActualizadas: 2 });

      await ejecutarCli(e.entorno);

      const todo = [...e.salida, ...e.errores].join("\n");
      // No-vacuidad: SÍ se imprimió algo.
      expect(todo.length).toBeGreaterThan(0);
      for (const prohibido of [
        URL_DE_PRUEBA,
        "contrasena_que_no_debe_salir",
        "usuario_de_prueba",
        "db.ejemplo.interno",
        "postgresql://",
      ]) {
        expect(todo).not.toContain(prohibido);
      }
    } finally {
      if (previo === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previo;
    }
  });
});

describe("400/menor-3 — importar el script no ejecuta nada", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("importar el módulo no imprime, no cambia `process.exitCode` y no toca la base", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitCodeAntes = process.exitCode;
    vi.resetModules();

    await import("@/scripts/backfill-marcador-config-geocode");

    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(exitCodeAntes);
  });
});
