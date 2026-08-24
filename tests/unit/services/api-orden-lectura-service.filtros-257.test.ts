import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { ApiOrdenLecturaService } from "@/lib/services/ApiOrdenLecturaService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ApiOrdenRow } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";

// Feature 257 (T6) — la TRADUCCION de fecha calendario de Costa Rica a INSTANTE UTC, que es la
// unica decision de negocio que esta feature mete en el service. El repo solo habla de instantes;
// quien decide que "el dia operativo es el dia natural de CR" es este service, y por eso se prueba
// aqui con el repo doblado.
//
// Que error concreto congela: la trampa `startOfDayCR`. Ese helper (feature 46) devuelve la
// MEDIANOCHE UTC de la fecha calendario de CR, porque su columna es `@db.Date`. Pero `created_at`
// es un `timestamp`, asi que usarlo como cota daria la ventana 18:00-18:00 hora de CR: entrarian
// las ordenes de las 18:00-23:59 del dia ANTERIOR y se caerian las de las 18:00-23:59 del dia
// pedido. Es el off-by-one que cerro la ficha 166. Por eso los instantes esperados se escriben
// LITERALMENTE a mano (`...T06:00:00.000Z`) y no como una expresion calculada con los mismos
// helpers que usa la implementacion: un test que recalcula la formula del codigo bajo prueba
// aprobaria tambien la formula equivocada.
//
// Ademas congela la SEMIABIERTURA de la ventana: `[desde 00:00 CR, hasta+1dia 00:00 CR)`. `hasta`
// es INCLUSIVO, y la unica forma de conseguirlo con una cota superior exclusiva es empujarla al
// comienzo del dia SIGUIENTE. Con la cota superior en el mismo dia se perderia el dia entero
// salvo su primer instante — justo el dia que el integrador acaba de pedir.

const ACTOR: Actor = { usuarioId: "store-1", rol: "apiKey" };

/** Owner distinto al del actor: aparece solo para comprobar que NUNCA llega al repo. */
const OTRA_TIENDA = "store-ajena";

function row(overrides: Partial<ApiOrdenRow> = {}): ApiOrdenRow {
  return {
    numGuia: 10234,
    numRemision: "REM-1",
    estatusValue: "en_bodega_central",
    destinatario: "Ana",
    telefonoDest: "0991234567",
    producto: "Caja",
    direccion: "Calle 1",
    montoCobrar: 1500,
    createdAt: new Date("2026-08-10T15:04:00.000Z"),
    ...overrides,
  };
}

function fakeRepo(overrides: Record<string, unknown> = {}) {
  return {
    listByOwner: vi.fn().mockResolvedValue({ items: [row()], total: 1 }),
    findDetalleByNumGuiaForOwner: vi.fn().mockResolvedValue(null),
    findDetalleByOrdenIdForOwner: vi.fn().mockResolvedValue(null),
    findEstatusIdByValue: vi.fn().mockResolvedValue("os-bodega"),
    ...overrides,
  };
}

function fakeSignedUrls(): ISignedUrlProvider {
  return {
    createSignedUrl: vi.fn(async () => "https://signed/one"),
    createSignedUrls: vi.fn(async () => ({})),
  };
}

/** Los argumentos con que el service pidio la pagina al repo. */
function argsDe(repo: ReturnType<typeof fakeRepo>): {
  ownerId: string;
  estatusId?: string;
  createdAtDesde?: Date;
  createdAtHasta?: Date;
  numGuia?: number;
  numRemision?: string;
  skip: number;
  take: number;
} {
  return repo.listByOwner.mock.calls[0]![0];
}

// El reloj se fija aunque los helpers de fecha NO dependan de "ahora": si manana alguien
// introdujera un default tipo "hasta = hoy", este test tiene que seguir diciendo lo mismo el
// martes que el domingo, y fallar por el cambio de comportamiento, no por la fecha de la corrida.
beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-21T12:00:00.000Z"));
});
afterAll(() => {
  vi.useRealTimers();
});

describe("ApiOrdenLecturaService.listar — filtros de la feature 257 (T6)", () => {
  it("R5/R6/R7: desde=2026-08-01&hasta=2026-08-21 -> [2026-08-01T06:00:00.000Z, 2026-08-22T06:00:00.000Z)", async () => {
    const repo = fakeRepo();
    const svc = new ApiOrdenLecturaService(repo as never, fakeSignedUrls());

    await svc.listar(ACTOR, { limit: 50, offset: 0, desde: "2026-08-01", hasta: "2026-08-21" });

    const args = argsDe(repo);
    // R5/R7: la cota INFERIOR es el comienzo del dia en hora de PARED de Costa Rica (UTC-6), o
    // sea las 06:00 UTC — NO la medianoche UTC, que en CR son todavia las 18:00 del dia anterior.
    expect(args.createdAtDesde).toBeInstanceOf(Date);
    expect(args.createdAtDesde!.toISOString()).toBe("2026-08-01T06:00:00.000Z");
    // R6: la cota SUPERIOR es el comienzo del dia SIGUIENTE al pedido (el 22, no el 21), porque
    // el repo la aplica como EXCLUSIVA. Asi `hasta` acaba siendo inclusivo: la ventana es la
    // semiabierta `[desde 00:00 CR, hasta+1dia 00:00 CR)` y cubre el 21 entero.
    expect(args.createdAtHasta).toBeInstanceOf(Date);
    expect(args.createdAtHasta!.toISOString()).toBe("2026-08-22T06:00:00.000Z");
  });

  it("R7: una orden a las 00:30 de CR cae DENTRO de la ventana y una de las 19:00 del dia anterior cae FUERA", async () => {
    // La comprobacion de la trampa, dicha en instantes concretos y sin tocar la base: con las
    // cotas correctas, `D T06:30:00Z` (00:30 CR del dia D) esta dentro y `D T01:00:00Z` (19:00 CR
    // del dia D-1) esta fuera. Con `startOfDayCR` —medianoche UTC— pasaria exactamente al reves.
    const repo = fakeRepo();
    const svc = new ApiOrdenLecturaService(repo as never, fakeSignedUrls());

    await svc.listar(ACTOR, { limit: 50, offset: 0, desde: "2026-08-10", hasta: "2026-08-10" });

    const { createdAtDesde, createdAtHasta } = argsDe(repo);
    const dentro = new Date("2026-08-10T06:30:00.000Z"); // 00:30 hora de CR del 10
    const fuera = new Date("2026-08-10T01:00:00.000Z"); // 19:00 hora de CR del 9
    expect(dentro.getTime()).toBeGreaterThanOrEqual(createdAtDesde!.getTime());
    expect(dentro.getTime()).toBeLessThan(createdAtHasta!.getTime());
    expect(fuera.getTime()).toBeLessThan(createdAtDesde!.getTime());
  });

  it("R8: desde=hasta=2026-08-10 cubre las 24 horas completas de ese dia en Costa Rica", async () => {
    const repo = fakeRepo();
    const svc = new ApiOrdenLecturaService(repo as never, fakeSignedUrls());

    await svc.listar(ACTOR, { limit: 50, offset: 0, desde: "2026-08-10", hasta: "2026-08-10" });

    const { createdAtDesde, createdAtHasta } = argsDe(repo);
    expect(createdAtDesde!.toISOString()).toBe("2026-08-10T06:00:00.000Z");
    expect(createdAtHasta!.toISOString()).toBe("2026-08-11T06:00:00.000Z");
    // Ni franja vacia ni un solo instante: exactamente un dia. Es la afirmacion que cae si
    // alguien "simplifica" la cota superior al mismo dia.
    expect(createdAtHasta!.getTime() - createdAtDesde!.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("R9: solo `desde` aplica unicamente la cota inferior (la superior queda sin definir)", async () => {
    const repo = fakeRepo();
    const svc = new ApiOrdenLecturaService(repo as never, fakeSignedUrls());

    await svc.listar(ACTOR, { limit: 50, offset: 0, desde: "2026-08-01" });

    const args = argsDe(repo);
    expect(args.createdAtDesde!.toISOString()).toBe("2026-08-01T06:00:00.000Z");
    expect(args.createdAtHasta).toBeUndefined();
  });

  it("R9: solo `hasta` aplica unicamente la cota superior (la inferior queda sin definir)", async () => {
    const repo = fakeRepo();
    const svc = new ApiOrdenLecturaService(repo as never, fakeSignedUrls());

    await svc.listar(ACTOR, { limit: 50, offset: 0, hasta: "2026-08-21" });

    const args = argsDe(repo);
    expect(args.createdAtDesde).toBeUndefined();
    expect(args.createdAtHasta!.toISOString()).toBe("2026-08-22T06:00:00.000Z");
  });

  it("R1: sin `desde` ni `hasta` el repo no recibe ninguna cota de fecha", async () => {
    // La feature no puede cambiar el camino de quien no filtra: si aqui apareciera una cota
    // (p. ej. un default "ultimos N dias"), el integrador que ya paginaba dejaria de ver su
    // historico sin que nada fallara.
    const repo = fakeRepo();
    const svc = new ApiOrdenLecturaService(repo as never, fakeSignedUrls());

    await svc.listar(ACTOR, { limit: 50, offset: 0 });

    const args = argsDe(repo);
    expect(args.createdAtDesde).toBeUndefined();
    expect(args.createdAtHasta).toBeUndefined();
    expect(args.numGuia).toBeUndefined();
    expect(args.numRemision).toBeUndefined();
    expect(args.skip).toBe(0);
    expect(args.take).toBe(50);
  });

  it("R18: `numGuia` y `numRemision` viajan al repo tal cual, sin transformar", async () => {
    // El service NO normaliza estos dos: la igualdad exacta (R13/R16) exige que lo que valido el
    // borde sea literalmente lo que se compara en SQL. Cualquier `trim`, `toUpperCase` o cast
    // aqui convertiria una busqueda exacta en otra cosa.
    const repo = fakeRepo();
    const svc = new ApiOrdenLecturaService(repo as never, fakeSignedUrls());

    await svc.listar(ACTOR, {
      limit: 25,
      offset: 50,
      numGuia: 10234,
      numRemision: "REM-abc",
    });

    const args = argsDe(repo);
    expect(args.numGuia).toBe(10234);
    expect(args.numRemision).toBe("REM-abc");
  });

  it("R20: el owner que llega al repo es SIEMPRE actor.usuarioId, aunque la peticion traiga filtros", async () => {
    // Invariante del ENDPOINT, no propiedad de los filtros: ningun parametro puede sustituir,
    // ampliar ni omitir el owner. Se pasa ademas una clave `tiendaId` ajena por la query (que el
    // contrato no declara: de ahi el cast) para congelar que ni siquiera colandola llega al repo.
    const repo = fakeRepo();
    const svc = new ApiOrdenLecturaService(repo as never, fakeSignedUrls());

    await svc.listar(ACTOR, {
      limit: 10,
      offset: 0,
      estado: "en_bodega_central",
      desde: "2026-08-01",
      hasta: "2026-08-21",
      numGuia: 999,
      numRemision: "REM-9",
      tiendaId: OTRA_TIENDA,
      ownerId: OTRA_TIENDA,
    } as never);

    const args = argsDe(repo);
    expect(args.ownerId, "el owner dejo de venir del actor").toBe("store-1");
    expect(args).not.toHaveProperty("tiendaId");
    // Y los cinco filtros conviven (R18): resolver el estado no descarta el resto.
    expect(args.estatusId).toBe("os-bodega");
    expect(args.createdAtDesde!.toISOString()).toBe("2026-08-01T06:00:00.000Z");
    expect(args.createdAtHasta!.toISOString()).toBe("2026-08-22T06:00:00.000Z");
    expect(args.numGuia).toBe(999);
    expect(args.numRemision).toBe("REM-9");
  });
});
