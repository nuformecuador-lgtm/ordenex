import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";

import { ZonaRepository } from "@/lib/repositories/ZonaRepository";
import type { HistorialAccionTipo } from "@/lib/types/historial-accion";
import type {
  TarifaZonaMensajeroData,
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
// ⭑ FICHA 380 / T8 — EL RASTRO DE LA REESCRITURA DEL PAGO AL MENSAJERO, CONTRA POSTGRES REAL.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// POR QUE ESTE ARCHIVO ES OBLIGATORIO Y NO UN EXTRA. Lo que esta ficha decide vive en el estado
// de la TABLA antes y despues del `deleteMany` + `createMany`, y los dobles NO VEN NADA DE ESO:
//
//   · el doble de `tx.tarifaZonaMensajero.findMany` devuelve EL MISMO array a la lectura de
//     «antes» y a la de «despues» salvo que el test use `mockResolvedValueOnce`. Un test con
//     dobles NO PUEDE DISTINGUIR LOS DOS ESTADOS: diria «no cambio» pase lo que pase, y R1
//     pasaria en verde con la escritura del historial borrada.
//   · R3 exige demostrar que el `deleteMany` + `createMany` SI corrio (los `id` cambiaron) y que
//     aun asi NO hay fila. Los `id` los pone Postgres.
//   · R11/R12 son atomicidad y rechazos: lo que hay que demostrar no es un literal de retorno,
//     son FILAS que no existen y pagos que siguen intactos.
//
// Este repo tiene MEDIDO cuatro veces que una mutacion del `WHERE` pasa en verde contra dobles.
//
// ⚠️ NADA DE `if (!fks) return;`: con base y sin catalogo esto REVIENTA con un mensaje que dice
// que hacer. Un test que no encuentra datos y se va por un `return` reporta `passed` sin haber
// comprobado nada, y este repo ya se comio ese verde. Sin base alcanzable, `describe.skip`
// VISIBLE. Y cada caso AFIRMA SU PREMISA antes de afirmar su efecto: un `toHaveLength(0)` sobre un
// escenario que no se sembro esta verde por la razon equivocada.
//
// ⚠️ EL LIMITE ACEPTADO QUE ESTE ARCHIVO FIJA (Q2, firmada por el humano el 2026-09-08 EN CONTRA
// de la recomendacion del leader): la fila NO lleva importes. `monto`, `valor_anterior` y
// `valor_nuevo` van NULL, y se AFIRMA que van NULL. El registro dira que el pago de una zona
// cambio, en cual, quien y cuando — y nunca de cuanto a cuanto.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const ACCION = "zona_pago_mensajero_cambiado";
const SUFIJO = `380-${Date.now().toString(36)}`;
let contador = 0;
/** Sufijo unico por fila: `zona.nombre` y `vehiculos.name` son UNIQUE. */
function unico(): string {
  contador += 1;
  return `${SUFIJO}-${contador.toString(36)}-${randomUUID().slice(0, 6)}`;
}

function pago(cobroEntregado: number, cobroRechazado: number, vehiculoId: string | null = null) {
  return { cobroEntregado, cobroRechazado, vehiculoId } satisfies TarifaZonaMensajeroData;
}

function datos(
  nombre: string,
  distritoIds: string[],
  tarifas: TarifaZonaMensajeroData[],
): UpdateZonaData {
  return { nombre, cobroVehiculo: tarifas.some((t) => t.vehiculoId !== null), distritoIds, tarifas };
}

/** El desenlace `ok`, o un fallo RUIDOSO. Nunca un `undefined` que pase por vacuidad. */
function soloOk(res: UpdateZonaResult): Extract<UpdateZonaResult, { estado: "ok" }> {
  if (res.estado !== "ok") throw new Error(`se esperaba \`ok\` y llego \`${res.estado}\``);
  return res;
}

/** Una fila de `historial_accion` con todo lo que R6/R7/R8/R10 exigen mirar. */
interface FilaDePago {
  accion: string;
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
}

interface PagoEnTabla {
  id: string;
  vehiculoId: string | null;
  cobroEntregado: string;
  cobroRechazado: string;
}

interface Escenario {
  tx: TxDeTest;
  repo: ZonaRepository;
  zonas: {
    A: { id: string; nombre: string };
    B: { id: string; nombre: string };
  };
  vehiculos: { moto: string; carro: string };
  crearDistrito: (zonaIds: string[]) => Promise<string>;
  crearOrden: (opciones: { zonaId: string; distritoId?: string | null }) => Promise<string>;
  /** Los pagos que la tabla tiene HOY para esa zona, con su `id` y sus importes en STRING. */
  pagosDe: (zonaId: string) => Promise<PagoEnTabla[]>;
  /** Las filas del tipo NUEVO de esas zonas, en orden de escritura. */
  filasDePago: (zonaIds: string[]) => Promise<FilaDePago[]>;
  /** Las filas de CUALQUIER accion sobre esas entidades: para contar lotes distintos (R10). */
  filasDeAccion: (accion: HistorialAccionTipo, entidadIds: string[]) => Promise<FilaDePago[]>;
}

describeSiHayBase("⭑ 380/T8 — el pago al mensajero deja rastro al guardar (Postgres real)", () => {
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
        "hacen falta usuarios en la base: el actor congelado de R6 cuelga de uno. Corre " +
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

  /** Siembra dos zonas y dos vehiculos y entrega los constructores. TODO se revierte. */
  async function conEscenario<T>(fn: (e: Escenario) => Promise<T>): Promise<T> {
    return enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);

      const nombres = { A: `380 A ${unico()}`, B: `380 B ${unico()}` };
      const [a, b] = await Promise.all([
        tx.zona.create({ data: { nombre: nombres.A }, select: { id: true } }),
        tx.zona.create({ data: { nombre: nombres.B }, select: { id: true } }),
      ]);
      const [moto, carro] = await Promise.all([
        tx.vehiculo.create({ data: { name: `380 moto ${unico()}` }, select: { id: true } }),
        tx.vehiculo.create({ data: { name: `380 carro ${unico()}` }, select: { id: true } }),
      ]);

      const escenario: Escenario = {
        tx,
        // `update`/`create`/`hardDelete` abren su propia `$transaction`; el savepoint la traduce a
        // uno REAL, asi que el SQL medido es el de produccion y un fallo revierte de verdad.
        repo: new ZonaRepository(clienteConSavepoint(tx)),
        zonas: { A: { id: a.id, nombre: nombres.A }, B: { id: b.id, nombre: nombres.B } },
        vehiculos: { moto: moto.id, carro: carro.id },

        crearDistrito: async (zonaIds) => {
          const d = await tx.distrito.create({
            data: { nombre: `380 D ${unico()}`, cantonId: FKS.cantonId },
            select: { id: true },
          });
          for (const zonaId of zonaIds) {
            await tx.zonaDistrito.create({ data: { zonaId, distritoId: d.id } });
          }
          return d.id;
        },

        crearOrden: async ({ zonaId, distritoId = null }) => {
          const o = await tx.orden.create({
            data: {
              numRemision: `R-${unico()}`,
              destinatario: "Destinataria 380",
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
            },
            select: { id: true },
          });
          return o.id;
        },

        pagosDe: async (zonaId) => {
          const filas = await tx.tarifaZonaMensajero.findMany({
            where: { zonaId },
            select: {
              id: true,
              vehiculoId: true,
              cobroEntregado: true,
              cobroRechazado: true,
            },
            orderBy: { id: "asc" },
          });
          // Los importes viajan a las aserciones como STRING de escala 2 (`Decimal.toFixed(2)`,
          // del propio `Decimal`): comparar `number`s aqui reintroduciria por la puerta de atras
          // la coma flotante que R4 prohibe en el camino.
          return filas.map((f) => ({
            id: f.id,
            vehiculoId: f.vehiculoId,
            cobroEntregado: f.cobroEntregado.toFixed(2),
            cobroRechazado: f.cobroRechazado.toFixed(2),
          }));
        },

        filasDePago: async (zonaIds) =>
          (await tx.historialAccion.findMany({
            where: { accion: ACCION, entidadId: { in: zonaIds } },
            orderBy: { createdAt: "asc" },
            select: {
              accion: true,
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
            },
          })) as unknown as FilaDePago[],

        filasDeAccion: async (accion, entidadIds) =>
          (await tx.historialAccion.findMany({
            where: { accion, entidadId: { in: entidadIds } },
            orderBy: { createdAt: "asc" },
            select: {
              accion: true,
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
            },
          })) as unknown as FilaDePago[],
      };

      return fn(escenario);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // A — El hecho que hoy no se registra (R1, R2, R3)
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  it("⭑ R1: cambiar UN importe deja EXACTAMENTE UNA fila, sobre la zona guardada", async () => {
    // EL DEFECTO QUE ABRE LA FICHA, medido donde vive: en `historial_accion`, tras el guardado.
    const medido = await conEscenario(async (e) => {
      const d = await e.crearDistrito([e.zonas.A.id]);
      await e.repo.update(e.zonas.A.id, datos(e.zonas.A.nombre, [d], [pago(1500, 700)]), USUARIO);
      const trasSembrar = await e.filasDePago([e.zonas.A.id, e.zonas.B.id]);

      const res = await e.repo.update(
        e.zonas.A.id,
        datos(e.zonas.A.nombre, [d], [pago(1800, 700)]),
        USUARIO,
      );

      return {
        estado: res.estado,
        trasSembrar: trasSembrar.length,
        filas: await e.filasDePago([e.zonas.A.id, e.zonas.B.id]),
        idA: e.zonas.A.id,
        pagos: await e.pagosDe(e.zonas.A.id),
      };
    });

    // PREMISA: el guardado salio bien y el pago quedo como se pidio.
    expect(medido.estado).toBe("ok");
    expect(medido.pagos.map((p) => p.cobroEntregado)).toEqual(["1800.00"]);
    // El primer guardado —de «sin pagos» a «un pago»— ya es un cambio y deja SU fila (es un alta).
    expect(medido.trasSembrar).toBe(1);
    // EFECTO: el segundo guardado añade UNA sola fila mas, y es de esta zona.
    expect(medido.filas).toHaveLength(2);
    expect(medido.filas.map((f) => f.entidadId)).toEqual([medido.idA, medido.idA]);
    expect(medido.filas.map((f) => f.accion)).toEqual([ACCION, ACCION]);
  }, 60_000);

  it("⭑ R2: guardar cambiando SOLO EL NOMBRE no escribe ninguna fila de este tipo", async () => {
    // Sin la comparacion, este guardado diria «cambio el pago al mensajero», que es FALSO, en un
    // registro que se descarga y no se purga.
    const medido = await conEscenario(async (e) => {
      const d = await e.crearDistrito([e.zonas.A.id]);
      await e.repo.update(e.zonas.A.id, datos(e.zonas.A.nombre, [d], [pago(1500, 700)]), USUARIO);
      const trasSembrar = await e.filasDePago([e.zonas.A.id]);

      const nombreNuevo = `380 A renombrada ${unico()}`;
      const res = await e.repo.update(
        e.zonas.A.id,
        datos(nombreNuevo, [d], [pago(1500, 700)]),
        USUARIO,
      );

      return {
        estado: res.estado,
        nombreNuevo,
        trasSembrar: trasSembrar.length,
        filas: await e.filasDePago([e.zonas.A.id]),
        zona: await e.tx.zona.findUniqueOrThrow({
          where: { id: e.zonas.A.id },
          select: { nombre: true },
        }),
      };
    });

    // PREMISA: el guardado ocurrio de verdad y el nombre SI cambio.
    expect(medido.estado).toBe("ok");
    expect(medido.zona.nombre).toBe(medido.nombreNuevo);
    expect(medido.trasSembrar).toBe(1);
    // EFECTO: y aun asi el conteo de filas no se movio.
    expect(medido.filas).toHaveLength(1);
  }, 60_000);

  it("⭑ R2: mover la marca de zona central escribe la fila de la 376 y NINGUNA de esta", async () => {
    const medido = await conEscenario(async (e) => {
      await e.tx.zona.updateMany({ where: { esCentral: true }, data: { esCentral: false } });
      const quedan = await e.tx.zona.count({ where: { esCentral: true } });
      if (quedan !== 0) throw new Error(`el escenario arranca con ${quedan} centrales: imposible`);

      const d = await e.crearDistrito([e.zonas.A.id]);
      await e.repo.update(e.zonas.A.id, datos(e.zonas.A.nombre, [d], [pago(1500, 700)]), USUARIO);
      const trasSembrar = await e.filasDePago([e.zonas.A.id]);

      const res = await e.repo.update(
        e.zonas.A.id,
        { ...datos(e.zonas.A.nombre, [d], [pago(1500, 700)]), esCentral: true },
        USUARIO,
      );

      return {
        estado: res.estado,
        trasSembrar: trasSembrar.length,
        filasPago: await e.filasDePago([e.zonas.A.id]),
        filasMarca: await e.filasDeAccion("zona_central_cambiada", [e.zonas.A.id]),
        esCentral: (
          await e.tx.zona.findUniqueOrThrow({
            where: { id: e.zonas.A.id },
            select: { esCentral: true },
          })
        ).esCentral,
      };
    });

    expect(medido.estado).toBe("ok");
    // PREMISA: la marca SI se movio y la 376 SI dejo su fila. Sin esto, «0 filas de pago» estaria
    // verde porque el guardado no hizo nada.
    expect(medido.esCentral).toBe(true);
    expect(medido.filasMarca).toHaveLength(1);
    // EFECTO: el pago no cambio, asi que su contador se quedo donde estaba.
    expect(medido.trasSembrar).toBe(1);
    expect(medido.filasPago).toHaveLength(1);
  }, 60_000);

  it("⭑ R3: el MISMO conjunto exacto — los `id` CAMBIAN y aun asi no hay fila nueva", async () => {
    // EL CASO MAS BARATO Y MAS DECISIVO: mata a la vez «compara por id» y «escribe siempre».
    const medido = await conEscenario(async (e) => {
      const d = await e.crearDistrito([e.zonas.A.id]);
      const mismos = [pago(1500, 700, e.vehiculos.moto), pago(2000, 900, e.vehiculos.carro)];

      await e.repo.update(e.zonas.A.id, datos(e.zonas.A.nombre, [d], mismos), USUARIO);
      const idsAntes = (await e.pagosDe(e.zonas.A.id)).map((p) => p.id).sort();
      const trasSembrar = await e.filasDePago([e.zonas.A.id]);

      // El MISMO payload, otra vez. `deleteMany` + `createMany` regenera los `id`.
      const res = await e.repo.update(e.zonas.A.id, datos(e.zonas.A.nombre, [d], mismos), USUARIO);
      const despues = await e.pagosDe(e.zonas.A.id);

      return {
        estado: res.estado,
        idsAntes,
        idsDespues: despues.map((p) => p.id).sort(),
        importes: despues.map((p) => `${p.cobroEntregado}/${p.cobroRechazado}`).sort(),
        trasSembrar: trasSembrar.length,
        filas: await e.filasDePago([e.zonas.A.id]),
      };
    });

    expect(medido.estado).toBe("ok");
    // PREMISA 1: habia dos pagos y siguen siendo dos, con los mismos importes.
    expect(medido.idsAntes).toHaveLength(2);
    expect(medido.importes).toEqual(["1500.00/700.00", "2000.00/900.00"]);
    // PREMISA 2 —la decisiva—: el reemplazo SI corrio, porque los `id` son OTROS.
    expect(medido.idsDespues).toHaveLength(2);
    expect(medido.idsDespues).not.toEqual(medido.idsAntes);
    for (const id of medido.idsDespues) expect(medido.idsAntes).not.toContain(id);
    // EFECTO: y aun asi el segundo guardado no añadio ninguna fila.
    expect(medido.trasSembrar).toBe(1);
    expect(medido.filas).toHaveLength(1);
  }, 60_000);

  it("⭑ R3: reordenar el MISMO conjunto en el payload tampoco es un cambio", async () => {
    const medido = await conEscenario(async (e) => {
      const d = await e.crearDistrito([e.zonas.A.id]);
      const uno = pago(1500, 700, e.vehiculos.moto);
      const dos = pago(2000, 900, e.vehiculos.carro);

      await e.repo.update(e.zonas.A.id, datos(e.zonas.A.nombre, [d], [uno, dos]), USUARIO);
      const trasSembrar = await e.filasDePago([e.zonas.A.id]);
      const res = await e.repo.update(e.zonas.A.id, datos(e.zonas.A.nombre, [d], [dos, uno]), USUARIO);

      return {
        estado: res.estado,
        trasSembrar: trasSembrar.length,
        pagos: (await e.pagosDe(e.zonas.A.id)).length,
        filas: await e.filasDePago([e.zonas.A.id]),
      };
    });

    expect(medido.estado).toBe("ok");
    expect(medido.trasSembrar).toBe(1);
    expect(medido.pagos).toBe(2);
    expect(medido.filas).toHaveLength(1);
  }, 60_000);

  it("⭑ R1: quitar un pago (BAJA) tambien deja fila", async () => {
    const medido = await conEscenario(async (e) => {
      const d = await e.crearDistrito([e.zonas.A.id]);
      await e.repo.update(
        e.zonas.A.id,
        datos(e.zonas.A.nombre, [d], [
          pago(1500, 700, e.vehiculos.moto),
          pago(2000, 900, e.vehiculos.carro),
        ]),
        USUARIO,
      );
      const trasSembrar = await e.filasDePago([e.zonas.A.id]);

      const res = await e.repo.update(
        e.zonas.A.id,
        datos(e.zonas.A.nombre, [d], [pago(1500, 700, e.vehiculos.moto)]),
        USUARIO,
      );

      return {
        estado: res.estado,
        trasSembrar: trasSembrar.length,
        pagos: await e.pagosDe(e.zonas.A.id),
        filas: await e.filasDePago([e.zonas.A.id]),
      };
    });

    expect(medido.estado).toBe("ok");
    expect(medido.trasSembrar).toBe(1);
    expect(medido.pagos).toHaveLength(1);
    expect(medido.filas).toHaveLength(2);
  }, 60_000);

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // B — Que dice la fila (R6, R7, R8, R10)
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  it("⭑ R6/R8: la fila trae la zona nombrada y el actor CONGELADO, y NI UN IMPORTE", async () => {
    const medido = await conEscenario(async (e) => {
      const d = await e.crearDistrito([e.zonas.A.id]);
      await e.repo.update(e.zonas.A.id, datos(e.zonas.A.nombre, [d], [pago(1500, 700)]), USUARIO);
      return { filas: await e.filasDePago([e.zonas.A.id]), idA: e.zonas.A.id, nombreA: e.zonas.A.nombre };
    });

    expect(medido.filas).toHaveLength(1);
    const fila = medido.filas[0];
    expect(fila.accion).toBe(ACCION);
    expect(fila.entidadTipo).toBe("zona");
    expect(fila.entidadId).toBe(medido.idA);
    // R6: la zona, NOMBRADA. Sale de `etiquetaDeEntidad`, no de una interpolacion a mano.
    expect(fila.entidadEtiqueta).toBe(medido.nombreA);
    // R6: quien, y CONGELADO — no resuelto por join al leer.
    expect(fila.actorUsuarioId).toBe(USUARIO);
    expect(fila.actorNombre).toBe(NOMBRE_ACTOR);
    expect(fila.actorRol).toBe(ROL_ACTOR);
    // ⭑ R8 Y LA FIRMA DE Q2: NI UN IMPORTE. Es lo que hace que el registro NUNCA pueda decir de
    // cuanto a cuanto — limite conocido y ACEPTADO, firmado en contra de la recomendacion del
    // leader. Si alguien «mejorara» esto guardando los montos, se habria salido de lo firmado y
    // este caso lo pone encima de la mesa.
    expect(fila.monto).toBeNull();
    expect(fila.valorAnterior).toBeNull();
    expect(fila.valorNuevo).toBeNull();
  }, 60_000);

  it("⭑ R7: sin usuario detras, los TRES campos del actor quedan vacios A LA VEZ", async () => {
    const medido = await conEscenario(async (e) => {
      const d = await e.crearDistrito([e.zonas.A.id]);
      await e.repo.update(e.zonas.A.id, datos(e.zonas.A.nombre, [d], [pago(1500, 700)]), null);
      return { filas: await e.filasDePago([e.zonas.A.id]) };
    });

    expect(medido.filas).toHaveLength(1);
    const fila = medido.filas[0];
    expect(fila.actorUsuarioId).toBeNull();
    expect(fila.actorNombre).toBeNull();
    expect(fila.actorRol).toBeNull();
  }, 60_000);

  it("⭑ R10: un guardado que reconcilia + mueve la marca + cambia el pago deja TRES lotes", async () => {
    // Tres hechos de naturaleza distinta en un solo guardado. Si compartieran lote, filtrar por
    // lote devolveria una mezcla de ordenes y de zonas que nadie pidio.
    const medido = await conEscenario(async (e) => {
      await e.tx.zona.updateMany({ where: { esCentral: true }, data: { esCentral: false } });

      const d = await e.crearDistrito([]);
      const orden = await e.crearOrden({ zonaId: e.zonas.B.id, distritoId: d });

      const res = await e.repo.update(
        e.zonas.A.id,
        { ...datos(e.zonas.A.nombre, [d], [pago(1500, 700)]), esCentral: true },
        USUARIO,
      );

      return {
        reconciliadas: soloOk(res).ordenesReconciliadas,
        lotesPago: [...new Set((await e.filasDePago([e.zonas.A.id])).map((f) => f.loteId))],
        lotesMarca: [
          ...new Set(
            (await e.filasDeAccion("zona_central_cambiada", [e.zonas.A.id])).map((f) => f.loteId),
          ),
        ],
        lotesOrden: [
          ...new Set(
            (await e.filasDeAccion("orden_zona_reconciliada", [orden])).map((f) => f.loteId),
          ),
        ],
      };
    });

    // PREMISA: los TRES hechos ocurrieron de verdad. Sin esto no habria tres lotes que comparar.
    expect(medido.reconciliadas).toBe(1);
    expect(medido.lotesPago).toHaveLength(1);
    expect(medido.lotesMarca).toHaveLength(1);
    expect(medido.lotesOrden).toHaveLength(1);
    // EFECTO: y los tres son DISTINTOS entre si.
    expect(new Set([medido.lotesPago[0], medido.lotesMarca[0], medido.lotesOrden[0]]).size).toBe(3);
  }, 60_000);

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // C — Atomicidad y rechazos (R11, R12)
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  it("⭑ R11: un guardado que REVIENTA no deja fila ni toca los pagos anteriores", async () => {
    // El fallo se dispara DESPUES de que el guardado haya escrito de verdad: cuando la FK de
    // `zonaDistrito` revienta por un `distritoId` inexistente, `tx.zona.update` YA cambio el
    // nombre y `tx.zonaDistrito.deleteMany` YA borro la N:M. Que las dos cosas vuelvan atras es lo
    // que demuestra que la transaccion es una sola — y por tanto que la fila de esta ficha, que
    // vive dentro de ella, no puede sobrevivir a un guardado que no ocurrio.
    const medido = await conEscenario(async (e) => {
      const d = await e.crearDistrito([e.zonas.A.id]);
      await e.repo.update(e.zonas.A.id, datos(e.zonas.A.nombre, [d], [pago(1500, 700)]), USUARIO);
      const antes = await e.pagosDe(e.zonas.A.id);
      const trasSembrar = await e.filasDePago([e.zonas.A.id]);
      const nombreQueNoDebeCuajar = `380 A NO deberia quedar ${unico()}`;

      let error: unknown = null;
      try {
        await e.repo.update(
          e.zonas.A.id,
          datos(
            nombreQueNoDebeCuajar,
            [`distrito-inexistente-${randomUUID()}`],
            [pago(9999, 9999)],
          ),
          USUARIO,
        );
      } catch (e2) {
        error = e2;
      }

      return {
        error,
        antes,
        trasSembrar: trasSembrar.length,
        nombreOriginal: e.zonas.A.nombre,
        nombreActual: (
          await e.tx.zona.findUniqueOrThrow({
            where: { id: e.zonas.A.id },
            select: { nombre: true },
          })
        ).nombre,
        distritos: (
          await e.tx.zonaDistrito.findMany({
            where: { zonaId: e.zonas.A.id },
            select: { distritoId: true },
          })
        ).map((z) => z.distritoId),
        d,
        despues: await e.pagosDe(e.zonas.A.id),
        filas: await e.filasDePago([e.zonas.A.id]),
      };
    });

    // PREMISA: el guardado REVENTO de verdad (si no, «nada cambio» estaria verde por vacuidad).
    expect(medido.error).not.toBeNull();
    expect(medido.trasSembrar).toBe(1);
    expect(medido.antes).toHaveLength(1);
    // PREMISA 2: y reventó DESPUES de escribir — lo que ya se habia escrito volvio atras.
    expect(medido.nombreActual).toBe(medido.nombreOriginal);
    expect(medido.distritos).toEqual([medido.d]);
    // EFECTO: cero filas nuevas y los pagos INTACTOS, `id` incluido.
    expect(medido.filas).toHaveLength(1);
    expect(medido.despues).toEqual(medido.antes);
  }, 60_000);

  it("⭑ R11: si el REGISTRO falla, el pago nuevo tampoco persiste", async () => {
    // La otra mitad de la atomicidad, y la que solo se puede medir con el arnes:
    // `clienteConSavepoint(tx, true)` sustituye `historialAccion.createMany` por una funcion que
    // LANZA, y su `$transaction` abre un SAVEPOINT REAL con `ROLLBACK TO` al fallar — que es lo que
    // Postgres hace con una transaccion abortada. Un pass-through no serviria: sin savepoint, este
    // caso pasaria en verde por accidente.
    const medido = await conEscenario(async (e) => {
      const d = await e.crearDistrito([e.zonas.A.id]);
      await e.repo.update(e.zonas.A.id, datos(e.zonas.A.nombre, [d], [pago(1500, 700)]), USUARIO);
      const antes = await e.pagosDe(e.zonas.A.id);

      const repoRoto = new ZonaRepository(clienteConSavepoint(e.tx, true));
      let error: unknown = null;
      try {
        await repoRoto.update(
          e.zonas.A.id,
          datos(e.zonas.A.nombre, [d], [pago(8888, 4444)]),
          USUARIO,
        );
      } catch (e2) {
        error = e2;
      }

      return { error, antes, despues: await e.pagosDe(e.zonas.A.id) };
    });

    // PREMISA: el fallo inyectado es el que se pidio, no otro cualquiera.
    expect(medido.error).toBeInstanceOf(RegistroCaido);
    expect(medido.antes).toHaveLength(1);
    // EFECTO: el pago de 8888 NO persistio. No puede haber un cambio sin su fila.
    expect(medido.despues).toEqual(medido.antes);
    expect(medido.despues[0].cobroEntregado).toBe("1500.00");
  }, 60_000);

  it("⭑ R12: `not_found` no escribe ninguna fila", async () => {
    const medido = await conEscenario(async (e) => {
      const d = await e.crearDistrito([e.zonas.A.id]);
      const inexistente = randomUUID();
      const res = await e.repo.update(
        inexistente,
        datos(`380 fantasma ${unico()}`, [d], [pago(1500, 700)]),
        USUARIO,
      );
      return {
        estado: res.estado,
        filas: await e.filasDePago([inexistente, e.zonas.A.id, e.zonas.B.id]),
      };
    });

    expect(medido.estado).toBe("not_found");
    expect(medido.filas).toEqual([]);
  }, 60_000);

  it("⭑ R12: `sin_zona_central` no reescribe ningun pago ni deja fila", async () => {
    const medido = await conEscenario(async (e) => {
      await e.tx.zona.updateMany({ where: { esCentral: true }, data: { esCentral: false } });
      const d = await e.crearDistrito([e.zonas.A.id]);
      // A se vuelve la unica central, CON pagos ya sembrados.
      await e.repo.update(
        e.zonas.A.id,
        { ...datos(e.zonas.A.nombre, [d], [pago(1500, 700)]), esCentral: true },
        USUARIO,
      );
      const antes = await e.pagosDe(e.zonas.A.id);
      const trasSembrar = await e.filasDePago([e.zonas.A.id]);

      // Y ahora se pide apagarle la marca cambiando ADEMAS el pago: el rechazo sale ANTES de la
      // primera escritura, asi que no se aplica NADA — ni el pago nuevo, ni su fila.
      const res = await e.repo.update(
        e.zonas.A.id,
        { ...datos(e.zonas.A.nombre, [d], [pago(4444, 3333)]), esCentral: false },
        USUARIO,
      );

      return {
        estado: res.estado,
        antes,
        trasSembrar: trasSembrar.length,
        despues: await e.pagosDe(e.zonas.A.id),
        filas: await e.filasDePago([e.zonas.A.id]),
      };
    });

    // PREMISA: habia un pago sembrado y su fila.
    expect(medido.antes).toHaveLength(1);
    expect(medido.antes[0].cobroEntregado).toBe("1500.00");
    expect(medido.trasSembrar).toBe(1);
    // EFECTO: el rechazo salio y NADA se movio.
    expect(medido.estado).toBe("sin_zona_central");
    expect(medido.despues).toEqual(medido.antes);
    expect(medido.filas).toHaveLength(1);
  }, 60_000);

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // D — El alcance FIRMADO en Q3: solo la edicion (R5)
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  it("⭑ R5: CREAR una zona con pagos NO deja fila de este tipo (firma de Q3)", async () => {
    // ⚠️ ESTE CASO NO ES UN OLVIDO NI UN DEFECTO A ARREGLAR: es la firma del humano del 2026-09-08
    // (Q3), tomada EN CONTRA de la recomendacion del leader —que era cerrar tambien la creacion—.
    // El primer pago de una zona, el que se teclea al crearla, NO deja rastro; el segundo y todos
    // los demas, si. Esta escrito aqui para que nadie lo «arregle» dentro de seis meses sin saber
    // que se decidio, y para que nadie lo pierda sin querer.
    //
    // Es ademas coherente con el catalogo que ya existe: hay `zona_borrada` y no `zona_creada`,
    // igual que hay `vehiculo_borrado` y no `vehiculo_creado`.
    const medido = await conEscenario(async (e) => {
      const d = await e.crearDistrito([]);
      const zona = await e.repo.create(
        {
          nombre: `380 nueva ${unico()}`,
          cobroVehiculo: false,
          esCentral: false,
          distritoIds: [d],
          tarifas: [pago(1500, 700)],
        },
        USUARIO,
      );
      return { zonaId: zona.id, pagos: await e.pagosDe(zona.id), filas: await e.filasDePago([zona.id]) };
    });

    // PREMISA: la zona se creo CON sus pagos escritos de verdad.
    expect(medido.pagos).toHaveLength(1);
    expect(medido.pagos[0].cobroEntregado).toBe("1500.00");
    // EFECTO (alcance firmado): cero filas de este tipo.
    expect(medido.filas).toEqual([]);
  }, 60_000);

  it("⭑ R5: BORRAR una zona con pagos deja `zona_borrada` y NINGUNA de este tipo", async () => {
    // ⚠️ TAMBIEN ES ALCANCE FIRMADO (Q3): `zona_borrada` ya documenta que la zona desaparecio, y
    // con ella sus pagos, que se van en el mismo `deleteMany`. Una segunda fila diciendo «cambio
    // el pago» sobre una zona que ya no existe seria ruido apuntando a un id muerto.
    const medido = await conEscenario(async (e) => {
      const d = await e.crearDistrito([]);
      const zona = await e.repo.create(
        {
          nombre: `380 a borrar ${unico()}`,
          cobroVehiculo: false,
          esCentral: false,
          distritoIds: [d],
          tarifas: [pago(1500, 700)],
        },
        USUARIO,
      );
      const pagosAntes = await e.pagosDe(zona.id);
      const desenlace = await e.repo.hardDelete(zona.id, USUARIO);
      return {
        desenlace,
        pagosAntes,
        pagosDespues: await e.pagosDe(zona.id),
        borrada: await e.filasDeAccion("zona_borrada", [zona.id]),
        filas: await e.filasDePago([zona.id]),
      };
    });

    // PREMISA: la zona TENIA pagos y el borrado salio `ok`.
    expect(medido.pagosAntes).toHaveLength(1);
    expect(medido.desenlace).toBe("ok");
    expect(medido.pagosDespues).toEqual([]);
    // EFECTO: la desaparicion queda documentada UNA vez, por `zona_borrada`.
    expect(medido.borrada).toHaveLength(1);
    expect(medido.filas).toEqual([]);
  }, 60_000);

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // E — Lo que esta ficha NO cambia (R18)
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  it("⭑ R18: tras guardar, la tabla tiene EXACTAMENTE los pagos del payload", async () => {
    // Esta ficha REGISTRA el reemplazo; no lo impide, no lo condiciona y no lo altera.
    const medido = await conEscenario(async (e) => {
      const d = await e.crearDistrito([e.zonas.A.id]);
      await e.repo.update(
        e.zonas.A.id,
        datos(e.zonas.A.nombre, [d], [
          pago(1500, 700, e.vehiculos.moto),
          pago(2000, 900, e.vehiculos.carro),
        ]),
        USUARIO,
      );
      const dos = await e.pagosDe(e.zonas.A.id);

      const res = await e.repo.update(
        e.zonas.A.id,
        datos(e.zonas.A.nombre, [d], [pago(3333, 1111, e.vehiculos.carro)]),
        USUARIO,
      );
      const uno = await e.pagosDe(e.zonas.A.id);

      return {
        estado: res.estado,
        dos: dos
          .map((p) => `${p.vehiculoId === e.vehiculos.moto ? "moto" : "carro"}:${p.cobroEntregado}/${p.cobroRechazado}`)
          .sort(),
        uno: uno.map((p) => `${p.vehiculoId === e.vehiculos.carro ? "carro" : "?"}:${p.cobroEntregado}/${p.cobroRechazado}`),
        dtoTarifas: soloOk(res).zona.tarifas?.length ?? 0,
      };
    });

    expect(medido.estado).toBe("ok");
    expect(medido.dos).toEqual(["carro:2000.00/900.00", "moto:1500.00/700.00"]);
    // Ni uno mas, ni uno menos: el reemplazo es completo.
    expect(medido.uno).toEqual(["carro:3333.00/1111.00"]);
    // R17: el DTO que devuelve el guardado sigue trayendo las tarifas resultantes.
    expect(medido.dtoTarifas).toBe(1);
  }, 60_000);

  it("⭑ R18: el payload SIN pagos deja la tabla vacia, y eso SI es un cambio", async () => {
    const medido = await conEscenario(async (e) => {
      const d = await e.crearDistrito([e.zonas.A.id]);
      await e.repo.update(e.zonas.A.id, datos(e.zonas.A.nombre, [d], [pago(1500, 700)]), USUARIO);
      const trasSembrar = await e.filasDePago([e.zonas.A.id]);

      const res = await e.repo.update(e.zonas.A.id, datos(e.zonas.A.nombre, [d], []), USUARIO);

      return {
        estado: res.estado,
        trasSembrar: trasSembrar.length,
        pagos: await e.pagosDe(e.zonas.A.id),
        filas: await e.filasDePago([e.zonas.A.id]),
      };
    });

    expect(medido.estado).toBe("ok");
    expect(medido.trasSembrar).toBe(1);
    expect(medido.pagos).toEqual([]);
    // Quitarle TODOS los pagos a una zona es exactamente el cambio que hay que poder auditar.
    expect(medido.filas).toHaveLength(2);
  }, 60_000);

  it("R18 acotado: guardar una zona SIN pagos que ya no los tenia no deja fila", async () => {
    // El otro extremo de la comparacion: vacio contra vacio no es un cambio.
    const medido = await conEscenario(async (e) => {
      const d = await e.crearDistrito([e.zonas.A.id]);
      const res = await e.repo.update(e.zonas.A.id, datos(e.zonas.A.nombre, [d], []), USUARIO);
      return {
        estado: res.estado,
        pagos: await e.pagosDe(e.zonas.A.id),
        filas: await e.filasDePago([e.zonas.A.id]),
      };
    });

    expect(medido.estado).toBe("ok");
    expect(medido.pagos).toEqual([]);
    expect(medido.filas).toEqual([]);
  }, 60_000);
});
