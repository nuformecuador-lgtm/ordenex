import { describe, it, expect, vi } from "vitest";
import { CierreEstado, Prisma, RolValue, type PrismaClient } from "@prisma/client";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { CajaPagoTiendaFeedService } from "@/lib/services/CajaPagoTiendaFeedService";
import { LiquidacionService } from "@/lib/services/LiquidacionService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  CierreImputableDTO,
  CierresNoAprobadosPorEstadoDTO,
  CrearLiquidacionPagoInput,
  ILiquidacionPagoRepository,
  LiquidacionPagoDTO,
} from "@/lib/interfaces/repositories/ILiquidacionPagoRepository";
import type {
  CrearLiquidacionRepartoInput,
  ILiquidacionRepartoRepository,
  LiquidacionRepartoDTO,
} from "@/lib/interfaces/repositories/ILiquidacionRepartoRepository";
import type {
  CrearPagoMensajeroInput,
  IPagoMensajeroMovimientoRepository,
} from "@/lib/interfaces/repositories/IPagoMensajeroMovimientoRepository";
import type { IWalletTiendaMovimientoRepository } from "@/lib/interfaces/repositories/IWalletTiendaMovimientoRepository";
import type {
  LiquidacionTx,
  LiquidacionTxRunner,
} from "@/lib/interfaces/services/ILiquidacionService";
import type { RegistrarRepartoMensajeroInput } from "@/lib/types/liquidacion-reparto";

// Feature 205 / T3.3 — `LiquidacionService.previsualizarRepartoMensajero` y
// `registrarRepartoMensajero`. Cubre R1, R4, R5, R6, R7, R14, R15, R18, R19, R20, R23, R24, R25,
// R26, R28, R30, R32-R38, R51, R54, R56, R57 y R58.
//
// Money-safe: ni un `Number(` ni un `parseFloat` sobre un monto en todo el archivo. Los importes
// se comparan como STRING (que es como cruzan la frontera) y las sumas de control se hacen con
// `Prisma.Decimal`.
//
// **Lo que este archivo NO puede probar, y por eso no lo intenta:** el `WHERE` de
// `listarCierresImputables` / `contarCierresNoAprobadosPorEstado` — ni que el conteo de R36 lo
// haga la BASE con un `groupBy` en vez del proceso (aqui son dobles y no hay SQL que mirar).
// Eso vive en `tests/unit/repositories/liquidacion-pago-repository.test.ts`, que lo prueba donde
// se ejecuta. Lo de aqui es el ORDEN, la ATOMICIDAD y la ARITMETICA del acto.

const MENSAJERO = "m1";
const ACTOR_ADMIN: Actor = { usuarioId: "u-admin", rol: RolValue.admin };
const ACTOR_MAESTRO: Actor = { usuarioId: "u-maestro", rol: RolValue.maestro };

const CLAVE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

/**
 * El RELOJ del servicio y la FECHA DE PAGO de la peticion son dos dias DISTINTOS a proposito, y
 * eso es una aserción disfrazada de fixture: la transferencia se hizo el 30 de julio y se
 * registra el 2 de agosto, que es lo que de verdad pasa cuando alguien captura el comprobante
 * dias despues.
 *
 * Por que importa que no coincidan: la fecha del pago sale de la PETICION (`input.fechaPago`), no
 * del reloj del servidor. Con las dos fechas iguales, una implementacion que fechara los pagos con
 * `medianocheUtcDelDia(fechaCalendarioCR(this.ahora()))` produciria EXACTAMENTE el mismo valor y
 * ningun caso de este archivo lo notaria — el test seguiria verde con la implementacion correcta y
 * con la rota, que es no medir nada. Es la misma familia que la cicatriz `a3` de la tanda 0 (dos
 * reglas distintas dando la misma respuesta por como estaba elegido el dato).
 *
 * Si algun dia se tocan estas dos constantes: tienen que seguir siendo dias distintos.
 */
const RELOJ = "2026-08-02T15:04:05.000Z";
const FECHA_PAGO = "2026-07-30";
/** Medianoche UTC del dia de pago: lo que se escribe en el documento y en el libro. */
const FECHA_PAGO_UTC = "2026-07-30T00:00:00.000Z";
/** El dia del RELOJ, en el formato de la peticion. Nunca puede ser lo que se escribe. */
const DIA_DEL_RELOJ = "2026-08-02";

const INPUT: RegistrarRepartoMensajeroInput = {
  claveIdempotencia: CLAVE,
  mensajeroId: MENSAJERO,
  monto: "15000.00",
  metodo: "SINPE",
  referencia: "1234567",
  nota: "Pago de la semana",
  fechaPago: FECHA_PAGO,
};

/**
 * Un cierre APROBADO cuyo pendiente BRUTO es `pendiente`: con `E = 0`,
 * `derivarPendienteCierre(P, 0, pagado) = P − pagado`, asi que el pendiente del cierre es `P`
 * mientras no haya pagos vigentes contra el. Los tests que quieren mover el pendiente lo hacen
 * por donde de verdad se mueve: la Σ de pagos VIGENTES (R6/R7).
 */
function cierre(
  id: string,
  pendiente: string,
  solicitadoAt: string,
  over: Partial<CierreImputableDTO> = {},
): CierreImputableDTO {
  return {
    id,
    mensajeroId: MENSAJERO,
    estado: CierreEstado.aprobado,
    totalPagoMensajero: pendiente,
    totalEfectivo: "0.00",
    solicitadoAt,
    ...over,
  };
}

/** Tres cierres, del mas antiguo al mas reciente, con 5 000 / 8 000 / 12 000 pendientes. */
function tresCierres(): CierreImputableDTO[] {
  return [
    cierre("c-viejo", "5000.00", "2026-07-01T10:00:00.000Z"),
    cierre("c-medio", "8000.00", "2026-07-05T10:00:00.000Z"),
    cierre("c-nuevo", "12000.00", "2026-07-09T10:00:00.000Z"),
  ];
}

function repartoDTO(over: Partial<LiquidacionRepartoDTO> = {}): LiquidacionRepartoDTO {
  return {
    id: "rep-1",
    claveIdempotencia: CLAVE,
    mensajeroId: MENSAJERO,
    montoTotal: "15000.00",
    registradoPor: "u-admin",
    // El instante en que la fila NACE, que es el del reloj: distinto de la fecha del pago.
    registradoAt: RELOJ,
    ...over,
  };
}

interface Opciones {
  /** Lo que devuelve `listarCierresImputables`. Una entrada por LLAMADA; la ultima se repite. */
  cierres?: CierreImputableDTO[][];
  /** Σ de pagos vigentes por cierre. Una entrada por LLAMADA; la ultima se repite. */
  pagados?: Record<string, string>[];
  /** El CONTEO por estado de R36 (no la lista de cierres: ver el DTO). */
  noAprobados?: CierresNoAprobadosPorEstadoDTO[];
  cuenta?: { devengado: string; pagado: string };
  nombre?: string | null;
  tope?: number;
  /** Claves de reparto ya usadas: el `UNIQUE` de la tabla, modelado como dato. */
  clavesUsadas?: string[];
  repartoExistente?: LiquidacionRepartoDTO | null;
  pagosDelReparto?: LiquidacionPagoDTO[];
  /** Hace explotar la N-esima escritura de documento (1 = la primera). R20. */
  reventarEnPago?: number;
  /** Hace que la N-esima escritura choque con el `UNIQUE` de la clave del pago. R20. */
  chocarEnPago?: number;
}

/**
 * Los cuatro repositorios, dobles, compartiendo un LOG ORDENADO. El orden del log es lo que
 * prueba R21/R22/R23 (los candados, en el orden del reparto y ANTES de la relectura que decide) y
 * el conteo lo que prueba R20 y R35.
 *
 * La transaccion modela el ROLLBACK de verdad: lo escrito se apunta en `pendientesDeCommit` y solo
 * pasa a `confirmados` si la funcion termina sin lanzar. Sin eso, «todo o nada» seria una promesa
 * en un comentario en vez de una aserción.
 */
function buildDobles(opciones: Opciones = {}) {
  const log: string[] = [];
  const espia = () => ({
    create: vi.fn(),
    createMany: vi.fn().mockResolvedValue({ count: 1 }),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
    upsert: vi.fn(),
  });
  const tx = {
    liquidacionPago: espia(),
    liquidacionReparto: espia(),
    walletTiendaMovimiento: espia(),
    pagoMensajeroMovimiento: espia(),
    walletMovimiento: espia(),
    cierreDia: espia(), // R26: los datos del cierre son de SOLO LECTURA
    $queryRaw: vi.fn().mockResolvedValue([]),
  };

  const confirmados = { pagos: [] as CrearLiquidacionPagoInput[], movimientos: [] as CrearPagoMensajeroInput[], repartos: [] as CrearLiquidacionRepartoInput[] };
  const intentados = { pagos: [] as CrearLiquidacionPagoInput[], movimientos: [] as CrearPagoMensajeroInput[] };
  let pendientesDeCommit: Array<() => void> = [];

  const listasDeCierres = opciones.cierres ?? [tresCierres()];
  const listasDePagados = opciones.pagados ?? [{}];
  const clavesUsadas = new Set(opciones.clavesUsadas ?? []);
  let llamadasCierres = 0;
  let llamadasPagados = 0;
  let seqPago = 0;

  const enesima = <T,>(listas: T[], indice: number): T =>
    listas[Math.min(indice, listas.length - 1)];

  const pagoRepo: ILiquidacionPagoRepository = {
    bloquearBeneficiario: vi.fn(async (_tx, objetivo) => {
      log.push(
        objetivo.tipo === "cierre"
          ? `bloquear:cierre:${objetivo.cierreId}`
          : `bloquear:tienda:${objetivo.tiendaId}`,
      );
    }),
    crear: vi.fn(async (_tx, input: CrearLiquidacionPagoInput) => {
      seqPago += 1;
      log.push(`crear:documento:${input.cierreId}`);
      intentados.pagos.push(input);
      if (opciones.reventarEnPago === seqPago) throw new Error("boom: la base dijo que no");
      if (opciones.chocarEnPago === seqPago) return { status: "clave_repetida" as const };
      const pago: LiquidacionPagoDTO = {
        id: `pago-${seqPago}`,
        mensajeroId: input.mensajeroId,
        tiendaId: null,
        cierreId: input.cierreId,
        monto: input.monto,
        metodo: input.metodo,
        referencia: input.referencia,
        nota: input.nota,
        fechaPago: input.fechaPago.toISOString().slice(0, 10),
        registradoPorNombre: "Ana Admin",
        registradoAt: RELOJ,
        anulacion: null,
      };
      pendientesDeCommit.push(() => confirmados.pagos.push(input));
      return { status: "creado" as const, pago };
    }),
    listarCierresImputables: vi.fn(async (_mensajeroId, t) => {
      const lista = enesima(listasDeCierres, llamadasCierres);
      llamadasCierres += 1;
      log.push(t === undefined ? "leer:imputables:fuera-de-tx" : "leer:imputables");
      return lista;
    }),
    sumarVigentesPorCierre: vi.fn(async (ids: string[]) => {
      const mapa = enesima(listasDePagados, llamadasPagados);
      llamadasPagados += 1;
      log.push("leer:pagado-vigente");
      return Object.fromEntries(ids.map((id) => [id, mapa[id] ?? "0.00"]));
    }),
    contarCierresNoAprobadosPorEstado: vi.fn(async () => {
      log.push("contar:no-aprobados");
      return opciones.noAprobados ?? [];
    }),
    listarPorReparto: vi.fn(async () => {
      log.push("listar:por-reparto");
      return opciones.pagosDelReparto ?? [];
    }),
    obtenerCierreParaPago: vi.fn(async (id: string, t) => {
      log.push(t === undefined ? "leer:cierre:fuera-de-tx" : "leer:cierre");
      const encontrado = enesima(listasDeCierres, 0).find((c) => c.id === id);
      return encontrado ?? null;
    }),
    anular: vi.fn(async () => {
      log.push("anular");
      return { status: "ya_anulado" as const };
    }),
    obtenerPorClave: vi.fn(async () => {
      log.push("obtener:pago-por-clave");
      return null;
    }),
    obtenerPorId: vi.fn(async () => null),
    sumarVigentesPorTienda: vi.fn(async () => "0.00"),
    listarPorCierre: vi.fn(async () => []),
    listarPorTienda: vi.fn(async () => []),
  };

  const tiendaRepo = {
    crearMovimientos: vi.fn(async () => {
      log.push("crear:movimiento:tienda");
      return 1;
    }),
    agregarSaldoPorTienda: vi.fn(async () => ({ creditos: "0.00", debitos: "0.00" })),
  } as unknown as IWalletTiendaMovimientoRepository;

  const mensajeroRepo = {
    crearMovimientos: vi.fn(async (_tx, movs: CrearPagoMensajeroInput[]) => {
      for (const mov of movs) log.push(`crear:movimiento:${mov.origenId}`);
      intentados.movimientos.push(...movs);
      pendientesDeCommit.push(() => confirmados.movimientos.push(...movs));
      return movs.length;
    }),
    agregarCuentaPorPagar: vi.fn(async () => {
      log.push("leer:cuenta-por-pagar");
      return opciones.cuenta ?? { devengado: "25000.00", pagado: "0.00" };
    }),
    obtenerNombreMensajero: vi.fn(async () => {
      log.push("leer:nombre-mensajero");
      return opciones.nombre === undefined ? "Marco Mensajero" : opciones.nombre;
    }),
    listarPorMensajero: vi.fn(),
    listarCuentasPorPagarTodos: vi.fn(),
    listarCuentasPorPagarPaginado: vi.fn(),
    listarCuentasPorPagarCompleto: vi.fn(),
  } as unknown as IPagoMensajeroMovimientoRepository;

  const repartoRepo: ILiquidacionRepartoRepository = {
    crear: vi.fn(async (_tx, input: CrearLiquidacionRepartoInput) => {
      log.push("crear:reparto");
      // El `UNIQUE(clave_idempotencia)`, modelado como barrera DE DATOS: no hay `SELECT` previo
      // que decida si insertar (R29).
      if (clavesUsadas.has(input.claveIdempotencia)) return { status: "clave_repetida" as const };
      pendientesDeCommit.push(() => {
        clavesUsadas.add(input.claveIdempotencia);
        confirmados.repartos.push(input);
      });
      return { status: "creado" as const, reparto: repartoDTO({ montoTotal: input.montoTotal }) };
    }),
    obtenerPorClave: vi.fn(async () => {
      log.push("obtener:reparto-por-clave");
      return opciones.repartoExistente === undefined ? repartoDTO() : opciones.repartoExistente;
    }),
  };

  const llamadasTx = { n: 0 };
  const runTransaction: LiquidacionTxRunner = async (fn) => {
    llamadasTx.n += 1;
    log.push("tx:abrir");
    try {
      const r = await fn(tx as unknown as LiquidacionTx);
      for (const aplicar of pendientesDeCommit) aplicar(); // COMMIT
      log.push("tx:commit");
      return r;
    } finally {
      // Lo no aplicado se pierde: ESO es el rollback (R20).
      pendientesDeCommit = [];
    }
  };

  const caja = new CajaPagoTiendaFeedService(
    new WalletMovimientoRepository({} as unknown as PrismaClient),
  );
  vi.spyOn(caja, "emitirEgresoDePago");
  vi.spyOn(caja, "emitirReversoDeAnulacion");

  const comunes = [
    pagoRepo,
    tiendaRepo,
    mensajeroRepo,
    runTransaction,
    caja,
    repartoRepo,
    // El reloj del servidor. NO es el dia del pago (ver `RELOJ`): que sean dias distintos es lo
    // que hace que fechar los pagos con el reloj ponga rojo este archivo.
    () => new Date(RELOJ),
  ] as const;

  // El tope se INYECTA solo si el caso lo pide. Sin `opciones.tope`, el argumento NO se pasa y el
  // servicio cae en SU default, que es el unico punto de configuracion (R53) — que es lo que el
  // caso «sin tope inyectado» dice medir.
  //
  // Escribir aqui `opciones.tope ?? 50` era otra coincidencia de la familia de m3: el 50 del
  // fixture y el 50 de la configuracion valen lo mismo, asi que el constructor recibia SIEMPRE un
  // numero y la configuracion no se ejercitaba nunca. Medido: con el defecto de
  // `lib/config/reparto-mensajero.ts` puesto a 7, este archivo seguia en verde (61/61).
  const service =
    opciones.tope === undefined
      ? new LiquidacionService(...comunes)
      : new LiquidacionService(...comunes, opciones.tope);

  return {
    service,
    pagoRepo,
    mensajeroRepo,
    repartoRepo,
    caja,
    log,
    tx,
    llamadasTx,
    confirmados,
    intentados,
  };
}

/** Σ de una lista de importes STRING, con Decimal (money-safe). */
function suma(importes: readonly string[]): string {
  let total = new Prisma.Decimal(0);
  for (const importe of importes) total = total.add(new Prisma.Decimal(importe));
  return total.toFixed(2);
}

async function repartir(d: ReturnType<typeof buildDobles>, over: Partial<RegistrarRepartoMensajeroInput> = {}) {
  return d.service.registrarRepartoMensajero({ ...INPUT, ...over }, ACTOR_ADMIN);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("R1/R4 — el permiso se comprueba ANTES de tocar o leer un solo dato", () => {
  const sinAcceso: [string, RolValue][] = [
    ["adminSatelite", RolValue.adminSatelite],
    ["adminTienda", RolValue.adminTienda],
    ["mensajero", RolValue.mensajero],
    ["apiKey", RolValue.apiKey],
  ];

  for (const [nombre, rol] of sinAcceso) {
    it(`R1: ${nombre} no puede REGISTRAR un reparto y no se lee nada`, async () => {
      const d = buildDobles();

      const r = await d.service.registrarRepartoMensajero(INPUT, { usuarioId: "u", rol });

      expect(r).toEqual({ status: "forbidden" });
      // El log VACIO es la aserción: si el guard estuviera después de la primera lectura, aquí
      // habría un `leer:*` aunque la respuesta fuera `forbidden`.
      expect(d.log).toEqual([]);
      expect(d.llamadasTx.n).toBe(0);
    });

    it(`R1: ${nombre} tampoco puede PREVISUALIZAR (dice cuánto se le debe a una persona)`, async () => {
      const d = buildDobles();

      const r = await d.service.previsualizarRepartoMensajero(
        { mensajeroId: MENSAJERO, monto: "15000.00" },
        { usuarioId: "u", rol },
      );

      expect(r).toEqual({ status: "forbidden" });
      expect(d.log).toEqual([]);
      expect(d.mensajeroRepo.obtenerNombreMensajero).not.toHaveBeenCalled();
    });
  }

  it("maestro y admin SÍ pueden (si no, las contrapruebas de arriba no dirían nada)", async () => {
    for (const actor of [ACTOR_ADMIN, ACTOR_MAESTRO]) {
      const d = buildDobles();
      const r = await d.service.registrarRepartoMensajero(INPUT, actor);
      expect(r.status).toBe("ok");
      const p = await d.service.previsualizarRepartoMensajero({ mensajeroId: MENSAJERO }, actor);
      expect(p.status).toBe("ok");
    }
  });

  it("R1: un `mensajeroId` cualquiera en la petición no amplía el alcance de un rol sin acceso", async () => {
    const d = buildDobles();
    // El actor ES el mensajero: pide lo suyo y tampoco pasa.
    const r = await d.service.registrarRepartoMensajero(
      { ...INPUT, mensajeroId: "u-mensajero" },
      { usuarioId: "u-mensajero", rol: RolValue.mensajero },
    );
    expect(r).toEqual({ status: "forbidden" });
    expect(d.log).toEqual([]);
  });
});

describe("R18/R19/R25/R58 — tres imputaciones, tres pagos, tres movimientos", () => {
  it("R18: cada imputación escribe UN pago atado a SU cierre, del más antiguo al más nuevo", async () => {
    const d = buildDobles();

    const r = await repartir(d, { monto: "15000.00" }); // 5 000 + 8 000 + 2 000

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(d.confirmados.pagos.map((p) => [p.cierreId, p.monto])).toEqual([
      ["c-viejo", "5000.00"],
      ["c-medio", "8000.00"],
      ["c-nuevo", "2000.00"],
    ]);
    // R13: ni un céntimo creado ni perdido.
    expect(suma(d.confirmados.pagos.map((p) => p.monto))).toBe("15000.00");
  });

  it("R19: cada pago escribe SU movimiento en el libro, enlazado por `origen_id` al documento", async () => {
    const d = buildDobles();

    await repartir(d, { monto: "15000.00" });

    expect(d.confirmados.movimientos).toHaveLength(3);
    expect(d.confirmados.movimientos.map((m) => m.origenId)).toEqual([
      "pago-1",
      "pago-2",
      "pago-3",
    ]);
    for (const mov of d.confirmados.movimientos) {
      expect(mov.mensajeroId).toBe(MENSAJERO);
      expect(mov.tipo).toBe("pago");
      expect(mov.categoria).toBe("liquidacion");
      expect(mov.origenTipo).toBe("pago_mensajero");
      // R37 de la 172: la fecha REAL del pago, medianoche UTC, no el instante de registro. El
      // reloj del doble marca el 2 de agosto: si el libro se fechara con él, esto sería rojo.
      expect(mov.fechaMovimiento).toEqual(new Date(FECHA_PAGO_UTC));
    }
    // Y los montos del libro son los mismos que los de los documentos, uno a uno.
    expect(d.confirmados.movimientos.map((m) => m.monto)).toEqual(
      d.confirmados.pagos.map((p) => p.monto),
    );
  });

  it("R58: método, referencia y fecha son IDÉNTICOS en las tres, capturados una sola vez", async () => {
    const d = buildDobles();

    await repartir(d, { monto: "15000.00" });

    const metodos = new Set(d.confirmados.pagos.map((p) => p.metodo));
    const referencias = new Set(d.confirmados.pagos.map((p) => p.referencia));
    const fechas = new Set(d.confirmados.pagos.map((p) => p.fechaPago.toISOString()));
    expect([...metodos]).toEqual(["SINPE"]);
    expect([...referencias]).toEqual(["1234567"]);
    expect([...fechas]).toEqual([FECHA_PAGO_UTC]);

    // …y las tres líneas del libro dicen lo mismo, con `origen_id` distinto (design §5.4.1): esa
    // es la contracara que hace que la repetición sea legible en vez de confusa.
    expect(new Set(d.confirmados.movimientos.map((m) => m.descripcion))).toEqual(
      new Set(["SINPE · 1234567"]),
    );
    expect(new Set(d.confirmados.movimientos.map((m) => m.origenId)).size).toBe(3);
  });

  it("R58: esa fecha viene de la PETICIÓN y no del reloj del servidor", async () => {
    // El caso que la coincidencia del fixture tapaba (review m3): con el reloj y `fechaPago` en el
    // mismo día, fechar los pagos con `medianocheUtcDelDia(fechaCalendarioCR(this.ahora()))` daba
    // el MISMO valor y ningún caso lo notaba. Aquí se mide de dónde sale el dato, dos veces:
    //
    //  1. con la fecha por defecto, que NO es el día del reloj;
    //  2. con OTRA fecha, que tampoco lo es — y el valor escrito la SIGUE. Sin este segundo
    //     envío, una implementación que devolviera la constante `2026-07-30` pasaría igual.
    for (const fechaPago of [FECHA_PAGO, "2026-07-15"]) {
      const d = buildDobles();

      await repartir(d, { monto: "15000.00", fechaPago });

      const esperada = `${fechaPago}T00:00:00.000Z`;
      expect(esperada, "la fecha del caso no puede ser la del reloj").not.toBe(
        `${DIA_DEL_RELOJ}T00:00:00.000Z`,
      );

      // Las tres filas del documento…
      expect(d.confirmados.pagos.map((p) => p.fechaPago.toISOString())).toEqual([
        esperada,
        esperada,
        esperada,
      ]);
      // …y las tres del libro (R37 de la 172: el libro se fecha con el día del pago). El `?.` es
      // por el tipo (el campo es opcional en el input del libro): si alguna línea llegara SIN
      // fecha, el `undefined` no casaría con `esperada` y esto seguiría siendo rojo.
      expect(d.confirmados.movimientos.map((m) => m.fechaMovimiento?.toISOString())).toEqual([
        esperada,
        esperada,
        esperada,
      ]);
      // Dicho por el otro lado, que es el que nombra al culpable si esto se rompe: el día del
      // reloj no aparece en ninguna fila escrita.
      expect(d.confirmados.pagos.map((p) => p.fechaPago.toISOString().slice(0, 10))).not.toContain(
        DIA_DEL_RELOJ,
      );
    }
  });

  it("R28: los tres pagos cuelgan del MISMO reparto y su clave se deriva del cierre", async () => {
    const d = buildDobles();

    await repartir(d, { monto: "15000.00" });

    expect(new Set(d.confirmados.pagos.map((p) => p.repartoId))).toEqual(new Set(["rep-1"]));
    expect(d.confirmados.pagos.map((p) => p.claveIdempotencia)).toEqual([
      `${CLAVE}:c-viejo`,
      `${CLAVE}:c-medio`,
      `${CLAVE}:c-nuevo`,
    ]);
  });

  it("R25: el resultado devuelve el reparto APLICADO, con lo que queda por imputar", async () => {
    const d = buildDobles();

    const r = await repartir(d, { monto: "15000.00" });

    expect(r).toEqual({
      status: "ok",
      reparto: {
        totalImputado: "15000.00",
        // 25 000 imputables − 15 000 aplicados.
        restanteImputable: "10000.00",
        imputaciones: [
          { cierreId: "c-viejo", monto: "5000.00", pendienteDespues: "0.00" },
          { cierreId: "c-medio", monto: "8000.00", pendienteDespues: "0.00" },
          { cierreId: "c-nuevo", monto: "2000.00", pendienteDespues: "10000.00" },
        ],
      },
    });
  });

  it("R26: no se escribe NADA en el cierre: sus datos son de solo lectura", async () => {
    const d = buildDobles();

    await repartir(d, { monto: "15000.00" });

    for (const metodo of ["create", "createMany", "update", "updateMany", "delete", "deleteMany", "upsert"] as const) {
      expect(d.tx.cierreDia[metodo], `cierreDia.${metodo}`).not.toHaveBeenCalled();
    }
  });

  it("[P2] la caja principal no recibe ni una llamada: el pago al mensajero no la roza", async () => {
    const d = buildDobles();

    await repartir(d, { monto: "15000.00" });

    expect(d.caja.emitirEgresoDePago).not.toHaveBeenCalled();
    expect(d.caja.emitirReversoDeAnulacion).not.toHaveBeenCalled();
    expect(d.tx.walletMovimiento.createMany).not.toHaveBeenCalled();
  });
});

describe("R20 — todo o nada: un fallo a mitad no deja NADA", () => {
  it("R20: si la TERCERA imputación revienta, no queda ni un pago, ni un movimiento, ni el reparto", async () => {
    const d = buildDobles({ reventarEnPago: 3 });

    await expect(repartir(d, { monto: "15000.00" })).rejects.toThrow("boom");

    // Se INTENTARON las dos primeras (es lo que hace que este caso valga algo)…
    expect(d.intentados.pagos.map((p) => p.cierreId)).toEqual(["c-viejo", "c-medio", "c-nuevo"]);
    expect(d.intentados.movimientos).toHaveLength(2);
    // …y no quedó CONFIRMADA ninguna, ni el acto que las agrupa.
    expect(d.confirmados.pagos).toEqual([]);
    expect(d.confirmados.movimientos).toEqual([]);
    expect(d.confirmados.repartos).toEqual([]);
    expect(d.log).not.toContain("tx:commit");
  });

  it("R20: si revienta la PRIMERA, tampoco queda el reparto (la fila del acto va dentro)", async () => {
    const d = buildDobles({ reventarEnPago: 1 });

    await expect(repartir(d, { monto: "15000.00" })).rejects.toThrow("boom");

    expect(d.confirmados.pagos).toEqual([]);
    expect(d.confirmados.repartos).toEqual([]);
  });

  it("R20: si una imputación CHOCA con una clave ya usada, se revierte todo (no se salta)", async () => {
    // El caso imposible-en-teoría de `ImputacionRepetidaError`. Que sea imposible no lo hace
    // inofensivo: SALTARSE esa imputación devolvería `ok` por un importe menor que el que la
    // persona comprometió, y el reparto habría pagado 7 000 de los 15 000 sin que nada lo diga.
    // Un fallo ruidoso que revierte es la única respuesta auditable.
    const d = buildDobles({ chocarEnPago: 2 });

    await expect(repartir(d, { monto: "15000.00" })).rejects.toThrow(/imputacion|imputación/i);

    expect(d.confirmados.pagos).toEqual([]);
    expect(d.confirmados.movimientos).toEqual([]);
    expect(d.confirmados.repartos).toEqual([]);
    expect(d.log).not.toContain("tx:commit");
    // Y NO siguió con la tercera: se corta en el choque.
    expect(d.intentados.pagos.map((p) => p.cierreId)).toEqual(["c-viejo", "c-medio"]);
  });

  it("R20 (control): sin fallo, esas mismas filas SÍ se confirman", async () => {
    const d = buildDobles();
    await repartir(d, { monto: "15000.00" });
    expect(d.confirmados.pagos).toHaveLength(3);
    expect(d.confirmados.repartos).toHaveLength(1);
    expect(d.log).toContain("tx:commit");
  });
});

describe("R14/R15 — los dos rechazos, sin escribir nada", () => {
  it("R14: un importe por encima del imputable se rechaza informando del disponible", async () => {
    const d = buildDobles();

    const r = await repartir(d, { monto: "25000.01" }); // imputable = 25 000

    expect(r).toEqual({ status: "excede", disponible: "25000.00" });
    expect(d.confirmados.pagos).toEqual([]);
    expect(d.intentados.pagos).toEqual([]);
    expect(d.confirmados.movimientos).toEqual([]);
  });

  it("R14: la frontera exacta (importe == imputable) SÍ se acepta", async () => {
    const d = buildDobles();

    const r = await repartir(d, { monto: "25000.00" });

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.reparto.restanteImputable).toBe("0.00");
  });

  it("R15: sin cierres imputables se responde `sin_saldo` y no se escribe nada", async () => {
    const d = buildDobles({ cierres: [[]] });

    const r = await repartir(d);

    expect(r).toEqual({ status: "sin_saldo" });
    expect(d.intentados.pagos).toEqual([]);
    expect(d.pagoRepo.bloquearBeneficiario).not.toHaveBeenCalled();
  });

  it("R15: cierres aprobados pero TODOS saldados también son `sin_saldo` (no `excede` con 0.00)", async () => {
    // Es la diferencia entre «no hay nada que pagar» y «se puede pagar 0.00», y la segunda sería
    // un mensaje absurdo para el operador.
    const d = buildDobles({
      pagados: [{ "c-viejo": "5000.00", "c-medio": "8000.00", "c-nuevo": "12000.00" }],
    });

    const r = await repartir(d);

    expect(r).toEqual({ status: "sin_saldo" });
    expect(d.intentados.pagos).toEqual([]);
  });
});

describe("R5/R6/R7 — qué es imputable, derivado en cada lectura", () => {
  it("R5/R6: un cierre ya saldado no recibe nada Y NO OCUPA PLAZA en la ventana", async () => {
    // Con `tope: 2`, si el saldado ocupara plaza sólo entraría un cierre pagable y el importe no
    // cabría. Es la forma de medir que el filtro va ANTES de formar la ventana.
    const d = buildDobles({
      tope: 2,
      pagados: [{ "c-viejo": "5000.00" }], // el más antiguo queda a 0
    });

    const r = await repartir(d, { monto: "20000.00" }); // 8 000 + 12 000

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.reparto.imputaciones.map((i) => i.cierreId)).toEqual(["c-medio", "c-nuevo"]);
    expect(d.log).not.toContain("bloquear:cierre:c-viejo");
  });

  it("R6/R7: el pendiente sale de la Σ de pagos VIGENTES, y se vuelve a derivar en cada lectura", async () => {
    // Un pago anulado no está en esa suma (lo excluye el `where` del repositorio, probado en su
    // propia suite): aquí se mide que el servicio no tiene ninguna otra fuente del pendiente.
    const d = buildDobles({ pagados: [{ "c-viejo": "4000.00" }] });

    const r = await repartir(d, { monto: "1000.00" });

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    // 5 000 − 4 000 ya pagados = 1 000 pendiente, y el importe lo agota exactamente.
    expect(r.reparto.imputaciones).toEqual([
      { cierreId: "c-viejo", monto: "1000.00", pendienteDespues: "0.00" },
    ]);
    expect(d.pagoRepo.sumarVigentesPorCierre).toHaveBeenCalled();
  });

  it("R24: un cierre de OTRO mensajero no recibe nada aunque la lectura lo devuelva", async () => {
    const d = buildDobles({
      cierres: [
        [
          cierre("c-ajeno", "9000.00", "2026-06-01T10:00:00.000Z", { mensajeroId: "otro" }),
          cierre("c-viejo", "5000.00", "2026-07-01T10:00:00.000Z"),
        ],
      ],
    });

    const r = await repartir(d, { monto: "5000.00" });

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.reparto.imputaciones.map((i) => i.cierreId)).toEqual(["c-viejo"]);
    expect(d.log).not.toContain("bloquear:cierre:c-ajeno");
    expect(d.confirmados.pagos.map((p) => p.cierreId)).toEqual(["c-viejo"]);
  });
});

describe("R23/R24 — manda lo que se lee BAJO BLOQUEO, y la ventana ENCOGE", () => {
  it("R23: si el pendiente cambió entre la primera lectura y el bloqueo, se aplica el RECALCULADO", async () => {
    // Primera lectura: c-viejo debe 5 000. Bajo bloqueo ya le pagaron 3 000 por otra vía, así que
    // sólo admite 2 000 y el resto baja al siguiente cierre.
    const d = buildDobles({
      pagados: [{}, { "c-viejo": "3000.00" }],
    });

    const r = await repartir(d, { monto: "5000.00" });

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.reparto.imputaciones).toEqual([
      { cierreId: "c-viejo", monto: "2000.00", pendienteDespues: "0.00" },
      { cierreId: "c-medio", monto: "3000.00", pendienteDespues: "5000.00" },
    ]);
    // La previsualización habría dicho «todo a c-viejo»; mandó la relectura.
    expect(d.pagoRepo.sumarVigentesPorCierre).toHaveBeenCalledTimes(2);
  });

  it("R23: las DOS lecturas del reparto ocurren DENTRO de la transacción", async () => {
    // Leer fuera dejaría una ventana entre lo que se lee y lo que se escribe, y el candado no
    // serializaría nada: es el mismo motivo por el que la guardia del cierre de la 172 se lee en
    // la transacción. El doble distingue las dos formas por el `tx` que recibe.
    const d = buildDobles();

    await repartir(d, { monto: "15000.00" });

    expect(d.log.filter((e) => e === "leer:imputables")).toHaveLength(2);
    expect(d.log).not.toContain("leer:imputables:fuera-de-tx");
  });

  it("R24: un cierre que dejó de estar `aprobado` bajo bloqueo NO recibe nada", async () => {
    // Segunda lectura: `c-medio` ya no sale del `WHERE estado = aprobado`.
    const d = buildDobles({
      cierres: [tresCierres(), [tresCierres()[0], tresCierres()[2]]],
    });

    const r = await repartir(d, { monto: "17000.00" }); // 5 000 + 12 000

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.reparto.imputaciones.map((i) => i.cierreId)).toEqual(["c-viejo", "c-nuevo"]);
    // Se bloqueó igualmente —era de la ventana cuando se tomó el candado— pero no recibió nada.
    expect(d.log).toContain("bloquear:cierre:c-medio");
    expect(d.confirmados.pagos.map((p) => p.cierreId)).toEqual(["c-viejo", "c-nuevo"]);
  });

  it("§2.5.5: la ventana SE ENCOGE, no se rellena con el cierre recortado siguiente", async () => {
    // `tope: 2` ⇒ ventana = {c-viejo, c-medio} y c-nuevo queda RECORTADO (no se bloquea). Bajo
    // bloqueo, c-medio se cae. Rellenar con c-nuevo exigiría bloquearlo AHORA, fuera del orden
    // acordado: por eso el reparto se queda con uno solo y el resto se rechaza por exceso.
    const d = buildDobles({
      tope: 2,
      cierres: [tresCierres(), [tresCierres()[0], tresCierres()[2]]],
    });

    const r = await repartir(d, { monto: "13000.00" }); // 5 000 + 8 000, si se rellenara: cabría

    expect(r).toEqual({ status: "excede", disponible: "5000.00" });
    // El cierre recortado NO se bloqueó ni antes ni después: la ventana nunca creció.
    expect(d.log.filter((e) => e.startsWith("bloquear:"))).toEqual([
      "bloquear:cierre:c-viejo",
      "bloquear:cierre:c-medio",
    ]);
    expect(d.intentados.pagos).toEqual([]);
  });

  it("§2.5.5 (control): con la ventana intacta, ese mismo importe SÍ se aplica", async () => {
    // Sin este control, el caso de arriba podría estar pasando por cualquier otro motivo.
    const d = buildDobles({ tope: 2 });

    const r = await repartir(d, { monto: "13000.00" });

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.reparto.imputaciones.map((i) => i.cierreId)).toEqual(["c-viejo", "c-medio"]);
  });
});

describe("R53/R54/R55 — el tope RECORTA la ventana, nunca rechaza por su causa", () => {
  it("R54: con `tope: 2` y 3 imputables se responde `ok` sobre los DOS más antiguos", async () => {
    const d = buildDobles({ tope: 2 });

    const r = await repartir(d, { monto: "13000.00" });

    expect(r.status).toBe("ok"); // NO hay rechazo por superar el tope
    if (r.status !== "ok") return;
    expect(r.reparto.imputaciones.map((i) => i.cierreId)).toEqual(["c-viejo", "c-medio"]);
    // Y lo que queda por imputar incluye al recortado: es lo que dice que hace falta otro reparto.
    expect(r.reparto.restanteImputable).toBe("12000.00");
  });

  it("R14/R54: por encima de la VENTANA se responde `excede` con el disponible de la ventana", async () => {
    const d = buildDobles({ tope: 2 });

    const r = await repartir(d, { monto: "13000.01" });

    // 13 000 es la ventana; 25 000 el total. El disponible que se ofrece es el de la VENTANA.
    expect(r).toEqual({ status: "excede", disponible: "13000.00" });
  });

  it("R55: con `tope: 2` y 5 imputables se bloquean DOS cierres y se escriben DOS pagos", async () => {
    const cinco = [
      ...tresCierres(),
      cierre("c-d", "3000.00", "2026-07-11T10:00:00.000Z"),
      cierre("c-e", "4000.00", "2026-07-13T10:00:00.000Z"),
    ];
    const d = buildDobles({ tope: 2, cierres: [cinco] });

    const r = await repartir(d, { monto: "13000.00" });

    expect(r.status).toBe("ok");
    expect(d.log.filter((e) => e.startsWith("bloquear:"))).toEqual([
      "bloquear:cierre:c-viejo",
      "bloquear:cierre:c-medio",
    ]);
    expect(d.confirmados.pagos).toHaveLength(2);
    expect(d.confirmados.movimientos).toHaveLength(2);
    // Los otros tres cierres no aparecen en NINGUNA llamada de escritura ni de bloqueo.
    for (const id of ["c-nuevo", "c-d", "c-e"]) {
      expect(d.log.join("|"), id).not.toContain(`bloquear:cierre:${id}`);
      expect(d.log.join("|"), id).not.toContain(`crear:documento:${id}`);
    }
  });

  it("R53: sin tope inyectado, el servicio usa el del único punto de configuración (50)", async () => {
    // Se construye con 51 cierres imputables de 100.00: si el tope por defecto no fuera 50, la
    // ventana y el `imputable` serían otros.
    const muchos = Array.from({ length: 51 }, (_, i) =>
      cierre(`c-${String(i).padStart(2, "0")}`, "100.00", `2026-05-${String(i + 1).padStart(2, "0")}T10:00:00.000Z`),
    );
    const d = buildDobles({ cierres: [muchos], tope: undefined });

    const r = await d.service.previsualizarRepartoMensajero({ mensajeroId: MENSAJERO }, ACTOR_ADMIN);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.previsualizacion.recorte).toEqual({
      aplicado: true,
      tope: 50,
      enVentana: 50,
      fuera: 1,
      montoFuera: "100.00",
    });
    expect(r.previsualizacion.imputable).toBe("5000.00");
    expect(r.previsualizacion.imputableTotal).toBe("5100.00");
  });
});

describe("R28/R29/R30 — idempotencia: la clave es del REPARTO, no del cierre", () => {
  it("R28: la segunda petición con la MISMA clave no escribe nada y devuelve el reparto original", async () => {
    const d = buildDobles({
      clavesUsadas: [CLAVE],
      repartoExistente: repartoDTO(),
      pagosDelReparto: [
        pagoDelReparto("pago-1", "c-viejo", "5000.00", RELOJ),
        pagoDelReparto("pago-2", "c-medio", "8000.00", RELOJ),
        pagoDelReparto("pago-3", "c-nuevo", "2000.00", RELOJ),
      ],
    });

    const r = await repartir(d);

    expect(r.status).toBe("ya_registrado");
    if (r.status !== "ya_registrado") return;
    expect(r.reparto.totalImputado).toBe("15000.00");
    expect(r.reparto.imputaciones.map((i) => [i.cierreId, i.monto])).toEqual([
      ["c-medio", "8000.00"],
      ["c-nuevo", "2000.00"],
      ["c-viejo", "5000.00"],
    ]);
    // CERO filas nuevas.
    expect(d.confirmados.pagos).toEqual([]);
    expect(d.confirmados.movimientos).toEqual([]);
    expect(d.confirmados.repartos).toEqual([]);
    expect(d.log).not.toContain("tx:commit");
    // El original se reconstruye por `reparto_id`, no se infiere del importe ni de la fecha.
    expect(d.pagoRepo.listarPorReparto).toHaveBeenCalledWith("rep-1");
  });

  it("R28: la reconstrucción NO depende de que el FIFO vuelva a dar el mismo resultado", async () => {
    // Éste es el caso que mata la alternativa descartada (§5.2): tras el primer reparto con éxito
    // los cierres ya están saldados, así que el FIFO de HOY empieza en otro sitio. Una clave
    // derivada por cierre no colisionaría y se pagaría dos veces; la fila del acto sí colisiona.
    const d = buildDobles({
      clavesUsadas: [CLAVE],
      cierres: [[cierre("c-otro", "9000.00", "2026-08-01T10:00:00.000Z")]],
      repartoExistente: repartoDTO(),
      pagosDelReparto: [pagoDelReparto("pago-1", "c-viejo", "15000.00", RELOJ)],
    });

    const r = await repartir(d);

    expect(r.status).toBe("ya_registrado");
    if (r.status !== "ya_registrado") return;
    expect(r.reparto.imputaciones).toEqual([
      { cierreId: "c-viejo", monto: "15000.00", pendienteDespues: "0.00" },
    ]);
    expect(d.intentados.pagos).toEqual([]);
  });

  it("R28: una clave reusada apuntando a OTRO mensajero no devuelve el reparto ajeno", async () => {
    const d = buildDobles({
      clavesUsadas: [CLAVE],
      repartoExistente: repartoDTO({ mensajeroId: "otro-mensajero" }),
    });

    const r = await repartir(d);

    expect(r).toEqual({ status: "no_encontrado" });
    expect(d.pagoRepo.listarPorReparto).not.toHaveBeenCalled();
  });

  it("R28: choque de clave sin fila que lo explique ⇒ `no_encontrado`, sin inventar un `ok`", async () => {
    const d = buildDobles({ clavesUsadas: [CLAVE], repartoExistente: null });

    const r = await repartir(d);

    expect(r).toEqual({ status: "no_encontrado" });
  });

  it("R30: abrir el formulario otra vez (clave NUEVA) registra un pago distinto con los mismos datos", async () => {
    const d = buildDobles();

    const primero = await repartir(d, { monto: "5000.00" });
    const segundo = await repartir(d, {
      monto: "5000.00",
      claveIdempotencia: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    });

    expect(primero.status).toBe("ok");
    expect(segundo.status).toBe("ok"); // mismo mensajero, mismo importe, mismo método y fecha
    expect(d.confirmados.repartos).toHaveLength(2);
  });

  it("R29: la barrera es DE DATOS: no hay lectura previa que decida si escribir", async () => {
    const d = buildDobles();

    await repartir(d, { monto: "5000.00" });

    // El acto se INSERTA lo primero de la transacción; no hay `obtener:reparto-por-clave` antes.
    const iCrear = d.log.indexOf("crear:reparto");
    expect(iCrear).toBe(1); // [0] es "tx:abrir"
    expect(d.log.slice(0, iCrear)).not.toContain("obtener:reparto-por-clave");
    expect(d.repartoRepo.obtenerPorClave).not.toHaveBeenCalled();
  });
});

describe("R35/R57 — la previsualización no escribe nada y usa la MISMA ventana", () => {
  it("R35: previsualizar no abre transacción, no bloquea y no llama a ningún método de escritura", async () => {
    const d = buildDobles();

    const r = await d.service.previsualizarRepartoMensajero(
      { mensajeroId: MENSAJERO, monto: "15000.00" },
      ACTOR_ADMIN,
    );

    expect(r.status).toBe("ok");
    expect(d.llamadasTx.n).toBe(0);
    expect(d.pagoRepo.bloquearBeneficiario).not.toHaveBeenCalled();
    expect(d.pagoRepo.crear).not.toHaveBeenCalled();
    expect(d.repartoRepo.crear).not.toHaveBeenCalled();
    expect(d.mensajeroRepo.crearMovimientos).not.toHaveBeenCalled();
    expect(d.log).not.toContain("tx:abrir");
    // Y la lectura de imputables ocurre FUERA de toda transacción.
    expect(d.log).toContain("leer:imputables:fuera-de-tx");
  });

  it("R57: previsualizar y aplicar en el MISMO servicio dan la MISMA ventana", async () => {
    const cinco = [
      ...tresCierres(),
      cierre("c-d", "3000.00", "2026-07-11T10:00:00.000Z"),
      cierre("c-e", "4000.00", "2026-07-13T10:00:00.000Z"),
    ];
    const d = buildDobles({ tope: 3, cierres: [cinco] });

    const previa = await d.service.previsualizarRepartoMensajero(
      { mensajeroId: MENSAJERO, monto: "25000.00" },
      ACTOR_ADMIN,
    );
    const aplicado = await repartir(d, { monto: "25000.00" });

    expect(previa.status).toBe("ok");
    expect(aplicado.status).toBe("ok");
    if (previa.status !== "ok" || aplicado.status !== "ok") return;
    expect(previa.previsualizacion.imputaciones.map((i) => [i.cierreId, i.monto])).toEqual(
      aplicado.reparto.imputaciones.map((i) => [i.cierreId, i.monto]),
    );
    expect(previa.previsualizacion.recorte.enVentana).toBe(3);
    // Y no hay camino que impute a más cierres de los que la previsualización declaró.
    expect(aplicado.reparto.imputaciones.length).toBeLessThanOrEqual(
      previa.previsualizacion.recorte.enVentana,
    );
  });

  it("R32/R33/R34: la previsualización marca la parcial y dice el resto, todo como STRING", async () => {
    const d = buildDobles();

    const r = await d.service.previsualizarRepartoMensajero(
      { mensajeroId: MENSAJERO, monto: "15000.00" },
      ACTOR_ADMIN,
    );

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.previsualizacion.imputaciones).toEqual([
      {
        cierreId: "c-viejo",
        solicitadoAt: "2026-07-01T10:00:00.000Z",
        pendienteActual: "5000.00",
        monto: "5000.00",
        pendienteDespues: "0.00",
        parcial: false,
      },
      {
        cierreId: "c-medio",
        solicitadoAt: "2026-07-05T10:00:00.000Z",
        pendienteActual: "8000.00",
        monto: "8000.00",
        pendienteDespues: "0.00",
        parcial: false,
      },
      {
        cierreId: "c-nuevo",
        solicitadoAt: "2026-07-09T10:00:00.000Z",
        pendienteActual: "12000.00",
        monto: "2000.00",
        pendienteDespues: "10000.00",
        parcial: true, // R33: la ÚNICA parcial, y es la última
      },
    ]);
    // R46: ni un `number` suelto entre los importes.
    const json = JSON.stringify(r.previsualizacion.imputaciones);
    expect(json.match(/"(monto|pendienteActual|pendienteDespues)":\s*-?\d/)).toBeNull();
  });

  it("R38: un importe por encima de la ventana se avisa ANTES de confirmar", async () => {
    const d = buildDobles();

    const r = await d.service.previsualizarRepartoMensajero(
      { mensajeroId: MENSAJERO, monto: "30000.00" },
      ACTOR_ADMIN,
    );

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.previsualizacion.excede).toBe(true);
    expect(r.previsualizacion.sobrante).toBe("5000.00");
    expect(r.previsualizacion.imputable).toBe("25000.00");
  });

  it("R32: sin monto, la previsualización trae el conjunto imputable y ninguna imputación", async () => {
    const d = buildDobles();

    const r = await d.service.previsualizarRepartoMensajero({ mensajeroId: MENSAJERO }, ACTOR_ADMIN);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.previsualizacion.imputaciones).toEqual([]);
    expect(r.previsualizacion.imputable).toBe("25000.00");
    expect(r.previsualizacion.excede).toBe(false);
    expect(r.previsualizacion.sobrante).toBe("0.00");
  });

  it("R48: la previsualización emite el NOMBRE del mensajero y ningún id de persona", async () => {
    const d = buildDobles();

    const r = await d.service.previsualizarRepartoMensajero({ mensajeroId: MENSAJERO }, ACTOR_ADMIN);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.previsualizacion.mensajeroNombre).toBe("Marco Mensajero");
    const json = JSON.stringify(r.previsualizacion);
    expect(json).not.toContain(MENSAJERO);
    expect(json).not.toContain("u-admin");
  });

  it("un mensajero que no existe se responde sin exponer ninguna cifra", async () => {
    const d = buildDobles({ nombre: null });

    const r = await d.service.previsualizarRepartoMensajero({ mensajeroId: MENSAJERO }, ACTOR_ADMIN);

    expect(r).toEqual({ status: "no_encontrado" });
    expect(d.pagoRepo.listarCierresImputables).not.toHaveBeenCalled();
  });
});

describe("R36/R37/R56 — los avisos, resueltos en el servidor y separados", () => {
  it("R36: los excluidos llegan CONTADOS por estado, sin importe y sin nombrar ningún cierre", async () => {
    const d = buildDobles({
      noAprobados: [
        { estado: CierreEstado.rechazado, cantidad: 9 },
        { estado: CierreEstado.solicitado, cantidad: 3 },
      ],
    });

    const r = await d.service.previsualizarRepartoMensajero({ mensajeroId: MENSAJERO }, ACTOR_ADMIN);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    // «9 rechazados, 3 solicitados»: el aviso dice CUÁNTO dinero se queda fuera de este pago y
    // POR QUÉ, que es para lo que existe R36. El inventario está en `/cierres-admin`.
    expect(r.previsualizacion.excluidos).toEqual([
      { estado: "rechazado", cantidad: 9 },
      { estado: "solicitado", cantidad: 3 },
    ]);
    for (const excluido of r.previsualizacion.excluidos) {
      // Un cierre no aprobado no ha devengado nada: ni un monto en el DTO. Y ni `cierreId` ni
      // `solicitadoAt`: se PERDIÓ poder nombrar un cierre concreto en el aviso, y es el precio
      // aceptado de que esto no crezca con el historial. Este assert es lo que impide que
      // alguien lo «arregle» devolviendo otra vez la lista.
      expect(Object.keys(excluido).sort()).toEqual(["cantidad", "estado"]);
    }
  });

  it("R36: la respuesta NO crece con el historial — dos años de rechazos son UNA entrada", async () => {
    // Este es el caso que la enmienda existe para cubrir. Con una fila por cierre, aquí habría
    // 900 entradas en la previsualización; contado por estado hay una, y su tamaño depende del
    // número de valores de `CierreEstado`, no del de cierres.
    const d = buildDobles({ noAprobados: [{ estado: CierreEstado.rechazado, cantidad: 900 }] });

    const r = await d.service.previsualizarRepartoMensajero({ mensajeroId: MENSAJERO }, ACTOR_ADMIN);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.previsualizacion.excluidos).toHaveLength(1);
    expect(r.previsualizacion.excluidos[0]).toEqual({ estado: "rechazado", cantidad: 900 });
    // Y el servicio NO expande el conteo a filas por su cuenta: en el aviso no aparece ni un
    // identificador de cierre ni una fecha con la que reconstruir la lista.
    const serializado = JSON.stringify(r.previsualizacion.excluidos);
    expect(serializado).not.toContain("cierreId");
    expect(serializado).not.toContain("solicitadoAt");
  });

  it("R36: el conteo se pide UNA vez, al mensajero de la petición, y se copia tal cual", async () => {
    const d = buildDobles({ noAprobados: [{ estado: CierreEstado.vencido, cantidad: 2 }] });

    await d.service.previsualizarRepartoMensajero({ mensajeroId: MENSAJERO }, ACTOR_ADMIN);

    expect(d.pagoRepo.contarCierresNoAprobadosPorEstado).toHaveBeenCalledTimes(1);
    expect(d.pagoRepo.contarCierresNoAprobadosPorEstado).toHaveBeenCalledWith(MENSAJERO);
    // El servicio no recuenta ni suma nada: quien agrega es la base (ahí es donde el `groupBy`
    // se prueba). Aquí solo se afirma que no hay una segunda fuente para el mismo número.
    expect(d.pagoRepo.listarCierresImputables).toHaveBeenCalledTimes(1);
  });

  it("R36: sin cierres fuera, la lista de conteos viene VACÍA (no un `0` por estado)", async () => {
    // «0 rechazados» no es información: sería ruido en pantalla y obligaría al cliente a filtrar.
    const d = buildDobles({ noAprobados: [] });

    const r = await d.service.previsualizarRepartoMensajero({ mensajeroId: MENSAJERO }, ACTOR_ADMIN);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.previsualizacion.excluidos).toEqual([]);
  });

  it("R37: la deuda que no cuelga de ningún cierre se avisa con su cifra, ya comparada", async () => {
    // Cuenta por pagar 30 000 (el libro incluye un ajuste manual) contra 25 000 imputables.
    const d = buildDobles({ cuenta: { devengado: "30000.00", pagado: "0.00" } });

    const r = await d.service.previsualizarRepartoMensajero({ mensajeroId: MENSAJERO }, ACTOR_ADMIN);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.previsualizacion.cuentaPorPagar).toBe("30000.00");
    expect(r.previsualizacion.deudaNoImputable).toEqual({ hay: true, monto: "5000.00" });
  });

  it("R37: cuando todo lo que se debe cuelga de cierres, no hay aviso ni cifra negativa", async () => {
    const d = buildDobles({ cuenta: { devengado: "25000.00", pagado: "0.00" } });

    const r = await d.service.previsualizarRepartoMensajero({ mensajeroId: MENSAJERO }, ACTOR_ADMIN);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.previsualizacion.deudaNoImputable).toEqual({ hay: false, monto: "0.00" });
  });

  it("R37 (borde): un imputable MAYOR que la cuenta por pagar no produce una deuda al revés", async () => {
    const d = buildDobles({ cuenta: { devengado: "10000.00", pagado: "0.00" } });

    const r = await d.service.previsualizarRepartoMensajero({ mensajeroId: MENSAJERO }, ACTOR_ADMIN);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.previsualizacion.deudaNoImputable).toEqual({ hay: false, monto: "0.00" });
  });

  it("R56: el recorte sale del servidor con SUS TRES cifras, y es distinto del aviso de R37", async () => {
    const d = buildDobles({ tope: 2, cuenta: { devengado: "30000.00", pagado: "0.00" } });

    const r = await d.service.previsualizarRepartoMensajero({ mensajeroId: MENSAJERO }, ACTOR_ADMIN);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    // Deuda PAGABLE aquí mismo, en otro reparto…
    expect(r.previsualizacion.recorte).toEqual({
      aplicado: true,
      tope: 2,
      enVentana: 2,
      fuera: 1,
      montoFuera: "12000.00",
    });
    // …y deuda que esta pantalla NO sabe pagar. Son dos cosas distintas y llegan por separado.
    expect(r.previsualizacion.deudaNoImputable).toEqual({ hay: true, monto: "5000.00" });
    expect(r.previsualizacion.imputable).toBe("13000.00");
    expect(r.previsualizacion.imputableTotal).toBe("25000.00");
  });

  it("R56: sin cierres fuera de la ventana, `aplicado` es falso (no «la ventana está llena»)", async () => {
    const d = buildDobles({ tope: 3 }); // exactamente 3 imputables

    const r = await d.service.previsualizarRepartoMensajero({ mensajeroId: MENSAJERO }, ACTOR_ADMIN);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.previsualizacion.recorte).toEqual({
      aplicado: false,
      tope: 3,
      enVentana: 3,
      fuera: 0,
      montoFuera: "0.00",
    });
  });
});

describe("R51 — un reparto que cae entero en UN cierre escribe lo mismo que el pago simple", () => {
  it("las filas del documento y del libro coinciden campo a campo", async () => {
    const unSoloCierre = [cierre("c-uno", "50000.00", "2026-07-01T10:00:00.000Z")];

    const dReparto = buildDobles({ cierres: [unSoloCierre] });
    await dReparto.service.registrarRepartoMensajero(
      { ...INPUT, monto: "15000.00" },
      ACTOR_ADMIN,
    );

    const dSimple = buildDobles({ cierres: [unSoloCierre] });
    await dSimple.service.registrarPagoMensajero(
      {
        claveIdempotencia: CLAVE,
        cierreId: "c-uno",
        monto: "15000.00",
        metodo: "SINPE",
        referencia: "1234567",
        nota: "Pago de la semana",
        fechaPago: FECHA_PAGO,
      },
      ACTOR_ADMIN,
    );

    expect(dReparto.confirmados.pagos).toHaveLength(1);
    expect(dSimple.confirmados.pagos).toHaveLength(1);

    // Lo único que difiere son las dos columnas que dicen «esto nació de un acto de reparto»:
    // la clave derivada y el `reparto_id`. Todo lo demás es idéntico, campo a campo.
    const { claveIdempotencia: claveA, repartoId: repartoA, ...restoReparto } = dReparto.confirmados.pagos[0];
    const { claveIdempotencia: claveB, repartoId: repartoB, ...restoSimple } = dSimple.confirmados.pagos[0];
    expect(restoReparto).toEqual(restoSimple);
    expect(claveA).toBe(`${CLAVE}:c-uno`);
    expect(claveB).toBe(CLAVE);
    expect(repartoA).toBe("rep-1");
    expect(repartoB).toBeNull();

    // Y el movimiento del libro es EL MISMO, sin excepciones.
    expect(dReparto.confirmados.movimientos).toEqual(dSimple.confirmados.movimientos);
  });
});

/** Un pago tal y como lo devuelve `listarPorReparto` para la respuesta idempotente. */
function pagoDelReparto(
  id: string,
  cierreId: string,
  monto: string,
  registradoAt: string,
): LiquidacionPagoDTO {
  return {
    id,
    mensajeroId: MENSAJERO,
    tiendaId: null,
    cierreId,
    monto,
    metodo: "SINPE",
    referencia: "1234567",
    nota: null,
    fechaPago: FECHA_PAGO,
    registradoPorNombre: "Ana Admin",
    registradoAt,
    anulacion: null,
  };
}
