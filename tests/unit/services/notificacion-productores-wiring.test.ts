import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import { PostulacionMensajeroService } from "@/lib/services/PostulacionMensajeroService";
import { CierreDiaService } from "@/lib/services/CierreDiaService";
import { BulkOrdenService } from "@/lib/services/BulkOrdenService";
import { UsuarioDuplicadoError } from "@/lib/interfaces/repositories/IUserRepository";
import type { IPostulacionRepository } from "@/lib/interfaces/repositories/IPostulacionRepository";
import type { IFileStorage } from "@/lib/interfaces/external/IFileStorage";
import type { PostularMensajeroCommand } from "@/lib/interfaces/services/IPostulacionMensajeroService";
import { DOCUMENTO_TIPOS } from "@/lib/types/postulacion-mensajero";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { SIN_BLOQUEO } from "@/lib/utils/bloqueo-cierre";
import type {
  CargaMasivaNotificador,
  CierreNotificador,
} from "@/lib/notificaciones/notificadores";

// Feature 146 — B14/B15/B16 (wiring) y B17 (guardia de alcance). Verifica que cada operacion
// de negocio DISPARA su productor y que un productor que LANZA no cambia el resultado de la
// operacion (R25). Cubre R22, R23, R24, R25 y R26.

const ROOT = path.join(__dirname, "..", "..", "..");

// ---------------------------------------------------------------------------
// B14 — postulacion de mensajero
// ---------------------------------------------------------------------------

function repoPostulacion(overrides: Partial<IPostulacionRepository> = {}): IPostulacionRepository {
  return {
    emailExiste: vi.fn().mockResolvedValue(false),
    cedulaExiste: vi.fn().mockResolvedValue(false),
    findRolIdByValue: vi.fn().mockResolvedValue("rol-mensajero"),
    tipoIdentificacionExiste: vi.fn().mockResolvedValue(true),
    vehiculoExiste: vi.fn().mockResolvedValue(true),
    crearMensajeroConDocumentos: vi.fn().mockResolvedValue({ id: "usr-nuevo" }),
    ...overrides,
  };
}

function storageFake(): IFileStorage {
  return {
    upload: vi.fn().mockImplementation(async ({ path: p }: { path: string }) => p),
    remove: vi.fn().mockResolvedValue(undefined),
  };
}

function comandoPostulacion(): PostularMensajeroCommand {
  const documentos = Object.fromEntries(
    DOCUMENTO_TIPOS.map((t) => [t, { contentType: "image/jpeg", bytes: new Uint8Array([1]) }]),
  ) as PostularMensajeroCommand["documentos"];
  return {
    nombre: "Ana",
    primerApellido: "Perez",
    segundoApellido: "Gomez",
    email: "ana@example.com",
    telefono: "0991234567",
    tipoIdentificacionId: "tipo-1",
    cedula: "1710034065",
    vehiculoId: "veh-1",
    placa: "ABC123",
    password: "Abcdef1!",
    documentos,
  };
}

describe("R23 — registrar una postulacion dispara su aviso", () => {
  beforeEach(() => vi.clearAllMocks());

  it("notifica con el postulante y su nombre tras la escritura atomica", async () => {
    const notificar = vi.fn().mockResolvedValue(undefined);
    const service = new PostulacionMensajeroService(
      repoPostulacion(),
      storageFake(),
      notificar,
    );

    const r = await service.postular(comandoPostulacion());

    expect(r).toEqual({ status: "ok" });
    expect(notificar).toHaveBeenCalledTimes(1);
    expect(notificar.mock.calls[0][0]).toMatchObject({ nombre: "Ana Perez" });
    expect(typeof notificar.mock.calls[0][0].postulanteId).toBe("string");
  });

  it("NO notifica cuando la postulacion no llega a crearse", async () => {
    const notificar = vi.fn();
    const service = new PostulacionMensajeroService(
      repoPostulacion({ emailExiste: vi.fn().mockResolvedValue(true) }),
      storageFake(),
      notificar,
    );

    expect(await service.postular(comandoPostulacion())).toEqual({
      status: "conflict",
      field: "email",
    });
    expect(notificar).not.toHaveBeenCalled();
  });

  it("tampoco notifica si la escritura atomica falla por duplicado", async () => {
    const notificar = vi.fn();
    const service = new PostulacionMensajeroService(
      repoPostulacion({
        crearMensajeroConDocumentos: vi.fn().mockRejectedValue(new UsuarioDuplicadoError("cedula")),
      }),
      storageFake(),
      notificar,
    );

    expect(await service.postular(comandoPostulacion())).toMatchObject({ status: "conflict" });
    expect(notificar).not.toHaveBeenCalled();
  });
});

describe("R25 — un aviso que falla no tumba la postulacion", () => {
  it("la postulacion sigue devolviendo ok y no se limpian los documentos subidos", async () => {
    const notificar = vi.fn().mockRejectedValue(new Error("aviso caido"));
    const storage = storageFake();
    const service = new PostulacionMensajeroService(repoPostulacion(), storage, notificar);

    expect(await service.postular(comandoPostulacion())).toEqual({ status: "ok" });
    expect(storage.remove).not.toHaveBeenCalled(); // R24 no se dispara por un aviso
  });
});

// ---------------------------------------------------------------------------
// B15 — cierre del dia por aprobar (los TRES caminos de exito)
// ---------------------------------------------------------------------------

const MENSAJERO: Actor = { usuarioId: "men-1", rol: "mensajero", zonaId: "zona-1" };

const GESTION_PENDIENTE = {
  gestionId: "g-1",
  ordenId: "o-1",
  numGuia: 1,
  numRemision: "REM-1",
  destinatario: "D",
  direccion: null,
  zonaNombre: null,
  provinciaNombre: null,
  cantonNombre: null,
  distritoNombre: null,
  resultado: "entregada" as const,
  metodoPago: null,
  montoRecibido: null,
  evidenciaStoragePath: null,
  observacion: null,
  causaDevolucion: null,
  pagoMensajero: null,
  ingresoBodegaRechazo: null,
  pagos: [], // feature 212/R21: gestion sin cobro -> cero lineas de desglose
  createdAt: new Date("2026-07-27T10:00:00.000Z"),
};

function cierreRepo(overrides: Record<string, unknown> = {}) {
  return {
    // FEATURE 271 (R18): la re-solicitud elige por EDAD, no por estado: UN metodo, no cuatro.
    findCierreResolicitableMasViejo: vi.fn().mockResolvedValue(null),
    transicionarASolicitado: vi.fn().mockResolvedValue(true),
    contarOrdenesPendientesGestion: vi.fn().mockResolvedValue(0),
    findGestionesPendientes: vi.fn().mockResolvedValue([GESTION_PENDIENTE]),
    crearCierre: vi.fn().mockResolvedValue("c-1"),
    // FEATURE 271 (R56, cierra M9): el aviso se compone con el id del cierre que se acaba de tocar.
    findCierreParaAviso: vi
      .fn()
      .mockResolvedValue({ id: "c-1", destinoZonaId: "zona-1", mensajeroNombre: "Luis" }),
    findCierresByMensajero: vi.fn().mockResolvedValue([]),
    findGestionParaDeshacer: vi.fn(),
    findUltimaGestionNoAnuladaId: vi.fn(),
    anularGestionYDevolverAGestion: vi.fn(),
    ...overrides,
  };
}

function cierreService(repo: ReturnType<typeof cierreRepo>, notificar: CierreNotificador) {
  return new CierreDiaService(
    repo as never,
    { findCentralZonaId: vi.fn().mockResolvedValue("zona-central") } as never,
    {
      findUsuarioZonaId: vi.fn().mockResolvedValue("zona-1"),
      findUsuarioVehiculoId: vi.fn().mockResolvedValue("veh-1"),
      findEstatusIdByValue: vi.fn(),
      findBloqueoDetalle: vi.fn().mockResolvedValue(SIN_BLOQUEO),
    } as never,
    { createSignedUrls: vi.fn().mockResolvedValue({}) } as never,
    { resolvePagoTarifa: vi.fn().mockResolvedValue(null) } as never,
    notificar,
  );
}

// FEATURE 271 (R18): los TRES caminos pasaron a ser DOS —creacion y re-solicitud—, porque las dos
// ramas de transicion se unificaron en una que elige por EDAD. El aviso sigue saliendo por un unico
// sitio, que es lo que este bloque mide.
describe("R24 — los DOS caminos de exito de solicitar cierre avisan", () => {
  beforeEach(() => vi.clearAllMocks());

  it("camino de creacion (crearCierre)", async () => {
    const notificar = vi.fn().mockResolvedValue(undefined);
    const r = await cierreService(cierreRepo(), notificar).solicitarCierre(MENSAJERO);

    expect(r).toMatchObject({ status: "ok", via: "creado" });
    expect(notificar).toHaveBeenCalledWith({
      cierreId: "c-1",
      zonaId: "zona-1",
      mensajeroNombre: "Luis",
    });
  });

  it.each([["vencido"], ["rechazado"]] as const)(
    "camino de RE-SOLICITUD (el mas viejo es un `%s`)",
    async (estado) => {
      const notificar = vi.fn().mockResolvedValue(undefined);
      const repo = cierreRepo({
        findCierreResolicitableMasViejo: vi.fn().mockResolvedValue({ id: "c-1", estado }),
      });

      const r = await cierreService(repo, notificar).solicitarCierre(MENSAJERO);

      expect(r).toMatchObject({ status: "ok", via: "resolicitado" });
      expect(notificar).toHaveBeenCalledTimes(1);
      // R56 (M9): el aviso se compone con el id del cierre QUE SE ACABA DE TOCAR.
      expect(repo.findCierreParaAviso).toHaveBeenCalledWith("c-1");
    },
  );

  it("propaga la zona destino del cierre como alcance del aviso", async () => {
    const notificar = vi.fn().mockResolvedValue(undefined);
    const repo = cierreRepo({
      findCierreParaAviso: vi
        .fn()
        .mockResolvedValue({ id: "c-9", destinoZonaId: "zona-7", mensajeroNombre: null }),
    });

    await cierreService(repo, notificar).solicitarCierre(MENSAJERO);

    expect(notificar.mock.calls[0][0]).toMatchObject({ cierreId: "c-9", zonaId: "zona-7" });
  });

  it("NO avisa cuando la solicitud termina en conflicto", async () => {
    // FEATURE 271: el conflicto ya no es «ya tienes un cierre solicitado» (el segundo se permite,
    // R13). El unico que queda por esta via es la precondicion de ordenes sin gestionar.
    const notificar = vi.fn();
    const repo = cierreRepo({ contarOrdenesPendientesGestion: vi.fn().mockResolvedValue(3) });

    const r = await cierreService(repo, notificar).solicitarCierre(MENSAJERO);

    expect(r.status).toBe("conflict");
    expect(notificar).not.toHaveBeenCalled();
  });

  it("no inventa un aviso si el cierre solicitado no se puede resolver", async () => {
    const notificar = vi.fn();
    const repo = cierreRepo({ findCierreParaAviso: vi.fn().mockResolvedValue(null) });

    const r = await cierreService(repo, notificar).solicitarCierre(MENSAJERO);

    expect(r.status).toBe("ok");
    expect(notificar).not.toHaveBeenCalled();
  });
});

describe("R25 — un aviso que falla no tumba el cierre", () => {
  it("solicitarCierre sigue devolviendo ok cuando el notificador lanza", async () => {
    const notificar = vi.fn().mockRejectedValue(new Error("aviso caido"));

    const r = await cierreService(cierreRepo(), notificar).solicitarCierre(MENSAJERO);

    expect(r).toMatchObject({ status: "ok", via: "creado" });
  });
});

// ---------------------------------------------------------------------------
// B16 — carga masiva por API key
// ---------------------------------------------------------------------------

const ACTOR_API: Actor = { usuarioId: "api-user-1", rol: "apiKey", zonaId: null };

function bulkService(notificar: CargaMasivaNotificador) {
  const repo = {
    findEstatusIdByValue: vi.fn().mockResolvedValue("est-1"),
    findExistingRemisiones: vi.fn().mockResolvedValue(new Map()),
    findAllProvincias: vi.fn().mockResolvedValue([]),
    findCantonesByProvinciaIds: vi.fn().mockResolvedValue([]),
    findDistritosByCantonIds: vi.fn().mockResolvedValue([]),
    // Feature 155: `cargarViaApi` resuelve el estado inicial con el flag de la tienda
    // dueña de la key, asi que el doble del repositorio debe exponerlo.
    findUsuarioFulfillment: vi.fn().mockResolvedValue(false),
    createManyOrdenesConGuia: vi.fn().mockResolvedValue([]),
  };
  const tarifas = { resolveTarifaPorTienda: vi.fn().mockResolvedValue(null) };
  return new BulkOrdenService(repo as never, tarifas as never, notificar);
}

describe("R22 — la carga por API key notifica al ejecutor al cerrar el lote", () => {
  beforeEach(() => vi.clearAllMocks());

  it("emite una sola vez, al usuario de la key, con los contadores del resumen", async () => {
    const notificar = vi.fn().mockResolvedValue(undefined);

    // fila sin geografia -> resultado `error`: no se crea nada, pero el LOTE termina igual y
    // el aviso se emite con los contadores del resumen.
    const r = await bulkService(notificar).cargarViaApi([{ num_remision: "R1" }], ACTOR_API);

    expect(r.status).toBe("ok");
    expect(notificar).toHaveBeenCalledTimes(1);
    const ctx = notificar.mock.calls[0][0];
    expect(ctx.usuarioId).toBe("api-user-1");
    expect(ctx.total).toBe(1);
    expect(typeof ctx.loteId).toBe("string");
  });

  it("no notifica cuando el rol no esta autorizado", async () => {
    const notificar = vi.fn();

    const r = await bulkService(notificar).cargarViaApi(
      [{ num_remision: "R1" }],
      { usuarioId: "u-1", rol: "adminTienda", zonaId: null },
    );

    expect(r.status).toBe("forbidden");
    expect(notificar).not.toHaveBeenCalled();
  });
});

describe("R25 — un aviso que falla no tumba la carga masiva", () => {
  it("cargarViaApi sigue devolviendo el resumen cuando el notificador lanza", async () => {
    const notificar = vi.fn().mockRejectedValue(new Error("aviso caido"));

    const r = await bulkService(notificar).cargarViaApi([{ num_remision: "R1" }], ACTOR_API);

    expect(r.status).toBe("ok");
  });
});

// ---------------------------------------------------------------------------
// B17 — guardia de alcance (R26 / D2)
// ---------------------------------------------------------------------------

describe("R26 — la feature no introduce ningun trabajo programado", () => {
  it("vercel.json no gana ninguna entrada de cron de notificaciones", () => {
    const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8")) as {
      crons?: { path: string }[];
    };
    for (const cron of vercel.crons ?? []) {
      expect(cron.path).not.toMatch(/notificacion/i);
    }
  });

  it("el enum JobTipo no gana ningun valor de notificacion", () => {
    const schema = fs.readFileSync(path.join(ROOT, "db", "schema.prisma"), "utf8");
    const jobTipo = /enum JobTipo \{([\s\S]*?)\}/.exec(schema);
    expect(jobTipo).not.toBeNull();
    expect(jobTipo![1]).not.toMatch(/notificacion/i);
  });

  it("no existe ninguna ruta de cron ni route handler de notificaciones bajo app/", () => {
    const encontrados: string[] = [];
    const recorrer = (dir: string) => {
      for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
        const completo = path.join(dir, entrada.name);
        if (entrada.isDirectory()) {
          if (/notificacion/i.test(entrada.name)) encontrados.push(completo);
          recorrer(completo);
        }
      }
    };
    recorrer(path.join(ROOT, "app"));
    expect(encontrados).toEqual([]);
  });

  it("la migracion de la feature no toca la tabla `jobs` ni su enum", () => {
    const dir = fs
      .readdirSync(path.join(ROOT, "db", "migrations"), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .find((n) => n.endsWith("_notificacion"))!;
    const sql = fs.readFileSync(path.join(ROOT, "db", "migrations", dir, "migration.sql"), "utf8");
    expect(sql).not.toMatch(/"jobs"/);
    expect(sql).not.toMatch(/job_tipo/);
  });

  // ⚠️ EL TITULO YA NO LLEVA EL NUMERO, y es deliberado (mismo criterio que
  // `notificacion-notificadores-reales.test.ts`): decia «exactamente seis» cuando ya eran ocho, y
  // un nombre con la cuenta atrasada hace que el inventario PAREZCA mas pequeño de lo que es. La
  // lista literal de abajo es la fuente; el titulo solo dice que esta cerrada.
  it("el enum de eventos sigue siendo un inventario CERRADO, y la lista es LITERAL", () => {
    // ⚠️ ERA CUATRO hasta el 2026-08-20. La feature 253 (D6, firmada por el humano EN CONTRA de la
    // recomendacion de su propio spec) anadio `postulacion_recurso_pendiente` con su migracion de
    // enum y su `down.sql` de recreacion — que es exactamente el precio que D1 puso a anadir un
    // evento, y por eso este test se actualiza en vez de relajarse.
    //
    // ⚠️ Y ERA CINCO hasta el 2026-08-22. La feature 262 (D7, P2 respondida SI por la puerta humana,
    // otra vez EN CONTRA de la recomendacion del spec) anade `dia_reparto_corregido`: al mensajero
    // se le avisa cuando le corrigen el dia de reparto de una orden suya. Pago el mismo precio —dos
    // `ALTER TYPE`, su `down.sql` de recreacion con los CINCO previos y este test rojo—, y que este
    // test se pusiera rojo ES LA PRUEBA de que el inventario sigue cerrado.
    //
    // La lista sigue siendo LITERAL a proposito: el contrato de D1 no es "hay N eventos", es "los
    // eventos son ESTOS y cada uno tiene un productor identificado". Cambiarla por una derivacion
    // del propio schema dejaria el test siempre verde y no diria nada.
    const schema = fs.readFileSync(path.join(ROOT, "db", "schema.prisma"), "utf8");
    const eventos = /enum NotificacionEvento \{([\s\S]*?)\n\}/.exec(schema)![1];
    const valores = eventos
      .split("\n")
      // El valor de la 253 lleva comentario al final de linea; se corta antes de comparar.
      .map((l) => l.trim().split(/\s+\/\//)[0].trim())
      .filter((l) => l.length > 0 && !l.startsWith("//") && !l.startsWith("@@"));
    expect(valores).toEqual([
      "orden_rechazada",
      "carga_masiva_terminada",
      "postulacion_mensajero_pendiente",
      "cierre_dia_por_aprobar",
      "postulacion_recurso_pendiente", // feature 253 / D6
      "dia_reparto_corregido", // feature 262 / D7
      // FEATURE 271 (§9.2, Q4 resuelta el 2026-08-23) — DOS valores mas, y este test rojo fue otra
      // vez LA PRUEBA de que el inventario sigue cerrado. Pago el mismo precio: un `ALTER TYPE`, su
      // `down.sql` de recreacion con los SEIS previos y esta lista actualizada a mano.
      //
      // POR QUE DOS Y NO UNO: el evento es lo que la campana usa para AGRUPAR y para DEDUPLICAR, y
      // las dos causas piden acciones OPUESTAS —con un `vencido` la pelota esta en el tejado del
      // mensajero; con `N >= 2`, en el de la administracion—.
      "cierre_dia_vencido", // feature 271 / §9.2
      "mensajero_bloqueado_por_cierres", // feature 271 / §9.2
      // FICHA 333 (E6, R36) — NOVENO valor. Que esta lista se pusiera roja ES LA PRUEBA de que el
      // inventario sigue CERRADO, y esta ficha pago el precio completo: `ALTER TYPE` en migracion
      // APARTE (por el 55P04), su `down.sql` recreando el tipo con los OCHO previos, y esta linea
      // escrita a mano.
      //
      // Su productor es el CRON de gastos fijos (`GeneracionGastosFijosService`), que lo emite al
      // final de su corrida mientras quede al menos un cobro `pendiente`. Destinatario: el rol
      // `maestro` y nadie mas — el `admin` VE la cola pero no puede decidirla (R24).
      "gasto_fijo_cobro_pendiente", // ficha 333 / §4.1
      // FICHA 403 (R9) — DECIMO valor. Que esta lista se pusiera roja ES LA PRUEBA de que el
      // inventario sigue CERRADO, y esta ficha pago el precio completo: `ALTER TYPE` en migracion
      // APARTE (por el 55P04), su `down.sql` recreando el tipo con los NUEVE previos, y esta linea
      // escrita a mano.
      //
      // Su productor es el DRENADOR DE LA COLA (`WebhookEstadoService`), que lo emite en cada
      // entrega fallida mientras la suscripcion este pausada; que salga UN solo aviso por racha lo
      // da la ENTIDAD, no una rama de codigo. Destinatario: el rol `maestro` y nadie mas — es el
      // unico que opera Configuracion > API.
      "webhook_suscripcion_pausada", // ficha 403 / §5
      // FICHA 401 (T5, R7) — UNDECIMO valor, y que esta lista se pusiera roja ES otra vez LA
      // PRUEBA de que el inventario sigue CERRADO. Pago el precio completo: `ALTER TYPE` en
      // migracion APARTE (por el 55P04), su `down.sql` recreando el tipo con los DIEZ previos —los
      // nueve de siempre MAS el de la 403, que entro antes que esta ficha—, y esta linea escrita a
      // mano.
      //
      // Su productor es `GeocodeSaludService`, desde la rama de configuracion del job de
      // geocodificacion (es decir, dentro del cron de la cola). Destinatarios: `maestro` Y `admin`
      // —decision del humano del 2026-09-09—, porque un corte del proveedor deja de ubicar
      // direcciones de TODA la operacion y el maestro puede no estar delante durante las horas que
      // dura, que es literalmente lo que paso las 19 h del 2026-09-08.
      "geocodificacion_caida", // ficha 401 / §7.1
      // FICHA 409 (T2.1) — DUODECIMO y DECIMOTERCERO valores, y que esta lista se pusiera roja ES
      // otra vez LA PRUEBA de que el inventario sigue CERRADO. La ficha pago el precio completo:
      // `ALTER TYPE` en migracion APARTE (por el 55P04), su `down.sql` recreando los DOS tipos con
      // los ONCE eventos y las NUEVE entidades previos —leidos de `origin/dev` @ `aff769d8`—, y
      // estas dos lineas escritas a mano.
      //
      // Los dos son AGREGADOS: UNA notificacion con el NUMERO dentro, jamas una por orden. Su
      // productor es el CRON `avisos-diarios` (`AvisosDiariosService`), a las 07:00 CR.
      //   · `novedades_sin_gestionar`  -> al rol `adminTienda`, ACOTADO a su tienda.
      //   · `devoluciones_represadas`  -> a `maestro` y `admin` (ambito global) y al
      //     `adminSatelite` de cada zona (ambito = su zona), cada uno con SU numero.
      "novedades_sin_gestionar", // ficha 409 / §4.3
      "devoluciones_represadas", // ficha 409 / §4.3
      // FICHA 412 (T1.1) — DECIMOCUARTO valor, y que esta lista se pusiera roja ES otra vez LA
      // PRUEBA de que el inventario sigue CERRADO. La ficha pago el precio completo: `ALTER TYPE`
      // en migracion APARTE (por el 55P04), su `down.sql` recreando los DOS tipos con los TRECE
      // eventos y las ONCE entidades previos —leidos de `origin/dev` @ `b4ee8412` y re-leidos en
      // `6c5335fc` antes del PR—, y esta linea escrita a mano.
      //
      // Su productor es el RECHAZO de un cierre del dia (`CierresAdminService.rechazarCierre`),
      // que lo emite SIEMPRE que la escritura confirme, deje bloqueado al mensajero o no.
      // Destinatario UNICO: el MENSAJERO dueno del cierre, como fila dirigida a USUARIO — no hay
      // fila de rol de este evento (R2); la administracion sigue recibiendo la suya de
      // `mensajero_bloqueado_por_cierres`, sin cambios (R18).
      //
      // POR QUE UN EVENTO PROPIO Y NO UNA VARIANTE DE TEXTO DEL BLOQUEO: hasta esta ficha NINGUN
      // aviso del sistema decia la palabra «rechazado» —el mensajero leia lo mismo que por un
      // `vencido`—, y el compositor `avisoBloqueo` lo comparten TRES productores y TRES pantallas,
      // asi que meterlo ahi seria FALSO para las otras dos causas. Ademas el evento es lo que la
      // campana usa para AGRUPAR y DEDUPLICAR: una diferencia metida en la descripcion es
      // invisible para todo lo que no sea leer la frase.
      "cierre_dia_rechazado", // ficha 412 / §2
      // FICHA 413 (design 7) - DECIMOQUINTO valor, y este test rojo fue OTRA VEZ la prueba de que
      // el inventario sigue CERRADO. Su productor es el CRON `aviso-reparto-manana`
      // (`RepartoMananaAvisoService`), que lo emite a las 19:00 CR (= `0 1 * * *` UTC) UNA VEZ POR
      // DIA ANUNCIADO, dirigido al MENSAJERO asignado como fila de USUARIO. Es el TERCER aviso
      // AGREGADO: el numero NO se persiste -lo compone el catalogo con la cifra VIVA en cada
      // lectura- y el BLOQUEADO por cierres no lo recibe (filtro de EMISION, no de lectura).
      "reparto_manana", // ficha 413 / §7
    ]);
  });

  it("el enum de ENTIDADES tambien es un inventario cerrado, y la de este aviso es EL DIA (R36)", () => {
    // FICHA 333 (E6) — la lista hermana, y no es simetria decorativa: `gasto_fijo_cobro_dia` es el
    // PRIMER `entidad_tipo` que NO apunta a una fila de tabla. `entidad_id` es la fecha
    // `"YYYY-MM-DD"` de la corrida, y de ahi salen las dos propiedades que la ficha necesita: dias
    // distintos ⇒ entidades distintas ⇒ el recordatorio diario sale siempre (R30); misma corrida
    // repetida el mismo dia ⇒ misma entidad ⇒ un solo aviso (R31).
    //
    // Con el COBRO como entidad, `notificacion_dedupe_key` admitiria UNA sola fila por
    // (evento, cobro, maestro) PARA SIEMPRE y el recordatorio del dia 2 no saldria nunca, en
    // silencio: es el fallo que la 262 documento. Por eso el valor esta enumerado aqui y no
    // derivado del schema — para que reusar uno existente tenga que ser una decision escrita.
    const schema = fs.readFileSync(path.join(ROOT, "db", "schema.prisma"), "utf8");
    const entidades = /enum NotificacionEntidadTipo \{([\s\S]*?)\n\}/.exec(schema)![1];
    const valores = entidades
      .split("\n")
      .map((l) => l.trim().split(/\s+\/\//)[0].trim())
      .filter((l) => l.length > 0 && !l.startsWith("//") && !l.startsWith("@@"));
    expect(valores).toEqual([
      "orden",
      "usuario",
      "cierre_dia",
      "carga",
      "postulacion_recurso", // feature 253 / D6
      "orden_dia_reparto_cambio", // feature 262 / D7
      "gasto_fijo_cobro_dia", // ficha 333 / §4.2 — EL DIA CR, no el cobro
      // FICHA 403 (design §1.2) — SEGUNDO valor que NO apunta a una fila de tabla: la entidad es
      // LA RACHA DE FALLOS (`entidad_id = "<owner>:<sinExitoDesde ISO>"`), no la suscripcion. Con
      // la suscripcion como entidad, `notificacion_dedupe_key` admitiria UNA sola fila por
      // (evento, owner, maestro) PARA SIEMPRE y la SEGUNDA racha de ese integrador no avisaria
      // nunca, en silencio — el fallo que documento la 262 con `orden`.
      "webhook_suscripcion_pausa", // ficha 403 / §1.2 — LA RACHA, no la suscripcion
      // FICHA 401 (§3.3) — TERCER `entidad_tipo` que no apunta a una fila de tabla, por el mismo
      // motivo exacto: la entidad del aviso es LA JORNADA CR. No hay ninguna fila que represente
      // «el corte» —esta ficha no crea tabla ni columna (R31)— y con una entidad que no cambiara
      // entre jornadas el aviso del dia 2 no saldria NUNCA, en silencio.
      "geocodificacion_caida_dia", // ficha 401 / §3.3 — LA JORNADA CR
      // ⚠️ FICHA 409 (design §4.2) — CUARTO y QUINTO valores que NO apuntan a una fila de tabla, y
      // los primeros que llevan EL ALCANCE DENTRO del `entidad_id`:
      //
      //     novedades_sin_gestionar_dia   -> `${tiendaId}:${diaCR}`
      //     devoluciones_represadas_dia   -> `${ambito}:${diaCR}`   (ambito = "global" | zonaId)
      //
      // Y esa mitad —la tienda, la zona— NO es decoracion: `notificacion_dedupe_key` es UNIQUE
      // sobre `(evento, entidad_id, destinatario_rol, destinatario_usuario_id)` y el ALCANCE
      // (`tienda_id`, `zona_id`) **NO ENTRA** en la clave. Con `entidad_id = diaCR` a secas, la
      // primera tienda de la corrida se llevaria el aviso y TODAS LAS DEMAS quedarian silenciadas,
      // sin error y sin log — el fallo que la 262 documento con `orden` y la 403 con la racha.
      "novedades_sin_gestionar_dia", // ficha 409 / §4.2 — LA TIENDA Y EL DIA CR
      "devoluciones_represadas_dia", // ficha 409 / §4.2 — EL AMBITO Y EL DIA CR
      // ⚠️ FICHA 412 (design §3) — SEXTO valor que NO apunta a una fila de tabla, y el primero
      // cuya mitad variable es UN INSTANTE en vez de un dia:
      //
      //     cierre_dia_rechazo  ->  `${cierreId}:${resueltoAtISO}`
      //
      // POR QUE EL RECHAZO Y NO EL CIERRE, que es la eleccion natural —y la que sigue usando el
      // aviso de bloqueo—: `notificacion_dedupe_key` NO MIRA EL ESTADO DE LECTURA, asi que con el
      // cierre como entidad la clave admitiria UNA sola fila por (evento, cierre, mensajero) PARA
      // SIEMPRE. Y como `rechazado` es RE-SOLICITABLE y `transicionarASolicitado` REUTILIZA la
      // misma fila de `cierre_dia`, el ciclo NORMAL de esa pantalla —rechazo, correccion,
      // rechazo— dejaria el SEGUNDO rechazo MUDO: sin error, sin log y sin nada. Es el fallo que
      // la 262 documento con `orden` y la 403 con la racha, y es el que esta ficha vino a cerrar.
      //
      // Y NO es el DIA CR (como los cinco de arriba): el ciclo rechazo -> correccion -> rechazo
      // cabe entero dentro del mismo dia. El dia es el grano de un RECORDATORIO que se repite
      // mientras dure un estado; aqui la pregunta no es «¿ya avise hoy?» sino «¿ya avise de ESTE
      // rechazo?».
      "cierre_dia_rechazo", // ficha 412 / §3 — EL RECHAZO (cierre + instante), no el cierre
      // FICHA 413 (design 7) - SEPTIMO valor que NO apunta a una fila de tabla: la entidad es EL
      // DIA ANUNCIADO (`entidad_id = "YYYY-MM-DD"`), no ninguna orden. Con una entidad que no
      // cambiara entre jornadas, el aviso de la SEGUNDA noche no saldria NUNCA, en silencio - el
      // fallo que pagaron la 262 (con `orden`) y la 403 (con la suscripcion).
      // Y NO lleva prefijo de mensajero, al contrario que los DOS de la 409: alli el destinatario
      // es un ROL CON ALCANCE y el alcance no esta en la clave unica; aqui es un USUARIO, y
      // `destinatario_usuario_id` YA ES una columna de `notificacion_dedupe_key`.
      "reparto_manana_dia", // ficha 413 / §7 - EL DIA ANUNCIADO, sin prefijo de mensajero
    ]);
  });
});
