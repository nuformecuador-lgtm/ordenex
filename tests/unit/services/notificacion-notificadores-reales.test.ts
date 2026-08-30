import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import type {
  CrearNotificacionInput,
  INotificacionRepository,
} from "@/lib/interfaces/repositories/INotificacionRepository";
import {
  notificadorNoOp,
  notificarCargaMasivaTerminadaCon,
  notificarCierreDiaPorAprobarCon,
  notificarPostulacionPendienteCon,
} from "@/lib/notificaciones/notificadores";
import { PostulacionMensajeroService } from "@/lib/services/PostulacionMensajeroService";
import { BulkOrdenService } from "@/lib/services/BulkOrdenService";
import { CierreDiaService } from "@/lib/services/CierreDiaService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IPostulacionRepository } from "@/lib/interfaces/repositories/IPostulacionRepository";
import type { IFileStorage } from "@/lib/interfaces/external/IFileStorage";
import type { PostularMensajeroCommand } from "@/lib/interfaces/services/IPostulacionMensajeroService";
import { DOCUMENTO_TIPOS } from "@/lib/types/postulacion-mensajero";

// Feature 146 — camino REAL de los notificadores best-effort (R22, R23, R24, R25).
//
// ⚠️ 2026-08-23: eran TRES cuando se escribio este archivo; hoy son CINCO (la 253 anadio el de
// la postulacion de recurso y la 262 el del dia de reparto corregido). Los casos de emision de
// abajo siguen cubriendo los tres originales; el censo del final —«el camino real esta CABLEADO
// en el composition root»— cubre los cinco y se contrasta contra el arbol.
//
// El default del constructor de cada uno de esos services es el NO-OP, y el notificador real se
// cablea en el composition root. Esto es lo que permite que este archivo pruebe el camino que corre en
// produccion: se construye `notificar*Con(repoDoble)` —la MISMA funcion que usa el binding real,
// solo que con el repositorio inyectado— y se verifica que emite lo esperado, y que un fallo se
// absorbe y se registra en vez de propagarse.

const ROOT = path.join(__dirname, "..", "..", "..");

/** Repositorio doble: registra lo creado, sin dedupe previa. */
class RepoDoble implements INotificacionRepository {
  creadas: CrearNotificacionInput[] = [];
  async crear(input: CrearNotificacionInput): Promise<boolean> {
    this.creadas.push(input);
    return true;
  }
  existeNoLeidaPara = vi.fn().mockResolvedValue(false);
  listarParaUsuario = vi.fn().mockResolvedValue([]);
  verificarVisible = vi.fn().mockResolvedValue("visible" as const);
  marcarTodasLeidas = vi.fn().mockResolvedValue(0);
  descartar = vi.fn().mockResolvedValue(undefined);
}

/** Repositorio que revienta al crear: modela la base caida en el camino real. */
class RepoQueFalla extends RepoDoble {
  override async crear(): Promise<boolean> {
    throw new Error("base caida");
  }
}

describe("R23 — camino real del notificador de postulacion", () => {
  it("emite las dos filas de maestro y admin contra el repositorio inyectado", async () => {
    const repo = new RepoDoble();

    await notificarPostulacionPendienteCon(repo)({ postulanteId: "u-9", nombre: "Ana Pérez" });

    expect(repo.creadas).toHaveLength(2);
    expect(repo.creadas.map((c) => c.destinatario)).toEqual([
      { tipo: "rol", rol: "maestro" },
      { tipo: "rol", rol: "admin" },
    ]);
    expect(repo.creadas[0].descripcion).toBe(
      "Una postulación de mensajero está pendiente de aprobación.",
    );
  });

  it("R25: absorbe el fallo del repositorio y lo registra, sin propagarlo", async () => {
    const logError = vi.fn();

    await expect(
      notificarPostulacionPendienteCon(new RepoQueFalla(), { logError })({
        postulanteId: "u-9",
        nombre: "Ana",
      }),
    ).resolves.toBeUndefined();

    expect(logError).toHaveBeenCalledTimes(1);
    const registrado = logError.mock.calls[0][0] as Error;
    expect(registrado.message).toContain("postulacion_mensajero_pendiente");
    expect((registrado.cause as Error).message).toBe("base caida");
  });
});

describe("R24 — camino real del notificador de cierre por aprobar", () => {
  it("emite las tres filas, la tercera acotada a la zona destino", async () => {
    const repo = new RepoDoble();

    await notificarCierreDiaPorAprobarCon(repo)({
      cierreId: "c-1",
      zonaId: "zona-3",
      mensajeroNombre: "Luis",
    });

    expect(repo.creadas.map((c) => c.destinatario)).toEqual([
      { tipo: "rol", rol: "maestro" },
      { tipo: "rol", rol: "admin" },
      { tipo: "rol", rol: "adminSatelite", zonaId: "zona-3" },
    ]);
  });

  it("R25: absorbe el fallo del repositorio y lo registra", async () => {
    const logError = vi.fn();

    await expect(
      notificarCierreDiaPorAprobarCon(new RepoQueFalla(), { logError })({
        cierreId: "c-1",
        zonaId: null,
        mensajeroNombre: null,
      }),
    ).resolves.toBeUndefined();

    expect((logError.mock.calls[0][0] as Error).message).toContain("cierre_dia_por_aprobar");
  });
});

describe("R22 — camino real del notificador de carga masiva", () => {
  it("emite una fila box dirigida al ejecutor con los contadores del lote", async () => {
    const repo = new RepoDoble();

    await notificarCargaMasivaTerminadaCon(repo)({
      usuarioId: "api-user-1",
      creadas: 128,
      total: 130,
      loteId: "lote-1",
    });

    expect(repo.creadas).toHaveLength(1);
    expect(repo.creadas[0]).toMatchObject({
      tipo: "box",
      evento: "carga_masiva_terminada",
      entidadTipo: "carga",
      entidadId: "lote-1",
      destinatario: { tipo: "usuario", usuarioId: "api-user-1" },
    });
    expect(repo.creadas[0].descripcion).toBe("Carga masiva terminada: 128 órdenes cargadas.");
  });

  it("R25: absorbe el fallo del repositorio y lo registra", async () => {
    const logError = vi.fn();

    await expect(
      notificarCargaMasivaTerminadaCon(new RepoQueFalla(), { logError })({
        usuarioId: "u-1",
        creadas: 1,
        total: 1,
        loteId: "lote-1",
      }),
    ).resolves.toBeUndefined();

    expect((logError.mock.calls[0][0] as Error).message).toContain("carga_masiva_terminada");
  });
});

describe("el notificador real, cableado en un service, emite de punta a punta", () => {
  function repoPostulacion(): IPostulacionRepository {
    return {
      emailExiste: vi.fn().mockResolvedValue(false),
      cedulaExiste: vi.fn().mockResolvedValue(false),
      findRolIdByValue: vi.fn().mockResolvedValue("rol-mensajero"),
      tipoIdentificacionExiste: vi.fn().mockResolvedValue(true),
      vehiculoExiste: vi.fn().mockResolvedValue(true),
      crearMensajeroConDocumentos: vi.fn().mockResolvedValue({ id: "usr-nuevo" }),
    };
  }
  function storageFake(): IFileStorage {
    return {
      upload: vi.fn().mockImplementation(async ({ path: p }: { path: string }) => p),
      remove: vi.fn().mockResolvedValue(undefined),
    };
  }
  function comando(): PostularMensajeroCommand {
    const documentos = Object.fromEntries(
      DOCUMENTO_TIPOS.map((t) => [t, { contentType: "image/jpeg", bytes: new Uint8Array([1]) }]),
    ) as PostularMensajeroCommand["documentos"];
    return {
      nombre: "Ana",
      primerApellido: "Perez",
      segundoApellido: undefined,
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

  it("postular con el notificador REAL cableado crea las dos filas en el repositorio", async () => {
    const notificaciones = new RepoDoble();
    const service = new PostulacionMensajeroService(
      repoPostulacion(),
      storageFake(),
      notificarPostulacionPendienteCon(notificaciones),
    );

    expect(await service.postular(comando())).toEqual({ status: "ok" });
    expect(notificaciones.creadas).toHaveLength(2);
    expect(notificaciones.creadas[0].anexo).toBe("Ana Perez");
  });

  it("cargarViaApi con el notificador REAL cableado crea la fila del ejecutor", async () => {
    const notificaciones = new RepoDoble();
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
    const service = new BulkOrdenService(
      repo as never,
      { resolveTarifaPorTienda: vi.fn().mockResolvedValue(null) } as never,
      notificarCargaMasivaTerminadaCon(notificaciones),
    );
    const actor: Actor = { usuarioId: "api-user-1", rol: "apiKey", zonaId: null };

    expect((await service.cargarViaApi([{ num_remision: "R1" }], actor)).status).toBe("ok");
    expect(notificaciones.creadas).toHaveLength(1);
    expect(notificaciones.creadas[0].destinatario).toEqual({
      tipo: "usuario",
      usuarioId: "api-user-1",
    });
  });
});

describe("el DEFAULT de un service con notificador es inocuo POR CONSTRUCCION", () => {
  it("notificadorNoOp no hace nada y no lanza", async () => {
    await expect(notificadorNoOp({} as never)).resolves.toBeUndefined();
  });

  it("un service construido sin cablear el notificador no puede emitir nada", async () => {
    // Se construye tal y como lo hacen los dobles de las suites ajenas: sin tercer argumento.
    const service = new PostulacionMensajeroService(repoPostulacionSinCablear(), storageSinCablear());
    // No hay forma de observar una emision porque el default NO tiene repositorio detras.
    // Lo que se fija aqui es que el camino termina en `ok` sin tocar nada externo.
    expect(await service.postular(comandoMinimo())).toEqual({ status: "ok" });
  });

  function repoPostulacionSinCablear(): IPostulacionRepository {
    return {
      emailExiste: vi.fn().mockResolvedValue(false),
      cedulaExiste: vi.fn().mockResolvedValue(false),
      findRolIdByValue: vi.fn().mockResolvedValue("rol-mensajero"),
      tipoIdentificacionExiste: vi.fn().mockResolvedValue(true),
      vehiculoExiste: vi.fn().mockResolvedValue(true),
      crearMensajeroConDocumentos: vi.fn().mockResolvedValue({ id: "usr-nuevo" }),
    };
  }
  function storageSinCablear(): IFileStorage {
    return {
      upload: vi.fn().mockImplementation(async ({ path: p }: { path: string }) => p),
      remove: vi.fn().mockResolvedValue(undefined),
    };
  }
  function comandoMinimo(): PostularMensajeroCommand {
    const documentos = Object.fromEntries(
      DOCUMENTO_TIPOS.map((t) => [t, { contentType: "image/jpeg", bytes: new Uint8Array([1]) }]),
    ) as PostularMensajeroCommand["documentos"];
    return {
      nombre: "Ana",
      primerApellido: "Perez",
      segundoApellido: undefined,
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

  it("CierreDiaService sin cablear tampoco emite", async () => {
    // FEATURE 271 (R18): la re-solicitud elige por EDAD. `findCierreParaAviso` recibe el id del
    // cierre que se acaba de tocar (R56, cierra M9).
    const repo = {
      findCierreResolicitableMasViejo: vi
        .fn()
        .mockResolvedValue({ id: "c-1", estado: "vencido" }),
      transicionarASolicitado: vi.fn().mockResolvedValue(true),
      findCierreParaAviso: vi
        .fn()
        .mockResolvedValue({ id: "c-1", destinoZonaId: null, mensajeroNombre: null }),
    };
    const service = new CierreDiaService(
      repo as never,
      { findCentralZonaId: vi.fn() } as never,
      { findUsuarioZonaId: vi.fn(), findBloqueoDetalle: vi.fn() } as never,
      { createSignedUrls: vi.fn() } as never,
      { resolvePagoTarifa: vi.fn() } as never,
    );

    const r = await service.solicitarCierre({
      usuarioId: "men-1",
      rol: "mensajero",
      zonaId: "z-1",
    });

    expect(r).toMatchObject({ status: "ok", via: "resolicitado" });
  });
});

describe("el camino real esta CABLEADO en el composition root, no en el default", () => {
  const leer = (...partes: string[]) => fs.readFileSync(path.join(ROOT, ...partes), "utf8");

  it("lib/actions/postulacion-mensajero.ts inyecta el notificador real", () => {
    expect(leer("lib", "actions", "postulacion-mensajero.ts")).toContain(
      "notificarPostulacionPendienteReal",
    );
  });

  it("lib/actions/cierre-dia.ts inyecta LOS DOS notificadores reales que cablea", () => {
    // ⚠️ AQUI FALTABA EL SEGUNDO. Este fichero cablea DOS avisos —«cierre por aprobar» (146) y
    // «quedaste bloqueado por acumular» (271/R40/R41)— y esta guardia solo miraba el primero. Era
    // el UNICO punto de cableado del arbol sin proteger, y la guardia derivada del final NO lo
    // cubre: aquella pregunta si el SIMBOLO esta vivo en algun sitio, y
    // `notificarMensajeroBloqueadoReal` seguiria vivo por `lib/actions/cierres-admin.ts` aunque
    // esta linea desapareciera. Los SITIOS los fija esta guardia; el SIMBOLO, la derivada.
    //
    // Y se afirma sobre el USO EFECTIVO (sin imports ni comentarios), no sobre el fichero entero.
    // Medido: con un `toContain` a secas, borrar la linea del cableado deja el test EN VERDE,
    // porque el import de arriba sigue conteniendo el nombre. Es exactamente el fallo del cron,
    // reproducido dentro de su propia guardia.
    const uso = fuenteSinImportsNiComentarios(leer("lib", "actions", "cierre-dia.ts"));
    expect(uso).toContain("notificarCierreDiaPorAprobarReal");
    expect(uso).toContain("notificarMensajeroBloqueadoReal");
  });

  it("app/api/ordenes/api-key/carga/route.ts inyecta el notificador real", () => {
    expect(leer("app", "api", "ordenes", "api-key", "carga", "route.ts")).toContain(
      "notificarCargaMasivaTerminadaReal",
    );
  });

  // ⚠️ 2026-08-23 (feature 262, F6) — ESTE CENSO DECIA «TRES» Y EN EL ARBOL HABIA CINCO.
  // La 253 anadio `PostulacionRecursoService` y la 262 anadio `CorreccionDiaRepartoService`, los
  // dos con su notificador best-effort y su default no-op, y NINGUNO entraba aqui: un service
  // que se cablease con el notificador real en su propio constructor —o que se olvidase de
  // cablearlo en el composition root— no habria puesto rojo nada. El censo se AMPLIA, no se
  // relaja: la lista sigue siendo LITERAL por el mismo motivo que la del enum de eventos
  // (`notificacion-productores-wiring.test.ts`), y debajo hay una comprobacion que la contrasta
  // contra el arbol para que un SEXTO service no pueda quedarse fuera en silencio.
  const SERVICES_CON_NOTIFICADOR = [
    "PostulacionMensajeroService.ts",
    "CierreDiaService.ts",
    "BulkOrdenService.ts",
    "PostulacionRecursoService.ts", // feature 253 / D6
    "CorreccionDiaRepartoService.ts", // feature 262 / D7
    // FEATURE 271 (T6.4, R38/R39): el CORTE DIARIO pasa a tener notificador, y hasta hoy NO tenia
    // ninguno —verificado contra produccion: 0 filas en `notificacion` a las 00:03 del 22/08—.
    // Es el que mas avisos va a emitir, y ademas corre en un CRON sin nadie mirando: su default
    // no-op no es comodidad, es lo que impide que una suite escriba en la base compartida.
    "CorteDiarioService.ts", // feature 271 / §9.4
    // FEATURE 271 (T6.6, R42): el RECHAZO de un cierre pasa a avisar al mensajero, asi que
    // `CierresAdminService` entra en el censo. Su default no-op es el que impide que las TRECE
    // suites que lo instancian escriban avisos contra la base local, que en este repo es
    // compartida.
    "CierresAdminService.ts", // feature 271 / R42
    // FICHA 333 (E5, R34): el CRON DE GASTOS FIJOS pasa a tener notificador —«quedan N cobros
    // esperando tu aprobacion»—. Es el segundo aviso del arbol que se dispara SOLO, cada noche y
    // sin nadie mirando, asi que su default no-op no es comodidad: es lo que impide que una suite
    // escriba avisos contra la base local, que en este repo es COMPARTIDA.
    "GeneracionGastosFijosService.ts", // ficha 333 / §4.4
  ] as const;

  it("lib/actions/postulacion-recurso.ts inyecta el notificador real", () => {
    expect(leer("lib", "actions", "postulacion-recurso.ts")).toContain(
      "notificarPostulacionRecursoPendienteReal",
    );
  });

  it("lib/actions/corregir-dia-reparto.ts inyecta el notificador real", () => {
    expect(leer("lib", "actions", "corregir-dia-reparto.ts")).toContain(
      "notificarDiaRepartoCorregidoReal",
    );
  });

  it("app/api/cron/corte-diario/route.ts inyecta el notificador real", () => {
    // ⚠️ ESTA GUARDIA NACE DE UN FALLO REAL, no de la simetria. `buildService()` de esa ruta
    // pasaba CINCO argumentos y el notificador es el SEPTIMO (detras del logger), asi que el
    // corte corria con su no-op: el aviso de «tu cierre del dia vencio» —el que mas se emite y el
    // unico que se dispara solo cada noche— no se habria emitido JAMAS en produccion, y ninguna
    // de las 18.000 pruebas se habria puesto roja. El censo de abajo no lo veia: comprueba que el
    // DEFAULT del service sea el no-op, y eso seguia siendo cierto.
    //
    // Se afirma la LINEA DEL CABLEADO y no solo el import, porque importar sin pasar es
    // exactamente el estado que produjo el fallo.
    const fuente = leer("app", "api", "cron", "corte-diario", "route.ts");
    expect(fuente).toContain("notificarCierreDiaVencidoReal");
    expect(fuente).toMatch(/new CorteDiarioService\([\s\S]*notificarCierreDiaVencidoReal,[\s\S]*\)/);
  });

  it("app/api/cron/generar-gastos-fijos/route.ts inyecta el notificador real", () => {
    // FICHA 333 (E5, R34) — MISMO MOLDE QUE EL DE ARRIBA, Y POR EL MISMO MOTIVO. Este es el otro
    // cron money-critical del arbol: corre a las 00:00 CR, sin nadie delante, y su aviso es el
    // recordatorio diario de que hay dinero esperando autorizacion. Si `buildService()` dejara de
    // pasar el notificador, el service se quedaria con su default NO-OP y el aviso no se emitiria
    // JAMAS, con la suite entera en verde — que es exactamente lo que le paso a `corte-diario`.
    //
    // Se afirma sobre el USO EFECTIVO (fuente sin imports ni comentarios) y no con un `toContain`
    // a secas: medido en este mismo archivo, un `toContain` se satisface con el `import` de
    // arriba, asi que borrar solo el argumento del cableado lo dejaria EN VERDE.
    const fuente = leer("app", "api", "cron", "generar-gastos-fijos", "route.ts");
    const uso = fuenteSinImportsNiComentarios(fuente);
    expect(uso).toContain("notificarGastoFijoCobroPendienteReal");
    expect(uso).toMatch(
      /new GeneracionGastosFijosService\([\s\S]*notificarGastoFijoCobroPendienteReal,?[\s\S]*\)/,
    );
    // Y el `import` tiene que seguir ahi: sin el, lo de arriba no compilaria — pero es el USO lo
    // que se exige, no el import.
    expect(fuente).toContain(
      'import { notificarGastoFijoCobroPendienteReal } from "@/lib/notificaciones/notificadores"',
    );
  });

  it("lib/actions/cierres-admin.ts inyecta el notificador real", () => {
    // FEATURE 271 (T6.6, R42): el aviso del RECHAZO. Sin esta linea el service se construye con
    // su default NO-OP y el rechazo sigue siendo mudo en produccion con toda la suite en verde —
    // exactamente el fallo que este bloque de guardias existe para nombrar.
    expect(leer("lib", "actions", "cierres-admin.ts")).toContain("notificarMensajeroBloqueadoReal");
  });

  // El titulo NO lleva el numero a proposito: decia «los TRES» cuando eran cinco y «los CINCO»
  // cuando ya eran seis. La lista de arriba es la fuente, y el test de debajo la contrasta contra
  // el arbol; un nombre con cuenta atrasada solo hace que el censo parezca mas pequeno de lo que es.
  it("los defaults de TODOS los services del censo son el no-op, no el notificador real", () => {
    for (const servicio of SERVICES_CON_NOTIFICADOR) {
      const fuente = leer("lib", "services", servicio);
      expect(fuente).toMatch(/Notificador = notificadorNoOp/);
      expect(fuente).not.toMatch(/Notificador = notificar\w*Real/);
    }
  });

  it("el censo esta COMPLETO: no hay ningun otro service con notificador por constructor", () => {
    // Contra el ARBOL, no contra la propia lista: es lo unico que convierte «son estos» en una
    // afirmacion que se puede romper. Si manana entra otro service con notificador y nadie lo
    // apunta arriba, este test lo nombra.
    const dir = path.join(ROOT, "lib", "services");
    const conNotificador = fs
      .readdirSync(dir)
      .filter((n) => n.endsWith(".ts"))
      .filter((n) => /Notificador = notificadorNoOp/.test(fs.readFileSync(path.join(dir, n), "utf8")))
      .sort();
    expect(conNotificador).toEqual([...SERVICES_CON_NOTIFICADOR].sort());
  });

  it("ningun modulo de lib/ ni app/ apaga la emision segun el entorno de test", () => {
    const sospechosos: string[] = [];
    const recorrer = (dir: string) => {
      for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
        const completo = path.join(dir, entrada.name);
        if (entrada.isDirectory()) {
          recorrer(completo);
          continue;
        }
        if (!/\.tsx?$/.test(entrada.name)) continue;
        const fuente = fs.readFileSync(completo, "utf8");
        if (/process\.env\.VITEST|NODE_ENV\s*===\s*["']test["']/.test(fuente)) {
          sospechosos.push(completo);
        }
      }
    };
    recorrer(path.join(ROOT, "lib"));
    recorrer(path.join(ROOT, "app"));
    expect(sospechosos).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// LA GUARDIA DERIVADA DEL ARBOL — la que habria cazado los dos muertos del 2026-08-23
// ---------------------------------------------------------------------------
//
// Las guardias de arriba son UNA POR ARCHIVO Y ESCRITAS A MANO, y ese es su defecto: solo protegen
// lo que alguien se acordo de apuntar. El 2026-08-23 se midio el tamano real del agujero: de SIETE
// notificadores reales, DOS no los pasaba nadie —`notificarCierreDiaVencidoReal`, el aviso nocturno
// del corte y el que mas se emite, y `notificarMensajeroBloqueadoReal`—, y los dos tenian su
// entrada del censo en verde, porque el censo comprueba que el DEFAULT del service sea el no-op y
// eso seguia siendo cierto. Un notificador sin composition root esta MUERTO: se despliega, no emite
// nada, y ninguna prueba se pone roja.
//
// Esta guardia no pregunta por una lista: pregunta AL ARBOL. Por cada `notificar*Real` exportado
// exige al menos un fichero de produccion que lo PASE de verdad.
//
// ⚠️ «PASARLO» NO ES «IMPORTARLO», Y ESA DISTINCION ES TODO EL TEST. El fallo del cron se
// reprodujo con una mutacion que dejaba el import intacto y quitaba solo el argumento: una guardia
// que se conforme con el import lo da por vivo. Por eso el simbolo se busca en el fuente CON LAS
// SENTENCIAS DE IMPORT Y LOS COMENTARIOS RETIRADOS — un comentario que lo nombre tampoco cuenta,
// que es como se acaba cableando un aviso en la prosa y no en el codigo.

/** Quita de un fuente TS lo que NO es uso: las sentencias `import` (incluidas las multilinea) y los comentarios. */
function fuenteSinImportsNiComentarios(fuente: string): string {
  const salida: string[] = [];
  let dentroDeImport = false;
  let dentroDeBloque = false;
  for (const linea of fuente.split("\n")) {
    const t = linea.trim();
    if (dentroDeBloque) {
      if (t.includes("*/")) dentroDeBloque = false;
      continue;
    }
    if (t.startsWith("/*")) {
      if (!t.includes("*/")) dentroDeBloque = true;
      continue;
    }
    if (t.startsWith("//") || t.startsWith("*")) continue;
    if (dentroDeImport) {
      // El bloque de import termina en la linea que trae el `from "..."`.
      if (/from\s+["']/.test(t)) dentroDeImport = false;
      continue;
    }
    if (t.startsWith("import ")) {
      if (!/from\s+["']/.test(t)) dentroDeImport = true;
      continue;
    }
    salida.push(linea);
  }
  return salida.join("\n");
}

describe("guardia derivada: ningun notificador REAL puede quedarse sin composition root", () => {
  // Ficheros de PRODUCCION: `lib/` y `app/`, menos el modulo que los define (alli aparecen todos
  // por su propia declaracion). Los tests quedan fuera a proposito: un notificador cableado solo
  // en una suite esta igual de muerto en produccion.
  const ficherosDeProduccion = (): string[] => {
    const encontrados: string[] = [];
    const recorrer = (dir: string) => {
      for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
        const completo = path.join(dir, entrada.name);
        if (entrada.isDirectory()) {
          recorrer(completo);
          continue;
        }
        if (!/\.tsx?$/.test(entrada.name)) continue;
        if (completo.endsWith(path.join("lib", "notificaciones", "notificadores.ts"))) continue;
        encontrados.push(completo);
      }
    };
    recorrer(path.join(ROOT, "lib"));
    recorrer(path.join(ROOT, "app"));
    return encontrados;
  };

  const relativo = (p: string) => path.relative(ROOT, p).split(path.sep).join("/");

  it("cada `notificar*Real` exportado lo PASA algun fichero de lib/ o app/, no solo lo importa", () => {
    const definicion = fs.readFileSync(
      path.join(ROOT, "lib", "notificaciones", "notificadores.ts"),
      "utf8",
    );
    const reales = [...definicion.matchAll(/^export const (notificar\w+Real)\b/gm)].map((m) => m[1]);

    // AUTOCOMPROBACION: si la extraccion se rompe, `reales` queda vacio y el `toEqual([])` de abajo
    // pasaria en verde sin haber comprobado NADA. Este repo ya midio lo que cuesta un test que
    // reporta `passed` sin ejercitar nada. El canario es el notificador que ESTUVO muerto.
    expect(reales.length).toBeGreaterThan(0);
    expect(reales).toContain("notificarCierreDiaVencidoReal");

    const fuentes = ficherosDeProduccion().map((f) => {
      const crudo = fs.readFileSync(f, "utf8");
      return { fichero: relativo(f), crudo, uso: fuenteSinImportsNiComentarios(crudo) };
    });
    expect(fuentes.length).toBeGreaterThan(0); // el recorrido tiene que haber encontrado arbol

    // El diagnostico nombra las DOS cosas que hacen falta para arreglarlo: QUE notificador y, si
    // alguien lo importo sin pasarlo, EN QUE FICHERO quedo a medias.
    const muertos = reales
      .map((notificador) => ({
        notificador,
        cableadoEn: fuentes.filter((f) => f.uso.includes(notificador)).map((f) => f.fichero),
        soloImportadoEn: fuentes
          .filter((f) => f.crudo.includes(notificador) && !f.uso.includes(notificador))
          .map((f) => f.fichero),
      }))
      .filter((d) => d.cableadoEn.length === 0);

    expect(muertos).toEqual([]);
  });
});
