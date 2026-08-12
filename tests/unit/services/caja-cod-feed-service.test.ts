import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { CajaCodFeedService } from "@/lib/services/CajaCodFeedService";
import type { CajaCodFeedTxClient } from "@/lib/interfaces/services/ICajaCodFeedService";
import { codigoSinComentarios } from "../../fixtures/sin-comentarios";

/**
 * Feature 173 / T B.1 (R11/R12/R13/R17) — el feed que mete el CONTRA-ENTREGA en la caja.
 *
 * La propiedad que este archivo defiende es UNA: **el monto sale del LEDGER POR TIENDA, no de
 * las gestiones**. Por eso el doble de `walletTiendaMovimiento` no devuelve una lista fija:
 * HONRA EL `where` como lo haria Postgres. Con un doble complaciente, olvidarse de `categoria`
 * o de `tipo` en el WHERE seguiria verde y la caja se comeria los debitos de flete e IVA como
 * si fueran contra-entrega.
 */

// Filas del ledger, con la forma con la que Prisma las devuelve: `monto` es un `Prisma.Decimal`
// (nunca un number), que es lo que el feed tiene que saber sumar.
interface FilaLedger {
  origenTipo: string;
  origenId: string | null;
  categoria: string;
  tipo: string;
  monto: Prisma.Decimal;
}

function fila(
  origenId: string | null,
  categoria: string,
  tipo: string,
  monto: string,
  origenTipo = "cierre_dia",
): FilaLedger {
  return { origenTipo, origenId, categoria, tipo, monto: new Prisma.Decimal(monto) };
}

/**
 * El ledger de la prueba. Solo el credito `cod_recaudado` de `c1` es contra-entrega de ESE
 * cierre; todo lo demas esta puesto para que una mutacion del WHERE se note:
 *
 *  - los DEBITOS de `c1` son lo que Ordenex SE QUEDA (flete, IVA): si se colaran, la caja
 *    contaria dos veces el mismo dinero;
 *  - `ajuste_credito` es un credito de OTRA categoria;
 *  - `c2` es otro cierre;
 *  - el `cod_recaudado`/`debito` no existe en produccion: esta aqui exclusivamente para que
 *    quitar `tipo` del WHERE ponga el test rojo.
 */
function ledgerDeEjemplo(): FilaLedger[] {
  return [
    fila("c1", "cod_recaudado", "credito", "12500.75"), // tienda 1
    fila("c1", "cod_recaudado", "credito", "300.25"), // tienda 2
    fila("c1", "flete", "debito", "1000.00"),
    fila("c1", "iva_flete", "debito", "130.00"),
    fila("c1", "ajuste_credito", "credito", "999.00"),
    fila("c1", "cod_recaudado", "debito", "7.00"),
    fila("c2", "cod_recaudado", "credito", "77777.00"),
    fila(null, "cod_recaudado", "credito", "55.00", "manual"),
  ];
}

/**
 * Doble del cliente de transaccion. `walletTiendaMovimiento.findMany` FILTRA de verdad por el
 * `where` recibido; `gestionOrden` esta presente solo para poder afirmar que el feed NO lo
 * toca (el `Pick` del tipo ya lo impide en compilacion, pero la contraprueba de R12 lo mide en
 * ejecucion).
 */
function txConLedger(filas: FilaLedger[], montoRecibidoDeLasGestiones: string[] = []) {
  const walletTiendaMovimiento = {
    findMany: vi.fn(async (args: { where: Record<string, unknown>; select?: unknown }) => {
      const w = args.where;
      return filas
        .filter((f) =>
          Object.entries(w).every(([k, v]) => (f as unknown as Record<string, unknown>)[k] === v),
        )
        .map((f) => ({ monto: f.monto }));
    }),
  };
  const gestionOrden = {
    findMany: vi.fn(async () =>
      montoRecibidoDeLasGestiones.map((m) => ({ montoRecibido: new Prisma.Decimal(m) })),
    ),
  };
  const tx = { walletTiendaMovimiento, gestionOrden };
  return { tx: tx as unknown as CajaCodFeedTxClient, walletTiendaMovimiento, gestionOrden };
}

const feed = new CajaCodFeedService();

describe("CajaCodFeedService — el contra-entrega entra en la caja (R11/R12)", () => {
  it("R11/R12: con DOS tiendas en el cierre, el monto es la suma EXACTA de sus dos creditos", async () => {
    const { tx } = txConLedger(ledgerDeEjemplo());

    const movs = await feed.construirIngresoCod("c1", tx);

    expect(movs).toHaveLength(1);
    // 12500.75 + 300.25 = 12801.00. Ni los debitos (1130.00), ni el ajuste (999.00), ni el
    // otro cierre (77777.00), ni el manual (55.00).
    expect(movs[0].monto).toBe("12801.00");
  });

  it("R11: el movimiento es un INGRESO de la categoria del contra-entrega, con el cierre como origen", async () => {
    const { tx } = txConLedger(ledgerDeEjemplo());

    const [mov] = await feed.construirIngresoCod("c1", tx);

    expect(mov).toEqual({
      tipo: "ingreso",
      categoria: "ingreso_cod_recaudado",
      monto: "12801.00",
      origenTipo: "cierre_dia",
      origenId: "c1",
      descripcion: null,
      registradoPor: null,
    });
  });

  it("R12: el WHERE acota por cierre, categoria Y tipo — las cuatro claves, ninguna de mas", async () => {
    const { tx, walletTiendaMovimiento } = txConLedger(ledgerDeEjemplo());

    await feed.construirIngresoCod("c1", tx);

    const arg = walletTiendaMovimiento.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({
      origenTipo: "cierre_dia",
      origenId: "c1",
      categoria: "cod_recaudado",
      tipo: "credito",
    });
    // Solo se trae el monto: el feed no necesita —ni puede— nada mas.
    expect(arg.select).toEqual({ monto: true });
  });

  it("R12: cada cierre suma LO SUYO (el mismo ledger, otro cierre, otro monto)", async () => {
    const { tx } = txConLedger(ledgerDeEjemplo());

    const [movC2] = await feed.construirIngresoCod("c2", tx);

    expect(movC2.monto).toBe("77777.00");
    expect(movC2.origenId).toBe("c2");
  });

  it("acumula N creditos sin perder ninguno (cinco tiendas en el mismo cierre)", async () => {
    const cinco = ["1000.01", "2000.02", "3000.03", "4000.04", "5000.05"].map((m) =>
      fila("c9", "cod_recaudado", "credito", m),
    );
    const { tx } = txConLedger(cinco);

    const [mov] = await feed.construirIngresoCod("c9", tx);

    expect(mov.monto).toBe("15000.15");
  });
});

describe("CajaCodFeedService — CONTRAPRUEBA de R12: el monto sale del LEDGER, no de las gestiones", () => {
  it("con el ledger y las gestiones DISCREPANTES, gana el ledger", async () => {
    // El caso real que esto atrapa: alguien reescribe el feed para recalcular desde
    // `gestion_orden.montoRecibido`. Mientras los dos numeros coincidan, nadie lo nota; el dia
    // que divergen —una gestion anulada, un ajuste, el interruptor Q3— la caja diria una cosa
    // y el saldo de la tienda otra, y no habria forma de decir cual tiene razon.
    const ledger = [
      fila("c1", "cod_recaudado", "credito", "12500.75"),
      fila("c1", "cod_recaudado", "credito", "300.25"),
    ];
    const gestionesQueDicenOtraCosa = ["9999.00", "1.00"]; // 10000.00, NO 12801.00
    const { tx, gestionOrden } = txConLedger(ledger, gestionesQueDicenOtraCosa);

    const [mov] = await feed.construirIngresoCod("c1", tx);

    expect(mov.monto).toBe("12801.00"); // el LEDGER
    expect(mov.monto).not.toBe("10000.00"); // NO las gestiones
    // Y no es que coincida por casualidad: las gestiones ni se leen.
    expect(gestionOrden.findMany).not.toHaveBeenCalled();
  });

  it("un ledger VACIO no se rescata con las gestiones: no hay movimiento", async () => {
    // Espejo del anterior. Si el feed cayera a `gestion_orden` cuando el ledger no da nada,
    // aqui saldria una fila de 5000.00 de la nada.
    const { tx, gestionOrden } = txConLedger([], ["5000.00"]);

    expect(await feed.construirIngresoCod("c1", tx)).toEqual([]);
    expect(gestionOrden.findMany).not.toHaveBeenCalled();
  });
});

describe("CajaCodFeedService — R13: sin contra-entrega, NI UNA FILA (ni siquiera en 0.00)", () => {
  it("un cierre sin creditos `cod_recaudado` devuelve lista VACIA", async () => {
    // El ledger tiene movimientos de ese cierre, pero ninguno es contra-entrega: un cierre de
    // puras devoluciones. La caja no gana nada.
    const soloDebitos = [
      fila("c1", "flete", "debito", "1000.00"),
      fila("c1", "iva_flete", "debito", "130.00"),
    ];
    const { tx } = txConLedger(soloDebitos);

    expect(await feed.construirIngresoCod("c1", tx)).toEqual([]);
  });

  it("un cierre cuyos creditos SUMAN 0.00 tampoco emite fila", async () => {
    const { tx } = txConLedger([fila("c1", "cod_recaudado", "credito", "0.00")]);

    const movs = await feed.construirIngresoCod("c1", tx);

    expect(movs).toEqual([]);
    // Dicho de la otra forma, porque es lo que el requisito prohibe literalmente: no existe
    // una fila con monto "0.00".
    expect(movs.some((m) => m.monto === "0.00")).toBe(false);
  });

  it("un cierre que no existe en el ledger devuelve lista VACIA (no lanza)", async () => {
    const { tx } = txConLedger(ledgerDeEjemplo());
    expect(await feed.construirIngresoCod("c-inexistente", tx)).toEqual([]);
  });
});

describe("CajaCodFeedService — R17: la fecha la pone la base, como en los otros cuatro movimientos", () => {
  it("NO se pasa `fechaMovimiento`: la clave ni siquiera esta presente", async () => {
    const { tx } = txConLedger(ledgerDeEjemplo());

    const [mov] = await feed.construirIngresoCod("c1", tx);

    // No basta con que valga `undefined`: el repositorio de la 42 decide si la clave viaja
    // mirando si esta definida, y una clave presente con `undefined` seria otra historia.
    expect(mov).not.toHaveProperty("fechaMovimiento");
    expect(Object.keys(mov)).not.toContain("fechaMovimiento");
  });
});

describe("CajaCodFeedService — money-safe (R7 aplicado a este emisor)", () => {
  it("el monto sale como STRING con DOS decimales, siempre", async () => {
    for (const [entrada, esperado] of [
      ["0.01", "0.01"],
      ["7", "7.00"],
      ["1234.5", "1234.50"],
      ["99999999.99", "99999999.99"],
    ] as const) {
      const { tx } = txConLedger([fila("cx", "cod_recaudado", "credito", entrada)]);
      const [mov] = await feed.construirIngresoCod("cx", tx);
      expect(typeof mov.monto).toBe("string");
      expect(mov.monto).toBe(esperado);
    }
  });

  it("no pierde centavos sumando importes grandes (Decimal, no double)", async () => {
    // 9007199254.74 esta por encima del rango donde un double conserva centavos exactos.
    const { tx } = txConLedger([
      fila("cx", "cod_recaudado", "credito", "9007199254.74"),
      fila("cx", "cod_recaudado", "credito", "0.07"),
    ]);

    const [mov] = await feed.construirIngresoCod("cx", tx);

    expect(mov.monto).toBe("9007199254.81");
  });

  it("el modulo no nombra `Number(`, `parseFloat(`, `parseInt(` ni lee otra tabla", () => {
    // Se barre el CODIGO, no los comentarios: el modulo explica por escrito por que NO lee
    // `gestion_orden.montoRecibido`, y esa frase no puede poner el barrido rojo.
    const codigo = codigoSinComentarios("lib/services/CajaCodFeedService.ts");

    expect(codigo).not.toMatch(/Number\(/);
    expect(codigo).not.toMatch(/parseFloat\(/);
    expect(codigo).not.toMatch(/parseInt\(/);
    expect(codigo).toMatch(/toFixed\(2\)/);
    // El ledger es su UNICA fuente: ni gestiones, ni snapshot del cierre, ni tarifas.
    expect(codigo).not.toMatch(/gestionOrden/);
    expect(codigo).not.toMatch(/montoRecibido/);
    expect(codigo).not.toMatch(/cierreDetail/);
    expect(codigo).toMatch(/walletTiendaMovimiento\.findMany/);
  });
});
