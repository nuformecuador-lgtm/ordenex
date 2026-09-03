import type {
  CorregirDatosClienteData,
  DistritoResueltoRow,
  IOrdenRepository,
  OrdenParaCorreccionRow,
} from "@/lib/interfaces/repositories/IOrdenRepository";
import type { ITarifaVigenteRepository } from "@/lib/interfaces/repositories/ITarifaVigenteRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  AvisoCambioUbicacion,
  CorregirDatosClienteInput,
  CorregirDatosClienteServiceResult,
  ICorregirDatosClienteService,
  ObtenerUbicacionServiceResult,
  UbicacionConCostos,
} from "@/lib/interfaces/services/ICorregirDatosClienteService";
import {
  CAMPOS_CORREGIBLES,
  CAMPOS_GEOGRAFIA,
  CAMPOS_UBICACION,
  ESTADOS_SIN_CORRECCION,
  rolAdmiteCorreccion,
  type CampoCorregible,
} from "@/lib/types/correccion-datos-cliente";
import { costosListadoOrden } from "@/lib/utils/ingreso-ordenex";
import { normalizarTelefonoWa } from "@/lib/utils/whatsapp-telefono";

// FICHA 312, AMPLIADA POR LA 327 — logica de negocio de LA CORRECCION DE LOS DATOS DEL CLIENTE Y
// DE SU UBICACION. No conoce HTTP, no conoce Prisma y no conoce Next: se instancia entero con
// dobles en los tests.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ 2026-09-02 — D4 DE LA 312 QUEDA REABIERTA. APROBACION HUMANA EXPLICITA, Y POR LA PUERTA.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Aqui decia «SIN RASTRO» y avisaba de que cambiarlo «REABRE D4 y va a la puerta de aprobacion
// humana — no se resuelve por la puerta de atras con solo un logcito».
//
// QUIEN Y CUANDO LO AUTORIZO: el humano dueño del producto, el 2026-09-02, al cerrar la pregunta
// Q1 de la ficha 362 («¿se reabre esa decision para registrar aqui un `orden_ubicacion_corregida`,
// solo el hecho?»). La respuesta fue SI. La puerta se cruzo por delante: hubo pregunta escrita en
// `specs/362-historial-de-acciones/requirements.md`, hubo respuesta, y hay ficha.
//
// QUE CAMBIA, EXACTAMENTE: cuando la UBICACION cambia (direccion, provincia, canton o distrito),
// `corregirDatosCliente` escribe UNA fila en `historial_accion` con la accion
// `orden_ubicacion_corregida`. Esa fila lleva QUIEN y CUANDO, el id de la orden y su GUIA como
// etiqueta. NADA MAS.
//
// QUE NO CAMBIA, Y ES LA MITAD QUE IMPORTA:
//   - NI la direccion vieja NI la nueva, NI el distrito, NI la provincia, NI el canton, NI la
//     zona, NI el destinatario, NI el telefono, NI el producto, NI las notas entran en ese
//     registro. `valor_anterior` y `valor_nuevo` van NULL a proposito;
//   - corregir el NOMBRE o el TELEFONO del destinatario sigue SIN dejar rastro: no mueve dinero;
//   - este servicio sigue sin publicar nota, sin escribir `orden_historial_estado`, sin llamar a
//     ninguna escritura del modulo de chat y sin un solo `console.`.
//
// POR QUE SE REABRIO: la 327 amplio esta correccion a la direccion y al DISTRITO; el distrito
// re-deriva la zona y la zona decide la tarifa facturada. O sea, hasta hoy se podia cambiar lo que
// una orden va a cobrar sin dejar quien ni cuando. El motivo de D4 era proteger datos de una
// persona, y esta fila no guarda ninguno.
//
// LA GUARDIA NO SE BURLO: `tests/unit/guards/corregir-datos-sin-rastro.guardia.test.ts` se
// ACTUALIZO para afirmar la regla NUEVA —el rastro existe, es exactamente uno, y no lleva ni un
// dato de cliente— en vez de la vieja.
//
// ⚠️ LO QUE LA 327 AÑADE Y NO EXISTIA: ESTA CORRECCION MUEVE DINERO. La zona decide la tarifa, y
// la zona se deriva del distrito. Por eso, cuando el distrito cambia, el servidor NO escribe a la
// primera: devuelve `confirmacion_requerida` con los importes de las dos ubicaciones y espera una
// segunda peticion confirmada (R11). El gate vive AQUI, en el servidor, y no en la pantalla,
// precisamente para que no dependa de que la pantalla lo pinte.

/**
 * Lo que el servicio consume del repositorio de ordenes, por `Pick` de la interfaz (patron
 * `EliminarOrdenService`).
 *
 * POR QUE `findParaCorreccion` Y YA NO `findById`. `OrdenDTO` no lleva `direccion`, ni
 * `montoCobrar`, ni `cobraComision`, y los tres son entradas del aviso del importe (327/R12). La
 * lectura nueva conserva el `deletedAt: null` en su `WHERE`, asi que una orden BORRADA sigue
 * saliendo como `null` igual que una INEXISTENTE — esa confusion no es un efecto lateral, es
 * exactamente el resultado opaco que pide R30, y sale gratis en vez de tener que construirse.
 */
export type CorregirDatosClienteRepo = Pick<
  IOrdenRepository,
  "findParaCorreccion" | "findDistritoParaCorreccion" | "corregirDatosCliente"
>;

/**
 * La tarifa del aviso. Se pide por `Pick` de la interfaz y NO se instancia aqui: el composition
 * root la PASA. Un servicio que recibe `undefined` compila igual y muere en produccion.
 */
export type CorregirDatosClienteTarifas = Pick<ITarifaVigenteRepository, "resolveTarifa">;

/**
 * Los campos de texto obligatorio: la orden no puede quedarse sin ellos (312/design §10).
 *
 * `direccion` entra con la 327 y por el mismo motivo (R8). Y entra AQUI, y no como un `.trim()` en
 * el schema, para que «vacio» tenga UNA sola definicion para los cuatro: el `min(1)` del borde
 * caza la cadena vacia y este barrido caza la de solo espacios, igual para todos.
 */
const CAMPOS_NO_VACIABLES = ["destinatario", "telefonoDest", "producto", "direccion"] as const;

/**
 * Valores normalizados de una orden, en la forma en que se comparan y se guardan. Es
 * `CorregirDatosClienteData` MENOS `zonaId`: la zona no se recibe, se deriva (R5).
 */
type ValoresNormalizados = Omit<CorregirDatosClienteData, "zonaId">;

/**
 * 312/§10 — LA NORMALIZACION, que es la MISMA que aplica la carga masiva y por eso se escribe una
 * vez y se usa para comparar Y para guardar. Si se normalizara solo al guardar, R10 compararia
 * peras con manzanas: un `" Ana "` contra un `"Ana"` almacenado contaria como cambio y escribiria
 * una fila identica.
 *
 * `telefonoDest` se recorta Y SE GUARDA TAL CUAL (312/R17, T1 del 2026-08-28): la carga guarda
 * texto recortado, NO E.164 («una orden de Costa Rica guardada en formato LOCAL, que es como las
 * carga el negocio», `ChatConversacionRepository`). Canonizar solo desde esta superficie dejaria
 * la columna con dos formatos segun por donde entro el dato.
 *
 * `notas`: `""` -> `null`, copia literal de `BulkOrdenService` («notas vacia es ausencia»).
 *
 * `direccion` SE RECORTA, que es EXACTAMENTE el tratamiento de la carga masiva
 * (`BulkOrdenService:83`, `(raw.direccion ?? "").trim()`) — 327/R8. Lo que aqui NO puede pasar es
 * acabar en `null` como alli: la direccion vacia se rechaza antes de llegar a la columna.
 *
 * Los tres ids de geografia y el peso NO se normalizan: son un uuid de catalogo y un numero.
 * Fingir una normalizacion sobre ellos solo escondería un valor mal formado.
 */
function normalizar(input: CorregirDatosClienteInput): ValoresNormalizados {
  const salida: ValoresNormalizados = {};
  if (input.destinatario !== undefined) salida.destinatario = input.destinatario.trim();
  if (input.telefonoDest !== undefined) salida.telefonoDest = input.telefonoDest.trim();
  if (input.producto !== undefined) salida.producto = input.producto.trim();
  if (input.notas !== undefined) {
    const recortada = input.notas === null ? null : input.notas.trim();
    salida.notas = recortada === "" ? null : recortada;
  }
  if (input.direccion !== undefined) salida.direccion = input.direccion.trim();
  if (input.provinciaId !== undefined) salida.provinciaId = input.provinciaId;
  if (input.cantonId !== undefined) salida.cantonId = input.cantonId;
  if (input.distritoId !== undefined) salida.distritoId = input.distritoId;
  if (input.peso !== undefined) salida.peso = input.peso;
  return salida;
}

/** El valor almacenado de un campo corregible, en la forma en que se compara con el normalizado. */
function almacenado(orden: OrdenParaCorreccionRow, campo: CampoCorregible): string | number | null {
  return orden[campo];
}

export class CorregirDatosClienteService implements ICorregirDatosClienteService {
  constructor(
    private readonly repo: CorregirDatosClienteRepo,
    private readonly tarifas: CorregirDatosClienteTarifas,
  ) {}

  /**
   * LA PUERTA, EN UN SOLO SITIO (R18/R27/R28). La escritura y la precarga la cruzan llamando a
   * ESTE metodo, no repitiendo la secuencia: dos copias de «rol -> orden -> pertenencia ->
   * ventana» son dos puertas que un dia se abren distinto, y la que se abriera de mas convertiria
   * el modal en un oraculo de que ordenes existen.
   *
   * `null` = denegado, SIEMPRE por el mismo camino y sin decir por cual de los cuatro motivos
   * (R30).
   */
  private async autorizar(ordenId: string, actor: Actor): Promise<OrdenParaCorreccionRow | null> {
    // 1. ROL, ANTES de tocar dato alguno (312/R10). `mensajero`, `adminSatelite` y `apiKey` no
    //    llegan ni a consultar la orden: un `forbidden` que cueste una consulta es un oraculo de
    //    existencia para quien lo cronometre.
    if (actor.rol !== "maestro" && actor.rol !== "admin" && actor.rol !== "adminTienda") {
      return null;
    }

    // 2. Carga de la orden. Una sola consulta, y `null` cubre a la vez «no existe» y «esta
    //    borrada» (R30): el mismo objeto opaco para los dos casos.
    const orden = await this.repo.findParaCorreccion(ordenId);
    if (orden === null) return null;

    // 3. PERTENENCIA (312/R9). Sale del ACTOR, jamas del input (R28): el mismo mecanismo que
    //    `autorizarSobreHilo` (227/R9), del que NO se reusa la funcion porque aquella exige
    //    `esRolConHilo` y rechazaria a `maestro`/`admin`, que son el caso principal de esta ficha.
    //
    //    ⚠️ P2, RESUELTA POR EL HUMANO EL 2026-08-28: el `adminTienda` SI puede corregir la
    //    ubicacion de SUS ordenes, aunque eso mueva su propio flete. Es el mismo nivel de
    //    confianza que ya tiene para cargar ordenes y declarar su monto a cobrar: no gana la
    //    capacidad de mover dinero, gana la de arreglar un dato. Y no puede hacerlo sin verlo —
    //    el aviso de R11 se le exige igual que a `maestro`.
    if (actor.rol === "adminTienda" && orden.tiendaId !== actor.usuarioId) return null;

    // 4. VENTANA POR ROL (312/R8-R11, 327/R27), leida del modulo puro que la pantalla tambien
    //    consulta. `estatusValue` ausente -> `false`: fallo cerrado.
    if (!rolAdmiteCorreccion(actor.rol, orden.estatusValue)) return null;

    return orden;
  }

  async corregir(
    input: CorregirDatosClienteInput,
    actor: Actor,
  ): Promise<CorregirDatosClienteServiceResult> {
    const orden = await this.autorizar(input.ordenId, actor);
    if (orden === null) return { status: "forbidden" };

    // 5. Normalizacion y DIFF (312/R4, 327/R10). Se compara con el valor ALMACENADO tras la MISMA
    //    normalizacion que se aplicaria al guardar.
    const valores = normalizar(input);
    const cambios: CampoCorregible[] = [];
    for (const campo of CAMPOS_CORREGIBLES) {
      const nuevo = valores[campo];
      if (nuevo === undefined) continue;
      if (nuevo === almacenado(orden, campo)) continue; // ya era eso: no es un cambio
      cambios.push(campo);
    }

    // 5.a. NADA QUE CAMBIAR (R10): se termina SIN escribir. No es un error y no gasta una
    //      escritura —que ademas moveria el `updated_at`, el unico rastro que esta ficha deja—.
    //      Va ANTES de resolver el distrito: si nada cambia, tampoco hay geografia que validar.
    if (cambios.length === 0) return { status: "ok", cambios: [] };

    // 5.b. Los rechazos de VALOR, y solo sobre lo que efectivamente cambia.
    const fieldErrors: Record<string, string[]> = {};
    for (const campo of CAMPOS_NO_VACIABLES) {
      // Un texto de solo espacios pasa el `min(1)` del schema y se convierte en vacio al
      // recortarlo. La carga masiva no admite esos campos vacios y la correccion tampoco
      // (312/design §10, 327/R8): dejar la orden sin destinatario —o sin direccion— no es
      // corregirla.
      if (cambios.includes(campo) && valores[campo] === "") {
        fieldErrors[campo] = ["No puede quedar vacio"];
      }
    }
    // 312/R18 — la validacion de UTILIDAD del telefono, que es cosa distinta de guardarlo
    // canonizado. Si al normalizarlo con la normalizacion de WhatsApp del sistema no queda ningun
    // digito utilizable, el numero no puede casar ningun entrante ni recibir ningun saliente (el
    // job de bienvenida ya lanza en ese caso). Se rechaza y NO se guarda.
    const telefono = valores.telefonoDest;
    if (
      cambios.includes("telefonoDest") &&
      telefono !== undefined &&
      normalizarTelefonoWa(telefono) === ""
    ) {
      fieldErrors.telefonoDest = ["Numero de telefono no utilizable"];
    }
    // 327/R9 — el peso, por si llega por un camino que no paso por el schema del borde. La
    // segunda puerta no puede DEPENDER de la primera (R28).
    if (cambios.includes("peso") && !(typeof valores.peso === "number" && valores.peso > 0)) {
      fieldErrors.peso = ["El peso tiene que ser mayor que cero"];
    }
    if (Object.keys(fieldErrors).length > 0) return { status: "validation_error", fieldErrors };

    // 6. LA GEOGRAFIA (327/R3, R5, R6, R7). Solo si alguno de los tres cambia: una correccion que
    //    no toca la ubicacion no paga una consulta de catalogo.
    const data: CorregirDatosClienteData = this.proyectar(valores, cambios);
    let distritoPropuesto: DistritoResueltoRow | null = null;

    if (CAMPOS_GEOGRAFIA.some((campo) => cambios.includes(campo))) {
      const { provinciaId, cantonId, distritoId } = valores;
      // R3, revalidado en el servidor. El schema del borde ya lo exige, pero la segunda puerta no
      // puede DEPENDER de la primera (R28): sin los tres no hay cadena que comprobar.
      if (provinciaId === undefined || cantonId === undefined || distritoId === undefined) {
        return this.rechazoDeUbicacion("Indica provincia, canton y distrito juntos");
      }
      const distrito = await this.repo.findDistritoParaCorreccion(distritoId);
      if (distrito === null) {
        return this.rechazoDeUbicacion("El distrito indicado no existe");
      }
      // R6 — LA CADENA, en sus dos eslabones. Sin esto la fila puede quedar con un canton que no
      // pertenece a su provincia: nada rompe, y las lecturas por jerarquia dejan de encontrarla.
      if (distrito.cantonId !== cantonId || distrito.provinciaId !== provinciaId) {
        return this.rechazoDeUbicacion(
          "El distrito no pertenece al canton y la provincia elegidos",
        );
      }
      // R7 — la zona se deriva del distrito, y solo si resuelve EXACTAMENTE una. Con 0 o con >1 se
      // rechaza NOMBRANDO el motivo: `orden.zona_id` es NOT NULL y elegir una de varias seria
      // inventar la tarifa.
      if (distrito.zonaId === null) {
        return this.rechazoDeUbicacion(
          "Ese distrito no tiene una zona unica asignada: hay que configurarla antes de mover la orden ahi",
        );
      }
      // R5 — LA ZONA LA ESCRIBE EL SERVIDOR. Nunca sale del input: el schema del borde ni siquiera
      // la admite.
      data.zonaId = distrito.zonaId;
      distritoPropuesto = distrito;
    }

    // 7. EL GATE DEL DINERO (R11/R15). Se dispara con el cambio de DISTRITO —no de zona—: la marca
    //    `zona_especial` es del distrito, asi que cambiar de distrito dentro de la MISMA zona
    //    tambien puede mover el flete. Fail-closed: sin `confirmaCambioDeUbicacion === true` no se
    //    escribe NADA y se devuelve el aviso con las dos columnas de importes.
    if (
      distritoPropuesto !== null &&
      distritoPropuesto.zonaId !== null &&
      cambios.includes("distritoId") &&
      input.confirmaCambioDeUbicacion !== true
    ) {
      return {
        status: "confirmacion_requerida",
        aviso: await this.componerAviso(orden, distritoPropuesto, distritoPropuesto.zonaId),
      };
    }

    // 8. ESCRITURA. Una sola sentencia guardada por la ventana (312/R13, 327/R29). La ventana que
    //    viaja es la de 312/D3 —la que bloquea los cuatro estados terminales—: la restriccion
    //    EXTRA del `adminTienda` (solo los grupos de `/novedades`) ya se comprobo en `autorizar` y
    //    no se puede expresar como lista de bloqueados sin enumerar el complemento del catalogo
    //    entero.
    // ⭑ 362 / Q1 — EL RASTRO, decidido AQUI porque este es el unico sitio que tiene el diff
    // contra los valores almacenados. `CAMPOS_GEOGRAFIA` (direccion + los tres ids) es la MISMA
    // lista que decide arriba si hay que revalidar la cadena geografica: no nace una segunda
    // definicion de «cambio de ubicacion» que pueda divergir de la primera.
    //
    // Lo que viaja al repositorio es un BOOLEANO, no los valores: el repositorio no puede
    // escribir la direccion en el registro porque nunca la recibe para eso.
    const ubicacionCorregida = CAMPOS_UBICACION.some((campo) => cambios.includes(campo));
    const resultado = await this.repo.corregirDatosCliente(
      input.ordenId,
      data,
      ESTADOS_SIN_CORRECCION,
      { actorUsuarioId: actor.usuarioId, ubicacionCorregida },
    );
    return resultado === "conflict" ? { status: "conflict" } : { status: "ok", cambios };
  }

  async obtenerUbicacion(ordenId: string, actor: Actor): Promise<ObtenerUbicacionServiceResult> {
    // R18: la MISMA puerta que la escritura, y por eso es la misma llamada. A quien no la cruza no
    // se le devuelve NINGUN dato de la orden.
    const orden = await this.autorizar(ordenId, actor);
    if (orden === null) return { status: "forbidden" };
    return {
      status: "ok",
      orden: {
        ordenId: orden.id,
        destinatario: orden.destinatario,
        telefonoDest: orden.telefonoDest,
        producto: orden.producto,
        notas: orden.notas,
        direccion: orden.direccion,
        peso: orden.peso,
        provinciaId: orden.provinciaId,
        cantonId: orden.cantonId,
        distritoId: orden.distritoId,
        zonaNombre: orden.zonaNombre,
        distritoNombre: orden.distritoNombre,
        numGuia: orden.numGuia,
        yaEnUnCierre: orden.yaEnUnCierre,
        // `montoCobrar` NO viaja: no se edita aqui y no hace falta para pintar (design §9.3).
      },
    };
  }

  /**
   * El `data` que llega al repositorio, CLAVE A CLAVE y solo con lo que cambia. Explicito y sin
   * indexacion dinamica a proposito: lo que se escribe se lee de un vistazo, y una clave nueva no
   * puede colarse por un `...valores`.
   */
  private proyectar(
    valores: ValoresNormalizados,
    cambios: readonly CampoCorregible[],
  ): CorregirDatosClienteData {
    const data: CorregirDatosClienteData = {};
    for (const campo of cambios) {
      if (campo === "destinatario") data.destinatario = valores.destinatario;
      else if (campo === "telefonoDest") data.telefonoDest = valores.telefonoDest;
      else if (campo === "producto") data.producto = valores.producto;
      else if (campo === "notas") data.notas = valores.notas;
      else if (campo === "direccion") data.direccion = valores.direccion;
      else if (campo === "provinciaId") data.provinciaId = valores.provinciaId;
      else if (campo === "cantonId") data.cantonId = valores.cantonId;
      else if (campo === "distritoId") data.distritoId = valores.distritoId;
      else data.peso = valores.peso;
    }
    return data;
  }

  /**
   * Los rechazos de ubicacion se cuelgan TODOS de `distritoId` (design §9.2): es el campo que el
   * humano acaba de elegir y junto al que el modal ya sabe pintar un motivo. Un estado propio por
   * cada motivo de rechazo seria superficie sin ganancia.
   */
  private rechazoDeUbicacion(motivo: string): CorregirDatosClienteServiceResult {
    return { status: "validation_error", fieldErrors: { distritoId: [motivo] } };
  }

  /**
   * R11/R12/R13/R14/R16 — el aviso, con las DOS ubicaciones calculadas por el mismo camino.
   *
   * Se calcula tambien la ACTUAL, y no solo la propuesta, porque enseñar solo el importe nuevo
   * obligaria a quien mira a recordar el viejo — que es justo lo que un aviso de dinero no puede
   * pedir.
   */
  private async componerAviso(
    orden: OrdenParaCorreccionRow,
    distrito: DistritoResueltoRow,
    zonaId: string,
  ): Promise<AvisoCambioUbicacion> {
    // SECUENCIAL y no `Promise.all`: son dos consultas del mismo cliente, y este servicio se
    // ejercita tambien con un cliente TRANSACCIONAL en los tests contra Postgres, donde dos
    // consultas concurrentes sobre la misma conexion no estan definidas. El aviso es un camino
    // raro (solo al cambiar de distrito): dos viajes en serie no son un coste que valga el riesgo.
    const actual = await this.ubicacionConCostos(orden, {
      zonaId: orden.zonaId,
      zonaNombre: orden.zonaNombre,
      distritoNombre: orden.distritoNombre,
      esCentral: orden.esCentral,
      esZonaEspecial: orden.esZonaEspecial,
    });
    const propuesta = await this.ubicacionConCostos(orden, {
      zonaId,
      zonaNombre: distrito.zonaNombre ?? "",
      distritoNombre: distrito.nombre,
      esCentral: distrito.esCentral,
      esZonaEspecial: distrito.esZonaEspecial,
    });
    return { actual, propuesta, yaEnUnCierre: orden.yaEnUnCierre };
  }

  /**
   * R12 — LOS IMPORTES, SIN UNA SOLA LINEA DE ARITMETICA NUEVA.
   *
   *   1. `resolveTarifa(tienda, zona)` — la cascada de la feature 274 (tienda+zona, tienda, zona).
   *   2. `costosListadoOrden(tarifa, orden)` — que NO reimplementa la formula: delega en
   *      `derivarIngresoOrden(..., "entregada")`, LA MISMA funcion que factura el cierre del dia.
   *
   * `montoCobrar` viaja como STRING de punta a punta, nunca `number`: es la leccion medida de la
   * feature 204 (14 de 66 ordenes con un centimo de desviacion al multiplicar en el navegador).
   *
   * `tarifa === null` NO se pinta como cero (R13): sale como el discriminante `"sin_tarifa"`. Y no
   * bloquea, por coherencia con la regla ya firmada de la feature 274 —un par sin tarifa se
   * muestra como hueco y se sigue— (P1, resuelta por el humano el 2026-08-28). La consecuencia
   * asumida esta escrita: la orden puede quedar en una zona por la que Ordenex no factura nada
   * hasta que alguien configure esa tarifa.
   */
  private async ubicacionConCostos(
    orden: Pick<OrdenParaCorreccionRow, "tiendaId" | "montoCobrar" | "cobraComision">,
    ubicacion: Omit<
      UbicacionConCostos,
      "tarifa" | "fleteConIva" | "comisionConIva" | "fleteOrigen"
    >,
  ): Promise<UbicacionConCostos> {
    const tarifa = await this.tarifas.resolveTarifa(orden.tiendaId, ubicacion.zonaId);
    const costos = costosListadoOrden(tarifa, {
      esCentral: ubicacion.esCentral,
      esZonaEspecial: ubicacion.esZonaEspecial,
      montoCobrar: orden.montoCobrar,
      cobraComision: orden.cobraComision,
    });
    return { ...ubicacion, tarifa: tarifa === null ? "sin_tarifa" : "resuelta", ...costos };
  }
}
