import { describe, it, expect, vi } from "vitest";
import { GastoFijoCobroService } from "@/lib/services/GastoFijoCobroService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  GastoFijoCobroRegistro,
  IGastoFijoCobroRepository,
} from "@/lib/interfaces/repositories/IGastoFijoCobroRepository";
import type {
  CrearMovimientoInput,
  IWalletMovimientoRepository,
} from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type {
  GastoFijoCobroTx,
  GastoFijoCobroTxRunner,
} from "@/lib/interfaces/services/IGastoFijoCobroService";
import type { WalletMovimientoDTO } from "@/lib/types/wallet";
import { gastoFijoConfig } from "@/lib/config/gasto-fijo";

// FICHA 333 (D5) — tests unit de `GastoFijoCobroService` con DOBLES (sin DB ni HTTP).
//
// Cubre: R14 (aprobar escribe el egreso con la clave del cobro y el autor que aprobo), R16 (cobra
// el monto COPIADO aunque la plantilla haya cambiado), R20 (`not_found`), R21 (rechazar no toca el
// libro), R23 (una decision es final), R24 (el `admin` NO decide, aunque tenga acceso total), R25
// (maestro y admin SI ven la cola), R45 (cancelar por plantilla dentro del `tx` recibido), R49 (un
// cancelado no aparece ni produce movimiento) y R56 (el numero REAL de cancelados).
//
// ⚠️ LO QUE ESTE ARCHIVO **NO** PUEDE PROBAR, Y ESTA DICHO AQUI PARA QUE NADIE LO CREA: los dobles
// NO VEN EL SQL. El `WHERE estado = 'pendiente'` de la transicion, la unicidad de la clave y la
// serializacion de dos aprobaciones simultaneas viven en el MOTOR y se prueban contra Postgres en
// `tests/integration/db/gasto-fijo-cobro-{aprobacion,idempotencia}.test.ts`. Aqui `ya_decidido` se
// modela devolviendo `0` desde el doble, que es lo que el repositorio devuelve cuando el `WHERE`
// no encuentra fila — no una demostracion de que ese `WHERE` exista.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro", zonaId: null };
const ADMIN: Actor = { usuarioId: "u-admin", rol: "admin", zonaId: null };
const OTRO: Actor = { usuarioId: "u-otro", rol: "adminSatelite", zonaId: null };
const AHORA = new Date("2026-08-29T18:00:00.000Z");
const ID = "11111111-1111-4111-8111-111111111111";

function registro(overrides: Partial<GastoFijoCobroRegistro> = {}): GastoFijoCobroRegistro {
  return {
    id: ID,
    plantillaId: "p-alquiler",
    origenId: "p-alquiler:2026-08",
    periodo: "2026-08",
    concepto: "Alquiler",
    monto: "80000.00",
    estado: "pendiente",
    generadoEl: "2026-08-29",
    decididoPor: null,
    decididoAt: null,
    movimientoId: null,
    ...overrides,
  };
}

function movimiento(overrides: Partial<WalletMovimientoDTO> = {}): WalletMovimientoDTO {
  return {
    id: "w-1",
    tipo: "egreso",
    categoria: "egreso_gasto_fijo",
    monto: "80000.00",
    origenTipo: "gasto",
    origenId: "p-alquiler:2026-08",
    descripcion: "Alquiler — 2026-08",
    registradoPor: MAESTRO.usuarioId,
    fechaMovimiento: "2026-08-29T18:00:00.000Z",
    dueno: "propio",
    ...overrides,
  };
}

function buildCobroRepo(
  overrides: Partial<IGastoFijoCobroRepository> = {},
): IGastoFijoCobroRepository {
  return {
    crearPendientes: vi.fn().mockResolvedValue(0),
    obtenerPorId: vi.fn().mockResolvedValue(registro()),
    listarPendientes: vi.fn().mockResolvedValue([]),
    contarPendientes: vi.fn().mockResolvedValue(0),
    contarPendientesDePlantilla: vi.fn().mockResolvedValue(0),
    marcarDecidido: vi.fn().mockResolvedValue(1), // 1 = la decision es tuya
    enlazarMovimiento: vi.fn().mockResolvedValue(undefined),
    cancelarPendientesDePlantilla: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
}

function buildMovRepo(
  overrides: Partial<IWalletMovimientoRepository> = {},
): IWalletMovimientoRepository {
  return {
    crearMovimientos: vi.fn().mockResolvedValue(1),
    listar: vi.fn(),
    agregarPorCategoriaYTipo: vi.fn(),
    obtenerPorId: vi.fn(),
    agregarPorCategoria: vi.fn(),
    obtenerPorOrigen: vi.fn().mockResolvedValue(movimiento()),
    crearMovimientoRegistrado: vi.fn().mockResolvedValue(1), // ficha 362

    ...overrides,
  };
}

/** Runner en memoria con la MISMA semantica que `prisma.$transaction`: propaga valor y error. */
const runTx: GastoFijoCobroTxRunner = async (fn) => fn({} as GastoFijoCobroTx);

/**
 * El mismo runner, pero contando cuantas veces se ABRIO la transaccion. Va escrito a mano y no
 * con `vi.fn(runTx)` porque el `Mock` de vitest pierde el generico `<T>` de la firma: el tipo
 * dejaria de comprobar que el runner devuelve lo que `fn` devuelve, que es justo lo que hace que
 * `aprobar` pueda propagar su resultado.
 */
function runnerContado(): GastoFijoCobroTxRunner & { veces: number } {
  const runner = (async (fn) => {
    runner.veces += 1;
    return fn({} as GastoFijoCobroTx);
  }) as GastoFijoCobroTxRunner & { veces: number };
  runner.veces = 0;
  return runner;
}

function servicio(
  cobroRepo: IGastoFijoCobroRepository = buildCobroRepo(),
  movRepo: IWalletMovimientoRepository = buildMovRepo(),
  runner: GastoFijoCobroTxRunner = runTx,
): GastoFijoCobroService {
  return new GastoFijoCobroService(cobroRepo, movRepo, {} as GastoFijoCobroTx, runner);
}

/** La UNICA fila que el servicio pidio escribir en el libro. */
function filaDelLibro(movRepo: IWalletMovimientoRepository): CrearMovimientoInput {
  const filas = (movRepo.crearMovimientos as ReturnType<typeof vi.fn>).mock
    .calls[0][1] as CrearMovimientoInput[];
  expect(filas).toHaveLength(1); // un cobro aprobado = UN movimiento, nunca dos
  return filas[0];
}

// ---------------------------------------------------------------------------
// R14 / R16 — aprobar mueve dinero: la clave, el monto copiado y el autor.
// ---------------------------------------------------------------------------

describe("333/R14 — aprobar escribe el egreso con la clave del cobro y el autor que aprobo", () => {
  it("⭑ la fila del libro es exactamente la que el requisito describe", async () => {
    const movRepo = buildMovRepo();
    const svc = servicio(buildCobroRepo(), movRepo);

    const r = await svc.aprobar({ id: ID }, MAESTRO, AHORA);

    expect(r).toEqual({ status: "ok", yaEstabaEnElLibro: false });
    // LITERAL y completo: si alguien cambiara la categoria, el `origen_tipo` o el autor, esto cae.
    expect(filaDelLibro(movRepo)).toEqual({
      tipo: "egreso",
      categoria: "egreso_gasto_fijo",
      monto: "80000.00", // la COPIA del cobro
      origenTipo: "gasto",
      origenId: "p-alquiler:2026-08", // LA CLAVE guardada en el cobro
      descripcion: "Alquiler — 2026-08",
      registradoPor: "u-maestro", // R14: quien autorizo, NO `null`
    });
  });

  it("⭑ la clave que se escribe sale del COBRO, no se recompone a partir de la plantilla", async () => {
    // Mutacion que este caso mata: derivar `origen_id` de `plantillaId` + `periodo` en vez de leer
    // `origenId`. Se le da un cobro cuya clave NO coincide con esa derivacion —el caso real de una
    // plantilla borrada, con `plantilla_id = NULL`— y solo pasa quien lea la clave guardada.
    const movRepo = buildMovRepo();
    const cobroRepo = buildCobroRepo({
      obtenerPorId: vi
        .fn()
        .mockResolvedValue(registro({ plantillaId: null, origenId: "p-vieja:2026-08" })),
    });

    await servicio(cobroRepo, movRepo).aprobar({ id: ID }, MAESTRO, AHORA);

    expect(filaDelLibro(movRepo).origenId).toBe("p-vieja:2026-08");
  });

  it("⭑ el autor NO es `null`: un egreso aprobado se distingue del que escribe el cron solo", async () => {
    const movRepo = buildMovRepo();
    await servicio(buildCobroRepo(), movRepo).aprobar({ id: ID }, MAESTRO, AHORA);
    expect(filaDelLibro(movRepo).registradoPor).toBe(MAESTRO.usuarioId);
    expect(filaDelLibro(movRepo).registradoPor).not.toBeNull();
  });

  it("la decision se registra con QUIEN y CUANDO, con el reloj INYECTADO", async () => {
    const cobroRepo = buildCobroRepo();
    await servicio(cobroRepo).aprobar({ id: ID }, MAESTRO, AHORA);
    expect(cobroRepo.marcarDecidido).toHaveBeenCalledWith(
      expect.anything(),
      ID,
      "aprobado",
      "u-maestro",
      AHORA,
    );
  });
});

describe("333/R16 — aprobar cobra el monto COPIADO aunque la plantilla haya cambiado", () => {
  it("⭑ el monto escrito es el del cobro, no uno leido en el momento de aprobar", async () => {
    // Mutacion que este caso mata: cobrar el monto vigente de la plantilla. El doble del cobro
    // dice 80.000; NADIE le pregunta a la plantilla, y el servicio no tiene por donde hacerlo —no
    // recibe su repositorio—. Lo que se fija es que el importe sale de la copia y llega INTACTO.
    const movRepo = buildMovRepo();
    const cobroRepo = buildCobroRepo({
      obtenerPorId: vi.fn().mockResolvedValue(registro({ monto: "80000.00" })),
    });

    await servicio(cobroRepo, movRepo).aprobar({ id: ID }, MAESTRO, AHORA);

    expect(filaDelLibro(movRepo).monto).toBe("80000.00");
  });

  it("⭑ money-safe: el monto cruza como STRING y conserva sus decimales exactos", async () => {
    const movRepo = buildMovRepo();
    const cobroRepo = buildCobroRepo({
      obtenerPorId: vi.fn().mockResolvedValue(registro({ monto: "12345.67" })),
    });

    await servicio(cobroRepo, movRepo).aprobar({ id: ID }, MAESTRO, AHORA);

    const fila = filaDelLibro(movRepo);
    expect(fila.monto).toBe("12345.67");
    expect(typeof fila.monto).toBe("string"); // nunca `number`
  });
});

// ---------------------------------------------------------------------------
// R17 / R19 / R20 — los finales que no son «se acaba de cobrar».
// ---------------------------------------------------------------------------

describe("333/R20 — aprobar un cobro inexistente responde not_found sin escribir nada", () => {
  it("ni movimiento, ni transicion, ni enlace", async () => {
    const movRepo = buildMovRepo();
    const cobroRepo = buildCobroRepo({ obtenerPorId: vi.fn().mockResolvedValue(null) });

    const r = await servicio(cobroRepo, movRepo).aprobar({ id: ID }, MAESTRO, AHORA);

    expect(r).toEqual({ status: "not_found" });
    expect(cobroRepo.marcarDecidido).not.toHaveBeenCalled();
    expect(movRepo.crearMovimientos).not.toHaveBeenCalled();
    expect(cobroRepo.enlazarMovimiento).not.toHaveBeenCalled();
  });
});

describe("333/R17 — un cobro ya decidido no vuelve a escribir en el libro", () => {
  it("`marcarDecidido` devuelve 0 -> `ya_decidido`, y el libro no se toca", async () => {
    const movRepo = buildMovRepo();
    const cobroRepo = buildCobroRepo({ marcarDecidido: vi.fn().mockResolvedValue(0) });

    const r = await servicio(cobroRepo, movRepo).aprobar({ id: ID }, MAESTRO, AHORA);

    expect(r).toEqual({ status: "ya_decidido" });
    expect(movRepo.crearMovimientos).not.toHaveBeenCalled();
  });
});

describe("333/R19 — si el libro YA tiene la clave, se enlaza ese movimiento y se dice la verdad", () => {
  it("⭑ `crearMovimientos` devuelve 0 -> se enlaza el existente y `yaEstabaEnElLibro` es true", async () => {
    const existente = movimiento({ id: "w-existente", registradoPor: null });
    const movRepo = buildMovRepo({
      crearMovimientos: vi.fn().mockResolvedValue(0), // ON CONFLICT DO NOTHING
      obtenerPorOrigen: vi.fn().mockResolvedValue(existente),
    });
    const cobroRepo = buildCobroRepo();

    const r = await servicio(cobroRepo, movRepo).aprobar({ id: ID }, MAESTRO, AHORA);

    expect(r).toEqual({ status: "ok", yaEstabaEnElLibro: true });
    expect(cobroRepo.enlazarMovimiento).toHaveBeenCalledWith(
      expect.anything(),
      ID,
      "w-existente",
    );
  });

  it("la relectura va por LA CLAVE del cobro y la categoria del gasto fijo, dentro del `tx`", async () => {
    const movRepo = buildMovRepo();
    await servicio(buildCobroRepo(), movRepo).aprobar({ id: ID }, MAESTRO, AHORA);
    expect(movRepo.obtenerPorOrigen).toHaveBeenCalledWith(
      expect.anything(),
      "gasto",
      "p-alquiler:2026-08",
      "egreso_gasto_fijo",
    );
  });

  it("si la relectura no encuentra nada (imposible), se PROPAGA con contexto y no se devuelve ok", async () => {
    // Un cobro `aprobado` sin movimiento detras es peor que un error: es dinero autorizado que no
    // esta en el libro. La transaccion tiene que revertir, asi que el servicio lanza.
    const movRepo = buildMovRepo({ obtenerPorOrigen: vi.fn().mockResolvedValue(null) });

    await expect(servicio(buildCobroRepo(), movRepo).aprobar({ id: ID }, MAESTRO, AHORA)).rejects.toThrow(
      /p-alquiler:2026-08/,
    );
  });
});

// ---------------------------------------------------------------------------
// R21 / R23 — rechazar.
// ---------------------------------------------------------------------------

describe("333/R21 — rechazar no escribe movimiento y deja decisor e instante", () => {
  it("⭑ el libro no se toca en absoluto", async () => {
    const movRepo = buildMovRepo();
    const cobroRepo = buildCobroRepo();

    const r = await servicio(cobroRepo, movRepo).rechazar({ id: ID }, MAESTRO, AHORA);

    expect(r).toEqual({ status: "ok" });
    expect(movRepo.crearMovimientos).not.toHaveBeenCalled();
    expect(movRepo.obtenerPorOrigen).not.toHaveBeenCalled();
    expect(cobroRepo.enlazarMovimiento).not.toHaveBeenCalled();
  });

  it("la transicion registra `rechazado` con quien y cuando", async () => {
    const cobroRepo = buildCobroRepo();
    await servicio(cobroRepo).rechazar({ id: ID }, MAESTRO, AHORA);
    expect(cobroRepo.marcarDecidido).toHaveBeenCalledWith(
      expect.anything(),
      ID,
      "rechazado",
      "u-maestro",
      AHORA,
    );
  });

  it("R20: rechazar un cobro inexistente responde not_found sin transicion", async () => {
    const cobroRepo = buildCobroRepo({ obtenerPorId: vi.fn().mockResolvedValue(null) });
    const r = await servicio(cobroRepo).rechazar({ id: ID }, MAESTRO, AHORA);
    expect(r).toEqual({ status: "not_found" });
    expect(cobroRepo.marcarDecidido).not.toHaveBeenCalled();
  });

  it("no abre transaccion: es una sola sentencia condicional, que ya es atomica", async () => {
    const runner = runnerContado();
    await servicio(buildCobroRepo(), buildMovRepo(), runner).rechazar({ id: ID }, MAESTRO, AHORA);
    expect(runner.veces).toBe(0);
  });
});

describe("333/R23 — un cobro decidido no admite una segunda decision", () => {
  it.each([
    ["aprobar", "aprobado"],
    ["rechazar", "rechazado"],
  ] as const)("%s sobre un cobro ya decidido responde `ya_decidido`", async (metodo, estado) => {
    // El doble devuelve 0 porque el `WHERE estado = 'pendiente'` no encuentra fila: esa es la
    // unica puerta por la que se decide, y no hay una segunda que reabra lo ya cerrado.
    const cobroRepo = buildCobroRepo({
      obtenerPorId: vi
        .fn()
        .mockResolvedValue(registro({ estado, decididoPor: "u-admin", decididoAt: "2026-08-28T00:00:00.000Z" })),
      marcarDecidido: vi.fn().mockResolvedValue(0),
    });
    const movRepo = buildMovRepo();
    const svc = servicio(cobroRepo, movRepo);

    const r =
      metodo === "aprobar"
        ? await svc.aprobar({ id: ID }, MAESTRO, AHORA)
        : await svc.rechazar({ id: ID }, MAESTRO, AHORA);

    expect(r).toEqual({ status: "ya_decidido" });
    expect(movRepo.crearMovimientos).not.toHaveBeenCalled();
  });

  it("el servicio NO expone ninguna forma de reabrir o editar un cobro", async () => {
    // La superficie ES el contrato: cuatro metodos, ninguno de ellos «reabrir» ni «editar».
    const metodos = Object.getOwnPropertyNames(GastoFijoCobroService.prototype)
      .filter((m) => m !== "constructor")
      .sort();
    expect(metodos).toEqual([
      "aprobar",
      "cancelarPorPlantilla",
      "contarPendientesDePlantilla",
      "listarPendientes",
      "rechazar",
    ]);
  });
});

// ---------------------------------------------------------------------------
// R24 / R25 — quien decide y quien mira. La excepcion a la paridad de la 94.
// ---------------------------------------------------------------------------

describe("333/R24 — el admin NO puede aprobar ni rechazar, aunque tenga acceso total", () => {
  it.each([
    ["aprobar", ADMIN],
    ["rechazar", ADMIN],
    ["aprobar", OTRO],
    ["rechazar", OTRO],
  ] as const)("⭑ %s con rol `%s` -> forbidden, sin tocar el repositorio", async (metodo, actor) => {
    const cobroRepo = buildCobroRepo();
    const movRepo = buildMovRepo();
    const runner = runnerContado();
    const svc = servicio(cobroRepo, movRepo, runner);

    const r =
      metodo === "aprobar"
        ? await svc.aprobar({ id: ID }, actor, AHORA)
        : await svc.rechazar({ id: ID }, actor, AHORA);

    expect(r).toEqual({ status: "forbidden" });
    // El guard va ANTES de todo: ni lectura, ni transaccion, ni transicion, ni libro.
    expect(cobroRepo.obtenerPorId).not.toHaveBeenCalled();
    expect(cobroRepo.marcarDecidido).not.toHaveBeenCalled();
    expect(movRepo.crearMovimientos).not.toHaveBeenCalled();
    expect(runner.veces).toBe(0);
  });

  it("⭑ y el MAESTRO si: sin este control positivo, lo de arriba pasaria con un `forbidden` a todos", async () => {
    const r = await servicio().aprobar({ id: ID }, MAESTRO, AHORA);
    expect(r).toEqual({ status: "ok", yaEstabaEnElLibro: false });
  });
});

describe("333/R25 — maestro y admin VEN la lista de pendientes", () => {
  it.each([[MAESTRO], [ADMIN]])("con acceso total la cola se devuelve", async (actor) => {
    const cobroRepo = buildCobroRepo({
      listarPendientes: vi.fn().mockResolvedValue([
        {
          id: "c-1",
          concepto: "Alquiler",
          monto: "80000.00",
          periodo: "2026-08",
          generadoEl: "2026-08-29",
          estado: "pendiente" as const,
        },
      ]),
      contarPendientes: vi.fn().mockResolvedValue(7),
    });

    const r = await servicio(cobroRepo).listarPendientes(actor);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("esperado ok");
    expect(r.items).toHaveLength(1);
    // R41: el `total` sale del SERVIDOR y NO es `items.length`.
    expect(r.total).toBe(7);
    expect(r.total).not.toBe(r.items.length);
  });

  it("un rol sin acceso total -> forbidden, sin leer la cola", async () => {
    const cobroRepo = buildCobroRepo();
    const r = await servicio(cobroRepo).listarPendientes(OTRO);
    expect(r).toEqual({ status: "forbidden" });
    expect(cobroRepo.listarPendientes).not.toHaveBeenCalled();
  });

  it("el recorte lo pone la CONFIGURACION del dominio, no un literal escrito en el servicio", async () => {
    const cobroRepo = buildCobroRepo();
    await servicio(cobroRepo).listarPendientes(MAESTRO);
    expect(cobroRepo.listarPendientes).toHaveBeenCalledWith(gastoFijoConfig.MAX_PAGE_SIZE);
  });
});

// ---------------------------------------------------------------------------
// R45 / R49 / R56 — la cascada del borrado y el cobro cancelado.
// ---------------------------------------------------------------------------

describe("333/R45 — borrar una plantilla cancela sus pendientes en la MISMA transaccion", () => {
  it("⭑ `cancelarPorPlantilla` usa el `tx` QUE RECIBE, no abre uno propio", async () => {
    // Es lo que hace que la cancelacion y el `DELETE` sean atomicos: si el servicio abriera su
    // propia transaccion, media cascada podria quedar commiteada con la plantilla intacta.
    const cobroRepo = buildCobroRepo({
      cancelarPendientesDePlantilla: vi.fn().mockResolvedValue(2),
    });
    const runner = runnerContado();
    const tx = {} as GastoFijoCobroTx;

    const n = await servicio(cobroRepo, buildMovRepo(), runner).cancelarPorPlantilla(
      tx,
      "p-alquiler",
      MAESTRO,
      AHORA,
    );

    expect(n).toBe(2);
    expect(runner.veces).toBe(0); // NO abre transaccion propia
    expect(cobroRepo.cancelarPendientesDePlantilla).toHaveBeenCalledWith(
      tx, // EL MISMO objeto que recibio
      "p-alquiler",
      "u-maestro",
      AHORA,
    );
  });

  it("R56: devuelve el numero REAL de cancelados, sea el que sea", async () => {
    const cobroRepo = buildCobroRepo({
      cancelarPendientesDePlantilla: vi.fn().mockResolvedValue(5),
    });
    await expect(
      servicio(cobroRepo).cancelarPorPlantilla({} as GastoFijoCobroTx, "p-1", MAESTRO, AHORA),
    ).resolves.toBe(5);
  });

  it("cancelar NO escribe en el libro: un cobro cancelado no produce movimiento (R49)", async () => {
    const movRepo = buildMovRepo();
    await servicio(buildCobroRepo(), movRepo).cancelarPorPlantilla(
      {} as GastoFijoCobroTx,
      "p-1",
      MAESTRO,
      AHORA,
    );
    expect(movRepo.crearMovimientos).not.toHaveBeenCalled();
  });
});

describe("333/R49 — un cobro cancelado no aparece en pendientes ni produce movimiento", () => {
  it("la cola solo pide `pendiente`: un cancelado no puede llegar a la pantalla", async () => {
    // El filtro vive en el `WHERE` del repositorio (probado contra Postgres); lo que se fija aqui
    // es que el SERVICIO no ensancha ese conjunto ni le anade estados por su cuenta.
    const cobroRepo = buildCobroRepo({
      listarPendientes: vi.fn().mockResolvedValue([]),
      contarPendientes: vi.fn().mockResolvedValue(0),
    });

    const r = await servicio(cobroRepo).listarPendientes(MAESTRO);

    expect(r).toEqual({ status: "ok", items: [], total: 0 });
    expect(cobroRepo.listarPendientes).toHaveBeenCalledTimes(1);
    // Un solo argumento: el tope. Ni un filtro de estado que se pudiera cambiar desde arriba.
    expect(
      (cobroRepo.listarPendientes as ReturnType<typeof vi.fn>).mock.calls[0],
    ).toHaveLength(1);
  });

  it("aprobar un cobro `cancelado` no escribe nada: la transicion lo rechaza", async () => {
    const movRepo = buildMovRepo();
    const cobroRepo = buildCobroRepo({
      obtenerPorId: vi
        .fn()
        .mockResolvedValue(registro({ estado: "cancelado", plantillaId: null, decididoAt: "2026-08-29T00:00:00.000Z" })),
      marcarDecidido: vi.fn().mockResolvedValue(0), // `WHERE estado = 'pendiente'` -> 0 filas
    });

    const r = await servicio(cobroRepo, movRepo).aprobar({ id: ID }, MAESTRO, AHORA);

    expect(r).toEqual({ status: "ya_decidido" });
    expect(movRepo.crearMovimientos).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// R55 — el numero que la confirmacion del borrado anuncia.
// ---------------------------------------------------------------------------

describe("333/R55 — contar los pendientes de UNA plantilla", () => {
  it("acceso total -> el conteo del repositorio, tal cual", async () => {
    const cobroRepo = buildCobroRepo({
      contarPendientesDePlantilla: vi.fn().mockResolvedValue(2),
    });

    await expect(
      servicio(cobroRepo).contarPendientesDePlantilla({ plantillaId: "p-1" }, ADMIN),
    ).resolves.toEqual({ status: "ok", pendientes: 2 });
    expect(cobroRepo.contarPendientesDePlantilla).toHaveBeenCalledWith("p-1");
  });

  it("R28: autoriza `esAccesoTotal` y NO el predicado estrecho — el `admin` puede contar", async () => {
    // Contrapunto explicito de R24: el admin no decide, pero SI acompaña un borrado de plantilla,
    // cuya autorizacion esta ficha no estrecha. Si alguien «unificara» los guards, esto cae.
    const r = await servicio().contarPendientesDePlantilla({ plantillaId: "p-1" }, ADMIN);
    expect(r.status).toBe("ok");
  });

  it("un rol sin acceso total -> forbidden, sin contar", async () => {
    const cobroRepo = buildCobroRepo();
    const r = await servicio(cobroRepo).contarPendientesDePlantilla({ plantillaId: "p-1" }, OTRO);
    expect(r).toEqual({ status: "forbidden" });
    expect(cobroRepo.contarPendientesDePlantilla).not.toHaveBeenCalled();
  });
});
