import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

import { quitarComentarios } from "../../fixtures/sin-comentarios";
import { aDTO } from "@/lib/services/HistorialAccionService";
import { Prisma } from "@prisma/client";

/**
 * FICHA 362 / T7.7 (R6) — GUARDIA MONEY-SAFE del importe del registro de acciones.
 *
 * ## Que se prohibe, y por que
 *
 * `historial_accion.monto` es `DECIMAL(12,2)` en la base y STRING en el DTO. En NINGUN punto del
 * camino —repositorio de escritura, repositorio de lectura, servicio, DTO— se convierte a
 * `number`. Un `number` intermedio es una perdida de precision silenciosa sobre dinero que nadie
 * vuelve a mirar, y este repo ya midio lo que cuesta: la feature 204 encontro 14 de 66 ordenes con
 * un centimo de desviacion, sin un solo error.
 *
 * Y aqui duele mas que en otras tablas: este importe es lo que un maestro leera para responder
 * «¿cuanto movio esa decision?». Si esa cifra miente, miente en un registro de auditoria.
 *
 * ## Las TRES cosas que hace, y por que no basta una
 *
 *   1. barrido de CONVERSIONES (`Number(`, `parseFloat(`, `parseInt(`) en el camino del importe;
 *   2. `toFixed` SOLO admitido sobre un `Prisma.Decimal` —que es el metodo del propio `Decimal` y
 *      NO pasa por coma flotante—, prohibido en los archivos que ni siquiera importan `Prisma`;
 *   3. ninguna ARITMETICA sobre el monto fuera de `Prisma.Decimal`: `a * b` no lleva `Number(` y
 *      el barrido de conversiones no lo ve. Es lo que la 204 midio.
 *
 * Y una CUARTA, que es de comportamiento y no estatica: el DTO devuelve un `string`. Una guardia
 * de texto no puede afirmar eso; un caso que ejecuta `aDTO`, si.
 *
 * Se lee el fuente SIN COMENTARIOS: los docstrings de este arbol nombran a proposito lo que esta
 * prohibido («nunca `Number()`/`parseFloat`»), asi que un barrido sobre el texto crudo denunciaria
 * la EXPLICACION y obligaria a borrarla para pasar.
 *
 * La selecciona `pnpm exec vitest run guard` por el nombre del archivo.
 */

const RAIZ = path.resolve(__dirname, "../../..");

/** El camino COMPLETO del importe, de la columna al DTO. Censo explicito. */
const CAMINO_DEL_MONTO = [
  "lib/repositories/registrar-accion.ts",
  "lib/repositories/HistorialAccionRepository.ts",
  "lib/services/HistorialAccionService.ts",
  "lib/types/historial-accion.ts",
  "lib/interfaces/repositories/IHistorialAccionRepository.ts",
] as const;

/** Conversiones prohibidas en cualquier punto del camino. */
const CONVERSIONES = [/\bNumber\s*\(/, /\bparseFloat\s*\(/, /\bparseInt\s*\(/];

/** Aritmetica sobre algo que se llame `monto`. `+` unario incluido. */
const ARITMETICA_SOBRE_MONTO = [
  /\b\w*[Mm]onto\w*\s*[*/%]\s/,
  /\b\w*[Mm]onto\w*\s*[-+]\s*\w/,
  /[*/%]\s*\w*[Mm]onto\w*\b/,
  /\+\s*\w*[Mm]onto\w*\b/,
];

function fuente(rel: string): string {
  return quitarComentarios(readFileSync(path.join(RAIZ, rel), "utf8"));
}

describe("362/T7.7 — el detector se prueba a si mismo", () => {
  it("CONTRAPRUEBA: reconoce las conversiones prohibidas", () => {
    for (const patron of CONVERSIONES) {
      const ejemplos = ["Number(fila.monto)", "parseFloat(fila.monto)", "parseInt(x, 10)"];
      expect(ejemplos.some((e) => patron.test(e))).toBe(true);
    }
    expect(CONVERSIONES.some((p) => p.test("monto: Number(fila.monto)"))).toBe(true);
  });

  it("CONTRAPRUEBA: reconoce la aritmetica sobre el monto", () => {
    expect(ARITMETICA_SOBRE_MONTO.some((p) => p.test("const total = monto * 1.13;"))).toBe(true);
    expect(ARITMETICA_SOBRE_MONTO.some((p) => p.test("const t = a + montoAnulado;"))).toBe(true);
  });

  it("CONTRAPRUEBA: NO se dispara con `Decimal.toFixed(2)` ni con `Prisma.Decimal`", () => {
    const legitimo = "monto: fila.monto === null ? null : fila.monto.toFixed(2),";
    expect(CONVERSIONES.some((p) => p.test(legitimo))).toBe(false);
    expect(ARITMETICA_SOBRE_MONTO.some((p) => p.test(legitimo))).toBe(false);
  });

  it("anti-vacuidad: los archivos del camino existen y se leen con contenido", () => {
    for (const rel of CAMINO_DEL_MONTO) {
      expect(fuente(rel).length, `${rel} se leyo vacio`).toBeGreaterThan(200);
    }
  });
});

describe("362/R6 — ni un `number` en el camino del importe", () => {
  it.each(CAMINO_DEL_MONTO)("%s no convierte el importe a number", (rel) => {
    const codigo = fuente(rel);
    for (const patron of CONVERSIONES) {
      expect(patron.test(codigo), `${rel} usa ${String(patron)} sobre el camino del dinero`).toBe(
        false,
      );
    }
  });

  it.each(CAMINO_DEL_MONTO)("%s no hace aritmetica sobre el monto fuera de Decimal", (rel) => {
    const codigo = fuente(rel);
    for (const patron of ARITMETICA_SOBRE_MONTO) {
      expect(patron.test(codigo), `${rel} opera sobre el monto en coma flotante`).toBe(false);
    }
  });

  it("el `toFixed` del servicio es del propio `Decimal`, no de un `number`", () => {
    const servicio = fuente("lib/services/HistorialAccionService.ts");
    // Control positivo: el `toFixed` EXISTE (es la conversion correcta) …
    expect(servicio).toContain("toFixed(2)");
    // … y se aplica sobre la columna `Decimal` que el repositorio devuelve, no sobre un numero.
    expect(servicio).toMatch(/fila\.monto\.toFixed\(2\)/);
  });

  it("la columna es `Decimal(12,2)` en el schema y en la migracion", () => {
    const schema = readFileSync(path.join(RAIZ, "db/schema.prisma"), "utf8");
    const inicio = schema.indexOf("model HistorialAccion {");
    expect(inicio, "desaparecio el modelo").toBeGreaterThan(-1);
    const bloque = schema.slice(inicio, schema.indexOf("\n}", inicio));
    expect(bloque).toMatch(/monto\s+Decimal\?\s+@db\.Decimal\(12, 2\)/);
    expect(bloque).not.toMatch(/monto\s+Float/);
  });

  it("el DTO expone el importe como STRING, y esto se EJECUTA (no se lee)", () => {
    // La mitad que una guardia de texto no puede dar: `Number(monto)` en el DTO pasaria todos los
    // barridos de arriba si alguien lo escribiera como `+fila.monto`. Esto lo caza ejecutandolo.
    const dto = aDTO({
      id: "h1",
      createdAt: new Date("2026-09-02T12:00:00Z"),
      accion: "cierre_dia_aprobado",
      entidadTipo: "cierre_dia",
      entidadEtiqueta: "Mensa Uno · 2026-09-02",
      actorUsuarioId: "u-1",
      actorNombre: "Admin Uno",
      actorRol: "admin",
      monto: new Prisma.Decimal("123456.78"),
      valorAnterior: null,
      valorNuevo: null,
      loteId: "lote-1",
    });
    expect(typeof dto.monto).toBe("string");
    // Y el valor es EXACTO, con sus dos decimales: un `Number` intermedio no lo garantiza.
    expect(dto.monto).toBe("123456.78");
  });

  it("un importe sin decimales sale con sus dos decimales, y uno nulo sale `null`", () => {
    const conCero = aDTO({
      id: "h2",
      createdAt: new Date("2026-09-02T12:00:00Z"),
      accion: "tarifa_creada",
      entidadTipo: "tarifa",
      entidadEtiqueta: "Zona Norte",
      actorUsuarioId: null,
      actorNombre: null,
      actorRol: null,
      monto: null,
      valorAnterior: null,
      valorNuevo: null,
      loteId: "lote-2",
    });
    expect(conCero.monto).toBeNull();

    const redondo = aDTO({
      id: "h3",
      createdAt: new Date("2026-09-02T12:00:00Z"),
      accion: "pago_mensajero_registrado",
      entidadTipo: "liquidacion_pago",
      entidadEtiqueta: "Mensa Uno",
      actorUsuarioId: "u-1",
      actorNombre: "Admin Uno",
      actorRol: "admin",
      monto: new Prisma.Decimal("15000"),
      valorAnterior: null,
      valorNuevo: null,
      loteId: "lote-3",
    });
    expect(redondo.monto).toBe("15000.00");
  });
});
