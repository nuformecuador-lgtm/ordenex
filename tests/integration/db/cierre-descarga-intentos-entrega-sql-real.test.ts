import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { CierresAdminRepository } from "@/lib/repositories/CierresAdminRepository";
import type { Alcance } from "@/lib/interfaces/repositories/ICierresAdminRepository";

import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  fksDeOrden,
  serializarEscriturasReales,
} from "./_postgres-real";

/**
 * FICHA 394 (2026-09-08) — LOS INTENTOS DE ENTREGA DE LA DESCARGA DETALLADA DE CIERRES,
 * EJECUTADOS CONTRA POSTGRES.
 *
 * QUE SE MIDE. Que la columna de intentos de la hoja fundida sale del DERIVADOR de las features
 * 160/215 —cierres APROBADOS distintos con una gestion contable, VIGENTE y nacida de una visita
 * real— y no de `orden.intentos_contacto`, que es lo que la tienda registra desde /novedades y
 * lo que la ficha 385 puso ahi por error. Y que son los VIGENTES: ni las gestiones anuladas, ni
 * las de cierres sin aprobar, ni los resultados que no cuentan como intento.
 *
 * ⚠️ POR QUE CONTRA POSTGRES Y NO CON DOBLES, que es la pregunta que decide si este archivo vale
 * algo. El numero es DERIVADO: sale de un `groupBy` con un `where` de SEIS condiciones, una de
 * ellas un `EXISTS` sobre `orden_historial_estado`. Un test de servicio con dobles no ejecuta ese
 * SQL —este repositorio ya midio CUATRO veces que una mutacion de un `where` sobrevive en verde a
 * los tests de servicio—, y un doble del repositorio devolveria el Map que el propio test le
 * ponga: confirmaria la aritmetica del test, no el criterio del sistema. Aqui el filtro lo aplica
 * Postgres sobre filas sembradas de verdad.
 *
 * EL CORPUS, y cada semilla mata una forma concreta de equivocarse:
 *
 *  1. `dos-vigentes`   — dos cierres aprobados con gestion contable ⇒ **2**. El caso normal.
 *  2. `con-anuladas`   — un vigente + DOS gestiones ANULADAS ⇒ **1**. Si el conteo pasara de
 *     «vigentes» a «todos los que hubo», daria 3: es la mitad firmada del encargo.
 *  3. `cierre-abierto` — su unica gestion contable vive en un cierre `solicitado` ⇒ **0**. Lo
 *     que suma no es el corte, es la APROBACION posterior.
 *  4. `entregada`      — una gestion `entregada` en un cierre aprobado ⇒ **0**. La lista de
 *     resultados que cuentan es de INCLUSION (rechazada/devuelta/reprogramada).
 *  5. `sin-visita`     — gestion contable en cierre aprobado pero SIN fila de historial de
 *     visita real ⇒ **0**. Es la sexta condicion del predicado (215/R34).
 *  6. `dos-en-un-cierre` — DOS gestiones contables en el MISMO cierre aprobado ⇒ **1**. El grano
 *     es la orden dentro del cierre: un `count()` de gestiones diria 2.
 *  7. `sin-intentos`   — ninguna ⇒ **0** explicito, no `null` ni celda vacia.
 *
 * Y TODAS llevan `intentos_contacto` (el de la TIENDA) con un valor DISTINTO de su conteo de
 * entrega: si la hoja volviera a coger el contador equivocado, cada fila lo diria.
 *
 * LOS INTENTOS SE SIEMBRAN EN CIERRES DE **OTRO MENSAJERO**, y no es un adorno: la descarga se
 * acota con `mensajeroIds` al mensajero de la hoja, asi que esos cierres NO estan en el conjunto
 * descargado. Un conteo que mirara solo las gestiones de la propia hoja daria cero en todas las
 * filas. Es ademas lo que pasa en la operacion: la orden la intento otro mensajero otro dia.
 *
 * SIN BASE ALCANZABLE se SALTA (`describe.skip`), NO pasa en verde: un `if (!x) return` dentro
 * del caso se leeria como `passed` sin haber comprobado nada, y este repo ya se comio ese verde.
 * CON base pero SIN catalogo, falla RUIDOSAMENTE en el `beforeAll`.
 *
 * Todo se siembra dentro de una transaccion que SIEMPRE se revierte: no queda ni una fila.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

/** Sufijo unico por corrida: `num_remision`, `email` y `cedula` son UNIQUE. */
const SUFIJO = `int394${Date.now().toString(36)}`;

/** Alcance del maestro sobre la bodega central, que es donde se siembra el cierre descargado. */
const ALCANCE: Alcance = { destinoTipo: "bodega_central", destinoZonaId: null };

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

/** Una gestion que la orden acumula ANTES del cierre que se descarga. */
interface Intento {
  /** `devuelta` cuenta; `entregada` no (lista de INCLUSION de la 215). */
  resultado: "devuelta" | "entregada";
  /** `aprobado` cuenta; `solicitado` no (el corte no suma, la aprobacion si). */
  estadoCierre: "aprobado" | "solicitado";
  /** Una gestion deshecha NO cuenta (filtro de LECTURA, R5). */
  anulada?: boolean;
  /** Sin fila de historial de visita real la gestion no respalda ningun intento (R34). */
  conVisitaReal?: boolean;
  /** Reusa el cierre de la posicion N de la lista en vez de crear uno nuevo (grano = cierre). */
  mismoCierreQue?: number;
}

interface Semilla {
  clave: string;
  /** El contador de LA TIENDA, siempre distinto del conteo de entrega esperado. */
  intentosContactoTienda: number;
  /** Lo que la descarga tiene que emitir en `intentosEntrega`. */
  esperado: number;
  intentos: Intento[];
}

const VIGENTE: Intento = { resultado: "devuelta", estadoCierre: "aprobado", conVisitaReal: true };

const SEMILLAS: Semilla[] = [
  {
    clave: "dos-vigentes",
    intentosContactoTienda: 7,
    esperado: 2,
    intentos: [VIGENTE, VIGENTE],
  },
  {
    clave: "con-anuladas",
    intentosContactoTienda: 9,
    esperado: 1,
    intentos: [VIGENTE, { ...VIGENTE, anulada: true }, { ...VIGENTE, anulada: true }],
  },
  {
    clave: "cierre-abierto",
    intentosContactoTienda: 4,
    esperado: 0,
    intentos: [{ ...VIGENTE, estadoCierre: "solicitado" }],
  },
  {
    clave: "entregada",
    intentosContactoTienda: 3,
    esperado: 0,
    intentos: [{ ...VIGENTE, resultado: "entregada" }],
  },
  {
    clave: "sin-visita",
    intentosContactoTienda: 6,
    esperado: 0,
    intentos: [{ ...VIGENTE, conVisitaReal: false }],
  },
  {
    clave: "dos-en-un-cierre",
    intentosContactoTienda: 8,
    esperado: 1,
    intentos: [VIGENTE, { ...VIGENTE, mismoCierreQue: 0 }],
  },
  { clave: "sin-intentos", intentosContactoTienda: 5, esperado: 0, intentos: [] },
];

describeSiHayBase("descarga detallada — los intentos de entrega vigentes (ficha 394)", () => {
  let prisma: PrismaClient;
  let fks: NonNullable<Awaited<ReturnType<typeof fksDeOrden>>>;
  let fksUsuario: { tipoIdentificacionId: string; rolId: string };
  let estatusVisitaId: string;
  let n = 0;

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    const encontradas = await fksDeOrden(prisma);
    if (encontradas === null) {
      throw new Error(
        "hay DATABASE_URL pero la tabla `orden` esta vacia: sin FKs no se puede sembrar. " +
          "Corre `pnpm run db:seed` (y las semillas de zonas) antes de esta suite.",
      );
    }
    fks = encontradas;
    const usuario = await prisma.usuario.findFirst({
      select: { tipoIdentificacionId: true, rolId: true },
    });
    if (usuario === null) {
      throw new Error(
        "hace falta al menos UN usuario en la base: de el se toman prestadas las FKs de catalogo " +
          "(tipo de identificacion y rol) para crear los mensajeros limpios de estos casos.",
      );
    }
    fksUsuario = usuario;
    // El `estatus_destino_id` de las filas de historial que respaldan un intento. Cualquier
    // estado real sirve —el predicado NO mira el destino, mira `origen_tipo`—, pero la columna
    // es NOT NULL con FK, asi que tiene que existir de verdad.
    const destino = await prisma.orderStatus.findFirst({
      where: { value: "devolucion_por_confirmar" },
      select: { id: true },
    });
    if (destino === null) {
      throw new Error(
        "falta el estatus «devolucion_por_confirmar» en `order_status`. Corre `pnpm run db:seed`: " +
          "sin el, este archivo no puede sembrar el historial y NO debe pasar en verde.",
      );
    }
    estatusVisitaId = destino.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Un mensajero SIN historia: es lo que permite afirmar conjuntos EXACTOS. */
  async function crearMensajero(tx: Tx, marca: string): Promise<string> {
    const clave = `${SUFIJO}${(n += 1)}${marca}`;
    const u = await tx.usuario.create({
      data: {
        nombre: `Mensajero intentos ${clave}`,
        email: `mint-${clave}@example.test`,
        telefono: "88880000",
        passwordHash: "no-se-usa-en-este-test",
        cedula: `int${clave}`,
        tipoIdentificacionId: fksUsuario.tipoIdentificacionId,
        rolId: fksUsuario.rolId,
      },
      select: { id: true },
    });
    return u.id;
  }

  /**
   * Siembra el corpus entero y devuelve las filas que la descarga emite para el mensajero de la
   * hoja, indexadas por su clave.
   */
  async function filasDeLaDescarga() {
    return enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const mensajeroHoja = await crearMensajero(tx, "hoja");
      // Los intentos PREVIOS son de OTRO mensajero: quedan fuera del conjunto descargado, asi
      // que el conteo no puede salir de las gestiones de la propia hoja.
      const mensajeroPrevio = await crearMensajero(tx, "prev");

      const cierreHoja = await tx.cierreDia.create({
        data: {
          mensajeroId: mensajeroHoja,
          estado: "aprobado",
          destinoTipo: "bodega_central",
          destinoZonaId: fks.zonaId,
          solicitadoAt: new Date("2026-03-10T15:00:00.000Z"),
        },
        select: { id: true },
      });

      const remisionPorClave = new Map<string, string>();

      for (const s of SEMILLAS) {
        const numRemision = `R-${SUFIJO}-${s.clave}`;
        remisionPorClave.set(s.clave, numRemision);
        const orden = await tx.orden.create({
          data: {
            numRemision,
            destinatario: `Dest ${s.clave}`,
            telefonoDest: "88880000",
            producto: `Prod ${s.clave}`,
            estatusId: fks.estatusId,
            tiendaId: fks.tiendaId,
            zonaId: fks.zonaId,
            provinciaId: fks.provinciaId,
            cantonId: fks.cantonId,
            // El OTRO contador, el de la tienda. Distinto del esperado en TODAS las semillas.
            intentosContacto: s.intentosContactoTienda,
          },
          select: { id: true },
        });

        // La gestion de ESTE cierre, la que produce la fila de la hoja. `entregada` y sin fila
        // de historial: no aporta ningun intento, asi que lo que se cuente viene de los previos.
        await tx.gestionOrden.create({
          data: {
            ordenId: orden.id,
            mensajeroId: mensajeroHoja,
            resultado: "entregada",
            cierreId: cierreHoja.id,
          },
          select: { id: true },
        });
        // Sin la fila congelada, la composicion revienta duro (y el rojo no diria nada de los
        // intentos): el snapshot es parte del escenario, no un extra.
        await tx.cierreDetail.create({
          data: {
            cierreId: cierreHoja.id,
            ordenId: orden.id,
            montoCobrar: null,
            cobraComision: false,
            zonaId: fks.zonaId,
            tiendaId: fks.tiendaId,
            esCentral: true,
            numGuia: null,
            numRemision,
            destinatario: `Dest ${s.clave}`,
            direccion: null,
            producto: `Prod ${s.clave}`,
            tiendaNombre: "Tienda congelada",
            zonaNombre: "Zona congelada",
            provinciaNombre: "Provincia congelada",
            cantonNombre: "Canton congelado",
            distritoNombre: null,
          },
          select: { id: true },
        });

        // Los intentos PREVIOS, uno a uno, tal como el predicado los ve en la base.
        const cierresPrevios: string[] = [];
        for (const intento of s.intentos) {
          let cierreId: string;
          if (intento.mismoCierreQue !== undefined) {
            cierreId = cierresPrevios[intento.mismoCierreQue] as string;
          } else {
            const c = await tx.cierreDia.create({
              data: {
                mensajeroId: mensajeroPrevio,
                estado: intento.estadoCierre,
                destinoTipo: "bodega_central",
                destinoZonaId: fks.zonaId,
              },
              select: { id: true },
            });
            cierreId = c.id;
          }
          cierresPrevios.push(cierreId);

          const gestion = await tx.gestionOrden.create({
            data: {
              ordenId: orden.id,
              mensajeroId: mensajeroPrevio,
              resultado: intento.resultado,
              cierreId,
              anuladaAt: intento.anulada ? new Date("2026-03-01T10:00:00.000Z") : null,
            },
            select: { id: true },
          });
          if (intento.conVisitaReal) {
            await tx.ordenHistorialEstado.create({
              data: {
                ordenId: orden.id,
                estatusDestinoId: estatusVisitaId,
                origenTipo: "gestion", // VISITA REAL
                gestionOrdenId: gestion.id,
              },
              select: { id: true },
            });
          }
        }
      }

      const filas = await new CierresAdminRepository(
        tx as unknown as PrismaClient,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      ).findGestionesPorAlcanceCompleto(ALCANCE, { mensajeroIds: [mensajeroHoja] });

      return { filas, remisionPorClave };
    });
  }

  it("cada fila trae el conteo VIGENTE de su orden, y ninguna trae el de la tienda", async () => {
    const { filas, remisionPorClave } = await filasDeLaDescarga();

    // Control positivo, primero: si el WHERE dejara de casar, todo lo de abajo pasaria por vacio
    // y este archivo diria `passed` sin haber comprobado una sola semilla.
    expect(filas).toHaveLength(SEMILLAS.length);
    expect([...filas.map((f) => f.numRemision)].sort()).toEqual(
      [...remisionPorClave.values()].sort(),
    );

    const porRemision = new Map(filas.map((f) => [f.numRemision, f]));
    for (const s of SEMILLAS) {
      const fila = porRemision.get(remisionPorClave.get(s.clave) as string);
      expect(fila, s.clave).toBeDefined();
      // ⭑ EL HECHO de esta ficha: el conteo de entrega VIGENTE de la orden.
      expect(fila!.intentosEntrega, s.clave).toBe(s.esperado);
      // …y NO el contador de la tienda, que es lo que la hoja traia hasta hoy. Los dos numeros
      // son distintos en TODAS las semillas, asi que un cruce no puede pasar por coincidencia.
      expect(fila!.intentosEntrega, s.clave).not.toBe(s.intentosContactoTienda);
      expect(fila!.intentosContactoTienda, s.clave).toBe(s.intentosContactoTienda);
    }
  });

  it("una gestion ANULADA no cuenta: son los vigentes, no todos los que hubo", async () => {
    // El caso que separa «vigentes» de «todos», que es la mitad firmada del encargo. La orden
    // tiene TRES gestiones contables en tres cierres aprobados; dos llevan `anulada_at`. Con un
    // conteo de todas saldria 3.
    const { filas, remisionPorClave } = await filasDeLaDescarga();

    const fila = filas.find((f) => f.numRemision === remisionPorClave.get("con-anuladas"));
    expect(fila).toBeDefined();
    expect(fila!.intentosEntrega).toBe(1);
    expect(fila!.intentosEntrega).not.toBe(3);
  });

  it("un cierre sin aprobar no suma, y una `entregada` tampoco", async () => {
    // Los dos «cero» que no son ausencia de datos: hay una gestion sembrada en los dos casos, y
    // aun asi el conteo es 0. Lo que suma es la APROBACION del cierre, y solo para los
    // resultados de la lista de inclusion.
    const { filas, remisionPorClave } = await filasDeLaDescarga();

    const abierto = filas.find((f) => f.numRemision === remisionPorClave.get("cierre-abierto"))!;
    const entregada = filas.find((f) => f.numRemision === remisionPorClave.get("entregada"))!;
    const sinVisita = filas.find((f) => f.numRemision === remisionPorClave.get("sin-visita"))!;

    expect(abierto.intentosEntrega).toBe(0);
    expect(entregada.intentosEntrega).toBe(0);
    expect(sinVisita.intentosEntrega).toBe(0);
    // Y el cero es un NUMERO emitido, no un hueco: la celda dira «0», no quedara vacia.
    for (const fila of [abierto, entregada, sinVisita]) {
      expect(typeof fila.intentosEntrega).toBe("number");
      expect(fila.intentosEntrega).not.toBeNull();
      expect(fila.intentosEntrega).not.toBeUndefined();
    }
  });

  it("dos gestiones contables en el MISMO cierre aprobado suman UNA, no dos", async () => {
    // El grano es la ORDEN dentro del CIERRE (215/R29). Un `count()` de gestiones diria 2, y con
    // el la orden llegaria al tope de intentos antes de tiempo — y cobraria antes de tiempo.
    const { filas, remisionPorClave } = await filasDeLaDescarga();

    const fila = filas.find((f) => f.numRemision === remisionPorClave.get("dos-en-un-cierre"))!;
    expect(fila.intentosEntrega).toBe(1);
    expect(fila.intentosEntrega).not.toBe(2);
  });
});
