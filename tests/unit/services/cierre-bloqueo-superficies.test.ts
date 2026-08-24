import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { MisAsignacionesService } from "@/lib/services/MisAsignacionesService";
import { RecoleccionTiendaService } from "@/lib/services/RecoleccionTiendaService";
import { CierreDiaService } from "@/lib/services/CierreDiaService";
import { GuiaAsignacionService } from "@/lib/services/GuiaAsignacionService";
import { AsignacionSateliteService } from "@/lib/services/AsignacionSateliteService";
import type {
  IOrdenRepository,
  OrdenTransicionRow,
} from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type {
  EstadoAsignabilidad,
  IAsignabilidadCoordenadasService,
  OrdenAsignabilidadRow,
} from "@/lib/interfaces/services/IAsignabilidadCoordenadasService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { CierreEstado } from "@/lib/types/cierre";

/**
 * FEATURE 271 (T4.6) — LA REGLA N/V CRUZADA CON **TODAS** SUS SUPERFICIES, EN UN SITIO.
 *
 * ⚠️ ESTE ARCHIVO SUSTITUYE A `cierre-bloqueo-asimetria.test.ts`, Y EL RENOMBRADO ES EL PUNTO: YA
 * NO HAY ASIMETRIA QUE MEDIR. Aquel archivo codificaba la regla firmada el 2026-08-20 —«RECIBIR
 * ASIGNACIONES NUNCA se bloquea»— y habria quedado MINTIENDO en cuanto entraran las guardas de
 * T4.1-T4.3. El humano revirtio esa mitad el 2026-08-23: «un mensajero no puede hacer las dos
 * gestiones, solo una a la vez».
 *
 * QUE SE CONSERVA DE AQUEL ARCHIVO, y es su virtud: EL METODO. Aqui NO se usa un
 * `vi.fn(async () => new Set(["m1"]))`, porque un doble asi no sabe cuantos cierres tiene el
 * mensajero ni en que estado estan: afirma «bloqueado» porque se lo han dicho. Se construye un
 * `OrdenRepository` REAL sobre un Prisma que AGRUPA de verdad, y el corpus de cierres es una
 * ENTRADA del caso. Asi, devolver la lista de estados vieja al codigo pone rojos los casos de
 * `N=2, V=0` — que son exactamente los que la ficha añade.
 *
 * LO QUE SOBREVIVE DE LA 241, y se afirma para que nadie lo «complete» por simetria: un cierre
 * `solicitado` A SECAS (N=1, V=0) **NO** bloquea nada.
 */

const MENSAJERO: Actor = { usuarioId: "m1", rol: "mensajero" };
const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const ADMIN_SATELITE: Actor = { usuarioId: "u-adminsat", rol: "adminSatelite" };

const ZONA_CENTRAL = "z-central";
const ZONA_SATELITE = "z-satelite";
const ESTATUS_ID: Record<string, string> = {
  por_recoger: "os-por-recoger",
  en_reparto: "os-en-reparto",
  en_bodega_central: "os-bodega-central",
  en_bodega_satelite: "os-bodega-satelite",
  recolectando: "os-recolectando",
  por_recolectar_en_tienda: "os-por-recolectar",
};

/**
 * LAS SIETE FILAS DE LA TABLA DE VERDAD, expresadas como el corpus de cierres de `m1`. Es la
 * ENTRADA del caso: de aqui salen N y V, y de N y V sale el veredicto — no al reves.
 */
const CASOS: { nombre: string; cierres: CierreEstado[]; bloqueado: boolean }[] = [
  { nombre: "1 · sin cierres (N=0,V=0)", cierres: [], bloqueado: false },
  { nombre: "2 · un `solicitado` (N=1,V=0)", cierres: ["solicitado"], bloqueado: false },
  { nombre: "4 · dos `solicitado` (N=2,V=0)", cierres: ["solicitado", "solicitado"], bloqueado: true },
  { nombre: "5 · un `vencido` (N=1,V=1)", cierres: ["vencido"], bloqueado: true },
  { nombre: "5-bis · un `rechazado` (N=1,V=1)", cierres: ["rechazado"], bloqueado: true },
  { nombre: "6 · `solicitado`+`vencido` (N=2,V=1)", cierres: ["solicitado", "vencido"], bloqueado: true },
  { nombre: "7 · dos `rechazado` (N=2,V=2)", cierres: ["rechazado", "rechazado"], bloqueado: true },
];

const LIBRES = CASOS.filter((c) => !c.bloqueado);
const BLOQUEADOS = CASOS.filter((c) => c.bloqueado);

/**
 * Repositorio REAL sobre un Prisma que AGRUPA de verdad: `m1` tiene exactamente `cierres`, y el
 * `groupBy` responde con el conteo por estado, filtrando por `where.estado.in` como lo hace
 * Postgres. Si alguien saca `rechazado` del calculo de V, o mete `aprobado` entre los abiertos, o
 * cambia `n >= 2` por `n > 2`, estos casos lo notan.
 */
function repoConCierres(cierres: readonly CierreEstado[]): IOrdenRepository {
  const prisma = {
    cierreDia: {
      groupBy: vi.fn(async (args: { where: { estado: { in: string[] } } }) => {
        const admitidos = cierres.filter((e) => args.where.estado.in.includes(e));
        const porEstado = new Map<string, number>();
        for (const e of admitidos) porEstado.set(e, (porEstado.get(e) ?? 0) + 1);
        return [...porEstado].map(([estado, n]) => ({
          mensajeroId: "m1",
          estado,
          _count: { _all: n },
        }));
      }),
      findFirst: vi.fn(async () =>
        cierres.length === 0
          ? null
          : {
              id: "c-viejo",
              estado: cierres[0],
              solicitadoAt: new Date("2026-08-21T18:00:00.000Z"),
              createdAt: new Date("2026-08-22T06:03:00.000Z"),
            },
      ),
    },
    gestionOrden: { findMany: vi.fn(async () => []) },
  };
  return new OrdenRepository(prisma as unknown as PrismaClient);
}

// =================================================================================================
// CONTROL — el instrumento se prueba a si mismo ANTES que nada.
// =================================================================================================

describe("271 · control: el doble de Prisma AGRUPA de verdad", () => {
  // Sin esto, todo lo de abajo pasaria igual con un doble que devolviera siempre vacio: «no
  // bloqueo» y «ni siquiera se pregunto» son verdes indistinguibles.
  it.each(CASOS.map((c) => [c.nombre, c.cierres, c.bloqueado] as const))(
    "%s -> bloqueado=%o",
    async (_nombre, cierres, esperado) => {
      const bloqueados = await repoConCierres(cierres).findMensajerosBloqueadosPorCierres(["m1"]);
      expect(bloqueados.has("m1")).toBe(esperado);
    },
  );

  it("un cierre `aprobado` NO cuenta: es el unico terminal", async () => {
    const bloqueados = await repoConCierres([
      "aprobado",
      "aprobado",
      "aprobado",
    ]).findMensajerosBloqueadosPorCierres(["m1"]);
    expect(bloqueados).toEqual(new Set());
  });
});

// =================================================================================================
// FAMILIA A — GESTIONAR Y COBRAR. Las cinco superficies (R25/R26/R27).
// =================================================================================================

describe("271 · familia A — GESTIONAR y COBRAR", () => {
  /**
   * `escogerParaGestion` es el camino mas corto a la guarda de gestionar/recoger/escoger: si NO
   * bloquea, el servicio sigue y se topa con la orden inexistente (`forbidden`). Los dos resultados
   * son distinguibles, asi que el caso no puede pasar por vacuidad — «no bloqueo» no se confunde
   * con «no llego a mirar».
   */
  function servicioDeGestion(cierres: readonly CierreEstado[]) {
    const repoGestion = {
      findByIdsParaGestion: vi.fn(async () => []),
      getOrdenEnGestion: vi.fn(async () => null),
      setOrdenEnGestion: vi.fn(async () => true),
    };
    const service = new MisAsignacionesService(
      repoGestion as never,
      repoConCierres(cierres),
      { upload: vi.fn(), remove: vi.fn() } as never,
      { createSignedUrl: vi.fn(), createSignedUrls: vi.fn() } as never,
      { findByMensajero: vi.fn(async () => null), upsertOrigen: vi.fn() },
      { findMarcarLuegoByMensajero: vi.fn(async () => new Set<string>()) },
      { contarIntentosEnLote: vi.fn(async () => new Map<string, number>()) },
    );
    return { service, repoGestion };
  }

  it.each(LIBRES.map((c) => [c.nombre, c.cierres] as const))(
    "A-libre · %s: escoger PASA la guarda y el servicio sigue adelante",
    async (_n, cierres) => {
      const { service, repoGestion } = servicioDeGestion(cierres);

      const r = await service.escogerParaGestion("o1", MENSAJERO);

      expect(r.status).toBe("forbidden"); // la orden inexistente del doble: llego hasta ahi
      expect(repoGestion.findByIdsParaGestion).toHaveBeenCalled();
    },
  );

  it.each(BLOQUEADOS.map((c) => [c.nombre, c.cierres] as const))(
    "A-bloqueado · %s: escoger -> conflict, y SIN llegar a leer la orden (R27)",
    async (_n, cierres) => {
      const { service, repoGestion } = servicioDeGestion(cierres);

      const r = await service.escogerParaGestion("o1", MENSAJERO);

      expect(r.status).toBe("conflict");
      if (r.status === "conflict") {
        // R27: el motivo dice que NO puede hacer y que le toca, no un «no se puede» a secas.
        expect(r.motivo).toMatch(/no puedes entregar, cobrar ni recibir trabajo nuevo/i);
      }
      expect(repoGestion.findByIdsParaGestion).not.toHaveBeenCalled();
      expect(repoGestion.setOrdenEnGestion).not.toHaveBeenCalled();
    },
  );

  /** Recolectar en tienda es COBRAR: le toca la misma regla (R25). */
  function servicioDeRecoleccion(cierres: readonly CierreEstado[]) {
    const findByNumGuiaForTransicion = vi.fn(async () => null);
    const service = new RecoleccionTiendaService(
      Object.assign(Object.create(repoConCierres(cierres)) as IOrdenRepository, {
        findByNumGuiaForTransicion,
      }),
      { findMisAsignaciones: vi.fn(async () => []), findMisAsignacionesByIds: vi.fn(async () => []) },
      { findRecoleccionesDeActor: vi.fn(async () => []) },
    );
    return { service, findByNumGuiaForTransicion };
  }

  it.each(LIBRES.map((c) => [c.nombre, c.cierres] as const))(
    "A-libre · %s: recolectar en tienda pasa la guarda y busca la guia",
    async (_n, cierres) => {
      const { service, findByNumGuiaForTransicion } = servicioDeRecoleccion(cierres);

      const r = await service.recolectarEnTienda(1234, MENSAJERO);

      expect(r.status).toBe("no_encontrada"); // llego a buscarla, que es el punto
      expect(findByNumGuiaForTransicion).toHaveBeenCalledWith(1234);
    },
  );

  it.each(BLOQUEADOS.map((c) => [c.nombre, c.cierres] as const))(
    "A-bloqueado · %s: recolectar -> conflict sin llegar a saber si la guia existe",
    async (_n, cierres) => {
      const { service, findByNumGuiaForTransicion } = servicioDeRecoleccion(cierres);

      const r = await service.recolectarEnTienda(1234, MENSAJERO);

      expect(r.status).toBe("conflict");
      expect(findByNumGuiaForTransicion).not.toHaveBeenCalled();
    },
  );

  /** `deshacerGestion` (111/R5, Q2 cerrada por el humano con un «SI» explicito). */
  function servicioDeDeshacer(cierres: readonly CierreEstado[]) {
    const findGestionParaDeshacer = vi.fn(async () => null);
    const service = new CierreDiaService(
      { findGestionParaDeshacer } as never,
      { findCentralZonaId: vi.fn(async () => ZONA_CENTRAL) },
      repoConCierres(cierres),
      { createSignedUrl: vi.fn(), createSignedUrls: vi.fn() } as never,
      {} as never,
    );
    return { service, findGestionParaDeshacer };
  }

  it.each(LIBRES.map((c) => [c.nombre, c.cierres] as const))(
    "A-libre · %s: deshacer pasa la guarda y busca la gestion",
    async (_n, cierres) => {
      const { service, findGestionParaDeshacer } = servicioDeDeshacer(cierres);

      const r = await service.deshacerGestion("00000000-0000-4000-8000-000000000000", MENSAJERO);

      expect(r.status).toBe("forbidden"); // gestion inexistente: llego hasta ahi
      expect(findGestionParaDeshacer).toHaveBeenCalled();
    },
  );

  it.each(BLOQUEADOS.map((c) => [c.nombre, c.cierres] as const))(
    "A-bloqueado · %s: deshacer -> conflict sin tocar la gestion",
    async (_n, cierres) => {
      const { service, findGestionParaDeshacer } = servicioDeDeshacer(cierres);

      const r = await service.deshacerGestion("00000000-0000-4000-8000-000000000000", MENSAJERO);

      expect(r.status).toBe("conflict");
      expect(findGestionParaDeshacer).not.toHaveBeenCalled();
    },
  );
});

// =================================================================================================
// FAMILIA B — RECIBIR TRABAJO NUEVO. Las TRES escrituras (R28/R29/R30/R31).
//
// ⚠️ ESTA FAMILIA ENTERA DECIA LO CONTRARIO HASTA EL 2026-08-23.
// =================================================================================================

describe("271 · familia B — RECIBIR TRABAJO NUEVO (las TRES escrituras)", () => {
  const ordenBodega: OrdenTransicionRow = {
    id: "o1",
    estatusValue: "en_bodega_central",
    numGuia: 4321,
    deletedAt: null,
    zonaId: ZONA_CENTRAL,
    zonaEsGam: true,
    tiendaId: "store-1",
    fechaReparto: null,
  };

  const gateTodoAsignable: IAsignabilidadCoordenadasService = {
    evaluar: async (ordenes: OrdenAsignabilidadRow[]) =>
      new Map<string, EstadoAsignabilidad>(ordenes.map((o) => [o.id, "asignable"])),
  };

  function repoDeAsignacion(cierres: readonly CierreEstado[], extra: Record<string, unknown>) {
    return Object.assign(Object.create(repoConCierres(cierres)) as IOrdenRepository, {
      findEstatusIdByValue: vi.fn(async (v: string) => ESTATUS_ID[v] ?? null),
      findMensajeroIdsValidos: vi.fn(async (ids: string[]) => new Set(ids)),
      findMensajeroIdsValidosByZona: vi.fn(async (ids: string[]) => new Set(ids)),
      findMensajerosConOrdenesEn: vi.fn(async () => new Set<string>()),
      findParaAsignabilidad: vi.fn(async (ids: string[]) =>
        ids.map((id) => ({ id, direccion: "x", latitud: 9.9, longitud: -84.1, geocodeStatus: "OK" })),
      ),
      ...extra,
    }) as IOrdenRepository;
  }

  function guiaService(repo: IOrdenRepository) {
    return new GuiaAsignacionService(
      repo,
      { findCentralZonaId: vi.fn(async () => ZONA_CENTRAL) } as unknown as IZonaRepository,
      gateTodoAsignable,
    );
  }

  // --- B1: reparto desde la bodega CENTRAL (R28/R30) ---

  it.each(LIBRES.map((c) => [c.nombre, c.cierres] as const))(
    "B1-libre · %s: `asignarDesdeBodega` -> ok y persiste",
    async (_n, cierres) => {
      const asignarBodegaLote = vi.fn(async (ids: string[]) => ids.length);
      const repo = repoDeAsignacion(cierres, {
        findByIdsForTransicion: vi.fn(async () => [ordenBodega]),
        asignarBodegaLote,
      });

      const r = await guiaService(repo).asignarDesdeBodega(
        { ordenIds: ["o1"], mensajeroId: "m1" },
        MAESTRO,
      );

      expect(r.status).toBe("ok");
      expect(asignarBodegaLote).toHaveBeenCalledTimes(1);
    },
  );

  it.each(BLOQUEADOS.map((c) => [c.nombre, c.cierres] as const))(
    "B1-bloqueado · %s: `asignarDesdeBodega` -> conflict y NINGUNA orden cambia (R30)",
    async (_n, cierres) => {
      const asignarBodegaLote = vi.fn(async (ids: string[]) => ids.length);
      const repo = repoDeAsignacion(cierres, {
        findByIdsForTransicion: vi.fn(async () => [
          ordenBodega,
          { ...ordenBodega, id: "o2", numGuia: 4322 },
          { ...ordenBodega, id: "o3", numGuia: 4323 },
        ]),
        asignarBodegaLote,
      });

      const r = await guiaService(repo).asignarDesdeBodega(
        { ordenIds: ["o1", "o2", "o3"], mensajeroId: "m1" },
        MAESTRO,
      );

      expect(r.status).toBe("conflict");
      if (r.status === "conflict") {
        // Todo-o-nada: el detalle cubre el LOTE ENTERO, no solo la primera.
        expect(r.detalle.map((d) => d.ordenId)).toEqual(["o1", "o2", "o3"]);
        expect(r.detalle[0].motivo).toMatch(/cierres sin resolver/i);
      }
      expect(asignarBodegaLote).not.toHaveBeenCalled(); // sin efectos sobre ninguna orden
    },
  );

  // --- B2: reparto desde la bodega SATELITE (R29/R30) — donde ocurrio el incidente del 18/08 ---

  function sateliteService(cierres: readonly CierreEstado[], asignarSateliteLote: unknown) {
    const repo = repoDeAsignacion(cierres, {
      findUsuarioZonaId: vi.fn(async () => ZONA_SATELITE),
      findByIdsForTransicion: vi.fn(async () => [
        {
          ...ordenBodega,
          estatusValue: "en_bodega_satelite",
          zonaId: ZONA_SATELITE,
          zonaEsGam: false,
        },
      ]),
      existeBodegaSateliteBloqueada: vi.fn(async () => ({
        bloqueada: false,
        porMensajeros: true, // informativo, NO veto (R34): la bodega entera no se congela
        porCierreBodega: false,
      })),
      asignarSateliteLote,
    });
    return new AsignacionSateliteService(repo, gateTodoAsignable);
  }

  it.each(LIBRES.map((c) => [c.nombre, c.cierres] as const))(
    "B2-libre · %s: asignacion SATELITE -> ok y persiste",
    async (_n, cierres) => {
      const asignarSateliteLote = vi.fn(async () => 1);
      const r = await sateliteService(cierres, asignarSateliteLote).asignar(
        { ordenIds: ["o1"], mensajeroId: "m1" },
        ADMIN_SATELITE,
      );

      expect(r.status).toBe("ok");
      expect(asignarSateliteLote).toHaveBeenCalledTimes(1);
    },
  );

  it.each(BLOQUEADOS.map((c) => [c.nombre, c.cierres] as const))(
    "B2-bloqueado · %s: asignacion SATELITE -> conflict y NINGUNA orden cambia (R29/R30)",
    async (_n, cierres) => {
      const asignarSateliteLote = vi.fn(async () => 1);
      const r = await sateliteService(cierres, asignarSateliteLote).asignar(
        { ordenIds: ["o1"], mensajeroId: "m1" },
        ADMIN_SATELITE,
      );

      expect(r.status).toBe("conflict");
      if (r.status === "conflict") expect(r.detalle[0].motivo).toMatch(/cierres sin resolver/i);
      expect(asignarSateliteLote).not.toHaveBeenCalled();
    },
  );

  // --- B3: RECOLECCION en tienda (R31) — la que la version anterior del spec dejaba fuera ---

  it.each(LIBRES.map((c) => [c.nombre, c.cierres] as const))(
    "B3-libre · %s: `asignarRecoleccion` -> ok y persiste",
    async (_n, cierres) => {
      const asignarRecoleccionLote = vi.fn(async (ids: string[]) => ids.length);
      const repo = repoDeAsignacion(cierres, {
        findByIdsForTransicion: vi.fn(async () => [
          { ...ordenBodega, estatusValue: "por_recolectar_en_tienda" },
        ]),
        asignarRecoleccionLote,
      });

      const r = await guiaService(repo).asignarRecoleccion(
        { ordenIds: ["o1"], mensajeroId: "m1" },
        MAESTRO,
      );

      expect(r.status).toBe("ok");
      expect(asignarRecoleccionLote).toHaveBeenCalledTimes(1);
    },
  );

  it.each(BLOQUEADOS.map((c) => [c.nombre, c.cierres] as const))(
    "B3-bloqueado · %s: `asignarRecoleccion` -> conflict y NINGUNA orden cambia (R31)",
    async (_n, cierres) => {
      // ⚠️ ESTE CASO AFIRMABA LO CONTRARIO HASTA EL 2026-08-23, con una guardia dedicada a impedir
      // que alguien bloqueara la recoleccion. Q1 la revirtio: recolectar cobra, y `RecoleccionTienda`
      // YA bloqueaba el ACTO — permitir RECIBIR lo que no se puede EJECUTAR dejaba al mensajero con
      // paquetes asignados y un rechazo en el mostrador de la tienda.
      const asignarRecoleccionLote = vi.fn(async (ids: string[]) => ids.length);
      const repo = repoDeAsignacion(cierres, {
        findByIdsForTransicion: vi.fn(async () => [
          { ...ordenBodega, estatusValue: "por_recolectar_en_tienda" },
        ]),
        asignarRecoleccionLote,
      });

      const r = await guiaService(repo).asignarRecoleccion(
        { ordenIds: ["o1"], mensajeroId: "m1" },
        MAESTRO,
      );

      expect(r.status).toBe("conflict");
      if (r.status === "conflict") expect(r.detalle[0].motivo).toMatch(/cierres sin resolver/i);
      expect(asignarRecoleccionLote).not.toHaveBeenCalled();
    },
  );

  it("R31: la guarda de recoleccion va ANTES de la regla de dedicacion, y no la sustituye", async () => {
    // La regla de dedicacion (feature 157) sigue viva DOS LINEAS mas abajo y esta ficha no la toca.
    // Con el mensajero LIBRE pero con reparto encima, el rechazo es el de la dedicacion.
    const asignarRecoleccionLote = vi.fn(async (ids: string[]) => ids.length);
    const repo = repoDeAsignacion(["solicitado"], {
      findByIdsForTransicion: vi.fn(async () => [
        { ...ordenBodega, estatusValue: "por_recolectar_en_tienda" },
      ]),
      findMensajerosConOrdenesEn: vi.fn(async () => new Set(["m1"])),
      asignarRecoleccionLote,
    });

    const r = await guiaService(repo).asignarRecoleccion(
      { ordenIds: ["o1"], mensajeroId: "m1" },
      MAESTRO,
    );

    expect(r.status).toBe("conflict");
    if (r.status === "conflict") expect(r.detalle[0].motivo).toMatch(/ordenes de reparto/i);
    expect(asignarRecoleccionLote).not.toHaveBeenCalled();
  });
});

// =================================================================================================
// R34 — EL BLOQUEO ES DEL MENSAJERO, NO DE SU BODEGA.
// =================================================================================================

describe("271/R34 · un mensajero bloqueado NO congela a sus companeros", () => {
  it("el compañero sin cierres recibe reparto aunque `m1` este bloqueado", async () => {
    // Prisma que agrupa de verdad sobre DOS mensajeros: `m1` con dos `solicitado`, `m2` con nada.
    const prisma = {
      cierreDia: {
        groupBy: vi.fn(async (args: { where: { mensajeroId: { in: string[] } } }) =>
          args.where.mensajeroId.in.includes("m1")
            ? [{ mensajeroId: "m1", estado: "solicitado", _count: { _all: 2 } }]
            : [],
        ),
      },
    };
    const base = new OrdenRepository(prisma as unknown as PrismaClient);

    const bloqueados = await base.findMensajerosBloqueadosPorCierres(["m1", "m2"]);

    expect(bloqueados).toEqual(new Set(["m1"]));
    expect(bloqueados.has("m2")).toBe(false);
  });
});
