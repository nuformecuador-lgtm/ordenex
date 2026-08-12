import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import { CierreEstado, RolValue, type PrismaClient } from "@prisma/client";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { CajaPagoTiendaFeedService } from "@/lib/services/CajaPagoTiendaFeedService";
import { LiquidacionService } from "@/lib/services/LiquidacionService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  BeneficiarioBloqueo,
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
import type { AnularPagoInput } from "@/lib/types/liquidacion";

// Feature 172 / T F.2 — `LiquidacionService.anularPago`. Cubre R69, R70, R71, R76, R77, R81,
// R82, R84 (+ R85 en el conteo de candados, R39/R41 en la atomicidad y R40 en la caja).
//
// El criterio que manda en este archivo es R70: **el monto del contraasiento NO se acepta del
// input**. Se mide COLANDO un monto distinto en la peticion y comprobando que se ignora; si el
// cliente pudiera dictar el importe del reverso, anular seria una via para escribir cualquier
// cifra en un libro de dinero. Ese test es el que la mutacion 1 de la bitacora apaga.
//
// ⚠️ **Feature 173 / T C.3 — CAMBIO DELIBERADO DE UNA ASERCION QUE ESTABA VERDE.** «Anular un
// pago a una TIENDA no toca la caja» pasa a «la caja recibe EXACTAMENTE UN ingreso
// `ingreso_reverso_pago_tienda`, por el mismo monto, con el mismo origen y fechado el DIA DE LA
// ANULACION». Su premisa —«si al pagar no se emitio egreso, al anular no hay nada que
// revertir»— dejo de ser cierta con T C.2. «Anular un pago a un MENSAJERO tampoco» **no se
// toca** ([P2] = (a)) y gana una contraprueba nueva sobre el puerto.
//
// Money-safe: ni un `Number(` ni un `parseFloat` sobre un monto en todo el archivo.

const ACTOR_ADMIN: Actor = { usuarioId: "u-admin", rol: RolValue.admin };
const ACTOR_MAESTRO: Actor = { usuarioId: "u-maestro", rol: RolValue.maestro };

// Ids INTERNOS con forma de uuid: el barrido de R56 no podria distinguir un identificador de un
// texto cualquiera si fueran `"t1"`/`"c1"`.
const UUID_PAGO = "dddddddd-4444-4444-8444-dddddddddddd";
const UUID_TIENDA = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const UUID_MENSAJERO = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const UUID_CIERRE = "cccccccc-3333-4333-8333-cccccccccccc";

const MOTIVO = "Monto mal tecleado";
const NOMBRE_ANULADOR = "Mario Maestro";
const INSTANTE_ANULACION = "2026-08-05T14:30:00.000Z";

/**
 * EL RELOJ de la anulacion, fijado. Son las 14:30 de Costa Rica del 5 de agosto (20:30Z), asi
 * que el dia CALENDARIO de la anulacion es el 2026-08-05 — y el pago que se anula es del
 * 2026-07-30, seis dias antes. R77 se mide con esa distancia.
 */
const AHORA = new Date("2026-08-05T20:30:00.000Z");
const DIA_DE_LA_ANULACION = "2026-08-05T00:00:00.000Z";
const DIA_DEL_PAGO = "2026-07-30";

/** El pago a una TIENDA que se va a anular, vigente y con todos sus datos. */
function pagoATienda(over: Partial<LiquidacionPagoDTO> = {}): LiquidacionPagoDTO {
  return {
    id: UUID_PAGO,
    mensajeroId: null,
    tiendaId: UUID_TIENDA,
    cierreId: null,
    monto: "15000.00",
    metodo: "SINPE",
    referencia: "1234567",
    nota: "Pago parcial de julio",
    fechaPago: DIA_DEL_PAGO,
    registradoPorNombre: "Ana Admin",
    registradoAt: "2026-07-30T15:04:05.000Z",
    anulacion: null,
    ...over,
  };
}

/** El mismo pago, pero a un MENSAJERO contra su cierre (el otro libro, el otro candado). */
function pagoAMensajero(over: Partial<LiquidacionPagoDTO> = {}): LiquidacionPagoDTO {
  return pagoATienda({
    mensajeroId: UUID_MENSAJERO,
    tiendaId: null,
    cierreId: UUID_CIERRE,
    ...over,
  });
}

/** Cierre APROBADO con P = 50 000 y E = 0 -> genera 50 000 de pendiente. */
function cierreDTO(over: Partial<CierreParaPagoDTO> = {}): CierreParaPagoDTO {
  return {
    id: UUID_CIERRE,
    mensajeroId: UUID_MENSAJERO,
    estado: CierreEstado.aprobado,
    totalPagoMensajero: "50000.00",
    totalEfectivo: "0.00",
    ...over,
  };
}

/**
 * Doble de la TRANSACCION con la forma de un `tx` de Prisma. Igual que en
 * `liquidacion-service.test.ts`: expone los delegados de los dos libros, del documento, de la
 * ANULACION y el de la CAJA PRINCIPAL, todos espiados.
 *
 * **Feature 173 / T C.3:** `walletMovimiento.createMany` apunta en el LOG. En la rama del
 * MENSAJERO su ausencia del log sigue siendo la prueba de que la caja no se toca; en la de la
 * TIENDA su POSICION —dentro de la `tx` y despues del contraasiento del ledger— es la prueba de
 * que el reverso es atomico con la anulacion.
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
    liquidacionAnulacion: espia(),
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

/**
 * Los tres repositorios, dobles, compartiendo un LOG ORDENADO. El orden es lo que prueba R83/R84
 * (el candado antes de la lectura del disponible) y el conteo lo que prueba R85.
 *
 * `anular` NO es un mock que devuelve lo que se le dice: mantiene el conjunto de pagos ya
 * anulados y RECHAZA el segundo intento del mismo pago, igual que el `UNIQUE(pago_id)` de la
 * base. Es lo que hace observable R82 —«no hay camino para deshacer una anulacion»— en vez de
 * darlo por bueno, y lo que permite encadenar dos llamadas de verdad.
 */
function buildDobles(opciones: {
  pago?: LiquidacionPagoDTO | null;
  creditos?: string;
  debitos?: string;
  cierre?: CierreParaPagoDTO | null;
  pagadoVigente?: string;
  ahora?: Date;
}) {
  const log: string[] = [];
  const tx = buildTx(log);
  const txsVistos: unknown[] = [];
  const cierre = opciones.cierre === undefined ? cierreDTO() : opciones.cierre;
  const pago = opciones.pago === undefined ? pagoATienda() : opciones.pago;
  const anulaciones = new Map<
    string,
    { motivo: string; anuladoPorNombre: string; anuladoAt: string }
  >();
  /** Escrituras diferidas al commit: si la transaccion revienta, no se aplican (R39). */
  const aplicarAlCommit: Array<() => void> = [];

  const pagoRepo: ILiquidacionPagoRepository = {
    bloquearBeneficiario: vi.fn(async (t, objetivo: BeneficiarioBloqueo) => {
      txsVistos.push(t);
      log.push(
        objetivo.tipo === "tienda"
          ? `bloquear:tienda:${objetivo.tiendaId}`
          : `bloquear:cierre:${objetivo.cierreId}`,
      );
    }),
    crear: vi.fn(async (t) => {
      txsVistos.push(t);
      log.push("crear:documento");
      return { status: "creado" as const, pago: pago ?? pagoATienda() };
    }),
    anular: vi.fn(async (t, input) => {
      txsVistos.push(t);
      log.push("anular");
      // UNIQUE(pago_id): la barrera es DE DATOS, no un `if` del servicio.
      if (anulaciones.has(input.pagoId)) return { status: "ya_anulado" as const };
      const anulacion = {
        motivo: input.motivo,
        anuladoPorNombre: NOMBRE_ANULADOR, // R56: el NOMBRE, no `input.anuladoPor`
        anuladoAt: INSTANTE_ANULACION,
      };
      aplicarAlCommit.push(() => anulaciones.set(input.pagoId, anulacion));
      return { status: "anulado" as const, anulacion };
    }),
    obtenerCierreParaPago: vi.fn(async (_id, t) => {
      if (t !== undefined) txsVistos.push(t);
      log.push(t === undefined ? "leer:cierre:fuera-de-tx" : "leer:cierre");
      return cierre;
    }),
    obtenerPorClave: vi.fn(async () => {
      log.push("obtener:por-clave");
      return null;
    }),
    // R70: EL PAGO SE LEE SERVER-SIDE. Devuelve el documento con su bloque de anulacion si ya lo
    // tiene, que es lo que la relectura de `ya_anulado` necesita encontrar.
    obtenerPorId: vi.fn(async (id: string) => {
      log.push(`leer:pago:${id}`);
      if (pago === null || pago.id !== id) return null;
      return { ...pago, anulacion: anulaciones.get(id) ?? null };
    }),
    sumarVigentesPorCierre: vi.fn(async (ids: string[]) => {
      log.push("leer:pagado-vigente");
      return Object.fromEntries(ids.map((id) => [id, opciones.pagadoVigente ?? "0.00"]));
    }),
    sumarVigentesPorTienda: vi.fn(async () => "0.00"),
    listarPorCierre: vi.fn(async () => []),
    listarPorTienda: vi.fn(async () => []),
    // Feature 205 (T2.2): el contrato gana dos LECTURAS. Ningun test de este archivo las
    // usa —son del reparto—, pero el doble las expone para poder afirmar que los caminos de la
    // 172 NO las llaman.
    listarCierresImputables: vi.fn(async () => []),
    listarPorReparto: vi.fn(async () => []),
    // Feature 205 (T3.1): la tercera lectura del reparto (el CONTEO por estado de R36).
    contarCierresNoAprobadosPorEstado: vi.fn(async () => []),
  };

  /**
   * Feature 205 (T3.2): el repositorio del ACTO de repartir, doble mudo. Anular no reparte y no
   * lo toca; esta aqui porque el servicio lo exige por constructor (sin default, igual que el
   * puerto de la caja) y porque sus dos metodos escriben en el log: si la anulacion tocara un
   * reparto, las comparaciones del log lo dirian.
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
      log.push("crear:movimiento:tienda");
      return 1;
    }),
    agregarSaldoPorTienda: vi.fn(async () => {
      log.push("leer:disponible");
      return { creditos: opciones.creditos ?? "0.00", debitos: opciones.debitos ?? "0.00" };
    }),
    listarPorTienda: vi.fn(),
    listarSaldosTodasTiendas: vi.fn(),
    listarSaldosTiendasPaginado: vi.fn(),
    agregarDesglosePorTienda: vi.fn(),
  } as unknown as IWalletTiendaMovimientoRepository;

  const mensajeroRepo: IPagoMensajeroMovimientoRepository = {
    crearMovimientos: vi.fn(async (t) => {
      txsVistos.push(t);
      log.push("crear:movimiento:mensajero");
      return 1;
    }),
    listarPorMensajero: vi.fn(),
    agregarCuentaPorPagar: vi.fn(),
    listarCuentasPorPagarTodos: vi.fn(),
    listarCuentasPorPagarPaginado: vi.fn(),
    listarCuentasPorPagarCompleto: vi.fn(),
    obtenerNombreMensajero: vi.fn(),
  } as unknown as IPagoMensajeroMovimientoRepository;

  const llamadasTx = { n: 0 };
  const runTransaction: LiquidacionTxRunner = async (fn) => {
    llamadasTx.n += 1;
    log.push("tx:abrir");
    try {
      const r = await fn(tx as unknown as LiquidacionTx);
      for (const aplicar of aplicarAlCommit) aplicar(); // COMMIT
      log.push("tx:commit");
      return r;
    } finally {
      aplicarAlCommit.length = 0; // lo no aplicado se pierde: eso es el rollback
    }
  };

  /**
   * Feature 173 / T C.3 — el PUERTO de la caja, REAL y con sus dos metodos espiados. Real y no
   * doble: lo que hay que medir es que la fila del reverso lleva
   * `ingreso_reverso_pago_tienda`, y un doble mudo no diria nada de eso. El repositorio va sobre
   * un cliente vacio porque `crearMovimientos` escribe siempre en el `tx` que recibe.
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
    repartoRepo, // feature 205 (T3.2): va ANTES del reloj y sin default
    () => opciones.ahora ?? AHORA,
  );
  return { service, pagoRepo, tiendaRepo, mensajeroRepo, caja, llamadasTx, log, tx, txsVistos };
}

/** La fila que el servicio mando escribir en la CAJA PRINCIPAL (feature 173). */
function filaDeCaja(tx: ReturnType<typeof buildTx>): Record<string, unknown> {
  const mock = tx.walletMovimiento.createMany as unknown as { mock: { calls: unknown[][] } };
  const arg = mock.mock.calls[0][0] as { data: Record<string, unknown>[] };
  return arg.data[0];
}

/** La peticion de anular, que solo tiene DOS campos (R76: no hay por donde pedir una parte). */
function anular(over: Partial<AnularPagoInput> = {}): AnularPagoInput {
  return { pagoId: UUID_PAGO, motivo: MOTIVO, ...over };
}

/** El contraasiento que el servicio mando escribir en el ledger de la TIENDA. */
function contraasientoDeTienda(
  tiendaRepo: IWalletTiendaMovimientoRepository,
): CrearMovimientoTiendaInput {
  const mock = tiendaRepo.crearMovimientos as unknown as { mock: { calls: unknown[][] } };
  return (mock.mock.calls[0][1] as CrearMovimientoTiendaInput[])[0];
}

/** El contraasiento que el servicio mando escribir en el libro del MENSAJERO. */
function contraasientoDeMensajero(
  mensajeroRepo: IPagoMensajeroMovimientoRepository,
): CrearPagoMensajeroInput {
  const mock = mensajeroRepo.crearMovimientos as unknown as { mock: { calls: unknown[][] } };
  return (mock.mock.calls[0][1] as CrearPagoMensajeroInput[])[0];
}

/** El objetivo del candado que se tomo, tal y como llego al repositorio. */
function bloqueoTomado(pagoRepo: ILiquidacionPagoRepository): BeneficiarioBloqueo | undefined {
  const mock = pagoRepo.bloquearBeneficiario as unknown as { mock: { calls: unknown[][] } };
  return mock.mock.calls[0]?.[1] as BeneficiarioBloqueo | undefined;
}

/** Fuente del servicio SIN comentarios (los comentarios NOMBRAN lo que el codigo no hace). */
function fuenteDelServicioSinComentarios(): string {
  return fs
    .readFileSync(path.join(process.cwd(), "lib/services/LiquidacionService.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

/**
 * El CUERPO de `anularPago`, aislado y sin comentarios. Sirve para afirmar sobre el metodo lo
 * que ningun conteo de llamadas puede afirmar: QUE campos de la peticion se leen (R70/R76).
 */
function cuerpoDeAnularPago(): string {
  const fuente = fuenteDelServicioSinComentarios();
  const desde = fuente.indexOf("async anularPago(");
  const hasta = fuente.indexOf("async listarPagosDeCierre(");
  if (desde < 0 || hasta <= desde) {
    throw new Error("no se pudo aislar `anularPago` en la fuente del servicio");
  }
  return fuente.slice(desde, hasta);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// R81 — QUIEN puede anular, comprobado ANTES de leer nada
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("R81 [P3] — anular es la misma superficie de dinero que pagar", () => {
  const sinAcceso: [string, RolValue][] = [
    ["adminSatelite", RolValue.adminSatelite],
    ["adminTienda", RolValue.adminTienda],
    ["mensajero", RolValue.mensajero],
    ["apiKey", RolValue.apiKey],
  ];

  for (const [nombre, rol] of sinAcceso) {
    it(`${nombre} recibe forbidden y el pago NI SIQUIERA SE LEE`, async () => {
      const d = buildDobles({ creditos: "100000.00", debitos: "15000.00" });

      const r = await d.service.anularPago(anular(), { usuarioId: "u", rol });

      expect(r).toEqual({ status: "forbidden" });
      // El log VACIO es la asercion: el gate va antes de la lectura server-side del pago, no
      // despues. Si estuviera despues, el importe y el beneficiario ya habrian salido de la base.
      expect(d.log).toEqual([]);
      expect(d.pagoRepo.obtenerPorId).not.toHaveBeenCalled();
      expect(d.llamadasTx.n).toBe(0);
      expect(d.pagoRepo.bloquearBeneficiario).not.toHaveBeenCalled();
      expect(d.pagoRepo.anular).not.toHaveBeenCalled();
    });
  }

  it("R6 (contraprueba): el `adminSatelite` APRUEBA cierres, pero anular su pago es forbidden", async () => {
    const d = buildDobles({ creditos: "100000.00", debitos: "15000.00" });

    const r = await d.service.anularPago(anular(), {
      usuarioId: "u-sat",
      rol: RolValue.adminSatelite,
    });

    expect(r).toEqual({ status: "forbidden" });
    expect(d.log).toEqual([]);
  });

  it("R2 (contraprueba): el `adminTienda` de la tienda BENEFICIARIA tampoco puede anular", async () => {
    const d = buildDobles({ creditos: "100000.00", debitos: "15000.00" });

    // El actor ES la tienda a la que se le pago: ni aun asi.
    const r = await d.service.anularPago(anular(), {
      usuarioId: UUID_TIENDA,
      rol: RolValue.adminTienda,
    });

    expect(r).toEqual({ status: "forbidden" });
    expect(d.log).toEqual([]);
  });

  it("maestro y admin si pueden (si no, las contrapruebas de arriba no dirian nada)", async () => {
    for (const actor of [ACTOR_ADMIN, ACTOR_MAESTRO]) {
      const d = buildDobles({ creditos: "100000.00", debitos: "15000.00" });
      expect((await d.service.anularPago(anular(), actor)).status).toBe("ok");
    }
  });

  it("R73: quien anula sale de la SESION, no de la peticion", async () => {
    const d = buildDobles({ creditos: "100000.00", debitos: "15000.00" });

    await d.service.anularPago(anular(), ACTOR_MAESTRO);

    const mock = d.pagoRepo.anular as unknown as { mock: { calls: unknown[][] } };
    expect(mock.mock.calls[0][1]).toEqual({
      pagoId: UUID_PAGO,
      motivo: MOTIVO,
      anuladoPor: "u-maestro", // el actor, no un campo del input
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// R70 — EL MONTO NO SE ACEPTA DEL INPUT. El test que decide esta task.
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("R70 — el importe del contraasiento sale del PAGO leido server-side, jamas de la peticion", () => {
  /**
   * La peticion con un `monto` COLADO. El tipo `AnularPagoInput` no lo admite —esa es la primera
   * barrera, y la de zod en el borde es la segunda—, asi que se cuela con un `as`: aqui se mide
   * la tercera y la que de verdad manda, que es que el servicio no lo mira aunque llegue.
   */
  function conMontoColado(monto: string): AnularPagoInput {
    return { pagoId: UUID_PAGO, motivo: MOTIVO, monto } as AnularPagoInput;
  }

  it("CRITERIO DURO: un monto ENORME colado en la peticion se IGNORA (tienda)", async () => {
    const d = buildDobles({ creditos: "100000.00", debitos: "15000.00" });

    const r = await d.service.anularPago(conMontoColado("999999.99"), ACTOR_ADMIN);

    // El contraasiento vale lo que valia el PAGO (15 000), no lo que pedia la peticion.
    expect(contraasientoDeTienda(d.tiendaRepo).monto).toBe("15000.00");
    expect(r).toMatchObject({ status: "ok", restante: "100000.00" });
    // Y el numero colado no aparece en NINGUNA de las cosas que el servicio mando hacer ni en lo
    // que devolvio: ni en el libro, ni en la anulacion, ni en el restante.
    const todo = JSON.stringify({
      contraasiento: contraasientoDeTienda(d.tiendaRepo),
      anulacion: (d.pagoRepo.anular as unknown as { mock: { calls: unknown[][] } }).mock.calls,
      respuesta: r,
    });
    expect(todo).not.toContain("999999");
  });

  it("CRITERIO DURO: tambien un monto MINUSCULO colado se ignora (tienda)", async () => {
    // La otra direccion del mismo agujero: si el input mandara, anular «por 0,01» dejaria el
    // pago descontado casi entero y el libro cuadrando con una cifra que nadie autorizo.
    const d = buildDobles({ creditos: "100000.00", debitos: "15000.00" });

    const r = await d.service.anularPago(conMontoColado("0.01"), ACTOR_ADMIN);

    expect(contraasientoDeTienda(d.tiendaRepo).monto).toBe("15000.00");
    expect(r).toMatchObject({ status: "ok", restante: "100000.00" });
  });

  it("CRITERIO DURO: lo mismo en el libro del MENSAJERO (es codigo distinto)", async () => {
    const d = buildDobles({
      pago: pagoAMensajero({ monto: "20000.00" }),
      pagadoVigente: "20000.00",
    });

    const r = await d.service.anularPago(conMontoColado("999999.99"), ACTOR_ADMIN);

    expect(contraasientoDeMensajero(d.mensajeroRepo).monto).toBe("20000.00");
    expect(r).toMatchObject({ status: "ok", restante: "50000.00" });
    expect(JSON.stringify(contraasientoDeMensajero(d.mensajeroRepo))).not.toContain("999999");
  });

  it("el pago se lee POR SU ID y ANTES de abrir la transaccion (hace falta para saber que bloquear)", async () => {
    const d = buildDobles({ creditos: "100000.00", debitos: "15000.00" });

    await d.service.anularPago(anular(), ACTOR_ADMIN);

    expect(d.pagoRepo.obtenerPorId).toHaveBeenCalledWith(UUID_PAGO);
    expect(d.log[0]).toBe(`leer:pago:${UUID_PAGO}`);
    expect(d.log[1]).toBe("tx:abrir");
  });

  it("el BENEFICIARIO tambien sale del pago, no de la peticion (no hay campo por donde decirlo)", async () => {
    // El pago dice a quien se le pago; la peticion solo trae `pagoId` y `motivo`. Si el
    // beneficiario se pudiera dictar, se podria acreditar el reverso en el libro de otro.
    const d = buildDobles({
      pago: pagoAMensajero({ mensajeroId: "99999999-9999-4999-8999-999999999999" }),
      pagadoVigente: "15000.00",
    });

    await d.service.anularPago(anular(), ACTOR_ADMIN);

    expect(contraasientoDeMensajero(d.mensajeroRepo).mensajeroId).toBe(
      "99999999-9999-4999-8999-999999999999",
    );
    expect(d.tiendaRepo.crearMovimientos).not.toHaveBeenCalled();
  });

  it("ESTRUCTURAL: `anularPago` solo lee DOS campos de la peticion, y ninguno es un monto", async () => {
    // El conteo de llamadas mide UN camino; esto cierra el metodo entero, incluidas las ramas
    // que ningun test recorra. Es a la vez R70 (no hay monto) y R76 (no hay parte que pedir).
    const cuerpo = cuerpoDeAnularPago();
    const leidos = [...new Set([...cuerpo.matchAll(/input\.\w+/g)].map((m) => m[0]))].sort();

    expect(leidos).toEqual(["input.motivo", "input.pagoId"]);
    expect(cuerpo).not.toMatch(/input\.monto/);
    expect(cuerpo).not.toMatch(/Decimal\(input/);
    // El unico origen del importe es el pago leido server-side.
    expect(cuerpo).toMatch(/Decimal\(pago\.monto\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// R69 — ANULAR ES AÑADIR UN CONTRAASIENTO: mismo monto, signo opuesto, mismo documento
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("R69 — el contraasiento del MENSAJERO: `devengo`/`ajuste_devengo`", () => {
  it("mismo monto y signo OPUESTO al del pago, colgando del MISMO documento", async () => {
    const d = buildDobles({ pago: pagoAMensajero(), pagadoVigente: "15000.00" });

    const r = await d.service.anularPago(anular(), ACTOR_MAESTRO);

    expect(r.status).toBe("ok");
    expect(contraasientoDeMensajero(d.mensajeroRepo)).toMatchObject({
      mensajeroId: UUID_MENSAJERO,
      tipo: "devengo", // el pago fue `pago`: el reverso sube la cuenta por pagar
      categoria: "ajuste_devengo", // la unica que casa con `devengo` en el CHECK (§2.3)
      monto: "15000.00", // el MISMO monto del pago
      origenTipo: "pago_mensajero", // el del PAGO (R38)…
      origenId: UUID_PAGO, //          …y su id: es lo que da la idempotencia gratis
      registradoPor: "u-maestro",
    });
    // Un solo movimiento, y NI UNA fila en el otro libro.
    const mock = d.mensajeroRepo.crearMovimientos as unknown as { mock: { calls: unknown[][] } };
    expect((mock.mock.calls[0][1] as unknown[]).length).toBe(1);
    expect(d.tiendaRepo.crearMovimientos).not.toHaveBeenCalled();
  });

  it("la descripcion dice que es un reverso y NO lleva el motivo ni ningun id", async () => {
    const d = buildDobles({ pago: pagoAMensajero(), pagadoVigente: "15000.00" });

    await d.service.anularPago(anular({ motivo: "Se pago dos veces por error" }), ACTOR_ADMIN);

    const mov = contraasientoDeMensajero(d.mensajeroRepo);
    expect(mov.descripcion).toBe("Anulación de pago · SINPE · 1234567");
    // El motivo es texto libre del usuario: su sitio es `liquidacion_anulacion.motivo` (R74).
    expect(mov.descripcion).not.toContain("Se pago dos veces");
    expect(mov.descripcion).not.toContain(UUID_PAGO);
    expect(mov.descripcion).not.toContain(UUID_MENSAJERO);
  });
});

describe("R69 — el contraasiento de la TIENDA: `credito`/`ajuste_credito`", () => {
  it("mismo monto y signo OPUESTO al del pago, colgando del MISMO documento", async () => {
    const d = buildDobles({ creditos: "100000.00", debitos: "15000.00" });

    const r = await d.service.anularPago(anular(), ACTOR_ADMIN);

    expect(r.status).toBe("ok");
    expect(contraasientoDeTienda(d.tiendaRepo)).toMatchObject({
      tiendaId: UUID_TIENDA,
      tipo: "credito", // el pago fue `debito`: el reverso devuelve el saldo a favor
      categoria: "ajuste_credito", // la unica que casa con `credito` en el CHECK (§2.3)
      monto: "15000.00",
      origenTipo: "pago_tienda", // el del PAGO (R38)
      origenId: UUID_PAGO,
      registradoPor: "u-admin",
    });
    expect(d.mensajeroRepo.crearMovimientos).not.toHaveBeenCalled();
  });

  it("en efectivo sin referencia, la descripcion es solo el reverso del metodo", async () => {
    const d = buildDobles({
      pago: pagoATienda({ metodo: "efectivo", referencia: null }),
      creditos: "100000.00",
      debitos: "15000.00",
    });

    await d.service.anularPago(anular(), ACTOR_ADMIN);

    expect(contraasientoDeTienda(d.tiendaRepo).descripcion).toBe("Anulación de pago · Efectivo");
  });

  it("el monto viaja como STRING de escala 2, exacto al centimo (R14)", async () => {
    const d = buildDobles({
      pago: pagoATienda({ monto: "0.01" }),
      creditos: "100000.00",
      debitos: "0.01",
    });

    const r = await d.service.anularPago(anular(), ACTOR_ADMIN);

    const mov = contraasientoDeTienda(d.tiendaRepo);
    expect(typeof mov.monto).toBe("string");
    expect(mov.monto).toBe("0.01");
    expect(r).toMatchObject({ status: "ok", restante: "100000.00" });
  });
});

describe("R69/R41 — anular AÑADE: no borra ni edita nada", () => {
  it("no se crea ningun documento nuevo y no se toca la fila del pago", async () => {
    const d = buildDobles({ creditos: "100000.00", debitos: "15000.00" });

    await d.service.anularPago(anular(), ACTOR_ADMIN);

    // El documento no se vuelve a escribir…
    expect(d.pagoRepo.crear).not.toHaveBeenCalled();
    // …y sobre el `tx` no hay NI UNA escritura de las que borran o editan.
    for (const tabla of [
      "liquidacionPago",
      "liquidacionAnulacion",
      "walletTiendaMovimiento",
      "pagoMensajeroMovimiento",
    ] as const) {
      for (const metodo of ["update", "updateMany", "delete", "deleteMany", "upsert"] as const) {
        expect(d.tx[tabla][metodo], `${tabla}.${metodo}`).not.toHaveBeenCalled();
      }
    }
  });

  it("R74: el comprobante que vuelve sigue ENTERO y ahora ademas esta marcado", async () => {
    const d = buildDobles({ creditos: "100000.00", debitos: "15000.00" });

    const r = await d.service.anularPago(anular(), ACTOR_MAESTRO);

    if (r.status !== "ok") throw new Error("esperaba ok");
    // R78: la fecha real y la referencia del pago anulado NO se tocan.
    expect(r.pago).toMatchObject({
      id: UUID_PAGO,
      monto: "15000.00",
      metodo: "SINPE",
      referencia: "1234567",
      nota: "Pago parcial de julio",
      fechaPago: DIA_DEL_PAGO,
      registradoPorNombre: "Ana Admin",
    });
    expect(r.pago.anulacion).toEqual({
      motivo: MOTIVO,
      anuladoPorNombre: NOMBRE_ANULADOR, // R56: el NOMBRE de quien anulo
      anuladoAt: INSTANTE_ANULACION, // R73: el instante, que lo pone la base
    });
  });

  it("R56: el comprobante que cruza no lleva ni un identificador interno", async () => {
    const d = buildDobles({ creditos: "100000.00", debitos: "15000.00" });

    const r = await d.service.anularPago(anular(), ACTOR_MAESTRO);

    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(Object.keys(r.pago).sort()).toEqual([
      "anulacion",
      "fechaPago",
      "id",
      "metodo",
      "monto",
      "nota",
      "referencia",
      "registradoAt",
      "registradoPorNombre",
    ]);
    const serializado = JSON.stringify(r);
    expect(serializado).not.toContain(UUID_TIENDA);
    expect(serializado).not.toContain(UUID_MENSAJERO);
    expect(serializado).not.toContain(UUID_CIERRE);
    expect(serializado).not.toContain("u-maestro"); // el id del actor tampoco
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// R71 — el saldo vuelve al valor EXACTO que tenia antes del pago
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("R71 — el disponible vuelve al valor exacto previo al pago", () => {
  it("TIENDA: 100 000 a favor, pago de 15 000, anular -> vuelve a 100 000,00", async () => {
    // El ledger que lee la anulacion YA tiene el debito del pago (85 000 de saldo). El restante
    // no se estima: se deriva otra vez, con el contraasiento metido en los creditos.
    const d = buildDobles({ creditos: "100000.00", debitos: "15000.00" });

    const r = await d.service.anularPago(anular(), ACTOR_ADMIN);

    expect(r).toMatchObject({ status: "ok", restante: "100000.00" });
  });

  it("TIENDA: exacto al centimo, con cifras que un float redondearia mal", async () => {
    const d = buildDobles({
      pago: pagoATienda({ monto: "0.01" }),
      creditos: "123456.78",
      debitos: "23456.79", // incluye el centimo del pago
    });

    const r = await d.service.anularPago(anular(), ACTOR_ADMIN);

    expect(r).toMatchObject({ status: "ok", restante: "100000.00" });
  });

  it("TIENDA: un saldo que quedo EN CONTRA vuelve a su valor negativo previo", async () => {
    // 10 000 de creditos, 40 000 de debitos de los cuales 15 000 son el pago: saldo -30 000.
    // Al anular vuelve a -15 000, que es lo que habia antes de pagar. No se recorta a cero: el
    // saldo de una tienda puede ser negativo y mentir aqui escondería una deuda.
    const d = buildDobles({ creditos: "10000.00", debitos: "40000.00" });

    const r = await d.service.anularPago(anular(), ACTOR_ADMIN);

    expect(r).toMatchObject({ status: "ok", restante: "-15000.00" });
  });

  it("MENSAJERO: cierre de 50 000, pago de 15 000, anular -> el pendiente vuelve a 50 000,00", async () => {
    // `pagadoVigente` incluye el pago que se esta anulando (la anulacion aun no esta escrita
    // cuando se lee): el servicio lo descuenta y deriva el pendiente con la regla de la 44.
    const d = buildDobles({ pago: pagoAMensajero(), pagadoVigente: "15000.00" });

    const r = await d.service.anularPago(anular(), ACTOR_ADMIN);

    expect(r).toMatchObject({ status: "ok", restante: "50000.00" });
  });

  it("MENSAJERO: con OTRO pago vigente en medio, solo vuelve lo del pago anulado", async () => {
    // 50 000 generados, 35 000 pagados en total (20 000 de otro pago + los 15 000 que se anulan):
    // tras anular quedan 30 000 pendientes, no 50 000.
    const d = buildDobles({ pago: pagoAMensajero(), pagadoVigente: "35000.00" });

    const r = await d.service.anularPago(anular(), ACTOR_ADMIN);

    expect(r).toMatchObject({ status: "ok", restante: "30000.00" });
  });

  it("MENSAJERO: exacto al centimo (0,01 sobre un cierre de 1 000)", async () => {
    const d = buildDobles({
      pago: pagoAMensajero({ monto: "0.01" }),
      cierre: cierreDTO({ totalPagoMensajero: "1000.00", totalEfectivo: "0.00" }),
      pagadoVigente: "1000.00",
    });

    const r = await d.service.anularPago(anular(), ACTOR_ADMIN);

    expect(r).toMatchObject({ status: "ok", restante: "0.01" });
  });

  it("MENSAJERO: el pendiente devuelto NUNCA supera lo que el cierre genera", async () => {
    // Caso defensivo: si la suma de vigentes llegara ya sin el pago (0.00), la resta daria un
    // negativo. Se recorta a cero pagado, y el pendiente es el completo del cierre — jamas mas.
    const d = buildDobles({ pago: pagoAMensajero(), pagadoVigente: "0.00" });

    const r = await d.service.anularPago(anular(), ACTOR_ADMIN);

    expect(r).toMatchObject({ status: "ok", restante: "50000.00" });
  });

  it("el disponible se lee BAJO el candado y DESPUES de tomarlo (R83)", async () => {
    const d = buildDobles({ creditos: "100000.00", debitos: "15000.00" });

    await d.service.anularPago(anular(), ACTOR_ADMIN);

    // ⚠️ Feature 173/T C.3: esta lista gana `"crear:caja"`. El reverso de la caja va en la MISMA
    // transaccion que la anulacion y el contraasiento del ledger, y despues de los dos. Antes de
    // la 173 la lista terminaba en `"crear:movimiento:tienda", "tx:commit"`.
    expect(d.log).toEqual([
      `leer:pago:${UUID_PAGO}`,
      "tx:abrir",
      `bloquear:tienda:${UUID_TIENDA}`,
      "leer:disponible",
      "anular",
      "crear:movimiento:tienda",
      "crear:caja",
      "tx:commit",
    ]);
  });

  it("R14: todo monto de la respuesta es STRING de escala 2", async () => {
    const d = buildDobles({ creditos: "100000.00", debitos: "15000.00" });

    const r = await d.service.anularPago(anular(), ACTOR_ADMIN);

    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(typeof r.restante).toBe("string");
    expect(r.restante).toMatch(/^-?\d+\.\d{2}$/);
    expect(r.pago.monto).toMatch(/^\d+\.\d{2}$/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// R77 — el contraasiento se fecha el dia de la ANULACION, no el del pago
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("R77 — la fecha del contraasiento es la de HOY, no la del pago", () => {
  it("TIENDA: el pago es del 30 de julio y el reverso se fecha el 5 de agosto", async () => {
    const d = buildDobles({ creditos: "100000.00", debitos: "15000.00" });

    await d.service.anularPago(anular(), ACTOR_ADMIN);

    const mov = contraasientoDeTienda(d.tiendaRepo);
    expect(mov.fechaMovimiento?.toISOString()).toBe(DIA_DE_LA_ANULACION);
    // …y NO la del pago: fechar el reverso en el pasado reescribiria saldos ya mirados (§6.3).
    expect(mov.fechaMovimiento?.toISOString()).not.toBe("2026-07-30T00:00:00.000Z");
  });

  it("MENSAJERO: mismo criterio en el otro libro", async () => {
    const d = buildDobles({ pago: pagoAMensajero(), pagadoVigente: "15000.00" });

    await d.service.anularPago(anular(), ACTOR_ADMIN);

    const mov = contraasientoDeMensajero(d.mensajeroRepo);
    expect(mov.fechaMovimiento?.toISOString()).toBe(DIA_DE_LA_ANULACION);
    expect(mov.fechaMovimiento?.toISOString()).not.toBe("2026-07-30T00:00:00.000Z");
  });

  it("el dia es el CALENDARIO DE COSTA RICA, no el de UTC (las 23:00 de CR siguen siendo hoy)", async () => {
    // 2026-08-06T05:00:00Z son las 23:00 del 5 de agosto en CR (UTC-6). Con
    // `toISOString().slice(0,10)` el reverso se fecharia el DIA SIGUIENTE.
    const d = buildDobles({
      creditos: "100000.00",
      debitos: "15000.00",
      ahora: new Date("2026-08-06T05:00:00.000Z"),
    });

    await d.service.anularPago(anular(), ACTOR_ADMIN);

    expect(contraasientoDeTienda(d.tiendaRepo).fechaMovimiento?.toISOString()).toBe(
      "2026-08-05T00:00:00.000Z",
    );
  });

  it("se fecha a MEDIANOCHE UTC del dia, la convencion de las columnas `@db.Date` (§2.4)", async () => {
    // Con 06:00Z el movimiento quedaria FUERA de su propio dia al filtrar por `hasta`.
    const d = buildDobles({ creditos: "100000.00", debitos: "15000.00" });

    await d.service.anularPago(anular(), ACTOR_ADMIN);

    const iso = contraasientoDeTienda(d.tiendaRepo).fechaMovimiento?.toISOString() ?? "";
    expect(iso.endsWith("T00:00:00.000Z")).toBe(true);
  });

  it("R78: la fecha REAL del pago anulado no cambia (el documento es inmutable)", async () => {
    const d = buildDobles({ creditos: "100000.00", debitos: "15000.00" });

    const r = await d.service.anularPago(anular(), ACTOR_ADMIN);

    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.pago.fechaPago).toBe(DIA_DEL_PAGO);
    expect(r.pago.referencia).toBe("1234567");
  });

  it("el reloj es una DEPENDENCIA: dos anulaciones en dias distintos se fechan distinto", async () => {
    const primera = buildDobles({
      creditos: "100000.00",
      debitos: "15000.00",
      ahora: new Date("2026-08-05T20:30:00.000Z"),
    });
    const segunda = buildDobles({
      creditos: "100000.00",
      debitos: "15000.00",
      ahora: new Date("2026-09-01T20:30:00.000Z"),
    });

    await primera.service.anularPago(anular(), ACTOR_ADMIN);
    await segunda.service.anularPago(anular(), ACTOR_ADMIN);

    expect(contraasientoDeTienda(primera.tiendaRepo).fechaMovimiento?.toISOString()).toBe(
      "2026-08-05T00:00:00.000Z",
    );
    expect(contraasientoDeTienda(segunda.tiendaRepo).fechaMovimiento?.toISOString()).toBe(
      "2026-09-01T00:00:00.000Z",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// R84/R85 — EL MISMO bloqueo que tomaria su pago, y UNO SOLO
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("R84 — anular toma EL MISMO bloqueo que tomaria su pago", () => {
  it("CRITERIO DURO (mensajero): el objetivo es identico al que toma `registrarPagoMensajero`", async () => {
    // No se compara contra una constante escrita a mano: se EJECUTA el registro y se compara con
    // lo que aquel candado bloquea. Si la anulacion bloqueara otra cosa —o no bloqueara—, los
    // dos objetivos dejarian de coincidir.
    const alPagar = buildDobles({ pago: pagoAMensajero() });
    await alPagar.service.registrarPagoMensajero(
      {
        claveIdempotencia: "11111111-1111-4111-8111-111111111111",
        cierreId: UUID_CIERRE,
        monto: "15000.00",
        metodo: "SINPE",
        fechaPago: DIA_DEL_PAGO,
      },
      ACTOR_ADMIN,
    );

    const alAnular = buildDobles({ pago: pagoAMensajero(), pagadoVigente: "15000.00" });
    await alAnular.service.anularPago(anular(), ACTOR_ADMIN);

    expect(bloqueoTomado(alAnular.pagoRepo)).toEqual(bloqueoTomado(alPagar.pagoRepo));
    expect(bloqueoTomado(alAnular.pagoRepo)).toEqual({ tipo: "cierre", cierreId: UUID_CIERRE });
  });

  it("CRITERIO DURO (tienda): el objetivo es identico al que toma `registrarPagoTienda`", async () => {
    const alPagar = buildDobles({ creditos: "100000.00", debitos: "0.00" });
    await alPagar.service.registrarPagoTienda(
      {
        claveIdempotencia: "22222222-2222-4222-8222-222222222222",
        tiendaId: UUID_TIENDA,
        monto: "15000.00",
        metodo: "SINPE",
        fechaPago: DIA_DEL_PAGO,
      },
      ACTOR_ADMIN,
    );

    const alAnular = buildDobles({ creditos: "100000.00", debitos: "15000.00" });
    await alAnular.service.anularPago(anular(), ACTOR_ADMIN);

    expect(bloqueoTomado(alAnular.pagoRepo)).toEqual(bloqueoTomado(alPagar.pagoRepo));
    expect(bloqueoTomado(alAnular.pagoRepo)).toEqual({ tipo: "tienda", tiendaId: UUID_TIENDA });
  });

  it("el objetivo se deriva del PAGO leido: otro cierre en la fila, otro candado", async () => {
    const otroCierre = "eeeeeeee-5555-4555-8555-eeeeeeeeeeee";
    const d = buildDobles({
      pago: pagoAMensajero({ cierreId: otroCierre }),
      cierre: cierreDTO({ id: otroCierre }),
      pagadoVigente: "15000.00",
    });

    await d.service.anularPago(anular(), ACTOR_ADMIN);

    expect(bloqueoTomado(d.pagoRepo)).toEqual({ tipo: "cierre", cierreId: otroCierre });
    expect(d.log.filter((l) => l.startsWith("bloquear:"))).toEqual([`bloquear:cierre:${otroCierre}`]);
  });

  it("R85: UNA sola adquisicion por operacion (tienda)", async () => {
    const d = buildDobles({ creditos: "100000.00", debitos: "15000.00" });

    await d.service.anularPago(anular(), ACTOR_ADMIN);

    expect(d.pagoRepo.bloquearBeneficiario).toHaveBeenCalledTimes(1);
    expect(d.log.filter((l) => l.startsWith("bloquear:"))).toHaveLength(1);
  });

  it("R85: UNA sola adquisicion por operacion (mensajero)", async () => {
    const d = buildDobles({ pago: pagoAMensajero(), pagadoVigente: "15000.00" });

    await d.service.anularPago(anular(), ACTOR_ADMIN);

    expect(d.pagoRepo.bloquearBeneficiario).toHaveBeenCalledTimes(1);
    expect(d.log.filter((l) => l.startsWith("bloquear:"))).toHaveLength(1);
  });

  it("R85: tambien los caminos que NO escriben toman uno y solo uno", async () => {
    // El pago existe pero su cierre no aparece: se sale sin anular, y ni por eso se toma un
    // segundo candado.
    const d = buildDobles({ pago: pagoAMensajero(), cierre: null });

    const r = await d.service.anularPago(anular(), ACTOR_ADMIN);

    expect(r).toEqual({ status: "no_encontrado" });
    expect(d.pagoRepo.bloquearBeneficiario).toHaveBeenCalledTimes(1);
  });

  it("R84/R83: el candado va ANTES de leer el pendiente del cierre (mensajero)", async () => {
    const d = buildDobles({ pago: pagoAMensajero(), pagadoVigente: "15000.00" });

    await d.service.anularPago(anular(), ACTOR_ADMIN);

    expect(d.log).toEqual([
      `leer:pago:${UUID_PAGO}`,
      "tx:abrir",
      `bloquear:cierre:${UUID_CIERRE}`,
      "leer:cierre",
      "leer:pagado-vigente",
      "anular",
      "crear:movimiento:mensajero",
      "tx:commit",
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// R76 / R82 — ni a medias, ni deshacer
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("R76 — no existe entrada de monto parcial", () => {
  it("la peticion tiene EXACTAMENTE dos campos, y el repositorio recibe tres (ninguno es monto)", async () => {
    const d = buildDobles({ creditos: "100000.00", debitos: "15000.00" });

    await d.service.anularPago(anular(), ACTOR_ADMIN);

    const mock = d.pagoRepo.anular as unknown as { mock: { calls: unknown[][] } };
    const enviado = mock.mock.calls[0][1] as Record<string, unknown>;
    expect(Object.keys(enviado).sort()).toEqual(["anuladoPor", "motivo", "pagoId"]);
    expect(enviado).not.toHaveProperty("monto");
    // Y lo que llega al libro es el pago ENTERO: no hay proporcion ni resto que calcular.
    expect(contraasientoDeTienda(d.tiendaRepo).monto).toBe("15000.00");
  });

  it("un pago de monto raro se anula ENTERO, sin partirlo ni redondearlo a la baja", async () => {
    const d = buildDobles({
      pago: pagoATienda({ monto: "33333.33" }),
      creditos: "100000.00",
      debitos: "33333.33",
    });

    const r = await d.service.anularPago(anular(), ACTOR_ADMIN);

    expect(contraasientoDeTienda(d.tiendaRepo).monto).toBe("33333.33");
    expect(r).toMatchObject({ status: "ok", restante: "100000.00" });
  });
});

describe("R82/R75 — no hay camino para anular una anulacion", () => {
  it("el SEGUNDO intento sobre el mismo pago devuelve `ya_anulado` y NO escribe otro contraasiento", async () => {
    const d = buildDobles({ creditos: "100000.00", debitos: "15000.00" });

    const primera = await d.service.anularPago(anular(), ACTOR_MAESTRO);
    const segunda = await d.service.anularPago(
      anular({ motivo: "Otro motivo, otro dia" }),
      ACTOR_ADMIN,
    );

    expect(primera.status).toBe("ok");
    expect(segunda.status).toBe("ya_anulado");
    if (segunda.status !== "ya_anulado") return;
    // El comprobante vuelve con la anulacion de la PRIMERA vez: la segunda no reescribio nada.
    expect(segunda.pago.anulacion).toEqual({
      motivo: MOTIVO,
      anuladoPorNombre: NOMBRE_ANULADOR,
      anuladoAt: INSTANTE_ANULACION,
    });
    // UN solo contraasiento en el libro, no dos.
    expect(d.tiendaRepo.crearMovimientos).toHaveBeenCalledTimes(1);
    // …y `ya_anulado` NO trae restante: esa llamada no movio ni un centimo.
    expect(segunda).not.toHaveProperty("restante");
  });

  it("el segundo intento INTENTA insertar: la barrera es la restriccion, no un `if` previo", async () => {
    const d = buildDobles({ creditos: "100000.00", debitos: "15000.00" });

    await d.service.anularPago(anular(), ACTOR_MAESTRO);
    const marca = d.log.length;
    await d.service.anularPago(anular(), ACTOR_MAESTRO);

    const segundoIntento = d.log.slice(marca);
    // Se abre transaccion, se toma el candado, se INTENTA anular… y no hay commit: la
    // transaccion murio con el choque y la relectura ocurre FUERA.
    expect(segundoIntento).toEqual([
      `leer:pago:${UUID_PAGO}`,
      "tx:abrir",
      `bloquear:tienda:${UUID_TIENDA}`,
      "leer:disponible",
      "anular",
      `leer:pago:${UUID_PAGO}`,
    ]);
    expect(segundoIntento).not.toContain("tx:commit");
    expect(segundoIntento).not.toContain("crear:movimiento:tienda");
  });

  it("el servicio no expone NINGUN metodo que deshaga, borre o edite", async () => {
    const metodos = Object.getOwnPropertyNames(LiquidacionService.prototype)
      .filter((n) => n !== "constructor")
      .sort();

    // Lista CERRADA a proposito (incluidos los privados): anadir un `desanularPago` obliga a
    // tocar este test, que es justo el momento de mirar si tiene derecho a existir. No lo tiene.
    //
    // ⚠️ **Feature 205 (T3.1/T3.2) — la lista crece de 11 a 17, y cada nombre nuevo tiene su
    // porque.** Este test hizo exactamente su trabajo: se puso rojo al aparecer los metodos del
    // reparto y obligo a mirarlos uno a uno.
    //
    //  - `previsualizarRepartoMensajero` / `registrarRepartoMensajero`: los dos actos publicos.
    //  - `escribirPagoDeCierre`: el ESCRITOR UNICO (design §2.3), extraido del cuerpo que ya
    //    estaba dentro de `registrarPagoMensajero`. No es capacidad nueva: es la MISMA, en un
    //    solo sitio, para que el pago simple y cada imputacion no puedan divergir.
    //  - `imputablesDe` / `ventanaBajoBloqueo` / `responderRepartoYaRegistrado`: lecturas y
    //    composicion del reparto.
    //
    // Ninguno edita, borra ni deshace nada — lo sigue afirmando el barrido de abajo, y R52 lo
    // exige: deshacer un reparto es anular sus pagos uno a uno (design §10.5).
    expect(metodos).toEqual([
      "anularPago",
      "escribirContraasiento",
      "escribirPagoDeCierre",
      "imputablesDe",
      "listarPagosDeCierre",
      "listarPagosDeTienda",
      "pendienteDelCierre",
      "previsualizarRepartoMensajero",
      "registrarPagoMensajero",
      "registrarPagoTienda",
      "registrarRepartoMensajero",
      "responderRepartoYaRegistrado",
      "responderYaAnulado",
      "responderYaRegistrado",
      "restanteDe",
      "restanteTrasAnular",
      "ventanaBajoBloqueo",
    ]);
    for (const nombre of metodos) {
      expect(nombre, `metodo sospechoso: ${nombre}`).not.toMatch(
        /desanular|revertir|deshacer|borrar|eliminar|editar|actualizar/i,
      );
    }
  });

  it("ESTRUCTURAL: en el servicio no existe ninguna sentencia de borrado", async () => {
    const codigo = fuenteDelServicioSinComentarios();
    expect(codigo).not.toMatch(/\.delete\(/);
    expect(codigo).not.toMatch(/\.deleteMany\(/);
    expect(codigo).not.toMatch(/\.update\(/);
    expect(codigo).not.toMatch(/\.updateMany\(/);
  });

  it("un choque sin anulacion que lo explique -> `no_encontrado`, nunca un `ok` inventado", async () => {
    const d = buildDobles({ creditos: "100000.00", debitos: "15000.00" });
    (d.pagoRepo.anular as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      status: "ya_anulado",
    });

    const r = await d.service.anularPago(anular(), ACTOR_ADMIN);

    // El pago se relee y no trae bloque de anulacion: mejor un estado explicito que un
    // `ya_anulado` con el bloque vacio, que la pantalla pintaria como un pago vigente.
    expect(r).toEqual({ status: "no_encontrado" });
    expect(d.tiendaRepo.crearMovimientos).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// R40 / R39 — donde NO se escribe, y la atomicidad
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("R24-R27 [173] — la caja al anular: la TIENDA recupera su dinero, el MENSAJERO no se toca", () => {
  // ─────────────────────────────────────────────────────────────────────────────────────────
  // ⚠️ ASERCION REESCRITA (feature 173 / T C.3). Antes decia:
  //
  //     it("anular un pago a una TIENDA no toca la caja", …)
  //       for (const [metodo, espia] of Object.entries(d.tx.walletMovimiento))
  //         expect(espia).not.toHaveBeenCalled();
  //
  // Pasa de CERO llamadas a EXACTAMENTE UNA, con su categoria, su monto, su origen y su fecha.
  // ─────────────────────────────────────────────────────────────────────────────────────────
  it("R24/R25/R26: anular un pago a una TIENDA devuelve el dinero a la caja, EXACTAMENTE una vez", async () => {
    const d = buildDobles({ creditos: "100000.00", debitos: "15000.00" });

    await d.service.anularPago(anular(), ACTOR_ADMIN);

    expect(d.caja.emitirReversoDeAnulacion).toHaveBeenCalledTimes(1);
    expect(d.caja.emitirEgresoDePago).not.toHaveBeenCalled();
    expect(d.tx.walletMovimiento.createMany).toHaveBeenCalledTimes(1);

    const fila = filaDeCaja(d.tx);
    expect(fila.tipo).toBe("ingreso");
    // R26 — la categoria es la CLAVE de la feature: `ingreso_ajuste` es de naturaleza PROPIA y
    // haria que anular un pago SUBIERA la ganancia de Ordenex (design §10-C). Por eso el enum
    // gano DOS valores y no uno. `caja-cadena-pago-anulacion.test.ts` mide el efecto en ₡.
    expect(fila.categoria).toBe("ingreso_reverso_pago_tienda");
    expect(fila.categoria).not.toBe("ingreso_ajuste");
    expect((fila.monto as { toFixed: (n: number) => string }).toFixed(2)).toBe("15000.00");
    // Mismo origen que el egreso del pago: comparten `(origen_tipo, origen_id)` y solo cambia la
    // categoria, que es lo que deja convivir a los dos sin que ninguno pueda duplicarse.
    expect(fila.origenTipo).toBe("pago_tienda");
    expect(fila.origenId).toBe(UUID_PAGO);
    expect(fila.registradoPor).toBe("u-admin");
    expect(fila.descripcion).toBe("Anulación de pago · SINPE · 1234567");
    // R25 — el dia de la ANULACION (05/08), no el del pago (30/07): seis dias de distancia.
    expect((fila.fechaMovimiento as Date).toISOString()).toBe(DIA_DE_LA_ANULACION);
    expect((fila.fechaMovimiento as Date).toISOString()).not.toContain(DIA_DEL_PAGO);
  });

  it("R29: el reverso es una fila NUEVA — ni un update ni un delete en el libro de la caja", async () => {
    const d = buildDobles({ creditos: "100000.00", debitos: "15000.00" });

    await d.service.anularPago(anular(), ACTOR_ADMIN);

    for (const metodo of ["create", "update", "updateMany", "delete", "deleteMany", "upsert"] as const) {
      expect(d.tx.walletMovimiento[metodo], `walletMovimiento.${metodo}`).not.toHaveBeenCalled();
    }
  });

  it("R31 [173]: el reverso de la caja no añade nada a los otros dos libros", async () => {
    const d = buildDobles({ creditos: "100000.00", debitos: "15000.00" });

    await d.service.anularPago(anular(), ACTOR_ADMIN);

    // El ledger de la tienda recibe su unico `ajuste_credito` (el de la 172) y el libro del
    // mensajero, nada.
    expect(d.tiendaRepo.crearMovimientos).toHaveBeenCalledTimes(1);
    expect(contraasientoDeTienda(d.tiendaRepo).categoria).toBe("ajuste_credito");
    expect(d.mensajeroRepo.crearMovimientos).not.toHaveBeenCalled();
  });

  // ⚠️ Feature 173: esta asercion NO se toca. [P2] = (a).
  it("anular un pago a un MENSAJERO tampoco", async () => {
    const d = buildDobles({ pago: pagoAMensajero(), pagadoVigente: "15000.00" });

    await d.service.anularPago(anular(), ACTOR_ADMIN);

    for (const [metodo, espia] of Object.entries(d.tx.walletMovimiento)) {
      expect(espia, `walletMovimiento.${metodo} fue llamado`).not.toHaveBeenCalled();
    }
  });

  it("R27 [173/P2]: y el PUERTO de la caja tampoco recibe ninguna de sus dos llamadas", async () => {
    const d = buildDobles({ pago: pagoAMensajero(), pagadoVigente: "15000.00" });

    await d.service.anularPago(anular(), ACTOR_ADMIN);

    expect(d.caja.emitirEgresoDePago).not.toHaveBeenCalled();
    expect(d.caja.emitirReversoDeAnulacion).not.toHaveBeenCalled();
    expect(d.log).not.toContain("crear:caja");
  });

  it("R23: no hay por donde escribir en la caja mas que las dos filas del puerto", async () => {
    // Antes de la 173 esto decia «el servicio ni siquiera tiene ese repositorio inyectado».
    // Sigue sin tenerlo: lo que tiene es un puerto de dos metodos que no admite categoria.
    const codigo = fuenteDelServicioSinComentarios();
    expect(codigo).not.toMatch(/IWalletMovimientoRepository/);
    expect(codigo.match(/walletMovimiento/g)).toBeNull();
    expect(codigo).not.toMatch(/egreso_pago_tienda/);
    expect(codigo).not.toMatch(/ingreso_reverso_pago_tienda/);
    expect(codigo).not.toMatch(/ingreso_ajuste/);
    expect(codigo).not.toMatch(/reversarEgreso/);
  });

  it("R42: anular no toca el snapshot del cierre — solo lo LEE", async () => {
    const d = buildDobles({ pago: pagoAMensajero(), pagadoVigente: "15000.00" });

    await d.service.anularPago(anular(), ACTOR_ADMIN);

    for (const [metodo, espia] of Object.entries(d.tx.cierreDia)) {
      expect(espia, `cierreDia.${metodo} fue llamado`).not.toHaveBeenCalled();
    }
    expect(d.pagoRepo.obtenerCierreParaPago).toHaveBeenCalledTimes(1);
  });
});

describe("R39 — la anulacion y su contraasiento van en la MISMA transaccion", () => {
  it("las tres sentencias reciben EL MISMO `tx`, en una sola transaccion", async () => {
    const d = buildDobles({ creditos: "100000.00", debitos: "15000.00" });

    await d.service.anularPago(anular(), ACTOR_ADMIN);

    expect(d.llamadasTx.n).toBe(1);
    expect(d.txsVistos).toHaveLength(3); // candado + anulacion + contraasiento
    expect(new Set(d.txsVistos).size).toBe(1);
  });

  it("si el contraasiento falla, el fallo sale de la transaccion (no hay commit parcial)", async () => {
    const d = buildDobles({ creditos: "100000.00", debitos: "15000.00" });
    (
      d.tiendaRepo.crearMovimientos as unknown as { mockRejectedValue: (e: Error) => void }
    ).mockRejectedValue(new Error("ledger caido"));

    await expect(d.service.anularPago(anular(), ACTOR_ADMIN)).rejects.toThrow("ledger caido");

    // Ni commit, ni anulacion publicada: quien relea el pago lo sigue viendo VIGENTE, asi que la
    // correccion se puede reintentar. Si la anulacion hubiera quedado sin su contraasiento, el
    // pago estaria marcado y el libro seguiria descontandolo — el peor de los dos estados.
    expect(d.log).not.toContain("tx:commit");
    expect((await d.pagoRepo.obtenerPorId(UUID_PAGO))?.anulacion).toBeNull();
  });

  it("el contraasiento se escribe DESPUES de la anulacion, dentro de la misma transaccion", async () => {
    const d = buildDobles({ pago: pagoAMensajero(), pagadoVigente: "15000.00" });

    await d.service.anularPago(anular(), ACTOR_ADMIN);

    const iAnular = d.log.indexOf("anular");
    const iMov = d.log.indexOf("crear:movimiento:mensajero");
    const iCommit = d.log.indexOf("tx:commit");
    expect(iAnular).toBeGreaterThan(d.log.indexOf("tx:abrir"));
    expect(iMov).toBeGreaterThan(iAnular);
    expect(iCommit).toBeGreaterThan(iMov);
  });
});

describe("los caminos que no escriben nada", () => {
  it("un pago que no existe -> `no_encontrado`, sin abrir transaccion ni tomar candado", async () => {
    const d = buildDobles({ pago: null });

    const r = await d.service.anularPago(anular(), ACTOR_ADMIN);

    expect(r).toEqual({ status: "no_encontrado" });
    expect(d.llamadasTx.n).toBe(0);
    expect(d.pagoRepo.bloquearBeneficiario).not.toHaveBeenCalled();
    expect(d.pagoRepo.anular).not.toHaveBeenCalled();
  });

  it("un pago sin beneficiario (dato que la base ya impide) -> `no_encontrado`, sin inventar nada", async () => {
    const d = buildDobles({ pago: pagoATienda({ tiendaId: null, mensajeroId: null }) });

    const r = await d.service.anularPago(anular(), ACTOR_ADMIN);

    expect(r).toEqual({ status: "no_encontrado" });
    expect(d.llamadasTx.n).toBe(0);
  });

  it("un pago a un mensajero SIN cierre (idem) -> `no_encontrado`", async () => {
    const d = buildDobles({ pago: pagoAMensajero({ cierreId: null }) });

    const r = await d.service.anularPago(anular(), ACTOR_ADMIN);

    expect(r).toEqual({ status: "no_encontrado" });
    expect(d.llamadasTx.n).toBe(0);
  });

  it("si el cierre del pago no aparece, NO se anula: se sale sin escribir", async () => {
    const d = buildDobles({ pago: pagoAMensajero(), cierre: null });

    const r = await d.service.anularPago(anular(), ACTOR_ADMIN);

    expect(r).toEqual({ status: "no_encontrado" });
    expect(d.pagoRepo.anular).not.toHaveBeenCalled();
    expect(d.mensajeroRepo.crearMovimientos).not.toHaveBeenCalled();
  });

  it("un cierre en cualquier estado se puede anular: la guardia de R20 es del REGISTRO", async () => {
    // Anular corrige un pago que YA ocurrio. Que el cierre haya dejado de estar aprobado despues
    // no puede dejar ese pago sin reverso posible.
    for (const estado of [
      CierreEstado.solicitado,
      CierreEstado.rechazado,
      CierreEstado.vencido,
    ] as const) {
      const d = buildDobles({
        pago: pagoAMensajero(),
        cierre: cierreDTO({ estado }),
        pagadoVigente: "15000.00",
      });

      const r = await d.service.anularPago(anular(), ACTOR_ADMIN);

      expect(r.status, `estado ${estado}`).toBe("ok");
      expect(contraasientoDeMensajero(d.mensajeroRepo).monto).toBe("15000.00");
    }
  });
});

describe("money-safe: la anulacion no convierte dinero a numero", () => {
  it("el cuerpo de `anularPago` y sus ayudantes no usan `Number(` ni `parseFloat`", () => {
    const codigo = fuenteDelServicioSinComentarios();
    expect(codigo.match(/parseFloat/g)).toBeNull();
    expect(codigo.match(/\bNumber\(/g)).toBeNull();
    expect(codigo.match(/parseInt/g)).toBeNull();
  });

  it("el importe que sale hacia el libro es un STRING, nunca un number", async () => {
    const d = buildDobles({ creditos: "100000.00", debitos: "15000.00" });

    await d.service.anularPago(anular(), ACTOR_ADMIN);

    const mov = contraasientoDeTienda(d.tiendaRepo);
    expect(typeof mov.monto).toBe("string");
    expect(mov.monto).toMatch(/^\d+\.\d{2}$/);
  });
});
