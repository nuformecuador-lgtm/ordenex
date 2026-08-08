import { describe, it, expect, vi } from "vitest";
import { WalletTiendaService } from "@/lib/services/WalletTiendaService";
import { WalletTiendaMovimientoRepository } from "@/lib/repositories/WalletTiendaMovimientoRepository";
import type {
  IWalletTiendaMovimientoRepository,
  SaldoTiendaAgregadoRow,
} from "@/lib/interfaces/repositories/IWalletTiendaMovimientoRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { RangoPagina } from "@/lib/utils/rango-pagina";
import { descargaConfig } from "@/lib/config/descarga";

// Feature 184 — Tanda G (R1/R4/R5/R6/R16) — el CONJUNTO del que sale el archivo del listado 12,
// «Saldos de tiendas».
//
// **Lo que esta tanda NO gana:** nada de coste. El conjunto es la misma agregacion del ledger
// entero que la pantalla ya releia (`groupBy` + la resolucion de nombres), ni una consulta mas
// ni una menos. Fingir un ahorro aqui seria mentir.
//
// **Lo que si gana, y no es cosmetico: el archivo estaba SIN ORDENAR.** `listarSaldosTodasTiendas`
// devuelve las filas en el orden que le conviene al planificador de Postgres —lo dice el propio
// repositorio, y por eso la 170 tuvo que anadir un orden al paginar— mientras la tabla las
// presenta por nombre de tienda. Con la relectura de hoy, la fila 26 del archivo NO es la
// primera de la pagina 2, y dos descargas seguidas pueden salir en distinto orden. La 170 dejo
// esa divergencia declarada como desviacion consciente porque entonces ese conjunto no sostenia
// ningun archivo; desde esta tanda lo sostiene, y R5 deja de admitirla.
//
// Por eso el conjunto se pide al MISMO metodo del que sale la pagina —donde vive la UNICA
// declaracion del orden (R16)— y no a `listarSaldosTodasTiendas`, que es lo que el inventario
// anoto y seria heredar el defecto.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "u-admin", rol: "admin" };

const ROLES_SIN_ACCESO: Actor[] = [
  { usuarioId: "t1", rol: "adminTienda" }, // ni siquiera para ver el suyo
  { usuarioId: "s1", rol: "adminSatelite" },
  { usuarioId: "g1", rol: "mensajero" },
  { usuarioId: "k1", rol: "apiKey" },
  { usuarioId: "x1", rol: "otroRolInventado" as Actor["rol"] },
];

/**
 * Almacen deliberadamente DESORDENADO por nombre, y con un nombre DISTINTO en cada fila: es la
 * unica forma de que una mutacion que cambie el orden del conjunto se note. Un fixture con el
 * mismo nombre en todas las filas dejaria pasar la reordenacion sin un solo caso rojo.
 *
 * Los saldos tambien difieren, para que el mapper de dinero no se pueda confundir con otro.
 */
const AGREGADOS: SaldoTiendaAgregadoRow[] = [
  { tiendaId: "t-3", tiendaNombre: "Carlos", creditos: "1000.00", debitos: "250.00" },
  { tiendaId: "t-1", tiendaNombre: "Ana", creditos: "500.00", debitos: "500.00" },
  { tiendaId: "t-5", tiendaNombre: "Elena", creditos: "0.00", debitos: "80.00" },
  { tiendaId: "t-2", tiendaNombre: "Beto", creditos: "300.00", debitos: "100.00" },
  { tiendaId: "t-4", tiendaNombre: "Dora", creditos: "10.00", debitos: "0.00" },
];

/**
 * Repositorio doble que delega en la IMPLEMENTACION REAL del recorte: se inyecta la agregacion
 * —que es lo que toca Prisma— y `listarSaldosTiendasPaginado` corre el codigo de produccion
 * (orden + slice + total). Mismo montaje que `saldos-tiendas-paginado.test.ts`, para que estos
 * casos afirmen sobre el repositorio de verdad y no sobre una copia del criterio.
 */
function repoEnMemoria(filas: SaldoTiendaAgregadoRow[] = AGREGADOS) {
  const llamadas: string[] = [];

  const listarSaldosTodasTiendas = vi.fn(async () => {
    llamadas.push("listarSaldosTodasTiendas");
    return filas; // TAL CUAL: sin ordenar, como los devuelve el `groupBy`
  });

  const listarSaldosTiendasPaginado = vi.fn(async (rango: RangoPagina) => {
    llamadas.push("listarSaldosTiendasPaginado");
    return WalletTiendaMovimientoRepository.prototype.listarSaldosTiendasPaginado.call(
      { listarSaldosTodasTiendas } as unknown as WalletTiendaMovimientoRepository,
      rango,
    );
  });

  const repo = {
    listarSaldosTodasTiendas,
    listarSaldosTiendasPaginado,
    listarPorTienda: vi.fn(),
    agregarSaldoPorTienda: vi.fn(),
    agregarDesglosePorTienda: vi.fn(),
    crearMovimientos: vi.fn(),
  } as unknown as IWalletTiendaMovimientoRepository;

  return { repo, llamadas, listarSaldosTiendasPaginado };
}

function servicio(repo: IWalletTiendaMovimientoRepository) {
  return new WalletTiendaService(repo);
}

function nombres(items: ReadonlyArray<{ tiendaNombre: string }>): string[] {
  return items.map((t) => t.tiendaNombre);
}

/** N tiendas con nombres que difieren y NO llegan ya ordenadas, para los bordes del tope. */
function nTiendas(n: number): SaldoTiendaAgregadoRow[] {
  return Array.from({ length: n }, (_, i) => ({
    tiendaId: `t-${String(n - i).padStart(6, "0")}`,
    tiendaNombre: `Tienda ${String(n - i).padStart(6, "0")}`,
    creditos: "10.00",
    debitos: "0.00",
  }));
}

describe("WalletTiendaService.listarSaldosTiendasCompleto (feature 184, T G.1)", () => {
  it("un rol sin acceso recibe forbidden ANTES de tocar el repositorio (R4)", async () => {
    for (const actor of ROLES_SIN_ACCESO) {
      const { repo, llamadas } = repoEnMemoria();
      const r = await servicio(repo).listarSaldosTiendasCompleto(actor);

      expect(r, `rol ${actor.rol}`).toEqual({ status: "forbidden" });
      expect(r, `rol ${actor.rol}`).not.toHaveProperty("items");
      expect(r, `rol ${actor.rol}`).not.toHaveProperty("total"); // un conteo tambien es informacion
      // El guard va ANTES del repositorio: el saldo de todas las tiendas no sale de la base.
      expect(llamadas, `rol ${actor.rol}`).toEqual([]);
    }

    // El otro lado, sin el cual lo de arriba pasaria con un servicio mudo. Y `adminTienda` en la
    // lista de arriba no es un descuido: su superficie es `listarMisMovimientos`, que acota por
    // el actor; abrirle esta le daria el saldo de su competencia dentro de un xlsx.
    for (const actor of [MAESTRO, ADMIN]) {
      const r = await servicio(repoEnMemoria().repo).listarSaldosTiendasCompleto(actor);
      if (r.status !== "ok") throw new Error("no ok");
      expect(nombres(r.items), `rol ${actor.rol}`).toEqual([
        "Ana",
        "Beto",
        "Carlos",
        "Dora",
        "Elena",
      ]);
    }
  });

  it("el alcance sale del ACTOR: el metodo no tiene parametro por el que pedir otro (R4)", async () => {
    const { repo } = repoEnMemoria();
    expect(servicio(repo).listarSaldosTiendasCompleto).toHaveLength(1); // solo el actor
  });

  it("el conjunto del archivo sale ORDENADO como la pagina, no en el orden del planificador (R5)", async () => {
    // ESTE es el caso de la tanda. El almacen llega desordenado a proposito: si el conjunto se
    // pidiera a `listarSaldosTodasTiendas` —lo que hacia la pantalla, y lo que el inventario
    // anoto— saldria "Carlos, Ana, Elena, Beto, Dora" y este caso se pondria rojo.
    const svc = servicio(repoEnMemoria().repo);

    const completo = await svc.listarSaldosTiendasCompleto(MAESTRO);
    if (completo.status !== "ok") throw new Error("no ok");

    const recorrido: string[] = [];
    for (let page = 1; page <= 10; page += 1) {
      const p = await svc.listarSaldosTiendasPaginado({ page, pageSize: 2 }, MAESTRO);
      if (p.status !== "ok") throw new Error("no ok");
      if (p.items.length === 0) break;
      recorrido.push(...nombres(p.items));
    }

    // `toEqual` sobre el ARRAY, no sobre un `Set` ni sobre una copia ordenada: el orden ES lo
    // que se afirma, y es justo lo que la 170 tuvo que dejar fuera de su comparacion.
    expect(nombres(completo.items)).toEqual(recorrido);
    expect(nombres(completo.items)).toEqual(["Ana", "Beto", "Carlos", "Dora", "Elena"]);
    expect(completo.total).toBe(recorrido.length);

    // Y la contraprueba de que el fixture no es el que ordena: el almacen NO llega asi.
    expect(AGREGADOS.map((r) => r.tiendaNombre)).not.toEqual(nombres(completo.items));
  });

  it("las filas del archivo son las MISMAS que las de la pagina: un solo mapper de dinero (R16)", async () => {
    const svc = servicio(repoEnMemoria().repo);
    const completo = await svc.listarSaldosTiendasCompleto(MAESTRO);
    const pagina = await svc.listarSaldosTiendasPaginado({ page: 1, pageSize: 50 }, MAESTRO);
    if (completo.status !== "ok" || pagina.status !== "ok") throw new Error("no ok");

    expect(completo.items).toEqual(pagina.items);
    // Money-safe y signo incluidos: los cinco casos del derivador, en STRING escala 2.
    expect(completo.items.map((t) => `${t.saldo}/${t.signo}`)).toEqual([
      "0.00/cero", // Ana: 500 - 500
      "200.00/positivo", // Beto: 300 - 100
      "750.00/positivo", // Carlos: 1000 - 250
      "10.00/positivo", // Dora: 10 - 0
      "-80.00/negativo", // Elena: 0 - 80
    ]);
    // El listado sin paginar que esta tanda sustituye deriva el MISMO saldo: el archivo y la
    // pantalla no pueden decir dos cifras del mismo libro.
    const viejo = await svc.listarSaldosTiendas(MAESTRO);
    if (viejo.status !== "ok") throw new Error("no ok");
    expect([...completo.items].sort((a, b) => a.tiendaId.localeCompare(b.tiendaId))).toEqual(
      [...viejo.tiendas].sort((a, b) => a.tiendaId.localeCompare(b.tiendaId)),
    );
  });

  it("con MAX_FILAS entrega TODAS; con una mas devuelve limite_excedido y ni una fila (R6)", async () => {
    const limite = descargaConfig.MAX_FILAS;

    const justo = await servicio(
      repoEnMemoria(nTiendas(limite)).repo,
    ).listarSaldosTiendasCompleto(MAESTRO);
    if (justo.status !== "ok") throw new Error("en el tope EXACTO el archivo sale");
    expect(justo.items).toHaveLength(limite);
    expect(justo.total).toBe(limite);

    const unaMas = await servicio(
      repoEnMemoria(nTiendas(limite + 1)).repo,
    ).listarSaldosTiendasCompleto(MAESTRO);

    expect(unaMas).toEqual({ status: "limite_excedido", total: limite + 1, limite });
    // R6: ni una fila, y el total es el del CONJUNTO —no «5001»— porque sale del mismo
    // resultado que las filas.
    expect(unaMas).not.toHaveProperty("items");
  });

  it("el conjunto pide UNA agregacion, la misma que el listado de la pantalla", async () => {
    // Anti-vacuidad de la afirmacion «no cuesta mas»: el listado que esta tanda sustituye hace
    // exactamente la misma agregacion. Lo que este caso vigila es que no haya SOBRECOSTE —el
    // recorte del repositorio no anade consultas, reusa la que ya hay— y que el conjunto no se
    // sirva de una lectura distinta de la de la pagina.
    const viejo = repoEnMemoria();
    await servicio(viejo.repo).listarSaldosTiendas(MAESTRO);
    expect(viejo.llamadas).toEqual(["listarSaldosTodasTiendas"]);

    const nuevo = repoEnMemoria();
    await servicio(nuevo.repo).listarSaldosTiendasCompleto(MAESTRO);
    expect(nuevo.llamadas).toEqual(["listarSaldosTiendasPaginado", "listarSaldosTodasTiendas"]);

    // La agregacion del ledger se pide UNA vez, igual que antes: el recorte no la repite.
    const agregaciones = (ls: string[]) => ls.filter((l) => l === "listarSaldosTodasTiendas").length;
    expect(agregaciones(nuevo.llamadas)).toBe(agregaciones(viejo.llamadas));
    expect(agregaciones(nuevo.llamadas)).toBe(1);
  });

  it("pide como mucho el tope + 1 filas: lo justo para saber que se supero (R6)", async () => {
    const nuevo = repoEnMemoria();
    await servicio(nuevo.repo).listarSaldosTiendasCompleto(MAESTRO);

    const rango = nuevo.listarSaldosTiendasPaginado.mock.calls[0]![0];
    // `skip: 0` porque el conjunto empieza en la primera fila —no es una pagina— y `take` una
    // por encima del tope: con `take` = tope exacto, un conjunto de 5001 se veria como 5000 y
    // el archivo saldria truncado sin avisar.
    expect(rango).toEqual({ skip: 0, take: descargaConfig.MAX_FILAS + 1 });
  });
});
