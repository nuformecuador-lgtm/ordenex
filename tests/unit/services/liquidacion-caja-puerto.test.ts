import { describe, it, expect, vi } from "vitest";
import type {
  CrearMovimientoInput,
  IWalletMovimientoRepository,
  WalletTxClient,
} from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type {
  CajaPagoTiendaTxClient,
  ICajaPagoTiendaFeedService,
  MovimientoDeCajaDePagoTienda,
} from "@/lib/interfaces/services/ICajaPagoTiendaFeedService";
import { CajaPagoTiendaFeedService } from "@/lib/services/CajaPagoTiendaFeedService";
import { LiquidacionService } from "@/lib/services/LiquidacionService";
import { NATURALEZA_POR_CATEGORIA } from "@/lib/utils/caja-tesoreria";
import { codigoSinComentarios } from "../../fixtures/money-safe";

/**
 * Feature 173 / T C.1 (R23) — EL PUERTO ESTRECHO, medido ESTRUCTURALMENTE.
 *
 * Este archivo no comprueba que la liquidacion se porte bien: comprueba que **no puede portarse
 * mal**. La 172 se protegio a si misma no inyectando el repositorio de la caja
 * (`LiquidacionService.ts`, R40): «sin la dependencia inyectada no hay forma de escribir alli
 * aunque alguien lo intente». La 173 necesita que la tienda SI escriba, asi que esa garantia
 * baja un escalon —de «no tiene la puerta» a «la puerta solo abre a dos sitios»— y este archivo
 * es el que paga la diferencia:
 *
 *  1. `LiquidacionService` sigue SIN recibir `IWalletMovimientoRepository` (que sabe escribir
 *     cualquier categoria, incluida `egreso_pago_mensajero`).
 *  2. El puerto tiene DOS metodos y ninguno mas.
 *  3. Ninguno de los dos es capaz de emitir `egreso_pago_mensajero`, ni de emitir nada cuya
 *     categoria o tipo venga de quien llama.
 *
 * El punto 3 no se afirma leyendo un comentario: se INTENTA. Los tests de abajo cuelan una
 * categoria y un tipo en la peticion y comprueban que el puerto los ignora.
 */

const FUENTE_SERVICIO = "lib/services/LiquidacionService.ts";
const FUENTE_PUERTO = "lib/services/CajaPagoTiendaFeedService.ts";
const CONTRATO_PUERTO = "lib/interfaces/services/ICajaPagoTiendaFeedService.ts";
const COMPOSITION_ROOT = "lib/actions/liquidacion.ts";

/** Repositorio de la caja, doble, que solo GUARDA lo que le mandan escribir. */
function repoEspia() {
  const escrituras: { tx: WalletTxClient; movs: CrearMovimientoInput[] }[] = [];
  const repo: IWalletMovimientoRepository = {
    crearMovimientos: vi.fn(async (tx: WalletTxClient, movs: CrearMovimientoInput[]) => {
      escrituras.push({ tx, movs });
      return movs.length;
    }),
    listar: vi.fn(),
    agregarBalance: vi.fn(),
    obtenerPorId: vi.fn(),
    agregarPorCategoria: vi.fn(),
  } as unknown as IWalletMovimientoRepository;
  return { repo, escrituras };
}

const TX = { walletMovimiento: {} } as unknown as CajaPagoTiendaTxClient;

const MOVIMIENTO: MovimientoDeCajaDePagoTienda = {
  pagoId: "pago-1",
  monto: "15000.00",
  descripcion: "SINPE · 1234567",
  registradoPor: "u-admin",
  fechaMovimiento: new Date("2026-07-30T00:00:00.000Z"),
};

describe("R23 — `LiquidacionService` NO recibe el repositorio de la caja", () => {
  it("su fuente no nombra ni el repositorio ni el delegado de Prisma de la caja", () => {
    const codigo = codigoSinComentarios(FUENTE_SERVICIO);

    expect(codigo).not.toMatch(/IWalletMovimientoRepository/);
    expect(codigo).not.toMatch(/WalletMovimientoRepository/);
    expect(codigo.match(/walletMovimiento/g)).toBeNull();
    // Lo que si tiene es el puerto, y entra como TIPO: no puede construir la implementacion.
    expect(codigo).toMatch(/import type \{ ICajaPagoTiendaFeedService \}/);
    expect(codigo).not.toMatch(/new CajaPagoTiendaFeedService/);
  });

  it("el servicio no nombra NINGUNA categoria de la caja: las fija el puerto", () => {
    const codigo = codigoSinComentarios(FUENTE_SERVICIO);

    // Todas las categorias del catalogo de la caja, no solo las tres de esta feature. Si una
    // sola apareciera en el codigo del servicio, es que alguien esta eligiendo desde fuera.
    for (const categoria of Object.keys(NATURALEZA_POR_CATEGORIA)) {
      expect(codigo, `LiquidacionService nombra ${categoria}`).not.toContain(categoria);
    }
  });

  it("el constructor pide CINCO dependencias, y la quinta es el puerto (no un repositorio)", () => {
    // `.length` cuenta los parametros SIN valor por defecto: los cuatro de la 172 mas el puerto.
    // El reloj queda fuera porque trae default. Si alguien añadiera aqui un sexto repositorio,
    // este numero lo delataria antes de que ningun test de comportamiento se enterara.
    expect(LiquidacionService.length).toBe(5);
  });

  it("el composition root le da el PUERTO, con el repositorio encapsulado dentro", () => {
    const codigo = codigoSinComentarios(COMPOSITION_ROOT);
    const build = codigo.slice(
      codigo.indexOf("function buildService"),
      codigo.indexOf("export interface LiquidacionDeps"),
    );

    expect(build.length).toBeGreaterThan(0);
    expect(build).toMatch(
      /new CajaPagoTiendaFeedService\(\s*new WalletMovimientoRepository\(prisma\),?\s*\)/,
    );
    // El repositorio de la caja aparece EXACTAMENTE una vez, y es dentro del puerto: no hay una
    // segunda instancia suelta que pudiera acabar en el constructor del servicio.
    expect(build.match(/new WalletMovimientoRepository\(/g)).toHaveLength(1);
  });
});

describe("R23 — el puerto tiene DOS metodos y ninguno mas", () => {
  it("la implementacion expone exactamente `emitirEgresoDePago` y `emitirReversoDeAnulacion`", () => {
    const metodos = Object.getOwnPropertyNames(CajaPagoTiendaFeedService.prototype)
      .filter((n) => n !== "constructor")
      .sort();

    expect(metodos).toEqual(["emitirEgresoDePago", "emitirReversoDeAnulacion"]);
  });

  it("y el CONTRATO declara esos dos y nada mas (un tercero rompe esta cuenta)", () => {
    const contrato = codigoSinComentarios(CONTRATO_PUERTO);
    const cuerpo = contrato.slice(contrato.indexOf("export interface ICajaPagoTiendaFeedService"));
    const firmas = [...cuerpo.matchAll(/^\s{2}(\w+)\(/gm)].map((m) => m[1]);

    expect(firmas).toEqual(["emitirEgresoDePago", "emitirReversoDeAnulacion"]);
  });

  it("ninguno de los dos admite `tipo` ni `categoria` en su peticion", () => {
    const contrato = codigoSinComentarios(CONTRATO_PUERTO);
    const entrada = contrato.slice(
      contrato.indexOf("export interface MovimientoDeCajaDePagoTienda"),
      contrato.indexOf("export interface ICajaPagoTiendaFeedService"),
    );

    expect(entrada.length).toBeGreaterThan(0);
    expect(entrada).not.toMatch(/^\s*tipo\s*[?:]/m);
    expect(entrada).not.toMatch(/^\s*categoria\s*[?:]/m);
    expect(entrada).not.toMatch(/^\s*origenTipo\s*[?:]/m);
    // Lo que si describe es el HECHO: que pago, cuanto, quien y cuando.
    for (const campo of ["pagoId", "monto", "descripcion", "registradoPor", "fechaMovimiento"]) {
      expect(entrada, `falta ${campo}`).toMatch(new RegExp(`^\\s*${campo}\\s*:`, "m"));
    }
  });

  it("el puerto solo alcanza el libro de la CAJA: su `tx` es un `Pick` de una tabla (R31/R33)", () => {
    const contrato = codigoSinComentarios(CONTRATO_PUERTO);

    expect(contrato).toMatch(
      /export type CajaPagoTiendaTxClient = Pick<PrismaClient, "walletMovimiento">;/,
    );
    // Con ese tipo, tocar el ledger por tienda o el libro del mensajero no compila.
    expect(contrato).not.toContain("walletTiendaMovimiento");
    expect(contrato).not.toContain("pagoMensajeroMovimiento");
  });
});

describe("R23 — el puerto NO puede escribir `egreso_pago_mensajero`", () => {
  it("su fuente nombra DOS categorias, y ninguna es la del mensajero", () => {
    const codigo = codigoSinComentarios(FUENTE_PUERTO);
    const nombradas = Object.keys(NATURALEZA_POR_CATEGORIA).filter((c) => codigo.includes(c));

    expect(nombradas.sort()).toEqual(["egreso_pago_tienda", "ingreso_reverso_pago_tienda"]);
    expect(codigo).not.toContain("egreso_pago_mensajero");
    // Y las dos que puede emitir son de naturaleza TERCEROS: por construccion, nada de lo que
    // este puerto escriba puede mover la ganancia de Ordenex (R18/R26).
    for (const categoria of nombradas) {
      expect(
        NATURALEZA_POR_CATEGORIA[categoria as keyof typeof NATURALEZA_POR_CATEGORIA],
        categoria,
      ).toBe("terceros");
    }
  });

  it("el `tipo` y la `categoria` son literales del puerto: colarlos en la peticion no sirve", async () => {
    const { repo, escrituras } = repoEspia();
    const puerto: ICajaPagoTiendaFeedService = new CajaPagoTiendaFeedService(repo);

    // Se INTENTA de verdad: una peticion con la categoria del mensajero y el tipo invertido.
    const colado = {
      ...MOVIMIENTO,
      tipo: "ingreso",
      categoria: "egreso_pago_mensajero",
      origenTipo: "pago_mensajero",
    } as unknown as MovimientoDeCajaDePagoTienda;

    await puerto.emitirEgresoDePago(TX, colado);
    await puerto.emitirReversoDeAnulacion(TX, colado);

    expect(escrituras).toHaveLength(2);
    expect(escrituras[0].movs[0]).toMatchObject({
      tipo: "egreso",
      categoria: "egreso_pago_tienda",
      origenTipo: "pago_tienda",
    });
    expect(escrituras[1].movs[0]).toMatchObject({
      tipo: "ingreso",
      categoria: "ingreso_reverso_pago_tienda",
      origenTipo: "pago_tienda",
    });
  });

  it("cada metodo emite UNA fila y solo una, con la clave de origen del pago", async () => {
    const { repo, escrituras } = repoEspia();
    const puerto = new CajaPagoTiendaFeedService(repo);

    const insertadasEgreso = await puerto.emitirEgresoDePago(TX, MOVIMIENTO);
    const insertadasReverso = await puerto.emitirReversoDeAnulacion(TX, MOVIMIENTO);

    expect(insertadasEgreso).toBe(1);
    expect(insertadasReverso).toBe(1);
    for (const escritura of escrituras) {
      expect(escritura.movs).toHaveLength(1);
      expect(escritura.movs[0].origenTipo).toBe("pago_tienda");
      expect(escritura.movs[0].origenId).toBe("pago-1");
      expect(escritura.movs[0].monto).toBe("15000.00");
      expect(escritura.movs[0].fechaMovimiento?.toISOString()).toBe("2026-07-30T00:00:00.000Z");
      // El `tx` que se le da es el que usa: no abre uno propio ni escribe fuera de transaccion.
      expect(escritura.tx).toBe(TX);
    }
    // Las dos filas comparten `(origen_tipo, origen_id)` y se distinguen por `categoria`: caben
    // las dos en el indice unico parcial y ninguna puede duplicarse (design §2.5).
    expect(escrituras[0].movs[0].categoria).not.toBe(escrituras[1].movs[0].categoria);
  });

  it("no hace aritmetica con el dinero: el monto sale tal cual entro (money-safe)", async () => {
    const { repo, escrituras } = repoEspia();
    const puerto = new CajaPagoTiendaFeedService(repo);

    await puerto.emitirEgresoDePago(TX, { ...MOVIMIENTO, monto: "9007199254740993.13" });

    expect(escrituras[0].movs[0].monto).toBe("9007199254740993.13");
    const codigo = codigoSinComentarios(FUENTE_PUERTO);
    for (const prohibida of [/\bNumber\s*\(/, /\bparseFloat\s*\(/, /\bparseInt\s*\(/, /\.toFixed\s*\(/]) {
      expect(codigo, `${FUENTE_PUERTO} usa ${prohibida}`).not.toMatch(prohibida);
    }
  });
});
