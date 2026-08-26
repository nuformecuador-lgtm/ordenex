import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  fuenteEtiqueta,
  PESO_DECLARADO_BASE64,
  PESO_DECLARADO_BYTES,
} from "@/lib/pdf/etiquetas-fuente";
import {
  caracterNoCubierto,
  cubreTexto,
  exigirCobertura,
} from "@/lib/pdf/etiquetas-fuente-registro";
import { monedaConfig } from "@/lib/config/moneda";

import {
  CP1252_IMPRIMIBLES,
  CP1252_SIN_TINTA,
  nombreCodePoint,
} from "../../fixtures/cp1252";
import { codePointsCubiertos, contorno, glifoDe, tieneTinta } from "./ttf-lector";

// Feature 282 (T1/T3/T4/T24/T25) — El ARTEFACTO de fuente: que es, de donde
// sale, que cubre y cuanto pesa.
//
// La puerta de R30 es el primer bloque: si el archivo elegido no trajera U+20A1
// con contorno no vacio, no se sigue con el. No se da por bueno "porque
// Liberation Sans deberia tenerlo": se mide.

const RAIZ = path.join(__dirname, "..", "..", "..");
const TTF = path.join(RAIZ, "assets", "fuentes", "LiberationSans-etiqueta-subset.ttf");
const MODULO = path.join(RAIZ, "lib", "pdf", "etiquetas-fuente.ts");
const LICENCIA = path.join(RAIZ, "licenses", "LiberationSans-OFL.txt");

const TTF_BYTES = new Uint8Array(readFileSync(TTF));
const DEL_BASE64 = new Uint8Array(Buffer.from(fuenteEtiqueta.base64, "base64"));

describe("R30 — la fuente elegida contiene el simbolo, verificado ANTES de darla por buena", () => {
  it("U+20A1 tiene glifo con contorno NO VACIO en el archivo commiteado", () => {
    const gid = glifoDe(TTF_BYTES, 0x20a1);
    expect(gid, "el subconjunto no mapea U+20A1: hay que elegir otro archivo").toBeGreaterThan(0);
    expect(
      contorno(TTF_BYTES, gid),
      "U+20A1 mapea a un glifo VACIO: imprimiria papel en blanco",
    ).toBeGreaterThan(0);
  });

  it("el simbolo CONFIGURADO (no uno escrito a mano aqui) esta cubierto", () => {
    // Se lee de la configuracion, como hace `dinero-sin-centimos.guardia.test.ts`:
    // si mañana la moneda cambia, este test lo dice en vez de seguir verde
    // afirmando sobre un simbolo que ya no se usa.
    for (const caracter of monedaConfig.simbolo) {
      const cp = caracter.codePointAt(0) as number;
      const gid = glifoDe(TTF_BYTES, cp);
      expect(gid, `el subconjunto no cubre ${nombreCodePoint(cp)}`).toBeGreaterThan(0);
      expect(contorno(TTF_BYTES, gid)).toBeGreaterThan(0);
    }
  });
});

describe("R11 — cobertura: nada de lo que hoy se imprime puede desaparecer", () => {
  it("los 218 code points imprimibles de cp1252 tienen glifo", () => {
    const sinGlifo = CP1252_IMPRIMIBLES.filter((cp) => glifoDe(TTF_BYTES, cp) === 0);
    expect(sinGlifo.map(nombreCodePoint)).toEqual([]);
  });

  it("todos dejan tinta salvo los dos que por diseño no la dejan (espacio y NBSP)", () => {
    const vacios = CP1252_IMPRIMIBLES.filter(
      (cp) => !tieneTinta(TTF_BYTES, glifoDe(TTF_BYTES, cp)),
    );
    // Igualdad EXACTA, no `contains`: si un tercer caracter se quedara con el
    // contorno vacio —el fallo de R10 llevado al artefacto— este test lo dice.
    expect(vacios).toEqual([...CP1252_SIN_TINTA]);
  });

  it("cubre cp1252 MAS el simbolo configurado, y ni uno menos", () => {
    const requeridos = new Set<number>(CP1252_IMPRIMIBLES);
    for (const c of monedaConfig.simbolo) requeridos.add(c.codePointAt(0) as number);
    const cubiertos = new Set(codePointsCubiertos(TTF_BYTES));
    const faltan = [...requeridos].filter((cp) => !cubiertos.has(cp));
    expect(faltan.map(nombreCodePoint)).toEqual([]);
  });
});

describe("R29 — la cobertura declarada no miente", () => {
  it("COBERTURA coincide EXACTAMENTE con lo que el archivo cubre", () => {
    const delArchivo = codePointsCubiertos(TTF_BYTES).sort((a, b) => a - b);
    const declarados: number[] = [];
    for (const [desde, hasta] of fuenteEtiqueta.cobertura) {
      for (let cp = desde; cp <= hasta; cp++) declarados.push(cp);
    }
    expect(declarados).toEqual(delArchivo);
  });

  it("los rangos declarados vienen ordenados y sin solaparse (lo que asume la busqueda)", () => {
    let anterior = -1;
    for (const [desde, hasta] of fuenteEtiqueta.cobertura) {
      expect(desde).toBeGreaterThan(anterior);
      expect(hasta).toBeGreaterThanOrEqual(desde);
      anterior = hasta;
    }
  });

  it("`cubreTexto` usa esa declaracion: dice que si a lo cubierto y que NO a lo demas", () => {
    expect(cubreTexto(fuenteEtiqueta, "₡18.000")).toBe(true);
    expect(cubreTexto(fuenteEtiqueta, "áéíñóú ÁÉÍÑÓÚ")).toBe(true);
    expect(cubreTexto(fuenteEtiqueta, "18.000 中")).toBe(false);
    expect(caracterNoCubierto(fuenteEtiqueta, "18.000 中")).toBe("中");
    expect(caracterNoCubierto(fuenteEtiqueta, "₡18.000")).toBeNull();
  });

  it("R28 — un caracter no cubierto LANZA, con el code point en el mensaje", () => {
    expect(() => exigirCobertura(fuenteEtiqueta, "₡18.000", "Monto a cobrar")).not.toThrow();
    expect(() => exigirCobertura(fuenteEtiqueta, "₹18.000", "Monto a cobrar")).toThrow(
      /U\+20B9[\s\S]*Monto a cobrar/,
    );
  });
});

describe("R17 — procedencia y licencia", () => {
  it("el base64 que ships decodifica BYTE A BYTE al .ttf commiteado", () => {
    expect(DEL_BASE64.byteLength).toBe(TTF_BYTES.byteLength);
    const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
    expect(sha(DEL_BASE64)).toBe(sha(TTF_BYTES));
  });

  it("la cabecera del modulo declara origen, version, licencia, sha256 y como se regenera", () => {
    const cabecera = readFileSync(MODULO, "utf8").slice(0, 3000);
    expect(cabecera).toContain("Liberation Sans Regular");
    expect(cabecera).toContain("2.1.5");
    expect(cabecera).toMatch(/https:\/\/github\.com\/liberationfonts/);
    expect(cabecera).toContain("SIL Open Font License 1.1");
    expect(cabecera).toContain("licenses/LiberationSans-OFL.txt");
    expect(cabecera).toContain(createHash("sha256").update(TTF_BYTES).digest("hex"));
    // El procedimiento de regeneracion, con el comando exacto del subconjunto.
    expect(cabecera).toContain("scripts/fuente-etiqueta-a-base64.ts");
    expect(cabecera).toContain("fontTools.subset");
    expect(cabecera).toContain("U+20A1");
  });

  it("la licencia citada existe en el repositorio y es la OFL", () => {
    expect(existsSync(LICENCIA)).toBe(true);
    const texto = readFileSync(LICENCIA, "utf8");
    expect(texto).toContain("SIL OPEN FONT LICENSE Version 1.1");
    expect(texto).toContain("Liberation");
  });
});

describe("R14 — el peso declarado es el peso real", () => {
  it("PESO_DECLARADO_BYTES coincide con el archivo (si no, dice los dos numeros)", () => {
    expect(
      PESO_DECLARADO_BYTES,
      `declarado ${PESO_DECLARADO_BYTES} B, real ${TTF_BYTES.byteLength} B: regenera con \`pnpm exec tsx scripts/fuente-etiqueta-a-base64.ts\``,
    ).toBe(TTF_BYTES.byteLength);
  });

  it("PESO_DECLARADO_BASE64 coincide con lo que realmente viaja", () => {
    expect(PESO_DECLARADO_BASE64).toBe(fuenteEtiqueta.base64.length);
  });
});
