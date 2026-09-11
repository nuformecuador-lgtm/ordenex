import { it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import {
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
} from "./_postgres-real";
import type { ConsultaConteoEntregas } from "@/lib/analytics/entregas-conteo";

import { crearOrden, instanteCR, sembrarBase } from "./_semilla-rollup";
import {
  cargadasDe,
  consultaDe,
  D,
  describeSiHayBase,
  leerCohortes,
  rangoDe,
} from "./_cohorte-carga";

/**
 * ⭑⭑ FICHA 411 / T4.6 — LA FRONTERA MULTI-TENANT, EN SQL Y CONTRA POSTGRES (R20).
 *
 * ⚠ POR QUE ESTE ARCHIVO Y NO UN TEST CON DOBLES. **Los dobles NO VEN EL SQL**, y en este repo
 * una mutacion del `WHERE` los pasa en verde — medido cuatro veces. Aqui no hay policies RLS
 * debajo (Prisma se conecta con credenciales de servicio), asi que **esa condicion del `WHERE`
 * ES la separacion entre inquilinos**: un fallo no da una cifra equivocada, filtra las ordenes de
 * una tienda a otra. Eso se prueba contra el motor o no se prueba.
 *
 * ─── EL ESCENARIO: DOS ZONAS x DOS TIENDAS ──────────────────────────────────────────────
 *
 * Cuatro ordenes, una en cada combinacion, todas el MISMO dia y dentro de la MISMA ventana. Lo
 * unico que las separa es el alcance concedido:
 *
 * | actor                       | alcance   | ve                       |
 * | --------------------------- | --------- | ------------------------ |
 * | `adminTienda` (tienda1)     | tienda    | las 2 de tienda1         |
 * | `adminSatelite` (zonaA)     | zona      | las 2 de zonaA           |
 * | `maestro`                   | global    | las 4 (+ lo que ya hubiera)|
 *
 * P2 de la ficha, dicha con todas las letras: el **`adminSatelite` VE la seccion**, con alcance
 * de zona. Aqui no se declara ninguna excepcion de permisos propia de esta tabla.
 *
 * El alcance NO se forja: cada consulta pasa por `prepararConteoEntregas`, que es el unico sitio
 * donde se gana el tipo opaco. Un test que lo construyera a mano estaria midiendo su propio
 * `as unknown as`, no la frontera.
 */

describeSiHayBase("411/T4.6 — el alcance recorta la cohorte DENTRO del SQL", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function escenario() {
    return enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const base = await sembrarBase(tx);

      // Cuantas ordenes de la base REAL caen ya en esta ventana. Casi siempre 0 (el ano 2001
      // esta vacio a proposito), pero se MIDE en vez de suponerse: el caso `global` suma esta
      // linea base y asi no se vuelve rojo en la maquina de alguien que si tenga datos de 2001.
      const [{ n }] = await tx.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(*)::bigint AS n FROM "orden" o
        WHERE o."deleted_at" IS NULL
          AND o."created_at" >= ${instanteCR(D, "00:00")}
          AND o."created_at" <  ${instanteCR("2001-06-16", "00:00")}`;
      const lineaBase = Number(n);

      const cargar = (clave: string, zonaId: string, tiendaId: string) =>
        crearOrden(tx, base, { clave, zonaId, tiendaId, createdAt: instanteCR(D, "09:00") });

      await cargar("zonaA-tienda1", base.zonaA, base.tienda1);
      await cargar("zonaA-tienda2", base.zonaA, base.tienda2);
      await cargar("zonaB-tienda1", base.zonaB, base.tienda1);
      await cargar("zonaB-tienda2", base.zonaB, base.tienda2);

      const rango = rangoDe(D, D);
      const [porTienda, porZona, global] = await Promise.all([
        leerCohortes(tx, consultaDe(rango, { usuarioId: base.tienda1, rol: "adminTienda" })),
        leerCohortes(
          tx,
          consultaDe(rango, { usuarioId: "u-satelite", rol: "adminSatelite", zonaId: base.zonaA }),
        ),
        leerCohortes(tx, consultaDe(rango, { usuarioId: "u-maestro", rol: "maestro" })),
      ]);

      // La MITAD DE ARRIBA del cinturon, sola. Ver el caso que la usa: se le quita al filtro el
      // recorte que `recortarFiltroConteoEntregas` le escribio, dejando en pie SOLO la condicion
      // de alcance. Esto se hace AQUI y solo aqui —un test cuyo objeto es medir esa condicion—,
      // nunca en `lib/`, donde forjar el tipo opaco es justo lo que persigue
      // `alcance-obligatorio.guardia.test.ts`.
      const conAlcanceDesnudo = (() => {
        const preparada = consultaDe(rango, { usuarioId: base.tienda1, rol: "adminTienda" });
        return {
          ...preparada,
          filtro: { ...preparada.filtro, tienda_id: undefined },
        } as ConsultaConteoEntregas;
      })();

      return {
        lineaBase,
        porTienda,
        porZona,
        global,
        soloPorAlcance: await leerCohortes(tx, conAlcanceDesnudo),
      };
    });
  }

  it("con alcance de TIENDA solo salen las de su tienda", async () => {
    const { porTienda } = await escenario();

    expect(porTienda.length, "el fixture no produjo ni una cohorte").toBeGreaterThan(0);
    // Dos de las cuatro: las de `tienda1`, en las dos zonas. Si el recorte se cayera, serian 4.
    expect(cargadasDe(porTienda, D)).toBe(2);
  });

  it("con alcance de ZONA solo salen las de su zona (el adminSatelite VE la seccion)", async () => {
    const { porZona } = await escenario();

    expect(porZona.length).toBeGreaterThan(0);
    // Dos de las cuatro: las de `zonaA`, en las dos tiendas.
    expect(cargadasDe(porZona, D)).toBe(2);
  });

  it("con alcance GLOBAL salen las cuatro", async () => {
    const { lineaBase, global } = await escenario();

    expect(global.length).toBeGreaterThan(0);
    expect(cargadasDe(global, D)).toBe(lineaBase + 4);
  });

  it("los tres recortes son DISTINTOS entre si: el alcance esta haciendo algo", async () => {
    // ANTI-VACIO en la direccion que importa. Si el `WHERE` del alcance desapareciera, los tres
    // devolverian lo mismo y los tres casos de arriba seguirian teniendo sentido leidos por
    // separado. Aqui se exige que el recorte SEPARE: dos vistas de 2 que no son la misma, y una
    // global estrictamente mayor.
    const { lineaBase, porTienda, porZona, global } = await escenario();

    expect(cargadasDe(global, D)).toBeGreaterThan(cargadasDe(porTienda, D));
    expect(cargadasDe(global, D)).toBeGreaterThan(cargadasDe(porZona, D));
    expect(cargadasDe(porTienda, D) + cargadasDe(porZona, D)).toBe(4);
    expect(lineaBase).toBeGreaterThanOrEqual(0);
  });

  // ⚠ ESTE ES EL CASO QUE MIDE LA CONDICION DE ALCANCE, y hace falta porque los cuatro de arriba
  // NO la miden. Medido: borrar `condicionDeAlcance` del `where` los deja a los cuatro EN VERDE.
  //
  // El motivo no es que sean flojos, es que el repo lleva CINTURON Y TIRANTES:
  // `recortarFiltroConteoEntregas` escribe el recorte DENTRO del filtro (`tienda_id: [tienda1]`),
  // y las facetas del filtro tambien acaban en el `where`. Con las dos piezas puestas, quitar una
  // no cambia ni una fila — y por eso una mutacion del `WHERE` pasa en verde en este repo.
  //
  // Aqui se le quita la faceta al filtro y se deja SOLO el alcance. Si alguien borrara la
  // condicion de alcance, este caso —y solo este— se pondria rojo con las cuatro ordenes.
  it("la condicion de ALCANCE sostiene el recorte ella sola, sin la faceta del filtro", async () => {
    const { soloPorAlcance } = await escenario();

    expect(soloPorAlcance.length, "el fixture no produjo ni una cohorte").toBeGreaterThan(0);
    expect(cargadasDe(soloPorAlcance, D)).toBe(2);
  });
});
