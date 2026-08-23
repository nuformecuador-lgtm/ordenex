import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { HAY_BASE_DE_DATOS, crearPrismaDeTest, enTransaccionRevertida } from "./_postgres-real";
import {
  FECHA_D,
  FECHA_D_MENOS_1,
  clienteSobreTransaccion,
  crearGestion,
  crearOrden,
  crearServicio,
  estatusId,
  instanteCR,
  leerFilas,
  sembrarBase,
  agregarTransicion,
  type BaseSembrada,
  type FilaLeida,
} from "./_semilla-rollup";
import { prepararConsultaAnalitica } from "@/lib/analytics/consulta";
import type { ConsultaAnalitica } from "@/lib/analytics/consulta";
import { ventanaDelDia } from "@/lib/analytics/rollup-dia";
import { AnaliticaOperativaVivaRepository } from "@/lib/repositories/AnaliticaOperativaVivaRepository";
import { completarPrimerIntentoEnCubos } from "@/lib/services/AnaliticaOperativaService";
import { OrdenHistorialRepository } from "@/lib/repositories/OrdenHistorialRepository";
import { OrdenDiaRepartoCambioRepository } from "@/lib/repositories/OrdenDiaRepartoCambioRepository";
import { OrdenHistorialService } from "@/lib/services/OrdenHistorialService";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import type { CuboRollup } from "@/lib/interfaces/repositories/IAnaliticaOperativaRollupRepository";

// Feature 126 / T6.4 — R33. LA CONTENCION DE D13, y no es opcional.
//
// D13 decidio que el camino intradia declara CONSULTAS PROPIAS en vez de reusar el repositorio
// de la 124 (sus seis consultas son plantillas `$queryRaw` cerradas sobre `VentanaDia`, sin
// costura para inyectar un `where`; reusarlas obligaria a agregar la compania entera por
// request y recortar en memoria). El precio son DOS implementaciones de las MISMAS
// definiciones.
//
// Sin este test, una divergencia entre las dos seria SILENCIOSA y aparecería como «los numeros
// de hoy no cuadran con los de ayer»: un bug de confianza, no de calculo, y de los que nadie
// consigue reproducir. Con el, cambiar UNA definicion del camino intradia —quitar
// `anulada_at IS NULL`, o tomar la coordenada del mensajero del sitio equivocado— pone rojo
// este archivo.
//
// COMO SE COMPARA: sobre una fecha YA CERRADA se corre el job de la 124 (que escribe el
// rollup) y, aparte, el camino intradia con `ventanaDelDia(fecha)` —la MISMA ventana que
// recibe el job—. Las dos salidas se normalizan a la misma forma y se comparan CUBO A CUBO y
// MEDIDA A MEDIDA. `primer_intento_ok` se reparte con `completarPrimerIntentoEnCubos`, la
// funcion que usa el propio servicio: si el test la reimplementara, estaria comparando dos
// implementaciones de la 126 en vez de la 126 contra la 124.

/** Actor `maestro`: alcance `global`, es decir SIN recorte. Es lo que hace comparable. */
const MAESTRO = { usuarioId: "u-maestro-equivalencia", rol: "maestro" } as const;

/** Reloj congelado en un instante posterior a la ventana sembrada (ano 2001, ver la semilla). */
const AHORA = instanteCR(FECHA_D, "23:59");

function consultaGlobal(metricaId: string): ConsultaAnalitica {
  const r = prepararConsultaAnalitica(
    { rango: "personalizado", desde: FECHA_D, hasta: FECHA_D },
    MAESTRO,
    metricaId,
    AHORA,
  );
  if (r.status !== "ok") throw new Error(`preparacion no concedida: ${JSON.stringify(r)}`);
  return r.consulta;
}

/** Forma comparable de un cubo, con las coordenadas traducidas a etiquetas legibles. */
interface CuboComparable {
  readonly clave: string;
  readonly medidas: Record<string, number>;
}

function medidasDe(c: {
  ordenesCreadas: number;
  ordenesEstadoStock: number;
  entregas: number;
  devoluciones: number;
  rechazos: number;
  reprogramaciones: number;
  incidentes: number;
  primerIntentoOk: number;
  segCicloAcum: number | bigint;
  segCicloN: number;
}): Record<string, number> {
  return {
    ordenesCreadas: c.ordenesCreadas,
    ordenesEstadoStock: c.ordenesEstadoStock,
    entregas: c.entregas,
    devoluciones: c.devoluciones,
    rechazos: c.rechazos,
    reprogramaciones: c.reprogramaciones,
    incidentes: c.incidentes,
    primerIntentoOk: c.primerIntentoOk,
    segCicloAcum: Number(c.segCicloAcum),
    segCicloN: c.segCicloN,
  };
}

function delRollup(filas: readonly FilaLeida[]): CuboComparable[] {
  return filas
    .map((f) => ({
      clave: [f.zona, f.tienda, f.mensajero ?? "-", f.estatus, f.causa ?? "-"].join("|"),
      medidas: medidasDe(f),
    }))
    .sort((a, b) => a.clave.localeCompare(b.clave));
}

function delIntradia(cubos: readonly CuboRollup[], base: BaseSembrada): CuboComparable[] {
  const et = (id: string | null): string | null =>
    id === null ? null : (base.etiqueta.get(id) ?? id);
  return cubos
    .map((c) => ({
      clave: [
        et(String(c.zonaId)),
        et(String(c.tiendaId)),
        c.mensajeroId === null ? "-" : et(String(c.mensajeroId)),
        et(String(c.estatusId)),
        c.causaDevolucion === null ? "-" : String(c.causaDevolucion),
      ].join("|"),
      medidas: medidasDe(c),
    }))
    .sort((a, b) => a.clave.localeCompare(b.clave));
}

/**
 * Ejecuta el camino INTRADIA completo (repositorio + reparto de primer intento).
 *
 * Dos clientes distintos, y es lo mismo que hace `crearServicio` de la semilla: el repositorio
 * de SQL crudo va sobre `clienteSobreTransaccion` (que ademas avanza la marca de corrida), y
 * el servicio del historial va sobre el `tx` desnudo, porque necesita los modelos de Prisma
 * (`prisma.orderStatus.findUnique`) y el cliente reducido solo expone `$queryRaw`.
 */
async function caminoIntradia(
  cliente: PrismaClient,
  prismaDelHistorial: PrismaClient,
  fecha: string,
): Promise<readonly CuboRollup[]> {
  const repo = new AnaliticaOperativaVivaRepository(cliente);
  const crudos = await repo.cubosDelDiaEnCurso(consultaGlobal("entregas"), ventanaDelDia(fecha));
  const historial = new OrdenHistorialService(
    new OrdenRepository(prismaDelHistorial),
    new OrdenHistorialRepository(prismaDelHistorial),
    new OrdenDiaRepartoCambioRepository(prismaDelHistorial),
  );
  const intentos = await historial.contarIntentosEnLote([
    ...new Set(crudos.entregasVigentes.map((e) => e.ordenId)),
  ]);
  return completarPrimerIntentoEnCubos(crudos, intentos);
}

describe.skipIf(!HAY_BASE_DE_DATOS)("R33 · equivalencia intradia ↔ rollup", () => {
  it("el intradia de una fecha cerrada reproduce exactamente las filas del rollup", async () => {
    const prisma = crearPrismaDeTest();
    try {
      await enTransaccionRevertida(prisma, async (tx) => {
        const base = await sembrarBase(tx);
        const cliente = clienteSobreTransaccion(tx);

        // --- Siembra: un dia con las cinco medidas y sus trampas ---------------------------
        // (a) Orden creada el dia D, entregada por el mensajero A al primer intento.
        const entregada = await crearOrden(tx, base, {
          clave: "entregada",
          zonaId: base.zonaA,
          tiendaId: base.tienda1,
          mensajeroId: base.mensajero1,
          createdAt: instanteCR(FECHA_D, "08:00"),
        });
        await agregarTransicion(tx, base, entregada, {
          at: instanteCR(FECHA_D, "08:05"),
          destino: "en_reparto",
        });
        const gEntrega = await crearGestion(tx, {
          ordenId: entregada,
          mensajeroId: base.mensajero1,
          resultado: "entregada",
          at: instanteCR(FECHA_D, "12:00"),
        });
        await agregarTransicion(tx, base, entregada, {
          at: instanteCR(FECHA_D, "12:00"),
          destino: "entregada",
          origenTipo: "gestion",
          gestionOrdenId: gEntrega,
        });

        // (b) Orden VIEJA (dia D-1) devuelta hoy con causa: entra en el cubo de la causa y
        //     NO en `ordenes_creadas`. Ademas cierra ciclo hoy.
        const devuelta = await crearOrden(tx, base, {
          clave: "devuelta",
          zonaId: base.zonaA,
          tiendaId: base.tienda1,
          mensajeroId: base.mensajero2,
          createdAt: instanteCR(FECHA_D_MENOS_1, "09:00"),
        });
        await agregarTransicion(tx, base, devuelta, {
          at: instanteCR(FECHA_D_MENOS_1, "09:05"),
          destino: "en_reparto",
        });
        const gDev = await crearGestion(tx, {
          ordenId: devuelta,
          mensajeroId: base.mensajero2,
          resultado: "devuelta",
          causaDevolucion: "not_found",
          at: instanteCR(FECHA_D, "14:00"),
        });
        await agregarTransicion(tx, base, devuelta, {
          at: instanteCR(FECHA_D, "14:00"),
          destino: "devuelta",
          origenTipo: "gestion",
          gestionOrdenId: gDev,
        });

        // (c) LA TRAMPA DE R33: una gestion ANULADA el mismo dia. No cuenta en ninguna medida.
        //     Quitar `anulada_at IS NULL` del camino intradia la haria aparecer, y esa es
        //     exactamente la mutacion que este test tiene que matar.
        const anulada = await crearOrden(tx, base, {
          clave: "anulada",
          zonaId: base.zonaA,
          tiendaId: base.tienda1,
          mensajeroId: base.mensajero1,
          createdAt: instanteCR(FECHA_D, "07:00"),
        });
        await agregarTransicion(tx, base, anulada, {
          at: instanteCR(FECHA_D, "07:05"),
          destino: "en_reparto",
        });
        await crearGestion(tx, {
          ordenId: anulada,
          mensajeroId: base.mensajero1,
          resultado: "rechazada",
          at: instanteCR(FECHA_D, "15:00"),
          anuladaAt: instanteCR(FECHA_D, "16:00"),
        });

        // (d) SEGUNDA TRAMPA: orden de la zona/tienda de la semilla ASIGNADA al mensajero A
        //     pero GESTIONADA por el B. Las coordenadas de las medidas de ORDEN salen de la
        //     orden; las de GESTION, de la gestion. Confundirlas mueve la fila de cubo.
        const cruzada = await crearOrden(tx, base, {
          clave: "cruzada",
          zonaId: base.zonaA,
          tiendaId: base.tienda1,
          mensajeroId: base.mensajero1,
          createdAt: instanteCR(FECHA_D, "06:30"),
        });
        await agregarTransicion(tx, base, cruzada, {
          at: instanteCR(FECHA_D, "06:35"),
          destino: "en_reparto",
        });
        await crearGestion(tx, {
          ordenId: cruzada,
          mensajeroId: base.mensajero2,
          resultado: "reprogramada",
          at: instanteCR(FECHA_D, "17:00"),
        });

        // (e) Y una orden SIN mensajero asignado, para que el cubo `NULL` viaje por los dos
        //     caminos (R8: no se descarta ni se renombra).
        const sinAsignar = await crearOrden(tx, base, {
          clave: "sin-asignar",
          zonaId: base.zonaA,
          tiendaId: base.tienda1,
          mensajeroId: null,
          createdAt: instanteCR(FECHA_D, "05:00"),
        });
        await agregarTransicion(tx, base, sinAsignar, {
          at: instanteCR(FECHA_D, "05:05"),
          destino: "sin_gestionar",
        });

        // --- Camino 1: el job de la 124 escribe el rollup ----------------------------------
        await crearServicio(tx).agregarFecha(FECHA_D);
        const rollup = delRollup(await leerFilas(tx, base, FECHA_D));

        // --- Camino 2: el intradia de la 126 sobre la MISMA ventana ------------------------
        const intradia = delIntradia(await caminoIntradia(cliente, tx as unknown as PrismaClient, FECHA_D), base);

        // La siembra tiene que producir algo, o la comparacion seria «vacio == vacio».
        expect(rollup.length, "el job no escribio ninguna fila: la siembra no mide nada").toBeGreaterThan(
          0,
        );

        // CUBO A CUBO: mismas claves, en el mismo conjunto.
        expect(intradia.map((c) => c.clave)).toEqual(rollup.map((c) => c.clave));
        // MEDIDA A MEDIDA.
        expect(intradia).toEqual(rollup);

        // Y la trampa (c) de verdad estaba puesta: ninguna medida cuenta el rechazo anulado.
        const rechazos = rollup.reduce((a, c) => a + c.medidas.rechazos, 0);
        expect(rechazos, "la gestion anulada se colo en el rollup: revisa la semilla").toBe(0);
      });
    } finally {
      await prisma.$disconnect();
    }
  }, 60_000);

  it("y con el dia VACIO los dos caminos coinciden tambien: cero filas y cero filas", async () => {
    // Frontera barata pero necesaria: un intradia que devolviera un cubo «todo a cero» donde el
    // job no escribe ninguna fila (R46 de la 124) ya seria una divergencia.
    const prisma = crearPrismaDeTest();
    try {
      await enTransaccionRevertida(prisma, async (tx) => {
        const base = await sembrarBase(tx);
        const cliente = clienteSobreTransaccion(tx);
        await crearServicio(tx).agregarFecha(FECHA_D);
        const rollup = delRollup(await leerFilas(tx, base, FECHA_D));
        const intradia = delIntradia(await caminoIntradia(cliente, tx as unknown as PrismaClient, FECHA_D), base);
        expect(rollup).toEqual([]);
        expect(intradia).toEqual([]);
        expect(estatusId(base, "entregada")).toBeTruthy();
      });
    } finally {
      await prisma.$disconnect();
    }
  }, 60_000);
});
