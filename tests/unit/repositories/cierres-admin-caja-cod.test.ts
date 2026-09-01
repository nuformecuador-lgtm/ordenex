import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { CierresAdminRepository } from "@/lib/repositories/CierresAdminRepository";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import type { Alcance } from "@/lib/interfaces/repositories/ICierresAdminRepository";
import type { CrearMovimientoInput } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type { CrearMovimientoTiendaInput } from "@/lib/interfaces/repositories/IWalletTiendaMovimientoRepository";
import { ANCLAJE_DEVOLUCION } from "@/tests/fixtures/anclaje-devolucion";

/**
 * Feature 173 / T B.2 (R11/R12/R13/R15) — el enganche del contra-entrega en la APROBACION del
 * cierre, dentro de la misma transaccion.
 *
 * Aqui corre el feed REAL (`CajaCodFeedService`, que el repositorio instancia el mismo) y el
 * repositorio REAL de la caja: lo unico doblado es Prisma. Es la unica forma de medir lo que
 * esta task promete —que el feed lee del LEDGER lo que la linea anterior acaba de escribir— en
 * vez de afirmarlo en un comentario.
 *
 * Los dos dobles imitan a Postgres donde importa:
 *  - `walletMovimiento`, el indice unico parcial `(origen_tipo, origen_id, categoria)`;
 *  - `walletTiendaMovimiento`, el suyo `(origen_tipo, origen_id, tienda_id, categoria)` Y el
 *    `where` del `findMany` (filtra de verdad).
 *  - `$transaction` REVIERTE los dos libros si el callback lanza, que es lo que hace el
 *    todo-o-nada de R15 medible en vez de deducible.
 */

const ALCANCE: Alcance = { destinoTipo: "bodega_central", destinoZonaId: null };
const CIERRE = "c1";

type FilaCaja = Omit<CrearMovimientoInput, "monto"> & { monto: unknown };
type FilaLedger = CrearMovimientoTiendaInput;

/** Monto de una fila ya escrita, normalizado a STRING escala 2 (nunca number). */
function montoDe(fila: { monto: unknown }): string {
  return new Prisma.Decimal(fila.monto as Prisma.Decimal).toFixed(2);
}

function credito(tiendaId: string, monto: string, cierreId = CIERRE): FilaLedger {
  return {
    tiendaId,
    tipo: "credito",
    categoria: "cod_recaudado",
    monto,
    origenTipo: "cierre_dia",
    origenId: cierreId,
    descripcion: null,
    registradoPor: null,
  };
}

function debito(tiendaId: string, monto: string, cierreId = CIERRE): FilaLedger {
  return { ...credito(tiendaId, monto, cierreId), tipo: "debito", categoria: "flete" };
}

/**
 * Prisma doble. `traza` apunta el ORDEN real de los hechos que importan: cuando el ledger se
 * ESCRIBE y cuando se LEE.
 */
function buildPrisma(opciones: { ledgerPrevio?: FilaLedger[]; updateCierreCount?: number } = {}) {
  const traza: string[] = [];
  const caja: FilaCaja[] = [];
  const cajaSeen = new Set<string>();
  const ledger: FilaLedger[] = [...(opciones.ledgerPrevio ?? [])];
  const ledgerSeen = new Set(
    (opciones.ledgerPrevio ?? []).map((r) => `${r.origenTipo}|${r.origenId}|${r.tiendaId}|${r.categoria}`),
  );
  const cierre = { estado: "solicitado" as string };

  const walletMovimiento = {
    createMany: vi.fn(
      async ({ data, skipDuplicates }: { data: FilaCaja[]; skipDuplicates?: boolean }) => {
        let count = 0;
        for (const d of data) {
          if (d.origenId !== null) {
            const k = `${d.origenTipo}|${d.origenId}|${d.categoria}`;
            if (cajaSeen.has(k)) {
              if (skipDuplicates) continue; // ON CONFLICT DO NOTHING
              throw new Error(`unique violation ${k}`);
            }
            cajaSeen.add(k);
          }
          caja.push(d);
          count += 1;
        }
        return { count };
      },
    ),
  };

  const walletTiendaMovimiento = {
    findMany: vi.fn(async (args: { where: Record<string, unknown> }) => {
      traza.push(`lee-ledger:${String(args.where.categoria)}`);
      return ledger
        .filter((f) =>
          Object.entries(args.where).every(
            ([k, v]) => (f as unknown as Record<string, unknown>)[k] === v,
          ),
        )
        .map((f) => ({ monto: new Prisma.Decimal(f.monto) }));
    }),
  };

  const prisma = {
    cierreDia: {
      updateMany: vi.fn(async ({ data }: { data: { estado: string } }) => {
        const count = opciones.updateCierreCount ?? 1;
        if (count === 1) cierre.estado = data.estado;
        return { count };
      }),
      count: vi.fn(async () => 1),
      findUnique: vi.fn(async () => ({ mensajeroId: "m1" })),
    },
    gestionOrden: { findMany: vi.fn(async () => []), updateMany: vi.fn(async () => ({ count: 1 })) },
    cierreDetail: { findMany: vi.fn(async () => []) },
    orden: { findMany: vi.fn(async () => []), updateMany: vi.fn(async () => ({ count: 0 })) },
    walletMovimiento,
    walletTiendaMovimiento,
  };

  return {
    prisma: {
      ...prisma,
      // Todo-o-nada de verdad: si el callback lanza, los dos libros y el estado del cierre
      // vuelven a como estaban. Sin esto, R15 solo se podria "deducir" de que hay un
      // $transaction en el codigo.
      $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
        const snapCaja = caja.length;
        const snapCajaSeen = new Set(cajaSeen);
        const snapLedger = ledger.length;
        const snapLedgerSeen = new Set(ledgerSeen);
        const snapEstado = cierre.estado;
        try {
          return await cb(prisma);
        } catch (e) {
          caja.length = snapCaja;
          cajaSeen.clear();
          for (const k of snapCajaSeen) cajaSeen.add(k);
          ledger.length = snapLedger;
          ledgerSeen.clear();
          for (const k of snapLedgerSeen) ledgerSeen.add(k);
          cierre.estado = snapEstado;
          throw e;
        }
      }),
    },
    caja,
    ledger,
    ledgerSeen,
    cierre,
    traza,
    walletMovimiento,
    walletTiendaMovimiento,
  };
}

type Doble = ReturnType<typeof buildPrisma>;

/**
 * Repositorio del ledger por tienda: doble que ESCRIBE de verdad en el libro en memoria (con
 * su idempotencia) y deja constancia en la traza. Es lo que convierte el orden en algo
 * observable: el feed del COD tiene que leer DESPUES de esta escritura.
 */
function tiendaRepoQueEscribe(d: Doble) {
  return {
    crearMovimientos: vi.fn(async (_tx: unknown, movs: FilaLedger[]) => {
      d.traza.push("escribe-ledger");
      let count = 0;
      for (const m of movs) {
        const k = `${m.origenTipo}|${m.origenId}|${m.tiendaId}|${m.categoria}`;
        if (m.origenId !== null && d.ledgerSeen.has(k)) continue; // skipDuplicates
        if (m.origenId !== null) d.ledgerSeen.add(k);
        d.ledger.push(m);
        count += 1;
      }
      return count;
    }),
    listarPorTienda: vi.fn(),
    agregarSaldoPorTienda: vi.fn(),
    listarSaldosTodasTiendas: vi.fn(),
    listarSaldosTiendasPaginado: vi.fn(),
    agregarDesglosePorTienda: vi.fn(),
    // ficha 335: doble no-op; esta suite no abre el selector de cierres.
    listarCierresDeTienda: vi.fn(async () => []),
    // Ficha 344: la lectura por id acotada a la tienda. Este doble no la ejercita.
    obtenerPorIdDeTienda: vi.fn(async () => null),
  };
}

function buildRepo(
  d: Doble,
  opciones: {
    movsTienda?: FilaLedger[];
    egresoMensajero?: CrearMovimientoInput[];
    tiendaRepo?: ReturnType<typeof tiendaRepoQueEscribe>;
  } = {},
) {
  const tiendaRepo = opciones.tiendaRepo ?? tiendaRepoQueEscribe(d);
  const repo = new CierresAdminRepository(
    d.prisma as unknown as PrismaClient,
    // Repositorio REAL de la caja: es el que ya estaba inyectado desde la feature 42 y el que
    // esta task reusa. Cero dependencias nuevas.
    new WalletMovimientoRepository(d.prisma as unknown as PrismaClient),
    { construirMovimientosDeIngreso: vi.fn(async () => []) },
    tiendaRepo,
    { construirMovimientosPorTienda: vi.fn(async () => opciones.movsTienda ?? []) },
    { crearMovimientos: vi.fn(async () => 0), listarPorMensajero: vi.fn(), agregarCuentaPorPagar: vi.fn(), listarCuentasPorPagarTodos: vi.fn(), listarCuentasPorPagarPaginado: vi.fn(), listarCuentasPorPagarCompleto: vi.fn(), obtenerNombreMensajero: vi.fn(), sumarPremiosVivosPorCierre: vi.fn(async () => ({})), listarPremiosPorDias: vi.fn(async () => []) },
    {
      construirMovimientosDePago: vi.fn(async () => ({
        libro: [],
        egresoCaja: opciones.egresoMensajero ?? [],
      })),
    },
    { construirEgresoIndemnizacion: vi.fn(async () => []) },
  );
  return { repo, tiendaRepo };
}

function aprobar(repo: CierresAdminRepository, cierreId = CIERRE) {
  return repo.resolverCierre({
    cierreId,
    alcance: ALCANCE,
    nuevoEstado: "aprobado",
      anclajeDevolucion: ANCLAJE_DEVOLUCION, // feature 239/T2.1: obligatorio al aprobar
      confirmacionFisica: [], // feature 238/T3.2: obligatorio al aprobar (vacio = el cierre no devuelve nada)
    resueltoPor: "adm",
    motivoRechazo: null,
  });
}

const cod = (d: Doble) => d.caja.filter((m) => m.categoria === "ingreso_cod_recaudado");

describe("T B.2 — aprobar un cierre mete el contra-entrega en la caja (R11/R12/R15)", () => {
  it("R11/R12: UN ingreso `ingreso_cod_recaudado` con la SUMA exacta de los creditos del cierre", async () => {
    const d = buildPrisma();
    const { repo } = buildRepo(d, {
      movsTienda: [credito("t1", "12500.75"), credito("t2", "300.25"), debito("t1", "1000.00")],
    });

    const res = await aprobar(repo);

    expect(res).toBe("updated");
    expect(cod(d)).toHaveLength(1);
    expect(cod(d)[0]).toMatchObject({
      tipo: "ingreso",
      categoria: "ingreso_cod_recaudado",
      origenTipo: "cierre_dia",
      origenId: CIERRE,
      registradoPor: null,
    });
    // 12500.75 + 300.25 = 12801.00. El debito de flete (1000.00) NO entra: eso es lo que
    // Ordenex se queda, y ya entro por su propio concepto en la 42.
    expect(montoDe(cod(d)[0])).toBe("12801.00");
  });

  it("R15: todo dentro de UNA transaccion", async () => {
    const d = buildPrisma();
    const { repo } = buildRepo(d, { movsTienda: [credito("t1", "500.00")] });

    await aprobar(repo);

    expect(d.prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("R12/R15: el feed LEE el ledger DESPUES de que se escribe (orden medido, no comentado)", async () => {
    const d = buildPrisma();
    const { repo } = buildRepo(d, { movsTienda: [credito("t1", "777.00")] });

    await aprobar(repo);

    const escribe = d.traza.indexOf("escribe-ledger");
    const lee = d.traza.indexOf("lee-ledger:cod_recaudado");
    expect(escribe).toBeGreaterThanOrEqual(0);
    expect(lee).toBeGreaterThanOrEqual(0);
    expect(escribe).toBeLessThan(lee);
    // Y la consecuencia, que es lo que de verdad importa: al leer, el credito YA estaba, asi
    // que el ingreso existe. Invertir las dos lineas dejaria la caja sin el.
    expect(montoDe(cod(d)[0])).toBe("777.00");
  });

  it("R12: el monto sale del LEDGER, no del array que el feed de la 43 devolvio", async () => {
    // Reintento de una aprobacion: el ledger YA tiene el credito de 8000.00 de la primera
    // pasada, y el feed de la 43 reconstruye 5000.00 (por ejemplo, porque una gestion se
    // anulo despues). El `skipDuplicates` del ledger conserva el 8000.00 original —es
    // append-only— y en la caja tiene que entrar EL DEL LEDGER.
    const d = buildPrisma({ ledgerPrevio: [credito("t1", "8000.00")] });
    const { repo } = buildRepo(d, { movsTienda: [credito("t1", "5000.00")] });

    await aprobar(repo);

    expect(montoDe(cod(d)[0])).toBe("8000.00");
    expect(montoDe(cod(d)[0])).not.toBe("5000.00");
  });

  it("R15: si la escritura en la caja falla, la aprobacion ENTERA revierte", async () => {
    const d = buildPrisma();
    const { repo } = buildRepo(d, { movsTienda: [credito("t1", "999.00")] });
    // La caja rechaza JUSTO el ingreso del contra-entrega (disco lleno, deadlock, lo que sea)
    // y solo ese: si el fallo fuera de otra escritura, el test pasaria por el motivo
    // equivocado.
    const original = d.walletMovimiento.createMany.getMockImplementation()!;
    d.walletMovimiento.createMany.mockImplementation(async (args: { data: FilaCaja[] }) => {
      if (args.data.some((m) => m.categoria === "ingreso_cod_recaudado")) {
        throw new Error("fallo al escribir en la caja");
      }
      return original(args);
    });

    await expect(aprobar(repo)).rejects.toThrow("fallo al escribir en la caja");

    // Nada de cierre aprobado sin su COD: ni el estado, ni el ledger, ni la caja.
    expect(d.cierre.estado).toBe("solicitado");
    expect(d.caja).toHaveLength(0);
    expect(d.ledger).toHaveLength(0);
  });
});

describe("T B.2 — R13: un cierre sin contra-entrega no toca la caja", () => {
  it("solo debitos en el ledger -> NI UNA fila de contra-entrega (ni en 0.00)", async () => {
    const d = buildPrisma();
    const { repo } = buildRepo(d, { movsTienda: [debito("t1", "1000.00")] });

    await aprobar(repo);

    expect(cod(d)).toHaveLength(0);
    expect(d.caja.some((m) => montoDe(m) === "0.00")).toBe(false);
  });

  it("un cierre que no acredita nada tampoco pregunta al ledger", async () => {
    const d = buildPrisma();
    const { repo } = buildRepo(d, { movsTienda: [] });

    await aprobar(repo);

    expect(cod(d)).toHaveLength(0);
    expect(d.traza).not.toContain("lee-ledger:cod_recaudado");
  });

  it("RECHAZAR un cierre no mete contra-entrega en la caja", async () => {
    const d = buildPrisma();
    const { repo } = buildRepo(d, { movsTienda: [credito("t1", "12500.00")] });

    const res = await repo.resolverCierre({
      cierreId: CIERRE,
      alcance: ALCANCE,
      nuevoEstado: "rechazado",
      resueltoPor: "adm",
      motivoRechazo: "no cuadra",
    });

    expect(res).toBe("updated");
    expect(d.caja).toHaveLength(0);
    expect(d.traza).toHaveLength(0);
  });

  it("un cierre que NO se aprueba (guardia perdida) no mete nada", async () => {
    const d = buildPrisma({ updateCierreCount: 0 });
    const { repo } = buildRepo(d, { movsTienda: [credito("t1", "12500.00")] });

    expect(await aprobar(repo)).toBe("conflict");
    expect(d.caja).toHaveLength(0);
  });
});

describe("T B.2 — R14: reintentar la aprobacion no duplica el contra-entrega", () => {
  it("aprobar DOS veces deja UNA sola fila, con su monto intacto", async () => {
    const d = buildPrisma();
    const tiendaRepo = tiendaRepoQueEscribe(d);
    const { repo } = buildRepo(d, {
      movsTienda: [credito("t1", "12500.75"), credito("t2", "300.25")],
      tiendaRepo,
    });

    await aprobar(repo);
    await aprobar(repo);

    expect(cod(d)).toHaveLength(1);
    expect(montoDe(cod(d)[0])).toBe("12801.00");
    // Y el ledger tampoco se duplico, asi que el monto leido la segunda vez es el mismo.
    expect(d.ledger).toHaveLength(2);
  });
});

describe("T B.2 — el pago al MENSAJERO no cambia [P2]", () => {
  it("el egreso `egreso_pago_mensajero` se sigue emitiendo tal cual, junto al COD", async () => {
    // P2 = (a): la 173 NO toca el feed del mensajero. Este caso lo fija: el egreso que emite
    // la 44 llega a la caja con SU monto (el costo total P), sin recortes ni `min(P,E)`, y la
    // llegada del contra-entrega no lo altera.
    const d = buildPrisma();
    const { repo } = buildRepo(d, {
      movsTienda: [credito("t1", "12500.75")],
      egresoMensajero: [
        {
          tipo: "egreso",
          categoria: "egreso_pago_mensajero",
          monto: "4000.00",
          origenTipo: "cierre_dia",
          origenId: CIERRE,
          descripcion: null,
          registradoPor: null,
        },
      ],
    });

    await aprobar(repo);

    const mensajero = d.caja.filter((m) => m.categoria === "egreso_pago_mensajero");
    expect(mensajero).toHaveLength(1);
    expect(montoDe(mensajero[0])).toBe("4000.00");
    expect(cod(d)).toHaveLength(1);
    expect(montoDe(cod(d)[0])).toBe("12500.75");
  });
});

describe("T B.2 — cero dependencias nuevas en el constructor", () => {
  it("el constructor sigue teniendo OCHO parametros: el repositorio de la caja ya estaba", () => {
    // Guardia estructural del acuerdo de la task. Inyectar el feed del COD habria obligado a
    // tocar los 12 sitios que construyen este repositorio —entre ellos las suites de la 42, la
    // 43, la 44 y la 158—, que es exactamente lo que la 173 se prohibio a si misma (R68).
    expect(CierresAdminRepository.length).toBe(8);
  });
});
