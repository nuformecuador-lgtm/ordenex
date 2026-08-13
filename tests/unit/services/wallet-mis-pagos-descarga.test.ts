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
  listarMisPagosCompletoSchema,
  listarPagosMensajeroSchema,
} from "@/lib/types/wallet-mensajero";
import { descargaConfig } from "@/lib/config/descarga";

// Feature 170 / T C.1 (R9/R11/R14/R15/R17/R27/R29) — MIS PAGOS del mensajero sin paginación.
//
// PUNTO CALIENTE, gemelo del ledger de la tienda: el alcance lo define un DATO del actor
// (`mensajero_id = actor.usuarioId`), no su rol. Un fallo entrega los pagos de OTRO
// mensajero. Por eso R14 se prueba con los DOS mensajeros (cada uno ve el suyo, ninguno
// vacío) y R15 con un `mensajeroId` inyectado, que es la clave que este schema SÍ admite.

const MENSAJERO_A: Actor = { usuarioId: "msg-A", rol: "mensajero" };
const MENSAJERO_B: Actor = { usuarioId: "msg-B", rol: "mensajero" };

/** Contraprueba de R17: esta superficie es SOLO del mensajero; ni el maestro entra. */
const ROLES_SIN_ACCESO: Actor[] = [
  { usuarioId: "m1", rol: "maestro" },
  { usuarioId: "a1", rol: "admin" },
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
        .filter((m) => m.mensajeroId === f.mensajeroId) // acotado (WHERE del repo real)
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
  return {
    repo: {
      listarPorMensajero,
      agregarCuentaPorPagar,
    } as unknown as IPagoMensajeroMovimientoRepository,
    listarPorMensajero,
    agregarCuentaPorPagar,
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
  return listarMisPagosCompletoSchema.parse(extra);
}

function ids(items: PagoMensajeroMovimientoDTO[]): string[] {
  return items.map((m) => m.id);
}

/** Dos mensajeros con movimientos propios: el fixture de las pruebas de fuga. */
function dosMensajeros(): PagoMensajeroMovimientoDTO[] {
  return [
    mov({ id: "A1", mensajeroId: "msg-A", fechaMovimiento: "2026-07-04T00:00:00.000Z" }),
    mov({ id: "A2", mensajeroId: "msg-A", fechaMovimiento: "2026-07-03T00:00:00.000Z" }),
    mov({ id: "B1", mensajeroId: "msg-B", fechaMovimiento: "2026-07-02T00:00:00.000Z" }),
    mov({ id: "B2", mensajeroId: "msg-B", fechaMovimiento: "2026-07-01T00:00:00.000Z" }),
  ];
}

describe("WalletMensajeroService.listarMisPagosCompleto — mis pagos sin paginacion", () => {
  it("devuelve todos los movimientos propios, sin recorte por pagina (R9)", async () => {
    const filas = Array.from({ length: 110 }, (_, i) =>
      mov({
        id: `a${String(i).padStart(3, "0")}`,
        mensajeroId: "msg-A",
        fechaMovimiento: `2026-07-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
      }),
    );
    const svc = servicio(repoEnMemoria(filas).repo);

    const paginado = await svc.listarMisPagos(
      listarPagosMensajeroSchema.parse({ pageSize: 20 }),
      MENSAJERO_A,
    );
    const completo = await svc.listarMisPagosCompleto(input(), MENSAJERO_A);

    expect(paginado.status).toBe("ok");
    if (paginado.status !== "ok") return;
    expect(paginado.data.movimientos).toHaveLength(20);

    expect(completo.status).toBe("ok");
    if (completo.status !== "ok") return;
    expect(completo.items).toHaveLength(110);
    expect(completo.total).toBe(110);
  });

  it("el archivo del mensajero A no trae ni una fila del mensajero B, y viceversa (R14)", async () => {
    const a = await servicio(repoEnMemoria(dosMensajeros()).repo).listarMisPagosCompleto(
      input(),
      MENSAJERO_A,
    );
    expect(a.status).toBe("ok");
    if (a.status !== "ok") return;
    expect(ids(a.items)).toEqual(["A1", "A2"]);

    const b = await servicio(repoEnMemoria(dosMensajeros()).repo).listarMisPagosCompleto(
      input(),
      MENSAJERO_B,
    );
    expect(b.status).toBe("ok");
    if (b.status !== "ok") return;
    expect(ids(b.items)).toEqual(["B1", "B2"]);

    // Ambos conjuntos son NO VACÍOS y disjuntos: el test no pasa por estar todo vacío.
    expect(ids(a.items).some((id) => ids(b.items).includes(id))).toBe(false);
  });

  it("un mensajeroId inyectado en el input NO amplia el alcance (R15)", async () => {
    // Este schema SÍ admite `mensajeroId` (se hereda del listado, por paridad): la garantía
    // no está en rechazarlo sino en que el servicio jamás lo lee en la vista propia.
    const { repo, listarPorMensajero } = repoEnMemoria(dosMensajeros());
    const r = await servicio(repo).listarMisPagosCompleto(
      input({ mensajeroId: "msg-B" }),
      MENSAJERO_A,
    );

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(ids(r.items)).toEqual(["A1", "A2"]);
    expect(ids(r.items)).not.toContain("B1");
    expect(listarPorMensajero.mock.calls[0][0].mensajeroId).toBe("msg-A");
  });

  it("devuelve forbidden y ninguna fila a todo rol que no sea mensajero (R17)", async () => {
    for (const actor of ROLES_SIN_ACCESO) {
      const { repo, listarPorMensajero } = repoEnMemoria(dosMensajeros());
      const r = await servicio(repo).listarMisPagosCompleto(input(), actor);

      expect(r, `rol ${actor.rol}`).toEqual({ status: "forbidden" });
      expect(r, `rol ${actor.rol}`).not.toHaveProperty("items");
      expect(listarPorMensajero, `rol ${actor.rol}`).not.toHaveBeenCalled();
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
      mov({ id: "B-c1", mensajeroId: "msg-B", origenId: "cierre-1" }),
    ];
    const { repo, listarPorMensajero } = repoEnMemoria(filas);
    const svc = servicio(repo);

    const filtros = { cierreId: "cierre-1" };

    const paginado = await svc.listarMisPagos(
      listarPagosMensajeroSchema.parse({ ...filtros, pageSize: 50 }),
      MENSAJERO_A,
    );
    const completo = await svc.listarMisPagosCompleto(input(filtros), MENSAJERO_A);

    expect(paginado.status).toBe("ok");
    expect(completo.status).toBe("ok");
    if (paginado.status !== "ok" || completo.status !== "ok") return;
    expect(ids(completo.items)).toEqual(["A-c1"]);
    expect(ids(completo.items)).toEqual(ids(paginado.data.movimientos));

    const filtrosCompleto = soloFiltros(listarPorMensajero.mock.calls[1][0]);
    expect(filtrosCompleto).toEqual(soloFiltros(listarPorMensajero.mock.calls[0][0]));
    expect(filtrosCompleto.mensajeroId).toBe("msg-A");
  });

  it("mantiene el orden mas reciente primero, igual que el listado (R11)", async () => {
    const svc = servicio(repoEnMemoria(dosMensajeros()).repo);

    const paginado = await svc.listarMisPagos(
      listarPagosMensajeroSchema.parse({}),
      MENSAJERO_A,
    );
    const completo = await svc.listarMisPagosCompleto(input(), MENSAJERO_A);

    expect(paginado.status).toBe("ok");
    expect(completo.status).toBe("ok");
    if (paginado.status !== "ok" || completo.status !== "ok") return;
    expect(ids(completo.items)).toEqual(["A1", "A2"]);
    expect(ids(completo.items)).toEqual(ids(paginado.data.movimientos));
  });

  it("los montos viajan como STRING, sin recalcularse (R7)", async () => {
    const { repo } = repoEnMemoria([
      mov({ id: "A1", mensajeroId: "msg-A", monto: "10203040506.07" }),
    ]);
    const r = await servicio(repo).listarMisPagosCompleto(input(), MENSAJERO_A);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.items[0].monto).toBe("10203040506.07");
    expect(typeof r.items[0].monto).toBe("string");
  });

  it("devuelve limite_excedido con total y limite, y sin filas, cuando el total supera el tope (R27)", async () => {
    const { repo } = repoStub(LIMITE + 1);
    const r = await servicio(repo).listarMisPagosCompleto(input(), MENSAJERO_A);

    expect(r).toEqual({ status: "limite_excedido", total: LIMITE + 1, limite: LIMITE });
    expect(r).not.toHaveProperty("items");
  });

  it("nunca pide al repositorio mas de N+1 filas (R29)", async () => {
    const { repo, listarPorMensajero } = repoStub(50_000);
    const r = await servicio(repo).listarMisPagosCompleto(input(), MENSAJERO_A);

    const filtros = listarPorMensajero.mock.calls[0][0];
    expect(filtros.page).toBe(1); // => skip 0
    expect(filtros.pageSize).toBe(LIMITE + 1); // => take N+1
    expect(r.status).toBe("limite_excedido");
  });

  it("no devuelve un dataset truncado: o entrega todas las filas o el error de tope (R28)", async () => {
    const ok = await servicio(repoStub(LIMITE).repo).listarMisPagosCompleto(input(), MENSAJERO_A);
    expect(ok.status).toBe("ok");
    if (ok.status !== "ok") return;
    expect(ok.items).toHaveLength(LIMITE);
    expect(ok.items.length).toBe(ok.total);

    const excedido = await servicio(repoStub(LIMITE + 1).repo).listarMisPagosCompleto(
      input(),
      MENSAJERO_A,
    );
    expect(excedido.status).toBe("limite_excedido");
    expect(excedido).not.toHaveProperty("items");
  });

  it("no ejecuta la consulta de la cuenta por pagar: es cabecera de pantalla (R32)", async () => {
    const { repo, agregarCuentaPorPagar } = repoEnMemoria(dosMensajeros());
    await servicio(repo).listarMisPagosCompleto(input(), MENSAJERO_A);

    expect(agregarCuentaPorPagar).not.toHaveBeenCalled();
  });
});
