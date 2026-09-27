// FICHA 449 (G) — GUARDIA: EL FULFILLMENT NO PUEDE ENTRAR EN LA FORMULA DEL DINERO.
//
// ─── QUE PROTEGE, Y POR QUE ES ESTE EL TEST QUE IMPORTA DENTRO DE SEIS MESES ─────────────────
//
// La 449 hace que el fulfillment congelado VIAJE hasta Analitica. La forma OBVIA de conseguirlo
// —y la que alguien va a intentar el dia que haga falta en otra pantalla— es meterlo en
// `TarifaVigente`, que es donde ya viven las otras nueve columnas congeladas. Eso esta
// PROHIBIDO POR ESCRITO desde el 2026-08-19 en `ITarifaVigenteRepository`:
//
//   «Meterlo alli lo pondria al alcance de `derivarIngresoOrden`, y esa funcion decide dinero
//    que se liquida.»
//
// El peligro no es teorico y no es abstracto: `derivarIngresoOrden` produce los importes que se
// escriben en las wallets al aprobar un cierre. Un concepto de mas ahi dentro no revienta nada
// —la firma no cambia, ningun test de pantalla se entera— y empieza a cobrar. Es un fallo MUDO
// en el sitio mas caro del sistema.
//
// Por eso la cifra viaja por un CAMPO APARTE (`FilaDineroCruda.fulfillment`), leido de la
// COLUMNA `cierre_detail.tarifa_fulfillment`, y esta guardia vigila que siga siendo asi.
//
// ─── LAS CUATRO MITADES, Y QUE APORTA CADA UNA ──────────────────────────────────────────────
//
//  (a) EN EJECUCION. `tarifaDe` recibe una fila que SI trae el fulfillment y lo que devuelve NO
//      lo contiene. Es la comprobacion mas fuerte: no depende de como este escrito el fuente.
//  (b) EN EL CONTRATO. El cuerpo de `interface TarifaVigente` no lo nombra. Con ANTI-VACIO: el
//      mismo predicado SI lo encuentra en `TarifaVigenteResuelta`, que es donde vive legalmente.
//  (c) EN EL CAMINO. El repositorio de Analitica proyecta la columna (o sea, la ficha esta
//      hecha) y NO se la pasa a `tarifaDe`.
//  (d) EN LA CIFRA. `cifrasDelGrupo` emite el fulfillment FUERA de `liquidado.ordenex`, y R20
//      —`ordenex + tienda === liquidado.recaudado`— sigue siendo exacta con un fulfillment > 0.
//
//  (e) AUTOCOMPROBACION. Los predicados se aplican ademas a material sintetico que SI infringe,
//      y tienen que detectarlo. Sin esto una guardia queda verde POR VACIO —encuentra cero
//      infracciones porque no busca nada— que es el modo de fallo que este arbol ya se comio.
import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";

import { tarifaDe } from "@/lib/utils/cierre-detalle";
import { derivarIngresoOrden } from "@/lib/utils/ingreso-ordenex";
import { cifrasDelGrupo, ordenesQueAportan } from "@/lib/services/ConteoProductosService";
import { codigoSinComentarios } from "../../fixtures/sin-comentarios";
import { filaDinero } from "./_dinero-falso";

/** Cualquier forma de nombrar el fulfillment, en camelCase o en snake_case. */
const NOMBRA_FULFILLMENT = /fulfillment/i;

/**
 * El cuerpo de una `interface` del fuente, por su nombre. Devuelve `null` si no existe, y el
 * `null` se AFIRMA en cada caso: si alguien renombra el tipo, esta guardia tiene que ponerse
 * roja en vez de dar por buena una busqueda que no encontro nada.
 */
function cuerpoDeInterfaz(codigo: string, nombre: string): string | null {
  const inicio = codigo.indexOf(`interface ${nombre} `);
  if (inicio === -1) return null;
  const abre = codigo.indexOf("{", inicio);
  if (abre === -1) return null;
  let profundidad = 0;
  for (let i = abre; i < codigo.length; i += 1) {
    if (codigo[i] === "{") profundidad += 1;
    else if (codigo[i] === "}") {
      profundidad -= 1;
      if (profundidad === 0) return codigo.slice(abre + 1, i);
    }
  }
  return null;
}

/** La lista de argumentos de una llamada `nombre(` del fuente, con sus parentesis casados. */
function argumentosDeLlamada(codigo: string, nombre: string): string | null {
  const inicio = codigo.indexOf(`${nombre}(`);
  if (inicio === -1) return null;
  const abre = codigo.indexOf("(", inicio);
  let profundidad = 0;
  for (let i = abre; i < codigo.length; i += 1) {
    if (codigo[i] === "(") profundidad += 1;
    else if (codigo[i] === ")") {
      profundidad -= 1;
      if (profundidad === 0) return codigo.slice(abre + 1, i);
    }
  }
  return null;
}

/** La fila congelada de `cierre_detail` que `tarifaDe` sabe leer, CON el fulfillment puesto. */
const FILA_CONGELADA = {
  tarifaId: "tar-1",
  tarifaValorFlete: new Prisma.Decimal("3000"),
  tarifaValorFleteGam: new Prisma.Decimal("2500"),
  tarifaValorFleteDevuelto: new Prisma.Decimal("2000"),
  tarifaValorFleteDevueltoGam: new Prisma.Decimal("1800"),
  tarifaComisionCod: new Prisma.Decimal("5"),
  tarifaIvaFlete: new Prisma.Decimal("13"),
  tarifaIvaComisionCod: new Prisma.Decimal("13"),
  tarifaEspecial: null,
  tarifaEspecialDevuelta: null,
  // La columna que la 449 hace viajar. `tarifaDe` recibe la fila entera —es un `Pick` de la fila
  // de Prisma, y una fila real la trae— y aun asi NO la puede devolver.
  tarifaFulfillment: new Prisma.Decimal("696"),
} as never;

describe("(a) EN EJECUCION · `tarifaDe` no devuelve el fulfillment ni teniendolo delante", () => {
  it("la `TarifaVigente` reconstruida NO tiene ninguna clave que lo nombre", () => {
    const tarifa = tarifaDe(FILA_CONGELADA);
    expect(tarifa, "`tarifaDe` devolvio null: la fila de prueba dejo de ser valida").not.toBeNull();
    const claves = Object.keys(tarifa as object);
    expect(claves.filter((k) => NOMBRA_FULFILLMENT.test(k))).toEqual([]);
    // ANTI-VACIO: no es que el objeto venga vacio. Trae sus nueve entradas de siempre.
    expect(claves.sort()).toEqual(
      [
        "comisionCod",
        "ivaComisionCod",
        "ivaFlete",
        "tarifaEspecial",
        "tarifaEspecialDevuelta",
        "valorFlete",
        "valorFleteDevuelto",
        "valorFleteDevueltoGam",
        "valorFleteGam",
      ].sort(),
    );
  });

  it("(e) AUTOCOMPROBACION · el mismo predicado SI detecta una tarifa contaminada", () => {
    const contaminada = { ...(tarifaDe(FILA_CONGELADA) as object), fulfillment: "696.00" };
    expect(Object.keys(contaminada).filter((k) => NOMBRA_FULFILLMENT.test(k))).toEqual([
      "fulfillment",
    ]);
  });

  it("y `derivarIngresoOrden` no cobra nada por el, ni aunque llegue de polizon", () => {
    // El escenario exacto que la prohibicion describe: alguien mete el monto dentro de la tarifa
    // y la formula lo alcanza. Aqui se FUERZA y se mide que el ingreso NO se mueve — si algun
    // dia se moviera, este caso se pone rojo y dira por que.
    const entrada = {
      resultado: "entregado" as const,
      esCentral: false,
      esZonaEspecial: false,
      montoCobrar: "10000.00",
      cobraComision: true,
    };
    const limpia = tarifaDe(FILA_CONGELADA);
    const conPolizon = { ...(limpia as object), fulfillment: "696.00" } as never;

    const sumar = (d: ReturnType<typeof derivarIngresoOrden>): string => {
      let total = new Prisma.Decimal(0);
      for (const v of Object.values(d)) if (v !== undefined) total = total.plus(v);
      return total.toFixed(2);
    };
    const sinPolizon = sumar(derivarIngresoOrden(entrada, limpia));
    expect(sumar(derivarIngresoOrden(entrada, conPolizon))).toBe(sinPolizon);
    // Y el numero es el de siempre, escrito A MANO: 3000 + 390 + 500 + 65.
    expect(sinPolizon).toBe("3955.00");
  });
});

describe("(b) EN EL CONTRATO · `TarifaVigente` no lo declara, y `TarifaVigenteResuelta` si", () => {
  const RUTA = "lib/interfaces/repositories/ITarifaVigenteRepository.ts";

  it("el cuerpo de `interface TarifaVigente` no nombra el fulfillment", () => {
    // Se lee SIN comentarios: la prosa de ese archivo lo nombra a proposito —es donde esta
    // escrita la prohibicion— y un barrido sobre el texto crudo denunciaria la explicacion.
    const cuerpo = cuerpoDeInterfaz(codigoSinComentarios(RUTA), "TarifaVigente");
    expect(cuerpo, "no se encontro `interface TarifaVigente`: ¿la renombraron?").not.toBeNull();
    expect(NOMBRA_FULFILLMENT.test(cuerpo as string)).toBe(false);
    // ANTI-VACIO: el cuerpo que se leyo es el de verdad, con sus campos dentro.
    expect(cuerpo as string).toContain("valorFlete");
    expect(cuerpo as string).toContain("comisionCod");
  });

  it("(e) ANTI-VACIO · el mismo lector SI lo encuentra donde el fulfillment SI vive", () => {
    // `TarifaVigenteResuelta` es el camino del SNAPSHOT y ahi el fulfillment es legal desde el
    // 2026-08-19. Si este caso se pusiera verde «porque no encuentra nada», el de arriba no
    // estaria midiendo nada tampoco.
    const cuerpo = cuerpoDeInterfaz(codigoSinComentarios(RUTA), "TarifaVigenteResuelta");
    expect(cuerpo, "no se encontro `interface TarifaVigenteResuelta`").not.toBeNull();
    expect(NOMBRA_FULFILLMENT.test(cuerpo as string)).toBe(true);
  });

  it("`tarifaDe` y `TarifaCongeladaRow` tampoco lo nombran en su fuente", () => {
    const codigo = codigoSinComentarios("lib/utils/cierre-detalle.ts");
    expect(NOMBRA_FULFILLMENT.test(codigo)).toBe(false);
    // ANTI-VACIO: es el archivo correcto y se leyo entero.
    expect(codigo).toContain("export function tarifaDe");
    expect(codigo).toContain("TarifaCongeladaRow");
  });
});

describe("(c) EN EL CAMINO · el repositorio la proyecta, pero no se la pasa a `tarifaDe`", () => {
  const codigo = codigoSinComentarios("lib/repositories/DineroProductosRepository.ts");

  it("PROYECTA `tarifa_fulfillment` y la emite en su campo propio (la ficha esta hecha)", () => {
    // Esta mitad es la que se pone roja si alguien REVIERTE la 449. Sin ella, la guardia
    // protegeria un invariante sobre una cifra que ya no viaja.
    expect(codigo).toContain('d."tarifa_fulfillment"');
    expect(codigo).toContain("fulfillment: fulfillmentDe(f)");
  });

  it("y la llamada a `tarifaDe(...)` NO incluye el fulfillment entre sus argumentos", () => {
    const argumentos = argumentosDeLlamada(codigo, "tarifaDe");
    expect(argumentos, "no se encontro la llamada a `tarifaDe`").not.toBeNull();
    expect(NOMBRA_FULFILLMENT.test(argumentos as string)).toBe(false);
    // ANTI-VACIO: se leyeron los argumentos de verdad, con las nueve columnas dentro.
    expect(argumentos as string).toContain("tarifaValorFlete");
    expect(argumentos as string).toContain("tarifaEspecialDevuelta");
  });

  it("(e) AUTOCOMPROBACION · el lector de argumentos SI caza una llamada contaminada", () => {
    const sintetico = "tarifa: tarifaDe({ tarifaId: x, tarifaFulfillment: f.tarifa_fulfillment })";
    const argumentos = argumentosDeLlamada(sintetico, "tarifaDe");
    expect(NOMBRA_FULFILLMENT.test(argumentos as string)).toBe(true);
  });
});

describe("(d) EN LA CIFRA · el fulfillment va FUERA del reparto, y R20 sigue exacta", () => {
  it("no esta dentro de `liquidado.ordenex`, y `ordenex + tienda === liquidado.recaudado`", () => {
    const cifras = cifrasDelGrupo(
      ordenesQueAportan([filaDinero({ ordenId: "o1", fulfillment: "696.00" })]),
    );

    // El fulfillment se emite, y es el que se sembro.
    expect(cifras.fulfillment).toBe("696.00");
    // Pero NO esta dentro de `ordenex`: ese sigue valiendo 3.955,00, escrito A MANO
    // (3000 + 390 + 500 + 65). Si alguien lo sumara, valdria 4.651,00.
    expect(cifras.liquidado.ordenex).toBe("3955.00");
    expect(cifras.liquidado.ordenex).not.toBe("4651.00");
    // Y R20 sigue siendo EXACTA, que es la invariante que su suma romperia en silencio.
    expect(
      new Prisma.Decimal(cifras.liquidado.ordenex as string)
        .plus(cifras.liquidado.tienda as string)
        .toFixed(2),
    ).toBe(cifras.liquidado.recaudado);
  });
});
