import { describe, it, expect, beforeAll } from "vitest";
import type { EstadoUsuario, PrismaClient, RolValue } from "@prisma/client";

import { UserRepository } from "@/lib/repositories/UserRepository";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { CierresAdminRepository } from "@/lib/repositories/CierresAdminRepository";
import { ESTADOS_USUARIO_NO_ASIGNABLES } from "@/lib/constants/estado-usuario-asignable";

import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
} from "./_postgres-real";

/**
 * FICHA 351 — **LOS CATÁLOGOS DE FILTRO NO OFRECEN CUENTAS DADAS DE BAJA, Y EL HISTÓRICO NO SE
 * TOCA.** Todo medido contra Postgres.
 *
 * ⚠️ POR QUÉ CONTRA POSTGRES Y NO CON DOBLES. En este repo está medido cuatro veces que una
 * mutación del `WHERE` pasa en verde con dobles: el doble responde lo mismo se filtre como se
 * filtre. Lo que esta ficha cambia ES un `WHERE`, así que un test de servicio no probaría nada.
 * Las mutaciones de la bitácora (`progress/impl_351.md`) se mataron aquí.
 *
 * LAS DOS MITADES, Y LA SEGUNDA ES LA QUE IMPORTA:
 *
 *   1. el CATÁLOGO deja fuera a `inactivo` y `bloqueado` (T1, T2, T3, T6);
 *   2. los DATOS **no**: una orden de una tienda dada de baja, llevada por un mensajero dado de
 *      baja, sigue saliendo entera en el listado y sigue siendo filtrable por esos ids (T4, T5).
 *      Un arreglo que escondiera órdenes históricas sería peor que el problema que vino a
 *      resolver, así que esa mitad se afirma explícitamente y no por ausencia.
 *
 * `pendiente` SE OFRECE, y también se afirma (T1/T2): no está en `ESTADOS_USUARIO_NO_ASIGNABLES`,
 * así que hoy se le pueden asignar órdenes y puede tener trabajo vivo que alguien necesite buscar.
 * Si mañana alguien decide esconderlo, este archivo se pone rojo y obliga a decidirlo a propósito.
 *
 * SIN `DATABASE_URL` se SALTA (`describe.skip`), que es la convención del arnés y se ve en la
 * salida. CON base pero sin los catálogos que necesita, REVIENTA CON MENSAJE: un `if (!x) return;`
 * reporta `passed` sin haber comprobado nada, y eso es peor que no tener el test.
 *
 * Todo corre dentro de una transacción que SIEMPRE se revierte, y `serializarEscriturasReales` es
 * la primera sentencia porque se escribe en `public."usuario"`, `public."zona"` y `public."orden"`,
 * que son tablas REALES compartidas con los demás archivos que corren en paralelo.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

/** Sufijo único por corrida: `usuario.email`, `usuario.cedula` y `zona.nombre` son UNIQUE. */
const SUFIJO = `f351${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

/** Cuántas filas se piden cuando se quiere "todo". */
const TAKE_TODO = 2000;

/** Las cuatro formas de `EstadoUsuario`, sembradas cada una en su rol. */
const ESTADOS: readonly EstadoUsuario[] = ["activo", "pendiente", "inactivo", "bloqueado"];

interface Sembrado {
  /** id de la cuenta tienda (`adminTienda`) por estado. */
  tienda: Record<EstadoUsuario, string>;
  /** id del mensajero por estado, todos en `zonaConAdminActivo`. */
  mensajero: Record<EstadoUsuario, string>;
  /** Zona cuyo ÚNICO `adminSatelite` está `activo`: sigue siendo una bodega ofrecible. */
  zonaConAdminActivo: string;
  /** Zona cuyo ÚNICO `adminSatelite` está `inactivo`: ya no es una bodega operativa. */
  zonaConAdminDeBaja: string;
  /** Orden de la tienda DADA DE BAJA, llevada por el mensajero DADO DE BAJA. */
  ordenHistorica: string;
}

describeSiHayBase("351 — catálogos de filtro sin cuentas dadas de baja (Postgres real)", () => {
  let prisma: PrismaClient;
  let tipoIdentificacionId: string;
  let estatusId: string;
  let provinciaId: string;
  let cantonId: string;
  const rolId: Partial<Record<RolValue, string>> = {};

  beforeAll(async () => {
    prisma = crearPrismaDeTest();

    const tipo = await prisma.tipoIdentificacion.findFirst({ select: { id: true } });
    if (!tipo) {
      throw new Error(
        "hay DATABASE_URL pero `tipo_identificacion` está vacía: sin FK no se puede sembrar el " +
          "corpus. Corré `pnpm run db:seed`. Este archivo NO debe pasar en verde así.",
      );
    }
    tipoIdentificacionId = tipo.id;

    for (const valor of ["mensajero", "adminTienda", "adminSatelite"] as const) {
      const rol = await prisma.rol.findFirst({ where: { value: valor }, select: { id: true } });
      if (!rol) {
        throw new Error(
          `hay DATABASE_URL pero falta el rol \`${valor}\` en el catálogo \`rol\`. Corré ` +
            "`pnpm run db:seed`: sin él no se puede sembrar el corpus.",
        );
      }
      rolId[valor] = rol.id;
    }

    const estatus = await prisma.orderStatus.findFirst({ select: { id: true } });
    const canton = await prisma.canton.findFirst({ select: { id: true, provinciaId: true } });
    if (!estatus || !canton) {
      throw new Error(
        "hay DATABASE_URL pero faltan `order_status` o `canton`: sin esas FK no se puede sembrar " +
          "la orden histórica, que es la mitad del test que protege el histórico.",
      );
    }
    estatusId = estatus.id;
    cantonId = canton.id;
    provinciaId = canton.provinciaId;
  });

  /**
   * Siembra el corpus y ejecuta `fn` con los repositorios REALES montados sobre `tx`.
   *
   * El corpus se acota por el SUFIJO en el nombre: todo lo que se afirma abajo se mide sobre las
   * filas cuyo nombre lo lleva, así que lo que ya haya en la base local no puede alterar el
   * resultado (ni en un sentido ni en el otro).
   */
  async function conCorpus<T>(
    fn: (ctx: {
      sembrado: Sembrado;
      userRepo: UserRepository;
      ordenRepo: OrdenRepository;
      cierresRepo: CierresAdminRepository;
    }) => Promise<T>,
  ): Promise<T> {
    return enTransaccionRevertida(prisma, async (tx) => {
      // PRIMERA sentencia: serializa contra los demás archivos que escriben en `public`.
      await serializarEscriturasReales(tx);

      const zonaConAdminActivo = (
        await tx.zona.create({
          data: { nombre: `Zona con admin en pie ${SUFIJO}` },
          select: { id: true },
        })
      ).id;
      const zonaConAdminDeBaja = (
        await tx.zona.create({
          data: { nombre: `Zona con admin de baja ${SUFIJO}` },
          select: { id: true },
        })
      ).id;

      const crear = async (
        clave: string,
        valorRol: RolValue,
        estado: EstadoUsuario,
        zonaId: string | null,
      ): Promise<string> => {
        const fila = await tx.usuario.create({
          data: {
            nombre: `${clave} ${estado} ${SUFIJO}`,
            email: `${clave}.${estado}.${SUFIJO}@ejemplo.test`,
            telefono: "88880000",
            passwordHash: `hash-de-mentira-${clave}-${estado}-${SUFIJO}`,
            estado,
            cedula: `${clave}-${estado}-${SUFIJO}`.slice(0, 40),
            tipoIdentificacionId,
            rolId: rolId[valorRol] as string,
            ...(zonaId !== null ? { zonaId } : {}),
          },
          select: { id: true },
        });
        return fila.id;
      };

      const tienda = {} as Record<EstadoUsuario, string>;
      const mensajero = {} as Record<EstadoUsuario, string>;
      for (const estado of ESTADOS) {
        tienda[estado] = await crear("tienda", "adminTienda", estado, null);
        mensajero[estado] = await crear("mensajero", "mensajero", estado, zonaConAdminActivo);
      }

      // Un adminSatelite EN PIE en una zona y otro DADO DE BAJA en la otra: es lo único que
      // distingue a las dos zonas, así que el catálogo de bodegas solo puede separarlas mirando
      // el estado del admin.
      await crear("admin-zona", "adminSatelite", "activo", zonaConAdminActivo);
      await crear("admin-zona", "adminSatelite", "inactivo", zonaConAdminDeBaja);

      // LA ORDEN HISTÓRICA: dueña dada de baja, mensajero dado de baja. Es la fila que un
      // arreglo mal hecho escondería.
      const ordenHistorica = (
        await tx.orden.create({
          data: {
            numRemision: `REM-${SUFIJO}`,
            estatusId,
            destinatario: `Destinatario ${SUFIJO}`,
            telefonoDest: "88881111",
            tiendaId: tienda.inactivo,
            zonaId: zonaConAdminActivo,
            provinciaId,
            cantonId,
            producto: `Producto ${SUFIJO}`,
            mensajeroAsignadoId: mensajero.inactivo,
          },
          select: { id: true },
        })
      ).id;

      return fn({
        sembrado: {
          tienda,
          mensajero,
          zonaConAdminActivo,
          zonaConAdminDeBaja,
          ordenHistorica,
        },
        userRepo: new UserRepository(tx),
        ordenRepo: new OrdenRepository(tx as unknown as PrismaClient),
        cierresRepo: new CierresAdminRepository(
          tx as unknown as PrismaClient,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
        ),
      });
    });
  }

  /** Los ids del corpus que aparecen en una lista de opciones, en el orden en que vienen. */
  function idsDelCorpus(
    opciones: readonly { id: string }[],
    delCorpus: Record<EstadoUsuario, string>,
  ): EstadoUsuario[] {
    const porId = new Map(Object.entries(delCorpus).map(([estado, id]) => [id, estado]));
    return opciones
      .map((o) => porId.get(o.id))
      .filter((e): e is EstadoUsuario => e !== undefined);
  }

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // T1 — el catálogo de TIENDAS de `/ordenes`
  // ───────────────────────────────────────────────────────────────────────────────────────────
  it("T1 — `listCuentasTienda` ofrece `activo` y `pendiente`, y NO `inactivo` ni `bloqueado`", async () => {
    const { presentes, sembrado, filas } = await conCorpus(async ({ userRepo, sembrado }) => {
      const filas = await userRepo.listCuentasTienda();
      return { presentes: idsDelCorpus(filas, sembrado.tienda), sembrado, filas };
    });

    // Se sembraron las CUATRO: si el corpus no llegara a la consulta, el test no afirmaría nada.
    expect(Object.keys(sembrado.tienda).sort()).toEqual([...ESTADOS].sort());
    expect([...presentes].sort()).toEqual(["activo", "pendiente"]);
    // Y ninguna de las dos dadas de baja se coló por otro camino.
    const ids = filas.map((f) => f.id);
    expect(ids).not.toContain(sembrado.tienda.inactivo);
    expect(ids).not.toContain(sembrado.tienda.bloqueado);
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // T2 — el catálogo de MENSAJEROS de `/ordenes`, sin zona y acotado a una zona
  // ───────────────────────────────────────────────────────────────────────────────────────────
  it("T2 — `listMensajerosParaFiltro` ofrece `activo` y `pendiente`, con y sin acotar por zona", async () => {
    const medido = await conCorpus(async ({ userRepo, sembrado }) => {
      const todos = await userRepo.listMensajerosParaFiltro();
      const deLaZona = await userRepo.listMensajerosParaFiltro(sembrado.zonaConAdminActivo);
      return {
        todos: idsDelCorpus(todos, sembrado.mensajero),
        deLaZona: idsDelCorpus(deLaZona, sembrado.mensajero),
        estadosDevueltos: [...new Set(deLaZona.map((m) => m.estado))],
      };
    });

    expect([...medido.todos].sort()).toEqual(["activo", "pendiente"]);
    // Acotar por zona no puede ampliar: los cuatro están en esa zona, y siguen saliendo dos.
    expect([...medido.deLaZona].sort()).toEqual(["activo", "pendiente"]);
    // Y el `estado` que viaja en el DTO ya no puede traer un no-asignable.
    for (const estado of medido.estadosDevueltos) {
      expect(ESTADOS_USUARIO_NO_ASIGNABLES).not.toContain(estado);
    }
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // T3 — el catálogo de BODEGAS de `/cierres-admin` (zonas por su admin de zona)
  // ───────────────────────────────────────────────────────────────────────────────────────────
  it("T3 — una zona cuyo único admin de zona está dado de baja deja de ofrecerse como bodega", async () => {
    const medido = await conCorpus(async ({ cierresRepo, sembrado }) => {
      const catalogo = await cierresRepo.findCatalogoFiltros({
        destinoTipo: "bodega_central",
        destinoZonaId: null,
      });
      return { zonas: catalogo.zonas.map((z) => z.id), sembrado };
    });

    // La contraprueba va PRIMERO: sin ella, «no aparece» podría significar «la consulta no
    // devuelve ninguna zona» y el caso pasaría sin vigilar nada.
    expect(medido.zonas).toContain(medido.sembrado.zonaConAdminActivo);
    expect(medido.zonas).not.toContain(medido.sembrado.zonaConAdminDeBaja);
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // T4 — EL HISTÓRICO. La orden de la tienda dada de baja SIGUE saliendo.
  // ───────────────────────────────────────────────────────────────────────────────────────────
  it("T4 — el listado de órdenes NO mira el estado del dueño ni del mensajero: la orden histórica sigue ahí", async () => {
    const medido = await conCorpus(async ({ ordenRepo, sembrado }) => {
      const listado = await ordenRepo.list({
        where: {},
        sortBy: "created_at",
        sortDir: "desc",
        skip: 0,
        take: TAKE_TODO,
      });
      return { ids: listado.items.map((o) => o.id), sembrado };
    });

    // La orden es de una tienda `inactivo` Y de un mensajero `inactivo`: si el filtro de estado
    // se hubiera colado en los DATOS, esta fila desaparecería.
    expect(medido.ids).toContain(medido.sembrado.ordenHistorica);
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // T5 — y SIGUE SIENDO FILTRABLE por esos mismos ids (el filtro no valida el estado)
  // ───────────────────────────────────────────────────────────────────────────────────────────
  it("T5 — filtrar por la tienda o el mensajero dados de baja sigue devolviendo su orden", async () => {
    const medido = await conCorpus(async ({ ordenRepo, sembrado }) => {
      const pedir = (where: Parameters<OrdenRepository["list"]>[0]["where"]) =>
        ordenRepo.list({
          where,
          sortBy: "created_at",
          sortDir: "desc",
          skip: 0,
          take: TAKE_TODO,
        });
      const porTienda = await pedir({ tiendaId: [sembrado.tienda.inactivo] });
      const porMensajero = await pedir({ mensajeroAsignadoId: [sembrado.mensajero.inactivo] });
      return {
        porTienda: porTienda.items.map((o) => o.id),
        porMensajero: porMensajero.items.map((o) => o.id),
        sembrado,
      };
    });

    // El desplegable ya no los ofrece, pero el id sigue siendo un filtro legítimo: quien llegue
    // por URL, por una descarga o por un enlace guardado obtiene sus órdenes.
    expect(medido.porTienda).toEqual([medido.sembrado.ordenHistorica]);
    expect(medido.porMensajero).toEqual([medido.sembrado.ordenHistorica]);
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // T6 — LA SEPARACIÓN: catálogo de filtro ≠ universo de la descarga
  // ───────────────────────────────────────────────────────────────────────────────────────────
  it("T6 — `mensajerosFiltro` deja fuera a los dados de baja y `mensajeros` los CONSERVA", async () => {
    const medido = await conCorpus(async ({ cierresRepo, sembrado }) => {
      const catalogo = await cierresRepo.findCatalogoFiltros({
        destinoTipo: "bodega_central",
        destinoZonaId: null,
      });
      return {
        universo: idsDelCorpus(catalogo.mensajeros, sembrado.mensajero),
        filtro: idsDelCorpus(catalogo.mensajerosFiltro, sembrado.mensajero),
      };
    });

    // `mensajeros` es el universo del histórico: alimenta la selección POR DEFECTO de la
    // descarga de gestiones, así que recortarlo borraría filas del archivo en silencio.
    expect([...medido.universo].sort()).toEqual([...ESTADOS].sort());
    // `mensajerosFiltro` es lo que el desplegable ofrece.
    expect([...medido.filtro].sort()).toEqual(["activo", "pendiente"]);
  });
});
