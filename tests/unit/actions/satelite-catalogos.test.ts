import { describe, it, expect, vi } from "vitest";
import {
  obtenerCatalogoFiltrosSatelite,
  listarOrdenesBodegaPaginado,
} from "@/lib/actions/recepcion-satelite";
import { RecepcionSateliteService } from "@/lib/services/RecepcionSateliteService";
import type {
  IOrdenRepository,
  RecepcionSateliteFiltro,
  RecepcionSateliteRow,
} from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IOrdenHistorialService } from "@/lib/interfaces/services/IOrdenHistorialService";
import { ESTADOS_BODEGA_SATELITE } from "@/lib/utils/estados-bodega-satelite";
import type { RangoPagina } from "@/lib/utils/rango-pagina";
import {
  CLAVE_CANTON,
  CLAVE_DISTRITO,
  CLAVE_ESTADO,
  ESTADOS_SATELITE,
  construirFiltrosSatelite,
} from "@/app/(app)/recepcion-satelite/_components/satelite-ordenes-filtros";

// Feature 170 — FASE 2, T K.2 (R44/R46) — el catalogo de cantones y distritos de la bodega
// satelite, acotado por rol y ajeno al recorte de pagina.
//
// Que se rompe si esto falla, y por que no se ve: hoy las opciones de los dos desplegables se
// derivan del array COMPLETO que la pantalla tiene cargado
// (`construirFiltrosSatelite(ordenes)`). Al paginar, ese array pasa a ser la pagina visible:
// el desplegable ofreceria los cantones de 25 filas y el operador concluiria —sin ningun
// error, sin ningun aviso— que su bodega no tiene ordenes en el canton que busca.
//
// Por eso el test central compara el catalogo del SERVIDOR con lo que
// `construirFiltrosSatelite` produce sobre el conjunto entero: la misma funcion que la
// pantalla usa hoy, sobre el mismo conjunto. Molde de la accion: `filtros-ordenes.ts` (144).

const SAT_A: Actor = { usuarioId: "u-sat-a", rol: "adminSatelite" };
const SAT_B: Actor = { usuarioId: "u-sat-b", rol: "adminSatelite" };
const SAT_SIN_ZONA: Actor = { usuarioId: "u-sat-sin", rol: "adminSatelite" };

const ZONA_POR_USUARIO: Record<string, string | null> = {
  "u-sat-a": "z-a",
  "u-sat-b": "z-b",
  "u-sat-sin": null,
};

const ROLES_SIN_ACCESO: Actor[] = [
  { usuarioId: "u-maestro", rol: "maestro" },
  { usuarioId: "u-admin", rol: "admin" },
  { usuarioId: "t1", rol: "adminTienda" },
  { usuarioId: "g1", rol: "mensajero" },
  { usuarioId: "k1", rol: "apiKey" },
];

interface FilaAlmacen {
  row: RecepcionSateliteRow;
  zonaId: string;
  createdAt: string;
}

function fila(
  id: string,
  zonaId: string,
  estatusValue: string,
  provincia: string,
  canton: string,
  distrito: string | null,
  dia: number,
): FilaAlmacen {
  return {
    zonaId,
    createdAt: `2026-03-${String(dia).padStart(2, "0")}T00:00:00.000Z`,
    row: {
      id,
      numGuia: 2000 + dia,
      numRemision: `REM-${id}`,
      estatusValue,
      destinatario: `Destinatario ${id}`,
      telefonoDest: "88880000",
      direccion: null,
      producto: "Caja",
      montoCobrar: null,
      tiendaNombre: "Tienda",
      zonaNombre: `Zona ${zonaId}`,
      provinciaNombre: provincia,
      cantonNombre: canton,
      distritoNombre: distrito,
      prioridad: false,
    },
  };
}

/**
 * El almacen esta ordenado a proposito para que la PAGINA 1 no vea casi nada del catalogo: las
 * primeras filas por recencia son todas de «Escazú». Si las opciones se derivaran de la
 * pagina, el desplegable ofreceria un canton de los cuatro y el test lo dice.
 *
 * «Escazú» aparece tambien en la zona B, y «Central» aparece en DOS provincias de la zona A:
 * ese homonimo es el que obliga a que la etiqueta lleve la provincia.
 */
const ALMACEN: FilaAlmacen[] = [
  fila("a-01", "z-a", "en_bodega_satelite", "San José", "Escazú", "San Rafael", 21),
  fila("a-02", "z-a", "en_bodega_satelite", "San José", "Escazú", "San Antonio", 20),
  fila("a-03", "z-a", "por_recoger", "San José", "Escazú", "San Rafael", 19),
  fila("a-04", "z-a", "por_devolver", "Heredia", "Barva", "San Pedro", 8),
  fila("a-05", "z-a", "devuelta", "Heredia", "Barva", null, 7),
  fila("a-06", "z-a", "devolviendo_a_bodega_central", "San José", "Central", "Carmen", 6),
  fila("a-07", "z-a", "devuelta", "Alajuela", "Central", "Alajuela", 5),
  // Fuera del listado: su geografia NO debe aparecer en el catalogo (es la seccion «Por
  // recibir», que no usa estos filtros).
  fila("a-08", "z-a", "en_ruta_bodega_satelite", "Limón", "Pococí", "Guápiles", 4),
  fila("b-01", "z-b", "en_bodega_satelite", "Cartago", "Cartago", "Occidental", 22),
  fila("b-02", "z-b", "devuelta", "San José", "Escazú", "San Rafael", 3),
];

function repoEnMemoria(filas: FilaAlmacen[] = ALMACEN) {
  const llamadas: string[] = [];

  const repo = {
    findUsuarioZonaId: vi.fn(async (usuarioId: string) => {
      llamadas.push("findUsuarioZonaId");
      return ZONA_POR_USUARIO[usuarioId] ?? null;
    }),
    findRecepcionSateliteGeoByZona: vi.fn(async (zonaId: string, estatusValues: string[]) => {
      llamadas.push("findRecepcionSateliteGeoByZona");
      const vistos = new Set<string>();
      const geo: { provinciaNombre: string; cantonNombre: string; distritoNombre: string | null }[] =
        [];
      for (const f of filas) {
        if (f.zonaId !== zonaId) continue;
        if (!estatusValues.includes(f.row.estatusValue)) continue;
        const clave = `${f.row.provinciaNombre}|${f.row.cantonNombre}|${f.row.distritoNombre}`;
        if (vistos.has(clave)) continue;
        vistos.add(clave);
        geo.push({
          provinciaNombre: f.row.provinciaNombre,
          cantonNombre: f.row.cantonNombre,
          distritoNombre: f.row.distritoNombre,
        });
      }
      return geo;
    }),
    findRecepcionSatelitePaginada: vi.fn(
      async (filtro: RecepcionSateliteFiltro, rango: RangoPagina) => {
        llamadas.push("findRecepcionSatelitePaginada");
        const conjunto = filas
          .filter((f) => f.zonaId === filtro.zonaId)
          .filter((f) => filtro.estatusValues.includes(f.row.estatusValue))
          .sort((a, b) => {
            const grupo =
              ESTADOS_BODEGA_SATELITE.indexOf(a.row.estatusValue as never) -
              ESTADOS_BODEGA_SATELITE.indexOf(b.row.estatusValue as never);
            return grupo !== 0 ? grupo : b.createdAt.localeCompare(a.createdAt);
          });
        return {
          items: conjunto.slice(rango.skip, rango.skip + rango.take).map((f) => f.row),
          total: conjunto.length,
        };
      },
    ),
  } as unknown as IOrdenRepository;

  return { repo, llamadas };
}

function servicio(repo: IOrdenRepository) {
  const historial = {
    contarIntentosEnLote: vi.fn(async () => new Map<string, number>()),
  } as unknown as Pick<IOrdenHistorialService, "contarIntentosEnLote">;
  return new RecepcionSateliteService(repo, historial);
}

/** El conjunto COMPLETO del actor, tal como llegaba hoy a la pantalla. */
function conjuntoDe(zonaId: string) {
  return ALMACEN.filter(
    (f) => f.zonaId === zonaId && ESTADOS_BODEGA_SATELITE.includes(f.row.estatusValue as never),
  ).map((f) => f.row);
}

/** Las opciones que `construirFiltrosSatelite` produce hoy en el cliente, por clave. */
function opcionesDeLaPantalla(zonaId: string) {
  const filtros = construirFiltrosSatelite(conjuntoDe(zonaId));
  const de = (clave: string) => filtros.find((f) => f.key === clave)!.options;
  return { cantones: de(CLAVE_CANTON), distritos: de(CLAVE_DISTRITO), estados: de(CLAVE_ESTADO) };
}

describe("obtenerCatalogoFiltrosSatelite (T K.2)", () => {
  it("ofrece todas las opciones del conjunto del actor, no solo las de la página (R46)", async () => {
    const { repo } = repoEnMemoria();
    const service = servicio(repo);

    // Lo que la pagina 1 ve: tres filas, TODAS de «Escazú».
    const pagina = await listarOrdenesBodegaPaginado(
      { page: 1, pageSize: 3 },
      { service, getActor: async () => SAT_A },
    );
    if (pagina.status !== "ok") throw new Error("no ok");
    const cantonesDeLaPagina = [...new Set(pagina.items.map((o) => o.cantonNombre))];
    expect(cantonesDeLaPagina).toEqual(["Escazú"]);

    const r = await obtenerCatalogoFiltrosSatelite({ service, getActor: async () => SAT_A });
    if (r.status !== "ok") throw new Error("no ok");

    // El catalogo es EXACTAMENTE lo que la pantalla construye hoy con el conjunto entero:
    // mismas etiquetas (con la provincia para desambiguar homonimos), mismo orden alfabetico,
    // mismo encadenamiento distrito -> canton.
    const esperado = opcionesDeLaPantalla("z-a");
    expect(r.catalogo.cantones).toEqual(esperado.cantones);
    expect(r.catalogo.distritos).toEqual(esperado.distritos);

    // Y por si esa comparacion se volviera trivial algun dia: hay CUATRO cantones y tres de
    // ellos no estan en la pagina visible.
    expect(r.catalogo.cantones.map((c) => c.value)).toEqual([
      "Barva",
      "Central",
      "Central",
      "Escazú",
    ]);
    expect(r.catalogo.cantones.map((c) => c.label)).toEqual([
      "Barva (Heredia)",
      "Central (Alajuela)",
      "Central (San José)",
      "Escazú (San José)",
    ]);
    const fueraDeLaPagina = r.catalogo.cantones.filter(
      (c) => !cantonesDeLaPagina.includes(c.value),
    );
    expect(fueraDeLaPagina).toHaveLength(3);

    // Los distritos tambien: los de Barva y los de Central no aparecen en la pagina 1. Los de
    // «Central» salen DOS veces, una por cada canton homonimo y con el mismo contenido: el
    // filtro compara por NOMBRE de canton, asi que es exactamente lo que se ve hoy.
    expect(r.catalogo.distritos.map((d) => `${d.parentValue}/${d.value}`)).toEqual([
      "Barva/San Pedro",
      "Central/Alajuela",
      "Central/Carmen",
      "Central/Alajuela",
      "Central/Carmen",
      "Escazú/San Antonio",
      "Escazú/San Rafael",
    ]);
  });

  it("no cambia con la página ni con los filtros vigentes (R46)", async () => {
    const { repo } = repoEnMemoria();
    const service = servicio(repo);

    const primero = await obtenerCatalogoFiltrosSatelite({ service, getActor: async () => SAT_A });

    // El usuario filtra por un estado y se va a la ultima pagina…
    await listarOrdenesBodegaPaginado(
      { page: 3, pageSize: 2, estados: ["devuelta"], cantones: ["Barva"] },
      { service, getActor: async () => SAT_A },
    );

    const despues = await obtenerCatalogoFiltrosSatelite({ service, getActor: async () => SAT_A });
    // …y el desplegable sigue ofreciendo lo mismo: elegir un canton no borra los demas.
    expect(despues).toEqual(primero);
  });

  it("no ofrece opciones de zonas ajenas al actor (R44)", async () => {
    const { repo } = repoEnMemoria();
    const service = servicio(repo);

    const deA = await obtenerCatalogoFiltrosSatelite({ service, getActor: async () => SAT_A });
    const deB = await obtenerCatalogoFiltrosSatelite({ service, getActor: async () => SAT_B });
    if (deA.status !== "ok" || deB.status !== "ok") throw new Error("no ok");

    const valoresA = deA.catalogo.cantones.map((c) => c.value);
    const valoresB = deB.catalogo.cantones.map((c) => c.value);

    // La zona B tiene «Cartago», que la zona A no puede ver…
    expect(valoresB).toContain("Cartago");
    expect(valoresA).not.toContain("Cartago");
    // …y CONTRAPRUEBA: cada uno SI ve lo suyo, con su etiqueta. Sin esto, un catalogo que
    // devolviera siempre vacio pasaria la primera mitad.
    expect(valoresA).toEqual(expect.arrayContaining(["Barva", "Escazú", "Central"]));
    expect(deB.catalogo.cantones).toEqual(opcionesDeLaPantalla("z-b").cantones);
    // «Escazú» existe en las DOS zonas: la B lo ofrece por SUS ordenes, no por las de la A.
    expect(valoresB).toContain("Escazú");
    expect(deB.catalogo.distritos.map((d) => `${d.parentValue}/${d.value}`)).toEqual([
      "Cartago/Occidental",
      "Escazú/San Rafael",
    ]);
    // Y la zona A no hereda el distrito «Occidental» de la B.
    expect(deA.catalogo.distritos.map((d) => d.value)).not.toContain("Occidental");
  });

  it("el catálogo no ofrece la geografía de órdenes que este listado no muestra (R44)", async () => {
    const { repo } = repoEnMemoria();
    const r = await obtenerCatalogoFiltrosSatelite({
      service: servicio(repo),
      getActor: async () => SAT_A,
    });
    if (r.status !== "ok") throw new Error("no ok");

    // a-08 es de la zona A pero esta en `en_ruta_bodega_satelite` («Por recibir»): su canton
    // no puede aparecer en un filtro que no la filtra.
    expect(r.catalogo.cantones.map((c) => c.value)).not.toContain("Pococí");
    expect(r.catalogo.distritos.map((d) => d.value)).not.toContain("Guápiles");
  });

  it("un rol ajeno al módulo obtiene forbidden sin catálogo y sin tocar la base (R44)", async () => {
    for (const actor of ROLES_SIN_ACCESO) {
      const { repo, llamadas } = repoEnMemoria();
      const r = await obtenerCatalogoFiltrosSatelite({
        service: servicio(repo),
        getActor: async () => actor,
      });

      expect(r, `rol ${actor.rol}`).toEqual({ status: "forbidden" });
      expect(r, `rol ${actor.rol}`).not.toHaveProperty("catalogo");
      expect(llamadas, `rol ${actor.rol}`).toEqual([]);
    }
  });

  it("sin sesión devuelve unauthenticated sin construir el servicio", async () => {
    const { repo, llamadas } = repoEnMemoria();
    const r = await obtenerCatalogoFiltrosSatelite({
      service: servicio(repo),
      getActor: async () => null,
    });
    expect(r).toEqual({ status: "unauthenticated" });
    expect(llamadas).toEqual([]);
  });

  it("el adminSatelite sin zona recibe un catálogo vacío, no un error", async () => {
    const { repo, llamadas } = repoEnMemoria();
    const r = await obtenerCatalogoFiltrosSatelite({
      service: servicio(repo),
      getActor: async () => SAT_SIN_ZONA,
    });
    // Tiene acceso al modulo; lo que no tiene es alcance. La pantalla ya avisa `sinZona`.
    expect(r).toEqual({ status: "ok", catalogo: { cantones: [], distritos: [] } });
    expect(llamadas).toEqual(["findUsuarioZonaId"]);
  });

  it("la lista blanca del servidor y el desplegable de estado declaran los mismos cinco, en el mismo orden", async () => {
    // El desplegable de estado NO viaja en el catalogo: son cinco valores fijos que la
    // pantalla ya declara. Pero el servidor los usa para dos cosas —la lista blanca del filtro
    // (R44) y el rango de grupo del orden (R51)— y si las dos listas divergieran, el usuario
    // podria elegir un estado que el servidor descarta, o ver los grupos en otro orden.
    expect(ESTADOS_SATELITE.map((e) => e.value)).toEqual([...ESTADOS_BODEGA_SATELITE]);
  });
});
