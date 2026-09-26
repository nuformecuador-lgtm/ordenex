import { vi } from "vitest";

import type { IFileStorage } from "@/lib/interfaces/external/IFileStorage";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type {
  AbonoTiendaRegistro,
  CrearAbonoTiendaInput,
  IAbonoTiendaRepository,
} from "@/lib/interfaces/repositories/IAbonoTiendaRepository";
import type { CuentaTiendaValidacion } from "@/lib/interfaces/repositories/IUserRepository";
import type { CrearMovimientoTiendaInput } from "@/lib/interfaces/repositories/IWalletTiendaMovimientoRepository";
import type { AbonoTiendaTxRunner } from "@/lib/interfaces/services/IAbonoTiendaService";
import type { ICajaAbonoTiendaFeedService } from "@/lib/interfaces/services/ICajaAbonoTiendaFeedService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { AbonoTiendaService } from "@/lib/services/AbonoTiendaService";
import type { RegistrarAbonoTiendaInput } from "@/lib/types/abono-tienda";

// FICHA 457 — los DOBLES de `AbonoTiendaService`, compartidos por los tres archivos de servicio
// (registrar, anular, comprobante). No es un archivo de test (no acaba en `.test.ts`).

export const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
export const ADMIN: Actor = { usuarioId: "u-admin", rol: "admin" };
export const TIENDA_ID = "7f1c2d3e-0000-4000-8000-00000000000a";
export const OTRA_TIENDA = "7f1c2d3e-0000-4000-8000-00000000000b";

/** 12:00 en Costa Rica del 2026-09-24. */
export const AHORA = new Date("2026-09-24T18:00:00.000Z");

export const PDF = { contentType: "application/pdf", bytes: new Uint8Array([1, 2, 3]) };

export function entrada(over: Partial<RegistrarAbonoTiendaInput> = {}): RegistrarAbonoTiendaInput {
  return {
    claveIdempotencia: "11111111-1111-4111-8111-111111111111",
    tiendaId: TIENDA_ID,
    monto: "4000",
    metodo: "SINPE",
    referencia: "123456",
    motivo: "Pago de lo que debía por los fletes de septiembre",
    fechaPago: "2026-09-20",
    ...over,
  };
}

export function registro(over: Partial<AbonoTiendaRegistro> = {}): AbonoTiendaRegistro {
  return {
    id: "ab-1",
    tiendaId: TIENDA_ID,
    tiendaNombre: "Nuform",
    monto: "4000.00",
    metodo: "SINPE",
    referencia: "123456",
    motivo: "Pago de lo que debía por los fletes de septiembre",
    fechaPago: "2026-09-20",
    comprobantePath: null,
    comprobanteContentType: null,
    registradoPorNombre: "Maestro",
    registradoAt: AHORA.toISOString(),
    anulado: false,
    ...over,
  };
}

/** Una secuencia de saldos: cada llamada a `agregarSaldoPorTienda` consume el siguiente (el ultimo se repite). */
export type Saldos = ReadonlyArray<{ creditos: string; debitos: string }>;

export function montar(opts: {
  cuenta?: CuentaTiendaValidacion | null;
  crear?: IAbonoTiendaRepository["crear"];
  anular?: IAbonoTiendaRepository["anular"];
  documento?: AbonoTiendaRegistro | null;
  /**
   * Lo que devuelve `obtenerPorClave` en cada llamada (el ultimo se repite). Por defecto `[null]`: la
   * clave es NUEVA. `[null, original]` = la clave aparece despues (el choque en la transaccion).
   */
  porClave?: ReadonlyArray<AbonoTiendaRegistro | null>;
  upload?: IFileStorage["upload"];
  /** Por defecto la tienda DEBE 10 000,00 (creditos 5 000 − debitos 15 000). */
  saldos?: Saldos;
  caja?: Partial<ICajaAbonoTiendaFeedService>;
  ahora?: Date;
} = {}) {
  const orden: string[] = [];
  let lecturasClave = 0;
  const abonoRepo: IAbonoTiendaRepository = {
    crear: vi.fn(
      opts.crear ??
        (async (_tx, input: CrearAbonoTiendaInput) => {
          orden.push("crear");
          return {
            status: "creado" as const,
            abono: registro({
              id: input.id,
              tiendaId: input.tiendaId,
              monto: input.monto,
              metodo: input.metodo,
              referencia: input.referencia,
              motivo: input.motivo,
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
    obtenerPorClave: vi.fn(async () => {
      orden.push("clave");
      const seq = opts.porClave ?? [null];
      const r = seq[Math.min(lecturasClave, seq.length - 1)];
      lecturasClave += 1;
      return r;
    }),
    obtenerPorId: vi.fn(async () => (opts.documento === undefined ? registro() : opts.documento)),
    estadoDeDocumentos: vi.fn(async () => []),
  };
  const saldos: Saldos = opts.saldos ?? [{ creditos: "5000.00", debitos: "15000.00" }];
  let lecturas = 0;
  const tiendaRepo = {
    crearMovimientos: vi.fn(async (_tx: unknown, movs: CrearMovimientoTiendaInput[]) => {
      orden.push(`tienda:${movs[0].categoria}`);
      return movs.length;
    }),
    agregarSaldoPorTienda: vi.fn(async () => {
      orden.push("saldo");
      const s = saldos[Math.min(lecturas, saldos.length - 1)];
      lecturas += 1;
      return s;
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
  const caja: ICajaAbonoTiendaFeedService = {
    emitirIngresoDeAbono: vi.fn(
      opts.caja?.emitirIngresoDeAbono ??
        (async () => {
          orden.push("caja:ingreso");
          return 1;
        }),
    ),
    emitirReversoDeAbono: vi.fn(
      opts.caja?.emitirReversoDeAbono ??
        (async () => {
          orden.push("caja:reverso");
          return 1;
        }),
    ),
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
  const svc = new AbonoTiendaService(
    abonoRepo,
    tiendaRepo,
    candado,
    usuarioRepo,
    caja,
    storage,
    urls,
    runTx as unknown as AbonoTiendaTxRunner,
    () => opts.ahora ?? AHORA,
    { MAX_BYTES: 4 * 1024 * 1024, SIGNED_URL_TTL_SECONDS: 300 },
  );
  return { svc, orden, abonoRepo, tiendaRepo, candado, usuarioRepo, caja, storage, urls, runTx, tx };
}
