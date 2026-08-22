import { describe, it, expect, vi, type Mock } from "vitest";
import path from "node:path";
import fs from "node:fs";
import type { PrismaClient } from "@prisma/client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import type { ApiOrdenDetalleRow, IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import * as detalleRoute from "@/app/api/ordenes/api-key/[numGuia]/route";
import * as cancelarRoute from "@/app/api/ordenes/api-key/[numGuia]/cancelar/route";

// Feature 177 / T21 (R17): NO-REGRESION de la feature 106. La 177 extrajo la proyeccion del
// detalle a una constante compartida (`API_ORDEN_DETALLE_SELECT`) y anadio metodos nuevos al
// repositorio; este archivo fija que el endpoint y el metodo de la 106 quedaron IDENTICOS.
//
// Deliberadamente NO se importa `API_ORDEN_DETALLE_SELECT` desde produccion: compararse contra
// la misma constante que se quiere vigilar seria tautologico (cualquier cambio pasaria). El
// contrato se escribe AQUI como literal congelado, tal y como era ANTES de la 177.

const OWNER = "store-1";

/**
 * Proyeccion EXACTA que la feature 106 enviaba a Prisma en `findDetalleByNumGuiaForOwner`.
 * Copia literal congelada: si produccion anade, quita o renombra un campo, este test cae.
 *
 * ⚠️ FEATURE 268 (T6c / R27, 2026-08-22) — AQUI DECIA `resultado: { in: ["entregada",
 * "rechazada"] }` Y NO EXISTIA `incidentesAdmin`, y ya no es cierto. Los dos cambios son
 * DELIBERADOS y estan firmados en `specs/268-webhook-ayuda-incidente/design.md` §7.3 (opcion a+):
 *
 *   - el `in` gana `incidente` -> las evidencias del incidente del MENSAJERO (arista #44, familia
 *     `gestion`), que hasta ahora no salian por NINGUN endpoint del canal;
 *   - `incidentesAdmin` es la segunda procedencia -> el incidente del ADMIN (aristas #48-#52) NO
 *     crea gestion ninguna, asi que ampliar solo el `in` habria dejado 5 de las 6 aristas sin
 *     fotos y EN SILENCIO (esa es la opcion (a) que el design descarta por su nombre).
 *
 * Lo que este literal SIGUE congelando y no ha cambiado: los nueve campos publicos de la orden, la
 * forma del bloque `gestiones` (mismas claves, mismo `select`, mismo `orderBy`, mismo filtro de
 * `evidenciaStoragePath`) y el `where` del metodo. La no-regresion de la 106 es que su respuesta
 * para una orden entregada o rechazada es byte a byte la de antes: eso lo afirma
 * `orden-repository.api-lectura.test.ts`.
 */
const SELECT_DETALLE_106 = {
  numGuia: true,
  numRemision: true,
  destinatario: true,
  telefonoDest: true,
  producto: true,
  direccion: true,
  montoCobrar: true,
  createdAt: true,
  estatus: { select: { value: true } },
  gestiones: {
    where: {
      resultado: { in: ["entregada", "rechazada", "incidente"] }, // 268/R27
      evidenciaStoragePath: { not: null },
    },
    select: {
      resultado: true,
      evidenciaStoragePath: true,
      evidenciaContentType: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  },
  // 268/R27: la portada (indice 0) del incidente del ADMIN, y nada mas del tramite.
  incidentesAdmin: {
    select: {
      evidencias: {
        where: { indice: 0 },
        select: { storagePath: true, contentType: true },
      },
    },
    orderBy: { createdAt: "asc" },
  },
};

/** Verbos HTTP que un route handler de Next.js puede exportar. */
const VERBOS_HTTP = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

const RAIZ = process.cwd();

function buildPrisma() {
  return {
    orden: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
  };
}

function verbosExportados(modulo: Record<string, unknown>): string[] {
  return VERBOS_HTTP.filter((verbo) => typeof modulo[verbo] === "function");
}

describe("Feature 106 intacta — findDetalleByNumGuiaForOwner (R17)", () => {
  it("el metodo sigue existiendo en OrdenRepository y en el contrato IOrdenRepository", () => {
    const repo = new OrdenRepository(buildPrisma() as unknown as PrismaClient);

    expect(typeof repo.findDetalleByNumGuiaForOwner).toBe("function");
    expect(
      Object.prototype.hasOwnProperty.call(
        OrdenRepository.prototype,
        "findDetalleByNumGuiaForOwner",
      ),
    ).toBe(true);

    // Comprobacion de tipos: si la firma declarada en la interfaz cambiara, esta asignacion
    // (repo -> interfaz -> firma esperada) dejaria de compilar y `pnpm typecheck` fallaria.
    const desdeLaInterfaz: IOrdenRepository["findDetalleByNumGuiaForOwner"] =
      repo.findDetalleByNumGuiaForOwner.bind(repo);
    const conLaFirmaDeLa106: (
      numGuia: number,
      ownerId: string,
    ) => Promise<ApiOrdenDetalleRow | null> = desdeLaInterfaz;
    expect(typeof conLaFirmaDeLa106).toBe("function");
  });

  it("conserva su aridad de dos parametros (numGuia, ownerId)", () => {
    const repo = new OrdenRepository(buildPrisma() as unknown as PrismaClient);
    expect(repo.findDetalleByNumGuiaForOwner.length).toBe(2);
    expect(OrdenRepository.prototype.findDetalleByNumGuiaForOwner.length).toBe(2);
  });

  it("envia a Prisma exactamente la misma proyeccion que antes de la feature 177", async () => {
    const prisma = buildPrisma();
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.findDetalleByNumGuiaForOwner(10234, OWNER);

    const { select } = (prisma.orden.findFirst as Mock).mock.calls[0][0];
    // Igualdad estructural contra el literal congelado: detecta campos anadidos y quitados.
    expect(select).toEqual(SELECT_DETALLE_106);
    expect(Object.keys(select).sort()).toEqual(Object.keys(SELECT_DETALLE_106).sort());
    expect(Object.keys(select.gestiones).sort()).toEqual(["orderBy", "select", "where"]);
    expect(Object.keys(select.gestiones.select).sort()).toEqual(
      Object.keys(SELECT_DETALLE_106.gestiones.select).sort(),
    );
  });

  it("sigue filtrando por numGuia + tiendaId + deletedAt: null y por nada mas", async () => {
    const prisma = buildPrisma();
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.findDetalleByNumGuiaForOwner(10234, OWNER);

    const { where } = (prisma.orden.findFirst as Mock).mock.calls[0][0];
    expect(where).toEqual({ numGuia: 10234, tiendaId: OWNER, deletedAt: null });
  });
});

describe("Feature 106 intacta — rutas y verbos de sus endpoints (R17)", () => {
  it("el archivo de ruta GET /api/ordenes/api-key/[numGuia] sigue en su sitio", () => {
    const ruta = path.join(RAIZ, "app", "api", "ordenes", "api-key", "[numGuia]", "route.ts");
    expect(fs.existsSync(ruta)).toBe(true);
  });

  it("el archivo de ruta PUT /api/ordenes/api-key/[numGuia]/cancelar sigue en su sitio", () => {
    const ruta = path.join(
      RAIZ,
      "app",
      "api",
      "ordenes",
      "api-key",
      "[numGuia]",
      "cancelar",
      "route.ts",
    );
    expect(fs.existsSync(ruta)).toBe(true);
  });

  it("el modulo del detalle exporta solo GET y ningun verbo nuevo", () => {
    expect(verbosExportados(detalleRoute as unknown as Record<string, unknown>)).toEqual(["GET"]);
  });

  it("el modulo de cancelar exporta solo PUT y ningun verbo nuevo", () => {
    expect(verbosExportados(cancelarRoute as unknown as Record<string, unknown>)).toEqual(["PUT"]);
  });
});
