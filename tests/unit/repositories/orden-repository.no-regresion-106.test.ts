import { describe, it, expect, vi, type Mock } from "vitest";
import path from "node:path";
import fs from "node:fs";
import type { PrismaClient } from "@prisma/client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import type { ApiOrdenDetalleRow, IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import * as cancelarRoute from "@/app/api/ordenes/api-key/[numGuia]/cancelar/route";

// Feature 177 / T21 (R17): NO-REGRESION de la feature 106. La 177 extrajo la proyeccion del
// detalle a una constante compartida (`API_ORDEN_DETALLE_SELECT`) y anadio metodos nuevos al
// repositorio; este archivo fija que el endpoint y el metodo de la 106 quedaron IDENTICOS.
//
// Deliberadamente NO se importa `API_ORDEN_DETALLE_SELECT` desde produccion: compararse contra
// la misma constante que se quiere vigilar seria tautologico (cualquier cambio pasaria). El
// contrato se escribe AQUI como literal congelado, tal y como era ANTES de la 177.

const OWNER = "store-1";
const ORDEN_ID = "orden-1";

/**
 * Proyeccion EXACTA que la feature 106 enviaba a Prisma en `findDetalleByNumGuiaForOwner` (hoy
 * retirado) y que `findDetalleByOrdenIdForOwner` heredo sin tocar.
 * Copia literal congelada: si produccion anade, quita o renombra un campo, este test cae.
 *
 * ⚠️ FEATURE 268 (T6c / R27, 2026-08-22) — AQUI DECIA `resultado: { in: ["entregada",
 * "rechazada"] }` Y NO EXISTIA `incidentesAdmin`, y ya no es cierto. Los dos cambios son
 * DELIBERADOS y estan firmados en `specs/268-webhook-ayuda-incidente/design.md` §7.3 (opcion a+):
 *
 *   - el `in` gana `incidente` -> las evidencias del incidente del MENSAJERO (arista #44, familia
 *     `gestion`), que hasta ahora no salian por NINGUN endpoint del canal;
 *   - `incidentesAdmin` es la segunda procedencia -> el incidente del ADMIN (aristas #48-#52) NO
 *     crea gestion ninguna, asi que ampliar solo el `in` habria dejado 5 de las 6 aristas sin
 *     fotos y EN SILENCIO (esa es la opcion (a) que el design descarta por su nombre).
 *
 * ⚠️ FEATURE 404 (T4, 2026-09-09) — AQUI NO EXISTIA `mensajeroAsignado`, y ya no es cierto. El
 * cambio es DELIBERADO y esta firmado en `specs/404-mensajero-en-webhook-y-api/design.md` §5.2, y
 * la excepcion de privacidad que lo permite la firmo el humano el 2026-09-09 (design §2):
 *
 *   - se anade la relacion `mensajeroAsignado` con `id` + las TRES columnas de identidad de la
 *     feature 21 (`nombre`, `primerApellido`, `segundoApellido`) y NADA MAS -> el listado y el
 *     detalle publican `mensajero: { id, nombre } | null`, que es «quien LLEVA la orden», no quien
 *     la gestiono (404/R7);
 *   - entra en `API_ORDEN_SELECT` (no aqui abajo, no en el detalle): el detalle la hereda por el
 *     spread, que es la razon por la que la constante compartida existe.
 *
 * ⚠️ FEATURE 405 (T4, 2026-09-10) — AQUI EL `where` DE `gestiones` ERA UN SOLO PREDICADO Y NO
 * EXISTIA `historialEstados`, y ya no es cierto. Los cambios son DELIBERADOS y estan firmados en
 * `specs/405-gestiones-en-detalle-api/design.md` §3.1 y §3.2:
 *
 *   - el `where` de `gestiones` pasa a ser el `OR` del predicado ORIGINAL —intacto, palabra por
 *     palabra— y del de la 405 (`anuladaAt: null`). Prisma no deja pedir la misma relacion dos
 *     veces con dos alias, asi que se pide el SUPERCONJUNTO una vez y `toApiOrdenDetalleRow`
 *     vuelve a aplicar cada predicado en memoria. `evidencias[]` sale igual que antes, y eso lo
 *     afirma `orden-repository.api-lectura.test.ts` por comportamiento, no por proyeccion;
 *   - el `select` gana `id`, `anuladaAt`, las DOS causas tipificadas y la relacion `mensajero`
 *     (id + las tres columnas de identidad). NO gana `motivo` —el texto libre, 256/R22— ni
 *     `cierreId`, ni montos, ni ubicacion: lo que no se lee no se puede filtrar;
 *   - el `orderBy` gana `id` como desempate (405/R10); el orden primario no cambia;
 *   - `historialEstados` es la relacion NUEVA de la orden, la unica forma de saber a que estado
 *     llevo cada gestion sin entrar por una columna sin indice.
 *
 * ⚠️ FEATURE 415 (T3, 2026-09-10) — AQUI NO EXISTIAN `zonaId`, `cobraComision`, `zona`, `distrito`
 * NI `cierreDetalles`, y ya no es cierto. Los cinco son DELIBERADOS y estan firmados en
 * `specs/415-zona-y-costo-por-orden-api/design.md` §5 y §5.1:
 *
 *   - `zona` (`id`, `nombre`, `esCentral`) -> el item publica `zona: { id, nombre }`, que es la
 *     zona DE LA ORDEN (el destino del paquete). `esCentral` **NO se publica**: entra solo en el
 *     bundle de costeo, donde elige la columna de flete. ⚠️ NO CONFUNDIR con la zona DEL
 *     MENSAJERO (`usuario.zona_id`), que sigue excluida de `mensajeroAsignado` y que esta ficha no
 *     toca (415/R6);
 *   - `zonaId` y `cobraComision` -> entradas de la resolucion de tarifa y de la formula. No se
 *     publican;
 *   - `distrito: { zonaEspecial }` -> la marca tri-valuada que elige el pacto especial del flete.
 *     Ni el nombre del distrito, ni la provincia, ni el canton (415/R5);
 *   - `cierreDetalles` -> la fila CONGELADA de `cierre_detail` con la que se deriva `costoReal`,
 *     acotada por `tiendaId` (el CONGELADO, 415/R33) **y** por `cierre.estado = "aprobado"`
 *     (415/R26), con `orderBy` de dos claves y `take: 1` (415/R27). El `select` pide las quince
 *     columnas congeladas y ni una mas: ni el `id` de la fila, ni el `cierre_id`, ni el
 *     `zona_nombre` congelado, ni los descriptivos.
 *
 * ⚠️ EL `where` DEL CONGELADO NO ES UNA CONSTANTE: depende del `ownerId` de la peticion, y por eso
 * `API_ORDEN_SELECT` paso a ser `apiOrdenSelect(ownerId)`. Aqui se congela con el OWNER del test,
 * que es lo mismo que el codigo construye. La propiedad que la constante garantizaba —que listado
 * y detalle no puedan divergir— se afirma aparte, clave a clave, en
 * `orden-repository.api-lectura.test.ts`.
 *
 * El literal se ENMIENDA, no se sustituye por una comparacion contra la constante de produccion:
 * eso seria tautologico y dejaria de vigilar nada. Lo que sigue congelando: que no aparezca ninguna
 * OTRA columna de `usuario` (telefono, email, cedula, rol...), los nueve campos publicos de la
 * orden, la forma del bloque `gestiones` (mismas claves, mismo `select`, mismo `orderBy`, mismo
 * filtro de `evidenciaStoragePath`) y el `where` del metodo.
 *
 * Lo que este literal SIGUE congelando y no ha cambiado: los nueve campos publicos de la orden, la
 * forma del bloque `gestiones` (mismas claves, mismo `select`, mismo `orderBy`, mismo filtro de
 * `evidenciaStoragePath`) y el `where` del metodo. La no-regresion de la 106 es que su respuesta
 * para una orden entregada o rechazada es byte a byte la de antes: eso lo afirma
 * `orden-repository.api-lectura.test.ts`.
 */
const SELECT_DETALLE_106 = {
  numGuia: true,
  numRemision: true,
  destinatario: true,
  telefonoDest: true,
  producto: true,
  direccion: true,
  montoCobrar: true,
  createdAt: true,
  estatus: { select: { value: true } },
  // 404/R6 (2026-09-09): el mensajero ASIGNADO. Id + identidad, ni una columna mas de `usuario`.
  mensajeroAsignado: {
    select: { id: true, nombre: true, primerApellido: true, segundoApellido: true },
  },
  // --- 415 (2026-09-10): la zona de la ORDEN y las entradas del costo ---------------------------
  zonaId: true,
  cobraComision: true,
  // `esCentral` se lee pero NO se publica: elige la columna de flete (GAM vs estandar).
  zona: { select: { id: true, nombre: true, esCentral: true } },
  // Del distrito, SOLO la marca tri-valuada. Ni nombre, ni provincia, ni canton (415/R5).
  distrito: { select: { zonaEspecial: true } },
  // La fila congelada elegible MAS RECIENTE. El `where` lleva las DOS mitades y las dos son
  // load-bearing: `tiendaId` es el tienda_id CONGELADO (415/R33) y `cierre.estado` impide que
  // `costoReal` cambie hacia atras cuando haya un cierre solicitado o rechazado (415/R26).
  cierreDetalles: {
    where: { tiendaId: OWNER, cierre: { estado: "aprobado" } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], // 415/R27: orden TOTAL
    take: 1,
    select: {
      montoCobrar: true,
      cobraComision: true,
      esCentral: true,
      esZonaEspecial: true,
      tarifaId: true,
      tarifaValorFlete: true,
      tarifaValorFleteGam: true,
      tarifaValorFleteDevuelto: true,
      tarifaValorFleteDevueltoGam: true,
      tarifaComisionCod: true,
      tarifaIvaFlete: true,
      tarifaIvaComisionCod: true,
      tarifaEspecial: true,
      tarifaEspecialDevuelta: true,
      tarifaFulfillment: true,
    },
  },
  gestiones: {
    where: {
      OR: [
        {
          resultado: { in: ["entregada", "rechazada", "incidente"] }, // 268/R27
          evidenciaStoragePath: { not: null },
        },
        { anuladaAt: null }, // 405/R11
      ],
    },
    select: {
      resultado: true,
      evidenciaStoragePath: true,
      evidenciaContentType: true,
      createdAt: true,
      // 405: id + anuladaAt son de uso INTERNO del mapeo (emparejar y re-filtrar); no se publican.
      id: true,
      anuladaAt: true,
      causaDevolucion: true, // 405/R8
      causaIncidente: true, // 405/R8
      mensajero: {
        select: { id: true, nombre: true, primerApellido: true, segundoApellido: true },
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }], // 405/R10: empate determinista
  },
  // 405/R6: el historial de la ORDEN, filtrado a las transiciones que nacieron de una gestion.
  // Se pide por aqui —y no navegando `gestion.historialEstados`— porque `orden_historial_estado`
  // no tiene indice por `gestion_orden_id` (design 405 §3.2).
  historialEstados: {
    where: { gestionOrdenId: { not: null } },
    select: {
      id: true,
      gestionOrdenId: true,
      createdAt: true,
      estatusDestino: { select: { value: true } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
  // 268/R27: la portada (indice 0) del incidente del ADMIN, y nada mas del tramite.
  incidentesAdmin: {
    select: {
      evidencias: {
        where: { indice: 0 },
        select: { storagePath: true, contentType: true },
      },
    },
    orderBy: { createdAt: "asc" },
  },
};

/** Verbos HTTP que un route handler de Next.js puede exportar. */
const VERBOS_HTTP = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

const RAIZ = process.cwd();

function buildPrisma() {
  return {
    orden: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
  };
}

function verbosExportados(modulo: Record<string, unknown>): string[] {
  return VERBOS_HTTP.filter((verbo) => typeof modulo[verbo] === "function");
}

// BAJA (2026-08-31) — este bloque vigilaba `findDetalleByNumGuiaForOwner`, que SE RETIRO con su
// endpoint (`GET /api/ordenes/api-key/{numGuia}`). Lo que congelaba NO era el metodo sino la
// PROYECCION, y esa sigue viva en `findDetalleByOrdenIdForOwner` —era la misma constante
// (`API_ORDEN_DETALLE_SELECT`) para los dos—, asi que la vigilancia se muda ahi en vez de
// borrarse: el literal de abajo sigue siendo el de la 106, byte a byte. Lo unico que cambia es
// el `where`, que ahora identifica por `id` en vez de por `num_guia`.
describe("Feature 106 — la proyeccion del detalle sigue congelada (ahora por orden.id)", () => {
  it("el metodo sigue existiendo en OrdenRepository y en el contrato IOrdenRepository", () => {
    const repo = new OrdenRepository(buildPrisma() as unknown as PrismaClient);

    expect(typeof repo.findDetalleByOrdenIdForOwner).toBe("function");
    expect(
      Object.prototype.hasOwnProperty.call(
        OrdenRepository.prototype,
        "findDetalleByOrdenIdForOwner",
      ),
    ).toBe(true);

    // Comprobacion de tipos: si la firma declarada en la interfaz cambiara, esta asignacion
    // (repo -> interfaz -> firma esperada) dejaria de compilar y `pnpm typecheck` fallaria.
    const desdeLaInterfaz: IOrdenRepository["findDetalleByOrdenIdForOwner"] =
      repo.findDetalleByOrdenIdForOwner.bind(repo);
    const conLaFirmaDelDetalle: (
      ordenId: string,
      ownerId: string,
    ) => Promise<ApiOrdenDetalleRow | null> = desdeLaInterfaz;
    expect(typeof conLaFirmaDelDetalle).toBe("function");
  });

  it("conserva su aridad de dos parametros (ordenId, ownerId)", () => {
    const repo = new OrdenRepository(buildPrisma() as unknown as PrismaClient);
    expect(repo.findDetalleByOrdenIdForOwner.length).toBe(2);
    expect(OrdenRepository.prototype.findDetalleByOrdenIdForOwner.length).toBe(2);
  });

  it("envia a Prisma exactamente la misma proyeccion que antes de la feature 177", async () => {
    const prisma = buildPrisma();
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.findDetalleByOrdenIdForOwner(ORDEN_ID, OWNER);

    const { select } = (prisma.orden.findFirst as Mock).mock.calls[0][0];
    // Igualdad estructural contra el literal congelado: detecta campos anadidos y quitados.
    expect(select).toEqual(SELECT_DETALLE_106);
    expect(Object.keys(select).sort()).toEqual(Object.keys(SELECT_DETALLE_106).sort());
    expect(Object.keys(select.gestiones).sort()).toEqual(["orderBy", "select", "where"]);
    expect(Object.keys(select.gestiones.select).sort()).toEqual(
      Object.keys(SELECT_DETALLE_106.gestiones.select).sort(),
    );
  });

  it("sigue filtrando por el identificador + tiendaId + deletedAt: null y por nada mas", async () => {
    const prisma = buildPrisma();
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.findDetalleByOrdenIdForOwner(ORDEN_ID, OWNER);

    const { where } = (prisma.orden.findFirst as Mock).mock.calls[0][0];
    expect(where).toEqual({ id: ORDEN_ID, tiendaId: OWNER, deletedAt: null });
  });
});

describe("Feature 106 intacta — rutas y verbos de sus endpoints (R17)", () => {
  // BAJA (2026-08-31) — el `GET /api/ordenes/api-key/[numGuia]` de la 106 SE RETIRO: el
  // `GET /api/ordenes/api-key/orden/{id}` de la 177 sirve el MISMO `OrdenDetalle` y ademas
  // acepta `num_remision`, asi que la ruta por guia era un segundo camino, mas pobre, al mismo
  // recurso. La afirmacion se INVIERTE en vez de borrarse: si alguien la repone sin pasar por el
  // changelog del canal, este test lo caza.
  it("el archivo de ruta GET /api/ordenes/api-key/[numGuia] YA NO existe (retirado)", () => {
    const ruta = path.join(RAIZ, "app", "api", "ordenes", "api-key", "[numGuia]", "route.ts");
    expect(fs.existsSync(ruta)).toBe(false);
  });

  it("el archivo de ruta PUT /api/ordenes/api-key/[numGuia]/cancelar sigue en su sitio", () => {
    const ruta = path.join(
      RAIZ,
      "app",
      "api",
      "ordenes",
      "api-key",
      "[numGuia]",
      "cancelar",
      "route.ts",
    );
    expect(fs.existsSync(ruta)).toBe(true);
  });

  it("el modulo de cancelar exporta solo PUT y ningun verbo nuevo", () => {
    expect(verbosExportados(cancelarRoute as unknown as Record<string, unknown>)).toEqual(["PUT"]);
  });
});
