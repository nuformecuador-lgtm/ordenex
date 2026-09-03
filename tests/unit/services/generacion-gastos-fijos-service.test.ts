import { describe, it, expect, vi } from "vitest";
import { GeneracionGastosFijosService } from "@/lib/services/GeneracionGastosFijosService";
import type { IGastoFijoPlantillaRepository } from "@/lib/interfaces/repositories/IGastoFijoPlantillaRepository";
import type { IWalletMovimientoRepository } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type {
  CrearCobroPendienteInput,
  IGastoFijoCobroRepository,
} from "@/lib/interfaces/repositories/IGastoFijoCobroRepository";
import type {
  GeneracionGastosFijosTx,
  GeneracionGastosFijosTxRunner,
} from "@/lib/interfaces/services/IGeneracionGastosFijosService";
import type { GastoFijoCobroPendienteNotificador } from "@/lib/notificaciones/notificadores";
import type { GastoFijoPlantillaDTO } from "@/lib/types/gasto-fijo-plantilla";

// Feature 45 + 84 (R27/R28/R30/R31) — logica del cron DIARIO. De las plantillas ACTIVAS genera UN
// egreso egreso_gasto_fijo por cada una que APLICA HOY (origen_id "<plantillaId>:<periodo>",
// monto=plantilla STRING, autor NULL); las inactivas nunca entran; un unico createMany (atomico).
// Dobles de repo (sin DB/HTTP). Reloj inyectado: mediodia CR = 18:00 UTC (UTC-6).
//
// FICHA 333 (D6) — el archivo gana los casos del INTERRUPTOR: R5 (cobra sola = el egreso de
// siempre, byte por byte), R6 (requiere aprobacion = cobro pendiente y NADA en el libro), R7 (la
// copia de concepto y monto), R8 (la clave resuelta una sola vez), R11 (el formato del periodo no
// cambia) y R12 (una inactiva no genera ninguna de las dos cosas).

const NOW = new Date("2026-07-15T18:00:00.000Z"); // 12:00 CR del 15 jul

function plantilla(overrides: Partial<GastoFijoPlantillaDTO> = {}): GastoFijoPlantillaDTO {
  return {
    id: "p-alquiler",
    concepto: "Alquiler",
    monto: "80000.00",
    activa: true,
    periodicidadUnidad: "meses",
    periodicidadCantidad: 1,
    fechaCobro: "2026-07-15", // ancla el 15 -> aplica el 15 jul (NOW)
    // ⚠️ FICHA 333 (D6/R5) — EL FIXTURE POR DEFECTO ES «COBRA SOLA», y no es indiferente:
    // este bloque de tests es el del CAMINO AUTOMATICO, el que la ficha promete dejar
    // IDENTICO (R5). Con `true` («requiere aprobacion») cada uno de ellos estaria midiendo el
    // camino nuevo con el nombre del viejo. Los tests del cobro pendiente ponen `true`
    // explicitamente, que es donde esa palabra se lee.
    requiereAprobacion: false,
    createdAt: "2026-07-01T10:00:00.000Z",
    updatedAt: "2026-07-01T10:00:00.000Z",
    ...overrides,
  };
}

function buildPlantillaRepo(activas: GastoFijoPlantillaDTO[]): IGastoFijoPlantillaRepository {
  return {
    crear: vi.fn(),
    actualizar: vi.fn(),
    setActiva: vi.fn(),
    listar: vi.fn(),
    listarActivas: vi.fn().mockResolvedValue(activas),
    // Feature 170 (T I.1): listado paginado; el cron no lo usa.
    listarPaginado: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    obtenerPorId: vi.fn(),
    // Ficha 332: el borrado entra en el contrato del repositorio; el cron NO lo usa (ni debe).
    eliminar: vi.fn(),
  };
}

function buildMovimientoRepo(count: number): IWalletMovimientoRepository {
  return {
    crearMovimientos: vi.fn().mockResolvedValue(count),
    listar: vi.fn(),
    agregarPorCategoriaYTipo: vi.fn(),
    obtenerPorId: vi.fn(),
    agregarPorCategoria: vi.fn(),
    obtenerPorOrigen: vi.fn(), // ficha 333: lectura por la clave del libro; este camino no la usa
    // ficha 362: el escritor de los movimientos que nacen de una DECISION humana; registra la
    // accion en su propia transaccion. Los feeds automaticos siguen entrando por `crearMovimientos`.
    crearMovimientoRegistrado: vi.fn().mockResolvedValue(1),
  };
}

/**
 * Ficha 333 (D6) — doble del repositorio de COBROS. `creadas` es lo que `crearPendientes`
 * devuelve (0 en una reejecucion, por `gasto_fijo_cobro_origen_uq`) y `totales` lo que
 * `contarPendientes` responde al final de la corrida.
 */
function buildCobroRepo(creadas = 0, totales = 0): IGastoFijoCobroRepository {
  return {
    crearPendientes: vi.fn().mockResolvedValue(creadas),
    obtenerPorId: vi.fn(),
    listarPendientes: vi.fn(),
    contarPendientes: vi.fn().mockResolvedValue(totales),
    contarPendientesDePlantilla: vi.fn(),
    marcarDecidido: vi.fn(),
    enlazarMovimiento: vi.fn(),
    cancelarPendientesDePlantilla: vi.fn(),
  };
}

/**
 * Ficha 333 (R10) — runner en memoria con la misma semantica que `prisma.$transaction`: ejecuta
 * `fn` y propaga lo que devuelva o lance. Los dobles de repositorio ignoran el `tx`, asi que lo
 * que este runner permite MEDIR es que las dos escrituras se piden dentro de la MISMA llamada.
 */
const runTx: GeneracionGastosFijosTxRunner = async (fn) => fn({} as GeneracionGastosFijosTx);

function movsDe(movRepo: IWalletMovimientoRepository) {
  return (movRepo.crearMovimientos as ReturnType<typeof vi.fn>).mock.calls[0][1];
}

/** Las filas que el service pidio insertar en `gasto_fijo_cobro` en su unica llamada. */
function cobrosDe(cobroRepo: IGastoFijoCobroRepository): CrearCobroPendienteInput[] {
  return (cobroRepo.crearPendientes as ReturnType<typeof vi.fn>).mock
    .calls[0][1] as CrearCobroPendienteInput[];
}

describe("GeneracionGastosFijosService — solo cobra lo que aplica hoy (feature 84)", () => {
  it("genera un egreso por plantilla que aplica hoy; forma correcta de cada fila", async () => {
    const activas = [
      plantilla(), // mensual dia 15 -> aplica el 15
      plantilla({ id: "p-internet", concepto: "Internet", monto: "25000.00", fechaCobro: "2026-07-15" }),
    ];
    const movRepo = buildMovimientoRepo(2);
    const svc = new GeneracionGastosFijosService(buildPlantillaRepo(activas), movRepo, buildCobroRepo(), runTx);

    const r = await svc.ejecutarGeneracion(NOW);

    // ⚠️ LITERAL A PROPOSITO, y es el CONTRATO del resumen del cron (R13): se actualiza a mano
    // cuando el resumen gana un campo. Derivarlo de la propia constante lo dejaria siempre verde
    // y no fijaria nada — es la leccion que este repo ya tiene escrita.
    expect(r).toEqual({
      fecha: "2026-07-15",
      plantillasActivas: 2,
      plantillasQueAplicanHoy: 2,
      egresosGenerados: 2,
      cobrosPendientesCreados: 0, // ficha 333: las dos plantillas COBRAN SOLAS
      cobrosPendientesTotales: 0,
    });
    const movs = movsDe(movRepo);
    expect(movs).toHaveLength(2);
    expect(movs[0]).toEqual({
      tipo: "egreso",
      categoria: "egreso_gasto_fijo",
      monto: "80000.00", // money-safe: STRING
      origenTipo: "gasto",
      origenId: "p-alquiler:2026-07", // meses -> clave :YYYY-MM
      descripcion: "Alquiler — 2026-07",
      registradoPor: null, // generacion automatica
    });
  });

  it("una plantilla que NO aplica hoy queda fuera del createMany", async () => {
    const activas = [
      plantilla({ id: "aplica", fechaCobro: "2026-07-15" }), // aplica el 15
      plantilla({ id: "no-aplica", fechaCobro: "2026-07-20" }), // mensual dia 20 -> NO el 15
    ];
    const movRepo = buildMovimientoRepo(1);
    const svc = new GeneracionGastosFijosService(buildPlantillaRepo(activas), movRepo, buildCobroRepo(), runTx);

    const r = await svc.ejecutarGeneracion(NOW);

    expect(r).toMatchObject({ plantillasActivas: 2, plantillasQueAplicanHoy: 1, egresosGenerados: 1 });
    const movs = movsDe(movRepo);
    expect(movs).toHaveLength(1);
    expect(movs[0].origenId).toBe("aplica:2026-07");
  });

  it("R31: un UNICO createMany para toda la corrida (atomico)", async () => {
    const movRepo = buildMovimientoRepo(1);
    const svc = new GeneracionGastosFijosService(buildPlantillaRepo([plantilla()]), movRepo, buildCobroRepo(), runTx);
    await svc.ejecutarGeneracion(NOW);
    expect(movRepo.crearMovimientos).toHaveBeenCalledTimes(1);
  });

  it("R27: las plantillas INACTIVAS no entran (el service consume listarActivas, no listar)", async () => {
    const plantillaRepo = buildPlantillaRepo([]); // el repo de activas no las devuelve
    const movRepo = buildMovimientoRepo(0);
    const svc = new GeneracionGastosFijosService(plantillaRepo, movRepo, buildCobroRepo(), runTx);

    const r = await svc.ejecutarGeneracion(NOW);

    expect(plantillaRepo.listarActivas).toHaveBeenCalledTimes(1);
    expect(plantillaRepo.listar).not.toHaveBeenCalled();
    expect(r).toEqual({
      fecha: "2026-07-15",
      plantillasActivas: 0,
      plantillasQueAplicanHoy: 0,
      egresosGenerados: 0,
      cobrosPendientesCreados: 0,
      cobrosPendientesTotales: 0,
    });
    expect(movsDe(movRepo)).toHaveLength(0);
  });
});

describe("GeneracionGastosFijosService — clave de idempotencia por unidad", () => {
  it("meses -> `:YYYY-MM`", async () => {
    const movRepo = buildMovimientoRepo(1);
    const svc = new GeneracionGastosFijosService(
      buildPlantillaRepo([plantilla({ periodicidadUnidad: "meses", fechaCobro: "2026-07-15" })]),
      movRepo,
      buildCobroRepo(),
      runTx,
    );
    await svc.ejecutarGeneracion(NOW);
    expect(movsDe(movRepo)[0].origenId).toBe("p-alquiler:2026-07");
  });

  it("dias -> `:YYYY-MM-DD` (fecha CR del disparo)", async () => {
    const movRepo = buildMovimientoRepo(1);
    const svc = new GeneracionGastosFijosService(
      buildPlantillaRepo([plantilla({ periodicidadUnidad: "dias", periodicidadCantidad: 1, fechaCobro: "2026-07-10" })]),
      movRepo,
      buildCobroRepo(),
      runTx,
    );
    await svc.ejecutarGeneracion(NOW);
    expect(movsDe(movRepo)[0].origenId).toBe("p-alquiler:2026-07-15");
  });

  it("semanas -> `:YYYY-MM-DD`", async () => {
    const movRepo = buildMovimientoRepo(1);
    const svc = new GeneracionGastosFijosService(
      buildPlantillaRepo([plantilla({ periodicidadUnidad: "semanas", periodicidadCantidad: 1, fechaCobro: "2026-07-01" })]),
      movRepo,
      buildCobroRepo(),
      runTx,
    );
    await svc.ejecutarGeneracion(NOW); // 2026-07-01 + 2 semanas = 2026-07-15 -> aplica
    expect(movsDe(movRepo)[0].origenId).toBe("p-alquiler:2026-07-15");
  });

  it("REGRESION: una plantilla mensual pre-migracion (backfill fecha_cobro=dia 1) conserva la clave `:YYYY-MM` — sin doble cobro tras el deploy", async () => {
    // Backfill: `fecha_cobro = date_trunc('month', created_at)::date` -> dia 1. En el dia 1 del
    // mes aplica y la clave es la MISMA que emitia el cron mensual pre-84 (`:YYYY-MM`), asi que el
    // egreso viejo y el nuevo colisionan en el indice unico y skipDuplicates evita el doble cobro.
    const dia1 = new Date("2026-08-01T18:00:00.000Z"); // 12:00 CR del 1 ago
    const legacy = plantilla({ id: "p-legacy", periodicidadUnidad: "meses", periodicidadCantidad: 1, fechaCobro: "2026-01-01" });
    const movRepo = buildMovimientoRepo(0); // ON CONFLICT DO NOTHING: la clave ya existia
    const svc = new GeneracionGastosFijosService(buildPlantillaRepo([legacy]), movRepo, buildCobroRepo(), runTx);

    const r = await svc.ejecutarGeneracion(dia1);

    expect(movsDe(movRepo)[0].origenId).toBe("p-legacy:2026-08"); // formato legacy intacto
    expect(r.egresosGenerados).toBe(0); // no reinserta -> no duplica plata
  });

  it("reejecucion del mismo dia inserta 0 (createMany devuelve 0)", async () => {
    const movRepo = buildMovimientoRepo(0); // ON CONFLICT DO NOTHING
    const svc = new GeneracionGastosFijosService(buildPlantillaRepo([plantilla()]), movRepo, buildCobroRepo(), runTx);
    const r = await svc.ejecutarGeneracion(NOW);
    expect(r).toMatchObject({ plantillasQueAplicanHoy: 1, egresosGenerados: 0 });
  });
});

// ---------------------------------------------------------------------------
// FICHA 333 (D6) — EL INTERRUPTOR: R5, R6, R7, R8, R11, R12.
// ---------------------------------------------------------------------------

/** «Requiere aprobacion»: la plantilla del camino NUEVO. */
function conAprobacion(overrides: Partial<GastoFijoPlantillaDTO> = {}): GastoFijoPlantillaDTO {
  return plantilla({ requiereAprobacion: true, ...overrides });
}

describe("333 — el interruptor reparte la corrida entre el libro y la cola (R5/R6)", () => {
  it("R5: una plantilla que COBRA SOLA escribe el mismo egreso que antes de la ficha, y no crea cobro", async () => {
    // El testigo de que el camino automatico no cambio: la fila del libro se compara ENTERA,
    // campo por campo, contra la que emitia el cron antes de la 333 — mismo tipo, misma
    // categoria, mismo `origen_tipo`, la misma clave y `registrado_por = null`.
    const movRepo = buildMovimientoRepo(1);
    const cobroRepo = buildCobroRepo();
    const svc = new GeneracionGastosFijosService(
      buildPlantillaRepo([plantilla({ requiereAprobacion: false })]),
      movRepo,
      cobroRepo,
      runTx,
    );

    const r = await svc.ejecutarGeneracion(NOW);

    expect(movsDe(movRepo)).toEqual([
      {
        tipo: "egreso",
        categoria: "egreso_gasto_fijo",
        monto: "80000.00",
        origenTipo: "gasto",
        origenId: "p-alquiler:2026-07",
        descripcion: "Alquiler — 2026-07",
        registradoPor: null,
      },
    ]);
    expect(cobrosDe(cobroRepo)).toEqual([]); // ni un cobro por este camino
    expect(r).toMatchObject({ egresosGenerados: 1, cobrosPendientesCreados: 0 });
  });

  it("R6: una plantilla que REQUIERE APROBACION crea el cobro y NO toca el libro", async () => {
    const movRepo = buildMovimientoRepo(0);
    const cobroRepo = buildCobroRepo(1, 1);
    const svc = new GeneracionGastosFijosService(
      buildPlantillaRepo([conAprobacion()]),
      movRepo,
      cobroRepo,
      runTx,
    );

    const r = await svc.ejecutarGeneracion(NOW);

    // La lista de movimientos va VACIA: el libro no se toca por esta plantilla. Se comprueba el
    // ARGUMENTO y no solo el conteo, porque `crearMovimientos([])` devuelve 0 igual que no
    // llamarlo, y lo que el requisito prohibe es que la fila exista.
    expect(movsDe(movRepo)).toEqual([]);
    expect(cobrosDe(cobroRepo)).toHaveLength(1);
    expect(r).toMatchObject({
      plantillasQueAplicanHoy: 1,
      egresosGenerados: 0,
      cobrosPendientesCreados: 1,
      cobrosPendientesTotales: 1,
    });
  });

  it("R5+R6: con las dos clases a la vez, cada una va a su sitio y `plantillasQueAplicanHoy` las cuenta a las dos", async () => {
    const movRepo = buildMovimientoRepo(1);
    const cobroRepo = buildCobroRepo(1, 1);
    const svc = new GeneracionGastosFijosService(
      buildPlantillaRepo([
        plantilla({ id: "p-sola", concepto: "Internet", requiereAprobacion: false }),
        conAprobacion({ id: "p-aprueba", concepto: "Alquiler" }),
      ]),
      movRepo,
      cobroRepo,
      runTx,
    );

    const r = await svc.ejecutarGeneracion(NOW);

    expect(movsDe(movRepo).map((m: { origenId: string }) => m.origenId)).toEqual([
      "p-sola:2026-07",
    ]);
    expect(cobrosDe(cobroRepo).map((c) => c.origenId)).toEqual(["p-aprueba:2026-07"]);
    expect(r.plantillasQueAplicanHoy).toBe(2); // las DOS aplican; se reparten, no se pierden
  });

  it("R10: las dos escrituras van dentro de UNA sola transaccion, y el conteo de pendientes queda FUERA", async () => {
    // Se mide el ORDEN real de las llamadas contra un runner que marca cuando entra y cuando
    // sale. Sin esto, «va en una transaccion» seria una afirmacion de la prosa.
    const traza: string[] = [];
    const movRepo = buildMovimientoRepo(1);
    const cobroRepo = buildCobroRepo(1, 3);
    (movRepo.crearMovimientos as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      traza.push("crearMovimientos");
      return 1;
    });
    (cobroRepo.crearPendientes as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      traza.push("crearPendientes");
      return 1;
    });
    (cobroRepo.contarPendientes as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      traza.push("contarPendientes");
      return 3;
    });
    const runnerVigilado: GeneracionGastosFijosTxRunner = async (fn) => {
      traza.push("tx:abre");
      const salida = await fn({} as GeneracionGastosFijosTx);
      traza.push("tx:cierra");
      return salida;
    };
    const svc = new GeneracionGastosFijosService(
      buildPlantillaRepo([
        plantilla({ id: "p-sola", requiereAprobacion: false }),
        conAprobacion({ id: "p-aprueba" }),
      ]),
      movRepo,
      cobroRepo,
      runnerVigilado,
    );

    await svc.ejecutarGeneracion(NOW);

    expect(traza).toEqual([
      "tx:abre",
      "crearMovimientos",
      "crearPendientes",
      "tx:cierra",
      "contarPendientes", // R30: el recordatorio cuenta DESPUES, fuera de la transaccion
    ]);
  });

  it("R10: si la escritura de cobros lanza, la transaccion propaga el fallo y la corrida NO devuelve resumen", async () => {
    const movRepo = buildMovimientoRepo(1);
    const cobroRepo = buildCobroRepo();
    (cobroRepo.crearPendientes as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("cobros caidos"),
    );
    const svc = new GeneracionGastosFijosService(
      buildPlantillaRepo([
        plantilla({ id: "p-sola", requiereAprobacion: false }),
        conAprobacion({ id: "p-aprueba" }),
      ]),
      movRepo,
      cobroRepo,
      runTx,
    );

    await expect(svc.ejecutarGeneracion(NOW)).rejects.toThrow("cobros caidos");
    // La reversion REAL de los egresos la hace Postgres; lo que se fija aqui es que el service
    // no traga el error ni devuelve un resumen que diria que la corrida fue bien.
    expect(cobroRepo.contarPendientes).not.toHaveBeenCalled();
  });
});

describe("333 — el cobro copia lo que la plantilla decia HOY (R7) y congela la clave (R8/R11)", () => {
  it("R7: el cobro guarda el concepto y el monto de la plantilla, y el monto viaja como STRING", async () => {
    const cobroRepo = buildCobroRepo(1, 1);
    const svc = new GeneracionGastosFijosService(
      buildPlantillaRepo([
        conAprobacion({ id: "p-luz", concepto: "Electricidad", monto: "12345.67" }),
      ]),
      buildMovimientoRepo(0),
      cobroRepo,
      runTx,
    );

    await svc.ejecutarGeneracion(NOW);

    expect(cobrosDe(cobroRepo)[0]).toEqual({
      plantillaId: "p-luz",
      origenId: "p-luz:2026-07",
      periodo: "2026-07",
      concepto: "Electricidad",
      monto: "12345.67",
      generadoEl: "2026-07-15", // dia CR de la corrida
    });
    expect(typeof cobrosDe(cobroRepo)[0].monto).toBe("string"); // money-safe: nunca number
  });

  it("R8: la clave del cobro es EXACTAMENTE la que el libro habria recibido por esa plantilla y ese periodo", async () => {
    // El testigo de que la clave se resuelve UNA vez y con el MISMO criterio en los dos caminos:
    // la misma plantilla, el mismo dia, con el interruptor en cada posicion, produce la MISMA
    // cadena en el libro y en el cobro. Si alguien cambiara la derivacion en uno solo de los dos
    // sitios, el cobro aprobado dejaria de colisionar con el egreso automatico y se cobraria dos
    // veces.
    const p = { id: "p-alquiler", fechaCobro: "2026-07-15" };

    const movRepo = buildMovimientoRepo(1);
    await new GeneracionGastosFijosService(
      buildPlantillaRepo([plantilla({ ...p, requiereAprobacion: false })]),
      movRepo,
      buildCobroRepo(),
      runTx,
    ).ejecutarGeneracion(NOW);

    const cobroRepo = buildCobroRepo(1, 1);
    await new GeneracionGastosFijosService(
      buildPlantillaRepo([conAprobacion(p)]),
      buildMovimientoRepo(0),
      cobroRepo,
      runTx,
    ).ejecutarGeneracion(NOW);

    expect(cobrosDe(cobroRepo)[0].origenId).toBe(movsDe(movRepo)[0].origenId);
    expect(cobrosDe(cobroRepo)[0].origenId).toBe("p-alquiler:2026-07");
  });

  it.each([
    ["meses", 1, "2026-07-15", "2026-07"],
    ["dias", 1, "2026-07-10", "2026-07-15"],
    ["semanas", 1, "2026-07-01", "2026-07-15"],
  ] as const)(
    "R11: el periodo del cobro sale de `periodoDe` y conserva su formato (%s -> %s)",
    async (unidad, cantidad, ancla, periodoEsperado) => {
      const cobroRepo = buildCobroRepo(1, 1);
      const svc = new GeneracionGastosFijosService(
        buildPlantillaRepo([
          conAprobacion({
            periodicidadUnidad: unidad,
            periodicidadCantidad: cantidad,
            fechaCobro: ancla,
          }),
        ]),
        buildMovimientoRepo(0),
        cobroRepo,
        runTx,
      );

      await svc.ejecutarGeneracion(NOW);

      const cobro = cobrosDe(cobroRepo)[0];
      expect(cobro.periodo).toBe(periodoEsperado);
      // Y la clave lo lleva dentro, sin un segundo formato ni una segunda forma de componerla.
      expect(cobro.origenId).toBe(`p-alquiler:${periodoEsperado}`);
    },
  );
});

describe("333 — R12: una plantilla INACTIVA no genera ni egreso ni cobro", () => {
  it("las inactivas no llegan ni al libro ni a la cola, sea cual sea su interruptor", async () => {
    // Las inactivas se excluyen en `listarActivas`, asi que el doble devuelve la lista vacia:
    // eso ES el mecanismo, y lo que este caso fija es que la particion NO reabre un camino por
    // el que una inactiva pudiera colarse — el service sigue sin consumir `listar()`.
    const movRepo = buildMovimientoRepo(0);
    const cobroRepo = buildCobroRepo(0, 0);
    const plantillaRepo = buildPlantillaRepo([]);
    (plantillaRepo.listar as ReturnType<typeof vi.fn>).mockResolvedValue([
      plantilla({ id: "p-inactiva-sola", activa: false, requiereAprobacion: false }),
      plantilla({ id: "p-inactiva-aprueba", activa: false, requiereAprobacion: true }),
    ]);
    const svc = new GeneracionGastosFijosService(plantillaRepo, movRepo, cobroRepo, runTx);

    const r = await svc.ejecutarGeneracion(NOW);

    expect(plantillaRepo.listar).not.toHaveBeenCalled();
    expect(movsDe(movRepo)).toEqual([]);
    expect(cobrosDe(cobroRepo)).toEqual([]);
    expect(r).toMatchObject({
      plantillasActivas: 0,
      plantillasQueAplicanHoy: 0,
      egresosGenerados: 0,
      cobrosPendientesCreados: 0,
    });
  });
});

describe("333 — el aviso de la campana sale del service, con el total y el dia (R29/R30/R32)", () => {
  function notificadorEspia(): GastoFijoCobroPendienteNotificador & { calls: unknown[] } {
    const calls: unknown[] = [];
    const fn = (async (ctx: unknown) => {
      calls.push(ctx);
    }) as GastoFijoCobroPendienteNotificador & { calls: unknown[] };
    fn.calls = calls;
    return fn;
  }

  it("R29/R30: con pendientes, avisa con el TOTAL (no con los creados hoy) y con el dia CR", async () => {
    const notificar = notificadorEspia();
    // Corrida que NO genera ningun cobro nuevo y en la que quedan 4 pendientes de dias
    // anteriores: es EXACTAMENTE el caso del recordatorio (R30).
    const svc = new GeneracionGastosFijosService(
      buildPlantillaRepo([]),
      buildMovimientoRepo(0),
      buildCobroRepo(0, 4),
      runTx,
      notificar,
    );

    const r = await svc.ejecutarGeneracion(NOW);

    expect(notificar.calls).toEqual([{ pendientes: 4, diaCR: "2026-07-15" }]);
    expect(r).toMatchObject({ cobrosPendientesCreados: 0, cobrosPendientesTotales: 4 });
  });

  it("R32: sin pendientes, NO se llama al notificador", async () => {
    const notificar = notificadorEspia();
    const svc = new GeneracionGastosFijosService(
      buildPlantillaRepo([plantilla({ requiereAprobacion: false })]),
      buildMovimientoRepo(1),
      buildCobroRepo(0, 0),
      runTx,
      notificar,
    );

    await svc.ejecutarGeneracion(NOW);

    expect(notificar.calls).toEqual([]);
  });

  it("R34: el DEFAULT del service es el no-op — un service sin cablear no puede emitir nada", async () => {
    // Construido con CUATRO argumentos, como lo hacen los dobles de las suites ajenas. Termina en
    // exito y no hay forma de observar una emision: el default no tiene repositorio detras.
    const svc = new GeneracionGastosFijosService(
      buildPlantillaRepo([]),
      buildMovimientoRepo(0),
      buildCobroRepo(0, 7),
      runTx,
    );

    await expect(svc.ejecutarGeneracion(NOW)).resolves.toMatchObject({
      cobrosPendientesTotales: 7,
    });
  });
});
