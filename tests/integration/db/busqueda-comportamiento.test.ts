import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { OrdenService } from "@/lib/services/OrdenService";
import type { ListOrdenesWhere } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { listarOrdenesSchema } from "@/lib/types/orden";
import { normalizarTerminoBusqueda } from "@/lib/utils/busqueda-orden";
import { fakeIntentosEnLote } from "@/tests/fixtures/intentos-entrega";
import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  fksDeOrden,
  type FksDeOrden,
} from "./_postgres-real";

// Feature 169 / T2.6 (+ la mitad de COMPORTAMIENTO de T2.5) — que la busqueda ENCUENTRE lo
// que tiene que encontrar, contra Postgres real: R5, R6, R7, R8, R13, R15, R16, R17, y la
// contraprueba de R2 (los datos que el humano dejo FUERA del alcance no coinciden).
//
// Por que contra base y no con un doble: lo que se prueba aqui es el motor —la columna
// generada, el plegado de acentos, el `LIKE` y su escape—. Un repositorio en memoria que
// "hace lo mismo" solo demostraria que dos implementaciones mias coinciden.
//
// Todo corre en una transaccion que SIEMPRE se revierte, y el corpus se acota por
// `createdAt >= marca` (las filas se insertan dentro del test). El primer caso comprueba
// ese acotamiento: si entrara una fila ajena, los conteos dejarian de ser afirmables.

const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };
const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const SUFIJO = `b169-${Date.now().toString(36)}`;

interface Semilla {
  clave: string;
  numGuia: number | null;
  numRemision: string;
  telefonoDest: string;
  destinatario: string;
  direccion?: string;
  producto?: string;
  notas?: string;
  borrada?: boolean;
}

const SEMILLAS: Semilla[] = [
  {
    clave: "acentos",
    numGuia: 44556610,
    numRemision: `REM-${SUFIJO}-ALPHA`,
    telefonoDest: "8888-0000",
    destinatario: "José Hernández Solís",
  },
  {
    clave: "sin-tilde",
    numGuia: 44556611,
    numRemision: `REM-${SUFIJO}-BETA`,
    telefonoDest: "60011234",
    destinatario: "MARIA PENA",
  },
  {
    clave: "espacios",
    numGuia: 44556612,
    numRemision: `FAC-${SUFIJO}-0912`,
    telefonoDest: "70009999",
    destinatario: "Ana   Rojas Mora",
  },
  {
    clave: "porcentaje",
    numGuia: 44556613,
    numRemision: `REM-${SUFIJO}-PCT`,
    telefonoDest: "22221111",
    destinatario: "Cliente 100% Satisfecho",
  },
  {
    clave: "telefono-guion",
    numGuia: 44556614,
    numRemision: `REM-${SUFIJO}-TEL`,
    telefonoDest: "8712-3456",
    destinatario: "Carlos Vega",
  },
  {
    clave: "borrada",
    numGuia: 44556615,
    numRemision: `REM-${SUFIJO}-DEL`,
    telefonoDest: "50505050",
    destinatario: "Fantasma Borrado",
    borrada: true,
  },
  {
    // Contraprueba de R2: los campos que siguen FUERA del alcance (direccion y notas)
    // llevan palabras unicas. Si alguna vez coinciden, es que alguien amplio la columna
    // generada sin decirlo. `producto` estuvo aqui hasta la migracion
    // `20260808120000_orden_busqueda_producto`, que lo metio DENTRO del alcance; su
    // palabra unica se conserva porque ahora sirve para lo contrario: demostrar que SI se
    // encuentra (ver "el PRODUCTO tambien es buscable").
    clave: "fuera-de-alcance",
    numGuia: 44556616,
    numRemision: `REM-${SUFIJO}-OUT`,
    telefonoDest: "40404040",
    destinatario: "Sin Coincidencia",
    direccion: "Calle Zarzaparrilla 123",
    producto: "Berenjena Cuantica",
    notas: "Nota Malaquita",
  },
  {
    // M1 del review: una remision NUMERICA CON SEPARADORES. La columna indexa la remision
    // TAL CUAL (a diferencia del telefono, que va tambien en su forma solo-digitos), asi que
    // esta fila es la unica que puede demostrar que teclear `2026-0912` la encuentra.
    clave: "remision-numerica",
    numGuia: 44559900,
    numRemision: `REM-2026-0912-${SUFIJO}`,
    telefonoDest: "21212121",
    destinatario: "Rebeca Numerica",
  },
  {
    clave: "sin-guia",
    numGuia: null,
    numRemision: `REM-${SUFIJO}-NOGUIA`,
    telefonoDest: "30303030",
    destinatario: "Pendiente De Guia",
  },
];

const VIVAS = SEMILLAS.filter((s) => !s.borrada).length;

describeSiHayBase("comportamiento de la busqueda contra Postgres", () => {
  let prisma: PrismaClient;
  let fks: FksDeOrden | null;
  /** Ejecuta `fn` con un repositorio conectado al corpus recien sembrado, y revierte. */
  let conCorpus: <T>(
    fn: (ctx: {
      repo: OrdenRepository;
      service: OrdenService;
      idPorClave: Map<string, string>;
      marca: Date;
    }) => Promise<T>,
  ) => Promise<T>;

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    fks = await fksDeOrden(prisma);
    if (!fks) return;
    const base = fks;
    conCorpus = (fn) =>
      enTransaccionRevertida(prisma, async (tx) => {
        const marca = new Date();
        const idPorClave = new Map<string, string>();
        for (const semilla of SEMILLAS) {
          const creada = await tx.orden.create({
            data: {
              numGuia: semilla.numGuia,
              numRemision: semilla.numRemision,
              destinatario: semilla.destinatario,
              telefonoDest: semilla.telefonoDest,
              producto: semilla.producto ?? "caja",
              direccion: semilla.direccion ?? null,
              notas: semilla.notas ?? null,
              deletedAt: semilla.borrada ? new Date() : null,
              estatusId: base.estatusId,
              tiendaId: base.tiendaId,
              zonaId: base.zonaId,
              provinciaId: base.provinciaId,
              cantonId: base.cantonId,
            },
            select: { id: true },
          });
          idPorClave.set(semilla.clave, creada.id);
        }
        const repo = new OrdenRepository(tx as unknown as PrismaClient);
        const service = new OrdenService(repo, fakeIntentosEnLote());
        return fn({ repo, service, idPorClave, marca });
      });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  /** Busca un termino DENTRO del corpus sembrado y devuelve las claves que casaron. */
  async function buscar(
    termino: string,
    extra: Partial<ListOrdenesWhere> = {},
  ): Promise<{ claves: string[]; total: number }> {
    return conCorpus(async ({ repo, idPorClave, marca }) => {
      const { items, total } = await repo.list({
        where: {
          createdAt: { gte: marca },
          busqueda: normalizarTerminoBusqueda(termino),
          ...extra,
        },
        sortBy: "created_at",
        sortDir: "asc",
        skip: 0,
        take: 50,
      });
      const claves = items.map(
        (o) => [...idPorClave].find(([, id]) => id === o.id)?.[0] ?? o.id,
      );
      return { claves, total };
    });
  }

  it("hay ordenes de las que tomar las FKs", () => {
    expect(fks).not.toBeNull();
  });

  it("el corpus queda acotado: sin termino solo salen las filas VIVAS sembradas (R17)", async () => {
    // Contrapeso de todo el archivo: si este caso fallara, los conteos de abajo no
    // afirmarian nada (podrian estar contando filas de la base de desarrollo).
    if (!fks) return;
    const { claves, total } = await conCorpus(async ({ repo, idPorClave, marca }) => {
      const { items, total } = await repo.list({
        where: { createdAt: { gte: marca } },
        sortBy: "created_at",
        sortDir: "asc",
        skip: 0,
        take: 50,
      });
      return {
        claves: items.map((o) => [...idPorClave].find(([, id]) => id === o.id)?.[0] ?? o.id),
        total,
      };
    });
    expect(total).toBe(VIVAS);
    expect(claves).not.toContain("borrada");
  });

  describe("fragmento en cualquier posicion (R5)", () => {
    it("al PRINCIPIO del destinatario", async () => {
      expect((await buscar("jose")).claves).toEqual(["acentos"]);
    });

    it("en MEDIO del destinatario", async () => {
      expect((await buscar("hernandez")).claves).toEqual(["acentos"]);
    });

    it("al FINAL del destinatario", async () => {
      expect((await buscar("solis")).claves).toEqual(["acentos"]);
    });

    it("dentro de una palabra, no solo al principio de ella", async () => {
      // Es justo lo que la busqueda de texto completo (tsvector) NO puede hacer, y el
      // motivo de haberla descartado: aqui se buscan FRAGMENTOS, no palabras.
      expect((await buscar("rnand")).claves).toEqual(["acentos"]);
    });

    it("fragmento en medio de la REMISION", async () => {
      expect((await buscar(SUFIJO)).claves.length).toBe(VIVAS);
    });

    it("el PRODUCTO tambien es buscable, y con el mismo plegado que el resto", async () => {
      // Migracion `20260808120000_orden_busqueda_producto`. Se busca en minusculas un
      // producto guardado como "Berenjena Cuantica": si alguien resolviera esto con un
      // `ILIKE` sobre la columna cruda en vez de por la columna generada, este caso
      // pasaria igual pero el de acentos (paridad) no.
      expect((await buscar("berenjena")).claves).toEqual(["fuera-de-alcance"]);
      expect((await buscar("berenjena cuantica")).claves).toEqual(["fuera-de-alcance"]);
    });

    it("fragmento de la GUIA (los ultimos digitos)", async () => {
      // Sin la columna generada esto seria imposible: `num_guia` es `int` y ningun indice
      // btree sirve para un fragmento en medio.
      expect((await buscar("4455661")).claves.sort()).toEqual(
        ["acentos", "espacios", "fuera-de-alcance", "porcentaje", "sin-tilde", "telefono-guion"].sort(),
      );
    });
  });

  describe("acentos y caja, en los dos sentidos (R6)", () => {
    it("un termino SIN tildes encuentra el dato CON tildes", async () => {
      expect((await buscar("hernandez solis")).claves).toEqual(["acentos"]);
    });

    it("un termino CON tildes encuentra el dato SIN tildes", async () => {
      expect((await buscar("Peña")).claves).toEqual(["sin-tilde"]);
    });

    it("un termino en MAYUSCULAS encuentra el dato en minusculas y al reves", async () => {
      expect((await buscar("JOSÉ HERNÁNDEZ")).claves).toEqual(["acentos"]);
      expect((await buscar("maria pena")).claves).toEqual(["sin-tilde"]);
    });

    it("mayusculas acentuadas tambien se pliegan (translate va antes de lower)", async () => {
      expect((await buscar("SOLÍS")).claves).toEqual(["acentos"]);
    });
  });

  describe("espacios sobrantes (R8)", () => {
    it("un dato con espacios repetidos se encuentra tecleando espacios simples", async () => {
      expect((await buscar("ana rojas")).claves).toEqual(["espacios"]);
    });

    it("un termino con espacios repetidos da el MISMO resultado que con simples", async () => {
      const conRepetidos = await buscar("  ana    rojas  ");
      const conSimples = await buscar("ana rojas");
      expect(conRepetidos.claves).toEqual(conSimples.claves);
      expect(conRepetidos.total).toBe(conSimples.total);
    });
  });

  describe("telefono con y sin separadores (R13)", () => {
    it("los digitos encuentran el telefono guardado CON guion", async () => {
      expect((await buscar("87123456")).claves).toEqual(["telefono-guion"]);
    });

    it("el telefono CON guion se encuentra tal cual", async () => {
      expect((await buscar("8712-3456")).claves).toEqual(["telefono-guion"]);
    });

    it("los ultimos digitos bastan (el caso de uso real del operador)", async () => {
      expect((await buscar("3456")).claves).toEqual(["telefono-guion"]);
    });

    it("funciona igual con el otro telefono con guion del corpus", async () => {
      expect((await buscar("88880000")).claves).toEqual(["acentos"]);
      expect((await buscar("8888-0000")).claves).toEqual(["acentos"]);
    });
  });

  describe("comodines como texto literal (R7)", () => {
    it("`100%` encuentra SOLO la orden que dice 100%, no todo lo que empieza por 100", async () => {
      const conPorcentaje = await buscar("100%");
      expect(conPorcentaje.claves).toEqual(["porcentaje"]);
      expect(conPorcentaje.total).toBe(1);
    });

    it("un `%` suelto no devuelve el listado entero: solo lo que contiene un % literal", async () => {
      // Sin escape, este termino casaria TODAS las filas del corpus: la fuga mas ruidosa
      // posible. Con escape casa exactamente la unica orden que lleva un `%` en su texto.
      const soloPorcentaje = await buscar("%");
      expect(soloPorcentaje.claves).toEqual(["porcentaje"]);
      expect(soloPorcentaje.total).toBe(1);
      expect(soloPorcentaje.total).toBeLessThan(VIVAS);
    });

    it("`_` no comodinea: `1_0` no encuentra `100`", async () => {
      expect((await buscar("1_0")).total).toBe(0);
      expect((await buscar("100")).claves).toEqual(["porcentaje"]);
    });

    it("un backslash tampoco escapa nada: `\\%` no encuentra el 100%", async () => {
      expect((await buscar("\\%")).total).toBe(0);
    });
  });

  describe("lo que la busqueda NO debe encontrar (R2/R17)", () => {
    it("R17: una orden borrada logicamente no aparece ni buscandola por su nombre exacto", async () => {
      expect((await buscar("fantasma borrado")).total).toBe(0);
      expect((await buscar("50505050")).total).toBe(0);
    });

    it("R2: la DIRECCION no es buscable", async () => {
      expect((await buscar("zarzaparrilla")).total).toBe(0);
    });

    it("R2: las NOTAS no son buscables", async () => {
      expect((await buscar("malaquita")).total).toBe(0);
    });

    it("un termino que no esta en ningun campo devuelve cero", async () => {
      expect((await buscar("wenceslao")).total).toBe(0);
    });
  });

  describe("conteo y orden (R15/R16)", () => {
    it("R15: el total coincide con el numero real de coincidencias", async () => {
      const unaSola = await buscar("solis");
      expect(unaSola.total).toBe(unaSola.claves.length);
      expect(unaSola.total).toBe(1);
      const todas = await buscar(SUFIJO);
      expect(todas.total).toBe(VIVAS);
      expect(todas.claves).toHaveLength(VIVAS);
    });

    it("R15: el total respeta el AND con los demas filtros (R14)", async () => {
      if (!fks) return;
      const conEstado = await buscar(SUFIJO, { estatusId: "no-existe" });
      expect(conEstado.total).toBe(0);
    });

    it("R16: el orden del listado es el mismo con termino y sin termino", async () => {
      if (!fks) return;
      const { conTermino, sinTermino } = await conCorpus(async ({ repo, marca }) => {
        const comun = { sortBy: "created_at", sortDir: "asc", skip: 0, take: 50 } as const;
        const sin = await repo.list({ where: { createdAt: { gte: marca } }, ...comun });
        const con = await repo.list({
          where: { createdAt: { gte: marca }, busqueda: normalizarTerminoBusqueda(SUFIJO) },
          ...comun,
        });
        return {
          sinTermino: sin.items.map((o) => o.id),
          conTermino: con.items.map((o) => o.id),
        };
      });
      // Mismo conjunto y mismo ORDEN: la busqueda filtra, no ranquea por relevancia.
      expect(conTermino).toEqual(sinTermino);
    });
  });

  describe("M1: un termino de digitos CON separadores se busca en sus DOS formas", () => {
    /**
     * Busca POR EL CAMINO COMPLETO (service: es el que decide las formas del termino) y
     * devuelve solo las filas DEL CORPUS que casaron. El acotamiento por `createdAt` no
     * sirve aqui —el service construye su propio `where`—, asi que las filas ajenas de la
     * base de desarrollo se descartan por id: los conteos siguen afirmando algo.
     */
    async function buscarConServicio(termino: string): Promise<string[]> {
      return conCorpus(async ({ service, idPorClave }) => {
        const r = await service.listar(
          listarOrdenesSchema.parse({ filter: { q: termino }, pageSize: 100 }),
          MAESTRO,
        );
        if (r.status !== "ok") throw new Error(`status ${r.status}`);
        const porId = new Map([...idPorClave].map(([clave, id]) => [id, clave]));
        return r.items.map((o) => porId.get(o.id)).filter((c): c is string => c !== undefined);
      });
    }

    it("`2026-0912` encuentra la remision `REM-2026-0912` (R5, el falso negativo de M1)", async () => {
      if (!fks) return;
      expect(await buscarConServicio("2026-0912")).toEqual(["remision-numerica"]);
    });

    it("y NO la encontraba reducido a digitos: por eso hacen falta las dos formas", async () => {
      // Contraprueba del caso de arriba. `20260912` es el termino tal como viajaba ANTES de
      // M1 (la reduccion a digitos aplicada siempre): no casa nada, porque la remision se
      // indexa con sus guiones. Si algun dia esta asercion se volviera falsa, seria que
      // alguien amplio la columna generada — y entonces la de arriba habria que releerla.
      if (!fks) return;
      expect(await buscarConServicio("20260912")).toEqual([]);
    });

    it("un telefono tecleado CON guiones sigue encontrando el guardado SIN ellos (R13)", async () => {
      // La mitad que motivo la reduccion a digitos, y que no se puede perder: `60011234`
      // esta guardado pelado, y aqui se teclea con guion.
      if (!fks) return;
      expect(await buscarConServicio("6001-1234")).toEqual(["sin-tilde"]);
    });

    it("y un telefono guardado CON guiones se sigue encontrando de las dos maneras", async () => {
      if (!fks) return;
      expect(await buscarConServicio("8712-3456")).toEqual(["telefono-guion"]);
      expect(await buscarConServicio("87123456")).toEqual(["telefono-guion"]);
    });

    it("R9 intacto: una guia tecleada en limpio devuelve SOLO esa orden", async () => {
      // La ruta rapida no la toca M1: un termino de digitos PELADOS sigue resolviendose por
      // igualdad contra `num_guia`, sin trigram y sin segunda forma. La guia 44559900 es la
      // de la fila de remision numerica, cuyo texto contiene ademas `2026`: si la ruta
      // rapida hubiera degradado a coincidencia parcial, saldrian mas filas.
      if (!fks) return;
      expect(await buscarConServicio("44559900")).toEqual(["remision-numerica"]);
    });

    it("las dos formas SOLO ESTRECHAN: nunca devuelven mas que el corpus", async () => {
      // El OR de las dos formas vive dentro de la dimension de busqueda; el resto del
      // `where` sigue siendo AND. Con un estado inexistente, cero filas.
      if (!fks) return;
      const r = await conCorpus(async ({ repo, marca }) =>
        repo.list({
          where: {
            createdAt: { gte: marca },
            busqueda: "2026-0912",
            busquedaDigitos: "20260912",
            estatusId: "no-existe",
          },
          sortBy: "created_at",
          sortDir: "asc",
          skip: 0,
          take: 50,
        }),
      );
      expect(r.total).toBe(0);
      expect(r.items).toEqual([]);
    });
  });

  describe("ruta rapida y fallback, extremo a extremo (R9/R10)", () => {
    it("R9: un termino que ES una guia devuelve esa orden y SOLO esa", async () => {
      if (!fks) return;
      const r = await conCorpus(({ service }) =>
        service.listar(listarOrdenesSchema.parse({ filter: { q: "44556614" } }), MAESTRO),
      );
      expect(r.status).toBe("ok");
      if (r.status !== "ok") return;
      expect(r.total).toBe(1);
      expect(r.items[0].numGuia).toBe(44556614);
      // Y NO las que llevan ese numero dentro de otro dato: no hay coincidencia parcial.
      expect(r.items).toHaveLength(1);
    });

    it("R10: un termino numerico que NO es guia cae a coincidencia parcial", async () => {
      if (!fks) return;
      const r = await conCorpus(({ service, idPorClave }) =>
        service
          .listar(listarOrdenesSchema.parse({ filter: { q: "87123456" } }), MAESTRO)
          .then((res) => ({ res, esperado: idPorClave.get("telefono-guion") })),
      );
      expect(r.res.status).toBe("ok");
      if (r.res.status !== "ok") return;
      // Ninguna orden tiene la guia 87123456, asi que la ruta rapida devolvio 0 y el
      // service reintento por el trigram, encontrando el telefono `8712-3456`.
      expect(r.res.items.map((o) => o.id)).toContain(r.esperado);
      expect(r.res.total).toBeGreaterThan(0);
    });
  });
});
