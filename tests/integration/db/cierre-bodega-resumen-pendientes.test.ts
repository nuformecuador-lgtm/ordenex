import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";

import { quitarComentarios } from "../../fixtures/sin-comentarios";
import { CierreBodegaRepository } from "@/lib/repositories/CierreBodegaRepository";
import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
  type TxDeTest,
} from "./_postgres-real";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 379 / T4 (R18/R19) — **EL AVISO CUENTA LO MISMO QUE LA CONSOLIDACION**, contra Postgres.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// ⚠️ POR QUE ESTE ARCHIVO NO PUEDE SER UN TEST CON DOBLES. Lo que se mide aqui vive ENTERO en un
// `WHERE`: cuatro predicados (`estado='aprobado'`, `destino_tipo='bodega_satelite'`,
// `destino_zona_id=Z`, `cierre_bodega_id IS NULL`). Un doble de Prisma devuelve lo que el test le
// diga y no ve el SQL — medido cuatro veces en este repo: una mutacion del `WHERE` pasa en verde.
//
// LA ASERCION QUE IMPORTA (R18) es CRUZADA: sobre el MISMO dataset, `resumirConsolidablesPendientes`
// tiene que devolver exactamente la cuenta y la suma de lo que `findCierresDiaConsolidables` LISTA.
// No se compara contra numeros escritos a mano, porque un numero a mano solo prueba que el test y
// el codigo coinciden hoy; la comparacion cruzada prueba que las dos lecturas comparten criterio, y
// esa es la propiedad que no puede fallar: un aviso que dice un numero distinto del que la pantalla
// de consolidacion ensena es peor que no avisar.
//
// Los datos los crea el propio test y falla RUIDOSAMENTE si el catalogo no esta sembrado: un
// `if (!fks) return;` reporta `passed` sin comprobar nada, y este repo ya se comio esa mentira.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;
const SUFIJO = `379-res-${Date.now().toString(36)}`;

// ---------------------------------------------------------------------------------------------
// R19 — LA MITAD QUE NINGUN DATO PUEDE PROBAR, Y ESTA MEDIDO
// ---------------------------------------------------------------------------------------------
//
// ⚠️ Se intento probar R19 con datos y NO SE PUEDE, y conviene que quede escrito para que nadie
// lo reintente: la columna es `Decimal(12,2)`, o sea como mucho 9.999.999.999,99. A esa escala
// el error de un `double` es del orden de 1e-6, y `toFixed(2)` lo redondea de vuelta al valor
// exacto — haria falta un importe del orden de 4,5e13 para que la diferencia se viera en los
// centimos, y esa fila no cabe en la columna. Medido con la mutacion
// `Number(_sum.totalGeneral).toFixed(2)`: los tres casos de datos de abajo pasaron en VERDE.
//
// Asi que la unica evidencia honesta de R19 es ESTRUCTURAL: el camino del importe no llama a
// `Number`/`parseFloat`/`parseInt`. El barrido va sobre el fuente SIN COMENTARIOS, porque la
// prosa de este repo nombra a proposito lo que el codigo tiene prohibido; y lleva su propia
// contraprueba, porque una guardia estatica rota no falla, calla.

const RAIZ = path.resolve(__dirname, "../../..");
const RUTA_REPO = "lib/repositories/CierreBodegaRepository.ts";

/** El cuerpo de un metodo del repositorio, por conteo de llaves, sobre el fuente sin comentarios. */
function cuerpoDeMetodo(fuente: string, nombre: string): string | null {
  const inicio = fuente.search(new RegExp(`\\n {2}async ${nombre}\\s*\\(`));
  if (inicio === -1) return null;
  const abre = fuente.indexOf("{", fuente.indexOf("Promise<", inicio));
  if (abre === -1) return null;
  let profundidad = 0;
  for (let i = abre; i < fuente.length; i++) {
    if (fuente[i] === "{") profundidad++;
    else if (fuente[i] === "}" && --profundidad === 0) return fuente.slice(abre, i + 1);
  }
  return null;
}

/** Las formas de perder un centimo convirtiendo el importe. `toFixed` sobre un `Decimal` NO lo es. */
const CONVERSIONES = [/\bNumber\s*\(/, /\bparseFloat\s*\(/, /\bparseInt\s*\(/] as const;

describe("379/R19 — el importe no pasa por coma flotante (barrido estatico)", () => {
  const FUENTE = quitarComentarios(readFileSync(path.join(RAIZ, RUTA_REPO), "utf8"));
  const CUERPO = cuerpoDeMetodo(FUENTE, "resumirConsolidablesPendientes");

  it("anti-vacuidad: el cuerpo se encontro y es el que se cree", () => {
    expect(CUERPO, "no se encontro `resumirConsolidablesPendientes`").not.toBeNull();
    expect(CUERPO).toContain("consolidablesWhere");
    expect(CUERPO).toContain("toFixed(2)");
    expect(CUERPO!.length).toBeLessThan(1_200);
  });

  it("CONTRAPRUEBA: el detector caza la conversion si se le da un cuerpo mutado", () => {
    const mutado = '{ return { totalGeneral: Number(r._sum.totalGeneral ?? 0).toFixed(2) }; }';
    expect(CONVERSIONES.some((re) => re.test(mutado))).toBe(true);
  });

  it("⭑ el cuerpo real no convierte el importe a numero", () => {
    const infractoras = CONVERSIONES.filter((re) => re.test(CUERPO ?? ""));
    expect(
      infractoras.map(String),
      "el importe del aviso pasa por coma flotante. `Prisma.Decimal` -> `toFixed(2)` y nada mas.",
    ).toEqual([]);
  });
});

describeSiHayBase("379/T4 · el resumen de consolidables sale del MISMO `where` (Postgres real)", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Zona satelite desechable: el dataset tiene que ser SOLO el que el test siembra. */
  async function sembrarZona(tx: TxDeTest, marca: string): Promise<string> {
    const fila = await tx.zona.create({
      data: { nombre: `Zona ${SUFIJO}-${marca}`, cobroVehiculo: false, esCentral: false },
      select: { id: true },
    });
    return fila.id;
  }

  /** Un usuario cualquiera al que colgar los cierres (`mensajero_id` es solo una FK aqui). */
  async function algunUsuarioId(tx: TxDeTest): Promise<string> {
    const fila = await tx.usuario.findFirst({ select: { id: true } });
    if (!fila) {
      throw new Error(
        "hay DATABASE_URL pero la tabla `usuario` esta vacia: sin FK no se puede sembrar un " +
          "cierre_dia. Corre `pnpm run db:seed` antes de esta suite.",
      );
    }
    return fila.id;
  }

  interface CierreSembrado {
    zonaId: string;
    total: string;
    estado?: "solicitado" | "aprobado" | "rechazado";
    destinoTipo?: "bodega_central" | "bodega_satelite";
    consolidado?: boolean;
  }

  async function sembrarCierreDia(
    tx: TxDeTest,
    mensajeroId: string,
    c: CierreSembrado,
  ): Promise<void> {
    let cierreBodegaId: string | null = null;
    if (c.consolidado) {
      // `aprobado` y no `solicitado`: el indice unico parcial de `cierre_bodega` prohibe dos
      // solicitados por zona, y aqui el estado del cierre de BODEGA es irrelevante — lo que
      // importa es que `cierre_bodega_id` deje de ser NULL.
      const cb = await tx.cierreBodega.create({
        data: { zonaId: c.zonaId, solicitadoPor: mensajeroId, estado: "aprobado" },
        select: { id: true },
      });
      cierreBodegaId = cb.id;
    }
    await tx.cierreDia.create({
      data: {
        mensajeroId,
        estado: c.estado ?? "aprobado",
        destinoTipo: c.destinoTipo ?? "bodega_satelite",
        destinoZonaId: c.zonaId,
        totalGeneral: new Prisma.Decimal(c.total),
        cierreBodegaId,
      },
    });
  }

  it("⭑ R18: el resumen devuelve EXACTAMENTE la cuenta y la suma de lo que la consolidacion lista", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const mensajeroId = await algunUsuarioId(tx);
      const zonaId = await sembrarZona(tx, "cruzada");
      const otraZonaId = await sembrarZona(tx, "vecina");

      // Dentro del conjunto …
      await sembrarCierreDia(tx, mensajeroId, { zonaId, total: "0.10" });
      await sembrarCierreDia(tx, mensajeroId, { zonaId, total: "0.20" });
      await sembrarCierreDia(tx, mensajeroId, { zonaId, total: "123456789.12" });
      // … y las cuatro exclusiones, una por predicado del `where`.
      await sembrarCierreDia(tx, mensajeroId, { zonaId, total: "999.99", consolidado: true });
      await sembrarCierreDia(tx, mensajeroId, { zonaId, total: "888.88", estado: "solicitado" });
      await sembrarCierreDia(tx, mensajeroId, {
        zonaId,
        total: "777.77",
        destinoTipo: "bodega_central",
      });
      await sembrarCierreDia(tx, mensajeroId, { zonaId: otraZonaId, total: "666.66" });

      const repo = new CierreBodegaRepository(tx as unknown as PrismaClient);
      const [resumen, listado] = await Promise.all([
        repo.resumirConsolidablesPendientes(zonaId),
        repo.findCierresDiaConsolidables(zonaId),
      ]);
      return { resumen, listado };
    });

    // (a) Control positivo: el dataset NO esta vacio. Sin esto, «0 = 0» pasaria siempre.
    expect(r.listado.length, "el listado salio vacio: el dataset no se sembro").toBe(3);

    // (b) La cuenta es la misma …
    expect(r.resumen.cantidad).toBe(r.listado.length);

    // (c) … y la suma tambien, calculada con Decimal desde lo que la OTRA lectura devolvio.
    //     Money-safe: se suma con `Prisma.Decimal`, nunca con `+` sobre numeros.
    const sumaDelListado = r.listado
      .reduce((acc, fila) => acc.plus(new Prisma.Decimal(fila.totales.general)), new Prisma.Decimal(0))
      .toFixed(2);
    expect(r.resumen.totalGeneral).toBe(sumaDelListado);

    // (d) Y el valor concreto, para que quede escrito que las exclusiones son las cuatro dichas:
    //     0.10 + 0.20 + 123456789.12. En coma flotante 0.1 + 0.2 no da 0.3; aqui si.
    expect(r.resumen.totalGeneral).toBe("123456789.42");
  });

  it("R19: el importe viaja como STRING de escala 2, sin pasar por coma flotante", async () => {
    // Once digitos con centimos. `Number` los aguanta, pero la propiedad que se afirma es la del
    // CONTRATO: sale un `string` con dos decimales exactos, no un `number` que la pantalla tenga
    // que volver a formatear.
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const mensajeroId = await algunUsuarioId(tx);
      const zonaId = await sembrarZona(tx, "r19");
      await sembrarCierreDia(tx, mensajeroId, { zonaId, total: "987654321.09" });

      const repo = new CierreBodegaRepository(tx as unknown as PrismaClient);
      return repo.resumirConsolidablesPendientes(zonaId);
    });

    expect(typeof r.totalGeneral).toBe("string");
    expect(r.totalGeneral).toBe("987654321.09");
    expect(r.totalGeneral).toMatch(/^\d+\.\d{2}$/);
  });

  it("R18/AS1: una zona sin ningun consolidable devuelve 0 y \"0.00\", no un hueco", async () => {
    // AS1: el aviso aparece TAMBIEN con cero pendiente, asi que el cero tiene que ser un importe
    // decible y no un `null` que la pantalla tenga que interpretar.
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const zonaId = await sembrarZona(tx, "vacia");
      const repo = new CierreBodegaRepository(tx as unknown as PrismaClient);
      return repo.resumirConsolidablesPendientes(zonaId);
    });

    expect(r).toEqual({ cantidad: 0, totalGeneral: "0.00" });
  });
});
