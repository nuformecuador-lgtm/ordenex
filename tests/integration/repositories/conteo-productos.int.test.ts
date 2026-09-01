import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
} from "../db/_postgres-real";
import { prepararConsultaProductos } from "@/lib/analytics/productos-consulta";
import type { ConsultaProductos } from "@/lib/analytics/productos-consulta";
import { ConteoProductosRepository } from "@/lib/repositories/ConteoProductosRepository";
import type { FilaProductoCruda } from "@/lib/interfaces/repositories/IConteoProductosRepository";

// FICHA 345 / T3.3 — EL RECORTE DONDE VIVE: CONTRA POSTGRES (R27, R39, R54, R55, R57).
//
// ⚠ POR QUE ESTE ARCHIVO EXISTE, y no basta el test de servicio. En este repo esta MEDIDO —cuatro
// veces seguidas— que una mutacion del `WHERE` pasa EN VERDE con dobles: un doble del repositorio
// devuelve las filas que el test le dio, asi que demuestra que el doble devuelve lo que le dieron.
// La separacion entre inquilinos vive en el SQL, y aqui es donde se mira. Sin policies RLS debajo
// (Prisma se conecta con credenciales de servicio) esa condicion es la UNICA separacion: un fallo
// no da una cifra equivocada, filtra los productos de una tienda a otra.
//
// COMPROBADO CON UNA MUTACION (T3.3): quitar `tienda_id` del `WHERE` del alcance —es decir, que
// `condicionDeAlcance` devuelva `TRUE` para el caso `tienda`— deja este archivo ROJO en el caso
// «(d) un adminTienda NO ve ni una fila de la otra tienda». Anotado en `progress/impl_345.md`.
//
// COMO NO ENSUCIA NADA: todo ocurre dentro de `enTransaccionRevertida`, que SIEMPRE hace rollback
// (pase el test, falle o muera el proceso). El test crea SUS PROPIAS filas —dos tiendas, un
// mensajero y sus ordenes— porque la base local esta practicamente vacia y un test que retorna
// temprano por falta de datos cuenta como `passed`: eso es un verde EN FALSO. Si faltaran los
// catalogos, FALLA con el motivo escrito. Lo unico que lo salta es la ausencia de `DATABASE_URL`
// (vitest lo marca SKIPPED, no passed).

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

const AHORA = new Date("2026-09-01T12:00:00.000Z");

/** El texto que las DOS tiendas escriben igual: la prueba de que no se funden (R39). */
const TEXTO_COMPARTIDO = "1 * Crema Especial MLX";
/** El texto que se REPITE en varias ordenes de la misma tienda: N ordenes, UNA fila (R57). */
const TEXTO_REPETIDO = "1 * Base Dr. 1 * BASE C.";

interface Medicion {
  tiendaA: string;
  tiendaB: string;
  /** lo que ve un maestro sobre las dos tiendas */
  global: readonly FilaProductoCruda[];
  /** lo que ve el adminTienda de A */
  soloA: readonly FilaProductoCruda[];
  /** lo que ve el adminTienda de B */
  soloB: readonly FilaProductoCruda[];
}

describeSiHayBase("345 / T3.3 — ConteoProductosRepository contra Postgres real", () => {
  let prisma: PrismaClient;
  let m: Medicion;

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    m = await enTransaccionRevertida(prisma, medir);
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  function consultaDe(rol: string, usuarioId: string): ConsultaProductos {
    // La consulta se PREPARA de verdad —no se forja— para que el alcance que viaja al `WHERE`
    // sea el que el resolutor concede y no uno escrito a mano por el test.
    const preparada = prepararConsultaProductos({}, { usuarioId, rol } as never, AHORA);
    if (preparada.status !== "ok") {
      throw new Error(`la consulta de prueba salio ${preparada.status}`);
    }
    return preparada.consulta;
  }

  async function medir(tx: Tx): Promise<Medicion> {
    // PRIMERA sentencia: este test escribe usuarios y ordenes REALES en `public`, igual que
    // otros que corren en paralelo. Sin serializar, los locks de FK se toman en distinto orden
    // y Postgres mata a uno con `40P01`.
    await serializarEscriturasReales(tx);

    const tiendaA = await crearUsuario(tx, "Tienda A del test 345");
    const tiendaB = await crearUsuario(tx, "Tienda B del test 345");
    const mensajero = await crearUsuario(tx, "Mensajero del test 345");

    // (a) EL MISMO TEXTO EN DOS TIENDAS. Dos filas, nunca una.
    await crearOrden(tx, tiendaA, TEXTO_COMPARTIDO);
    await crearOrden(tx, tiendaB, TEXTO_COMPARTIDO);
    await crearOrden(tx, tiendaB, TEXTO_COMPARTIDO);

    // (b) N ORDENES CON EL MISMO TEXTO en la misma tienda: una sola fila con `n = 3`.
    await crearOrden(tx, tiendaA, TEXTO_REPETIDO);
    await crearOrden(tx, tiendaA, TEXTO_REPETIDO);
    await crearOrden(tx, tiendaA, TEXTO_REPETIDO);

    // (c) UNA ORDEN BORRADA no cuenta en ningun bucket.
    const borrada = await crearOrden(tx, tiendaA, "1 * Producto Borrado");
    await tx.orden.update({ where: { id: borrada }, data: { deletedAt: new Date() } });

    // (e) DOS GESTIONES: la ULTIMA VIGENTE manda, y una anulada no cuenta ni aunque sea la mas
    // reciente. La orden tiene que salir como `rechazada`, no como `entregada` ni por su estatus.
    const conGestiones = await crearOrden(tx, tiendaA, "1 * Producto Con Gestiones");
    await crearGestion(tx, conGestiones, mensajero, "entregada", new Date("2026-08-30T10:00:00Z"));
    await crearGestion(tx, conGestiones, mensajero, "rechazada", new Date("2026-08-31T10:00:00Z"));
    await crearGestion(tx, conGestiones, mensajero, "devuelta", new Date("2026-09-01T10:00:00Z"), {
      anulada: true,
    });

    const repo = new ConteoProductosRepository(tx as unknown as PrismaClient);

    return {
      tiendaA,
      tiendaB,
      global: await repo.contarProductos(consultaDe("maestro", "quien-sea")),
      soloA: await repo.contarProductos(consultaDe("adminTienda", tiendaA)),
      soloB: await repo.contarProductos(consultaDe("adminTienda", tiendaB)),
    };
  }

  /** Sólo las filas que este test sembró: la base local puede traer otras órdenes. */
  function delTest(filas: readonly FilaProductoCruda[], tienda: string): FilaProductoCruda[] {
    return filas.filter((f) => f.tiendaId === tienda);
  }

  // ==========================================================================================

  it("(a) dos tiendas con el MISMO texto de producto dan DOS filas, nunca una", () => {
    const compartidas = m.global.filter((f) => f.producto === TEXTO_COMPARTIDO);

    // R39 — que dos tiendas escriban lo mismo no prueba que sea el mismo articulo. La tienda es
    // parte de la clave de agrupacion EN LA BASE, no un campo que se rellene despues.
    expect(compartidas).toHaveLength(2);
    expect(new Set(compartidas.map((f) => f.tiendaId))).toEqual(new Set([m.tiendaA, m.tiendaB]));
    expect(compartidas.find((f) => f.tiendaId === m.tiendaA)?.n).toBe(1);
    expect(compartidas.find((f) => f.tiendaId === m.tiendaB)?.n).toBe(2);
    // Y cada fila trae el NOMBRE de su tienda por el JOIN, no un id pelado.
    for (const fila of compartidas) expect(fila.tiendaNombre).toContain("del test 345");
  });

  it("(b) N ordenes con el mismo texto son UNA fila con `n = N` (R57)", () => {
    const repetidas = delTest(m.global, m.tiendaA).filter((f) => f.producto === TEXTO_REPETIDO);

    // Lo que acota el coste de esta lectura: las filas crecen con el CATALOGO, no con las
    // ventas. Si el repositorio devolviera una fila por orden, aqui habria 3.
    expect(repetidas).toHaveLength(1);
    expect(repetidas[0].n).toBe(3);
    // Y el texto llega CRUDO: el repositorio no parsea.
    expect(repetidas[0].producto).toBe("1 * Base Dr. 1 * BASE C.");
  });

  it("(c) una orden BORRADA no cuenta en ningun bucket (R55)", () => {
    expect(m.global.map((f) => f.producto)).not.toContain("1 * Producto Borrado");
    expect(m.soloA.map((f) => f.producto)).not.toContain("1 * Producto Borrado");
  });

  it("(d) un adminTienda NO ve ni una fila de la otra tienda (R54)", () => {
    // ⚠ ÉSTA es la aserción que la mutación mata. Es la frontera multi-tenant medida donde vive:
    // en el `WHERE` que Postgres ejecuta, no en un doble que devuelve lo que se le dio.
    expect(m.soloA.length).toBeGreaterThan(0);
    expect(m.soloB.length).toBeGreaterThan(0);

    // Ni una sola fila ajena, en ninguna de las dos direcciones.
    expect(m.soloA.filter((f) => f.tiendaId !== m.tiendaA)).toEqual([]);
    expect(m.soloB.filter((f) => f.tiendaId !== m.tiendaB)).toEqual([]);
    expect(m.soloA.map((f) => f.tiendaId)).not.toContain(m.tiendaB);
    expect(m.soloB.map((f) => f.tiendaId)).not.toContain(m.tiendaA);

    // Y no es que la consulta venga vacia: el maestro SÍ ve las dos, asi que el recorte esta
    // quitando filas que existen. Sin este contrapeso, un `WHERE FALSE` pasaria el caso.
    expect(new Set(m.global.map((f) => f.tiendaId))).toContain(m.tiendaA);
    expect(new Set(m.global.map((f) => f.tiendaId))).toContain(m.tiendaB);
    expect(delTest(m.global, m.tiendaB).length).toBeGreaterThan(0);
    expect(delTest(m.global, m.tiendaA).length).toBeGreaterThan(0);
  });

  it("(d bis) el adminTienda ve TODO lo suyo: el recorte no se pasa de frenada", () => {
    const suyasSegunElMaestro = delTest(m.global, m.tiendaA);
    const suyasSegunElla = [...m.soloA].sort((x, y) => (x.producto < y.producto ? -1 : 1));
    const esperadas = [...suyasSegunElMaestro].sort((x, y) => (x.producto < y.producto ? -1 : 1));

    expect(suyasSegunElla).toEqual(esperadas);
  });

  it("(e) el desenlace es el de la ULTIMA gestion VIGENTE (R27)", () => {
    const fila = m.global.find((f) => f.producto === "1 * Producto Con Gestiones");

    expect(fila).toBeDefined();
    // La mas reciente esta ANULADA (`devuelta`), asi que manda la anterior vigente. Si el
    // `LATERAL` no filtrara `anulada_at IS NULL`, aqui saldria `devuelta`; si ordenara al reves,
    // saldria `entregada`; y si no hubiera `LATERAL`, saldria el `order_status` de la orden.
    expect(fila?.status).toBe("rechazada");
    expect(fila?.n).toBe(1);
  });

  it("una orden SIN gestion cae del lado de su `order_status` (LEFT, no INNER)", async () => {
    // Las ordenes sembradas sin gestion tienen que estar: si el `JOIN LATERAL` fuera `INNER`,
    // desaparecerian y la tabla contaria solo las gestionadas.
    const sinGestion = m.global.filter((f) => f.producto === TEXTO_COMPARTIDO);
    expect(sinGestion).toHaveLength(2);
    for (const fila of sinGestion) {
      expect(typeof fila.status).toBe("string");
      expect(fila.status.length).toBeGreaterThan(0);
      // No es un resultado de gestion: es el `value` del catalogo de estatus.
      expect(["entregada", "rechazada", "devuelta", "reprogramada", "incidente"]).not.toContain(
        fila.status,
      );
    }
  });

  it("las cifras son enteros y no hay ninguna de dinero", () => {
    for (const fila of m.global) {
      expect(Number.isSafeInteger(fila.n), fila.producto).toBe(true);
      expect(fila.n).toBeGreaterThan(0);
      expect(Object.keys(fila).sort()).toEqual([
        "n",
        "producto",
        "status",
        "tiendaId",
        "tiendaNombre",
      ]);
    }
  });

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
        email: `t345-${sufijo}@example.test`,
        telefono: "00000000",
        passwordHash: "x",
        cedula: `t345${sufijo}`,
        tipoIdentificacionId: tipo.id,
        rolId: rol.id,
      },
      select: { id: true },
    });
    return id;
  }

  /** Una orden NUEVA del test, con las FK obligatorias tomadas de los catalogos. */
  async function crearOrden(tx: Tx, tiendaId: string, producto: string): Promise<string> {
    const canton = await tx.canton.findFirst({ select: { id: true, provinciaId: true } });
    const zona = await tx.zona.findFirst({ select: { id: true } });
    const estatus = await tx.orderStatus.findFirst({ select: { id: true } });
    if (!canton || !zona || !estatus) {
      throw new Error(
        "La base de pruebas no tiene catalogos de geografia/estatus sembrados: sin ellos no se " +
          "puede crear la orden propia del test. Corre `pnpm db:seed`. Este test NO se salta en " +
          "ese caso a proposito.",
      );
    }
    const sufijo = randomUUID().slice(0, 12);
    const { id } = await tx.orden.create({
      data: {
        numRemision: `t345-${sufijo}`,
        estatusId: estatus.id,
        destinatario: "Destinatario de prueba",
        telefonoDest: "00000000",
        tiendaId,
        zonaId: zona.id,
        provinciaId: canton.provinciaId,
        cantonId: canton.id,
        producto,
      },
      select: { id: true },
    });
    return id;
  }

  async function crearGestion(
    tx: Tx,
    ordenId: string,
    mensajeroId: string,
    resultado: "entregada" | "rechazada" | "devuelta",
    createdAt: Date,
    opts: { anulada?: boolean } = {},
  ): Promise<void> {
    await tx.gestionOrden.create({
      data: {
        ordenId,
        mensajeroId,
        resultado,
        createdAt,
        anuladaAt: opts.anulada === true ? new Date() : null,
      },
    });
  }
});
