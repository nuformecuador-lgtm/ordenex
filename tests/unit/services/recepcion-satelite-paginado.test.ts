import { describe, it, expect, vi } from "vitest";
import { RecepcionSateliteService } from "@/lib/services/RecepcionSateliteService";
import type {
  IOrdenRepository,
  RecepcionSateliteFiltro,
  RecepcionSateliteRow,
} from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { RecepcionSateliteDTO } from "@/lib/interfaces/services/IRecepcionSateliteService";
import type { IOrdenHistorialService } from "@/lib/interfaces/services/IOrdenHistorialService";
import { ESTADOS_BODEGA_SATELITE } from "@/lib/utils/estados-bodega-satelite";
import { normalizeName } from "@/lib/utils/normalize";
import type { RangoPagina } from "@/lib/utils/rango-pagina";
import { listarOrdenesBodegaPaginadoSchema } from "@/lib/types/recepcion-satelite";
import { CAMPOS_BASE_ORDEN } from "@/tests/fixtures/fila-bodega-satelite";

// Feature 170 — FASE 2, T K.1 (R40/R41/R44/R45/R51) — «Órdenes de la bodega» de la bodega
// satelite: los TRES filtros pasan al servidor y el listado pagina.
//
// Esta es la pantalla de RIESGO ALTO de la fase, y el riesgo no es que se caiga: es que siga
// funcionando y mienta. Hoy el navegador recibe el conjunto entero de la zona y cruza
// estado ∧ canton ∧ distrito con `Array.filter`. Si se pagina sin mudar ese cruce, el filtro
// pasa a operar sobre 25 filas: el operador cree que esta filtrando su bodega y esta
// filtrando la pagina. No hay error, no hay log, no hay forma de notarlo desde dentro.
//
// Por eso el test central de este archivo NO es «el filtro devuelve algo razonable», sino
// «para los MISMOS valores devuelve el MISMO conjunto que el filtro de cliente», comprobado
// sobre las 64 combinaciones de los tres desplegables (R45). El filtro de cliente se copia
// aqui LITERALMENTE de `SateliteOrdenesListado.tsx` (`visibles`, :129-154) para que la
// comparacion sea contra lo que la pantalla hace HOY y no contra lo que uno recuerda.
//
// AVISO heredado de las tandas I y J, y vigente aqui: este archivo usa un DOBLE de
// repositorio y NO ve la traduccion a SQL. El `WHERE`, el `ORDER BY` y el conteo de esta
// misma pagina se afirman en `tests/unit/repositories/satelite-paginado-where.test.ts`.

const SAT_A: Actor = { usuarioId: "u-sat-a", rol: "adminSatelite" };
const SAT_B: Actor = { usuarioId: "u-sat-b", rol: "adminSatelite" };
const SAT_SIN_ZONA: Actor = { usuarioId: "u-sat-sin", rol: "adminSatelite" };

const ZONA_POR_USUARIO: Record<string, string | null> = {
  "u-sat-a": "z-a",
  "u-sat-b": "z-b",
  "u-sat-sin": null,
};

/** Contraprueba por el lado del rechazo: el modulo satelite es de UN solo rol (R3/R17). */
const ROLES_SIN_ACCESO: Actor[] = [
  { usuarioId: "u-maestro", rol: "maestro" },
  { usuarioId: "u-admin", rol: "admin" },
  { usuarioId: "t1", rol: "adminTienda" },
  { usuarioId: "g1", rol: "mensajero" },
  { usuarioId: "k1", rol: "apiKey" },
  { usuarioId: "x1", rol: "otroRolInventado" as Actor["rol"] },
];

interface FilaAlmacen {
  row: RecepcionSateliteRow;
  zonaId: string;
  /** El repositorio ordena por `created_at` pero NO lo proyecta: vive solo en el almacen. */
  createdAt: string;
  /**
   * FICHA 357 — «esta orden paso por una bodega satelite». En produccion se lee del historial
   * (`orden_historial_estado` con destino `en_ruta_bodega_satelite` / `en_bodega_satelite`) y el
   * repositorio lo emite SIEMPRE en el `WHERE`, sin parametro que lo apague; aqui es un hecho de
   * la fila. Es la mitad NUEVA del alcance, y sin ella este almacen no podria representar la
   * cara (B) del defecto: una orden de la zona que nunca estuvo en la bodega.
   */
  pasoPorBodegaSatelite: boolean;
}

function fila(
  id: string,
  zonaId: string,
  estatusValue: string,
  canton: string,
  distrito: string | null,
  dia: number,
  prioridad = false,
  pasoPorBodegaSatelite = true,
): FilaAlmacen {
  return {
    zonaId,
    pasoPorBodegaSatelite,
    createdAt: `2026-03-${String(dia).padStart(2, "0")}T00:00:00.000Z`,
    row: {
      // FICHA 349: los escalares de `OrdenDTO` que la fila comparte con `/ordenes`, en un solo sitio.
      ...CAMPOS_BASE_ORDEN,
      id,
      numGuia: 1000 + dia,
      numRemision: `REM-${id}`,
      estatusValue,
      destinatario: `Destinatario ${id}`,
      telefonoDest: "88880000",
      direccion: "100 metros al sur",
      producto: "Caja",
      montoCobrar: 1000,
      tiendaNombre: "Tienda",
      zonaNombre: `Zona ${zonaId}`,
      provinciaNombre: canton === "Cartago" ? "Cartago" : canton === "Barva" ? "Heredia" : "San José",
      cantonNombre: canton,
      distritoNombre: distrito,
      prioridad,
      // Feature 262 (B8): el dia de reparto por orden, ya serializado. `null` aqui: este archivo
      // mide filtros y paginacion, no el dia. Ninguna asercion cambia.
      fechaRepartoISO: null,
    },
  };
}

/**
 * El almacen. Tres cosas estan puestas a proposito y sin ellas el archivo probaria menos:
 *
 *  - **«Escazú» existe en las DOS zonas** (a-01… y b-01): el filtro de canton es por NOMBRE,
 *    asi que si el acotamiento por zona se perdiera, filtrar por «Escazú» seria la forma mas
 *    facil de ver la bodega del vecino.
 *  - **«San Rafael» existe en DOS cantones** de la misma zona (Escazú y Barva): el filtro de
 *    distrito compara solo el nombre, tambien hoy en el cliente.
 *  - **hay ordenes SIN distrito** (a-05, a-10, a-12).
 *  - **hay ordenes que ninguna combinacion de filtros puede hacer aparecer, y desde la ficha
 *    357 por DOS motivos distintos**, que es justo lo que el defecto confundia: a-13 esta en un
 *    estado que este listado no muestra («Por recibir» tiene pantalla propia) aunque SI paso por
 *    la bodega; a-14 esta en un estado que el listado SI muestra (`entregada`) pero NUNCA paso
 *    por una bodega satelite. a-15 es el espejo de a-14 —`entregada` que SI paso—, sin el cual
 *    «a-14 no sale» estaria verde por la razon equivocada.
 */
const ALMACEN: FilaAlmacen[] = [
  fila("a-01", "z-a", "en_bodega_satelite", "Escazú", "San Rafael", 1),
  fila("a-02", "z-a", "en_bodega_satelite", "Escazú", "San Antonio", 2, true),
  fila("a-03", "z-a", "en_bodega_satelite", "Barva", "San Rafael", 3),
  fila("a-04", "z-a", "por_recoger", "Escazú", "San Rafael", 4),
  fila("a-05", "z-a", "por_recoger", "San José", null, 5),
  fila("a-06", "z-a", "por_devolver", "Barva", "San Pedro", 6),
  fila("a-07", "z-a", "por_devolver", "Escazú", "San Antonio", 7),
  fila("a-08", "z-a", "devolviendo_a_bodega_central", "Barva", "San Rafael", 8),
  fila("a-09", "z-a", "devuelta", "Escazú", "San Rafael", 9, true),
  fila("a-10", "z-a", "devuelta", "San José", null, 10),
  fila("a-11", "z-a", "devuelta", "Barva", "San Pedro", 11),
  fila("a-12", "z-a", "en_bodega_satelite", "San José", null, 12),
  // Fuera del listado por el ESTADO: «Por recibir» tiene su propia seccion.
  fila("a-13", "z-a", "en_ruta_bodega_satelite", "Escazú", "San Rafael", 13),
  // Fuera del listado por el ALCANCE (ficha 357): `entregada` de la zona que NUNCA paso por una
  // bodega satelite. Es la cara (B) medida en produccion.
  fila("a-14", "z-a", "entregada", "Escazú", "San Rafael", 14, false, false),
  // Dentro (ficha 357, cara A): `entregada` que SI paso por la bodega. Hasta hoy era invisible.
  fila("a-15", "z-a", "entregada", "Escazú", "San Rafael", 15),
  fila("b-01", "z-b", "en_bodega_satelite", "Escazú", "San Rafael", 20),
  fila("b-02", "z-b", "devuelta", "Cartago", "Occidental", 21),
  fila("b-03", "z-b", "por_recoger", "Cartago", "Occidental", 22),
];

/** El orden del listado SIN paginar: prioridad primero, luego recencia (feature 33/R7). */
function porPrioridadYRecencia(a: FilaAlmacen, b: FilaAlmacen): number {
  if (a.row.prioridad !== b.row.prioridad) return a.row.prioridad ? -1 : 1;
  return b.createdAt.localeCompare(a.createdAt);
}

/**
 * Doble del repositorio. Aplica la semantica de la BASE, no la del filtro de cliente:
 * igualdad EXACTA de nombre (`IN (...)`), `NULL IN (...)` que no casa (el `LEFT JOIN` de
 * distrito) y rango de grupo por `array_position`. Si implementara `normalizeName` como el
 * cliente, la comparacion de R45 seria el codigo comparandose consigo mismo.
 */
function repoEnMemoria(filas: FilaAlmacen[] = ALMACEN) {
  const llamadas: string[] = [];

  const findUsuarioZonaId = vi.fn(async (usuarioId: string) => {
    llamadas.push("findUsuarioZonaId");
    return ZONA_POR_USUARIO[usuarioId] ?? null;
  });

  const findRecepcionSateliteByZona = vi.fn(async (zonaId: string, estatusValues: string[]) => {
    llamadas.push("findRecepcionSateliteByZona");
    if (estatusValues.length === 0) return [];
    return filas
      .filter((f) => f.zonaId === zonaId && estatusValues.includes(f.row.estatusValue))
      .sort(porPrioridadYRecencia)
      .map((f) => f.row);
  });

  const findRecepcionSatelitePaginada = vi.fn(
    async (filtro: RecepcionSateliteFiltro, rango: RangoPagina) => {
      llamadas.push("findRecepcionSatelitePaginada");
      const estados = [...filtro.estatusValues];
      if (estados.length === 0) return { items: [], total: 0 };
      // Pedido humano (2026-08-19): la geografía viaja por ID. Este doble describe sus filas
      // por nombre y usa el nombre como id, igual que `catalogoSatelite`.
      const cantones = [...(filtro.cantonIds ?? [])];
      const distritos = [...(filtro.distritoIds ?? [])];
      const conjunto = filas
        .filter((f) => f.zonaId === filtro.zonaId)
        // FICHA 357 — la otra mitad del acotamiento, que el repositorio real emite SIEMPRE.
        .filter((f) => f.pasoPorBodegaSatelite)
        .filter((f) => estados.includes(f.row.estatusValue))
        .filter((f) => cantones.length === 0 || cantones.includes(f.row.cantonNombre))
        .filter(
          (f) =>
            distritos.length === 0 ||
            (f.row.distritoNombre !== null && distritos.includes(f.row.distritoNombre)),
        )
        .sort((a, b) => {
          const grupo =
            ESTADOS_BODEGA_SATELITE.indexOf(a.row.estatusValue as never) -
            ESTADOS_BODEGA_SATELITE.indexOf(b.row.estatusValue as never);
          if (grupo !== 0) return grupo;
          const dentro = porPrioridadYRecencia(a, b);
          return dentro !== 0 ? dentro : a.row.id.localeCompare(b.row.id);
        });
      return {
        items: conjunto.slice(rango.skip, rango.skip + rango.take).map((f) => f.row),
        total: conjunto.length,
      };
    },
  );

  const repo = {
    findUsuarioZonaId,
    findRecepcionSateliteByZona,
    findRecepcionSatelitePaginada,
  } as unknown as IOrdenRepository;

  return { repo, llamadas, findRecepcionSatelitePaginada };
}

/**
 * Los intentos se derivan POR ID y no por posicion en el lote: si dependieran de la posicion,
 * la misma orden traeria un numero distinto segun la pagina en la que cayera, y el test no
 * podria comparar el DTO paginado con el del listado sin paginar. Las de sufijo IMPAR se
 * omiten del mapa a proposito: ese es el caso de `?? 0` (feature 160/R14).
 */
function servicio(repo: IOrdenRepository, lotes?: string[][], ahora?: Date) {
  const historial = {
    contarIntentosEnLote: vi.fn(async (ids: string[]) => {
      lotes?.push([...ids]);
      const pares = ids
        .map((id) => [id, Number(id.slice(-2))] as const)
        .filter(([, n]) => n % 2 === 0);
      return new Map(pares);
    }),
  } as unknown as Pick<IOrdenHistorialService, "contarIntentosEnLote">;
  // El reloj se inyecta para poder fijar el rango del atajo de antiguedad («ultimos 7 dias»
  // se mide desde AHORA); sin `ahora` el servicio usa el del sistema, como en produccion.
  return ahora
    ? new RecepcionSateliteService(repo, historial, () => ahora)
    : new RecepcionSateliteService(repo, historial);
}

function input(extra: Record<string, unknown> = {}) {
  return listarOrdenesBodegaPaginadoSchema.parse(extra);
}

function ids(items: ReadonlyArray<{ id: string }>): string[] {
  return items.map((i) => i.id);
}

/**
 * EL FILTRO DE CLIENTE DE HOY, copiado literalmente de
 * `app/(app)/recepcion-satelite/_components/SateliteOrdenesListado.tsx` (`visibles`, :129-154).
 *
 * Se copia y no se importa porque vive dentro de un `useMemo` de un componente: no hay nada
 * que importar. Es la referencia contra la que se mide el filtro de servidor (R45); si algun
 * dia el componente cambia, este bloque tiene que cambiar con el o el test deja de significar
 * lo que dice.
 */
function filtroDeCliente(
  ordenes: RecepcionSateliteDTO[],
  seleccion: { estado?: string[]; canton?: string[]; distrito?: string[] },
): RecepcionSateliteDTO[] {
  const estadosElegidos = seleccion.estado ?? [];
  const cantonesElegidos = seleccion.canton ?? [];
  const distritosElegidos = seleccion.distrito ?? [];
  const cantones = new Set(cantonesElegidos.map(normalizeName));
  const distritos = new Set(distritosElegidos.map(normalizeName));
  return ordenes.filter((orden) => {
    if (estadosElegidos.length > 0 && !estadosElegidos.includes(orden.estatusValue)) {
      return false;
    }
    if (cantones.size > 0 && !cantones.has(normalizeName(orden.cantonNombre))) {
      return false;
    }
    if (distritos.size > 0) {
      if (orden.distritoNombre === null) return false;
      if (!distritos.has(normalizeName(orden.distritoNombre))) return false;
    }
    return true;
  });
}

/**
 * El conjunto ENTERO del listado, sin recorte de pagina y sin filtros: la referencia contra la
 * que se miden el filtro (R45) y la estabilidad de la paginacion (R51).
 *
 * FICHA 357 — ANTES ESTO ERA `listar()`, y ya no puede serlo. Aquella funcion devuelve los CINCO
 * grupos de la pantalla vieja (`recibidas`, `asignadas`, `porDevolver`, `enTransitoACentral`,
 * `devueltas`), que era exactamente el alcance que la ficha corrige: ni trae los desenlaces de
 * las ordenes de la bodega (cara A) ni sabe distinguir una orden que paso por la bodega de una
 * que solo comparte zona (cara B). Seguir usandola como referencia dejaria estos tests
 * afirmando el criterio VIEJO con otro nombre, en verde y sin decirlo.
 *
 * Lo que se mide con esto sigue siendo lo mismo: que filtrar en el servidor de un conjunto da lo
 * mismo que filtrar ese conjunto, y que pasar paginas no reordena ni pierde filas. El CONTENIDO
 * del conjunto no se afirma aqui —para eso estan las listas absolutas de cada caso y, sobre
 * todo, `tests/integration/db/satelite-alcance-por-bodega-real.test.ts`, que lo mide contra
 * Postgres—.
 */
async function conjuntoSinPaginar(
  svc: RecepcionSateliteService,
  actor: Actor,
): Promise<RecepcionSateliteDTO[]> {
  const r = await svc.listarOrdenesBodegaPaginado(input({ page: 1, pageSize: 100 }), actor);
  if (r.status !== "ok") throw new Error(`listado devolvio ${r.status}`);
  // Anti-vacuidad: si el conjunto cupiera justo en la pagina, la referencia estaria truncada y
  // las comparaciones de abajo compararian dos recortes.
  if (r.items.length !== r.total) throw new Error("la referencia no cabe en una pagina");
  return r.items;
}

/** Recorre TODAS las paginas y devuelve los ids en el orden en que el servidor los entrega. */
async function recorrerPaginas(
  svc: RecepcionSateliteService,
  actor: Actor,
  filtros: Record<string, unknown> = {},
  pageSize = 2,
): Promise<{ recorrido: string[]; total: number }> {
  const recorrido: string[] = [];
  let total = -1;
  for (let page = 1; page <= 50; page += 1) {
    const p = await svc.listarOrdenesBodegaPaginado(input({ ...filtros, page, pageSize }), actor);
    if (p.status !== "ok") throw new Error(`pagina ${page} devolvio ${p.status}`);
    total = p.total;
    if (p.items.length === 0) break;
    recorrido.push(...ids(p.items));
  }
  return { recorrido, total };
}

describe("RecepcionSateliteService.listarOrdenesBodegaPaginado", () => {
  it("para los mismos valores de filtro devuelve el mismo conjunto que el filtro de cliente (R45)", async () => {
    // Las 64 combinaciones de los tres desplegables. No es un caso feliz: son todos los casos
    // que la barra de filtros puede producir sobre este almacen, incluidos los que no
    // devuelven nada y los que cruzan un canton con un distrito que no le pertenece.
    const seleccionesEstado = [
      [],
      ["en_bodega_satelite"],
      ["devuelta"],
      // FICHA 357: un DESENLACE entre las selecciones. Sin el, las 64 combinaciones seguirian
      // recorriendo solo los estados del listado viejo y el filtro nuevo quedaria sin ejercer.
      ["entregada"],
      ["en_bodega_satelite", "por_recoger", "devuelta"],
    ];
    const seleccionesCanton = [[], ["Escazú"], ["Barva"], ["Escazú", "San José"]];
    const seleccionesDistrito = [[], ["San Rafael"], ["San Antonio"], ["San Rafael", "San Pedro"]];

    let combinaciones = 0;
    let conFilas = 0;
    for (const estado of seleccionesEstado) {
      for (const canton of seleccionesCanton) {
        for (const distrito of seleccionesDistrito) {
          const svc = servicio(repoEnMemoria().repo);
          const etiqueta = `estado=${JSON.stringify(estado)} canton=${JSON.stringify(
            canton,
          )} distrito=${JSON.stringify(distrito)}`;

          const enCliente = filtroDeCliente(await conjuntoSinPaginar(svc, SAT_A), {
            estado,
            canton,
            distrito,
          });
          // Una lista VACIA se OMITE, no viaja como `[]`: desde que la barra es la de
          // `/ordenes`, su borde comparte la regla R32 —lista vacia = `validation_error`—
          // porque «sin filtro» se expresa quitando la clave. Es lo que hace la barra.
          const { recorrido, total } = await recorrerPaginas(svc, SAT_A, {
            ...(estado.length > 0 ? { estados: estado } : {}),
            ...(canton.length > 0 ? { canton_id: canton } : {}),
            ...(distrito.length > 0 ? { distrito_id: distrito } : {}),
          });

          // El MISMO conjunto y en el MISMO orden, no solo los mismos elementos.
          expect(recorrido, etiqueta).toEqual(ids(enCliente));
          // Y el total del servidor es el tamaño de ese conjunto, no el de la pagina (R41).
          expect(total, etiqueta).toBe(enCliente.length);

          combinaciones += 1;
          if (recorrido.length > 0) conFilas += 1;
        }
      }
    }

    // Anti-vacuidad: 64 combinaciones comprobadas y la GRAN MAYORIA con filas. Si el filtro
    // de servidor devolviera siempre vacio, el bucle pasaria entero comparando [] con [].
    expect(combinaciones).toBe(80);
    expect(conFilas).toBeGreaterThanOrEqual(45);
  });

  it("el filtro no amplía el alcance de zona del actor (R44)", async () => {
    const svc = servicio(repoEnMemoria().repo);

    // «Escazú» existe en las dos zonas. Cada actor ve LO SUYO bajo el mismo valor de filtro.
    const escazuDeA = await recorrerPaginas(svc, SAT_A, { canton_id: ["Escazú"] }, 50);
    const escazuDeB = await recorrerPaginas(svc, SAT_B, { canton_id: ["Escazú"] }, 50);

    // FICHA 357: a-15 (`entregada` de Escazu que SI paso por la bodega) entra; a-14, que es su
    // gemela salvo por no haber pasado nunca, NO — y las dos comparten zona, canton y distrito,
    // asi que lo unico que puede separarlas es el criterio nuevo.
    expect(escazuDeA.recorrido).toEqual(["a-02", "a-01", "a-04", "a-15", "a-07", "a-09"]);
    expect(escazuDeA.recorrido).not.toContain("a-14");
    expect(escazuDeA.recorrido.some((id) => id.startsWith("b-"))).toBe(false);
    // CONTRAPRUEBA: el vecino SI ve la suya con ese mismo valor. Sin esto, un servicio que
    // devolviera vacio ante cualquier canton pasaria la primera mitad.
    expect(escazuDeB.recorrido).toEqual(["b-01"]);
    expect(escazuDeB.recorrido.some((id) => id.startsWith("a-"))).toBe(false);

    // Un canton que solo existe en la zona del vecino no abre ninguna puerta.
    const cartagoDeA = await recorrerPaginas(svc, SAT_A, { canton_id: ["Cartago"] }, 50);
    expect(cartagoDeA.recorrido).toEqual([]);
    expect(cartagoDeA.total).toBe(0);
    const cartagoDeB = await recorrerPaginas(svc, SAT_B, { canton_id: ["Cartago"] }, 50);
    expect(cartagoDeB.recorrido).toEqual(["b-03", "b-02"]);
  });

  it("el filtro de estado no saca del listado las órdenes que nunca estuvieron en él (R44)", async () => {
    const { repo } = repoEnMemoria();
    const svc = servicio(repo);

    // FICHA 357 — LAS DOS EXCLUSIONES SON DE NATURALEZA DISTINTA, y por eso se afirman por
    // separado: a-13 queda fuera por el ESTADO (`en_ruta_bodega_satelite` tiene pantalla propia)
    // y a-14 por el ALCANCE (`entregada` SI se lista, pero esa orden nunca paso por la bodega).
    // a-15 es el control: misma zona, mismo estado y mismo distrito que a-14, y SI entra.
    const todo = await recorrerPaginas(svc, SAT_A, {}, 50);
    expect(todo.recorrido).not.toContain("a-13");
    expect(todo.recorrido).not.toContain("a-14");
    expect(todo.recorrido).toContain("a-15");

    // Pedido explicitamente, y saltandose el schema del borde a proposito: la lista blanca del
    // servicio tiene que sostenerse sola, no solo detras de zod.
    const inventado = await svc.listarOrdenesBodegaPaginado(
      { page: 1, pageSize: 50, estados: ["en_bodega_central"] },
      SAT_A,
    );
    if (inventado.status !== "ok") throw new Error("no ok");
    // Ni las de la central NI —lo que seria peor— «todas», por caer al caso «sin seleccion».
    expect(inventado.items).toEqual([]);
    expect(inventado.total).toBe(0);

    // Mezclado con uno valido, se queda solo con el valido.
    const mezcla = await svc.listarOrdenesBodegaPaginado(
      { page: 1, pageSize: 50, estados: ["en_bodega_central", "devuelta"] },
      SAT_A,
    );
    if (mezcla.status !== "ok") throw new Error("no ok");
    expect(ids(mezcla.items)).toEqual(["a-09", "a-11", "a-10"]);
  });

  it("CONTRAPRUEBA de R44: forbidden sin filas ni total a todo rol que no sea adminSatelite", async () => {
    for (const actor of ROLES_SIN_ACCESO) {
      const { repo, llamadas } = repoEnMemoria();
      const r = await servicio(repo).listarOrdenesBodegaPaginado(input(), actor);

      expect(r, `rol ${actor.rol}`).toEqual({ status: "forbidden" });
      expect(r, `rol ${actor.rol}`).not.toHaveProperty("items");
      expect(r, `rol ${actor.rol}`).not.toHaveProperty("total");
      // El guard va ANTES de resolver la zona y ANTES de la base: ni una consulta.
      expect(llamadas, `rol ${actor.rol}`).toEqual([]);
    }
  });

  it("el adminSatelite SIN zona recibe una página vacía y no consulta la base (R44)", async () => {
    const { repo, llamadas } = repoEnMemoria();
    const r = await servicio(repo).listarOrdenesBodegaPaginado(input({ page: 3 }), SAT_SIN_ZONA);

    if (r.status !== "ok") throw new Error("no ok");
    expect(r.items).toEqual([]);
    expect(r.total).toBe(0);
    // Devuelve la pagina que se pidio, no una inventada: la pantalla pinta su control con ella.
    expect(r.page).toBe(3);
    // Resolver la zona es la unica consulta; no se toca el listado.
    expect(llamadas).toEqual(["findUsuarioZonaId"]);
  });

  it("devuelve la página pedida y el total del conjunto (R40, R41)", async () => {
    const svc = servicio(repoEnMemoria().repo);

    const p1 = await svc.listarOrdenesBodegaPaginado(input({ page: 1, pageSize: 5 }), SAT_A);
    const p2 = await svc.listarOrdenesBodegaPaginado(input({ page: 2, pageSize: 5 }), SAT_A);
    const p3 = await svc.listarOrdenesBodegaPaginado(input({ page: 3, pageSize: 5 }), SAT_A);
    if (p1.status !== "ok" || p2.status !== "ok" || p3.status !== "ok") throw new Error("no ok");

    expect(ids(p1.items)).toEqual(["a-02", "a-12", "a-03", "a-01", "a-05"]);
    expect(ids(p2.items)).toEqual(["a-04", "a-15", "a-07", "a-06", "a-08"]);
    expect(ids(p3.items)).toEqual(["a-09", "a-11", "a-10"]);

    // R41: el total es el del CONJUNTO en las tres, y en la ultima NO coincide con la pagina.
    for (const p of [p1, p2, p3]) expect(p.total).toBe(13);
    expect(p3.total).not.toBe(p3.items.length);
    // El recorte efectivo viaja de vuelta (la pantalla lo necesita para su control).
    expect([p1.page, p1.pageSize]).toEqual([1, 5]);
  });

  it("el total responde a los filtros, no al conjunto entero (R41)", async () => {
    const svc = servicio(repoEnMemoria().repo);
    const r = await svc.listarOrdenesBodegaPaginado(
      input({ page: 1, pageSize: 2, estados: ["devuelta"] }),
      SAT_A,
    );
    if (r.status !== "ok") throw new Error("no ok");

    expect(ids(r.items)).toEqual(["a-09", "a-11"]);
    // 3 devueltas de las 13 del conjunto: ni 13 (ignorar el filtro) ni 2 (contar la pagina).
    expect(r.total).toBe(3);
  });

  it("acota el tamaño de página al máximo configurado y nunca lo excede (R40)", async () => {
    const r = await servicio(repoEnMemoria().repo).listarOrdenesBodegaPaginado(
      input({ pageSize: 100000 }),
      SAT_A,
    );
    if (r.status !== "ok") throw new Error("no ok");
    expect(r.pageSize).toBe(100); // recepcionSateliteConfig.MAX_PAGE_SIZE
  });

  it("conserva el orden del flujo por grupos, con prioridad y recencia dentro (R51)", async () => {
    const svc = servicio(repoEnMemoria().repo);

    const { recorrido } = await recorrerPaginas(svc, SAT_A, {}, 3);
    const sinPaginar = ids(await conjuntoSinPaginar(svc, SAT_A));

    // Paginar no reordena ni pierde filas (R51).
    expect(recorrido).toEqual(sinPaginar);

    // Y escrito ademas de forma absoluta, para que el test no se limite a comparar dos
    // caminos que podrian estar mal a la vez. FICHA 357: el grupo `entregada` es NUEVO y cae
    // donde lo pone `ESTADOS_BODEGA_SATELITE` — detras de `por_recoger`, delante del retorno—,
    // y los cinco grupos de siempre conservan su orden relativo.
    expect(recorrido).toEqual([
      // en_bodega_satelite: la prioritaria primero, luego por recencia
      "a-02",
      "a-12",
      "a-03",
      "a-01",
      // por_recoger
      "a-05",
      "a-04",
      // entregada (ficha 357): la que SI paso por la bodega
      "a-15",
      // por_devolver
      "a-07",
      "a-06",
      // devolviendo_a_bodega_central
      "a-08",
      // devuelta: la prioritaria primero
      "a-09",
      "a-11",
      "a-10",
    ]);
    // La prioritaria de cada grupo flota a la cabeza de SU grupo, no a la del listado.
    expect(recorrido.indexOf("a-09")).toBeGreaterThan(recorrido.indexOf("a-01"));
  });

  it("con un solo estado elegido conserva el orden de ese grupo (R51)", async () => {
    const svc = servicio(repoEnMemoria().repo);
    const { recorrido } = await recorrerPaginas(svc, SAT_A, { estados: ["en_bodega_satelite"] }, 2);
    const enCliente = filtroDeCliente(await conjuntoSinPaginar(svc, SAT_A), {
      estado: ["en_bodega_satelite"],
    });
    expect(recorrido).toEqual(ids(enCliente));
    expect(recorrido).toEqual(["a-02", "a-12", "a-03", "a-01"]);
  });

  it("una fila no se repite entre páginas ni se cae entre dos (R40, R51)", async () => {
    const svc = servicio(repoEnMemoria().repo);
    // Tres tamaños de pagina distintos sobre el mismo conjunto: el recorrido no cambia.
    const de2 = await recorrerPaginas(svc, SAT_A, {}, 2);
    const de5 = await recorrerPaginas(svc, SAT_A, {}, 5);
    const de50 = await recorrerPaginas(svc, SAT_A, {}, 50);

    expect(de2.recorrido).toEqual(de5.recorrido);
    expect(de5.recorrido).toEqual(de50.recorrido);
    expect(new Set(de2.recorrido).size).toBe(de2.recorrido.length);
    expect(de2.recorrido).toHaveLength(13);
  });

  it("no ejecuta más consultas que el listado sin paginar, salvo el conteo (R54)", async () => {
    const sinPaginar = repoEnMemoria();
    await servicio(sinPaginar.repo).listar(SAT_A);
    expect(sinPaginar.llamadas).toEqual(["findUsuarioZonaId", "findRecepcionSateliteByZona"]);

    const paginado = repoEnMemoria();
    const lotes: string[][] = [];
    await servicio(paginado.repo, lotes).listarOrdenesBodegaPaginado(input({ pageSize: 5 }), SAT_A);

    // La MISMA forma: resolver la zona + UNA lectura del listado. El conteo viaja dentro de
    // esa lectura, no en una consulta aparte que pudiera mirar otro conjunto.
    expect(paginado.llamadas).toEqual(["findUsuarioZonaId", "findRecepcionSatelitePaginada"]);
    await expect(
      paginado.findRecepcionSatelitePaginada.mock.results[0]!.value,
    ).resolves.toMatchObject({ total: 13 });

    // El derivador de intentos sigue siendo UN SOLO lote (feature 160/R12) y ahora ademas
    // acotado a la pagina: 5 ids, no los 13 del conjunto.
    expect(lotes).toHaveLength(1);
    expect(lotes[0]).toHaveLength(5);
  });

  it("cada fila de la página llega con su número de intentos, el 0 incluido (feature 160/R14)", async () => {
    const svc = servicio(repoEnMemoria().repo);
    const r = await svc.listarOrdenesBodegaPaginado(input({ pageSize: 3 }), SAT_A);
    if (r.status !== "ok") throw new Error("no ok");
    // a-02 -> 2, a-12 -> 12, a-03 -> ausente del mapa -> 0, que SI se expone (no se omite).
    expect(r.items.map((i) => i.intentosEntrega)).toEqual([2, 12, 0]);
    // Y el resto del DTO es el mismo que entrega el listado sin paginar.
    const sinPaginar = await conjuntoSinPaginar(svc, SAT_A);
    expect(r.items[0]).toEqual(sinPaginar.find((o) => o.id === "a-02"));
  });
});

// --- Pedido humano (2026-08-19): los filtros que esta barra heredo de `/ordenes` ---------

describe("RecepcionSateliteService.listarOrdenesBodegaPaginado — buscador y fecha (barra de /ordenes)", () => {
  /** El filtro que le llego al repositorio en la primera llamada. */
  async function filtroDe(
    entrada: Record<string, unknown>,
    ahora?: Date,
  ): Promise<RecepcionSateliteFiltro> {
    const { repo, findRecepcionSatelitePaginada } = repoEnMemoria();
    await servicio(repo, undefined, ahora).listarOrdenesBodegaPaginado(
      input(entrada),
      SAT_A,
    );
    return findRecepcionSatelitePaginada.mock.calls[0]![0] as RecepcionSateliteFiltro;
  }

  it("el termino viaja NORMALIZADO, no como se tecleo", () => {
    // La columna generada esta en minusculas y sin acentos; el termino tiene que llegar igual
    // o la busqueda «no encuentra» sin que nada falle. La normalizacion es la MISMA funcion
    // que usa `/ordenes` (`lib/utils/filtros-listado-ordenes`).
    return expect(filtroDe({ q: "  Guápiles  " })).resolves.toMatchObject({
      busqueda: "guapiles",
    });
  });

  it("un termino con separadores viaja TAMBIEN en su forma solo-digitos", async () => {
    // «8888-0000» tiene que encontrar el telefono guardado sin guiones Y la remision escrita
    // con ellos: son dos formas de la MISMA columna, no dos filtros.
    const filtro = await filtroDe({ q: "8888-0000" });
    expect(filtro.busqueda).toBe("8888-0000");
    expect(filtro.busquedaDigitos).toBe("88880000");
  });

  it("un termino ya limpio NO duplica la forma de digitos", async () => {
    const filtro = await filtroDe({ q: "88880000" });
    expect(filtro.busqueda).toBe("88880000");
    expect(filtro.busquedaDigitos).toBeUndefined();
  });

  it("el atajo de antiguedad se resuelve a un rango con el huso de Costa Rica", async () => {
    // «Ultimos 7 dias» son 7 dias CALENDARIO incluido hoy, contados desde las 00:00 de Costa
    // Rica (UTC-6), no desde hace 168 horas ni desde medianoche UTC. El 19 de agosto a las
    // 03:00 UTC son todavia las 21:00 del 18 en CR, asi que el septimo dia hacia atras
    // empieza el 12 a las 06:00 UTC.
    const filtro = await filtroDe(
      { created_preset: "7d" },
      new Date("2026-08-19T03:00:00.000Z"),
    );
    expect(filtro.creadaDesde).toEqual(new Date("2026-08-12T06:00:00.000Z"));
    expect(filtro.creadaHasta).toBeUndefined();
  });

  it("el rango de fechas incluye el dia «hasta» entero", async () => {
    const filtro = await filtroDe({
      created_desde: "2026-08-01",
      created_hasta: "2026-08-10",
    });
    expect(filtro.creadaDesde).toEqual(new Date("2026-08-01T06:00:00.000Z"));
    // El borde superior es el inicio del dia SIGUIENTE y la consulta lo compara con `<`: el
    // dia 10 entra entero, incluida una orden creada a las 23:59 de Costa Rica.
    expect(filtro.creadaHasta).toEqual(new Date("2026-08-11T06:00:00.000Z"));
  });

  it("el alcance por zona no depende de ninguno de los dos: siguen siendo filtros", async () => {
    const filtro = await filtroDe({ q: "guapiles", created_preset: "30d" });
    expect(filtro.zonaId).toBe("z-a");
    expect(filtro.estatusValues).toEqual([...ESTADOS_BODEGA_SATELITE]);
  });
});
