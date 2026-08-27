import { describe, it, expect, vi } from "vitest";
import { CierreEstado, RolValue, type PrismaClient } from "@prisma/client";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { CajaPagoTiendaFeedService } from "@/lib/services/CajaPagoTiendaFeedService";
import { LiquidacionService } from "@/lib/services/LiquidacionService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { codigoSinComentarios } from "../../fixtures/sin-comentarios";
import type {
  CierreParaPagoDTO,
  ILiquidacionPagoRepository,
  LiquidacionPagoDTO,
} from "@/lib/interfaces/repositories/ILiquidacionPagoRepository";
import type { ILiquidacionRepartoRepository } from "@/lib/interfaces/repositories/ILiquidacionRepartoRepository";
import type {
  CrearPagoMensajeroInput,
  IPagoMensajeroMovimientoRepository,
} from "@/lib/interfaces/repositories/IPagoMensajeroMovimientoRepository";
import type {
  CrearMovimientoTiendaInput,
  IWalletTiendaMovimientoRepository,
} from "@/lib/interfaces/repositories/IWalletTiendaMovimientoRepository";
import type {
  LiquidacionTx,
  LiquidacionTxRunner,
} from "@/lib/interfaces/services/ILiquidacionService";
import type {
  RegistrarPagoMensajeroInput,
  RegistrarPagoTiendaInput,
} from "@/lib/types/liquidacion";

// Feature 172 / T B.3 (mitad TIENDA) + T B.5 (mitad MENSAJERO) — `LiquidacionService`.
// Cubre R1, R2, R5, R6, R20, R21, R23, R24, R25, R29, R30, R31, R32, R35, R36, R38, R39, R40,
// R41, R42 (+ R37 en la fecha del movimiento y R43/R47 en la rama idempotente).
//
// ⚠️ **Feature 173 / T C.2 — CAMBIO DELIBERADO DE ASERCIONES QUE ESTABAN VERDES.** R40 de la 172
// decia «la caja principal no recibe ni una llamada, ni al pagar ni al anular». Su premisa era
// que el egreso del pago a tienda restaria de la caja un dinero que nunca entro en ella. Desde
// la Tanda B de la 173 ese dinero SI entra (el contra-entrega se acredita a la caja al aprobar
// el cierre), asi que la mitad-TIENDA de R40 queda superada y se REESCRIBE aqui: de «cero
// llamadas» a «EXACTAMENTE UNA, con esta categoria, este monto, este origen y esta fecha».
//
// La mitad-MENSAJERO de R40 **no se toca** ([P2] = (a), respuesta humana del 2026-08-03): sigue
// en cero llamadas, y ademas gana una contraprueba nueva sobre el puerto. Las dos aserciones
// reescritas estan enumeradas una a una en `progress/impl_173-caja-tesoreria.md`.
//
// Money-safe: ni un `Number(` ni un `parseFloat` sobre un monto en todo el archivo; el ultimo
// bloque afirma lo mismo del modulo del servicio.

const ACTOR_ADMIN: Actor = { usuarioId: "u-admin", rol: RolValue.admin };
const ACTOR_MAESTRO: Actor = { usuarioId: "u-maestro", rol: RolValue.maestro };

const INPUT: RegistrarPagoTiendaInput = {
  claveIdempotencia: "11111111-1111-4111-8111-111111111111",
  tiendaId: "t1",
  monto: "15000.00",
  metodo: "SINPE",
  referencia: "1234567",
  nota: "Pago parcial de julio",
  fechaPago: "2026-07-30",
};

/** El mismo pago, pero contra el cierre `c1` de un mensajero (T B.5). */
const INPUT_MENSAJERO: RegistrarPagoMensajeroInput = {
  claveIdempotencia: "22222222-2222-4222-8222-222222222222",
  cierreId: "c1",
  monto: "15000.00",
  metodo: "SINPE",
  referencia: "1234567",
  nota: "Pago parcial de julio",
  fechaPago: "2026-07-30",
};

/** Cierre APROBADO con P = 50 000 y E = 0 -> pendiente generado por el cierre: 50 000. */
function cierreDTO(over: Partial<CierreParaPagoDTO> = {}): CierreParaPagoDTO {
  return {
    id: "c1",
    mensajeroId: "m1",
    estado: CierreEstado.aprobado,
    totalPagoMensajero: "50000.00",
    totalEfectivo: "0.00",
    ...over,
  };
}

function pagoDTO(over: Partial<LiquidacionPagoDTO> = {}): LiquidacionPagoDTO {
  return {
    id: "pago-1",
    mensajeroId: null,
    tiendaId: "t1",
    cierreId: null,
    monto: "15000.00",
    metodo: "SINPE",
    referencia: "1234567",
    nota: "Pago parcial de julio",
    fechaPago: "2026-07-30",
    registradoPorNombre: "Ana Admin",
    registradoAt: "2026-08-02T15:04:05.000Z",
    // Feature 206: por defecto un pago SUELTO. Los tests de la anulacion agrupada lo sobrescriben
    // con un reparto; dejarlo `null` aqui es lo que hace que el caso agrupado se vea explicito en
    // el test que lo necesita, en vez de venir de serie y no distinguir nada.
    repartoId: null,
    anulacion: null,
    ...over,
  };
}

/**
 * Doble de la TRANSACCION con la forma de un `tx` de Prisma: expone los delegados de los dos
 * libros, del documento y el de la CAJA PRINCIPAL, con todos sus metodos espiados. Asi, R41 y la
 * mitad-mensajero de R40 no se comprueban leyendo el codigo: se comprueban contando llamadas
 * sobre las puertas que el servicio TENDRIA que abrir si escribiera donde no debe.
 *
 * **Feature 173 / T C.2:** el delegado de la caja deja de ser una puerta que debe seguir cerrada
 * en el camino de la TIENDA y pasa a ser la tercera escritura de la transaccion. `createMany`
 * apunta en el LOG cuando ocurre, para que su posicion —dentro de la `tx` y DESPUES del ledger—
 * sea medible y no una promesa (R19). Los otros seis metodos siguen espiados y siguen debiendo
 * quedarse a cero: el reverso de una anulacion es una fila NUEVA, nunca un `update` (R29).
 */
function buildTx(log: string[]) {
  const espia = () => ({
    create: vi.fn(),
    createMany: vi.fn().mockResolvedValue({ count: 1 }),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
    upsert: vi.fn(),
  });
  return {
    liquidacionPago: espia(),
    walletTiendaMovimiento: espia(),
    pagoMensajeroMovimiento: espia(),
    walletMovimiento: {
      ...espia(),
      createMany: vi.fn(async () => {
        log.push("crear:caja");
        return { count: 1 };
      }),
    },
    cierreDia: espia(), // R42: ningun snapshot del cierre se toca
    $queryRaw: vi.fn().mockResolvedValue([]),
  };
}

type Registro = string;

/**
 * Los tres repositorios, dobles, compartiendo un LOG ORDENADO de lo que se les pide. El orden es
 * lo que prueba R83 (el candado antes de la lectura) y el conteo lo que prueba R85.
 *
 * `cierre` y `pagadoVigente` alimentan el camino del MENSAJERO (T B.5): el cierre que devuelve
 * la guardia de R20 y lo ya pagado contra el, que es lo que `derivarPendienteCierre` resta.
 */
function buildDobles(opciones: {
  creditos: string;
  debitos: string;
  cierre?: CierreParaPagoDTO | null;
  pagadoVigente?: string;
  /** T C.1: los comprobantes que devuelven los dos listados del repositorio. */
  pagos?: LiquidacionPagoDTO[];
  /** Feature 293 (T2.3, §6/4): Σ de PREMIOS VIVOS del cierre. Ausente = "0.00". */
  premiosVivos?: string;
}) {
  const log: Registro[] = [];
  const tx = buildTx(log);
  const txsVistos: unknown[] = [];
  const cierre = opciones.cierre === undefined ? cierreDTO() : opciones.cierre;

  const pagoRepo: ILiquidacionPagoRepository = {
    bloquearBeneficiario: vi.fn(async (t, objetivo) => {
      txsVistos.push(t);
      log.push(
        objetivo.tipo === "tienda" ? `bloquear:tienda:${objetivo.tiendaId}` : `bloquear:cierre:${objetivo.cierreId}`,
      );
    }),
    crear: vi.fn(async (t) => {
      txsVistos.push(t);
      log.push("crear:documento");
      return { status: "creado" as const, pago: pagoDTO() };
    }),
    // T F.1: el contrato gana `anular`. Ningun test de ESTE archivo anula —la anulacion tiene el
    // suyo, `liquidacion-anulacion.test.ts`—, pero el doble escribe en el log igualmente: los
    // caminos de registro comparan el log ENTERO, asi que una llamada a `anular` colada en el
    // registro rompería esas aserciones en vez de pasar inadvertida.
    anular: vi.fn(async () => {
      log.push("anular");
      return {
        status: "anulado" as const,
        anulacion: {
          motivo: "Monto mal tecleado",
          anuladoPorNombre: "Mario Maestro",
          anuladoAt: "2026-08-03T09:00:00.000Z",
        },
      };
    }),
    // R20: si llega `tx`, la guardia se leyo DENTRO de la transaccion (y el `tx` visto lo
    // demuestra); sin `tx` es la relectura de la rama idempotente, que ocurre fuera.
    obtenerCierreParaPago: vi.fn(async (_id, t) => {
      if (t !== undefined) txsVistos.push(t);
      log.push(t === undefined ? "leer:cierre:fuera-de-tx" : "leer:cierre");
      return cierre;
    }),
    obtenerPorClave: vi.fn(async () => {
      log.push("obtener:por-clave");
      return null;
    }),
    obtenerPorId: vi.fn(async () => null),
    sumarVigentesPorCierre: vi.fn(async (ids: string[]) => {
      log.push("leer:pagado-vigente");
      return Object.fromEntries(ids.map((id) => [id, opciones.pagadoVigente ?? "0.00"]));
    }),
    sumarVigentesPorTienda: vi.fn(async () => "0.00"),
    listarPorCierre: vi.fn(async () => {
      log.push("listar:por-cierre");
      return opciones.pagos ?? [];
    }),
    listarPorTienda: vi.fn(async () => {
      log.push("listar:por-tienda");
      return opciones.pagos ?? [];
    }),
    // Feature 205 (T2.2): el contrato gana dos LECTURAS. Ningun test de este archivo las
    // usa —son del reparto—, pero el doble las expone para poder afirmar que los caminos de la
    // 172 NO las llaman.
    listarCierresImputables: vi.fn(async () => {
      log.push("listar:cierres-imputables");
      return [];
    }),
    listarPorReparto: vi.fn(async () => {
      log.push("listar:por-reparto");
      return [];
    }),
    // Feature 205 (T3.1): la tercera lectura del reparto (el CONTEO por estado de los cierres no
    // aprobados de R36). Tampoco la usa ningun test de este archivo, y por eso mismo esta
    // espiada: los caminos de la 172 comparan el log ENTERO, asi que una llamada colada aqui los
    // pondria rojos.
    contarCierresNoAprobadosPorEstado: vi.fn(async () => {
      log.push("contar:cierres-no-aprobados");
      return [];
    }),
  };

  /**
   * Feature 205 (T3.2): el repositorio del ACTO de repartir, doble MUDO. Ningun test de este
   * archivo reparte —eso vive en `liquidacion-reparto-service.test.ts`—, pero el servicio lo
   * exige por constructor (no tiene default a proposito) y sus dos metodos escriben en el log:
   * si un camino de la 172 escribiera un reparto, las comparaciones del log lo dirian.
   */
  const repartoRepo: ILiquidacionRepartoRepository = {
    crear: vi.fn(async () => {
      log.push("crear:reparto");
      return { status: "clave_repetida" as const };
    }),
    obtenerPorClave: vi.fn(async () => {
      log.push("obtener:reparto-por-clave");
      return null;
    }),
  };

  const tiendaRepo: IWalletTiendaMovimientoRepository = {
    crearMovimientos: vi.fn(async (t) => {
      txsVistos.push(t);
      log.push("crear:movimiento");
      return 1;
    }),
    agregarSaldoPorTienda: vi.fn(async () => {
      log.push("leer:disponible");
      return { creditos: opciones.creditos, debitos: opciones.debitos };
    }),
    listarPorTienda: vi.fn(),
    listarSaldosTodasTiendas: vi.fn(),
    listarSaldosTiendasPaginado: vi.fn(),
    agregarDesglosePorTienda: vi.fn(),
  } as unknown as IWalletTiendaMovimientoRepository;

  const mensajeroRepo: IPagoMensajeroMovimientoRepository = {
    crearMovimientos: vi.fn(async (t) => {
      txsVistos.push(t);
      log.push("crear:movimiento");
      return 1;
    }),
    listarPorMensajero: vi.fn(),
    agregarCuentaPorPagar: vi.fn(),
    listarCuentasPorPagarTodos: vi.fn(),
    listarCuentasPorPagarPaginado: vi.fn(),
    listarCuentasPorPagarCompleto: vi.fn(),
    obtenerNombreMensajero: vi.fn(),
    // Feature 293 (T2.3, §6/4): la Σ de PREMIOS VIVOS que `pendienteDelCierre` lee para fijar
    // el tope del pago. Escribe en el log, como sus hermanas: los caminos que NO deben leerla
    // (el de la tienda) comparan el log ENTERO y una llamada colada los pondria rojos.
    sumarPremiosVivosPorCierre: vi.fn(async (ids: string[]) => {
      log.push("leer:premios-vivos");
      return Object.fromEntries(ids.map((id) => [id, opciones.premiosVivos ?? "0.00"]));
    }),
    listarPremiosPorDias: vi.fn(async () => []),
  } as unknown as IPagoMensajeroMovimientoRepository;

  const llamadasTx = { n: 0 };
  const runTransaction: LiquidacionTxRunner = async (fn) => {
    llamadasTx.n += 1;
    log.push("tx:abrir");
    const r = await fn(tx as unknown as LiquidacionTx);
    log.push("tx:commit");
    return r;
  };

  /**
   * Feature 173 / T C.2 — el PUERTO de la caja, REAL, con sus dos metodos espiados (llaman al
   * original). Real y no doble a proposito: un doble mudo dejaria sin medir lo unico que importa
   * aqui —que la fila que llega a la caja lleva la categoria, el tipo, el origen y la fecha
   * correctos—, y hay una suite entera (`liquidacion-caja-puerto.test.ts`) para afirmar que esos
   * cuatro campos NO los elige quien llama.
   *
   * El repositorio va sobre un cliente vacio a proposito: `crearMovimientos` escribe siempre en
   * el `tx` que se le pasa y jamas en el cliente propio. Si algun dia dejara de ser cierto, este
   * doble reventaria en vez de escribir en una base de mentira.
   */
  const caja = new CajaPagoTiendaFeedService(
    new WalletMovimientoRepository({} as unknown as PrismaClient),
  );
  vi.spyOn(caja, "emitirEgresoDePago");
  vi.spyOn(caja, "emitirReversoDeAnulacion");

  const service = new LiquidacionService(
    pagoRepo,
    tiendaRepo,
    mensajeroRepo,
    runTransaction,
    caja,
    repartoRepo, // feature 205 (T3.2): sin default, igual que el puerto de la caja
  );
  return {
    service,
    pagoRepo,
    tiendaRepo,
    mensajeroRepo,
    repartoRepo,
    caja,
    llamadasTx,
    log,
    tx,
    txsVistos,
  };
}

/** La fila que el servicio mando escribir en la CAJA PRINCIPAL (feature 173). */
function filaDeCaja(tx: ReturnType<typeof buildTx>): Record<string, unknown> {
  const mock = tx.walletMovimiento.createMany as unknown as { mock: { calls: unknown[][] } };
  const arg = mock.mock.calls[0][0] as { data: Record<string, unknown>[] };
  return arg.data[0];
}

/**
 * Fuente del servicio SIN comentarios. Importa: los barridos de abajo buscan cadenas que el
 * propio modulo NOMBRA en sus comentarios para explicar por que NO las usa (`egreso_pago_tienda`,
 * [P2]). Un barrido sobre el texto crudo confundiria la explicacion con el defecto.
 */
function fuenteDelServicioSinComentarios(): string {
  return codigoSinComentarios("lib/services/LiquidacionService.ts");
}

/** El movimiento que el servicio mando escribir en el ledger de la tienda. */
function movimientoEscrito(
  tiendaRepo: IWalletTiendaMovimientoRepository,
): CrearMovimientoTiendaInput {
  const mock = tiendaRepo.crearMovimientos as unknown as { mock: { calls: unknown[][] } };
  return (mock.mock.calls[0][1] as CrearMovimientoTiendaInput[])[0];
}

/** El movimiento que el servicio mando escribir en el libro del mensajero (T B.5). */
function movimientoDelMensajero(
  mensajeroRepo: IPagoMensajeroMovimientoRepository,
): CrearPagoMensajeroInput {
  const mock = mensajeroRepo.crearMovimientos as unknown as { mock: { calls: unknown[][] } };
  return (mock.mock.calls[0][1] as CrearPagoMensajeroInput[])[0];
}

/** El `data` con el que se escribio el DOCUMENTO, sea cual sea el beneficiario. */
function documentoEscrito(pagoRepo: ILiquidacionPagoRepository): Record<string, unknown> {
  const mock = pagoRepo.crear as unknown as { mock: { calls: unknown[][] } };
  return mock.mock.calls[0][1] as Record<string, unknown>;
}

describe("R1/R2/R5/R6 — quien puede pagar, comprobado ANTES de tocar datos", () => {
  const sinAcceso: [string, RolValue][] = [
    ["adminSatelite", RolValue.adminSatelite],
    ["adminTienda", RolValue.adminTienda],
    ["mensajero", RolValue.mensajero],
    ["apiKey", RolValue.apiKey],
  ];

  for (const [nombre, rol] of sinAcceso) {
    it(`R1: ${nombre} recibe forbidden y NO se abre ninguna transaccion`, async () => {
      const d = buildDobles({ creditos: "100000.00", debitos: "0.00" });

      const r = await d.service.registrarPagoTienda(INPUT, { usuarioId: "u", rol });

      expect(r).toEqual({ status: "forbidden" });
      // R5: ni siquiera se lee el beneficiario del input. El log tiene que estar VACIO: si el
      // guard estuviera despues, el saldo de la tienda ya habria salido de la base.
      expect(d.log).toEqual([]);
      expect(d.llamadasTx.n).toBe(0);
      expect(d.tiendaRepo.agregarSaldoPorTienda).not.toHaveBeenCalled();
    });
  }

  it("R2 (contraprueba): `adminTienda` pidiendo SU PROPIA tienda tambien recibe forbidden", async () => {
    const d = buildDobles({ creditos: "100000.00", debitos: "0.00" });

    // El actor ES la tienda: su usuarioId es el tienda_id que pide pagar.
    const r = await d.service.registrarPagoTienda(
      { ...INPUT, tiendaId: "t1" },
      { usuarioId: "t1", rol: RolValue.adminTienda },
    );

    expect(r).toEqual({ status: "forbidden" });
    expect(d.log).toEqual([]);
  });

  it("R6 (contraprueba): `adminSatelite` aprueba cierres, pero pagar le responde forbidden", async () => {
    const d = buildDobles({ creditos: "100000.00", debitos: "0.00" });
    const r = await d.service.registrarPagoTienda(INPUT, {
      usuarioId: "u-sat",
      rol: RolValue.adminSatelite,
    });
    expect(r).toEqual({ status: "forbidden" });
    expect(d.llamadasTx.n).toBe(0);
  });

  it("R5: un `tiendaId` distinto en la peticion no amplia el alcance de un rol sin acceso", async () => {
    const d = buildDobles({ creditos: "100000.00", debitos: "0.00" });
    const r = await d.service.registrarPagoTienda(
      { ...INPUT, tiendaId: "otra-tienda" },
      { usuarioId: "t1", rol: RolValue.adminTienda },
    );
    expect(r).toEqual({ status: "forbidden" });
    expect(d.log).toEqual([]);
  });

  it("maestro y admin si pueden (si no, las contrapruebas de arriba no dirian nada)", async () => {
    for (const actor of [ACTOR_ADMIN, ACTOR_MAESTRO]) {
      const d = buildDobles({ creditos: "100000.00", debitos: "0.00" });
      const r = await d.service.registrarPagoTienda(INPUT, actor);
      expect(r.status).toBe("ok");
    }
  });
});

describe("R29/R31/R32 — el pago va contra el SALDO ACUMULADO de la tienda", () => {
  it("R29: no exige cierre y lee el saldo SIN filtros (acumulado, no de un periodo)", async () => {
    const d = buildDobles({ creditos: "100000.00", debitos: "40000.00" });

    const r = await d.service.registrarPagoTienda(INPUT, ACTOR_ADMIN);

    expect(r.status).toBe("ok");
    expect(d.tiendaRepo.agregarSaldoPorTienda).toHaveBeenCalledWith("t1", {});
    // El documento se escribe SIN cierre (el CHECK de la base lo exige, §2.3).
    const arg = (d.pagoRepo.crear as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][1] as Record<string, unknown>;
    expect(arg.cierreId).toBeNull();
    expect(arg.mensajeroId).toBeNull();
    expect(arg.tiendaId).toBe("t1");
  });

  it("R30: un pago PARCIAL se acepta y el restante es exacto al centimo", async () => {
    const d = buildDobles({ creditos: "100000.00", debitos: "0.00" });

    const r = await d.service.registrarPagoTienda({ ...INPUT, monto: "0.01" }, ACTOR_ADMIN);

    expect(r).toMatchObject({ status: "ok", restante: "99999.99" });
  });

  it("R31 [P1]: un monto por encima del saldo se RECHAZA e informa del disponible", async () => {
    const d = buildDobles({ creditos: "100000.00", debitos: "40000.00" }); // disponible 60 000

    const r = await d.service.registrarPagoTienda({ ...INPUT, monto: "60000.01" }, ACTOR_ADMIN);

    expect(r).toEqual({ status: "excede", disponible: "60000.00" });
    // …y no escribe NADA: ni documento ni movimiento.
    expect(d.pagoRepo.crear).not.toHaveBeenCalled();
    expect(d.tiendaRepo.crearMovimientos).not.toHaveBeenCalled();
  });

  it("R31: la frontera exacta (monto == disponible) SI se acepta", async () => {
    const d = buildDobles({ creditos: "60000.00", debitos: "0.00" });

    const r = await d.service.registrarPagoTienda({ ...INPUT, monto: "60000.00" }, ACTOR_ADMIN);

    expect(r).toMatchObject({ status: "ok", restante: "0.00" });
  });

  it("R32 [P1]: saldo cero -> `sin_saldo`, sin escribir nada", async () => {
    const d = buildDobles({ creditos: "40000.00", debitos: "40000.00" });

    const r = await d.service.registrarPagoTienda(INPUT, ACTOR_ADMIN);

    expect(r).toEqual({ status: "sin_saldo" });
    expect(d.pagoRepo.crear).not.toHaveBeenCalled();
    expect(d.tiendaRepo.crearMovimientos).not.toHaveBeenCalled();
  });

  it("R32: saldo EN CONTRA (negativo) tampoco permite pagar", async () => {
    const d = buildDobles({ creditos: "10000.00", debitos: "40000.00" }); // -30 000

    const r = await d.service.registrarPagoTienda(INPUT, ACTOR_ADMIN);

    expect(r).toEqual({ status: "sin_saldo" });
  });

  it("el disponible se DERIVA del ledger (creditos - debitos), no se lee de ningun saldo guardado", async () => {
    const d = buildDobles({ creditos: "123456.78", debitos: "23456.78" }); // 100 000,00

    const r = await d.service.registrarPagoTienda({ ...INPUT, monto: "100000.01" }, ACTOR_ADMIN);

    expect(r).toEqual({ status: "excede", disponible: "100000.00" });
  });
});

describe("R36/R37/R38 — el movimiento que nace del pago", () => {
  it("R36: debito con concepto `pago_tienda` por el monto registrado", async () => {
    const d = buildDobles({ creditos: "100000.00", debitos: "0.00" });

    await d.service.registrarPagoTienda(INPUT, ACTOR_ADMIN);

    expect(movimientoEscrito(d.tiendaRepo)).toMatchObject({
      tiendaId: "t1",
      tipo: "debito",
      categoria: "pago_tienda",
      monto: "15000.00",
    });
  });

  it("R38: `origenTipo`/`origenId` apuntan al documento recien creado", async () => {
    const d = buildDobles({ creditos: "100000.00", debitos: "0.00" });

    await d.service.registrarPagoTienda(INPUT, ACTOR_ADMIN);

    const mov = movimientoEscrito(d.tiendaRepo);
    expect(mov.origenTipo).toBe("pago_tienda");
    expect(mov.origenId).toBe("pago-1"); // el id que devolvio `crear`, no una constante
    expect(mov.registradoPor).toBe("u-admin");
  });

  it("R37: se fecha con la fecha REAL del pago (medianoche UTC), no con la de registro", async () => {
    const d = buildDobles({ creditos: "100000.00", debitos: "0.00" });

    await d.service.registrarPagoTienda(INPUT, ACTOR_ADMIN);

    const mov = movimientoEscrito(d.tiendaRepo);
    expect(mov.fechaMovimiento?.toISOString()).toBe("2026-07-30T00:00:00.000Z");
    // Y el documento guarda esa MISMA fecha real (R9).
    const arg = (d.pagoRepo.crear as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][1] as Record<string, unknown>;
    expect((arg.fechaPago as Date).toISOString()).toBe("2026-07-30T00:00:00.000Z");
  });

  it("la descripcion compone metodo y referencia, y NO lleva la nota ni ningun id", async () => {
    const d = buildDobles({ creditos: "100000.00", debitos: "0.00" });

    await d.service.registrarPagoTienda(INPUT, ACTOR_ADMIN);

    const mov = movimientoEscrito(d.tiendaRepo);
    expect(mov.descripcion).toBe("SINPE · 1234567");
    expect(mov.descripcion).not.toContain("Pago parcial de julio"); // la nota es texto libre
    expect(mov.descripcion).not.toContain("pago-1");
    expect(mov.descripcion).not.toContain("t1");
  });

  it("en efectivo sin referencia, la descripcion es solo el metodo", async () => {
    const d = buildDobles({ creditos: "100000.00", debitos: "0.00" });

    await d.service.registrarPagoTienda(
      { ...INPUT, metodo: "efectivo", referencia: undefined },
      ACTOR_ADMIN,
    );

    expect(movimientoEscrito(d.tiendaRepo).descripcion).toBe("Efectivo");
  });

  it("el monto del documento y el del movimiento son EL MISMO string de escala 2", async () => {
    const d = buildDobles({ creditos: "100000.00", debitos: "0.00" });

    // Entrada con un solo decimal: el borde la acepta (`\\d+(\\.\\d{1,2})?`).
    await d.service.registrarPagoTienda({ ...INPUT, monto: "15000.5" }, ACTOR_ADMIN);

    const arg = (d.pagoRepo.crear as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][1] as Record<string, unknown>;
    expect(arg.monto).toBe("15000.50");
    expect(movimientoEscrito(d.tiendaRepo).monto).toBe("15000.50");
  });
});

describe("R39/R40/R41 — atomicidad, y donde NO se escribe", () => {
  it("R39: documento y movimiento reciben EL MISMO `tx`, en una sola transaccion", async () => {
    const d = buildDobles({ creditos: "100000.00", debitos: "0.00" });

    await d.service.registrarPagoTienda(INPUT, ACTOR_ADMIN);

    expect(d.llamadasTx.n).toBe(1);
    expect(d.txsVistos).toHaveLength(3); // candado + documento + movimiento
    expect(new Set(d.txsVistos).size).toBe(1); // …y los tres son el MISMO objeto
    // ⚠️ Feature 173/T C.2: esta lista gana `"crear:caja"`. El egreso de la caja es la TERCERA
    // escritura de la MISMA transaccion (R19) y va DESPUES del ledger de la tienda; el log es lo
    // que lo mide. Antes de la 173 la lista terminaba en `"crear:movimiento", "tx:commit"`.
    expect(d.log).toEqual([
      "tx:abrir",
      "bloquear:tienda:t1",
      "leer:disponible",
      "crear:documento",
      "crear:movimiento",
      "crear:caja",
      "tx:commit",
    ]);
  });

  it("R39: si el movimiento falla, el fallo sale de la transaccion (no hay commit parcial)", async () => {
    const d = buildDobles({ creditos: "100000.00", debitos: "0.00" });
    (d.tiendaRepo.crearMovimientos as unknown as { mockRejectedValue: (e: Error) => void })
      .mockRejectedValue(new Error("ledger caido"));

    await expect(d.service.registrarPagoTienda(INPUT, ACTOR_ADMIN)).rejects.toThrow("ledger caido");

    // La transaccion NO llego a `commit`: quien la ejecuta revierte, y el documento se va con ella.
    expect(d.log).toEqual([
      "tx:abrir",
      "bloquear:tienda:t1",
      "leer:disponible",
      "crear:documento",
    ]);
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // ⚠️ ASERCION REESCRITA (feature 173 / T C.2). Antes decia:
  //
  //     it("R40 [P2]: la CAJA PRINCIPAL no recibe ni una llamada", …)
  //       for (const [metodo, espia] of Object.entries(d.tx.walletMovimiento))
  //         expect(espia).not.toHaveBeenCalled();
  //
  // Su premisa (172/design §4) era que emitir el egreso restaria de la caja «un dinero que nunca
  // entro en ella». Desde la Tanda B de la 173 ese dinero entra, asi que la aserción pasa de
  // CERO llamadas a EXACTAMENTE UNA, y con los cuatro campos fijados. No se borra: se reescribe.
  // ───────────────────────────────────────────────────────────────────────────────────────────
  it("R18/R20 [173]: la CAJA PRINCIPAL recibe EXACTAMENTE UNA escritura, y es el egreso del pago", async () => {
    const d = buildDobles({ creditos: "100000.00", debitos: "0.00" });

    await d.service.registrarPagoTienda(INPUT, ACTOR_ADMIN);

    // UNA llamada al puerto, y una sola sentencia en la caja.
    expect(d.caja.emitirEgresoDePago).toHaveBeenCalledTimes(1);
    expect(d.caja.emitirReversoDeAnulacion).not.toHaveBeenCalled();
    expect(d.tx.walletMovimiento.createMany).toHaveBeenCalledTimes(1);

    // R18: egreso de la categoria del pago a tienda (naturaleza TERCEROS: no toca la ganancia).
    // R20: fechado el dia REAL del pago, no el de registro.
    const fila = filaDeCaja(d.tx);
    expect(fila.tipo).toBe("egreso");
    expect(fila.categoria).toBe("egreso_pago_tienda");
    expect((fila.monto as { toFixed: (n: number) => string }).toFixed(2)).toBe("15000.00");
    expect(fila.origenTipo).toBe("pago_tienda");
    expect(fila.origenId).toBe("pago-1"); // el id que devolvio `crear`, no una constante
    expect(fila.registradoPor).toBe("u-admin");
    expect(fila.descripcion).toBe("SINPE · 1234567");
    expect((fila.fechaMovimiento as Date).toISOString()).toBe("2026-07-30T00:00:00.000Z");

    // R19: la escritura va en LA MISMA transaccion — el puerto recibe el mismo objeto `tx`.
    const llamada = (d.caja.emitirEgresoDePago as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0];
    expect(llamada[0]).toBe(d.tx);
  });

  it("R18: el monto de la caja es EL MISMO string del documento y del ledger (un solo redondeo)", async () => {
    const d = buildDobles({ creditos: "100000.00", debitos: "0.00" });

    await d.service.registrarPagoTienda({ ...INPUT, monto: "15000.5" }, ACTOR_ADMIN);

    // Si la caja re-redondeara por su cuenta, documento, ledger y caja podrian discrepar por un
    // centimo y ningun cuadre lo explicaria.
    expect(documentoEscrito(d.pagoRepo).monto).toBe("15000.50");
    expect(movimientoEscrito(d.tiendaRepo).monto).toBe("15000.50");
    expect((filaDeCaja(d.tx).monto as { toFixed: (n: number) => string }).toFixed(2)).toBe(
      "15000.50",
    );
  });

  it("R19: si la CAJA falla, la transaccion no llega a commit — no queda el pago", async () => {
    const d = buildDobles({ creditos: "100000.00", debitos: "0.00" });
    (
      d.tx.walletMovimiento.createMany as unknown as { mockRejectedValue: (e: Error) => void }
    ).mockRejectedValue(new Error("caja caida"));

    await expect(d.service.registrarPagoTienda(INPUT, ACTOR_ADMIN)).rejects.toThrow("caja caida");

    // El fallo SALE de la transaccion: quien la ejecuta revierte, y el documento y el debito del
    // ledger se van con ella. Un pago cobrado sin su salida de caja seria peor que no pagarlo.
    expect(d.log).toEqual([
      "tx:abrir",
      "bloquear:tienda:t1",
      "leer:disponible",
      "crear:documento",
      "crear:movimiento",
    ]);
    expect(d.log).not.toContain("tx:commit");
  });

  it("R23: el servicio no puede EXPRESAR ninguna otra escritura en la caja", async () => {
    // La contraprueba estructural de los tests de arriba. Antes de la 173 decia «no hay
    // repositorio inyectado»; ahora dice algo mas fino y mas util: hay un PUERTO de dos metodos,
    // el servicio no nombra el delegado de la caja ni ninguna categoria, y por tanto lo unico
    // que puede escribir alli es lo que el puerto sabe emitir.
    const codigo = fuenteDelServicioSinComentarios();
    expect(codigo).not.toMatch(/IWalletMovimientoRepository/);
    expect(codigo.match(/walletMovimiento/g)).toBeNull();
    expect(codigo).not.toMatch(/egreso_pago_tienda/);
    // Y las tres categorias que la 173 pone en juego tampoco: las fija el puerto, no el que llama.
    expect(codigo).not.toMatch(/egreso_pago_mensajero/);
    expect(codigo).not.toMatch(/ingreso_reverso_pago_tienda/);
    expect(codigo).not.toMatch(/ingreso_ajuste/);
    // El puerto entra como TIPO, nunca como implementacion concreta.
    expect(codigo).toMatch(/import type \{ ICajaPagoTiendaFeedService \}/);
    expect(codigo).not.toMatch(/CajaPagoTiendaFeedService\s*\(/);
  });

  it("R41: solo se AÑADEN filas — ningun update/delete sobre libros ni sobre el pago", async () => {
    const d = buildDobles({ creditos: "100000.00", debitos: "0.00" });

    await d.service.registrarPagoTienda(INPUT, ACTOR_ADMIN);

    for (const tabla of ["liquidacionPago", "walletTiendaMovimiento", "pagoMensajeroMovimiento"] as const) {
      for (const metodo of ["update", "updateMany", "delete", "deleteMany", "upsert"] as const) {
        expect(d.tx[tabla][metodo], `${tabla}.${metodo}`).not.toHaveBeenCalled();
      }
    }
  });

  it("R29 [173]: en la CAJA tampoco — la unica sentencia que se usa alli es `createMany`", async () => {
    const d = buildDobles({ creditos: "100000.00", debitos: "0.00" });

    await d.service.registrarPagoTienda(INPUT, ACTOR_ADMIN);

    // El libro de la caja es append-only igual que los otros dos: la 173 le añade una fila, no
    // le enseña a modificar ninguna.
    for (const metodo of ["create", "update", "updateMany", "delete", "deleteMany", "upsert"] as const) {
      expect(d.tx.walletMovimiento[metodo], `walletMovimiento.${metodo}`).not.toHaveBeenCalled();
    }
  });

  it("R31 [173]: el egreso de la caja NO añade ni una fila a los otros dos libros", async () => {
    const d = buildDobles({ creditos: "100000.00", debitos: "0.00" });

    await d.service.registrarPagoTienda(INPUT, ACTOR_ADMIN);

    // El ledger de la tienda sigue recibiendo UNA sola escritura (su debito de la 172) y el
    // libro del mensajero, ninguna. Si el egreso de la caja se hubiera colado por el ledger, el
    // saldo a favor de la tienda bajaria dos veces.
    expect(d.tiendaRepo.crearMovimientos).toHaveBeenCalledTimes(1);
    expect(d.mensajeroRepo.crearMovimientos).not.toHaveBeenCalled();
  });

  it("R42: ningun snapshot del cierre se escribe en el camino de la tienda", async () => {
    const d = buildDobles({ creditos: "100000.00", debitos: "0.00" });

    await d.service.registrarPagoTienda(INPUT, ACTOR_ADMIN);

    for (const espia of Object.values(d.tx.cierreDia)) {
      expect(espia).not.toHaveBeenCalled();
    }
  });
});

describe("R43/R47 — la respuesta idempotente cuando la clave ya se uso", () => {
  it("devuelve `ya_registrado` con el MISMO comprobante y sin crear el movimiento", async () => {
    const d = buildDobles({ creditos: "100000.00", debitos: "15000.00" });
    // `mockImplementation` y no `mockResolvedValue`: hace falta seguir alimentando el LOG, que
    // es lo que demuestra donde ocurre cada paso.
    (d.pagoRepo.crear as unknown as { mockImplementation: (f: () => unknown) => void })
      .mockImplementation(async () => {
        d.log.push("crear:documento");
        return { status: "clave_repetida" as const };
      });
    (d.pagoRepo.obtenerPorClave as unknown as { mockImplementation: (f: () => unknown) => void })
      .mockImplementation(async () => {
        d.log.push("obtener:por-clave");
        return pagoDTO();
      });

    const r = await d.service.registrarPagoTienda(INPUT, ACTOR_ADMIN);

    expect(r).toMatchObject({ status: "ya_registrado" });
    if (r.status !== "ya_registrado") return;
    expect(r.pago.id).toBe("pago-1");
    expect(r.pago.monto).toBe("15000.00");
    // El restante refleja el estado YA con el pago aplicado (85 000 = 100 000 - 15 000).
    expect(r.restante).toBe("85000.00");
    // Cero filas nuevas: no se escribio el movimiento.
    expect(d.tiendaRepo.crearMovimientos).not.toHaveBeenCalled();
    // Y la relectura ocurre FUERA de la transaccion (en Postgres, tras el error de la sentencia
    // la transaccion queda abortada y toda sentencia posterior falla).
    expect(d.log).toEqual(["tx:abrir", "bloquear:tienda:t1", "leer:disponible", "crear:documento", "obtener:por-clave", "leer:disponible"]);
  });

  it("R44: no hay consulta previa por clave — la barrera es la restriccion, no un `if`", async () => {
    const d = buildDobles({ creditos: "100000.00", debitos: "0.00" });

    await d.service.registrarPagoTienda(INPUT, ACTOR_ADMIN);

    // En el camino feliz `obtenerPorClave` NO se llama: no hay check-then-insert.
    expect(d.pagoRepo.obtenerPorClave).not.toHaveBeenCalled();
    expect(d.log.indexOf("obtener:por-clave")).toBe(-1);
  });

  it("choque de clave sin fila que lo explique -> `no_encontrado`, nunca un `ok` inventado", async () => {
    const d = buildDobles({ creditos: "100000.00", debitos: "0.00" });
    (d.pagoRepo.crear as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      status: "clave_repetida",
    });

    const r = await d.service.registrarPagoTienda(INPUT, ACTOR_ADMIN);

    expect(r).toEqual({ status: "no_encontrado" });
  });
});

describe("R56/R14 — lo que cruza la frontera", () => {
  it("el comprobante NO lleva ids internos del beneficiario ni la clave de idempotencia", async () => {
    const d = buildDobles({ creditos: "100000.00", debitos: "0.00" });

    const r = await d.service.registrarPagoTienda(INPUT, ACTOR_ADMIN);

    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(Object.keys(r.pago).sort()).toEqual(
      [
        "id",
        "monto",
        "metodo",
        "referencia",
        "nota",
        "fechaPago",
        "registradoPorNombre",
        "registradoAt",
        "anulacion",
        "esDeReparto", // feature 206: booleano, no el uuid del reparto (R56)
      ].sort(),
    );
    const serializado = JSON.stringify(r);
    expect(serializado).not.toContain(INPUT.claveIdempotencia);
    expect(serializado).not.toContain("u-admin");
    expect(serializado).not.toContain('"tiendaId"');
    expect(serializado).not.toContain('"cierreId"');
  });

  it("R14: todo monto de la respuesta es STRING de escala 2", async () => {
    const d = buildDobles({ creditos: "100000.00", debitos: "0.00" });
    const r = await d.service.registrarPagoTienda(INPUT, ACTOR_ADMIN);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(typeof r.pago.monto).toBe("string");
    expect(typeof r.restante).toBe("string");
    expect(r.pago.monto).toMatch(/^\d+\.\d{2}$/);
    expect(r.restante).toMatch(/^\d+\.\d{2}$/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// T B.5 — `registrarPagoMensajero`. Cubre R20, R21, R23, R24, R25, R35, R42 (+ R1/R5/R6 y
// R39/R40/R41 por el segundo camino, que es codigo distinto y merece su propia contraprueba).
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("R1/R6 — quien puede pagar a un mensajero (el segundo camino tiene su propio guard)", () => {
  const sinAcceso: [string, RolValue][] = [
    ["adminSatelite", RolValue.adminSatelite],
    ["adminTienda", RolValue.adminTienda],
    ["mensajero", RolValue.mensajero],
    ["apiKey", RolValue.apiKey],
  ];

  for (const [nombre, rol] of sinAcceso) {
    it(`R1: ${nombre} recibe forbidden y NO se abre ninguna transaccion`, async () => {
      const d = buildDobles({ creditos: "0.00", debitos: "0.00" });

      const r = await d.service.registrarPagoMensajero(INPUT_MENSAJERO, { usuarioId: "u", rol });

      expect(r).toEqual({ status: "forbidden" });
      expect(d.log).toEqual([]); // R5: ni el cierre se llega a leer
      expect(d.llamadasTx.n).toBe(0);
      expect(d.pagoRepo.obtenerCierreParaPago).not.toHaveBeenCalled();
    });
  }

  it("R6 (contraprueba): el `adminSatelite` APRUEBA cierres, pero pagarlos le responde forbidden", async () => {
    const d = buildDobles({ creditos: "0.00", debitos: "0.00" });
    const r = await d.service.registrarPagoMensajero(INPUT_MENSAJERO, {
      usuarioId: "u-sat",
      rol: RolValue.adminSatelite,
    });
    expect(r).toEqual({ status: "forbidden" });
    expect(d.llamadasTx.n).toBe(0);
  });

  it("maestro y admin si pueden (si no, la contraprueba de arriba no diria nada)", async () => {
    for (const actor of [ACTOR_ADMIN, ACTOR_MAESTRO]) {
      const d = buildDobles({ creditos: "0.00", debitos: "0.00" });
      const r = await d.service.registrarPagoMensajero(INPUT_MENSAJERO, actor);
      expect(r.status).toBe("ok");
    }
  });
});

describe("R20 — el cierre debe existir y estar APROBADO, leido dentro de la transaccion", () => {
  const noAprobados: [string, CierreEstado][] = [
    ["solicitado", CierreEstado.solicitado],
    ["vencido", CierreEstado.vencido],
    ["rechazado", CierreEstado.rechazado],
  ];

  for (const [nombre, estado] of noAprobados) {
    it(`un cierre ${nombre} -> cierre_no_aprobado, SIN escribir nada`, async () => {
      const d = buildDobles({ creditos: "0.00", debitos: "0.00", cierre: cierreDTO({ estado }) });

      const r = await d.service.registrarPagoMensajero(INPUT_MENSAJERO, ACTOR_ADMIN);

      expect(r).toEqual({ status: "cierre_no_aprobado" });
      expect(d.pagoRepo.crear).not.toHaveBeenCalled();
      expect(d.mensajeroRepo.crearMovimientos).not.toHaveBeenCalled();
      expect(d.tiendaRepo.crearMovimientos).not.toHaveBeenCalled();
      // Ni siquiera se llego a derivar el pendiente: el estado se comprueba antes.
      expect(d.pagoRepo.sumarVigentesPorCierre).not.toHaveBeenCalled();
    });
  }

  it("la guardia se lee DENTRO de la transaccion y DESPUES del candado (no antes, no fuera)", async () => {
    const d = buildDobles({ creditos: "0.00", debitos: "0.00" });

    await d.service.registrarPagoMensajero(INPUT_MENSAJERO, ACTOR_ADMIN);

    expect(d.log).toEqual([
      "tx:abrir",
      "bloquear:cierre:c1",
      "leer:cierre",
      "leer:pagado-vigente",
      // Feature 293 (T2.3, §6/4): lo pagable de un cierre pasa a incluir sus premios vivos, asi
      // que el tope de [P1] se lee con DOS agregaciones y no con una. Va DENTRO de la
      // transaccion y bajo el candado, como la de arriba.
      "leer:premios-vivos",
      "crear:documento",
      "crear:movimiento",
      "tx:commit",
    ]);
    // …y el `tx` con el que se leyo el cierre es EL MISMO del candado y de las escrituras.
    expect(d.txsVistos).toHaveLength(4); // candado + cierre + documento + movimiento
    expect(new Set(d.txsVistos).size).toBe(1);
  });

  it("un cierre que no existe -> `no_encontrado`, sin escribir nada", async () => {
    const d = buildDobles({ creditos: "0.00", debitos: "0.00", cierre: null });

    const r = await d.service.registrarPagoMensajero(INPUT_MENSAJERO, ACTOR_ADMIN);

    expect(r).toEqual({ status: "no_encontrado" });
    expect(d.pagoRepo.crear).not.toHaveBeenCalled();
    expect(d.mensajeroRepo.crearMovimientos).not.toHaveBeenCalled();
  });
});

describe("R21/R5 — el pago va atado al cierre, y el beneficiario sale del CIERRE", () => {
  it("R21: el documento se escribe con su `cierreId` y SIN tienda", async () => {
    const d = buildDobles({ creditos: "0.00", debitos: "0.00" });

    await d.service.registrarPagoMensajero(INPUT_MENSAJERO, ACTOR_ADMIN);

    const doc = documentoEscrito(d.pagoRepo);
    expect(doc.cierreId).toBe("c1");
    expect(doc.tiendaId).toBeNull(); // el CHECK XOR de la base lo exige (§2.3)
    expect(doc.registradoPor).toBe("u-admin");
  });

  it("R5: el `mensajeroId` sale del cierre LEIDO, no de la peticion", async () => {
    // El cierre `c1` pertenece a `m-real`; el input no dice —ni puede decir— a quien se paga.
    const d = buildDobles({
      creditos: "0.00",
      debitos: "0.00",
      cierre: cierreDTO({ mensajeroId: "m-real" }),
    });

    await d.service.registrarPagoMensajero(INPUT_MENSAJERO, ACTOR_ADMIN);

    expect(documentoEscrito(d.pagoRepo).mensajeroId).toBe("m-real");
    expect(movimientoDelMensajero(d.mensajeroRepo).mensajeroId).toBe("m-real");
  });

  it("el candado es el del CIERRE, no el del usuario (§4.2: ese es el grano de lo que se consume)", async () => {
    const d = buildDobles({ creditos: "0.00", debitos: "0.00" });

    await d.service.registrarPagoMensajero(INPUT_MENSAJERO, ACTOR_ADMIN);

    expect(d.pagoRepo.bloquearBeneficiario).toHaveBeenCalledTimes(1); // R85
    expect(d.log.filter((l) => l.startsWith("bloquear:"))).toEqual(["bloquear:cierre:c1"]);
  });
});

describe("R22/R23/R24/R25 — el pendiente del cierre manda [P1]", () => {
  it("R22: el pendiente se DERIVA de min(P, E) menos lo ya pagado VIGENTE", async () => {
    // P = 50 000, E = 0 -> genera 50 000; ya pagados 10 000 -> pendiente 40 000.
    const d = buildDobles({ creditos: "0.00", debitos: "0.00", pagadoVigente: "10000.00" });

    const r = await d.service.registrarPagoMensajero(
      { ...INPUT_MENSAJERO, monto: "40000.01" },
      ACTOR_ADMIN,
    );

    expect(r).toEqual({ status: "excede", disponible: "40000.00" });
    expect(d.pagoRepo.sumarVigentesPorCierre).toHaveBeenCalledWith(["c1"]);
  });

  it("R22: con E >= P el cierre no genera pendiente (el mensajero ya se pago del efectivo)", async () => {
    const d = buildDobles({
      creditos: "0.00",
      debitos: "0.00",
      cierre: cierreDTO({ totalPagoMensajero: "50000.00", totalEfectivo: "80000.00" }),
    });

    const r = await d.service.registrarPagoMensajero(INPUT_MENSAJERO, ACTOR_ADMIN);

    expect(r).toEqual({ status: "sin_saldo" });
    expect(d.pagoRepo.crear).not.toHaveBeenCalled();
  });

  // ── Feature 293 (T2.3, §6/4) — el PREMIO es pagable por este mismo camino ──────────────

  it("293/R24/R27: un cierre SALDADO con premio deja de responder `sin_saldo`", async () => {
    // Sin el premio, este cierre (E >= P) no genera nada pendiente y el pago se rechaza. Con
    // 5 000 de premio imputados, el mismo pago tiene que entrar: es literalmente la decision
    // humana —«el premio se cobra con el flujo de pago por cierre que ya existe»— y sin este
    // call-site pagarlo seria imposible.
    const saldado = buildDobles({
      creditos: "0.00",
      debitos: "0.00",
      cierre: cierreDTO({ totalPagoMensajero: "50000.00", totalEfectivo: "80000.00" }),
    });
    const conPremio = buildDobles({
      creditos: "0.00",
      debitos: "0.00",
      cierre: cierreDTO({ totalPagoMensajero: "50000.00", totalEfectivo: "80000.00" }),
      premiosVivos: "5000.00",
    });
    const pagoDelPremio = { ...INPUT_MENSAJERO, monto: "5000.00" };

    expect(await saldado.service.registrarPagoMensajero(pagoDelPremio, ACTOR_ADMIN)).toEqual({
      status: "sin_saldo",
    });
    expect(
      await conPremio.service.registrarPagoMensajero(pagoDelPremio, ACTOR_ADMIN),
    ).toMatchObject({ status: "ok", restante: "0.00" });
    expect(conPremio.pagoRepo.crear).toHaveBeenCalledTimes(1);
  });

  it("293/R25: el premio NO se acota con el efectivo del dia (el tope lo incluye entero)", async () => {
    // E = 80 000 cubre de sobra la P de 50 000, asi que el cierre no debe nada POR SI MISMO; el
    // disponible tiene que ser EXACTAMENTE el premio, ni un centimo mas.
    const d = buildDobles({
      creditos: "0.00",
      debitos: "0.00",
      cierre: cierreDTO({ totalPagoMensajero: "50000.00", totalEfectivo: "80000.00" }),
      premiosVivos: "5000.00",
    });

    const r = await d.service.registrarPagoMensajero(
      { ...INPUT_MENSAJERO, monto: "5000.01" },
      ACTOR_ADMIN,
    );

    expect(r).toEqual({ status: "excede", disponible: "5000.00" });
  });

  it("R22: con E entre 0 y P, el pendiente es P - E (la regla min(P,E) de la 44, no una copia)", async () => {
    const d = buildDobles({
      creditos: "0.00",
      debitos: "0.00",
      cierre: cierreDTO({ totalPagoMensajero: "50000.00", totalEfectivo: "20000.00" }),
    });

    const r = await d.service.registrarPagoMensajero(
      { ...INPUT_MENSAJERO, monto: "30000.01" },
      ACTOR_ADMIN,
    );

    expect(r).toEqual({ status: "excede", disponible: "30000.00" });
  });

  it("R23/R24: un pago PARCIAL entra y el resto SIGUE pendiente, al centimo", async () => {
    const d = buildDobles({ creditos: "0.00", debitos: "0.00", pagadoVigente: "10000.00" });

    const r = await d.service.registrarPagoMensajero(
      { ...INPUT_MENSAJERO, monto: "15000.00" },
      ACTOR_ADMIN,
    );

    // 50 000 generados - 10 000 ya pagados - 15 000 de ahora = 25 000 pendientes.
    expect(r).toMatchObject({ status: "ok", restante: "25000.00" });
  });

  it("R24: la resta es exacta al centimo (lo que un float redondearia mal)", async () => {
    const d = buildDobles({
      creditos: "0.00",
      debitos: "0.00",
      cierre: cierreDTO({ totalPagoMensajero: "1000.00", totalEfectivo: "0.00" }),
      pagadoVigente: "999.98",
    });

    const r = await d.service.registrarPagoMensajero(
      { ...INPUT_MENSAJERO, monto: "0.01" },
      ACTOR_ADMIN,
    );

    expect(r).toMatchObject({ status: "ok", restante: "0.01" });
  });

  it("R25 [P1]: un monto por encima del pendiente se RECHAZA sin escribir, e informa", async () => {
    const d = buildDobles({ creditos: "0.00", debitos: "0.00" });

    const r = await d.service.registrarPagoMensajero(
      { ...INPUT_MENSAJERO, monto: "50000.01" },
      ACTOR_ADMIN,
    );

    expect(r).toEqual({ status: "excede", disponible: "50000.00" });
    expect(d.pagoRepo.crear).not.toHaveBeenCalled();
    expect(d.mensajeroRepo.crearMovimientos).not.toHaveBeenCalled();
  });

  it("R25: la frontera exacta (monto == pendiente) SI entra y deja el cierre en cero", async () => {
    const d = buildDobles({ creditos: "0.00", debitos: "0.00" });

    const r = await d.service.registrarPagoMensajero(
      { ...INPUT_MENSAJERO, monto: "50000.00" },
      ACTOR_ADMIN,
    );

    expect(r).toMatchObject({ status: "ok", restante: "0.00" });
  });

  it("R27: un cierre ya liquidado del todo no admite mas pagos", async () => {
    const d = buildDobles({ creditos: "0.00", debitos: "0.00", pagadoVigente: "50000.00" });

    const r = await d.service.registrarPagoMensajero(INPUT_MENSAJERO, ACTOR_ADMIN);

    expect(r).toEqual({ status: "sin_saldo" });
    expect(d.pagoRepo.crear).not.toHaveBeenCalled();
  });
});

describe("R35/R37/R38 — el movimiento que nace del pago al mensajero", () => {
  it("R35: `pago`/`liquidacion` por el monto registrado, en el libro del MENSAJERO", async () => {
    const d = buildDobles({ creditos: "0.00", debitos: "0.00" });

    await d.service.registrarPagoMensajero(INPUT_MENSAJERO, ACTOR_ADMIN);

    expect(movimientoDelMensajero(d.mensajeroRepo)).toMatchObject({
      mensajeroId: "m1",
      tipo: "pago",
      categoria: "liquidacion",
      monto: "15000.00",
    });
    // …y NI UNA fila en el ledger de la tienda: cada pago escribe en UN libro.
    expect(d.tiendaRepo.crearMovimientos).not.toHaveBeenCalled();
  });

  it("R38: `origenTipo: pago_mensajero` y `origenId` = el documento recien creado", async () => {
    const d = buildDobles({ creditos: "0.00", debitos: "0.00" });

    await d.service.registrarPagoMensajero(INPUT_MENSAJERO, ACTOR_ADMIN);

    const mov = movimientoDelMensajero(d.mensajeroRepo);
    expect(mov.origenTipo).toBe("pago_mensajero");
    expect(mov.origenId).toBe("pago-1"); // el id que devolvio `crear`, no una constante
    expect(mov.registradoPor).toBe("u-admin");
  });

  it("R37: se fecha con la fecha REAL del pago (medianoche UTC), no con la de registro", async () => {
    const d = buildDobles({ creditos: "0.00", debitos: "0.00" });

    await d.service.registrarPagoMensajero(INPUT_MENSAJERO, ACTOR_ADMIN);

    expect(movimientoDelMensajero(d.mensajeroRepo).fechaMovimiento?.toISOString()).toBe(
      "2026-07-30T00:00:00.000Z",
    );
    expect((documentoEscrito(d.pagoRepo).fechaPago as Date).toISOString()).toBe(
      "2026-07-30T00:00:00.000Z",
    );
  });

  it("la descripcion compone metodo y referencia, y NO lleva la nota ni ningun id", async () => {
    const d = buildDobles({ creditos: "0.00", debitos: "0.00" });

    await d.service.registrarPagoMensajero(INPUT_MENSAJERO, ACTOR_ADMIN);

    const mov = movimientoDelMensajero(d.mensajeroRepo);
    expect(mov.descripcion).toBe("SINPE · 1234567");
    expect(mov.descripcion).not.toContain("Pago parcial de julio");
    expect(mov.descripcion).not.toContain("c1");
  });
});

describe("R39/R40/R41/R42 — atomicidad, y donde NO se escribe (camino del mensajero)", () => {
  it("R39: si el movimiento falla, el fallo sale de la transaccion (no hay commit parcial)", async () => {
    const d = buildDobles({ creditos: "0.00", debitos: "0.00" });
    (d.mensajeroRepo.crearMovimientos as unknown as { mockRejectedValue: (e: Error) => void })
      .mockRejectedValue(new Error("libro caido"));

    await expect(d.service.registrarPagoMensajero(INPUT_MENSAJERO, ACTOR_ADMIN)).rejects.toThrow(
      "libro caido",
    );

    expect(d.log).toEqual([
      "tx:abrir",
      "bloquear:cierre:c1",
      "leer:cierre",
      "leer:pagado-vigente",
      "leer:premios-vivos", // 293/T2.3
      "crear:documento",
    ]);
  });

  // ⚠️ Feature 173: esta asercion NO se toca. [P2] = (a) — la caja carga
  // `egreso_pago_mensajero = P` al APROBAR el cierre, asi que pagarle al mensajero no puede
  // volver a restar. Si un dia se pone roja, es que se rompio P2, no que haga falta ajustarla.
  it("R40 [P2]: la CAJA PRINCIPAL no recibe ni una llamada al liquidar a un mensajero", async () => {
    const d = buildDobles({ creditos: "0.00", debitos: "0.00" });

    await d.service.registrarPagoMensajero(INPUT_MENSAJERO, ACTOR_ADMIN);

    for (const [metodo, espia] of Object.entries(d.tx.walletMovimiento)) {
      expect(espia, `walletMovimiento.${metodo} fue llamado`).not.toHaveBeenCalled();
    }
  });

  it("R22 [173/P2]: y el PUERTO de la caja tampoco recibe ninguna de sus dos llamadas", async () => {
    const d = buildDobles({ creditos: "0.00", debitos: "0.00" });

    await d.service.registrarPagoMensajero(INPUT_MENSAJERO, ACTOR_ADMIN);

    // Contraprueba nueva, no sustituta: la de arriba mide el DELEGADO de Prisma, esta mide el
    // unico camino por el que este servicio puede llegar a el. El puerto es REAL, asi que si se
    // le llamara escribiria de verdad y las dos aserciones caerian juntas.
    expect(d.caja.emitirEgresoDePago).not.toHaveBeenCalled();
    expect(d.caja.emitirReversoDeAnulacion).not.toHaveBeenCalled();
    // Y el libro del mensajero sigue recibiendo su unica escritura, con su monto integro.
    expect(d.mensajeroRepo.crearMovimientos).toHaveBeenCalledTimes(1);
    expect(movimientoDelMensajero(d.mensajeroRepo).monto).toBe("15000.00");
  });

  it("R41: solo se AÑADEN filas — ningun update/delete en el camino del mensajero", async () => {
    const d = buildDobles({ creditos: "0.00", debitos: "0.00" });

    await d.service.registrarPagoMensajero(INPUT_MENSAJERO, ACTOR_ADMIN);

    for (const tabla of ["liquidacionPago", "walletTiendaMovimiento", "pagoMensajeroMovimiento"] as const) {
      for (const metodo of ["update", "updateMany", "delete", "deleteMany", "upsert"] as const) {
        expect(d.tx[tabla][metodo], `${tabla}.${metodo}`).not.toHaveBeenCalled();
      }
    }
  });

  it("R42: NINGUN snapshot del cierre se toca — el cierre solo se LEE", async () => {
    const d = buildDobles({ creditos: "0.00", debitos: "0.00" });

    await d.service.registrarPagoMensajero(INPUT_MENSAJERO, ACTOR_ADMIN);

    // (a) sobre el doble de la transaccion: ninguna escritura sobre `cierre_dia`.
    for (const [metodo, espia] of Object.entries(d.tx.cierreDia)) {
      expect(espia, `cierreDia.${metodo} fue llamado`).not.toHaveBeenCalled();
    }
    // (b) sobre el doble del REPOSITORIO: lo unico que se le pidio del cierre fue leerlo.
    expect(d.pagoRepo.obtenerCierreParaPago).toHaveBeenCalledTimes(1);
  });

  it("R42: ni el repositorio tiene por donde escribir el cierre (contraprueba estructural)", async () => {
    // El unico modulo que puede tocar `cierre_dia` en esta feature es el repositorio: si el
    // servicio no lo hace pero el repositorio expusiera un `update`, R42 dependeria de que nadie
    // lo llame. Aqui se afirma que ese metodo NO EXISTE.
    const codigo = codigoSinComentarios("lib/repositories/LiquidacionPagoRepository.ts");
    for (const escritura of ["update", "updateMany", "create", "delete", "deleteMany", "upsert"]) {
      expect(codigo, `cierreDia.${escritura}`).not.toMatch(
        new RegExp(`cierreDia\\.${escritura}\\b`),
      );
    }
    // El servicio ni siquiera nombra el delegado: pasa por el repositorio.
    expect(fuenteDelServicioSinComentarios().match(/cierreDia/g)).toBeNull();
  });
});

describe("R43/R47 — la rama idempotente del camino del mensajero", () => {
  it("devuelve `ya_registrado` con el restante recalculado sobre el CIERRE", async () => {
    const d = buildDobles({ creditos: "0.00", debitos: "0.00", pagadoVigente: "15000.00" });
    (d.pagoRepo.crear as unknown as { mockImplementation: (f: () => unknown) => void })
      .mockImplementation(async () => {
        d.log.push("crear:documento");
        return { status: "clave_repetida" as const };
      });
    (d.pagoRepo.obtenerPorClave as unknown as { mockImplementation: (f: () => unknown) => void })
      .mockImplementation(async () => {
        d.log.push("obtener:por-clave");
        return pagoDTO({ tiendaId: null, cierreId: "c1", mensajeroId: "m1" });
      });

    const r = await d.service.registrarPagoMensajero(INPUT_MENSAJERO, ACTOR_ADMIN);

    expect(r).toMatchObject({ status: "ya_registrado" });
    if (r.status !== "ya_registrado") return;
    expect(r.pago.id).toBe("pago-1");
    // El pendiente ya refleja el pago (50 000 - 15 000), y se recalcula FUERA de la transaccion.
    expect(r.restante).toBe("35000.00");
    expect(d.mensajeroRepo.crearMovimientos).not.toHaveBeenCalled();
    expect(d.log).toEqual([
      "tx:abrir",
      "bloquear:cierre:c1",
      "leer:cierre",
      "leer:pagado-vigente",
      "leer:premios-vivos", // 293/T2.3
      "crear:documento",
      "obtener:por-clave",
      "leer:cierre:fuera-de-tx",
      "leer:pagado-vigente",
      "leer:premios-vivos", // 293/T2.3: tambien en la relectura idempotente, misma formula
    ]);
  });

  it("R44: en el camino feliz no hay consulta previa por clave", async () => {
    const d = buildDobles({ creditos: "0.00", debitos: "0.00" });

    await d.service.registrarPagoMensajero(INPUT_MENSAJERO, ACTOR_ADMIN);

    expect(d.pagoRepo.obtenerPorClave).not.toHaveBeenCalled();
  });
});

// ── T C.1 — las listas de comprobantes (R49, R50, R56, R74) ─────────────────────────────────

/**
 * Ids INTERNOS con forma de uuid. Se usan a proposito en lugar de `"m1"`/`"t1"`: el criterio
 * duro de T C.1 es que el DTO no contenga NINGUN uuid salvo el `id` del pago, y con ids cortos
 * el barrido no podria distinguir un identificador de un texto cualquiera.
 */
const UUID_MENSAJERO = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const UUID_TIENDA = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const UUID_CIERRE = "cccccccc-3333-4333-8333-cccccccccccc";
const UUID_PAGO = "dddddddd-4444-4444-8444-dddddddddddd";

/** Un comprobante VIGENTE, con todos sus ids internos poblados. */
function pagoDeCierre(over: Partial<LiquidacionPagoDTO> = {}): LiquidacionPagoDTO {
  return pagoDTO({
    id: UUID_PAGO,
    mensajeroId: UUID_MENSAJERO,
    tiendaId: null,
    cierreId: UUID_CIERRE,
    ...over,
  });
}

/** El mismo comprobante, ANULADO: sigue entero y ademas trae quien, cuando y por que (R74). */
function pagoAnulado(): LiquidacionPagoDTO {
  return pagoDeCierre({
    id: "eeeeeeee-5555-4555-8555-eeeeeeeeeeee",
    anulacion: {
      motivo: "Monto equivocado",
      anuladoPorNombre: "Beto Maestro",
      anuladoAt: "2026-08-02T16:00:00.000Z",
    },
  });
}

describe("R49/R50 — las listas de comprobantes", () => {
  it("R49: los comprobantes de un CIERRE salen con sus siete datos y el nombre de quien registro", async () => {
    const d = buildDobles({ creditos: "0.00", debitos: "0.00", pagos: [pagoDeCierre()] });

    const r = await d.service.listarPagosDeCierre(UUID_CIERRE, ACTOR_ADMIN);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.pagos).toHaveLength(1);
    expect(r.pagos[0]).toEqual({
      id: UUID_PAGO,
      monto: "15000.00",
      metodo: "SINPE",
      referencia: "1234567",
      nota: "Pago parcial de julio",
      fechaPago: "2026-07-30", // la fecha REAL del pago…
      registradoPorNombre: "Ana Admin", // …el NOMBRE, no el id (R56)…
      esDeReparto: false, // feature 206: pago SUELTO
      registradoAt: "2026-08-02T15:04:05.000Z", // …y el instante de registro (R9)
      anulacion: null,
    });
    expect(d.pagoRepo.listarPorCierre).toHaveBeenCalledWith(UUID_CIERRE);
  });

  it("R50: los de una TIENDA salen por el otro listado, sin cierre de por medio", async () => {
    const pago = pagoDTO({ id: UUID_PAGO, tiendaId: UUID_TIENDA, cierreId: null });
    const d = buildDobles({ creditos: "0.00", debitos: "0.00", pagos: [pago] });

    const r = await d.service.listarPagosDeTienda(UUID_TIENDA, ACTOR_MAESTRO);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(d.pagoRepo.listarPorTienda).toHaveBeenCalledWith(UUID_TIENDA);
    expect(d.pagoRepo.listarPorCierre).not.toHaveBeenCalled();
    expect(r.pagos[0]!.id).toBe(UUID_PAGO);
  });

  it("un beneficiario sin pagos devuelve la lista VACIA (no `no_encontrado`: no revela nada)", async () => {
    const d = buildDobles({ creditos: "0.00", debitos: "0.00", pagos: [] });

    expect(await d.service.listarPagosDeCierre(UUID_CIERRE, ACTOR_ADMIN)).toEqual({
      status: "ok",
      pagos: [],
    });
    expect(await d.service.listarPagosDeTienda(UUID_TIENDA, ACTOR_ADMIN)).toEqual({
      status: "ok",
      pagos: [],
    });
  });

  it("el orden que fija el repositorio se conserva: el servicio no reordena", async () => {
    const primero = pagoDeCierre({ id: UUID_PAGO });
    const segundo = pagoDeCierre({ id: "ffffffff-6666-4666-8666-ffffffffffff" });
    const d = buildDobles({ creditos: "0.00", debitos: "0.00", pagos: [primero, segundo] });

    const r = await d.service.listarPagosDeCierre(UUID_CIERRE, ACTOR_ADMIN);

    if (r.status !== "ok") return;
    expect(r.pagos.map((p) => p.id)).toEqual([primero.id, segundo.id]);
  });

  it("es SOLO lectura: no abre transaccion, no toca candados y no escribe nada", async () => {
    const d = buildDobles({ creditos: "0.00", debitos: "0.00", pagos: [pagoDeCierre()] });

    await d.service.listarPagosDeCierre(UUID_CIERRE, ACTOR_ADMIN);

    expect(d.llamadasTx.n).toBe(0);
    expect(d.pagoRepo.bloquearBeneficiario).not.toHaveBeenCalled();
    expect(d.pagoRepo.crear).not.toHaveBeenCalled();
    expect(d.log).toEqual(["listar:por-cierre"]);
  });
});

describe("R74 — un pago ANULADO se sigue listando, entero y marcado", () => {
  it("viene con todos sus datos originales MAS el bloque de anulacion", async () => {
    const d = buildDobles({ creditos: "0.00", debitos: "0.00", pagos: [pagoAnulado()] });

    const r = await d.service.listarPagosDeCierre(UUID_CIERRE, ACTOR_ADMIN);

    if (r.status !== "ok") return;
    const pago = r.pagos[0]!;
    // Los datos del pago NO cambian al anularlo (el documento es inmutable, R41/R78).
    expect(pago.monto).toBe("15000.00");
    expect(pago.referencia).toBe("1234567");
    expect(pago.fechaPago).toBe("2026-07-30");
    expect(pago.registradoPorNombre).toBe("Ana Admin");
    // Y encima, quien anulo, cuando y por que — con el NOMBRE del anulador, no su id (R56/R73).
    expect(pago.anulacion).toEqual({
      motivo: "Monto equivocado",
      anuladoPorNombre: "Beto Maestro",
      anuladoAt: "2026-08-02T16:00:00.000Z",
    });
  });

  it("el servicio NO filtra los anulados: vigentes y anulados salen juntos", async () => {
    const d = buildDobles({
      creditos: "0.00",
      debitos: "0.00",
      pagos: [pagoDeCierre(), pagoAnulado()],
    });

    const r = await d.service.listarPagosDeCierre(UUID_CIERRE, ACTOR_ADMIN);

    if (r.status !== "ok") return;
    // Quien SI excluye los anulados es la SUMA del pendiente (R80); la lista, no (R74).
    expect(r.pagos).toHaveLength(2);
    expect(r.pagos.filter((p) => p.anulacion !== null)).toHaveLength(1);
  });
});

describe("R56 — el comprobante que cruza no lleva ni un identificador interno", () => {
  it("emite EXACTAMENTE nueve claves, y `id` es la unica que es un uuid", async () => {
    const d = buildDobles({
      creditos: "0.00",
      debitos: "0.00",
      pagos: [pagoDeCierre(), pagoAnulado()],
    });

    const r = await d.service.listarPagosDeCierre(UUID_CIERRE, ACTOR_ADMIN);

    if (r.status !== "ok") return;
    for (const pago of r.pagos) {
      expect(Object.keys(pago).sort()).toEqual([
        "anulacion",
        "esDeReparto", // feature 206: booleano, no el uuid del reparto (R56)
        "fechaPago",
        "id",
        "metodo",
        "monto",
        "nota",
        "referencia",
        "registradoAt",
        "registradoPorNombre",
      ]);
    }
  });

  it("CRITERIO DURO: en la respuesta serializada no hay ningun uuid salvo el `id` del pago", async () => {
    const d = buildDobles({
      creditos: "0.00",
      debitos: "0.00",
      pagos: [pagoDeCierre(), pagoAnulado()],
    });

    const r = await d.service.listarPagosDeCierre(UUID_CIERRE, ACTOR_ADMIN);

    if (r.status !== "ok") return;
    const serializado = JSON.stringify(r);
    // Ni el mensajero, ni la tienda, ni el cierre contra el que se pago.
    expect(serializado).not.toContain(UUID_MENSAJERO);
    expect(serializado).not.toContain(UUID_TIENDA);
    expect(serializado).not.toContain(UUID_CIERRE);
    // Y el barrido a la inversa: TODO uuid que aparezca es el id de uno de los pagos.
    const uuids =
      serializado.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? [];
    expect(uuids.sort()).toEqual(r.pagos.map((p) => p.id).sort());
  });
});

describe("R1/R2/R6 — ver los comprobantes es la misma superficie de dinero que pagarlos", () => {
  const sinAcceso: [string, RolValue][] = [
    ["adminSatelite", RolValue.adminSatelite],
    ["adminTienda", RolValue.adminTienda],
    ["mensajero", RolValue.mensajero],
    ["apiKey", RolValue.apiKey],
  ];

  for (const [nombre, rol] of sinAcceso) {
    it(`${nombre} recibe forbidden en los DOS listados, sin que salga una fila`, async () => {
      const d = buildDobles({ creditos: "0.00", debitos: "0.00", pagos: [pagoDeCierre()] });

      expect(await d.service.listarPagosDeCierre(UUID_CIERRE, { usuarioId: "u", rol })).toEqual({
        status: "forbidden",
      });
      expect(await d.service.listarPagosDeTienda(UUID_TIENDA, { usuarioId: "u", rol })).toEqual({
        status: "forbidden",
      });
      // El log VACIO es la asercion: el gate va ANTES de leer, no despues de filtrar.
      expect(d.log).toEqual([]);
      expect(d.pagoRepo.listarPorCierre).not.toHaveBeenCalled();
      expect(d.pagoRepo.listarPorTienda).not.toHaveBeenCalled();
    });
  }

  it("R2 (contraprueba): `adminTienda` pidiendo los comprobantes de SU tienda tambien es forbidden", async () => {
    const d = buildDobles({ creditos: "0.00", debitos: "0.00", pagos: [pagoDeCierre()] });

    const r = await d.service.listarPagosDeTienda(UUID_TIENDA, {
      usuarioId: UUID_TIENDA, // el actor ES la tienda
      rol: RolValue.adminTienda,
    });

    // Lo suyo lo ve en `/mi-wallet`, que lee el LIBRO. Esta lista es la del que mueve el dinero.
    expect(r).toEqual({ status: "forbidden" });
    expect(d.log).toEqual([]);
  });

  it("maestro y admin si pueden (si no, las contrapruebas de arriba no dirian nada)", async () => {
    for (const actor of [ACTOR_ADMIN, ACTOR_MAESTRO]) {
      const d = buildDobles({ creditos: "0.00", debitos: "0.00", pagos: [pagoDeCierre()] });
      expect((await d.service.listarPagosDeCierre(UUID_CIERRE, actor)).status).toBe("ok");
      expect((await d.service.listarPagosDeTienda(UUID_TIENDA, actor)).status).toBe("ok");
    }
  });
});

describe("money-safe: el modulo no convierte dinero a numero", () => {
  it("`LiquidacionService.ts` no usa `Number(` ni `parseFloat` sobre montos", () => {
    const codigo = fuenteDelServicioSinComentarios();
    expect(codigo.match(/parseFloat/g)).toBeNull();
    expect(codigo.match(/\bNumber\(/g)).toBeNull();
    expect(codigo.match(/parseInt/g)).toBeNull();
  });

  it("R14: todo monto de la respuesta del pago al mensajero es STRING de escala 2", async () => {
    const d = buildDobles({ creditos: "0.00", debitos: "0.00" });
    const r = await d.service.registrarPagoMensajero(INPUT_MENSAJERO, ACTOR_ADMIN);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.pago.monto).toMatch(/^\d+\.\d{2}$/);
    expect(r.restante).toMatch(/^\d+\.\d{2}$/);
  });
});
