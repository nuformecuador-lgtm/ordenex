import { describe, it, expect, vi } from "vitest";

import type { IAjusteCajaAnulacionRepository } from "@/lib/interfaces/repositories/IAjusteCajaAnulacionRepository";
import type {
  FilaDeLibroParaAnular,
  FilaDeMensajeroParaAnular,
  IWalletAnulacionDestinoRepository,
} from "@/lib/interfaces/repositories/IWalletAnulacionDestinoRepository";
import type {
  CrearMovimientoInput,
  IWalletMovimientoRepository,
} from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IWalletAnulacionService } from "@/lib/interfaces/services/IWalletAnulacionService";
import { EgresoCajaAnulacionService } from "@/lib/services/EgresoCajaAnulacionService";
import { WalletAnulacionService } from "@/lib/services/WalletAnulacionService";
import { anularMovimientoAction } from "@/lib/actions/wallet-anulacion";
import type { WalletMovimientoDTO } from "@/lib/types/wallet";
import { NATURALEZA_POR_CATEGORIA } from "@/lib/utils/caja-tesoreria";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 458-B / TB.9 (R63–R67, R72, R82) — la anulacion con motivo de un EGRESO de caja y la accion
// UNICA que enruta cada destino a su camino, con dobles.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// Lo que decide el SERVICIO: el orden (rol → leer → transaccion), que egreso se anula, que el
// contra-asiento es un `ingreso_ajuste` por el monto DEL ORIGINAL —nunca de la peticion—, con que
// origen (el egreso o el incidente, D8), fechado con el reloj inyectado, y que un «ya estaba» no deja
// rastro. Lo que decide la BASE (UNIQUE, R7/R8 al centimo, el `documento` del libro, dos a la vez)
// se mide en `tests/integration/db/wallet-anulacion-458.test.ts` y `…-concurrencia.test.ts`.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "u-admin", rol: "admin" };
const TIENDA: Actor = { usuarioId: "u-tienda", rol: "adminTienda" };
const MENSAJERO: Actor = { usuarioId: "u-mensajero", rol: "mensajero" };
const SATELITE: Actor = { usuarioId: "u-sat", rol: "adminSatelite", zonaId: "z" };
const AHORA = new Date("2026-09-26T14:15:33.123Z");

function mov(over: Partial<WalletMovimientoDTO> = {}): WalletMovimientoDTO {
  const base = {
    id: "egr-1",
    tipo: "egreso" as const,
    categoria: "egreso_sueldo" as const,
    monto: "45000.00",
    origenTipo: "gasto" as const,
    origenId: null,
    descripcion: "Sueldo quincena",
    registradoPor: "u-maestro",
    fechaMovimiento: "2026-09-20T15:00:00.000Z",
    ...over,
  };
  return { ...base, dueno: NATURALEZA_POR_CATEGORIA[base.categoria], documento: null };
}

function montaje(
  egreso: WalletMovimientoDTO | null = mov(),
  opciones: { constancia?: "anulado" | "ya_anulado"; escritas?: number } = {},
) {
  const TX = { marca: "tx-458" };
  const walletRepo = {
    obtenerPorId: vi.fn(async () => egreso),
    crearMovimientos: vi.fn(async (_tx: unknown, movs: CrearMovimientoInput[]) => opciones.escritas ?? movs.length),
  } as unknown as Pick<IWalletMovimientoRepository, "obtenerPorId" | "crearMovimientos">;
  const anulaciones: Pick<IAjusteCajaAnulacionRepository, "anularEgreso"> = {
    anularEgreso: vi.fn(async () => ({ status: opciones.constancia ?? "anulado" })),
  };
  const runTransaction = vi.fn(async (fn: (tx: never) => Promise<unknown>) => fn(TX as never));
  const servicio = new EgresoCajaAnulacionService(walletRepo, anulaciones, runTransaction as never, () => AHORA);
  return { servicio, walletRepo, anulaciones, runTransaction, TX };
}

const PETICION = { movimientoId: "egr-1", motivo: "Se pagó dos veces" };

describe("458-B — EgresoCajaAnulacionService.anular (R63–R67, R82)", () => {
  it("R82: sin acceso total responde `forbidden` ANTES de leer nada (tienda, mensajero, satelite)", async () => {
    for (const actor of [TIENDA, MENSAJERO, SATELITE]) {
      const m = montaje();
      expect(await m.servicio.anular(PETICION, actor)).toEqual({ status: "forbidden" });
      expect(m.walletRepo.obtenerPorId).not.toHaveBeenCalled();
      expect(m.runTransaction).not.toHaveBeenCalled();
    }
  });

  it("R63: maestro y admin anulan un sueldo: constancia en la tx y contra-asiento `ingreso_ajuste` por el monto DEL EGRESO", async () => {
    for (const actor of [MAESTRO, ADMIN]) {
      const m = montaje();
      expect(await m.servicio.anular(PETICION, actor)).toEqual({ status: "ok" });
      expect(m.anulaciones.anularEgreso).toHaveBeenCalledWith(m.TX, {
        movimientoId: "egr-1",
        motivo: "Se pagó dos veces",
        anuladoPor: actor.usuarioId,
      });
      expect(m.walletRepo.crearMovimientos).toHaveBeenCalledWith(m.TX, [
        {
          tipo: "ingreso",
          categoria: "ingreso_ajuste",
          monto: "45000.00", // el del egreso: la peticion no trae monto
          origenTipo: "gasto",
          origenId: "egr-1", // el egreso: el mismo indice unico que el reverso de siempre
          descripcion: "Anulación de: Sueldo quincena",
          registradoPor: actor.usuarioId,
          fechaMovimiento: AHORA, // R64: el instante inyectado
        },
      ]);
    }
  });

  it("R4: sin descripcion, el contra-asiento se nombra por el egreso y NUNCA por su uuid", async () => {
    const m = montaje(mov({ descripcion: null, categoria: "egreso_gasto_fijo" }));
    await m.servicio.anular(PETICION, MAESTRO);
    const fila = (m.walletRepo.crearMovimientos as unknown as { mock: { calls: [unknown, CrearMovimientoInput[]][] } })
      .mock.calls[0][1][0];
    expect(fila.descripcion).toBe("Anulación de: Gasto fijo de Ordenex");
    expect(fila.descripcion).not.toContain("egr-1");
  });

  it("D8: la indemnizacion por incidente se anula con origen EL INCIDENTE", async () => {
    const m = montaje(
      mov({ categoria: "egreso_indemnizacion", origenTipo: "orden_incidente", origenId: "inc-9", monto: "6500.00", descripcion: null }),
    );
    expect(await m.servicio.anular(PETICION, MAESTRO)).toEqual({ status: "ok" });
    const fila = (m.walletRepo.crearMovimientos as unknown as { mock: { calls: [unknown, CrearMovimientoInput[]][] } })
      .mock.calls[0][1][0];
    expect(fila).toMatchObject({
      categoria: "ingreso_ajuste",
      monto: "6500.00",
      origenTipo: "orden_incidente",
      origenId: "inc-9",
      descripcion: "Anulación de: Indemnización que Ordenex paga por un incidente",
    });
  });

  it("R65: lo que no es un egreso anulable responde `no_encontrado` sin abrir la transaccion", async () => {
    const noAnulables = [
      null,
      mov({ tipo: "ingreso", categoria: "ingreso_ajuste", origenId: "egr-0" }), // un reverso
      mov({ categoria: "egreso_indemnizacion", origenTipo: "cierre_dia", origenId: "c-1" }), // la del cierre
      mov({ categoria: "egreso_ajuste", origenTipo: "manual" }), // una correccion (461)
      mov({ categoria: "egreso_pago_tienda", origenTipo: "pago_tienda", origenId: "p-1" }),
    ];
    for (const e of noAnulables) {
      const m = montaje(e);
      expect(await m.servicio.anular(PETICION, MAESTRO)).toEqual({ status: "no_encontrado" });
      expect(m.runTransaction).not.toHaveBeenCalled();
    }
  });

  it("R66/R67: con constancia ya escrita (`count = 0`) responde `ya_anulado` y NO escribe el contra-asiento", async () => {
    const m = montaje(mov(), { constancia: "ya_anulado" });
    expect(await m.servicio.anular(PETICION, MAESTRO)).toEqual({ status: "ya_anulado" });
    expect(m.walletRepo.crearMovimientos).not.toHaveBeenCalled();
  });

  it("R72: si el egreso ya tenia su reverso SIN constancia (via vieja), responde `ya_anulado` y la transaccion se revierte", async () => {
    const m = montaje(mov(), { escritas: 0 });
    expect(await m.servicio.anular(PETICION, MAESTRO)).toEqual({ status: "ya_anulado" });
    // La transaccion lanzo (y en la base se revierte, constancia incluida): lo mide el test de integracion.
    await expect(m.runTransaction.mock.results[0].value).rejects.toThrow(/ya anulado/);
  });
});

// ── La accion unica: el enrutado ────────────────────────────────────────────────────────────

function fila(over: Partial<FilaDeLibroParaAnular> = {}): FilaDeLibroParaAnular {
  return { id: "m-1", tipo: "egreso", categoria: "egreso_sueldo", origenTipo: "gasto", origenId: null, ...over };
}

function router(filas: {
  caja?: FilaDeLibroParaAnular | null;
  tienda?: FilaDeLibroParaAnular | null;
  mensajero?: FilaDeMensajeroParaAnular | null;
  cobroDeGestion?: string | null;
  podio?: string | null;
}) {
  const repo: IWalletAnulacionDestinoRepository = {
    filaDeCaja: vi.fn(async () => filas.caja ?? null),
    filaDeTienda: vi.fn(async () => filas.tienda ?? null),
    filaDeMensajero: vi.fn(async () => filas.mensajero ?? null),
    cobroRechazoDeGestion: vi.fn(async () => filas.cobroDeGestion ?? null),
    filaDelPodio: vi.fn(async () => filas.podio ?? null),
  };
  return { repo, servicio: new WalletAnulacionService(repo) };
}

const CAJA = (movimientoId = "m-1") => ({ libro: "caja" as const, movimientoId });

describe("458-B — WalletAnulacionService.enrutar: cada destino a SU camino (design §4.2, R63/R65/R82)", () => {
  it("R82: sin acceso total responde `forbidden` ANTES de leer ninguna fila", async () => {
    const r = router({ caja: fila() });
    expect(await r.servicio.enrutar(CAJA(), TIENDA)).toEqual({ status: "forbidden" });
    expect(r.repo.filaDeCaja).not.toHaveBeenCalled();
  });

  it("caja: cada original a su camino, con el id que su action espera", async () => {
    const casos: [FilaDeLibroParaAnular, string, string][] = [
      [fila(), "egreso_caja", "m-1"],
      [fila({ categoria: "egreso_gasto_fijo", origenId: "gf-1" }), "egreso_caja", "m-1"],
      [fila({ categoria: "egreso_indemnizacion", origenTipo: "orden_incidente", origenId: "inc" }), "egreso_caja", "m-1"],
      [fila({ tipo: "ingreso", categoria: "ingreso_ajuste", origenTipo: "manual" }), "ajuste_caja", "m-1"],
      [fila({ tipo: "ingreso", categoria: "ingreso_cobro_tienda", origenTipo: "cobro_tienda", origenId: "deb" }), "cobro_tienda", "deb"],
      [fila({ tipo: "ingreso", categoria: "ingreso_cobro_tienda", origenTipo: "cobro_tienda_completado", origenId: "deb2" }), "cobro_tienda", "deb2"],
      [fila({ categoria: "egreso_pago_por_cuenta_tienda", origenTipo: "pago_por_cuenta_tienda", origenId: "ppc" }), "pago_por_cuenta_tienda", "ppc"],
      [fila({ tipo: "ingreso", categoria: "ingreso_aporte_capital", origenTipo: "aporte_capital", origenId: "ap" }), "aporte_capital", "ap"],
      [fila({ tipo: "ingreso", categoria: "ingreso_abono_tienda", origenTipo: "abono_tienda", origenId: "ab" }), "abono_tienda", "ab"],
      [fila({ categoria: "egreso_pago_tienda", origenTipo: "pago_tienda", origenId: "pt" }), "liquidacion_pago", "pt"],
      [fila({ categoria: "egreso_pago_mensajero", origenTipo: "ranking_snapshot_fila", origenId: "fila" }), "premio_del_ranking", "fila"],
    ];
    for (const [f, camino, id] of casos) {
      const r = router({ caja: f });
      expect(await r.servicio.enrutar(CAJA(), MAESTRO), `${f.categoria}/${f.origenTipo}`).toEqual({
        status: "ruta",
        camino,
        id,
      });
    }
  });

  it("caja: las DOS lineas del cobro por rechazo van al MISMO cobro, buscado por su gestion", async () => {
    for (const categoria of ["ingreso_flete_devolucion", "ingreso_iva_flete_devolucion"]) {
      const r = router({ caja: fila({ tipo: "ingreso", categoria, origenTipo: "gestion_orden", origenId: "ges-1" }), cobroDeGestion: "cob-1" });
      expect(await r.servicio.enrutar(CAJA(), ADMIN)).toEqual({ status: "ruta", camino: "rechazo_tienda_cobro", id: "cob-1" });
      expect(r.repo.cobroRechazoDeGestion).toHaveBeenCalledWith("ges-1");
    }
  });

  it("R65: lo que produce un cierre, lo reclasificado y los contra-asientos NO se anulan, con su motivo", async () => {
    const casos: [FilaDeLibroParaAnular, string][] = [
      [fila({ tipo: "ingreso", categoria: "ingreso_flete", origenTipo: "cierre_dia", origenId: "c" }), "nace_de_un_cierre"],
      [fila({ categoria: "egreso_indemnizacion", origenTipo: "cierre_dia", origenId: "c" }), "nace_de_un_cierre"],
      [fila({ categoria: "egreso_pago_por_cuenta_tienda", origenTipo: "cobro_manual_reclasificado", origenId: "r" }), "reclasificado"],
      [fila({ tipo: "ingreso", categoria: "ingreso_ajuste", origenTipo: "gasto", origenId: "egr" }), "contra_asiento"],
      [fila({ tipo: "ingreso", categoria: "ingreso_ajuste", origenTipo: "orden_incidente", origenId: "inc" }), "contra_asiento"],
      [fila({ tipo: "ingreso", categoria: "ingreso_ajuste", origenTipo: "manual", origenId: "corr" }), "contra_asiento"],
      [fila({ categoria: "egreso_reverso_flete_devolucion", origenTipo: "gestion_orden", origenId: "g" }), "contra_asiento"],
      [fila({ tipo: "ingreso", categoria: "ingreso_reverso_pago_tienda", origenTipo: "pago_tienda", origenId: "p" }), "contra_asiento"],
    ];
    for (const [f, motivo] of casos) {
      const r = router({ caja: f });
      expect(await r.servicio.enrutar(CAJA(), MAESTRO), `${f.categoria}/${f.origenTipo}`).toEqual({
        status: "no_anulable",
        motivo,
      });
    }
  });

  it("tienda: el cobro por la propia fila; pagos, pagos de un gasto y abonos por su documento; los contra-asientos no", async () => {
    const tienda = (over: Partial<FilaDeLibroParaAnular>) => fila({ tipo: "debito", ...over });
    const casos: [FilaDeLibroParaAnular, unknown][] = [
      [tienda({ id: "c-1", categoria: "cobro_manual", origenTipo: "manual" }), { status: "ruta", camino: "cobro_tienda", id: "c-1" }],
      [tienda({ categoria: "pago_tienda", origenTipo: "pago_tienda", origenId: "pt" }), { status: "ruta", camino: "liquidacion_pago", id: "pt" }],
      [tienda({ categoria: "pago_por_cuenta", origenTipo: "pago_por_cuenta_tienda", origenId: "ppc" }), { status: "ruta", camino: "pago_por_cuenta_tienda", id: "ppc" }],
      [tienda({ tipo: "credito", categoria: "abono_tienda", origenTipo: "abono_tienda", origenId: "ab" }), { status: "ruta", camino: "abono_tienda", id: "ab" }],
      [tienda({ categoria: "flete", origenTipo: "cierre_dia", origenId: "c" }), { status: "no_anulable", motivo: "nace_de_un_cierre" }],
      [tienda({ tipo: "credito", categoria: "cobro_tienda_anulado", origenTipo: "cobro_tienda", origenId: "c-1" }), { status: "no_anulable", motivo: "contra_asiento" }],
      [tienda({ tipo: "credito", categoria: "flete_devolucion_anulado", origenTipo: "gestion_orden", origenId: "g" }), { status: "no_anulable", motivo: "contra_asiento" }],
    ];
    for (const [f, esperado] of casos) {
      const r = router({ tienda: f });
      expect(await r.servicio.enrutar({ libro: "tienda", movimientoId: f.id }, MAESTRO), f.categoria).toEqual(esperado);
    }
    const rechazo = router({ tienda: tienda({ categoria: "flete_devolucion", origenTipo: "gestion_orden", origenId: "g" }), cobroDeGestion: "cob" });
    expect(await rechazo.servicio.enrutar({ libro: "tienda", movimientoId: "x" }, MAESTRO)).toEqual({
      status: "ruta",
      camino: "rechazo_tienda_cobro",
      id: "cob",
    });
  });

  it("mensajero: el pago por su documento, el premio por la fila del podio de SU dia; el cierre y los reversos no", async () => {
    const m = (over: Partial<FilaDeMensajeroParaAnular>): FilaDeMensajeroParaAnular => ({
      ...fila({ tipo: "pago", categoria: "liquidacion", origenTipo: "pago_mensajero", origenId: "lp" }),
      mensajeroId: "men",
      premioDia: null,
      ...over,
    });
    const dia = new Date("2026-09-01T00:00:00.000Z");
    const pago = router({ mensajero: m({}) });
    expect(await pago.servicio.enrutar({ libro: "mensajero", movimientoId: "x" }, MAESTRO)).toEqual({ status: "ruta", camino: "liquidacion_pago", id: "lp" });
    const premio = router({ mensajero: m({ tipo: "devengo", categoria: "otro", origenTipo: "cierre_dia", premioDia: dia }), podio: "fila-1" });
    expect(await premio.servicio.enrutar({ libro: "mensajero", movimientoId: "x" }, MAESTRO)).toEqual({ status: "ruta", camino: "premio_del_ranking", id: "fila-1" });
    expect(premio.repo.filaDelPodio).toHaveBeenCalledWith("men", dia);
    const reversoPremio = router({ mensajero: m({ tipo: "pago", categoria: "ajuste_pago", origenTipo: "cierre_dia", premioDia: dia }) });
    expect(await reversoPremio.servicio.enrutar({ libro: "mensajero", movimientoId: "x" }, MAESTRO)).toEqual({ status: "no_anulable", motivo: "contra_asiento" });
    const cierre = router({ mensajero: m({ tipo: "devengo", categoria: "pago_devengado", origenTipo: "cierre_dia", origenId: "c" }) });
    expect(await cierre.servicio.enrutar({ libro: "mensajero", movimientoId: "x" }, MAESTRO)).toEqual({ status: "no_anulable", motivo: "nace_de_un_cierre" });
  });

  it("un documento se enruta por su tipo sin leer ninguna fila; una fila inexistente responde `no_encontrado`", async () => {
    const r = router({});
    expect(await r.servicio.enrutar({ documento: "rechazo_tienda_cobro", id: "cob" }, MAESTRO)).toEqual({
      status: "ruta",
      camino: "rechazo_tienda_cobro",
      id: "cob",
    });
    expect(r.repo.filaDeCaja).not.toHaveBeenCalled();
    expect(await r.servicio.enrutar(CAJA("nada"), MAESTRO)).toEqual({ status: "no_encontrado" });
  });
});

describe("458-B — anularMovimientoAction: el borde y la respuesta normalizada", () => {
  const enrutadorA = (camino: "egreso_caja" | "liquidacion_pago" | "premio_del_ranking"): IWalletAnulacionService => ({
    enrutar: vi.fn(async () => ({ status: "ruta" as const, camino, id: "doc-1" })),
  });

  it("sin sesion responde `unauthenticated` sin tocar el enrutador", async () => {
    const router = enrutadorA("egreso_caja");
    const r = await anularMovimientoAction(
      { destino: CAJA("00000000-0000-4000-8000-000000000001"), motivo: "x" },
      { getActor: async () => null, router },
    );
    expect(r).toEqual({ status: "unauthenticated" });
    expect(router.enrutar).not.toHaveBeenCalled();
  });

  it("`.strict()`: un `monto` colado (o un destino sin uuid) es `validation_error` sin enrutar", async () => {
    const router = enrutadorA("egreso_caja");
    const deps = { getActor: async () => MAESTRO, router };
    const conMonto = await anularMovimientoAction(
      { destino: CAJA("00000000-0000-4000-8000-000000000001"), motivo: "x", monto: "1.00" },
      deps,
    );
    expect(conMonto.status).toBe("validation_error");
    const sinUuid = await anularMovimientoAction({ destino: CAJA("no-es-un-id"), motivo: "x" }, deps);
    expect(sinUuid.status).toBe("validation_error");
    const sinMotivo = await anularMovimientoAction({ destino: CAJA("00000000-0000-4000-8000-000000000001"), motivo: "   " }, deps);
    expect(sinMotivo.status).toBe("validation_error");
    expect(router.enrutar).not.toHaveBeenCalled();
  });

  it("llama a la action del camino con el id del documento, el motivo y el MISMO actor, y normaliza cada dialecto", async () => {
    const tabla: [string, unknown][] = [
      ["ok", { status: "ok", camino: "liquidacion_pago" }],
      ["ya_anulado", { status: "ya_anulado", camino: "liquidacion_pago" }],
      ["already_reversed", { status: "ya_anulado", camino: "liquidacion_pago" }],
      ["not_found", { status: "no_encontrado" }],
      ["no_registrado", { status: "no_encontrado" }],
      ["forbidden", { status: "forbidden" }],
    ];
    for (const [estado, esperado] of tabla) {
      const accion = vi.fn(async () => ({ status: estado }));
      const r = await anularMovimientoAction(
        { destino: CAJA("00000000-0000-4000-8000-000000000001"), motivo: "Duplicado" },
        { getActor: async () => MAESTRO, router: enrutadorA("liquidacion_pago"), caminos: { liquidacion_pago: accion } },
      );
      expect(r, estado).toEqual(esperado);
      expect(accion).toHaveBeenCalledWith("doc-1", "Duplicado", MAESTRO);
    }
  });

  it("`no_anulable` conserva el motivo conocido y cae en `no_es_anulable` si no lo conoce; un estado desconocido LANZA", async () => {
    const base = { getActor: async () => MAESTRO, router: enrutadorA("egreso_caja") };
    const destino = { destino: CAJA("00000000-0000-4000-8000-000000000001"), motivo: "x" };
    expect(
      await anularMovimientoAction(destino, { ...base, caminos: { egreso_caja: async () => ({ status: "no_anulable", motivo: "sin_linea_de_caja" }) } }),
    ).toEqual({ status: "no_anulable", motivo: "sin_linea_de_caja" });
    expect(
      await anularMovimientoAction(destino, { ...base, caminos: { egreso_caja: async () => ({ status: "no_anulable", motivo: "otro" }) } }),
    ).toEqual({ status: "no_anulable", motivo: "no_es_anulable" });
    // El borde lo envuelve como INTERNAL y lo relanza (un 500), nunca lo convierte en una respuesta.
    await expect(
      anularMovimientoAction(destino, { ...base, caminos: { egreso_caja: async () => ({ status: "inventado" }) } }),
    ).rejects.toThrow(/INTERNAL/);
  });

  it("R82: un rol sin acceso total recibe `forbidden` del enrutador y NINGUN camino se ejecuta", async () => {
    const accion = vi.fn(async () => ({ status: "ok" }));
    const r = await anularMovimientoAction(
      { destino: CAJA("00000000-0000-4000-8000-000000000001"), motivo: "x" },
      { getActor: async () => TIENDA, router: new WalletAnulacionService(router({ caja: fila() }).repo), caminos: { egreso_caja: accion } },
    );
    expect(r).toEqual({ status: "forbidden" });
    expect(accion).not.toHaveBeenCalled();
  });
});
