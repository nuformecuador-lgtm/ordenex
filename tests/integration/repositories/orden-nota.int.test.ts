import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTestConEspia,
  enTransaccionRevertida,
  serializarEscriturasReales,
} from "../db/_postgres-real";
import { OrdenNotaRepository } from "@/lib/repositories/OrdenNotaRepository";
import type { OrdenNotaRow } from "@/lib/interfaces/repositories/IOrdenNotaRepository";

// Feature 227 (T2.5) — el REPOSITORIO del hilo contra Postgres REAL. Cubre R3 (orden ascendente
// y estable con instantes REPETIDOS), R31 (el borrado logico conserva la fila y su autoria) y
// R32 (el borrado filtra por autor en el MISMO statement).
//
// POR QUE CONTRA POSTGRES Y NO CON UN DOBLE. Las tres cosas que se miden aqui son del MOTOR y no
// del codigo: quien decide el orden de un `ORDER BY created_at, id` con dos instantes iguales es
// Postgres; que un `updateMany` con `autor_id` en el WHERE no toque la fila ajena es Postgres; y
// que la fila borrada SIGA existiendo con su cuerpo y su autor es la tabla. Un fake que ordena
// con `Array.sort` demuestra que el fake ordena.
//
// COMO NO ENSUCIA NADA: todo ocurre dentro de `enTransaccionRevertida`, que SIEMPRE hace
// rollback (pase el test, falle o muera el proceso). El test crea SUS PROPIAS filas —dos
// usuarios y una orden, a partir de los catalogos— porque la base local esta practicamente
// vacia y un test que retorna temprano por falta de datos cuenta como `passed`: eso es un verde
// EN FALSO, y aqui se evita a proposito. Si faltaran los catalogos, FALLA con el motivo escrito.
// Lo unico que lo salta es la ausencia de `DATABASE_URL` (vitest lo marca SKIPPED, no passed).

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

/** Ids FIJOS y ordenables como texto: el desempate de R3 es por `id`, asi que el test necesita
 *  saber cual va antes SIN depender de que uuid salga sorteado. */
const ID_A = "aaaaaaaa-1111-4111-8111-111111111111";
const ID_B = "bbbbbbbb-2222-4222-8222-222222222222";
const ID_C = "cccccccc-3333-4333-8333-333333333333";

/** Dos instantes: el primero se REPITE en dos notas (el caso que R3 existe para cubrir). */
const T1 = new Date("2026-08-15T10:00:00.000Z");
const T2 = new Date("2026-08-15T11:00:00.000Z");

interface Medicion {
  primeraLectura: OrdenNotaRow[];
  segundaLectura: OrdenNotaRow[];
  creadaPorElRepo: OrdenNotaRow;
  /** R31 */
  borradasPorElAutor: number;
  filaTrasElBorrado: {
    id: string;
    autorId: string;
    cuerpo: string;
    deletedAt: Date | null;
    createdAt: Date;
  } | null;
  lecturaTrasElBorrado: OrdenNotaRow[];
  /** R32 */
  borradasPorLaContraparte: number;
  filaAjenaTrasElIntento: { autorId: string; cuerpo: string; deletedAt: Date | null } | null;
  borradasPorSegundaVez: number;
  borradasDeOtraOrden: number;
  /** SQL que emitio el intento de borrado ajeno. */
  sqlDelBorradoAjeno: string[];
}

describeSiHayBase("227 / T2.5 — OrdenNotaRepository contra Postgres real (R3, R31, R32)", () => {
  let prisma: PrismaClient;
  let eventos: { query: string }[];
  let m: Medicion;

  beforeAll(async () => {
    const espia = crearPrismaDeTestConEspia();
    prisma = espia.prisma;
    eventos = espia.eventos;
    m = await enTransaccionRevertida(prisma, medir);
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function medir(tx: Tx): Promise<Medicion> {
    // PRIMERA sentencia de la transaccion, antes de tocar nada: este test escribe usuarios y
    // ordenes REALES en `public`, igual que los dos tests de migracion de la feature, que
    // corren en paralelo. Sin serializar, los tres toman los mismos locks de FK en distinto
    // orden y Postgres mata a uno con `40P01`. No cambia NADA de lo que se mide: va antes de
    // que se instale el espia de SQL sobre `orden_nota` (el `slice` de eventos empieza mucho
    // despues) y se suelta solo al revertir la transaccion.
    await serializarEscriturasReales(tx);

    const repo = new OrdenNotaRepository(tx as unknown as PrismaClient);

    const tienda = await crearUsuario(tx, "Tienda del test");
    const mensajero = await crearUsuario(tx, "Mensajero del test");
    const ordenId = await crearOrden(tx, tienda, mensajero);
    const otraOrdenId = await crearOrden(tx, tienda, mensajero);

    // Sembradas por `tx` y NO por el repo: hacen falta instantes CONTROLADOS (uno repetido), y
    // `crear` —con razon— no deja fijar `created_at`. Se insertan en orden C, B, A para que el
    // orden de INSERCION sea el contrario del esperado: si el repo devolviera "como vinieron",
    // el test lo veria.
    await sembrar(tx, ID_C, ordenId, mensajero, "mensajero", "la tercera", T2);
    await sembrar(tx, ID_B, ordenId, tienda, "adminTienda", "la segunda", T1);
    await sembrar(tx, ID_A, ordenId, tienda, "adminTienda", "la primera", T1);
    // Una nota de OTRA orden: el `where` del borrado tambien la tiene que dejar en paz.
    await sembrar(tx, randomUUID(), otraOrdenId, tienda, "adminTienda", "de otra orden", T1);

    // --- R3 --------------------------------------------------------------------------------
    const primeraLectura = await repo.listarPorOrden(ordenId);
    const segundaLectura = await repo.listarPorOrden(ordenId);

    // El `crear` del repo, ejercitado de verdad (la nota nace vigente y al final del hilo).
    const creadaPorElRepo = await repo.crear({
      ordenId,
      autorId: mensajero,
      rolAutor: "mensajero",
      cuerpo: "escrita por el repositorio",
    });

    // --- R32: la contraparte intenta borrar una nota AJENA -----------------------------------
    const antesDelIntento = eventos.length;
    const borradasPorLaContraparte = await repo.marcarBorrada(ID_A, ordenId, mensajero);
    const sqlDelBorradoAjeno = eventos.slice(antesDelIntento).map((e) => e.query);
    const filaAjenaTrasElIntento = await tx.ordenNota.findUnique({
      where: { id: ID_A },
      select: { autorId: true, cuerpo: true, deletedAt: true },
    });
    // El mismo id, desde la orden equivocada: tampoco.
    const borradasDeOtraOrden = await repo.marcarBorrada(ID_A, otraOrdenId, tienda);

    // --- R31: el AUTOR borra su propia nota ---------------------------------------------------
    const borradasPorElAutor = await repo.marcarBorrada(ID_A, ordenId, tienda);
    const filaTrasElBorrado = await tx.ordenNota.findUnique({
      where: { id: ID_A },
      select: { id: true, autorId: true, cuerpo: true, deletedAt: true, createdAt: true },
    });
    const lecturaTrasElBorrado = await repo.listarPorOrden(ordenId);
    // Repetir el borrado no vuelve a mover la marca (idempotente por `deletedAt: null`).
    const borradasPorSegundaVez = await repo.marcarBorrada(ID_A, ordenId, tienda);

    return {
      primeraLectura,
      segundaLectura,
      creadaPorElRepo,
      borradasPorElAutor,
      filaTrasElBorrado,
      lecturaTrasElBorrado,
      borradasPorLaContraparte,
      filaAjenaTrasElIntento,
      borradasPorSegundaVez,
      borradasDeOtraOrden,
      sqlDelBorradoAjeno,
    };
  }

  async function sembrar(
    tx: Tx,
    id: string,
    ordenId: string,
    autorId: string,
    rolAutor: "adminTienda" | "mensajero",
    cuerpo: string,
    createdAt: Date,
  ): Promise<void> {
    await tx.ordenNota.create({ data: { id, ordenId, autorId, rolAutor, cuerpo, createdAt } });
  }

  /** Un usuario NUEVO del test. Si faltan los catalogos, FALLA (no se abstiene). */
  async function crearUsuario(tx: Tx, nombre: string): Promise<string> {
    const rol = await tx.rol.findFirst({ select: { id: true } });
    const tipo = await tx.tipoIdentificacion.findFirst({ select: { id: true } });
    if (!rol || !tipo) {
      throw new Error(
        "La base de pruebas no tiene catalogos `rol`/`tipo_identificacion` sembrados: sin ellos " +
          "no se pueden crear los usuarios propios del test. Corre `pnpm db:seed`. Este test NO " +
          "se salta en ese caso a proposito.",
      );
    }
    const sufijo = randomUUID().slice(0, 8);
    const { id } = await tx.usuario.create({
      data: {
        nombre: `${nombre} ${sufijo}`,
        email: `t227-${sufijo}@example.test`,
        telefono: "00000000",
        passwordHash: "x",
        cedula: `t227${sufijo}`,
        tipoIdentificacionId: tipo.id,
        rolId: rol.id,
      },
      select: { id: true },
    });
    return id;
  }

  /** Una orden NUEVA del test, con las FK obligatorias tomadas de los catalogos. */
  async function crearOrden(tx: Tx, tiendaId: string, mensajeroId: string): Promise<string> {
    const canton = await tx.canton.findFirst({ select: { id: true, provinciaId: true } });
    const zona = await tx.zona.findFirst({ select: { id: true } });
    const estatus = await tx.orderStatus.findFirst({ select: { id: true } });
    if (!canton || !zona || !estatus) {
      throw new Error(
        "La base de pruebas no tiene catalogos de geografia/estatus sembrados: sin ellos no se " +
          "puede crear la orden propia del test (y sin orden no hay hilo que medir). Corre " +
          "`pnpm db:seed`. Este test NO se salta en ese caso a proposito.",
      );
    }
    const sufijo = randomUUID().slice(0, 12);
    const { id } = await tx.orden.create({
      data: {
        numRemision: `t227-${sufijo}`,
        estatusId: estatus.id,
        destinatario: "Destinatario de prueba",
        telefonoDest: "00000000",
        tiendaId,
        zonaId: zona.id,
        provinciaId: canton.provinciaId,
        cantonId: canton.id,
        producto: "Producto",
        mensajeroAsignadoId: mensajeroId,
      },
      select: { id: true },
    });
    return id;
  }

  // ==========================================================================================

  it("devuelve el hilo en orden ascendente y estable con instantes repetidos", () => {
    // A y B comparten `created_at` EXACTO; el desempate por `id` los deja siempre en el mismo
    // orden, y C —posterior— cierra. Sin el segundo criterio del `orderBy`, dos notas del mismo
    // milisegundo pueden volver en cualquier orden y el hilo "se mueve" solo entre recargas.
    expect(m.primeraLectura.map((n) => n.id)).toEqual([ID_A, ID_B, ID_C]);
    expect(m.primeraLectura.map((n) => n.createdAt.toISOString())).toEqual([
      T1.toISOString(),
      T1.toISOString(),
      T2.toISOString(),
    ]);
    // Dos lecturas consecutivas devuelven la MISMA secuencia.
    expect(m.segundaLectura.map((n) => n.id)).toEqual(m.primeraLectura.map((n) => n.id));
    // Y el orden NO es el de insercion (se sembro C, B, A).
    expect(m.primeraLectura.map((n) => n.id)).not.toEqual([ID_C, ID_B, ID_A]);
  });

  it("resuelve el nombre del autor por JOIN en la misma consulta y no filtra por orden ajena", () => {
    expect(m.primeraLectura).toHaveLength(3); // la nota de la OTRA orden no aparece
    for (const nota of m.primeraLectura) {
      expect(nota.autor.nombre.length).toBeGreaterThan(0);
    }
    expect(m.primeraLectura.map((n) => n.rolAutor)).toEqual(["adminTienda", "adminTienda", "mensajero"]);
  });

  it("`crear` inserta UNA fila vigente al final del hilo, con el rol congelado que recibe", () => {
    expect(m.creadaPorElRepo.deletedAt).toBeNull();
    expect(m.creadaPorElRepo.rolAutor).toBe("mensajero");
    expect(m.creadaPorElRepo.cuerpo).toBe("escrita por el repositorio");
    expect(m.creadaPorElRepo.autor.nombre).toContain("Mensajero del test");
    // El hilo pasa de 3 a 4 y las tres previas siguen ahi (la lectura posterior las cuenta).
    expect(m.lecturaTrasElBorrado).toHaveLength(4);
  });

  it("el borrado lógico conserva la fila y su autoría", () => {
    // R31: `updateMany` devolvio 1 y la fila SIGUE EN LA BASE, con su autor, su cuerpo y su
    // instante de creacion intactos, mas la marca de borrado. Nada de `DELETE`.
    expect(m.borradasPorElAutor).toBe(1);
    expect(m.filaTrasElBorrado).not.toBeNull();
    expect(m.filaTrasElBorrado!.autorId.length).toBeGreaterThan(0);
    expect(m.filaTrasElBorrado!.cuerpo).toBe("la primera");
    expect(m.filaTrasElBorrado!.deletedAt).toBeInstanceOf(Date);
    expect(m.filaTrasElBorrado!.createdAt.toISOString()).toBe(T1.toISOString());

    // La lectura del hilo SIGUE trayendola (R34: el hueco se pinta en su sitio) y en la misma
    // posicion; quien le quita el cuerpo es el service, no el repo.
    expect(m.lecturaTrasElBorrado.map((n) => n.id).slice(0, 3)).toEqual([ID_A, ID_B, ID_C]);
    const borrada = m.lecturaTrasElBorrado.find((n) => n.id === ID_A)!;
    expect(borrada.deletedAt).toBeInstanceOf(Date);
    expect(borrada.cuerpo).toBe("la primera");

    // Repetirlo es no-op: la marca no se vuelve a mover.
    expect(m.borradasPorSegundaVez).toBe(0);
  });

  it("el borrado filtra por autor en el mismo statement", () => {
    // R32: la CONTRAPARTE del hilo pide borrar una nota de la tienda -> 0 filas, y la nota sigue
    // vigente y con su cuerpo. El autor no se comprueba en un `if` previo (que dejaria una
    // ventana entre el chequeo y el efecto): va en el WHERE del UPDATE.
    expect(m.borradasPorLaContraparte).toBe(0);
    expect(m.filaAjenaTrasElIntento).not.toBeNull();
    expect(m.filaAjenaTrasElIntento!.deletedAt).toBeNull();
    expect(m.filaAjenaTrasElIntento!.cuerpo).toBe("la primera");

    // Y el mismo id desde OTRA orden tampoco: el `orden_id` ata la nota al hilo sobre el que el
    // service autorizo (sin eso, un autor podria borrar su nota de una orden cuya ventana esta
    // cerrada, R35).
    expect(m.borradasDeOtraOrden).toBe(0);

    // La prueba de "en el MISMO statement": el intento emitio UN solo UPDATE y NINGUN SELECT
    // previo sobre `orden_nota`. Se mide sobre el SQL que Prisma mando de verdad al servidor.
    const sql = m.sqlDelBorradoAjeno.filter((q) => /orden_nota/i.test(q));
    expect(sql).toHaveLength(1);
    expect(sql[0]).toMatch(/^\s*UPDATE\b/i);
    expect(sql[0]).toMatch(/autor_id/i);
    expect(sql[0]).toMatch(/orden_id/i);
    expect(sql[0]).toMatch(/deleted_at/i);
  });
});
