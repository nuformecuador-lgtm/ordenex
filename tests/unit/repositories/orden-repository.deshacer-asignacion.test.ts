import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import { type PrismaClient } from "@prisma/client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { DeshacerAsignacionConflictoError } from "@/lib/interfaces/repositories/IOrdenRepository";
import { idEstado, sembrarCatalogoEstados } from "@/tests/fixtures/catalogo-estados";

// Feature 149 — T2.2 / T4.12 / T4.14(b): writer transaccional de la reversion.
//   - UPDATE por orden guardado por estado de ORIGEN (+ zona opcional), sin guarda de cierre;
//   - todo-o-nada REAL: si una orden no gana su guarda, lanza y revierte la tx;
//   - historial `deshacer_asignacion` + motivo en la MISMA tx;
//   - `num_guia` y `prioridad` NO aparecen en el SET (D2/R29, Q2/R30);
//   - el ancla `TODO(146)` vive en el fuente (R41).

const HIST = {
  actorUsuarioId: "maestro-1",
  origenTipo: "deshacer_asignacion",
  motivo: "mensajero equivocado, se reasigna al de la ruta norte",
} as const;

/**
 * Doble de Prisma que distingue la consulta por su SQL: el pre-read (`SELECT ... FROM "orden"`)
 * devuelve los mensajeros previos y el `UPDATE` devuelve las filas que ganan la guarda. Por
 * defecto todas ganan.
 */
/** Aplana un fragmento `Prisma.sql` anidado a su texto (lo que Prisma inlinea de verdad). */
function textoDe(valor: unknown): string | null {
  const strings = (valor as { strings?: readonly string[] } | null)?.strings;
  return Array.isArray(strings) ? strings.join(" ") : null;
}

/** Aplana los valores parametrizados, incluidos los de los fragmentos anidados. */
function valoresDe(values: unknown[]): unknown[] {
  return values.flatMap((v) => {
    const inner = (v as { values?: unknown[] } | null)?.values;
    return Array.isArray(inner) ? valoresDe(inner) : [v];
  });
}

function buildPrisma(opciones: { perdedoras?: Set<string> } = {}) {
  const perdedoras = opciones.perdedoras ?? new Set<string>();
  const updates: { sql: string; values: unknown[] }[] = [];
  const $queryRaw = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    // Reconstruye el SQL como lo hace Prisma: los fragmentos `Prisma.sql` anidados se INLINEAN
    // en el texto (no son parametros), los escalares quedan como placeholders.
    const partes = (strings as unknown as string[]).map(
      (s, i) => s + (i < values.length ? (textoDe(values[i]) ?? "") : ""),
    );
    const sql = partes.join(" ");
    if (sql.includes("UPDATE")) {
      updates.push({ sql, values: valoresDe(values) });
      const ordenId = values[1] as string; // destino, ordenId, origen, [fragmento de zona]
      return perdedoras.has(ordenId) ? [] : [{ id: ordenId }];
    }
    if (sql.includes("webhook_suscripcion")) return [];
    if (sql.includes("order_status")) return [];
    return []; // pre-read del lote
  });
  const tx = {
    $queryRaw,
    $executeRaw: vi.fn(),
    ordenHistorialEstado: { createMany: vi.fn() },
  };
  const prisma = { $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(tx)) };
  return { prisma, tx, updates, $queryRaw };
}

function items() {
  return [
    { ordenId: "o1", destinoEstatusId: idEstado("en_bodega_central") },
    { ordenId: "o2", destinoEstatusId: idEstado("en_bodega_satelite") },
  ];
}

function origenes() {
  return new Map([
    ["o1", idEstado("por_recoger")],
    ["o2", idEstado("por_recoger")],
  ]);
}

beforeEach(async () => {
  await sembrarCatalogoEstados(); // feature 140: la guardia del choke point es de fallo CERRADO
});

describe("OrdenRepository.deshacerAsignacionLote — escritura guardada (R8/R9/R10/R21)", () => {
  it("un UPDATE por orden, guardado por estado de origen + no borrada, con RETURNING", async () => {
    const { prisma, updates } = buildPrisma();
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const count = await repo.deshacerAsignacionLote(items(), origenes(), HIST, null);

    expect(count).toBe(2);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(updates).toHaveLength(2);
    const sql = updates[0].sql;
    expect(sql).toMatch(/"estatus_id" = /);
    expect(sql).toMatch(/"mensajero_asignado_id" = NULL/); // R8
    expect(sql).toMatch(/"asignado_at" = NULL/); // R9
    expect(sql).toMatch(/AND "estatus_id" = /); // guarda anti-TOCTOU por origen (R21)
    expect(sql).toMatch(/AND "deleted_at" IS NULL/);
    expect(sql).toMatch(/RETURNING "id"/);
    // Los ids y estatus viajan parametrizados, no concatenados.
    expect(updates[0].values).toContain("o1");
    expect(updates[0].values).toContain(idEstado("por_recoger"));
    expect(updates[0].values).toContain(idEstado("en_bodega_central"));
  });

  it("R29/R30 (T4.12): el SET NO menciona num_guia ni prioridad", async () => {
    const { prisma, updates } = buildPrisma();
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.deshacerAsignacionLote(items(), origenes(), HIST, null);

    for (const u of updates) {
      // La AUSENCIA es el mecanismo: la guia impresa sigue valida (D2) y la prioridad queda
      // como la dejo la asignacion (Q2, limitacion conocida y aceptada).
      expect(u.sql).not.toMatch(/num_guia/);
      expect(u.sql).not.toMatch(/prioridad/);
    }
  });

  it("R19 (Q1 CERRADA): el UPDATE NO lleva guarda de cierre_dia (asimetria con asignar)", async () => {
    const { prisma, updates } = buildPrisma();
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.deshacerAsignacionLote(items(), origenes(), HIST, null);

    for (const u of updates) {
      expect(u.sql).not.toMatch(/cierre_dia/);
      expect(u.sql).not.toMatch(/NOT EXISTS/);
    }
  });

  it("con zonaId no-null (adminSatelite) añade la guarda de zona al WHERE", async () => {
    const { prisma, updates } = buildPrisma();
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.deshacerAsignacionLote(
      [{ ordenId: "o1", destinoEstatusId: idEstado("en_bodega_satelite") }],
      new Map([["o1", idEstado("por_recoger")]]),
      HIST,
      "z-satelite",
    );

    expect(updates[0].sql).toMatch(/AND "zona_id" = /);
    expect(updates[0].values).toContain("z-satelite");
  });

  it("con zonaId null (maestro/admin) NO añade guarda de zona: cualquier zona (R3)", async () => {
    const { prisma, updates } = buildPrisma();
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.deshacerAsignacionLote(items(), origenes(), HIST, null);

    for (const u of updates) expect(u.sql).not.toMatch(/"zona_id"/);
  });

  it("devuelve 0 sin abrir transaccion con el lote vacio", async () => {
    const { prisma, tx } = buildPrisma();
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    expect(await repo.deshacerAsignacionLote([], new Map(), HIST, null)).toBe(0);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.ordenHistorialEstado.createMany).not.toHaveBeenCalled();
  });
});

describe("R20/R21 — todo-o-nada REAL: una perdedora aborta el lote entero", () => {
  it("lanza DeshacerAsignacionConflictoError con los ids que no transicionaron", async () => {
    const { prisma, tx } = buildPrisma({ perdedoras: new Set(["o2"]) });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await expect(repo.deshacerAsignacionLote(items(), origenes(), HIST, null)).rejects.toThrow(
      DeshacerAsignacionConflictoError,
    );
    // El throw revierte la tx: ni historial ni webhook para la ganadora o1 (R33).
    expect(tx.ordenHistorialEstado.createMany).not.toHaveBeenCalled();
  });

  it("el error expone los ids no transicionados para que el service componga el detalle", async () => {
    const { prisma } = buildPrisma({ perdedoras: new Set(["o1", "o2"]) });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const error = await repo
      .deshacerAsignacionLote(items(), origenes(), HIST, null)
      .catch((e: unknown) => e as DeshacerAsignacionConflictoError);

    expect(error).toBeInstanceOf(DeshacerAsignacionConflictoError);
    expect([...(error as DeshacerAsignacionConflictoError).ordenIdsNoTransicionadas]).toEqual([
      "o1",
      "o2",
    ]);
  });

  it("una orden sin origen en el mapa NO se toca y aborta el lote (fallo CERRADO)", async () => {
    const { prisma, updates, tx } = buildPrisma();
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await expect(
      repo.deshacerAsignacionLote(items(), new Map([["o1", idEstado("por_recoger")]]), HIST, null),
    ).rejects.toThrow(DeshacerAsignacionConflictoError);
    expect(updates.map((u) => u.values[1])).toEqual(["o1"]); // o2 nunca se intento
    expect(tx.ordenHistorialEstado.createMany).not.toHaveBeenCalled();
  });
});

describe("R23/R31/R32 — historial y webhook en la MISMA transaccion", () => {
  it("registra una fila por orden con origen real, destino, actor, tipo y motivo", async () => {
    const { prisma, tx } = buildPrisma();
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.deshacerAsignacionLote(items(), origenes(), HIST, null);

    expect(tx.ordenHistorialEstado.createMany).toHaveBeenCalledTimes(1);
    const arg = tx.ordenHistorialEstado.createMany.mock.calls[0][0] as {
      data: Record<string, unknown>[];
    };
    expect(arg.data).toEqual([
      {
        ordenId: "o1",
        estatusOrigenId: idEstado("por_recoger"),
        estatusDestinoId: idEstado("en_bodega_central"),
        actorUsuarioId: "maestro-1",
        origenTipo: "deshacer_asignacion",
        motivo: HIST.motivo,
        gestionOrdenId: null, // R26: esta familia NUNCA enlaza una gestion
      },
      {
        ordenId: "o2",
        estatusOrigenId: idEstado("por_recoger"),
        estatusDestinoId: idEstado("en_bodega_satelite"),
        actorUsuarioId: "maestro-1",
        origenTipo: "deshacer_asignacion",
        motivo: HIST.motivo,
        gestionOrdenId: null,
      },
    ]);
  });

  it("R27: la guardia REAL de la 140 acepta el caso (b) en_ruta_bodega_satelite -> central", async () => {
    const { prisma, tx } = buildPrisma();
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const count = await repo.deshacerAsignacionLote(
      [{ ordenId: "o3", destinoEstatusId: idEstado("en_bodega_central") }],
      new Map([["o3", idEstado("en_ruta_bodega_satelite")]]),
      HIST,
      null,
    );

    expect(count).toBe(1); // sin TransicionIlegalError: la arista #45 esta declarada
    expect(tx.ordenHistorialEstado.createMany).toHaveBeenCalledTimes(1);
  });
});

describe("R41 (T4.14b) — ancla TODO(146) para la campana de notificaciones", () => {
  const fuente = fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "lib", "repositories", "OrdenRepository.ts"),
    "utf8",
  );

  /**
   * Valla de FIN del metodo: el comentario de seccion que va justo despues de
   * `deshacerAsignacionLote`. No es un contrato de redaccion, es un delimitador — pero si deja de
   * encontrarse, `indexOf` devuelve -1 y el `slice` se tragaria medio archivo en silencio. De ahi
   * el `expect(hasta).toBeGreaterThan(desde)` de cada caso, que es lo que hace ruidoso el fallo.
   *
   * Feature 241 (2026-08-20): la valla cambio de texto. Decia «Feature 41: bloqueo derivado en
   * asignacion» y ese «en asignacion» era justo lo que dejo de ser cierto — el predicado bloquea
   * la GESTION, no la asignacion. Se actualiza aqui y la guardia sigue midiendo lo mismo.
   */
  const FIN_DEL_METODO = "// --- Feature 41 -> 241: bloqueo derivado para GESTIONAR";

  it("el ancla literal `TODO(146)` vive dentro de deshacerAsignacionLote", () => {
    const desde = fuente.indexOf("async deshacerAsignacionLote(");
    expect(desde).toBeGreaterThan(-1);
    // Fin del metodo: el comentario de seccion de la feature 41, que va justo despues.
    const hasta = fuente.indexOf(FIN_DEL_METODO, desde);
    expect(hasta).toBeGreaterThan(desde);
    const cuerpo = fuente.slice(desde, hasta);
    expect(cuerpo).toContain("TODO(146)");
    // El ancla describe el destinatario y el contenido del aviso diferido (R41).
    expect(cuerpo).toContain("mensajero desasignado");
    expect(cuerpo).toContain("fue retirada de tus asignaciones");
  });

  it("el pre-read captura el mensajero previo, insumo del aviso de la 146", () => {
    const desde = fuente.indexOf("async deshacerAsignacionLote(");
    const hasta = fuente.indexOf(FIN_DEL_METODO, desde);
    expect(fuente.slice(desde, hasta)).toContain("mensajero_asignado_id");
  });
});
