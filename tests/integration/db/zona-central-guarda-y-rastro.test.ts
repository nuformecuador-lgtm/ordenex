import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";

import { ZonaRepository } from "@/lib/repositories/ZonaRepository";
import type {
  UpdateZonaData,
  UpdateZonaResult,
} from "@/lib/interfaces/repositories/IZonaRepository";

import {
  HAY_BASE_DE_DATOS,
  RegistroCaido,
  clienteConSavepoint,
  crearPrismaDeTest,
  enTransaccionRevertida,
  fksDeOrden,
  serializarEscriturasReales,
  type TxDeTest,
} from "./_postgres-real";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 376 / T11 — LA GUARDA Y EL RASTRO DE LA ZONA CENTRAL, CONTRA POSTGRES REAL.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// POR QUE ESTE ARCHIVO ES OBLIGATORIO Y NO UN EXTRA. Esta ficha vive entera en el `data` y en el
// `WHERE` de Prisma, y los tests con dobles NO VEN NADA DE ESO:
//
//   · R1 («ausente no es apagado») es literalmente la propiedad de Prisma de tratar `undefined`
//     como «campo no provisto». Con un doble, `data.esCentral === undefined` no escribe nada
//     PORQUE EL DOBLE NO ESCRIBE NADA: el test daria verde aunque la propiedad no existiera. Aqui
//     se lee la columna DESPUES del guardado.
//   · R5 es un `if` dentro de la transaccion, y lo que hay que demostrar no es que devuelva un
//     literal: es que NO SE APLICO NINGUNA de las cuatro escrituras del guardado. Eso son filas.
//   · R10 es un rechazo que las FK NO cubren: una zona central SIN ninguna orden y SIN ningun
//     usuario. Un doble no puede demostrar que la zona sigue existiendo.
//
// Este repo tiene MEDIDO cuatro veces que una mutacion del `WHERE` pasa en verde contra dobles.
//
// ⚠️ NADA DE `if (!fks) return;`: con base y sin catalogo esto REVIENTA con un mensaje que dice
// que hacer. Un test que no encuentra datos y se va por un `return` reporta `passed` sin haber
// comprobado nada, y este repo ya se comio ese verde. Sin base alcanzable, `describe.skip` VISIBLE.
//
// ⚠️ LA BASE LOCAL ES COMPARTIDA Y `zona_es_central_unico` ES UN INDICE UNICO PARCIAL GLOBAL: no se
// puede crear una segunda zona central mientras exista la de verdad. Por eso cada escenario APAGA
// TODAS las marcas dentro de su propia transaccion —que SIEMPRE se revierte— y lo AFIRMA antes de
// seguir. Sin esa afirmacion, un escenario que arrancara con la marca puesta en otro sitio mediria
// una historia distinta de la que dice medir.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const SUFIJO = `376-${Date.now().toString(36)}`;
let contador = 0;
/** Sufijo unico por fila: `zona.nombre` es UNIQUE y `orden.num_remision` lo es por tienda. */
function unico(): string {
  contador += 1;
  return `${SUFIJO}-${contador.toString(36)}-${randomUUID().slice(0, 6)}`;
}

/** La forma que `update` espera, SIN la marca: el caso de R1. */
function datosSinMarca(nombre: string, distritoIds: string[]): UpdateZonaData {
  return { nombre, cobroVehiculo: false, distritoIds, tarifas: [] };
}

/** El desenlace `ok`, o un fallo RUIDOSO. Nunca un `undefined` que pase por vacuidad. */
function soloOk(res: UpdateZonaResult): Extract<UpdateZonaResult, { estado: "ok" }> {
  if (res.estado !== "ok") throw new Error(`se esperaba \`ok\` y llego \`${res.estado}\``);
  return res;
}

/** Una fila de `historial_accion` del cambio de marca, con lo que R13 exige comprobar. */
interface FilaDeMarca {
  entidadId: string | null;
  entidadTipo: string;
  entidadEtiqueta: string;
  valorAnterior: string | null;
  valorNuevo: string | null;
  monto: Prisma.Decimal | null;
  loteId: string;
  actorUsuarioId: string | null;
  actorNombre: string | null;
  actorRol: string | null;
  accion: string;
}

interface Escenario {
  tx: TxDeTest;
  repo: ZonaRepository;
  zonas: {
    A: { id: string; nombre: string };
    B: { id: string; nombre: string };
    C: { id: string; nombre: string };
  };
  crearDistrito: (zonaIds: string[]) => Promise<string>;
  crearOrden: (opciones: {
    zonaId: string;
    distritoId?: string | null;
    borrada?: boolean;
    congelada?: boolean;
  }) => Promise<string>;
  crearTarifaDeZona: (zonaId: string) => Promise<void>;
  /** Las filas `zona_central_cambiada` de las zonas indicadas, en orden de escritura. */
  marcasDe: (zonaIds: string[]) => Promise<FilaDeMarca[]>;
  /** Cuantas zonas tienen HOY la marca (en toda la base, dentro de esta transaccion). */
  centralesVivas: () => Promise<string[]>;
  zonaCompleta: (id: string) => Promise<{
    nombre: string;
    esCentral: boolean;
    distritos: number;
    tarifas: number;
  }>;
}

describeSiHayBase("⭑ 376/T11 — la zona central: guarda, borrado y rastro (Postgres real)", () => {
  let prisma: PrismaClient;
  let FKS: NonNullable<Awaited<ReturnType<typeof fksDeOrden>>>;
  let USUARIO: string;
  let NOMBRE_ACTOR: string;
  let ROL_ACTOR: string;

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
    const usuario = await prisma.usuario.findFirst({
      select: { id: true, nombre: true, primerApellido: true, rol: { select: { value: true } } },
    });
    if (usuario === null) {
      throw new Error(
        "hacen falta usuarios en la base: el actor congelado de R13 cuelga de uno. Corre " +
          "`pnpm run db:seed:maestro`.",
      );
    }
    USUARIO = usuario.id;
    NOMBRE_ACTOR = [usuario.nombre, usuario.primerApellido].filter((p) => p).join(" ");
    ROL_ACTOR = usuario.rol.value;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  /**
   * Siembra tres zonas y entrega los constructores del escenario. TODO se revierte.
   *
   * `centralInicial` dice cual de las tres arranca con la marca —o ninguna, que es el caso de R8—.
   * Antes de nada se apaga la marca de TODA la base dentro de esta transaccion: el indice unico
   * parcial es global y sin eso no se podria marcar ninguna zona de prueba.
   */
  async function conEscenario<T>(
    centralInicial: "A" | "B" | "ninguna",
    fn: (e: Escenario) => Promise<T>,
  ): Promise<T> {
    return enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);

      // El mundo real, apagado DENTRO de la transaccion que se revierte.
      await tx.zona.updateMany({ where: { esCentral: true }, data: { esCentral: false } });
      const quedan = await tx.zona.count({ where: { esCentral: true } });
      // Anti-vacuidad de la PREMISA: si esto no fuera cero, «la unica central es A» seria mentira
      // y todos los casos de abajo medirian otra cosa.
      if (quedan !== 0) throw new Error(`el escenario arranca con ${quedan} centrales: imposible`);

      const nombres = { A: `376 A ${unico()}`, B: `376 B ${unico()}`, C: `376 C ${unico()}` };
      const [a, b, c] = await Promise.all([
        tx.zona.create({ data: { nombre: nombres.A }, select: { id: true } }),
        tx.zona.create({ data: { nombre: nombres.B }, select: { id: true } }),
        tx.zona.create({ data: { nombre: nombres.C }, select: { id: true } }),
      ]);
      const ids = { A: a.id, B: b.id, C: c.id };
      if (centralInicial !== "ninguna") {
        await tx.zona.update({ where: { id: ids[centralInicial] }, data: { esCentral: true } });
      }

      const escenario: Escenario = {
        tx,
        // `update`/`create`/`hardDelete` abren su propia `$transaction`; el savepoint la traduce a
        // uno REAL, asi que el SQL medido es el de produccion y un fallo revierte de verdad.
        repo: new ZonaRepository(clienteConSavepoint(tx)),
        zonas: {
          A: { id: ids.A, nombre: nombres.A },
          B: { id: ids.B, nombre: nombres.B },
          C: { id: ids.C, nombre: nombres.C },
        },

        crearDistrito: async (zonaIds) => {
          const d = await tx.distrito.create({
            data: { nombre: `376 D ${unico()}`, cantonId: FKS.cantonId },
            select: { id: true },
          });
          for (const zonaId of zonaIds) {
            await tx.zonaDistrito.create({ data: { zonaId, distritoId: d.id } });
          }
          return d.id;
        },

        crearOrden: async ({ zonaId, distritoId = null, borrada = false, congelada = false }) => {
          const o = await tx.orden.create({
            data: {
              numRemision: `R-${unico()}`,
              destinatario: "Destinataria 376",
              telefonoDest: "8888-0000",
              producto: "caja de zapatos",
              estatusId: FKS.estatusId,
              tiendaId: FKS.tiendaId,
              zonaId,
              provinciaId: FKS.provinciaId,
              cantonId: FKS.cantonId,
              distritoId,
              direccion: "avenida siempre viva 742",
              montoCobrar: 12_000,
              deletedAt: borrada ? new Date() : null,
            },
            select: { id: true },
          });
          if (congelada) {
            const cierre = await tx.cierreDia.create({
              data: {
                mensajeroId: USUARIO,
                estado: "solicitado",
                destinoTipo: "bodega_central",
                destinoZonaId: zonaId,
              },
              select: { id: true },
            });
            await tx.cierreDetail.create({
              data: {
                cierreId: cierre.id,
                ordenId: o.id,
                cobraComision: false,
                zonaId,
                tiendaId: FKS.tiendaId,
                esCentral: false,
                numRemision: `R-${unico()}`,
                destinatario: "Destinataria 376",
                producto: "caja de zapatos",
                tiendaNombre: "Tienda de prueba",
                zonaNombre: "Zona congelada",
                provinciaNombre: "Provincia",
                cantonNombre: "Canton",
              },
              select: { id: true },
            });
          }
          return o.id;
        },

        crearTarifaDeZona: async (zonaId) => {
          await tx.tarifaZonaMensajero.create({
            data: {
              zonaId,
              cobroEntregado: new Prisma.Decimal("1000.00"),
              cobroRechazado: new Prisma.Decimal("500.00"),
            },
            select: { id: true },
          });
        },

        marcasDe: async (zonaIds) =>
          (await tx.historialAccion.findMany({
            where: { accion: "zona_central_cambiada", entidadId: { in: zonaIds } },
            orderBy: { createdAt: "asc" },
            select: {
              entidadId: true,
              entidadTipo: true,
              entidadEtiqueta: true,
              valorAnterior: true,
              valorNuevo: true,
              monto: true,
              loteId: true,
              actorUsuarioId: true,
              actorNombre: true,
              actorRol: true,
              accion: true,
            },
          })) as unknown as FilaDeMarca[],

        centralesVivas: async () =>
          (await tx.zona.findMany({ where: { esCentral: true }, select: { id: true } })).map(
            (z) => z.id,
          ),

        zonaCompleta: async (id) => {
          const z = await tx.zona.findUniqueOrThrow({
            where: { id },
            select: {
              nombre: true,
              esCentral: true,
              _count: { select: { distritos: true, tarifaZonaMensajeros: true } },
            },
          });
          return {
            nombre: z.nombre,
            esCentral: z.esCentral,
            distritos: z._count.distritos,
            tarifas: z._count.tarifaZonaMensajeros,
          };
        },
      };

      return fn(escenario);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // A — Ausente no es apagado (R1, R3, R4)
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  it("⭑ R1: la marca SOBREVIVE a su ausencia en el payload", async () => {
    // EL DEFECTO QUE ABRE LA FICHA, medido donde vive: en la columna, despues del guardado.
    // MUTACION PROBADA A MANO (2026-09-07): volver `esCentral` obligatorio en `UpdateZonaData` y
    // escribir `esCentral: data.esCentral ?? false` -> este caso se pone rojo (`false`).
    const medido = await conEscenario("A", async (e) => {
      const distrito = await e.crearDistrito([e.zonas.A.id]);
      const res = await e.repo.update(
        e.zonas.A.id,
        datosSinMarca(e.zonas.A.nombre, [distrito]),
        USUARIO,
      );
      return {
        estado: res.estado,
        zona: await e.zonaCompleta(e.zonas.A.id),
        centrales: await e.centralesVivas(),
        idA: e.zonas.A.id,
        filas: await e.marcasDe([e.zonas.A.id, e.zonas.B.id, e.zonas.C.id]),
      };
    });

    expect(medido.estado).toBe("ok");
    expect(medido.zona.esCentral, "el guardado apago la marca sin que nadie lo pidiera").toBe(true);
    expect(medido.centrales).toEqual([medido.idA]);
    // R18: no hubo cambio, asi que no hay fila.
    expect(medido.filas).toEqual([]);
  }, 60_000);

  it("⭑ R4: el resto del guardado SI se aplica entero — nombre, distritos y tarifas", async () => {
    // La otra mitad de R1: la marca se conserva sin congelar nada mas. Sin este caso, «no tocar la
    // columna» podria haberse implementado saltandose el `update` entero.
    const medido = await conEscenario("A", async (e) => {
      const viejo = await e.crearDistrito([e.zonas.A.id]);
      const nuevo = await e.crearDistrito([]);
      await e.crearTarifaDeZona(e.zonas.A.id);
      const nombreNuevo = `376 A renombrada ${unico()}`;

      const res = await e.repo.update(
        e.zonas.A.id,
        {
          nombre: nombreNuevo,
          cobroVehiculo: false,
          distritoIds: [nuevo],
          tarifas: [{ cobroEntregado: 7777, cobroRechazado: 3333, vehiculoId: null }],
        },
        USUARIO,
      );

      const distritosFinales = await e.tx.zonaDistrito.findMany({
        where: { zonaId: e.zonas.A.id },
        select: { distritoId: true },
      });
      const tarifasFinales = await e.tx.tarifaZonaMensajero.findMany({
        where: { zonaId: e.zonas.A.id },
        select: { cobroEntregado: true },
      });

      return {
        estado: res.estado,
        zona: await e.zonaCompleta(e.zonas.A.id),
        nombreNuevo,
        distritosFinales: distritosFinales.map((d) => d.distritoId),
        nuevo,
        viejo,
        cobros: tarifasFinales.map((t) => t.cobroEntregado.toNumber()),
      };
    });

    expect(medido.estado).toBe("ok");
    expect(medido.zona.nombre).toBe(medido.nombreNuevo);
    expect(medido.distritosFinales).toEqual([medido.nuevo]);
    expect(medido.distritosFinales).not.toContain(medido.viejo);
    expect(medido.cobros).toEqual([7777]);
    // Y la marca, intacta.
    expect(medido.zona.esCentral).toBe(true);
  }, 60_000);

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // B — Nunca sin zona central (R3, R5, R8, R9, R19)
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  it("⭑ R3/R5/R19: `false` EXPLICITO sobre la unica central se RECHAZA, y NADA cambia", async () => {
    // MUTACION PROBADA A MANO (2026-09-07): quitar la condicion del paso 2 de `update` -> este
    // caso se pone rojo por `estado` Y por las cuatro cosas que se habrian escrito.
    const medido = await conEscenario("A", async (e) => {
      const viejo = await e.crearDistrito([e.zonas.A.id]);
      const otro = await e.crearDistrito([]);
      await e.crearTarifaDeZona(e.zonas.A.id);
      const antes = await e.zonaCompleta(e.zonas.A.id);

      const res = await e.repo.update(
        e.zonas.A.id,
        {
          nombre: `376 A NO DEBE GUARDARSE ${unico()}`,
          cobroVehiculo: false,
          distritoIds: [otro],
          tarifas: [{ cobroEntregado: 1, cobroRechazado: 1, vehiculoId: null }],
          esCentral: false,
        },
        USUARIO,
      );

      const distritos = await e.tx.zonaDistrito.findMany({
        where: { zonaId: e.zonas.A.id },
        select: { distritoId: true },
      });
      const tarifas = await e.tx.tarifaZonaMensajero.findMany({
        where: { zonaId: e.zonas.A.id },
        select: { cobroEntregado: true },
      });

      return {
        res,
        antes,
        despues: await e.zonaCompleta(e.zonas.A.id),
        distritos: distritos.map((d) => d.distritoId),
        viejo,
        cobros: tarifas.map((t) => t.cobroEntregado.toNumber()),
        centrales: await e.centralesVivas(),
        idA: e.zonas.A.id,
        // R19: ni una fila de historial, ni de esta accion ni de ninguna otra sobre estas zonas.
        filasDeMarca: await e.marcasDe([e.zonas.A.id, e.zonas.B.id, e.zonas.C.id]),
        historialTotal: await e.tx.historialAccion.count({
          where: { entidadId: { in: [e.zonas.A.id, e.zonas.B.id, e.zonas.C.id] } },
        }),
      };
    });

    expect(medido.res).toEqual({ estado: "sin_zona_central" });
    // R5: EL GUARDADO COMPLETO, no aplicado. Las cuatro escrituras del `update`, una por una.
    expect(medido.despues.nombre, "se guardo el nombre pese al rechazo").toBe(medido.antes.nombre);
    expect(medido.despues.esCentral).toBe(true);
    expect(medido.distritos).toEqual([medido.viejo]);
    expect(medido.cobros).toEqual([1000]);
    expect(medido.centrales).toEqual([medido.idA]);
    // R19.
    expect(medido.filasDeMarca).toEqual([]);
    expect(medido.historialTotal).toBe(0);
  }, 60_000);

  it("⭑ R8: sin ninguna zona central, guardar una zona con `esCentral: false` se ACEPTA", async () => {
    // La guarda es «no quedarse sin», no «siempre debe haber». Este caso es el que impide que
    // alguien la endurezca hasta romper el arranque de una base vacia y los seeds.
    const medido = await conEscenario("ninguna", async (e) => {
      const distrito = await e.crearDistrito([e.zonas.A.id]);
      const res = await e.repo.update(
        e.zonas.A.id,
        { ...datosSinMarca(e.zonas.A.nombre, [distrito]), esCentral: false },
        USUARIO,
      );
      return {
        estado: res.estado,
        zona: await e.zonaCompleta(e.zonas.A.id),
        centrales: await e.centralesVivas(),
        filas: await e.marcasDe([e.zonas.A.id]),
      };
    });

    expect(medido.estado).toBe("ok");
    expect(medido.zona.esCentral).toBe(false);
    expect(medido.centrales).toEqual([]);
    expect(medido.filas).toEqual([]); // R18: no cambio nada
  }, 60_000);

  it("R5 acotado: `false` sobre una zona que NO es la central se acepta y la apaga", async () => {
    // El control positivo de la guarda: sin el, un `return "sin_zona_central"` incondicional
    // pasaria el caso de arriba.
    const medido = await conEscenario("A", async (e) => {
      const distrito = await e.crearDistrito([e.zonas.B.id]);
      const res = await e.repo.update(
        e.zonas.B.id,
        { ...datosSinMarca(e.zonas.B.nombre, [distrito]), esCentral: false },
        USUARIO,
      );
      return {
        estado: res.estado,
        centrales: await e.centralesVivas(),
        idA: e.zonas.A.id,
      };
    });

    expect(medido.estado).toBe("ok");
    expect(medido.centrales).toEqual([medido.idA]);
  }, 60_000);

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // C/D — El traslado, y su rastro (R9, R12, R13, R15, R18)
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  it("⭑ R9/R12: el traslado deja EXACTAMENTE una central y escribe DOS filas", async () => {
    const medido = await conEscenario("A", async (e) => {
      const distrito = await e.crearDistrito([e.zonas.B.id]);
      const res = await e.repo.update(
        e.zonas.B.id,
        { ...datosSinMarca(e.zonas.B.nombre, [distrito]), esCentral: true },
        USUARIO,
      );
      return {
        reconciliadas: soloOk(res).ordenesReconciliadas,
        centrales: await e.centralesVivas(),
        zonaA: await e.zonaCompleta(e.zonas.A.id),
        zonaB: await e.zonaCompleta(e.zonas.B.id),
        filas: await e.marcasDe([e.zonas.A.id, e.zonas.B.id, e.zonas.C.id]),
        ids: { A: e.zonas.A.id, B: e.zonas.B.id },
        nombres: { A: e.zonas.A.nombre, B: e.zonas.B.nombre },
      };
    });

    // R9: la marca se traslada y queda EXACTAMENTE una.
    expect(medido.centrales).toEqual([medido.ids.B]);
    expect(medido.zonaA.esCentral).toBe(false);
    expect(medido.zonaB.esCentral).toBe(true);

    // R12: UNA fila por CADA zona cuya marca cambio. La de A es la que hoy no existe.
    expect(medido.filas).toHaveLength(2);
    const porZona = new Map(medido.filas.map((f) => [f.entidadId, f]));
    expect(porZona.get(medido.ids.A)).toMatchObject({
      valorAnterior: "true",
      valorNuevo: "false",
      entidadEtiqueta: medido.nombres.A,
    });
    expect(porZona.get(medido.ids.B)).toMatchObject({
      valorAnterior: "false",
      valorNuevo: "true",
      entidadEtiqueta: medido.nombres.B,
    });
    // Nada mas se movio: este guardado no reconcilio ninguna orden.
    expect(medido.reconciliadas).toBe(0);
  }, 60_000);

  it("⭑ R13: la forma de la fila — entidad, etiqueta, actor congelado y `monto` NULL", async () => {
    const medido = await conEscenario("A", async (e) => {
      const distrito = await e.crearDistrito([e.zonas.B.id]);
      await e.repo.update(
        e.zonas.B.id,
        { ...datosSinMarca(e.zonas.B.nombre, [distrito]), esCentral: true },
        USUARIO,
      );
      return { filas: await e.marcasDe([e.zonas.A.id, e.zonas.B.id]) };
    });

    expect(medido.filas).toHaveLength(2);
    for (const fila of medido.filas) {
      expect(fila.accion).toBe("zona_central_cambiada");
      expect(fila.entidadTipo).toBe("zona");
      expect(fila.entidadEtiqueta.length).toBeGreaterThan(0);
      // R13: quien, y congelado — no resuelto por join al leer.
      expect(fila.actorUsuarioId).toBe(USUARIO);
      expect(fila.actorNombre).toBe(NOMBRE_ACTOR);
      expect(fila.actorRol).toBe(ROL_ACTOR);
      // El importe que se mueve no es uno solo: son dos tarifas por cada tienda de dos zonas.
      expect(fila.monto).toBeNull();
    }
  }, 60_000);

  it("⭑ R15: las dos filas comparten lote, y ese lote es propio del acto", async () => {
    const medido = await conEscenario("A", async (e) => {
      const dB = await e.crearDistrito([e.zonas.B.id]);
      const dC = await e.crearDistrito([e.zonas.C.id]);

      await e.repo.update(
        e.zonas.B.id,
        { ...datosSinMarca(e.zonas.B.nombre, [dB]), esCentral: true },
        USUARIO,
      );
      const trasPrimero = await e.marcasDe([e.zonas.A.id, e.zonas.B.id, e.zonas.C.id]);

      // Un SEGUNDO guardado: la marca pasa de B a C.
      await e.repo.update(
        e.zonas.C.id,
        { ...datosSinMarca(e.zonas.C.nombre, [dC]), esCentral: true },
        USUARIO,
      );
      const todas = await e.marcasDe([e.zonas.A.id, e.zonas.B.id, e.zonas.C.id]);

      return {
        lotesPrimero: [...new Set(trasPrimero.map((f) => f.loteId))],
        lotesTodos: [...new Set(todas.map((f) => f.loteId))],
        total: todas.length,
      };
    });

    // Las dos filas del PRIMER acto, un solo lote.
    expect(medido.lotesPrimero).toHaveLength(1);
    // Cuatro filas en total y DOS lotes: dos actos distintos, no cuatro sueltos ni uno solo.
    expect(medido.total).toBe(4);
    expect(medido.lotesTodos).toHaveLength(2);
  }, 60_000);

  it("⭑ design §7.1: el lote de la marca es DISTINTO del de la reconciliacion del MISMO guardado", async () => {
    // Dos hechos de naturaleza distinta en un solo guardado. Si compartieran lote, filtrar por
    // lote devolveria una mezcla de zonas y de ordenes que nadie pidio.
    const medido = await conEscenario("A", async (e) => {
      // Un distrito que este guardado le da a B, con una orden que hoy apunta a C: la
      // reconciliacion de la 366 la re-estampa en el mismo acto que mueve la marca.
      const distrito = await e.crearDistrito([]);
      const orden = await e.crearOrden({ zonaId: e.zonas.C.id, distritoId: distrito });

      const res = await e.repo.update(
        e.zonas.B.id,
        { ...datosSinMarca(e.zonas.B.nombre, [distrito]), esCentral: true },
        USUARIO,
      );

      const filasMarca = await e.marcasDe([e.zonas.A.id, e.zonas.B.id]);
      const filasOrden = (await e.tx.historialAccion.findMany({
        where: { accion: "orden_zona_reconciliada", entidadId: orden },
        select: { loteId: true },
      })) as { loteId: string }[];

      return {
        reconciliadas: soloOk(res).ordenesReconciliadas,
        lotesMarca: [...new Set(filasMarca.map((f) => f.loteId))],
        lotesOrden: [...new Set(filasOrden.map((f) => f.loteId))],
      };
    });

    // Anti-vacuidad: si la reconciliacion no hubiera ocurrido, no habria dos lotes que comparar.
    expect(medido.reconciliadas).toBe(1);
    expect(medido.lotesMarca).toHaveLength(1);
    expect(medido.lotesOrden).toHaveLength(1);
    expect(medido.lotesMarca[0]).not.toBe(medido.lotesOrden[0]);
  }, 60_000);

  it("⭑ R18: repetir el guardado con la marca YA puesta no añade ni una fila", async () => {
    const medido = await conEscenario("B", async (e) => {
      const distrito = await e.crearDistrito([e.zonas.B.id]);
      const datos = { ...datosSinMarca(e.zonas.B.nombre, [distrito]), esCentral: true };

      const primera = await e.repo.update(e.zonas.B.id, datos, USUARIO);
      const trasPrimera = await e.marcasDe([e.zonas.A.id, e.zonas.B.id]);
      const segunda = await e.repo.update(e.zonas.B.id, datos, USUARIO);

      return {
        estados: [primera.estado, segunda.estado],
        trasPrimera: trasPrimera.length,
        trasSegunda: (await e.marcasDe([e.zonas.A.id, e.zonas.B.id])).length,
        centrales: await e.centralesVivas(),
        idB: e.zonas.B.id,
      };
    });

    expect(medido.estados).toEqual(["ok", "ok"]);
    // B ya era la central: NI la primera ni la segunda cambian nada, asi que cero filas siempre.
    expect(medido.trasPrimera).toBe(0);
    expect(medido.trasSegunda).toBe(0);
    expect(medido.centrales).toEqual([medido.idB]);
  }, 60_000);

  it("⭑ R12 en `create`: crear con la marca habiendo otra central escribe DOS filas", async () => {
    const medido = await conEscenario("A", async (e) => {
      const distrito = await e.crearDistrito([]);
      const nombre = `376 NUEVA ${unico()}`;
      const dto = await e.repo.create(
        {
          nombre,
          cobroVehiculo: false,
          esCentral: true,
          distritoIds: [distrito],
          tarifas: [],
        },
        USUARIO,
      );

      return {
        creada: dto,
        nombre,
        filas: await e.marcasDe([e.zonas.A.id, dto.id]),
        centrales: await e.centralesVivas(),
        zonaA: await e.zonaCompleta(e.zonas.A.id),
        idA: e.zonas.A.id,
        nombreA: e.zonas.A.nombre,
      };
    });

    expect(medido.creada.esCentral).toBe(true);
    // La anterior quedo apagada, y queda EXACTAMENTE una.
    expect(medido.zonaA.esCentral).toBe(false);
    expect(medido.centrales).toEqual([medido.creada.id]);

    expect(medido.filas).toHaveLength(2);
    expect(new Set(medido.filas.map((f) => f.loteId)).size).toBe(1);
    const porZona = new Map(medido.filas.map((f) => [f.entidadId, f]));
    expect(porZona.get(medido.idA)).toMatchObject({
      valorAnterior: "true",
      valorNuevo: "false",
      entidadEtiqueta: medido.nombreA,
    });
    expect(porZona.get(medido.creada.id)).toMatchObject({
      valorAnterior: "false",
      valorNuevo: "true",
      entidadEtiqueta: medido.nombre,
    });
  }, 60_000);

  it("R18 en `create`: crear SIN la marca no escribe ninguna fila ni apaga la central", async () => {
    const medido = await conEscenario("A", async (e) => {
      const distrito = await e.crearDistrito([]);
      const dto = await e.repo.create(
        {
          nombre: `376 NUEVA SIN MARCA ${unico()}`,
          cobroVehiculo: false,
          esCentral: false,
          distritoIds: [distrito],
          tarifas: [],
        },
        USUARIO,
      );
      return {
        filas: await e.marcasDe([e.zonas.A.id, dto.id]),
        centrales: await e.centralesVivas(),
        idA: e.zonas.A.id,
      };
    });

    expect(medido.filas).toEqual([]);
    expect(medido.centrales).toEqual([medido.idA]);
  }, 60_000);

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // C — Borrar la zona central (R10, R11, R19)
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  it("⭑ R10: la zona central SIN ordenes ni usuarios NO se borra, y no pierde nada", async () => {
    // ⚠️ ES EL CASO QUE LAS FK NO CUBREN, y el unico que prueba que la guarda es la que actua: sin
    // ordenes ni usuarios apuntando, hasta esta ficha esta zona se borraba sin mas.
    // MUTACION PROBADA A MANO (2026-09-07): quitar el `if (exists.esCentral)` -> este caso se pone
    // rojo por BORRADO (`salida` = "ok" y `sigueViva` = 0), no por otra cosa.
    const medido = await conEscenario("A", async (e) => {
      const distrito = await e.crearDistrito([e.zonas.A.id]);
      await e.crearTarifaDeZona(e.zonas.A.id);

      // Anti-vacuidad de la PREMISA: cero ordenes y cero usuarios apuntando a A.
      const ordenes = await e.tx.orden.count({ where: { zonaId: e.zonas.A.id } });
      const usuarios = await e.tx.usuario.count({ where: { zonaId: e.zonas.A.id } });

      const salida = await e.repo.hardDelete(e.zonas.A.id, USUARIO);

      return {
        ordenes,
        usuarios,
        salida,
        sigueViva: await e.tx.zona.count({ where: { id: e.zonas.A.id } }),
        zona: await e.zonaCompleta(e.zonas.A.id),
        distrito,
        registroDeBorrado: await e.tx.historialAccion.count({
          where: { entidadId: e.zonas.A.id, accion: "zona_borrada" },
        }),
      };
    });

    expect(medido.ordenes, "la premisa del caso es que NO hay ordenes apuntando").toBe(0);
    expect(medido.usuarios, "la premisa del caso es que NO hay usuarios apuntando").toBe(0);
    expect(medido.salida).toBe("es_central");
    expect(medido.sigueViva).toBe(1);
    // El rechazo sale ANTES del primer `deleteMany`: la N:M y las tarifas siguen enteras.
    expect(medido.zona.distritos).toBe(1);
    expect(medido.zona.tarifas).toBe(1);
    // R19: un borrado rechazado no deja fila.
    expect(medido.registroDeBorrado).toBe(0);
  }, 60_000);

  it("⭑ R11: la zona NO central con una orden sigue devolviendo `referenced`, no `es_central`", async () => {
    // Los dos rechazos existen a la vez y tienen que seguir siendo distinguibles.
    const medido = await conEscenario("A", async (e) => {
      await e.crearOrden({ zonaId: e.zonas.B.id });
      return {
        salida: await e.repo.hardDelete(e.zonas.B.id, USUARIO),
        sigueViva: await e.tx.zona.count({ where: { id: e.zonas.B.id } }),
      };
    });

    expect(medido.salida).toBe("referenced");
    expect(medido.salida).not.toBe("es_central");
    expect(medido.sigueViva).toBe(1);
  }, 60_000);

  it("R10 acotado: una zona NO central y libre se sigue borrando (`ok`)", async () => {
    // Control positivo: sin el, un `return "es_central"` incondicional pasaria los dos de arriba.
    const medido = await conEscenario("A", async (e) => ({
      salida: await e.repo.hardDelete(e.zonas.C.id, USUARIO),
      sigueViva: await e.tx.zona.count({ where: { id: e.zonas.C.id } }),
      registro: await e.tx.historialAccion.count({
        where: { entidadId: e.zonas.C.id, accion: "zona_borrada" },
      }),
    }));

    expect(medido.salida).toBe("ok");
    expect(medido.sigueViva).toBe(0);
    expect(medido.registro).toBe(1);
  }, 60_000);

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // R17 — atomicidad: si el registro falla, la marca NO se mueve
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  it("⭑ R17: si el registro falla, ni la marca cambia ni queda la fila", async () => {
    // El arnes SI permite inyectar el fallo: `clienteConSavepoint(tx, true)` sustituye
    // `historialAccion.createMany` por una funcion que LANZA, y su `$transaction` abre un SAVEPOINT
    // REAL con `ROLLBACK TO` al fallar — que es lo que Postgres hace con una transaccion abortada.
    // Un pass-through no serviria: sin savepoint, este caso pasaria en verde por accidente.
    const medido = await conEscenario("A", async (e) => {
      const distrito = await e.crearDistrito([e.zonas.B.id]);
      const repoRoto = new ZonaRepository(clienteConSavepoint(e.tx, true));

      let error: unknown = null;
      try {
        await repoRoto.update(
          e.zonas.B.id,
          { ...datosSinMarca(e.zonas.B.nombre, [distrito]), esCentral: true },
          USUARIO,
        );
      } catch (e2) {
        error = e2;
      }

      return {
        error,
        centrales: await e.centralesVivas(),
        idA: e.zonas.A.id,
        zonaB: await e.zonaCompleta(e.zonas.B.id),
        filas: await e.marcasDe([e.zonas.A.id, e.zonas.B.id]),
      };
    });

    // Anti-vacuidad: el fallo inyectado es el que se pidio, no otro cualquiera.
    expect(medido.error).toBeInstanceOf(RegistroCaido);
    // Y NADA persistio: la marca sigue en A, B no la gano, y no hay ni una fila.
    expect(medido.centrales).toEqual([medido.idA]);
    expect(medido.zonaB.esCentral).toBe(false);
    expect(medido.filas).toEqual([]);
  }, 60_000);

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // Q4 — el impacto que la confirmacion va a decir
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  it("⭑ Q4: el conteo de ordenes vivas excluye las borradas y las ya congeladas en un cierre", async () => {
    // EL CORTE VIVE EN EL `WHERE`, y esto es lo unico que lo mide: una orden con `cierre_detail`
    // ya fotografio `es_central` y su flete no cambia pase lo que pase con la marca. Contarla
    // inflaria el numero que se le enseña a quien esta a punto de confirmar.
    const medido = await conEscenario("A", async (e) => {
      await e.crearOrden({ zonaId: e.zonas.A.id }); // viva
      await e.crearOrden({ zonaId: e.zonas.A.id }); // viva
      await e.crearOrden({ zonaId: e.zonas.A.id, borrada: true }); // NO cuenta
      await e.crearOrden({ zonaId: e.zonas.A.id, congelada: true }); // NO cuenta
      await e.crearOrden({ zonaId: e.zonas.B.id }); // de otra zona

      return {
        impacto: await e.repo.contarOrdenesVivasPorZona([
          e.zonas.A.id,
          e.zonas.B.id,
          e.zonas.C.id,
        ]),
        ids: { A: e.zonas.A.id, B: e.zonas.B.id, C: e.zonas.C.id },
      };
    });

    expect(medido.impacto).toEqual([
      { zonaId: medido.ids.A, ordenesVivas: 2 },
      { zonaId: medido.ids.B, ordenesVivas: 1 },
      // Una zona sin ordenes sale con CERO, no ausente: «no afecta a ninguna» no es «no lo sé».
      { zonaId: medido.ids.C, ordenesVivas: 0 },
    ]);
  }, 60_000);
});
