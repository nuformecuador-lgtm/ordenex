import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import type { PrismaClient } from "@prisma/client";
import { OrdenMensajeroMetaRepository } from "@/lib/repositories/OrdenMensajeroMetaRepository";
import { OrdenMensajeroMetaService } from "@/lib/services/OrdenMensajeroMetaService";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { OrdenDTO } from "@/lib/types/orden";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 115 — T7. Prisma mockeado con SEMANTICA (patron del resto de
// tests/integration/repositories: la suite NO levanta Postgres). El fake ejecuta el
// comportamiento que importa de `orden_mensajero_meta`: upsert idempotente por la pareja
// (usuario, orden) y lectura filtrada por mensajero + marca. Las propiedades de la MIGRACION
// (RLS, ambas columnas, reversibilidad) se cubren con aserciones ESTATICAS sobre el SQL.
//
// El round-trip REAL (up -> down -> up) contra un Postgres real lo verifica el humano
// (patron api_key-migration); aqui protegemos que el SQL escrito a mano no se desvie del
// diseño y que la logica repo+service se comporte.

const MENSAJERO_1: Actor = { usuarioId: "m1", rol: "mensajero" };
const MENSAJERO_2: Actor = { usuarioId: "m2", rol: "mensajero" };

interface Fila {
  id: string;
  usuarioId: string;
  ordenId: string;
  marcarLuego: boolean;
  nota: string | null;
}

// Fake semantico de `prisma.ordenMensajeroMeta`: upsert por el UNIQUE(usuario_id, orden_id)
// y findMany con el WHERE { usuarioId, marcarLuego } + select { ordenId }.
function buildPrisma(filas: Fila[] = []) {
  let seq = 0;
  const ordenMensajeroMeta = {
    upsert: vi.fn(
      async (args: {
        where: { usuarioId_ordenId: { usuarioId: string; ordenId: string } };
        create: { usuarioId: string; ordenId: string; marcarLuego: boolean };
        update: { marcarLuego: boolean };
      }) => {
        const { usuarioId, ordenId } = args.where.usuarioId_ordenId;
        const existente = filas.find((f) => f.usuarioId === usuarioId && f.ordenId === ordenId);
        if (existente) {
          existente.marcarLuego = args.update.marcarLuego;
          return existente;
        }
        const nueva: Fila = {
          id: `meta-${++seq}`,
          usuarioId: args.create.usuarioId,
          ordenId: args.create.ordenId,
          marcarLuego: args.create.marcarLuego,
          nota: null,
        };
        filas.push(nueva);
        return nueva;
      },
    ),
    findMany: vi.fn(
      async (args: { where: { usuarioId: string; marcarLuego: boolean }; select: { ordenId: true } }) => {
        return filas
          .filter((f) => f.usuarioId === args.where.usuarioId && f.marcarLuego === args.where.marcarLuego)
          .map((f) => ({ ordenId: f.ordenId }));
      },
    ),
  };
  return { prisma: { ordenMensajeroMeta } as unknown as PrismaClient, filas };
}

function ordenDTO(over: Partial<OrdenDTO> = {}): OrdenDTO {
  return {
    id: "o1",
    numGuia: 1001,
    numRemision: "REM-1",
    estatusId: "os-reparto",
    estatusValue: "en_ruta",
    destinatario: "Ana",
    telefonoDest: "88880000",
    tiendaId: "t1",
    zonaId: "z1",
    provinciaId: "p1",
    cantonId: "c1",
    distritoId: null,
    producto: "Caja",
    peso: 1,
    notas: null,
    mensajeroAsignadoId: "m1", // asignada a MENSAJERO_1
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

// ordenRepo de solo lectura: findById devuelve la orden de m1. Los mutadores son spies para
// afirmar que el toggle NO los toca (R15/R16).
function fakeOrdenRepo(orden: OrdenDTO = ordenDTO()) {
  return {
    findById: vi.fn(async () => orden),
    update: vi.fn(async () => orden),
    softDelete: vi.fn(async () => true),
  };
}

function buildStack(filas: Fila[] = []) {
  const { prisma, filas: store } = buildPrisma(filas);
  const repo = new OrdenMensajeroMetaRepository(prisma);
  const ordenRepo = fakeOrdenRepo();
  const service = new OrdenMensajeroMetaService(
    repo,
    ordenRepo as unknown as Pick<IOrdenRepository, "findById">,
  );
  return { repo, service, ordenRepo, store };
}

describe("R7 — el upsert no crea filas duplicadas para el mismo (usuario, orden)", () => {
  it("dos toggles sobre la misma pareja dejan EXACTAMENTE una fila con el ultimo valor", async () => {
    const { service, store } = buildStack();
    await service.marcarGestionarLuego({ ordenId: "o1", marcarLuego: true }, MENSAJERO_1);
    await service.marcarGestionarLuego({ ordenId: "o1", marcarLuego: true }, MENSAJERO_1); // idempotente
    await service.marcarGestionarLuego({ ordenId: "o1", marcarLuego: false }, MENSAJERO_1); // flip
    expect(store).toHaveLength(1);
    expect(store[0].marcarLuego).toBe(false);
  });
});

describe("R8 — el usuario_id persistido es el del actor (fijado por el service)", () => {
  it("el service escribe la fila con usuario_id = actor, no un dato del input", async () => {
    const { service, store } = buildStack();
    await service.marcarGestionarLuego(
      { ordenId: "o1", marcarLuego: true, usuarioId: "hacker" } as never,
      MENSAJERO_1,
    );
    expect(store).toHaveLength(1);
    expect(store[0].usuarioId).toBe("m1");
  });
});

describe("R17 — lectura de las marcas del mensajero", () => {
  it("findMarcarLuegoByMensajero devuelve solo las ordenId con marcar_luego=true del mensajero", async () => {
    const { repo, service } = buildStack();
    await service.marcarGestionarLuego({ ordenId: "o1", marcarLuego: true }, MENSAJERO_1);
    // Otra orden marcada false: no debe aparecer.
    await service.marcarGestionarLuego({ ordenId: "o1", marcarLuego: false }, MENSAJERO_1);
    await service.marcarGestionarLuego({ ordenId: "o1", marcarLuego: true }, MENSAJERO_1);
    const set = await repo.findMarcarLuegoByMensajero("m1");
    expect([...set]).toEqual(["o1"]);
  });
});

describe("R8/R20 — un mensajero no ve las marcas de otro", () => {
  it("la fila de m1 no aparece en la lectura de m2", async () => {
    // Sembramos una marca de m1 y consultamos como m2.
    const { repo, store } = buildStack([
      { id: "meta-seed", usuarioId: "m1", ordenId: "o1", marcarLuego: true, nota: null },
    ]);
    expect([...(await repo.findMarcarLuegoByMensajero("m2"))]).toEqual([]); // m2 no ve nada
    expect([...(await repo.findMarcarLuegoByMensajero("m1"))]).toEqual(["o1"]); // m1 si
    expect(store).toHaveLength(1); // consultar no crea filas
  });

  it("R20: m2 marcando o1 crea una fila PROPIA, no toca la de m1", async () => {
    const { service, store } = buildStack([
      { id: "meta-seed", usuarioId: "m1", ordenId: "o1", marcarLuego: true, nota: null },
    ]);
    // o1 esta asignada a m1; m2 no puede marcarla -> forbidden, sin fila nueva.
    const r = await service.marcarGestionarLuego({ ordenId: "o1", marcarLuego: true }, MENSAJERO_2);
    expect(r.status).toBe("forbidden");
    expect(store).toHaveLength(1);
    expect(store[0].usuarioId).toBe("m1");
  });
});

describe("R15/R16 — la orden no cambia de estado ni de ruta tras marcar", () => {
  it("el toggle solo escribe en orden_mensajero_meta; no muta la orden", async () => {
    const { service, ordenRepo } = buildStack();
    await service.marcarGestionarLuego({ ordenId: "o1", marcarLuego: true }, MENSAJERO_1);
    expect(ordenRepo.findById).toHaveBeenCalledTimes(1); // solo lectura de la guarda
    expect(ordenRepo.update).not.toHaveBeenCalled();
    expect(ordenRepo.softDelete).not.toHaveBeenCalled();
  });
});

// --- Cobertura ESTATICA de la migracion (R1/R2/R3/R4) ---

const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "..", "db", "migrations");

function migrationDirFor(nombre: string): string {
  const dirs = fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => new RegExp(`^\\d+_${nombre}$`).test(name));
  if (dirs.length !== 1) throw new Error(`Se esperaba 1 carpeta para ${nombre}, hay ${dirs.length}`);
  return path.join(MIGRATIONS_DIR, dirs[0]);
}

function sinComentarios(sql: string): string {
  return sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");
}

const migDir = migrationDirFor("orden_mensajero_meta");
const upExec = sinComentarios(fs.readFileSync(path.join(migDir, "migration.sql"), "utf8"));
const downExec = sinComentarios(fs.readFileSync(path.join(migDir, "down.sql"), "utf8"));

describe("migracion UP — orden_mensajero_meta (R1/R2/R3)", () => {
  it("R1: crea la tabla con marcar_luego BOOLEAN NOT NULL DEFAULT false", () => {
    expect(upExec).toMatch(/CREATE TABLE\s+"orden_mensajero_meta"/);
    expect(upExec).toMatch(/"marcar_luego"\s+BOOLEAN\s+NOT NULL\s+DEFAULT\s+false/);
  });

  it("R2: la MISMA migracion crea la columna nota TEXT NULLABLE (para la feature 116)", () => {
    expect(upExec).toMatch(/"nota"\s+TEXT\b(?!\s+NOT NULL)/);
  });

  it("R1/R7: UNIQUE sobre (usuario_id, orden_id)", () => {
    expect(upExec).toMatch(
      /CREATE UNIQUE INDEX\s+"orden_mensajero_meta_usuario_id_orden_id_key"\s+ON\s+"orden_mensajero_meta"\("usuario_id",\s*"orden_id"\)/,
    );
  });

  it("dos FK ON DELETE CASCADE a usuario y orden", () => {
    expect(upExec).toMatch(
      /"orden_mensajero_meta_usuario_id_fkey"[\s\S]*?REFERENCES\s+"usuario"\("id"\)\s+ON DELETE CASCADE/,
    );
    expect(upExec).toMatch(
      /"orden_mensajero_meta_orden_id_fkey"[\s\S]*?REFERENCES\s+"orden"\("id"\)\s+ON DELETE CASCADE/,
    );
  });

  it("indices de las dos FK (lectura por mensajero, R17)", () => {
    expect(upExec).toMatch(/CREATE INDEX\s+"orden_mensajero_meta_usuario_id_idx"/);
    expect(upExec).toMatch(/CREATE INDEX\s+"orden_mensajero_meta_orden_id_idx"/);
  });

  it("R3: habilita RLS y NO define ninguna policy (solo service role)", () => {
    expect(upExec).toMatch(/ALTER TABLE\s+"orden_mensajero_meta"\s+ENABLE ROW LEVEL SECURITY/);
    expect(upExec).not.toMatch(/CREATE POLICY/i);
  });

  it("es aditiva: no altera ni borra tablas existentes", () => {
    expect(upExec).not.toMatch(/DROP TABLE/i);
    expect(upExec).not.toMatch(/ALTER TABLE\s+"usuario"/i);
    expect(upExec).not.toMatch(/ALTER TABLE\s+"orden"\s/i);
  });
});

describe("migracion DOWN — revierte exactamente (R4)", () => {
  it("R4: DROP TABLE arrastra PK, indices, FKs y RLS", () => {
    expect(downExec).toMatch(/DROP TABLE IF EXISTS\s+"orden_mensajero_meta"/);
  });
});
