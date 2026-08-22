import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

import { codigoSinComentarios, quitarComentariosSql } from "../../fixtures/sin-comentarios";

/**
 * Feature 264 (B6, R10) — GUARDIA: LA LISTA DE ORDENES SIN GESTIONAR NO TOCA DINERO.
 *
 * POR QUE EXISTE, Y POR QUE ES UNA GUARDIA Y NO UN UNIT TEST.
 *
 * R19/R20/R22 dicen que estas ordenes no mueven ni un total del comprobante. Eso se puede
 * intentar demostrar con tests de comportamiento —y hay varios, emparejados, en B5, B8 y en el
 * componente—, pero la demostracion FUERTE es otra: que no exista campo donde meter un importe.
 * Una orden que el corte barrio no tiene gestion, luego no tiene `pago_mensajero`, ni recaudo, ni
 * tarifa. **Que no pueda mover un total no es una promesa de la capa de arriba: es que no hay
 * nada que sumar.**
 *
 * Y eso es exactamente lo que ningun test de comportamiento vigila. El dia que alguien añada un
 * `montoCobrar` al DTO «para mostrarlo tambien aqui», ningun caso existente se pone rojo: la
 * pantalla empieza a pintar dinero en un sitio donde el dinero no significa nada, y el paso
 * siguiente —sumarlo a un total, porque ya esta ahi— tampoco tendria por que romper nada.
 *
 * RECORRE ARCHIVOS EN VEZ DE IMPORTAR, como el resto de guardias del repo: un `import` la ataria
 * al grafo de imports, y `--rapido` selecciona por ese grafo. Leyendo el arbol entra siempre.
 *
 * ⚠️ Si esta guardia no se pone ROJA al añadir una columna `monto_cobrar DECIMAL(12,2)` a la
 * tabla y su campo al DTO (mutacion M7 de `tasks.md`), no vale nada y hay que reescribirla.
 */

const RAIZ = path.resolve(__dirname, "../../..");

/**
 * El vocabulario de dinero de este repo. No es una lista de estilo: cada palabra nombra un
 * concepto que SI existe en `cierre_detail` / `gestion_orden`, que son las tablas de las que sale
 * la liquidacion. Ninguna tiene sentido en una orden que nunca se gestiono.
 */
const VOCABULARIO_DE_DINERO: readonly string[] = [
  "monto",
  "pago",
  "cobro",
  "cobrar",
  "ingreso",
  "tarifa",
  "comision",
  "flete",
  "indemnizacion",
  "recaudo",
  "total",
  "precio",
  "saldo",
];

/** Tipos con los que se guarda dinero. Ninguno pinta nada aqui. */
const TIPOS_DE_DINERO: readonly RegExp[] = [/\bDecimal\b/, /DECIMAL/, /NUMERIC/, /@db\.Decimal/];

/**
 * Cuerpo del primer bloque `<apertura> { … }`, contando llaves. Un `slice` hasta el primer `}`
 * cortaria en el primer objeto anidado y dejaria media declaracion fuera del examen — que es la
 * forma silenciosa de que una guardia afirme de menos y siga en verde.
 */
function cuerpoDelBloque(fuente: string, apertura: string): string {
  const inicio = fuente.indexOf(apertura);
  expect(
    inicio,
    `no se encontro «${apertura}»: ¿se renombro o se movio? Esta guardia no puede quedarse ` +
      "vigilando un bloque que ya no existe.",
  ).toBeGreaterThanOrEqual(0);
  let i = fuente.indexOf("{", inicio);
  expect(i).toBeGreaterThan(inicio);
  const desde = i;
  let nivel = 0;
  for (; i < fuente.length; i += 1) {
    if (fuente[i] === "{") nivel += 1;
    else if (fuente[i] === "}") {
      nivel -= 1;
      if (nivel === 0) return fuente.slice(desde, i + 1);
    }
  }
  throw new Error(`bloque «${apertura}» sin cerrar`);
}

/** Las TRES declaraciones del mismo dato: el modelo, la fila del repositorio y el DTO. */
const DECLARACIONES: readonly { nombre: string; archivo: string; apertura: string }[] = [
  {
    nombre: "el modelo Prisma `CierreSinGestion`",
    archivo: "db/schema.prisma",
    apertura: "model CierreSinGestion",
  },
  {
    nombre: "la fila de repositorio `CierreSinGestionRow`",
    archivo: "lib/interfaces/repositories/ICierreDiaRepository.ts",
    apertura: "export interface CierreSinGestionRow",
  },
  {
    nombre: "el DTO de servicio `CierreOrdenSinGestion`",
    // Se DECLARA en el contrato del cierre del dia y se re-exporta desde el del admin: al reves,
    // la arista metia `Prisma` como VALOR en el bundle del navegador (ver el comentario alli).
    archivo: "lib/interfaces/services/ICierreDiaService.ts",
    apertura: "export interface CierreOrdenSinGestion",
  },
];

/** El `CREATE TABLE` de la migracion, localizado por SUFIJO (el timestamp puede cambiar). */
function createTableDeLaMigracion(): string {
  const dirs = fs
    .readdirSync(path.join(RAIZ, "db", "migrations"), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  const dir = dirs.find((n) => n.endsWith("_cierre_sin_gestion"));
  expect(dir, "no existe la carpeta de migracion `*_cierre_sin_gestion`").toBeDefined();
  const sql = quitarComentariosSql(
    fs.readFileSync(path.join(RAIZ, "db", "migrations", dir as string, "migration.sql"), "utf8"),
  );
  const desde = sql.indexOf('CREATE TABLE "cierre_sin_gestion"');
  expect(desde).toBeGreaterThanOrEqual(0);
  return sql.slice(desde, sql.indexOf(");", desde));
}

describe("264/R10 — la fila de una orden sin gestionar no puede llevar dinero", () => {
  for (const d of DECLARACIONES) {
    it(`${d.nombre}: ningun campo del vocabulario de dinero`, () => {
      // Sin comentarios: la prosa de estas tres declaraciones EXPLICA justamente lo que NO
      // llevan («ni monto cobrado, ni pago al mensajero, ni ingreso…»), y buscarlo sobre el texto
      // crudo daria un falso positivo en cada palabra.
      const cuerpo = cuerpoDelBloque(codigoSinComentarios(d.archivo), d.apertura).toLowerCase();
      const encontradas = VOCABULARIO_DE_DINERO.filter((p) => cuerpo.includes(p));
      expect(
        encontradas,
        `${d.nombre} nombra conceptos de dinero: ${encontradas.join(", ")}. Una orden barrida por ` +
          "el corte NO tiene gestion, luego no tiene importe que mostrar. Si de verdad hace falta " +
          "ese dato, es una decision de diseño que pasa por el spec, no por añadir un campo.",
      ).toEqual([]);
    });

    it(`${d.nombre}: ningun tipo numerico de dinero`, () => {
      const cuerpo = cuerpoDelBloque(codigoSinComentarios(d.archivo), d.apertura);
      for (const tipo of TIPOS_DE_DINERO) {
        expect(cuerpo, `${d.nombre} declara un tipo de dinero (${tipo})`).not.toMatch(tipo);
      }
    });
  }

  it("R10: tampoco en la COLUMNA — el `CREATE TABLE` no declara dinero", () => {
    // El tipo de TypeScript se puede cambiar sin migrar; la COLUMNA no. Las dos caras se afirman
    // por separado a proposito: una tabla con `monto_cobrar DECIMAL` y un DTO limpio seguiria
    // siendo un sitio donde guardar dinero de un cierre, esperando a que alguien lo lea.
    const bloque = createTableDeLaMigracion().toLowerCase();
    expect(bloque.length).toBeGreaterThan(100);
    expect(VOCABULARIO_DE_DINERO.filter((p) => bloque.includes(p))).toEqual([]);
    expect(bloque).not.toMatch(/decimal|numeric|money/);
  });

  it("la guardia mira algo: las declaraciones existen y conservan los campos que decimos", () => {
    // ⭑ CONTRAPUNTO OBLIGATORIO. Si `cuerpoDelBloque` devolviera casi nada —porque alguien
    // renombro el modelo, o porque el quitador de comentarios se llevo el fuente por delante—
    // todos los casos de arriba pasarian en verde sin haber comprobado nada. Este caso lo
    // impide, y es la diferencia entre una guardia y un adorno.
    for (const d of DECLARACIONES) {
      const cuerpo = cuerpoDelBloque(codigoSinComentarios(d.archivo), d.apertura).toLowerCase();
      expect(cuerpo.length, `${d.nombre} salio practicamente vacio`).toBeGreaterThan(80);
      for (const campo of ["destinatario", "producto", "numremision"]) {
        expect(cuerpo.replace(/_/g, ""), `${d.nombre} perdio el campo ${campo}`).toContain(campo);
      }
    }
    expect(createTableDeLaMigracion()).toMatch(/"destinatario" TEXT NOT NULL/);
  });
});
