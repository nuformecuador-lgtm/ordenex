import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import { RolValue } from "@prisma/client";
import { LiquidacionService } from "@/lib/services/LiquidacionService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  ILiquidacionPagoRepository,
  LiquidacionPagoDTO,
} from "@/lib/interfaces/repositories/ILiquidacionPagoRepository";
import type {
  CrearMovimientoTiendaInput,
  IWalletTiendaMovimientoRepository,
} from "@/lib/interfaces/repositories/IWalletTiendaMovimientoRepository";
import type {
  LiquidacionTx,
  LiquidacionTxRunner,
} from "@/lib/interfaces/services/ILiquidacionService";
import type { RegistrarPagoTiendaInput } from "@/lib/types/liquidacion";

// Feature 172 / T B.3 — `LiquidacionService.registrarPagoTienda` (mitad TIENDA).
// Cubre R1, R2, R5, R6, R29, R30, R31, R32, R36, R38, R39, R40, R41 (+ R37 en la fecha del
// movimiento y R43/R47 en la rama idempotente).
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
    anulacion: null,
    ...over,
  };
}

/**
 * Doble de la TRANSACCION con la forma de un `tx` de Prisma: expone los delegados de los dos
 * libros, del documento y —a proposito— el de la CAJA PRINCIPAL, con todos sus metodos
 * espiados. Asi, R40 y R41 no se comprueban leyendo el codigo: se comprueban contando llamadas
 * sobre las puertas que el servicio TENDRIA que abrir si escribiera donde no debe.
 */
function buildTx() {
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
    walletMovimiento: espia(), // [P2]/R40: la caja principal. No debe recibir NI UNA llamada.
    cierreDia: espia(), // R42: ningun snapshot del cierre se toca
    $queryRaw: vi.fn().mockResolvedValue([]),
  };
}

type Registro = string;

/**
 * Los dos repositorios, dobles, compartiendo un LOG ORDENADO de lo que se les pide. El orden es
 * lo que prueba R83 (el candado antes de la lectura) y el conteo lo que prueba R85.
 */
function buildDobles(opciones: { creditos: string; debitos: string }) {
  const log: Registro[] = [];
  const tx = buildTx();
  const txsVistos: unknown[] = [];

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
    obtenerPorClave: vi.fn(async () => {
      log.push("obtener:por-clave");
      return null;
    }),
    obtenerPorId: vi.fn(async () => null),
    sumarVigentesPorCierre: vi.fn(async () => ({})),
    sumarVigentesPorTienda: vi.fn(async () => "0.00"),
    listarPorCierre: vi.fn(async () => []),
    listarPorTienda: vi.fn(async () => []),
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

  const llamadasTx = { n: 0 };
  const runTransaction: LiquidacionTxRunner = async (fn) => {
    llamadasTx.n += 1;
    log.push("tx:abrir");
    const r = await fn(tx as unknown as LiquidacionTx);
    log.push("tx:commit");
    return r;
  };

  const service = new LiquidacionService(pagoRepo, tiendaRepo, runTransaction);
  return { service, pagoRepo, tiendaRepo, llamadasTx, log, tx, txsVistos };
}

/**
 * Fuente del servicio SIN comentarios. Importa: los barridos de abajo buscan cadenas que el
 * propio modulo NOMBRA en sus comentarios para explicar por que NO las usa (`egreso_pago_tienda`,
 * [P2]). Un barrido sobre el texto crudo confundiria la explicacion con el defecto.
 */
function fuenteDelServicioSinComentarios(): string {
  const fuente = fs.readFileSync(
    path.join(process.cwd(), "lib/services/LiquidacionService.ts"),
    "utf8",
  );
  return fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/** El movimiento que el servicio mando escribir en el ledger de la tienda. */
function movimientoEscrito(
  tiendaRepo: IWalletTiendaMovimientoRepository,
): CrearMovimientoTiendaInput {
  const mock = tiendaRepo.crearMovimientos as unknown as { mock: { calls: unknown[][] } };
  return (mock.mock.calls[0][1] as CrearMovimientoTiendaInput[])[0];
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
    expect(d.log).toEqual([
      "tx:abrir",
      "bloquear:tienda:t1",
      "leer:disponible",
      "crear:documento",
      "crear:movimiento",
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

  it("R40 [P2]: la CAJA PRINCIPAL no recibe ni una llamada", async () => {
    const d = buildDobles({ creditos: "100000.00", debitos: "0.00" });

    await d.service.registrarPagoTienda(INPUT, ACTOR_ADMIN);

    for (const [metodo, espia] of Object.entries(d.tx.walletMovimiento)) {
      expect(espia, `walletMovimiento.${metodo} fue llamado`).not.toHaveBeenCalled();
    }
  });

  it("R40: el servicio ni siquiera tiene por donde escribir en la caja", async () => {
    // La contraprueba estructural del test de arriba: no hay repositorio de la caja inyectado,
    // asi que no existe camino para emitir un egreso de caja aunque alguien lo intentara.
    const codigo = fuenteDelServicioSinComentarios();
    expect(codigo).not.toMatch(/IWalletMovimientoRepository/);
    expect(codigo.match(/walletMovimiento/g)).toBeNull();
    expect(codigo).not.toMatch(/egreso_pago_tienda/);
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

describe("money-safe: el modulo no convierte dinero a numero", () => {
  it("`LiquidacionService.ts` no usa `Number(` ni `parseFloat` sobre montos", () => {
    const codigo = fuenteDelServicioSinComentarios();
    expect(codigo.match(/parseFloat/g)).toBeNull();
    expect(codigo.match(/\bNumber\(/g)).toBeNull();
    expect(codigo.match(/parseInt/g)).toBeNull();
  });
});
