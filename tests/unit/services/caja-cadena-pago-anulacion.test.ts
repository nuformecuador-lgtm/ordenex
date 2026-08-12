import { describe, it, expect, vi } from "vitest";
import { Prisma, RolValue, type PrismaClient } from "@prisma/client";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  AnularLiquidacionPagoInput,
  ILiquidacionPagoRepository,
  LiquidacionPagoDTO,
} from "@/lib/interfaces/repositories/ILiquidacionPagoRepository";
import type { ILiquidacionRepartoRepository } from "@/lib/interfaces/repositories/ILiquidacionRepartoRepository";
import type {
  CrearMovimientoTiendaInput,
  IWalletTiendaMovimientoRepository,
} from "@/lib/interfaces/repositories/IWalletTiendaMovimientoRepository";
import type { IPagoMensajeroMovimientoRepository } from "@/lib/interfaces/repositories/IPagoMensajeroMovimientoRepository";
import type { CajaPagoTiendaTxClient } from "@/lib/interfaces/services/ICajaPagoTiendaFeedService";
import type {
  LiquidacionTx,
  LiquidacionTxRunner,
} from "@/lib/interfaces/services/ILiquidacionService";
import type { AnulacionDTO, RegistrarPagoTiendaInput } from "@/lib/types/liquidacion";
import type {
  AgregadoCajaRow,
  CajaResumenDTO,
  WalletMovimientoCategoria,
  WalletMovimientoTipo,
} from "@/lib/types/wallet";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { CajaPagoTiendaFeedService } from "@/lib/services/CajaPagoTiendaFeedService";
import { LiquidacionService } from "@/lib/services/LiquidacionService";
import { derivarCaja } from "@/lib/utils/caja-tesoreria";

/**
 * Feature 173 / T C.4 (R21, R28, R30, R48 — parte pago/anulacion) — LA CADENA COMPLETA, medida
 * en colones: **pagar → anular deja el dinero en caja donde estaba y la ganancia donde estaba**.
 *
 * Por que hace falta este archivo si ya hay dos suites de liquidacion. Aquellas miden LLAMADAS
 * («la caja recibio esta fila»). Esta mide EL EFECTO sobre las dos cifras que la feature existe
 * para separar, encadenando pago y anulacion sobre el MISMO libro. Es el unico test en el que
 * cambiar la categoria del reverso a `ingreso_ajuste` (design §10-C) se ve como lo que es: ₡15
 * 000 de ganancia inventada. La mutacion esta ejecutada y pegada en
 * `progress/impl_173-caja-tesoreria.md`.
 *
 * El store no es complaciente: implementa los TRES indices unicos de verdad —el
 * `UNIQUE(clave_idempotencia)` del pago, el `UNIQUE(pago_id)` de la anulacion y el parcial
 * `(origen_tipo, origen_id, categoria)` de la caja— y la visibilidad diferida al commit. La
 * idempotencia de R21/R28 se mide sobre ellos, no sobre un `if` del test.
 *
 * Money-safe: `Prisma.Decimal` y STRING; ni un `Number(` ni un `parseFloat` en todo el archivo.
 */

const ACTOR: Actor = { usuarioId: "u-admin", rol: RolValue.admin };
const TIENDA = "t1";
const CLAVE = "11111111-1111-4111-8111-111111111111";
const AHORA = new Date("2026-08-05T20:30:00.000Z"); // 14:30 en Costa Rica del 5 de agosto

/** El pago a la tienda: ₡15 000, el 30 de julio. */
function pagoInput(over: Partial<RegistrarPagoTiendaInput> = {}): RegistrarPagoTiendaInput {
  return {
    claveIdempotencia: CLAVE,
    tiendaId: TIENDA,
    monto: "15000.00",
    metodo: "SINPE",
    referencia: "1234567",
    fechaPago: "2026-07-30",
    ...over,
  };
}

type FilaCaja = {
  tipo: WalletMovimientoTipo;
  categoria: WalletMovimientoCategoria;
  monto: Prisma.Decimal;
  origenTipo: string;
  origenId: string | null;
};

/**
 * EL LIBRO DE LA CAJA tal y como estaria un dia cualquiera despues de la Tanda B: contra-entrega
 * recaudado (de las TIENDAS), flete e IVA (de ORDENEX) y dos salidas propias.
 *
 *   enCaja   = 20 000 + 3 000 + 390 − 500 − 1 200 = 21 690,00
 *   ganancia =           3 000 + 390 − 500 − 1 200 =  1 690,00
 *
 * Las dos cifras son DISTINTAS a proposito: si la semilla no tuviera dinero de terceros, un
 * reverso mal clasificado podria pasar inadvertido.
 */
const SEMILLA: FilaCaja[] = [
  { tipo: "ingreso", categoria: "ingreso_cod_recaudado", monto: new Prisma.Decimal("20000.00"), origenTipo: "cierre_dia", origenId: "c-1" },
  { tipo: "ingreso", categoria: "ingreso_flete", monto: new Prisma.Decimal("3000.00"), origenTipo: "cierre_dia", origenId: "c-2" },
  { tipo: "ingreso", categoria: "ingreso_iva_flete", monto: new Prisma.Decimal("390.00"), origenTipo: "cierre_dia", origenId: "c-3" },
  { tipo: "egreso", categoria: "egreso_sueldo", monto: new Prisma.Decimal("500.00"), origenTipo: "manual", origenId: null },
  { tipo: "egreso", categoria: "egreso_pago_mensajero", monto: new Prisma.Decimal("1200.00"), origenTipo: "cierre_dia", origenId: "c-4" },
];

/**
 * Store en memoria con la semantica de la base que importa aqui:
 *
 *  1. `UNIQUE(clave_idempotencia)` en el pago — el segundo submit no crea un segundo documento.
 *  2. `UNIQUE(pago_id)` en la anulacion — no se puede anular dos veces.
 *  3. El indice unico parcial `(origen_tipo, origen_id, categoria)` de la CAJA, con
 *     `ON CONFLICT DO NOTHING` cuando el insert lleva `skipDuplicates`.
 *  4. Visibilidad diferida: lo escrito dentro de la transaccion solo se publica al commit, y lo
 *     que no llega al commit se pierde (rollback).
 */
function makeStore(saldoTienda: string) {
  const caja: FilaCaja[] = [...SEMILLA];
  const clavesCaja = new Set<string>(SEMILLA.filter((f) => f.origenId !== null).map(claveCaja));
  const ledger: CrearMovimientoTiendaInput[] = [];
  const pagos: LiquidacionPagoDTO[] = [];
  const anulados = new Set<string>();
  const clavesIdempotencia = new Map<string, string>(); // clave -> pagoId (el UNIQUE de la columna)
  const aplicarAlCommit: Array<() => void> = [];
  let seq = 0;

  function claveCaja(f: { origenTipo: string; origenId: string | null; categoria: string }) {
    return `${f.origenTipo}|${f.origenId}|${f.categoria}`;
  }

  const tx = {
    walletMovimiento: {
      createMany: async ({
        data,
        skipDuplicates,
      }: {
        data: FilaCaja[];
        skipDuplicates?: boolean;
      }) => {
        const aInsertar: FilaCaja[] = [];
        for (const fila of data) {
          const k = claveCaja(fila);
          if (fila.origenId !== null && clavesCaja.has(k)) {
            if (skipDuplicates) continue; // ON CONFLICT DO NOTHING
            throw new Error(`unique violation ${k}`);
          }
          if (fila.origenId !== null) clavesCaja.add(k); // reservada ya: no cabe dos veces
          aInsertar.push(fila);
        }
        aplicarAlCommit.push(() => caja.push(...aInsertar));
        return { count: aInsertar.length };
      },
    },
  };

  const cajaRepo = new WalletMovimientoRepository({} as unknown as PrismaClient);
  const puerto = new CajaPagoTiendaFeedService(cajaRepo);

  const runTransaction: LiquidacionTxRunner = async (fn) => {
    try {
      const r = await fn(tx as unknown as LiquidacionTx);
      for (const aplicar of aplicarAlCommit) aplicar(); // COMMIT
      return r;
    } finally {
      aplicarAlCommit.length = 0; // lo no aplicado se pierde: eso es el rollback
    }
  };

  const pagoRepo: ILiquidacionPagoRepository = {
    bloquearBeneficiario: vi.fn(async () => {}),
    crear: vi.fn(async (_tx, input) => {
      // UNIQUE(clave_idempotencia): la barrera es de datos, no un `if` del servicio.
      if (clavesIdempotencia.has(input.claveIdempotencia)) return { status: "clave_repetida" as const };
      seq += 1;
      clavesIdempotencia.set(input.claveIdempotencia, `pago-${seq}`);
      const pago: LiquidacionPagoDTO = {
        id: `pago-${seq}`,
        mensajeroId: null,
        tiendaId: input.tiendaId,
        cierreId: null,
        monto: input.monto,
        metodo: input.metodo,
        referencia: input.referencia,
        nota: input.nota,
        fechaPago: "2026-07-30",
        registradoPorNombre: "Ana Admin",
        registradoAt: "2026-07-30T15:04:05.000Z",
        anulacion: null,
      };
      aplicarAlCommit.push(() => pagos.push(pago));
      return { status: "creado" as const, pago };
    }),
    anular: vi.fn(async (_tx, input: AnularLiquidacionPagoInput) => {
      if (anulados.has(input.pagoId)) return { status: "ya_anulado" as const }; // UNIQUE(pago_id)
      const anulacion: AnulacionDTO = {
        motivo: input.motivo,
        anuladoPorNombre: "Mario Maestro",
        anuladoAt: "2026-08-05T20:31:00.000Z",
      };
      aplicarAlCommit.push(() => {
        anulados.add(input.pagoId);
        const p = pagos.find((x) => x.id === input.pagoId);
        if (p !== undefined) p.anulacion = anulacion;
      });
      return { status: "anulado" as const, anulacion };
    }),
    obtenerPorClave: vi.fn(async (clave: string) => {
      const id = clavesIdempotencia.get(clave);
      return id === undefined ? null : (pagos.find((p) => p.id === id) ?? null);
    }),
    obtenerPorId: vi.fn(async (id: string) => pagos.find((p) => p.id === id) ?? null),
    obtenerCierreParaPago: vi.fn(async () => null),
    sumarVigentesPorCierre: vi.fn(async () => ({})),
    sumarVigentesPorTienda: vi.fn(async () => "0.00"),
    listarPorCierre: vi.fn(async () => []),
    listarPorTienda: vi.fn(async () => pagos),
    // Feature 205 (T2.2): el contrato gana dos LECTURAS. Ningun test de este archivo las
    // usa —son del reparto—, pero el doble las expone para poder afirmar que los caminos de la
    // 172 NO las llaman.
    listarCierresImputables: vi.fn(async () => []),
    listarPorReparto: vi.fn(async () => []),
    // Feature 205 (T3.1): la tercera lectura del reparto (el CONTEO por estado de R36).
    contarCierresNoAprobadosPorEstado: vi.fn(async () => []),
  };

  /**
   * Feature 205 (T3.2): el repositorio del ACTO de repartir, doble mudo. Esta cadena es de
   * TIENDA (pagar -> anular -> caja) y no reparte nada; el doble existe porque el servicio exige
   * el repositorio por constructor, sin default.
   */
  const repartoRepo: ILiquidacionRepartoRepository = {
    crear: vi.fn(async () => ({ status: "clave_repetida" as const })),
    obtenerPorClave: vi.fn(async () => null),
  };

  const tiendaRepo: IWalletTiendaMovimientoRepository = {
    crearMovimientos: vi.fn(async (_tx, movs: CrearMovimientoTiendaInput[]) => {
      aplicarAlCommit.push(() => ledger.push(...movs));
      return movs.length;
    }),
    agregarSaldoPorTienda: vi.fn(async () => {
      const suma = (tipo: "credito" | "debito") =>
        ledger
          .filter((m) => m.tipo === tipo)
          .reduce((acc, m) => acc.add(new Prisma.Decimal(m.monto)), new Prisma.Decimal(0));
      return {
        creditos: new Prisma.Decimal(saldoTienda).add(suma("credito")).toFixed(2),
        debitos: suma("debito").toFixed(2),
      };
    }),
    listarPorTienda: vi.fn(),
    listarSaldosTodasTiendas: vi.fn(),
    listarSaldosTiendasPaginado: vi.fn(),
    agregarDesglosePorTienda: vi.fn(),
  } as unknown as IWalletTiendaMovimientoRepository;

  const mensajeroRepo = {
    crearMovimientos: vi.fn(async () => 1),
  } as unknown as IPagoMensajeroMovimientoRepository;

  const service = new LiquidacionService(
    pagoRepo,
    tiendaRepo,
    mensajeroRepo,
    runTransaction,
    puerto,
    repartoRepo, // feature 205 (T3.2): va ANTES del reloj y sin default
    () => AHORA,
  );

  /** Las DOS cifras, derivadas del libro de la caja tal y como esta AHORA MISMO. */
  function cifras(): CajaResumenDTO {
    const porClave = new Map<string, AgregadoCajaRow>();
    for (const fila of caja) {
      const k = `${fila.categoria}|${fila.tipo}`;
      const previo = porClave.get(k);
      const total = new Prisma.Decimal(previo?.total ?? "0").add(fila.monto);
      porClave.set(k, { categoria: fila.categoria, tipo: fila.tipo, total: total.toFixed(2) });
    }
    return derivarCaja([...porClave.values()]);
  }

  /**
   * Reintento del egreso POR EL PUERTO, saltandose el servicio: es la carrera que el indice
   * unico parcial tiene que absorber sin error y sin fila (R48).
   */
  async function emitirEgresoOtraVez(pagoId: string, monto: string): Promise<number> {
    const insertadas = await puerto.emitirEgresoDePago(tx as unknown as CajaPagoTiendaTxClient, {
      pagoId,
      monto,
      descripcion: "SINPE · 1234567",
      registradoPor: ACTOR.usuarioId,
      fechaMovimiento: new Date("2026-07-30T00:00:00.000Z"),
    });
    for (const aplicar of aplicarAlCommit) aplicar();
    aplicarAlCommit.length = 0;
    return insertadas;
  }

  return { service, caja, ledger, cifras, tiendaRepo, mensajeroRepo, puerto, emitirEgresoOtraVez };
}

/** Las filas de la caja que cuelgan de un pago concreto. */
function filasDelPago(caja: FilaCaja[], pagoId: string): FilaCaja[] {
  return caja.filter((f) => f.origenTipo === "pago_tienda" && f.origenId === pagoId);
}

describe("R30 — pagar y anular deja el dinero en caja donde estaba y la ganancia intacta", () => {
  it("R30: las TRES cifras del recorrido, en colones", async () => {
    const d = makeStore("100000.00");

    const antes = d.cifras();
    expect(antes.enCaja).toBe("21690.00");
    expect(antes.ganancia).toBe("1690.00");

    // ── momento 2: el dinero SALE ────────────────────────────────────────────────────────────
    const pago = await d.service.registrarPagoTienda(pagoInput(), ACTOR);
    expect(pago.status).toBe("ok");

    const trasPagar = d.cifras();
    // R18: el «dinero en caja» baja EXACTAMENTE el importe del pago…
    expect(trasPagar.enCaja).toBe("6690.00");
    // …y la ganancia NO se mueve ni un centimo: ese dinero nunca fue de Ordenex.
    expect(trasPagar.ganancia).toBe("1690.00");

    // ── momento 3: el dinero VUELVE ──────────────────────────────────────────────────────────
    if (pago.status !== "ok") return;
    const anulacion = await d.service.anularPago(
      { pagoId: pago.pago.id, motivo: "Monto mal tecleado" },
      ACTOR,
    );
    expect(anulacion.status).toBe("ok");

    const trasAnular = d.cifras();
    // R30, primera mitad: el dinero en caja vuelve al importe EXACTO previo al pago.
    expect(trasAnular.enCaja).toBe(antes.enCaja);
    // R30, segunda mitad y R26: la ganancia es IDENTICA en los tres momentos.
    expect([antes.ganancia, trasPagar.ganancia, trasAnular.ganancia]).toEqual([
      "1690.00",
      "1690.00",
      "1690.00",
    ]);
    // Y la tercera linea (dinero de terceros) tambien vuelve a su sitio.
    expect(trasAnular.deTerceros).toBe(antes.deTerceros);
  });

  it("R26 (contraprueba): si el reverso fuera de naturaleza PROPIA, la ganancia subiria ₡15 000", () => {
    // Esta es la mutacion de design §10-C expresada como aritmetica, para que quede escrito
    // CUANTO cuesta el error y no solo que existe. `ingreso_ajuste` es la categoria que
    // `reversarEgreso` (feature 45) usa para revertir un egreso propio: reusarla aqui
    // convertiria una correccion administrativa en utilidad.
    const base: AgregadoCajaRow[] = [
      { categoria: "ingreso_cod_recaudado", tipo: "ingreso", total: "20000.00" },
      { categoria: "egreso_pago_tienda", tipo: "egreso", total: "15000.00" },
    ];
    const conReverso = derivarCaja([
      ...base,
      { categoria: "ingreso_reverso_pago_tienda", tipo: "ingreso", total: "15000.00" },
    ]);
    const conAjuste = derivarCaja([
      ...base,
      { categoria: "ingreso_ajuste", tipo: "ingreso", total: "15000.00" },
    ]);

    expect(conReverso.enCaja).toBe(conAjuste.enCaja); // el dinero en caja no distingue…
    expect(conReverso.ganancia).toBe("0.00"); // …pero la ganancia si, y esa es la feature
    expect(conAjuste.ganancia).toBe("15000.00");
  });

  it("R24/R25: las dos filas del pago conviven en la caja, con su categoria y su fecha", async () => {
    const d = makeStore("100000.00");

    const pago = await d.service.registrarPagoTienda(pagoInput(), ACTOR);
    if (pago.status !== "ok") throw new Error("el pago no se registro");
    await d.service.anularPago({ pagoId: pago.pago.id, motivo: "Monto mal tecleado" }, ACTOR);

    const filas = filasDelPago(d.caja, pago.pago.id);
    expect(filas.map((f) => f.categoria)).toEqual([
      "egreso_pago_tienda",
      "ingreso_reverso_pago_tienda",
    ]);
    expect(filas.map((f) => f.tipo)).toEqual(["egreso", "ingreso"]);
    expect(filas.map((f) => f.monto.toFixed(2))).toEqual(["15000.00", "15000.00"]);
  });
});

describe("R21/R28/R48 — la misma clave dos veces no mueve el dinero dos veces", () => {
  it("R21: reintentar el pago con la MISMA clave de idempotencia deja UN solo egreso", async () => {
    const d = makeStore("100000.00");

    const primero = await d.service.registrarPagoTienda(pagoInput(), ACTOR);
    const segundo = await d.service.registrarPagoTienda(pagoInput(), ACTOR); // doble submit

    expect(primero.status).toBe("ok");
    expect(segundo.status).toBe("ya_registrado");
    // UNA fila de egreso en la caja, y el dinero baja UNA vez.
    const egresos = d.caja.filter((f) => f.categoria === "egreso_pago_tienda");
    expect(egresos).toHaveLength(1);
    expect(d.cifras().enCaja).toBe("6690.00");
  });

  it("R28: anular dos veces deja UN solo reverso, y la caja no sube dos veces", async () => {
    const d = makeStore("100000.00");

    const pago = await d.service.registrarPagoTienda(pagoInput(), ACTOR);
    if (pago.status !== "ok") throw new Error("el pago no se registro");
    const primera = await d.service.anularPago({ pagoId: pago.pago.id, motivo: "Error" }, ACTOR);
    const segunda = await d.service.anularPago({ pagoId: pago.pago.id, motivo: "Error" }, ACTOR);

    expect(primera.status).toBe("ok");
    expect(segunda.status).toBe("ya_anulado");
    const reversos = d.caja.filter((f) => f.categoria === "ingreso_reverso_pago_tienda");
    expect(reversos).toHaveLength(1);
    expect(d.cifras().enCaja).toBe("21690.00"); // exactamente el importe previo al pago
  });

  it("R48: la idempotencia es por PAGO — dos pagos distintos SI mueven el dinero dos veces", async () => {
    // La contraprueba de los dos de arriba: el indice unico parcial deduplica por
    // `(origen_tipo, origen_id, categoria)`, no por tienda. Si dedujera de mas, el segundo pago
    // legitimo a la misma tienda no saldria de la caja y el libro dejaria de explicarla.
    const d = makeStore("100000.00");

    const primero = await d.service.registrarPagoTienda(pagoInput(), ACTOR);
    const otro = await d.service.registrarPagoTienda(
      pagoInput({ claveIdempotencia: "22222222-2222-4222-8222-222222222222" }),
      ACTOR,
    );

    expect(primero.status).toBe("ok");
    expect(otro.status).toBe("ok");
    expect(d.caja.filter((f) => f.categoria === "egreso_pago_tienda")).toHaveLength(2);
    expect(d.cifras().enCaja).toBe("-8310.00"); // 21 690 − 15 000 − 15 000
  });

  it("R48: el mismo egreso emitido dos veces por el PUERTO inserta una sola fila", async () => {
    // Sin pasar por el servicio: es lo que ocurriria si dos transacciones reintentaran a la vez.
    // No hay ningun `if` que lo impida — lo impide la clave de origen, con `skipDuplicates`.
    const d = makeStore("100000.00");
    const pago = await d.service.registrarPagoTienda(pagoInput(), ACTOR);
    if (pago.status !== "ok") throw new Error("el pago no se registro");

    const insertadas = await d.emitirEgresoOtraVez(pago.pago.id, "15000.00");

    expect(insertadas).toBe(0); // ON CONFLICT DO NOTHING, sin error y sin fila
    expect(d.caja.filter((f) => f.categoria === "egreso_pago_tienda")).toHaveLength(1);
    expect(d.cifras().enCaja).toBe("6690.00");
  });
});

describe("R31 — la cadena no toca los otros dos libros mas de lo que ya los tocaba", () => {
  it("el ledger de la tienda recibe su debito y su ajuste, y el libro del mensajero, nada", async () => {
    const d = makeStore("100000.00");

    const pago = await d.service.registrarPagoTienda(pagoInput(), ACTOR);
    if (pago.status !== "ok") throw new Error("el pago no se registro");
    await d.service.anularPago({ pagoId: pago.pago.id, motivo: "Error" }, ACTOR);

    // Exactamente las DOS filas que la 172 ya escribia: ni una mas por culpa de la caja.
    expect(d.ledger.map((m) => m.categoria)).toEqual(["pago_tienda", "ajuste_credito"]);
    expect(d.mensajeroRepo.crearMovimientos).not.toHaveBeenCalled();
  });
});
