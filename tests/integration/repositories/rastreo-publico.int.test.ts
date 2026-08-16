import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { RastreoPublicoRepository } from "@/lib/repositories/RastreoPublicoRepository";
import { RastreoPublicoService } from "@/lib/services/RastreoPublicoService";
import type { RastreoPublicoConfig } from "@/lib/config/rastreo-publico";

// Feature 229 — T2.7: el repositorio publico contra datos.
//
// Prisma mockeado con SEMANTICA, que es el patron del resto de `tests/integration/
// repositories/` (la suite NO levanta Postgres, ver la cabecera de
// `nota-privada-mensajero-repo.int.test.ts`). El fake EJECUTA lo que importa: `findUnique`
// por `num_guia @unique`, `findMany` filtrado por `orden_id` y ORDENADO por `created_at`
// segun el `orderBy` que pida el repositorio, y proyeccion estricta del `select`.
//
// Que el fake respete el `select` no es cosmetico: es lo que permite afirmar que si el
// repositorio pidiera un campo prohibido el test lo VERIA (R25), en vez de que Prisma
// devolviera la fila entera y nadie se enterase.
//
// Cubre R21 (linea de tiempo en UNA consulta, ascendente) y R7 caso (c) (orden con
// `deleted_at`).

interface FilaOrden {
  id: string;
  numGuia: number | null;
  telefonoDest: string;
  deletedAt: Date | null;
  // Campos PROHIBIDOS en la lectura publica: viven en la fila, como en la base real, para
  // que se note si el `select` del repositorio los pidiera alguna vez.
  destinatario: string;
  direccion: string;
  montoCobrar: number;
  producto: string;
  notas: string;
  mensajeroAsignadoId: string;
}

interface FilaHistorial {
  ordenId: string;
  createdAt: Date;
  estatusDestino: { value: string };
  actorUsuarioId: string;
  origenTipo: string;
  motivo: string;
  gestionOrdenId: string;
}

const ORDENES: FilaOrden[] = [
  {
    id: "orden-viva",
    numGuia: 4321,
    telefonoDest: "8888-7766",
    deletedAt: null,
    destinatario: "Ana Solis",
    direccion: "200 metros norte de la iglesia",
    montoCobrar: 25000,
    producto: "Zapatos",
    notas: "porton azul",
    mensajeroAsignadoId: "mensajero-9",
  },
  {
    id: "orden-borrada",
    numGuia: 5555,
    telefonoDest: "8888-7766",
    deletedAt: new Date("2026-08-14T10:00:00.000Z"),
    destinatario: "Luis Mora",
    direccion: "frente al parque",
    montoCobrar: 10000,
    producto: "Camisa",
    notas: "",
    mensajeroAsignadoId: "mensajero-3",
  },
];

function historial(ordenId: string, iso: string, value: string): FilaHistorial {
  return {
    ordenId,
    createdAt: new Date(iso),
    estatusDestino: { value },
    actorUsuarioId: "usuario-7",
    origenTipo: "gestion",
    motivo: "cliente no estaba, se reintenta mañana",
    gestionOrdenId: "gestion-12",
  };
}

// Insertadas DESORDENADAS a proposito: el orden lo tiene que poner la consulta.
const HISTORIAL: FilaHistorial[] = [
  historial("orden-viva", "2026-08-12T16:00:00.000Z", "en_reparto"),
  historial("orden-viva", "2026-08-10T14:00:00.000Z", "en_preparacion"),
  historial("orden-borrada", "2026-08-10T14:00:00.000Z", "en_preparacion"),
  historial("orden-viva", "2026-08-13T17:00:00.000Z", "entregada"),
  historial("orden-viva", "2026-08-11T15:00:00.000Z", "en_bodega_central"),
];

type Seleccion = Record<string, unknown>;

/** Devuelve SOLO las claves pedidas por el `select` (anidando un nivel, como Prisma). */
function proyectar(fila: Record<string, unknown>, select: Seleccion): Record<string, unknown> {
  const salida: Record<string, unknown> = {};
  for (const [campo, valor] of Object.entries(select)) {
    if (valor === true) {
      salida[campo] = fila[campo];
    } else if (typeof valor === "object" && valor !== null && "select" in valor) {
      const anidado = fila[campo] as Record<string, unknown>;
      salida[campo] = proyectar(anidado, (valor as { select: Seleccion }).select);
    }
  }
  return salida;
}

function buildPrisma() {
  const findUnique = vi.fn(
    async (args: { where: { numGuia?: number }; select: Seleccion }) => {
      const fila = ORDENES.find((o) => o.numGuia === args.where.numGuia);
      return fila ? proyectar(fila as unknown as Record<string, unknown>, args.select) : null;
    },
  );
  const findMany = vi.fn(
    async (args: {
      where: { ordenId: string };
      orderBy: { createdAt: "asc" | "desc" };
      select: Seleccion;
    }) => {
      const signo = args.orderBy.createdAt === "asc" ? 1 : -1;
      return HISTORIAL.filter((h) => h.ordenId === args.where.ordenId)
        .sort((a, b) => signo * (a.createdAt.getTime() - b.createdAt.getTime()))
        .map((h) => proyectar(h as unknown as Record<string, unknown>, args.select));
    },
  );
  const prisma = {
    orden: { findUnique },
    ordenHistorialEstado: { findMany },
  } as unknown as PrismaClient;
  return { prisma, findUnique, findMany };
}

const CONFIG: RastreoPublicoConfig = {
  RATE_MAX: 8,
  RATE_WINDOW_MINUTES: 10,
  DIGITOS_SEGUNDO_FACTOR: 4,
  ZONA_HORARIA: "America/Costa_Rica",
};

function build() {
  const { prisma, findUnique, findMany } = buildPrisma();
  const repo = new RastreoPublicoRepository(prisma);
  return { repo, service: new RastreoPublicoService(repo, CONFIG), findUnique, findMany };
}

describe("R21 — la linea de tiempo sale en UNA consulta y ordenada asc", () => {
  it("resuelve la linea de tiempo en una consulta ordenada asc", async () => {
    const { repo, findMany } = build();
    const transiciones = await repo.listarTransiciones("orden-viva");

    expect(findMany).toHaveBeenCalledTimes(1); // ni una consulta por transicion
    expect(transiciones.map((t) => t.estatusValue)).toEqual([
      "en_preparacion",
      "en_bodega_central",
      "en_reparto",
      "entregada",
    ]);
    const instantes = transiciones.map((t) => t.createdAt.getTime());
    expect([...instantes].sort((a, b) => a - b)).toEqual(instantes);
  });

  it("solo trae las transiciones de ESA orden", async () => {
    const { repo } = build();
    expect(await repo.listarTransiciones("orden-borrada")).toHaveLength(1);
  });

  it("con datos reales, la consulta publica completa emite exactamente dos lecturas", async () => {
    const { service, findUnique, findMany } = build();
    const resultado = await service.consultar(4321, "7766");

    expect(resultado.estado).toBe("ok");
    expect(findUnique).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledTimes(1);
    if (resultado.estado !== "ok") throw new Error("se esperaba ok");
    expect(resultado.envio.linea.map((e) => e.hito)).toEqual([
      "registrado",
      "en_bodega",
      "en_reparto",
      "entregado",
    ]);
  });
});

describe("R7 caso (c) — la orden con deleted_at no se encuentra", () => {
  it("una guia de una orden borrada logicamente responde igual que una guia inexistente", async () => {
    const { service } = build();
    const borrada = await service.consultar(5555, "7766"); // existe, factor CORRECTO
    const inexistente = await service.consultar(9999, "7766");

    expect(borrada).toEqual({ estado: "no_encontrado" });
    expect(borrada).toEqual(inexistente);
  });

  it("la orden borrada tampoco llega a leer su historial", async () => {
    const { service, findMany } = build();
    await service.consultar(5555, "7766");
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe("R25 — el select es explicito y no toca campos prohibidos", () => {
  it("la lectura de la orden pide solo id, numGuia, telefonoDest y deletedAt", async () => {
    const { repo, findUnique } = build();
    await repo.buscarPorGuia(4321);
    const args = findUnique.mock.calls[0][0];
    expect(Object.keys(args.select).sort()).toEqual([
      "deletedAt",
      "id",
      "numGuia",
      "telefonoDest",
    ]);
  });

  it("la lectura del historial pide solo createdAt y el value del estatus destino", async () => {
    const { repo, findMany } = build();
    await repo.listarTransiciones("orden-viva");
    const args = findMany.mock.calls[0][0];
    expect(Object.keys(args.select).sort()).toEqual(["createdAt", "estatusDestino"]);
    expect(args.select.estatusDestino).toEqual({ select: { value: true } });
  });

  it("ningun dato sensible de la fila llega al resultado publico", async () => {
    const { service } = build();
    const resultado = await service.consultar(4321, "7766");
    const serializado = JSON.stringify(resultado);
    for (const prohibido of [
      "Ana Solis",
      "200 metros norte de la iglesia",
      "25000",
      "Zapatos",
      "porton azul",
      "mensajero-9",
      "usuario-7",
      "gestion",
      "cliente no estaba",
      "gestion-12",
      "orden-viva",
      "8888",
    ]) {
      expect(serializado).not.toContain(prohibido);
    }
  });
});
