import { z } from "zod";
import type { RolValue } from "@prisma/client";

// Feature 227 (T2.2, design §3) — validacion de borde (zod) + contratos serializables del HILO
// de notas por orden. Patron de `lib/types/orden-mensajero-meta.ts`: zod en el borde (Server
// Action) y resultado DISCRIMINADO por `status`. (Aqui se citaba tambien el modulo de tipos de la
// feature 116, que ESTA feature retira entera (R20): la referencia se quito con el archivo, para
// que el comentario no apunte a un sitio que ya no existe.)
//
// El hilo NO es `orden.notas` (la nota de la TIENDA, R25) ni la nota privada del mensajero (la
// feature 116, que esta feature RETIRA): vive en su propia tabla `orden_nota`, con N filas por
// orden y dos interlocutores (adminTienda <-> mensajero).

/**
 * R7 (decision P5) — tope del cuerpo, en caracteres. 200, no los 2000 de la 116: esto es una
 * conversacion sobre una novedad, no un parte. Se mide sobre el texto CRUDO (pre-recorte), igual
 * que en la 116; el RECORTE y el rechazo del cuerpo vacio ocurren en el SERVICE (R6), porque
 * "   " es un texto valido para el schema y un no-mensaje para el negocio.
 */
export const CUERPO_MAX = 200;

// --- Schemas de borde (R27) -----------------------------------------------------------------

/** R27: publicar necesita la orden (uuid) y el cuerpo acotado. El AUTOR nunca viaja: lo fija el
 *  service con el actor de la sesion (R5); si alguien manda `autorId`, zod lo descarta. */
export const publicarNotaSchema = z.object({
  ordenId: z.uuid(),
  cuerpo: z.string().max(CUERPO_MAX),
});
export type PublicarNotaInput = z.infer<typeof publicarNotaSchema>;

/** R27: leer solo necesita la orden. El alcance (tienda propia / asignacion) lo resuelve el
 *  service con el actor, nunca un dato del input (R9/R11). */
export const listarNotasSchema = z.object({
  ordenId: z.uuid(),
});
export type ListarNotasInput = z.infer<typeof listarNotasSchema>;

/**
 * R27/R33 — borrar lleva la nota Y la orden del hilo en el que el actor la esta borrando.
 *
 * OJO, DESVIACION CONSCIENTE DE design §3, que escribe `borrarNotaSchema = { notaId: uuid }`:
 * con solo el `notaId` el service NO PUEDE ejecutar su propia secuencia de comprobaciones
 * (design §2.2, pasos 2-4: cargar la orden, pertenencia y ventana) porque no sabe de que orden
 * es la nota, y el repositorio que el mismo design define no tiene ningun metodo para
 * averiguarlo. Sin `ordenId` no habria forma de aplicar R35 (la ventana de borrado) ni R10/R11
 * (pertenencia). El `ordenId` NO relaja nada: es un dato que el actor ya tiene abierto en
 * pantalla y que solo sirve para AÑADIR comprobaciones; el `autorId` sigue saliendo de la
 * sesion y viajando en el `where` del UPDATE (R32).
 */
export const borrarNotaSchema = z.object({
  ordenId: z.uuid(),
  notaId: z.uuid(),
});
export type BorrarNotaInput = z.infer<typeof borrarNotaSchema>;

// --- DTO serializable (cruza el borde RSC) ---------------------------------------------------

/**
 * Lo que el cliente recibe de UNA nota. Todo string/boolean: ni `Date` ni `Prisma.Decimal`
 * cruzan la frontera RSC.
 *
 * - `cuerpo` viaja VACIO cuando `eliminada` (R34): el texto borrado NO cruza el borde. Si se
 *   enviara y la UI lo ocultara, un `view-source` bastaria para leerlo.
 * - `esPropia` lo calcula el SERVICE (unica capa que conoce al actor) para que el DTO no tenga
 *   que publicar `autorId` hacia el cliente (R16).
 * - `rolAutor` es el rol CONGELADO en el instante de publicar (R4), no el rol actual del usuario.
 */
export interface OrdenNotaDTO {
  id: string;
  cuerpo: string;
  autorNombre: string;
  rolAutor: RolValue;
  /** ISO-8601. */
  createdAt: string;
  esPropia: boolean;
  eliminada: boolean;
}

// --- Resultados discriminados por `status` ---------------------------------------------------
//
// `forbidden` cubre a la vez rol no autorizado, orden ajena, orden inexistente, nota ajena y
// ventana cerrada (R10/R14/R33/R35): un solo resultado OPACO, para no convertir el borde en un
// oraculo de existencia. El detalle accionable lo pone la UI segun donde monto el hilo (R18).
//
// Los `*ServiceResult` son lo que devuelve el SERVICE; los `*Result` son lo que devuelve la
// Server Action, que añade lo que solo el borde sabe: `unauthenticated` (R13) y el
// `validation_error` de zod (R27). Patron `INovedadesService.ListarNovedadesServiceResult`.

/** Error de validacion, con errores POR CAMPO y sin mensajes internos (R27). */
export interface NotaValidationError {
  status: "validation_error";
  fieldErrors: Record<string, string[]>;
}

/**
 * R15/R19: la lectura devuelve el hilo COMPLETO (en cualquier estatus) y `puedeEscribir`, que
 * es «el actor esta DENTRO de SU ventana», no «la orden esta en devuelta»: el mismo hilo, en el
 * mismo estatus, es escribible para un rol y de solo lectura para el otro (D1). Viaja en la
 * lectura porque la UI no debe re-derivar la regla en el cliente ni adivinarla del estatus.
 */
export type ListarNotasServiceResult =
  | { status: "ok"; notas: OrdenNotaDTO[]; puedeEscribir: boolean }
  | { status: "forbidden" };

export type ListarNotasResult =
  | ListarNotasServiceResult
  | NotaValidationError
  | { status: "unauthenticated" };

/** R1/R6: `ok` devuelve la nota recien creada ya proyectada. El `validation_error` del cuerpo
 *  vacio tras recortar lo produce el SERVICE (R6), no zod, por eso vive tambien aqui. */
export type PublicarNotaServiceResult =
  | { status: "ok"; nota: OrdenNotaDTO }
  | NotaValidationError
  | { status: "forbidden" };

export type PublicarNotaResult = PublicarNotaServiceResult | { status: "unauthenticated" };

/** R31/R33: `ok` si la nota propia y vigente se marco borrada dentro de la ventana; `forbidden`
 *  en todo lo demas (inexistente, ajena, ya borrada, fuera de ventana), sin distinguir cual. */
export type BorrarNotaServiceResult = { status: "ok" } | { status: "forbidden" };

export type BorrarNotaResult =
  | BorrarNotaServiceResult
  | NotaValidationError
  | { status: "unauthenticated" };
