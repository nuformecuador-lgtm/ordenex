import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { JobDTO } from "@/lib/interfaces/repositories/IJobRepository";
import type { ICierresAdminRepository } from "@/lib/interfaces/repositories/ICierresAdminRepository";
import type { ICierresBodegaAdminRepository } from "@/lib/interfaces/repositories/ICierresBodegaAdminRepository";
import type { IIncidenteAdminRepository } from "@/lib/interfaces/repositories/IIncidenteAdminRepository";
import type { IGastoFijoPlantillaRepository } from "@/lib/interfaces/repositories/IGastoFijoPlantillaRepository";
import type {
  ILiquidacionPagoRepository,
  LiquidacionPagoDTO,
} from "@/lib/interfaces/repositories/ILiquidacionPagoRepository";
import type { IPagoMensajeroMovimientoRepository } from "@/lib/interfaces/repositories/IPagoMensajeroMovimientoRepository";
import type { IWalletTiendaMovimientoRepository } from "@/lib/interfaces/repositories/IWalletTiendaMovimientoRepository";
import type { LiquidacionTx, LiquidacionTxRunner } from "@/lib/interfaces/services/ILiquidacionService";
import { ESCRITORES_DE_LEDGER } from "@/lib/analytics/escritores-ledger";
import { CajaPagoTiendaFeedService } from "@/lib/services/CajaPagoTiendaFeedService";
import { CierresAdminService } from "@/lib/services/CierresAdminService";
import { CierresBodegaAdminService } from "@/lib/services/CierresBodegaAdminService";
import { GeneracionGastosFijosService } from "@/lib/services/GeneracionGastosFijosService";
import { IncidenteAdminService } from "@/lib/services/IncidenteAdminService";
import { decorarLiquidacionConInvalidacion } from "@/lib/services/LiquidacionConInvalidacionService";
import { LiquidacionService } from "@/lib/services/LiquidacionService";
import { WalletEgresoService } from "@/lib/services/WalletEgresoService";
import { WalletService } from "@/lib/services/WalletService";
import { crearAnaliticaInvalidacionCacheHandler } from "@/lib/services/jobs/analitica-invalidacion-cache-handler";
import { payloadInvalidacionDeDominio } from "@/lib/services/jobs/analitica-invalidacion-encolado";
import { libroFinanciero, type LibroFinanciero } from "./_libro-financiero";

// Feature 179 / T3.10 — R24: CADA ESCRITOR REGISTRA SU PROPIO ORIGEN.
//
// ⚠ POR QUE UNO POR ESCRITOR Y NO UNO GLOBAL `"ledger"`. Este registro es la unica senal que
// distingue «la cifra no cambio porque no hubo movimiento» de «la cifra no cambio porque el
// invalidador de los cierres de bodega no llego». Con un origen unico para los ocho, esa senal
// no existe: se sabria que alguien invalido, no CUAL no lo hizo. Y el modo de fallo de esta
// feature es precisamente mudo — nada se rompe, el numero se queda quieto.
//
// LOS OCHO SE EJERCEN DE VERDAD EN ESTE ARCHIVO. No se leen del registro declarado: se corren
// los ocho escritores reales y se recoge lo que CADA UNO deja en el rastro de invalidaciones. El
// registro (`escritores-ledger.ts`) se usa solo como la OTRA punta del cuadre.
//
// MUTACION QUE LO MATA: usar un unico origen para los ocho -> el primer bloque rojo, porque la
// lista deja de tener ocho valores distintos. Tipar el origen como `string` -> el ultimo bloque
// rojo: un texto libre acaba llevando un id dentro.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");

/** Ids reconocibles A PROPOSITO: si alguno se cuela en el registro, el ultimo caso lo ve. */
const USUARIO = "u-maestro-3f7a";
const TIENDA = "t-9c21";
const CIERRE = "c-4b88";
const MENSAJERO = "m-7d10";
const MAESTRO: Actor = { usuarioId: USUARIO, rol: "maestro" };
const CLIENTE = {} as never;
const AHORA = new Date("2026-08-10T06:00:00.000Z");

function pagoDTO(): LiquidacionPagoDTO {
  return {
    id: "pago-1",
    mensajeroId: null,
    tiendaId: TIENDA,
    cierreId: null,
    monto: "15000.00",
    metodo: "SINPE",
    referencia: "1234567",
    nota: null,
    fechaPago: "2026-07-30",
    registradoPorNombre: "Ana Admin",
    registradoAt: "2026-08-02T15:04:05.000Z",
    anulacion: null,
  } as LiquidacionPagoDTO;
}

/** Corre LOS OCHO escritores contra el mismo libro y devuelve el rastro de invalidaciones. */
async function correrLosOchoEscritores(libro: LibroFinanciero): Promise<void> {
  // (1) egreso administrativo
  await new WalletEgresoService(libro.cajaRepo, CLIENTE, libro.cache).registrarEgreso(
    { tipoEgreso: "gasto_variable", monto: "10.00", descripcion: "combustible" },
    MAESTRO,
  );

  // (2) movimiento manual de caja
  await new WalletService(libro.cajaRepo, CLIENTE, libro.cache).registrarMovimientoManual(
    { tipo: "egreso", categoria: "egreso_ajuste", monto: "20.00", descripcion: "ajuste" },
    MAESTRO,
  );

  // (3) liquidacion (pago a tienda: toca los tres ledgers y la caja)
  const pagoRepo = {
    bloquearBeneficiario: vi.fn(async () => {}),
    crear: vi.fn(async () => ({ status: "creado" as const, pago: pagoDTO() })),
    obtenerPorClave: vi.fn(async () => null),
    obtenerPorId: vi.fn(async () => pagoDTO()),
    sumarVigentesPorTienda: vi.fn(async () => "0.00"),
  } as unknown as ILiquidacionPagoRepository;
  const tiendaRepo = {
    crearMovimientos: vi.fn(async () => 1),
    agregarSaldoPorTienda: vi.fn(async () => ({ creditos: "90000.00", debitos: "0.00" })),
  } as unknown as IWalletTiendaMovimientoRepository;
  const runner: LiquidacionTxRunner = async (fn) => fn({} as unknown as LiquidacionTx);
  await decorarLiquidacionConInvalidacion(
    new LiquidacionService(
      pagoRepo,
      tiendaRepo,
      {} as unknown as IPagoMensajeroMovimientoRepository,
      runner,
      new CajaPagoTiendaFeedService(libro.cajaRepo),
      () => AHORA,
    ),
    libro.cache,
  ).registrarPagoTienda(
    {
      claveIdempotencia: "11111111-1111-4111-8111-111111111111",
      tiendaId: TIENDA,
      monto: "30.00",
      metodo: "SINPE",
      referencia: "1234567",
      fechaPago: "2026-07-30",
    },
    MAESTRO,
  );

  // (4) cron de gastos fijos
  const plantillas = {
    async listarActivas() {
      return [
        {
          id: "p1",
          concepto: "Alquiler",
          monto: "40.00",
          activa: true,
          periodicidadUnidad: "dias" as const,
          periodicidadCantidad: 1,
          fechaCobro: "2026-08-01",
          createdAt: "2026-08-01T00:00:00.000Z",
          updatedAt: "2026-08-01T00:00:00.000Z",
        },
      ];
    },
  } as unknown as IGastoFijoPlantillaRepository;
  await new GeneracionGastosFijosService(
    plantillas,
    libro.cajaRepo,
    CLIENTE,
    libro.cache,
  ).ejecutarGeneracion(AHORA);

  // (5) indemnizacion de incidente
  const incidenteRepo = {
    findByIdEnAlcance: vi.fn(async () => ({
      incidenteId: "i1",
      ordenId: "o1",
      zonaId: "z1",
      estado: "solicitado",
      indemnizacion: null,
      ordenMontoCobrar: "20000.00",
      reportadoPor: MENSAJERO,
      evidenciaStoragePaths: [],
    })),
    resolver: vi.fn(async () => "updated" as const),
  } as unknown as IIncidenteAdminRepository;
  await new IncidenteAdminService(
    incidenteRepo,
    { findUsuarioZonaId: vi.fn(async () => null), findEstatusIdByValue: vi.fn(async () => "e1") } as never,
    { findOrigenesReversion: vi.fn(async () => new Map()) } as never,
    {} as never,
    { firmar: vi.fn() } as never,
    libro.cache,
  ).aprobar("i1", "50.00", MAESTRO);

  // (6) cierre de dia
  const cierresRepo = {
    findGestionesIncidenteDelCierre: vi.fn(async () => []),
    resolverCierre: vi.fn(async () => "updated" as const),
  } as unknown as ICierresAdminRepository;
  await new CierresAdminService(
    cierresRepo,
    { findCentralZonaId: vi.fn(async () => null) } as never,
    { findEstatusIdByValue: vi.fn(async () => "e1"), findUsuarioZonaId: vi.fn(async () => null) } as never,
    { firmar: vi.fn() } as never,
    { obtenerCierreParaPago: vi.fn(async () => null), sumarVigentesPorCierre: vi.fn(async () => ({})) } as never,
    libro.cache,
  ).aprobarCierre(CIERRE, MAESTRO);

  // (7) cierre de bodega
  const bodegaRepo = {
    resolverCierreBodega: vi.fn(async () => "updated" as const),
  } as unknown as ICierresBodegaAdminRepository;
  await new CierresBodegaAdminService(bodegaRepo, { firmar: vi.fn() } as never, libro.cache)
    .aprobarCierreBodega("cb1", MAESTRO);

  // (8) el backfill de tesoreria, por su job
  await crearAnaliticaInvalidacionCacheHandler(libro.cache)({
    id: "job-1",
    tipo: "analitica_invalidacion_cache",
    payload: payloadInvalidacionDeDominio("financiera"),
  } as unknown as JobDTO);
}

describe("R24 · cada uno de los OCHO escritores registra SU propio origen", () => {
  it("los ocho origenes son distintos, uno por escritor", async () => {
    const libro = libroFinanciero();
    await correrLosOchoEscritores(libro);

    const origenes = libro.cache.invalidaciones.map((i) => i.origen);

    expect(origenes).toEqual([
      "ledger_egreso_admin",
      "ledger_movimiento_manual",
      "ledger_liquidacion",
      "ledger_gastos_fijos",
      "ledger_indemnizacion",
      "ledger_cierre_dia",
      "ledger_cierre_bodega",
      "job_backfill_tesoreria",
    ]);
    expect(
      new Set(origenes).size,
      "dos escritores comparten origen: el registro ya no puede decir CUAL invalidador no llego, " +
        "que es lo unico para lo que existe.",
    ).toBe(8);
  });

  it("y son EXACTAMENTE los que el registro de escritores declara", async () => {
    const libro = libroFinanciero();
    await correrLosOchoEscritores(libro);

    const observados = new Set(libro.cache.invalidaciones.map((i) => i.origen));
    const declarados = new Set(
      ESCRITORES_DE_LEDGER.flatMap((e) =>
        e.invalidadores.flatMap((inv) => (inv.clase === "por_su_llamador" ? [] : [inv.origen])),
      ),
    );

    // El cuadre en las dos direcciones: un origen declarado que ningun escritor emite es una
    // entrada muerta; un origen emitido que nadie declaro es un escritor fuera del censo.
    expect([...observados].sort()).toEqual([...declarados].sort());
  });

  it("todas las invalidaciones llevan el tag del dominio financiero (D1: uno solo)", async () => {
    const libro = libroFinanciero();
    await correrLosOchoEscritores(libro);

    const tags = new Set(libro.cache.invalidaciones.flatMap((i) => i.tags));
    expect(tags.size).toBe(1);
  });
});

describe("R24 · el registro no lleva ids de tienda, mensajero, cierre ni usuario", () => {
  it("ninguno de los ids que participaron en las operaciones aparece en el rastro", async () => {
    const libro = libroFinanciero();
    await correrLosOchoEscritores(libro);

    const rastro = JSON.stringify(libro.cache.invalidaciones);
    for (const id of [USUARIO, TIENDA, CIERRE, MENSAJERO, "pago-1", "i1", "cb1"]) {
      expect(rastro, `el registro de invalidacion filtro el id ${id}`).not.toContain(id);
    }
  });

  it("`OrigenInvalidacion` sigue siendo un dominio CERRADO, nunca `string`", () => {
    const fuente = fs.readFileSync(
      path.join(REPO_ROOT, "lib", "interfaces", "external", "IAnaliticaCache.ts"),
      "utf8",
    );
    const declaracion = fuente.slice(
      fuente.indexOf("export type OrigenInvalidacion"),
      fuente.indexOf("export interface IAnaliticaCache"),
    );

    expect(declaracion.length).toBeGreaterThan(0);
    // Con `string`, un texto libre acabaria llevando un id dentro y el bloque de arriba dejaria
    // de poder afirmar nada: cualquier cosa seria un origen valido.
    expect(declaracion).not.toMatch(/\|\s*string\b/);
    expect(declaracion).not.toMatch(/=\s*string\b/);
    // Y los ocho de esta feature estan declarados uno a uno.
    for (const origen of [
      "ledger_egreso_admin",
      "ledger_movimiento_manual",
      "ledger_liquidacion",
      "ledger_gastos_fijos",
      "ledger_indemnizacion",
      "ledger_cierre_dia",
      "ledger_cierre_bodega",
      "job_backfill_tesoreria",
    ]) {
      expect(declaracion).toContain(`"${origen}"`);
    }
  });
});
