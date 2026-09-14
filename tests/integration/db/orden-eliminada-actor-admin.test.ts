import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import {
  HAY_BASE_DE_DATOS,
  clienteConSavepoint,
  crearPrismaDeTest,
  enTransaccionRevertida,
  fksDeOrden,
  serializarEscriturasReales,
  type TxDeTest,
} from "./_postgres-real";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 424 / T7 (R11/R12/R13/R14/R19) — **LA CONTRAPARTIDA DE LA REVERSION, MEDIDA CON EL ROL
// NUEVO.**
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// QUE DECIDIO EL HUMANO, Y POR QUE ESTE ARCHIVO NO ES UN EXTRA. El 2026-09-14 Carlos Restrepo
// pidio devolverle al `admin` la capacidad de eliminar ordenes, revirtiendo el estrechamiento del
// 2026-08-27 —«con dos roles capaces de borrar, el rastro de quien lo hizo deja de ser una sola
// persona»—. Su frase al decidirlo fue «que borre, pero que quede registro en el historial que ya
// tenemos». Ese registro es, literalmente, **lo unico que sostiene la reversion**: de 2 personas
// capaces de retirar una orden del sistema se pasa a 6 (medido el 2026-09-14: 2 `maestro` + 4
// `admin` activos en produccion), y lo que se exige a cambio es que cada retirada diga QUIEN, con
// QUE ROL, sobre QUE ORDEN y en QUE ACTO.
//
// ⚠️ NO SE ESTRENA NINGUN MECANISMO. Todo lo que este archivo mide existe desde la ficha 362:
// `softDelete` abre una `$transaction`, hace `UPDATE … RETURNING` (las ordenes EFECTIVAMENTE
// alcanzadas, no las pedidas), resuelve el actor con `resolverActorCongelado` y escribe una fila
// por orden con `appendAccion`, todas bajo un mismo `lote_id`. Lo que faltaba —y es lo que esta
// ficha aporta— es MEDIRLO con un actor de rol `admin`.
//
// POR QUE FALTABA, dicho con nombre: el caso que hoy congela nombre y rol
// (`historial-accion-atomicidad.test.ts`, «R3/R4: la fila congela la GUIA de la orden y el nombre
// y rol del actor») resuelve el actor con `tx.usuario.findFirstOrThrow()` SIN filtrar por rol.
// Afirma «el rol que sea del primer usuario que salga», que puede ser cualquiera. Los demas casos
// de aquel archivo pasan `actorUsuarioId: FKS.tiendaId`. Ninguno dice nada sobre `admin`.
//
// ⚠️ POR QUE CONTRA POSTGRES Y NO CON DOBLES. El congelado ocurre DENTRO de la transaccion del
// repositorio, leyendo la fila viva del usuario y escribiendo en una columna de tipo `rol_value`.
// Con dobles se afirmaria que `appendAccion` se llamo con un objeto; aqui se afirma que la fila
// EXISTE en la tabla y que la columna admitio el valor. Este repo tiene las dos lecciones
// escritas: «el WHERE se prueba donde vive» y «una imposibilidad razonada no es medida».
//
// ⚠️ PROHIBIDO EL `if (!fks) return;`. Si no hay datos para sembrar, el caso FALLA. Un `return`
// temprano reporta `passed` sin comprobar nada, y este repo ya se comio esa mentira una vez.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const SUFIJO = `424-adm-${Date.now().toString(36)}`;

describeSiHayBase("424/T7 — borrar como `admin` deja nombre y rol congelados (Postgres real)", () => {
  let prisma: PrismaClient;
  let FKS: Awaited<ReturnType<typeof fksDeOrden>>;
  let ESTATUS_ID: string;

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    FKS = await fksDeOrden(prisma);
    if (FKS === null) {
      // LANZA, no `return`: ver la cabecera.
      throw new Error(
        "hay DATABASE_URL pero la tabla `orden` esta vacia: sin FKs no se puede sembrar. Corre " +
          "`pnpm run db:seed` (y `pnpm exec tsx scripts/seed-zonas.ts`) antes de esta suite.",
      );
    }
    ESTATUS_ID = FKS.estatusId;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Siembra `n` ordenes vivas y devuelve sus ids. */
  async function sembrarOrdenes(tx: TxDeTest, n: number, marca: string): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const fila = await tx.orden.create({
        data: {
          numRemision: `R-${SUFIJO}-${marca}-${i}`,
          destinatario: "Dest",
          telefonoDest: "88880000",
          producto: "Prod",
          estatusId: ESTATUS_ID,
          tiendaId: FKS!.tiendaId,
          zonaId: FKS!.zonaId,
          provinciaId: FKS!.provinciaId,
          cantonId: FKS!.cantonId,
        },
        select: { id: true },
      });
      ids.push(fila.id);
    }
    return ids;
  }

  /**
   * Un usuario EFIMERO **con rol `admin`**, sembrado dentro de la transaccion revertida.
   *
   * Se SIEMBRA en vez de buscar uno existente a proposito: la base local puede no tener ningun
   * `admin` —y en produccion hay cuatro, pero eso no es asunto de un test—, y buscar uno haria
   * que este archivo pasara o fallara segun el contenido de una base compartida. El `rol` si se
   * BUSCA, porque el catalogo de roles es semilla del sistema y `rol.value` es `@unique`.
   *
   * El nombre lleva dos partes (nombre + primer apellido) para poder afirmar que lo congelado es
   * el nombre COMPUESTO y no solo la primera columna.
   */
  async function sembrarAdmin(
    tx: TxDeTest,
    marca: string,
  ): Promise<{ id: string; nombre: string; primerApellido: string }> {
    const rolAdmin = await tx.rol.findFirstOrThrow({
      where: { value: "admin" },
      select: { id: true },
    });
    // Solo para copiar el `tipo_identificacion_id`, que es un catalogo y no se puede inventar.
    const plantilla = await tx.usuario.findFirstOrThrow({
      select: { tipoIdentificacionId: true },
    });
    const nombre = `Admin${marca}`;
    const primerApellido = "Efimero424";
    const fila = await tx.usuario.create({
      data: {
        nombre,
        primerApellido,
        email: `${SUFIJO}-${marca}@example.test`,
        telefono: "88880000",
        passwordHash: "x",
        cedula: `${SUFIJO}-${marca}`,
        estado: "activo",
        tipoIdentificacionId: plantilla.tipoIdentificacionId,
        rolId: rolAdmin.id,
      },
      select: { id: true },
    });
    return { id: fila.id, nombre, primerApellido };
  }

  /** Las filas del registro que apuntan a estas entidades. */
  async function registroDe(tx: TxDeTest, entidadIds: string[]) {
    return tx.historialAccion.findMany({
      where: { entidadId: { in: entidadIds } },
      select: {
        accion: true,
        entidadTipo: true,
        entidadId: true,
        entidadEtiqueta: true,
        actorUsuarioId: true,
        actorNombre: true,
        actorRol: true,
        loteId: true,
      },
      orderBy: { entidadId: "asc" },
    });
  }

  it("ANTI-VACUIDAD: el actor que este archivo siembra tiene rol `admin` DE VERDAD", async () => {
    // Sin este caso, todo lo de abajo podria estar verde sobre un actor que no es `admin` —y
    // entonces mediria lo que ya media la ficha 362, no lo que esta ficha vino a medir—. Se lee
    // POR LA RELACION desde la base, no del objeto que devolvio el helper.
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const admin = await sembrarAdmin(tx, "anti");
      return tx.usuario.findUniqueOrThrow({
        where: { id: admin.id },
        select: { estado: true, rol: { select: { value: true } } },
      });
    });

    expect(r.rol.value).toBe("admin");
    expect(r.estado).toBe("activo");
  });

  it("⭑ R11/R12: dos ordenes borradas por un `admin` dejan DOS filas con su nombre y su rol congelados", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const admin = await sembrarAdmin(tx, "r11");
      const ids = await sembrarOrdenes(tx, 2, "r11");
      const repo = new OrdenRepository(clienteConSavepoint(tx));

      // `ownerId: null` = SIN frontera de tienda, que es el alcance «todas» que la ficha 424 le
      // devuelve al `admin` (el mismo con el que borra el `maestro`).
      const eliminadas = await repo.softDelete({
        ids,
        ownerId: null,
        actorUsuarioId: admin.id,
      });

      const ordenes = await tx.orden.findMany({
        where: { id: { in: ids } },
        select: { id: true, deletedAt: true },
      });
      const transiciones = await tx.ordenHistorialEstado.count({
        where: { ordenId: { in: ids } },
      });

      return { admin, ids, eliminadas, ordenes, transiciones, registro: await registroDe(tx, ids) };
    });

    expect(r.eliminadas).toBe(2);
    // R11: UNA fila por orden EFECTIVAMENTE borrada, y son esas dos.
    expect(r.registro).toHaveLength(2);
    expect(r.registro.map((f) => f.entidadId).sort()).toEqual([...r.ids].sort());

    for (const fila of r.registro) {
      expect(fila.accion).toBe("orden_eliminada");
      expect(fila.entidadTipo).toBe("orden");
      expect(fila.actorUsuarioId).toBe(r.admin.id);
      // ⭑ R12 — EL ASERTO DE LA FICHA. La columna es el enum `rol_value`, que ya contenia `admin`:
      // por eso esta ficha no necesita migracion. Si `resolverActorCongelado` devolviera el rol
      // VIVO en vez del congelado —o `null`—, esto cae.
      expect(fila.actorRol).toBe("admin");
      // Y el nombre COMPUESTO, no solo la primera columna.
      expect(fila.actorNombre).toBe(`${r.admin.nombre} ${r.admin.primerApellido}`);
      // La orden sembrada no tiene guia: la etiqueta cae a la REMISION, que si tiene.
      expect(fila.entidadEtiqueta).toContain(SUFIJO);
    }

    // R19: el borrado es LOGICO. Las dos filas de `orden` siguen existiendo, con `deleted_at`
    // puesto, y el historial de ESTADOS no gana ninguna transicion por haberlas borrado.
    expect(r.ordenes).toHaveLength(2);
    for (const orden of r.ordenes) expect(orden.deletedAt).not.toBeNull();
    expect(r.transiciones).toBe(0);
  });

  it("R12: el rol congelado sigue siendo `admin` aunque despues se le cambie el rol VIVO", async () => {
    // El motivo de congelarlo, en su caso mas directo: uno de los eventos que este registro
    // guarda ES el cambio de rol. Si la fila se resolviera por join al leer, una promocion a
    // `maestro` re-etiquetaria la historia —«el maestro Fulano borro»— sobre un acto que hizo
    // siendo `admin`, y ese error es indetectable a ojo.
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const admin = await sembrarAdmin(tx, "promo");
      const [ordenId] = await sembrarOrdenes(tx, 1, "promo");
      const repo = new OrdenRepository(clienteConSavepoint(tx));
      await repo.softDelete({ ids: [ordenId], ownerId: null, actorUsuarioId: admin.id });

      // Se le cambia el rol vivo DESPUES del borrado.
      const rolMaestro = await tx.rol.findFirstOrThrow({
        where: { value: "maestro" },
        select: { id: true },
      });
      await tx.usuario.update({ where: { id: admin.id }, data: { rolId: rolMaestro.id } });

      const vivo = await tx.usuario.findUniqueOrThrow({
        where: { id: admin.id },
        select: { rol: { select: { value: true } } },
      });
      return { vivo: vivo.rol.value, registro: await registroDe(tx, [ordenId]) };
    });

    // El control que impide que este caso sea vacio: el rol vivo SI cambio.
    expect(r.vivo).toBe("maestro");
    expect(r.registro).toHaveLength(1);
    expect(r.registro[0].actorRol).toBe("admin");
  });

  it("⭑ R13: las dos filas comparten UN `lote_id`, y un segundo acto trae otro", async () => {
    // La diferencia entre «se borraron 2 de una vez» y «hubo 2 borrados». Con la reversion de la
    // 424 esto importa mas, no menos: el rastro tiene que poder decir cuantas VECES actuo cada
    // persona, no solo cuantas ordenes se llevo por delante.
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const admin = await sembrarAdmin(tx, "lote");
      const acto1 = await sembrarOrdenes(tx, 2, "lote1");
      const acto2 = await sembrarOrdenes(tx, 2, "lote2");
      const repo = new OrdenRepository(clienteConSavepoint(tx));

      await repo.softDelete({ ids: acto1, ownerId: null, actorUsuarioId: admin.id });
      await repo.softDelete({ ids: acto2, ownerId: null, actorUsuarioId: admin.id });

      return { uno: await registroDe(tx, acto1), dos: await registroDe(tx, acto2) };
    });

    expect(r.uno).toHaveLength(2);
    expect(r.dos).toHaveLength(2);
    // UN lote por acto...
    expect(new Set(r.uno.map((f) => f.loteId)).size).toBe(1);
    expect(new Set(r.dos.map((f) => f.loteId)).size).toBe(1);
    // ...y distinto del otro.
    expect(r.uno[0].loteId).not.toBe(r.dos[0].loteId);
  });

  it("⭑ R14: una orden YA borrada dentro del mismo lote NO deja fila", async () => {
    // «Se pidio borrar» y «se borro» son cosas distintas. El `where` conserva
    // `deleted_at IS NULL`, el `RETURNING` no la trae y no se escribe su auditoria. La mutacion
    // que esto prohibe es construir las entradas con los ids PEDIDOS: con ellos habria TRES
    // filas, y una seria la auditoria de un borrado que no ocurrio.
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const admin = await sembrarAdmin(tx, "r14");
      const ids = await sembrarOrdenes(tx, 3, "r14");
      await tx.orden.update({ where: { id: ids[1] }, data: { deletedAt: new Date() } });

      const repo = new OrdenRepository(clienteConSavepoint(tx));
      const eliminadas = await repo.softDelete({
        ids,
        ownerId: null,
        actorUsuarioId: admin.id,
      });
      return { ids, eliminadas, registro: await registroDe(tx, ids) };
    });

    expect(r.eliminadas).toBe(2);
    expect(r.registro).toHaveLength(2);
    expect(r.registro.map((f) => f.entidadId).sort()).toEqual([r.ids[0], r.ids[2]].sort());
    expect(r.registro.map((f) => f.entidadId)).not.toContain(r.ids[1]);
    // Y las dos que si quedaron llevan el rol del `admin`: el lote parcial no degrada el rastro.
    for (const fila of r.registro) expect(fila.actorRol).toBe("admin");
  });
});
