import { describe, it, expect } from "vitest";
import {
  NOMBRE_SIN_PRODUCTO,
  construirModeloPicking,
  contarPorTienda,
  diasEnPreparacion,
  estaAtrasada,
  nombreArchivoPicking,
} from "@/lib/whatsapp-envios/informes/picking/modelo";
import type { FilaPicking } from "@/lib/whatsapp-envios/informes/picking/tipos";

// Ficha 476 (T2.2) — el modelo PURO del picking: R10-R15, R18, R23, R25-R28.

const UN_DIA = 24 * 60 * 60 * 1000;
/** Lunes 5 de octubre de 2026, 06:30 hora de Costa Rica. */
const AHORA = new Date("2026-10-05T12:30:00.000Z");

let n = 0;
function fila(producto: string, o: Partial<FilaPicking> = {}): FilaPicking {
  n += 1;
  return {
    ordenId: `o-${n}`,
    numRemision: `NA-${n}`,
    numGuia: null,
    producto,
    entrada: new Date(AHORA.getTime() - UN_DIA),
    ...o,
  };
}

function modelo(filas: FilaPicking[], diasAtraso = 2, tienda = "Gameos") {
  return construirModeloPicking(filas, { ahora: AHORA, diasAtraso, tienda });
}

describe("476/R10 — interpretacion del producto con el parser de la 345", () => {
  it("«2 * Crema X» son 2 unidades; «Crema X» sin marcador es 1", () => {
    const m = modelo([fila("2 * Crema X"), fila("Crema X")]);
    expect(m.grupos).toHaveLength(1);
    expect(m.grupos[0]).toMatchObject({ nombre: "Crema X", unidades: 3 });
    expect(m.grupos[0].ordenes.map((o) => o.cantidad)).toEqual([2, 1]);
  });

  it("«1 * Base Dr. 1 * BASE C.» son DOS productos (parte por el marcador, no por el punto)", () => {
    const m = modelo([fila("1 * Base Dr. 1 * BASE C.")]);
    expect(m.grupos.map((g) => g.nombre).sort()).toEqual(["BASE C", "Base Dr"]);
    expect(m.totales).toMatchObject({ ordenes: 1, unidades: 2, productos: 2 });
  });

  it("mayusculas, espacios repetidos y puntos finales no distinguen productos (clave de la 345)", () => {
    const m = modelo([fila("1 * Crema  X."), fila("1 * crema x")]);
    expect(m.grupos).toHaveLength(1);
    expect(m.grupos[0].unidades).toBe(2);
  });
});

describe("476/R11 — el mismo producto dos veces en UNA orden", () => {
  it("«2 * Base C. 1 * base c.» → 3 unidades y la orden cuenta UNA vez en ese producto", () => {
    const f = fila("2 * Base C. 1 * base c.");
    const m = modelo([f]);
    expect(m.grupos).toHaveLength(1);
    expect(m.grupos[0].unidades).toBe(3);
    expect(m.grupos[0].ordenes).toEqual([expect.objectContaining({ ordenId: f.ordenId, cantidad: 3 })]);
  });
});

describe("476/R12 — forma visible", () => {
  it("gana la forma escrita en MAS ordenes", () => {
    const m = modelo([fila("1 * BASE C"), fila("1 * BASE C"), fila("1 * Base C.")]);
    expect(m.grupos[0].nombre).toBe("BASE C");
  });

  it("empate → la menor por unidades de codigo (mayusculas antes que minusculas)", () => {
    const m = modelo([fila("1 * Base C"), fila("1 * BASE C")]);
    expect(m.grupos[0].nombre).toBe("BASE C");
    const m2 = modelo([fila("1 * BASE C"), fila("1 * Base C")]);
    expect(m2.grupos[0].nombre).toBe("BASE C");
  });
});

describe("476/R13 — orden sin producto interpretable", () => {
  it("cuenta en ordenes, con 0 unidades, en la fila «Sin producto indicado» (al final) y no en productos", () => {
    const vacia = fila("   ");
    const m = modelo([fila("5 * Crema X"), vacia]);
    expect(m.grupos.map((g) => g.nombre)).toEqual(["Crema X", NOMBRE_SIN_PRODUCTO]);
    const sin = m.grupos[1];
    expect(sin).toMatchObject({ clave: null, unidades: 0 });
    expect(sin.ordenes).toEqual([expect.objectContaining({ ordenId: vacia.ordenId, cantidad: 0 })]);
    expect(m.totales).toEqual({ ordenes: 2, unidades: 5, productos: 1, atrasadas: 0 });
  });
});

describe("476/R14 — dias en preparacion en calendario de Costa Rica", () => {
  it("entrada ayer a las 23:50 CR → 1 dia aunque hayan pasado menos de 24 h", () => {
    expect(diasEnPreparacion(new Date("2026-10-05T05:50:00.000Z"), AHORA)).toBe(1);
  });

  it("frontera de medianoche CR (06:00 UTC): 00:00 CR de hoy → 0; 23:59:59 CR de ayer → 1", () => {
    expect(diasEnPreparacion(new Date("2026-10-05T06:00:00.000Z"), AHORA)).toBe(0);
    expect(diasEnPreparacion(new Date("2026-10-05T05:59:59.000Z"), AHORA)).toBe(1);
  });

  it("el modelo pone esos dias en cada orden", () => {
    const f = fila("1 * X", { entrada: new Date("2026-10-02T15:00:00.000Z") });
    expect(modelo([f]).grupos[0].ordenes[0].dias).toBe(3);
  });
});

describe("476/R15 — atrasada = MAS de N dias", () => {
  it("N=2: 2 dias no, 3 dias si", () => {
    expect(estaAtrasada(2, 2)).toBe(false);
    expect(estaAtrasada(3, 2)).toBe(true);
    const dos = fila("1 * X", { entrada: new Date(AHORA.getTime() - 2 * UN_DIA) });
    const tres = fila("1 * X", { entrada: new Date(AHORA.getTime() - 3 * UN_DIA) });
    const m = modelo([dos, tres], 2);
    expect(m.grupos[0].ordenes.map((o) => [o.dias, o.atrasada])).toEqual([
      [2, false],
      [3, true],
    ]);
    expect(m.totales.atrasadas).toBe(1);
    expect(m.atrasadas.map((a) => a.ordenId)).toEqual([tres.ordenId]);
  });

  it("R19: lista de atrasadas de mas a menos dias; empate en el orden natural de las filas", () => {
    const a = fila("1 * X", { entrada: new Date(AHORA.getTime() - 4 * UN_DIA) });
    const b = fila("1 * Y", { entrada: new Date(AHORA.getTime() - 6 * UN_DIA) });
    const c = fila("1 * Z", { entrada: new Date(AHORA.getTime() - 4 * UN_DIA) });
    const m = modelo([a, b, c], 2);
    expect(m.atrasadas.map((x) => [x.ordenId, x.dias])).toEqual([
      [b.ordenId, 6],
      [a.ordenId, 4],
      [c.ordenId, 4],
    ]);
  });
});

describe("476/R17 — orden de los productos", () => {
  it("unidades desc; empate, nombre asc por unidades de codigo", () => {
    const m = modelo([fila("1 * b"), fila("3 * Zeta"), fila("1 * a"), fila("1 * B2")]);
    expect(m.grupos.map((g) => g.nombre)).toEqual(["Zeta", "B2", "a", "b"]);
  });

  it("las remisiones dentro de un producto siguen el orden de las filas (natural de remision)", () => {
    const f1 = fila("1 * X", { numRemision: "NA-107" });
    const f2 = fila("1 * X", { numRemision: "NA-1069" });
    expect(modelo([f1, f2]).grupos[0].ordenes.map((o) => o.identificador)).toEqual(["NA-107", "NA-1069"]);
  });
});

describe("476/R18 — identificador", () => {
  it("sin guia → la remision; con guia → «R (guía N)»", () => {
    const m = modelo([fila("1 * X", { numRemision: "GM-1" }), fila("1 * X", { numRemision: "GM-2", numGuia: 48127 })]);
    expect(m.grupos[0].ordenes.map((o) => o.identificador)).toEqual(["GM-1", "GM-2 (guía 48127)"]);
  });
});

describe("476/R23 — nombre del PDF", () => {
  it("«Gameos» → picking-gameos-2026-10-05.pdf", () => {
    expect(nombreArchivoPicking("Gameos", AHORA)).toBe("picking-gameos-2026-10-05.pdf");
  });

  it("«Ñandú Más» → sin diacriticos, en minusculas y con guiones", () => {
    expect(nombreArchivoPicking("  Ñandú   Más!! ", AHORA)).toBe("picking-nandu-mas-2026-10-05.pdf");
  });

  it("23:30 CR (ya el dia siguiente en UTC) usa la fecha de Costa Rica", () => {
    expect(nombreArchivoPicking("Gameos", new Date("2026-10-06T05:30:00.000Z"))).toBe("picking-gameos-2026-10-05.pdf");
  });

  it("una tienda sin ningun caracter util → «tienda»", () => {
    expect(nombreArchivoPicking("😀", AHORA)).toBe("picking-tienda-2026-10-05.pdf");
  });
});

describe("476/R25-R28 — valores", () => {
  it("las 10 variables, un dato cada una, ninguna vacia, iguales a los totales del modelo", () => {
    const filas = [
      fila("2 * Crema X", { numRemision: "BS-3" }),
      fila("1 * Base", { numRemision: "NA-107", entrada: new Date(AHORA.getTime() - 5 * UN_DIA) }),
      fila("", { numRemision: "NA-1069" }),
    ];
    const m = modelo(filas, 2, "Gameos");
    expect(m.valores).toEqual({
      tienda: "Gameos",
      ordenes: "3",
      unidades: "3",
      productos: "2",
      atrasadas: "1",
      dias_atraso: "2",
      remision_desde: "BS-3",
      remision_hasta: "NA-1069",
      fecha: "05/10/2026",
      hora: "06:30",
    });
    expect(m.valores.ordenes).toBe(String(m.totales.ordenes));
    expect(m.valores.unidades).toBe(String(m.totales.unidades));
    expect(m.valores.productos).toBe(String(m.totales.productos));
    expect(m.valores.atrasadas).toBe(String(m.totales.atrasadas));
  });

  it("R28: 2026-10-06T05:30Z es 05/10/2026 23:30 en Costa Rica", () => {
    const m = construirModeloPicking([fila("1 * X")], { ahora: new Date("2026-10-06T05:30:00.000Z"), diasAtraso: 2, tienda: "G" });
    expect(m.valores.fecha).toBe("05/10/2026");
    expect(m.valores.hora).toBe("23:30");
  });
});

describe("476/R3 — el conteo del selector usa LA MISMA definicion de atrasada que el modelo", () => {
  it("contarPorTienda = totales del modelo sobre las mismas filas, para varios N", () => {
    const filas = [0, 1, 2, 3, 4, 7, 12].map((d) =>
      fila("1 * X", { entrada: new Date(AHORA.getTime() - d * UN_DIA - 3 * 60 * 60 * 1000) }),
    );
    for (const N of [1, 2, 3, 5, 10, 30]) {
      const c = contarPorTienda(
        filas.map((f) => ({ tiendaId: "t1", entrada: f.entrada })),
        AHORA,
        N,
      ).get("t1");
      const m = modelo(filas, N);
      expect(c).toEqual({ ordenes: m.totales.ordenes, atrasadas: m.totales.atrasadas });
    }
  });
});
