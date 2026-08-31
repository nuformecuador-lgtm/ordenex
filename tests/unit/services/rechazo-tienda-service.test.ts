import { describe, it, expect, vi } from "vitest";
import { RechazoTiendaService } from "@/lib/services/RechazoTiendaService";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import {
  SinGestionDevueltaError,
  type IGestionOrdenRepository,
} from "@/lib/interfaces/repositories/IGestionOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { OrdenDTO } from "@/lib/types/orden";
import type {
  ITarifaVigenteRepository,
  TarifaVigenteResuelta,
} from "@/lib/interfaces/repositories/ITarifaVigenteRepository";
import type {
  CrearCobroRechazoTiendaInput,
  IRechazoTiendaCobroRepository,
} from "@/lib/interfaces/repositories/IRechazoTiendaCobroRepository";
import { clavePar } from "@/lib/utils/cascada-tarifa";

// 💰 Feature 240 (T3.1) — regla del RECHAZO MANUAL por la tienda. Molde:
// `reprogramacion-tienda-service.test.ts` (100), su hermana de esta misma card.
//
// Cubre R1 (el adminTienda dueño rechaza), R2 (otra tienda / otro rol -> forbidden SIN revelar el
// estado), R3 (fuera de la devolucion anclada -> conflict sin llamar al repo; carrera perdida ->
// conflict), R12 (el motivo llega al repo tal cual), R25 (no se exige que el plazo haya vencido),
// `config_error` y `not_found`.
//
// ⚠️ LO QUE ESTE ARCHIVO NO PUEDE PROBAR, dicho aqui para que nadie lo de por cubierto: el `where`
// del `updateMany`. Este nivel usa un DOBLE del repositorio, asi que borrar la guarda de estado deja
// todos estos casos en verde — esta medido cuatro veces en este repo. Esa mutacion la mata
// `tests/unit/repositories/gestion-orden-rechazar.test.ts` y SOLO el.

const TIENDA: Actor = { usuarioId: "store-1", rol: "adminTienda" };
const OTRA_TIENDA: Actor = { usuarioId: "store-2", rol: "adminTienda" };
const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };
const MENSAJERO: Actor = { usuarioId: "msj-1", rol: "mensajero" };
const SATELITE: Actor = { usuarioId: "sat-1", rol: "adminSatelite" };

const MOTIVO = "el cliente ya compro en otro lado, no reintentar";

/** OrdenDTO de una orden en la DEVOLUCION ANCLADA (`devuelta`, 239) de la tienda store-1. */
function ordenDTO(overrides: Partial<OrdenDTO> = {}): OrdenDTO {
  return {
    id: "o1",
    numGuia: 10,
    numRemision: "REM-1",
    estatusId: "os-devuelta",
    estatusValue: "devuelta",
    destinatario: "Ana",
    telefonoDest: "0991234567",
    tiendaId: "store-1",
    zonaId: "z1",
    provinciaId: "p1",
    cantonId: "c1",
    distritoId: null,
    producto: "Caja",
    peso: 1.5,
    notas: null,
    mensajeroAsignadoId: "msj-9",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

type OrdenRepoDoble = Pick<
  IOrdenRepository,
  "findById" | "findEstatusIdByValue" | "findBaseCobroDevolucion"
>;
type GestionRepoDoble = Pick<IGestionOrdenRepository, "rechazarDesdeDevuelta">;
type TarifaRepoDoble = Pick<ITarifaVigenteRepository, "resolveTarifas">;
type CobroRepoDoble = Pick<IRechazoTiendaCobroRepository, "crearPendiente">;

const ESTATUS: Record<string, string> = { devuelta: "os-devuelta", rechazada: "os-rechazada" };

/** Reloj FIJO. El `generado_el` del cobro no puede depender de cuando corra la suite. */
const AHORA = new Date("2026-08-31T15:00:00.000Z"); // 09:00 en Costa Rica -> dia CR 2026-08-31
const DIA_CR = "2026-08-31";

const PAR = { tiendaId: "store-1", zonaId: "z1" };

/**
 * FICHA 337 — la tarifa que resuelve para el par de la orden de estos casos. Los numeros estan
 * elegidos para que NO sean intercambiables: 500,00 de devolucion no-GAM contra 400,00 GAM, y un
 * IVA del 13 % que da 65,00 / 52,00. Si el service leyera la columna equivocada, el test lo dice.
 */
function tarifaResuelta(overrides: Partial<TarifaVigenteResuelta> = {}): TarifaVigenteResuelta {
  return {
    tarifaId: "tar-1",
    valorFlete: "1000.00",
    valorFleteGam: "900.00",
    valorFleteDevuelto: "500.00",
    valorFleteDevueltoGam: "400.00",
    comisionCod: "3.50",
    ivaFlete: "13.00",
    ivaComisionCod: "13.00",
    tarifaEspecial: null,
    tarifaEspecialDevuelta: null,
    fulfillment: "0.00",
    ...overrides,
  };
}

function buildOrdenRepo(overrides: Partial<OrdenRepoDoble> = {}): OrdenRepoDoble {
  return {
    findById: vi.fn(async () => ordenDTO()),
    findEstatusIdByValue: vi.fn(async (v: string) => ESTATUS[v] ?? null),
    // FICHA 337: las entradas de la formula, tal como estan en el instante del rechazo.
    findBaseCobroDevolucion: vi.fn(async () => ({
      ordenId: "o1",
      tiendaId: "store-1",
      zonaId: "z1",
      esCentral: false,
      esZonaEspecial: false,
      montoCobrar: "25000.00",
      cobraComision: true,
    })),
    ...overrides,
  };
}

function buildGestionRepo(overrides: Partial<GestionRepoDoble> = {}): GestionRepoDoble {
  return {
    // ⭑ EL DOBLE EJECUTA EL HOOK, y no es un detalle: si se limitara a devolver `true`, el alta
    // del cobro no se ejercitaria NUNCA desde este nivel y la suite quedaria verde con el
    // cableado roto. El repositorio real lo invoca dentro de su transaccion con la gestion ya
    // creada; aqui se imita eso con un `tx` de mentira y un id fijo.
    rechazarDesdeDevuelta: vi.fn(async (input) => {
      if (input.trasCrearGestion) {
        await input.trasCrearGestion(TX_FALSO, "gest-nueva");
      }
      return true;
    }),
    ...overrides,
  };
}

/** El `tx` que el repositorio real presta al hook. Aqui no se usa: el doble del cobro lo ignora. */
const TX_FALSO = {} as Parameters<
  NonNullable<Parameters<IGestionOrdenRepository["rechazarDesdeDevuelta"]>[0]["trasCrearGestion"]>
>[0];

function buildTarifaRepo(overrides: Partial<TarifaRepoDoble> = {}): TarifaRepoDoble {
  return {
    resolveTarifas: vi.fn(async () => new Map([[clavePar(PAR), tarifaResuelta()]])),
    ...overrides,
  };
}

function buildCobroRepo(overrides: Partial<CobroRepoDoble> = {}): CobroRepoDoble {
  return {
    crearPendiente: vi.fn(async () => 1),
    ...overrides,
  };
}

function build(
  ordenOverrides: Partial<OrdenRepoDoble> = {},
  gestionOverrides: Partial<GestionRepoDoble> = {},
  tarifaOverrides: Partial<TarifaRepoDoble> = {},
  cobroOverrides: Partial<CobroRepoDoble> = {},
) {
  const ordenRepo = buildOrdenRepo(ordenOverrides);
  const gestionRepo = buildGestionRepo(gestionOverrides);
  const tarifaRepo = buildTarifaRepo(tarifaOverrides);
  const cobroRepo = buildCobroRepo(cobroOverrides);
  return {
    ordenRepo,
    gestionRepo,
    tarifaRepo,
    cobroRepo,
    service: new RechazoTiendaService(
      ordenRepo,
      gestionRepo,
      tarifaRepo,
      cobroRepo,
      () => AHORA,
    ),
  };
}

/** El input con el que el service da de alta el cobro, leido del doble. */
function cobroCreado(cobroRepo: CobroRepoDoble): CrearCobroRechazoTiendaInput {
  const mock = cobroRepo.crearPendiente as ReturnType<typeof vi.fn>;
  return mock.mock.calls[0][1] as CrearCobroRechazoTiendaInput;
}

/* -------------------------------------------------------------------------- */
/* 1. El camino feliz                                                           */
/* -------------------------------------------------------------------------- */

describe("RechazoTiendaService — el adminTienda dueño rechaza (R1/R12)", () => {
  it("R1: una orden en la devolucion anclada pasa a `rechazada`", async () => {
    const { service, gestionRepo } = build();

    await expect(service.rechazar("o1", MOTIVO, TIENDA)).resolves.toEqual({ status: "ok" });
    expect(gestionRepo.rechazarDesdeDevuelta).toHaveBeenCalledTimes(1);
  });

  it("R11/R12: delega con los dos estatus del catalogo, el motivo y la TIENDA como actor", async () => {
    const { service, gestionRepo } = build();

    await service.rechazar("o1", MOTIVO, TIENDA);

    // `toEqual` y no `toMatchObject`: la afirmacion incluye que NO se manda nada mas. En
    // particular, ningun `mensajeroId` — quien lo deriva es el repositorio, dentro de la
    // transaccion y de la ultima `devuelta` vigente (R9). Si el service lo mandara, seria una
    // segunda fuente de verdad sobre a QUE CIERRE va a parar el cobro.
    expect(gestionRepo.rechazarDesdeDevuelta).toHaveBeenCalledWith({
      ordenId: "o1",
      estatusDevueltaId: "os-devuelta", // la GUARDA (R4), no solo el destino
      estatusRechazadaId: "os-rechazada",
      motivo: MOTIVO, // R12: llega tal cual, sin recortes ni defaults
      actorUsuarioId: "store-1", // R11: la persona de la tienda que decidio
      // ⏳ FICHA 337: la clave SEXTA. Este literal ES EL CONTRATO -- afirma que no se manda nada
      // mas-- asi que se EXTIENDE, no se relaja a `toMatchObject`. Que el hook sea una funcion es
      // lo que hace que el cobro entre en la transaccion del rechazo; si alguien lo dejara de
      // pasar, aqui llegaria `undefined` y este caso caeria.
      trasCrearGestion: expect.any(Function),
    });
  });

  it("R25/D9: NO se exige que el plazo de la devolucion haya vencido", async () => {
    // El plazo (99/239) existe para que el sistema decida CUANDO NADIE DECIDE. Exigirlo dejaria a
    // la tienda con un boton que falla las primeras 23 horas de cada 24, y la obligaria a
    // descubrir el limite pulsandolo.
    //
    // La ausencia se afirma por CONSTRUCCION: el service solo consulta dos metodos del repo de
    // ordenes, y ninguno tiene que ver con el reloj. Si alguien añadiera una lectura del anclaje o
    // de la ventana, este censo se pondria rojo.
    const { service, ordenRepo } = build();

    await expect(service.rechazar("o1", MOTIVO, TIENDA)).resolves.toEqual({ status: "ok" });
    // FICHA 337: el censo gana `findBaseCobroDevolucion` -- las entradas de la formula del cobro--
    // y sigue SIN nada que huela a reloj, anclaje o ventana de plazo, que es lo que este caso
    // afirma. Se extiende la lista literal en vez de relajarla: es el contrato.
    expect(Object.keys(ordenRepo).sort()).toEqual([
      "findBaseCobroDevolucion",
      "findById",
      "findEstatusIdByValue",
    ]);
    // Y el `findById` es UNO: no hay una segunda lectura escondida del historial de anclaje.
    expect(ordenRepo.findById).toHaveBeenCalledTimes(1);
  });

  it("R14: el service no toca mensajero, prioridad ni montos — solo delega", async () => {
    // Las tres cosas que R14 prohibe mover no aparecen en el input del repo, y ese input es TODO
    // lo que este service puede decir sobre la escritura.
    const { service, gestionRepo } = build();
    await service.rechazar("o1", MOTIVO, TIENDA);

    const arg = (gestionRepo.rechazarDesdeDevuelta as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg).not.toHaveProperty("mensajeroAsignadoId");
    expect(arg).not.toHaveProperty("prioridad");
    expect(arg).not.toHaveProperty("montoCobrar");
    expect(arg).not.toHaveProperty("cobroRechazado");
  });
});

/* -------------------------------------------------------------------------- */
/* 2. Autorizacion: R2                                                          */
/* -------------------------------------------------------------------------- */

describe("RechazoTiendaService — autorizacion por tienda dueña (R2)", () => {
  it("otra TIENDA -> forbidden, sin efectos", async () => {
    const { service, gestionRepo } = build();

    await expect(service.rechazar("o1", MOTIVO, OTRA_TIENDA)).resolves.toEqual({
      status: "forbidden",
    });
    expect(gestionRepo.rechazarDesdeDevuelta).not.toHaveBeenCalled();
  });

  it.each([
    ["maestro", MAESTRO],
    ["mensajero", MENSAJERO],
    ["adminSatelite", SATELITE],
  ])("rol %s -> forbidden, sin efectos", async (_nombre, actor) => {
    const { service, gestionRepo } = build();

    await expect(service.rechazar("o1", MOTIVO, actor)).resolves.toEqual({ status: "forbidden" });
    expect(gestionRepo.rechazarDesdeDevuelta).not.toHaveBeenCalled();
  });

  it("R2: `forbidden` NO revela el estado de la orden, y es el MISMO valor para las dos causas", async () => {
    // ⭑ El caso que impide usar este borde como oraculo de ordenes ajenas. Una orden de OTRA tienda
    // que ademas esta en otro estado devuelve `forbidden` a secas: ni `conflict` (que diria «existe
    // y no esta en devuelta») ni `not_found` (que diria «no existe»). La guardia de autz va ANTES
    // de mirar el estatus, y por eso los dos casos son indistinguibles desde fuera.
    const { service } = build({
      findById: vi.fn(async () => ordenDTO({ tiendaId: "store-2", estatusValue: "entregada" })),
    });

    const r = await service.rechazar("o1", MOTIVO, TIENDA);
    expect(r).toEqual({ status: "forbidden" });
    expect(JSON.stringify(r)).not.toContain("entregada");
    expect(JSON.stringify(r)).not.toContain("devuelta");
  });
});

/* -------------------------------------------------------------------------- */
/* 3. Las ramas sin efectos                                                     */
/* -------------------------------------------------------------------------- */

describe("RechazoTiendaService — las ramas que NO escriben (R3)", () => {
  it("orden inexistente o borrada -> not_found", async () => {
    const { service, gestionRepo } = build({ findById: vi.fn(async () => null) });

    await expect(service.rechazar("o1", MOTIVO, TIENDA)).resolves.toEqual({ status: "not_found" });
    expect(gestionRepo.rechazarDesdeDevuelta).not.toHaveBeenCalled();
  });

  it.each(["en_reparto", "rechazada", "reprogramada", "ayuda_tienda", "devolucion_por_confirmar"])(
    "R3: una orden en `%s` -> conflict SIN llamar al repositorio",
    async (estatusValue) => {
      // La lista incluye `devolucion_por_confirmar` a proposito: es el PRE-estado de la 239, la
      // devolucion que la bodega todavia no confirmo. Rechazar ahi seria cerrar como devuelto un
      // paquete que nadie ha visto llegar.
      const { service, gestionRepo } = build({
        findById: vi.fn(async () => ordenDTO({ estatusValue })),
      });

      const r = await service.rechazar("o1", MOTIVO, TIENDA);
      expect(r.status).toBe("conflict");
      expect(gestionRepo.rechazarDesdeDevuelta).not.toHaveBeenCalled();
    },
  );

  it("R31: la carrera perdida (el repo devuelve false) -> conflict, y NO dice que rechazo", async () => {
    // El cron de la 99 escalo la orden entre la lectura optimista del service y el `updateMany`.
    // La pantalla tiene que poder decir QUE PASO sin afirmar que rechazo (R31), asi que el estado
    // de dominio no puede ser `ok`.
    const { service } = build({}, { rechazarDesdeDevuelta: vi.fn(async () => false) });

    const r = await service.rechazar("o1", MOTIVO, TIENDA);
    expect(r.status).toBe("conflict");
    expect(r).not.toEqual({ status: "ok" });
  });

  // -------------------------------------------------------------------------------------------
  // R10 (2026-08-20) — LA ORDEN SIN GESTION `devuelta` VIGENTE **SALE CON TEXTO**, NO EN SILENCIO.
  //
  // Nace de un recorrido real: el leader puso una orden en `devuelta` a mano, sin gestion, pulso
  // «Rechazar» con el motivo escrito y **no paso absolutamente nada**. El servidor lanzaba
  // `[AppError:INTERNAL]` y el borde remataba con «AppErrorCode inesperado INTERNAL»; la pantalla
  // no sabia pintar ninguno de los dos. Un boton mudo — el defecto que esta ficha vino a cerrar,
  // una capa mas abajo.
  //
  // ⚠️ El estado NO es alcanzable hoy y se midio antes de tocar nada: en produccion, 11 ordenes han
  // pasado por `devuelta` y **las 11 tienen su gestion**, ni una anulada. Por eso NO se inventa un
  // camino de recuperacion ni se deriva el mensajero de otra parte: el `throw` del repo se queda
  // como fallo CERRADO. Lo unico que cambia es COMO SALE.
  // -------------------------------------------------------------------------------------------
  it("R10: sin gestion `devuelta` vigente -> `sin_gestion_origen`, no una excepcion", async () => {
    const { service } = build(
      {},
      {
        rechazarDesdeDevuelta: vi.fn(async () => {
          throw new SinGestionDevueltaError("rechazarDesdeDevuelta");
        }),
      },
    );

    // ⭑ LA MUTACION QUE ESTE CASO MATA: devolver el `throw` a la superficie. Si alguien quita el
    // `catch` del service, esta promesa REJECTA en vez de resolver y el caso cae aqui.
    await expect(service.rechazar("o1", MOTIVO, TIENDA)).resolves.toEqual({
      status: "sin_gestion_origen",
    });
  });

  it("R10: y NO se disfraza de `conflict` — el texto de la carrera perdida seria FALSO", async () => {
    // La pantalla pinta un texto FIJO para `conflict` («esta orden ya no estaba en devolucion») y
    // descarta el `motivo`. Aqui la orden SI sigue en devolucion: lo que falta es su gestion. Un
    // `conflict` le ensenaria a la tienda algo que no es cierto, que es la clase de dato que este
    // repo persigue. Por eso es un estado propio, y este caso lo fija.
    const { service } = build(
      {},
      {
        rechazarDesdeDevuelta: vi.fn(async () => {
          throw new SinGestionDevueltaError("rechazarDesdeDevuelta");
        }),
      },
    );

    const r = await service.rechazar("o1", MOTIVO, TIENDA);
    expect(r.status).not.toBe("conflict");
    expect(r.status).not.toBe("ok");
  });

  it("una caida de base NO se captura: sigue subiendo como excepcion", async () => {
    // El contraste obligatorio. Si el `catch` fuera a ciegas, un fallo de infraestructura pasaria
    // por desenlace de negocio y la tienda leeria «le falta el registro de su devolucion» sobre una
    // base caida: un diagnostico inventado. Solo se captura la clase, y todo lo demas sube.
    const { service } = build(
      {},
      {
        rechazarDesdeDevuelta: vi.fn(async () => {
          throw new Error("db down");
        }),
      },
    );

    await expect(service.rechazar("o1", MOTIVO, TIENDA)).rejects.toThrow("db down");
  });

  it.each(["devuelta", "rechazada"])(
    "catalogo sin `%s` -> config_error (fallo CERRADO), sin escribir",
    async (faltante) => {
      // Sin el id de `devuelta` no hay guarda que poner en el `where`, y escribir sin guarda es
      // exactamente lo que R4 prohibe. Sin el de `rechazada` no hay destino. En los dos casos se
      // falla cerrado, nunca «escribo igual y ya veremos».
      const { service, gestionRepo } = build({
        findEstatusIdByValue: vi.fn(async (v: string) => (v === faltante ? null : ESTATUS[v])),
      });

      await expect(service.rechazar("o1", MOTIVO, TIENDA)).resolves.toEqual({
        status: "config_error",
      });
      expect(gestionRepo.rechazarDesdeDevuelta).not.toHaveBeenCalled();
    },
  );
});

/* -------------------------------------------------------------------------- */
/* 4. FICHA 337 (segunda mitad) — EL COBRO PENDIENTE CONTRA LA TIENDA          */
/* -------------------------------------------------------------------------- */

describe("💰 337 — el rechazo da de alta un COBRO PENDIENTE contra la tienda", () => {
  it("⭑ el cobro nace DENTRO de la transaccion del rechazo, con la gestion recien creada", async () => {
    // La atomicidad no se afirma con un comentario: se afirma viendo que el alta llega por el
    // HOOK que el repositorio invoca con el `gestionId`, y no por una llamada suelta del service
    // despues de que el rechazo haya confirmado. Si alguien moviera el alta fuera de la
    // transaccion, `crearPendiente` se llamaria con otro `gestionId` (o sin el) y este caso cae.
    const { service, cobroRepo } = build();

    await expect(service.rechazar("o1", MOTIVO, TIENDA)).resolves.toEqual({ status: "ok" });

    expect(cobroRepo.crearPendiente).toHaveBeenCalledTimes(1);
    expect(cobroCreado(cobroRepo).gestionId).toBe("gest-nueva");
  });

  it("⭑ el importe es el que produce `derivarIngresoOrden`, NO uno calculado aqui", async () => {
    // Tarifa no-GAM: flete devuelto 500,00 e IVA del 13 % -> 65,00. Los numeros del fixture estan
    // elegidos para que la columna GAM (400,00 / 52,00) de OTRA cosa: si el service leyera la
    // columna equivocada, o si alguien reimplementara la multiplicacion, aqui se ve.
    const { service, cobroRepo } = build();

    await service.rechazar("o1", MOTIVO, TIENDA);

    // `toEqual` del objeto ENTERO: es el contrato de lo que se congela, incluidas las ausencias.
    expect(cobroCreado(cobroRepo)).toEqual({
      gestionId: "gest-nueva",
      ordenId: "o1",
      tiendaId: "store-1", // CONGELADA: a quien se le cobra
      montoFlete: "500.00", // STRING escala 2, nunca number
      montoIva: "65.00",
      tarifaId: "tar-1", // auditoria: de que fila salio
      generadoEl: DIA_CR, // dia CALENDARIO de Costa Rica, del reloj inyectado
    });
  });

  it("⭑ una orden en zona GAM cobra la columna GAM (400,00 + 52,00)", async () => {
    // El contraste del caso anterior. `esCentral` es la unica diferencia y cambia los DOS importes.
    const { service, cobroRepo } = build({
      findBaseCobroDevolucion: vi.fn(async () => ({
        ordenId: "o1",
        tiendaId: "store-1",
        zonaId: "z1",
        esCentral: true,
        esZonaEspecial: false,
        montoCobrar: "25000.00",
        cobraComision: true,
      })),
    });

    await service.rechazar("o1", MOTIVO, TIENDA);

    expect(cobroCreado(cobroRepo).montoFlete).toBe("400.00");
    expect(cobroCreado(cobroRepo).montoIva).toBe("52.00");
  });

  it("⭑ el PACTO ESPECIAL del distrito manda sobre la columna normal", async () => {
    // `tarifa_especial_devuelta` es una entrada de la formula desde el 2026-08-25. Si el service
    // no pasara `esZonaEspecial`, el pacto no se aplicaria y se cobrarian 500,00 en vez de 300,00.
    const { service, cobroRepo } = build(
      {
        findBaseCobroDevolucion: vi.fn(async () => ({
          ordenId: "o1",
          tiendaId: "store-1",
          zonaId: "z1",
          esCentral: false,
          esZonaEspecial: true,
          montoCobrar: null,
          cobraComision: false,
        })),
      },
      {},
      {
        resolveTarifas: vi.fn(
          async () =>
            new Map([[clavePar(PAR), tarifaResuelta({ tarifaEspecialDevuelta: "300.00" })]]),
        ),
      },
    );

    await service.rechazar("o1", MOTIVO, TIENDA);

    expect(cobroCreado(cobroRepo).montoFlete).toBe("300.00");
    expect(cobroCreado(cobroRepo).montoIva).toBe("39.00"); // 13 % de 300,00
  });

  it("⭑ SIN tarifa vigente: NO se cobra, pero el rechazo SIGUE adelante", async () => {
    // El «gap seguro» de R9 de la feature 42, aplicado aqui: sin tarifa no hay importe que
    // congelar. La direccion segura del error es no cobrar —un cobro fantasma contra una tienda
    // es peor que uno que no se emitio— y sobre todo NO bloquear a la tienda.
    const { service, cobroRepo, gestionRepo } = build(
      {},
      {},
      { resolveTarifas: vi.fn(async () => new Map([[clavePar(PAR), null]])) },
    );

    await expect(service.rechazar("o1", MOTIVO, TIENDA)).resolves.toEqual({ status: "ok" });

    expect(cobroRepo.crearPendiente).not.toHaveBeenCalled();
    // Y el hook NO viaja: el repositorio se comporta exactamente como antes de esta ficha.
    const arg = (gestionRepo.rechazarDesdeDevuelta as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.trasCrearGestion).toBeUndefined();
  });

  it("⭑ flete de devolucion en 0,00: NO se cobra (R10 de la 42), y el rechazo sigue", async () => {
    // Un cobro de cero no es un cobro. Es la misma regla por la que `agregarIngresosPorConcepto`
    // OMITE los conceptos en 0.00, y ademas el CHECK `rechazo_tienda_cobro_montos_validos` lo
    // rechazaria en la base.
    const { service, cobroRepo } = build(
      {},
      {},
      {
        resolveTarifas: vi.fn(
          async () =>
            new Map([
              [
                clavePar(PAR),
                tarifaResuelta({ valorFleteDevuelto: "0.00", valorFleteDevueltoGam: "0.00" }),
              ],
            ]),
        ),
      },
    );

    await expect(service.rechazar("o1", MOTIVO, TIENDA)).resolves.toEqual({ status: "ok" });
    expect(cobroRepo.crearPendiente).not.toHaveBeenCalled();
  });

  it("⭑ IVA del 0 %: el cobro SI nace, con el IVA en cero", async () => {
    // El contraste del caso anterior, y la razon de que el CHECK sea `monto_flete > 0 AND
    // monto_iva >= 0` y no `> 0` en las dos columnas: el cero del IVA es un valor REAL.
    const { service, cobroRepo } = build(
      {},
      {},
      {
        resolveTarifas: vi.fn(
          async () => new Map([[clavePar(PAR), tarifaResuelta({ ivaFlete: "0.00" })]]),
        ),
      },
    );

    await service.rechazar("o1", MOTIVO, TIENDA);

    expect(cobroCreado(cobroRepo).montoFlete).toBe("500.00");
    expect(cobroCreado(cobroRepo).montoIva).toBe("0.00");
  });

  it("⭑ la carrera perdida NO deja cobro: el hook solo corre si la gestion se creo", async () => {
    // El repositorio real no invoca el hook cuando su `updateMany` guardado afecta cero filas.
    // Aqui se imita con un doble que devuelve `false` sin ejecutarlo. Un cobro sin rechazo seria
    // dinero contra una tienda por algo que no paso.
    const { service, cobroRepo } = build({}, { rechazarDesdeDevuelta: vi.fn(async () => false) });

    const r = await service.rechazar("o1", MOTIVO, TIENDA);

    expect(r.status).toBe("conflict");
    expect(cobroRepo.crearPendiente).not.toHaveBeenCalled();
  });

  it("⭑ si el alta del cobro LANZA, la excepcion sube y el rechazo entero revierte", async () => {
    // La atomicidad, vista desde arriba: el hook corre dentro de la transaccion del repositorio,
    // asi que un fallo suyo tiene que ABORTARLA. Si el service se lo tragara —un `try/catch`
    // «para no molestar a la tienda»— quedaria un rechazo que no se cobra nunca y en silencio,
    // que es exactamente el fallo mudo que esta ficha vino a cerrar.
    const { service } = build(
      {},
      {},
      {},
      {
        crearPendiente: vi.fn(async () => {
          throw new Error("unique constraint");
        }),
      },
    );

    await expect(service.rechazar("o1", MOTIVO, TIENDA)).rejects.toThrow("unique constraint");
  });

  it("la tarifa se resuelve por el par (tienda, zona) de la orden, no por la tienda sola", async () => {
    // La cascada de la feature 274 es sobre el PAR. Pedirla solo por tienda devolveria la fila de
    // otro nivel y se cobraria una tarifa que no es la de esa zona.
    const { service, tarifaRepo } = build();

    await service.rechazar("o1", MOTIVO, TIENDA);

    expect(tarifaRepo.resolveTarifas).toHaveBeenCalledWith([{ tiendaId: "store-1", zonaId: "z1" }]);
  });
});
