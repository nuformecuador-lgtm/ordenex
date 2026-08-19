import { describe, it, expect, vi } from "vitest";

import { prepararConteoEntregas, type ConsultaConteoEntregas } from "@/lib/analytics/entregas-conteo";
import { CONTEO_ENTREGAS_CACHE_TTL_SEGUNDOS } from "@/lib/config/conteo-entregas-cache";
import type { IAnaliticaCache } from "@/lib/interfaces/external/IAnaliticaCache";
import type { IConteoEntregasRepository } from "@/lib/interfaces/repositories/IConteoEntregasRepository";
import { ConteoEntregasService } from "@/lib/services/ConteoEntregasService";

const AHORA = new Date("2026-08-17T12:00:00.000Z");

function consultaDe(raw: object = { rango: "semana" }): ConsultaConteoEntregas {
  const preparada = prepararConteoEntregas(raw, { usuarioId: "u1", rol: "maestro" }, AHORA);
  if (preparada.status !== "ok") throw new Error("filtro de prueba inválido");
  return preparada.consulta;
}

function repoQueDevuelve(porDesenlace: Record<string, number>): IConteoEntregasRepository {
  return { contar: vi.fn().mockResolvedValue({ porDesenlace }) };
}

/** Los seis buckets, con los que no se nombren en cero. */
function seis(parcial: Record<string, number>): Record<string, number> {
  return { entregada: 0, devuelta: 0, rechazada: 0, reprogramada: 0, incidente: 0, otros: 0, ...parcial };
}

/**
 * Caché de MENTIRA con memoria real: guarda por clave y sirve lo guardado sin volver a
 * ejecutar el productor. Es lo mínimo para poder afirmar que `lastSync` se sella DENTRO y no
 * fuera — con una caché pass-through ese caso no existiría y el defecto pasaría vivo.
 */
function cacheConMemoria() {
  const entradas = new Map<string, unknown>();
  const ejecuciones: string[] = [];
  const cache: IAnaliticaCache = {
    async envolver(clave, _tags, producir) {
      if (entradas.has(clave)) return entradas.get(clave) as never;
      ejecuciones.push(clave);
      const valor = await producir();
      entradas.set(clave, valor);
      return valor;
    },
    async invalidar() {},
  };
  return { cache, entradas, ejecuciones };
}

describe("Servicio del conteo — las tres cifras", () => {
  // El total se DERIVA sumando los seis buckets. Eso hace que «suma de segmentos = total» sea
  // cierto por construcción y no por coincidencia de dos consultas independientes.
  it("el total es la suma de los seis buckets", async () => {
    const service = new ConteoEntregasService(
      repoQueDevuelve(seis({ entregada: 20, devuelta: 5, rechazada: 3, reprogramada: 7, incidente: 1, otros: 64 })),
      cacheConMemoria().cache,
      { now: () => AHORA },
    );

    const datos = await service.consultar(consultaDe());

    expect(datos.porDesenlace.entregada).toBe(20);
    expect(datos.porDesenlace.devuelta).toBe(5);
    expect(datos.total).toBe(100);
    expect(Object.values(datos.porDesenlace).reduce((s, n) => s + n, 0)).toBe(datos.total);
  });

  // Ceros reales, nunca `null`: el universo es la tabla `orden` viva y siempre hay respuesta.
  it("un universo vacío son seis ceros, no seis `null`", async () => {
    const service = new ConteoEntregasService(repoQueDevuelve(seis({})), cacheConMemoria().cache, {
      now: () => AHORA,
    });

    const datos = await service.consultar(consultaDe());
    expect(datos.total).toBe(0);
    expect(Object.values(datos.porDesenlace)).toHaveLength(6);
    expect(Object.values(datos.porDesenlace).every((n) => n === 0)).toBe(true);
  });
});

describe("Servicio del conteo — el sello `lastSync`", () => {
  it("es un ISO-8601 y sale del reloj inyectado, no de `Date.now()`", async () => {
    const service = new ConteoEntregasService(repoQueDevuelve(seis({ entregada: 1, otros: 1 })), cacheConMemoria().cache, {
      now: () => AHORA,
    });

    expect((await service.consultar(consultaDe())).lastSync).toBe("2026-08-17T12:00:00.000Z");
  });

  /**
   * EL CASO QUE JUSTIFICA TODO EL DISEÑO DEL SELLO. Se sella DENTRO del productor, que es el
   * único código que corre en un fallo de caché. Si se sellara fuera —sobre el valor ya
   * devuelto— escribiría la hora del render en cada ACIERTO, que son todas las peticiones
   * menos la primera de cada ventana de 15 min: la pantalla juraría que la cifra es de este
   * segundo llevando hasta un cuarto de hora de retraso.
   */
  it("con la caché caliente NO se refresca: dice cuándo se LEYÓ, no cuándo se sirvió", async () => {
    const { cache, ejecuciones } = cacheConMemoria();
    let reloj = new Date("2026-08-17T12:00:00.000Z");
    const repo = repoQueDevuelve(seis({ entregada: 20, otros: 80 }));
    const service = new ConteoEntregasService(repo, cache, { now: () => reloj });

    const primera = await service.consultar(consultaDe());

    // Diez minutos después, dentro del TTL de 15.
    reloj = new Date("2026-08-17T12:10:00.000Z");
    const segunda = await service.consultar(consultaDe());

    expect(segunda.lastSync).toBe(primera.lastSync);
    expect(segunda.lastSync).toBe("2026-08-17T12:00:00.000Z");
    // Y la base se tocó UNA sola vez: la caché es de verdad, no un adorno.
    expect(repo.contar).toHaveBeenCalledTimes(1);
    expect(ejecuciones).toHaveLength(1);
  });

  it("el sello viaja DENTRO del valor cacheado", async () => {
    const { cache, entradas } = cacheConMemoria();
    const service = new ConteoEntregasService(repoQueDevuelve(seis({ entregada: 1, otros: 1 })), cache, { now: () => AHORA });

    await service.consultar(consultaDe());

    expect([...entradas.values()][0]).toMatchObject({ lastSync: "2026-08-17T12:00:00.000Z" });
  });
});

describe("Servicio del conteo — la clave de caché", () => {
  // Sin el alcance en la clave, la entrada que se cacheó para un admin la serviría un
  // adminTienda. No es una cifra equivocada: es una fuga entre inquilinos.
  it("dos alcances distintos NO comparten entrada", async () => {
    const { cache, ejecuciones } = cacheConMemoria();
    const service = new ConteoEntregasService(repoQueDevuelve(seis({ entregada: 1, otros: 1 })), cache, { now: () => AHORA });
    const base = consultaDe();

    await service.consultar({ ...base, alcance: { tipo: "global" } });
    await service.consultar({ ...base, alcance: { tipo: "tienda", tiendaId: "t1" } });

    expect(ejecuciones).toHaveLength(2);
    expect(new Set(ejecuciones).size).toBe(2);
  });

  it("dos filtros distintos NO comparten entrada, y el mismo filtro SÍ", async () => {
    const { cache, ejecuciones } = cacheConMemoria();
    const service = new ConteoEntregasService(repoQueDevuelve(seis({ entregada: 1, otros: 1 })), cache, { now: () => AHORA });

    await service.consultar(consultaDe({ rango: "semana", zona_id: ["z1"] }));
    await service.consultar(consultaDe({ rango: "semana", zona_id: ["z2"] }));
    await service.consultar(consultaDe({ rango: "semana", zona_id: ["z1"] }));

    expect(ejecuciones).toHaveLength(2);
  });
});

describe("El TTL pedido", () => {
  // 15 minutos, pedidos explícitamente por el humano el 2026-08-17. Vive en UNA constante:
  // ajustarlo debe ser un one-liner con su test, no una cacería de números sueltos.
  it("son 900 segundos = 15 minutos", () => {
    expect(CONTEO_ENTREGAS_CACHE_TTL_SEGUNDOS).toBe(900);
    expect(CONTEO_ENTREGAS_CACHE_TTL_SEGUNDOS).toBe(15 * 60);
  });
});
