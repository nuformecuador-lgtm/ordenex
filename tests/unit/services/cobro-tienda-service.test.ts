import { describe, it, expect, vi } from "vitest";

import { CobroTiendaService } from "@/lib/services/CobroTiendaService";
import type { ICobroTiendaAnulacionRepository } from "@/lib/interfaces/repositories/ICobroTiendaAnulacionRepository";
import type { IWalletTiendaMovimientoRepository } from "@/lib/interfaces/repositories/IWalletTiendaMovimientoRepository";
import type { IUserRepository } from "@/lib/interfaces/repositories/IUserRepository";
import type { ICajaCobroTiendaFeedService } from "@/lib/interfaces/services/ICajaCobroTiendaFeedService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { RegistrarCobroTiendaInput } from "@/lib/types/wallet-tienda";
import { fechaCalendarioCR } from "@/lib/utils/fecha-cr";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 381 → 461 / T B.7 + T B.8 — el servicio con el que ORDENEX LE COBRA A UNA TIENDA, y anula.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// ⚠️ LO QUE ESTE ARCHIVO **NO** PUEDE PROBAR, Y ESTA DICHO PARA QUE NADIE LO SUPONGA: los dobles no
// ven el SQL. Que el CHECK acepte los pares, que el saldo REAL baje, que el fallo de una escritura no
// deje las otras, que la ganancia suba y «De las tiendas» baje EXACTAMENTE el monto y que R8 valga
// sin excepcion se prueban contra Postgres en `wallet-tienda-cobro.test.ts`,
// `cobro-tienda-461.test.ts` y `caja-invariante-tiendas.test.ts`. Aqui se prueba lo que decide el
// SERVICIO: el orden de los pasos, que campos escribe en cada libro, con que monto e instante, y que
// NO llama a nadie mas.
//
// REESCRITO por la 461 (cada literal cambiado, con su R, en `progress/impl_461.md`): la 381 afirmaba
// que el cobro NO escribe en la caja (R24/D1) y que sin fecha la clave `fechaMovimiento` no viaja
// (R21). HD1 y R3 de la 461 dicen lo contrario, y este archivo lo mide.
//
// Cubre R1, R2, R3, R4 (la forma), R5, R6, R7, R8, R9 y R10–R19.

const TIENDA = "0b1e6f1a-6d3a-4c6e-9c8f-3a1c9d2b7e55";
const COBRO_ID = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

const ACTOR_MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const ACTOR_ADMIN: Actor = { usuarioId: "u-admin", rol: "admin" };

/** Un reloj FIJO: es lo que permite afirmar «el MISMO instante» y no «un instante parecido». */
const AHORA = new Date("2026-09-25T15:30:45.123Z");

/** Ficha 461 (R66): la clave que el dialogo genera al abrirse; aqui fija, para poder afirmarla. */
const CLAVE_461 = "6b1f0d2e-7c3a-4d5b-9e8f-0a1b2c3d4e5f";

function entrada(over: Partial<RegistrarCobroTiendaInput> = {}): RegistrarCobroTiendaInput {
  return {
    claveIdempotencia: CLAVE_461,
    tiendaId: TIENDA,
    monto: "1500.00",
    descripcion: "Reposicion de etiquetas",
    ...over,
  } as RegistrarCobroTiendaInput;
}

/** El cliente de transaccion que ve el servicio: un objeto marcado, para afirmar identidad. */
function txDoble() {
  return { marca: "tx-461" };
}

interface Montaje {
  saldo?: { creditos: string; debitos: string };
  cuenta?: { rol: string; estado: string } | null;
  cobro?: Record<string, unknown> | null;
  estado?: { anulado: boolean; reclasificado: boolean; tieneCargo: boolean };
  anularResponde?: { status: "anulado" } | { status: "ya_anulado" };
}

function montaje(over: Montaje = {}) {
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
    fechaMovimiento: "2026-09-25T15:30:45.123Z",
  };
  const cobroLeido =
    over.cobro === undefined
      ? {
          id: COBRO_ID,
          tiendaId: TIENDA,
          tiendaNombre: "Tienda Uno",
          monto: "1500.00",
          descripcion: "Reposicion de etiquetas",
          fechaMovimiento: "2026-09-20T06:00:00.000Z",
        }
      : over.cobro;
  // ⚠️ Los dobles se declaran SIN el tipo de la interfaz a proposito: tipados, TypeScript esconde el
  // `.mock` de cada `vi.fn()`. El cast va donde toca —al construir el servicio—.
  const tiendaRepo = {
    crearMovimientos: vi.fn(async () => 1),
    registrarCobroEnHistorial: vi.fn(async () => undefined),
    nombreDeTienda: vi.fn(async () => "Tienda Uno"), obtenerCobroPorClave: vi.fn(async () => null),
    obtenerPorIdDeTienda: vi.fn(async (id: string) => ({ ...filaLeida, id })),
    obtenerCobroPorId: vi.fn(async () => cobroLeido),
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
  const caja = {
    emitirCargoDeCobro: vi.fn(async () => 1),
    emitirReversoDeCobro: vi.fn(async () => 1),
  };
  const anulaciones = {
    anular: vi.fn(async () => over.anularResponde ?? { status: "anulado" as const }),
    estadoDelCobro: vi.fn(
      async () => over.estado ?? { anulado: false, reclasificado: false, tieneCargo: true },
    ),
    estadoDeDocumentos: vi.fn(async () => []),
  };
  const runTransaction = vi.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx));
  const servicio = new CobroTiendaService(
    tiendaRepo as unknown as IWalletTiendaMovimientoRepository,
    usuarioRepo as unknown as Pick<IUserRepository, "obtenerCuentaTienda">,
    caja as unknown as ICajaCobroTiendaFeedService,
    anulaciones as unknown as ICobroTiendaAnulacionRepository,
    runTransaction as never,
    () => AHORA,
  );
  return { servicio, tiendaRepo, usuarioRepo, caja, anulaciones, tx, runTransaction };
}

type M = ReturnType<typeof montaje>;

/** La UNICA fila que `crearMovimientos` recibio en la llamada `n`. */
function filaEscrita(m: M, n = 0): Record<string, unknown> {
  const llamadas = m.tiendaRepo.crearMovimientos.mock.calls as unknown as unknown[][];
  expect(llamadas.length).toBeGreaterThan(n);
  const movs = llamadas[n][1] as Record<string, unknown>[];
  expect(movs).toHaveLength(1);
  return movs[0];
}

/** El input del rastro del cobro que el servicio emitio. */
function rastroEscrito(m: M): Record<string, unknown> {
  const llamadas = m.tiendaRepo.registrarCobroEnHistorial.mock.calls as unknown as unknown[][];
  expect(llamadas).toHaveLength(1);
  return llamadas[0][1] as Record<string, unknown>;
}

/** El movimiento de caja que recibio `emitirCargoDeCobro` / `emitirReversoDeCobro`. */
function cargoEscrito(m: M): Record<string, unknown> {
  const llamadas = m.caja.emitirCargoDeCobro.mock.calls as unknown as unknown[][];
  expect(llamadas).toHaveLength(1);
  return llamadas[0][1] as Record<string, unknown>;
}
function reversoEscrito(m: M): Record<string, unknown> {
  const llamadas = m.caja.emitirReversoDeCobro.mock.calls as unknown as unknown[][];
  expect(llamadas).toHaveLength(1);
  return llamadas[0][1] as Record<string, unknown>;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// REGISTRAR (R1–R9)
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe("461/B.7 (R8) — el rol se evalua ANTES de tocar la base", () => {
  it.each(["adminTienda", "mensajero", "adminSatelite", "apiKey"] as const)(
    "%s recibe `forbidden` y NINGUN doble recibe una sola llamada",
    async (rol) => {
      const m = montaje();
      const r = await m.servicio.registrarCobro(entrada(), { usuarioId: "u-x", rol });
      expect(r).toEqual({ status: "forbidden" });
      // ⚠️ ESTO ES EL REQUISITO, no el `forbidden`: un `forbidden` evaluado despues del `SELECT` ya
      // habria leido el dinero para tirarlo.
      expect(m.usuarioRepo.obtenerCuentaTienda).not.toHaveBeenCalled();
      expect(m.tiendaRepo.crearMovimientos).not.toHaveBeenCalled();
      expect(m.tiendaRepo.registrarCobroEnHistorial).not.toHaveBeenCalled();
      expect(m.caja.emitirCargoDeCobro).not.toHaveBeenCalled();
      expect(m.tiendaRepo.agregarSaldoPorTienda).not.toHaveBeenCalled();
      expect(m.runTransaction).not.toHaveBeenCalled();
    },
  );

  it.each([ACTOR_MAESTRO, ACTOR_ADMIN])("$rol SI puede cobrar", async (actor) => {
    const m = montaje();
    expect((await m.servicio.registrarCobro(entrada(), actor)).status).toBe("ok");
  });
});

describe("461/B.7 (R6) — la tienda se valida en el SERVIDOR, con los textos de la 381, sin escribir nada", () => {
  it.each([
    ["inexistente", null, "La tienda no existe"],
    ["no es tienda", { rol: "mensajero", estado: "activo" }, "La cuenta elegida no es una tienda"],
    ["inactiva", { rol: "adminTienda", estado: "inactivo" }, "La tienda no esta activa"],
  ])("%s -> error bajo `tiendaId` y CERO escrituras en los tres libros", async (_caso, cuenta, mensaje) => {
    const m = montaje({ cuenta: cuenta as { rol: string; estado: string } | null });
    const r = await m.servicio.registrarCobro(entrada(), ACTOR_MAESTRO);
    expect(r).toEqual({ status: "validation_error", fieldErrors: { tiendaId: [mensaje] } });
    expect(m.tiendaRepo.crearMovimientos).not.toHaveBeenCalled();
    expect(m.tiendaRepo.registrarCobroEnHistorial).not.toHaveBeenCalled();
    expect(m.caja.emitirCargoDeCobro).not.toHaveBeenCalled();
    expect(m.runTransaction).not.toHaveBeenCalled();
  });

  it("la lectura de la tienda va FUERA de la transaccion, y por su id", async () => {
    const m = montaje();
    await m.servicio.registrarCobro(entrada(), ACTOR_MAESTRO);
    expect(m.usuarioRepo.obtenerCuentaTienda).toHaveBeenCalledWith(TIENDA);
    expect(m.usuarioRepo.obtenerCuentaTienda.mock.invocationCallOrder[0]).toBeLessThan(
      m.runTransaction.mock.invocationCallOrder[0],
    );
  });
});

describe("461/B.7 (R1/R2/R3/R7) — las TRES escrituras, con el MISMO monto y el MISMO instante", () => {
  it("R1: debito, historial y CARGO en la MISMA transaccion, en ESE orden, todos con el tx del runner", async () => {
    const m = montaje();
    await m.servicio.registrarCobro(entrada(), ACTOR_MAESTRO);
    expect(m.runTransaction).toHaveBeenCalledTimes(1);
    const asiento = m.tiendaRepo.crearMovimientos.mock.calls as unknown as unknown[][];
    const rastro = m.tiendaRepo.registrarCobroEnHistorial.mock.calls as unknown as unknown[][];
    const cargo = m.caja.emitirCargoDeCobro.mock.calls as unknown as unknown[][];
    expect(asiento[0][0]).toBe(m.tx);
    expect(rastro[0][0]).toBe(m.tx);
    expect(cargo[0][0]).toBe(m.tx);
    expect(m.tiendaRepo.crearMovimientos.mock.invocationCallOrder[0]).toBeLessThan(
      m.tiendaRepo.registrarCobroEnHistorial.mock.invocationCallOrder[0],
    );
    expect(m.tiendaRepo.registrarCobroEnHistorial.mock.invocationCallOrder[0]).toBeLessThan(
      m.caja.emitirCargoDeCobro.mock.invocationCallOrder[0],
    );
    // Y el saldo se lee DESPUES de la transaccion.
    expect(m.runTransaction.mock.invocationCallOrder[0]).toBeLessThan(
      m.tiendaRepo.agregarSaldoPorTienda.mock.invocationCallOrder[0],
    );
  });

  it("⭑ HD1/R1/R4 (mutacion 1 de design §14.2): el CARGO se escribe, y es lo que motiva la ficha", async () => {
    // Quitar `emitirCargoDeCobro` del servicio —la mutacion 1— deja este caso en rojo.
    const m = montaje();
    await m.servicio.registrarCobro(entrada(), ACTOR_MAESTRO);
    expect(m.caja.emitirCargoDeCobro).toHaveBeenCalledTimes(1);
    expect(m.caja.emitirReversoDeCobro).not.toHaveBeenCalled();
  });

  it("el debito: `debito`/`cobro_manual`, manual y sin origen, con la descripcion TAL CUAL (R7)", async () => {
    const m = montaje();
    await m.servicio.registrarCobro(entrada({ descripcion: "  Reposicion de etiquetas  " }), ACTOR_MAESTRO);
    const fila = filaEscrita(m);
    // ⚠️ LITERALES, y son EL CONTRATO: `debito` baja el disponible y `cobro_manual` distingue un
    // cobro de una correccion (381, D2). No cambian con la 461.
    expect(fila.tipo).toBe("debito");
    expect(fila.categoria).toBe("cobro_manual");
    expect(fila.tiendaId).toBe(TIENDA);
    expect(fila.monto).toBe("1500.00");
    expect(fila.origenTipo).toBe("manual");
    expect(fila.origenId).toBeNull();
    expect(fila.registradoPor).toBe("u-maestro");
    // R7: la descripcion que tecleo la persona, sin recortar ni componer (el borde ya la recorta).
    expect(fila.descripcion).toBe("  Reposicion de etiquetas  ");
  });

  it("R2/R7: el cargo lleva el id del debito, el MISMO monto, y se describe con la tienda y la descripcion", async () => {
    const m = montaje();
    await m.servicio.registrarCobro(entrada(), ACTOR_MAESTRO);
    const fila = filaEscrita(m);
    const cargo = cargoEscrito(m);
    expect(cargo.cobroId).toBe(fila.id); // R2: vinculado al debito
    expect(cargo.monto).toBe("1500.00"); // el MISMO string
    expect(cargo.registradoPor).toBe("u-maestro");
    // R7: «{Tienda} · {descripcion}», con el nombre leido DENTRO de la transaccion; sin forma de uuid.
    expect(m.tiendaRepo.nombreDeTienda).toHaveBeenCalledWith(m.tx, TIENDA);
    expect(cargo.descripcion).toBe("Tienda Uno · Reposicion de etiquetas");
    expect(String(cargo.descripcion)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
  });

  it("R3: con «hoy», debito y cargo llevan el MISMO instante: el reloj del SERVICIO, no el DEFAULT", async () => {
    // REESCRITO (461/R3): la 381 exigia que sin fecha la clave `fechaMovimiento` NO viajara. Ahora
    // viaja SIEMPRE con el instante del servicio: Prisma rellena `@default(now())` fila a fila y el
    // debito y la linea de caja quedarian con instantes distintos (medido en la 459: 4 ms).
    const m = montaje();
    await m.servicio.registrarCobro(entrada(), ACTOR_MAESTRO);
    expect(filaEscrita(m).fechaMovimiento).toEqual(AHORA);
    expect(cargoEscrito(m).fechaMovimiento).toEqual(AHORA);
  });

  it("R3: con HOY como fecha elegida, lo mismo", async () => {
    const m = montaje();
    await m.servicio.registrarCobro(entrada({ fecha: fechaCalendarioCR(AHORA) }), ACTOR_MAESTRO);
    expect(filaEscrita(m).fechaMovimiento).toEqual(AHORA);
    expect(cargoEscrito(m).fechaMovimiento).toEqual(AHORA);
  });

  it("R3: con un dia ANTERIOR, los dos llevan el instante en que ese dia empieza en Costa Rica", async () => {
    const m = montaje();
    await m.servicio.registrarCobro(entrada({ fecha: "2026-09-01" }), ACTOR_MAESTRO);
    expect((filaEscrita(m).fechaMovimiento as Date).toISOString()).toBe("2026-09-01T06:00:00.000Z");
    expect((cargoEscrito(m).fechaMovimiento as Date).toISOString()).toBe("2026-09-01T06:00:00.000Z");
  });

  it("el rastro lleva el id del debito, la tienda, el MISMO importe y el actor; sin la descripcion", async () => {
    const m = montaje();
    await m.servicio.registrarCobro(entrada(), ACTOR_ADMIN);
    const fila = filaEscrita(m);
    const rastro = rastroEscrito(m);
    expect(rastro.cobroId).toBe(fila.id);
    expect(rastro.tiendaId).toBe(TIENDA);
    expect(rastro.monto).toBe("1500.00");
    expect(rastro.actorUsuarioId).toBe("u-admin");
    expect(rastro).not.toHaveProperty("descripcion");
  });

  it("el `id` lo genera el servicio, es distinto en cada cobro, y la relectura va POR ESE id", async () => {
    const m = montaje();
    const r1 = await m.servicio.registrarCobro(entrada(), ACTOR_MAESTRO);
    const primero = filaEscrita(m).id as string;
    expect(m.tiendaRepo.obtenerPorIdDeTienda).toHaveBeenCalledWith(primero, TIENDA);
    expect(r1.status === "ok" && r1.cobro.id).toBe(primero);
    expect(cargoEscrito(m).cobroId).toBe(primero);
    m.tiendaRepo.crearMovimientos.mockClear();
    await m.servicio.registrarCobro(entrada(), ACTOR_MAESTRO);
    expect(filaEscrita(m).id).not.toBe(primero);
  });
});

describe("461/B.7 (R3) — el importe es texto de punta a punta, en los TRES libros", () => {
  it.each([
    ["1500", "1500.00"],
    ["1500.5", "1500.50"],
    ["0.01", "0.01"],
    ["99999999.99", "99999999.99"],
  ])("%s se persiste como el STRING %s en el debito, el cargo y el rastro", async (dado, esperado) => {
    const m = montaje();
    await m.servicio.registrarCobro(entrada({ monto: dado }), ACTOR_MAESTRO);
    for (const monto of [filaEscrita(m).monto, cargoEscrito(m).monto, rastroEscrito(m).monto]) {
      expect(typeof monto).toBe("string");
      expect(monto).toBe(esperado);
    }
  });

  it("un importe con muchos decimales del pasado no se cuela como number", async () => {
    const m = montaje();
    await m.servicio.registrarCobro(entrada({ monto: "1500.005" }), ACTOR_MAESTRO);
    expect(filaEscrita(m).monto).toBe("1500.01"); // HALF_UP
    expect(cargoEscrito(m).monto).toBe("1500.01");
  });
});

describe("461/B.7 (R5) — sin tope ni candado: el saldo PUEDE quedar negativo y se devuelve entero", () => {
  it("un cobro mayor que el saldo se ACEPTA y devuelve `signo: negativo`", async () => {
    const m = montaje({ saldo: { creditos: "0.00", debitos: "15000.00" } });
    const r = await m.servicio.registrarCobro(entrada(), ACTOR_MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.saldo.saldo).toBe("-15000.00");
    expect(r.saldo.signo).toBe("negativo");
    expect(m.tiendaRepo.crearMovimientos).toHaveBeenCalledTimes(1);
    expect(m.caja.emitirCargoDeCobro).toHaveBeenCalledTimes(1);
  });

  it("con saldo suficiente el signo sigue siendo `positivo` (discriminador)", async () => {
    const m = montaje({ saldo: { creditos: "5000.00", debitos: "1500.00" } });
    const r = await m.servicio.registrarCobro(entrada(), ACTOR_MAESTRO);
    expect(r.status === "ok" && r.saldo.saldo).toBe("3500.00");
    expect(r.status === "ok" && r.saldo.signo).toBe("positivo");
  });

  it("P11: NINGUN candado se toma (el repositorio no tiene `bloquearBeneficiario` y nadie lo pide)", async () => {
    const m = montaje({ saldo: { creditos: "0.00", debitos: "0.00" } });
    const r = await m.servicio.registrarCobro(entrada({ monto: "99999999.99" }), ACTOR_MAESTRO);
    expect(r.status).toBe("ok");
    expect(Object.keys(m.tiendaRepo)).not.toContain("bloquearBeneficiario");
    // Y el saldo se lee del ledger entero, sin filtros, DESPUES de escribir.
    expect(m.tiendaRepo.agregarSaldoPorTienda).toHaveBeenCalledWith(TIENDA, {});
  });
});

describe("461/B.7 (R9) — el servicio NO se construye sin su puerto de caja", () => {
  it("el constructor declara CINCO dependencias obligatorias (tienda, usuarios, caja, anulaciones, runner)", () => {
    // `length` cuenta los parametros sin valor por defecto: el reloj es el sexto y es opcional.
    expect(CobroTiendaService.length).toBe(5);
  });

  it("construirlo con las tres dependencias de la 381 NO COMPILA", () => {
    const m = montaje();
    // @ts-expect-error — R9: sin caja ni anulaciones no hay servicio. La 381 lo construia asi.
    const sinCaja = () => new CobroTiendaService(m.tiendaRepo as never, m.usuarioRepo as never, m.runTransaction as never);
    expect(typeof sinCaja).toBe("function");
  });

  it("el archivo del servicio importa el puerto de caja (lo contrario de la 381)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const fuente = fs.readFileSync(path.join(process.cwd(), "lib", "services", "CobroTiendaService.ts"), "utf8");
    const imports = fuente
      .split("\n")
      .filter((l) => /^\s*import\b/.test(l) || /^\s*}\s*from\s+"/.test(l) || /^\s*"@\//.test(l))
      .join("\n");
    expect(imports).toMatch(/ICajaCobroTiendaFeedService/);
    expect(imports).toMatch(/ICobroTiendaAnulacionRepository/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ANULAR (R10–R19)
// ═════════════════════════════════════════════════════════════════════════════════════════════

const ANULACION = { cobroId: COBRO_ID, motivo: "Se cobro dos veces" };

describe("461/B.8 (R18) — el rol se evalua ANTES de leer el cobro", () => {
  it.each(["adminTienda", "mensajero", "adminSatelite", "apiKey"] as const)(
    "%s recibe `forbidden` sin que se lea el cobro ni se escriba nada",
    async (rol) => {
      const m = montaje();
      expect(await m.servicio.anular(ANULACION, { usuarioId: "u-x", rol })).toEqual({ status: "forbidden" });
      expect(m.tiendaRepo.obtenerCobroPorId).not.toHaveBeenCalled();
      expect(m.anulaciones.estadoDelCobro).not.toHaveBeenCalled();
      expect(m.runTransaction).not.toHaveBeenCalled();
    },
  );
});

describe("461/B.8 (R15/R16/R17) — lo que se rechaza ANTES de la transaccion, sin escribir nada", () => {
  it("R16: un id que no es un cobro (o no existe) -> `no_encontrado`", async () => {
    const m = montaje({ cobro: null });
    expect(await m.servicio.anular(ANULACION, ACTOR_MAESTRO)).toEqual({ status: "no_encontrado" });
    expect(m.tiendaRepo.obtenerCobroPorId).toHaveBeenCalledWith(COBRO_ID);
    expect(m.anulaciones.estadoDelCobro).not.toHaveBeenCalled();
    expect(m.runTransaction).not.toHaveBeenCalled();
  });

  it("R17/P12: un cobro RECLASIFICADO por la 459 -> `no_anulable` y dice por que", async () => {
    const m = montaje({ estado: { anulado: false, reclasificado: true, tieneCargo: false } });
    expect(await m.servicio.anular(ANULACION, ACTOR_MAESTRO)).toEqual({
      status: "no_anulable",
      motivo: "reclasificado",
    });
    expect(m.runTransaction).not.toHaveBeenCalled();
  });

  it("R17: un cobro SIN linea de caja (ni propia ni completada) -> `no_anulable` y dice por que", async () => {
    const m = montaje({ estado: { anulado: false, reclasificado: false, tieneCargo: false } });
    expect(await m.servicio.anular(ANULACION, ACTOR_MAESTRO)).toEqual({
      status: "no_anulable",
      motivo: "sin_linea_de_caja",
    });
    expect(m.runTransaction).not.toHaveBeenCalled();
  });

  it("R15: un cobro ya anulado -> `ya_anulado`, sin abrir la transaccion", async () => {
    const m = montaje({ estado: { anulado: true, reclasificado: false, tieneCargo: true } });
    expect(await m.servicio.anular(ANULACION, ACTOR_MAESTRO)).toEqual({ status: "ya_anulado" });
    expect(m.runTransaction).not.toHaveBeenCalled();
  });

  it("R15 (carrera): si el UNIQUE rechaza la constancia DENTRO de la transaccion -> `ya_anulado` y nada mas se escribe", async () => {
    const m = montaje({ anularResponde: { status: "ya_anulado" } });
    expect(await m.servicio.anular(ANULACION, ACTOR_MAESTRO)).toEqual({ status: "ya_anulado" });
    expect(m.anulaciones.anular).toHaveBeenCalledTimes(1);
    // Ni el credito ni el reverso: el `throw` interno revierte la transaccion entera.
    expect(m.tiendaRepo.crearMovimientos).not.toHaveBeenCalled();
    expect(m.caja.emitirReversoDeCobro).not.toHaveBeenCalled();
  });
});

describe("461/B.8 (R10–R13) — la anulacion: constancia, credito y reverso en UNA transaccion", () => {
  it("R10: constancia (con el motivo y quien) -> credito -> reverso, los tres con el tx del runner", async () => {
    const m = montaje();
    const r = await m.servicio.anular(ANULACION, ACTOR_ADMIN);
    expect(r.status).toBe("ok");
    expect(m.runTransaction).toHaveBeenCalledTimes(1);
    const constancia = m.anulaciones.anular.mock.calls as unknown as unknown[][];
    expect(constancia[0][0]).toBe(m.tx);
    expect(constancia[0][1]).toEqual({ cobroId: COBRO_ID, motivo: "Se cobro dos veces", anuladoPor: "u-admin" });
    const credito = m.tiendaRepo.crearMovimientos.mock.calls as unknown as unknown[][];
    const reverso = m.caja.emitirReversoDeCobro.mock.calls as unknown as unknown[][];
    expect(credito[0][0]).toBe(m.tx);
    expect(reverso[0][0]).toBe(m.tx);
    expect(m.anulaciones.anular.mock.invocationCallOrder[0]).toBeLessThan(
      m.tiendaRepo.crearMovimientos.mock.invocationCallOrder[0],
    );
    expect(m.tiendaRepo.crearMovimientos.mock.invocationCallOrder[0]).toBeLessThan(
      m.caja.emitirReversoDeCobro.mock.invocationCallOrder[0],
    );
  });

  it("⭑ mutacion 6 de design §14.2: el CREDITO a la tienda se escribe, `credito`/`cobro_tienda_anulado`", async () => {
    const m = montaje();
    await m.servicio.anular(ANULACION, ACTOR_MAESTRO);
    const fila = filaEscrita(m);
    expect(fila.tipo).toBe("credito");
    expect(fila.categoria).toBe("cobro_tienda_anulado");
    expect(fila.tiendaId).toBe(TIENDA);
    expect(fila.origenTipo).toBe("cobro_tienda");
    expect(fila.origenId).toBe(COBRO_ID); // idempotente por `wallet_tienda_movimiento_origen_uq`
    expect(fila.registradoPor).toBe("u-maestro");
    expect(fila.descripcion).toBe("Anulación · Reposicion de etiquetas");
  });

  it("⭑ R13 (mutacion 7 de design §14.2): el monto de los DOS contra-asientos es el DEL COBRO", async () => {
    // El cobro leido vale 2 500,50. La peticion trae a proposito un `monto` que el borde prohibe
    // (`.strict()`): si el servicio lo leyera —la mutacion 7, medida el 2026-09-25: con una peticion
    // sin `monto`, `input.monto ?? cobro.monto` era un mutante EQUIVALENTE y sobrevivia—, los
    // contra-asientos saldrian por 1,00 y este caso caeria en rojo.
    const m = montaje({
      cobro: { id: COBRO_ID, tiendaId: TIENDA, tiendaNombre: "Tienda Uno", monto: "2500.50", descripcion: "Publicidad", fechaMovimiento: "2026-09-20T06:00:00.000Z" },
    });
    await m.servicio.anular({ ...ANULACION, monto: "1.00" } as never, ACTOR_MAESTRO);
    expect(filaEscrita(m).monto).toBe("2500.50");
    expect(reversoEscrito(m).monto).toBe("2500.50");
    expect(reversoEscrito(m).cobroId).toBe(COBRO_ID);
  });

  it("R11: los dos contra-asientos llevan el MISMO instante, el de la anulacion (hoy)", async () => {
    const m = montaje();
    await m.servicio.anular(ANULACION, ACTOR_MAESTRO);
    expect(filaEscrita(m).fechaMovimiento).toEqual(AHORA);
    expect(reversoEscrito(m).fechaMovimiento).toEqual(AHORA);
    // Y NO la fecha original del cobro (2026-09-20): la anulacion es un hecho de hoy (P13).
    expect((filaEscrita(m).fechaMovimiento as Date).toISOString()).not.toBe("2026-09-20T06:00:00.000Z");
  });

  it("R7/R10: el reverso se describe «Anulación · {Tienda} · {descripcion}», sin ids ni el motivo", async () => {
    const m = montaje();
    await m.servicio.anular(ANULACION, ACTOR_MAESTRO);
    const reverso = reversoEscrito(m);
    expect(reverso.descripcion).toBe("Anulación · Tienda Uno · Reposicion de etiquetas");
    expect(String(reverso.descripcion)).not.toContain("Se cobro dos veces");
    expect(String(reverso.descripcion)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
    expect(reverso.registradoPor).toBe("u-maestro");
  });

  it("R11: la anulacion no EDITA ni BORRA nada: el repositorio del ledger solo recibe un `crearMovimientos`", async () => {
    const m = montaje();
    await m.servicio.anular(ANULACION, ACTOR_MAESTRO);
    expect(m.tiendaRepo.crearMovimientos).toHaveBeenCalledTimes(1);
    for (const metodo of Object.keys(m.tiendaRepo)) {
      expect(metodo).not.toMatch(/update|delete|borrar|editar/i);
    }
  });

  it("R12/R5: devuelve el saldo de la tienda DESPUES, con su signo (puede seguir en contra)", async () => {
    const m = montaje({ saldo: { creditos: "1500.00", debitos: "5000.00" } });
    const r = await m.servicio.anular(ANULACION, ACTOR_MAESTRO);
    expect(r).toEqual({ status: "ok", saldo: { creditos: "1500.00", debitos: "5000.00", saldo: "-3500.00", signo: "negativo" } });
    expect(m.tiendaRepo.agregarSaldoPorTienda).toHaveBeenCalledWith(TIENDA, {});
  });
});

describe("461/B.8 (R19) — DOS metodos y ni uno mas: no hay editar ni deshacer la anulacion", () => {
  it("el servicio expone `registrarCobro` y `anular`, y NADA MAS", () => {
    const metodos = Object.getOwnPropertyNames(CobroTiendaService.prototype)
      .filter((n) => n !== "constructor")
      .sort();
    // `toEqual` literal, y ES el contrato (R19): la correccion de un cobro erroneo es su anulacion,
    // con contra-asientos; editarlo o «des-anularlo» no existe. REESCRITO por la 461: la 381 fijaba
    // `["registrarCobro"]` (su R22), superado por HD1.
    expect(metodos).toEqual(["anular", "registrarCobro"]);
  });
});

describe("461/B.7 — anti-vacuidad del montaje", () => {
  it("los dobles estan VIVOS: sin ellos nada de lo anterior significaria nada", async () => {
    const m = montaje();
    const r = await m.servicio.registrarCobro(entrada(), ACTOR_MAESTRO);
    expect(m.usuarioRepo.obtenerCuentaTienda).toHaveBeenCalledTimes(1);
    expect(m.tiendaRepo.crearMovimientos).toHaveBeenCalledTimes(1);
    expect(m.tiendaRepo.registrarCobroEnHistorial).toHaveBeenCalledTimes(1);
    expect(m.caja.emitirCargoDeCobro).toHaveBeenCalledTimes(1);
    expect(m.tiendaRepo.obtenerPorIdDeTienda).toHaveBeenCalledTimes(1);
    expect(m.tiendaRepo.agregarSaldoPorTienda).toHaveBeenCalledTimes(1);
    expect(r.status === "ok" ? r.cobro.id : "").toMatch(/^[0-9a-f-]{36}$/);
  });

  it("si la relectura no encuentra la fila, el servicio FALLA en vez de inventarse una", async () => {
    const m = montaje();
    m.tiendaRepo.obtenerPorIdDeTienda.mockResolvedValueOnce(null as never);
    await expect(m.servicio.registrarCobro(entrada(), ACTOR_MAESTRO)).rejects.toThrow(/no se pudo releer/);
  });
});

// ─── FICHA 461 (R66/R68, auditoria D2) — la clave de idempotencia del cobro ───

describe("461/R66/R68 — la clave de idempotencia del cobro", () => {
  it("la clave del cliente viaja al debito; `origen_id` sigue NULL", async () => {
    const m = montaje();
    await m.servicio.registrarCobro(entrada(), ACTOR_MAESTRO);
    const [, filas] = m.tiendaRepo.crearMovimientos.mock.calls[0] as unknown as [unknown, Array<Record<string, unknown>>];
    expect(filas[0]).toMatchObject({ claveIdempotencia: CLAVE_461, origenId: null, categoria: "cobro_manual" });
  });

  it("R68: si el debito NO se inserto (count 0: la clave ya tenia su cobro), la transaccion sale ANTES del historial y de la caja, y se responde `ya_registrado` con el cobro releido por clave", async () => {
    const m = montaje();
    const original = {
      id: "cobro-original",
      tiendaId: TIENDA,
      tipo: "debito" as const,
      categoria: "cobro_manual" as const,
      monto: "1500.00",
      origenTipo: "manual" as const,
      origenId: null,
      descripcion: "Reposicion de etiquetas",
      fechaMovimiento: "2026-09-25T15:30:45.123Z",
    };
    m.tiendaRepo.crearMovimientos.mockResolvedValueOnce(0 as never);
    m.tiendaRepo.obtenerCobroPorClave.mockResolvedValueOnce(original as never);
    const r = await m.servicio.registrarCobro(entrada(), ACTOR_MAESTRO);
    expect(r).toMatchObject({ status: "ya_registrado", cobro: original });
    expect(m.tiendaRepo.obtenerCobroPorClave).toHaveBeenCalledWith(CLAVE_461);
    expect(m.tiendaRepo.registrarCobroEnHistorial).not.toHaveBeenCalled();
    expect(m.caja.emitirCargoDeCobro).not.toHaveBeenCalled();
    expect(m.tiendaRepo.obtenerPorIdDeTienda).not.toHaveBeenCalled();
  });

  it("count 0 sin cobro que releer es un error con contexto, no una fila inventada", async () => {
    const m = montaje();
    m.tiendaRepo.crearMovimientos.mockResolvedValueOnce(0 as never);
    m.tiendaRepo.obtenerCobroPorClave.mockResolvedValueOnce(null as never);
    await expect(m.servicio.registrarCobro(entrada(), ACTOR_MAESTRO)).rejects.toThrow(/clave de idempotencia repetida/);
  });
});
