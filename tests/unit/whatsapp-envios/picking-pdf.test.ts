import { describe, it, expect } from "vitest";
import {
  ROTULOS_HELVETICA,
  maquetarPicking,
  renderizarPicking,
  type MedirTexto,
  type OpPdf,
} from "@/lib/whatsapp-envios/informes/picking/pdf";
import { construirModeloPicking } from "@/lib/whatsapp-envios/informes/picking/modelo";
import type { FilaPicking } from "@/lib/whatsapp-envios/informes/picking/tipos";
import { fuenteEtiqueta } from "@/lib/pdf/etiquetas-fuente";
import { cubreTexto, seguroEnFuenteEstandar } from "@/lib/pdf/etiquetas-fuente-registro";

// Ficha 476 (T2.3) — el PDF del picking sobre su MAQUETA (operaciones por pagina): R16, R17, R19-R22.
// Mas un humo del PDF real con jsPDF: bytes `%PDF` y numero de paginas = el de la maqueta.

const UN_DIA = 24 * 60 * 60 * 1000;
const AHORA = new Date("2026-10-05T12:30:00.000Z"); // lunes 5 oct 2026, 06:30 CR

/** Medida determinista: ancho proporcional al numero de caracteres y al tamaño. */
const medir: MedirTexto = (t, tam) => [...t].length * tam * 0.18;

let n = 0;
function fila(producto: string, o: Partial<FilaPicking> = {}): FilaPicking {
  n += 1;
  return { ordenId: `o-${n}`, numRemision: `NA-${n}`, numGuia: null, producto, entrada: new Date(AHORA.getTime() - UN_DIA), ...o };
}

function maqueta(filas: FilaPicking[], diasAtraso = 2, tienda = "Gameos") {
  const modelo = construirModeloPicking(filas, { ahora: AHORA, diasAtraso, tienda });
  return { modelo, m: maquetarPicking(modelo, medir) };
}

type Texto = Extract<OpPdf, { tipo: "texto" }>;
const textos = (ops: OpPdf[]): Texto[] => ops.filter((o): o is Texto => o.tipo === "texto");
const deRol = (ops: OpPdf[], rol: Texto["rol"]): string[] => textos(ops).filter((t) => t.rol === rol).map((t) => t.texto);
const todas = (paginas: OpPdf[][]): OpPdf[] => paginas.flat();

describe("476/R16 — encabezado", () => {
  it("tienda, fecha larga, hora «· hora de Costa Rica», cifras de ordenes y unidades", () => {
    const { m } = maqueta([fila("2 * Crema X"), fila("1 * Base"), fila("3 * Crema X")]);
    const p1 = m.paginas[0];
    expect(deRol(p1, "tienda")).toEqual(["Gameos"]);
    expect(deRol(p1, "fecha")).toEqual(["Lunes 5 de octubre de 2026"]);
    expect(deRol(p1, "hora")).toEqual(["06:30 · hora de Costa Rica"]);
    expect(deRol(p1, "cifra-ordenes")).toEqual(["3"]);
    expect(deRol(p1, "cifra-unidades")).toEqual(["6"]);
    expect(deRol(p1, "cifra-titulo")).toEqual(["ÓRDENES", "UNIDADES"]);
  });
});

describe("476/R17 — tabla por producto", () => {
  it("cabecera con «Remisiones que lo llevan» y una fila por producto: unidades desc, nombre asc", () => {
    const { m } = maqueta([fila("1 * b"), fila("3 * Zeta"), fila("1 * a")]);
    const ops = todas(m.paginas);
    expect(deRol(ops, "cabecera-tabla")).toEqual(["Producto", "Unidades", "Remisiones que lo llevan", "Listo"]);
    expect(deRol(ops, "producto")).toEqual(["Zeta", "a", "b"]);
    expect(deRol(ops, "unidades")).toEqual(["3", "1", "1"]);
  });

  it("«×k» solo cuando la orden lleva k > 1 unidades; una casilla vacia por producto", () => {
    const { m } = maqueta([fila("2 * Crema X", { numRemision: "GM-1" }), fila("1 * Crema X", { numRemision: "GM-2" })]);
    const ops = todas(m.paginas);
    expect(deRol(ops, "ficha")).toEqual(["GM-1 ×2", "GM-2"]);
    expect(ops.filter((o) => o.tipo === "rect" && o.rol === "casilla")).toHaveLength(1);
  });

  it("«Sin producto indicado» al final, con 0 unidades", () => {
    const { m } = maqueta([fila(""), fila("1 * X")]);
    const ops = todas(m.paginas);
    expect(deRol(ops, "producto")).toEqual(["X", "Sin producto indicado"]);
    expect(deRol(ops, "unidades")).toEqual(["1", "0"]);
  });
});

describe("476/R19 — atrasadas", () => {
  it("con atrasadas: bloque con el numero, N y la lista (mas dias primero), y fichas ambar con sus dias", () => {
    const { m } = maqueta(
      [
        fila("1 * X", { numRemision: "NA-1" }),
        fila("2 * X", { numRemision: "NA-2", entrada: new Date(AHORA.getTime() - 5 * UN_DIA) }),
        fila("1 * Y", { numRemision: "NA-3", entrada: new Date(AHORA.getTime() - 7 * UN_DIA) }),
      ],
      2,
    );
    const ops = todas(m.paginas);
    expect(deRol(ops, "atrasadas-titulo").join(" ")).toBe("2 órdenes llevan más de 2 días en preparación, prepáralas primero:");
    expect(deRol(ops, "atrasadas-lista").join(" ")).toBe("NA-3 (7 días) · NA-2 (5 días)");
    expect(deRol(ops, "ficha-atrasada").sort()).toEqual(["NA-2 ×2 · 5d", "NA-3 · 7d"]);
    expect(deRol(ops, "ficha")).toEqual(["NA-1"]);
    const rectAtrasada = ops.find((o) => o.tipo === "rect" && o.rol === "ficha-atrasada");
    const rectNormal = ops.find((o) => o.tipo === "rect" && o.rol === "ficha");
    expect(rectAtrasada && rectAtrasada.tipo === "rect" ? rectAtrasada.relleno : null).not.toEqual(
      rectNormal && rectNormal.tipo === "rect" ? rectNormal.relleno : null,
    );
    expect(ops.some((o) => o.tipo === "rect" && o.rol === "atrasadas")).toBe(true);
  });

  it("singular: «1 orden lleva más de 1 día»", () => {
    const { m } = maqueta([fila("1 * X", { entrada: new Date(AHORA.getTime() - 3 * UN_DIA) })], 1);
    expect(deRol(todas(m.paginas), "atrasadas-titulo").join(" ")).toBe("1 orden lleva más de 1 día en preparación, prepáralas primero:");
  });

  it("sin atrasadas: ni bloque ni fichas ambar", () => {
    const { m } = maqueta([fila("1 * X"), fila("1 * Y")], 2);
    const ops = todas(m.paginas);
    expect(deRol(ops, "atrasadas-titulo")).toEqual([]);
    expect(ops.some((o) => o.tipo === "rect" && (o.rol === "atrasadas" || o.rol === "ficha-atrasada"))).toBe(false);
  });
});

describe("476/R20 — fila de total", () => {
  it("«Total · P productos», U y «en O órdenes» (la orden sin producto cuenta en órdenes, no en productos)", () => {
    const { m } = maqueta([fila("2 * X"), fila("1 * Y"), fila("")]);
    expect(deRol(todas(m.paginas), "total")).toEqual(["Total · 2 productos", "3", "en 3 órdenes"]);
  });

  it("R27: las cifras impresas son las de `valores` del mismo modelo", () => {
    const { m, modelo } = maqueta([fila("2 * X"), fila("1 * Y", { entrada: new Date(AHORA.getTime() - 9 * UN_DIA) })]);
    const ops = todas(m.paginas);
    expect(deRol(ops, "cifra-ordenes")).toEqual([modelo.valores.ordenes]);
    expect(deRol(ops, "cifra-unidades")).toEqual([modelo.valores.unidades]);
    expect(deRol(ops, "total")).toEqual([
      `Total · ${modelo.valores.productos} productos`,
      modelo.valores.unidades,
      `en ${modelo.valores.ordenes} órdenes`,
    ]);
    expect(deRol(ops, "atrasadas-titulo").join(" ")).toContain(`${modelo.valores.atrasadas} orden lleva`);
  });
});

describe("476/R21 — paginacion", () => {
  function grande() {
    const filas: FilaPicking[] = [];
    for (let i = 0; i < 500; i++) {
      filas.push(fila(`${(i % 3) + 1} * Producto numero ${i % 80} con un nombre bastante largo`, {
        numRemision: `NA-${1000 + i}`,
        entrada: new Date(AHORA.getTime() - (i % 6) * UN_DIA),
      }));
    }
    return maqueta(filas, 2, "Sicommer");
  }

  it("500 ordenes y 80 productos: varias paginas, cabecera de tabla en cada pagina con filas, pie «Página X de Y» en todas", () => {
    const { m } = grande();
    const Y = m.paginas.length;
    expect(Y).toBeGreaterThan(1);
    m.paginas.forEach((ops, i) => {
      expect(deRol(ops, "pie-pagina")).toEqual([`Página ${i + 1} de ${Y}`]);
      expect(deRol(ops, "pie")).toEqual(["Ordenex · Picking Sicommer · 5 oct 2026 06:30"]);
      if (deRol(ops, "producto").length > 0) expect(deRol(ops, "cabecera-tabla")).toContain("Remisiones que lo llevan");
    });
    // Ninguna ficha se pierde: una por (orden, producto).
    const fichas = [...deRol(todas(m.paginas), "ficha"), ...deRol(todas(m.paginas), "ficha-atrasada")];
    expect(fichas).toHaveLength(500);
  });

  it("nada se dibuja por debajo del limite del contenido (el pie vive debajo)", () => {
    const { m } = grande();
    for (const op of todas(m.paginas)) {
      if (op.tipo === "texto" && (op.rol === "pie" || op.rol === "pie-pagina")) continue;
      if (op.tipo === "linea" && op.y1 === 297 - 14) continue;
      const fondo = op.tipo === "texto" ? op.y : op.tipo === "rect" ? op.y + op.h : Math.max(op.y1, op.y2);
      expect(fondo).toBeLessThanOrEqual(277 + 1e-9);
    }
  });

  it("un producto en 400 ordenes (mas alto que una pagina) se parte en filas «(continúa)» sin perder remisiones", () => {
    const filas = Array.from({ length: 400 }, (_, i) => fila("1 * Crema X", { numRemision: `REMISION-LARGA-${10000 + i}` }));
    const { m } = maqueta(filas);
    expect(m.paginas.length).toBeGreaterThan(1);
    const productos = deRol(todas(m.paginas), "producto");
    expect(productos[0]).toBe("Crema X");
    expect(productos.slice(1).every((p) => p.includes("(continúa)"))).toBe(true);
    expect(deRol(todas(m.paginas), "ficha")).toHaveLength(400);
    expect(deRol(todas(m.paginas), "unidades")).toEqual(["400"]);
  });
});

describe("476/R22 — caracteres que la fuente no imprime", () => {
  it("U+1D560 en un producto sale «?», el resto intacto, y se avisa «1 carácter…»", () => {
    const { m } = maqueta([fila("1 * Crema \u{1D560}k")]);
    const ops = todas(m.paginas);
    expect(deRol(ops, "producto")).toEqual(["Crema ?k"]);
    expect(m.sustituidos).toBe(1);
    expect(deRol(ops, "aviso-sustitucion").join(" ")).toBe("1 carácter que no se puede imprimir se muestra como «?».");
  });

  it("cuenta por DATO, no por cada vez que se pinta (la tienda sale en encabezado y en cada pie)", () => {
    const { m } = maqueta([fila("1 * X", { numRemision: "R→" })], 2, "Tienda ★");
    expect(m.sustituidos).toBe(2);
    expect(deRol(todas(m.paginas), "tienda")).toEqual(["Tienda ?"]);
    expect(deRol(todas(m.paginas), "ficha")).toEqual(["R?"]);
    expect(deRol(todas(m.paginas), "aviso-sustitucion").join(" ")).toBe("2 caracteres que no se pueden imprimir se muestran como «?».");
  });

  it("sin sustituciones no hay aviso", () => {
    const { m } = maqueta([fila("1 * Crema ₡ — ’X’")]);
    expect(m.sustituidos).toBe(0);
    expect(deRol(todas(m.paginas), "aviso-sustitucion")).toEqual([]);
  });

  it("D6: todo texto con la fuente embebida cabe en su cobertura; todo texto Helvetica es seguro en la estandar", () => {
    const { m } = maqueta(
      [fila("1 * Crema ₡ — ’X’ \u{1D560}", { entrada: new Date(AHORA.getTime() - 5 * UN_DIA) }), fila("")],
      2,
      "Tienda “Ñandú” ★",
    );
    for (const t of textos(todas(m.paginas))) {
      if (t.fuente === "embebida") expect(cubreTexto(fuenteEtiqueta, t.texto), t.texto).toBe(true);
      else expect(seguroEnFuenteEstandar(t.texto), t.texto).toBe(true);
    }
  });

  it("D6: los rotulos fijos de Helvetica no llevan caracteres que la fuente estandar borraria", () => {
    for (const r of Object.values(ROTULOS_HELVETICA)) expect(seguroEnFuenteEstandar(r), r).toBe(true);
  });
});

describe("476/R16 — humo del PDF real (jsPDF)", () => {
  const paginasDelPdf = (bytes: Uint8Array) =>
    (Buffer.from(bytes).toString("latin1").match(/\/Type \/Page[^s]/g) ?? []).length;

  it("bytes que empiezan por %PDF y tantas paginas como la maqueta (1 pagina)", () => {
    const modelo = construirModeloPicking([fila("2 * Crema X"), fila("1 * Base")], { ahora: AHORA, diasAtraso: 2, tienda: "Gameos" });
    const r = renderizarPicking(modelo);
    expect(Buffer.from(r.bytes.slice(0, 4)).toString("latin1")).toBe("%PDF");
    expect(r.paginas).toBe(1);
    expect(paginasDelPdf(r.bytes)).toBe(1);
  });

  it("varias paginas: el PDF real tiene las de su maqueta", () => {
    const filas = Array.from({ length: 300 }, (_, i) => fila(`1 * Producto ${i % 60} con nombre largo de verdad`, { numRemision: `NA-${i}` }));
    const r = renderizarPicking(construirModeloPicking(filas, { ahora: AHORA, diasAtraso: 2, tienda: "Nuform" }));
    expect(r.paginas).toBeGreaterThan(1);
    expect(paginasDelPdf(r.bytes)).toBe(r.paginas);
  });
});
