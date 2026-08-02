import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";

import { WalletMensajeroService } from "@/lib/services/WalletMensajeroService";
import { PagoMensajeroMovimientoRepository } from "@/lib/repositories/PagoMensajeroMovimientoRepository";
import type {
  CuentaPorPagarAgregadoRow,
  CuentasPorPagarFiltro,
  IPagoMensajeroMovimientoRepository,
} from "@/lib/interfaces/repositories/IPagoMensajeroMovimientoRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { CuentaPorPagarResumenDTO } from "@/lib/types/wallet-mensajero";
import { listarCuentasPorPagarPaginadoSchema } from "@/lib/types/wallet-mensajero";
import type { RangoPagina } from "@/lib/utils/rango-pagina";

// Feature 170 — FASE 2, T L.1 (R40/R41/R45/R51) — «Cuentas por pagar a mensajeros» paginado.
//
// Es la pantalla de riesgo ALTO de la tanda L, y el riesgo tiene nombre: hoy el maestro recibe
// el dataset entero y BUSCA POR NOMBRE EN EL NAVEGADOR. Al paginar, esa busqueda dejaria de ver
// el conjunto —el usuario buscaria dentro de lo que tiene en pantalla— y nadie lo notaria hasta
// que un mensajero al que se le debe dinero no apareciera al escribir su nombre. El humano
// renuncio a la verificacion en pantalla: estos tests son la unica red.
//
// De ahi que el caso central no sea un caso feliz sino una BATERIA de 25 textos (vacio, solo
// espacios, ausente, parcial, acentos en los dos sentidos, mayusculas, espacios sobrantes,
// comodines de SQL y sin resultados) comparada, uno a uno, contra la busqueda de cliente
// COPIADA LITERAL del componente.
//
// El acotamiento es por ROL y es de los duros: `mensajero` no entra ni pidiendo lo suyo (su
// superficie es `listarMisPagos`, acotada por el actor). Este listado es la cuenta por pagar de
// TODOS los mensajeros.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "u-admin", rol: "admin" };

const ROLES_SIN_ACCESO: Actor[] = [
  { usuarioId: "m1", rol: "mensajero" }, // ni siquiera para ver lo suyo
  { usuarioId: "t1", rol: "adminTienda" },
  { usuarioId: "s1", rol: "adminSatelite" },
  { usuarioId: "k1", rol: "apiKey" },
  { usuarioId: "x1", rol: "otroRolInventado" as Actor["rol"] },
];

/**
 * El conjunto del maestro, deliberadamente DESORDENADO y con nombres «sucios» de verdad:
 * acentos (`José`/`JOSE`), minusculas, espacios sobrantes, guion bajo, dos homonimos exactos.
 *
 * Los montos no son decorado: la suma de las doce cuentas por pagar es 2410.75, y ninguna
 * pagina de este test llega a ese numero (§ el caso de dinero).
 */
const CONJUNTO: CuentaPorPagarAgregadoRow[] = [
  { mensajeroId: "m-07", mensajeroNombre: "Zulema Ovando", devengado: "900.00", pagado: "900.00" },
  { mensajeroId: "m-03", mensajeroNombre: "josé pérez", devengado: "500.00", pagado: "200.00" },
  { mensajeroId: "m-11", mensajeroNombre: "Ana_María Solís", devengado: "150.00", pagado: "0.00" },
  { mensajeroId: "m-01", mensajeroNombre: "Ana Mensajera", devengado: "1000.00", pagado: "300.00" },
  { mensajeroId: "m-09", mensajeroNombre: "Óscar Núñez", devengado: "80.00", pagado: "80.00" },
  { mensajeroId: "m-05", mensajeroNombre: "JOSE RAMIREZ", devengado: "640.50", pagado: "40.50" },
  { mensajeroId: "m-02", mensajeroNombre: "ana lópez", devengado: "220.25", pagado: "20.25" },
  { mensajeroId: "m-13", mensajeroNombre: "  Bruno Díaz  ", devengado: "60.00", pagado: "10.00" },
  { mensajeroId: "m-08", mensajeroNombre: "María del Carmen", devengado: "310.75", pagado: "0.00" },
  { mensajeroId: "m-06", mensajeroNombre: "Repetida", devengado: "70.00", pagado: "0.00" },
  { mensajeroId: "m-04", mensajeroNombre: "Repetida", devengado: "30.00", pagado: "0.00" },
  { mensajeroId: "m-12", mensajeroNombre: "carlos mensajero", devengado: "45.00", pagado: "45.00" },
];

/**
 * COPIADO LITERAL de `app/(app)/wallet/mensajeros/_components/CuentasPorPagarTable.tsx` (:84-88,
 * el `useMemo` de `filtrados`). Se copia y no se importa porque vive dentro de un componente y
 * no hay nada que importar; se copia LITERAL, y no «equivalente», porque R45 dice que el
 * conjunto tiene que ser el MISMO y la unica forma honesta de medirlo es contra el codigo que
 * hoy corre en el navegador.
 */
function busquedaDeCliente(
  mensajeros: CuentaPorPagarResumenDTO[],
  busqueda: string,
): CuentaPorPagarResumenDTO[] {
  const q = busqueda.trim().toLowerCase();
  if (q === "") return mensajeros;
  return mensajeros.filter((m) => m.mensajeroNombre.toLowerCase().includes(q));
}

/**
 * Repositorio doble que delega el filtro, el orden y el recorte en la IMPLEMENTACION REAL del
 * repositorio: se inyecta la agregacion y `listarCuentasPorPagarPaginado` corre el codigo de
 * produccion. Asi el test afirma el comportamiento del repositorio, no el de una copia suya.
 *
 * Lo que este doble NO puede ver es la traduccion a consultas Prisma (que la agregacion no
 * lleve `where`, ni `take`, ni `skip`). Eso vive en
 * `tests/unit/repositories/cuentas-por-pagar-paginado-where.test.ts`, por el aviso que las
 * tandas I, J y K midieron tres veces.
 */
function repoEnMemoria(filas: readonly CuentaPorPagarAgregadoRow[] = CONJUNTO) {
  const llamadas: string[] = [];

  const listarCuentasPorPagarTodos = vi.fn(async () => {
    llamadas.push("listarCuentasPorPagarTodos");
    return [...filas];
  });

  const listarCuentasPorPagarPaginado = vi.fn(
    async (filtro: CuentasPorPagarFiltro, rango: RangoPagina) => {
      llamadas.push("listarCuentasPorPagarPaginado");
      return PagoMensajeroMovimientoRepository.prototype.listarCuentasPorPagarPaginado.call(
        { listarCuentasPorPagarTodos } as unknown as PagoMensajeroMovimientoRepository,
        filtro,
        rango,
      );
    },
  );

  const repo = {
    crearMovimientos: vi.fn(),
    listarPorMensajero: vi.fn(),
    agregarCuentaPorPagar: vi.fn(),
    obtenerNombreMensajero: vi.fn(),
    listarCuentasPorPagarTodos,
    listarCuentasPorPagarPaginado,
  } as unknown as IPagoMensajeroMovimientoRepository;

  return { repo, llamadas, listarCuentasPorPagarPaginado };
}

function servicio(repo: IPagoMensajeroMovimientoRepository) {
  return new WalletMensajeroService(repo);
}

function input(extra: Record<string, unknown> = {}) {
  return listarCuentasPorPagarPaginadoSchema.parse(extra);
}

/** Recorre TODAS las paginas de un filtro y devuelve lo acumulado y el total declarado. */
async function recorrerPaginas(
  svc: WalletMensajeroService,
  actor: Actor,
  extra: Record<string, unknown> = {},
  pageSize = 5,
): Promise<{ items: CuentaPorPagarResumenDTO[]; total: number; paginas: number }> {
  const items: CuentaPorPagarResumenDTO[] = [];
  let total = -1;
  let paginas = 0;
  for (let page = 1; page <= 50; page += 1) {
    const r = await svc.listarCuentasPorPagarPaginado(input({ ...extra, page, pageSize }), actor);
    if (r.status !== "ok") throw new Error(`no ok: ${r.status}`);
    total = r.total;
    if (r.items.length === 0) break;
    paginas += 1;
    items.push(...r.items);
  }
  return { items, total, paginas };
}

/** Clave estable de una fila: identidad + los tres montos. Compara CONJUNTO y DINERO a la vez. */
function claves(filas: readonly CuentaPorPagarResumenDTO[]): string[] {
  return filas
    .map((m) => `${m.mensajeroId}|${m.devengado}|${m.pagado}|${m.cuentaPorPagar}|${m.signo}`)
    .sort();
}

function sumaCuentaPorPagar(filas: readonly CuentaPorPagarResumenDTO[]): string {
  return filas
    .reduce((acc, m) => acc.add(new Prisma.Decimal(m.cuentaPorPagar)), new Prisma.Decimal(0))
    .toFixed(2);
}

/**
 * Los 25 textos de la bateria. La columna `esperados` esta escrita A MANO contra el fixture: si
 * saliera de cualquiera de las dos implementaciones, un cambio de semantica (p. ej. volver la
 * busqueda insensible a acentos, o dejar que `%` sea comodin) pasaria verde en las dos.
 */
const BATERIA: { texto: string; esperados: string[]; nota: string }[] = [
  { texto: "", esperados: [], nota: "vacio: sin filtro (los 12)" },
  { texto: "   ", esperados: [], nota: "solo espacios: se recorta a vacio, sin filtro" },
  { texto: "ana", esperados: ["m-01", "m-02", "m-11"], nota: "parcial en minusculas" },
  { texto: "ANA", esperados: ["m-01", "m-02", "m-11"], nota: "mayusculas: mismo conjunto" },
  { texto: "AnA", esperados: ["m-01", "m-02", "m-11"], nota: "mezcla de caja" },
  { texto: "  ana  ", esperados: ["m-01", "m-02", "m-11"], nota: "espacios alrededor: se recortan" },
  { texto: "mensajer", esperados: ["m-01", "m-12"], nota: "subcadena que no es prefijo" },
  { texto: "jose", esperados: ["m-05"], nota: "SIN acento: NO alcanza a «josé pérez»" },
  { texto: "josé", esperados: ["m-03"], nota: "CON acento: NO alcanza a «JOSE RAMIREZ»" },
  { texto: "JOSÉ", esperados: ["m-03"], nota: "acento + mayusculas" },
  { texto: "perez", esperados: [], nota: "sin acento: cero resultados, no «casi»" },
  { texto: "pérez", esperados: ["m-03"], nota: "con acento" },
  { texto: "ó", esperados: ["m-02", "m-09"], nota: "una vocal acentuada suelta" },
  { texto: "Ó", esperados: ["m-02", "m-09"], nota: "la misma, en mayuscula" },
  {
    texto: "o",
    // Las dos de «ó» (m-02 «lópez», m-09 «Núñez»/«Óscar») NO estan: la vocal sin acento no las
    // alcanza, y ese es el punto.
    esperados: ["m-03", "m-05", "m-07", "m-11", "m-12", "m-13"],
    nota: "la vocal SIN acento no casa las acentuadas",
  },
  { texto: "ñ", esperados: ["m-09"], nota: "ene" },
  { texto: "repetida", esperados: ["m-04", "m-06"], nota: "dos homonimos exactos" },
  { texto: "REPETIDA", esperados: ["m-04", "m-06"], nota: "los mismos dos" },
  { texto: "%", esperados: [], nota: "comodin de SQL tratado como TEXTO: cero, no todos" },
  { texto: "a_m", esperados: ["m-11"], nota: "el `_` de SQL es texto: solo «Ana_María»" },
  { texto: "_", esperados: ["m-11"], nota: "un `_` suelto: una fila, no doce" },
  { texto: "bruno", esperados: ["m-13"], nota: "nombre con espacios al principio y al final" },
  { texto: "del carmen", esperados: ["m-08"], nota: "espacio INTERIOR: no se recorta" },
  { texto: "z", esperados: ["m-02", "m-03", "m-05", "m-07", "m-09", "m-13"], nota: "una letra: media tabla" },
  { texto: "zzz", esperados: [], nota: "sin resultados" },
];

describe("WalletMensajeroService.listarCuentasPorPagarPaginado (T L.1)", () => {
  it("para el mismo texto devuelve el mismo conjunto que la búsqueda de cliente (R45)", async () => {
    // El conjunto que la pantalla tiene HOY en el navegador: el listado sin paginar.
    const sinPaginar = await servicio(repoEnMemoria().repo).listarCuentasPorPagar(MAESTRO);
    if (sinPaginar.status !== "ok") throw new Error("no ok");
    expect(sinPaginar.mensajeros).toHaveLength(12);

    let conFilas = 0;
    for (const caso of BATERIA) {
      const svc = servicio(repoEnMemoria().repo);
      // pageSize 5 sobre 12 filas: todo texto poco selectivo cruza varias paginas.
      const recorrido = await recorrerPaginas(svc, MAESTRO, { busqueda: caso.texto }, 5);
      const deCliente = busquedaDeCliente(sinPaginar.mensajeros, caso.texto);

      // (1) El MISMO conjunto, fila a fila y monto a monto.
      expect(claves(recorrido.items), `«${caso.texto}» (${caso.nota})`).toEqual(claves(deCliente));
      // (2) Y el mismo tamano declarado: el total del servidor es el del conjunto filtrado.
      expect(recorrido.total, `«${caso.texto}»: total`).toBe(deCliente.length);

      // (3) Anti-vacuidad por caso: los esperados estan escritos A MANO en la bateria.
      const esperados =
        caso.esperados.length === 0 && caso.nota.includes("sin filtro")
          ? CONJUNTO.map((m) => m.mensajeroId).sort()
          : [...caso.esperados].sort();
      expect(
        recorrido.items.map((m) => m.mensajeroId).sort(),
        `«${caso.texto}» (${caso.nota}): ids esperados a mano`,
      ).toEqual(esperados);

      if (recorrido.items.length > 0) conFilas += 1;
    }

    // (4) Anti-vacuidad global: si el filtro de servidor devolviera siempre vacio, el bucle
    // habria comparado 25 veces [] con [] sin quejarse.
    expect(conFilas).toBe(22);
    expect(BATERIA).toHaveLength(25);
  });

  it("CONTRAPRUEBA de R45: la búsqueda mira el CONJUNTO, no la página visible", async () => {
    // «Zulema Ovando» es la ULTIMA del orden y con pageSize 3 vive en la cuarta pagina. Si la
    // busqueda se resolviera sobre las filas ya recortadas, pedir «zulema» en la pagina 1
    // devolveria vacio: es exactamente la regresion que esta tanda existe para evitar.
    const svc = servicio(repoEnMemoria().repo);

    const sinFiltro = await svc.listarCuentasPorPagarPaginado(
      input({ page: 1, pageSize: 3 }),
      MAESTRO,
    );
    if (sinFiltro.status !== "ok") throw new Error("no ok");
    expect(sinFiltro.items.map((m) => m.mensajeroId)).not.toContain("m-07");

    const conFiltro = await svc.listarCuentasPorPagarPaginado(
      input({ page: 1, pageSize: 3, busqueda: "zulema" }),
      MAESTRO,
    );
    if (conFiltro.status !== "ok") throw new Error("no ok");
    expect(conFiltro.items.map((m) => m.mensajeroId)).toEqual(["m-07"]);
    expect(conFiltro.items[0]!.cuentaPorPagar).toBe("0.00");
    expect(conFiltro.total).toBe(1);
  });

  it("devuelve la página pedida y el total del conjunto (R40, R41)", async () => {
    const svc = servicio(repoEnMemoria().repo);

    const p1 = await svc.listarCuentasPorPagarPaginado(input({ page: 1, pageSize: 5 }), MAESTRO);
    const p2 = await svc.listarCuentasPorPagarPaginado(input({ page: 2, pageSize: 5 }), MAESTRO);
    const p3 = await svc.listarCuentasPorPagarPaginado(input({ page: 3, pageSize: 5 }), MAESTRO);
    const p4 = await svc.listarCuentasPorPagarPaginado(input({ page: 4, pageSize: 5 }), MAESTRO);
    if (p1.status !== "ok" || p2.status !== "ok" || p3.status !== "ok" || p4.status !== "ok") {
      throw new Error("no ok");
    }

    expect(p1.items).toHaveLength(5);
    expect(p2.items).toHaveLength(5);
    expect(p3.items).toHaveLength(2); // 12 = 5 + 5 + 2
    expect(p4.items).toEqual([]); // mas alla del final: sin filas, con total

    // R41: el total es el del CONJUNTO en las cuatro, tambien donde no coincide con la pagina.
    for (const p of [p1, p2, p3, p4]) expect(p.total).toBe(12);
    expect(p3.total).not.toBe(p3.items.length);
    expect(p4.total).not.toBe(p4.items.length);

    // El eco del recorte efectivo, que la pantalla necesita para pintar el control.
    expect([p1.page, p1.pageSize]).toEqual([1, 5]);
    expect([p3.page, p3.pageSize]).toEqual([3, 5]);

    // Ni una fila repetida entre paginas ni caida entre dos.
    const recorrido = [...p1.items, ...p2.items, ...p3.items].map((m) => m.mensajeroId);
    expect(new Set(recorrido).size).toBe(12);
    expect([...recorrido].sort()).toEqual(CONJUNTO.map((m) => m.mensajeroId).sort());
  });

  it("el total responde a la búsqueda, no al conjunto entero (R41)", async () => {
    const svc = servicio(repoEnMemoria().repo);

    const filtrada = await svc.listarCuentasPorPagarPaginado(
      input({ page: 1, pageSize: 1, busqueda: "ana" }),
      MAESTRO,
    );
    if (filtrada.status !== "ok") throw new Error("no ok");

    expect(filtrada.items).toHaveLength(1); // la pagina
    expect(filtrada.total).toBe(3); // el conjunto que casa «ana»
    expect(filtrada.total).not.toBe(12); // ni el conjunto entero…
    expect(filtrada.total).not.toBe(filtrada.items.length); // …ni la pagina
  });

  it("acota el tamaño de página al máximo configurado y nunca lo excede (R40)", async () => {
    const r = await servicio(repoEnMemoria().repo).listarCuentasPorPagarPaginado(
      input({ pageSize: 100000 }),
      MAESTRO,
    );
    if (r.status !== "ok") throw new Error("no ok");
    expect(r.pageSize).toBe(100); // walletMensajeroConfig.MAX_PAGE_SIZE
    expect(r.items.length).toBeLessThanOrEqual(100);

    // Y sin pedir nada, el tamano por defecto del dominio (no un literal de la pantalla).
    const porDefecto = await servicio(repoEnMemoria().repo).listarCuentasPorPagarPaginado(
      input(),
      MAESTRO,
    );
    if (porDefecto.status !== "ok") throw new Error("no ok");
    expect([porDefecto.page, porDefecto.pageSize]).toEqual([1, 25]);
  });

  it("conserva el orden: el mismo, sea cual sea el orden en que la base devuelva las filas (R51)", async () => {
    // Este listado NO tenia criterio de ordenacion (su `groupBy` no declara `orderBy`), asi que
    // R51 se cumple aqui como DESVIACION declarada: se impone uno TOTAL. Lo que se afirma es lo
    // que hace correcta la paginacion: el orden no puede depender de lo que la base devuelva.
    const enOrden = await recorrerPaginas(servicio(repoEnMemoria().repo), MAESTRO, {}, 5);
    const alReves = await recorrerPaginas(
      servicio(repoEnMemoria([...CONJUNTO].reverse()).repo),
      MAESTRO,
      {},
      5,
    );

    // Anti-vacuidad: las dos entradas SI estan en ordenes distintos.
    expect(CONJUNTO.map((m) => m.mensajeroId)).not.toEqual(
      [...CONJUNTO].reverse().map((m) => m.mensajeroId),
    );
    expect(alReves.items.map((m) => m.mensajeroId)).toEqual(enOrden.items.map((m) => m.mensajeroId));

    // Orden TOTAL: no decreciente por nombre y, en los homonimos, por id ascendente. Sin el
    // desempate, «Repetida»/«Repetida» podrian salir en dos paginas o en ninguna.
    const salida = enOrden.items;
    for (let i = 1; i < salida.length; i += 1) {
      const previa = salida[i - 1]!;
      const actual = salida[i]!;
      const cmp = previa.mensajeroNombre.localeCompare(actual.mensajeroNombre);
      expect(cmp, `${previa.mensajeroNombre} antes de ${actual.mensajeroNombre}`).toBeLessThanOrEqual(0);
      if (cmp === 0) expect(previa.mensajeroId < actual.mensajeroId).toBe(true);
    }

    const ids = salida.map((m) => m.mensajeroId);
    expect(ids.indexOf("m-04")).toBe(ids.indexOf("m-06") - 1); // homonimos, por id
    expect(ids[ids.length - 1]).toBe("m-07"); // «Zulema Ovando», la ultima del alfabeto

    // Y es estable: dos lecturas de la misma pagina dan la misma fila.
    const otra = await recorrerPaginas(servicio(repoEnMemoria().repo), MAESTRO, {}, 5);
    expect(otra.items.map((m) => m.mensajeroId)).toEqual(ids);
  });

  it("el orden de un texto filtrado es el del listado, no el de la base (R51)", async () => {
    const svc = servicio(repoEnMemoria().repo);
    const r = await svc.listarCuentasPorPagarPaginado(
      input({ pageSize: 50, busqueda: "ana" }),
      MAESTRO,
    );
    if (r.status !== "ok") throw new Error("no ok");

    // En el fixture entran en el orden m-11, m-01, m-02; salen ordenados por nombre. El orden
    // es el de `localeCompare`, que compara sin distinguir caja: «ana lópez» va delante de «Ana
    // Mensajera» (l < m), no detras por empezar en minuscula.
    expect(r.items.map((m) => m.mensajeroNombre)).toEqual([
      "ana lópez",
      "Ana Mensajera",
      "Ana_María Solís",
    ]);
  });

  it("el dinero de cada fila sale del LIBRO ENTERO de ese mensajero, no de la página (R49)", async () => {
    const svc = servicio(repoEnMemoria().repo);

    // El conjunto completo, tal como lo ve el listado sin paginar.
    const sinPaginar = await servicio(repoEnMemoria().repo).listarCuentasPorPagar(MAESTRO);
    if (sinPaginar.status !== "ok") throw new Error("no ok");
    const totalConjunto = sumaCuentaPorPagar(sinPaginar.mensajeros);
    expect(totalConjunto).toBe("2410.75");

    // Una pagina cualquiera NO llega a ese numero: si un agregado de pantalla se calculara
    // sobre las filas visibles, diria que se debe menos de lo que se debe.
    const p1 = await svc.listarCuentasPorPagarPaginado(input({ page: 1, pageSize: 5 }), MAESTRO);
    if (p1.status !== "ok") throw new Error("no ok");
    expect(sumaCuentaPorPagar(p1.items)).not.toBe(totalConjunto);
    expect(new Prisma.Decimal(sumaCuentaPorPagar(p1.items)).lt(totalConjunto)).toBe(true);

    // Pero el dinero del CONJUNTO no cambia al paginar: la suma de todas las paginas es la
    // misma, y cada fila trae el mismo monto que traia sin paginar (string a string, sin
    // recomputar).
    const recorrido = await recorrerPaginas(svc, MAESTRO, {}, 5);
    expect(sumaCuentaPorPagar(recorrido.items)).toBe(totalConjunto);
    expect(claves(recorrido.items)).toEqual(claves(sinPaginar.mensajeros));

    // Y el mensajero que vive en la ULTIMA pagina declara su libro entero, no un trozo:
    // 1000.00 devengado y 300.00 pagado son los del conjunto, con pageSize 1.
    const sola = await svc.listarCuentasPorPagarPaginado(
      input({ pageSize: 1, busqueda: "Ana Mensajera" }),
      MAESTRO,
    );
    if (sola.status !== "ok") throw new Error("no ok");
    expect(sola.items).toEqual([
      {
        mensajeroId: "m-01",
        mensajeroNombre: "Ana Mensajera",
        devengado: "1000.00",
        pagado: "300.00",
        cuentaPorPagar: "700.00",
        signo: "positivo",
      },
    ]);
  });

  it("el conjunto paginado y el listado sin paginar coinciden para el mismo actor (R44)", async () => {
    for (const actor of [MAESTRO, ADMIN]) {
      const sinPaginar = await servicio(repoEnMemoria().repo).listarCuentasPorPagar(actor);
      if (sinPaginar.status !== "ok") throw new Error("no ok");

      const recorrido = await recorrerPaginas(servicio(repoEnMemoria().repo), actor, {}, 5);

      expect(claves(recorrido.items), `rol ${actor.rol}`).toEqual(claves(sinPaginar.mensajeros));
      expect(recorrido.total, `rol ${actor.rol}`).toBe(sinPaginar.mensajeros.length);
      expect(recorrido.paginas, `rol ${actor.rol}`).toBe(3);
    }
  });

  it("CONTRAPRUEBA de R44: forbidden sin filas ni total a todo rol sin acceso total", async () => {
    for (const actor of ROLES_SIN_ACCESO) {
      const { repo, llamadas } = repoEnMemoria();
      const r = await servicio(repo).listarCuentasPorPagarPaginado(input(), actor);

      expect(r, `rol ${actor.rol}`).toEqual({ status: "forbidden" });
      expect(r, `rol ${actor.rol}`).not.toHaveProperty("items");
      expect(r, `rol ${actor.rol}`).not.toHaveProperty("total");
      // El guard va ANTES del repositorio: la cuenta por pagar de todos los mensajeros no sale
      // de la base aunque la respuesta sea un error.
      expect(llamadas, `rol ${actor.rol}`).toEqual([]);
    }

    // El otro lado, para que la contraprueba no pase por negar siempre.
    for (const actor of [MAESTRO, ADMIN]) {
      const r = await servicio(repoEnMemoria().repo).listarCuentasPorPagarPaginado(
        input({ pageSize: 50 }),
        actor,
      );
      if (r.status !== "ok") throw new Error(`rol ${actor.rol}: no ok`);
      expect(r.items).toHaveLength(12);
      expect(r.total).toBe(12);
    }
  });

  it("la búsqueda no amplía el alcance: es el único dato del input que llega al repositorio (R44)", async () => {
    const { repo, listarCuentasPorPagarPaginado } = repoEnMemoria();
    await servicio(repo).listarCuentasPorPagarPaginado(
      // `mensajeroId` NO es una clave de este schema (el borde la rechaza); aqui se cuela a
      // mano, saltandose el borde, para comprobar que el servicio tampoco la lee.
      { ...input({ page: 2, pageSize: 4, busqueda: "ana" }), mensajeroId: "m-01" } as never,
      MAESTRO,
    );

    expect(listarCuentasPorPagarPaginado).toHaveBeenCalledTimes(1);
    expect(listarCuentasPorPagarPaginado.mock.calls[0]).toEqual([
      { busqueda: "ana" }, // y NADA mas: ni mensajeroId, ni page/pageSize disfrazados de filtro
      { skip: 4, take: 4 },
    ]);
  });

  it("no ejecuta más consultas que el listado sin paginar, ni siquiera la del conteo (R54)", async () => {
    const sinPaginar = repoEnMemoria();
    await servicio(sinPaginar.repo).listarCuentasPorPagar(MAESTRO);
    expect(sinPaginar.llamadas).toEqual(["listarCuentasPorPagarTodos"]);

    const paginado = repoEnMemoria();
    await servicio(paginado.repo).listarCuentasPorPagarPaginado(
      input({ pageSize: 5, busqueda: "ana" }),
      MAESTRO,
    );

    // UNA llamada al repositorio desde el servicio, y por dentro exactamente la MISMA
    // agregacion que el listado sin paginar. R54 en su forma fuerte: ni el conteo es una
    // consulta nueva, porque sale de esa agregacion.
    expect(paginado.llamadas).toEqual([
      "listarCuentasPorPagarPaginado",
      "listarCuentasPorPagarTodos",
    ]);
  });

  it("un conjunto vacío devuelve página vacía y total 0, no un error (R41)", async () => {
    const r = await servicio(repoEnMemoria([]).repo).listarCuentasPorPagarPaginado(
      input(),
      MAESTRO,
    );
    if (r.status !== "ok") throw new Error("no ok");
    expect(r.items).toEqual([]);
    expect(r.total).toBe(0);
  });
});
