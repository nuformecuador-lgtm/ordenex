import { describe, it, expect, vi } from "vitest";

import type {
  IRechazoTiendaCobroRepository,
  RechazoTiendaCobroRegistro,
} from "@/lib/interfaces/repositories/IRechazoTiendaCobroRepository";
import type {
  IRechazoTiendaCobroAnulacionRepository,
  LineasDelCobro,
} from "@/lib/interfaces/repositories/IRechazoTiendaCobroAnulacionRepository";
import type { CrearMovimientoTiendaInput } from "@/lib/interfaces/repositories/IWalletTiendaMovimientoRepository";
import type { ICajaRechazoTiendaCobroFeedService } from "@/lib/interfaces/services/ICajaRechazoTiendaCobroFeedService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { RechazoTiendaCobroTx } from "@/lib/interfaces/services/IRechazoTiendaCobroService";
import { RechazoTiendaCobroService } from "@/lib/services/RechazoTiendaCobroService";
import { anularCobroRechazoTiendaAction } from "@/lib/actions/rechazo-tienda-cobro";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 458-B / TB.9 (D7, R63–R68, R73, R82) — `RechazoTiendaCobroService.anular`, con dobles.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// Lo que decide el SERVICIO: el orden (rol → leer → transaccion), que solo un cobro APROBADO se
// anula, que sin la linea del flete en la caja no se escribe nada, que cada reverso y cada credito
// llevan el monto de SU linea original —nunca uno de la peticion—, que sin debitos en la tienda no
// hay creditos, y que un «ya estaba» no deja rastro. Lo que decide la BASE (UNIQUE, R7/R8, dos a la
// vez) se mide en `tests/integration/db/wallet-anulacion-458.test.ts` y `…-concurrencia.test.ts`.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "u-admin", rol: "admin" };
const TIENDA: Actor = { usuarioId: "u-tienda", rol: "adminTienda" };
const MENSAJERO: Actor = { usuarioId: "u-msj", rol: "mensajero" };
const SATELITE: Actor = { usuarioId: "u-sat", rol: "adminSatelite" };
const AHORA = new Date("2026-09-26T15:00:00.000Z");

function registro(over: Partial<RechazoTiendaCobroRegistro> = {}): RechazoTiendaCobroRegistro {
  return {
    id: "cob-1",
    gestionId: "gest-1",
    ordenId: "o1",
    tiendaId: "store-1",
    montoFlete: "500.00",
    montoIva: "65.00",
    tarifaId: "tar-1",
    estado: "aprobado",
    generadoEl: "2026-08-31",
    decididoPor: "u-maestro",
    decididoAt: new Date("2026-09-01T15:00:00.000Z"),
    ...over,
  } as RechazoTiendaCobroRegistro;
}

const LINEAS_COMPLETAS: LineasDelCobro = {
  caja: [
    { categoria: "ingreso_flete_devolucion", monto: "500.00" },
    { categoria: "ingreso_iva_flete_devolucion", monto: "65.00" },
  ],
  tienda: [
    { categoria: "flete_devolucion", monto: "500.00" },
    { categoria: "iva_flete_devolucion", monto: "65.00" },
  ],
};

const TX = { marca: "tx-458" } as unknown as RechazoTiendaCobroTx;

function montaje(
  opciones: {
    cobro?: RechazoTiendaCobroRegistro | null;
    lineas?: LineasDelCobro;
    constancia?: "anulado" | "ya_anulado";
    reversos?: number;
    /** 458-B m4: cuantos creditos espejo dice haber escrito el repositorio (por defecto, todos). */
    creditosEscritos?: number;
  } = {},
) {
  const cobroRepo = {
    crearPendiente: vi.fn(),
    obtenerPorId: vi.fn(async () => (opciones.cobro === undefined ? registro() : opciones.cobro)),
    listarPendientes: vi.fn(async () => []),
    contarPendientes: vi.fn(async () => 0),
    marcarDecidido: vi.fn(async () => {
      throw new Error("anular NUNCA cambia el estado del cobro (R73)");
    }),
  } as unknown as IRechazoTiendaCobroRepository;
  const lineas = opciones.lineas ?? LINEAS_COMPLETAS;
  const repo: IRechazoTiendaCobroAnulacionRepository = {
    anular: vi.fn(async () => ({ status: opciones.constancia ?? "anulado" })),
    lineasDelCobro: vi.fn(async () => lineas),
    estadoPorGestion: vi.fn(async () => []),
    estadoDeDocumentos: vi.fn(async () => []),
    cobroDeGestion: vi.fn(async () => null),
  };
  const esperados = lineas.caja.length;
  const caja: ICajaRechazoTiendaCobroFeedService = {
    emitirReversosDeAnulacion: vi.fn(async () => opciones.reversos ?? esperados),
  };
  const movimientoRepo = { crearMovimientos: vi.fn(async () => 0) };
  const movimientoTiendaRepo = {
    crearMovimientos: vi.fn(async (_tx: unknown, movs: CrearMovimientoTiendaInput[]) => opciones.creditosEscritos ?? movs.length),
  };
  const runTx = vi.fn(async (fn: (tx: RechazoTiendaCobroTx) => Promise<unknown>) => fn(TX));
  const service = new RechazoTiendaCobroService(
    cobroRepo,
    movimientoRepo,
    movimientoTiendaRepo,
    {} as never,
    runTx as never,
    { repo, caja },
    { TIENDA_DEBITA_FLETE_DEVOLUCION: true },
  );
  return { service, cobroRepo, repo, caja, movimientoRepo, movimientoTiendaRepo, runTx };
}

const PETICION = { cobroId: "cob-1", motivo: "Se cobró por error" };

describe("458-B — RechazoTiendaCobroService.anular (D7, R63–R68, R73)", () => {
  it("R82/R83: sin acceso total responde `forbidden` ANTES de leer el cobro", async () => {
    for (const actor of [TIENDA, MENSAJERO, SATELITE]) {
      const m = montaje();
      expect(await m.service.anular(PETICION, actor, AHORA)).toEqual({ status: "forbidden" });
      expect(m.cobroRepo.obtenerPorId).not.toHaveBeenCalled();
      expect(m.runTx).not.toHaveBeenCalled();
    }
  });

  it("R64/R68: maestro y admin anulan: constancia, DOS reversos por el monto de SUS lineas y DOS creditos espejo, todo con el instante inyectado", async () => {
    for (const actor of [MAESTRO, ADMIN]) {
      const m = montaje();
      expect(await m.service.anular(PETICION, actor, AHORA)).toEqual({
        status: "ok",
        montoFlete: "500.00",
        montoIva: "65.00",
        creditosEnLaTienda: true,
      });
      expect(m.repo.anular).toHaveBeenCalledWith(TX, { cobroId: "cob-1", motivo: "Se cobró por error", anuladoPor: actor.usuarioId });
      expect(m.caja.emitirReversosDeAnulacion).toHaveBeenCalledWith(TX, {
        gestionId: "gest-1",
        montoFlete: "500.00",
        montoIva: "65.00",
        descripcion: null,
        registradoPor: actor.usuarioId,
        fechaMovimiento: AHORA,
      });
      expect(m.movimientoTiendaRepo.crearMovimientos).toHaveBeenCalledWith(TX, [
        { tiendaId: "store-1", tipo: "credito", categoria: "flete_devolucion_anulado", monto: "500.00", origenTipo: "gestion_orden", origenId: "gest-1", descripcion: null, registradoPor: actor.usuarioId, fechaMovimiento: AHORA },
        { tiendaId: "store-1", tipo: "credito", categoria: "iva_flete_devolucion_anulado", monto: "65.00", origenTipo: "gestion_orden", origenId: "gest-1", descripcion: null, registradoPor: actor.usuarioId, fechaMovimiento: AHORA },
      ]);
      // R73: el estado del cobro NO se toca (el doble de `marcarDecidido` revienta si se llama).
      expect(m.cobroRepo.marcarDecidido).not.toHaveBeenCalled();
    }
  });

  it("R64: el monto sale de las LINEAS ORIGINALES, no del cobro ni de la peticion", async () => {
    // Si la linea de la caja dijera otra cosa que el cobro (no deberia), manda la linea: el reverso
    // deshace EXACTAMENTE lo que se escribio.
    const m = montaje({
      lineas: {
        caja: [{ categoria: "ingreso_flete_devolucion", monto: "499.99" }],
        tienda: [{ categoria: "flete_devolucion", monto: "499.99" }],
      },
    });
    const r = await m.service.anular({ ...PETICION }, MAESTRO, AHORA);
    expect(r).toMatchObject({ status: "ok", montoFlete: "499.99", montoIva: null });
    expect(m.caja.emitirReversosDeAnulacion).toHaveBeenCalledWith(TX, expect.objectContaining({ montoFlete: "499.99", montoIva: null }));
  });

  it("R68: sin debitos en la tienda (interruptor apagado al aprobar) NO escribe creditos; la caja si se revierte", async () => {
    const m = montaje({ lineas: { caja: LINEAS_COMPLETAS.caja, tienda: [] } });
    expect(await m.service.anular(PETICION, MAESTRO, AHORA)).toMatchObject({ status: "ok", creditosEnLaTienda: false });
    expect(m.caja.emitirReversosDeAnulacion).toHaveBeenCalledTimes(1);
    expect(m.movimientoTiendaRepo.crearMovimientos).not.toHaveBeenCalled();
  });

  it("R65: un cobro pendiente o rechazado responde `no_anulable` (no_aprobado) sin abrir la transaccion", async () => {
    for (const estado of ["pendiente", "rechazado"] as const) {
      const m = montaje({ cobro: registro({ estado }) });
      expect(await m.service.anular(PETICION, MAESTRO, AHORA)).toEqual({ status: "no_anulable", motivo: "no_aprobado" });
      expect(m.runTx).not.toHaveBeenCalled();
    }
  });

  it("un cobro inexistente responde `no_encontrado`", async () => {
    const m = montaje({ cobro: null });
    expect(await m.service.anular(PETICION, MAESTRO, AHORA)).toEqual({ status: "no_encontrado" });
  });

  it("R68: sin la linea del flete en la caja no escribe NADA (`no_anulable`, sin_linea_de_caja)", async () => {
    const m = montaje({ lineas: { caja: [], tienda: LINEAS_COMPLETAS.tienda } });
    expect(await m.service.anular(PETICION, MAESTRO, AHORA)).toEqual({ status: "no_anulable", motivo: "sin_linea_de_caja" });
    expect(m.repo.anular).not.toHaveBeenCalled();
    expect(m.caja.emitirReversosDeAnulacion).not.toHaveBeenCalled();
    expect(m.movimientoTiendaRepo.crearMovimientos).not.toHaveBeenCalled();
  });

  it("R66/R67: con constancia ya escrita responde `ya_anulado` y no escribe reversos ni creditos", async () => {
    const m = montaje({ constancia: "ya_anulado" });
    expect(await m.service.anular(PETICION, MAESTRO, AHORA)).toEqual({ status: "ya_anulado" });
    expect(m.caja.emitirReversosDeAnulacion).not.toHaveBeenCalled();
    expect(m.movimientoTiendaRepo.crearMovimientos).not.toHaveBeenCalled();
  });

  it("si los reversos ya existian sin constancia, la transaccion LANZA (se revierte todo): la base no esta como se cree", async () => {
    const m = montaje({ reversos: 0 });
    await expect(m.service.anular(PETICION, MAESTRO, AHORA)).rejects.toThrow(/esperaba 2 reversos y escribio 0/);
  });

  it("458-B m4: si la tienda no recibe TODOS sus creditos espejo, la transaccion LANZA (se revierte todo)", async () => {
    const m = montaje({ creditosEscritos: 1 });
    await expect(m.service.anular(PETICION, MAESTRO, AHORA)).rejects.toThrow(/esperaba 2 creditos espejo y escribio 1/);
    // Dentro de la transaccion: el throw la revierte entera (caja incluida).
    expect(m.runTx).toHaveBeenCalledTimes(1);
  });
});

describe("458-B — anularCobroRechazoTiendaAction: el borde", () => {
  it("sin sesion: `unauthenticated` sin tocar el servicio; `.strict()`: un `monto` es `validation_error`", async () => {
    const m = montaje();
    expect(await anularCobroRechazoTiendaAction(PETICION, { getActor: async () => null, service: m.service })).toEqual({
      status: "unauthenticated",
    });
    const r = await anularCobroRechazoTiendaAction(
      { cobroId: "00000000-0000-4000-8000-000000000001", motivo: "x", monto: "1.00" },
      { getActor: async () => MAESTRO, service: m.service },
    );
    expect(r.status).toBe("validation_error");
    const sinMotivo = await anularCobroRechazoTiendaAction(
      { cobroId: "00000000-0000-4000-8000-000000000001", motivo: "  " },
      { getActor: async () => MAESTRO, service: m.service },
    );
    expect(sinMotivo.status).toBe("validation_error");
    expect(m.cobroRepo.obtenerPorId).not.toHaveBeenCalled();
  });

  it("pasa el reloj inyectado al servicio", async () => {
    const m = montaje();
    const r = await anularCobroRechazoTiendaAction(
      { cobroId: "00000000-0000-4000-8000-000000000001", motivo: "Error" },
      { getActor: async () => MAESTRO, service: m.service, now: () => AHORA },
    );
    expect(r.status).toBe("ok");
    expect(m.caja.emitirReversosDeAnulacion).toHaveBeenCalledWith(TX, expect.objectContaining({ fechaMovimiento: AHORA }));
  });
});
