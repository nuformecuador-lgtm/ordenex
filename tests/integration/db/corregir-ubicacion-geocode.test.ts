import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { ESTADOS_SIN_CORRECCION } from "@/lib/types/correccion-datos-cliente";
import type {
  EnqueueOpts,
  IJobRepository,
  JobDTO,
  JobTxClient,
} from "@/lib/interfaces/repositories/IJobRepository";
import type { JobTipo } from "@prisma/client";
import { hashDireccion } from "@/lib/geo/direccion-query";
import {
  GEOCODIFICACION_MAX_INTENTOS,
  dedupeKeyGeocodificacion,
} from "@/lib/services/jobs/geocodificacion-encolado";

import {
  HAY_BASE_DE_DATOS,
  clienteConTransaccionAnidada,
  crearPrismaDeTest,
  enTransaccionRevertida,
  fksDeOrden,
  serializarEscriturasReales,
} from "./_postgres-real";

/**
 * ⭑ FICHA 327 / B6 — LA PRUEBA DE QUE EL GUARD DE RE-GEOCODIFICACION SE ACTIVA DE VERDAD.
 *
 * ⚠️ ESTE ES EL ARCHIVO QUE LA FICHA NO PODIA DAR POR HECHO, y el motivo esta medido:
 *
 * El guard de la feature 91 vive en `OrdenRepository.update` desde entonces y NUNCA se ha
 * ejecutado end-to-end. Su propio comentario lo decia: «este codigo no es alcanzable hoy». La
 * ficha 312 no usa `update`: usa su hermano `corregirDatosCliente`, que era un `updateMany`
 * suelto. Por tanto **añadir `direccion` al schema NO activaba el guard**, y darlo por hecho
 * habria producido exactamente el bug que el comentario de la 91 describe — **direccion NUEVA,
 * coordenadas VIEJAS, en silencio, sin que ningun test se pusiera rojo**.
 *
 * Lo que la 327 hace es extraer el guard a una implementacion compartida y llamarlo TAMBIEN desde
 * `corregirDatosCliente`. Que eso funcione no se afirma leyendo el codigo: se ejerce aqui, contra
 * Postgres, sobre el camino vivo.
 *
 * POR QUE CONTRA POSTGRES Y NO CON UN PRISMA FALSO. Porque las tres cosas que hay que demostrar
 * son del motor y de la transaccion, no del codigo:
 *  · que la pre-lectura de la direccion ve el valor ANTERIOR (leer despues del `UPDATE` daria
 *    siempre «no cambio», y el test con dobles no notaria la diferencia);
 *  · que la fila de `jobs` aparece DE VERDAD, con su `dedupe_key` y su `max_intentos`;
 *  · que cuando el `updateMany` no alcanza ninguna fila (`conflict`) NO queda ningun job.
 *
 * Todo dentro de una transaccion que se revierte: no queda ni una fila.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const SUFIJO = `327-geo-${Date.now().toString(36)}`;
const GUIA_BASE = 942_000_000 + (Date.now() % 40_000_000);
const SEMBRADO_AT = new Date("2026-01-01T00:00:00.000Z");

const DIRECCION_VIEJA = "avenida siempre viva 742";
const DIRECCION_NUEVA = "calle nueva 10, casa azul";

/** Cola ESPIA: registra el 4.º argumento (el cliente transaccional) sin escribir en `jobs`. */
class ColaEspia implements IJobRepository {
  readonly llamadas: {
    tipo: JobTipo;
    payload: Record<string, unknown>;
    opts: EnqueueOpts;
    tx: JobTxClient | undefined;
  }[] = [];

  async enqueue(
    tipo: JobTipo,
    payload: Record<string, unknown>,
    opts: EnqueueOpts = {},
    tx?: JobTxClient,
  ): Promise<JobDTO | null> {
    this.llamadas.push({ tipo, payload, opts, tx });
    return null;
  }
  async claimBatch(): Promise<JobDTO[]> {
    return [];
  }
  async findByDedupeKeys(): Promise<JobDTO[]> {
    return [];
  }
  async complete(): Promise<void> {}
  async fail(): Promise<void> {}
}

describeSiHayBase("⭑ 327/B6 — el guard de re-geocodificacion, contra Postgres real", () => {
  let prisma: PrismaClient;
  let ESTATUS: Record<string, string>;
  let FKS: {
    estatusId: string;
    tiendaId: string;
    zonaId: string;
    provinciaId: string;
    cantonId: string;
  };

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    const fks = await fksDeOrden(prisma);
    if (fks === null) {
      throw new Error(
        "hay DATABASE_URL pero la tabla `orden` esta vacia: sin FKs no se puede sembrar. Corre " +
          "`pnpm run db:seed` (y las semillas de zonas) antes de esta suite.",
      );
    }
    FKS = fks;
    const valores = ["en_reparto", ...ESTADOS_SIN_CORRECCION];
    const estados = await prisma.orderStatus.findMany({
      where: { value: { in: valores } },
      select: { id: true, value: true },
    });
    ESTATUS = Object.fromEntries(estados.map((e) => [e.value, e.id]));
    const faltan = valores.filter((v) => !ESTATUS[v]);
    if (faltan.length > 0) {
      throw new Error(
        `el catalogo \`order_status\` no tiene ${faltan.join(", ")}. Corre el seed del catalogo.`,
      );
    }
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  /**
   * Siembra UNA orden con `DIRECCION_VIEJA` y ejecuta `fn`. Si `cola` viene, el repositorio la usa
   * en vez del `JobRepository` real: sirve para observar los ARGUMENTOS del encolado. Si no viene,
   * se usa el real y lo que se observa son las FILAS de `jobs`.
   */
  async function conOrden<T>(
    opciones: { estatusValue?: string; cola?: ColaEspia },
    fn: (ctx: { repo: OrdenRepository; tx: PrismaClient; ordenId: string }) => Promise<T>,
  ): Promise<T> {
    return enTransaccionRevertida(prisma, async (txCrudo) => {
      await serializarEscriturasReales(txCrudo);
      const tx = clienteConTransaccionAnidada(txCrudo);
      const orden = await tx.orden.create({
        data: {
          numGuia: GUIA_BASE + Math.floor(Math.random() * 1_000_000),
          numRemision: `R-${SUFIJO}-${Math.random().toString(36).slice(2, 10)}`,
          destinatario: "Ana Peres",
          telefonoDest: "8888-7777",
          producto: "caja de zapatos",
          estatusId: ESTATUS[opciones.estatusValue ?? "en_reparto"],
          tiendaId: FKS.tiendaId,
          zonaId: FKS.zonaId,
          provinciaId: FKS.provinciaId,
          cantonId: FKS.cantonId,
          direccion: DIRECCION_VIEJA,
          peso: "1.500",
          createdAt: SEMBRADO_AT,
          updatedAt: SEMBRADO_AT,
        },
        select: { id: true },
      });
      const repo =
        opciones.cola === undefined
          ? new OrdenRepository(tx)
          : new OrdenRepository(tx, opciones.cola);
      return fn({ repo, tx, ordenId: orden.id });
    });
  }

  /* ---------------------------------------------------------------------- */
  /* R19 — cambiar la direccion encola UNA fila, con su clave y sus intentos  */
  /* ---------------------------------------------------------------------- */

  it("⭑ R19: corregir la DIRECCION deja UNA fila `geocodificacion` en `jobs`", async () => {
    // Contra el `JobRepository` REAL: lo que se afirma es la fila, no la llamada.
    const r = await conOrden({}, async (ctx) => {
      const antes = await ctx.tx.job.count({ where: { tipo: "geocodificacion" } });
      const resultado = await ctx.repo.corregirDatosCliente(
        ctx.ordenId,
        { direccion: DIRECCION_NUEVA },
        ESTADOS_SIN_CORRECCION,
      );
      const filas = await ctx.tx.job.findMany({
        where: { tipo: "geocodificacion", dedupeKey: { contains: ctx.ordenId } },
      });
      const despues = await ctx.tx.job.count({ where: { tipo: "geocodificacion" } });
      return { resultado, antes, despues, filas, ordenId: ctx.ordenId };
    });

    expect(r.resultado).toBe("ok");
    expect(r.despues).toBe(r.antes + 1);
    expect(r.filas).toHaveLength(1);

    const job = r.filas[0];
    // R23 — el payload es EXACTAMENTE el id. Ni la direccion, ni el destinatario, ni el telefono:
    // un job es una fila que lee cualquiera con acceso a la cola.
    expect(job.payload).toEqual({ ordenId: r.ordenId });
    // La clave lleva el HASH de la direccion NUEVA: sin el, una orden ya geocodificada chocaria
    // con su fila `done` (que no se purga) y el encolado se descartaria EN SILENCIO.
    expect(job.dedupeKey).toBe(
      dedupeKeyGeocodificacion(r.ordenId, hashDireccion(DIRECCION_NUEVA)),
    );
    expect(job.maxIntentos).toBe(GEOCODIFICACION_MAX_INTENTOS);
    expect(job.estado).toBe("pending");
  });

  /* ---------------------------------------------------------------------- */
  /* R20 — lo que NO encola                                                   */
  /* ---------------------------------------------------------------------- */

  it.each([
    ["solo el destinatario", () => ({ destinatario: "Ana Perez" })],
    ["solo el peso", () => ({ peso: 4.25 })],
    ["solo la geografia", () => ({ cantonId: FKS.cantonId })],
    ["la MISMA direccion que ya tenia", () => ({ direccion: DIRECCION_VIEJA })],
  ])("⭑ R20: corregir %s NO encola nada", async (_nombre, construir) => {
    // El ultimo caso es el que mas importa: la direccion VIENE INFORMADA y no cambia. Si el guard
    // solo mirase `!== undefined`, cada guardado sin tocar la direccion pagaria una llamada al
    // proveedor de geocodificacion.
    //
    // La carga se construye con una funcion, y no como valor de la tabla, porque `FKS` se resuelve
    // en el `beforeAll`: en el momento en que `it.each` evalua la tabla todavia es `undefined`.
    const carga = construir();
    const r = await conOrden({}, async (ctx) => {
      const antes = await ctx.tx.job.count({ where: { tipo: "geocodificacion" } });
      const resultado = await ctx.repo.corregirDatosCliente(
        ctx.ordenId,
        carga,
        ESTADOS_SIN_CORRECCION,
      );
      const despues = await ctx.tx.job.count({ where: { tipo: "geocodificacion" } });
      const propios = await ctx.tx.job.count({
        where: { tipo: "geocodificacion", dedupeKey: { contains: ctx.ordenId } },
      });
      return { resultado, antes, despues, propios };
    });

    // Anti-vacuidad: la escritura SI ocurrio (menos en el caso de la direccion identica, donde
    // Prisma escribe la misma columna igual: `updateMany` alcanza la fila y devuelve `ok`).
    expect(r.resultado).toBe("ok");
    expect(r.despues).toBe(r.antes);
    expect(r.propios).toBe(0);
  });

  /* ---------------------------------------------------------------------- */
  /* R21 — el OUTBOX: mismo cliente transaccional, y nada si no se escribio   */
  /* ---------------------------------------------------------------------- */

  it("⭑ R21: el encolado recibe como 4.º argumento EL MISMO cliente que escribio la orden", async () => {
    // Esta es la propiedad de la que depende el invariante OUTBOX de la feature 91/R7: si la
    // transaccion del writer revierte, el job desaparece con ella. Se afirma por IDENTIDAD del
    // cliente —no por «hay una fila»—, porque encolar FUERA de la transaccion tambien dejaria una
    // fila y el test seguiria verde.
    const cola = new ColaEspia();
    const r = await conOrden({ cola }, async (ctx) => {
      const resultado = await ctx.repo.corregirDatosCliente(
        ctx.ordenId,
        { direccion: DIRECCION_NUEVA },
        ESTADOS_SIN_CORRECCION,
      );
      return { resultado, tx: ctx.tx };
    });

    expect(r.resultado).toBe("ok");
    expect(cola.llamadas).toHaveLength(1);
    const llamada = cola.llamadas[0];
    expect(llamada.tipo).toBe("geocodificacion");
    // El 4.º argumento NO es `undefined` (que es como encola el gate de asignabilidad, a
    // proposito), y NO es el cliente propio del repositorio de jobs.
    expect(llamada.tx).toBeDefined();
    expect(llamada.tx).toBe(r.tx);
  });

  it.each([...ESTADOS_SIN_CORRECCION])(
    "⭑ R21: con la escritura rechazada por la ventana (`%s`) NO queda job",
    async (estatusValue) => {
      // `count === 0` sale ANTES de llamar al guard: no hubo escritura, no hay nada que
      // geocodificar. Si el encolado se hiciera antes del `updateMany`, este caso dejaria un job
      // huerfano apuntando a una direccion que nunca se guardo.
      const cola = new ColaEspia();
      const r = await conOrden({ estatusValue, cola }, async (ctx) => {
        const resultado = await ctx.repo.corregirDatosCliente(
          ctx.ordenId,
          { direccion: DIRECCION_NUEVA },
          ESTADOS_SIN_CORRECCION,
        );
        const fila = await ctx.tx.orden.findUniqueOrThrow({
          where: { id: ctx.ordenId },
          select: { direccion: true },
        });
        return { resultado, fila };
      });

      expect(r.resultado).toBe("conflict");
      // Anti-vacuidad: la direccion sigue siendo la vieja, es decir, de verdad no se escribio.
      expect(r.fila.direccion).toBe(DIRECCION_VIEJA);
      expect(cola.llamadas).toEqual([]);
    },
  );

  /* ---------------------------------------------------------------------- */
  /* R22 — la correccion NO escribe coordenadas                               */
  /* ---------------------------------------------------------------------- */

  it("⭑ R22: encolar la re-geocodificacion NO toca las coordenadas de la orden", async () => {
    // Ponerlas a `null` «para que se note» dejaria la orden fuera de las puertas que exigen
    // coordenadas hasta que corriera el trabajo: la correccion de un dato bloquearia la operacion.
    const r = await conOrden({}, async (ctx) => {
      await ctx.tx.orden.update({
        where: { id: ctx.ordenId },
        data: {
          latitud: "9.9281",
          longitud: "-84.0907",
          geocodedAt: SEMBRADO_AT,
          geocodeStatus: "OK",
        },
      });
      const resultado = await ctx.repo.corregirDatosCliente(
        ctx.ordenId,
        { direccion: DIRECCION_NUEVA },
        ESTADOS_SIN_CORRECCION,
      );
      const fila = await ctx.tx.orden.findUniqueOrThrow({
        where: { id: ctx.ordenId },
        select: {
          direccion: true,
          latitud: true,
          longitud: true,
          geocodedAt: true,
          geocodeStatus: true,
        },
      });
      return { resultado, fila };
    });

    expect(r.resultado).toBe("ok");
    // La direccion SI cambio (anti-vacuidad) y las coordenadas NO.
    expect(r.fila.direccion).toBe(DIRECCION_NUEVA);
    expect(r.fila.latitud?.toString()).toBe("9.9281");
    expect(r.fila.longitud?.toString()).toBe("-84.0907");
    expect(r.fila.geocodedAt?.toISOString()).toBe(SEMBRADO_AT.toISOString());
    expect(r.fila.geocodeStatus).toBe("OK");
  });
});
