// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { createElement } from "react";
import type { PrismaClient } from "@prisma/client";

import { GeografiaSelector } from "@/app/(app)/configuracion/tarifas/_components/GeografiaSelector";
import type { UpdateZonaData } from "@/lib/interfaces/repositories/IZonaRepository";
import { ZonaRepository } from "@/lib/repositories/ZonaRepository";
import type { ProvinciaArbolDTO } from "@/lib/types/geografia-nodo";

import {
  HAY_BASE_DE_DATOS,
  clienteConTransaccionAnidada,
  crearPrismaDeTest,
  enTransaccionRevertida,
  fksDeOrden,
  serializarEscriturasReales,
} from "./_postgres-real";

/**
 * ⭑ FICHA 374 / H4 — R48: GUARDAR UNA ZONA SIN TOCAR EL SELECTOR NO LE BORRA NINGÚN DISTRITO,
 * INCLUIDOS LOS RETIRADOS.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * POR QUÉ ESTE ARCHIVO RECORRE LA CADENA ENTERA (selector → `onSelectedChange` → repositorio)
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `ZonaRepository.update` hace `deleteMany({ zonaId })` + `createMany(distritoIds)` (`:230-235`):
 * REEMPLAZO TOTAL de `zona_distrito` con lo que mande el formulario. El fallo que esta ficha viene
 * a impedir NO está en el repositorio —él hace exactamente lo que le piden— sino en el eslabón de
 * arriba: si el selector escondiera los distritos retirados, o filtrase `initialSelected` para no
 * pre-marcarlos, la lista que llega aquí vendría corta y el guardado BORRARÍA sus filas.
 *
 * A partir de ahí ese distrito resolvería 0 zonas y toda alta futura moriría con «no tiene zona
 * asignada»… y NO SE PONDRÍA ROJO NADA: la reconciliación hace `continue` cuando la zona resuelta
 * es `null` (`ZonaRepository.ts:266-267`). Ni excepción, ni log, ni test.
 *
 * Por eso `distritoIds` NO se escribe a mano en este archivo: se OBTIENE montando el selector real
 * con `initialSelected` y leyendo lo que reporta, que es literalmente lo que el formulario manda.
 * Un test que hardcodease la lista mediría el repositorio y sería CIEGO a la mutación que importa.
 *
 * ⚠️ NADA DE `if (!fks) return;`: con base y sin catálogo esto REVIENTA con un mensaje que dice qué
 * hacer. Sin base alcanzable, `describe.skip` VISIBLE. Todo ocurre dentro de una transacción que
 * SIEMPRE se revierte: la base local es compartida.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const SUFIJO = `374-${Date.now().toString(36)}`;
let contador = 0;
function unico(): string {
  contador += 1;
  return `${SUFIJO}-${contador.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function datosDeZona(nombre: string, distritoIds: string[]): UpdateZonaData {
  return { nombre, cobroVehiculo: false, esCentral: false, distritoIds, tarifas: [] };
}

/**
 * Monta el selector REAL con los distritos que la zona tiene hoy y devuelve lo que reporta.
 * Es el `distritoIds` que `CrearZonaForm` mandaría si nadie tocase nada.
 */
function loQueElFormularioMandaria(
  arbol: ProvinciaArbolDTO[],
  initialSelected: string[],
): string[] {
  const reportado: string[][] = [];
  const espia = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    render(
      createElement(GeografiaSelector, {
        provincias: arbol,
        initialSelected,
        onSelectedChange: (ids: string[]) => reportado.push(ids),
      }),
    );
  } finally {
    cleanup();
    espia.mockRestore();
  }
  if (reportado.length === 0) {
    throw new Error("el selector no reportó ninguna selección al montarse");
  }
  return reportado[reportado.length - 1];
}

describeSiHayBase("⭑ 374/R48 — guardar una zona conserva sus distritos RETIRADOS", () => {
  let prisma: PrismaClient;
  let FKS: NonNullable<Awaited<ReturnType<typeof fksDeOrden>>>;
  let USUARIO: string;

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    const fks = await fksDeOrden(prisma);
    if (fks === null) {
      throw new Error(
        "hay DATABASE_URL pero la tabla `orden` esta vacia: sin FKs no se puede sembrar. Corre " +
          "`pnpm run db:seed` (y `pnpm run db:seed:zonas`) antes de esta suite.",
      );
    }
    FKS = fks;
    const usuario = await prisma.usuario.findFirst({ select: { id: true } });
    if (usuario === null) {
      throw new Error(
        "hacen falta usuarios en la base: el actor congelado de la reconciliacion cuelga de uno. " +
          "Corre `pnpm run db:seed:maestro`.",
      );
    }
    USUARIO = usuario.id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("las filas de `zona_distrito` son EXACTAMENTE las mismas antes y después del guardado", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);

      const nombreZona = `374 Z ${unico()}`;
      const zona = await tx.zona.create({ data: { nombre: nombreZona }, select: { id: true } });

      // Un distrito DISPONIBLE y otro RETIRADO, los dos dentro de la zona. Con uno solo, «no se
      // pierde ninguno» pasaria en verde con un selector que los filtrase todos menos el primero.
      const activo = await tx.distrito.create({
        data: { nombre: `374 D activo ${unico()}`, cantonId: FKS.cantonId, activo: true },
        select: { id: true, nombre: true, activo: true },
      });
      const retirado = await tx.distrito.create({
        data: { nombre: `374 D retirado ${unico()}`, cantonId: FKS.cantonId, activo: false },
        select: { id: true, nombre: true, activo: true },
      });
      await tx.zonaDistrito.createMany({
        data: [
          { zonaId: zona.id, distritoId: activo.id },
          { zonaId: zona.id, distritoId: retirado.id },
        ],
      });

      const antes = await tx.zonaDistrito.findMany({
        where: { zonaId: zona.id },
        select: { distritoId: true },
        orderBy: { distritoId: "asc" },
      });
      expect(antes.map((f) => f.distritoId).sort()).toEqual(
        [activo.id, retirado.id].sort(),
      );

      // El árbol tal y como se lo entrega el servidor al formulario de Tarifas: los DOS distritos,
      // con su flag propio. `listArbol` no recorta por disponibilidad (R26) — eso lo mide
      // `geografia-catalogo-activo.test.ts`; aquí se parte de ese hecho.
      const canton = await tx.canton.findUniqueOrThrow({
        where: { id: FKS.cantonId },
        select: { id: true, nombre: true, activo: true, provincia: { select: { id: true, nombre: true, activo: true } } },
      });
      const arbol: ProvinciaArbolDTO[] = [
        {
          id: canton.provincia.id,
          nombre: canton.provincia.nombre,
          activo: canton.provincia.activo,
          cantones: [
            {
              id: canton.id,
              nombre: canton.nombre,
              activo: canton.activo,
              distritos: [activo, retirado].map((d) => ({
                id: d.id,
                nombre: d.nombre,
                zonaId: zona.id,
                zonaNombre: nombreZona,
                zonaEspecial: false,
                activo: d.activo,
              })),
            },
          ],
        },
      ];

      // ⭑ Aquí es donde este test deja de ser un test de repositorio: la lista sale del SELECTOR.
      const distritoIds = loQueElFormularioMandaria(
        arbol,
        antes.map((f) => f.distritoId),
      );
      expect(distritoIds.sort()).toEqual([activo.id, retirado.id].sort());

      const repo = new ZonaRepository(clienteConTransaccionAnidada(tx));
      const resultado = await repo.update(zona.id, datosDeZona(nombreZona, distritoIds), USUARIO);
      expect(resultado).not.toBeNull();

      const despues = await tx.zonaDistrito.findMany({
        where: { zonaId: zona.id },
        select: { distritoId: true },
        orderBy: { distritoId: "asc" },
      });
      expect(despues.map((f) => f.distritoId)).toEqual(antes.map((f) => f.distritoId));
      // Y se dice explícitamente cuál es el que se salva, porque es el que se perdería:
      expect(despues.map((f) => f.distritoId)).toContain(retirado.id);
    });
  });

  it("CONTRAPRUEBA: si la lista llega SIN el retirado, la fila desaparece de verdad", async () => {
    // Sin este caso, el anterior podría estar verde por un `update` que no escribe nada. Aquí se
    // demuestra que el reemplazo total es REAL: el borrado silencioso que R47/R48 impiden ocurre
    // en cuanto la lista viene corta, y NADA lo señala salvo esta comprobación.
    await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);

      const nombreZona = `374 Z ${unico()}`;
      const zona = await tx.zona.create({ data: { nombre: nombreZona }, select: { id: true } });
      const activo = await tx.distrito.create({
        data: { nombre: `374 D activo ${unico()}`, cantonId: FKS.cantonId, activo: true },
        select: { id: true },
      });
      const retirado = await tx.distrito.create({
        data: { nombre: `374 D retirado ${unico()}`, cantonId: FKS.cantonId, activo: false },
        select: { id: true },
      });
      await tx.zonaDistrito.createMany({
        data: [
          { zonaId: zona.id, distritoId: activo.id },
          { zonaId: zona.id, distritoId: retirado.id },
        ],
      });

      const repo = new ZonaRepository(clienteConTransaccionAnidada(tx));
      await repo.update(zona.id, datosDeZona(nombreZona, [activo.id]), USUARIO);

      const despues = await tx.zonaDistrito.findMany({
        where: { zonaId: zona.id },
        select: { distritoId: true },
      });
      expect(despues.map((f) => f.distritoId)).toEqual([activo.id]);
      expect(despues.map((f) => f.distritoId)).not.toContain(retirado.id);
      // El distrito NO se borra: lo que se pierde es su pertenencia a la zona, en silencio.
      const sigueVivo = await tx.distrito.findUnique({
        where: { id: retirado.id },
        select: { id: true },
      });
      expect(sigueVivo).not.toBeNull();
    });
  });
});
