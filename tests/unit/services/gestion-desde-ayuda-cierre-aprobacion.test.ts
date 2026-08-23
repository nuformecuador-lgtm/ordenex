import fs from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { CierreDiaService } from "@/lib/services/CierreDiaService";
import type { ICierreDiaRepository } from "@/lib/interfaces/repositories/ICierreDiaRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { RESULTADOS_DESDE_AYUDA } from "@/lib/types/gestion-desde-ayuda";
import { RESULTADOS_QUE_VUELVEN, vuelveABodega } from "@/lib/types/gestion-retorno";
import { quitarComentarios } from "@/tests/fixtures/sin-comentarios";
import { SIN_BLOQUEO } from "@/lib/utils/bloqueo-cierre";

// 💰 Feature 237 (T6.3-T6.8, R32/R33/R34/R35/R37/R44) — LO QUE PASA ALREDEDOR DEL CIERRE.
//
// Esta suite no trae codigo de produccion nuevo: DEMUESTRA lo que §7 y §8 del diseño afirman, y en
// particular EJERCE la invariante que la ficha daba por sentada (D1/R32) en vez de suponerla.

const MENSAJERO: Actor = { usuarioId: "mensajero-1", rol: "mensajero" };
const RAIZ = path.resolve(__dirname, "../../..");

function fuente(rel: string): string {
  return fs.readFileSync(path.join(RAIZ, rel), "utf8");
}

/* -------------------------------------------------------------------------- */
/* T6.3 / R32 (D1) — LA INVARIANTE: las DOS rutas de re-solicitud                */
/* -------------------------------------------------------------------------- */

/**
 * Doble del repositorio del cierre acotado a lo que `solicitarCierre` toca. Los contadores dicen
 * QUE camino se recorrio, que es justo lo que hay que demostrar.
 */
function repoParaSolicitar(over: {
  vencido?: boolean;
  rechazado?: boolean;
}): ICierreDiaRepository {
  // FEATURE 271 (R18): la re-solicitud ya no elige por ESTADO sino por EDAD, asi que el doble
  // devuelve EL cierre re-solicitable mas viejo en vez de dos booleanos.
  const resolicitable = over.vencido
    ? { id: "c-viejo", estado: "vencido" as const }
    : over.rechazado
      ? { id: "c-viejo", estado: "rechazado" as const }
      : null;
  return {
    findCierreResolicitableMasViejo: vi.fn(async () => resolicitable),
    transicionarASolicitado: vi.fn(async () => true),
    contarOrdenesPendientesGestion: vi.fn(async () => 0),
    findGestionesPendientes: vi.fn(async () => []),
    crearCierre: vi.fn(async () => "c-nuevo"),
  } as unknown as ICierreDiaRepository;
}

function servicioSolicitar(repo: ICierreDiaRepository) {
  const ordenRepo = {
    findUsuarioZonaId: vi.fn(async () => "z1"),
    findEstatusIdByValue: vi.fn(async () => "os-x"),
    findCentralZonaId: vi.fn(async () => "z1"),
    findBloqueoDetalle: vi.fn(async () => SIN_BLOQUEO),
  };
  const service = new CierreDiaService(
    repo,
    ordenRepo as never,
    { createSignedUrls: vi.fn(async () => ({})), createSignedUrl: vi.fn(async () => "") } as never,
    { resolveTarifaPorTienda: vi.fn(async () => null) } as never,
    { emitirCierrePorAprobar: vi.fn(async () => {}) } as never,
  );
  return { service, repo, ordenRepo };
}

describe("💰 R32/D1 — la gestion de la tienda posterior a una RE-SOLICITUD cae en el cierre siguiente", () => {
  it.each([
    {
      ruta: "vencido -> solicitado",
      repo: () => repoParaSolicitar({ vencido: true }),
      via: "resolicitado",
      metodo: "transicionarASolicitado" as const,
    },
    {
      ruta: "rechazado -> solicitado",
      repo: () => repoParaSolicitar({ rechazado: true }),
      via: "resolicitado",
      metodo: "transicionarASolicitado" as const,
    },
  ])(
    "la ruta EXENTA `$ruta` NO consulta pendientes, asi que una orden en ayuda no la bloquea",
    async ({ repo: hacerRepo, via, metodo }) => {
      // ESTE es el hecho que rompe la invariante «una orden en ayuda bloquea el cierre»: es cierta
      // al CREAR un cierre y FALSA en las dos rutas de re-solicitud, exentas por anti-deadlock
      // (111/R9 y 109/R28). Se ejerce, no se supone.
      const repo = hacerRepo();
      const { service } = servicioSolicitar(repo);

      const r = await service.solicitarCierre(MENSAJERO);

      expect(r).toEqual({ status: "ok", via });
      expect(repo[metodo]).toHaveBeenCalledTimes(1);
      // (i) la precondicion de pendientes NI SE CONSULTA: por eso una orden en `ayuda_tienda` no
      //     impide re-solicitar, aunque `ayuda_tienda` este en `ESTADOS_PENDIENTES`.
      expect(repo.contarOrdenesPendientesGestion).not.toHaveBeenCalled();
      // (ii) y NO se crea un cierre nuevo ni se re-vinculan gestiones: la escritura solo cambia
      //      `estado` (money-safe, 111/R8 y 109/R28). El cierre queda `solicitado` con las
      //      gestiones que ya tenia dentro y su snapshot congelado.
      expect(repo.crearCierre).not.toHaveBeenCalled();
      expect(repo.findGestionesPendientes).not.toHaveBeenCalled();
    },
  );

  it("y la consecuencia se lee en el CODIGO: la re-solicitud solo cambia `estado`", () => {
    // La otra mitad de R32 (que la gestion posterior cae en el siguiente cierre y en uno solo) se
    // ejerce sobre el almacen real en `gestion-desde-ayuda-cierre.test.ts`. Aqui se cierra el
    // argumento por su causa: si estas dos escrituras re-vincularan gestiones o re-snapshotearan
    // totales, la gestion de la tienda entraria en un cierre ya congelado — que es exactamente lo
    // que 111/R8 y 109/R28 declaran money-safe con esas palabras.
    // FEATURE 271 (R18): los DOS metodos gemelos se unificaron en `transicionarASolicitado`, que
    // ademas lleva el `id` en el `where` (cierra M2). La propiedad money-safe que este caso vigila
    // NO cambia y por eso el caso sobrevive: la escritura sigue tocando UNICAMENTE `estado`.
    const repoSrc = quitarComentarios(fuente("lib/repositories/CierreDiaRepository.ts"));
    const i = repoSrc.indexOf("async transicionarASolicitado(");
    expect(i, "no se encontro transicionarASolicitado").toBeGreaterThan(-1);
    const cuerpo = repoSrc.slice(i, i + 700);
    expect(cuerpo).toMatch(/data:\s*\{\s*estado:/);
    // Ni una sola escritura sobre gestiones ni sobre totales dentro de esa ruta.
    expect(cuerpo).not.toContain("gestionOrden");
    expect(cuerpo).not.toContain("cierreDetail");
    expect(cuerpo).not.toContain("totalGeneral");
  });

  it("R32: la ruta de CREACION si consulta pendientes — la exencion es de la RE-SOLICITUD", () => {
    // El contraste obligatorio. Si esta afirmacion cayera, la exencion dejaria de ser una
    // excepcion y pasaria a ser la regla, y D1 se habria firmado sobre un hecho falso.
    //
    // FEATURE 271 (R16/R18): las dos rutas exentas son ahora UNA —elige por edad—, asi que el orden
    // que se afirma es «la re-solicitud RETORNA antes de llegar a la precondicion».
    const servicioSrc = quitarComentarios(fuente("lib/services/CierreDiaService.ts"));
    const i = servicioSrc.indexOf("async solicitarCierre(");
    const cuerpo = servicioSrc.slice(i, servicioSrc.indexOf("async deshacerGestion(", i));
    const iResolicitud = cuerpo.indexOf("transicionarASolicitado");
    const iPendientes = cuerpo.indexOf("contarOrdenesPendientesGestion");
    expect(iResolicitud).toBeGreaterThan(-1);
    expect(iPendientes).toBeGreaterThan(iResolicitud);
  });
});

/* -------------------------------------------------------------------------- */
/* T6.4 / R33-R34 — el bloqueo y sus dos exenciones siguen como estaban          */
/* -------------------------------------------------------------------------- */

describe("R33/R34 — esta ficha no cambia el bloqueo del cierre ni sus exenciones", () => {
  it("R33: `ayuda_tienda` sigue en `ESTADOS_PENDIENTES` y sigue bloqueando la CREACION", async () => {
    const servicioSrc = quitarComentarios(fuente("lib/services/CierreDiaService.ts"));
    expect(servicioSrc).toMatch(
      /const ESTADOS_PENDIENTES = \["por_recoger", "en_reparto", "ayuda_tienda"\]/,
    );

    // Y se ejerce: con una orden pendiente, la creacion se rechaza.
    const repo = repoParaSolicitar({});
    (repo.contarOrdenesPendientesGestion as ReturnType<typeof vi.fn>).mockResolvedValue(1);
    const { service } = servicioSolicitar(repo);

    const r = await service.solicitarCierre(MENSAJERO);

    expect(r.status).toBe("conflict");
    expect(repo.crearCierre).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* T6.5 / R35 — el paquete entra en la confirmacion fisica (238)                 */
/* -------------------------------------------------------------------------- */

describe("💰 R35 — el paquete que resolvio la tienda tambien hay que escanearlo (238)", () => {
  it.each(["reprogramada", "rechazada"] as const)(
    "`%s` esta en `RESULTADOS_QUE_VUELVEN`, asi que su paquete entra en la ventana de confirmacion",
    (resultado) => {
      // El punto unico de «que paquete vuelve» (238) filtra por RESULTADO, no por origen ni por
      // actor: los dos desenlaces de la tienda estan dentro sin que esta ficha toque una linea.
      expect(vuelveABodega(resultado)).toBe(true);
      expect(RESULTADOS_QUE_VUELVEN).toContain(resultado);
    },
  );

  it("y el WHERE del conjunto esperado filtra por `cierreId` + `resultado`, sin mirar el origen", () => {
    // Se lee donde vive: el `where` esta en el repositorio y ningun test de servicio lo ve. Si
    // alguien le añadiera `origenTipo` o `actorUsuarioId`, las gestiones de la tienda saldrian de
    // la ventana de confirmacion y un paquete real dejaria de escanearse.
    const src = quitarComentarios(fuente("lib/repositories/CierresAdminRepository.ts"));
    const i = src.indexOf("findGestionesRetornablesDelCierre");
    expect(i).toBeGreaterThan(-1);
    const cuerpo = src.slice(i, i + 900);
    expect(cuerpo).toContain("RESULTADOS_QUE_VUELVEN");
    expect(cuerpo).toContain("cierreId");
    expect(cuerpo).not.toContain("origenTipo");
    expect(cuerpo).not.toContain("actorUsuarioId");
  });

  it("declarado: una gestion de la tienda PUEDE bloquear la aprobacion si el paquete no aparece", () => {
    // Consecuencia buscada de la regla D2 de la 238 («un solo paquete perdido devuelve el cierre
    // entero», sin escapatoria) combinada con esta ficha. Es correcto —el paquete existe y esta en
    // la moto— y se deja escrito antes de que ocurra, en vez de descubrirlo en operacion.
    expect(RESULTADOS_QUE_VUELVEN).toEqual(
      expect.arrayContaining(["reprogramada", "rechazada"]),
    );
  });
});

/* -------------------------------------------------------------------------- */
/* T6.7 / R37 — nada nuevo dentro de la transaccion de aprobacion                */
/* -------------------------------------------------------------------------- */

describe("R37 — esta ficha NO escribe dentro de la transaccion de aprobacion", () => {
  it("ni `CierresAdminRepository` ni `CierresAdminService` nombran la familia nueva", () => {
    // La gestion se escribe en SU PROPIA transaccion, en el instante en que la tienda actua, igual
    // que `reprogramarDesdeDevuelta`. Lo que ocurre al aprobar son consecuencias de una fila que YA
    // existe: los cinco feeds la leen por `cierreId`, como a cualquier otra.
    //
    // Si este censo se pone rojo, alguien metio trabajo de esta ficha dentro de la transaccion mas
    // cara del sistema, y con ello movio el orden de las llamadas que `cierres-admin-caja-cod`
    // mide porque los feeds se leen unos a otros.
    for (const rel of [
      "lib/repositories/CierresAdminRepository.ts",
      "lib/services/CierresAdminService.ts",
    ]) {
      expect(quitarComentarios(fuente(rel))).not.toContain("gestion_tienda_ayuda");
    }
  });

  it("💰 el ANCLAJE (239) NUNCA alcanza una gestion de esta familia: solo mira `resultado: devuelta`", () => {
    // Y desde ayuda NO se puede devolver (R1: los desenlaces son dos, y `devuelta` no esta). El
    // bloque de anclaje es, por tanto, inalcanzable para esta ficha — no por casualidad, sino por
    // la interseccion de dos conjuntos cerrados que se comprueba aqui.
    const src = quitarComentarios(fuente("lib/repositories/CierresAdminRepository.ts"));
    const i = src.indexOf("if (anclajeDevolucion)");
    expect(i).toBeGreaterThan(-1);
    const bloque = src.slice(i, i + 600);
    expect(bloque).toMatch(/resultado:\s*"devuelta"/);

    // La otra mitad: `devuelta` no es un desenlace posible desde ayuda. Se lee del CENSO REAL del
    // borde, no de una copia local — una copia local haria este caso verde para siempre.
    expect([...RESULTADOS_DESDE_AYUDA] as string[]).not.toContain("devuelta");
  });
});

/* -------------------------------------------------------------------------- */
/* T6.8 / R44 (D4) — el aviso de rechazo NO se emite, y es DECISION              */
/* -------------------------------------------------------------------------- */

describe("R44/D4 — el rechazo de la tienda NO emite «orden rechazada por el destinatario»", () => {
  it("el emisor filtra por `origen_tipo === 'gestion'`, y la familia nueva no lo es", () => {
    // El hecho tecnico que lo hace facil de creer: la ausencia sale sola porque el filtro es una
    // IGUALDAD. Pero eso es una coincidencia, no una garantia — el dia que alguien convierta esa
    // igualdad en un `in` «para cubrir mas casos», el aviso empezaria a salir. Por eso lleva test.
    const src = quitarComentarios(fuente("lib/notificaciones/emitir.ts"));
    expect(src).toMatch(/const ORIGEN_RECHAZO_DEL_DESTINATARIO = "gestion";/);
    expect(src).toMatch(/e\.origenTipo === ORIGEN_RECHAZO_DEL_DESTINATARIO/);
    // NO es un `in` ni un `includes`: si lo fuera, la familia nueva podria colarse.
    expect(src).not.toMatch(/ORIGEN_RECHAZO_DEL_DESTINATARIO\.includes/);
    expect(src).not.toContain("gestion_tienda_ayuda\",");
  });

  it("la AUSENCIA esta escrita como decision en el propio archivo, con su porque", () => {
    // Este repo tiene escrito lo que cuesta un dato que miente con formato de dato: el texto dice
    // «rechazada POR EL DESTINATARIO» y aqui rechazo la TIENDA, sobre un paquete que el
    // destinatario no llego a ver. Sin la nota, el proximo que lea el filtro lo ensancha creyendo
    // que arregla un olvido.
    const crudo = fuente("lib/notificaciones/emitir.ts");
    expect(crudo).toContain("gestion_tienda_ayuda");
    expect(crudo).toMatch(/D4/);
    expect(crudo).toMatch(/A PROPOSITO/);
  });
});

/* -------------------------------------------------------------------------- */
/* R43/R46 — a los integradores les llega EL MISMO evento                        */
/* -------------------------------------------------------------------------- */

describe("R43/R46 — el evento publico es el mismo, y la familia nueva no se exceptua", () => {
  it("`gestion_tienda_ayuda` NO esta en `ORIGENES_SIN_EVENTO_PUBLICO`", async () => {
    // El rescate de la 235 SI esta exceptuado (para que ningun integrador reciba `en_reparto` dos
    // veces). Esta familia NO: el integrador tiene que enterarse de que la orden quedo rechazada o
    // reprogramada, exactamente igual que si la hubiera resuelto el mensajero.
    const { ORIGENES_SIN_EVENTO_PUBLICO } = await import("@/lib/types/webhook-eventos");
    expect([...ORIGENES_SIN_EVENTO_PUBLICO]).not.toContain("gestion_tienda_ayuda");
  });

  it("R43: y el vocabulario publico NO gana ningun valor por causa de esta ficha", async () => {
    // `rechazada` y `reprogramada` ya estaban. Esta ficha no añade ningun estado, asi que ninguna
    // superficie exhaustiva de estados cambia.
    const { EVENTOS_PUBLICOS } = await import("@/lib/types/webhook-eventos");
    expect([...EVENTOS_PUBLICOS] as string[]).toContain("rechazada");
    expect([...EVENTOS_PUBLICOS] as string[]).toContain("reprogramada");
  });
});
