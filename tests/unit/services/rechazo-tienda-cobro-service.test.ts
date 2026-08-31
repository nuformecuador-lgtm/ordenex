import { describe, it, expect, vi } from "vitest";
import { RechazoTiendaCobroService } from "@/lib/services/RechazoTiendaCobroService";
import type {
  IRechazoTiendaCobroRepository,
  RechazoTiendaCobroRegistro,
} from "@/lib/interfaces/repositories/IRechazoTiendaCobroRepository";
import type {
  RechazoTiendaCobroTx,
  RechazoTiendaCobroTxRunner,
} from "@/lib/interfaces/services/IRechazoTiendaCobroService";
import type { CrearMovimientoInput } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type { CrearMovimientoTiendaInput } from "@/lib/interfaces/repositories/IWalletTiendaMovimientoRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// 💰 FICHA 337 (segunda mitad) — la REGLA del cobro por rechazo desde novedades: quien decide,
// que se escribe al aprobar y que NO se escribe al rechazar.
//
// ⚠️ LO QUE ESTE ARCHIVO NO PUEDE PROBAR, dicho aqui para que nadie lo de por cubierto:
//   · que el `WHERE ... AND estado = 'pendiente'` de `marcarDecidido` serialice de verdad a dos
//     humanos. Eso es un hecho del MOTOR y se prueba en
//     `tests/integration/db/rechazo-tienda-cobro.int.test.ts`, con dos transacciones REALES en
//     paralelo. Aqui el `0` del doble se elige a mano.
//   · que la clave unica impida el doble cobro. Idem: es un indice, no codigo.
// Este nivel prueba la DECISION —el guard, el orden de los pasos, la forma de los cuatro apuntes—
// que es lo que un doble si puede afirmar.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "u-admin", rol: "admin" };
const MENSAJERO: Actor = { usuarioId: "u-msj", rol: "mensajero" };
const TIENDA: Actor = { usuarioId: "u-tienda", rol: "adminTienda" };
const SATELITE: Actor = { usuarioId: "u-sat", rol: "adminSatelite" };
const API_KEY: Actor = { usuarioId: "u-key", rol: "apiKey" };

const AHORA = new Date("2026-08-31T15:00:00.000Z");

function registro(overrides: Partial<RechazoTiendaCobroRegistro> = {}): RechazoTiendaCobroRegistro {
  return {
    id: "cob-1",
    gestionId: "gest-1", // LA CLAVE: es el `origen_id` de los cuatro apuntes
    ordenId: "o1",
    tiendaId: "store-1",
    montoFlete: "500.00",
    montoIva: "65.00",
    tarifaId: "tar-1",
    estado: "pendiente",
    generadoEl: "2026-08-31",
    decididoPor: null,
    decididoAt: null,
    ...overrides,
  };
}

type CobroRepoDoble = IRechazoTiendaCobroRepository;

function buildCobroRepo(overrides: Partial<CobroRepoDoble> = {}): CobroRepoDoble {
  return {
    crearPendiente: vi.fn(async () => 1),
    obtenerPorId: vi.fn(async () => registro()),
    listarPendientes: vi.fn(async () => []),
    contarPendientes: vi.fn(async () => 0),
    marcarDecidido: vi.fn(async () => 1),
    ...overrides,
  };
}

/** El `tx` de mentira que el runner pasa. Ningun doble lo mira: solo viaja. */
const TX = {} as RechazoTiendaCobroTx;

function build(
  cobroOverrides: Partial<CobroRepoDoble> = {},
  opciones: { debitaFleteDevolucion?: boolean; crearMovimientos?: () => Promise<number> } = {},
) {
  const cobroRepo = buildCobroRepo(cobroOverrides);
  const movimientoRepo = {
    crearMovimientos: vi.fn(opciones.crearMovimientos ?? (async () => 2)),
  };
  const movimientoTiendaRepo = { crearMovimientos: vi.fn(async () => 2) };
  const writeClient = {} as never;
  const runTx: RechazoTiendaCobroTxRunner = (fn) => fn(TX);
  const service = new RechazoTiendaCobroService(
    cobroRepo,
    movimientoRepo,
    movimientoTiendaRepo,
    writeClient,
    runTx,
    { TIENDA_DEBITA_FLETE_DEVOLUCION: opciones.debitaFleteDevolucion ?? true },
  );
  return { cobroRepo, movimientoRepo, movimientoTiendaRepo, service };
}

function movimientosDeCaja(repo: { crearMovimientos: ReturnType<typeof vi.fn> }) {
  return repo.crearMovimientos.mock.calls[0][1] as CrearMovimientoInput[];
}
function movimientosDeTienda(repo: { crearMovimientos: ReturnType<typeof vi.fn> }) {
  return repo.crearMovimientos.mock.calls[0][1] as CrearMovimientoTiendaInput[];
}

/* -------------------------------------------------------------------------- */
/* 1. Quien decide                                                             */
/* -------------------------------------------------------------------------- */

describe("💰 337 — quien puede decidir un cobro por rechazo (`esAccesoTotal`)", () => {
  it.each([
    ["maestro", MAESTRO],
    ["admin", ADMIN],
  ])("%s SI puede aprobar", async (_n, actor) => {
    const { service } = build();
    const r = await service.aprobar({ id: "cob-1" }, actor, AHORA);
    expect(r.status).toBe("ok");
  });

  // ⭑ LA MUTACION QUE ESTE BLOQUE MATA: cambiar `esAccesoTotal` por `true`, o quitarlo. Con el
  // guard fuera, los cuatro roles de abajo aprobarian dinero contra una tienda. Se afirman los
  // CUATRO, y ademas se afirma que NO se escribio nada: un `forbidden` que ya hubiera tocado el
  // libro no seria un `forbidden`.
  it.each([
    ["mensajero", MENSAJERO],
    ["adminTienda", TIENDA],
    ["adminSatelite", SATELITE],
    ["apiKey", API_KEY],
  ])("%s NO puede aprobar, y no escribe ni una fila", async (_n, actor) => {
    const { service, cobroRepo, movimientoRepo, movimientoTiendaRepo } = build();

    await expect(service.aprobar({ id: "cob-1" }, actor, AHORA)).resolves.toEqual({
      status: "forbidden",
    });
    expect(cobroRepo.marcarDecidido).not.toHaveBeenCalled();
    expect(movimientoRepo.crearMovimientos).not.toHaveBeenCalled();
    expect(movimientoTiendaRepo.crearMovimientos).not.toHaveBeenCalled();
    // Ni siquiera se lee el cobro: el guard va ANTES de abrir la transaccion.
    expect(cobroRepo.obtenerPorId).not.toHaveBeenCalled();
  });

  it.each([
    ["mensajero", MENSAJERO],
    ["adminTienda", TIENDA],
    ["adminSatelite", SATELITE],
    ["apiKey", API_KEY],
  ])("%s NO puede rechazar", async (_n, actor) => {
    const { service, cobroRepo } = build();
    await expect(service.rechazar({ id: "cob-1" }, actor, AHORA)).resolves.toEqual({
      status: "forbidden",
    });
    expect(cobroRepo.marcarDecidido).not.toHaveBeenCalled();
  });

  it.each([
    ["mensajero", MENSAJERO],
    ["adminTienda", TIENDA],
    ["adminSatelite", SATELITE],
    ["apiKey", API_KEY],
  ])("%s NO puede ni VER la cola", async (_n, actor) => {
    // La cola dice cuanto se le va a cobrar a cada tienda: no es informacion neutra.
    const { service, cobroRepo } = build();
    await expect(service.listarPendientes(actor)).resolves.toEqual({ status: "forbidden" });
    expect(cobroRepo.listarPendientes).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* 2. La cola                                                                  */
/* -------------------------------------------------------------------------- */

describe("💰 337 — la cola de pendientes", () => {
  it("el `total` sale del SERVIDOR y NO es `items.length`", async () => {
    // `items` viene recortado por el tope; si el numero se derivara del largo, una cola mas larga
    // que el tope mentiria en pantalla. Aqui el doble devuelve 2 items y un total de 7.
    const { service } = build({
      listarPendientes: vi.fn(async () => [
        { id: "a" } as never,
        { id: "b" } as never,
      ]),
      contarPendientes: vi.fn(async () => 7),
    });

    const r = await service.listarPendientes(MAESTRO);
    expect(r).toEqual({ status: "ok", items: [{ id: "a" }, { id: "b" }], total: 7 });
  });
});

/* -------------------------------------------------------------------------- */
/* 3. Aprobar: los cuatro apuntes                                              */
/* -------------------------------------------------------------------------- */

describe("💰 337 — aprobar escribe los MISMOS apuntes que la aprobacion del cierre", () => {
  it("⭑ la CAJA de Ordenex recibe los dos ingresos, con la clave y los importes CONGELADOS", async () => {
    const { service, movimientoRepo } = build();

    await service.aprobar({ id: "cob-1" }, MAESTRO, AHORA);

    // `toEqual` del array ENTERO: fija las dos filas, su orden y que NO hay una tercera.
    expect(movimientosDeCaja(movimientoRepo)).toEqual([
      {
        tipo: "ingreso",
        categoria: "ingreso_flete_devolucion",
        monto: "500.00",
        origenTipo: "gestion_orden", // el ORIGEN es la gestion, no un cierre
        origenId: "gest-1", // LA CLAVE de idempotencia
        descripcion: null,
        registradoPor: "u-maestro", // quien autorizo
      },
      {
        tipo: "ingreso",
        categoria: "ingreso_iva_flete_devolucion",
        monto: "65.00",
        origenTipo: "gestion_orden",
        origenId: "gest-1",
        descripcion: null,
        registradoPor: "u-maestro",
      },
    ]);
  });

  it("⭑ el LIBRO DE LA TIENDA recibe los dos debitos espejo, contra la tienda CONGELADA", async () => {
    const { service, movimientoTiendaRepo } = build();

    await service.aprobar({ id: "cob-1" }, ADMIN, AHORA);

    expect(movimientosDeTienda(movimientoTiendaRepo)).toEqual([
      {
        tiendaId: "store-1", // la del COBRO, no la que la orden diga hoy
        tipo: "debito",
        categoria: "flete_devolucion",
        monto: "500.00",
        origenTipo: "gestion_orden",
        origenId: "gest-1", // LA MISMA clave que en la caja
        descripcion: null,
        registradoPor: "u-admin",
      },
      {
        tiendaId: "store-1",
        tipo: "debito",
        categoria: "iva_flete_devolucion",
        monto: "65.00",
        origenTipo: "gestion_orden",
        origenId: "gest-1",
        descripcion: null,
        registradoPor: "u-admin",
      },
    ]);
  });

  it("⭑ los importes son los del COBRO, no unos recalculados", async () => {
    // Si alguien reintrodujera un calculo aqui, tendria que leer una tarifa — que este servicio ni
    // siquiera recibe—. Este caso lo fija por el valor: un cobro con otros importes escribe esos.
    const { service, movimientoRepo, movimientoTiendaRepo } = build({
      obtenerPorId: vi.fn(async () => registro({ montoFlete: "1234.56", montoIva: "160.49" })),
    });

    await service.aprobar({ id: "cob-1" }, MAESTRO, AHORA);

    expect(movimientosDeCaja(movimientoRepo).map((m) => m.monto)).toEqual(["1234.56", "160.49"]);
    expect(movimientosDeTienda(movimientoTiendaRepo).map((m) => m.monto)).toEqual([
      "1234.56",
      "160.49",
    ]);
  });

  it("⭑ un IVA de 0,00 NO emite su apunte en ninguno de los dos libros (R10 de la 42)", async () => {
    // La aprobacion del cierre OMITE los conceptos en 0.00. Si aqui se emitiera igual, los apuntes
    // dejarian de ser «los mismos» y el libro tendria filas de cero que ninguna otra via escribe.
    const { service, movimientoRepo, movimientoTiendaRepo } = build({
      obtenerPorId: vi.fn(async () => registro({ montoIva: "0.00" })),
    });

    await service.aprobar({ id: "cob-1" }, MAESTRO, AHORA);

    expect(movimientosDeCaja(movimientoRepo)).toHaveLength(1);
    expect(movimientosDeCaja(movimientoRepo)[0].categoria).toBe("ingreso_flete_devolucion");
    expect(movimientosDeTienda(movimientoTiendaRepo)).toHaveLength(1);
    expect(movimientosDeTienda(movimientoTiendaRepo)[0].categoria).toBe("flete_devolucion");
  });

  it("⭑ el interruptor de la 43 apagado: la CAJA cobra igual y la TIENDA no se debita", async () => {
    // `TIENDA_DEBITA_FLETE_DEVOLUCION = false` es politica de la casa y el feed del cierre la
    // respeta. Ignorarla aqui haria que la misma politica se aplicara por una via y no por la
    // otra, que es la divergencia silenciosa que la 43 escribio su R28 para impedir.
    const { service, movimientoRepo, movimientoTiendaRepo } = build(
      {},
      { debitaFleteDevolucion: false },
    );

    await service.aprobar({ id: "cob-1" }, MAESTRO, AHORA);

    expect(movimientosDeCaja(movimientoRepo)).toHaveLength(2);
    expect(movimientoTiendaRepo.crearMovimientos).toHaveBeenCalledWith(TX, []);
  });

  it("la transicion se marca ANTES de escribir en ningun libro", async () => {
    // El orden ES la serializacion: si los apuntes fueran primero, dos aprobaciones simultaneas
    // los escribirian las dos y solo despues descubrirían que una sobraba.
    const orden: string[] = [];
    const { service } = build(
      { marcarDecidido: vi.fn(async () => { orden.push("marcarDecidido"); return 1; }) },
      { crearMovimientos: async () => { orden.push("caja"); return 2; } },
    );

    await service.aprobar({ id: "cob-1" }, MAESTRO, AHORA);

    expect(orden).toEqual(["marcarDecidido", "caja"]);
  });

  it("`marcarDecidido` recibe el estado, el actor y el reloj INYECTADO", async () => {
    const { service, cobroRepo } = build();
    await service.aprobar({ id: "cob-1" }, MAESTRO, AHORA);
    expect(cobroRepo.marcarDecidido).toHaveBeenCalledWith(TX, "cob-1", "aprobado", "u-maestro", AHORA);
  });

  it("cobro inexistente -> not_found, sin tocar nada", async () => {
    const { service, cobroRepo, movimientoRepo } = build({
      obtenerPorId: vi.fn(async () => null),
    });

    await expect(service.aprobar({ id: "cob-1" }, MAESTRO, AHORA)).resolves.toEqual({
      status: "not_found",
    });
    expect(cobroRepo.marcarDecidido).not.toHaveBeenCalled();
    expect(movimientoRepo.crearMovimientos).not.toHaveBeenCalled();
  });

  it("⭑ `ya_decidido` (la transicion afecta 0 filas) NO escribe en ningun libro", async () => {
    // ⭑ EL CASO QUE IMPIDE EL DOBLE COBRO POR ARRIBA. Cero filas es «alguien decidio antes», no un
    // error: la segunda aprobacion sale sin haber escrito una sola fila. Si el servicio siguiera
    // adelante ignorando el `count`, los dos indices unicos de los libros lo taparian... pero el
    // cobro quedaria contado dos veces en cualquier lectura que no pase por ellos.
    const { service, movimientoRepo, movimientoTiendaRepo } = build({
      marcarDecidido: vi.fn(async () => 0),
    });

    await expect(service.aprobar({ id: "cob-1" }, MAESTRO, AHORA)).resolves.toEqual({
      status: "ya_decidido",
    });
    expect(movimientoRepo.crearMovimientos).not.toHaveBeenCalled();
    expect(movimientoTiendaRepo.crearMovimientos).not.toHaveBeenCalled();
  });

  it("`yaEstabaEnElLibro` es true cuando la caja no inserto nada (la clave ya estaba)", async () => {
    const { service } = build({}, { crearMovimientos: async () => 0 });
    await expect(service.aprobar({ id: "cob-1" }, MAESTRO, AHORA)).resolves.toEqual({
      status: "ok",
      yaEstabaEnElLibro: true,
    });
  });
});

/* -------------------------------------------------------------------------- */
/* 4. Rechazar: no escribe dinero                                              */
/* -------------------------------------------------------------------------- */

describe("💰 337 — rechazar el cobro no mueve un colon", () => {
  it("⭑ deja el cobro `rechazado` y NO escribe en ningun libro", async () => {
    const { service, cobroRepo, movimientoRepo, movimientoTiendaRepo } = build();

    await expect(service.rechazar({ id: "cob-1" }, ADMIN, AHORA)).resolves.toEqual({
      status: "ok",
    });
    expect(cobroRepo.marcarDecidido).toHaveBeenCalledWith(
      expect.anything(),
      "cob-1",
      "rechazado",
      "u-admin",
      AHORA,
    );
    expect(movimientoRepo.crearMovimientos).not.toHaveBeenCalled();
    expect(movimientoTiendaRepo.crearMovimientos).not.toHaveBeenCalled();
  });

  it("cobro inexistente -> not_found", async () => {
    const { service, cobroRepo } = build({ obtenerPorId: vi.fn(async () => null) });
    await expect(service.rechazar({ id: "cob-1" }, MAESTRO, AHORA)).resolves.toEqual({
      status: "not_found",
    });
    expect(cobroRepo.marcarDecidido).not.toHaveBeenCalled();
  });

  it("ya decidido -> `ya_decidido`", async () => {
    const { service } = build({ marcarDecidido: vi.fn(async () => 0) });
    await expect(service.rechazar({ id: "cob-1" }, MAESTRO, AHORA)).resolves.toEqual({
      status: "ya_decidido",
    });
  });
});
