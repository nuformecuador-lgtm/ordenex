import { describe, it, expect, vi } from "vitest";
import { WalletMensajeroService } from "@/lib/services/WalletMensajeroService";
import type {
  IPagoMensajeroMovimientoRepository,
  ListarPorMensajeroFiltros,
  ListarPorMensajeroPage,
} from "@/lib/interfaces/repositories/IPagoMensajeroMovimientoRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { PagoMensajeroMovimientoDTO } from "@/lib/types/wallet-mensajero";
import {
  listarPagosDeMensajeroCompletoSchema,
  listarPagosDeMensajeroSchema,
} from "@/lib/types/wallet-mensajero";
import { descargaConfig } from "@/lib/config/descarga";

// Feature 170 / T C.1 (R9/R11/R14/R17/R27/R29) — DESGLOSE de UN mensajero sin paginación
// (vista de los roles de acceso total).
//
// Aquí el alcance lo define el ROL, no un dato del actor: el `mensajeroId` viene del input
// porque el admin elige a quién mira. Lo que hay que vigilar, por tanto, es que el guard
// separe de verdad esta superficie de la propia del mensajero: un `mensajero` NO puede usar
// esta vía para pedir el desglose de un compañero (su superficie es `listarMisPagosCompleto`,
// que ignora el `mensajeroId` del input).

const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "a1", rol: "admin" };

/** Contraprueba de R17. El `mensajero` está aquí a propósito: es el caso que importa. */
const ROLES_SIN_ACCESO: Actor[] = [
  { usuarioId: "msg-A", rol: "mensajero" },
  { usuarioId: "t1", rol: "adminTienda" },
  { usuarioId: "s1", rol: "adminSatelite" },
  { usuarioId: "k1", rol: "apiKey" },
  { usuarioId: "x1", rol: "otroRolInventado" as Actor["rol"] },
];

const LIMITE = descargaConfig.MAX_FILAS;

function mov(
  over: Partial<PagoMensajeroMovimientoDTO> & { id: string; mensajeroId: string },
): PagoMensajeroMovimientoDTO {
  return {
    tipo: "devengo",
    categoria: "pago_devengado",
    monto: "1000.00",
    origenTipo: "cierre_dia",
    origenId: "c1",
    cierreId: "c1", // feature 205/R43: en un origen `cierre_dia`, el origen ES el cierre
    descripcion: null,
    fechaMovimiento: "2026-07-12T10:00:00.000Z",
    ...over,
  };
}

/** Repositorio en memoria que aplica el acotado por `mensajero_id` DE VERDAD. */
function repoEnMemoria(filas: PagoMensajeroMovimientoDTO[]) {
  const listarPorMensajero = vi.fn(
    async (f: ListarPorMensajeroFiltros): Promise<ListarPorMensajeroPage> => {
      const casan = filas
        .filter((m) => m.mensajeroId === f.mensajeroId)
        .filter((m) => (f.cierreId === undefined ? true : m.origenId === f.cierreId))
        .filter((m) => (f.desde === undefined ? true : new Date(m.fechaMovimiento) >= f.desde))
        .filter((m) => (f.hasta === undefined ? true : new Date(m.fechaMovimiento) <= f.hasta))
        .sort(
          (a, b) =>
            new Date(b.fechaMovimiento).getTime() - new Date(a.fechaMovimiento).getTime(),
        );
      const skip = (f.page - 1) * f.pageSize;
      return { movimientos: casan.slice(skip, skip + f.pageSize), total: casan.length };
    },
  );
  const agregarCuentaPorPagar = vi.fn(async () => ({ devengado: "0.00", pagado: "0.00" }));
  const obtenerNombreMensajero = vi.fn(async () => "Ana Mensajera");
  return {
    repo: {
      listarPorMensajero,
      agregarCuentaPorPagar,
      obtenerNombreMensajero,
    } as unknown as IPagoMensajeroMovimientoRepository,
    listarPorMensajero,
    agregarCuentaPorPagar,
    obtenerNombreMensajero,
  };
}

/** Stub que declara un `total` cualquiera sin materializar más de `pageSize` filas. */
function repoStub(total: number) {
  const listarPorMensajero = vi.fn(
    async (f: ListarPorMensajeroFiltros): Promise<ListarPorMensajeroPage> => ({
      movimientos: Array.from({ length: Math.min(total, f.pageSize) }, (_, i) =>
        mov({ id: `p${i}`, mensajeroId: f.mensajeroId }),
      ),
      total,
    }),
  );
  return {
    repo: { listarPorMensajero } as unknown as IPagoMensajeroMovimientoRepository,
    listarPorMensajero,
  };
}

/**
 * Los filtros que llegaron al repositorio, SIN el recorte de página. Es lo que permite
 * comparar el listado y la descarga: si estos dos objetos difieren en algo, el archivo
 * estaría enseñando un conjunto distinto del de la pantalla.
 */
function soloFiltros(params: object): Record<string, unknown> {
  const copia: Record<string, unknown> = { ...params };
  delete copia.page;
  delete copia.pageSize;
  return copia;
}

function servicio(repo: IPagoMensajeroMovimientoRepository) {
  return new WalletMensajeroService(repo);
}

function input(extra: Record<string, unknown> = {}) {
  return listarPagosDeMensajeroCompletoSchema.parse({ mensajeroId: "msg-A", ...extra });
}

function ids(items: PagoMensajeroMovimientoDTO[]): string[] {
  return items.map((m) => m.id);
}

function dosMensajeros(): PagoMensajeroMovimientoDTO[] {
  return [
    mov({ id: "A1", mensajeroId: "msg-A", fechaMovimiento: "2026-07-04T00:00:00.000Z" }),
    mov({ id: "A2", mensajeroId: "msg-A", fechaMovimiento: "2026-07-03T00:00:00.000Z" }),
    mov({ id: "B1", mensajeroId: "msg-B", fechaMovimiento: "2026-07-02T00:00:00.000Z" }),
  ];
}

describe("WalletMensajeroService.listarPagosDeMensajeroCompleto — desglose sin paginacion", () => {
  it("devuelve todos los movimientos del mensajero elegido, sin recorte por pagina (R9)", async () => {
    const filas = Array.from({ length: 95 }, (_, i) =>
      mov({
        id: `a${String(i).padStart(3, "0")}`,
        mensajeroId: "msg-A",
        fechaMovimiento: `2026-07-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
      }),
    );
    const svc = servicio(repoEnMemoria(filas).repo);

    const paginado = await svc.listarPagosDeMensajero(
      listarPagosDeMensajeroSchema.parse({ mensajeroId: "msg-A", pageSize: 20 }),
      MAESTRO,
    );
    const completo = await svc.listarPagosDeMensajeroCompleto(input(), MAESTRO);

    expect(paginado.status).toBe("ok");
    if (paginado.status !== "ok") return;
    expect(paginado.data.movimientos).toHaveLength(20);

    expect(completo.status).toBe("ok");
    if (completo.status !== "ok") return;
    expect(completo.items).toHaveLength(95);
    expect(completo.total).toBe(95);
  });

  it("el desglose de un mensajero no trae ni una fila de otro (R14)", async () => {
    const a = await servicio(
      repoEnMemoria(dosMensajeros()).repo,
    ).listarPagosDeMensajeroCompleto(input({ mensajeroId: "msg-A" }), MAESTRO);
    expect(a.status).toBe("ok");
    if (a.status !== "ok") return;
    expect(ids(a.items)).toEqual(["A1", "A2"]);

    const b = await servicio(
      repoEnMemoria(dosMensajeros()).repo,
    ).listarPagosDeMensajeroCompleto(input({ mensajeroId: "msg-B" }), MAESTRO);
    expect(b.status).toBe("ok");
    if (b.status !== "ok") return;
    expect(ids(b.items)).toEqual(["B1"]);

    // Los dos conjuntos son NO VACÍOS y disjuntos.
    expect(ids(a.items).some((id) => ids(b.items).includes(id))).toBe(false);
  });

  it("un mensajero NO puede pedir por esta via el desglose de nadie, ni el suyo (R14/R17)", async () => {
    // Es el caso que separa las dos superficies: la propia del mensajero es
    // `listarMisPagosCompleto`, que ignora el `mensajeroId` del input. Ésta es del admin.
    const { repo, listarPorMensajero } = repoEnMemoria(dosMensajeros());
    const r = await servicio(repo).listarPagosDeMensajeroCompleto(input({ mensajeroId: "msg-B" }), {
      usuarioId: "msg-A",
      rol: "mensajero",
    });

    expect(r).toEqual({ status: "forbidden" });
    expect(r).not.toHaveProperty("items");
    expect(listarPorMensajero).not.toHaveBeenCalled();
  });

  it("devuelve forbidden y ninguna fila a todo rol sin acceso total (R17)", async () => {
    for (const actor of ROLES_SIN_ACCESO) {
      const { repo, listarPorMensajero } = repoEnMemoria(dosMensajeros());
      const r = await servicio(repo).listarPagosDeMensajeroCompleto(input(), actor);

      expect(r, `rol ${actor.rol}`).toEqual({ status: "forbidden" });
      expect(r, `rol ${actor.rol}`).not.toHaveProperty("items");
      expect(listarPorMensajero, `rol ${actor.rol}`).not.toHaveBeenCalled();
    }
  });

  it("CONTRAPRUEBA de R17: maestro y admin SI reciben las filas", async () => {
    for (const actor of [MAESTRO, ADMIN]) {
      const { repo, listarPorMensajero } = repoEnMemoria(dosMensajeros());
      const r = await servicio(repo).listarPagosDeMensajeroCompleto(input(), actor);

      expect(r.status, `rol ${actor.rol}`).toBe("ok");
      if (r.status !== "ok") return;
      expect(ids(r.items)).toEqual(["A1", "A2"]);
      expect(listarPorMensajero).toHaveBeenCalledTimes(1);
    }
  });

  it("aplica EXACTAMENTE los mismos filtros que el listado (R14)", async () => {
    const filas = [
      mov({
        id: "A-c1",
        mensajeroId: "msg-A",
        origenId: "cierre-1",
        fechaMovimiento: "2026-07-10T00:00:00.000Z",
      }),
      mov({
        id: "A-c2",
        mensajeroId: "msg-A",
        origenId: "cierre-2",
        fechaMovimiento: "2026-07-11T00:00:00.000Z",
      }),
    ];
    const { repo, listarPorMensajero } = repoEnMemoria(filas);
    const svc = servicio(repo);

    const filtros = { mensajeroId: "msg-A", cierreId: "cierre-2" };

    const paginado = await svc.listarPagosDeMensajero(
      listarPagosDeMensajeroSchema.parse({ ...filtros, pageSize: 50 }),
      MAESTRO,
    );
    const completo = await svc.listarPagosDeMensajeroCompleto(input(filtros), MAESTRO);

    expect(paginado.status).toBe("ok");
    expect(completo.status).toBe("ok");
    if (paginado.status !== "ok" || completo.status !== "ok") return;
    expect(ids(completo.items)).toEqual(["A-c2"]);
    expect(ids(completo.items)).toEqual(ids(paginado.data.movimientos));

    expect(soloFiltros(listarPorMensajero.mock.calls[1][0])).toEqual(
      soloFiltros(listarPorMensajero.mock.calls[0][0]),
    );
  });

  it("mantiene el orden mas reciente primero, igual que el listado (R11)", async () => {
    const svc = servicio(repoEnMemoria(dosMensajeros()).repo);

    const paginado = await svc.listarPagosDeMensajero(
      listarPagosDeMensajeroSchema.parse({ mensajeroId: "msg-A" }),
      MAESTRO,
    );
    const completo = await svc.listarPagosDeMensajeroCompleto(input(), MAESTRO);

    expect(paginado.status).toBe("ok");
    expect(completo.status).toBe("ok");
    if (paginado.status !== "ok" || completo.status !== "ok") return;
    expect(ids(completo.items)).toEqual(["A1", "A2"]);
    expect(ids(completo.items)).toEqual(ids(paginado.data.movimientos));
  });

  it("devuelve limite_excedido con total y limite, y sin filas, cuando el total supera el tope (R27)", async () => {
    const { repo } = repoStub(LIMITE + 1);
    const r = await servicio(repo).listarPagosDeMensajeroCompleto(input(), MAESTRO);

    expect(r).toEqual({ status: "limite_excedido", total: LIMITE + 1, limite: LIMITE });
    expect(r).not.toHaveProperty("items");
  });

  it("nunca pide al repositorio mas de N+1 filas (R29)", async () => {
    const { repo, listarPorMensajero } = repoStub(50_000);
    const r = await servicio(repo).listarPagosDeMensajeroCompleto(input(), MAESTRO);

    const filtros = listarPorMensajero.mock.calls[0][0];
    expect(filtros.page).toBe(1); // => skip 0
    expect(filtros.pageSize).toBe(LIMITE + 1); // => take N+1
    expect(r.status).toBe("limite_excedido");
  });

  it("no relee el nombre del mensajero ni su cuenta por pagar: son cabecera (R32)", async () => {
    const { repo, agregarCuentaPorPagar, obtenerNombreMensajero } = repoEnMemoria(
      dosMensajeros(),
    );
    await servicio(repo).listarPagosDeMensajeroCompleto(input(), MAESTRO);

    expect(agregarCuentaPorPagar).not.toHaveBeenCalled();
    expect(obtenerNombreMensajero).not.toHaveBeenCalled();
  });
});
