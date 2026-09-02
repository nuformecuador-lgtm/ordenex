import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { OrdenDiaRepartoCambioRepository } from "@/lib/repositories/OrdenDiaRepartoCambioRepository";
import { OrdenHistorialRepository } from "@/lib/repositories/OrdenHistorialRepository";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { OrdenHistorialService } from "@/lib/services/OrdenHistorialService";
import { RecepcionSateliteService } from "@/lib/services/RecepcionSateliteService";
import type { RecepcionSateliteDTO } from "@/lib/interfaces/services/IRecepcionSateliteService";
import { ESTADOS_BODEGA_SATELITE } from "@/lib/utils/estados-bodega-satelite";

import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
} from "./_postgres-real";

/**
 * FICHA 349 — EL LISTADO «Órdenes de la bodega» CONTRA UN POSTGRES DE VERDAD.
 *
 * ─── POR QUE ESTE ARCHIVO EXISTE, Y POR QUE NO VALEN DOBLES ────────────────────────────────
 *
 * La ficha 349 unifico la PROYECCION de esta pantalla con la de `/ordenes`: donde habia un
 * `select` propio de quince campos ahora se lee el `include` compartido y se serializa con la
 * MISMA `toListItemDTO`. Un cambio asi tiene exactamente dos formas de salir mal, y ninguna de
 * las dos la ve un test con dobles:
 *
 *   (a) **que ensanche el alcance.** El `WHERE` no se toco, pero eso hay que DEMOSTRARLO
 *       contra la base: en este repo esta medido —cuatro veces seguidas— que una mutacion del
 *       `WHERE` pasa en VERDE con dobles, porque el doble acepta cualquier criterio y devuelve
 *       lo que se le dijo. Aqui las filas las elige Postgres.
 *   (b) **que ensanche el DATO.** La fila compartida trae el flete, la comision, la tarifa de
 *       la tienda y su contacto. Nada de eso puede llegar a un `adminSatelite`: `/ordenes` le
 *       hace `notFound()`, y esta pantalla no puede ser la puerta de atras (feature 260/R13).
 *       Se comprueba sobre el JSON del payload —no solo campo a campo— con importes CENTINELA,
 *       que es lo unico que caza un campo ANIDADO que nadie listo.
 *
 * ─── SE ENTRA POR EL SERVICIO, NO POR EL REPOSITORIO ───────────────────────────────────────
 *
 * `listarOrdenesBodegaPaginado(input, actor)` con un `adminSatelite` REAL: la zona no se le
 * pasa, la resuelve el servidor desde `usuario.zona_id`. Es el camino entero —guard de rol,
 * resolucion de zona, criterio SQL, hidratacion y recorte— y por tanto el unico que puede
 * afirmar «un adminSatelite no ve ordenes de otra zona» sin dar por bueno el eslabon que mas
 * facil se rompe.
 *
 * ─── AISLAMIENTO ───────────────────────────────────────────────────────────────────────────
 *
 * Todo ocurre dentro de `enTransaccionRevertida`: si el test pasa, si falla o si el runner
 * muere, no queda ni una fila en la base compartida. Sin base alcanzable el archivo se SALTA.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

/**
 * Importes y textos IRREPETIBLES. No son datos de prueba: son DETECTORES. Se buscan en el JSON
 * del payload entero, que es donde se veria un campo anidado que ninguna lista contempla.
 */
const CENTINELA_TARIFA = "9999999.99";
// `orden.monto_cobrar` tiene un CHECK de entero en la base (`orden_monto_cobrar_entero_check`),
// asi que el centinela del monto no puede llevar centimos. Sigue siendo irrepetible.
const CENTINELA_MONTO = "7777777";
const CENTINELA_EMAIL = "centinela-349-tienda@ejemplo.invalid";
const CENTINELA_TELEFONO = "8349034903";
const DIA_REPROGRAMADA = "2001-06-22";
const CREADA_EN = new Date("2001-06-15T13:45:00.000Z");

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

interface Escenario {
  readonly adminSatelite: string;
  readonly zonaPropia: string;
  readonly zonaAjena: string;
  readonly idsPropios: readonly string[];
  readonly idsAjenos: readonly string[];
  /** La orden de la zona propia que lleva TODO poblado: mensajero, tarifa y reprogramacion. */
  readonly idCompleta: string;
  readonly mensajeroNombre: string;
  /**
   * Ordenes de la zona propia que el listado NO muestra. FICHA 357: son de DOS clases y las dos
   * estan sembradas, porque el motivo por el que quedan fuera ya no es el mismo:
   *  - las que NUNCA pasaron por una bodega satelite (aunque su estado SI se liste);
   *  - la que esta en un estado de la CENTRAL (aunque haya pasado por la bodega).
   */
  readonly idsFueraDeLaLista: readonly string[];
}

/**
 * Siembra propia, y no la de `_semilla-tablero-dia`: aquella construye el universo del tablero
 * del dia (gestiones, `asignado_at`, ventanas horarias) y aqui hace falta otra cosa —dos zonas
 * satelite, una tarifa, una reprogramacion vigente y estados dentro y fuera de la lista blanca—.
 * Reusarla obligaria a ensancharla para una pantalla que no es la suya.
 */
async function sembrar(tx: Tx): Promise<Escenario> {
  await serializarEscriturasReales(tx);
  const sufijo = `f349-${randomUUID().slice(0, 8)}`;

  const canton = await tx.canton.findFirst({ select: { id: true, provinciaId: true } });
  const distrito = await tx.distrito.findFirst({
    where: { cantonId: canton?.id },
    select: { id: true },
  });
  const [tipoIdentificacion, rolMensajero, rolTienda, rolSatelite] = await Promise.all([
    tx.tipoIdentificacion.findFirst({ select: { id: true } }),
    tx.rol.findFirst({ where: { value: "mensajero" }, select: { id: true } }),
    tx.rol.findFirst({ where: { value: "adminTienda" }, select: { id: true } }),
    tx.rol.findFirst({ where: { value: "adminSatelite" }, select: { id: true } }),
  ]);
  // Fallo RUIDOSO y no un `return` silencioso: un `if (!catalogo) return;` deja el caso en
  // «passed» sin haber comprobado nada, que es como este repo ya se ha mentido antes.
  if (!canton || !tipoIdentificacion || !rolMensajero || !rolTienda || !rolSatelite) {
    throw new Error("la base local no tiene catalogos (geografia / roles / identificacion)");
  }

  const crearZona = async (nombre: string): Promise<string> =>
    (await tx.zona.create({ data: { nombre: `${sufijo}-${nombre}` }, select: { id: true } })).id;

  const crearUsuario = async (
    nombre: string,
    rolId: string,
    zonaId: string | null,
    contacto: { email?: string; telefono?: string } = {},
  ): Promise<string> =>
    (
      await tx.usuario.create({
        data: {
          nombre,
          primerApellido: "Prueba",
          email: contacto.email ?? `${sufijo}-${nombre}@f349.local`,
          telefono: contacto.telefono ?? "88880000",
          passwordHash: "no-es-una-credencial",
          cedula: `${sufijo}-${nombre}`,
          tipoIdentificacionId: tipoIdentificacion.id,
          rolId,
          zonaId,
        },
        select: { id: true },
      })
    ).id;

  const zonaPropia = await crearZona("propia");
  const zonaAjena = await crearZona("ajena");
  const adminSatelite = await crearUsuario("Sara", rolSatelite.id, zonaPropia);
  const mensajeroNombre = "Ana";
  const mensajero = await crearUsuario(mensajeroNombre, rolMensajero.id, zonaPropia);
  const tienda = await crearUsuario("Tienda", rolTienda.id, null, {
    email: CENTINELA_EMAIL,
    telefono: CENTINELA_TELEFONO,
  });

  // La tarifa de la tienda. Sin ella, «el dinero no viaja» estaria verde POR FALTA DE DATOS:
  // el detector vacio de siempre. Con ella, la ausencia solo puede venir del recorte.
  await tx.tarifa.create({
    data: {
      tiendaId: tienda,
      valorFlete: CENTINELA_TARIFA,
      valorFleteDevuelto: CENTINELA_TARIFA,
      valorFleteGam: CENTINELA_TARIFA,
      valorFleteDevueltoGam: CENTINELA_TARIFA,
      fulfillment: CENTINELA_TARIFA,
      comisionCod: "10.00",
      ivaFlete: "13.00",
      ivaComisionCod: "13.00",
    },
  });

  const catalogo = new Map(
    (await tx.orderStatus.findMany({ select: { id: true, value: true } })).map((s) => [
      s.value,
      s.id,
    ]),
  );
  const estatus = (value: string): string => {
    const id = catalogo.get(value);
    if (id === undefined) throw new Error(`el catalogo local no tiene el estatus ${value}`);
    return id;
  };

  const crearOrden = async (
    clave: string,
    zonaId: string,
    estatusValue: string,
    extra: { mensajeroId?: string; montoCobrar?: string } = {},
  ): Promise<string> =>
    (
      await tx.orden.create({
        data: {
          numRemision: `${sufijo}-${clave}`,
          destinatario: `Cliente ${clave}`,
          telefonoDest: "80000000",
          direccion: `Direccion ${clave}`,
          producto: "caja",
          estatusId: estatus(estatusValue),
          tiendaId: tienda,
          zonaId,
          provinciaId: canton.provinciaId,
          cantonId: canton.id,
          distritoId: distrito?.id ?? null,
          mensajeroAsignadoId: extra.mensajeroId ?? null,
          montoCobrar: extra.montoCobrar ?? null,
          cobraComision: true,
          createdAt: CREADA_EN,
        },
        select: { id: true },
      })
    ).id;

  /**
   * FICHA 357 — el paso por la bodega satelite, escrito en el historial como lo escribe la
   * aplicacion. Sin esto, el alcance nuevo dejaria fuera a las ordenes de esta siembra y este
   * archivo mediria la ausencia de datos en vez de la proyeccion que vino a medir.
   */
  const sembrarPasoPorBodega = async (ordenId: string): Promise<void> => {
    await tx.ordenHistorialEstado.create({
      data: {
        ordenId,
        estatusOrigenId: estatus("en_ruta_bodega_satelite"),
        estatusDestinoId: estatus("en_bodega_satelite"),
        actorUsuarioId: adminSatelite,
        origenTipo: "recepcion_satelite",
      },
    });
  };

  // Zona PROPIA: tres en la lista blanca. La primera lleva todo lo que la ficha anade.
  const completa = await crearOrden("propia-completa", zonaPropia, "en_bodega_satelite", {
    mensajeroId: mensajero,
    montoCobrar: CENTINELA_MONTO,
  });
  const idsPropios = [
    completa,
    await crearOrden("propia-2", zonaPropia, "por_devolver"),
    await crearOrden("propia-3", zonaPropia, "devuelta"),
  ];
  for (const id of idsPropios) await sembrarPasoPorBodega(id);

  // La gestion de reprogramacion VIGENTE que alimenta «Liberada el». Sin ella ese campo seria
  // `null` por falta de datos y la asercion no distinguiria «lo envia» de «no lo envia».
  await tx.gestionOrden.create({
    data: {
      ordenId: completa,
      mensajeroId: mensajero,
      resultado: "reprogramada",
      fechaReprogramacion: new Date(`${DIA_REPROGRAMADA}T00:00:00.000Z`),
      anuladaAt: null,
    },
  });

  // Zona AJENA: dos en la MISMA lista blanca. Si el recorte por zona desapareciera, entrarian.
  const idsAjenos = [
    await crearOrden("ajena-1", zonaAjena, "en_bodega_satelite"),
    await crearOrden("ajena-2", zonaAjena, "por_recoger", { mensajeroId: mensajero }),
  ];
  // Pasaron por SU bodega (la ajena): la unica cosa que las deja fuera del listado del actor es
  // el recorte por ZONA. Sin el historial quedarian fuera por el alcance nuevo y el caso «no ve
  // las de otra zona» estaria verde sin haber ejercido el recorte por zona.
  for (const id of idsAjenos) await sembrarPasoPorBodega(id);

  // Zona PROPIA y fuera del listado. FICHA 357: `en_reparto`, `entregada` y `ayuda_tienda` YA
  // NO estan fuera por su estado —el listado los muestra ahora, y esa es la cara A de la ficha—,
  // asi que lo que las deja fuera aqui es el ALCANCE: nunca pasaron por una bodega satelite.
  // La cuarta si queda fuera por el ESTADO: paso por la bodega, pero el paquete volvio a la
  // custodia de la central.
  const idsFueraDeLaLista = [
    await crearOrden("propia-en-reparto", zonaPropia, "en_reparto", { mensajeroId: mensajero }),
    await crearOrden("propia-entregada", zonaPropia, "entregada", { mensajeroId: mensajero }),
    await crearOrden("propia-ayuda", zonaPropia, "ayuda_tienda", { mensajeroId: mensajero }),
  ];
  const enLaCentral = await crearOrden("propia-central", zonaPropia, "en_bodega_central");
  await sembrarPasoPorBodega(enLaCentral);
  idsFueraDeLaLista.push(enLaCentral);

  return {
    adminSatelite,
    zonaPropia,
    zonaAjena,
    idsPropios,
    idsAjenos,
    idCompleta: completa,
    mensajeroNombre,
    idsFueraDeLaLista,
  };
}

/** El servicio REAL, atado a la transaccion del test. */
function servicio(tx: Tx): RecepcionSateliteService {
  const prisma = tx as unknown as PrismaClient;
  const ordenes = new OrdenRepository(prisma);
  return new RecepcionSateliteService(
    ordenes,
    new OrdenHistorialService(
      ordenes,
      new OrdenHistorialRepository(prisma),
      new OrdenDiaRepartoCambioRepository(prisma),
    ),
  );
}

const PAGINA = { page: 1, pageSize: 50 } as const;

describeSiHayBase("FICHA 349 · bodega satelite contra Postgres real", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("un adminSatelite NO ve las ordenes de otra zona: ni en las filas, ni en el total", async () => {
    const { escenario, pagina, completo, vigentes } = await enTransaccionRevertida(
      prisma,
      async (tx) => {
        const sembrado = await sembrar(tx);
        const actor = { usuarioId: sembrado.adminSatelite, rol: "adminSatelite" as const };
        const srv = servicio(tx);
        return {
          escenario: sembrado,
          pagina: await srv.listarOrdenesBodegaPaginado(PAGINA, actor),
          completo: await srv.listarOrdenesBodegaCompleto({}, actor),
          // R21: preguntar por identificadores de OTRA zona no puede confirmar que existen.
          vigentes: await srv.listarIdsVigentesBodega({ ids: [...sembrado.idsAjenos] }, actor),
        };
      },
    );

    expect(pagina.status).toBe("ok");
    if (pagina.status !== "ok") return;

    const idsVistos = pagina.items.map((o) => o.id);
    // Las TRES suyas, ni una mas. El `total` es del CONJUNTO, asi que tambien delataria una
    // fuga aunque el recorte de pagina la tapara.
    expect(new Set(idsVistos)).toEqual(new Set(escenario.idsPropios));
    expect(pagina.total).toBe(escenario.idsPropios.length);
    for (const ajena of escenario.idsAjenos) expect(idsVistos).not.toContain(ajena);

    // El conjunto de la DESCARGA mira lo mismo: si divergiera, el archivo tendria filas que la
    // pantalla no ensena, y eso no lo veria ningun test de la pantalla.
    expect(completo.status).toBe("ok");
    if (completo.status === "ok") {
      expect(new Set(completo.items.map((o) => o.id))).toEqual(new Set(escenario.idsPropios));
    }

    // Y de las ajenas no vuelve NI SU EXISTENCIA.
    expect(vigentes).toEqual({ status: "ok", ids: [] });
  });

  it("lo que no es de esta bodega no sale: ni por estado ajeno ni por no haber pasado por ella", async () => {
    const { escenario, pagina } = await enTransaccionRevertida(prisma, async (tx) => {
      const sembrado = await sembrar(tx);
      const srv = servicio(tx);
      return {
        escenario: sembrado,
        pagina: await srv.listarOrdenesBodegaPaginado(PAGINA, {
          usuarioId: sembrado.adminSatelite,
          rol: "adminSatelite",
        }),
      };
    });

    expect(pagina.status).toBe("ok");
    if (pagina.status !== "ok") return;

    // No-vacuidad: las cuatro de fuera de la lista SI se sembraron en la zona del actor.
    expect(escenario.idsFueraDeLaLista).toHaveLength(4);
    for (const fuera of escenario.idsFueraDeLaLista) {
      expect(pagina.items.map((o) => o.id)).not.toContain(fuera);
    }

    // EL CRITERIO DE LA FICHA, medido y no razonado: todo estado que APARECE en la tabla se
    // puede FILTRAR. El conjunto de estados observado es subconjunto de la lista blanca, que es
    // exactamente la que alimenta el desplegable de estado.
    const observados = new Set(pagina.items.map((o) => o.estatusValue));
    expect(observados.size).toBeGreaterThan(0);
    for (const estado of observados) {
      expect(ESTADOS_BODEGA_SATELITE as readonly string[]).toContain(estado);
    }
  });

  it("la fila trae lo que la tabla de la bodega no recibia: mensajero, creacion y «Liberada el»", async () => {
    const { escenario, fila } = await enTransaccionRevertida(prisma, async (tx) => {
      const sembrado = await sembrar(tx);
      const pagina = await servicio(tx).listarOrdenesBodegaPaginado(PAGINA, {
        usuarioId: sembrado.adminSatelite,
        rol: "adminSatelite",
      });
      return {
        escenario: sembrado,
        fila:
          pagina.status === "ok"
            ? (pagina.items.find((o) => o.id === sembrado.idCompleta) ?? null)
            : null,
      };
    });

    expect(fila).not.toBeNull();
    const orden = fila as RecepcionSateliteDTO;

    // «Fecha de creación» y «Tiempo» — las dos derivan de este unico campo.
    expect(new Date(orden.createdAt).toISOString()).toBe(CREADA_EN.toISOString());
    // «Mensajero» — el NOMBRE ya resuelto, nunca el uuid.
    expect(orden.relaciones?.mensajeroAsignado?.nombre).toContain(escenario.mensajeroNombre);
    expect(orden.relaciones?.mensajeroAsignado?.nombre).not.toBe(orden.mensajeroAsignadoId);
    // «Liberada el» — la gestion de reprogramacion vigente, `YYYY-MM-DD` YA SERIALIZADO: si
    // llegara como `Date`, el navegador lo pintaria un dia antes en media America.
    expect(orden.fechaReprogramacion).toBe(DIA_REPROGRAMADA);
    // Y la geografia por relacion, que es de donde la lee `ordenesColumns`.
    expect(orden.relaciones?.provincia?.nombre).toEqual(expect.any(String));
    expect(orden.relaciones?.canton?.nombre).toEqual(expect.any(String));
  });

  it("el dinero de la tienda NO viaja a un alcance de zona, y el monto a cobrar SI", async () => {
    const { pagina, idCompleta } = await enTransaccionRevertida(prisma, async (tx) => {
      const sembrado = await sembrar(tx);
      return {
        idCompleta: sembrado.idCompleta,
        pagina: await servicio(tx).listarOrdenesBodegaPaginado(PAGINA, {
          usuarioId: sembrado.adminSatelite,
          rol: "adminSatelite",
        }),
      };
    });

    expect(pagina.status).toBe("ok");
    if (pagina.status !== "ok") return;
    const orden = pagina.items.find((o) => o.id === idCompleta);
    expect(orden).toBeDefined();
    if (orden === undefined) return;

    // (a) campo a campo: las claves NO EXISTEN, no es que valgan `undefined`.
    expect("fleteConIva" in orden).toBe(false);
    expect("comisionConIva" in orden).toBe(false);
    expect("fleteOrigen" in orden).toBe(false);
    expect(orden.relaciones?.tienda?.tarifa).toBeNull();
    expect("email" in (orden.relaciones?.tienda ?? {})).toBe(false);
    expect("telefono" in (orden.relaciones?.tienda ?? {})).toBe(false);

    // (b) sobre el PAYLOAD entero: es lo unico que caza un campo anidado que nadie listo. Los
    // centinelas se sembraron de verdad —la tarifa existe en la base—, asi que su ausencia aqui
    // solo puede venir del recorte y no de la falta de datos.
    const payload = JSON.stringify(pagina);
    expect(payload).not.toContain(CENTINELA_TARIFA);
    expect(payload).not.toContain(CENTINELA_EMAIL);
    expect(payload).not.toContain(CENTINELA_TELEFONO);

    // (c) CONTRAPRUEBA de que el detector funciona y de la decision R17: el monto a cobrar SI
    // se conserva en este alcance —el satelite ya lo ve en su pantalla de recepcion—, y su
    // centinela SI aparece. Sin esta clausula, (b) estaria verde aunque el payload viniera vacio.
    expect(orden.montoCobrar).toBe(Number(CENTINELA_MONTO));
    expect(payload).toContain(CENTINELA_MONTO);
  });
});
