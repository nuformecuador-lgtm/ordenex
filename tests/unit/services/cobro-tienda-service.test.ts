import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { CobroTiendaService } from "@/lib/services/CobroTiendaService";
import type { IWalletTiendaMovimientoRepository } from "@/lib/interfaces/repositories/IWalletTiendaMovimientoRepository";
import type { IUserRepository } from "@/lib/interfaces/repositories/IUserRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { RegistrarCobroTiendaInput } from "@/lib/types/wallet-tienda";
import { fechaCalendarioCR } from "@/lib/utils/fecha-cr";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 381 / T E.1 + E.2 — el servicio que le COBRA UN COSTO A UNA TIENDA.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// ⚠️ LO QUE ESTE ARCHIVO **NO** PUEDE PROBAR, Y ESTA DICHO PARA QUE NADIE LO SUPONGA: los dobles no
// ven el SQL. Que el CHECK de Postgres acepte `debito`/`cobro_manual`, que el saldo REAL baje, que
// el fallo del rastro no deje el asiento y que la fila no aparezca en el libro de otra tienda se
// prueban contra Postgres en `tests/integration/db/wallet-tienda-cobro.test.ts`. Aqui se prueba lo
// que decide el SERVICIO: el orden de los pasos, que campos escribe y que NO llama a nadie mas.
//
// Cubre R12, R17, R18, R19, R20, R21, R22, R23, R24 y R27.

const TIENDA = "0b1e6f1a-6d3a-4c6e-9c8f-3a1c9d2b7e55";

const ACTOR_MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const ACTOR_ADMIN: Actor = { usuarioId: "u-admin", rol: "admin" };

function entrada(over: Partial<RegistrarCobroTiendaInput> = {}): RegistrarCobroTiendaInput {
  return {
    tiendaId: TIENDA,
    monto: "1500.00",
    descripcion: "Reposicion de etiquetas",
    ...over,
  } as RegistrarCobroTiendaInput;
}

/**
 * El cliente de transaccion que ve el servicio. Lleva un espia de `walletMovimiento` —LA CAJA DE
 * ORDENEX— que NO deberia recibir ni una llamada (R24/D1). El repositorio del ledger es un doble
 * aparte, asi que este objeto solo existe para que el runner tenga algo que pasar y para que el
 * espia de la caja pueda estar VIVO.
 */
function txDoble() {
  return {
    walletTiendaMovimiento: { createMany: vi.fn(), findFirst: vi.fn() },
    historialAccion: { createMany: vi.fn() },
    usuario: { findUnique: vi.fn() },
    walletMovimiento: { createMany: vi.fn(), create: vi.fn() },
  };
}

function montaje(
  over: {
    saldo?: { creditos: string; debitos: string };
    cuenta?: { rol: string; estado: string } | null;
  } = {},
) {
  const tx = txDoble();
  const filaLeida = {
    id: "REEMPLAZADO",
    tiendaId: TIENDA,
    tipo: "debito" as const,
    categoria: "cobro_manual" as const,
    monto: "1500.00",
    origenTipo: "manual",
    origenId: null,
    descripcion: "Reposicion de etiquetas",
    fechaMovimiento: "2026-09-08T10:00:00.000Z",
  };
  // ⚠️ Los dobles se declaran SIN el tipo de la interfaz a proposito: tipados como
  // `IWalletTiendaMovimientoRepository`, TypeScript esconde el `.mock` de cada `vi.fn()` y no se
  // podria afirmar NADA sobre las llamadas. El cast va donde toca —al construir el servicio—, que
  // es donde el contrato importa.
  const tiendaRepo = {
    crearMovimientos: vi.fn(async () => 1),
    registrarCobroEnHistorial: vi.fn(async () => undefined),
    // Devuelve la fila con el `id` que el servicio genero: es lo que permite afirmar que la
    // relectura va POR ESE ID y no por «el mas reciente».
    obtenerPorIdDeTienda: vi.fn(async (id: string) => ({ ...filaLeida, id })),
    agregarSaldoPorTienda: vi.fn(async () => over.saldo ?? { creditos: "5000.00", debitos: "0.00" }),
    listarPorTienda: vi.fn(),
    listarSaldosTodasTiendas: vi.fn(),
    listarSaldosTiendasPaginado: vi.fn(),
    agregarDesglosePorTienda: vi.fn(),
    listarCierresDeTienda: vi.fn(),
  };
  const usuarioRepo = {
    obtenerCuentaTienda: vi.fn(async () =>
      over.cuenta === undefined ? { rol: "adminTienda", estado: "activo" } : over.cuenta,
    ),
  };
  const runTransaction = vi.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx));
  const servicio = new CobroTiendaService(
    tiendaRepo as unknown as IWalletTiendaMovimientoRepository,
    usuarioRepo as unknown as Pick<IUserRepository, "obtenerCuentaTienda">,
    runTransaction as never,
  );
  return { servicio, tiendaRepo, usuarioRepo, tx, runTransaction };
}

type TiendaRepoDoble = ReturnType<typeof montaje>["tiendaRepo"];

/** El unico argumento del `crearMovimientos` que el servicio emitio. */
function filaEscrita(tiendaRepo: TiendaRepoDoble): Record<string, unknown> {
  const llamadas = tiendaRepo.crearMovimientos.mock.calls as unknown as unknown[][];
  expect(llamadas).toHaveLength(1);
  const movs = llamadas[0][1] as Record<string, unknown>[];
  // R23: EXACTAMENTE UNA fila. Ningun IVA, ningun derivado, ningun espejo.
  expect(movs).toHaveLength(1);
  return movs[0];
}

/** El input del rastro que el servicio emitio. */
function rastroEscrito(tiendaRepo: TiendaRepoDoble): Record<string, unknown> {
  const llamadas = tiendaRepo.registrarCobroEnHistorial.mock.calls as unknown as unknown[][];
  expect(llamadas).toHaveLength(1);
  return llamadas[0][1] as Record<string, unknown>;
}

describe("381/E.1 (R12) — el rol se evalua ANTES de tocar la base", () => {
  it.each(["adminTienda", "mensajero", "adminSatelite", "apiKey"] as const)(
    "%s recibe `forbidden` y NINGUN doble recibe una sola llamada",
    async (rol) => {
      const { servicio, tiendaRepo, usuarioRepo, runTransaction } = montaje();
      const r = await servicio.registrarCobro(entrada(), { usuarioId: "u-x", rol });
      expect(r).toEqual({ status: "forbidden" });
      // ⚠️ ESTO ES EL REQUISITO, no el `forbidden`: un `forbidden` evaluado despues del `SELECT` ya
      // habria leido el dinero para tirarlo.
      expect(usuarioRepo.obtenerCuentaTienda).not.toHaveBeenCalled();
      expect(tiendaRepo.crearMovimientos).not.toHaveBeenCalled();
      expect(tiendaRepo.registrarCobroEnHistorial).not.toHaveBeenCalled();
      expect(tiendaRepo.agregarSaldoPorTienda).not.toHaveBeenCalled();
      expect(tiendaRepo.obtenerPorIdDeTienda).not.toHaveBeenCalled();
      expect(runTransaction).not.toHaveBeenCalled();
    },
  );

  it.each([ACTOR_MAESTRO, ACTOR_ADMIN])("$rol SI puede cobrar", async (actor) => {
    // La otra mitad del discriminador: sin esto, el bloque de arriba pasaria con un servicio que
    // devolviera `forbidden` SIEMPRE.
    const { servicio } = montaje();
    const r = await servicio.registrarCobro(entrada(), actor);
    expect(r.status).toBe("ok");
  });
});

describe("381/E.1 (R17) — la tienda se valida en el SERVIDOR, y sin escribir nada", () => {
  it.each([
    ["inexistente", null, "La tienda no existe"],
    ["no es tienda", { rol: "mensajero", estado: "activo" }, "La cuenta elegida no es una tienda"],
    ["inactiva", { rol: "adminTienda", estado: "inactivo" }, "La tienda no esta activa"],
  ])("%s -> error bajo `tiendaId` y CERO escrituras", async (_caso, cuenta, mensaje) => {
    const { servicio, tiendaRepo, runTransaction } = montaje({
      cuenta: cuenta as { rol: string; estado: string } | null,
    });
    const r = await servicio.registrarCobro(entrada(), ACTOR_MAESTRO);
    expect(r).toEqual({ status: "validation_error", fieldErrors: { tiendaId: [mensaje] } });
    expect(tiendaRepo.crearMovimientos).not.toHaveBeenCalled();
    expect(tiendaRepo.registrarCobroEnHistorial).not.toHaveBeenCalled();
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it("la lectura de la tienda va FUERA de la transaccion, y por su id", async () => {
    const { servicio, usuarioRepo, runTransaction } = montaje();
    await servicio.registrarCobro(entrada(), ACTOR_MAESTRO);
    expect(usuarioRepo.obtenerCuentaTienda).toHaveBeenCalledWith(TIENDA);
    expect(usuarioRepo.obtenerCuentaTienda.mock.invocationCallOrder[0]).toBeLessThan(
      runTransaction.mock.invocationCallOrder[0],
    );
  });
});

describe("381/E.1 (R19/R20/R21/R23) — la fila que se escribe", () => {
  it("es UN debito de la categoria propia de los cobros, con su monto, texto y autor", async () => {
    const { servicio, tiendaRepo } = montaje();
    await servicio.registrarCobro(entrada(), ACTOR_MAESTRO);
    const fila = filaEscrita(tiendaRepo);
    // ⚠️ LITERALES, y son EL CONTRATO: `debito` es lo que baja el disponible (R26) y
    // `cobro_manual` es lo que distingue un cobro de una correccion (R33/D2). Cambiar cualquiera
    // de los dos es cambiar lo que el humano firmo, no un detalle de nombres.
    expect(fila.tipo).toBe("debito");
    expect(fila.categoria).toBe("cobro_manual");
    expect(fila.tiendaId).toBe(TIENDA);
    expect(fila.monto).toBe("1500.00");
    expect(fila.descripcion).toBe("Reposicion de etiquetas");
    expect(fila.registradoPor).toBe("u-maestro");
  });

  it("R20: es un registro MANUAL y sin documento de origen", async () => {
    const { servicio, tiendaRepo } = montaje();
    await servicio.registrarCobro(entrada(), ACTOR_MAESTRO);
    const fila = filaEscrita(tiendaRepo);
    expect(fila.origenTipo).toBe("manual");
    expect(fila.origenId).toBeNull();
  });

  it("R21: sin fecha elegida, la clave `fechaMovimiento` NO viaja (manda el DEFAULT)", async () => {
    const { servicio, tiendaRepo } = montaje();
    await servicio.registrarCobro(entrada(), ACTOR_MAESTRO);
    // `not.toHaveProperty` y no `toBeUndefined`: emitir la clave con `undefined` es distinto de no
    // emitirla, y solo lo segundo cae en el `DEFAULT CURRENT_TIMESTAMP` de la columna.
    expect(filaEscrita(tiendaRepo)).not.toHaveProperty("fechaMovimiento");
  });

  it("R21: con HOY como fecha elegida, tampoco viaja", async () => {
    const { servicio, tiendaRepo } = montaje();
    await servicio.registrarCobro(entrada({ fecha: fechaCalendarioCR(new Date()) }), ACTOR_MAESTRO);
    expect(filaEscrita(tiendaRepo)).not.toHaveProperty("fechaMovimiento");
  });

  it("con una fecha ANTERIOR, viaja el instante en que ese dia empieza en Costa Rica", async () => {
    const { servicio, tiendaRepo } = montaje();
    await servicio.registrarCobro(entrada({ fecha: "2026-09-01" }), ACTOR_MAESTRO);
    const fila = filaEscrita(tiendaRepo);
    expect((fila.fechaMovimiento as Date).toISOString()).toBe("2026-09-01T06:00:00.000Z");
  });

  it("el asiento y el rastro van en LA MISMA transaccion, y el asiento primero (R25)", async () => {
    const { servicio, tiendaRepo, tx, runTransaction } = montaje();
    await servicio.registrarCobro(entrada(), ACTOR_MAESTRO);
    expect(runTransaction).toHaveBeenCalledTimes(1);
    // Los dos reciben EL MISMO cliente, que es el que el runner entrego.
    const llamadasAsiento = tiendaRepo.crearMovimientos.mock.calls as unknown as unknown[][];
    const llamadasRastro = tiendaRepo.registrarCobroEnHistorial.mock.calls as unknown as unknown[][];
    expect(llamadasAsiento[0][0]).toBe(tx);
    expect(llamadasRastro[0][0]).toBe(tx);
    expect(tiendaRepo.crearMovimientos.mock.invocationCallOrder[0]).toBeLessThan(
      tiendaRepo.registrarCobroEnHistorial.mock.invocationCallOrder[0],
    );
  });

  it("R40: el rastro lleva el id del asiento, la tienda, el MISMO importe y el actor", async () => {
    const { servicio, tiendaRepo } = montaje();
    await servicio.registrarCobro(entrada(), ACTOR_ADMIN);
    const fila = filaEscrita(tiendaRepo);
    const rastro = rastroEscrito(tiendaRepo);
    expect(rastro.cobroId).toBe(fila.id);
    expect(rastro.tiendaId).toBe(TIENDA);
    expect(rastro.monto).toBe("1500.00"); // el MISMO string que el asiento
    expect(rastro.actorUsuarioId).toBe("u-admin");
    // R43: la descripcion NO llega al historial.
    expect(rastro).not.toHaveProperty("descripcion");
  });

  it("el `id` lo genera el servicio, es distinto en cada cobro, y la relectura va POR ESE id", async () => {
    const { servicio, tiendaRepo } = montaje();
    const r1 = await servicio.registrarCobro(entrada(), ACTOR_MAESTRO);
    const primero = filaEscrita(tiendaRepo).id as string;
    expect(tiendaRepo.obtenerPorIdDeTienda).toHaveBeenCalledWith(primero, TIENDA);
    expect(r1.status === "ok" && r1.cobro.id).toBe(primero);

    tiendaRepo.crearMovimientos.mockClear();
    await servicio.registrarCobro(entrada(), ACTOR_MAESTRO);
    expect(filaEscrita(tiendaRepo).id).not.toBe(primero);
  });
});

describe("381/E.1 (R18) — el importe es texto de punta a punta", () => {
  it.each([
    ["1500", "1500.00"],
    ["1500.5", "1500.50"],
    ["0.01", "0.01"],
    ["99999999.99", "99999999.99"],
  ])("%s se persiste como el STRING %s", async (dado, esperado) => {
    const { servicio, tiendaRepo } = montaje();
    await servicio.registrarCobro(entrada({ monto: dado }), ACTOR_MAESTRO);
    const fila = filaEscrita(tiendaRepo);
    expect(typeof fila.monto).toBe("string");
    expect(fila.monto).toBe(esperado);
    // Y el rastro lleva EXACTAMENTE el mismo texto: libro y auditoria no pueden discrepar.
    expect(
      rastroEscrito(tiendaRepo).monto,
    ).toBe(esperado);
  });

  it("un importe con muchos decimales del pasado no se cuela como number", async () => {
    // El schema ya lo rechaza en el borde; aqui se comprueba la SEGUNDA red: si alguien llamara al
    // servicio saltandose zod, la escala se fija igual y el resultado sigue siendo STRING.
    const { servicio, tiendaRepo } = montaje();
    await servicio.registrarCobro(entrada({ monto: "1500.005" }), ACTOR_MAESTRO);
    const fila = filaEscrita(tiendaRepo);
    expect(typeof fila.monto).toBe("string");
    expect(fila.monto).toBe("1500.01"); // HALF_UP, no el 1500.0049999 de un float
  });
});

describe("381/E.1 (R27) — el saldo PUEDE quedar negativo, y se devuelve entero", () => {
  it("un cobro mayor que el saldo se ACEPTA y devuelve `signo: negativo`", async () => {
    const { servicio, tiendaRepo } = montaje({ saldo: { creditos: "0.00", debitos: "15000.00" } });
    const r = await servicio.registrarCobro(entrada(), ACTOR_MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    // ⚠️ LITERAL Y CON SIGNO: recortarlo a cero, devolver su valor absoluto o rechazar el cobro son
    // las TRES formas de romper lo que el humano firmo el 2026-09-07.
    expect(r.saldo.saldo).toBe("-15000.00");
    expect(r.saldo.signo).toBe("negativo");
    // Y se escribio de verdad: no es un rechazo disfrazado de `ok`.
    expect(tiendaRepo.crearMovimientos).toHaveBeenCalledTimes(1);
  });

  it("con saldo suficiente el signo sigue siendo `positivo` (discriminador)", async () => {
    const { servicio } = montaje({ saldo: { creditos: "5000.00", debitos: "1500.00" } });
    const r = await servicio.registrarCobro(entrada(), ACTOR_MAESTRO);
    expect(r.status === "ok" && r.saldo.saldo).toBe("3500.00");
    expect(r.status === "ok" && r.saldo.signo).toBe("positivo");
  });

  it("el saldo se lee DESPUES de escribir, y del ledger entero (sin filtros)", async () => {
    const { servicio, tiendaRepo } = montaje();
    await servicio.registrarCobro(entrada(), ACTOR_MAESTRO);
    expect(tiendaRepo.agregarSaldoPorTienda).toHaveBeenCalledWith(TIENDA, {});
    expect(tiendaRepo.agregarSaldoPorTienda.mock.invocationCallOrder[0]).toBeGreaterThan(
      tiendaRepo.crearMovimientos.mock.invocationCallOrder[0],
    );
  });

  it("NO existe ninguna rama `sin_saldo` ni `excede`: no hay tope contra el que comparar", async () => {
    const { servicio, tiendaRepo } = montaje({ saldo: { creditos: "0.00", debitos: "0.00" } });
    const r = await servicio.registrarCobro(entrada({ monto: "99999999.99" }), ACTOR_MAESTRO);
    expect(r.status).toBe("ok");
    expect(tiendaRepo.crearMovimientos).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------------------------
// T E.2 — R24: EL COBRO NO TOCA LA CAJA DE ORDENEX. La decision D1, convertida en algo que se rompe.
// ---------------------------------------------------------------------------------------------

describe("381/E.2 (R24) — un cobro NO escribe en la caja de Ordenex", () => {
  it("el cliente de la transaccion recibe CERO llamadas a `walletMovimiento`", async () => {
    const { servicio, tx } = montaje();
    await servicio.registrarCobro(entrada(), ACTOR_MAESTRO);
    // El espia esta VIVO: el mismo objeto recibe las llamadas del ledger en las demas pruebas.
    expect(tx.walletMovimiento.createMany).not.toHaveBeenCalled();
    expect(tx.walletMovimiento.create).not.toHaveBeenCalled();
  });

  it("el archivo del servicio NO importa el repositorio de la caja ni ningun puerto suyo", () => {
    const fuente = fs.readFileSync(
      path.join(process.cwd(), "lib", "services", "CobroTiendaService.ts"),
      "utf8",
    );
    // Solo las lineas de `import`: los comentarios de este archivo SI nombran la caja, a proposito,
    // para explicar por que no se toca.
    const imports = fuente
      .split("\n")
      .filter((l) => /^\s*import\b/.test(l) || /^\s*}\s*from\s+"/.test(l) || /^\s*"@\//.test(l))
      .join("\n");
    expect(imports).not.toMatch(/WalletMovimientoRepository/);
    expect(imports).not.toMatch(/IWalletMovimientoRepository/);
    expect(imports).not.toMatch(/Caja\w*Port|CajaAjusteTienda|CajaCargoTienda/);
    // Control positivo del detector: SI encuentra los imports que de verdad hay.
    expect(imports).toMatch(/IWalletTiendaMovimientoRepository/);
  });

  it("el constructor no admite un cuarto argumento con el que colar la caja", () => {
    // `length` cuenta los parametros declarados: si alguien añadiera un puerto de caja, esto se
    // pone rojo y obliga a pasar por aqui.
    expect(CobroTiendaService.length).toBe(3);
  });
});

describe("381/E.1 (R22) — no hay superficie para editar, borrar ni reversar un cobro", () => {
  it("el servicio expone `registrarCobro` y NADA MAS", () => {
    const metodos = Object.getOwnPropertyNames(CobroTiendaService.prototype).filter(
      (n) => n !== "constructor",
    );
    // `toEqual` literal, y ES el contrato: el ledger es append-only y la correccion de un cobro
    // erroneo queda fuera de alcance por decision del humano (D3). La AUSENCIA es el requisito.
    expect(metodos).toEqual(["registrarCobro"]);
  });
});

describe("381/E.1 — anti-vacuidad del montaje", () => {
  let ids: string[];
  beforeEach(() => {
    ids = [];
  });

  it("los dobles estan VIVOS: sin ellos nada de lo anterior significaria nada", async () => {
    const { servicio, tiendaRepo, usuarioRepo } = montaje();
    const r = await servicio.registrarCobro(entrada(), ACTOR_MAESTRO);
    ids.push(r.status === "ok" ? r.cobro.id : "");
    expect(usuarioRepo.obtenerCuentaTienda).toHaveBeenCalledTimes(1);
    expect(tiendaRepo.crearMovimientos).toHaveBeenCalledTimes(1);
    expect(tiendaRepo.registrarCobroEnHistorial).toHaveBeenCalledTimes(1);
    expect(tiendaRepo.obtenerPorIdDeTienda).toHaveBeenCalledTimes(1);
    expect(tiendaRepo.agregarSaldoPorTienda).toHaveBeenCalledTimes(1);
    expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("si la relectura no encuentra la fila, el servicio FALLA en vez de inventarse una", async () => {
    const { servicio, tiendaRepo } = montaje();
    tiendaRepo.obtenerPorIdDeTienda.mockResolvedValueOnce(null as never);
    await expect(servicio.registrarCobro(entrada(), ACTOR_MAESTRO)).rejects.toThrow(
      /no se pudo releer/,
    );
  });
});
