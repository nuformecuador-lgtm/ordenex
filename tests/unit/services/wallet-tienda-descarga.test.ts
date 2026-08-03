import { describe, it, expect, vi } from "vitest";
import { WalletTiendaService } from "@/lib/services/WalletTiendaService";
import type {
  IWalletTiendaMovimientoRepository,
  ListarPorTiendaFiltros,
  ListarPorTiendaPage,
} from "@/lib/interfaces/repositories/IWalletTiendaMovimientoRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { WalletTiendaMovimientoDTO } from "@/lib/types/wallet-tienda";
import {
  listarMovimientosTiendaCompletoSchema,
  listarMovimientosTiendaSchema,
} from "@/lib/types/wallet-tienda";
import { descargaConfig } from "@/lib/config/descarga";

// Feature 170 / T C.1 (R9/R11/R14/R15/R17/R27/R29) — LEDGER DE LA TIENDA sin paginación.
//
// PUNTO CALIENTE. Aquí el alcance NO lo define el rol sino un DATO del actor: el
// `usuarioId` del `adminTienda` ES el `tienda_id`. Un fallo no devuelve menos filas: devuelve
// el ledger de OTRA tienda dentro de un xlsx descargable. De ahí que R14 se pruebe con las
// DOS tiendas (cada una ve la suya, ninguna vacía) y R15 con un filtro inyectado.

const TIENDA_A: Actor = { usuarioId: "tienda-A", rol: "adminTienda" };
const TIENDA_B: Actor = { usuarioId: "tienda-B", rol: "adminTienda" };

/** Contraprueba de R17: esta superficie es SOLO del adminTienda; ni el maestro entra. */
const ROLES_SIN_ACCESO: Actor[] = [
  { usuarioId: "m1", rol: "maestro" },
  { usuarioId: "a1", rol: "admin" },
  { usuarioId: "s1", rol: "adminSatelite" },
  { usuarioId: "g1", rol: "mensajero" },
  { usuarioId: "k1", rol: "apiKey" },
  { usuarioId: "x1", rol: "otroRolInventado" as Actor["rol"] },
];

const LIMITE = descargaConfig.MAX_FILAS;

interface FilaFake extends WalletTiendaMovimientoDTO {
  tiendaId: string;
}

function mov(over: Partial<FilaFake> & { id: string; tiendaId: string }): FilaFake {
  return {
    tipo: "credito",
    categoria: "cod_recaudado",
    monto: "1000.00",
    origenTipo: "cierre_dia",
    origenId: "c1",
    descripcion: null,
    fechaMovimiento: "2026-07-12T10:00:00.000Z",
    ...over,
  };
}

/**
 * Repositorio en memoria que aplica el acotado por `tienda_id` DE VERDAD, como el real hace
 * en el WHERE. Es lo que permite afirmar QUÉ FILAS salen y no solo qué objeto se pasó.
 */
function repoEnMemoria(filas: FilaFake[]) {
  const listarPorTienda = vi.fn(
    async (f: ListarPorTiendaFiltros): Promise<ListarPorTiendaPage> => {
      const casan = filas
        .filter((m) => m.tiendaId === f.tiendaId) // acotado por tienda (WHERE del repo real)
        .filter((m) => (f.categoria === undefined ? true : m.categoria === f.categoria))
        .filter((m) => (f.cierreId === undefined ? true : m.origenId === f.cierreId))
        .filter((m) => (f.desde === undefined ? true : new Date(m.fechaMovimiento) >= f.desde))
        .filter((m) => (f.hasta === undefined ? true : new Date(m.fechaMovimiento) <= f.hasta))
        .sort(
          (a, b) =>
            new Date(b.fechaMovimiento).getTime() - new Date(a.fechaMovimiento).getTime(),
        );
      const skip = (f.page - 1) * f.pageSize;
      return {
        movimientos: casan.slice(skip, skip + f.pageSize) as WalletTiendaMovimientoDTO[],
        total: casan.length,
      };
    },
  );
  const agregarSaldoPorTienda = vi.fn(async () => ({ creditos: "0.00", debitos: "0.00" }));
  // Feature 172 (T G.2, R55): el listado de `/mi-wallet` pide tambien el desglose por
  // concepto, para que la tienda distinga el pago recibido de un cargo. Este archivo mide la
  // DESCARGA (que no lleva cabecera), asi que el doble solo tiene que existir.
  const agregarDesglosePorTienda = vi.fn(async () => []);
  return {
    repo: {
      listarPorTienda,
      agregarSaldoPorTienda,
      agregarDesglosePorTienda,
    } as unknown as IWalletTiendaMovimientoRepository,
    listarPorTienda,
    agregarSaldoPorTienda,
  };
}

/** Stub que declara un `total` cualquiera sin materializar más de `pageSize` filas. */
function repoStub(total: number) {
  const listarPorTienda = vi.fn(
    async (f: ListarPorTiendaFiltros): Promise<ListarPorTiendaPage> => ({
      movimientos: Array.from({ length: Math.min(total, f.pageSize) }, (_, i) =>
        mov({ id: `t${i}`, tiendaId: f.tiendaId }),
      ) as WalletTiendaMovimientoDTO[],
      total,
    }),
  );
  return {
    repo: { listarPorTienda } as unknown as IWalletTiendaMovimientoRepository,
    listarPorTienda,
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

function servicio(repo: IWalletTiendaMovimientoRepository) {
  return new WalletTiendaService(repo);
}

function input(extra: Record<string, unknown> = {}) {
  return listarMovimientosTiendaCompletoSchema.parse(extra);
}

function ids(items: WalletTiendaMovimientoDTO[]): string[] {
  return items.map((m) => m.id);
}

/** Dos tiendas con movimientos propios: el fixture de las pruebas de fuga. */
function dosTiendas(): FilaFake[] {
  return [
    mov({ id: "A1", tiendaId: "tienda-A", fechaMovimiento: "2026-07-04T00:00:00.000Z" }),
    mov({ id: "A2", tiendaId: "tienda-A", fechaMovimiento: "2026-07-03T00:00:00.000Z" }),
    mov({ id: "B1", tiendaId: "tienda-B", fechaMovimiento: "2026-07-02T00:00:00.000Z" }),
    mov({ id: "B2", tiendaId: "tienda-B", fechaMovimiento: "2026-07-01T00:00:00.000Z" }),
  ];
}

describe("WalletTiendaService.listarMisMovimientosCompleto — ledger sin paginacion", () => {
  it("devuelve todos los movimientos de la tienda, sin recorte por pagina (R9)", async () => {
    const filas = Array.from({ length: 140 }, (_, i) =>
      mov({
        id: `a${String(i).padStart(3, "0")}`,
        tiendaId: "tienda-A",
        fechaMovimiento: `2026-07-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
      }),
    );
    const svc = servicio(repoEnMemoria(filas).repo);

    const paginado = await svc.listarMisMovimientos(
      listarMovimientosTiendaSchema.parse({ pageSize: 20 }),
      TIENDA_A,
    );
    const completo = await svc.listarMisMovimientosCompleto(input(), TIENDA_A);

    expect(paginado.status).toBe("ok");
    if (paginado.status !== "ok") return;
    expect(paginado.data.movimientos).toHaveLength(20);

    expect(completo.status).toBe("ok");
    if (completo.status !== "ok") return;
    expect(completo.items).toHaveLength(140);
    expect(completo.total).toBe(140);
  });

  it("el archivo de la tienda A no trae ni una fila de la tienda B, y viceversa (R14)", async () => {
    // Las DOS direcciones, y las dos con resultado NO VACÍO: así el test no puede pasar
    // porque el servicio no devuelva nada a nadie.
    const svcA = servicio(repoEnMemoria(dosTiendas()).repo);
    const a = await svcA.listarMisMovimientosCompleto(input(), TIENDA_A);

    expect(a.status).toBe("ok");
    if (a.status !== "ok") return;
    expect(ids(a.items)).toEqual(["A1", "A2"]);
    expect(a.total).toBe(2);

    const svcB = servicio(repoEnMemoria(dosTiendas()).repo);
    const b = await svcB.listarMisMovimientosCompleto(input(), TIENDA_B);

    expect(b.status).toBe("ok");
    if (b.status !== "ok") return;
    expect(ids(b.items)).toEqual(["B1", "B2"]);
    expect(b.total).toBe(2);

    // Y ninguno de los dos conjuntos toca al otro.
    expect(ids(a.items).some((id) => ids(b.items).includes(id))).toBe(false);
  });

  it("un tiendaId inyectado en el input NO amplia el alcance (R15)", async () => {
    // El schema `.strict()` del borde ya rechazaría esto; aquí se comprueba la SEGUNDA
    // barrera: aunque la clave llegara al servicio, éste jamás la lee y el acotado por el
    // actor se escribe al final del objeto que va al repositorio.
    const { repo, listarPorTienda } = repoEnMemoria(dosTiendas());
    const inyectado = {
      ...input(),
      tiendaId: "tienda-B",
    } as ReturnType<typeof input>;

    const r = await servicio(repo).listarMisMovimientosCompleto(inyectado, TIENDA_A);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(ids(r.items)).toEqual(["A1", "A2"]);
    expect(ids(r.items)).not.toContain("B1");
    expect(listarPorTienda.mock.calls[0][0].tiendaId).toBe("tienda-A");
  });

  it("devuelve forbidden y ninguna fila a todo rol que no sea adminTienda (R17)", async () => {
    for (const actor of ROLES_SIN_ACCESO) {
      const { repo, listarPorTienda } = repoEnMemoria(dosTiendas());
      const r = await servicio(repo).listarMisMovimientosCompleto(input(), actor);

      expect(r, `rol ${actor.rol}`).toEqual({ status: "forbidden" });
      expect(r, `rol ${actor.rol}`).not.toHaveProperty("items");
      expect(listarPorTienda, `rol ${actor.rol}`).not.toHaveBeenCalled();
    }
  });

  it("aplica EXACTAMENTE los mismos filtros que el listado (R14)", async () => {
    const filas = [
      mov({
        id: "A-cod",
        tiendaId: "tienda-A",
        categoria: "cod_recaudado",
        fechaMovimiento: "2026-07-10T00:00:00.000Z",
      }),
      mov({
        id: "A-flete",
        tiendaId: "tienda-A",
        categoria: "flete",
        fechaMovimiento: "2026-07-11T00:00:00.000Z",
      }),
      mov({ id: "B-cod", tiendaId: "tienda-B", categoria: "cod_recaudado" }),
    ];
    const { repo, listarPorTienda } = repoEnMemoria(filas);
    const svc = servicio(repo);

    const filtros = { categoria: "cod_recaudado" as const };

    const paginado = await svc.listarMisMovimientos(
      listarMovimientosTiendaSchema.parse({ ...filtros, pageSize: 50 }),
      TIENDA_A,
    );
    const completo = await svc.listarMisMovimientosCompleto(input(filtros), TIENDA_A);

    expect(paginado.status).toBe("ok");
    expect(completo.status).toBe("ok");
    if (paginado.status !== "ok" || completo.status !== "ok") return;
    expect(ids(completo.items)).toEqual(["A-cod"]);
    expect(ids(completo.items)).toEqual(ids(paginado.data.movimientos));

    const filtrosCompleto = soloFiltros(listarPorTienda.mock.calls[1][0]);
    expect(filtrosCompleto).toEqual(soloFiltros(listarPorTienda.mock.calls[0][0]));
    expect(filtrosCompleto.tiendaId).toBe("tienda-A");
  });

  it("mantiene el orden mas reciente primero, igual que el listado (R11)", async () => {
    const svc = servicio(repoEnMemoria(dosTiendas()).repo);

    const paginado = await svc.listarMisMovimientos(
      listarMovimientosTiendaSchema.parse({}),
      TIENDA_A,
    );
    const completo = await svc.listarMisMovimientosCompleto(input(), TIENDA_A);

    expect(paginado.status).toBe("ok");
    expect(completo.status).toBe("ok");
    if (paginado.status !== "ok" || completo.status !== "ok") return;
    expect(ids(completo.items)).toEqual(["A1", "A2"]);
    expect(ids(completo.items)).toEqual(ids(paginado.data.movimientos));
  });

  it("los montos viajan como STRING, sin recalcularse (R7)", async () => {
    const { repo } = repoEnMemoria([
      mov({ id: "A1", tiendaId: "tienda-A", monto: "98765432109.87" }),
    ]);
    const r = await servicio(repo).listarMisMovimientosCompleto(input(), TIENDA_A);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.items[0].monto).toBe("98765432109.87");
    expect(typeof r.items[0].monto).toBe("string");
  });

  it("devuelve limite_excedido con total y limite, y sin filas, cuando el total supera el tope (R27)", async () => {
    const { repo } = repoStub(LIMITE + 1);
    const r = await servicio(repo).listarMisMovimientosCompleto(input(), TIENDA_A);

    expect(r).toEqual({ status: "limite_excedido", total: LIMITE + 1, limite: LIMITE });
    expect(r).not.toHaveProperty("items");
  });

  it("nunca pide al repositorio mas de N+1 filas (R29)", async () => {
    const { repo, listarPorTienda } = repoStub(50_000);
    const r = await servicio(repo).listarMisMovimientosCompleto(input(), TIENDA_A);

    const filtros = listarPorTienda.mock.calls[0][0];
    expect(filtros.page).toBe(1); // => skip 0
    expect(filtros.pageSize).toBe(LIMITE + 1); // => take N+1
    expect(r.status).toBe("limite_excedido");
  });

  it("no devuelve un dataset truncado: o entrega todas las filas o el error de tope (R28)", async () => {
    const ok = await servicio(repoStub(LIMITE).repo).listarMisMovimientosCompleto(
      input(),
      TIENDA_A,
    );
    expect(ok.status).toBe("ok");
    if (ok.status !== "ok") return;
    expect(ok.items).toHaveLength(LIMITE);
    expect(ok.items.length).toBe(ok.total);

    const excedido = await servicio(repoStub(LIMITE + 1).repo).listarMisMovimientosCompleto(
      input(),
      TIENDA_A,
    );
    expect(excedido.status).toBe("limite_excedido");
    expect(excedido).not.toHaveProperty("items");
  });

  it("no ejecuta la consulta del saldo agregado: es cabecera de pantalla, no del archivo (R32)", async () => {
    const { repo, agregarSaldoPorTienda } = repoEnMemoria(dosTiendas());
    await servicio(repo).listarMisMovimientosCompleto(input(), TIENDA_A);

    expect(agregarSaldoPorTienda).not.toHaveBeenCalled();
  });
});
