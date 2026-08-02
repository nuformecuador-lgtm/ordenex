import { describe, it, expect } from "vitest";
import { Prisma, RolValue, type PrismaClient } from "@prisma/client";
import { LiquidacionPagoRepository } from "@/lib/repositories/LiquidacionPagoRepository";
import { WalletTiendaMovimientoRepository } from "@/lib/repositories/WalletTiendaMovimientoRepository";
import { LiquidacionService } from "@/lib/services/LiquidacionService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { LiquidacionTx } from "@/lib/interfaces/services/ILiquidacionService";
import type { RegistrarPagoTiendaInput } from "@/lib/types/liquidacion";

// Feature 172 / T B.4 — EL CANDADO DE SERIALIZACION [P1] (design §4.2). Cubre R46, R83 y R85.
//
// Por que este archivo existe. El humano eligio RECHAZAR el pago que excede lo debido (P1), y
// esa comprobacion solo vale si nadie puede leer el mismo disponible a la vez: con
// `READ COMMITTED` —el default de Prisma— dos transacciones simultaneas leerian el mismo saldo,
// las dos pasarian el tope y entre las dos se pagaria de mas. El candado no es un detalle de
// implementacion: es la mitad de la respuesta a P1.
//
// Como se verifica sin Postgres (los tests del repo no levantan base): el store de abajo
// implementa la SEMANTICA de lo que la base hace —el `FOR UPDATE` hace ESPERAR a la segunda
// transaccion, y una transaccion solo publica sus escrituras al hacer commit— y el resto de la
// cadena es CODIGO REAL: el servicio real, los DOS repositorios reales y el SQL crudo real. El
// store ni siquiera sabe a quien bloquea: lee `FOR UPDATE` de la sentencia que emite
// `LiquidacionPagoRepository`. Si alguien quitara el `FOR UPDATE` del repositorio, aqui no se
// tomaria ningun candado.
//
// PRUEBA POR MUTACION: obligatoria y ejecutada; la salida esta pegada en
// `progress/impl_172-liquidacion.md`. Un test de concurrencia que pasa sin candado no prueba
// nada.
//
// Money-safe: ni un `Number(` ni un `parseFloat` sobre un monto en todo el archivo.

const ACTOR: Actor = { usuarioId: "u-admin", rol: RolValue.admin };

/** Cede el turno de verdad (macrotarea): sin esto las dos «transacciones» no se entrelazan. */
function tic(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

type FilaMovimiento = {
  tiendaId: string;
  tipo: "credito" | "debito";
  categoria: string;
  monto: Prisma.Decimal;
  origenTipo: string;
  origenId: string | null;
  descripcion: string | null;
  registradoPor: string | null;
  fechaMovimiento?: Date;
};

type FilaPago = {
  id: string;
  claveIdempotencia: string;
  mensajeroId: string | null;
  tiendaId: string | null;
  cierreId: string | null;
  monto: Prisma.Decimal;
  metodo: string;
  referencia: string | null;
  nota: string | null;
  fechaPago: Date;
  registradoPor: string;
  createdAt: Date;
  registrador: { nombre: string };
  anulacion: null;
};

/**
 * Store en memoria con la semantica REAL de tres cosas de la base:
 *
 *  1. `SELECT … FOR UPDATE`: la segunda transaccion que pide la misma fila ESPERA hasta que la
 *     primera termina. Se detecta leyendo `FOR UPDATE` en la sentencia cruda que emite el
 *     repositorio: el store no tiene una lista de a quien bloquear.
 *  2. Visibilidad transaccional: lo escrito dentro de una transaccion solo se ve DESPUES del
 *     commit, y el candado se suelta DESPUES de publicar (commit -> release, ese orden).
 *  3. `UNIQUE(clave_idempotencia)` y el indice unico parcial de los libros.
 */
function makeStore(saldoInicial: string) {
  const movimientos: FilaMovimiento[] = [
    {
      tiendaId: "t1",
      tipo: "credito",
      categoria: "cod_recaudado",
      monto: new Prisma.Decimal(saldoInicial),
      origenTipo: "cierre_dia",
      origenId: "c-previo",
      descripcion: null,
      registradoPor: null,
    },
  ];
  const clavesMovimiento = new Set<string>(["cierre_dia|c-previo|t1|cod_recaudado"]);
  const pagos: FilaPago[] = [];
  const clavesIdempotencia = new Set<string>();
  const candados = new Map<string, Promise<void>>();
  const log: string[] = [];
  let seq = 0;

  /** Cola FIFO por clave: `adquirir` no resuelve hasta que el titular anterior libera. */
  async function adquirir(clave: string): Promise<() => void> {
    const anterior = candados.get(clave) ?? Promise.resolve();
    let liberar!: () => void;
    const mio = new Promise<void>((resolve) => {
      liberar = resolve;
    });
    candados.set(
      clave,
      anterior.then(() => mio),
    );
    await anterior; // ← ESTA es la espera que serializa
    return liberar;
  }

  const claveMov = (d: FilaMovimiento) =>
    `${d.origenTipo}|${d.origenId}|${d.tiendaId}|${d.categoria}`;

  // Lecturas COMMITEADAS (el cliente propio del repositorio, fuera de la transaccion).
  const clienteLectura = {
    walletTiendaMovimiento: {
      groupBy: async ({
        by,
        where,
      }: {
        by: string[];
        where: { tiendaId?: string };
      }) => {
        if (by.join() !== "tipo" || where.tiendaId === undefined) {
          throw new Error(`el store no soporta este groupBy: ${JSON.stringify({ by, where })}`);
        }
        log.push(`leer-disponible:${where.tiendaId}`);
        // ⚠️ EL ORDEN DE ESTAS DOS LINEAS ES LA MITAD DEL EXPERIMENTO.
        //
        // En `READ COMMITTED` —el default de Prisma— una sentencia toma su INSTANTANEA cuando
        // EMPIEZA, no cuando devuelve. Por eso el store fotografia las filas AQUI y solo
        // despues cede el turno: si la foto se tomara tras el `tic`, la segunda transaccion
        // veria siempre el commit de la primera aunque nadie la hubiera hecho esperar, y el
        // test de carrera pasaria SIN candado — es decir, no probaria nada. Medido: con la
        // foto despues del `tic`, quitar el candado del servicio dejaba el test en verde.
        const propias = movimientos.filter((m) => m.tiendaId === where.tiendaId);
        const suma = (tipo: "credito" | "debito") =>
          propias
            .filter((m) => m.tipo === tipo)
            .reduce((acc, m) => acc.add(m.monto), new Prisma.Decimal(0));
        const resultado = [
          { tipo: "credito" as const, _sum: { monto: suma("credito") } },
          { tipo: "debito" as const, _sum: { monto: suma("debito") } },
        ];
        await tic(); // la respuesta llega despues: es lo que da hueco al entrelazado
        return resultado;
      },
    },
    liquidacionPago: {
      findUnique: async ({ where }: { where: { claveIdempotencia?: string; id?: string } }) => {
        // Misma convencion que arriba: instantanea al empezar la sentencia, respuesta despues.
        const fila = pagos.find(
          (p) =>
            (where.claveIdempotencia !== undefined &&
              p.claveIdempotencia === where.claveIdempotencia) ||
            (where.id !== undefined && p.id === where.id),
        );
        await tic();
        return fila ?? null;
      },
    },
  };

  /** Abre una transaccion: escrituras diferidas al commit y candados sueltos al cerrar. */
  async function runTransaction<T>(fn: (tx: LiquidacionTx) => Promise<T>): Promise<T> {
    const aplicarAlCommit: Array<() => void> = [];
    const liberadores: Array<() => void> = [];
    const clavesPendientes = new Set<string>();

    const tx = {
      $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const texto = strings.join("?").replace(/\s+/g, " ").trim();
        if (!/FOR UPDATE/.test(texto)) {
          throw new Error(`el store solo entiende sentencias de bloqueo; llego: ${texto}`);
        }
        const tabla = /FROM "([a-z_]+)"/.exec(texto)?.[1];
        if (tabla === undefined) throw new Error(`no se pudo leer la tabla de: ${texto}`);
        log.push(`candado:${tabla}:${String(values[0])}`);
        liberadores.push(await adquirir(`${tabla}:${String(values[0])}`));
        log.push(`candado-tomado:${tabla}:${String(values[0])}`);
        return [{ id: values[0] }];
      },
      liquidacionPago: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          const clave = data.claveIdempotencia as string;
          if (clavesIdempotencia.has(clave) || clavesPendientes.has(clave)) {
            // UNIQUE(clave_idempotencia): la barrera es DE DATOS (R44), no un `if` previo.
            throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
              code: "P2002",
              clientVersion: "7.0.0",
              meta: { target: ["clave_idempotencia"] },
            });
          }
          clavesPendientes.add(clave);
          const fila: FilaPago = {
            id: `pago-${++seq}`,
            claveIdempotencia: clave,
            mensajeroId: (data.mensajeroId as string | null) ?? null,
            tiendaId: (data.tiendaId as string | null) ?? null,
            cierreId: (data.cierreId as string | null) ?? null,
            monto: data.monto as Prisma.Decimal,
            metodo: data.metodo as string,
            referencia: (data.referencia as string | null) ?? null,
            nota: (data.nota as string | null) ?? null,
            fechaPago: data.fechaPago as Date,
            registradoPor: data.registradoPor as string,
            createdAt: new Date("2026-08-02T15:04:05.000Z"),
            registrador: { nombre: "Ana Admin" },
            anulacion: null,
          };
          log.push(`crear-documento:${fila.id}`);
          aplicarAlCommit.push(() => {
            pagos.push(fila);
            clavesIdempotencia.add(clave);
          });
          return fila;
        },
      },
      walletTiendaMovimiento: {
        createMany: async ({
          data,
          skipDuplicates,
        }: {
          data: FilaMovimiento[];
          skipDuplicates?: boolean;
        }) => {
          const aInsertar: FilaMovimiento[] = [];
          for (const d of data) {
            const k = claveMov(d);
            if (d.origenId !== null && (clavesMovimiento.has(k) || clavesPendientes.has(k))) {
              if (skipDuplicates) continue; // ON CONFLICT DO NOTHING
              throw new Error(`unique violation ${k}`);
            }
            if (d.origenId !== null) clavesPendientes.add(k);
            aInsertar.push(d);
          }
          log.push(`crear-movimiento:${aInsertar.length}`);
          aplicarAlCommit.push(() => {
            for (const d of aInsertar) {
              movimientos.push(d);
              if (d.origenId !== null) clavesMovimiento.add(claveMov(d));
            }
          });
          return { count: aInsertar.length };
        },
      },
      pagoMensajeroMovimiento: {
        createMany: async () => {
          throw new Error("el pago a una tienda NO debe tocar el libro del mensajero");
        },
      },
    };

    try {
      const r = await fn(tx as unknown as LiquidacionTx);
      for (const aplicar of aplicarAlCommit) aplicar(); // COMMIT: publica…
      log.push("commit");
      return r;
    } finally {
      for (const liberar of liberadores) liberar(); // …y solo entonces suelta el candado
    }
  }

  return { movimientos, pagos, log, runTransaction, clienteLectura };
}

function buildService(store: ReturnType<typeof makeStore>) {
  const pagoRepo = new LiquidacionPagoRepository(store.clienteLectura as unknown as PrismaClient);
  const tiendaRepo = new WalletTiendaMovimientoRepository(
    store.clienteLectura as unknown as PrismaClient,
  );
  return new LiquidacionService(pagoRepo, tiendaRepo, store.runTransaction);
}

function pago(monto: string, clave: string): RegistrarPagoTiendaInput {
  return {
    claveIdempotencia: clave,
    tiendaId: "t1",
    monto,
    metodo: "efectivo",
    fechaPago: "2026-07-30",
  };
}

const CLAVE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLAVE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/** Σ de los debitos `pago_tienda` que quedaron en el ledger, como STRING money-safe. */
function totalPagado(store: ReturnType<typeof makeStore>): string {
  return store.movimientos
    .filter((m) => m.categoria === "pago_tienda")
    .reduce((acc, m) => acc.add(m.monto), new Prisma.Decimal(0))
    .toFixed(2);
}

describe("R83 — el bloqueo se toma ANTES de leer cuanto hay disponible", () => {
  it("el orden de las sentencias es candado -> lectura, no al reves", async () => {
    const store = makeStore("100000.00");
    const service = buildService(store);

    const r = await service.registrarPagoTienda(pago("60000.00", CLAVE_A), ACTOR);

    expect(r.status).toBe("ok");
    // El log lo escribe el STORE, en el borde de la sentencia: mide lo que llega a la base, no
    // lo que el servicio dice que hace.
    expect(store.log).toEqual([
      "candado:usuario:t1",
      "candado-tomado:usuario:t1",
      "leer-disponible:t1",
      "crear-documento:pago-1",
      "crear-movimiento:1",
      "commit",
    ]);
    const iCandado = store.log.indexOf("candado-tomado:usuario:t1");
    const iLectura = store.log.indexOf("leer-disponible:t1");
    expect(iCandado).toBeGreaterThanOrEqual(0);
    expect(iCandado).toBeLessThan(iLectura); // un candado tomado DESPUES no serializa nada
  });

  it("el candado es sobre la fila de la TIENDA, que es lo que se consume", async () => {
    const store = makeStore("100000.00");
    const service = buildService(store);

    await service.registrarPagoTienda(pago("1000.00", CLAVE_A), ACTOR);

    expect(store.log.filter((l) => l.startsWith("candado:"))).toEqual(["candado:usuario:t1"]);
  });
});

describe("R85 — ninguna operacion toma mas de un bloqueo", () => {
  it("un pago que entra toma EXACTAMENTE un candado", async () => {
    const store = makeStore("100000.00");
    const service = buildService(store);

    await service.registrarPagoTienda(pago("60000.00", CLAVE_A), ACTOR);

    expect(store.log.filter((l) => l.startsWith("candado:"))).toHaveLength(1);
  });

  it("tambien los caminos que RECHAZAN toman uno y solo uno (y lo sueltan)", async () => {
    const store = makeStore("100000.00");
    const service = buildService(store);

    const excede = await service.registrarPagoTienda(pago("100000.01", CLAVE_A), ACTOR);
    expect(excede.status).toBe("excede");
    expect(store.log.filter((l) => l.startsWith("candado:"))).toHaveLength(1);

    // Si el candado del intento anterior no se hubiera soltado, esta llamada se colgaria.
    const ok = await service.registrarPagoTienda(pago("100000.00", CLAVE_B), ACTOR);
    expect(ok.status).toBe("ok");
    expect(store.log.filter((l) => l.startsWith("candado:"))).toHaveLength(2);
  });

  it("con un solo recurso bloqueado no existe orden de adquisicion que interbloquee", async () => {
    // Dos pagos a DOS tiendas distintas no comparten candado y no se estorban: la prueba de que
    // el grano es la fila del beneficiario y no una tabla entera.
    const store = makeStore("100000.00");
    store.movimientos.push({
      tiendaId: "t2",
      tipo: "credito",
      categoria: "cod_recaudado",
      monto: new Prisma.Decimal("50000.00"),
      origenTipo: "cierre_dia",
      origenId: "c-previo-2",
      descripcion: null,
      registradoPor: null,
    });
    const service = buildService(store);

    const [a, b] = await Promise.all([
      service.registrarPagoTienda(pago("60000.00", CLAVE_A), ACTOR),
      service.registrarPagoTienda({ ...pago("50000.00", CLAVE_B), tiendaId: "t2" }, ACTOR),
    ]);

    expect(a.status).toBe("ok");
    expect(b.status).toBe("ok");
    expect(store.log.filter((l) => l.startsWith("candado:")).sort()).toEqual([
      "candado:usuario:t1",
      "candado:usuario:t2",
    ]);
  });
});

describe("R46 [P1] — dos registros simultaneos no saldan mas de lo debido", () => {
  it("con 100 000 disponibles, dos pagos de 60 000 a la vez: uno entra y el otro se rechaza", async () => {
    const store = makeStore("100000.00");
    const service = buildService(store);

    // Las dos operaciones arrancan SIN esperar a la otra: es la carrera, no una secuencia.
    const [a, b] = await Promise.all([
      service.registrarPagoTienda(pago("60000.00", CLAVE_A), ACTOR),
      service.registrarPagoTienda(pago("60000.00", CLAVE_B), ACTOR),
    ]);

    const estados = [a.status, b.status].sort();
    expect(estados).toEqual(["excede", "ok"]);

    // El que se rechaza informa de lo que QUEDA de verdad tras el otro (100 000 - 60 000).
    const rechazado = a.status === "excede" ? a : b;
    if (rechazado.status !== "excede") throw new Error("esperaba excede");
    expect(rechazado.disponible).toBe("40000.00");

    // Lo que de verdad importa: entre las dos NO se pago mas de lo que habia.
    expect(totalPagado(store)).toBe("60000.00");
    expect(store.pagos).toHaveLength(1);
  });

  it("la segunda transaccion ESPERA: su lectura ocurre despues del commit de la primera", async () => {
    const store = makeStore("100000.00");
    const service = buildService(store);

    await Promise.all([
      service.registrarPagoTienda(pago("60000.00", CLAVE_A), ACTOR),
      service.registrarPagoTienda(pago("60000.00", CLAVE_B), ACTOR),
    ]);

    // Las dos piden el candado al principio (`candado:`), pero solo una lo TOMA
    // (`candado-tomado:`) antes del commit de la otra. Sin serializacion, las dos lecturas
    // caerian antes del primer commit y las dos verian 100 000.
    const commit = store.log.indexOf("commit");
    const lecturas = store.log
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => l.startsWith("leer-disponible:"))
      .map(({ i }) => i);
    expect(lecturas).toHaveLength(2);
    expect(lecturas[0]).toBeLessThan(commit);
    expect(lecturas[1]).toBeGreaterThan(commit); // la segunda lee DESPUES del commit del primero
  });

  it("tres a la vez contra 100 000: entran los que caben y el resto se rechaza", async () => {
    const store = makeStore("100000.00");
    const service = buildService(store);

    const [a, b, c] = await Promise.all([
      service.registrarPagoTienda(pago("60000.00", CLAVE_A), ACTOR),
      service.registrarPagoTienda(pago("60000.00", CLAVE_B), ACTOR),
      service.registrarPagoTienda(pago("40000.00", "cccccccc-cccc-4ccc-8ccc-cccccccccccc"), ACTOR),
    ]);

    const oks = [a, b, c].filter((r) => r.status === "ok");
    expect(oks.length).toBeGreaterThanOrEqual(1);
    // El invariante, sea cual sea el orden en que se resuelva la carrera: jamas se salda de mas.
    expect(new Prisma.Decimal(totalPagado(store)).lte("100000.00")).toBe(true);
    // Y el saldo final nunca queda en contra por culpa de un pago.
    const saldoFinal = store.movimientos.reduce(
      (acc, m) => (m.tipo === "credito" ? acc.add(m.monto) : acc.sub(m.monto)),
      new Prisma.Decimal(0),
    );
    expect(saldoFinal.gte(0)).toBe(true);
  });

  it("una carrera de pagos que SI caben entra entera (el candado no rechaza de mas)", async () => {
    // La contraprueba del test principal: si el candado convirtiera cualquier concurrencia en
    // un rechazo, los tests de arriba pasarian sin decir nada.
    const store = makeStore("100000.00");
    const service = buildService(store);

    const [a, b] = await Promise.all([
      service.registrarPagoTienda(pago("60000.00", CLAVE_A), ACTOR),
      service.registrarPagoTienda(pago("40000.00", CLAVE_B), ACTOR),
    ]);

    expect([a.status, b.status]).toEqual(["ok", "ok"]);
    expect(totalPagado(store)).toBe("100000.00");
    expect(store.pagos).toHaveLength(2);
  });
});

describe("el documento y el libro no divergen (§5, R39)", () => {
  it("Σ pagos registrados == Σ debitos `pago_tienda` del ledger", async () => {
    const store = makeStore("100000.00");
    const service = buildService(store);

    await service.registrarPagoTienda(pago("15000.00", CLAVE_A), ACTOR);
    await service.registrarPagoTienda(pago("25000.50", CLAVE_B), ACTOR);

    const sumaDocumentos = store.pagos
      .reduce((acc, p) => acc.add(p.monto), new Prisma.Decimal(0))
      .toFixed(2);
    expect(sumaDocumentos).toBe("40000.50");
    expect(totalPagado(store)).toBe("40000.50");
    // Y cada movimiento apunta a SU documento (R38).
    const debitos = store.movimientos.filter((m) => m.categoria === "pago_tienda");
    expect(debitos.map((m) => m.origenId).sort()).toEqual(store.pagos.map((p) => p.id).sort());
    expect(debitos.every((m) => m.origenTipo === "pago_tienda")).toBe(true);
  });
});
