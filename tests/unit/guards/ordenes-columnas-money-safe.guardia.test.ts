import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

import { LLAMADAS_PROHIBIDAS_EN_DINERO, quitarComentarios } from "../../fixtures/money-safe";

/**
 * Feature 204 — GUARDIA: las tablas de órdenes PINTAN dinero; no lo derivan.
 *
 * POR QUÉ EXISTE, Y POR QUÉ NO BASTABA CON AMPLIAR EL BARRIDO QUE YA HABÍA.
 *
 * `app/(app)/ordenes/_components/ordenes-columns.tsx` calculaba dos importes EN EL NAVEGADOR
 * —"Flete + IVA" y "Comisión + IVA"— multiplicando los `number` de la tarifa. La ficha pedía
 * MEDIR antes de arreglar, y la medición salió positiva: comparando, orden a orden, lo que la
 * tabla pintaba contra lo que factura el cierre, 14 de las 66 órdenes con tarifa activa de la
 * base se veían un céntimo desviadas. Dos mecanismos distintos, los dos reales:
 *
 *   - Medio exacto irrepresentable. Monto 14900.00 al 3.50%: la comisión es 521.50 clavada y
 *     su IVA, 67.795. `Prisma.Decimal` con ROUND_HALF_UP sube a 67.80 y el cierre cobra
 *     589.30. El navegador hacía 521.5 * 1.13, que en binario vale 589.29499999999995907
 *     (el 589.295 exacto no existe en `double`), y `toFixed(2)` BAJABA a 589.29.
 *   - Doble redondeo. Monto 16618.40: la comisión exacta es 581.644 y el servidor la
 *     REDONDEA a 581.64 antes de aplicarle el IVA (657.25). El navegador se lo aplicaba sin
 *     redondear (581.644 * 1.13 = 657.25772) y subía a 657.26. Ése ni siquiera es un problema
 *     de binario: era OTRA fórmula.
 *
 * La conclusión importante para esta guardia es la del último test: el barrido money-safe que
 * ya existía (`tests/unit/guards/liquidacion-money-safe.test.ts`) NO habría cazado ese código
 * ni censando el archivo. Persigue CONVERSIONES —`Number(`, `parseFloat(`, `parseInt(`,
 * `.toFixed(`— y aquella aritmética no tenía ninguna: los importes ya llegaban como `number`
 * en el DTO y bastaba con multiplicarlos. Un céntimo se pierde igual sin escribir `Number(`.
 *
 * Por eso aquí se afirman DOS cosas:
 *   1. el barrido de conversiones, sobre unos archivos que ningún censo alcanzaba; y
 *   2. la regla que sí muerde: ninguna tabla de órdenes vuelve a NOMBRAR los campos de la
 *      tarifa que son las entradas de las dos fórmulas. Para recalcular en el navegador hay
 *      que nombrarlos, y nombrarlos pone esto en rojo.
 *
 * Vive aparte del barrido de la 172 y no dentro: aquel declara «los archivos que la feature
 * 172 creó o modificó» y valida su censo contra los árboles de liquidación. Meterle una tabla
 * de órdenes convertiría esa afirmación en mentira.
 */

const RAIZ = path.resolve(__dirname, "../../..");

/**
 * Las tablas que muestran dinero de una orden. Censo explícito: si un archivo se mueve o
 * se renombra, el primer test cae en vez de salirse del alcance en silencio.
 *
 * FEATURE 260 (F7) — ALTA: el detalle del tablero del día. Nace una TERCERA superficie con
 * importes de orden —monta el mismo `ordenesColumns` en el modal de `/monitoreo`— y hasta hoy
 * esta guardia no llegaba hasta allí: estaba verde por omisión, que no es lo mismo que estar
 * verde. Entra en el censo por R41.
 */
const TABLAS_DE_ORDENES: readonly string[] = [
  "app/(app)/ordenes/_components/ordenes-columns.tsx",
  "app/(app)/recepcion-satelite/_components/recibidas-columns.tsx",
  "app/(app)/monitoreo/_components/detalle-columnas.ts",
];

/**
 * Los árboles COMPLETOS de los que salen esas tablas. La regla de abajo se aplica a todos sus
 * archivos, no solo a los censados: así no envejece. Un módulo nuevo que derive dinero en
 * el navegador cae aunque nadie se acuerde de añadirlo a ninguna lista.
 */
const ARBOLES = [
  "app/(app)/ordenes/_components",
  "app/(app)/recepcion-satelite/_components",
  "app/(app)/monitoreo/_components",
];

/**
 * Las entradas de las dos fórmulas de dinero derivado. `fulfillment` NO está: es un importe
 * de la tarifa que la columna solo formatea, sin ninguna operación en medio, y ese viaje sí
 * es exacto. Lo que se prohíbe es OPERAR, y para operar hay que nombrar estos siete.
 */
const CAMPOS_DE_LA_FORMULA: readonly string[] = [
  "valorFlete",
  "valorFleteGam",
  "valorFleteDevuelto",
  "valorFleteDevueltoGam",
  "comisionCod",
  "ivaFlete",
  "ivaComisionCod",
];

function codigo(rutaRelativa: string): string {
  return quitarComentarios(readFileSync(path.join(RAIZ, rutaRelativa), "utf8"));
}

function listarArchivos(dir: string, acc: string[] = []): string[] {
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const completo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) listarArchivos(completo, acc);
    else if (/\.tsx?$/.test(entrada.name)) acc.push(completo);
  }
  return acc;
}

function relativa(absoluta: string): string {
  return path.relative(RAIZ, absoluta).split(path.sep).join("/");
}

/** Campos de la fórmula NOMBRADOS en un fuente (ya sin comentarios). */
function camposNombrados(fuente: string): string[] {
  return CAMPOS_DE_LA_FORMULA.filter((campo) =>
    new RegExp(`\\b${campo}\\b`).test(fuente),
  );
}

describe("guardia 204 — las tablas de órdenes pintan el dinero, no lo derivan", () => {
  it("el censo existe entero", () => {
    for (const ruta of TABLAS_DE_ORDENES) {
      expect(existsSync(path.join(RAIZ, ruta)), `${ruta} no existe`).toBe(true);
    }
  });

  it("ninguna tabla de órdenes convierte un monto a número", () => {
    // El barrido money-safe de siempre (`Number(`, `parseFloat(`, `parseInt(`, `.toFixed(`),
    // aplicado por fin a unos archivos de dinero que ningún censo alcanzaba. Son de CLIENTE,
    // así que pesan las cuatro expresiones, `.toFixed(` incluida.
    const hallazgos: string[] = [];
    for (const ruta of TABLAS_DE_ORDENES) {
      const fuente = codigo(ruta);
      for (const patron of LLAMADAS_PROHIBIDAS_EN_DINERO) {
        const encontrado = fuente.match(patron);
        if (encontrado) hallazgos.push(`${ruta}: ${encontrado[0]}`);
      }
    }
    expect(hallazgos, "conversión de dinero a número en una tabla de órdenes").toEqual([]);
  });

  it("ninguna tabla de órdenes trae una biblioteca de decimales al navegador", () => {
    const conDecimales: string[] = [];
    for (const ruta of TABLAS_DE_ORDENES) {
      const fuente = codigo(ruta);
      if (/from\s+"(@prisma\/client|decimal\.js[^"]*)"/.test(fuente)) conDecimales.push(ruta);
      if (/\bnew\s+(Prisma\.)?Decimal\s*\(/.test(fuente)) conDecimales.push(`${ruta} (new Decimal)`);
    }
    expect(conDecimales, "aritmética de montos en el navegador").toEqual([]);
  });

  it("NINGÚN archivo de esos árboles nombra las entradas de las dos fórmulas", () => {
    // La regla que sí muerde. `flete * (1 + ivaFlete/100)` no lleva `Number(`, pero lleva
    // `ivaFlete`: para recalcular en el navegador hay que nombrar la tarifa.
    const hallazgos: string[] = [];
    for (const dir of ARBOLES) {
      for (const absoluta of listarArchivos(path.join(RAIZ, dir))) {
        const ruta = relativa(absoluta);
        const campos = camposNombrados(quitarComentarios(readFileSync(absoluta, "utf8")));
        if (campos.length > 0) hallazgos.push(`${ruta}: ${campos.join(", ")}`);
      }
    }
    expect(hallazgos, "una tabla de órdenes volvió a mirar la tarifa para operar con ella").toEqual(
      [],
    );
  });

  it("los árboles barridos existen y NO están vacíos", () => {
    // Sin esto, un `readdirSync` sobre una ruta que ya no existe dejaría el test anterior
    // pasando por no mirar nada. Son ~60 archivos entre los tres.
    const total = ARBOLES.reduce(
      (acc, dir) => acc + listarArchivos(path.join(RAIZ, dir)).length,
      0,
    );
    expect(total).toBeGreaterThan(20);
    // Y CADA árbol aporta lo suyo: si uno se quedara vacío o mal escrito, el total seguiría
    // por encima del umbral gracias a los otros dos y nadie se enteraría.
    for (const dir of ARBOLES) {
      expect(
        listarArchivos(path.join(RAIZ, dir)).length,
        `el árbol \`${dir}\` no aporta ni un archivo al barrido`,
      ).toBeGreaterThan(0);
    }
  });

  it("las dos columnas derivadas leen el campo del DTO y no la tarifa", () => {
    // Estructural sobre el archivo: las celdas de "Flete + IVA" y "Comisión + IVA" pintan
    // `row.fleteConIva` / `row.comisionConIva`, los STRING que deriva el servidor.
    const fuente = codigo("app/(app)/ordenes/_components/ordenes-columns.tsx");
    expect(fuente).toMatch(/value=\{row\.fleteConIva\}/);
    expect(fuente).toMatch(/value=\{row\.comisionConIva\}/);
    // Y las funciones que calculaban ya no están.
    expect(fuente).not.toMatch(/calcularFleteConIva|calcularComisionConIva/);
  });

  it("CONTRAPRUEBA: la guardia caza el código viejo — y el barrido de conversiones NO", () => {
    // Éste es el test que justifica que esta guardia exista aparte. Se le da EL CÓDIGO REAL
    // que vivía en `ordenes-columns.tsx` hasta la 204.
    const codigoViejo = `
      function calcularFleteConIva(row: OrdenListItemDTO): number {
        const tarifa = row.relaciones?.tienda?.tarifa;
        if (!tarifa) return 0;
        const esCentral = row.relaciones?.zona?.esCentral;
        const flete = toValidNumber(esCentral ? tarifa.valorFleteGam : tarifa.valorFlete);
        return flete * (1 + toValidNumber(tarifa.ivaFlete) / 100);
      }
      function calcularComisionConIva(row: OrdenListItemDTO): number {
        const tarifa = row.relaciones?.tienda?.tarifa;
        if (!tarifa || row.cobraComision === false) return 0;
        const comision = toValidNumber(row.montoCobrar) * (toValidNumber(tarifa.comisionCod) / 100);
        return comision * (1 + toValidNumber(tarifa.ivaComisionCod) / 100);
      }
    `;

    // 1. El barrido money-safe que ya existía NO ve nada: ni un `Number(`, ni un `.toFixed(`.
    //    Censar el archivo no habría bastado. Ésta es la medición, no una opinión.
    const cazadasPorElBarridoViejo = LLAMADAS_PROHIBIDAS_EN_DINERO.filter((p) =>
      p.test(quitarComentarios(codigoViejo)),
    );
    expect(cazadasPorElBarridoViejo).toEqual([]);

    // 2. La regla de esta guardia sí lo caza, y nombra por qué.
    expect(camposNombrados(quitarComentarios(codigoViejo)).sort()).toEqual([
      "comisionCod",
      "ivaComisionCod",
      "ivaFlete",
      "valorFlete",
      "valorFleteGam",
    ]);

    // 3. Y no caza la CITA: el docstring del archivo nombra los cuatro campos a propósito,
    //    para explicar qué se retiró. El barrido es sobre el código, no sobre el texto.
    const soloComentario = `
      /** Antes esto hacía flete * (1 + ivaFlete/100) con valorFleteGam y comisionCod. */
      // ni ivaComisionCod se salva de la cita
      const x = row.fleteConIva;
    `;
    expect(camposNombrados(quitarComentarios(soloComentario))).toEqual([]);
  });
});
