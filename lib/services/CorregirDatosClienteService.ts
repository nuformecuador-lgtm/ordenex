import type {
  CorregirDatosClienteData,
  IOrdenRepository,
} from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  CorregirDatosClienteInput,
  CorregirDatosClienteServiceResult,
  ICorregirDatosClienteService,
} from "@/lib/interfaces/services/ICorregirDatosClienteService";
import {
  CAMPOS_CORREGIBLES,
  ESTADOS_SIN_CORRECCION,
  rolAdmiteCorreccion,
  type CampoCorregible,
} from "@/lib/types/correccion-datos-cliente";
import { normalizarTelefonoWa } from "@/lib/utils/whatsapp-telefono";

// FICHA 312 — logica de negocio de LA CORRECCION DE LOS DATOS DEL CLIENTE. No conoce HTTP, no
// conoce Prisma y no conoce Next: se instancia entero con dobles en los tests.
//
// ⚠️ SIN RASTRO (D4, 2026-08-28). Este servicio NO publica nota, NO escribe historial y NO llama a
// ninguna escritura del modulo de chat. La unica escritura que hace es `corregirDatosCliente`, y
// el tipo de su `data` no puede expresar `estatusId` ni `direccion` (R5/R14). Si algun dia hace
// falta de verdad saber quien corrigio que, eso REABRE D4 y va a la puerta de aprobacion humana —
// no se resuelve por la puerta de atras con «solo un logcito» (R16).

/**
 * Lo que el servicio consume del repositorio, por `Pick` de la interfaz (patron
 * `EliminarOrdenService`): depende de los DOS metodos, no del repositorio entero.
 *
 * POR QUE `findById` Y NO UNA PROYECCION NUEVA. Ya devuelve, en una sola consulta, lo que la
 * secuencia necesita —la tienda dueña, el `estatusValue` y los cuatro valores actuales— y su
 * `WHERE` lleva `deletedAt: null`, asi que una orden BORRADA sale como `null` igual que una
 * INEXISTENTE. Esa confusion no es un efecto lateral: es exactamente el resultado opaco que pide
 * R12, y sale gratis en vez de tener que construirse.
 */
export type CorregirDatosClienteRepo = Pick<
  IOrdenRepository,
  "findById" | "corregirDatosCliente"
>;

/** Los tres campos de texto obligatorio: la orden no puede quedarse sin ellos (design §10). */
const CAMPOS_NO_VACIABLES = ["destinatario", "telefonoDest", "producto"] as const;

/** Valores normalizados de una orden, en la forma en que se comparan y se guardan. */
type ValoresNormalizados = {
  [K in CampoCorregible]?: K extends "notas" ? string | null : string;
};

/**
 * §10 — LA NORMALIZACION, que es la MISMA que aplica la carga masiva y por eso se escribe una vez
 * y se usa para comparar Y para guardar. Si se normalizara solo al guardar, R4 compararia peras
 * con manzanas: un `" Ana "` contra un `"Ana"` almacenado contaria como cambio y escribiria una
 * fila identica.
 *
 * `telefonoDest` se recorta Y SE GUARDA TAL CUAL (R17, T1 del 2026-08-28): la carga guarda texto
 * recortado, NO E.164 («una orden de Costa Rica guardada en formato LOCAL, que es como las carga
 * el negocio», `ChatConversacionRepository`). Canonizar solo desde esta superficie dejaria la
 * columna con dos formatos segun por donde entro el dato.
 *
 * `notas`: `""` -> `null`, copia literal de `BulkOrdenService` («notas vacia es ausencia»).
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
  return salida;
}

export class CorregirDatosClienteService implements ICorregirDatosClienteService {
  constructor(private readonly repo: CorregirDatosClienteRepo) {}

  async corregir(
    input: CorregirDatosClienteInput,
    actor: Actor,
  ): Promise<CorregirDatosClienteServiceResult> {
    // 1. ROL, ANTES de tocar dato alguno (R10). `mensajero`, `adminSatelite` y `apiKey` no llegan
    //    ni a consultar la orden: un `forbidden` que cueste una consulta es un oraculo de
    //    existencia para quien lo cronometre.
    if (actor.rol !== "maestro" && actor.rol !== "admin" && actor.rol !== "adminTienda") {
      return { status: "forbidden" };
    }

    // 2. Carga de la orden. Una sola consulta, y `null` cubre a la vez «no existe» y «esta
    //    borrada» (R12): el mismo objeto opaco para los dos casos.
    const orden = await this.repo.findById(input.ordenId);
    if (orden === null) return { status: "forbidden" };

    // 3. PERTENENCIA (R9). Sale del ACTOR, jamas del input (R25): el mismo mecanismo que
    //    `autorizarSobreHilo` (227/R9), del que NO se reusa la funcion porque aquella exige
    //    `esRolConHilo` y rechazaria a `maestro`/`admin`, que son el caso principal de esta ficha.
    if (actor.rol === "adminTienda" && orden.tiendaId !== actor.usuarioId) {
      return { status: "forbidden" };
    }

    // 4. VENTANA POR ROL (R8/R9/R11), leida del modulo puro que la pantalla tambien consulta.
    //    `estatusValue` ausente -> `false`: fallo cerrado.
    if (!rolAdmiteCorreccion(actor.rol, orden.estatusValue)) return { status: "forbidden" };

    // 5. Normalizacion y DIFF (R4). Se compara con el valor ALMACENADO tras la MISMA
    //    normalizacion que se aplicaria al guardar.
    const valores = normalizar(input);
    const cambios: CampoCorregible[] = [];
    const data: CorregirDatosClienteData = {};
    for (const campo of CAMPOS_CORREGIBLES) {
      const nuevo = valores[campo];
      if (nuevo === undefined) continue;
      if (nuevo === orden[campo]) continue; // ya era eso: no es un cambio
      cambios.push(campo);
      if (campo === "notas") data.notas = nuevo as string | null;
      else data[campo] = nuevo as string;
    }

    // 5.a. NADA QUE CAMBIAR (R4): se termina SIN escribir. No es un error y no gasta una escritura
    //      —que ademas moveria el `updated_at`, que es el unico rastro que esta ficha deja (R15).
    if (cambios.length === 0) return { status: "ok", cambios: [] };

    // 5.b. Los rechazos de VALOR, y solo sobre lo que efectivamente cambia.
    const fieldErrors: Record<string, string[]> = {};
    for (const campo of CAMPOS_NO_VACIABLES) {
      // Un texto de solo espacios pasa el `min(1)` del schema y se convierte en vacio al
      // recortarlo. La carga masiva no admite esos tres campos vacios y la correccion tampoco
      // (design §10): dejar la orden sin destinatario no es corregirla.
      if (cambios.includes(campo) && valores[campo] === "") {
        fieldErrors[campo] = ["No puede quedar vacio"];
      }
    }
    // R18 — la validacion de UTILIDAD del telefono, que es cosa distinta de guardarlo canonizado.
    // Si al normalizarlo con la normalizacion de WhatsApp del sistema no queda ningun digito
    // utilizable, el numero no puede casar ningun entrante ni recibir ningun saliente (el job de
    // bienvenida ya lanza en ese caso). Se rechaza y NO se guarda.
    const telefono = valores.telefonoDest;
    if (
      cambios.includes("telefonoDest") &&
      telefono !== undefined &&
      normalizarTelefonoWa(telefono) === ""
    ) {
      fieldErrors.telefonoDest = ["Numero de telefono no utilizable"];
    }
    if (Object.keys(fieldErrors).length > 0) return { status: "validation_error", fieldErrors };

    // 6. ESCRITURA. Una sola sentencia guardada por la ventana (R13). La ventana que viaja es la
    //    de D3 —la que bloquea los cuatro estados terminales—: la restriccion EXTRA del
    //    `adminTienda` (solo los grupos de `/novedades`) ya se comprobo en el paso 4 y no se puede
    //    expresar como lista de bloqueados sin enumerar el complemento del catalogo entero.
    //    Consecuencia anotada: si una orden de tienda saliera de su grupo hacia un estado NO
    //    bloqueado justo entre el paso 2 y este, la escritura pasaria. Es una carrera de
    //    microsegundos y su peor desenlace es corregir un nombre mal escrito, no mover dinero ni
    //    estado.
    const resultado = await this.repo.corregirDatosCliente(
      input.ordenId,
      data,
      ESTADOS_SIN_CORRECCION,
    );
    return resultado === "conflict" ? { status: "conflict" } : { status: "ok", cambios };
  }
}
