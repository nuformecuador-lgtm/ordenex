import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { WalletTiendaService } from "@/lib/services/WalletTiendaService";
import { WalletTiendaMovimientoRepository } from "@/lib/repositories/WalletTiendaMovimientoRepository";
import type {
  DesgloseTiendaAgregadoRow,
  IWalletTiendaMovimientoRepository,
  ListarPorTiendaFiltros,
  ListarPorTiendaPage,
  SaldoTiendaFiltros,
} from "@/lib/interfaces/repositories/IWalletTiendaMovimientoRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  WalletTiendaMovimientoCategoria,
  WalletTiendaMovimientoDTO,
} from "@/lib/types/wallet-tienda";
import {
  listarMovimientosDeTiendaCompletoSchema,
  listarMovimientosDeTiendaSchema,
} from "@/lib/types/wallet-tienda";
import { derivarSaldoTienda } from "@/lib/utils/saldo-tienda";
import { descargaConfig } from "@/lib/config/descarga";

// Feature 171 / T1.4 — DESGLOSE de UNA tienda elegida (R11/R12/R22/R24/R26/R27/R28/R34/R35/
// R39/R40/R43).
//
// Es una superficie con el alcance INVERTIDO respecto de `/mi-wallet`: alli la tienda ve lo
// suyo y el acotado sale del actor; aqui el maestro elige la tienda y el permiso lo fija el
// ROL. Por eso los dos casos que mandan son:
//
//  1. CONTRAPRUEBA de rol: un rol de acceso total tiene que recibir FILAS. Sin ella, un guard
//     que devolviera `forbidden` a todo el mundo pasaria los tests de R27 sin despeinarse.
//  2. CONTRAPRUEBA de R28: `adminTienda` pidiendo SU PROPIA tienda recibe `forbidden`. Es el
//     caso que un `if` mal escrito (`input.tiendaId === actor.usuarioId`) dejaria pasar.
//
// Y el orden importa tanto como el resultado: el guard va ANTES de tocar el repositorio. Si
// estuviera despues, el ledger ya habria salido de la base aunque la respuesta fuera un error.

const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "a1", rol: "admin" };
const TIENDA_A: Actor = { usuarioId: "tienda-A", rol: "adminTienda" };

/** Roles SIN acceso a esta superficie. `adminTienda` incluido a proposito (R28). */
const ROLES_SIN_ACCESO: Actor[] = [
  { usuarioId: "tienda-A", rol: "adminTienda" },
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

/** El `tipo` con el que el sistema emite cada categoria (para el fixture). */
function tipoDe(categoria: WalletTiendaMovimientoCategoria): "credito" | "debito" {
  return categoria === "cod_recaudado" || categoria === "ajuste_credito" ? "credito" : "debito";
}

function debito(
  id: string,
  tiendaId: string,
  categoria: WalletTiendaMovimientoCategoria,
  monto: string,
  fechaMovimiento = "2026-07-12T10:00:00.000Z",
): FilaFake {
  return mov({ id, tiendaId, categoria, monto, tipo: tipoDe(categoria), fechaMovimiento });
}

/**
 * Repositorio en memoria que aplica el acotado por `tienda_id` DE VERDAD, como el real hace en
 * el WHERE. Es lo que permite afirmar QUE FILAS salen y no solo que objeto se paso.
 */
function repoEnMemoria(filas: FilaFake[]) {
  const casanFiltros = (m: FilaFake, f: SaldoTiendaFiltros & { tiendaId: string }) =>
    m.tiendaId === f.tiendaId &&
    (f.categoria === undefined || m.categoria === f.categoria) &&
    (f.cierreId === undefined || m.origenId === f.cierreId) &&
    (f.desde === undefined || new Date(m.fechaMovimiento) >= f.desde) &&
    (f.hasta === undefined || new Date(m.fechaMovimiento) <= f.hasta);

  const listarPorTienda = vi.fn(
    async (f: ListarPorTiendaFiltros): Promise<ListarPorTiendaPage> => {
      const casan = filas
        .filter((m) => casanFiltros(m, f))
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

  // Espejo del `groupBy(["tipo","categoria"])` del repositorio real.
  const agregarDesglosePorTienda = vi.fn(
    async (tiendaId: string, f: SaldoTiendaFiltros): Promise<DesgloseTiendaAgregadoRow[]> => {
      const acc = new Map<string, DesgloseTiendaAgregadoRow>();
      for (const m of filas.filter((x) => casanFiltros(x, { ...f, tiendaId }))) {
        const clave = `${m.tipo}|${m.categoria}`;
        const previo = acc.get(clave);
        acc.set(clave, {
          tipo: m.tipo,
          categoria: m.categoria,
          total: new Prisma.Decimal(previo?.total ?? 0).add(new Prisma.Decimal(m.monto)).toFixed(2),
        });
      }
      return [...acc.values()];
    },
  );

  const agregarSaldoPorTienda = vi.fn(async () => ({ creditos: "0.00", debitos: "0.00" }));
  const listarSaldosTodasTiendas = vi.fn(async () => []);

  return {
    repo: {
      listarPorTienda,
      agregarDesglosePorTienda,
      agregarSaldoPorTienda,
      listarSaldosTodasTiendas,
    } as unknown as IWalletTiendaMovimientoRepository,
    listarPorTienda,
    agregarDesglosePorTienda,
    agregarSaldoPorTienda,
    listarSaldosTodasTiendas,
  };
}

/**
 * Repositorio que EXPLOTA si alguien lo llama. Con este doble, un guard colocado despues de la
 * consulta no devuelve `forbidden` calladamente: revienta el test con el motivo escrito.
 */
function repoQueExplota(): IWalletTiendaMovimientoRepository {
  const boom = (metodo: string) => () => {
    throw new Error(`el guard de rol NO se evaluo antes de la base: se llamo a ${metodo}`);
  };
  return {
    crearMovimientos: boom("crearMovimientos"),
    listarPorTienda: boom("listarPorTienda"),
    agregarSaldoPorTienda: boom("agregarSaldoPorTienda"),
    listarSaldosTodasTiendas: boom("listarSaldosTodasTiendas"),
    agregarDesglosePorTienda: boom("agregarDesglosePorTienda"),
  } as unknown as IWalletTiendaMovimientoRepository;
}

/** Stub que declara un `total` cualquiera sin materializar mas de `pageSize` filas. */
function repoStub(total: number) {
  const listarPorTienda = vi.fn(
    async (f: ListarPorTiendaFiltros): Promise<ListarPorTiendaPage> => ({
      movimientos: Array.from({ length: Math.min(total, f.pageSize) }, (_, i) =>
        mov({ id: `t${i}`, tiendaId: f.tiendaId }),
      ) as WalletTiendaMovimientoDTO[],
      total,
    }),
  );
  const agregarDesglosePorTienda = vi.fn(async (): Promise<DesgloseTiendaAgregadoRow[]> => []);
  return {
    repo: { listarPorTienda, agregarDesglosePorTienda } as unknown as IWalletTiendaMovimientoRepository,
    listarPorTienda,
    agregarDesglosePorTienda,
  };
}

function servicio(repo: IWalletTiendaMovimientoRepository) {
  return new WalletTiendaService(repo);
}

function input(extra: Record<string, unknown> = {}) {
  return listarMovimientosDeTiendaSchema.parse({ tiendaId: "tienda-A", ...extra });
}

function inputCompleto(extra: Record<string, unknown> = {}) {
  return listarMovimientosDeTiendaCompletoSchema.parse({ tiendaId: "tienda-A", ...extra });
}

function ids(items: WalletTiendaMovimientoDTO[]): string[] {
  return items.map((m) => m.id);
}

/** Dos tiendas con movimientos propios: el fixture de las pruebas de fuga. */
function dosTiendas(): FilaFake[] {
  return [
    debito("A-cod", "tienda-A", "cod_recaudado", "10000.00", "2026-07-04T00:00:00.000Z"),
    debito("A-flete", "tienda-A", "flete", "1000.00", "2026-07-03T00:00:00.000Z"),
    debito("B-cod", "tienda-B", "cod_recaudado", "7000.00", "2026-07-02T00:00:00.000Z"),
    debito("B-flete", "tienda-B", "flete", "700.00", "2026-07-01T00:00:00.000Z"),
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// R26 / R27 / R28 — alcance por rol
// ─────────────────────────────────────────────────────────────────────────────

describe("WalletTiendaService.listarMovimientosDeTienda — alcance por rol (R26/R27/R28)", () => {
  it("CONTRAPRUEBA R26: maestro y admin reciben FILAS e IMPORTES (el test no pasa por vacio)", async () => {
    for (const actor of [MAESTRO, ADMIN]) {
      const { repo } = repoEnMemoria(dosTiendas());
      const r = await servicio(repo).listarMovimientosDeTienda(input(), actor);

      expect(r.status, `rol ${actor.rol}`).toBe("ok");
      if (r.status !== "ok") return;
      // Filas de verdad: si el guard bloqueara a todos, esto seria [] y el test caeria.
      expect(ids(r.data.movimientos), `rol ${actor.rol}`).toEqual(["A-cod", "A-flete"]);
      expect(r.data.total, `rol ${actor.rol}`).toBe(2);
      expect(r.data.desglose.aFavor, `rol ${actor.rol}`).toBe("10000.00");
      expect(r.data.desglose.cargos, `rol ${actor.rol}`).toBe("1000.00");
      expect(r.data.desglose.saldo, `rol ${actor.rol}`).toBe("9000.00");
    }
  });

  it("R27: todo rol sin acceso total recibe forbidden, sin movimientos ni importes y con CERO llamadas al repositorio", async () => {
    for (const actor of ROLES_SIN_ACCESO) {
      const { repo, listarPorTienda, agregarDesglosePorTienda } = repoEnMemoria(dosTiendas());
      const r = await servicio(repo).listarMovimientosDeTienda(input(), actor);

      expect(r, `rol ${actor.rol}`).toEqual({ status: "forbidden" });
      expect(r, `rol ${actor.rol}`).not.toHaveProperty("data");
      // El guard corre ANTES de la base: sin esto, el dato ya habria salido aunque la
      // respuesta fuera un error.
      expect(listarPorTienda, `rol ${actor.rol}`).not.toHaveBeenCalled();
      expect(agregarDesglosePorTienda, `rol ${actor.rol}`).not.toHaveBeenCalled();
    }
  });

  it("R27: con un repositorio que EXPLOTA al ser llamado, el forbidden sale igual (el guard es lo primero)", async () => {
    // La forma mas dura de afirmar el orden: si el guard estuviera despues de la consulta,
    // este test no devolveria `forbidden`, lanzaria.
    for (const actor of ROLES_SIN_ACCESO) {
      const r = await servicio(repoQueExplota()).listarMovimientosDeTienda(input(), actor);
      expect(r, `rol ${actor.rol}`).toEqual({ status: "forbidden" });
    }
  });

  it("CONTRAPRUEBA R28: adminTienda pidiendo SU PROPIA tienda recibe forbidden, no datos", async () => {
    // `TIENDA_A.usuarioId === "tienda-A" === input().tiendaId`: es exactamente el caso que un
    // guard escrito como `input.tiendaId === actor.usuarioId` dejaria pasar. Su superficie es
    // `listarMisMovimientos`, que ignora el tiendaId del input y acota por el actor.
    const { repo, listarPorTienda, agregarDesglosePorTienda } = repoEnMemoria(dosTiendas());
    const propia = input({ tiendaId: TIENDA_A.usuarioId });
    expect(propia.tiendaId).toBe(TIENDA_A.usuarioId); // el caso es el que se cree que es

    const r = await servicio(repo).listarMovimientosDeTienda(propia, TIENDA_A);

    expect(r).toEqual({ status: "forbidden" });
    expect(listarPorTienda).not.toHaveBeenCalled();
    expect(agregarDesglosePorTienda).not.toHaveBeenCalled();
  });

  it("R28: y su superficie propia (`listarMisMovimientos`) le sigue funcionando — no se le quita nada", async () => {
    // Contraprueba de la contraprueba: el `forbidden` de arriba no es una regresion de acceso.
    const { repo } = repoEnMemoria(dosTiendas());
    const r = await servicio(repo).listarMisMovimientos(
      { page: 1, pageSize: 20, cierreId: undefined, categoria: undefined, desde: undefined, hasta: undefined },
      TIENDA_A,
    );
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(ids(r.data.movimientos)).toEqual(["A-cod", "A-flete"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R22 / R24 — contrato de lectura y acotamiento por la tienda de la ENTRADA
// ─────────────────────────────────────────────────────────────────────────────

describe("WalletTiendaService.listarMovimientosDeTienda — contrato (R22/R24)", () => {
  it("R22: una sola respuesta con movimientos, total, pagina, tamaño y los cuatro importes", async () => {
    const { repo } = repoEnMemoria(dosTiendas());
    const r = await servicio(repo).listarMovimientosDeTienda(
      input({ page: 1, pageSize: 20 }),
      MAESTRO,
    );

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(Object.keys(r.data).sort()).toEqual(
      ["desglose", "movimientos", "page", "pageSize", "tiendaId", "total"].sort(),
    );
    expect(r.data.tiendaId).toBe("tienda-A");
    expect(r.data.page).toBe(1);
    expect(r.data.pageSize).toBe(20);
    expect(Object.keys(r.data.desglose).sort()).toEqual(
      ["aFavor", "cargos", "pagado", "saldo", "signo"].sort(),
    );
  });

  it("R23: los cuatro importes y los montos viajan como STRING (ningun Decimal cruza la frontera)", async () => {
    const { repo } = repoEnMemoria([
      debito("A1", "tienda-A", "cod_recaudado", "98765432109.87"),
    ]);
    const r = await servicio(repo).listarMovimientosDeTienda(input(), MAESTRO);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    for (const clave of ["aFavor", "cargos", "pagado", "saldo"] as const) {
      expect(typeof r.data.desglose[clave], clave).toBe("string");
    }
    expect(r.data.desglose.aFavor).toBe("98765432109.87");
    expect(typeof r.data.movimientos[0].monto).toBe("string");
  });

  it("R24: el repositorio recibe EXACTAMENTE el tiendaId de la entrada, tambien con claves extra coladas", async () => {
    const { repo, listarPorTienda, agregarDesglosePorTienda } = repoEnMemoria(dosTiendas());
    // El borde de este camino PAGINADO no es `.strict()`: descarta las claves desconocidas en
    // vez de rechazarlas (el `.strict()` esta en el modo completo). Por eso lo que se prueba
    // aqui es la SEGUNDA barrera: `construirFiltros` lee claves EXPLICITAS, asi que nada
    // desconocido llega al repositorio, y el `tiendaId` se escribe AL FINAL, donde nada lo
    // puede pisar.
    const inyectado = {
      ...input({ tiendaId: "tienda-A" }),
      todasLasTiendas: true,
      tienda_id: "tienda-B",
    } as ReturnType<typeof input>;

    const r = await servicio(repo).listarMovimientosDeTienda(inyectado, MAESTRO);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(ids(r.data.movimientos)).toEqual(["A-cod", "A-flete"]);
    expect(ids(r.data.movimientos)).not.toContain("B-cod");

    const argListado = listarPorTienda.mock.calls[0][0];
    expect(argListado.tiendaId).toBe("tienda-A");
    expect(argListado).not.toHaveProperty("todasLasTiendas");
    expect(argListado).not.toHaveProperty("tienda_id");
    expect(agregarDesglosePorTienda.mock.calls[0][0]).toBe("tienda-A");
  });

  it("R24: cada tienda ve LO SUYO, en las dos direcciones y ninguna vacia", async () => {
    const svcA = servicio(repoEnMemoria(dosTiendas()).repo);
    const a = await svcA.listarMovimientosDeTienda(input({ tiendaId: "tienda-A" }), MAESTRO);
    const svcB = servicio(repoEnMemoria(dosTiendas()).repo);
    const b = await svcB.listarMovimientosDeTienda(input({ tiendaId: "tienda-B" }), MAESTRO);

    expect(a.status).toBe("ok");
    expect(b.status).toBe("ok");
    if (a.status !== "ok" || b.status !== "ok") return;
    expect(ids(a.data.movimientos)).toEqual(["A-cod", "A-flete"]);
    expect(ids(b.data.movimientos)).toEqual(["B-cod", "B-flete"]);
    expect(a.data.desglose.saldo).toBe("9000.00");
    expect(b.data.desglose.saldo).toBe("6300.00");
    expect(ids(a.data.movimientos).some((id) => ids(b.data.movimientos).includes(id))).toBe(false);
  });

  it("R16: los movimientos llegan del mas reciente al mas antiguo", async () => {
    const { repo } = repoEnMemoria([
      debito("viejo", "tienda-A", "flete", "1.00", "2026-07-01T00:00:00.000Z"),
      debito("nuevo", "tienda-A", "flete", "1.00", "2026-07-20T00:00:00.000Z"),
      debito("medio", "tienda-A", "flete", "1.00", "2026-07-10T00:00:00.000Z"),
    ]);
    const r = await servicio(repo).listarMovimientosDeTienda(input(), MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(ids(r.data.movimientos)).toEqual(["nuevo", "medio", "viejo"]);
  });

  it("R17: pagina en el servidor y devuelve el total del conjunto filtrado, no el de la pagina", async () => {
    const filas = Array.from({ length: 45 }, (_, i) =>
      debito(
        `A${String(i).padStart(2, "0")}`,
        "tienda-A",
        "flete",
        "1.00",
        `2026-07-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
      ),
    );
    const { repo } = repoEnMemoria(filas);
    const r = await servicio(repo).listarMovimientosDeTienda(input({ page: 2, pageSize: 20 }), MAESTRO);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.data.movimientos).toHaveLength(20);
    expect(r.data.total).toBe(45);
    expect(r.data.page).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R11 / R12 — los importes y el conjunto filtrado
// ─────────────────────────────────────────────────────────────────────────────

describe("WalletTiendaService.listarMovimientosDeTienda — importes (R11/R12)", () => {
  const LEDGER: FilaFake[] = [
    debito("A-cod", "tienda-A", "cod_recaudado", "10000.00", "2026-07-10T00:00:00.000Z"),
    debito("A-flete", "tienda-A", "flete", "1000.00", "2026-07-11T00:00:00.000Z"),
    debito("A-iva", "tienda-A", "iva_flete", "130.00", "2026-07-12T00:00:00.000Z"),
  ];

  it("R11: SIN filtros, el saldo del desglose es identico al que deriva la tabla de saldos", async () => {
    const { repo } = repoEnMemoria(LEDGER);
    const r = await servicio(repo).listarMovimientosDeTienda(input(), MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;

    // La OTRA derivacion del mismo conjunto: la que alimenta la fila de `SaldosTiendasTable`.
    const creditos = LEDGER.filter((m) => m.tipo === "credito").reduce(
      (s, m) => s.add(new Prisma.Decimal(m.monto)),
      new Prisma.Decimal(0),
    );
    const debitos = LEDGER.filter((m) => m.tipo === "debito").reduce(
      (s, m) => s.add(new Prisma.Decimal(m.monto)),
      new Prisma.Decimal(0),
    );
    const saldoFila = derivarSaldoTienda(creditos.toFixed(2), debitos.toFixed(2));

    expect(r.data.desglose.saldo).toBe(saldoFila.saldo);
    expect(r.data.desglose.signo).toBe(saldoFila.signo);
    expect(r.data.desglose.saldo).toBe("8870.00");
  });

  it("R12: CON filtros, los cuatro importes reflejan el conjunto filtrado, no el agregado total", async () => {
    const { repo } = repoEnMemoria(LEDGER);
    const sinFiltro = await servicio(repo).listarMovimientosDeTienda(input(), MAESTRO);
    const { repo: repo2 } = repoEnMemoria(LEDGER);
    const filtrado = await servicio(repo2).listarMovimientosDeTienda(
      input({ categoria: "flete" }),
      MAESTRO,
    );

    expect(sinFiltro.status).toBe("ok");
    expect(filtrado.status).toBe("ok");
    if (sinFiltro.status !== "ok" || filtrado.status !== "ok") return;
    expect(sinFiltro.data.desglose.aFavor).toBe("10000.00");
    // Filtrado por `flete`: ni COD ni IVA entran en la cabecera.
    expect(filtrado.data.desglose.aFavor).toBe("0.00");
    expect(filtrado.data.desglose.cargos).toBe("1000.00");
    expect(filtrado.data.desglose.saldo).toBe("-1000.00");
    expect(filtrado.data.desglose.signo).toBe("negativo");
    expect(filtrado.data.total).toBe(1);
  });

  it("R12: la cabecera se agrega con los MISMOS filtros que el listado", async () => {
    const { repo, listarPorTienda, agregarDesglosePorTienda } = repoEnMemoria(LEDGER);
    const desde = new Date("2026-07-11T00:00:00.000Z");
    await servicio(repo).listarMovimientosDeTienda(
      input({ cierreId: "c1", categoria: "flete", desde }),
      MAESTRO,
    );

    const filtrosListado = listarPorTienda.mock.calls[0][0];
    const filtrosCabecera = agregarDesglosePorTienda.mock.calls[0][1];
    expect(filtrosCabecera).toEqual({
      cierreId: filtrosListado.cierreId,
      categoria: filtrosListado.categoria,
      desde: filtrosListado.desde,
      hasta: filtrosListado.hasta,
    });
  });

  it("tienda sin movimientos en el conjunto filtrado -> los cuatro importes en 0.00 y total 0", async () => {
    const { repo } = repoEnMemoria(dosTiendas());
    const r = await servicio(repo).listarMovimientosDeTienda(
      input({ categoria: "ajuste_debito" }),
      MAESTRO,
    );
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.data.total).toBe(0);
    expect(r.data.movimientos).toEqual([]);
    expect(r.data.desglose).toEqual({
      aFavor: "0.00",
      cargos: "0.00",
      pagado: "0.00",
      saldo: "0.00",
      signo: "cero",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R34 / R35 — coste constante por tienda
// ─────────────────────────────────────────────────────────────────────────────

describe("WalletTiendaService.listarMovimientosDeTienda — coste constante (R34/R35)", () => {
  it("R34: EXACTAMENTE 2 llamadas al repositorio por lectura, con pageSize 20 y 100", async () => {
    for (const pageSize of [20, 100]) {
      const { repo, listarPorTienda, agregarDesglosePorTienda } = repoEnMemoria(dosTiendas());
      await servicio(repo).listarMovimientosDeTienda(input({ pageSize }), MAESTRO);

      expect(listarPorTienda, `pageSize ${pageSize}`).toHaveBeenCalledTimes(1);
      expect(agregarDesglosePorTienda, `pageSize ${pageSize}`).toHaveBeenCalledTimes(1);
    }
  });

  it("R34: el coste NO crece con el numero de tiendas del ledger (1 tienda vs 50)", async () => {
    const conUna = repoEnMemoria(dosTiendas().filter((m) => m.tiendaId === "tienda-A"));
    await servicio(conUna.repo).listarMovimientosDeTienda(input(), MAESTRO);

    const muchas: FilaFake[] = [];
    for (let t = 0; t < 50; t++) {
      muchas.push(debito(`x${t}`, t === 0 ? "tienda-A" : `tienda-${t}`, "flete", "1.00"));
    }
    const con50 = repoEnMemoria(muchas);
    await servicio(con50.repo).listarMovimientosDeTienda(input(), MAESTRO);

    expect(conUna.listarPorTienda.mock.calls.length + conUna.agregarDesglosePorTienda.mock.calls.length).toBe(2);
    expect(con50.listarPorTienda.mock.calls.length + con50.agregarDesglosePorTienda.mock.calls.length).toBe(2);
  });

  it("R36: cambiar de pagina o filtrar vuelve a consultar SOLO esa tienda (2 llamadas mas, mismo tiendaId)", async () => {
    const { repo, listarPorTienda, agregarDesglosePorTienda } = repoEnMemoria(dosTiendas());
    const svc = servicio(repo);
    await svc.listarMovimientosDeTienda(input({ page: 1 }), MAESTRO);
    await svc.listarMovimientosDeTienda(input({ page: 2 }), MAESTRO);
    await svc.listarMovimientosDeTienda(input({ categoria: "flete" }), MAESTRO);

    expect(listarPorTienda).toHaveBeenCalledTimes(3);
    expect(agregarDesglosePorTienda).toHaveBeenCalledTimes(3);
    for (const call of listarPorTienda.mock.calls) expect(call[0].tiendaId).toBe("tienda-A");
    for (const call of agregarDesglosePorTienda.mock.calls) expect(call[0]).toBe("tienda-A");
  });

  it("R35: NO se consulta el nombre de la tienda, y la respuesta no lo lleva", async () => {
    const { repo, listarSaldosTodasTiendas, agregarSaldoPorTienda } = repoEnMemoria(dosTiendas());
    const r = await servicio(repo).listarMovimientosDeTienda(input(), MAESTRO);

    // El nombre baja por props desde la fila; pedirlo aqui seria una consulta de mas por
    // apertura, que es justo el defecto que el desglose del mensajero paga hoy.
    expect(listarSaldosTodasTiendas).not.toHaveBeenCalled();
    expect(agregarSaldoPorTienda).not.toHaveBeenCalled();
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.data).not.toHaveProperty("tiendaNombre");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R43 — «Pagado a la tienda»: el hueco que cierra la 172
// ─────────────────────────────────────────────────────────────────────────────

describe("WalletTiendaService.listarMovimientosDeTienda — «pagado a la tienda» (R43)", () => {
  it("hoy, con el ledger REAL de produccion (nadie emite pagos), `pagado` vale 0.00", async () => {
    const { repo } = repoEnMemoria(dosTiendas());
    const r = await servicio(repo).listarMovimientosDeTienda(input(), MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.data.desglose.pagado).toBe("0.00");
  });

  it("con un movimiento `pago_tienda` sembrado A MANO, la cabecera lo refleja sin tocar una linea", async () => {
    const conPago = [
      ...dosTiendas(),
      // Exactamente la fila que insertara la 172.
      debito("A-pago", "tienda-A", "pago_tienda", "4000.00", "2026-07-05T00:00:00.000Z"),
    ];
    const { repo } = repoEnMemoria(conPago);
    const r = await servicio(repo).listarMovimientosDeTienda(input(), MAESTRO);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.data.desglose.pagado).toBe("4000.00");
    expect(r.data.desglose.cargos).toBe("1000.00"); // el pago NO se pliega en «cargos»
    expect(r.data.desglose.aFavor).toBe("10000.00");
    expect(r.data.desglose.saldo).toBe("5000.00"); // 10000 - 1000 - 4000
    // Y el movimiento aparece tambien en la lista, con su categoria real.
    expect(ids(r.data.movimientos)).toContain("A-pago");
  });

  it("la cifra sale de la categoria REAL del ledger, atravesando el repositorio de verdad (no un cero fijo)", async () => {
    // Cadena COMPLETA de servidor: WalletTiendaService -> WalletTiendaMovimientoRepository ->
    // Prisma. Solo se falsea la ultima capa (el cliente Prisma), sembrando la fila de pago que
    // hoy nadie emite. Si el servicio devolviera un "0.00" fijo en lugar de leer el ledger,
    // este test caeria.
    const prisma = {
      walletTiendaMovimiento: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "A-pago",
            tiendaId: "tienda-A",
            tipo: "debito",
            categoria: "pago_tienda",
            monto: new Prisma.Decimal("4000.00"),
            origenTipo: "pago_tienda",
            origenId: "p1",
            descripcion: null,
            registradoPor: null,
            fechaMovimiento: new Date("2026-07-05T00:00:00.000Z"),
            createdAt: new Date("2026-07-05T00:00:00.000Z"),
          },
        ]),
        count: vi.fn().mockResolvedValue(1),
        groupBy: vi.fn().mockResolvedValue([
          { tipo: "credito", categoria: "cod_recaudado", _sum: { monto: new Prisma.Decimal("10000.00") } },
          { tipo: "debito", categoria: "flete", _sum: { monto: new Prisma.Decimal("1000.00") } },
          { tipo: "debito", categoria: "pago_tienda", _sum: { monto: new Prisma.Decimal("4000.00") } },
        ]),
        createMany: vi.fn(),
      },
      usuario: { findMany: vi.fn() },
    };
    const svc = new WalletTiendaService(
      new WalletTiendaMovimientoRepository(prisma as unknown as PrismaClient),
    );

    const r = await svc.listarMovimientosDeTienda(input(), MAESTRO);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.data.desglose).toEqual({
      aFavor: "10000.00",
      cargos: "1000.00",
      pagado: "4000.00",
      saldo: "5000.00",
      signo: "positivo",
    });
    // Y el groupBy que lo trajo no excluye ninguna categoria.
    expect(prisma.walletTiendaMovimiento.groupBy.mock.calls[0][0].where).toEqual({
      tiendaId: "tienda-A",
    });
    // R35: ni una consulta al nombre de la tienda.
    expect(prisma.usuario.findMany).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R37 / R39 / R40 — el dataset completo (descarga)
// ─────────────────────────────────────────────────────────────────────────────

describe("WalletTiendaService.listarMovimientosDeTiendaCompleto — dataset completo", () => {
  it("R37: devuelve TODAS las filas del conjunto filtrado, sin recorte por pagina", async () => {
    const filas = Array.from({ length: 140 }, (_, i) =>
      debito(
        `A${String(i).padStart(3, "0")}`,
        "tienda-A",
        "flete",
        "1.00",
        `2026-07-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
      ),
    );
    const svc = servicio(repoEnMemoria(filas).repo);

    const paginado = await svc.listarMovimientosDeTienda(input({ pageSize: 20 }), MAESTRO);
    const completo = await svc.listarMovimientosDeTiendaCompleto(inputCompleto(), MAESTRO);

    expect(paginado.status).toBe("ok");
    expect(completo.status).toBe("ok");
    if (paginado.status !== "ok" || completo.status !== "ok") return;
    expect(paginado.data.movimientos).toHaveLength(20);
    expect(completo.items).toHaveLength(140);
    expect(completo.total).toBe(140);
  });

  it("R27/R40: forbidden a todo rol sin acceso total, sin filas y sin tocar el repositorio", async () => {
    for (const actor of ROLES_SIN_ACCESO) {
      const { repo, listarPorTienda } = repoEnMemoria(dosTiendas());
      const r = await servicio(repo).listarMovimientosDeTiendaCompleto(inputCompleto(), actor);

      expect(r, `rol ${actor.rol}`).toEqual({ status: "forbidden" });
      expect(r, `rol ${actor.rol}`).not.toHaveProperty("items");
      expect(listarPorTienda, `rol ${actor.rol}`).not.toHaveBeenCalled();
    }
  });

  it("R24: el archivo de la tienda A no trae ni una fila de la B, y viceversa (las dos no vacias)", async () => {
    const a = await servicio(repoEnMemoria(dosTiendas()).repo).listarMovimientosDeTiendaCompleto(
      inputCompleto({ tiendaId: "tienda-A" }),
      MAESTRO,
    );
    const b = await servicio(repoEnMemoria(dosTiendas()).repo).listarMovimientosDeTiendaCompleto(
      inputCompleto({ tiendaId: "tienda-B" }),
      MAESTRO,
    );

    expect(a.status).toBe("ok");
    expect(b.status).toBe("ok");
    if (a.status !== "ok" || b.status !== "ok") return;
    expect(ids(a.items)).toEqual(["A-cod", "A-flete"]);
    expect(ids(b.items)).toEqual(["B-cod", "B-flete"]);
    expect(ids(a.items).some((id) => ids(b.items).includes(id))).toBe(false);
  });

  it("R39/R40: limite_excedido lleva total y limite, y NINGUNA fila", async () => {
    const { repo } = repoStub(LIMITE + 1);
    const r = await servicio(repo).listarMovimientosDeTiendaCompleto(inputCompleto(), MAESTRO);

    expect(r).toEqual({ status: "limite_excedido", total: LIMITE + 1, limite: LIMITE });
    expect(r).not.toHaveProperty("items");
  });

  it("R39: nunca pide al repositorio mas de N+1 filas", async () => {
    const { repo, listarPorTienda } = repoStub(50_000);
    const r = await servicio(repo).listarMovimientosDeTiendaCompleto(inputCompleto(), MAESTRO);

    const filtros = listarPorTienda.mock.calls[0][0];
    expect(filtros.page).toBe(1); // => skip 0
    expect(filtros.pageSize).toBe(LIMITE + 1); // => take N+1
    expect(r.status).toBe("limite_excedido");
  });

  it("R40: o entrega TODAS las filas o el error de tope; nunca un dataset truncado", async () => {
    const ok = await servicio(repoStub(LIMITE).repo).listarMovimientosDeTiendaCompleto(
      inputCompleto(),
      MAESTRO,
    );
    expect(ok.status).toBe("ok");
    if (ok.status !== "ok") return;
    expect(ok.items).toHaveLength(LIMITE);
    expect(ok.items.length).toBe(ok.total);
  });

  it("R34: el modo completo NO agrega la cabecera (una consulta menos por descarga)", async () => {
    const { repo, agregarDesglosePorTienda } = repoEnMemoria(dosTiendas());
    await servicio(repo).listarMovimientosDeTiendaCompleto(inputCompleto(), MAESTRO);

    expect(agregarDesglosePorTienda).not.toHaveBeenCalled();
  });

  it("aplica EXACTAMENTE los mismos filtros que el listado (el archivo no muestra otro conjunto)", async () => {
    const { repo, listarPorTienda } = repoEnMemoria(dosTiendas());
    const svc = servicio(repo);
    const filtros = { categoria: "cod_recaudado" as const };

    const paginado = await svc.listarMovimientosDeTienda(input({ ...filtros, pageSize: 50 }), MAESTRO);
    const completo = await svc.listarMovimientosDeTiendaCompleto(inputCompleto(filtros), MAESTRO);

    expect(paginado.status).toBe("ok");
    expect(completo.status).toBe("ok");
    if (paginado.status !== "ok" || completo.status !== "ok") return;
    expect(ids(completo.items)).toEqual(["A-cod"]);
    expect(ids(completo.items)).toEqual(ids(paginado.data.movimientos));

    const sinPaginacion = (o: object) => {
      const c: Record<string, unknown> = { ...o };
      delete c.page;
      delete c.pageSize;
      return c;
    };
    expect(sinPaginacion(listarPorTienda.mock.calls[1][0])).toEqual(
      sinPaginacion(listarPorTienda.mock.calls[0][0]),
    );
  });
});
