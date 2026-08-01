import { describe, it, expect } from "vitest";
import {
  CUBETA_POR_CATEGORIA,
  derivarDesgloseTienda,
  type CubetaDesglose,
} from "@/lib/utils/desglose-tienda";
import { derivarSaldoTienda } from "@/lib/utils/saldo-tienda";
import {
  WALLET_TIENDA_DEBITO_CATEGORIA_SEED,
  WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED,
  type WalletTiendaMovimientoCategoria,
  type WalletTiendaMovimientoTipo,
} from "@/lib/types/wallet-tienda";
import type { DesgloseTiendaAgregadoRow } from "@/lib/interfaces/repositories/IWalletTiendaMovimientoRepository";

// Feature 171 / T1.2 — derivacion PURA de la cabecera del desglose (R8/R9/R10/R23/R43).
//
// Lo que se juega aqui: que ninguna categoria del ledger caiga en una cubeta por descuido, y
// que «pagado a la tienda» sea una cifra LEIDA del ledger y no un cero decorativo. Hoy vale
// siempre "0.00" porque ningun flujo emite `pago_tienda` (lo hara la 172); el test (c) inserta
// ese movimiento a mano para demostrar que el dia que exista, la cabecera lo refleja.

function fila(
  categoria: WalletTiendaMovimientoCategoria,
  total: string,
  tipo: WalletTiendaMovimientoTipo,
): DesgloseTiendaAgregadoRow {
  return { tipo, categoria, total };
}

/** El `tipo` con el que el SISTEMA emite cada categoria (design §2.1). */
const CREDITO_SEED: readonly WalletTiendaMovimientoCategoria[] = ["cod_recaudado", "ajuste_credito"];

function tipoEmitido(categoria: WalletTiendaMovimientoCategoria): WalletTiendaMovimientoTipo {
  return CREDITO_SEED.includes(categoria) ? "credito" : "debito";
}

describe("CUBETA_POR_CATEGORIA — clasificacion exhaustiva (R8/R9)", () => {
  it("R9: TODA categoria del catalogo tiene cubeta declarada, y el mapa no tiene ninguna de mas", () => {
    // El `Record<WalletTiendaMovimientoCategoria, …>` ya rompe el typecheck si el enum gana un
    // valor sin clasificar. Esto lo comprueba tambien en RUNTIME, para que la garantia no
    // dependa de que alguien ejecute `tsc`, y ademas cierra la direccion contraria: una clave
    // en el mapa que ya no exista en el catalogo.
    for (const categoria of WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED) {
      expect(CUBETA_POR_CATEGORIA[categoria], `categoria ${categoria}`).toBeDefined();
      expect(["aFavor", "cargos", "pagado"]).toContain(CUBETA_POR_CATEGORIA[categoria]);
    }
    expect(Object.keys(CUBETA_POR_CATEGORIA).sort()).toEqual(
      [...WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED].sort(),
    );
  });

  it("R8: la cubeta CONCUERDA con el tipo con el que el sistema emite la categoria", () => {
    for (const categoria of WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED) {
      const cubeta = CUBETA_POR_CATEGORIA[categoria];
      const tipo = tipoEmitido(categoria);
      if (tipo === "credito") {
        expect(cubeta, `credito ${categoria} debe ir a aFavor`).toBe("aFavor");
      } else {
        // Todo debito es «cargo» salvo el pago, que tiene cubeta propia.
        expect(["cargos", "pagado"], `debito ${categoria}`).toContain(cubeta);
        expect(cubeta === "aFavor", `debito ${categoria} NO puede ir a aFavor`).toBe(false);
      }
    }
  });

  it("R8: las 6 categorias de debito del feed del cierre son CARGOS, no pagos", () => {
    for (const categoria of WALLET_TIENDA_DEBITO_CATEGORIA_SEED) {
      expect(CUBETA_POR_CATEGORIA[categoria], `categoria ${categoria}`).toBe("cargos");
    }
  });

  it("R43: `pago_tienda` es la UNICA categoria de la cubeta `pagado`", () => {
    const enPagado = WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED.filter(
      (c) => CUBETA_POR_CATEGORIA[c] === "pagado",
    );
    expect(enPagado).toEqual(["pago_tienda"]);
  });

  it("R7/R8: las tres cubetas estan pobladas (ninguna nace vacia)", () => {
    const usadas = new Set<CubetaDesglose>(
      WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED.map((c) => CUBETA_POR_CATEGORIA[c]),
    );
    expect([...usadas].sort()).toEqual(["aFavor", "cargos", "pagado"]);
  });
});

describe("derivarDesgloseTienda — aritmetica de la cabecera (R10/R23)", () => {
  it("R10: saldo = aFavor - cargos - pagado, en POSITIVO", () => {
    const d = derivarDesgloseTienda([
      fila("cod_recaudado", "10000.00", "credito"),
      fila("flete", "1000.00", "debito"),
      fila("iva_flete", "130.00", "debito"),
      fila("pago_tienda", "2000.00", "debito"),
    ]);

    expect(d.aFavor).toBe("10000.00");
    expect(d.cargos).toBe("1130.00");
    expect(d.pagado).toBe("2000.00");
    expect(d.saldo).toBe("6870.00");
    expect(d.signo).toBe("positivo");
  });

  it("R10: saldo NEGATIVO (tienda que solo acumulo cargos)", () => {
    const d = derivarDesgloseTienda([
      fila("flete_devolucion", "400.00", "debito"),
      fila("iva_flete_devolucion", "52.00", "debito"),
    ]);

    expect(d.aFavor).toBe("0.00");
    expect(d.cargos).toBe("452.00");
    expect(d.pagado).toBe("0.00");
    expect(d.saldo).toBe("-452.00");
    expect(d.signo).toBe("negativo");
  });

  it("R10: saldo en CERO cuando lo cobrado y lo pagado agotan lo recaudado", () => {
    const d = derivarDesgloseTienda([
      fila("cod_recaudado", "1000.00", "credito"),
      fila("comision_cod", "250.00", "debito"),
      fila("pago_tienda", "750.00", "debito"),
    ]);

    expect(d.saldo).toBe("0.00");
    expect(d.signo).toBe("cero");
  });

  it("conjunto vacio -> los cuatro importes en 0.00 y signo cero (no un hueco)", () => {
    const d = derivarDesgloseTienda([]);
    expect(d).toEqual({
      aFavor: "0.00",
      cargos: "0.00",
      pagado: "0.00",
      saldo: "0.00",
      signo: "cero",
    });
  });

  it("R8: acumula VARIAS filas en la misma cubeta (los tres IVA + los dos fletes)", () => {
    const d = derivarDesgloseTienda([
      fila("cod_recaudado", "5000.00", "credito"),
      fila("ajuste_credito", "100.00", "credito"),
      fila("flete", "300.00", "debito"),
      fila("flete_devolucion", "200.00", "debito"),
      fila("comision_cod", "150.00", "debito"),
      fila("iva_flete", "39.00", "debito"),
      fila("iva_flete_devolucion", "26.00", "debito"),
      fila("iva_comision_cod", "19.50", "debito"),
      fila("ajuste_debito", "10.50", "debito"),
    ]);

    expect(d.aFavor).toBe("5100.00"); // 5000 + 100 (ajuste_credito pliega en «a favor», P6)
    expect(d.cargos).toBe("745.00"); // 300+200+150+39+26+19.50+10.50 (ajuste_debito incluido)
    expect(d.pagado).toBe("0.00");
    expect(d.saldo).toBe("4355.00");
  });

  it("R23: los cuatro importes son STRING con DOS decimales, siempre", () => {
    const d = derivarDesgloseTienda([
      fila("cod_recaudado", "7", "credito"), // sin decimales en la entrada
      fila("flete", "1.5", "debito"), // un solo decimal
    ]);

    for (const clave of ["aFavor", "cargos", "pagado", "saldo"] as const) {
      expect(typeof d[clave], clave).toBe("string");
      expect(d[clave], clave).toMatch(/^-?\d+\.\d{2}$/);
    }
    expect(d.aFavor).toBe("7.00");
    expect(d.cargos).toBe("1.50");
    expect(d.saldo).toBe("5.50");
  });

  it("R23: money-safe — 0.10 + 0.20 da 0.30 exacto, no 0.30000000000000004", () => {
    const d = derivarDesgloseTienda([
      fila("cod_recaudado", "0.10", "credito"),
      fila("ajuste_credito", "0.20", "credito"),
      fila("flete", "0.30", "debito"),
    ]);

    expect(d.aFavor).toBe("0.30");
    expect(d.saldo).toBe("0.00");
    expect(d.signo).toBe("cero");
  });

  it("R23: money-safe — un importe fuera del rango exacto de un double no pierde centavos", () => {
    const d = derivarDesgloseTienda([fila("cod_recaudado", "98765432109.87", "credito")]);
    expect(d.aFavor).toBe("98765432109.87");
    expect(d.saldo).toBe("98765432109.87");
  });
});

describe("derivarDesgloseTienda — «pagado a la tienda», el hueco que cierra la 172 (R43)", () => {
  it("(d) SIN movimientos de pago, `pagado` vale 0.00 — que es lo que se ve hoy", () => {
    // Estado REAL de produccion: ningun codigo emite `pago_tienda`, asi que el ledger de una
    // tienda solo trae COD y cargos.
    const d = derivarDesgloseTienda([
      fila("cod_recaudado", "10000.00", "credito"),
      fila("flete", "1000.00", "debito"),
    ]);

    expect(d.pagado).toBe("0.00");
    expect(d.saldo).toBe("9000.00"); // el cero no altera la aritmetica
  });

  it("(c) CON un movimiento `pago_tienda` sembrado a mano, el monto sale en `pagado` y NO en `cargos`", () => {
    // Este es el test que demuestra que la cifra no es decorativa: la MISMA funcion, sin
    // cambiar una linea, mueve el importe a su cubeta en cuanto el movimiento existe. El dia
    // que la 172 emita el primer pago, la pantalla lo refleja sola.
    const sinPago = derivarDesgloseTienda([
      fila("cod_recaudado", "10000.00", "credito"),
      fila("flete", "1000.00", "debito"),
    ]);
    const conPago = derivarDesgloseTienda([
      fila("cod_recaudado", "10000.00", "credito"),
      fila("flete", "1000.00", "debito"),
      fila("pago_tienda", "4000.00", "debito"), // <- lo que insertara la 172
    ]);

    expect(conPago.pagado).toBe("4000.00");
    // Lo que importa: el pago NO se pliega dentro de «cargos». Si lo hiciera, nadie podria
    // distinguir «lo que te cobre» de «lo que ya te pague» mirando la pantalla.
    expect(conPago.cargos).toBe(sinPago.cargos);
    expect(conPago.cargos).toBe("1000.00");
    // Y el saldo baja exactamente lo pagado.
    expect(conPago.saldo).toBe("5000.00");
    expect(sinPago.saldo).toBe("9000.00");
  });

  it("R43: varios pagos se acumulan en `pagado`, sin tocar las otras dos cubetas", () => {
    const d = derivarDesgloseTienda([
      fila("cod_recaudado", "10000.00", "credito"),
      fila("pago_tienda", "6000.00", "debito"),
    ]);
    // El repositorio agrega por (tipo, categoria), asi que varios pagos llegan ya sumados en
    // UNA fila; lo que se comprueba es que esa fila cae entera en `pagado`.
    expect(d).toEqual({
      aFavor: "10000.00",
      cargos: "0.00",
      pagado: "6000.00",
      saldo: "4000.00",
      signo: "positivo",
    });
  });
});

describe("derivarDesgloseTienda vs derivarSaldoTienda — las dos derivaciones cuadran (R11)", () => {
  // Riesgo 2 del design: dos agregaciones sobre la MISMA tabla acaban divergiendo. La tabla de
  // saldos deriva de (creditos, debitos) y la cabecera del desglose de (categoria); si algun
  // dia dejaran de cuadrar, la fila y su desplegable mostrarian saldos distintos.
  const CONJUNTOS: { nombre: string; filas: DesgloseTiendaAgregadoRow[] }[] = [
    {
      nombre: "cierre tipico (COD + los 6 cargos)",
      filas: [
        fila("cod_recaudado", "10000.00", "credito"),
        fila("flete", "1000.00", "debito"),
        fila("flete_devolucion", "400.00", "debito"),
        fila("comision_cod", "500.00", "debito"),
        fila("iva_flete", "130.00", "debito"),
        fila("iva_flete_devolucion", "52.00", "debito"),
        fila("iva_comision_cod", "65.00", "debito"),
      ],
    },
    {
      nombre: "solo devoluciones (saldo negativo)",
      filas: [fila("flete_devolucion", "400.00", "debito"), fila("iva_flete_devolucion", "52.00", "debito")],
    },
    {
      nombre: "con pagos y ajustes (el escenario de la 172)",
      filas: [
        fila("cod_recaudado", "10000.00", "credito"),
        fila("ajuste_credito", "250.00", "credito"),
        fila("flete", "1000.00", "debito"),
        fila("ajuste_debito", "50.00", "debito"),
        fila("pago_tienda", "3000.00", "debito"),
      ],
    },
    { nombre: "sin movimientos", filas: [] },
  ];

  for (const { nombre, filas } of CONJUNTOS) {
    it(`R11: mismo saldo y mismo signo que la tabla de saldos — ${nombre}`, () => {
      const desglose = derivarDesgloseTienda(filas);

      // La otra derivacion, partiendo del MISMO conjunto pero por `tipo` (que es como lo
      // agrega `agregarSaldoPorTienda` para la tabla de saldos).
      const creditos = filas
        .filter((f) => f.tipo === "credito")
        .reduce((s, f) => s + Number(f.total), 0)
        .toFixed(2);
      const debitos = filas
        .filter((f) => f.tipo === "debito")
        .reduce((s, f) => s + Number(f.total), 0)
        .toFixed(2);
      const saldoTabla = derivarSaldoTienda(creditos, debitos);

      expect(desglose.saldo).toBe(saldoTabla.saldo);
      expect(desglose.signo).toBe(saldoTabla.signo);
      // Y la particion en tres cubetas conserva el total de debitos: cargos + pagado.
      expect((Number(desglose.cargos) + Number(desglose.pagado)).toFixed(2)).toBe(debitos);
      expect(desglose.aFavor).toBe(creditos);
    });
  }
});
