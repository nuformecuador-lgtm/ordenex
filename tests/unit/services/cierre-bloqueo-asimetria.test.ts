import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { MisAsignacionesService } from "@/lib/services/MisAsignacionesService";
import { RecoleccionTiendaService } from "@/lib/services/RecoleccionTiendaService";
import { CierreDiaService } from "@/lib/services/CierreDiaService";
import { GuiaAsignacionService } from "@/lib/services/GuiaAsignacionService";
import { AsignacionSateliteService } from "@/lib/services/AsignacionSateliteService";
import type { IOrdenRepository, OrdenTransicionRow } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type {
  EstadoAsignabilidad,
  IAsignabilidadCoordenadasService,
  OrdenAsignabilidadRow,
} from "@/lib/interfaces/services/IAsignabilidadCoordenadasService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

/**
 * FEATURE 241 — LA ASIMETRÍA FIRMADA POR EL HUMANO EL 2026-08-20, medida entera y en un sitio.
 *
 * Son TRES cosas distintas y la suite las tenía repartidas en seis archivos, cada uno viendo su
 * trozo. Este archivo las cruza, porque el fallo que originó la ficha fue exactamente ese: dos
 * capas verdes afirmando conductas contrarias sobre la misma acción, y nadie mirándolas juntas.
 *
 *   1. SOLICITAR CIERRE   — nunca dos pendientes. Ya funcionaba y NO se toca (R12, 109/R30). Fuera
 *                           de este archivo a propósito: no depende de este predicado.
 *   2. RECIBIR ASIGNACIONES — NUNCA se bloquea, con cualquiera de los tres estados.
 *   3. GESTIONAR Y COBRAR — se bloquea SOLO con `vencido` o `rechazado`. NUNCA con `solicitado`,
 *                           que es espera del ADMIN (mediana 8,2 h, p90 22,1 h contra producción).
 *
 * POR QUÉ AQUÍ SE USA EL REPOSITORIO REAL Y NO UN DOBLE. Un `vi.fn(async () => new Set(["m1"]))`
 * no sabe qué estado tiene el cierre: afirma «bloqueado» o «no bloqueado» porque se lo han dicho.
 * Con ese instrumento, «con `solicitado` puede gestionar» pasa en verde aunque la lista de estados
 * diga lo contrario — es la lección de «probar el WHERE donde vive». Aquí se construye un
 * `OrdenRepository` de verdad sobre un doble de Prisma que FILTRA por `where.estado.in`, y se le
 * inyecta a cada servicio. Así el estado del cierre es una ENTRADA del caso, no una suposición, y
 * devolver `solicitado` a `ESTADOS_CIERRE_BLOQUEAN_GESTION` pone rojos los tres casos de la
 * propiedad 3-a (verificado por mutación, ver `progress/investigacion_241.md`).
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

/** LOS TRES ESTADOS ABIERTOS, que es el eje de todo este archivo. */
const ESTADOS_ABIERTOS = ["solicitado", "vencido", "rechazado"] as const;
type EstadoAbierto = (typeof ESTADOS_ABIERTOS)[number];

/**
 * Repositorio REAL sobre un Prisma que filtra de verdad: el mensajero `m1` tiene UN cierre en
 * `estado` y nada más. Un solo cierre abierto es, además, lo único que el invariante 109/R30
 * permite.
 */
function repoConCierre(estado: EstadoAbierto): IOrdenRepository {
  const prisma = {
    cierreDia: {
      findMany: vi.fn(async (args: { where: { estado: { in: string[] } } }) =>
        args.where.estado.in.includes(estado) ? [{ mensajeroId: "m1" }] : [],
      ),
    },
  };
  return new OrdenRepository(prisma as unknown as PrismaClient);
}

// =================================================================================================
// PROPIEDAD 3 — GESTIONAR Y COBRAR: `solicitado` sí, `vencido` y `rechazado` no.
// =================================================================================================

describe("241 · propiedad 3 — GESTIONAR y COBRAR", () => {
  /**
   * `MisAsignacionesService.escogerParaGestion`, que es el camino más corto a la guarda de
   * gestionar/recoger/escoger: si NO bloquea, el servicio sigue y se topa con la orden inexistente
   * (`forbidden`). Los dos resultados son distinguibles, así que el caso no puede pasar por
   * vacuidad — «no bloqueó» no se confunde con «no llegó a mirar».
   */
  function servicioDeGestion(estado: EstadoAbierto) {
    const repoGestion = {
      findByIdsParaGestion: vi.fn(async () => []),
      getOrdenEnGestion: vi.fn(async () => null),
      setOrdenEnGestion: vi.fn(async () => true),
    };
    const service = new MisAsignacionesService(
      repoGestion as never,
      repoConCierre(estado),
      { upload: vi.fn(), remove: vi.fn() } as never,
      { createSignedUrl: vi.fn(), createSignedUrls: vi.fn() } as never,
      { findByMensajero: vi.fn(async () => null), upsertOrigen: vi.fn() },
      { findMarcarLuegoByMensajero: vi.fn(async () => new Set<string>()) },
      { contarIntentosEnLote: vi.fn(async () => new Map<string, number>()) },
    );
    return { service, repoGestion };
  }

  it("3-a · con `solicitado` GESTIONA: la guarda no dispara y el servicio sigue adelante", async () => {
    const { service, repoGestion } = servicioDeGestion("solicitado");

    const r = await service.escogerParaGestion("o1", MENSAJERO);

    // NO es `conflict`: pasó la guarda. Que caiga en `forbidden` es la orden inexistente del
    // doble, y es la prueba de que el servicio SIGUIÓ — un `conflict` habría cortado antes.
    expect(r.status).toBe("forbidden");
    expect(repoGestion.findByIdsParaGestion).toHaveBeenCalled();
  });

  it.each([["vencido"], ["rechazado"]] as const)(
    "3-b · con `%s` NO gestiona: conflict, y sin llegar a leer la orden",
    async (estado) => {
      const { service, repoGestion } = servicioDeGestion(estado);

      const r = await service.escogerParaGestion("o1", MENSAJERO);

      expect(r.status).toBe("conflict");
      if (r.status === "conflict") expect(r.motivo).toMatch(/cierre pendiente/i);
      // Sin efectos parciales: la guarda está ANTES de cualquier lectura.
      expect(repoGestion.findByIdsParaGestion).not.toHaveBeenCalled();
      expect(repoGestion.setOrdenEnGestion).not.toHaveBeenCalled();
    },
  );

  /** La recolección en tienda es COBRAR, así que le toca la misma política (157/R31). */
  function servicioDeRecoleccion(estado: EstadoAbierto) {
    const findByNumGuiaForTransicion = vi.fn(async () => null);
    const service = new RecoleccionTiendaService(
      Object.assign(Object.create(repoConCierre(estado)) as IOrdenRepository, {
        findByNumGuiaForTransicion,
      }),
      { findMisAsignaciones: vi.fn(async () => []), findMisAsignacionesByIds: vi.fn(async () => []) },
      { findRecoleccionesDeActor: vi.fn(async () => []) },
    );
    return { service, findByNumGuiaForTransicion };
  }

  it("3-a · recolección en tienda con `solicitado`: pasa la guarda y busca la guía", async () => {
    const { service, findByNumGuiaForTransicion } = servicioDeRecoleccion("solicitado");

    const r = await service.recolectarEnTienda(1234, MENSAJERO);

    expect(r.status).toBe("no_encontrada"); // llegó a buscarla, que es el punto
    expect(findByNumGuiaForTransicion).toHaveBeenCalledWith(1234);
  });

  it.each([["vencido"], ["rechazado"]] as const)(
    "3-b · recolección en tienda con `%s`: conflict sin llegar a saber si la guía existe",
    async (estado) => {
      const { service, findByNumGuiaForTransicion } = servicioDeRecoleccion(estado);

      const r = await service.recolectarEnTienda(1234, MENSAJERO);

      expect(r.status).toBe("conflict");
      expect(findByNumGuiaForTransicion).not.toHaveBeenCalled();
    },
  );

  /** `deshacerGestion` (111/R5, Q2 cerrada por el humano con un «SÍ» explícito). */
  function servicioDeDeshacer(estado: EstadoAbierto) {
    const findGestionParaDeshacer = vi.fn(async () => null);
    const service = new CierreDiaService(
      { findGestionParaDeshacer } as never,
      { findCentralZonaId: vi.fn(async () => ZONA_CENTRAL) },
      repoConCierre(estado),
      { createSignedUrl: vi.fn(), createSignedUrls: vi.fn() } as never,
      {} as never,
    );
    return { service, findGestionParaDeshacer };
  }

  it("3-a · deshacer gestión con `solicitado`: pasa la guarda y busca la gestión", async () => {
    const { service, findGestionParaDeshacer } = servicioDeDeshacer("solicitado");

    const r = await service.deshacerGestion("00000000-0000-4000-8000-000000000000", MENSAJERO);

    expect(r.status).toBe("forbidden"); // gestión inexistente: llegó hasta ahí
    expect(findGestionParaDeshacer).toHaveBeenCalled();
  });

  it.each([["vencido"], ["rechazado"]] as const)(
    "3-b · deshacer gestión con `%s`: conflict sin tocar la gestión",
    async (estado) => {
      const { service, findGestionParaDeshacer } = servicioDeDeshacer(estado);

      const r = await service.deshacerGestion("00000000-0000-4000-8000-000000000000", MENSAJERO);

      expect(r.status).toBe("conflict");
      expect(findGestionParaDeshacer).not.toHaveBeenCalled();
    },
  );
});

// =================================================================================================
// PROPIEDAD 2 — RECIBIR ASIGNACIONES: con CUALQUIERA de los tres estados, se asigna.
// =================================================================================================

describe("241 · propiedad 2 — RECIBIR ASIGNACIONES no se bloquea con ningún estado", () => {
  const ordenBodega: OrdenTransicionRow = {
    id: "o1",
    estatusValue: "en_bodega_central",
    numGuia: 4321,
    deletedAt: null,
    zonaId: ZONA_CENTRAL,
    zonaEsGam: true,
    tiendaId: "store-1",
  };

  const gateTodoAsignable: IAsignabilidadCoordenadasService = {
    evaluar: async (ordenes: OrdenAsignabilidadRow[]) =>
      new Map<string, EstadoAsignabilidad>(ordenes.map((o) => [o.id, "asignable"])),
  };

  /**
   * El repositorio REAL sigue detrás (por eso el estado del cierre es una entrada de verdad), con
   * los métodos de escritura y catálogo puestos encima. Si alguna de estas dos acciones volviera a
   * consultar el predicado, lo consultaría contra los datos reales del caso.
   */
  function repoDeAsignacion(estado: EstadoAbierto, extra: Record<string, unknown>) {
    return Object.assign(Object.create(repoConCierre(estado)) as IOrdenRepository, {
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

  it.each(ESTADOS_ABIERTOS.map((e) => [e]))(
    "asignarDesdeBodega a un mensajero con cierre `%s` -> ok y persiste",
    async (estado) => {
      const asignarBodegaLote = vi.fn(async (ids: string[]) => ids.length);
      const repo = repoDeAsignacion(estado, {
        findByIdsForTransicion: vi.fn(async () => [ordenBodega]),
        asignarBodegaLote,
      });
      const service = new GuiaAsignacionService(
        repo,
        { findCentralZonaId: vi.fn(async () => ZONA_CENTRAL) } as unknown as IZonaRepository,
        gateTodoAsignable,
      );

      const r = await service.asignarDesdeBodega({ ordenIds: ["o1"], mensajeroId: "m1" }, MAESTRO);

      expect(r.status).toBe("ok");
      expect(asignarBodegaLote).toHaveBeenCalledTimes(1);
    },
  );

  it.each(ESTADOS_ABIERTOS.map((e) => [e]))(
    "asignación SATÉLITE a un mensajero con cierre `%s` -> ok y persiste",
    async (estado) => {
      // El caso del fallo vivo (§4.2): aquí la lectura decía «pasa» y la escritura devolvía 0
      // filas por su propio `NOT EXISTS`. El doble de `asignarSateliteLote` no puede reproducir
      // eso —por eso el SQL se mide en `orden-repository.asignacion-satelite.test.ts`—, pero esta
      // mitad afirma que el SERVICIO no vuelve a rechazarlo antes de escribir.
      const asignarSateliteLote = vi.fn(async () => 1);
      const repo = repoDeAsignacion(estado, {
        findUsuarioZonaId: vi.fn(async () => ZONA_SATELITE),
        findByIdsForTransicion: vi.fn(async () => [
          { ...ordenBodega, estatusValue: "en_bodega_satelite", zonaId: ZONA_SATELITE, zonaEsGam: false },
        ]),
        existeBodegaSateliteBloqueada: vi.fn(async () => ({
          bloqueada: false,
          porMensajeros: true, // hay cierres abiertos: informativo, NO veto
          porCierreBodega: false,
        })),
        asignarSateliteLote,
      });
      const service = new AsignacionSateliteService(repo, gateTodoAsignable);

      const r = await service.asignar({ ordenIds: ["o1"], mensajeroId: "m1" }, ADMIN_SATELITE);

      expect(r.status).toBe("ok");
      expect(asignarSateliteLote).toHaveBeenCalledTimes(1);
    },
  );

  it.each(ESTADOS_ABIERTOS.map((e) => [e]))(
    "asignarRecoleccion a un mensajero con cierre `%s` -> ok y persiste",
    async (estado) => {
      const asignarRecoleccionLote = vi.fn(async (ids: string[]) => ids.length);
      const repo = repoDeAsignacion(estado, {
        findByIdsForTransicion: vi.fn(async () => [
          { ...ordenBodega, estatusValue: "por_recolectar_en_tienda" },
        ]),
        asignarRecoleccionLote,
      });
      const service = new GuiaAsignacionService(
        repo,
        { findCentralZonaId: vi.fn(async () => ZONA_CENTRAL) } as unknown as IZonaRepository,
        gateTodoAsignable,
      );

      const r = await service.asignarRecoleccion({ ordenIds: ["o1"], mensajeroId: "m1" }, MAESTRO);

      expect(r.status).toBe("ok");
      expect(asignarRecoleccionLote).toHaveBeenCalledTimes(1);
    },
  );
});

// =================================================================================================
// ANTI-VACUIDAD — el instrumento se prueba a sí mismo.
// =================================================================================================

describe("241 · control: el doble de Prisma FILTRA de verdad", () => {
  // Sin esto, todo lo de arriba pasaría igual con un doble que devolviera siempre vacío: «no
  // bloqueó» y «ni siquiera se preguntó» son verdes indistinguibles. Aquí se comprueba, contra el
  // repositorio real, que el mismo instrumento da las DOS respuestas según el estado.
  it("el MISMO montaje bloquea con `vencido` y no bloquea con `solicitado`", async () => {
    const conVencido = await repoConCierre("vencido").findMensajerosBloqueadosParaGestion(["m1"]);
    const conSolicitado = await repoConCierre("solicitado").findMensajerosBloqueadosParaGestion([
      "m1",
    ]);

    expect(conVencido).toEqual(new Set(["m1"]));
    expect(conSolicitado).toEqual(new Set());
    // Y las dos respuestas son distintas, que es lo único que hace informativos los casos de arriba.
    expect(conVencido).not.toEqual(conSolicitado);
  });
});
