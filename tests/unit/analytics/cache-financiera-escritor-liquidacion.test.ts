import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  CierreParaPagoDTO,
  ILiquidacionPagoRepository,
  LiquidacionPagoDTO,
} from "@/lib/interfaces/repositories/ILiquidacionPagoRepository";
import type { IPagoMensajeroMovimientoRepository } from "@/lib/interfaces/repositories/IPagoMensajeroMovimientoRepository";
import type { IWalletTiendaMovimientoRepository } from "@/lib/interfaces/repositories/IWalletTiendaMovimientoRepository";
import type { LiquidacionTx, LiquidacionTxRunner } from "@/lib/interfaces/services/ILiquidacionService";
import { CajaPagoTiendaFeedService } from "@/lib/services/CajaPagoTiendaFeedService";
import { LiquidacionService } from "@/lib/services/LiquidacionService";
import { libroFinanciero, type LibroFinanciero } from "./_libro-financiero";

// Feature 179 / T3.3 — R11: `LiquidacionService` invalida tras cada transaccion que confirma.
//
// Cubre las TRES operaciones de dinero del servicio, porque son tres llamadas distintas que
// alguien puede olvidar por separado: pago a MENSAJERO, pago a TIENDA y ANULACION.
//
// El pago a tienda usa el `CajaPagoTiendaFeedService` REAL sobre el mismo libro que lee el
// tablero, asi que su paso 5 mide el egreso de caja que la propia operacion emitio (R18/R19 de
// la 173). El pago a MENSAJERO no toca la caja por diseño ([P2] = (a) de la 173), asi que ahi la
// cifra que cambia es la del paso 2 — lo que se afirma sigue siendo el DATO SERVIDO y sigue
// muriendo si se borra la invalidacion, pero conviene que este dicho y no parezca otra cosa.
//
// MUTACION QUE LO MATA: borrar `invalidarTrasConfirmar` (o su llamada en cualquiera de las tres
// operaciones). Solo este archivo se pone rojo.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };

const TX = { walletMovimiento: {} } as unknown as LiquidacionTx;

function cierreDTO(): CierreParaPagoDTO {
  return {
    id: "c1",
    mensajeroId: "m1",
    estado: "aprobado",
    totalPagoMensajero: "50000.00",
    totalEfectivo: "0.00",
  } as CierreParaPagoDTO;
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
    nota: null,
    fechaPago: "2026-07-30",
    registradoPorNombre: "Ana Admin",
    registradoAt: "2026-08-02T15:04:05.000Z",
    anulacion: null,
    ...over,
  } as LiquidacionPagoDTO;
}

/**
 * El servicio real con dobles de sus tres repositorios y el PUERTO DE CAJA REAL, cableado al
 * mismo libro que lee el tablero. `runTransaction` corre el cuerpo y resuelve: es lo que hace
 * que «despues del commit» sea observable (ver `cache-financiera-invalidacion-orden.test.ts`).
 */
function armarLiquidacion(libro: LibroFinanciero, pago: LiquidacionPagoDTO = pagoDTO()) {
  const pagoRepo: ILiquidacionPagoRepository = {
    bloquearBeneficiario: vi.fn(async () => {}),
    crear: vi.fn(async () => ({ status: "creado" as const, pago })),
    anular: vi.fn(async () => ({
      status: "anulado" as const,
      anulacion: {
        motivo: "Monto mal tecleado",
        anuladoPorNombre: "Mario Maestro",
        anuladoAt: "2026-08-03T09:00:00.000Z",
      },
    })),
    obtenerCierreParaPago: vi.fn(async () => cierreDTO()),
    obtenerPorClave: vi.fn(async () => null),
    obtenerPorId: vi.fn(async () => pago),
    sumarVigentesPorCierre: vi.fn(async (ids: string[]) =>
      Object.fromEntries(ids.map((id) => [id, "0.00"])),
    ),
    sumarVigentesPorTienda: vi.fn(async () => "0.00"),
    listarPorCierre: vi.fn(async () => []),
    listarPorTienda: vi.fn(async () => []),
  } as unknown as ILiquidacionPagoRepository;

  const tiendaRepo = {
    crearMovimientos: vi.fn(async () => 1),
    agregarSaldoPorTienda: vi.fn(async () => ({ creditos: "90000.00", debitos: "0.00" })),
  } as unknown as IWalletTiendaMovimientoRepository;

  const mensajeroRepo = {
    crearMovimientos: vi.fn(async () => 1),
  } as unknown as IPagoMensajeroMovimientoRepository;

  const runner: LiquidacionTxRunner = async (fn) => fn(TX);

  const servicio = new LiquidacionService(
    pagoRepo,
    tiendaRepo,
    mensajeroRepo,
    runner,
    new CajaPagoTiendaFeedService(libro.cajaRepo), // el puerto REAL, sobre el libro compartido
    () => new Date("2026-08-03T12:00:00.000Z"),
    libro.cache,
  );
  return { servicio, pagoRepo, tiendaRepo, mensajeroRepo };
}

const INPUT_TIENDA = {
  claveIdempotencia: "11111111-1111-4111-8111-111111111111",
  tiendaId: "t1",
  monto: "15000.00",
  metodo: "SINPE" as const,
  referencia: "1234567",
  fechaPago: "2026-07-30",
};

const INPUT_MENSAJERO = {
  claveIdempotencia: "22222222-2222-4222-8222-222222222222",
  cierreId: "c1",
  monto: "15000.00",
  metodo: "SINPE" as const,
  referencia: "1234567",
  fechaPago: "2026-07-30",
};

describe("R11 · un pago a TIENDA invalida la cache financiera", () => {
  it("los cinco pasos, y el paso 5 mide el egreso de caja que el propio pago emitio", async () => {
    const libro = libroFinanciero();
    const { servicio } = armarLiquidacion(libro);

    // (1)
    libro.moverAlMargen("1000.00");
    expect(await libro.consultar()).toBe("1000.00");
    // (2) + (3)
    libro.moverAlMargen("200.00");
    expect(await libro.consultar()).toBe("1000.00");

    // (4) EL ESCRITOR REAL: pago de 15 000 -> `egreso_pago_tienda` de 15 000 en la caja
    const r = await servicio.registrarPagoTienda(INPUT_TIENDA, MAESTRO);
    expect(r.status).toBe("ok");

    // (5) 1000 + 200 + 15 000
    expect(
      await libro.consultar(),
      "la invalidacion de `LiquidacionService` NO llego tras el pago a tienda: el dinero salio " +
        "de la caja y el tablero financiero sigue sirviendo la cifra anterior.",
    ).toBe("16200.00");
  });
});

describe("R11 · un pago a MENSAJERO invalida la cache financiera", () => {
  it("los cinco pasos (el pago al mensajero no toca la caja: la cifra que cambia es la del paso 2)", async () => {
    const libro = libroFinanciero();
    const { servicio } = armarLiquidacion(libro);

    libro.moverAlMargen("1000.00");
    expect(await libro.consultar()).toBe("1000.00");
    libro.moverAlMargen("450.00");
    expect(await libro.consultar()).toBe("1000.00");

    const r = await servicio.registrarPagoMensajero(INPUT_MENSAJERO, MAESTRO);
    expect(r.status).toBe("ok");

    // Un solo test para las tres operaciones dejaria DOS de ellas sueltas: cada una es una
    // llamada distinta, en un `catch` distinto, que alguien puede olvidar por separado.
    expect(await libro.consultar()).toBe("1450.00");
  });
});

describe("R11 · una ANULACION invalida la cache financiera", () => {
  it("los cinco pasos, y el paso 5 mide el reverso que la anulacion devolvio a la caja", async () => {
    const libro = libroFinanciero();
    const { servicio } = armarLiquidacion(libro);

    // El pago original, por el camino real: deja el `egreso_pago_tienda` de 15 000.
    await servicio.registrarPagoTienda(INPUT_TIENDA, MAESTRO);

    // (1)
    expect(await libro.consultar()).toBe("15000.00");
    // (2) + (3)
    libro.moverAlMargen("60.00");
    expect(await libro.consultar()).toBe("15000.00");

    // (4) LA ANULACION REAL: devuelve 15 000 a la caja como `ingreso_reverso_pago_tienda`
    const r = await servicio.anularPago({ pagoId: "pago-1", motivo: "Monto mal tecleado" }, MAESTRO);
    expect(r.status).toBe("ok");

    // (5) el reverso entra en el BRUTO de `egresos`: 15 000 + 60 + 15 000
    expect(await libro.consultar()).toBe("30060.00");
  });
});

describe("R11/R24 · las tres operaciones registran el origen de la liquidacion", () => {
  it("y no un origen generico: el registro tiene que poder decir CUAL invalidador no llego", async () => {
    const libro = libroFinanciero();
    const { servicio } = armarLiquidacion(libro);

    await servicio.registrarPagoTienda(INPUT_TIENDA, MAESTRO);
    await servicio.registrarPagoMensajero(INPUT_MENSAJERO, MAESTRO);

    expect(libro.cache.invalidaciones.map((i) => i.origen)).toEqual([
      "ledger_liquidacion",
      "ledger_liquidacion",
    ]);
  });

  it("una rama que NO escribe no invalida: `forbidden` deja la cache intacta", async () => {
    const libro = libroFinanciero();
    const { servicio } = armarLiquidacion(libro);

    const r = await servicio.registrarPagoTienda(INPUT_TIENDA, {
      usuarioId: "u-tienda",
      rol: "adminTienda",
    });

    expect(r.status).toBe("forbidden");
    expect(libro.cache.invalidaciones).toHaveLength(0);
  });
});

describe("R11 · el composition root de produccion pasa el puerto de verdad", () => {
  it("`buildService` de `lib/actions/liquidacion.ts` construye con `crearAnaliticaCacheDeNext()`", () => {
    const fuente = fs.readFileSync(path.join(REPO_ROOT, "lib", "actions", "liquidacion.ts"), "utf8");
    expect(fuente).toMatch(/new LiquidacionService\([\s\S]*?crearAnaliticaCacheDeNext\(\)/);
  });
});
