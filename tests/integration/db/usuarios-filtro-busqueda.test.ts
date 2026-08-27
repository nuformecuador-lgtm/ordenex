import { describe, it, expect, beforeAll } from "vitest";
import type { PrismaClient, RolValue } from "@prisma/client";

import { UserRepository } from "@/lib/repositories/UserRepository";
import type {
  ListUsuariosParams,
  ListUsuariosResult,
} from "@/lib/interfaces/repositories/IUserRepository";

import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
} from "./_postgres-real";

/**
 * FEATURE 285 (T3.1, design §9.1) — **EL `WHERE` DEL LISTADO DE USUARIOS, EJECUTADO CONTRA
 * POSTGRES.**
 *
 * ⚠️ POR QUE EXISTE ESTE ARCHIVO habiendo ya tests de servicio del mismo listado. Aquellos usan
 * dobles y **no ven el SQL**: con el `WHERE` mutado —sin la rama `email` del `OR`, sin
 * `mode: "insensitive"`, sin el escapado de comodines, con el `AND` cambiado por `OR`, o con el
 * `count` sin `where`— siguen TODOS en verde, porque el doble responde lo mismo se filtre como se
 * filtre. Este repo lo midio cuatro veces, y en la ficha 287 cinco mutaciones solo las mato
 * Postgres. R2, R4, R5, R13, R16, R17 y R19 **no se dan por cubiertos** con un doble.
 *
 * SIN `DATABASE_URL` se SALTA (`describe.skip`), que es la convencion del arnes y **se ve en la
 * salida**. CON base pero sin los catalogos que necesita, **revienta con mensaje**: un
 * `if (!datos) return;` reporta `passed` sin haber comprobado nada, y eso es peor que no tener el
 * test.
 *
 * TODO corre dentro de una transaccion que SIEMPRE se revierte: si el test pasa, si falla o si el
 * proceso muere a mitad, no queda ni una fila en la base compartida. `serializarEscriturasReales`
 * es la PRIMERA sentencia porque se escribe en `public."usuario"`, que es tabla REAL y compartida
 * con otros archivos de test que corren en paralelo.
 *
 * ── COMO SE ACOTA EL CORPUS, Y POR QUE ASI ────────────────────────────────────────────────────
 * `UserRepository.list` NO admite un filtro por `createdAt`, asi que el corpus no se puede acotar
 * "por marca de tiempo" desde fuera. Se acota por dos vias que SI pasan por el `WHERE` real:
 *   1. un **SUFIJO unico** por corrida, incrustado en el nombre y el correo de las 4 filas
 *      sembradas: buscarlo devuelve el corpus y nada mas (lo comprueba T-I0, que va PRIMERO —sin
 *      el, ningun conteo de abajo afirmaria nada);
 *   2. para lo que no lleva termino (el filtro de rol solo), un **conteo BASE tomado dentro de la
 *      misma transaccion antes de sembrar**, contra el que se afirma el DELTA exacto.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

/** Sufijo unico por corrida: `usuario.email` y `usuario.cedula` son UNIQUE. */
const SUFIJO = `f285${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const SUFIJO_MAYUS = SUFIJO.toUpperCase();

/** Cuantas filas se piden cuando se quiere "todo": el corpus mas el resto de la base. */
const TAKE_TODO = 2000;

/** Las claves EXACTAS de `UsuarioListItem`. Ni una mas (R27). */
const CLAVES_DE_FILA = ["createdAt", "email", "estado", "id", "nombre", "rolValue"];

interface Corpus {
  ana: string;
  beto: string;
  carla: string;
  dimas: string;
}

describeSiHayBase("285/T3.1 — filtro por rol y buscador contra Postgres real", () => {
  let prisma: PrismaClient;
  let tipoIdentificacionId: string;
  const rolId: Partial<Record<RolValue, string>> = {};

  beforeAll(async () => {
    prisma = crearPrismaDeTest();

    const tipo = await prisma.tipoIdentificacion.findFirst({ select: { id: true } });
    if (!tipo) {
      throw new Error(
        "hay DATABASE_URL pero `tipo_identificacion` esta vacia: sin FK no se puede sembrar el " +
          "corpus. Corre `pnpm run db:seed`. Este archivo NO debe pasar en verde asi.",
      );
    }
    tipoIdentificacionId = tipo.id;

    for (const valor of ["mensajero", "admin", "adminTienda"] as const) {
      const rol = await prisma.rol.findFirst({ where: { value: valor }, select: { id: true } });
      if (!rol) {
        throw new Error(
          `hay DATABASE_URL pero falta el rol \`${valor}\` en el catalogo \`rol\`. Corre ` +
            "`pnpm run db:seed`: sin el no se puede sembrar el corpus y este archivo NO debe " +
            "pasar en verde.",
        );
      }
      rolId[valor] = rol.id;
    }
  });

  /**
   * Siembra las 4 filas y ejecuta `fn` con el repositorio REAL montado sobre `tx`.
   * `base` son los conteos de la base ANTES de sembrar, tomados dentro de la misma transaccion.
   */
  async function conCorpus<T>(
    fn: (ctx: {
      corpus: Corpus;
      base: { total: number; mensajeros: number; admins: number };
      list: (params: Partial<ListUsuariosParams>) => Promise<ListUsuariosResult>;
    }) => Promise<T>,
  ): Promise<T> {
    return enTransaccionRevertida(prisma, async (tx) => {
      // PRIMERA sentencia: serializa contra los demas archivos que escriben en `public`.
      await serializarEscriturasReales(tx);

      const base = {
        total: await tx.usuario.count(),
        mensajeros: await tx.usuario.count({ where: { rol: { value: "mensajero" } } }),
        admins: await tx.usuario.count({ where: { rol: { value: "admin" } } }),
      };

      const crear = async (
        clave: string,
        nombre: string,
        email: string,
        valorRol: RolValue,
      ): Promise<string> => {
        const fila = await tx.usuario.create({
          data: {
            nombre,
            email,
            telefono: "88880000",
            passwordHash: `hash-de-mentira-${clave}-${SUFIJO}`,
            estado: "activo",
            cedula: `${clave}-${SUFIJO}`.slice(0, 40),
            tipoIdentificacionId,
            rolId: rolId[valorRol] as string,
          },
          select: { id: true },
        });
        return fila.id;
      };

      const corpus: Corpus = {
        // El SUFIJO va en el NOMBRE de las cuatro: buscarlo devuelve el corpus entero.
        ana: await crear("ana", `Ana Rojas ${SUFIJO}`, `ana.${SUFIJO}@ejemplo.test`, "mensajero"),
        beto: await crear("beto", `Beto Mora ${SUFIJO}`, `beto.${SUFIJO}@ejemplo.test`, "admin"),
        // El correo de carla va TODO en MAYUSCULAS y con un prefijo (`mayus.`) que NO aparece en
        // su nombre: es la unica forma de que un termino en minusculas solo pueda encontrarla
        // por el correo y solo si la comparacion es insensible (T-I2).
        carla: await crear(
          "carla",
          `Carla Sanz ${SUFIJO}`,
          `MAYUS.${SUFIJO_MAYUS}@EJEMPLO.TEST`,
          "mensajero",
        ),
        // dimas es el unico con dominio `@otra.test`: un termino con ese dominio solo puede
        // encontrarlo por el correo (T-I1, rama `email`).
        dimas: await crear(
          "dimas",
          `Dimas Vega ${SUFIJO}`,
          `dimas.${SUFIJO}@otra.test`,
          "adminTienda",
        ),
      };

      const repo = new UserRepository(tx);
      const list = (params: Partial<ListUsuariosParams>): Promise<ListUsuariosResult> =>
        repo.list({ skip: 0, take: TAKE_TODO, sortBy: "createdAt", sortDir: "desc", ...params });

      return fn({ corpus, base, list });
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // T-I0 — el acotamiento. VA PRIMERO: sin el, ningun conteo de abajo afirma nada.
  // ─────────────────────────────────────────────────────────────────────────────────────────
  it("T-I0 (R1) — sin filtros salen TODAS, y el SUFIJO acota EXACTAMENTE al corpus sembrado", async () => {
    const medido = await conCorpus(async ({ corpus, base, list }) => {
      const sinFiltro = await list({});
      const porSufijo = await list({ busqueda: SUFIJO });
      return { corpus, base, sinFiltro, porSufijo };
    });

    // La base cabe entera en una pagina: si no, los conteos de abajo no significarian lo que
    // dicen. Es una precondicion del test, y se dice en voz alta en vez de asumirse.
    expect(
      medido.base.total + 4,
      `la base local tiene ${medido.base.total} usuarios y no cabe en take=${TAKE_TODO}`,
    ).toBeLessThanOrEqual(TAKE_TODO);

    // R1: sin filtros, el listado devuelve lo de siempre MAS las 4 sembradas.
    expect(medido.sinFiltro.total).toBe(medido.base.total + 4);
    const idsSinFiltro = medido.sinFiltro.items.map((u) => u.id);
    for (const id of Object.values(medido.corpus)) expect(idsSinFiltro).toContain(id);

    // Y el acotamiento: el SUFIJO devuelve el corpus y NADA mas. Todo lo de abajo se apoya aqui.
    expect(medido.porSufijo.total).toBe(4);
    expect([...medido.porSufijo.items.map((u) => u.id)].sort()).toEqual(
      [...Object.values(medido.corpus)].sort(),
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // T-I1 — fragmento en cualquier posicion, sobre NOMBRE **o** CORREO (R2)
  // ─────────────────────────────────────────────────────────────────────────────────────────
  it("T-I1 (R2) — encuentra por NOMBRE y por CORREO, con el fragmento en medio", async () => {
    const medido = await conCorpus(async ({ corpus, list }) => ({
      corpus,
      // «Rojas <sufijo>» esta EN MEDIO del nombre de ana: `startsWith` no lo encontraria.
      porNombre: await list({ busqueda: `Rojas ${SUFIJO}` }),
      // «<sufijo>@otra» esta EN MEDIO del correo de dimas y NO aparece en ningun nombre: solo la
      // rama `email` del `OR` puede encontrarlo, y tampoco desde el principio de la cadena.
      porCorreo: await list({ busqueda: `${SUFIJO}@otra` }),
    }));

    // ⭑ Mata «cambiar `contains` por `startsWith`» y «quitar la rama `nombre` del OR».
    expect(medido.porNombre.total).toBe(1);
    expect(medido.porNombre.items.map((u) => u.id)).toEqual([medido.corpus.ana]);

    // ⭑ Mata «quitar la rama `email` del OR» (daria 0) y tambien `startsWith` (daria 0).
    expect(medido.porCorreo.total).toBe(1);
    expect(medido.porCorreo.items.map((u) => u.id)).toEqual([medido.corpus.dimas]);
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // T-I2 — sin distinguir mayusculas de minusculas (R4)
  // ─────────────────────────────────────────────────────────────────────────────────────────
  it("T-I2 (R4) — un termino en minusculas encuentra un correo escrito en MAYUSCULAS", async () => {
    const medido = await conCorpus(async ({ corpus, list }) => ({
      corpus,
      // El correo de carla es `MAYUS.<SUFIJO>@EJEMPLO.TEST`; se busca en minusculas. Su NOMBRE no
      // contiene «mayus.», asi que la unica via es el correo, y solo si la comparacion es ILIKE.
      enMinusculas: await list({ busqueda: `mayus.${SUFIJO}` }),
      // Contraprueba: el mismo termino en su caja original SI la encuentra pase lo que pase, de
      // modo que un 0 arriba signifique «no pliega la caja» y no «el corpus no esta».
      enSuCaja: await list({ busqueda: `MAYUS.${SUFIJO_MAYUS}` }),
    }));

    // ⭑ Mata «quitar `mode: "insensitive"`».
    expect(medido.enMinusculas.total).toBe(1);
    expect(medido.enMinusculas.items.map((u) => u.id)).toEqual([medido.corpus.carla]);

    expect(medido.enSuCaja.total).toBe(1);
    expect(medido.enSuCaja.items.map((u) => u.id)).toEqual([medido.corpus.carla]);
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // T-I3 — el filtro de rol Y el total que lo acompaña (R13, R14, R17)
  // ─────────────────────────────────────────────────────────────────────────────────────────
  it("T-I3 (R13/R17) — el rol recorta las filas Y el TOTAL cuenta solo lo filtrado", async () => {
    const medido = await conCorpus(async ({ corpus, base, list }) => ({
      corpus,
      base,
      soloMensajeros: await list({ roles: ["mensajero"] }),
      sinFiltroDeRol: await list({}),
    }));

    const ids = medido.soloMensajeros.items.map((u) => u.id);

    // ⭑ Mata «`count()` sin `where`»: sin el `where`, el total seria `base.total + 4`, que es
    //   estrictamente mayor que `base.mensajeros + 2` (los mensajeros son un subconjunto).
    expect(medido.soloMensajeros.total).toBe(medido.base.mensajeros + 2);
    expect(medido.soloMensajeros.total).toBeLessThan(medido.sinFiltroDeRol.total);
    // Y el total concuerda con lo que de verdad viene: no es un numero suelto.
    expect(medido.soloMensajeros.items).toHaveLength(medido.soloMensajeros.total);

    // ⭑ Mata «ignorar `roles`»: beto (admin) y dimas (adminTienda) NO pueden aparecer.
    expect(ids).toContain(medido.corpus.ana);
    expect(ids).toContain(medido.corpus.carla);
    expect(ids).not.toContain(medido.corpus.beto);
    expect(ids).not.toContain(medido.corpus.dimas);
    for (const fila of medido.soloMensajeros.items) expect(fila.rolValue).toBe("mensajero");
  });

  it("T-I3b (R12/R13) — la seleccion MULTIPLE devuelve la union de los roles marcados", async () => {
    const medido = await conCorpus(async ({ corpus, base, list }) => ({
      corpus,
      base,
      dosRoles: await list({ roles: ["admin", "adminTienda"] }),
      // Acotado al corpus con el sufijo, para poder afirmar el conjunto exacto.
      dosRolesEnCorpus: await list({ roles: ["admin", "adminTienda"], busqueda: SUFIJO }),
    }));

    expect([...medido.dosRolesEnCorpus.items.map((u) => u.id)].sort()).toEqual(
      [medido.corpus.beto, medido.corpus.dimas].sort(),
    );
    expect(medido.dosRolesEnCorpus.total).toBe(2);
    // Contraprueba de que `in` es una union real y no "el primero de la lista".
    expect(medido.dosRoles.total).toBeGreaterThanOrEqual(2);
    for (const fila of medido.dosRoles.items) {
      expect(["admin", "adminTienda"]).toContain(fila.rolValue);
    }
  });

  it("T-I3c (R14) — sin roles seleccionados, el listado NO se recorta por rol", async () => {
    const medido = await conCorpus(async ({ corpus, list }) => ({
      corpus,
      sinRoles: await list({ busqueda: SUFIJO }),
    }));

    // Las cuatro, con sus cuatro roles distintos representados.
    expect(medido.sinRoles.total).toBe(4);
    expect([...new Set(medido.sinRoles.items.map((u) => u.rolValue))].sort()).toEqual(
      ["admin", "adminTienda", "mensajero"].sort(),
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // T-I4 — los comodines del termino son TEXTO LITERAL (R5)
  // ─────────────────────────────────────────────────────────────────────────────────────────
  it("T-I4 (R5) — `%` y `_` en el termino se buscan como caracteres, no como comodines", async () => {
    const medido = await conCorpus(async ({ list }) => ({
      // Control POSITIVO: el nombre entero de ana SI la encuentra. Sin esto, los ceros de abajo
      // podrian significar «la consulta no encuentra nada» en vez de «el comodin es literal».
      control: await list({ busqueda: `Ana Rojas ${SUFIJO}` }),
      // Sin escapar, `%` casaria con « Rojas » y devolveria a ana.
      conPorcentaje: await list({ busqueda: `Ana%${SUFIJO}` }),
      // Sin escapar, `_` casaria con el espacio y devolveria a ana.
      conGuionBajo: await list({ busqueda: `Ana_Rojas ${SUFIJO}` }),
      // Sin escapar, `<sufijo>%` es «todo lo que contenga el sufijo» = las 4 sembradas.
      sufijoConPorcentaje: await list({ busqueda: `${SUFIJO}%` }),
    }));

    expect(medido.control.total).toBe(1);

    // ⭑ Los tres matan «quitar el escapado de comodines».
    expect(medido.conPorcentaje.total).toBe(0);
    expect(medido.conPorcentaje.items).toEqual([]);
    expect(medido.conGuionBajo.total).toBe(0);
    expect(medido.sufijoConPorcentaje.total).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // T-I5 — termino Y roles a la vez: se cumplen AMBAS condiciones (R16)
  // ─────────────────────────────────────────────────────────────────────────────────────────
  it("T-I5 (R16) — con termino y rol a la vez manda la INTERSECCION, no la union", async () => {
    const medido = await conCorpus(async ({ corpus, list }) => ({
      corpus,
      // El sufijo casa con las 4; el rol `admin` solo con beto. La interseccion es {beto}.
      ambos: await list({ busqueda: SUFIJO, roles: ["admin"] }),
      soloTermino: await list({ busqueda: SUFIJO }),
    }));

    // ⭑ Mata «cambiar el AND implicito por un OR»: con un `OR`, entrarian las 4 del sufijo (mas
    //   cualquier admin de la base), nunca 1.
    expect(medido.ambos.total).toBe(1);
    expect(medido.ambos.items.map((u) => u.id)).toEqual([medido.corpus.beto]);
    // ana casa con el termino pero NO con el rol: no puede colarse.
    expect(medido.ambos.items.map((u) => u.id)).not.toContain(medido.corpus.ana);
    // Y el termino por si solo si trae las 4: la resta la hace el rol, no un termino roto.
    expect(medido.soloTermino.total).toBe(4);
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // T-I6 — el filtro no altera el criterio de orden (R19)
  // ─────────────────────────────────────────────────────────────────────────────────────────
  it("T-I6 (R19) — el listado filtrado conserva columna y sentido de orden, tambien paginado", async () => {
    const medido = await conCorpus(async ({ list }) => ({
      ascTodo: await list({ busqueda: SUFIJO, sortBy: "nombre", sortDir: "asc", take: 4 }),
      ascPrimera: await list({ busqueda: SUFIJO, sortBy: "nombre", sortDir: "asc", take: 1 }),
      descPrimera: await list({ busqueda: SUFIJO, sortBy: "nombre", sortDir: "desc", take: 1 }),
      ascSegundaPagina: await list({
        busqueda: SUFIJO,
        sortBy: "nombre",
        sortDir: "asc",
        skip: 1,
        take: 1,
      }),
    }));

    expect(medido.ascTodo.items.map((u) => u.nombre)).toEqual([
      `Ana Rojas ${SUFIJO}`,
      `Beto Mora ${SUFIJO}`,
      `Carla Sanz ${SUFIJO}`,
      `Dimas Vega ${SUFIJO}`,
    ]);

    // ⭑ Mata «perder el `orderBy` al anadir el `where`»: sin orden, `desc` y `asc` devolverian
    //   la misma primera fila.
    expect(medido.ascPrimera.items.map((u) => u.nombre)).toEqual([`Ana Rojas ${SUFIJO}`]);
    expect(medido.descPrimera.items.map((u) => u.nombre)).toEqual([`Dimas Vega ${SUFIJO}`]);
    expect(medido.ascSegundaPagina.items.map((u) => u.nombre)).toEqual([`Beto Mora ${SUFIJO}`]);

    // El total no depende de la pagina: es el del conjunto filtrado (R17).
    for (const r of [medido.ascPrimera, medido.descPrimera, medido.ascSegundaPagina]) {
      expect(r.total).toBe(4);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // T-I7 — la busqueda se resuelve sobre TODOS los usuarios, no sobre la pagina visible (R3)
  // ─────────────────────────────────────────────────────────────────────────────────────────
  it("T-I7 (R3) — encuentra a quien SIN filtrar no cabria en la pagina que se esta viendo", async () => {
    const medido = await conCorpus(async ({ corpus, list }) => ({
      corpus,
      // Pagina 1 de UNA fila, por nombre ascendente y SIN filtro. `Dimas Vega <sufijo>` no puede
      // estar ahi: dentro del corpus le preceden Ana, Beto y Carla, y fuera de el cualquier
      // nombre que empiece por A-C. Es decir: sin filtrar, dimas esta "en otra pagina".
      paginaSinFiltro: await list({ sortBy: "nombre", sortDir: "asc", take: 1 }),
      // La MISMA pagina de una fila, ahora con el termino: dimas aparece.
      paginaConFiltro: await list({
        busqueda: `${SUFIJO}@otra`,
        sortBy: "nombre",
        sortDir: "asc",
        take: 1,
      }),
    }));

    // ⭑ Si la busqueda se resolviera sobre la pagina ya recortada, este id seria inalcanzable:
    //   el usuario leeria "no existe" de alguien que existe.
    expect(medido.paginaSinFiltro.items.map((u) => u.id)).not.toContain(medido.corpus.dimas);
    expect(medido.paginaConFiltro.items.map((u) => u.id)).toEqual([medido.corpus.dimas]);
    expect(medido.paginaConFiltro.total).toBe(1);
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // T-S4-int — la proyeccion por fila no crece con el filtro (R27)
  // ─────────────────────────────────────────────────────────────────────────────────────────
  it("T-S4-int (R27) — la fila filtrada trae EXACTAMENTE las claves de UsuarioListItem", async () => {
    const medido = await conCorpus(async ({ list }) => ({
      conFiltro: await list({ busqueda: SUFIJO, roles: ["mensajero"] }),
      sinFiltro: await list({ busqueda: SUFIJO }),
    }));

    // ⭑ Mata «ampliar `LIST_SELECT`»: cualquier columna de mas aparece aqui. Un test de servicio
    //   con dobles NO puede matar esta mutacion — la proyeccion la decide la consulta real.
    expect(medido.conFiltro.items.length).toBeGreaterThan(0);
    for (const fila of medido.conFiltro.items) {
      expect(Object.keys(fila).sort()).toEqual(CLAVES_DE_FILA);
      expect(fila).not.toHaveProperty("passwordHash");
      expect(fila).not.toHaveProperty("cedula");
      expect(fila).not.toHaveProperty("telefono");
    }
    for (const fila of medido.sinFiltro.items) {
      expect(Object.keys(fila).sort()).toEqual(CLAVES_DE_FILA);
    }
  });
});
