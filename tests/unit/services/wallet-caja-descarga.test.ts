import { describe, it, expect, vi } from "vitest";
import { WalletService } from "@/lib/services/WalletService";
import type {
  IWalletMovimientoRepository,
  ListarMovimientosFiltros,
  ListarMovimientosPage,
  WalletTxClient,
} from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { WalletMovimientoDTO } from "@/lib/types/wallet";
import { listarMovimientosCompletoSchema, listarMovimientosSchema } from "@/lib/types/wallet";
import { NATURALEZA_POR_CATEGORIA } from "@/lib/utils/caja-tesoreria";
import { descargaConfig } from "@/lib/config/descarga";

// Feature 170 / T C.1 (R9/R11/R14/R15/R17/R27/R29) — LIBRO DE CAJA sin paginación.
//
// El alcance de esta superficie lo define el ROL (no un dato del actor): la caja principal es
// de los roles de acceso total. La contraprueba es por tanto de rol: `maestro` y `admin`
// reciben las filas; el resto, `forbidden` sin una sola consulta.

const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "a1", rol: "admin" };

/** Contraprueba de R17: ninguno de éstos ve la caja central. */
const ROLES_SIN_ACCESO: Actor[] = [
  { usuarioId: "t1", rol: "adminTienda" },
  { usuarioId: "s1", rol: "adminSatelite" },
  { usuarioId: "g1", rol: "mensajero" },
  { usuarioId: "k1", rol: "apiKey" },
  { usuarioId: "x1", rol: "otroRolInventado" as Actor["rol"] },
];

const LIMITE = descargaConfig.MAX_FILAS;

function mov(over: Partial<WalletMovimientoDTO> & { id: string }): WalletMovimientoDTO {
  const base = {
    tipo: "ingreso" as const,
    categoria: "ingreso_flete" as const,
    monto: "1000.00",
    origenTipo: "cierre_dia" as const,
    origenId: "c1",
    descripcion: null,
    registradoPor: null,
    fechaMovimiento: "2026-07-12T10:00:00.000Z",
    ...over,
  };
  // Feature 231 (R31): `dueno` sale de la MISMA clasificacion que usa el repositorio.
  return { ...base, dueno: over.dueno ?? NATURALEZA_POR_CATEGORIA[base.categoria] };
}

/** Repositorio en memoria: aplica los filtros, ordena por fecha desc y recorta. */
function repoEnMemoria(filas: WalletMovimientoDTO[]) {
  const listar = vi.fn(async (f: ListarMovimientosFiltros): Promise<ListarMovimientosPage> => {
    const casan = filas
      .filter((m) => (f.tipo === undefined ? true : m.tipo === f.tipo))
      .filter((m) => (f.categoria === undefined ? true : m.categoria === f.categoria))
      .filter((m) => (f.desde === undefined ? true : new Date(m.fechaMovimiento) >= f.desde))
      .filter((m) => (f.hasta === undefined ? true : new Date(m.fechaMovimiento) <= f.hasta))
      .sort(
        (a, b) =>
          new Date(b.fechaMovimiento).getTime() - new Date(a.fechaMovimiento).getTime(),
      );
    const skip = (f.page - 1) * f.pageSize;
    return { movimientos: casan.slice(skip, skip + f.pageSize), total: casan.length };
  });
  return { repo: { listar } as unknown as IWalletMovimientoRepository, listar };
}

/** Stub que declara un `total` cualquiera sin materializar más de `pageSize` filas. */
function repoStub(total: number) {
  const listar = vi.fn(async (f: ListarMovimientosFiltros): Promise<ListarMovimientosPage> => ({
    movimientos: Array.from({ length: Math.min(total, f.pageSize) }, (_, i) =>
      mov({ id: `w${i}` }),
    ),
    total,
  }));
  return { repo: { listar } as unknown as IWalletMovimientoRepository, listar };
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

function servicio(repo: IWalletMovimientoRepository) {
  return new WalletService(repo, {} as WalletTxClient);
}

function input(extra: Record<string, unknown> = {}) {
  return listarMovimientosCompletoSchema.parse(extra);
}

function ids(items: WalletMovimientoDTO[]): string[] {
  return items.map((m) => m.id);
}

describe("WalletService.listarMovimientosCompleto — libro de caja sin paginacion", () => {
  it("devuelve todos los movimientos del dataset, sin recorte por pagina (R9)", async () => {
    const filas = Array.from({ length: 130 }, (_, i) =>
      mov({ id: `w${String(i).padStart(3, "0")}`, fechaMovimiento: `2026-07-${(i % 28) + 1}` }),
    );
    const svc = servicio(repoEnMemoria(filas).repo);

    const paginado = await svc.listarMovimientos(
      listarMovimientosSchema.parse({ pageSize: 20 }),
      MAESTRO,
    );
    const completo = await svc.listarMovimientosCompleto(input(), MAESTRO);

    expect(paginado.status).toBe("ok");
    if (paginado.status !== "ok") return;
    expect(paginado.data.movimientos).toHaveLength(20);

    expect(completo.status).toBe("ok");
    if (completo.status !== "ok") return;
    expect(completo.items).toHaveLength(130);
    expect(completo.total).toBe(130);
  });

  it("devuelve forbidden y ninguna fila a todo rol sin acceso total (R17)", async () => {
    for (const actor of ROLES_SIN_ACCESO) {
      const { repo, listar } = repoEnMemoria([mov({ id: "w1" })]);
      const r = await servicio(repo).listarMovimientosCompleto(input(), actor);

      expect(r, `rol ${actor.rol}`).toEqual({ status: "forbidden" });
      expect(r, `rol ${actor.rol}`).not.toHaveProperty("items");
      expect(listar, `rol ${actor.rol}`).not.toHaveBeenCalled();
    }
  });

  it("CONTRAPRUEBA de R17: maestro y admin SI reciben las filas", async () => {
    for (const actor of [MAESTRO, ADMIN]) {
      const { repo, listar } = repoEnMemoria([mov({ id: "w1" }), mov({ id: "w2" })]);
      const r = await servicio(repo).listarMovimientosCompleto(input(), actor);

      expect(r.status, `rol ${actor.rol}`).toBe("ok");
      if (r.status !== "ok") return;
      expect(ids(r.items).sort()).toEqual(["w1", "w2"]);
      expect(listar).toHaveBeenCalledTimes(1);
    }
  });

  it("aplica EXACTAMENTE los mismos filtros que el listado (R14)", async () => {
    const filas = [
      mov({ id: "ingreso-jul", tipo: "ingreso", fechaMovimiento: "2026-07-10T00:00:00.000Z" }),
      mov({
        id: "egreso-jul",
        tipo: "egreso",
        categoria: "egreso_sueldo",
        fechaMovimiento: "2026-07-11T00:00:00.000Z",
      }),
      mov({ id: "ingreso-ago", tipo: "ingreso", fechaMovimiento: "2026-08-01T00:00:00.000Z" }),
    ];
    const { repo, listar } = repoEnMemoria(filas);
    const svc = servicio(repo);

    const filtros = { tipo: "ingreso", hasta: new Date("2026-07-31T23:59:59.000Z") };

    const paginado = await svc.listarMovimientos(
      listarMovimientosSchema.parse({ ...filtros, pageSize: 50 }),
      MAESTRO,
    );
    const completo = await svc.listarMovimientosCompleto(input(filtros), MAESTRO);

    expect(paginado.status).toBe("ok");
    expect(completo.status).toBe("ok");
    if (paginado.status !== "ok" || completo.status !== "ok") return;
    expect(ids(completo.items)).toEqual(["ingreso-jul"]);
    expect(ids(completo.items)).toEqual(ids(paginado.data.movimientos));

    // Y el objeto de filtros que llega al repositorio es el mismo salvo el recorte.
    expect(soloFiltros(listar.mock.calls[1][0])).toEqual(soloFiltros(listar.mock.calls[0][0]));
  });

  it("mantiene el orden mas reciente primero, igual que el listado (R11)", async () => {
    const filas = [
      mov({ id: "vieja", fechaMovimiento: "2026-01-01T00:00:00.000Z" }),
      mov({ id: "nueva", fechaMovimiento: "2026-06-01T00:00:00.000Z" }),
      mov({ id: "media", fechaMovimiento: "2026-03-01T00:00:00.000Z" }),
    ];
    const svc = servicio(repoEnMemoria(filas).repo);

    const paginado = await svc.listarMovimientos(listarMovimientosSchema.parse({}), MAESTRO);
    const completo = await svc.listarMovimientosCompleto(input(), MAESTRO);

    expect(paginado.status).toBe("ok");
    expect(completo.status).toBe("ok");
    if (paginado.status !== "ok" || completo.status !== "ok") return;
    expect(ids(completo.items)).toEqual(["nueva", "media", "vieja"]);
    expect(ids(completo.items)).toEqual(ids(paginado.data.movimientos));
  });

  it("los montos viajan como STRING, sin recalcularse (R7)", async () => {
    const { repo } = repoEnMemoria([mov({ id: "w1", monto: "12345678901.99" })]);
    const r = await servicio(repo).listarMovimientosCompleto(input(), MAESTRO);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.items[0].monto).toBe("12345678901.99");
    expect(typeof r.items[0].monto).toBe("string");
  });

  it("devuelve limite_excedido con total y limite, y sin filas, cuando el total supera el tope (R27)", async () => {
    const { repo } = repoStub(LIMITE + 1);
    const r = await servicio(repo).listarMovimientosCompleto(input(), MAESTRO);

    expect(r).toEqual({ status: "limite_excedido", total: LIMITE + 1, limite: LIMITE });
    expect(r).not.toHaveProperty("items");
  });

  it("nunca pide al repositorio mas de N+1 filas (R29)", async () => {
    const { repo, listar } = repoStub(50_000);
    const r = await servicio(repo).listarMovimientosCompleto(input(), MAESTRO);

    const filtros = listar.mock.calls[0][0];
    expect(filtros.page).toBe(1); // => skip 0
    expect(filtros.pageSize).toBe(LIMITE + 1); // => take N+1
    expect(r.status).toBe("limite_excedido");
  });

  it("no devuelve un dataset truncado: o entrega todas las filas o el error de tope (R28)", async () => {
    const ok = await servicio(repoStub(LIMITE).repo).listarMovimientosCompleto(input(), MAESTRO);
    expect(ok.status).toBe("ok");
    if (ok.status !== "ok") return;
    expect(ok.items).toHaveLength(LIMITE);
    expect(ok.items.length).toBe(ok.total);

    const excedido = await servicio(repoStub(LIMITE + 1).repo).listarMovimientosCompleto(
      input(),
      MAESTRO,
    );
    expect(excedido.status).toBe("limite_excedido");
    expect(excedido).not.toHaveProperty("items");
  });
});
