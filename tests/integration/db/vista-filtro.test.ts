import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { VistaFiltroRepository } from "@/lib/repositories/VistaFiltroRepository";
import { VISTA_FILTRO_VERSION, type VistaFiltroPayload } from "@/lib/types/vista-filtro";
import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
  type TxDeTest,
} from "./_postgres-real";

// FICHA 453 (T1.5 — R2, R11) — EL `WHERE` DEL REPOSITORIO, CONTRA POSTGRES DE VERDAD.
//
// ⚠️ POR QUE AQUI Y NO CON UN DOBLE. Un doble no ve el `WHERE`: demuestra que el doble hace lo que
// el doble hace. Y lo que esta ficha se juega en el `where` es exactamente lo que un doble taparia
// —que `usuario_id` viaje en CADA escritura y no solo en una comprobacion previa (R2)—. Es la
// leccion «probar el WHERE donde vive», medida cuatro veces seguidas en este repo.
//
// ⚠️ LA MUTACION QUE HAY QUE CORRER ANTES DE CREERSE EL VERDE: quitar `usuarioId` del `where` de
// `eliminar` (y de `renombrar`, y de `actualizarFiltro`). Los casos «con el id de otra persona»
// tienen que ponerse ROJOS. Medido el 2026-09-21: con `where: { id }` a secas, tres casos caen.
//
// ⚠️ TODO CORRE DENTRO DE UNA TRANSACCION QUE SIEMPRE SE REVIERTE. La base local es COMPARTIDA
// entre worktrees: si el test pasa, si falla o si el proceso muere a mitad, no queda una fila.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const PAYLOAD: VistaFiltroPayload = {
  v: VISTA_FILTRO_VERSION,
  termino: "san jose",
  activos: ["zona", "distrito"],
  seleccion: { zona: ["z-1"], distrito: ["d-1", "d-2"] },
};

const OTRO_PAYLOAD: VistaFiltroPayload = {
  v: VISTA_FILTRO_VERSION,
  termino: "cartago",
  activos: ["zona"],
  seleccion: { zona: ["z-9"] },
};

/** Clona la identidad de un usuario existente para crear una persona propia del test. */
async function crearUsuario(tx: TxDeTest, modeloUsuarioId: string, etiqueta: string): Promise<string> {
  const id = randomUUID();
  await tx.$executeRawUnsafe(
    `INSERT INTO "usuario"
       ("id","nombre","email","telefono","password_hash","cedula","tipo_identificacion_id","rol_id","updated_at")
     SELECT $1, $2, $3, '00000000', 'x', $4,
            u."tipo_identificacion_id", u."rol_id", CURRENT_TIMESTAMP
       FROM "usuario" u WHERE u."id" = $5`,
    id,
    `453 ${etiqueta}`,
    `453-${id}@test.local`,
    `453-${id.slice(0, 12)}`,
    modeloUsuarioId,
  );
  return id;
}

/**
 * Ejecuta `fn` y DESHACE lo que haya tocado, tambien si Postgres aborto la transaccion.
 *
 * ⚠️ HACE FALTA PARA LOS CASOS DE NOMBRE DUPLICADO. El repositorio ATRAPA el `P2002` y devuelve
 * `nombre_en_uso`, pero la transaccion queda ABORTADA (`25P02`) y todo lo que venga despues falla
 * con otro mensaje. Con el punto de retorno, el caso puede seguir midiendo lo que vino a medir: que
 * la fila original sigue intacta.
 */
async function enPuntoDeRetorno<T>(tx: TxDeTest, fn: () => Promise<T>): Promise<T> {
  const punto = `sp_${randomUUID().replace(/-/g, "")}`;
  await tx.$executeRawUnsafe(`SAVEPOINT ${punto}`);
  try {
    return await fn();
  } finally {
    await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${punto}`);
  }
}

function repoDe(tx: TxDeTest): VistaFiltroRepository {
  return new VistaFiltroRepository(tx as unknown as PrismaClient);
}

describeSiHayBase("453/T1.5 · el repositorio de vistas contra Postgres real", () => {
  let prisma: PrismaClient;
  let modeloUsuarioId: string;

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    const modelo = await prisma.usuario.findFirst({ select: { id: true } });
    // ⚠️ FALLA RUIDOSAMENTE si la base no tiene ni un usuario: un `if (!modelo) return` reportaria
    // `passed` sin haber comprobado nada. Este repo ya midio lo que cuesta ese atajo.
    expect(modelo, "la tabla `usuario` esta vacia: estos casos no se pueden medir").not.toBeNull();
    modeloUsuarioId = modelo!.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⭑ R2: `listar` devuelve SOLO las del dueño, y ordenadas por nombre", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const ana = await crearUsuario(tx, modeloUsuarioId, "ana");
      const beto = await crearUsuario(tx, modeloUsuarioId, "beto");
      const repo = repoDe(tx);
      // Sembradas a proposito EN DESORDEN: si el `orderBy` desapareciera, saldrian asi.
      for (const nombre of ["Zarcero", "Alajuela", "Moravia"]) {
        await repo.crear(ana, "ordenes", nombre, PAYLOAD, VISTA_FILTRO_VERSION);
      }
      await repo.crear(beto, "ordenes", "La de Beto", PAYLOAD, VISTA_FILTRO_VERSION);
      // Y una de Ana en OTRA superficie: el listado de `ordenes` no la puede traer.
      await repo.crear(ana, "cierres-bodega", "Otra pantalla", PAYLOAD, VISTA_FILTRO_VERSION);
      return {
        deAna: await repo.listar(ana, "ordenes"),
        deBeto: await repo.listar(beto, "ordenes"),
      };
    });

    expect(r.deAna.map((v) => v.nombre)).toEqual(["Alajuela", "Moravia", "Zarcero"]);
    expect(r.deBeto.map((v) => v.nombre)).toEqual(["La de Beto"]);
    // El documento vuelve entero, tal cual se escribio (R5).
    expect(r.deAna[0].filtro).toEqual(PAYLOAD);
    expect(r.deAna[0].version).toBe(VISTA_FILTRO_VERSION);
  });

  it("⭑ `contar` acota por dueño Y por superficie (es lo que alimenta el tope)", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const ana = await crearUsuario(tx, modeloUsuarioId, "ana");
      const beto = await crearUsuario(tx, modeloUsuarioId, "beto");
      const repo = repoDe(tx);
      await repo.crear(ana, "ordenes", "Una", PAYLOAD, VISTA_FILTRO_VERSION);
      await repo.crear(ana, "ordenes", "Dos", PAYLOAD, VISTA_FILTRO_VERSION);
      await repo.crear(ana, "cierres-bodega", "Tres", PAYLOAD, VISTA_FILTRO_VERSION);
      await repo.crear(beto, "ordenes", "Cuatro", PAYLOAD, VISTA_FILTRO_VERSION);
      return {
        anaOrdenes: await repo.contar(ana, "ordenes"),
        anaCierres: await repo.contar(ana, "cierres-bodega"),
        betoOrdenes: await repo.contar(beto, "ordenes"),
      };
    });

    expect(r).toEqual({ anaOrdenes: 2, anaCierres: 1, betoOrdenes: 1 });
  });

  it("⭑ R11: el nombre duplicado lo revienta EL INDICE, no una comprobacion de codigo", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const ana = await crearUsuario(tx, modeloUsuarioId, "ana");
      const beto = await crearUsuario(tx, modeloUsuarioId, "beto");
      const repo = repoDe(tx);
      const primera = await repo.crear(ana, "ordenes", "San Jose arriba", PAYLOAD, 1);
      // El repositorio NO pregunta antes: manda el `INSERT` y traduce el `P2002`. Es la unica forma
      // de que dos pestañas guardando a la vez no dejen dos filas.
      const segunda = await enPuntoDeRetorno(tx, () =>
        repo.crear(ana, "ordenes", "San Jose arriba", OTRO_PAYLOAD, 1),
      );
      // R35: a BETO no le bloquea nadie ese nombre.
      const deBeto = await repo.crear(beto, "ordenes", "San Jose arriba", PAYLOAD, 1);
      const quedan = await repo.listar(ana, "ordenes");
      return { primera, segunda, deBeto, quedan };
    });

    expect(r.primera.estado).toBe("creada");
    expect(r.segunda.estado).toBe("nombre_en_uso");
    expect(r.deBeto.estado).toBe("creada");
    // Y NO SOBREESCRIBIO la existente (R11): sigue habiendo una, con su documento original.
    expect(r.quedan).toHaveLength(1);
    expect(r.quedan[0].filtro).toEqual(PAYLOAD);
  });

  it("⭑ R2: `renombrar` con el id de OTRA persona no toca nada y no encuentra nada", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const ana = await crearUsuario(tx, modeloUsuarioId, "ana");
      const beto = await crearUsuario(tx, modeloUsuarioId, "beto");
      const repo = repoDe(tx);
      const creada = await repo.crear(ana, "ordenes", "San Jose arriba", PAYLOAD, 1);
      const id = creada.estado === "creada" ? creada.fila.id : "";
      expect(id, "la siembra no creo la vista").not.toBe("");

      const intruso = await repo.renombrar(id, beto, "Mia ahora");
      const trasElIntento = await repo.listar(ana, "ordenes");
      // CONTROL POSITIVO: la duena SI puede. Sin el, un repositorio que no renombrara nunca
      // pasaria este caso en verde.
      const propia = await repo.renombrar(id, ana, "San Jose abajo");
      return { intruso, trasElIntento, propia, final: await repo.listar(ana, "ordenes") };
    });

    expect(r.intruso.estado).toBe("sin_coincidencia");
    expect(r.trasElIntento[0].nombre).toBe("San Jose arriba");
    expect(r.propia.estado).toBe("actualizada");
    expect(r.final[0].nombre).toBe("San Jose abajo");
  });

  it("⭑ R2/R15: `actualizarFiltro` con el id de OTRA persona no toca el documento", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const ana = await crearUsuario(tx, modeloUsuarioId, "ana");
      const beto = await crearUsuario(tx, modeloUsuarioId, "beto");
      const repo = repoDe(tx);
      const creada = await repo.crear(ana, "ordenes", "San Jose arriba", PAYLOAD, 1);
      const id = creada.estado === "creada" ? creada.fila.id : "";
      expect(id).not.toBe("");

      const intruso = await repo.actualizarFiltro(id, beto, OTRO_PAYLOAD, 1);
      const trasElIntento = await repo.listar(ana, "ordenes");
      const propia = await repo.actualizarFiltro(id, ana, OTRO_PAYLOAD, 1);
      return { intruso, trasElIntento, propia, final: await repo.listar(ana, "ordenes") };
    });

    expect(r.intruso.estado).toBe("sin_coincidencia");
    expect(r.trasElIntento[0].filtro).toEqual(PAYLOAD);
    expect(r.propia.estado).toBe("actualizada");
    expect(r.final[0].filtro).toEqual(OTRO_PAYLOAD);
    // R15: actualizar CONSERVA el nombre.
    expect(r.final[0].nombre).toBe("San Jose arriba");
  });

  it("⭑ R2: `eliminar` con el id de OTRA persona borra CERO filas", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const ana = await crearUsuario(tx, modeloUsuarioId, "ana");
      const beto = await crearUsuario(tx, modeloUsuarioId, "beto");
      const repo = repoDe(tx);
      const creada = await repo.crear(ana, "ordenes", "San Jose arriba", PAYLOAD, 1);
      const id = creada.estado === "creada" ? creada.fila.id : "";
      expect(id).not.toBe("");

      const borradasPorElIntruso = await repo.eliminar(id, beto);
      const trasElIntento = await repo.listar(ana, "ordenes");
      const borradasPorLaDueña = await repo.eliminar(id, ana);
      return {
        borradasPorElIntruso,
        trasElIntento,
        borradasPorLaDueña,
        final: await repo.listar(ana, "ordenes"),
      };
    });

    // ⚠️ ESTE ES EL CASO QUE MUERE CON LA MUTACION: `where: { id }` sin el dueño devuelve 1 aqui.
    expect(r.borradasPorElIntruso).toBe(0);
    expect(r.trasElIntento).toHaveLength(1);
    expect(r.borradasPorLaDueña).toBe(1);
    expect(r.final).toEqual([]);
  });

  it("⭑ R14/R11: renombrar a un nombre que ya tiene otra vista suya se rechaza", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const ana = await crearUsuario(tx, modeloUsuarioId, "ana");
      const repo = repoDe(tx);
      await repo.crear(ana, "ordenes", "San Jose arriba", PAYLOAD, 1);
      const otra = await repo.crear(ana, "ordenes", "San Jose abajo", OTRO_PAYLOAD, 1);
      const id = otra.estado === "creada" ? otra.fila.id : "";
      expect(id).not.toBe("");

      const choque = await enPuntoDeRetorno(tx, () =>
        repo.renombrar(id, ana, "San Jose arriba"),
      );
      return { choque, final: await repo.listar(ana, "ordenes") };
    });

    expect(r.choque.estado).toBe("nombre_en_uso");
    // Y las dos siguen como estaban: el rechazo no fusiona ni pisa nada.
    expect(r.final.map((v) => v.nombre)).toEqual(["San Jose abajo", "San Jose arriba"]);
  });

  it("⭑ un id que NO existe responde igual que uno ajeno (no se filtra si existe)", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const ana = await crearUsuario(tx, modeloUsuarioId, "ana");
      const repo = repoDe(tx);
      const inexistente = randomUUID();
      return {
        renombrar: await repo.renombrar(inexistente, ana, "Nada"),
        actualizar: await repo.actualizarFiltro(inexistente, ana, PAYLOAD, 1),
        eliminar: await repo.eliminar(inexistente, ana),
      };
    });

    expect(r.renombrar.estado).toBe("sin_coincidencia");
    expect(r.actualizar.estado).toBe("sin_coincidencia");
    expect(r.eliminar).toBe(0);
  });
});
