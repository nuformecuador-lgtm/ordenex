import { z } from "zod";
import type { RolValue } from "@prisma/client";
import { actualizarOrdenSchema } from "@/lib/types/orden";
import type { OrderStatusValue } from "@/lib/types/order-status";
import { ESTADOS_TERMINALES } from "@/lib/types/order-status-transiciones";
import { grupoDeEstatus } from "@/lib/types/novedad-grupo";

// Ficha 312 (design §3.1) — EL PUNTO UNICO de la correccion de datos del cliente.
//
// POR QUE UN MODULO PURO Y NO LA REGLA REPARTIDA. La pantalla decide QUE OFRECE y el servidor
// decide QUE ACEPTA. Si cada lado deriva la regla por su cuenta, un dia ofrecen cosas distintas y
// nada rompe: el operador ve un boton que el servidor rechaza, o al reves. Es exactamente el
// motivo por el que existe `lib/types/novedad-grupo.ts`, y este modulo es su hermano.
//
// LO QUE ESTE MODULO NO HACE: no conoce Prisma, ni React, ni HTTP. Valores, tipos y dos
// predicados.
//
// ⚠️ SIN RASTRO (312/D4, RATIFICADO el 2026-08-28 por la ficha 327/D3). Corregir un dato NO deja
// nota en el hilo, ni fila de historial, ni tabla de auditoria: el unico rastro es el `updated_at`
// de la orden. La nota automatica esta EVALUADA Y DESCARTADA (312/design §8/B). No es un olvido.
//
// La 327 añade UNA escritura fuera de la fila de la orden —el trabajo de re-geocodificacion,
// cuando la direccion cambia— y eso NO contradice lo anterior: ese trabajo lleva SOLO el id de la
// orden (feature 91/R14), asi que no registra quien corrigio que ni cual era el valor anterior.
// La enmienda esta declarada en `specs/327-editor-ubicacion/requirements.md` §D6.

/**
 * D1 — LOS NUEVE CAMPOS, como valores. La UI itera esta lista y el schema se DERIVA de ella, de
 * modo que ninguno de los dos puede quedarse con una lista propia.
 *
 * Los cuatro primeros son de la ficha 312. Los cinco ultimos los añade la 327, que reabrio la
 * decision de aquella misma mañana: la direccion se habia dejado fuera A SABIENDAS de que era el
 * error de carga mas caro (312/D1), y el humano la reabrio el 2026-08-28.
 *
 * ⚠️ `zonaId` NO ESTA, Y NO PUEDE ESTAR (327/R5). La zona la DERIVA el servidor a partir del
 * distrito recibido; el `.strict()` de abajo rechaza al cliente que la mande. Tampoco estan
 * `estatusId`, `tiendaId`, `montoCobrar`, `cobraComision`, `numGuia`, `numRemision` ni
 * `mensajeroAsignadoId` (327/D2): corregir una ubicacion mueve el flete que Ordenex factura, pero
 * no el dinero que la tienda declara que hay que cobrar, ni el estado, ni el dueño de la orden.
 */
export const CAMPOS_CORREGIBLES = [
  // Ficha 312
  "destinatario",
  "telefonoDest",
  "producto",
  "notas",
  // Ficha 327
  "direccion",
  "provinciaId",
  "cantonId",
  "distritoId",
  "peso",
] as const;
export type CampoCorregible = (typeof CAMPOS_CORREGIBLES)[number];

/**
 * FICHA 327 (R3) — LOS TRES QUE VIAJAN JUNTOS O NO VIAJAN.
 *
 * No es una preferencia de forma: el servidor comprueba la CADENA provincia -> canton -> distrito
 * (R6) y deriva la zona del distrito (R5). Con una geografia parcial no hay cadena que comprobar,
 * y aceptarla dejaria la fila con un canton que no pertenece a su provincia sin que nada lo note.
 */
export const CAMPOS_GEOGRAFIA = ["provinciaId", "cantonId", "distritoId"] as const;
export type CampoGeografia = (typeof CAMPOS_GEOGRAFIA)[number];

/**
 * D3 — LA VENTANA CERRADA. Se LEE de la fuente unica (`ESTADOS_TERMINALES`) y se le suma el unico
 * valor extra que el humano añadio; la lista de terminales NO se re-declara aqui, porque una
 * segunda copia es una segunda verdad que envejece sola.
 *
 * El `satisfies` impide que un typo —o un value retirado del catalogo— compile.
 *
 * T3 (2026-08-28): NO se añade `sin_gestionar` ni los estados de recoleccion. Son exactamente
 * estos cuatro.
 */
export const ESTADOS_SIN_CORRECCION = [
  ...ESTADOS_TERMINALES, // entregada, devuelta_a_tienda, incidente
  "rechazada",
] as const satisfies readonly OrderStatusValue[];

const SET_SIN_CORRECCION: ReadonlySet<string> = new Set<string>(ESTADOS_SIN_CORRECCION);

/**
 * R11/R22/R24 — ¿este estado admite correccion?
 *
 * FALLO CERRADO: `undefined`/`null` (una fila sin estatus en el DTO, un fixture viejo, un DTO que
 * un dia deje de emitir el campo) devuelve `false`. La AUSENCIA DE DATO NO HABILITA NADA — es lo
 * que R24 pide literalmente, y es lo contrario de lo que hace un `!ESTADOS.includes(x)` ingenuo,
 * que con `undefined` diria «adelante».
 */
export function estadoAdmiteCorreccion(estatusValue: string | null | undefined): boolean {
  if (estatusValue === null || estatusValue === undefined) return false;
  return !SET_SIN_CORRECCION.has(estatusValue);
}

/**
 * R8/R9/R10 — LA VENTANA POR ROL, en una sola tabla. La regla es ASIMETRICA:
 *
 *   maestro | admin  -> cualquier estado que pase `estadoAdmiteCorreccion` (D2: desde el modulo
 *                       de ordenes, sin restriccion de tienda)
 *   adminTienda      -> cualquier estado que pertenezca a un GRUPO de `/novedades`, es decir
 *                       `grupoDeEstatus(...) !== null` — LOS DOS grupos, `devuelta` y
 *                       `ayuda_tienda` (P2, 2026-08-28)
 *   el resto         -> false (mensajero, adminSatelite, apiKey; R10)
 *
 * ⚠️ ESTA FUNCION NO CONCEDE ACCESO A NINGUNA ORDEN. La PERTENENCIA (`orden.tiendaId ===
 * actor.usuarioId`) se comprueba aparte, en el servicio, y con el rol y la tienda DEL ACTOR —
 * jamas con lo que venga en el input (R25).
 *
 * POR QUE EL `adminTienda` SE EXPRESA CON `grupoDeEstatus` Y NO CON UNA LISTA DE DOS VALORES. La
 * regla que dio el humano no es «devuelta y ayuda_tienda»: es «lo que `/novedades` le lista, lo
 * puede corregir». Derivarla del punto unico (`ESTATUS_POR_GRUPO`) dice eso y no puede
 * desalinearse de la pantalla.
 *
 * CONSECUENCIA ANOTADA (design §3.1): si algun dia entra un TERCER grupo en `/novedades`, la
 * correccion quedara habilitada tambien ahi sin que nadie lo decida. Es la lectura pretendida de
 * la regla, pero es una puerta que se abre sola — el dia que aparezca ese grupo, mirar esta linea.
 * (Los dos valores actuales, ademas, pasan `estadoAdmiteCorreccion`: las dos reglas no se
 * contradicen.)
 */
export function rolAdmiteCorreccion(
  rol: RolValue,
  estatusValue: string | null | undefined,
): boolean {
  if (estatusValue === null || estatusValue === undefined) return false; // fallo cerrado (R24)
  switch (rol) {
    case "maestro":
    case "admin":
      return estadoAdmiteCorreccion(estatusValue);
    case "adminTienda":
      return grupoDeEstatus(estatusValue) !== null;
    default:
      return false; // R10: mensajero, adminSatelite, apiKey
  }
}

/**
 * 312/R1-R3-R6 + 327/R1-R2-R3-R4-R8-R9 — el schema del BORDE, DERIVADO de `actualizarOrdenSchema`
 * en vez de una lista paralela escrita a mano.
 *
 * POR QUE DERIVAR Y NO COPIAR. Es lo que garantiza que la correccion no acepte un `destinatario`
 * vacio que la actualizacion rechazaria (el `z.string().min(1)` ya vive alli), ni al reves. Y con
 * la 327 esa herencia entrega dos requisitos sin escribir una regla propia:
 *   · `direccion` hereda `min(1)`      -> 327/R8 (la cadena vacia no pasa)
 *   · `peso` hereda `number().positive()` y NO es nullable -> 327/R9
 * La direccion de SOLO ESPACIOS no la caza el `min(1)` —pasa, y se vacia al recortarla—, y por eso
 * la rechaza el servicio junto a `destinatario` y `producto`, en `CAMPOS_NO_VACIABLES`: hay UNA
 * definicion de «vacio» para los cuatro campos de texto, no dos.
 *
 * Y ES TAMBIEN LO QUE ENTREGA 312/R6 SIN ESCRIBIR NADA: como el schema origen NO tiene `.max()` en
 * ninguno de los campos, la correccion hereda «sin tope» de la misma fuente que la carga. Escribir
 * aqui un `.max()` seria justamente el caso que 312/P3 descarto: «se pudo cargar pero no se puede
 * corregir».
 *
 * `.strict()` se re-declara A PROPOSITO (R2): que `.pick()` conserve el modo del origen en zod 4
 * no es algo que esta ficha quiera dar por sabido. Un test lo fija — y es lo que deja fuera a
 * `zonaId`, que SI existe en el origen y que el cliente NO puede mandar (327/R5).
 *
 * `notas` conserva su `.nullable().optional()`: `null` es «vaciar el campo `notas` DE LA ORDEN»
 * (el campo propio de la orden — aqui no hay ningun hilo de notas de por medio, D4).
 */
export const corregirDatosClienteSchema = actualizarOrdenSchema
  .pick({
    // 312
    destinatario: true,
    telefonoDest: true,
    producto: true,
    notas: true,
    // 327 — la ubicacion. `zonaId` NO se escoge: la deriva el servidor (R5).
    direccion: true,
    provinciaId: true,
    cantonId: true,
    distritoId: true,
    peso: true,
  })
  .strict()
  .extend({
    ordenId: z.uuid(),
    /**
     * FICHA 327 (design §4.1) — EL GATE DEL DINERO, y su nombre esta elegido a proposito.
     *
     * Se llama `…DeUbicacion` y no `…DeZona` porque el gate se dispara con el cambio de
     * DISTRITO: la marca `zona_especial` es del distrito, asi que cambiar de distrito DENTRO de
     * la misma zona tambien puede mover el flete.
     *
     * `false` por defecto: la AUSENCIA no confirma nada. Un cliente que omita la clave recibe el
     * aviso, no la escritura.
     */
    confirmaCambioDeUbicacion: z.boolean().optional().default(false),
  })
  .refine((d) => CAMPOS_CORREGIBLES.some((campo) => d[campo] !== undefined), {
    path: ["destinatario"],
    // R3 de la 312. `confirmaCambioDeUbicacion` NO cuenta: SIEMPRE viene informada (tiene
    // default) y contarla dejaria pasar una peticion que no corrige nada.
    message: "Indica al menos un campo a corregir",
  })
  .refine(
    (d) => {
      // 327/R3 — los tres, o ninguno.
      const presentes = CAMPOS_GEOGRAFIA.filter((campo) => d[campo] !== undefined).length;
      return presentes === 0 || presentes === CAMPOS_GEOGRAFIA.length;
    },
    {
      path: ["distritoId"],
      message: "Indica provincia, canton y distrito juntos",
    },
  )
  .refine((d) => d.distritoId !== null, {
    // 327/R4 — el origen declara `distritoId` como `.nullable()` (es el unico FK nullable de
    // `orden`), pero desde esta superficie no se puede vaciar: la zona se deriva del distrito y
    // `orden.zona_id` es NOT NULL. La cadena vacia ya la rechaza el `min(1)` heredado.
    path: ["distritoId"],
    message: "El distrito es obligatorio",
  });

export type CorregirDatosClienteEntrada = z.infer<typeof corregirDatosClienteSchema>;
