import { describe, it, expect, vi } from "vitest";
import { WalletTiendaService } from "@/lib/services/WalletTiendaService";
import type {
  CierreDeTiendaAgregadoRow,
  IWalletTiendaMovimientoRepository,
} from "@/lib/interfaces/repositories/IWalletTiendaMovimientoRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { walletTiendaConfig } from "@/lib/config/wallet-tienda";

/**
 * FICHA 335 (A9) — `WalletTiendaService.listarMisCierres`: el catalogo de cierres del libro de
 * la PROPIA tienda, que es lo que sustituye al campo donde habia que teclear un identificador.
 *
 * QUE MIDE ESTE ARCHIVO Y QUE NO. Aqui el repositorio es un DOBLE, asi que estos casos NO ven
 * el SQL: lo que afirman es la logica de negocio —el guard antes de la base, el argumento de
 * alcance que sale hacia el repositorio, el recorte del tope y la forma exacta del DTO—.
 *
 * El `WHERE` de verdad se prueba donde vive: en
 * `tests/unit/repositories/wallet-tienda-movimiento-repository.test.ts` (sobre el argumento real
 * que llega al ORM) y en `tests/integration/db/mi-wallet-cierres-alcance.test.ts` (contra
 * Postgres). En este repo esta medido cuatro veces que una mutacion del `WHERE` pasa en verde
 * por esta capa; este archivo no pretende cerrarla.
 */

const TIENDA: Actor = { usuarioId: "t1", rol: "adminTienda" };
const OTRA_TIENDA: Actor = { usuarioId: "t2", rol: "adminTienda" };
const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "a1", rol: "admin" };
const MENSAJERO: Actor = { usuarioId: "x1", rol: "mensajero" };
const SATELITE: Actor = { usuarioId: "s1", rol: "adminSatelite" };

function fila(overrides: Partial<CierreDeTiendaAgregadoRow> = {}): CierreDeTiendaAgregadoRow {
  return {
    cierreId: "cierre-1",
    ultimaFecha: "2026-07-12T14:30:00.000Z",
    movimientos: 4,
    ...overrides,
  };
}

function fakeRepo(
  overrides: Partial<IWalletTiendaMovimientoRepository> = {},
): IWalletTiendaMovimientoRepository {
  return {
    crearMovimientos: vi.fn(async () => 0),
    listarPorTienda: vi.fn(async () => ({ movimientos: [], total: 0 })),
    agregarSaldoPorTienda: vi.fn(async () => ({ creditos: "0.00", debitos: "0.00" })),
    listarSaldosTodasTiendas: vi.fn(async () => []),
    listarSaldosTiendasPaginado: vi.fn(async () => ({ items: [], total: 0 })),
    agregarDesglosePorTienda: vi.fn(async () => []),
    listarCierresDeTienda: vi.fn(async () => []),
    ...overrides,
  };
}

/** El doble como `vi.fn`, para poder leer los argumentos con los que se le llamo. */
function espia(repo: IWalletTiendaMovimientoRepository) {
  return repo.listarCierresDeTienda as ReturnType<typeof vi.fn>;
}

describe("WalletTiendaService.listarMisCierres (ficha 335, R1/R6)", () => {
  it("R1/R6: devuelve un elemento por cierre, con su fecha más reciente y su número de movimientos, y nada más", async () => {
    const repo = fakeRepo({
      listarCierresDeTienda: vi.fn(async () => [
        fila({ cierreId: "c-nuevo", ultimaFecha: "2026-07-12T14:30:00.000Z", movimientos: 4 }),
        fila({ cierreId: "c-viejo", ultimaFecha: "2026-07-05T09:00:00.000Z", movimientos: 1 }),
      ]),
    });
    const r = await new WalletTiendaService(repo).listarMisCierres(TIENDA);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("ok");
    // `toEqual` sobre el objeto COMPLETO: una clave de mas —el mensajero del cierre, un
    // importe— rompe este caso. Es la forma de que R6 signifique «exactamente tres datos».
    expect(r.cierres).toEqual([
      { cierreId: "c-nuevo", fecha: "2026-07-12T14:30:00.000Z", movimientos: 4 },
      { cierreId: "c-viejo", fecha: "2026-07-05T09:00:00.000Z", movimientos: 1 },
    ]);
    expect(r.hayMas).toBe(false);
  });

  it("R6: la fecha del repositorio viaja SIN transformar (quien la formatea es la pantalla)", async () => {
    // Si el servicio recortara el dia aqui, la opcion y la columna «Fecha» de la tabla podrian
    // decir dias distintos el dia que una de las dos cambie de formateador.
    const repo = fakeRepo({
      listarCierresDeTienda: vi.fn(async () => [fila({ ultimaFecha: "2026-12-31T23:59:59.000Z" })]),
    });
    const r = await new WalletTiendaService(repo).listarMisCierres(TIENDA);
    if (r.status !== "ok") throw new Error("ok");
    expect(r.cierres[0].fecha).toBe("2026-12-31T23:59:59.000Z");
  });
});

describe("WalletTiendaService.listarMisCierres — alcance y permiso (R2/R3)", () => {
  it("R3: un rol que no es la tienda recibe forbidden sin llamar al repositorio", async () => {
    // El guard va ANTES de la base: con el guard despues, la lista de cierres ya habria salido
    // de Postgres aunque la respuesta fuera un error.
    for (const actor of [MAESTRO, ADMIN, MENSAJERO, SATELITE]) {
      const repo = fakeRepo();
      const r = await new WalletTiendaService(repo).listarMisCierres(actor);
      expect(r, actor.rol).toEqual({ status: "forbidden" });
      expect(repo.listarCierresDeTienda, actor.rol).not.toHaveBeenCalled();
    }
  });

  it("R2: el repositorio recibe EXACTAMENTE el `usuarioId` del actor como tienda", async () => {
    const repo = fakeRepo();
    await new WalletTiendaService(repo).listarMisCierres(OTRA_TIENDA);

    expect(espia(repo)).toHaveBeenCalledTimes(1);
    const [tiendaIdRecibido, limiteRecibido] = espia(repo).mock.calls[0];
    // El alcance sale del ACTOR (`t2`) y de ningun otro sitio: no hay entrada donde colar otro.
    expect(tiendaIdRecibido).toBe("t2");
    expect(tiendaIdRecibido).not.toBe(TIENDA.usuarioId);
    expect(typeof limiteRecibido).toBe("number");
  });
});

describe("WalletTiendaService.listarMisCierres — el tope (R8)", () => {
  /** N filas sinteticas, cada una con su propio cierre. */
  function nFilas(n: number): CierreDeTiendaAgregadoRow[] {
    return Array.from({ length: n }, (_, i) =>
      fila({ cierreId: `c-${i}`, movimientos: i + 1 }),
    );
  }

  const TOPE = walletTiendaConfig.MAX_CIERRES_FILTRO;

  it("R8: con el tope N y N+1 cierres devuelve N elementos y `hayMas` en true", async () => {
    const repo = fakeRepo({ listarCierresDeTienda: vi.fn(async () => nFilas(TOPE + 1)) });
    const r = await new WalletTiendaService(repo).listarMisCierres(TIENDA);

    if (r.status !== "ok") throw new Error("ok");
    expect(r.cierres).toHaveLength(TOPE);
    expect(r.hayMas).toBe(true);
    // Y el sobrante NO viaja: la opcion N+1 no se pinta ni siquiera oculta.
    expect(r.cierres.map((c) => c.cierreId)).not.toContain(`c-${TOPE}`);
    // El tope + 1 se pide a la BASE, no se recorta un conjunto ilimitado en memoria (R10: sin
    // una segunda consulta de conteo).
    expect(espia(repo).mock.calls[0][1]).toBe(TOPE + 1);
  });

  it("R8: con N cierres exactos devuelve N y `hayMas` en false", async () => {
    // Contraprueba del tope: sin ella, un `hayMas` cableado a `true` pasaria el caso de arriba.
    const repo = fakeRepo({ listarCierresDeTienda: vi.fn(async () => nFilas(TOPE)) });
    const r = await new WalletTiendaService(repo).listarMisCierres(TIENDA);

    if (r.status !== "ok") throw new Error("ok");
    expect(r.cierres).toHaveLength(TOPE);
    expect(r.hayMas).toBe(false);
  });

  it("R8: sin cierres devuelve lista vacia y `hayMas` en false", async () => {
    const r = await new WalletTiendaService(fakeRepo()).listarMisCierres(TIENDA);
    if (r.status !== "ok") throw new Error("ok");
    expect(r.cierres).toEqual([]);
    expect(r.hayMas).toBe(false);
  });
});

describe("WalletTiendaService.listarMisCierres — money-safe y superficie (R5/R9)", () => {
  it("R9: ninguna clave de la respuesta es un importe", async () => {
    const repo = fakeRepo({
      listarCierresDeTienda: vi.fn(async () => [fila(), fila({ cierreId: "c-2" })]),
    });
    const r = await new WalletTiendaService(repo).listarMisCierres(TIENDA);
    if (r.status !== "ok") throw new Error("ok");

    // Barrido sobre las claves REALES del DTO, no sobre una lista escrita a mano: si el DTO
    // ganara `monto`, `total` o `saldo`, este caso cae.
    const NOMBRE_DE_DINERO = /monto|saldo|total|importe|credito|debito|pagado|cargo|favor/i;
    expect(r.cierres.length).toBeGreaterThan(0); // no-vacuidad: sin filas no se barre nada
    for (const opcion of r.cierres) {
      expect(Object.keys(opcion).sort()).toEqual(["cierreId", "fecha", "movimientos"]);
      for (const clave of Object.keys(opcion)) {
        expect(clave, `la opcion expone ${clave}`).not.toMatch(NOMBRE_DE_DINERO);
      }
      // Y el unico numerico es un CARDINAL entero, no un decimal de dinero.
      expect(Number.isInteger(opcion.movimientos)).toBe(true);
    }

    // CONTRAPRUEBA del barrido: el mismo criterio SI caza una clave de dinero inventada.
    expect(["cierreId", "montoTotal"].filter((c) => NOMBRE_DE_DINERO.test(c))).toEqual([
      "montoTotal",
    ]);
  });

  it("R5: el método no admite entrada", async () => {
    // La barrera de alcance es la AUSENCIA de superficie: no hay ninguna clave que pueda
    // ampliar el conjunto porque no hay entrada donde escribirla. Su aridad es 1 (el actor).
    const svc = new WalletTiendaService(fakeRepo());
    expect(svc.listarMisCierres.length).toBe(1);
  });

  it("R5: un objeto colado como segundo argumento no cambia el conjunto ni el alcance", async () => {
    const repo = fakeRepo({ listarCierresDeTienda: vi.fn(async () => [fila()]) });
    const svc = new WalletTiendaService(repo);

    const limpio = await svc.listarMisCierres(TIENDA);
    // El `as never` es la unica forma de EJERCER lo que un cliente en JS podria intentar: la
    // firma ya lo prohibe en TypeScript, y este caso mide que tampoco cambia nada en ejecucion.
    const colado = await (
      svc.listarMisCierres as unknown as (a: Actor, extra: unknown) => Promise<unknown>
    )(TIENDA, { tiendaId: "t2", limite: 9999 });

    expect(colado).toEqual(limpio);
    for (const llamada of espia(repo).mock.calls) expect(llamada[0]).toBe("t1");
  });
});
