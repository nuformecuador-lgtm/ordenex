import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  fksDeOrden,
  type FksDeOrden,
} from "./_postgres-real";

// Feature 169 / T1.9 — el dato derivado se mantiene solo (R26), y NADIE puede escribirlo
// (R27/R28). Contra Postgres real, dentro de una transaccion que siempre se revierte.
//
// Es lo que hace innecesaria cualquier "ruta de mantenimiento" del indice: la columna es
// GENERATED, asi que las cuatro rutas de escritura de ordenes (alta manual, carga masiva
// por sesion, carga por API key y actualizacion) siguen funcionando sin tocar una linea.

const SUFIJO = `s169-${Date.now().toString(36)}`;
const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

/** Lectura CRUDA de la columna: el `omit` global la esconde a las lecturas normales. */
async function leerBusquedaTexto(
  tx: { $queryRawUnsafe: PrismaClient["$queryRawUnsafe"] },
  id: string,
): Promise<string | null> {
  const filas = await tx.$queryRawUnsafe<{ busqueda_texto: string | null }[]>(
    'SELECT "busqueda_texto" FROM "orden" WHERE "id" = $1',
    id,
  );
  return filas[0]?.busqueda_texto ?? null;
}

describeSiHayBase("orden.busqueda_texto se sincroniza sola con los cuatro campos", () => {
  let prisma: PrismaClient;
  let fks: FksDeOrden | null;

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    fks = await fksDeOrden(prisma);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("hay ordenes de las que tomar las FKs", () => {
    expect(fks).not.toBeNull();
  });

  it("al CREAR, la orden ya se encuentra por sus cuatro datos sin accion adicional (R26)", async () => {
    if (!fks) return;
    const base = fks;
    const encontrada = await enTransaccionRevertida(prisma, async (tx) => {
      const creada = await tx.orden.create({
        data: {
          numGuia: 918273,
          numRemision: `REM-${SUFIJO}-CREAR`,
          destinatario: "Rosaura Céspedes",
          telefonoDest: "8712-3456",
          producto: "caja",
          estatusId: base.estatusId,
          tiendaId: base.tiendaId,
          zonaId: base.zonaId,
          provinciaId: base.provinciaId,
          cantonId: base.cantonId,
        },
        select: { id: true },
      });
      const texto = await leerBusquedaTexto(tx, creada.id);
      // Buscar por cada uno de los CUATRO datos por separado, tal y como lo hara el
      // repositorio: `contains` sobre la columna generada.
      const porDato = await Promise.all(
        ["918273", `rem-${SUFIJO}-crear`, "87123456", "cespedes"].map((termino) =>
          tx.orden.count({ where: { id: creada.id, busquedaTexto: { contains: termino } } }),
        ),
      );
      return { texto, porDato };
    });
    expect(encontrada.texto).not.toBeNull();
    expect(encontrada.porDato).toEqual([1, 1, 1, 1]);
  });

  it("al MODIFICAR el destinatario, se encuentra por el nuevo y NO por el anterior (R26)", async () => {
    if (!fks) return;
    const base = fks;
    const resultado = await enTransaccionRevertida(prisma, async (tx) => {
      const creada = await tx.orden.create({
        data: {
          numRemision: `REM-${SUFIJO}-UPD`,
          destinatario: "Marta Villalobos",
          telefonoDest: "88887777",
          producto: "caja",
          estatusId: base.estatusId,
          tiendaId: base.tiendaId,
          zonaId: base.zonaId,
          provinciaId: base.provinciaId,
          cantonId: base.cantonId,
        },
        select: { id: true },
      });
      const antes = await leerBusquedaTexto(tx, creada.id);
      await tx.orden.update({
        where: { id: creada.id },
        data: { destinatario: "Óscar Zúñiga" },
        select: { id: true },
      });
      const despues = await leerBusquedaTexto(tx, creada.id);
      const porNuevo = await tx.orden.count({
        where: { id: creada.id, busquedaTexto: { contains: "oscar zuniga" } },
      });
      const porViejo = await tx.orden.count({
        where: { id: creada.id, busquedaTexto: { contains: "villalobos" } },
      });
      return { antes, despues, porNuevo, porViejo };
    });
    expect(resultado.antes).toContain("marta villalobos");
    expect(resultado.despues).toContain("oscar zuniga");
    expect(resultado.despues).not.toContain("villalobos");
    expect(resultado.porNuevo).toBe(1);
    expect(resultado.porViejo).toBe(0);
  });

  it("al asignar la GUIA despues, la orden pasa a encontrarse por ella (R26)", async () => {
    if (!fks) return;
    const base = fks;
    const resultado = await enTransaccionRevertida(prisma, async (tx) => {
      const creada = await tx.orden.create({
        data: {
          numRemision: `REM-${SUFIJO}-GUIA`,
          destinatario: "Karla Mora",
          telefonoDest: "88886666",
          producto: "caja",
          estatusId: base.estatusId,
          tiendaId: base.tiendaId,
          zonaId: base.zonaId,
          provinciaId: base.provinciaId,
          cantonId: base.cantonId,
        },
        select: { id: true },
      });
      const sinGuia = await tx.orden.count({
        where: { id: creada.id, busquedaTexto: { contains: "776655" } },
      });
      await tx.orden.update({
        where: { id: creada.id },
        data: { numGuia: 776655 },
        select: { id: true },
      });
      const conGuia = await tx.orden.count({
        where: { id: creada.id, busquedaTexto: { contains: "776655" } },
      });
      return { sinGuia, conGuia };
    });
    expect(resultado.sinGuia).toBe(0);
    expect(resultado.conGuia).toBe(1);
  });

  it("escribir la columna a mano es IMPOSIBLE: Postgres lo rechaza (R27)", async () => {
    if (!fks) return;
    const base = fks;
    // La garantia de R27 no descansa en la disciplina de quien escriba el proximo
    // repositorio: descansa en el motor. Si alguien intenta escribirla, revienta la
    // escritura entera, no se cuela un dato inconsistente.
    const fallo = await enTransaccionRevertida(prisma, async (tx) => {
      const creada = await tx.orden.create({
        data: {
          numRemision: `REM-${SUFIJO}-RO`,
          destinatario: "Solo Lectura",
          telefonoDest: "88885555",
          producto: "caja",
          estatusId: base.estatusId,
          tiendaId: base.tiendaId,
          zonaId: base.zonaId,
          provinciaId: base.provinciaId,
          cantonId: base.cantonId,
        },
        select: { id: true },
      });
      try {
        await tx.$executeRawUnsafe(
          'UPDATE "orden" SET "busqueda_texto" = $1 WHERE "id" = $2',
          "inyectado",
          creada.id,
        );
        return null;
      } catch (error) {
        return (error as Error).message;
      }
    });
    expect(fallo, "el UPDATE sobre la columna generada deberia fallar").not.toBeNull();
    // Se asserta el SQLSTATE (428C9 = ERRCODE_GENERATED_ALWAYS) y no el texto del error:
    // Postgres traduce sus mensajes segun el locale del servidor y el de esta maquina
    // responde en español. El codigo es el mismo en cualquier idioma y version.
    expect(String(fallo)).toContain("428C9");
  });

  it("una lectura normal NO trae la columna: no viaja a ningun DTO (R28)", async () => {
    if (!fks) return;
    const filas = await prisma.orden.findMany({ take: 1 });
    if (filas.length === 0) return;
    expect(Object.keys(filas[0])).not.toContain("busquedaTexto");
    expect(filas[0]).not.toHaveProperty("busquedaTexto");
  });
});
