import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { CierresAdminRepository } from "@/lib/repositories/CierresAdminRepository";
import type { Alcance } from "@/lib/interfaces/repositories/ICierresAdminRepository";

import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  fksDeOrden,
  serializarEscriturasReales,
} from "./_postgres-real";

/**
 * Feature 238 (T1.3, R2/R3/R4/R6) — EL `WHERE` DEL CONJUNTO ESPERADO, EJECUTADO CONTRA POSTGRES.
 *
 * POR QUE ESTE ARCHIVO EXISTE, aunque ya haya un test unitario del mismo metodo. Los tests de
 * servicio usan dobles del repositorio y NO VEN EL SQL; el unitario usa un doble que aplica el
 * predicado, que es mucho mejor, pero sigue siendo una re-implementacion mia de la semantica de
 * Postgres. Lo que NINGUNO de los dos puede demostrar es que el `where` que Prisma traduce
 * —incluida la condicion sobre la RELACION `cierre`, que se convierte en un JOIN— seleccione de
 * verdad las filas que decimos. Este repo ya midio cuatro veces que una mutacion del `where`
 * pasa en verde por arriba.
 *
 * TODO corre dentro de una transaccion que SIEMPRE se revierte: si el test pasa, si falla o si
 * el proceso muere, no queda ni una fila.
 *
 * SIN BASE ALCANZABLE se SALTA (no pasa en verde): un `skip` se ve en la salida; un `return`
 * silencioso dentro del caso se leeria como `passed` sin haber comprobado nada, que es peor que
 * no tener el test. Con base pero sin datos de catalogo, FALLA con un mensaje que dice que hay
 * que sembrar — tampoco se disfraza de verde.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

/** Sufijo unico por corrida: `num_remision` y `num_guia` son UNIQUE en `orden`. */
const SUFIJO = `238-${Date.now().toString(36)}`;
const GUIA_BASE = 900_000_000 + (Date.now() % 50_000_000);

interface Semilla {
  clave: string;
  resultado: "devuelta" | "rechazada" | "reprogramada" | "entregada" | "incidente";
  /** `false` = la orden nace sin numero de guia (R13: no se omite, viaja `null`). */
  conGuia?: boolean;
  anulada?: boolean;
  /** `"satelite"` = la gestion cuelga del cierre de la OTRA bodega (testigo del alcance). */
  cierre?: "central" | "satelite" | "otro";
}

// Un cierre con las tres clases que vuelven, las dos que no, una anulada, una de OTRO cierre
// central y una del cierre del SATELITE. Cada fila es el testigo de una condicion del WHERE.
const SEMILLAS: Semilla[] = [
  { clave: "dev", resultado: "devuelta" },
  { clave: "rec", resultado: "rechazada" },
  { clave: "rep", resultado: "reprogramada" },
  { clave: "sin-guia", resultado: "devuelta", conGuia: false },
  { clave: "entregada", resultado: "entregada" },
  { clave: "incidente", resultado: "incidente" },
  { clave: "anulada", resultado: "devuelta", anulada: true },
  { clave: "otro-cierre", resultado: "devuelta", cierre: "otro" },
  { clave: "del-satelite", resultado: "devuelta", cierre: "satelite" },
];

describeSiHayBase("238/T1.3 — findGestionesRetornablesDelCierre contra Postgres real", () => {
  let prisma: PrismaClient;

  /** Ejecuta `fn` con el corpus sembrado y revierte todo al terminar. */
  let conCorpus: <T>(
    fn: (ctx: {
      repo: CierresAdminRepository;
      cierreCentral: string;
      cierreSatelite: string;
      cierreOtro: string;
      zonaId: string;
      gestionPorClave: Map<string, string>;
      guiaPorClave: Map<string, number | null>;
    }) => Promise<T>,
  ) => Promise<T>;

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    const fks = await fksDeOrden(prisma);
    // Fallo RUIDOSO, no `return` silencioso: con base alcanzable y sin catalogo, este archivo no
    // puede comprobar nada, y un `passed` en esas condiciones es exactamente la clase de verde
    // que este repo ya se comio una vez.
    if (fks === null) {
      throw new Error(
        "hay DATABASE_URL pero la tabla `orden` esta vacia: sin FKs no se puede sembrar el " +
          "corpus. Corre `pnpm run db:seed` (y las semillas de zonas) antes de esta suite.",
      );
    }
    // `gestion_orden.mensajero_id` y `cierre_dia.mensajero_id` son FK -> `usuario`. Se reusa el
    // id de la tienda de una orden real: lo que se mide aqui es un WHERE, no un rol.
    const usuarioId = fks.tiendaId;

    conCorpus = (fn) =>
      enTransaccionRevertida(prisma, async (tx) => {
        // PRIMERA sentencia: serializa contra los otros archivos que escriben en las tablas
        // reales de `public` (ver `_postgres-real.ts`).
        await serializarEscriturasReales(tx);

        const nuevoCierre = (destinoTipo: "bodega_central" | "bodega_satelite") =>
          tx.cierreDia.create({
            data: {
              mensajeroId: usuarioId,
              estado: "solicitado",
              destinoTipo,
              destinoZonaId: fks.zonaId,
            },
            select: { id: true },
          });

        const central = await nuevoCierre("bodega_central");
        const otro = await nuevoCierre("bodega_central");
        const satelite = await nuevoCierre("bodega_satelite");
        const idDelCierre = { central: central.id, otro: otro.id, satelite: satelite.id };

        const gestionPorClave = new Map<string, string>();
        const guiaPorClave = new Map<string, number | null>();
        let n = 0;
        for (const s of SEMILLAS) {
          n += 1;
          const numGuia = s.conGuia === false ? null : GUIA_BASE + n;
          const orden = await tx.orden.create({
            data: {
              numGuia,
              numRemision: `R-${SUFIJO}-${s.clave}`,
              destinatario: "Corpus 238",
              telefonoDest: "88880000",
              producto: "caja",
              estatusId: fks.estatusId, // R4: el estatus VIVO es irrelevante para el conjunto
              tiendaId: fks.tiendaId,
              zonaId: fks.zonaId,
              provinciaId: fks.provinciaId,
              cantonId: fks.cantonId,
            },
            select: { id: true },
          });
          const gestion = await tx.gestionOrden.create({
            data: {
              ordenId: orden.id,
              mensajeroId: usuarioId,
              resultado: s.resultado,
              cierreId: idDelCierre[s.cierre ?? "central"],
              anuladaAt: s.anulada ? new Date() : null,
            },
            select: { id: true },
          });
          gestionPorClave.set(s.clave, gestion.id);
          guiaPorClave.set(s.clave, numGuia);
        }

        const repo = new CierresAdminRepository(
          tx as unknown as PrismaClient,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
        );
        return fn({
          repo,
          cierreCentral: central.id,
          cierreSatelite: satelite.id,
          cierreOtro: otro.id,
          zonaId: fks.zonaId,
          gestionPorClave,
          guiaPorClave,
        });
      });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("R2/R3: el SQL real devuelve las tres clases que vuelven y NADA mas", async () => {
    const { salen, esperadas } = await conCorpus(async (ctx) => {
      const filas = await ctx.repo.findGestionesRetornablesDelCierre(ctx.cierreCentral, {
        destinoTipo: "bodega_central",
        destinoZonaId: null,
      });
      return {
        salen: filas.map((f) => f.gestionId).sort(),
        esperadas: ["dev", "rec", "rep", "sin-guia"]
          .map((c) => ctx.gestionPorClave.get(c) as string)
          .sort(),
      };
    });

    // Igualdad EXACTA: lo que sobra importa tanto como lo que falta. `entregada` e `incidente`
    // del MISMO cierre, la ANULADA, la de OTRO cierre y la del SATELITE quedan fuera, y cada una
    // de esas exclusiones la produce una condicion distinta del WHERE.
    expect(salen).toEqual(esperadas);
    expect(salen).toHaveLength(4);
  });

  it("R13: la gestion cuya orden no tiene guia sale con `numGuia: null`, no se omite", async () => {
    const fila = await conCorpus(async (ctx) => {
      const filas = await ctx.repo.findGestionesRetornablesDelCierre(ctx.cierreCentral, {
        destinoTipo: "bodega_central",
        destinoZonaId: null,
      });
      return filas.find((f) => f.gestionId === ctx.gestionPorClave.get("sin-guia")) ?? null;
    });

    expect(fila).not.toBeNull();
    expect(fila?.numGuia).toBeNull();
    expect(fila?.resultado).toBe("devuelta");
  });

  it("la guia y el resultado que viajan son los de la BASE, no los que el test supone", async () => {
    const { leidas, sembradas } = await conCorpus(async (ctx) => {
      const filas = await ctx.repo.findGestionesRetornablesDelCierre(ctx.cierreCentral, {
        destinoTipo: "bodega_central",
        destinoZonaId: null,
      });
      const porGestion = new Map(filas.map((f) => [f.gestionId, f]));
      return {
        leidas: ["dev", "rec", "rep"].map((c) => {
          const f = porGestion.get(ctx.gestionPorClave.get(c) as string);
          return `${c}:${f?.numGuia}:${f?.resultado}`;
        }),
        sembradas: ["dev:devuelta", "rec:rechazada", "rep:reprogramada"].map((par, i) => {
          const [clave, resultado] = par.split(":");
          void i;
          return `${clave}:${ctx.guiaPorClave.get(clave)}:${resultado}`;
        }),
      };
    });

    expect(leidas).toEqual(sembradas);
  });

  it("R6: el alcance del SATELITE no ve el cierre central (y ve el suyo)", async () => {
    const { comoSatelite, suPropio, otraZona } = await conCorpus(async (ctx) => {
      const alcanceSatelite: Alcance = {
        destinoTipo: "bodega_satelite",
        destinoZonaId: ctx.zonaId,
      };
      return {
        comoSatelite: await ctx.repo.findGestionesRetornablesDelCierre(
          ctx.cierreCentral,
          alcanceSatelite,
        ),
        suPropio: await ctx.repo.findGestionesRetornablesDelCierre(
          ctx.cierreSatelite,
          alcanceSatelite,
        ),
        // Un satelite de OTRA zona: mismo `destino_tipo`, zona distinta.
        otraZona: await ctx.repo.findGestionesRetornablesDelCierre(ctx.cierreSatelite, {
          destinoTipo: "bodega_satelite",
          destinoZonaId: "zona-que-no-existe",
        }),
      };
    });

    // El cierre central EXISTE y tiene cuatro retornables: para el satelite es indistinguible de
    // un cierre inexistente. Esa es la propiedad de R6, y aqui la produce el JOIN, no un `if`.
    expect(comoSatelite).toEqual([]);
    expect(otraZona).toEqual([]);
    // Contrapunto obligatorio: si el WHERE devolviera siempre vacio, las dos de arriba pasarian
    // igual. Su propio cierre SI sale.
    expect(suPropio).toHaveLength(1);
  });

  it("R6: un cierre inexistente devuelve `[]` (mismo desenlace, sin distinguirse)", async () => {
    const filas = await conCorpus((ctx) =>
      ctx.repo.findGestionesRetornablesDelCierre("00000000-0000-4000-8000-000000000000", {
        destinoTipo: "bodega_central",
        destinoZonaId: null,
      }),
    );
    expect(filas).toEqual([]);
  });
});
