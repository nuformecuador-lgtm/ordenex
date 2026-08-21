import { describe, expect, it } from "vitest";

import { MAX_PUNTOS_SERIE } from "@/components/private/analytics/topes";
import { TableroDiaCacheMemoria } from "@/lib/cache/tablero-dia-cache-memoria";
import type { EntregasEnHora } from "@/lib/interfaces/repositories/ITableroDiaRepository";
import { TableroDiaService, acumularPorHora } from "@/lib/services/TableroDiaService";
import type { TableroDia } from "@/lib/types/tablero-dia";

import { RepositorioDoble, fila } from "./_doble-tablero-dia";

// Feature 258 (B4.3) — R50, R52, R54, R56, R57.
//
// La serie de entregas ACUMULADAS la arma el servicio a partir del HISTOGRAMA que devuelve el
// repositorio: rellena las horas sin entregas, acumula y corta en la hora de pared del
// instante de lectura. Todo eso es aritmetica pura y se prueba sin base y sin Next.
//
// ⚠ LO QUE ESTE ARCHIVO NO PUEDE DEMOSTRAR: que el `WHERE` y el corte horario del SQL
// produzcan el histograma correcto. Un test de servicio con dobles NO VE EL SQL: el doble
// devuelve lo que le digamos. La correccion de la consulta se prueba contra Postgres real en
// `tests/integration/tablero-dia-ritmo.test.ts`.

/** 19:00 UTC = 13:00 hora de PARED de Costa Rica: la hora de corte es la 13. */
const AHORA = new Date("2026-08-08T19:00:00.000Z");
const HORA_CORTE = 13;
const ADMIN = { usuarioId: "u-1", rol: "admin", zonaId: null };
const MENSAJERO = { usuarioId: "u-2", rol: "mensajero", zonaId: null };

function servicioCon(
  filas: ReturnType<typeof fila>[],
  histograma: EntregasEnHora[],
): { service: TableroDiaService; repo: RepositorioDoble } {
  const repo = new RepositorioDoble(
    () => filas,
    () => ({ ordenes: [], total: 0 }),
    () => histograma,
  );
  return { service: new TableroDiaService(repo), repo };
}

async function tableroDe(
  filas: ReturnType<typeof fila>[],
  histograma: EntregasEnHora[],
  now: Date = AHORA,
): Promise<TableroDia> {
  const { service } = servicioCon(filas, histograma);
  const resultado = await service.obtener(ADMIN, now);
  if (resultado.estado !== "ok") throw new Error("se esperaba ok");
  return resultado.tablero;
}

describe("TableroDiaService — la serie de entregas acumuladas (R50)", () => {
  it("publica la serie DENTRO del tablero, junto a los conteos", async () => {
    const tablero = await tableroDe([fila("m1", "Ana", { entregadas: 2 })], [{ hora: 8, entregadas: 2 }]);

    expect(Array.isArray(tablero.ritmoEntregas)).toBe(true);
    expect(tablero.ritmoEntregas.length).toBeGreaterThan(0);
  });

  it("cubre SIN HUECOS las horas 0..H, donde H es la hora de pared del instante de lectura (R54)", async () => {
    const tablero = await tableroDe(
      [fila("m1", "Ana", { entregadas: 3 })],
      [
        { hora: 7, entregadas: 1 },
        { hora: 11, entregadas: 2 },
      ],
    );

    expect(tablero.ritmoEntregas.map((p) => p.hora)).toEqual(
      Array.from({ length: HORA_CORTE + 1 }, (_, h) => h),
    );
  });

  it("es MONOTONA no decreciente y acumula de verdad (R54)", async () => {
    const tablero = await tableroDe(
      [fila("m1", "Ana", { entregadas: 6 })],
      [
        { hora: 7, entregadas: 1 },
        { hora: 8, entregadas: 2 },
        { hora: 11, entregadas: 3 },
      ],
    );

    const acumulados = tablero.ritmoEntregas.map((p) => p.acumulado);
    for (let i = 1; i < acumulados.length; i += 1) {
      expect(acumulados[i]).toBeGreaterThanOrEqual(acumulados[i - 1]);
    }
    // Los escalones caen donde el histograma dice, no repartidos a ojo.
    expect(tablero.ritmoEntregas[6].acumulado).toBe(0);
    expect(tablero.ritmoEntregas[7].acumulado).toBe(1);
    expect(tablero.ritmoEntregas[8].acumulado).toBe(3);
    expect(tablero.ritmoEntregas[10].acumulado).toBe(3);
    expect(tablero.ritmoEntregas[11].acumulado).toBe(6);
  });

  it("el ULTIMO punto es exactamente `totales.entregadas` del MISMO tablero (R52)", async () => {
    const tablero = await tableroDe(
      [
        fila("m1", "Ana", { entregadas: 4, sinRecoger: 1 }),
        fila("m2", "Beto", { entregadas: 2, reprogramadas: 3 }),
      ],
      [
        { hora: 6, entregadas: 2 },
        { hora: 9, entregadas: 1 },
        { hora: 12, entregadas: 3 },
      ],
    );

    const ultimo = tablero.ritmoEntregas[tablero.ritmoEntregas.length - 1];
    expect(ultimo.acumulado).toBe(tablero.totales.entregadas);
    expect(ultimo.acumulado).toBe(6);
    expect(ultimo.hora).toBe(HORA_CORTE);
  });

  it("un dia SIN ninguna entrega devuelve la serie completa a cero, no una lista vacia (R59)", async () => {
    const tablero = await tableroDe([fila("m1", "Ana", { sinRecoger: 3 })], []);

    expect(tablero.ritmoEntregas).toHaveLength(HORA_CORTE + 1);
    expect(tablero.ritmoEntregas.every((p) => p.acumulado === 0)).toBe(true);
    // Que no se dibuje una linea plana a cero lo decide la PRESENTACION (R59), no el contrato:
    // el servicio sigue diciendo la verdad, que es que a cada hora del dia llevaba 0.
    expect(tablero.totales.entregadas).toBe(0);
  });

  it("a las 00:30 de pared CR la serie tiene UN solo punto: la hora 0", async () => {
    const tablero = await tableroDe(
      [fila("m1", "Ana", { entregadas: 1 })],
      [{ hora: 0, entregadas: 1 }],
      new Date("2026-08-08T06:30:00.000Z"),
    );

    expect(tablero.ritmoEntregas).toEqual([{ hora: 0, acumulado: 1 }]);
    expect(tablero.fecha).toBe("2026-08-08");
  });

  it("a las 23:59 de pared CR la serie tiene los 24 puntos del dia — y ni uno mas (tope del paquete)", async () => {
    const tablero = await tableroDe(
      [fila("m1", "Ana", { entregadas: 1 })],
      [{ hora: 23, entregadas: 1 }],
      new Date("2026-08-09T05:59:00.000Z"),
    );

    expect(tablero.ritmoEntregas).toHaveLength(24);
    expect(tablero.ritmoEntregas[23]).toEqual({ hora: 23, acumulado: 1 });

    // El caso PEOR del dia entra en el paquete de graficas SIN RECORTE, comprobado contra su
    // constante y no supuesto: `aplicarTopePuntos` recorta —y fuera de produccion LANZA— por
    // encima de `MAX_PUNTOS_SERIE`. Si alguien bajara ese tope o cambiara el grano de la serie
    // a minutos, este test se pone rojo aqui y no en la pantalla.
    expect(MAX_PUNTOS_SERIE).toBe(62);
    expect(tablero.ritmoEntregas.length).toBeLessThanOrEqual(MAX_PUNTOS_SERIE);
  });

  it("`generadoAt` es UNO SOLO para los conteos y para la serie (R57)", async () => {
    const { service, repo } = servicioCon(
      [fila("m1", "Ana", { entregadas: 1 })],
      [{ hora: 5, entregadas: 1 }],
    );
    const resultado = await service.obtener(ADMIN, AHORA);
    if (resultado.estado !== "ok") throw new Error("se esperaba ok");

    expect(resultado.tablero.generadoAt).toBe(AHORA.toISOString());
    // Y las dos lecturas se hicieron sobre la MISMA ventana: si cada una calculara la suya, la
    // linea y los contadores podrian estar hablando de dias distintos en el cambio de fecha.
    expect(repo.ritmos).toHaveLength(1);
    expect(repo.ritmos[0].ventana).toEqual(repo.conteos[0].ventana);
    expect(repo.ritmos[0].filtro).toEqual(repo.conteos[0].filtro);
  });

  it("un acierto de cache NO vuelve a llamar a `contarEntregasPorHora` (R57)", async () => {
    const repo = new RepositorioDoble(
      () => [fila("m1", "Ana", { entregadas: 1 })],
      () => ({ ordenes: [], total: 0 }),
      () => [{ hora: 5, entregadas: 1 }],
    );
    let ahora = AHORA.getTime();
    const cache = new TableroDiaCacheMemoria({ ahora: () => ahora });
    const service = new TableroDiaService(repo, cache);

    const primera = await service.obtener(ADMIN, new Date(ahora));
    ahora += 5_000;
    const segunda = await service.obtener(ADMIN, new Date(ahora));

    expect(repo.conteos).toHaveLength(1);
    expect(repo.ritmos).toHaveLength(1);
    if (primera.estado !== "ok" || segunda.estado !== "ok") throw new Error("se esperaba ok");
    // El acierto sirve la MISMA serie y el MISMO instante: la pantalla no miente sobre su
    // frescura ni por los contadores ni por la linea.
    expect(segunda.tablero.ritmoEntregas).toEqual(primera.tablero.ritmoEntregas);
    expect(segunda.tablero.generadoAt).toBe(primera.tablero.generadoAt);
  });

  it("un actor DENEGADO no llama al repositorio ni una sola vez (R56)", async () => {
    const { service, repo } = servicioCon(
      [fila("m1", "Ana", { entregadas: 1 })],
      [{ hora: 5, entregadas: 1 }],
    );

    const resultado = await service.obtener(MENSAJERO, AHORA);

    expect(resultado).toEqual({ estado: "denegado", motivo: "rol_no_autorizado" });
    expect(repo.conteos).toEqual([]);
    expect(repo.ritmos).toEqual([]);
  });

  it("sin sesion tampoco se ejecuta la consulta de la serie (R56)", async () => {
    const { service, repo } = servicioCon([], [{ hora: 5, entregadas: 1 }]);

    const resultado = await service.obtener(null, AHORA);

    expect(resultado.estado).toBe("denegado");
    expect(repo.ritmos).toEqual([]);
  });

  it("la serie se recorta con el MISMO filtro de alcance que los conteos (R55)", async () => {
    const repo = new RepositorioDoble(
      () => [],
      () => ({ ordenes: [], total: 0 }),
      () => [],
    );
    const service = new TableroDiaService(repo);

    await service.obtener({ usuarioId: "u-3", rol: "adminSatelite", zonaId: "z-9" }, AHORA);

    expect(repo.ritmos).toHaveLength(1);
    expect(repo.ritmos[0].filtro).toEqual({ tipo: "zona", zonaId: "z-9" });
    expect(repo.ritmos[0].filtro).toEqual(repo.conteos[0].filtro);
  });
});

describe("acumularPorHora — la funcion pura (B4.1)", () => {
  it("con el histograma vacio devuelve 0..horaCorte a cero", () => {
    expect(acumularPorHora([], 3)).toEqual([
      { hora: 0, acumulado: 0 },
      { hora: 1, acumulado: 0 },
      { hora: 2, acumulado: 0 },
      { hora: 3, acumulado: 0 },
    ]);
  });

  it("con horaCorte 0 devuelve UN punto, no una lista vacia", () => {
    expect(acumularPorHora([{ hora: 0, entregadas: 2 }], 0)).toEqual([{ hora: 0, acumulado: 2 }]);
  });

  it("suma las horas repetidas en vez de quedarse con la ultima", () => {
    expect(
      acumularPorHora(
        [
          { hora: 1, entregadas: 2 },
          { hora: 1, entregadas: 3 },
        ],
        1,
      ),
    ).toEqual([
      { hora: 0, acumulado: 0 },
      { hora: 1, acumulado: 5 },
    ]);
  });

  it("no depende del orden en que venga el histograma", () => {
    const desordenado = acumularPorHora(
      [
        { hora: 3, entregadas: 1 },
        { hora: 1, entregadas: 2 },
      ],
      3,
    );
    const ordenado = acumularPorHora(
      [
        { hora: 1, entregadas: 2 },
        { hora: 3, entregadas: 1 },
      ],
      3,
    );
    expect(desordenado).toEqual(ordenado);
    expect(desordenado[3].acumulado).toBe(3);
  });

  it("una hora POR ENCIMA del corte se pliega en el ultimo punto: el total no se pierde (R52)", () => {
    // Solo pasa por desfase entre el reloj de la aplicacion y el de la base. Descartarla
    // romperia R52 (el ultimo punto dejaria de ser `totales.entregadas`) y ampliar la serie
    // hasta esa hora romperia R54 (llegaria mas alla de la hora de pared).
    const serie = acumularPorHora(
      [
        { hora: 2, entregadas: 1 },
        { hora: 9, entregadas: 4 },
      ],
      3,
    );
    expect(serie).toHaveLength(4);
    expect(serie[serie.length - 1].acumulado).toBe(5);
  });
});
