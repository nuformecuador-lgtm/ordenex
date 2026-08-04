import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import {
  NATURALEZA_POR_CATEGORIA,
  derivarCaja,
  type NaturalezaMovimiento,
} from "@/lib/utils/caja-tesoreria";
import { derivarBalance } from "@/lib/utils/wallet-balance";
import {
  WALLET_MOVIMIENTO_CATEGORIA_SEED,
  type AgregadoCajaRow,
  type WalletMovimientoCategoria,
  type WalletMovimientoTipo,
} from "@/lib/types/wallet";
import { codigoSinComentarios, LLAMADAS_PROHIBIDAS_EN_DINERO } from "../../fixtures/money-safe";

/**
 * Feature 173 (T A.4) — la derivacion PURA de las dos cifras de la caja.
 * Cubre R1, R2, R3, R4, R5, R6, R7 y R10.
 *
 * Lo que se juega aqui: que ninguna categoria caiga en la naturaleza equivocada por descuido.
 * Una sola mal clasificada no da un error —da una cifra de utilidad que sube cuando alguien
 * corrige un error administrativo—, asi que la clasificacion se comprueba tres veces: por
 * tipos (el `Record` total), recorriendo el SEED en RUNTIME (no basta el typecheck: nadie
 * garantiza que `tsc` corra antes del deploy) y por su EFECTO sobre las dos cifras.
 */

const FUENTE = "lib/utils/caja-tesoreria.ts";

/** El `tipo` con el que la base admite cada categoria (la disyuncion de design §2.2). */
function tipoDe(categoria: WalletMovimientoCategoria): WalletMovimientoTipo {
  return categoria.startsWith("ingreso_") ? "ingreso" : "egreso";
}

function fila(categoria: WalletMovimientoCategoria, total: string): AgregadoCajaRow {
  return { categoria, tipo: tipoDe(categoria), total };
}

describe("NATURALEZA_POR_CATEGORIA — clasificacion exhaustiva (R2/R3)", () => {
  it("R2/R3: TODA categoria del catalogo tiene naturaleza declarada, y el mapa no tiene ninguna de mas", () => {
    // El `Record<WalletMovimientoCategoria, …>` ya rompe el typecheck si el enum gana un valor
    // sin clasificar (R3). Esto lo comprueba tambien en RUNTIME, recorriendo el SEED, y cierra
    // ademas la direccion contraria: una clave en el mapa que ya no exista en el catalogo.
    for (const categoria of WALLET_MOVIMIENTO_CATEGORIA_SEED) {
      expect(NATURALEZA_POR_CATEGORIA[categoria], `categoria ${categoria}`).toBeDefined();
      expect(["propio", "terceros"]).toContain(NATURALEZA_POR_CATEGORIA[categoria]);
    }
    expect(Object.keys(NATURALEZA_POR_CATEGORIA).sort()).toEqual(
      [...WALLET_MOVIMIENTO_CATEGORIA_SEED].sort(),
    );
  });

  it("R2: cada categoria cae en EXACTAMENTE una naturaleza (el mapa es una funcion, no una lista)", () => {
    for (const categoria of WALLET_MOVIMIENTO_CATEGORIA_SEED) {
      const naturaleza: NaturalezaMovimiento = NATURALEZA_POR_CATEGORIA[categoria];
      expect(typeof naturaleza).toBe("string");
      expect(naturaleza === "propio" || naturaleza === "terceros").toBe(true);
    }
  });

  it("R2 (design §2.1): las TRES categorias de tesoreria son de TERCEROS, y ninguna otra lo es", () => {
    // Este es el assert que la mutacion obligatoria de T A.4/T H.3 pone rojo: mover
    // `ingreso_cod_recaudado` a «propio» falla aqui y en los cuatro tests de efecto de abajo.
    const terceros = WALLET_MOVIMIENTO_CATEGORIA_SEED.filter(
      (c) => NATURALEZA_POR_CATEGORIA[c] === "terceros",
    );
    expect([...terceros].sort()).toEqual([
      "egreso_pago_tienda",
      "ingreso_cod_recaudado",
      "ingreso_reverso_pago_tienda",
    ]);
  });

  it("R2/[P2]: `egreso_pago_mensajero` sigue siendo PROPIO (design §3.4, decision del humano)", () => {
    // La caja queda mixta a proposito: tesoreria para el COD y las tiendas, devengo para los
    // mensajeros. Si alguien lo moviera a «terceros» sin rehacer §3.4, la ganancia dejaria de
    // restar el costo del reparto y subiria sola.
    expect(NATURALEZA_POR_CATEGORIA.egreso_pago_mensajero).toBe("propio");
  });

  it("R26 (design §10-C): `ingreso_ajuste` es PROPIO, y por eso NO puede servir de reverso", () => {
    expect(NATURALEZA_POR_CATEGORIA.ingreso_ajuste).toBe("propio");
    expect(NATURALEZA_POR_CATEGORIA.ingreso_reverso_pago_tienda).toBe("terceros");
    // La trampa que la feature evita: si el reverso se emitiera como `ingreso_ajuste`, anular
    // un pago a una tienda SUBIRIA la ganancia de Ordenex por el monto anulado.
    const conReversoCorrecto = derivarCaja([fila("ingreso_reverso_pago_tienda", "4000.00")]);
    const conAjuste = derivarCaja([fila("ingreso_ajuste", "4000.00")]);
    expect(conReversoCorrecto.ganancia).toBe("0.00");
    expect(conAjuste.ganancia).toBe("4000.00");
  });
});

describe("derivarCaja — las dos cifras (R1/R4/R5)", () => {
  it("R4: `enCaja` = entradas − salidas, con TODAS las naturalezas dentro", () => {
    const r = derivarCaja([
      fila("ingreso_cod_recaudado", "10000.00"), // terceros
      fila("ingreso_flete", "1000.00"), // propio
      fila("egreso_pago_tienda", "6000.00"), // terceros
      fila("egreso_sueldo", "500.00"), // propio
    ]);

    expect(r.entradas).toBe("11000.00"); // 10000 + 1000
    expect(r.salidas).toBe("6500.00"); // 6000 + 500
    expect(r.enCaja).toBe("4500.00");
    expect(r.signoEnCaja).toBe("positivo");
  });

  it("R5: `ganancia` = ingresos propios − egresos propios, sobre el MISMO conjunto", () => {
    const r = derivarCaja([
      fila("ingreso_cod_recaudado", "10000.00"),
      fila("ingreso_flete", "1000.00"),
      fila("egreso_pago_tienda", "6000.00"),
      fila("egreso_sueldo", "500.00"),
    ]);

    expect(r.ingresosPropios).toBe("1000.00"); // el COD NO cuenta
    expect(r.egresosPropios).toBe("500.00"); // el pago a la tienda TAMPOCO
    expect(r.ganancia).toBe("500.00");
    expect(r.signoGanancia).toBe("positivo");
  });

  it("R1: sobre un conjunto CON dinero de terceros, las dos cifras son DISTINTAS", () => {
    const r = derivarCaja([
      fila("ingreso_cod_recaudado", "10000.00"),
      fila("ingreso_flete", "1000.00"),
      fila("egreso_pago_tienda", "6000.00"),
      fila("egreso_sueldo", "500.00"),
    ]);

    expect(r.enCaja).not.toBe(r.ganancia);
    expect(r.enCaja).toBe("4500.00");
    expect(r.ganancia).toBe("500.00");
    // Y la diferencia entre ambas es, exactamente, el dinero de terceros que sigue en la caja.
    expect(r.deTerceros).toBe("4000.00"); // 10000 cobrado − 6000 ya entregado
    expect(new Prisma.Decimal(r.ganancia).add(r.deTerceros).toFixed(2)).toBe(r.enCaja);
  });

  it("R2/R5: el contra-entrega ENTRA en la caja y NO roza la ganancia", () => {
    // Efecto medible de la clasificacion: la MISMA base, con y sin el COD.
    const sinCod = derivarCaja([fila("ingreso_flete", "1000.00"), fila("egreso_sueldo", "500.00")]);
    const conCod = derivarCaja([
      fila("ingreso_flete", "1000.00"),
      fila("egreso_sueldo", "500.00"),
      fila("ingreso_cod_recaudado", "10000.00"),
    ]);

    expect(conCod.ganancia).toBe(sinCod.ganancia); // <- mutacion obligatoria: rojo si es «propio»
    expect(conCod.ganancia).toBe("500.00");
    expect(conCod.enCaja).toBe("10500.00");
    expect(sinCod.enCaja).toBe("500.00");
  });

  it("R26/R30: pagar a la tienda y anular deja el dinero en caja igual y la ganancia intacta", () => {
    const antes = [fila("ingreso_cod_recaudado", "10000.00"), fila("ingreso_flete", "1000.00")];
    const trasPagar = [...antes, fila("egreso_pago_tienda", "6000.00")];
    const trasAnular = [...trasPagar, fila("ingreso_reverso_pago_tienda", "6000.00")];

    const a = derivarCaja(antes);
    const b = derivarCaja(trasPagar);
    const c = derivarCaja(trasAnular);

    expect(b.enCaja).toBe("5000.00");
    expect(c.enCaja).toBe(a.enCaja); // el dinero vuelve EXACTAMENTE al importe previo
    expect(c.enCaja).toBe("11000.00");
    // Y la ganancia es identica en los TRES momentos: anular no es ingresar.
    expect(a.ganancia).toBe("1000.00");
    expect(b.ganancia).toBe("1000.00");
    expect(c.ganancia).toBe("1000.00");
  });

  it("R4/R5: signos NEGATIVO y CERO, en las dos cifras", () => {
    const negativa = derivarCaja([
      fila("egreso_gasto_fijo", "300.00"),
      fila("ingreso_flete", "100.00"),
    ]);
    expect(negativa.enCaja).toBe("-200.00");
    expect(negativa.signoEnCaja).toBe("negativo");
    expect(negativa.ganancia).toBe("-200.00");
    expect(negativa.signoGanancia).toBe("negativo");

    const enCero = derivarCaja([
      fila("ingreso_cod_recaudado", "700.00"),
      fila("egreso_pago_tienda", "700.00"),
    ]);
    expect(enCero.enCaja).toBe("0.00");
    expect(enCero.signoEnCaja).toBe("cero");
    expect(enCero.ganancia).toBe("0.00");
    expect(enCero.signoGanancia).toBe("cero");
    // El dinero de terceros entro y salio entero: la tercera linea queda en cero.
    expect(enCero.deTerceros).toBe("0.00");
  });

  it("conjunto VACIO -> los importes en 0.00 y los dos signos en cero (no un hueco)", () => {
    expect(derivarCaja([])).toEqual({
      entradas: "0.00",
      salidas: "0.00",
      enCaja: "0.00",
      signoEnCaja: "cero",
      ingresosPropios: "0.00",
      egresosPropios: "0.00",
      ganancia: "0.00",
      signoGanancia: "cero",
      deTerceros: "0.00",
      periodoFiltrado: false,
    });
  });

  it("acumula VARIAS filas del mismo tipo sin perder ninguna", () => {
    const r = derivarCaja([
      fila("ingreso_flete", "300.00"),
      fila("ingreso_comision_cod", "150.00"),
      fila("ingreso_iva_flete", "39.00"),
      fila("ingreso_cod_recaudado", "5000.00"),
      fila("egreso_pago_mensajero", "200.00"),
      fila("egreso_gasto_variable", "50.00"),
      fila("egreso_pago_tienda", "1000.00"),
    ]);

    expect(r.entradas).toBe("5489.00"); // 300 + 150 + 39 + 5000
    expect(r.salidas).toBe("1250.00"); // 200 + 50 + 1000
    expect(r.ingresosPropios).toBe("489.00"); // 300 + 150 + 39
    expect(r.egresosPropios).toBe("250.00"); // 200 + 50 (el pago a tienda es de terceros)
    expect(r.enCaja).toBe("4239.00");
    expect(r.ganancia).toBe("239.00");
    expect(r.deTerceros).toBe("4000.00"); // 5000 − 1000
  });
});

describe("derivarCaja — sin dinero de terceros, las dos cifras COINCIDEN (R6)", () => {
  // Es la retrocompatibilidad conceptual de la feature: hoy no existe ni una fila de terceros,
  // asi que el numero que el maestro lleva viendo desde la 42 no cambia de VALOR, cambia de
  // NOMBRE. La cifra que aparece de cero es la otra.
  const SOLO_PROPIAS = WALLET_MOVIMIENTO_CATEGORIA_SEED.filter(
    (c) => NATURALEZA_POR_CATEGORIA[c] === "propio",
  );

  it("R6: un conjunto con TODAS las categorias propias del catalogo da enCaja === ganancia", () => {
    const filas = SOLO_PROPIAS.map((c, i) => fila(c, `${(i + 1) * 100}.00`));
    const r = derivarCaja(filas);

    expect(r.enCaja).toBe(r.ganancia);
    expect(r.signoEnCaja).toBe(r.signoGanancia);
    expect(r.entradas).toBe(r.ingresosPropios);
    expect(r.salidas).toBe(r.egresosPropios);
    expect(r.deTerceros).toBe("0.00");
  });

  it("R6/R9: sobre un conjunto sin terceros, `ganancia` es lo que hoy devuelve `derivarBalance`", () => {
    const filas = SOLO_PROPIAS.map((c, i) => fila(c, `${(i + 1) * 100}.00`));
    const r = derivarCaja(filas);
    const balanceDeSiempre = derivarBalance(r.entradas, r.salidas);

    expect(r.ganancia).toBe(balanceDeSiempre.balance);
    expect(r.signoGanancia).toBe(balanceDeSiempre.signo);
    expect(r.enCaja).toBe(balanceDeSiempre.balance);
  });

  it("R6: basta UNA fila de terceros para que las dos cifras se separen", () => {
    const propias = [fila("ingreso_flete", "1000.00"), fila("egreso_sueldo", "400.00")];
    expect(derivarCaja(propias).enCaja).toBe(derivarCaja(propias).ganancia);

    const conUnaDeTerceros = [...propias, fila("ingreso_cod_recaudado", "0.01")];
    const r = derivarCaja(conUnaDeTerceros);
    expect(r.enCaja).not.toBe(r.ganancia);
    expect(r.enCaja).toBe("600.01");
    expect(r.ganancia).toBe("600.00");
  });
});

describe("derivarCaja — money-safe y frontera (R7/R10)", () => {
  it("R7: los nueve importes son STRING con DOS decimales, siempre", () => {
    const r = derivarCaja([
      fila("ingreso_cod_recaudado", "7"), // sin decimales en la entrada
      fila("ingreso_flete", "1.5"), // un solo decimal
      fila("egreso_pago_tienda", "2"),
    ]);

    for (const clave of [
      "entradas",
      "salidas",
      "enCaja",
      "ingresosPropios",
      "egresosPropios",
      "ganancia",
      "deTerceros",
    ] as const) {
      expect(typeof r[clave], clave).toBe("string");
      expect(r[clave], clave).toMatch(/^-?\d+\.\d{2}$/);
    }
    expect(r.entradas).toBe("8.50");
    expect(r.enCaja).toBe("6.50");
    expect(r.ganancia).toBe("1.50");
    expect(r.deTerceros).toBe("5.00");
  });

  it("R7: el signo es EXPLICITO y solo puede ser uno de los tres valores", () => {
    const r = derivarCaja([fila("ingreso_flete", "1.00")]);
    expect(["positivo", "negativo", "cero"]).toContain(r.signoEnCaja);
    expect(["positivo", "negativo", "cero"]).toContain(r.signoGanancia);
  });

  it("R7: money-safe — 0.10 + 0.20 da 0.30 exacto, no 0.30000000000000004", () => {
    const r = derivarCaja([
      fila("ingreso_flete", "0.10"),
      fila("ingreso_comision_cod", "0.20"),
      fila("egreso_sueldo", "0.30"),
    ]);
    expect(r.entradas).toBe("0.30");
    expect(r.enCaja).toBe("0.00");
    expect(r.signoEnCaja).toBe("cero");
  });

  it("R7: money-safe — un importe fuera del rango exacto de un double no pierde centavos", () => {
    const r = derivarCaja([fila("ingreso_cod_recaudado", "98765432109.87")]);
    expect(r.entradas).toBe("98765432109.87");
    expect(r.enCaja).toBe("98765432109.87");
    expect(r.ganancia).toBe("0.00");
  });

  it("R7: el modulo NO tiene ni una llamada capaz de convertir un monto a numero", () => {
    const fuente = codigoSinComentarios(FUENTE);
    for (const prohibida of LLAMADAS_PROHIBIDAS_EN_DINERO) {
      expect(fuente, `${FUENTE} llama a ${prohibida}`).not.toMatch(prohibida);
    }
  });

  it("R10: es PURA — la firma solo admite las filas ya agregadas, ni repositorio ni cliente", () => {
    // Un solo parametro OBLIGATORIO (las opciones de presentacion tienen default), salida
    // sincrona: no hay por donde colarle una base de datos.
    expect(derivarCaja.length).toBe(1);
    expect(derivarCaja([]) instanceof Promise).toBe(false);

    const fuente = codigoSinComentarios(FUENTE);
    for (const prohibido of [
      "PrismaClient",
      "Repository",
      "prisma.",
      "findMany",
      "groupBy",
      "await ",
      "async ",
    ]) {
      expect(fuente, `${FUENTE} nombra ${prohibido}`).not.toContain(prohibido);
    }
  });

  it("R10: no muta la entrada ni depende del orden de las filas", () => {
    const filas: AgregadoCajaRow[] = [
      fila("ingreso_cod_recaudado", "10000.00"),
      fila("egreso_pago_tienda", "6000.00"),
      fila("ingreso_flete", "1000.00"),
    ];
    const copia = structuredClone(filas);

    const enOrden = derivarCaja(filas);
    const alReves = derivarCaja([...filas].reverse());

    expect(filas).toEqual(copia);
    expect(alReves).toEqual(enOrden);
  });

  it("[P7]: `periodoFiltrado` es false por defecto y no toca ningun numero", () => {
    const filas = [fila("ingreso_cod_recaudado", "10000.00"), fila("egreso_pago_tienda", "6000.00")];
    const sinFiltros = derivarCaja(filas);
    const conFiltros = derivarCaja(filas, { periodoFiltrado: true });

    expect(sinFiltros.periodoFiltrado).toBe(false);
    expect(conFiltros.periodoFiltrado).toBe(true);
    // El rotulo cambia; el numero NO.
    expect({ ...conFiltros, periodoFiltrado: false }).toEqual(sinFiltros);
  });
});
