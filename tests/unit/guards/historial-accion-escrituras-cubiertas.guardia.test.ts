import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";

import { codigoSinComentarios } from "../../fixtures/sin-comentarios";
import { HISTORIAL_ACCION_TIPOS } from "@/lib/types/historial-accion";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 362 / T7.1 (R9/R16) — LA GUARDIA QUE SOSTIENE «NO PUEDE HABER UNA SIN LA OTRA».
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// QUE PROTEGE, Y POR QUE NO BASTA CON LEER EL CODIGO. Un registro de auditoria incompleto es un
// MENTIROSO SILENCIOSO: la pantalla enseña 40 filas y el maestro concluye que eso fue todo lo que
// paso. La forma de que se vuelva incompleto no es un fallo ruidoso — es que alguien añada un
// camino de escritura nuevo y no se acuerde de registrarlo, o que mueva el `appendAccion` fuera
// de la transaccion «porque la tx quedaba muy larga».
//
// Ninguna de las dos cosas rompe un test que no exista. Esta guardia es ese test.
//
// LAS TRES COSAS QUE EXIGE, por cada uno de los 44 tipos del catalogo:
//   1. que el metodo declarado como su productor EXISTA y su cuerpo se pueda recortar;
//   2. que ese cuerpo llame a `appendAccion`;
//   3. que la llamada sea ATOMICA con la mutacion, en una de las DOS formas validas:
//      (a) el metodo ABRE una `$transaction` y el `appendAccion` cae DENTRO de su callback; o
//      (b) el metodo RECIBE la `tx` como primer parametro — ahi la atomicidad es del TIPO, no de
//          la disciplina: no puede abrir la suya y no tiene donde escribir fuera.
//
// Y DOS COSAS MAS, que son las que impiden que la guardia mienta:
//   - COBERTURA (R16): todo valor del enum tiene productor en el censo, y todo productor del censo
//     existe en el arbol. Un tipo declarado y nunca escrito convierte el modulo en un mentiroso
//     —precedente literal: el valor `incidente` de `OrdenHistorialOrigenTipo`, declarado sin
//     productor y dicho por escrito—.
//   - CONTRAPRUEBA en las DOS direcciones: el mismo detector, aplicado a un cuerpo MUTADO EN
//     MEMORIA (sin la llamada, y con la llamada fuera del callback), tiene que FALLAR.
//
// La selecciona `pnpm exec vitest run guard` por el nombre del archivo.

const RAIZ = path.resolve(__dirname, "../../..");

/**
 * Como se garantiza la atomicidad en cada punto de escritura.
 *
 * `abre_tx`  — el metodo abre `prisma.$transaction(...)` y el `appendAccion` va DENTRO del
 *              callback. Es la forma de los metodos que antes eran una sentencia suelta.
 * `recibe_tx`— el metodo recibe la transaccion como PRIMER parametro. No puede abrir la suya (el
 *              tipo no lo permite) ni escribir fuera: la atomicidad es estructural.
 */
type FormaDeAtomicidad = "abre_tx" | "recibe_tx";

interface EntradaCenso {
  /** Los tipos del catalogo que ESTE metodo produce. */
  tipos: string[];
  archivo: string;
  metodo: string;
  forma: FormaDeAtomicidad;
  /**
   * La SENTENCIA DE MUTACION que este metodo ejecuta y que el registro documenta. Se comprueba
   * que aparece en el mismo cuerpo: sin esto, la guardia daria por bueno un metodo que registra
   * una accion que no ocurre.
   */
  mutacion: RegExp;
}

/**
 * ⚠️ EL CENSO. Es CERRADO y se mantiene A MANO, y eso es el punto: añadir un tipo al enum sin
 * añadirlo aqui pone esta guardia roja, y añadirlo aqui sin escribirlo de verdad tambien.
 */
const CENSO: EntradaCenso[] = [
  // --- A.1 · mueve dinero ---
  {
    tipos: ["cierre_dia_aprobado", "cierre_dia_rechazado"],
    archivo: "lib/repositories/CierresAdminRepository.ts",
    metodo: "resolverCierre",
    forma: "abre_tx",
    mutacion: /tx\.cierreDia\.updateMany\(/,
  },
  {
    tipos: ["cierre_dia_pagos_editados"],
    archivo: "lib/repositories/CierresAdminRepository.ts",
    metodo: "actualizarPagosGestion",
    forma: "abre_tx",
    mutacion: /tx\.gestionOrden\.updateMany\(/,
  },
  {
    tipos: ["cierre_bodega_aprobado", "cierre_bodega_rechazado"],
    archivo: "lib/repositories/CierresBodegaAdminRepository.ts",
    metodo: "resolverCierreBodega",
    forma: "abre_tx",
    mutacion: /tx\.cierreBodega\.updateMany\(/,
  },
  {
    tipos: ["pago_mensajero_registrado", "pago_tienda_registrado"],
    archivo: "lib/repositories/LiquidacionPagoRepository.ts",
    metodo: "crear",
    forma: "recibe_tx",
    mutacion: /tx\.liquidacionPago\.create\(/,
  },
  {
    tipos: ["pago_anulado"],
    archivo: "lib/repositories/LiquidacionPagoRepository.ts",
    metodo: "anular",
    forma: "recibe_tx",
    mutacion: /tx\.liquidacionAnulacion\.create\(/,
  },
  {
    tipos: ["reparto_mensajero_registrado"],
    archivo: "lib/repositories/LiquidacionRepartoRepository.ts",
    metodo: "crear",
    forma: "recibe_tx",
    mutacion: /tx\.liquidacionReparto\.create\(/,
  },
  {
    // ⚠️ EL UNICO PRODUCTOR SIN MUTACION PROPIA, Y ESTA DECLARADO. La fila del reparto es
    // INMUTABLE (R52 de la 205): deshacerlo es anular sus N pagos hijos, y eso lo hace
    // `LiquidacionPagoRepository.anular` en la MISMA transaccion que este metodo recibe. La
    // «mutacion» que se exige aqui es, por tanto, la lectura del reparto que congela su etiqueta;
    // la atomicidad la da la forma `recibe_tx`, que es la garantia fuerte.
    tipos: ["reparto_anulado"],
    archivo: "lib/repositories/LiquidacionRepartoRepository.ts",
    metodo: "registrarAnulacion",
    forma: "recibe_tx",
    mutacion: /tx\.liquidacionReparto\.findUnique\(/,
  },
  {
    tipos: [
      "wallet_movimiento_manual_registrado",
      "egreso_administrativo_registrado",
      "egreso_administrativo_reversado",
    ],
    archivo: "lib/repositories/WalletMovimientoRepository.ts",
    metodo: "crearMovimientoRegistrado",
    forma: "abre_tx",
    mutacion: /this\.crearMovimientos\(tx,/,
  },
  {
    tipos: ["tarifa_creada"],
    archivo: "lib/repositories/TarifaRepository.ts",
    metodo: "createUnsafe",
    forma: "abre_tx",
    mutacion: /tx\.tarifa\.create\(/,
  },
  {
    tipos: ["tarifa_actualizada"],
    archivo: "lib/repositories/TarifaRepository.ts",
    metodo: "update",
    forma: "abre_tx",
    mutacion: /tx\.tarifa\.updateMany\(/,
  },
  {
    tipos: ["incidente_aprobado", "incidente_rechazado"],
    archivo: "lib/repositories/IncidenteAdminRepository.ts",
    metodo: "resolver",
    forma: "abre_tx",
    mutacion: /tx\.ordenIncidente\.updateMany\(/,
  },
  {
    tipos: ["cobro_gasto_fijo_aprobado", "cobro_gasto_fijo_rechazado"],
    archivo: "lib/repositories/GastoFijoCobroRepository.ts",
    metodo: "marcarDecidido",
    forma: "recibe_tx",
    mutacion: /tx\.gastoFijoCobro\.updateMany\(/,
  },
  {
    tipos: ["cobro_rechazo_tienda_aprobado", "cobro_rechazo_tienda_rechazado"],
    archivo: "lib/repositories/RechazoTiendaCobroRepository.ts",
    metodo: "marcarDecidido",
    forma: "recibe_tx",
    mutacion: /tx\.rechazoTiendaCobro\.updateMany\(/,
  },
  {
    // Mismo caso declarado que `reparto_anulado`: el snapshot del ranking es historia congelada y
    // no se reescribe. La mutacion que este registro documenta —el devengo y su egreso de caja—
    // la hace `PremioRankingDevengoService` en la MISMA transaccion que aqui se recibe.
    tipos: ["premio_ranking_registrado", "premio_ranking_anulado"],
    archivo: "lib/repositories/RankingSnapshotRepository.ts",
    metodo: "registrarAccionSobreFila",
    forma: "recibe_tx",
    mutacion: /tx\.rankingSnapshotFila\.findUnique\(/,
  },
  {
    // ⭑ Q1, aprobada por el humano el 2026-09-02.
    tipos: ["orden_ubicacion_corregida"],
    archivo: "lib/repositories/OrdenRepository.ts",
    metodo: "corregirDatosCliente",
    forma: "abre_tx",
    mutacion: /tx\.orden\.updateMany\(/,
  },
  {
    // ⭑ FICHA 366 — la re-derivacion de la zona de las ordenes elegibles al guardar una zona.
    // Comparte metodo con el resto del guardado (`update`), y por eso su `appendAccion` va dentro
    // de la MISMA `$transaction` que ya reemplazaba la N:M y las tarifas.
    tipos: ["orden_zona_reconciliada"],
    archivo: "lib/repositories/ZonaRepository.ts",
    metodo: "update",
    forma: "abre_tx",
    mutacion: /tx\.orden\.updateMany\(/,
  },
  {
    // ⭑ Q2 (`usuario_fulfillment_cambiado`) comparte punto de escritura con el rol y la zona: es
    // el MISMO formulario, y las N filas salen con el MISMO `lote_id`.
    tipos: ["usuario_rol_cambiado", "usuario_zona_cambiada", "usuario_fulfillment_cambiado"],
    archivo: "lib/repositories/UserRepository.ts",
    metodo: "update",
    forma: "abre_tx",
    mutacion: /tx\.usuario\.updateMany\(/,
  },

  // --- A.2 · hace desaparecer algo ---
  {
    // ⭑ FICHA 371 — la correccion de la fecha de una reprogramacion. La mutacion que se exige es
    // la ESCRITURA CRUDA de la fecha: `UPDATE "gestion_orden" … RETURNING`, que es lo que permite
    // registrar lo ALCANZADO en vez de lo PEDIDO (una carrera perdida devuelve 0 filas y no deja
    // NI UNA fila de rastro). Si alguien la devolviera a un `updateMany`, esta linea se pone roja.
    tipos: ["gestion_fecha_reprogramacion_corregida"],
    archivo: "lib/repositories/CorreccionFechaReprogramacionRepository.ts",
    metodo: "corregirFecha",
    forma: "abre_tx",
    mutacion: /UPDATE "gestion_orden"[\s\S]*RETURNING/,
  },
  {
    tipos: ["orden_eliminada"],
    archivo: "lib/repositories/OrdenRepository.ts",
    metodo: "softDelete",
    forma: "abre_tx",
    // ⚠️ `UPDATE … RETURNING` y NO `updateMany`: es lo que permite registrar lo ALCANZADO en vez
    // de lo PEDIDO (R12). Si alguien lo devolviera a `updateMany`, esta linea se pone roja.
    mutacion: /UPDATE "orden"[\s\S]*RETURNING/,
  },
  {
    tipos: ["orden_eliminada"],
    archivo: "lib/repositories/OrdenRepository.ts",
    metodo: "softDeleteViaApi",
    forma: "abre_tx",
    mutacion: /UPDATE "orden"[\s\S]*RETURNING/,
  },
  {
    tipos: ["orden_recuperada"],
    archivo: "lib/repositories/OrdenRepository.ts",
    metodo: "restore",
    forma: "abre_tx",
    mutacion: /UPDATE "orden"[\s\S]*RETURNING/,
  },
  {
    tipos: ["tarifa_borrada"],
    archivo: "lib/repositories/TarifaRepository.ts",
    metodo: "hardDelete",
    forma: "abre_tx",
    mutacion: /tx\.tarifa\.delete\(/,
  },
  {
    tipos: ["zona_borrada"],
    archivo: "lib/repositories/ZonaRepository.ts",
    metodo: "hardDelete",
    forma: "abre_tx",
    mutacion: /tx\.zona\.delete\(/,
  },
  {
    tipos: ["vehiculo_borrado"],
    archivo: "lib/repositories/VehiculoRepository.ts",
    metodo: "delete",
    forma: "abre_tx",
    mutacion: /tx\.vehiculo\.deleteMany\(/,
  },
  {
    tipos: ["plantilla_eliminada"],
    archivo: "lib/repositories/PlantillaMensajeRepository.ts",
    metodo: "softDelete",
    forma: "abre_tx",
    mutacion: /tx\.plantillaMensaje\.updateMany\(/,
  },

  // --- A.3 · cambia quien puede hacer que ---
  {
    tipos: ["usuario_creado"],
    archivo: "lib/repositories/UserRepository.ts",
    metodo: "create",
    forma: "abre_tx",
    mutacion: /tx\.usuario\.create\(/,
  },
  {
    tipos: ["usuario_estado_cambiado"],
    archivo: "lib/repositories/UserRepository.ts",
    metodo: "setEstado",
    forma: "abre_tx",
    mutacion: /tx\.usuario\.updateMany\(/,
  },
  {
    tipos: ["usuario_contrasena_restablecida"],
    archivo: "lib/repositories/UserRepository.ts",
    metodo: "restablecerContrasena",
    forma: "abre_tx",
    mutacion: /tx\.usuario\.update\(/,
  },
  {
    tipos: ["postulacion_aprobada", "postulacion_rechazada"],
    archivo: "lib/repositories/AprobacionPostulacionRepository.ts",
    metodo: "actualizarEstadoSiPendiente",
    forma: "abre_tx",
    mutacion: /tx\.usuario\.updateMany\(/,
  },
  {
    tipos: ["api_key_generada"],
    archivo: "lib/repositories/ApiKeyRepository.ts",
    metodo: "createConUsuario",
    forma: "abre_tx",
    mutacion: /tx\.apiKey\.create\(/,
  },
  {
    tipos: ["api_key_rotada"],
    archivo: "lib/repositories/ApiKeyRepository.ts",
    metodo: "rotar",
    forma: "abre_tx",
    mutacion: /tx\.apiKey\.update\(/,
  },
  {
    tipos: ["api_key_activada", "api_key_desactivada"],
    archivo: "lib/repositories/ApiKeyRepository.ts",
    metodo: "setEstado",
    forma: "abre_tx",
    mutacion: /tx\.apiKey\.update\(/,
  },
];

// ---------------------------------------------------------------------------------------------
// El recortador — tecnica de `corregir-datos-sin-rastro.guardia.test.ts`
// ---------------------------------------------------------------------------------------------

/** El bloque `{ … }` que empieza en `desde`, cerrado por llaves balanceadas. `null` si no cierra. */
function bloqueBalanceado(codigo: string, desde: number): string | null {
  const abre = codigo.indexOf("{", desde);
  if (abre === -1) return null;
  let profundidad = 0;
  for (let i = abre; i < codigo.length; i++) {
    if (codigo[i] === "{") profundidad++;
    else if (codigo[i] === "}") {
      profundidad--;
      if (profundidad === 0) return codigo.slice(abre, i + 1);
    }
  }
  return null;
}

/**
 * El cuerpo REAL de `<metodo>` en `<archivo>`, recortado por llaves balanceadas. LANZA si el
 * metodo no esta: una guardia estatica rota no falla, CALLA, y ese es el modo de fallo que este
 * archivo existe para cerrar.
 */
function cuerpoDelMetodo(archivo: string, metodo: string): string {
  const codigo = codigoSinComentarios(archivo);
  const declaracion = new RegExp(`(?:^|\\n)\\s*(?:private\\s+)?async\\s+${metodo}\\s*\\(`);
  const encontrado = declaracion.exec(codigo);
  if (encontrado === null) {
    throw new Error(
      `no se encontro \`async ${metodo}(\` en ${archivo}: o se renombro o se borro, y esta ` +
        "guardia estaria midiendo la nada",
    );
  }
  // El `{` del cuerpo es el primero DESPUES del `)` que cierra la lista de parametros; se busca
  // desde el final de la firma para no confundirlo con un `{` de un tipo del parametro.
  const cierreFirma = codigo.indexOf(")", encontrado.index + encontrado[0].length);
  const cuerpo = bloqueBalanceado(codigo, cierreFirma);
  if (cuerpo === null) {
    throw new Error(`el cuerpo de \`${metodo}\` en ${archivo} no cierra: el recortador esta roto`);
  }
  return cuerpo;
}

/** El bloque del callback de `$transaction(...)` dentro de `cuerpo`. `null` si no hay ninguno. */
function bloqueDeTransaccion(cuerpo: string): string | null {
  const inicio = cuerpo.indexOf("$transaction(");
  if (inicio === -1) return null;
  return bloqueBalanceado(cuerpo, inicio);
}

/**
 * EL DETECTOR, en una sola funcion, para que la contraprueba pueda ejercerlo sobre un cuerpo
 * MUTADO EN MEMORIA y no solo sobre el archivo real.
 *
 * Devuelve la lista de fallos; vacia = el punto de escritura cumple.
 */
export function fallosDelPuntoDeEscritura(
  cuerpo: string,
  forma: FormaDeAtomicidad,
  mutacion: RegExp,
): string[] {
  const fallos: string[] = [];
  const iAppend = cuerpo.indexOf("appendAccion");
  if (iAppend === -1) fallos.push("no llama a `appendAccion`");
  if (!mutacion.test(cuerpo)) fallos.push("no contiene su sentencia de mutacion");

  if (forma === "abre_tx") {
    const bloque = bloqueDeTransaccion(cuerpo);
    if (bloque === null) fallos.push("no abre ninguna `$transaction`");
    else if (iAppend !== -1) {
      const iBloque = cuerpo.indexOf(bloque);
      const dentro = iAppend > iBloque && iAppend < iBloque + bloque.length;
      if (!dentro) fallos.push("el `appendAccion` cae FUERA del callback de `$transaction`");
    }
  } else {
    // `recibe_tx`: la primera cosa que el metodo hace con el registro es usar EL `tx` que le
    // dieron. Que el primer parametro se llame `tx` no lo garantiza por si solo —lo garantiza el
    // TIPO, que no admite `$transaction`—, pero si alguien renombrara el parametro este chequeo
    // obligaria a pasar por aqui y a mirar el tipo.
    if (!/appendAccion\(\s*tx\b/.test(cuerpo)) {
      fallos.push("no pasa a `appendAccion` la `tx` que recibio");
    }
  }
  return fallos;
}

// ---------------------------------------------------------------------------------------------
// 0 — El detector, probado contra respuestas conocidas (en las DOS direcciones)
// ---------------------------------------------------------------------------------------------

describe("362/T7.1 — el detector se prueba a si mismo", () => {
  const CUERPO_SANO = `{
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.usuario.updateMany({ where: { id }, data: { estado } });
      if (count === 0) return null;
      await appendAccion(tx, [{ accion: "usuario_estado_cambiado" }]);
      return count;
    });
  }`;
  const MUTACION = /tx\.usuario\.updateMany\(/;

  it("CONTRAPRUEBA: un cuerpo correcto NO produce fallos", () => {
    // Control positivo. Sin el, todos los `toEqual([])` de abajo podrian estar pasando porque el
    // detector no sabe encontrar nada.
    expect(fallosDelPuntoDeEscritura(CUERPO_SANO, "abre_tx", MUTACION)).toEqual([]);
  });

  it("CONTRAPRUEBA (1/3): QUITAR el `appendAccion` se detecta", () => {
    const mutado = CUERPO_SANO.replace(/await appendAccion\([\s\S]*?\]\);/, "");
    expect(fallosDelPuntoDeEscritura(mutado, "abre_tx", MUTACION)).toContain(
      "no llama a `appendAccion`",
    );
  });

  it("CONTRAPRUEBA (2/3): SACARLO FUERA del callback de `$transaction` se detecta", () => {
    // Es la mutacion que el design nombra: «mover el registro a una llamada posterior fuera de la
    // transaccion». El resultado compila, pasa los tests de comportamiento y deja el sistema
    // capaz de borrar sin registrar.
    const mutado = `{
      await this.prisma.$transaction(async (tx) => {
        await tx.usuario.updateMany({ where: { id }, data: { estado } });
      });
      await appendAccion(this.prisma, [{ accion: "usuario_estado_cambiado" }]);
    }`;
    expect(fallosDelPuntoDeEscritura(mutado, "abre_tx", MUTACION)).toContain(
      "el `appendAccion` cae FUERA del callback de `$transaction`",
    );
  });

  it("CONTRAPRUEBA (3/3): quitar la sentencia de MUTACION se detecta", () => {
    // Un metodo que registra una accion que no ocurre es tan mentiroso como uno que no registra.
    const mutado = CUERPO_SANO.replace("tx.usuario.updateMany", "tx.usuario.findMany");
    expect(fallosDelPuntoDeEscritura(mutado, "abre_tx", MUTACION)).toContain(
      "no contiene su sentencia de mutacion",
    );
  });

  it("CONTRAPRUEBA: en la forma `recibe_tx`, pasar OTRO cliente se detecta", () => {
    const mutado = `{
      await tx.liquidacionPago.create({ data });
      await appendAccion(this.prisma, [{ accion: "pago_anulado" }]);
    }`;
    expect(
      fallosDelPuntoDeEscritura(mutado, "recibe_tx", /tx\.liquidacionPago\.create\(/),
    ).toContain("no pasa a `appendAccion` la `tx` que recibio");
  });

  it("CONTRAPRUEBA: el recortador recorta EL METODO, no el archivo entero", () => {
    const cuerpo = cuerpoDelMetodo("lib/repositories/VehiculoRepository.ts", "delete");
    const archivo = codigoSinComentarios("lib/repositories/VehiculoRepository.ts");
    expect(cuerpo.length).toBeGreaterThan(120);
    expect(cuerpo.length).toBeLessThan(archivo.length);
    expect(cuerpo).toContain("vehiculo.deleteMany");
    // Y NO trae el metodo de al lado.
    expect(cuerpo).not.toContain("contarUsos");
  });

  it("CONTRAPRUEBA: pedir un metodo inexistente LANZA en vez de medir vacio", () => {
    expect(() =>
      cuerpoDelMetodo("lib/repositories/VehiculoRepository.ts", "metodoQueNoExiste"),
    ).toThrow(/no se encontro/);
  });
});

// ---------------------------------------------------------------------------------------------
// 1 — Cobertura del catalogo (R16): ni un tipo sin productor, ni un productor sin archivo
// ---------------------------------------------------------------------------------------------

describe("362/R16 — cada tipo del catalogo tiene al menos un punto de escritura", () => {
  it("los archivos del censo existen todos", () => {
    for (const entrada of CENSO) {
      expect(existsSync(path.join(RAIZ, entrada.archivo)), `falta ${entrada.archivo}`).toBe(true);
    }
    // Anti-vacuidad: el censo no esta vacio ni se quedo a medias.
    expect(CENSO.length).toBeGreaterThan(20);
  });

  it("TODO valor del enum tiene productor declarado, y ninguno sobra", () => {
    const producidos = new Set(CENSO.flatMap((e) => e.tipos));
    const delCatalogo = new Set<string>(HISTORIAL_ACCION_TIPOS);

    const sinProductor = [...delCatalogo].filter((t) => !producidos.has(t)).sort();
    expect(
      sinProductor,
      "un tipo declarado y nunca escrito convierte el modulo en un mentiroso silencioso: la " +
        "pantalla ofrece el filtro y siempre sale vacio",
    ).toEqual([]);

    const inventados = [...producidos].filter((t) => !delCatalogo.has(t)).sort();
    expect(inventados, "el censo nombra un tipo que el catalogo no declara").toEqual([]);
  });

  it("los 44 tipos del Anexo A (+ Q1, Q2, la 366 y la 371) siguen siendo 44", () => {
    // Numero DURO a proposito: añadir un tipo al enum obliga a pasar por aqui, y por tanto a
    // añadirlo al censo y a escribir su productor. Es el mecanismo de R14.
    // 44 desde la ficha 371 (`gestion_fecha_reprogramacion_corregida`).
    expect(HISTORIAL_ACCION_TIPOS).toHaveLength(44);
  });
});

// ---------------------------------------------------------------------------------------------
// 2 — R9: el registro va en la MISMA transaccion que la mutacion
// ---------------------------------------------------------------------------------------------

describe("362/R9 — los 44 tipos se registran DENTRO de la transaccion de su accion", () => {
  it.each(CENSO.map((e) => [`${e.archivo.split("/").pop()}#${e.metodo}`, e] as const))(
    "%s registra su accion en la misma transaccion que la escribe",
    (_nombre, entrada) => {
      const cuerpo = cuerpoDelMetodo(entrada.archivo, entrada.metodo);
      // Anti-vacuidad: el recorte no puede salir vacio ni ser un `{}` .
      expect(cuerpo.trim().length, `${entrada.metodo} se leyo vacio`).toBeGreaterThan(80);

      const fallos = fallosDelPuntoDeEscritura(cuerpo, entrada.forma, entrada.mutacion);
      expect(
        fallos,
        `${entrada.archivo}#${entrada.metodo} (${entrada.tipos.join(", ")}): ` +
          "una accion que se escribe sin su registro deja el modulo mintiendo en silencio",
      ).toEqual([]);
    },
  );
});
