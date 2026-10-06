import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { fuentesDePagina, objetos, paginas, textoLegible, textosDePagina } from "./pdf-inspector";
import { clasificar } from "@/lib/whatsapp-envios/informes/transito/calculo";
import { pdfInformeTransito } from "@/lib/whatsapp-envios/informes/transito/pdf";
import { PARAMETROS_POR_DEFECTO, type ZonaInforme } from "@/lib/whatsapp-envios/informes/transito/parametros";
import type { FilaTransito } from "@/lib/whatsapp-envios/informes/transito/tipos";

// Ficha 475 (T4.2) — R19, R23-R32 sobre el PDF REAL, leyendo el texto con el /ToUnicode que el
// propio documento declara (la fuente embebida escribe en Identity-H: un grep no lo veria).

const UN_DIA = 24 * 60 * 60 * 1000;
const AHORA = new Date("2026-10-05T11:00:00.000Z"); // lunes 5/10/2026 05:00 CR

const GAM: ZonaInforme = { id: randomUUID(), nombre: "GAM", esCentral: true };
const SUR: ZonaInforme = { id: randomUUID(), nombre: "FGAM Zona Sur", esCentral: false };
const LIMON: ZonaInforme = { id: randomUUID(), nombre: "FGAM Limon Arriba", esCentral: false };
const COCO: ZonaInforme = { id: randomUUID(), nombre: "FGAM El Coco", esCentral: false };
const ZONAS = [GAM, SUR, LIMON, COCO];

function fila(over: Partial<FilaTransito>, dias: number, diasEnEstado = 0): FilaTransito {
  return {
    ordenId: randomUUID(),
    numRemision: "GM-10533",
    numGuia: 48240,
    estado: "en_reparto",
    zonaId: GAM.id,
    destinatario: "Randall Solís",
    canton: "Cartago",
    distrito: "Oriental",
    montoCobrar: "32000.00",
    hitoAt: new Date(AHORA.getTime() - dias * UN_DIA),
    ultimaTransicionAt: new Date(AHORA.getTime() - diasEnEstado * UN_DIA),
    ...over,
  };
}

/** Texto legible de cada pagina, en el orden en que se dibujo. */
function leer(bytes: Uint8Array): string[][] {
  const n = paginas(objetos(bytes)).length;
  return Array.from({ length: n }, (_, i) => {
    const fuentes = fuentesDePagina(bytes, i);
    return textosDePagina(bytes, i).map((t) => textoLegible(t, fuentes.get(t.fuenteRes)));
  });
}

function pdfDe(filas: FilaTransito[], sinHito = 0) {
  const modelo = clasificar(filas, ZONAS, PARAMETROS_POR_DEFECTO, AHORA, sinHito);
  const bytes = pdfInformeTransito(modelo);
  const pags = leer(bytes);
  return { bytes, pags, todo: pags.flat(), plano: pags.flat().join("\n") };
}

const FILAS = [
  fila({ numRemision: "GM-10482", numGuia: 48127, destinatario: "María Jiménez", canton: "San José", distrito: "Hatillo", montoCobrar: "18500.00" }, 12),
  fila({ numRemision: "GM-10511", numGuia: 48203, estado: "reprogramado", montoCobrar: "24900.00" }, 11, 4),
  fila({ numRemision: "NF-2231", numGuia: null, estado: "en_bodega_central", montoCobrar: null, distrito: null, canton: "Heredia" }, 9, 1),
  fila({ numRemision: "SC-7781", numGuia: 48251, estado: "novedad", montoCobrar: "0.00" }, 8, 2),
  fila({ numRemision: "GM-10288", numGuia: 47690, estado: "en_bodega_satelite", zonaId: SUR.id, montoCobrar: "36000.00" }, 24, 9),
  fila({ numRemision: "SC-7702", numGuia: 47801, estado: "novedad", zonaId: SUR.id, montoCobrar: "22500.00" }, 17, 3),
  fila({ numRemision: "GM-10340", numGuia: 47822, zonaId: SUR.id, montoCobrar: "14900.00" }, 15),
  fila({ numRemision: "GM-10302", numGuia: 47710, zonaId: LIMON.id, montoCobrar: "27500.00" }, 23),
];

describe("475/R23 — A4 vertical, encabezado y totales", () => {
  const { bytes, pags } = pdfDe(FILAS, 2);

  it("todas las paginas son A4 vertical", () => {
    for (const p of paginas(objetos(bytes))) {
      const caja = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(p.dict);
      expect(caja).not.toBeNull();
      expect(Number(caja![1])).toBeCloseTo(595.28, 1);
      expect(Number(caja![2])).toBeCloseTo(841.89, 1);
    }
  });

  it("titulo, fecha larga, hora CR y el hito en palabras al principio", () => {
    const p1 = pags[0];
    expect(p1.slice(0, 8)).toEqual(
      expect.arrayContaining([
        "Informe de tránsito",
        "Lunes 5 de octubre de 2026",
        "05:00 · hora de Costa Rica",
        "Días contados desde la entrada a la bodega central",
      ]),
    );
  });

  it("los cuatro totales con sus valores", () => {
    const p1 = pags[0];
    const tras = (k: string) => p1[p1.indexOf(k) + 1];
    expect(tras("VENCIDOS")).toBe("4"); // 12/10, 11/10, 24/20, 23/20
    expect(tras("POR VENCER")).toBe("4");
    expect(tras("PARADOS")).toBe("4"); // reprogramado 4>3, novedad 2>1, satelite 9>2, novedad 3>1
    expect(tras("POR COBRAR")).toBe("₡144.300");
  });
});

describe("475/R24 — bloque ATENCION", () => {
  it("con parados: tras los totales, por estado en orden del flujo, con umbral y columnas", () => {
    const { pags } = pdfDe(FILAS);
    const p1 = pags[0];
    const atencion = p1.indexOf("ATENCIÓN · 4 PAQUETES PARADOS");
    expect(atencion).toBeGreaterThan(p1.indexOf("POR COBRAR"));
    expect(atencion).toBeLessThan(p1.indexOf("GAM"));
    const grupos = p1.filter((t) => / · parado si lleva más de /.test(t));
    expect(grupos).toEqual([
      "En bodega satélite · parado si lleva más de 2 días",
      "Reprogramado · parado si lleva más de 3 días",
      "Novedad · parado si lleva más de 1 día",
    ]);
    for (const c of ["GUÍA", "ZONA", "DÍAS EN EL ESTADO", "DÍAS TOTALES"]) expect(p1).toContain(c);
    // fila de satelite: guia, zona, dias en el estado, dias totales
    const i = p1.indexOf("47690");
    expect(p1.slice(i, i + 4)).toEqual(["47690", "FGAM Zona Sur", "9", "24"]);
  });

  it("sin parados no se dibuja", () => {
    const { plano } = pdfDe([fila({}, 9)]);
    expect(plano).not.toContain("ATENCIÓN");
  });
});

describe("475/R25-R28 — tablas por zona", () => {
  const { pags, plano, todo } = pdfDe(FILAS);

  it("central primero; fuera de la GAM en pagina aparte, por nº de paquetes desc", () => {
    expect(pags[0]).toContain("GAM");
    const p2 = pags[1];
    expect(p2[0]).toBe("Informe de tránsito · fuera de la GAM");
    expect(p2.indexOf("FGAM Zona Sur")).toBeLessThan(p2.indexOf("FGAM Limon Arriba"));
  });

  it("cabecera de zona: plazo, dia de alerta, nº de paquetes y por cobrar", () => {
    expect(todo).toContain("Plazo 10 días · alerta desde el día 8 · 4 paquetes · ₡43.400 por cobrar");
    expect(todo).toContain("Plazo 20 días · alerta desde el día 15 · 3 paquetes · ₡73.400 por cobrar");
  });

  it("columnas y fila completa: remision, guia, N/plazo, estado visible, cliente, canton · distrito, por cobrar", () => {
    for (const c of ["REMISIÓN", "GUÍA", "DÍAS", "ESTADO", "CLIENTE", "CANTÓN · DISTRITO", "POR COBRAR"]) {
      expect(todo).toContain(c);
    }
    const i = todo.indexOf("GM-10482");
    expect(todo.slice(i, i + 8)).toEqual([
      "GM-10482",
      "48127",
      "12/10",
      "En reparto",
      "María Jiménez",
      "San José · Hatillo",
      "₡18.500",
      "VENCIDO",
    ]);
  });

  it("«—» sin guia y sin monto (null o 0); solo canton sin distrito", () => {
    const i = todo.indexOf("NF-2231");
    expect(todo.slice(i, i + 7)).toEqual(["NF-2231", "—", "9/10", "En bodega central", "Randall Solís", "Heredia", "—"]);
    const j = todo.indexOf("SC-7781");
    expect(todo[j + 6]).toBe("—");
  });

  it("R26: filas por dias desc dentro de la zona", () => {
    const orden = ["GM-10482", "GM-10511", "NF-2231", "SC-7781"].map((r) => todo.indexOf(r));
    expect([...orden].sort((a, b) => a - b)).toEqual(orden);
  });

  it("R27: marca de texto VENCIDO por vencido y PARADO por parado", () => {
    expect(todo.filter((t) => t === "VENCIDO").length).toBe(4);
    expect(todo.filter((t) => t === "PARADO").length).toBe(4);
  });

  it("R28: zonas sin paquetes en alerta por nombre", () => {
    expect(plano).toContain("Sin paquetes en alerta: FGAM El Coco");
  });
});

describe("475/R29 — resumen de parametros y pie", () => {
  const { pags, plano } = pdfDe(FILAS, 3);

  it("hito, plazo y aviso por zona, umbrales y sin el momento de inicio", () => {
    expect(plano).toContain("Parámetros de este informe");
    expect(plano).toContain("GAM: plazo 10 días y aviso 2 días antes (alerta desde el día 8).");
    expect(plano).toContain("FGAM Zona Sur: plazo 20 días y aviso 5 días antes (alerta desde el día 15).");
    expect(plano).toMatch(/En bodega central \(parado si más de 2 días\)/);
    expect(plano).toMatch(/En reparto \(sin umbral de parado\)/);
    expect(plano).toContain("3 paquetes en estos estados aún no han pasado por la entrada a la bodega central: no se cuentan.");
  });

  it("pie con fecha y hora y «Pagina X de Y» en todas", () => {
    pags.forEach((p, i) => {
      expect(p).toContain(`Página ${i + 1} de ${pags.length}`);
      expect(p).toContain("Ordenex · Informe de tránsito · 05/10/2026 05:00");
    });
  });
});

describe("475/R30 — sin datos personales ni identificadores internos", () => {
  it("ningun uuid de orden ni de zona aparece; tampoco telefono, direccion ni tienda (no viajan)", () => {
    const { plano } = pdfDe(FILAS);
    for (const f of FILAS) expect(plano).not.toContain(f.ordenId);
    for (const z of ZONAS) expect(plano).not.toContain(z.id);
    expect(plano).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    expect(plano).not.toMatch(/\b[2-8]\d{7}\b/); // un telefono de CR de 8 digitos
  });
});

describe("475/R31 — paginacion de una tabla larga", () => {
  it("200 filas: cabecera repetida en cada pagina de la tabla, sin perder ni duplicar filas", () => {
    const filas = Array.from({ length: 200 }, (_, i) =>
      fila({ numRemision: `TR-${String(i).padStart(3, "0")}`, numGuia: 50000 + i }, 9 + (i % 3)),
    );
    const { pags } = pdfDe(filas);
    expect(pags.length).toBeGreaterThan(3);
    const remisiones = pags.flat().filter((t) => /^TR-\d{3}$/.test(t));
    expect(remisiones.length).toBe(200);
    expect(new Set(remisiones).size).toBe(200);
    for (const p of pags) {
      if (p.some((t) => /^TR-\d{3}$/.test(t))) {
        const cab = p.indexOf("REMISIÓN");
        expect(cab).toBeGreaterThanOrEqual(0);
        expect(cab).toBeLessThan(p.findIndex((t) => /^TR-\d{3}$/.test(t)));
      }
    }
  });
});

describe("475/R32 — simbolo de moneda legible", () => {
  it("₡ sale impreso, no borrado", () => {
    const { todo } = pdfDe(FILAS);
    expect(todo).toContain("₡18.500");
    expect(todo.some((t) => t.includes("?"))).toBe(false);
  });

  it("un caracter que la fuente no cubre sale como «?» visible, no desaparece", () => {
    const { todo } = pdfDe([fila({ destinatario: "Ana 😀 Mora" }, 9)]);
    expect(todo).toContain("Ana ? Mora");
  });
});

describe("475/R19 — PDF sin paquetes en alerta", () => {
  it("dice que no hay paquetes, totales a 0 y lista las zonas", () => {
    const { pags, plano } = pdfDe([]);
    expect(pags.length).toBe(1);
    expect(plano).toContain("No hay paquetes en alerta con estos parámetros.");
    expect(pags[0][pags[0].indexOf("VENCIDOS") + 1]).toBe("0");
    expect(pags[0][pags[0].indexOf("POR COBRAR") + 1]).toBe("₡0");
    expect(plano).toContain("Sin paquetes en alerta: FGAM El Coco · FGAM Limon Arriba · FGAM Zona Sur · GAM");
  });
});
