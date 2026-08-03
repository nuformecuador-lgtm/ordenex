import { describe, it, expect, vi } from "vitest";
import { WalletTiendaService } from "@/lib/services/WalletTiendaService";
import { WalletTiendaMovimientoRepository } from "@/lib/repositories/WalletTiendaMovimientoRepository";
import type {
  IWalletTiendaMovimientoRepository,
  SaldoTiendaAgregadoRow,
} from "@/lib/interfaces/repositories/IWalletTiendaMovimientoRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { RangoPagina } from "@/lib/utils/rango-pagina";
import { listarSaldosTiendasPaginadoSchema } from "@/lib/types/wallet-tienda";

// Feature 170 — FASE 2, T I.1 (R40/R41/R44/R51/R54) — «Saldos de tiendas» paginado.
//
// El acotamiento es por ROL, y es de los duros: `adminTienda` NO entra ni pidiendo lo suyo (su
// superficie es `listarMisMovimientos`, que acota por el actor). Este listado es el saldo de
// TODAS las tiendas: abrirlo a una tienda seria darle el de su competencia.
//
// Ademas es el unico de los siete cuya pagina NO se corta en la base: cada fila es una
// agregacion de todo el ledger de esa tienda, asi que no hay nada que empujar al LIMIT. Ver la
// desviacion declarada de R51 (este listado no tenia criterio de ordenacion) en el repositorio.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "u-admin", rol: "admin" };

const ROLES_SIN_ACCESO: Actor[] = [
  { usuarioId: "t1", rol: "adminTienda" }, // ni siquiera para ver el suyo
  { usuarioId: "s1", rol: "adminSatelite" },
  { usuarioId: "g1", rol: "mensajero" },
  { usuarioId: "k1", rol: "apiKey" },
  { usuarioId: "x1", rol: "otroRolInventado" as Actor["rol"] },
];

/**
 * Almacen deliberadamente DESORDENADO por nombre: si el recorte no ordenara, la pagina 1 y la
 * pagina 2 podrian solaparse y este test no lo veria.
 */
const AGREGADOS: SaldoTiendaAgregadoRow[] = [
  { tiendaId: "t-3", tiendaNombre: "Carlos", creditos: "1000.00", debitos: "250.00" },
  { tiendaId: "t-1", tiendaNombre: "Ana", creditos: "500.00", debitos: "500.00" },
  { tiendaId: "t-5", tiendaNombre: "Elena", creditos: "0.00", debitos: "80.00" },
  { tiendaId: "t-2", tiendaNombre: "Beto", creditos: "300.00", debitos: "100.00" },
  { tiendaId: "t-4", tiendaNombre: "Dora", creditos: "10.00", debitos: "0.00" },
];

/**
 * Repositorio doble que delega el recorte en la IMPLEMENTACION REAL del repositorio: se
 * inyecta la agregacion y `listarSaldosTiendasPaginado` corre el codigo de produccion (orden +
 * slice + total). Asi el test afirma el comportamiento del repositorio, no el de una copia.
 */
function repoEnMemoria(filas: SaldoTiendaAgregadoRow[] = AGREGADOS) {
  const llamadas: string[] = [];

  const listarSaldosTodasTiendas = vi.fn(async () => {
    llamadas.push("listarSaldosTodasTiendas");
    return filas;
  });

  // El recorte lo hace la IMPLEMENTACION REAL del repositorio, con su unica dependencia
  // (`listarSaldosTodasTiendas`) sustituida por el doble de arriba. No se instancia con un
  // Prisma falso porque este metodo no toca Prisma: solo reusa la agregacion.
  const listarSaldosTiendasPaginado = vi.fn(async (rango: RangoPagina) => {
    llamadas.push("listarSaldosTiendasPaginado");
    return WalletTiendaMovimientoRepository.prototype.listarSaldosTiendasPaginado.call(
      { listarSaldosTodasTiendas } as unknown as WalletTiendaMovimientoRepository,
      rango,
    );
  });

  const repo = {
    listarSaldosTodasTiendas,
    listarSaldosTiendasPaginado,
    listarPorTienda: vi.fn(),
    agregarSaldoPorTienda: vi.fn(),
    agregarDesglosePorTienda: vi.fn(),
    crearMovimientos: vi.fn(),
  } as unknown as IWalletTiendaMovimientoRepository;

  return { repo, llamadas, listarSaldosTiendasPaginado };
}

function servicio(repo: IWalletTiendaMovimientoRepository) {
  return new WalletTiendaService(repo);
}

function input(extra: Record<string, unknown> = {}) {
  return listarSaldosTiendasPaginadoSchema.parse(extra);
}

function nombres(items: ReadonlyArray<{ tiendaNombre: string }>): string[] {
  return items.map((t) => t.tiendaNombre);
}

describe("WalletTiendaService.listarSaldosTiendasPaginado", () => {
  it("devuelve la pagina pedida y el total del conjunto (R40, R41)", async () => {
    const svc = servicio(repoEnMemoria().repo);

    const p1 = await svc.listarSaldosTiendasPaginado(input({ page: 1, pageSize: 2 }), MAESTRO);
    const p2 = await svc.listarSaldosTiendasPaginado(input({ page: 2, pageSize: 2 }), MAESTRO);
    const p3 = await svc.listarSaldosTiendasPaginado(input({ page: 3, pageSize: 2 }), MAESTRO);

    if (p1.status !== "ok" || p2.status !== "ok" || p3.status !== "ok") throw new Error("no ok");

    expect(nombres(p1.items)).toEqual(["Ana", "Beto"]);
    expect(nombres(p2.items)).toEqual(["Carlos", "Dora"]);
    expect(nombres(p3.items)).toEqual(["Elena"]);

    for (const p of [p1, p2, p3]) expect(p.total).toBe(5); // R41: el del CONJUNTO
    expect(p3.total).not.toBe(p3.items.length);
  });

  it("acota el tamano de pagina al maximo configurado y nunca lo excede (R40)", async () => {
    const r = await servicio(repoEnMemoria().repo).listarSaldosTiendasPaginado(
      input({ pageSize: 100000 }),
      MAESTRO,
    );
    if (r.status !== "ok") throw new Error("no ok");
    expect(r.pageSize).toBe(100); // walletTiendaConfig.MAX_PAGE_SIZE
  });

  it("el conjunto paginado y el dataset completo coinciden para el mismo actor (R44)", async () => {
    for (const actor of [MAESTRO, ADMIN]) {
      const svc = servicio(repoEnMemoria().repo);
      const sinPaginar = await svc.listarSaldosTiendas(actor);
      if (sinPaginar.status !== "ok") throw new Error("no ok");

      const recorrido: typeof sinPaginar.tiendas = [];
      let total = -1;
      for (let page = 1; page <= 10; page += 1) {
        const p = await svc.listarSaldosTiendasPaginado(input({ page, pageSize: 2 }), actor);
        if (p.status !== "ok") throw new Error("no ok");
        total = p.total;
        if (p.items.length === 0) break;
        recorrido.push(...p.items);
      }

      // Mismo CONJUNTO de tiendas y mismo saldo derivado en cada una: la unica diferencia
      // admitida entre las dos lecturas es el orden (ver la desviacion declarada de R51).
      const claves = (xs: typeof recorrido) =>
        xs.map((t) => `${t.tiendaId}|${t.saldo}|${t.signo}`).sort();
      expect(claves(recorrido), `rol ${actor.rol}`).toEqual(claves(sinPaginar.tiendas));
      expect(total, `rol ${actor.rol}`).toBe(sinPaginar.tiendas.length);
    }
  });

  it("CONTRAPRUEBA de R44: forbidden sin filas ni total, ni siquiera a la propia tienda", async () => {
    for (const actor of ROLES_SIN_ACCESO) {
      const { repo, llamadas } = repoEnMemoria();
      const r = await servicio(repo).listarSaldosTiendasPaginado(input(), actor);

      expect(r, `rol ${actor.rol}`).toEqual({ status: "forbidden" });
      expect(r, `rol ${actor.rol}`).not.toHaveProperty("items");
      expect(r, `rol ${actor.rol}`).not.toHaveProperty("total");
      // El guard va ANTES del repositorio: el saldo de todas las tiendas no sale de la base.
      expect(llamadas, `rol ${actor.rol}`).toEqual([]);
    }

    // El otro lado: el acceso total SI recibe las filas, con su saldo derivado.
    for (const actor of [MAESTRO, ADMIN]) {
      const r = await servicio(repoEnMemoria().repo).listarSaldosTiendasPaginado(
        input({ pageSize: 50 }),
        actor,
      );
      if (r.status !== "ok") throw new Error("no ok");
      expect(nombres(r.items), `rol ${actor.rol}`).toEqual(["Ana", "Beto", "Carlos", "Dora", "Elena"]);
      expect(r.items.map((t) => `${t.saldo}/${t.signo}`)).toEqual([
        "0.00/cero", // Ana: 500 - 500
        "200.00/positivo", // Beto: 300 - 100
        "750.00/positivo", // Carlos: 1000 - 250
        "10.00/positivo", // Dora: 10 - 0
        "-80.00/negativo", // Elena: 0 - 80
      ]);
    }
  });

  it("ordena por nombre de tienda, con un orden TOTAL que no solapa paginas (R51)", async () => {
    // Dos tiendas con el MISMO nombre: sin desempate por id, el orden no seria total y una de
    // las dos podria aparecer en dos paginas (o en ninguna).
    const homonimas: SaldoTiendaAgregadoRow[] = [
      { tiendaId: "t-b", tiendaNombre: "Repetida", creditos: "2.00", debitos: "0.00" },
      { tiendaId: "t-a", tiendaNombre: "Repetida", creditos: "1.00", debitos: "0.00" },
      { tiendaId: "t-c", tiendaNombre: "Zeta", creditos: "3.00", debitos: "0.00" },
    ];
    const svc = servicio(repoEnMemoria(homonimas).repo);

    const p1 = await svc.listarSaldosTiendasPaginado(input({ page: 1, pageSize: 1 }), MAESTRO);
    const p2 = await svc.listarSaldosTiendasPaginado(input({ page: 2, pageSize: 1 }), MAESTRO);
    const p3 = await svc.listarSaldosTiendasPaginado(input({ page: 3, pageSize: 1 }), MAESTRO);
    if (p1.status !== "ok" || p2.status !== "ok" || p3.status !== "ok") throw new Error("no ok");

    const recorrido = [...p1.items, ...p2.items, ...p3.items].map((t) => t.tiendaId);
    expect(recorrido).toEqual(["t-a", "t-b", "t-c"]);
    expect(new Set(recorrido).size).toBe(3); // ninguna repetida entre paginas
  });

  it("no ejecuta mas consultas que el listado sin paginar, salvo el conteo (R54)", async () => {
    const sinPaginar = repoEnMemoria();
    await servicio(sinPaginar.repo).listarSaldosTiendas(MAESTRO);
    expect(sinPaginar.llamadas).toEqual(["listarSaldosTodasTiendas"]);

    const paginado = repoEnMemoria();
    await servicio(paginado.repo).listarSaldosTiendasPaginado(input({ pageSize: 2 }), MAESTRO);

    // UNA llamada al repositorio desde el servicio, y por dentro exactamente la MISMA
    // agregacion que el listado sin paginar. Aqui R54 se cumple en su forma fuerte: ni
    // siquiera el conteo es una consulta nueva, porque sale de esa agregacion.
    expect(paginado.llamadas).toEqual([
      "listarSaldosTiendasPaginado",
      "listarSaldosTodasTiendas",
    ]);
    await expect(paginado.listarSaldosTiendasPaginado.mock.results[0]!.value).resolves.toMatchObject(
      { total: 5 },
    );

    // Y el coste no crece con el numero de filas de la pagina.
    const grande = repoEnMemoria();
    await servicio(grande.repo).listarSaldosTiendasPaginado(input({ pageSize: 100 }), MAESTRO);
    expect(grande.llamadas).toEqual(["listarSaldosTiendasPaginado", "listarSaldosTodasTiendas"]);
  });
});
