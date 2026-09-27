import { describe, it, expect, vi } from "vitest";

import { adjuntarComprobanteAction, verComprobanteAction } from "@/lib/actions/wallet-comprobante";
import type { IFileStorage } from "@/lib/interfaces/external/IFileStorage";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type { IWalletComprobanteRepository } from "@/lib/interfaces/repositories/IWalletComprobanteRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IWalletAnulacionService, RutaAnulacion } from "@/lib/interfaces/services/IWalletAnulacionService";
import type { IWalletComprobanteService } from "@/lib/interfaces/services/IWalletComprobanteService";
import { WalletComprobanteService } from "@/lib/services/WalletComprobanteService";
import type { DestinoMovimiento } from "@/lib/types/wallet-anulacion";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 458-B / TB.10 (R74–R80) — `WalletComprobanteService` con dobles: tipo, tamaño, fallo de
// subida no registra, fallo de registro borra, el UNIQUE impide el segundo, alcance de la tienda.
// El alcance contra Postgres vive en tests/integration/db/wallet-comprobante-alcance.test.ts.
// ═════════════════════════════════════════════════════════════════════════════════════════════

const MAESTRO: Actor = { usuarioId: "maestro-1", rol: "maestro" };
const TIENDA: Actor = { usuarioId: "tienda-1", rol: "adminTienda" };
const MENSAJERO: Actor = { usuarioId: "men-1", rol: "mensajero" };
const CAJA_ID = "00000000-0000-4000-8000-00000000000a";
const PNG = { contentType: "image/png", bytes: new Uint8Array([1, 2, 3]) };
const RUTA = "movimientos-caja/aleatorio.png";

type Clase = Exclude<RutaAnulacion, { status: "forbidden" }>;

function montar(
  opts: { clase?: Clase; ya?: boolean; anulado?: boolean; upload?: () => Promise<string>; crear?: () => Promise<"creado" | "ya_tiene"> } = {},
) {
  const repo = {
    crear: vi.fn(opts.crear ?? (async () => "creado" as const)),
    lateralDe: vi.fn(async () => (opts.ya ? { storagePath: "movimientos-caja/viejo.pdf", contentType: "application/pdf" } : null)),
    duenoDeLateral: vi.fn(async () => ({ tiendaId: null, categoria: "egreso_sueldo", fecha: new Date("2026-09-12T18:00:00Z") })),
    documento: vi.fn(async () => null),
    tiendaDeFila: vi.fn(async () => null as string | null),
    estaAnulado: vi.fn(async () => opts.anulado ?? false),
  } satisfies IWalletComprobanteRepository;
  const clasificador: Pick<IWalletAnulacionService, "clasificar"> = {
    clasificar: vi.fn(async () => opts.clase ?? ({ status: "ruta", camino: "egreso_caja", id: CAJA_ID } as Clase)),
  };
  const storage = {
    upload: vi.fn(opts.upload ?? (async () => RUTA)),
    remove: vi.fn(async () => undefined),
  } satisfies IFileStorage;
  const urls = {
    createSignedUrl: vi.fn(async (path: string, ttl: number) => `https://firmada/${path}?ttl=${ttl}`),
    createSignedUrls: vi.fn(async () => ({})),
  } satisfies ISignedUrlProvider;
  const tx = { walletComprobante: {} } as never;
  const servicio = new WalletComprobanteService(repo, clasificador, storage, urls, (fn) => fn(tx), {
    MAX_BYTES: 10,
    SIGNED_URL_TTL_SECONDS: 300,
  });
  return { servicio, repo, clasificador, storage, urls };
}

const DESTINO: DestinoMovimiento = { libro: "caja", movimientoId: CAJA_ID };

describe("458-B/TB.10 — adjuntar (D6, R75, R76, R79)", () => {
  it("R79/R82: sin acceso total `forbidden` ANTES de leer", async () => {
    for (const actor of [TIENDA, MENSAJERO]) {
      const t = montar();
      expect(await t.servicio.adjuntar(DESTINO, PNG, actor)).toEqual({ status: "forbidden" });
      expect(t.clasificador.clasificar).not.toHaveBeenCalled();
      expect(t.storage.upload).not.toHaveBeenCalled();
    }
  });

  it("feliz: sube a `movimientos-caja/`, escribe la fila del destino con quien la subio y no retira nada", async () => {
    const t = montar();
    expect(await t.servicio.adjuntar(DESTINO, PNG, MAESTRO)).toEqual({ status: "ok" });
    expect(t.storage.upload).toHaveBeenCalledWith(expect.objectContaining({ path: expect.stringMatching(/^movimientos-caja\/[0-9a-f-]{36}\.png$/) }));
    expect(t.repo.crear).toHaveBeenCalledWith(expect.anything(), { caja: CAJA_ID }, { storagePath: RUTA, contentType: "image/png", subidoPor: "maestro-1" });
    expect(t.storage.remove).not.toHaveBeenCalled();
  });

  it("R75: un tipo no admitido o un archivo que supera el tope se rechaza con el motivo y NO se sube ni se escribe", async () => {
    const tipo = montar();
    expect(await tipo.servicio.adjuntar(DESTINO, { contentType: "text/plain", bytes: new Uint8Array([1]) }, MAESTRO)).toEqual({
      status: "validation_error",
      fieldErrors: { comprobante: ["El comprobante debe ser una imagen JPEG, PNG o WebP, o un PDF."] },
    });
    const grande = montar();
    expect(await grande.servicio.adjuntar(DESTINO, { contentType: "image/png", bytes: new Uint8Array(11) }, MAESTRO)).toMatchObject({
      status: "validation_error",
    });
    for (const t of [tipo, grande]) {
      expect(t.storage.upload).not.toHaveBeenCalled();
      expect(t.repo.crear).not.toHaveBeenCalled();
    }
  });

  it("R76: si la subida falla responde `comprobante_no_guardado` y NO escribe la fila", async () => {
    const t = montar({ upload: async () => { throw new Error("bucket caido"); } });
    expect(await t.servicio.adjuntar(DESTINO, PNG, MAESTRO)).toEqual({ status: "comprobante_no_guardado" });
    expect(t.repo.crear).not.toHaveBeenCalled();
  });

  it("R76: si la fila no se escribe, el objeto subido se RETIRA y el error sube", async () => {
    const t = montar({ crear: async () => { throw new Error("se cayo la base"); } });
    await expect(t.servicio.adjuntar(DESTINO, PNG, MAESTRO)).rejects.toThrow("se cayo la base");
    expect(t.storage.remove).toHaveBeenCalledWith([RUTA]);
  });

  it("R79: el UNIQUE impide el segundo — `ya_tiene` y el objeto recien subido se retira", async () => {
    const t = montar({ crear: async () => "ya_tiene" });
    expect(await t.servicio.adjuntar(DESTINO, PNG, MAESTRO)).toEqual({ status: "ya_tiene" });
    expect(t.storage.remove).toHaveBeenCalledWith([RUTA]);
  });

  it("458-B m6: un movimiento ANULADO no admite comprobante (`no_admite: anulado`), sin subir ni escribir", async () => {
    const t = montar({ anulado: true });
    expect(await t.servicio.adjuntar(DESTINO, PNG, MAESTRO)).toEqual({ status: "no_admite", motivo: "anulado" });
    expect(t.repo.estaAnulado).toHaveBeenCalledWith("egreso_caja", CAJA_ID);
    expect(t.storage.upload).not.toHaveBeenCalled();
    expect(t.repo.crear).not.toHaveBeenCalled();
  });

  it("R79: si ya tenia uno ni se sube el nuevo (pre-chequeo)", async () => {
    const t = montar({ ya: true });
    expect(await t.servicio.adjuntar(DESTINO, PNG, MAESTRO)).toEqual({ status: "ya_tiene" });
    expect(t.storage.upload).not.toHaveBeenCalled();
  });

  it("D6: los documentos de la 459/457 lo llevan en SU documento; el cobro por rechazo, el premio y los contra-asientos no admiten", async () => {
    const casos: [Clase, unknown][] = [
      [{ status: "ruta", camino: "pago_por_cuenta_tienda", id: "d" }, { status: "no_admite", motivo: "en_su_documento" }],
      [{ status: "ruta", camino: "aporte_capital", id: "d" }, { status: "no_admite", motivo: "en_su_documento" }],
      [{ status: "ruta", camino: "abono_tienda", id: "d" }, { status: "no_admite", motivo: "en_su_documento" }],
      [{ status: "ruta", camino: "rechazo_tienda_cobro", id: "d" }, { status: "no_admite", motivo: "no_admite" }],
      [{ status: "ruta", camino: "premio_del_ranking", id: "d" }, { status: "no_admite", motivo: "no_admite" }],
      [{ status: "no_anulable", motivo: "contra_asiento" }, { status: "no_admite", motivo: "no_admite" }],
      [{ status: "no_encontrado" }, { status: "no_encontrado" }],
    ];
    for (const [clase, esperado] of casos) {
      const t = montar({ clase });
      expect(await t.servicio.adjuntar(DESTINO, PNG, MAESTRO)).toEqual(esperado);
      expect(t.storage.upload).not.toHaveBeenCalled();
    }
  });

  it("cada camino lateral va a SU carpeta y a SU columna: cobro → tienda, pago de la 172 → pago", async () => {
    const cobro = montar({ clase: { status: "ruta", camino: "cobro_tienda", id: "tm-1" } });
    await cobro.servicio.adjuntar(DESTINO, PNG, MAESTRO);
    expect(cobro.storage.upload).toHaveBeenCalledWith(expect.objectContaining({ path: expect.stringMatching(/^cobros-tienda\//) }));
    expect(cobro.repo.crear).toHaveBeenCalledWith(expect.anything(), { tienda: "tm-1" }, expect.anything());
    const pago = montar({ clase: { status: "ruta", camino: "liquidacion_pago", id: "lp-1" } });
    await pago.servicio.adjuntar(DESTINO, PNG, MAESTRO);
    expect(pago.storage.upload).toHaveBeenCalledWith(expect.objectContaining({ path: expect.stringMatching(/^pagos\//) }));
    expect(pago.repo.crear).toHaveBeenCalledWith(expect.anything(), { pago: "lp-1" }, expect.anything());
  });
});

describe("458-B/TB.10 — subir / registrarEnTx / retirar (el molde de los registros, TB.11)", () => {
  it("subir: invalido con el motivo, no_guardado si el storage falla, ok con la ruta", async () => {
    expect(await montar().servicio.subir("wallet_movimiento", { contentType: "image/gif", bytes: new Uint8Array([1]) })).toMatchObject({ status: "invalido" });
    expect(await montar({ upload: async () => { throw new Error("x"); } }).servicio.subir("wallet_movimiento", PNG)).toEqual({ status: "no_guardado" });
    expect(await montar().servicio.subir("wallet_movimiento", PNG)).toEqual({ status: "ok", guardado: { storagePath: RUTA, contentType: "image/png" } });
  });

  it("retirar no lanza aunque el storage falle", async () => {
    const t = montar();
    t.storage.remove.mockRejectedValueOnce(new Error("x"));
    await expect(t.servicio.retirar({ storagePath: RUTA, contentType: "image/png" })).resolves.toBeUndefined();
  });
});

describe("458-B/TB.10 — ver (R77, R78, R80)", () => {
  it("acceso total: URL firmada con el TTL de la config y el rotulo; NUNCA la ruta en claro fuera de la URL", async () => {
    const t = montar({ ya: true });
    const r = await t.servicio.ver(DESTINO, MAESTRO);
    expect(r).toEqual({
      status: "ok",
      url: "https://firmada/movimientos-caja/viejo.pdf?ttl=300",
      contentType: "application/pdf",
      rotulo: { fuente: "caja", categoria: "egreso_sueldo", fecha: "2026-09-12" },
    });
    expect(Object.keys(r)).not.toContain("storagePath");
  });

  it("sin comprobante: `sin_comprobante`; sin rol: `forbidden` antes de leer", async () => {
    expect(await montar().servicio.ver(DESTINO, MAESTRO)).toEqual({ status: "sin_comprobante" });
    const m = montar({ ya: true });
    expect(await m.servicio.ver(DESTINO, MENSAJERO)).toEqual({ status: "forbidden" });
    expect(m.clasificador.clasificar).not.toHaveBeenCalled();
  });

  it("R78: la tienda NO ve la caja ni el libro de un mensajero (`no_encontrado`, sin leer el comprobante)", async () => {
    for (const destino of [DESTINO, { libro: "mensajero", movimientoId: CAJA_ID }, { documento: "aporte_capital", id: CAJA_ID }] as DestinoMovimiento[]) {
      const t = montar({ ya: true });
      expect(await t.servicio.ver(destino, TIENDA)).toEqual({ status: "no_encontrado" });
      expect(t.urls.createSignedUrl).not.toHaveBeenCalled();
    }
  });

  it("R77: la tienda NO puede sondear un cobro por rechazo por su documento (seria `sin_comprobante` = existe)", async () => {
    const t = montar({ clase: { status: "ruta", camino: "rechazo_tienda_cobro", id: "cob-1" } });
    expect(await t.servicio.ver({ documento: "rechazo_tienda_cobro", id: CAJA_ID }, TIENDA)).toEqual({ status: "no_encontrado" });
    expect(t.clasificador.clasificar).not.toHaveBeenCalled();
  });

  it("R77: la tienda recibe LO MISMO por una fila ajena que por una inexistente", async () => {
    const destino: DestinoMovimiento = { libro: "tienda", movimientoId: CAJA_ID };
    const ajena = montar({ ya: true, clase: { status: "ruta", camino: "cobro_tienda", id: CAJA_ID } });
    ajena.repo.tiendaDeFila.mockResolvedValue("otra-tienda");
    const inexistente = montar({ ya: true });
    inexistente.repo.tiendaDeFila.mockResolvedValue(null);
    expect(await ajena.servicio.ver(destino, TIENDA)).toEqual({ status: "no_encontrado" });
    expect(await inexistente.servicio.ver(destino, TIENDA)).toEqual({ status: "no_encontrado" });
    expect(ajena.urls.createSignedUrl).not.toHaveBeenCalled();
  });

  it("R77: un documento de OTRA tienda por su id se responde `no_encontrado`", async () => {
    const t = montar({ clase: { status: "ruta", camino: "abono_tienda", id: "ab-1" } });
    t.repo.documento.mockResolvedValue({
      tiendaId: "otra-tienda",
      categoria: "abono_tienda",
      fecha: new Date("2026-09-12T00:00:00Z"),
      comprobante: { storagePath: "abonos-tienda/x.pdf", contentType: "application/pdf" },
    } as never);
    expect(await t.servicio.ver({ documento: "abono_tienda", id: "00000000-0000-4000-8000-0000000000ab" }, TIENDA)).toEqual({ status: "no_encontrado" });
  });

  it("R78: la tienda ve el comprobante de SU documento, fechado con el dia del documento", async () => {
    const t = montar({ clase: { status: "ruta", camino: "abono_tienda", id: "ab-1" } });
    t.repo.documento.mockResolvedValue({
      tiendaId: TIENDA.usuarioId,
      categoria: "abono_tienda",
      fecha: new Date("2026-09-12T00:00:00Z"),
      comprobante: { storagePath: "abonos-tienda/x.pdf", contentType: "application/pdf" },
    } as never);
    expect(await t.servicio.ver({ documento: "abono_tienda", id: "00000000-0000-4000-8000-0000000000ab" }, TIENDA)).toMatchObject({
      status: "ok",
      rotulo: { fuente: "documento", categoria: "abono_tienda", fecha: "2026-09-12" },
    });
  });
});

describe("458-B/TB.10 — las actions (sesion primero, forma despues)", () => {
  const servicio = (): IWalletComprobanteService => ({
    subir: vi.fn(),
    registrarEnTx: vi.fn(),
    retirar: vi.fn(),
    adjuntar: vi.fn(async () => ({ status: "ok" as const })),
    ver: vi.fn(async () => ({ status: "sin_comprobante" as const })),
  });

  function formData(campos: Record<string, string | Blob>): FormData {
    const fd = new FormData();
    for (const [k, v] of Object.entries(campos)) fd.append(k, v);
    return fd;
  }
  const archivo = () => new File([new Uint8Array([1, 2])], "c.png", { type: "image/png" });

  it("sin sesion `unauthenticated` sin tocar el servicio", async () => {
    const s = servicio();
    expect(await adjuntarComprobanteAction(formData({ destino: JSON.stringify(DESTINO), comprobante: archivo() }), { getActor: async () => null, service: s })).toEqual({ status: "unauthenticated" });
    expect(await verComprobanteAction({ destino: DESTINO }, { getActor: async () => null, service: s })).toEqual({ status: "unauthenticated" });
    expect(s.adjuntar).not.toHaveBeenCalled();
    expect(s.ver).not.toHaveBeenCalled();
  });

  it("adjuntar: el destino viaja como JSON; una clave de mas o un destino roto es `validation_error`", async () => {
    const s = servicio();
    const deps = { getActor: async () => MAESTRO, service: s };
    expect(await adjuntarComprobanteAction(formData({ destino: JSON.stringify(DESTINO), comprobante: archivo() }), deps)).toEqual({ status: "ok" });
    expect(s.adjuntar).toHaveBeenCalledWith(DESTINO, { contentType: "image/png", bytes: new Uint8Array([1, 2]) }, MAESTRO);
    expect(await adjuntarComprobanteAction(formData({ destino: "{no-json", comprobante: archivo() }), deps)).toMatchObject({ status: "validation_error" });
    expect(await adjuntarComprobanteAction(formData({ destino: JSON.stringify(DESTINO), comprobante: archivo(), monto: "1" }), deps)).toMatchObject({ status: "validation_error" });
    expect(await adjuntarComprobanteAction(formData({ destino: JSON.stringify(DESTINO), comprobante: new File(["x"], "c.txt", { type: "text/plain" }) }), deps)).toMatchObject({ status: "validation_error" });
    expect(s.adjuntar).toHaveBeenCalledTimes(1);
  });

  it("ver: `.strict()`", async () => {
    const s = servicio();
    const deps = { getActor: async () => TIENDA, service: s };
    expect(await verComprobanteAction({ destino: DESTINO }, deps)).toEqual({ status: "sin_comprobante" });
    expect(await verComprobanteAction({ destino: DESTINO, ruta: "x" }, deps)).toMatchObject({ status: "validation_error" });
  });
});
