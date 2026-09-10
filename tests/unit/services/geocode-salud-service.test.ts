import { describe, it, expect, vi } from "vitest";
import { GeocodeSaludService, hayCaida } from "@/lib/services/GeocodeSaludService";
import type { GeocodeSaludConfig } from "@/lib/config/geocode-salud";
import type {
  IGeocodeSaludRepository,
  RevivirFallosConfigOpts,
} from "@/lib/interfaces/repositories/IGeocodeSaludRepository";
import { esFalloConfigGeocode, marcarFalloConfigGeocode } from "@/lib/geo/fallo-config-geocode";
import type { GeocodificacionCaidaContexto } from "@/lib/notificaciones/emitir";

// FICHA 401 (T10) — LA REGLA: cuándo se considera que la geocodificación está caída por
// configuración NUESTRA, y qué se le pide al repositorio para recuperarla.
//
// Cubre R1, R2, R3, R4, R5, R11, R22, R24 y R26. Lo que NO se puede medir aquí —el `WHERE` real
// de las dos sentencias— vive en `tests/integration/db/geocode-recuperacion.test.ts`, contra
// Postgres: medido cuatro veces en este repo, una mutación del `WHERE` pasa en verde con dobles.

const AHORA = new Date("2026-09-08T21:00:00.000Z");
const CREDENCIAL_DE_PRUEBA = "AIzaSyClaveDePruebaQueNuncaDebeAparecer";

const CONFIG: GeocodeSaludConfig = {
  GEOCODE_CAIDA_JOBS_MINIMOS: 3,
  GEOCODE_CAIDA_VENTANA_MIN: 60,
  GEOCODE_RECUPERACION_LOTE: 5,
  GEOCODE_RECUPERACION_ESPACIADO_MS: 60_000,
  GEOCODE_RECUPERACION_ENFRIAMIENTO_MIN: 60,
};

interface Dobles {
  service: GeocodeSaludService;
  contar: ReturnType<typeof vi.fn>;
  revivir: ReturnType<typeof vi.fn>;
  avisos: GeocodificacionCaidaContexto[];
  logs: string[];
}

function build(
  opts: {
    /** Cuántos OTROS jobs (sin contar el job en curso) devuelve el repositorio. */
    otros?: number;
    revividos?: number;
    config?: Partial<GeocodeSaludConfig>;
    contarLanza?: Error;
    revivirLanza?: Error;
    notificarLanza?: Error;
  } = {},
): Dobles {
  const contar = vi.fn(async () => {
    if (opts.contarLanza) throw opts.contarLanza;
    return opts.otros ?? 0;
  });
  const revivir = vi.fn(async () => {
    if (opts.revivirLanza) throw opts.revivirLanza;
    return opts.revividos ?? 0;
  });
  const repo: IGeocodeSaludRepository = {
    contarFallosConfigDesde: contar as unknown as IGeocodeSaludRepository["contarFallosConfigDesde"],
    revivirFallosConfig: revivir as unknown as IGeocodeSaludRepository["revivirFallosConfig"],
  };
  const avisos: GeocodificacionCaidaContexto[] = [];
  const logs: string[] = [];
  const service = new GeocodeSaludService(
    repo,
    { ...CONFIG, ...opts.config },
    async (ctx) => {
      if (opts.notificarLanza) throw opts.notificarLanza;
      avisos.push(ctx);
    },
    { warn: (m) => logs.push(m) },
    () => AHORA,
  );
  return { service, contar, revivir, avisos, logs };
}

// ---------------------------------------------------------------------------
// R1 — la evidencia se cuenta con el detector de la 400, y con nada más
// ---------------------------------------------------------------------------

describe("401/R1 — el marcador de la 400 es la ÚNICA forma de reconocer el fallo", () => {
  it("⭑ un `lastError` con la prosa legada SIN marcador NO es un fallo de configuración", () => {
    // La prosa que se escribía antes de la 400, tal cual. Si esta ficha reconociera el caso por el
    // texto del mensaje, el primer cambio de copy lo rompería EN SILENCIO — y encima habría dos
    // mecanismos para lo mismo, que es justo lo que R1 prohíbe.
    const prosaLegada = "geocodificacion: el proveedor rechazo la peticion (REQUEST_DENIED)";
    expect(esFalloConfigGeocode(prosaLegada)).toBe(false);
  });

  it("⭑ y el MISMO texto, marcado por la 400, sí lo es: el detector es el que decide", () => {
    const marcado = marcarFalloConfigGeocode(
      "geocodificacion: el proveedor rechazo la peticion (REQUEST_DENIED)",
    );
    expect(esFalloConfigGeocode(marcado)).toBe(true);
  });

  it("el servicio no consulta al proveedor ni inspecciona prosa: sólo pregunta al repositorio", async () => {
    const d = build({ otros: 0 });
    await d.service.registrarFalloConfig("job-1", AHORA);
    // Un único colaborador de lectura, y su firma no admite ningún texto de error.
    expect(d.contar).toHaveBeenCalledTimes(1);
    expect(d.contar.mock.calls[0]).toHaveLength(2);
    expect(typeof d.contar.mock.calls[0][1]).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// R2 — jobs distintos, NO intentos
// ---------------------------------------------------------------------------

describe("401/R2 — se cuentan JOBS DISTINTOS, no intentos", () => {
  it("⭑ un solo job con 7 intentos fallidos con marcador NO cruza el umbral", async () => {
    // El repositorio cuenta FILAS: siete intentos del mismo job son UNA fila, así que `otros` = 0
    // y la cuenta con el job en curso es 1. Contando intentos, una sola orden cruzaría un umbral
    // de 3 en TRES MINUTOS (backoff 1-2-4 min) — el «fallo aislado» que R4 prohíbe avisar.
    const d = build({ otros: 0 });

    await d.service.registrarFalloConfig("job-unico", AHORA);

    expect(d.avisos).toEqual([]);
  });

  it("⭑ tres jobs DISTINTOS con un intento cada uno SÍ cruzan el umbral", async () => {
    // `otros` = 2 (dos jobs distintos ya registrados) + el job en curso = 3.
    const d = build({ otros: 2 });

    await d.service.registrarFalloConfig("job-3", AHORA);

    expect(d.avisos).toEqual([{ afectados: 3, diaCR: "2026-09-08" }]);
  });
});

// ---------------------------------------------------------------------------
// R3 — la matriz del umbral y la ventana
// ---------------------------------------------------------------------------

describe("401/R3 — matriz sobre el umbral", () => {
  it.each([
    [0, false],
    [1, false],
    [2, true],
    [7, true],
  ])("con %i otros jobs registrados, ¿avisa? %s", async (otros, esperaAviso) => {
    const d = build({ otros });
    await d.service.registrarFalloConfig("job-en-curso", AHORA);
    expect(d.avisos.length > 0).toBe(esperaAviso);
  });

  it("⭑ la VENTANA la aplica el `desde` de la consulta: `ahora − 60 min`, exacto", async () => {
    // Los fallos que quedan fuera de la ventana no entran en la cuenta porque no entran en la
    // CONSULTA. Que la ventana sea correcta es, por tanto, este parámetro — y por eso se afirma.
    const d = build({ otros: 0 });

    await d.service.registrarFalloConfig("job-1", AHORA);

    const [desde, excluido] = d.contar.mock.calls[0] as [Date, string];
    expect(desde.toISOString()).toBe("2026-09-08T20:00:00.000Z");
    expect(AHORA.getTime() - desde.getTime()).toBe(60 * 60_000);
    expect(excluido).toBe("job-1");
  });

  it("una ventana configurada distinta viaja tal cual al `desde`", async () => {
    const d = build({ otros: 0, config: { GEOCODE_CAIDA_VENTANA_MIN: 15 } });
    await d.service.registrarFalloConfig("job-1", AHORA);
    const [desde] = d.contar.mock.calls[0] as [Date];
    expect(desde.toISOString()).toBe("2026-09-08T20:45:00.000Z");
  });

  it("un umbral configurado distinto cambia el punto de corte", async () => {
    const conUmbral10 = build({ otros: 8, config: { GEOCODE_CAIDA_JOBS_MINIMOS: 10 } });
    await conUmbral10.service.registrarFalloConfig("job-9", AHORA);
    expect(conUmbral10.avisos).toEqual([]);

    const cruzado = build({ otros: 9, config: { GEOCODE_CAIDA_JOBS_MINIMOS: 10 } });
    await cruzado.service.registrarFalloConfig("job-10", AHORA);
    expect(cruzado.avisos).toEqual([{ afectados: 10, diaCR: "2026-09-08" }]);
  });

  it("la regla pura `hayCaida` es exactamente «alcanza el umbral», ni más ni menos", () => {
    expect(hayCaida(2, CONFIG)).toBe(false);
    expect(hayCaida(3, CONFIG)).toBe(true);
    expect(hayCaida(4, CONFIG)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// R4 — el fallo aislado y el off-by-one del job en curso
// ---------------------------------------------------------------------------

describe("401/R4 — un fallo de configuración AISLADO no emite nada", () => {
  it("⭑ con cero jobs previos, el aviso no sale (y sí se consultó: no es un no-op mudo)", async () => {
    const d = build({ otros: 0 });

    await d.service.registrarFalloConfig("job-solitario", AHORA);

    expect(d.contar).toHaveBeenCalledTimes(1);
    expect(d.avisos).toEqual([]);
    expect(d.logs).toEqual([]);
  });

  it("⭑ EL OFF-BY-ONE: con `umbral − 1` ya registrados, el job EN CURSO completa la cuenta", async () => {
    // El fallo del job en curso todavía NO está persistido (`fail()` corre después, en
    // `JobQueueService.manejarFallo`), así que la consulta lo EXCLUYE y el servicio suma 1. Sin
    // esa exclusión el umbral efectivo bailaría entre 2 y 4 según el intento.
    const d = build({ otros: 2 });

    await d.service.registrarFalloConfig("job-en-curso", AHORA);

    expect(d.contar.mock.calls[0][1]).toBe("job-en-curso"); // se excluye de la consulta
    expect(d.avisos).toEqual([{ afectados: 3, diaCR: "2026-09-08" }]); // y se suma como uno
  });
});

// ---------------------------------------------------------------------------
// R5 — ningún fallo ajeno a la configuración cuenta como evidencia
// ---------------------------------------------------------------------------

describe("401/R5 — los fallos AJENOS a la configuración no son evidencia de nada", () => {
  const AJENOS = [
    "geocodificacion: fallo de red",
    "geocodificacion: timeout de la peticion",
    "geocodificacion: HTTP 503 del proveedor",
    "geocodificacion: OVER_QUERY_LIMIT",
    "geocodificacion: estado desconocido del proveedor (UNKNOWN_ERROR)",
    "geocodificacion: respuesta con forma inesperada",
    "geocodificacion: payload invalido (se esperaba { ordenId })",
    "job sin handler registrado para el tipo geocodificacion",
  ];

  it.each(AJENOS)("⭑ «%s» NO lleva el marcador, así que la consulta no lo cuenta", (mensaje) => {
    expect(esFalloConfigGeocode(mensaje)).toBe(false);
  });

  it("⭑ CONTRAPRUEBA: un error ajeno que MENCIONE el marcador dentro de su texto tampoco cuenta", () => {
    // `startsWith` y no `includes`: es la razón por la que la 400 lo definió así, y esta ficha
    // hereda la propiedad porque usa su detector y no una regex propia.
    const citaElMarcador = `geocodificacion: fallo de red al reintentar ${marcarFalloConfigGeocode("x")}`;
    expect(esFalloConfigGeocode(citaElMarcador)).toBe(false);
  });

  it("⭑ y ninguno de ellos EMITE: la evaluación sólo se dispara desde la rama de configuración", async () => {
    // Un fallo ajeno ni siquiera llega a `registrarFalloConfig` (R6, medido en la suite de
    // `GeocodificacionService`). Aquí se fija la otra mitad: sin evidencia con marcador —`otros`
    // = 0 porque el `WHERE` no los cuenta— no hay aviso.
    const d = build({ otros: 0 });
    await d.service.registrarFalloConfig("job-1", AHORA);
    expect(d.avisos).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// R11 — el aviso no puede cambiar el desenlace del job
// ---------------------------------------------------------------------------

describe("401/R11 — un aviso que revienta queda registrado y NO se propaga", () => {
  it("⭑ con el notificador lanzando, `registrarFalloConfig` resuelve sin lanzar", async () => {
    const d = build({ otros: 5, notificarLanza: new Error("campana caida") });

    await expect(d.service.registrarFalloConfig("job-1", AHORA)).resolves.toBeUndefined();
  });

  it("⭑ y el fallo queda LOGUEADO con contexto: no es un `catch` vacío", async () => {
    const d = build({ otros: 5, notificarLanza: new Error("campana caida") });

    await d.service.registrarFalloConfig("job-1", AHORA);

    expect(d.logs).toHaveLength(1);
    expect(d.logs[0]).toContain("campana caida");
    expect(d.logs[0]).toContain("best-effort");
  });

  it("⭑ con el REPOSITORIO lanzando tampoco se propaga (la cola manda)", async () => {
    const d = build({ contarLanza: new Error("base caida") });

    await expect(d.service.registrarFalloConfig("job-1", AHORA)).resolves.toBeUndefined();
    expect(d.logs[0]).toContain("base caida");
    expect(d.avisos).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// R21/R22/R24 — los parámetros de la recuperación
// ---------------------------------------------------------------------------

describe("401/R21-R22-R24 — lo que el servicio le pide al repositorio para recuperar", () => {
  it("⭑ lote, espaciado y enfriamiento, los tres, afirmados A MANO", async () => {
    const d = build({ revividos: 5 });

    const n = await d.service.registrarExitoProveedor(AHORA);

    expect(n).toBe(5);
    expect(d.revivir).toHaveBeenCalledTimes(1);
    const opts = d.revivir.mock.calls[0][0] as RevivirFallosConfigOpts;
    expect(opts.ahora).toBe(AHORA);
    expect(opts.limite).toBe(5); // R21: nunca «todos de golpe»
    expect(opts.espaciadoMs).toBe(60_000); // R22: el intervalo del cron
    // R24: el enfriamiento, `ahora − 60 min`, para que un proveedor intermitente no pueda hacer
    // reintentar un mismo job sin fin.
    expect(opts.tocadoAntesDe.toISOString()).toBe("2026-09-08T20:00:00.000Z");
  });

  it("⭑ el lote nunca puede ser «todos»: no hay ninguna rama que omita el límite", async () => {
    for (const lote of [1, 5, 25]) {
      const d = build({ revividos: 0, config: { GEOCODE_RECUPERACION_LOTE: lote } });
      await d.service.registrarExitoProveedor(AHORA);
      const opts = d.revivir.mock.calls[0][0] as RevivirFallosConfigOpts;
      expect(opts.limite).toBe(lote);
      expect(Number.isFinite(opts.limite)).toBe(true);
    }
  });

  it("con cero revividos no se ensucia el log; con más de cero deja la huella forense", async () => {
    const vacio = build({ revividos: 0 });
    await vacio.service.registrarExitoProveedor(AHORA);
    expect(vacio.logs).toEqual([]);

    const conRevividos = build({ revividos: 3 });
    await conRevividos.service.registrarExitoProveedor(AHORA);
    expect(conRevividos.logs).toHaveLength(1);
    expect(conRevividos.logs[0]).toContain("recuperados 3");
  });

  it("R25: la recuperación NO se dispara desde `registrarFalloConfig`", async () => {
    // Mientras la geocodificación siga caída no se devuelve nada a la cola: revivir con el
    // proveedor todavía caído quemaría los 8 intentos de cada job.
    const d = build({ otros: 9 });
    await d.service.registrarFalloConfig("job-1", AHORA);
    expect(d.revivir).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// R26 — privacidad de los logs
// ---------------------------------------------------------------------------

describe("401/R26 — ningún log de esta ficha lleva PII ni secretos", () => {
  it("⭑ ninguna línea contiene la credencial de prueba, ni una dirección, ni un id de orden", async () => {
    const escenarios = [
      build({ otros: 9 }),
      build({ otros: 9, notificarLanza: new Error("campana caida") }),
      build({ contarLanza: new Error("base caida") }),
      build({ revividos: 4 }),
    ];
    for (const d of escenarios) {
      await d.service.registrarFalloConfig("orden-1", AHORA).catch(() => {});
      await d.service.registrarExitoProveedor(AHORA).catch(() => {});
      for (const linea of d.logs) {
        expect(linea).not.toContain(CREDENCIAL_DE_PRUEBA);
        expect(linea).not.toContain("Av. Central 100");
        expect(linea).not.toContain("orden-1");
        expect(linea).not.toContain("@");
        expect(linea).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
      }
    }
  });

  it("⭑ el aviso que sale lleva UN NÚMERO y UN DÍA, y nada más", async () => {
    const d = build({ otros: 24 });

    await d.service.registrarFalloConfig("orden-1", AHORA);

    expect(d.avisos).toHaveLength(1);
    expect(Object.keys(d.avisos[0]).sort()).toEqual(["afectados", "diaCR"]);
    expect(JSON.stringify(d.avisos[0])).not.toContain("orden-1");
  });

  it("⭑ el `diaCR` es la JORNADA DE COSTA RICA, no el día UTC", async () => {
    // A las 21:00Z del 8-sep en CR (UTC-6) son las 15:00 del 8-sep: coinciden. A las 02:00Z del
    // 9-sep son las 20:00 del 8-sep, y ahí es donde `toISOString().slice(0,10)` mentiría — que es
    // justo el tramo en el que empezó el corte medido.
    const d = build({ otros: 9 });
    const service = new GeocodeSaludService(
      {
        contarFallosConfigDesde: async () => 9,
        revivirFallosConfig: async () => 0,
      },
      CONFIG,
      async (ctx) => {
        d.avisos.push(ctx);
      },
      { warn: () => {} },
      () => new Date("2026-09-09T02:00:00.000Z"),
    );

    await service.registrarFalloConfig("job-1", new Date("2026-09-09T02:00:00.000Z"));

    expect(d.avisos[0].diaCR).toBe("2026-09-08");
  });
});
