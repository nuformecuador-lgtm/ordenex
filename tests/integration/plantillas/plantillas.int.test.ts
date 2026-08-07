import { describe, it, expect, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import { Prisma } from "@prisma/client";
import { PlantillaMensajeRepository } from "@/lib/repositories/PlantillaMensajeRepository";
import { PlantillaMensajeService } from "@/lib/services/PlantillaMensajeService";
import type { Actor } from "@/lib/interfaces/services/IPlantillaMensajeService";

// Feature 107 — T7 (R8, R10, R15, R20, R27, R28, R30, R31).
//
// La suite de vitest corre en `node` SIN levantar Postgres (patron de
// api-key-migration.test.ts). Por eso este test tiene DOS mitades:
//   1) Cobertura ESTATICA de la migracion (RLS, unicidad, text[], soft delete, down.sql)
//      -> R30/R31 y la FORMA de R27/R28 en el DDL.
//   2) Un roundtrip CRUD end-to-end a traves de Repository -> Service contra un Prisma
//      IN-MEMORY que emula `plantilla_mensaje` (create/findMany/count/findFirst/updateMany),
//      ejercitando la persistencia del array `variables` (R15), la unicidad de `nombre`
//      (R10, via P2002), la edicion (R20) y la exclusion de soft-deleted del listado
//      (R27/R28) con el MISMO codigo que corre en produccion.

const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };

// ---------------------------------------------------------------------------
// 1) Cobertura estatica de la migracion
// ---------------------------------------------------------------------------
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

const dir = migrationDirFor("plantilla_mensaje");
const upExec = sinComentarios(fs.readFileSync(path.join(dir, "migration.sql"), "utf8"));
const downExec = sinComentarios(fs.readFileSync(path.join(dir, "down.sql"), "utf8"));

describe("R30/R31: migracion plantilla_mensaje (enum + tabla + RLS, reversible)", () => {
  it("R23: crea el enum plantilla_estado con los cuatro valores exactos", () => {
    const m = upExec.match(/CREATE TYPE\s+"plantilla_estado"\s+AS ENUM\s*\(([^)]*)\)/);
    expect(m).not.toBeNull();
    const valores = (m ? m[1] : "")
      .split(",")
      .map((v) => v.trim().replace(/^'|'$/g, ""))
      .filter((v) => v.length > 0);
    expect(valores).toEqual(["activo", "inactivo", "pending", "refused"]);
  });

  it("crea la tabla con PK y estado DEFAULT 'pending' (R12)", () => {
    expect(upExec).toMatch(/CREATE TABLE\s+"plantilla_mensaje"/);
    expect(upExec).toMatch(/CONSTRAINT\s+"plantilla_mensaje_pkey"\s+PRIMARY KEY\s*\(\s*"id"\s*\)/);
    expect(upExec).toMatch(/"estado"\s+"plantilla_estado"\s+NOT NULL\s+DEFAULT\s+'pending'/);
  });

  it("R15: variables es TEXT[] NOT NULL DEFAULT '{}'", () => {
    expect(upExec).toMatch(/"variables"\s+TEXT\[\]\s+NOT NULL\s+DEFAULT\s+'\{\}'/);
  });

  it("R27: deleted_at nullable (soft delete) y FK created_by ON DELETE SET NULL", () => {
    expect(upExec).toMatch(/"deleted_at"\s+TIMESTAMP\(3\)/);
    expect(upExec).not.toMatch(/"deleted_at"\s+TIMESTAMP\(3\)\s+NOT NULL/);
    expect(upExec).toMatch(
      /"plantilla_mensaje_created_by_fkey"[\s\S]*?REFERENCES\s+"usuario"\("id"\)\s+ON DELETE SET NULL/,
    );
  });

  it("R10: indice UNIQUE sobre nombre", () => {
    expect(upExec).toMatch(
      /CREATE UNIQUE INDEX\s+"plantilla_mensaje_nombre_key"\s+ON\s+"plantilla_mensaje"\("nombre"\)/,
    );
  });

  it("R6/R28: indices de created_at, estado y deleted_at", () => {
    expect(upExec).toMatch(/CREATE INDEX\s+"plantilla_mensaje_created_at_idx"/);
    expect(upExec).toMatch(/CREATE INDEX\s+"plantilla_mensaje_estado_idx"/);
    expect(upExec).toMatch(/CREATE INDEX\s+"plantilla_mensaje_deleted_at_idx"/);
  });

  it("R30: habilita RLS y NO define ninguna policy (solo service role)", () => {
    expect(upExec).toMatch(/ALTER TABLE\s+"plantilla_mensaje"\s+ENABLE ROW LEVEL SECURITY/);
    expect(upExec).not.toMatch(/CREATE POLICY/i);
  });

  it("R31: es aditiva y el down revierte exactamente (DROP TABLE + DROP TYPE)", () => {
    expect(upExec).not.toMatch(/DROP TABLE/i);
    expect(upExec).not.toMatch(/ALTER TABLE\s+"usuario"/i);
    expect(downExec).toMatch(/DROP TABLE IF EXISTS\s+"plantilla_mensaje"/);
    expect(downExec).toMatch(/DROP TYPE IF EXISTS\s+"plantilla_estado"/);
  });
});

// ---------------------------------------------------------------------------
// 2) Roundtrip CRUD end-to-end (Repository -> Service) con Prisma in-memory
// ---------------------------------------------------------------------------

interface Row {
  id: string;
  nombre: string;
  cuerpo: string;
  variables: string[];
  estado: string;
  createdBy: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function p2002Nombre(): Error {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
    meta: { target: ["nombre"] },
  });
}

function matchWhere(row: Row, where: Record<string, unknown> | undefined): boolean {
  if (!where) return true;
  if ("deletedAt" in where && where.deletedAt === null && row.deletedAt !== null) return false;
  if ("id" in where && where.id !== undefined && row.id !== where.id) return false;
  if ("nombre" in where && where.nombre !== undefined && row.nombre !== where.nombre) return false;
  return true;
}

// Prisma in-memory minimo: solo lo que usa PlantillaMensajeRepository.
function makeFakePrisma() {
  const rows: Row[] = [];
  let seq = 0;
  const model = {
    async create({ data }: { data: Record<string, unknown>; select?: unknown }) {
      const nombre = data.nombre as string;
      if (rows.some((r) => r.nombre === nombre && r.deletedAt === null)) throw p2002Nombre();
      const now = new Date();
      const row: Row = {
        id: `pl-${++seq}`,
        nombre,
        cuerpo: data.cuerpo as string,
        variables: (data.variables as string[]) ?? [],
        estado: "pending", // default del schema (R12)
        createdBy: (data.createdBy as string | null) ?? null,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      rows.push(row);
      return { ...row };
    },
    async findMany({
      where,
      skip = 0,
      take = 100,
      orderBy,
    }: {
      where?: Record<string, unknown>;
      skip?: number;
      take?: number;
      orderBy?: { createdAt?: "asc" | "desc" };
      select?: unknown;
    }) {
      let out = rows.filter((r) => matchWhere(r, where));
      if (orderBy?.createdAt === "desc") out = out.slice().reverse();
      return out.slice(skip, skip + take).map((r) => ({ ...r }));
    },
    async count({ where }: { where?: Record<string, unknown> } = {}) {
      return rows.filter((r) => matchWhere(r, where)).length;
    },
    async findFirst({ where }: { where?: Record<string, unknown>; select?: unknown }) {
      const r = rows.find((row) => matchWhere(row, where));
      return r ? { ...r } : null;
    },
    async updateMany({
      where,
      data,
    }: {
      where?: Record<string, unknown>;
      data: Record<string, unknown>;
    }) {
      const targets = rows.filter((r) => matchWhere(r, where));
      for (const r of targets) {
        if (data.nombre !== undefined) {
          if (rows.some((o) => o !== r && o.nombre === data.nombre && o.deletedAt === null)) {
            throw p2002Nombre();
          }
          r.nombre = data.nombre as string;
        }
        if (data.cuerpo !== undefined) r.cuerpo = data.cuerpo as string;
        if (data.variables !== undefined) r.variables = data.variables as string[];
        if (data.estado !== undefined) r.estado = data.estado as string;
        if (data.deletedAt !== undefined) r.deletedAt = data.deletedAt as Date | null;
        r.updatedAt = new Date();
      }
      return { count: targets.length };
    },
  };
  return { plantillaMensaje: model } as unknown as ConstructorParameters<
    typeof PlantillaMensajeRepository
  >[0];
}

let service: PlantillaMensajeService;

beforeEach(() => {
  service = new PlantillaMensajeService(new PlantillaMensajeRepository(makeFakePrisma()));
});

describe("R8/R15/R12: crear persiste el array de variables y nace pending", () => {
  it("crea y guarda las variables derivadas del cuerpo", async () => {
    const r = await service.crear({ nombre: "Aviso", cuerpo: "Hola {{usuario}} {{cod}} {{usuario}}" }, MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.plantilla.variables).toEqual(["usuario", "cod"]); // R15: dedup, orden
      expect(r.plantilla.estado).toBe("pending"); // R12
    }
  });
});

describe("R10: unicidad de nombre (P2002 -> conflict)", () => {
  it("segundo create con el mismo nombre -> conflict(nombre)", async () => {
    await service.crear({ nombre: "Unica", cuerpo: "a" }, MAESTRO);
    const dup = await service.crear({ nombre: "Unica", cuerpo: "b" }, MAESTRO);
    expect(dup.status).toBe("conflict");
    if (dup.status === "conflict") expect(dup.campo).toBe("nombre");
  });
});

describe("R20: editar recalcula variables y persiste", () => {
  it("actualiza cuerpo y variables", async () => {
    const creada = await service.crear({ nombre: "Edit", cuerpo: "Hola {{usuario}}" }, MAESTRO);
    if (creada.status !== "ok") throw new Error("setup");
    const upd = await service.actualizar(creada.plantilla.id, { cuerpo: "Nuevo {{cod}}" }, MAESTRO);
    expect(upd.status).toBe("ok");
    if (upd.status === "ok") {
      expect(upd.plantilla.cuerpo).toBe("Nuevo {{cod}}");
      expect(upd.plantilla.variables).toEqual(["cod"]);
    }
  });
});

describe("R27/R28: soft delete oculta la plantilla del listado", () => {
  it("crea dos, elimina una y el listado solo devuelve la vigente", async () => {
    const a = await service.crear({ nombre: "A", cuerpo: "a" }, MAESTRO);
    await service.crear({ nombre: "B", cuerpo: "b" }, MAESTRO);
    if (a.status !== "ok") throw new Error("setup");

    const del = await service.eliminar(a.plantilla.id, MAESTRO); // R27
    expect(del.status).toBe("ok");

    const lista = await service.listar({ page: 1, pageSize: 25 }, MAESTRO); // R28
    expect(lista.status).toBe("ok");
    if (lista.status === "ok") {
      expect(lista.total).toBe(1);
      expect(lista.items.map((i) => i.nombre)).toEqual(["B"]);
    }

    // (La lectura por id de la borrada se afirmaba aqui via `obtener`, retirada el 2026-08-07.
    // R28 no se queda sin testigo: lo es el `listar` de arriba, que ya no la devuelve.)

    // R29: re-eliminar la ya borrada -> not_found.
    const reDel = await service.eliminar(a.plantilla.id, MAESTRO);
    expect(reDel.status).toBe("not_found");
  });
});
