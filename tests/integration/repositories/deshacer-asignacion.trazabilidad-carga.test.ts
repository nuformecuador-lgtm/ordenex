import { describe, it, expect, vi, beforeEach } from "vitest";
import { type PrismaClient } from "@prisma/client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { idEstado, sembrarCatalogoEstados } from "@/tests/fixtures/catalogo-estados";

// Feature 141 x 149 — INVARIANTE DE FRONTERA: una orden a la que se le DESHACE la asignacion
// NO PIERDE LA TRAZABILIDAD DE SU CARGA.
//
// QUE se protege (y por que importa)
//   `orden.carga_id` y `orden.download_url` (columnas de la 141) son el unico rastro de POR QUE
//   canal entro la orden al sistema —de que carga masiva salio, junto a que otras ordenes— y de
//   que PDF de etiquetas se genero para ella. Deshacer la asignacion revierte el REPARTO
//   (mensajero + estado): la orden sigue siendo la MISMA orden del MISMO lote, y su origen no
//   se toca. Si una reversion desvinculara la orden de su carga, el lote quedaria contando
//   ordenes que ya no se reconocen suyas y la guia impresa apuntaria a un PDF sin dueño. El
//   invariante NO es "no escribir dos columnas": es que una orden revertida siga siendo
//   rastreable hasta la carga que la creo.
//
// POR QUE existe este test
//   El codigo que podria romperlo es de la 149 (`OrdenRepository.deshacerAsignacionLote`), y hoy
//   NO lo rompe: su `SET` simplemente no menciona esas columnas. Pero lo cumplia por AUSENCIA,
//   sin red: el re-review del PR #168 aplico la mutacion "añade `carga_id = NULL,
//   download_url = NULL` al SET" y los 7110 tests del repo siguieron en verde (mutante M10
//   superviviente). Cualquier ampliacion futura de ese SET "por limpieza" se llevaria la
//   trazabilidad por delante sin que nadie se enterara.
//
// POR QUE VIVE AQUI Y NO CON LOS VECINOS UNITARIOS
//   Los otros tests de `deshacerAsignacionLote` (`tests/unit/repositories/
//   orden-repository.deshacer-asignacion.test.ts`) afirman la FORMA del SQL
//   (`expect(sql).not.toMatch(/num_guia/)`). Un aserto de esa familia aqui fijaria el TEXTO del
//   SET, no el comportamiento: seguiria verde el dia que la orden perdiera su lote por otra via
//   (un UPDATE adicional, un `updateMany` de Prisma). Este test vive con los de SEMANTICA
//   (`tests/integration/repositories`, patron de `deshacer-asignacion.historial.test.ts`): el
//   `$queryRaw` APLICA el UPDATE sobre una fila en memoria y el aserto mira LA FILA RESULTANTE.
//
// NOTA DE SPEC: ningun requisito R1-R55 de la 141 enuncia hoy este invariante (R36 cubre el
// camino de CARGA —todas las creadas del batch llevan el mismo `carga_id`—, no el de REVERSION).
// Queda propuesto como requisito propio en `progress/impl_141.md`; el test no lo da por escrito.

const HIST = {
  actorUsuarioId: "u-maestro",
  origenTipo: "deshacer_asignacion",
  motivo: "el mensajero no paso por la bodega: las ordenes vuelven al inventario",
} as const;

const LOTE = "carga-2026-07-30-tienda-1";
const ETIQUETAS = "https://storage.example/etiquetas/carga-2026-07-30-tienda-1.pdf";

type Valor = string | number | Date | null;
type FilaOrden = Record<string, Valor>;

// --- Base en memoria: aplica el UPDATE de verdad sobre la fila -----------------------------
//
// No interpreta "la consulta que esperamos": reconstruye el SQL como lo hace Prisma, parsea el
// SET y el WHERE que le llegan y los EJECUTA sobre las filas. Por eso una columna nueva en el
// SET se aplica sola, sin tocar el test. Toda expresion que no sabe evaluar LANZA: una base que
// no entiende lo que le mandan no puede afirmar nada sobre la fila resultante.

interface Fragmento {
  strings: readonly string[];
  values: readonly unknown[];
}

function esFragmento(valor: unknown): valor is Fragmento {
  return (
    typeof valor === "object" && valor !== null && Array.isArray((valor as Fragmento).strings)
  );
}

/**
 * Reconstruye el SQL como Prisma: los `Prisma.sql` anidados (la guarda opcional de zona,
 * `Prisma.join`) se INLINEAN en el texto y los escalares quedan como `$n` sobre una lista plana
 * de parametros.
 */
function aplanar(
  strings: readonly string[],
  values: readonly unknown[],
  params: unknown[],
): string {
  return strings
    .map((texto, i) => {
      if (i >= values.length) return texto;
      const valor = values[i];
      if (esFragmento(valor)) return texto + aplanar(valor.strings, valor.values, params);
      params.push(valor);
      return `${texto}$${params.length}`;
    })
    .join("");
}

function evaluar(expr: string, params: unknown[]): Valor {
  const texto = expr.trim();
  const placeholder = /^\$(\d+)$/.exec(texto);
  if (placeholder !== null) return params[Number(placeholder[1]) - 1] as Valor;
  if (texto === "NULL") return null;
  if (texto === "NOW()") return new Date();
  throw new Error(`base en memoria: expresion SQL no soportada -> ${texto}`);
}

function ejecutarUpdate(sql: string, params: unknown[], filas: FilaOrden[]): { id: string }[] {
  const set = /SET([\s\S]*?)WHERE/.exec(sql)?.[1];
  const where = /WHERE([\s\S]*?)RETURNING/.exec(sql)?.[1];
  if (set === undefined || where === undefined) throw new Error(`UPDATE no parseable: ${sql}`);

  const condiciones = where
    .split(/\bAND\b/)
    .map((c) => c.trim())
    .filter(Boolean);
  const afectadas = filas.filter((fila) =>
    condiciones.every((cond) => {
      const esNull = /^"([a-z_]+)"\s+IS\s+NULL$/.exec(cond);
      if (esNull !== null) return fila[esNull[1]] === null;
      const igualdad = /^"([a-z_]+)"\s*=\s*(\S+)$/.exec(cond);
      if (igualdad !== null) return fila[igualdad[1]] === evaluar(igualdad[2], params);
      throw new Error(`base en memoria: condicion WHERE no soportada -> ${cond}`);
    }),
  );

  const asignaciones = set
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);
  for (const fila of afectadas) {
    for (const asignacion of asignaciones) {
      const parsed = /^"([a-z_]+)"\s*=\s*([\s\S]+)$/.exec(asignacion);
      if (parsed === null) {
        throw new Error(`base en memoria: asignacion SET no soportada -> ${asignacion}`);
      }
      fila[parsed[1]] = evaluar(parsed[2], params);
    }
  }
  return afectadas.map((fila) => ({ id: fila.id as string }));
}

function buildPrisma(filas: FilaOrden[]) {
  const $queryRaw = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const params: unknown[] = [];
    const sql = aplanar(strings, values, params);
    if (sql.includes('UPDATE "orden"')) return ejecutarUpdate(sql, params, filas);
    if (sql.includes('"webhook_suscripcion"')) return []; // sin suscriptores: no hay outbox
    if (sql.includes('FROM "order_status"')) return [];
    // Pre-read del lote (149): el mensajero PREVIO, insumo del ancla TODO(146).
    return filas.map((f) => ({ id: f.id, mensajero_asignado_id: f.mensajero_asignado_id }));
  });
  const tx = { $queryRaw, $executeRaw: vi.fn(), ordenHistorialEstado: { createMany: vi.fn() } };
  const prisma = { $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(tx)) };
  return { prisma, tx };
}

/** Orden nacida de una carga masiva: trae lote y PDF de etiquetas, y esta asignada. */
function ordenDeLote(over: Partial<FilaOrden> = {}): FilaOrden {
  return {
    id: "o1",
    estatus_id: idEstado("por_recoger"),
    mensajero_asignado_id: "m-1",
    asignado_at: new Date("2026-07-30T10:00:00.000Z"),
    deleted_at: null,
    zona_id: "z-central",
    carga_id: LOTE, // 141: de que carga masiva entro esta orden
    download_url: ETIQUETAS, // 141: que PDF de etiquetas se genero para ella
    updated_at: new Date("2026-07-30T10:00:00.000Z"),
    ...over,
  };
}

beforeEach(async () => {
  await sembrarCatalogoEstados(); // 140: la guardia del choke point es de fallo CERRADO
});

describe("141 x 149 — la orden revertida conserva la trazabilidad de su carga", () => {
  it("caso (a) por_recoger -> en_bodega_central: suelta al mensajero, NO suelta el lote", async () => {
    const fila = ordenDeLote();
    const { prisma } = buildPrisma([fila]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const count = await repo.deshacerAsignacionLote(
      [{ ordenId: "o1", destinoEstatusId: idEstado("en_bodega_central") }],
      new Map([["o1", idEstado("por_recoger")]]),
      HIST,
      null,
    );

    expect(count).toBe(1);
    // La reversion SI ocurrio sobre esta fila: sin esto, el invariante de abajo seria vacuo
    // (una fila que nadie toco "conserva" cualquier cosa).
    expect(fila.estatus_id).toBe(idEstado("en_bodega_central"));
    expect(fila.mensajero_asignado_id).toBeNull();
    expect(fila.asignado_at).toBeNull();
    // EL INVARIANTE: sigue siendo la misma orden de la misma carga, con su PDF de etiquetas.
    expect(fila.carga_id).toBe(LOTE);
    expect(fila.download_url).toBe(ETIQUETAS);
  });

  it("caso (b) con guarda de zona: cada orden del lote conserva EL SUYO, y la que no tenia sigue sin el", async () => {
    const deLote = ordenDeLote({
      id: "o1",
      estatus_id: idEstado("en_ruta_bodega_satelite"),
      zona_id: "z-satelite",
    });
    // Alta manual individual (R37): nacio sin carga. La reversion tampoco debe INVENTARLE una.
    const manual = ordenDeLote({
      id: "o2",
      estatus_id: idEstado("en_ruta_bodega_satelite"),
      zona_id: "z-satelite",
      carga_id: null,
      download_url: null,
    });
    const { prisma } = buildPrisma([deLote, manual]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const count = await repo.deshacerAsignacionLote(
      [
        { ordenId: "o1", destinoEstatusId: idEstado("en_bodega_central") },
        { ordenId: "o2", destinoEstatusId: idEstado("en_bodega_central") },
      ],
      new Map([
        ["o1", idEstado("en_ruta_bodega_satelite")],
        ["o2", idEstado("en_ruta_bodega_satelite")],
      ]),
      HIST,
      "z-satelite",
    );

    expect(count).toBe(2);
    expect(deLote.estatus_id).toBe(idEstado("en_bodega_central"));
    expect(manual.estatus_id).toBe(idEstado("en_bodega_central"));
    // La que venia de una carga la conserva entera...
    expect(deLote.carga_id).toBe(LOTE);
    expect(deLote.download_url).toBe(ETIQUETAS);
    // ...y la que no venia de ninguna sigue igual (el invariante conserva, no escribe).
    expect(manual.carga_id).toBeNull();
    expect(manual.download_url).toBeNull();
  });
});
