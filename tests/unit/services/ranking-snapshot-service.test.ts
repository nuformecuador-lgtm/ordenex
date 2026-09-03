import { describe, it, expect, vi } from "vitest";
import { RankingSnapshotService } from "@/lib/services/RankingSnapshotService";
import { RankingService } from "@/lib/services/RankingService";
import type {
  CrearSnapshotInput,
  IRankingSnapshotRepository,
  SnapshotDiaRow,
} from "@/lib/interfaces/repositories/IRankingSnapshotRepository";
import type { IRankingRepository } from "@/lib/interfaces/repositories/IRankingRepository";
import type { IPremioRankingRepository } from "@/lib/interfaces/repositories/IPremioRankingRepository";
import type { IUserRepository } from "@/lib/interfaces/repositories/IUserRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ConteoPorMensajero, PremioRankingDTO } from "@/lib/types/ranking";
import { ventanaDelDia } from "@/lib/ranking/snapshot-dia";

// Feature 196 (T2.4) — servicio del snapshot con repos fake (sin DB). Cubre R2 (congela D−1),
// R3 (mismo orden y mismo podio que el vivo, fila a fila), R5 (0/0 no produce fila), R6 (la
// fila lleva las columnas de negocio), R7/R8 (premio solo en el podio), R11 (dia sin
// actividad -> cabecera con 0 filas), R12 (reejecucion -> omitido), R16 (nombre congelado),
// R25 (no se reordena en la lectura), R27/R28 (autorizacion).

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "u-admin", rol: "admin" };
const MENSAJERO: Actor = { usuarioId: "u-msj", rol: "mensajero" };
const ADMIN_TIENDA: Actor = { usuarioId: "u-tienda", rol: "adminTienda" };
const ADMIN_SATELITE: Actor = { usuarioId: "u-sat", rol: "adminSatelite" };

/** 02:00 CR del 11 de agosto: la corrida del cron. La fecha objetivo es el 10. */
const CORRIDA = new Date("2026-08-11T08:00:00.000Z");
const FECHA_OBJETIVO = "2026-08-10";
/** Un instante DENTRO del dia objetivo, para pedirle al vivo ese mismo dia. */
const DENTRO_DEL_DIA = new Date("2026-08-10T18:00:00.000Z");

interface Datos {
  mensajeros?: { id: string; nombre: string }[];
  entregadas?: ConteoPorMensajero[];
  asignadas?: ConteoPorMensajero[];
  premios?: PremioRankingDTO[];
  minPodio?: number;
}

function sinPremios(): PremioRankingDTO[] {
  return [
    { posicion: 1, monto: null, descripcion: null },
    { posicion: 2, monto: null, descripcion: null },
    { posicion: 3, monto: null, descripcion: null },
  ];
}

/** Los tres repos del ranking EN VIVO, compartidos por los dos services (esa es la gracia). */
function reposDelRanking(datos: Datos) {
  const contarEntregadasPorMensajero = vi.fn(async () => datos.entregadas ?? []);
  const contarAsignadasPorMensajero = vi.fn(async () => datos.asignadas ?? []);
  const rankingRepo = {
    contarEntregadasPorMensajero,
    contarAsignadasPorMensajero,
  } as IRankingRepository;
  const userRepo = {
    listMensajeros: vi.fn(async () => datos.mensajeros ?? []),
  } as unknown as IUserRepository;
  const premioRepo = {
    listar: vi.fn(async () => datos.premios ?? sinPremios()),
    upsertPremio: vi.fn(),
  } as unknown as IPremioRankingRepository;
  return { rankingRepo, userRepo, premioRepo, contarEntregadasPorMensajero, contarAsignadasPorMensajero };
}

interface SnapshotRepoOpts {
  creado?: boolean;
  filasCongeladas?: number;
  lectura?: SnapshotDiaRow | null;
}

function buildService(datos: Datos, opts: SnapshotRepoOpts = {}) {
  const escrituras: CrearSnapshotInput[] = [];
  const crearSnapshot = vi.fn(async (input: CrearSnapshotInput) => {
    escrituras.push(input);
    return {
      creado: opts.creado ?? true,
      filas: opts.filasCongeladas ?? input.filas.length,
    };
  });
  const obtenerPorFecha = vi.fn(async () => opts.lectura ?? null);
  // Feature 293 (T3.1): el contrato gana DOS lecturas del podio. Este servicio —el del cron y
  // el del historico— no las llama, y que sigan sin llamarse es parte de lo que este archivo
  // afirma: el premio NUNCA nace del congelado diario (R3).
  const listarPodioDeFecha = vi.fn(async () => null);
  const obtenerFilaDelPodio = vi.fn(async () => null);
  const snapshotRepo = {
    crearSnapshot,
    obtenerPorFecha,
    listarPodioDeFecha,
    obtenerFilaDelPodio,
    // ficha 362: el cron del congelado diario NO registra ninguna accion (el premio no nace
    // del congelado, R3), pero el contrato lo declara y el doble tiene que cumplirlo.
    registrarAccionSobreFila: vi.fn(async () => undefined),
  } as IRankingSnapshotRepository;
  const repos = reposDelRanking(datos);
  const config = { MIN_ASIGNADAS_PODIO: datos.minPodio ?? 1 };
  const service = new RankingSnapshotService(
    snapshotRepo,
    repos.rankingRepo,
    repos.userRepo,
    repos.premioRepo,
    config,
  );
  const vivo = new RankingService(repos.rankingRepo, repos.userRepo, repos.premioRepo, config);
  return { service, vivo, escrituras, crearSnapshot, obtenerPorFecha, ...repos };
}

/** Escenario compartido: cuatro mensajeros, uno de ellos SIN actividad. */
function escenario(): Datos {
  return {
    mensajeros: [
      { id: "m1", nombre: "Ana" },
      { id: "m2", nombre: "Beto" },
      { id: "m3", nombre: "Carlos" },
      { id: "m4", nombre: "Dora" }, // 0/0: sin actividad
    ],
    asignadas: [
      { mensajeroId: "m1", total: 10 },
      { mensajeroId: "m2", total: 10 },
      { mensajeroId: "m3", total: 4 },
    ],
    entregadas: [
      { mensajeroId: "m1", total: 9 }, // 90.0
      { mensajeroId: "m2", total: 10 }, // 100.0
      { mensajeroId: "m3", total: 3 }, // 75.0
    ],
    premios: [
      { posicion: 1, monto: "15000.00", descripcion: "Primer lugar" },
      { posicion: 2, monto: "10000.00", descripcion: "Segundo lugar" },
      { posicion: 3, monto: null, descripcion: null },
    ],
  };
}

describe("congelar — fecha objetivo y ventana (R2)", () => {
  it("congela D−1 y consulta los conteos con la ventana de ESA fecha", async () => {
    const { service, contarEntregadasPorMensajero, contarAsignadasPorMensajero, escrituras } =
      buildService(escenario());

    const res = await service.congelar(CORRIDA);

    expect(res.fecha).toBe(FECHA_OBJETIVO);
    const { desde, hasta } = ventanaDelDia(FECHA_OBJETIVO);
    expect(contarEntregadasPorMensajero).toHaveBeenCalledWith(desde, hasta);
    // Feature 246 (T6.3, D7): el denominador recibe un TERCER valor —el dia como `@db.Date`— y es
    // EXACTAMENTE el mismo que se congela en la cabecera. Las DOS convenciones conviven en la
    // misma llamada: `desde`/`hasta` llevan las 06:00 (cotas `timestamp`) y `diaReparto` no
    // (medianoche UTC). Confundirlas desplaza el dia seis horas — la trampa de la ficha 166.
    expect(contarAsignadasPorMensajero).toHaveBeenCalledWith(
      desde,
      hasta,
      new Date("2026-08-10T00:00:00.000Z"),
    );
    // La cabecera guarda la MEDIANOCHE UTC de la fecha, no el `desde` de la ventana.
    expect(escrituras[0].fecha.toISOString()).toBe("2026-08-10T00:00:00.000Z");
  });

  it("no hay forma de pedir otra fecha: `congelar` recibe solo `now` (R15)", () => {
    expect(RankingSnapshotService.prototype.congelar.length).toBe(1);
  });
});

describe("congelar — paridad EXACTA con el ranking en vivo (R3)", () => {
  it("el orden congelado coincide fila a fila con el del vivo sobre los mismos datos", async () => {
    const { service, vivo, escrituras } = buildService(escenario());

    await service.congelar(CORRIDA);
    const enVivo = await vivo.obtenerRanking(MAESTRO, DENTRO_DEL_DIA);
    expect(enVivo.status).toBe("ok");
    if (enVivo.status !== "ok") return;

    // El vivo LISTA a todos (incluida Dora, 0/0); el congelado omite a los sin actividad.
    const idsDelVivo = enVivo.data.ranking.map((r) => r.mensajeroId);
    const idsCongelados = escrituras[0].filas.map((f) => f.mensajeroId);
    expect(idsDelVivo).toEqual(["m2", "m1", "m3", "m4"]);
    expect(idsCongelados).toEqual(["m2", "m1", "m3"]);
    // ...y quitar a los sin actividad del vivo da EXACTAMENTE la lista congelada.
    const idsConActividad = enVivo.data.ranking
      .filter((r) => r.entregadasHoy > 0 || r.asignadasHoy > 0)
      .map((r) => r.mensajeroId);
    expect(idsCongelados).toEqual(idsConActividad);
  });

  it("la posicion de podio congelada es la misma que la del vivo, fila a fila", async () => {
    const { service, vivo, escrituras } = buildService({ ...escenario(), minPodio: 5 });

    await service.congelar(CORRIDA);
    const enVivo = await vivo.obtenerRanking(MAESTRO, DENTRO_DEL_DIA);
    if (enVivo.status !== "ok") throw new Error("el vivo debia responder ok");

    const posicionDelVivo = new Map(enVivo.data.ranking.map((r) => [r.mensajeroId, r.posicion]));
    for (const fila of escrituras[0].filas) {
      expect(fila.posicion).toBe(posicionDelVivo.get(fila.mensajeroId));
    }
    // R9: con el umbral en 5, Carlos (4 asignadas) se lista con puesto pero sin podio.
    expect(escrituras[0].filas.map((f) => [f.mensajeroId, f.posicion])).toEqual([
      ["m2", 1],
      ["m1", 2],
      ["m3", null],
    ]);
  });

  it("feature 297: el podio del 26/08 (tres a 0 entregas) sale VACIO del vivo Y del congelado", async () => {
    // El caso real de produccion. Se mide en ESTE archivo —el de la paridad— porque los dos
    // servicios comparten `lib/ranking/orden-ranking.ts` a proposito: si alguien reimplementara
    // el criterio en uno de los dos, el vivo y el congelado divergirian justo aqui.
    const datos: Datos = {
      mensajeros: [
        { id: "m-andres", nombre: "Andres" },
        { id: "m-carlos", nombre: "Carlos" },
        { id: "m-johel", nombre: "Johel" },
      ],
      asignadas: [
        { mensajeroId: "m-andres", total: 21 },
        { mensajeroId: "m-carlos", total: 25 },
        { mensajeroId: "m-johel", total: 37 },
      ],
      entregadas: [], // NADIE entrego
      premios: [
        { posicion: 1, monto: "5000.00", descripcion: "Primer lugar" },
        { posicion: 2, monto: null, descripcion: null },
        { posicion: 3, monto: null, descripcion: null },
      ],
    };
    const { service, vivo, escrituras } = buildService(datos);

    await service.congelar(CORRIDA);
    const enVivo = await vivo.obtenerRanking(MAESTRO, DENTRO_DEL_DIA);
    if (enVivo.status !== "ok") throw new Error("el vivo debia responder ok");

    // EN VIVO: los tres se listan, con su 0.0 %, y ninguno ocupa posicion ni lleva premio.
    expect(enVivo.data.ranking.map((r) => r.mensajeroId)).toEqual([
      "m-andres",
      "m-carlos",
      "m-johel",
    ]);
    expect(enVivo.data.ranking.map((r) => r.posicion)).toEqual([null, null, null]);
    expect(enVivo.data.ranking.map((r) => r.pct)).toEqual(["0.0", "0.0", "0.0"]);
    expect(enVivo.data.ranking.map((r) => r.premio)).toEqual([null, null, null]);

    // CONGELADO: las tres filas se escriben (hay actividad, R5) y ninguna congela premio: el
    // CHECK de la base solo deja monto donde hay posicion, y ya no hay ninguna.
    expect(escrituras[0].filas.map((f) => [f.mensajeroId, f.puesto, f.posicion])).toEqual([
      ["m-andres", 1, null],
      ["m-carlos", 2, null],
      ["m-johel", 3, null],
    ]);
    expect(escrituras[0].filas.map((f) => f.premioMonto)).toEqual([null, null, null]);
  });

  it("los conteos congelados son los mismos enteros que muestra el vivo (R10)", async () => {
    const { service, vivo, escrituras } = buildService(escenario());

    await service.congelar(CORRIDA);
    const enVivo = await vivo.obtenerRanking(MAESTRO, DENTRO_DEL_DIA);
    if (enVivo.status !== "ok") throw new Error("el vivo debia responder ok");

    for (const fila of escrituras[0].filas) {
      const delVivo = enVivo.data.ranking.find((r) => r.mensajeroId === fila.mensajeroId);
      expect([fila.entregadas, fila.asignadas]).toEqual([delVivo?.entregadasHoy, delVivo?.asignadasHoy]);
    }
  });

  it("filtrar por actividad no mueve el podio ni el orden relativo: la cola de indefinidos se conserva", async () => {
    // Zoe entrego una orden asignada AYER (5/0): pct indefinido, pero SI tiene actividad, y
    // el comparador la manda a la cola junto a los 0/0. Si el filtro se aplicara mal, su
    // puesto o su presencia cambiarian.
    const datos: Datos = {
      mensajeros: [
        { id: "m1", nombre: "Ana" }, // 0/0 -> fuera
        { id: "m2", nombre: "Beto" }, // 8/10 -> podio 1
        { id: "m9", nombre: "Zoe" }, // 5/0 -> se lista, sin podio
      ],
      asignadas: [{ mensajeroId: "m2", total: 10 }],
      entregadas: [
        { mensajeroId: "m2", total: 8 },
        { mensajeroId: "m9", total: 5 },
      ],
    };
    const { service, vivo, escrituras } = buildService(datos);

    await service.congelar(CORRIDA);
    const enVivo = await vivo.obtenerRanking(MAESTRO, DENTRO_DEL_DIA);
    if (enVivo.status !== "ok") throw new Error("el vivo debia responder ok");

    expect(enVivo.data.ranking.map((r) => r.mensajeroId)).toEqual(["m2", "m1", "m9"]);
    // Ana (0/0) desaparece; Zoe conserva su lugar RELATIVO y el puesto se renumera 1..N.
    expect(escrituras[0].filas.map((f) => [f.mensajeroId, f.puesto, f.posicion])).toEqual([
      ["m2", 1, 1],
      ["m9", 2, null],
    ]);
  });
});

describe("congelar — filas congeladas (R5/R6/R7/R8/R16)", () => {
  it("un mensajero sin actividad (0/0) no produce fila; los que la tienen, si (R5)", async () => {
    const { service, escrituras } = buildService(escenario());
    await service.congelar(CORRIDA);

    expect(escrituras[0].filas.map((f) => f.mensajeroId)).not.toContain("m4");
    expect(escrituras[0].filas).toHaveLength(3);
  });

  it("`entregadas > 0` con `asignadas = 0` ES actividad y produce fila (R5)", async () => {
    const { service, escrituras } = buildService({
      mensajeros: [{ id: "m1", nombre: "Ana" }],
      entregadas: [{ mensajeroId: "m1", total: 3 }],
      asignadas: [],
    });
    await service.congelar(CORRIDA);
    expect(escrituras[0].filas).toHaveLength(1);
    expect(escrituras[0].filas[0]).toMatchObject({ entregadas: 3, asignadas: 0, posicion: null });
  });

  it("`asignadas > 0` sin entregas ES actividad y produce fila (R5), pero SIN podio (297)", async () => {
    const { service, escrituras } = buildService({
      mensajeros: [{ id: "m1", nombre: "Ana" }],
      entregadas: [],
      asignadas: [{ mensajeroId: "m1", total: 6 }],
    });
    await service.congelar(CORRIDA);
    // R5 sigue: la fila se congela, con sus dos conteos. Lo que la feature 297 cambia es la
    // POSICION: 0 entregas ya no ocupa podio, asi que aqui era `1` y ahora es `null`.
    expect(escrituras[0].filas[0]).toMatchObject({ entregadas: 0, asignadas: 6, posicion: null });
    expect(escrituras[0].filas).toHaveLength(1);
  });

  it("la fila lleva puesto, posicion, id, nombre congelado y los dos conteos (R6/R16)", async () => {
    const { service, escrituras } = buildService(escenario());
    await service.congelar(CORRIDA);

    expect(escrituras[0].filas[0]).toEqual({
      puesto: 1,
      posicion: 1,
      mensajeroId: "m2",
      mensajeroNombre: "Beto", // R16: el nombre de la corrida
      entregadas: 10,
      asignadas: 10,
      premioMonto: "15000.00",
      premioDescripcion: "Primer lugar",
    });
  });

  it("los puestos son 1..N contiguos sobre las filas congeladas (R6)", async () => {
    const { service, escrituras } = buildService(escenario());
    await service.congelar(CORRIDA);
    expect(escrituras[0].filas.map((f) => f.puesto)).toEqual([1, 2, 3]);
  });

  it("la fila de podio congela monto Y descripcion del premio vigente (R7)", async () => {
    const { service, escrituras } = buildService(escenario());
    await service.congelar(CORRIDA);

    expect(escrituras[0].filas[1]).toMatchObject({
      posicion: 2,
      premioMonto: "10000.00",
      premioDescripcion: "Segundo lugar",
    });
  });

  it("la fila SIN podio queda sin premio congelado (R8)", async () => {
    const { service, escrituras } = buildService({ ...escenario(), minPodio: 5 });
    await service.congelar(CORRIDA);

    const carlos = escrituras[0].filas.find((f) => f.mensajeroId === "m3");
    expect(carlos).toMatchObject({ posicion: null, premioMonto: null, premioDescripcion: null });
  });

  it("posicion de podio sin premio configurado: monto y descripcion nulos, sin inventar (R7)", async () => {
    const { service, escrituras } = buildService(escenario());
    await service.congelar(CORRIDA);

    // La posicion 3 no tiene premio configurado; Carlos la ocupa igualmente.
    expect(escrituras[0].filas[2]).toMatchObject({
      posicion: 3,
      premioMonto: null,
      premioDescripcion: null,
    });
  });

  it("congela el umbral APLICADO en la corrida, no el default (R1)", async () => {
    const { service, escrituras } = buildService({ ...escenario(), minPodio: 5 });
    await service.congelar(CORRIDA);
    expect(escrituras[0].minAsignadasPodio).toBe(5);
  });
});

describe("congelar — dia sin actividad y reejecucion (R11/R12)", () => {
  it("sin actividad de nadie escribe la cabecera con filas = 0 (nunca «no escribir nada»)", async () => {
    const { service, escrituras, crearSnapshot } = buildService({
      mensajeros: [
        { id: "m1", nombre: "Ana" },
        { id: "m2", nombre: "Beto" },
      ],
      entregadas: [],
      asignadas: [],
    });

    const res = await service.congelar(CORRIDA);

    expect(crearSnapshot).toHaveBeenCalledTimes(1);
    expect(escrituras[0].filas).toEqual([]);
    expect(res).toEqual({ status: "creado", fecha: FECHA_OBJETIVO, filas: 0 });
  });

  it("sin ningun mensajero activo tambien escribe cabecera (R11)", async () => {
    const { service, escrituras } = buildService({ mensajeros: [] });
    const res = await service.congelar(CORRIDA);
    expect(escrituras).toHaveLength(1);
    expect(res.status).toBe("creado");
  });

  it("la segunda corrida sobre la fecha ya congelada devuelve `omitido` con las filas que ya habia (R12)", async () => {
    const { service } = buildService(escenario(), { creado: false, filasCongeladas: 3 });
    const res = await service.congelar(CORRIDA);
    expect(res).toEqual({ status: "omitido", fecha: FECHA_OBJETIVO, filas: 3 });
  });
});

describe("obtenerPorFecha — autorizacion (R27/R28)", () => {
  const LECTURA: SnapshotDiaRow = {
    fecha: new Date("2026-08-10T00:00:00.000Z"),
    generadoAt: new Date("2026-08-11T08:00:00.000Z"),
    minAsignadasPodio: 1,
    filas: [
      {
        puesto: 1,
        posicion: 1,
        mensajeroId: "m2",
        mensajeroNombre: "Beto",
        entregadas: 10,
        asignadas: 10,
        premioMonto: "15000.00",
        premioDescripcion: "Primer lugar",
      },
      {
        puesto: 2,
        posicion: null,
        mensajeroId: "m1",
        mensajeroNombre: "Ana (nombre congelado)",
        entregadas: 9,
        asignadas: 10,
        premioMonto: null,
        premioDescripcion: null,
      },
    ],
  };

  it("acceso total (maestro y admin) lee el historico", async () => {
    for (const actor of [MAESTRO, ADMIN]) {
      const { service } = buildService({}, { lectura: LECTURA });
      const res = await service.obtenerPorFecha(actor, FECHA_OBJETIVO);
      expect(res.status).toBe("ok");
    }
  });

  it("el mensajero ve TODAS las filas, sin recorte a las suyas (R28)", async () => {
    const { service } = buildService({}, { lectura: LECTURA });
    const res = await service.obtenerPorFecha(MENSAJERO, FECHA_OBJETIVO);
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.data.filas.map((f) => f.mensajeroId)).toEqual(["m2", "m1"]);
  });

  it("cualquier otro rol -> forbidden y NI SIQUIERA se consulta el almacenamiento (R27)", async () => {
    for (const actor of [ADMIN_TIENDA, ADMIN_SATELITE]) {
      const { service, obtenerPorFecha } = buildService({}, { lectura: LECTURA });
      const res = await service.obtenerPorFecha(actor, FECHA_OBJETIVO);
      expect(res).toEqual({ status: "forbidden" });
      expect(obtenerPorFecha).not.toHaveBeenCalled();
    }
  });
});

describe("obtenerPorFecha — contenido y serializacion (R16/R25/R26/R31)", () => {
  const LECTURA: SnapshotDiaRow = {
    fecha: new Date("2026-08-10T00:00:00.000Z"),
    generadoAt: new Date("2026-08-11T08:00:00.000Z"),
    minAsignadasPodio: 3,
    filas: [
      {
        puesto: 1,
        posicion: 1,
        mensajeroId: "m2",
        mensajeroNombre: "Beto",
        entregadas: 10,
        asignadas: 10,
        premioMonto: "15000.00",
        premioDescripcion: "Primer lugar",
      },
      {
        puesto: 2,
        posicion: null,
        mensajeroId: "m1",
        mensajeroNombre: "Ana la de entonces",
        entregadas: 3,
        asignadas: 0,
        premioMonto: null,
        premioDescripcion: null,
      },
    ],
  };

  it("sin cabecera responde `sin_snapshot` con la fecha pedida (R26)", async () => {
    const { service } = buildService({}, { lectura: null });
    const res = await service.obtenerPorFecha(MAESTRO, FECHA_OBJETIVO);
    expect(res).toEqual({ status: "sin_snapshot", fecha: FECHA_OBJETIVO });
  });

  it("cabecera con cero filas responde `ok` con filas vacias: es OTRO caso (R26)", async () => {
    const { service } = buildService(
      {},
      {
        lectura: {
          fecha: new Date("2026-08-10T00:00:00.000Z"),
          generadoAt: new Date("2026-08-11T08:00:00.000Z"),
          minAsignadasPodio: 1,
          filas: [],
        },
      },
    );
    const res = await service.obtenerPorFecha(MAESTRO, FECHA_OBJETIVO);
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.data.filas).toEqual([]);
  });

  it("consulta la fecha como medianoche UTC y devuelve el orden congelado sin reordenar (R25)", async () => {
    const { service, obtenerPorFecha } = buildService({}, { lectura: LECTURA });
    const res = await service.obtenerPorFecha(MAESTRO, FECHA_OBJETIVO);

    expect(obtenerPorFecha).toHaveBeenCalledWith(new Date("2026-08-10T00:00:00.000Z"));
    if (res.status !== "ok") throw new Error("debia responder ok");
    // La fila 2 tiene pct indefinido y mejor numerador que ninguna: si el service reordenara
    // por cualquier criterio propio, este orden cambiaria.
    expect(res.data.filas.map((f) => f.puesto)).toEqual([1, 2]);
    expect(res.data.filas.map((f) => f.mensajeroId)).toEqual(["m2", "m1"]);
  });

  it("muestra el nombre CONGELADO, no el actual (R16)", async () => {
    const { service } = buildService({}, { lectura: LECTURA });
    const res = await service.obtenerPorFecha(MAESTRO, FECHA_OBJETIVO);
    if (res.status !== "ok") throw new Error("debia responder ok");
    expect(res.data.filas[1].nombre).toBe("Ana la de entonces");
  });

  it("pct se DERIVA de los enteros congelados y cruza como STRING; null si no hay denominador (R10/R31)", async () => {
    const { service } = buildService({}, { lectura: LECTURA });
    const res = await service.obtenerPorFecha(MAESTRO, FECHA_OBJETIVO);
    if (res.status !== "ok") throw new Error("debia responder ok");

    expect(res.data.filas[0].pct).toBe("100.0");
    expect(res.data.filas[1].pct).toBeNull(); // asignadas = 0 -> indefinido, no "0.0"
    for (const fila of res.data.filas) {
      expect(fila.pct === null || typeof fila.pct === "string").toBe(true);
      expect(fila.premioMonto === null || typeof fila.premioMonto === "string").toBe(true);
    }
  });

  it("expone el instante de generacion y el umbral aplicado de ESA corrida (R1/R24)", async () => {
    const { service } = buildService({}, { lectura: LECTURA });
    const res = await service.obtenerPorFecha(MAESTRO, FECHA_OBJETIVO);
    if (res.status !== "ok") throw new Error("debia responder ok");

    expect(res.data.generadoAt).toBe("2026-08-11T08:00:00.000Z");
    expect(res.data.minAsignadasPodio).toBe(3);
    expect(res.data.fecha).toBe(FECHA_OBJETIVO);
  });
});

// =================================================================================================
// FEATURE 246 (T6.3, D7 firmada el 2026-08-20) — EL CONGELADO Y EL VIVO CUENTAN IGUAL.
//
// R41: los dos DEBEN poder diferir solo en QUE DIA miran, nunca en COMO lo cuentan. Aqui se afirma
// exactamente eso: misma forma de llamada, mismo tipo de valor, dias distintos.
// =================================================================================================
describe("246/R41/R42/R46 — el denominador congelado usa el MISMO criterio que el vivo", () => {
  /** Los tres argumentos que cada uno pasa al denominador. */
  async function argsDeLosDos() {
    const datos = escenario();
    const congelado = buildService(datos);
    await congelado.service.congelar(CORRIDA);

    const repos = reposDelRanking(datos);
    const vivo = new RankingService(repos.rankingRepo, repos.userRepo, repos.premioRepo, {
      MIN_ASIGNADAS_PODIO: datos.minPodio ?? 1,
    });
    await vivo.obtenerRanking(MAESTRO, DENTRO_DEL_DIA);

    return {
      delCongelado: congelado.contarAsignadasPorMensajero.mock.calls[0] as unknown as [
        Date,
        Date,
        Date,
      ],
      delVivo: repos.contarAsignadasPorMensajero.mock.calls[0] as unknown as [Date, Date, Date],
    };
  }

  it("R41: los dos pasan TRES argumentos, y el tercero tiene la MISMA convencion", async () => {
    const { delCongelado, delVivo } = await argsDeLosDos();

    expect(delCongelado).toHaveLength(3);
    expect(delVivo).toHaveLength(3);
    // Misma convencion `@db.Date`: medianoche UTC, sin las 06:00 dentro. Si uno de los dos usara
    // la convencion `timestamp`, contarian dias distintos sin que nadie se enterara — que es
    // exactamente lo que R41 prohibe.
    for (const dia of [delCongelado[2], delVivo[2]]) {
      expect(dia.getUTCHours()).toBe(0);
      expect(dia.getUTCMinutes()).toBe(0);
      expect(dia.getUTCSeconds()).toBe(0);
      expect(dia.getUTCMilliseconds()).toBe(0);
    }
  });

  it("R41: en este caso miran EL MISMO dia — el congelado de D−1 y el vivo dentro de D−1", async () => {
    // `CORRIDA` son las 02:00 CR del 11 (congela el 10) y `DENTRO_DEL_DIA` son las 12:00 CR del
    // 10. Los dos tienen que apuntar al 10: es la comprobacion de que «solo difieren en QUE dia».
    const { delCongelado, delVivo } = await argsDeLosDos();
    expect(delCongelado[2].toISOString()).toBe("2026-08-10T00:00:00.000Z");
    expect(delVivo[2].toISOString()).toBe(delCongelado[2].toISOString());
  });

  it("R46: el dia congelado es el MISMO que filtro el denominador — no dos fechas distintas", async () => {
    // Si la cabecera guardara un dia y el denominador filtrara por otro, la fila congelada
    // describiria un dia que nadie conto. Aqui son literalmente el mismo valor.
    const { service, contarAsignadasPorMensajero, escrituras } = buildService(escenario());

    await service.congelar(CORRIDA);

    const diaFiltrado = (contarAsignadasPorMensajero.mock.calls[0] as unknown as [
      Date,
      Date,
      Date,
    ])[2];
    expect(escrituras[0].fecha.toISOString()).toBe(diaFiltrado.toISOString());
  });

  it("R46: no hay escritura posible que mueva el denominador de un dia ya congelado", async () => {
    // No es una promesa: es el ALCANCE de la ficha. `fecha_reparto = X` solo puede escribirse
    // eligiendo «hoy» el dia X o «mañana» el dia X−1, y este cron congela X a las 02:00 CR del
    // X+1. La forma de afirmarlo desde aqui es que `congelar` no admite otra fecha que la que
    // deriva de `now` (R15, ya cubierto) y que el dia que filtra es siempre D−1.
    const { service, contarAsignadasPorMensajero } = buildService(escenario());

    await service.congelar(CORRIDA);

    const diaFiltrado = (contarAsignadasPorMensajero.mock.calls[0] as unknown as [
      Date,
      Date,
      Date,
    ])[2];
    // D−1 respecto de la corrida, nunca el dia en curso ni uno futuro.
    expect(diaFiltrado.getTime()).toBeLessThan(CORRIDA.getTime());
    expect(CORRIDA.getTime() - diaFiltrado.getTime()).toBeLessThan(2 * 24 * 60 * 60 * 1000);
  });

  it("R42: una re-corrida sobre una fecha ya congelada NO reescribe nada", async () => {
    // El criterio nuevo rige solo hacia adelante (D11, firmada). La idempotencia del cron es la
    // unicidad de `fecha`, y esta ficha no la toca: si el snapshot ya existe, se omite.
    const { service, escrituras } = buildService(escenario(), { creado: false });

    const res = await service.congelar(CORRIDA);

    expect(res.status).toBe("omitido");
    // Se intento escribir una vez (el repo es quien decide por unicidad), y NO hay ninguna
    // actualizacion de filas previas: este service no tiene ningun camino que las modifique.
    expect(escrituras).toHaveLength(1);
  });
});
