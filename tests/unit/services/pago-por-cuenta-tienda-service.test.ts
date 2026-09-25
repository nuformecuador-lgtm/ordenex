import { describe, it, expect, vi } from "vitest";

import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  CrearPagoPorCuentaInput,
  IPagoPorCuentaTiendaRepository,
  PagoPorCuentaRegistro,
} from "@/lib/interfaces/repositories/IPagoPorCuentaTiendaRepository";
import type { ICajaPagoPorCuentaFeedService } from "@/lib/interfaces/services/ICajaPagoPorCuentaFeedService";
import type { IFileStorage } from "@/lib/interfaces/external/IFileStorage";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type { CrearMovimientoTiendaInput } from "@/lib/interfaces/repositories/IWalletTiendaMovimientoRepository";
import { PagoPorCuentaTiendaService } from "@/lib/services/PagoPorCuentaTiendaService";
import type { CuentaTiendaValidacion } from "@/lib/interfaces/repositories/IUserRepository";
import type { PagoPorCuentaTxRunner } from "@/lib/interfaces/services/IPagoPorCuentaTiendaService";
import type { RegistrarPagoPorCuentaTiendaInput } from "@/lib/types/pago-por-cuenta-tienda";

/**
 * FICHA 459 / T B.10 — `PagoPorCuentaTiendaService` con dobles (R29–R43, R46–R52, R56, R57).
 *
 * Lo que decide QUE FILAS se escriben contra Postgres lo prueban
 * `tests/integration/db/pago-por-cuenta-tienda.test.ts` (por la action) y el de concurrencia. Aqui
 * se mide el ORDEN de los pasos, los desenlaces y lo que viaja a cada escritura.
 */

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "u-admin", rol: "admin" };
const TIENDA_ID = "7f1c2d3e-0000-4000-8000-00000000000a";
const OTRA_TIENDA = "7f1c2d3e-0000-4000-8000-00000000000b";

const AHORA = new Date("2026-09-24T18:00:00.000Z"); // 12:00 en Costa Rica

function entrada(over: Partial<RegistrarPagoPorCuentaTiendaInput> = {}): RegistrarPagoPorCuentaTiendaInput {
  return {
    claveIdempotencia: "11111111-1111-4111-8111-111111111111",
    tiendaId: TIENDA_ID,
    beneficiario: "Facebook",
    monto: "10000",
    metodo: "SINPE",
    referencia: "123",
    motivo: "Publicidad",
    ...over,
  };
}

function registro(over: Partial<PagoPorCuentaRegistro> = {}): PagoPorCuentaRegistro {
  return {
    id: "p-1",
    tiendaId: TIENDA_ID,
    tiendaNombre: "Nuform",
    beneficiario: "Facebook",
    monto: "10000.00",
    metodo: "SINPE",
    referencia: "123",
    motivo: "Publicidad",
    fechaPago: "2026-09-24",
    comprobantePath: null,
    comprobanteContentType: null,
    registradoPorNombre: "Maestro",
    registradoAt: AHORA.toISOString(),
    anulado: false,
    ...over,
  };
}

function montar(opts: {
  cuenta?: CuentaTiendaValidacion | null;
  crear?: IPagoPorCuentaTiendaRepository["crear"];
  anular?: IPagoPorCuentaTiendaRepository["anular"];
  documento?: PagoPorCuentaRegistro | null;
  upload?: IFileStorage["upload"];
  saldo?: { creditos: string; debitos: string };
  caja?: Partial<ICajaPagoPorCuentaFeedService>;
} = {}) {
  const orden: string[] = [];
  const pagoRepo: IPagoPorCuentaTiendaRepository = {
    crear: vi.fn(
      opts.crear ??
        (async (_tx, input: CrearPagoPorCuentaInput) => {
          orden.push("crear");
          return {
            status: "creado" as const,
            pago: registro({
              id: input.id,
              monto: input.monto,
              comprobantePath: input.comprobantePath,
              comprobanteContentType: input.comprobanteContentType,
            }),
          };
        }),
    ),
    anular: vi.fn(
      opts.anular ??
        (async () => {
          orden.push("anular");
          return { status: "anulado" as const };
        }),
    ),
    obtenerPorClave: vi.fn(async () => registro()),
    obtenerPorId: vi.fn(async () => (opts.documento === undefined ? registro() : opts.documento)),
    estadoDeDocumentos: vi.fn(async () => []),
  };
  const tiendaRepo = {
    crearMovimientos: vi.fn(async (_tx: unknown, movs: CrearMovimientoTiendaInput[]) => {
      orden.push(`tienda:${movs[0].categoria}`);
      return movs.length;
    }),
    agregarSaldoPorTienda: vi.fn(async () => {
      orden.push("saldo");
      return opts.saldo ?? { creditos: "5000.00", debitos: "15000.00" };
    }),
  };
  const candado = {
    bloquearBeneficiario: vi.fn(async () => {
      orden.push("candado");
    }),
  };
  const usuarioRepo = {
    obtenerCuentaTienda: vi.fn(
      async (): Promise<CuentaTiendaValidacion | null> =>
        opts.cuenta === undefined ? { rol: "adminTienda", estado: "activo" } : opts.cuenta,
    ),
  };
  const caja: ICajaPagoPorCuentaFeedService = {
    emitirEgresoDePagoPorCuenta: vi.fn(
      opts.caja?.emitirEgresoDePagoPorCuenta ??
        (async () => {
          orden.push("caja:egreso");
          return 1;
        }),
    ),
    emitirReversoDePagoPorCuenta: vi.fn(async () => {
      orden.push("caja:reverso");
      return 1;
    }),
  };
  const storage: IFileStorage = {
    upload: vi.fn(opts.upload ?? (async (i) => i.path)),
    remove: vi.fn(async () => undefined),
  };
  const urls: ISignedUrlProvider = {
    createSignedUrl: vi.fn(async (p: string, ttl: number) => `https://firmada/${p}?t=${ttl}`),
    createSignedUrls: vi.fn(async () => ({})),
  };
  const tx = { soyLaTx: true };
  const runTx = vi.fn(async (fn: (t: never) => Promise<unknown>) => fn(tx as never));
  const svc = new PagoPorCuentaTiendaService(
    pagoRepo,
    tiendaRepo,
    candado,
    usuarioRepo,
    caja,
    storage,
    urls,
    runTx as unknown as PagoPorCuentaTxRunner,
    () => AHORA,
    { MAX_BYTES: 4 * 1024 * 1024, SIGNED_URL_TTL_SECONDS: 300 },
  );
  return { svc, orden, pagoRepo, tiendaRepo, candado, usuarioRepo, caja, storage, urls, runTx, tx };
}

const PDF = { contentType: "application/pdf", bytes: new Uint8Array([1, 2, 3]) };

describe("459/B.10 — registrar un pago por cuenta", () => {
  it("R38: sin acceso total -> forbidden ANTES de leer nada", async () => {
    for (const rol of ["adminTienda", "mensajero", "adminSatelite"] as const) {
      const m = montar();
      const r = await m.svc.registrar(entrada(), PDF, { usuarioId: "x", rol });
      expect(r).toEqual({ status: "forbidden" });
      expect(m.usuarioRepo.obtenerCuentaTienda).not.toHaveBeenCalled();
      expect(m.storage.upload).not.toHaveBeenCalled();
      expect(m.runTx).not.toHaveBeenCalled();
    }
  });

  it("P14/R38: admin puede registrar igual que maestro", async () => {
    const m = montar();
    expect((await m.svc.registrar(entrada(), null, ADMIN)).status).toBe("ok");
  });

  it.each([
    [null, "La tienda no existe"],
    [{ rol: "mensajero", estado: "activo" } as CuentaTiendaValidacion, "La cuenta elegida no es una tienda"],
    [{ rol: "adminTienda", estado: "inactivo" } as CuentaTiendaValidacion, "La tienda no esta activa"],
  ] as const)("R36: tienda %j -> validation_error bajo tiendaId y NADA escrito", async (cuenta, msg) => {
    const m = montar({ cuenta });
    const r = await m.svc.registrar(entrada(), PDF, MAESTRO);
    expect(r).toEqual({ status: "validation_error", fieldErrors: { tiendaId: [msg] } });
    expect(m.storage.upload).not.toHaveBeenCalled();
    expect(m.runTx).not.toHaveBeenCalled();
  });

  it("R29/R42: el candado va ANTES del documento; luego tienda y caja, en ESE orden; saldo al final", async () => {
    const m = montar();
    await m.svc.registrar(entrada(), null, MAESTRO);
    expect(m.orden).toEqual(["candado", "crear", "tienda:pago_por_cuenta", "caja:egreso", "saldo"]);
    expect(m.candado.bloquearBeneficiario).toHaveBeenCalledWith(m.tx, {
      tipo: "tienda",
      tiendaId: TIENDA_ID,
    });
  });

  it("R29: las escrituras llevan el MISMO monto de escala 2 y el mismo instante (hoy: el reloj del servicio)", async () => {
    const m = montar();
    await m.svc.registrar(entrada({ monto: "10000.5" }), null, MAESTRO);
    const doc = vi.mocked(m.pagoRepo.crear).mock.calls[0][1];
    const tienda = m.tiendaRepo.crearMovimientos.mock.calls[0][1][0];
    const caja = vi.mocked(m.caja.emitirEgresoDePagoPorCuenta).mock.calls[0][1];
    expect([doc.monto, tienda.monto, caja.monto]).toEqual(["10000.50", "10000.50", "10000.50"]);
    // Hoy: las dos filas llevan EL MISMO instante explicito. No el DEFAULT de la columna: Prisma lo
    // rellena en el cliente fila a fila y el cargo y la salida quedaban a milisegundos (medido).
    expect(tienda.fechaMovimiento).toEqual(AHORA);
    expect(caja.fechaMovimiento).toEqual(AHORA);
    expect(doc.fechaPago.toISOString()).toBe("2026-09-24T00:00:00.000Z");
    // Y el origen de las dos es el DOCUMENTO.
    expect(tienda.origenTipo).toBe("pago_por_cuenta_tienda");
    expect(tienda.origenId).toBe(doc.id);
    expect(caja.pagoId).toBe(doc.id);
  });

  it("R35: con una fecha anterior, las dos filas se fechan al inicio de ese dia en Costa Rica", async () => {
    const m = montar();
    await m.svc.registrar(entrada({ fecha: "2026-09-20" }), null, MAESTRO);
    const tienda = m.tiendaRepo.crearMovimientos.mock.calls[0][1][0];
    const caja = vi.mocked(m.caja.emitirEgresoDePagoPorCuenta).mock.calls[0][1];
    expect(tienda.fechaMovimiento?.toISOString()).toBe("2026-09-20T06:00:00.000Z");
    expect(caja.fechaMovimiento?.toISOString()).toBe("2026-09-20T06:00:00.000Z");
  });

  it("R43: descripciones con beneficiario, motivo y metodo; la caja con el nombre de la tienda", async () => {
    const m = montar();
    await m.svc.registrar(entrada(), null, MAESTRO);
    const tienda = m.tiendaRepo.crearMovimientos.mock.calls[0][1][0];
    const caja = vi.mocked(m.caja.emitirEgresoDePagoPorCuenta).mock.calls[0][1];
    expect(tienda.descripcion).toBe("A Facebook · Publicidad · SINPE · 123");
    expect(caja.descripcion).toBe("Nuform · A Facebook · Publicidad · SINPE · 123");
  });

  it("R40: el saldo resultante negativo se devuelve con su signo", async () => {
    const m = montar({ saldo: { creditos: "5000.00", debitos: "15000.00" } });
    const r = await m.svc.registrar(entrada(), null, MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.saldo).toEqual({ creditos: "5000.00", debitos: "15000.00", saldo: "-10000.00", signo: "negativo" });
  });

  it("R58/R100: el DTO no lleva la tienda por id ni la ruta del comprobante", async () => {
    const m = montar();
    const r = await m.svc.registrar(entrada(), PDF, MAESTRO);
    if (r.status !== "ok") throw new Error("esperado ok");
    expect(Object.keys(r.pago).sort()).toEqual(
      [
        "anulado",
        "beneficiario",
        "fechaPago",
        "id",
        "metodo",
        "monto",
        "motivo",
        "referencia",
        "registradoAt",
        "registradoPorNombre",
        "tieneComprobante",
        "tiendaNombre",
      ].sort(),
    );
    expect(r.pago.tieneComprobante).toBe(true);
    expect(JSON.stringify(r)).not.toContain(TIENDA_ID);
    expect(JSON.stringify(r)).not.toContain("pagos-por-cuenta/");
  });

  it("R55: el comprobante se guarda con ruta aleatoria sin ids, ANTES de la transaccion", async () => {
    const m = montar();
    await m.svc.registrar(entrada(), PDF, MAESTRO);
    const subida = vi.mocked(m.storage.upload).mock.calls[0][0];
    expect(subida.path).toMatch(/^pagos-por-cuenta\/[0-9a-f-]{36}\.pdf$/);
    expect(subida.path).not.toContain(TIENDA_ID);
    expect(subida.path).not.toContain(MAESTRO.usuarioId);
    const doc = vi.mocked(m.pagoRepo.crear).mock.calls[0][1];
    expect(subida.path).not.toContain(doc.id);
    expect(doc.comprobantePath).toBe(subida.path);
    expect(doc.comprobanteContentType).toBe("application/pdf");
  });

  it("R54: un comprobante de tipo no admitido -> validation_error bajo comprobante, sin subir", async () => {
    const m = montar();
    const r = await m.svc.registrar(entrada(), { contentType: "image/gif", bytes: new Uint8Array([1]) }, MAESTRO);
    expect(r).toEqual({
      status: "validation_error",
      fieldErrors: { comprobante: ["El comprobante debe ser una imagen JPEG, PNG o WebP, o un PDF."] },
    });
    expect(m.storage.upload).not.toHaveBeenCalled();
    expect(m.runTx).not.toHaveBeenCalled();
  });

  it("R56: si el comprobante no se puede guardar -> comprobante_no_guardado y NADA escrito", async () => {
    const m = montar({
      upload: async () => {
        throw new Error("bucket inexistente");
      },
    });
    const r = await m.svc.registrar(entrada(), PDF, MAESTRO);
    expect(r).toEqual({ status: "comprobante_no_guardado" });
    expect(m.runTx).not.toHaveBeenCalled();
  });

  it("R56: si la transaccion falla con el comprobante ya guardado, se RETIRA", async () => {
    const m = montar({
      caja: {
        emitirEgresoDePagoPorCuenta: async () => {
          throw new Error("caida de la caja");
        },
      },
    });
    await expect(m.svc.registrar(entrada(), PDF, MAESTRO)).rejects.toThrow("caida de la caja");
    const subida = vi.mocked(m.storage.upload).mock.calls[0][0];
    expect(m.storage.remove).toHaveBeenCalledWith([subida.path]);
  });

  it("R41: clave repetida -> ya_registrado con el ORIGINAL y el saldo actual; el comprobante nuevo se retira", async () => {
    const m = montar({ crear: async () => ({ status: "clave_repetida" as const }) });
    const r = await m.svc.registrar(entrada(), PDF, MAESTRO);
    expect(r.status).toBe("ya_registrado");
    if (r.status !== "ya_registrado") return;
    expect(r.pago.id).toBe("p-1");
    expect(r.saldo.saldo).toBe("-10000.00");
    expect(m.pagoRepo.obtenerPorClave).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
    const subida = vi.mocked(m.storage.upload).mock.calls[0][0];
    expect(m.storage.remove).toHaveBeenCalledWith([subida.path]);
    // Ninguna escritura de libro tras el choque.
    expect(m.tiendaRepo.crearMovimientos).not.toHaveBeenCalled();
    expect(m.caja.emitirEgresoDePagoPorCuenta).not.toHaveBeenCalled();
  });

  it("con exito, el comprobante NO se retira", async () => {
    const m = montar();
    await m.svc.registrar(entrada(), PDF, MAESTRO);
    expect(m.storage.remove).not.toHaveBeenCalled();
  });
});

describe("459/B.10 — anular un pago por cuenta", () => {
  it("R38: sin acceso total -> forbidden antes de leer el documento", async () => {
    const m = montar();
    const r = await m.svc.anular({ pagoId: "p-1", motivo: "x" }, { usuarioId: "t", rol: "adminTienda" });
    expect(r).toEqual({ status: "forbidden" });
    expect(m.pagoRepo.obtenerPorId).not.toHaveBeenCalled();
  });

  it("R51: documento inexistente -> no_encontrado sin transaccion", async () => {
    const m = montar({ documento: null });
    expect(await m.svc.anular({ pagoId: "p-x", motivo: "x" }, MAESTRO)).toEqual({ status: "no_encontrado" });
    expect(m.runTx).not.toHaveBeenCalled();
  });

  it("R46/R47/R42: candado, anulacion, abono en la tienda y entrada en la caja con el monto DEL DOCUMENTO y el instante de hoy", async () => {
    const m = montar({ documento: registro({ monto: "2500.50" }) });
    const r = await m.svc.anular({ pagoId: "p-1", motivo: "Error" }, MAESTRO);
    expect(r.status).toBe("ok");
    expect(m.orden).toEqual(["candado", "anular", "tienda:pago_por_cuenta_anulado", "caja:reverso", "saldo"]);
    const tienda = m.tiendaRepo.crearMovimientos.mock.calls[0][1][0];
    const caja = vi.mocked(m.caja.emitirReversoDePagoPorCuenta).mock.calls[0][1];
    expect(tienda).toMatchObject({
      tipo: "credito",
      categoria: "pago_por_cuenta_anulado",
      monto: "2500.50",
      origenTipo: "pago_por_cuenta_tienda",
      origenId: "p-1",
    });
    expect(caja.monto).toBe("2500.50");
    expect(tienda.fechaMovimiento).toEqual(AHORA);
    expect(caja.fechaMovimiento).toEqual(AHORA);
    expect(tienda.descripcion).toBe("Anulación · A Facebook · Publicidad · SINPE · 123");
    expect(caja.descripcion).toBe("Anulación · Nuform · A Facebook · Publicidad · SINPE · 123");
  });

  it("R50: ya anulado -> ya_anulado y ningun asiento", async () => {
    const m = montar({ anular: async () => ({ status: "ya_anulado" as const }) });
    expect(await m.svc.anular({ pagoId: "p-1", motivo: "x" }, MAESTRO)).toEqual({ status: "ya_anulado" });
    expect(m.tiendaRepo.crearMovimientos).not.toHaveBeenCalled();
    expect(m.caja.emitirReversoDePagoPorCuenta).not.toHaveBeenCalled();
  });

  it("R47: la anulacion no toca el comprobante", async () => {
    const m = montar({ documento: registro({ comprobantePath: "pagos-por-cuenta/a.pdf", comprobanteContentType: "application/pdf" }) });
    await m.svc.anular({ pagoId: "p-1", motivo: "x" }, MAESTRO);
    expect(m.storage.remove).not.toHaveBeenCalled();
  });
});

describe("459/B.10 — R57: el comprobante", () => {
  const conComprobante = registro({
    comprobantePath: "pagos-por-cuenta/abc.pdf",
    comprobanteContentType: "application/pdf",
  });

  it("acceso total -> enlace temporal con el TTL de la config", async () => {
    const m = montar({ documento: conComprobante });
    expect(await m.svc.obtenerComprobante("p-1", MAESTRO)).toEqual({
      status: "ok",
      url: "https://firmada/pagos-por-cuenta/abc.pdf?t=300",
    });
  });

  it("la tienda DUEÑA ve el suyo; una tienda ajena recibe no_encontrado, igual que un id inexistente", async () => {
    const duena = montar({ documento: conComprobante });
    expect((await duena.svc.obtenerComprobante("p-1", { usuarioId: TIENDA_ID, rol: "adminTienda" })).status).toBe("ok");
    const ajena = montar({ documento: conComprobante });
    expect(await ajena.svc.obtenerComprobante("p-1", { usuarioId: OTRA_TIENDA, rol: "adminTienda" })).toEqual({
      status: "no_encontrado",
    });
    const inexistente = montar({ documento: null });
    expect(await inexistente.svc.obtenerComprobante("p-x", { usuarioId: OTRA_TIENDA, rol: "adminTienda" })).toEqual({
      status: "no_encontrado",
    });
    expect(ajena.urls.createSignedUrl).not.toHaveBeenCalled();
  });

  it("sin comprobante -> sin_comprobante; un mensajero -> forbidden sin leer", async () => {
    const m = montar();
    expect(await m.svc.obtenerComprobante("p-1", MAESTRO)).toEqual({ status: "sin_comprobante" });
    const mens = montar({ documento: conComprobante });
    expect(await mens.svc.obtenerComprobante("p-1", { usuarioId: "m", rol: "mensajero" })).toEqual({
      status: "forbidden",
    });
    expect(mens.pagoRepo.obtenerPorId).not.toHaveBeenCalled();
  });
});

describe("459/B.10 — R52: no hay forma de editar ni de deshacer una anulacion", () => {
  it("la superficie publica del servicio son TRES metodos", () => {
    const metodos = Object.getOwnPropertyNames(PagoPorCuentaTiendaService.prototype)
      .filter((m) => m !== "constructor" && !m.startsWith("saldo"))
      .sort();
    expect(metodos).toEqual(["anular", "obtenerComprobante", "registrar"]);
  });
});
