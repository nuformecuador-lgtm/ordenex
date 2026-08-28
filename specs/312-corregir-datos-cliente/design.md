# Ficha 312 — Diseño: corregir los datos del cliente de una orden

> Nota de método: el grafo de `codebase-memory` **no estaba disponible** en la sesión que
> escribió esto (la herramienta MCP no figuraba en el toolset). El censo de abajo se levantó con
> `grep`/lectura directa y cada afirmación cita el archivo del que sale.

---

## 0. Qué hay ya en disco, medido

| Pieza | Estado real | Dónde |
| --- | --- | --- |
| `OrdenRepository.update(id, data, historial)` | **VIVO.** `updateMany` guardado por `deletedAt: null` + append al historial **solo si cambia `estatusId`** + encolado de geocodificación **solo si cambia `direccion`**, todo en la misma `$transaction`. | `lib/repositories/OrdenRepository.ts:1362` |
| Consumidores de `update` | `DevolucionOrigenService`, `EnvioDevolucionCentralService`. | — |
| `actualizarOrdenSchema` | **VIVO**, `.strict()`, admite los 4 campos del alcance **y 7 más** (`peso`, `estatusId`, `tiendaId`, `zonaId`, `provinciaId`, `cantonId`, `distritoId`). | `lib/types/orden.ts:39` |
| `OrdenService.actualizar` / `lib/actions/ordenes.actualizarOrden` | **NO EXISTEN.** Borradas el 2026-08-07 («nacieron muertas, nunca tuvieron pantalla»). Solo quedan los comentarios del borrado. | `lib/services/OrdenService.ts:412`, `lib/actions/ordenes.ts:40` |
| Hilo de notas (`orden_nota`) | Tabla + repositorio + servicio + UI compartida. `IOrdenNotaRepository.crear` es público. | `lib/repositories/OrdenNotaRepository.ts:50`, `components/shared/HiloNotasOrden.tsx` |
| **Guardia** de la frontera del hilo | Censo **CERRADO** de operaciones: servicio `[listar, publicar, borrar]`, repositorio `[listarPorOrden, crear, marcarBorrada, findOrdenParaHilo]`, borde `[listarNotasOrden, publicarNotaOrden, borrarNotaOrden]`. Y prohíbe `console` y `catch {}` en el núcleo **y en todo módulo que importe el hilo**. | `tests/unit/guards/orden-nota-frontera.guardia.test.ts` |
| Ventana de escritura del hilo | `adminTienda: [devuelta, ayuda_tienda]`, `mensajero: [en_reparto, ayuda_tienda]`. `maestro`/`admin` **no tienen hilo** (227/R12). | `lib/types/ventana-hilo-notas.ts` |
| `ESTADOS_TERMINALES` | `["entregada", "devuelta_a_tienda", "incidente"]`. | `lib/types/order-status-transiciones.ts:491` |
| Grupos de `/novedades` | `ayuda → ayuda_tienda`, `devolucion → devuelta`. Punto único compartido servidor/UI. | `lib/types/novedad-grupo.ts:63` |
| **Guardias** de `/novedades` | Toda acción de la fila debe estar en `ACCIONES_POR_GRUPO` **y** en `PRODUCTOR_POR_ACCION` (con su Server Action real, importada desde `app/(app)/novedades/`). | `novedad-acciones-una-tabla.guardia.test.ts`, `novedad-acciones-sin-maqueta.guardia.test.ts` |
| Acción POR FILA en el listado | Precedente vivo: `ReportarIncidenteAccion` (disparador propio + modal, **no renderiza nada** si la acción no aplica). | `app/(app)/ordenes/_components/ReportarIncidenteAccion.tsx` |
| Precedente de la familia | `EliminarOrdenService` + `IEliminarOrdenService` + `mensajes-eliminar-orden.ts` + `EliminarOrdenModal` + `eliminar-orden-error-messages.ts` + acción `lib/actions/eliminar-orden.ts`. | — |
| Cómo guarda el teléfono la carga | `filaCargaSchema.telefono = requiredNonEmpty("telefono")` → **texto recortado, NO E.164**. `notas: data.notas === "" ? null : data.notas`. | `lib/types/carga-masiva.ts:106`, `lib/services/BulkOrdenService.ts:730,738` |
| Matcheo de WhatsApp entrante | Va por `orden.telefono_dest` normalizado en SQL, **no** por `chat_conversacion.telefono_e164`. | `lib/repositories/ChatConversacionRepository.ts:65` |

---

## 1. Forma general — se replica la de «eliminar orden»

```
app/(app)/ordenes/_components/CorregirDatosClienteAccion.tsx   ← disparador por FILA (patrón ReportarIncidenteAccion)
app/(app)/novedades/_components/NovedadAcciones.tsx            ← misma acción, otra superficie (celda de la tabla)
        ↓ ambas montan
app/(app)/ordenes/_components/CorregirDatosClienteModal.tsx    ← formulario + avisos (R28/R29/R30)
        ↓
lib/actions/corregir-datos-cliente.ts                          ← Server Action ('use server'), zod en el borde
        ↓ (interfaz)
lib/services/CorregirDatosClienteService.ts                    ← rol + pertenencia + ventana + diff + composición de la nota
        ↓ (interfaz)
lib/repositories/OrdenRepository.corregirDatosCliente()        ← UNA transacción: UPDATE guardado + fila de orden_nota
```

Módulos puros que las dos capas comparten:

```
lib/types/correccion-datos-cliente.ts        ← zod, ventana, predicado UI/servidor, contratos
lib/services/mensajes-corregir-datos-cliente.ts  ← textos del rastro y de los conflictos (patrón mensajes-eliminar-orden.ts)
lib/interfaces/services/ICorregirDatosClienteService.ts
```

**Servicio propio y no un método de `IOrdenService`**, por la misma razón que la 226/«eliminar»:
`IOrdenService` es SOLO LECTURAS desde el 2026-08-07, y la escritura de órdenes vive por
convención en un servicio de dominio **por acción** (`DeshacerAsignacionService`,
`RecuperacionBodegaService`, `EliminarOrdenService`, …). Esta es una acción más de esa familia.

---

## 2. Modelo de datos

### 2.1 Migraciones: **NINGUNA**

No hay tabla nueva, ni columna nueva, ni enum nuevo, ni índice nuevo. Las cuatro columnas
(`orden.destinatario`, `orden.telefono_dest`, `orden.producto`, `orden.notas`) existen desde
`20260709130100_ordenes`; `orden_nota` existe desde la 227. Por tanto **no hay `migration.sql`
ni `down.sql`** en esta ficha, y el gate rápido no debe forzarse al completo por cimientos.

> Esto es intencional y es la respuesta a lo que este repo ya rechazó dos veces: **no se propone
> tabla de auditoría** (alternativa A, §8). El rastro es la nota, y la nota ya tiene tabla.

### 2.2 RLS

`orden_nota` lleva **RLS habilitada sin policies** (solo service role, 227/R26): la única puerta
es el servicio. Esta ficha no la cambia y por tanto hereda la misma obligación — **aquí no hay
red de seguridad debajo**, la autorización de §3 es la única.

### 2.3 Lo que se escribe, exactamente

| Tabla | Operación | Columnas tocadas |
| --- | --- | --- |
| `orden` | `updateMany` (1 fila como mucho) | solo las corregidas de entre `destinatario`, `telefono_dest`, `producto`, `notas` (+ `updated_at` por Prisma) |
| `orden_nota` | `create` (1 fila) | `orden_id`, `autor_id`, `rol_autor`, `cuerpo` (+ `created_at`) |
| `orden_historial_estado` | **nada** (R15) | — |
| `chat_conversacion` | **nada** (R21) | — |

R5 («no se toca nada más») se cumple **por construcción y no por convención**: el método nuevo del
repositorio proyecta un `data` de exactamente cuatro claves posibles, y `estatusId`/`direccion`
**no son representables** en su tipo de entrada. Ver §8/alternativa B.

---

## 3. Autorización — dos superficies, un solo servidor

### 3.1 El módulo puro compartido

`lib/types/correccion-datos-cliente.ts` es el **punto único** que la UI y el servicio consultan.
Existe por la misma razón que `lib/types/novedad-grupo.ts`: si la pantalla y el servidor derivan
la regla por separado, un día ofrecen cosas distintas y nada rompe.

```ts
/** D1: los cuatro campos, como valores (la UI itera esta lista; el schema se deriva de ella). */
export const CAMPOS_CORREGIBLES = ["destinatario", "telefonoDest", "producto", "notas"] as const;
export type CampoCorregible = (typeof CAMPOS_CORREGIBLES)[number];

/**
 * D3 — la ventana CERRADA. Se LEE de la fuente única (`ESTADOS_TERMINALES`) y se le suma el
 * único valor extra que el humano añadió; no se re-declara la lista de terminales.
 * El `satisfies` impide que un typo o un value retirado del catálogo compile.
 */
export const ESTADOS_SIN_CORRECCION = [
  ...ESTADOS_TERMINALES,          // entregada, devuelta_a_tienda, incidente
  "rechazada",
] as const satisfies readonly OrderStatusValue[];

/**
 * R24/R26 — FALLO CERRADO. `undefined`/`null` (fila sin estatus en el DTO, fixture viejo)
 * devuelve `false`: la ausencia de dato no habilita nada.
 */
export function estadoAdmiteCorreccion(estatusValue: string | null | undefined): boolean;

/**
 * R7/R8 — la ventana POR ROL, en una sola tabla. Es la misma forma que
 * `estaEnVentanaDeEscritura` de la 227, y por el mismo motivo: la regla es ASIMÉTRICA.
 *   maestro | admin  → cualquier estado que pase `estadoAdmiteCorreccion`
 *   adminTienda      → SOLO `ESTATUS_POR_GRUPO.devolucion` (leído de la 236, no re-escrito)
 *   el resto         → false
 * NO concede acceso a ninguna orden: la PERTENENCIA se comprueba aparte, en el servicio.
 */
export function rolAdmiteCorreccion(rol: RolValue, estatusValue: string | null | undefined): boolean;
```

### 3.2 La secuencia del servicio

`CorregirDatosClienteService.corregir(input, actor)`:

1. **Rol y estado, sin tocar dato aún.** Si `rolAdmiteCorreccion(actor.rol, …)` no puede
   evaluarse todavía (falta el estado), se carga primero la orden — ver 2.
2. **Carga mínima de la orden**: `id`, `tiendaId`, `deletedAt`, `estatus.value` y los cuatro
   valores actuales. Una sola consulta.
   - No existe / `deletedAt !== null` → `forbidden` (R11: mismo resultado opaco).
3. **Pertenencia** (R8): `adminTienda` ⇒ `orden.tiendaId === actor.usuarioId`. Sale del ACTOR,
   nunca del input. Mismo mecanismo que `autorizarSobreHilo` (227/R9). Falla → `forbidden`.
4. **Ventana** (R7/R8/R10): `rolAdmiteCorreccion(actor.rol, orden.estatusValue)`. Falla →
   `forbidden`.
5. **Diff** (R4): para cada campo recibido, normalizar (§4) y comparar con el valor actual.
   Conjunto vacío ⇒ `{ status: "ok", cambios: [] }` **sin escribir nada**.
6. **Composición del cuerpo de la nota** (§6), en el servicio, antes de escribir.
7. **Escritura atómica** (§7).

> **Por qué la pertenencia NO se delega en `autorizarSobreHilo`** aunque sea la misma pregunta:
> esa función exige `esRolConHilo(actor.rol)` y **rechazaría a `maestro`/`admin`**, que son
> justamente el caso principal de esta ficha. Se reusa el *mecanismo* (`tiendaId === usuarioId`),
> no la función.

### 3.3 Lo que ve cada superficie

| Superficie | Rol | Cómo decide si ofrece |
| --- | --- | --- |
| `/ordenes`, acción por fila | `maestro`, `admin` | Prop `puedeCorregirDatos = esAccesoTotal(rol)` desde `page.tsx` (patrón exacto de `puedeReportarIncidente`), **más** `estadoAdmiteCorreccion(row.estatusValue)` dentro del disparador. `adminTienda` también usa `/ordenes` (`usaFiltroEstado` lo incluye) y **no** recibe la prop. |
| `/novedades`, card | `adminTienda` | Celda `"corregirDatos"` en `ACCIONES_POR_GRUPO.devolucion` **y solo ahí**. El grupo ya implica `devuelta`, así que la ventana se cumple por la tabla; el disparador consulta igual `estadoAdmiteCorreccion` (fallo cerrado, R26). |

**No hace falta ningún campo nuevo en el DTO.** Éste es el punto en el que esta ficha se separa
de «eliminar orden»: allí la UI necesitaba `sinGestion` porque el predicado exigía una consulta
al historial. Aquí el predicado es una **función pura de `estatusValue`**, que
`OrdenListItemDTO` y `NovedadDTO` **ya llevan**. Se cumple el mismo requisito («la UI no ofrece
lo que el servidor va a rechazar») sin ampliar ningún contrato ni pagar una consulta por página.

---

## 4. Contratos de entrada/salida

### 4.1 Schema de borde (`lib/types/correccion-datos-cliente.ts`)

Se **DERIVA** de `actualizarOrdenSchema` (que ya existe y ya es `.strict()`) en vez de escribir
un cuarteto paralelo:

```ts
export const corregirDatosClienteSchema = actualizarOrdenSchema
  .pick({ destinatario: true, telefonoDest: true, producto: true, notas: true })
  .strict()                                        // R2: explícito, no confiado a que .pick lo herede
  .extend({ ordenId: z.uuid() })
  .refine((d) => CAMPOS_CORREGIBLES.some((c) => d[c] !== undefined), {
    path: ["destinatario"],
    message: "Indicá al menos un campo a corregir",  // R3
  });
```

- **Derivar y no copiar** es lo que garantiza que la corrección no acepte un `destinatario` vacío
  que la actualización rechazaría (`z.string().min(1)` ya está allí), ni al revés.
- `.strict()` se re-declara **a propósito**: en zod 4 la conservación del modo por `.pick()` no
  es algo que este spec quiera dar por sabido. Un test lo fija (T1.3).
- `notas` conserva `.nullable().optional()` del schema origen: `null` es «vaciar la nota».

### 4.2 Resultado del servicio

```ts
export type CorregirDatosClienteServiceResult =
  | { status: "ok"; cambios: readonly CampoCorregible[] }   // vacío ⇒ no hubo nada que cambiar (R4)
  | { status: "forbidden" }                                 // rol, pertenencia, estado, inexistente, borrada (R11)
  | { status: "conflict" }                                  // el estado se movió entre la lectura y la escritura (R12)
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }; // R20 (teléfono inservible)
```

`cambios` dice **qué cambió el SERVIDOR**, no qué mandó la pantalla: es el mismo criterio que
`eliminadas` en `EliminarOrdenServiceResult`.

### 4.3 Resultado de la Server Action

```ts
export type CorregirDatosClienteActionResult =
  | CorregirDatosClienteServiceResult
  | { status: "unauthenticated" };                          // R6, resuelto en el BORDE
```

Patrón literal de `lib/actions/eliminar-orden.ts`: `withErrorHandler` + `resolveActorFromSession`
+ zod + fábrica del servicio + traductor de `AppErrorShape` a los dos códigos que este borde
puede producir. **Server Action y no Route Handler**: mutación interna del mismo proyecto
(`docs/architecture.md`).

---

## 5. WhatsApp: el punto delicado, resuelto

### 5.1 Cómo funciona hoy, leído

`ChatConversacionRepository.resolverOrdenActivaPorNumero(telefono)`
(`lib/repositories/ChatConversacionRepository.ts:65`) resuelve un entrante a su orden con:

```sql
WHERE o.deleted_at IS NULL
  AND o.mensajero_asignado_id IS NOT NULL
  AND <normalizarCR(o.telefono_dest)> = $numeroNormalizado
```

**El matcheo va contra `orden.telefono_dest`, no contra `chat_conversacion.telefono_e164`.** El
hilo se keyea después, con `upsertParaOrden`, por el único `(orden_id, telefono_e164)`, usando
`normalizarTelefonoWa(row.telefono_dest)`.

### 5.2 Qué pasa exactamente cuando la 312 escribe `telefono_dest`

| Momento | Efecto | Requisito |
| --- | --- | --- |
| Se corrige el número | `orden.telefono_dest` pasa a ser el nuevo. `chat_conversacion` **no se toca**. | R21 |
| Entrante desde el número **nuevo** | El `WHERE` de arriba **casa** → se resuelve a esta orden. | R22 |
| Ese entrante busca hilo | `upsertParaOrden(ordenId, nuevoNormalizado)` no encuentra `(orden_id, nuevo)` → **crea un hilo NUEVO**. El viejo sigue entero, con sus mensajes. | R21 |
| Entrante desde el número **anterior** | Ya no casa con esta orden → `sinResolver`, el webhook responde `200`, el mensaje no llega a nadie. | R23 |
| Saliente desde el panel / plantilla / bienvenida | Sale al número nuevo, porque todos leen `orden.telefonoDest`. | R22 |

### 5.3 Por qué NO se llama a `migrarTelefono`

`ChatConversacionRepository.migrarTelefono(anterior, nuevo)` existe (feature 311) y haría que el
hilo viejo adoptara el número nuevo, dando **continuidad**. Se descarta, y por dos razones que
apuntan al mismo sitio:

1. **Decisión del humano (D5):** «un cambio de número es evidencia, no continuidad», en línea con
   la 311 (`specs/311-…/requirements.md` R16/R18).
2. **Y aquí el argumento es más fuerte que en la 311.** En la 311 el cliente cambió de número:
   las dos puntas son la misma persona. En la 312 el número estaba **mal escrito**, así que el
   hilo viejo es —literalmente— una conversación con **otra persona**: la plantilla de bienvenida
   (`lib/services/jobs/whatsapp-bienvenida-handler.ts:146`, que envía a `orden.telefonoDest`) ya
   salió a un desconocido. Migrar ese hilo cosería los mensajes de un tercero al historial del
   cliente correcto. Eso no es continuidad: es contaminación de evidencia.

### 5.4 La consecuencia que hay que decir en voz alta

`findByOrdenParaMensajero(ordenId, mensajeroId)` es un `findFirst` ordenado por
`ultimoEntranteAt desc NULLS LAST, createdAt desc`: **devuelve UN hilo**. Tras una corrección de
teléfono una orden puede tener **dos** hilos, y el panel del mensajero enseñará solo el que tenga
el entrante más reciente. El otro sigue en la base y deja de ser alcanzable desde esa pantalla.

Esto **no se arregla en esta ficha** (sería rediseñar el panel de chat, que no es lo evidenciado)
y **no se disimula**: R13 obliga a que la nota diga que el teléfono cambió, de modo que quien
mire la orden sepa por qué el hilo «empieza de cero». Es la misma clase de limitación que la 311
ya aceptó y dejó anotada en su P5. Ver Pregunta T2 al final.

---

## 6. La nota automática

### 6.1 Cómo se escribe

Se usa `IOrdenNotaRepository.crear` **tal cual**, sin añadir ninguna operación al censo cerrado
que vigila `tests/unit/guards/orden-nota-frontera.guardia.test.ts`. Se escribe **una** fila con:

- `ordenId` — la orden corregida;
- `autorId` — `actor.usuarioId` (R14);
- `rolAutor` — `actor.rol` (la columna es `RolValue`, así que `maestro`/`admin` caben);
- `cuerpo` — el texto compuesto de §6.2.

> **Se salta `OrdenNotaService.publicar` a propósito, y hay que decirlo.** `publicar` exige
> `esRolConHilo` + la ventana de escritura, y `maestro`/`admin` **no pasan** ninguna de las dos
> (227/R12). El precedente del repo (`SolicitudAyudaService`) publica a través del servicio
> porque su actor es un `mensajero`; aquí no sirve. Esta nota **no es conversación**: es un
> apunte de sistema atribuido a quien corrigió, y su puerta es la autorización de §3.2, no la
> ventana del hilo.

### 6.2 Composición del cuerpo (`lib/services/mensajes-corregir-datos-cliente.ts`)

Módulo **puro**, patrón `mensajes-eliminar-orden.ts`.

- Orden fijo de los campos: `destinatario`, `telefonoDest`, `producto`, `notas` — el mismo de
  D1, y no por casualidad: los dos primeros son los cortos y los que más importan
  operativamente, así que son los que sobreviven a un recorte.
- Formato por campo: `Destinatario: «valor viejo» → «valor nuevo»`. Un `notas` vacío se escribe
  como `(sin notas)`, no como `«»`.
- Prefijo: `Corrección de datos del cliente. ` y las partes unidas con ` · `.
- **Autor y fecha NO van en el cuerpo** (R14): salen de la propia fila (`autor.nombre`,
  `created_at`) y el hilo ya los pinta (`HiloNotasOrden`). Repetirlos gastaría presupuesto.
- **R17 — el tope.** `CUERPO_MAX` es 200 (`lib/types/orden-nota.ts:20`). Ni `producto` ni `notas`
  tienen tope declarado en la orden, así que la composición **puede** pasarse. Regla única, total
  y determinista: si el texto compuesto supera `CUERPO_MAX`, se recorta por el final a
  `CUERPO_MAX - 1` y se cierra con `…`. Se importa `CUERPO_MAX`, no se escribe un `200`.

---

## 7. Atomicidad: un método nuevo en `OrdenRepository`

```ts
// lib/interfaces/repositories/IOrdenRepository.ts
export interface CorregirDatosClienteData {
  destinatario?: string;
  telefonoDest?: string;
  producto?: string;
  notas?: string | null;
}

corregirDatosCliente(
  ordenId: string,
  data: CorregirDatosClienteData,
  nota: CrearOrdenNotaInput,
  estadosBloqueados: readonly string[],
): Promise<"ok" | "conflict">;
```

Implementación (`lib/repositories/OrdenRepository.ts`), **una sola `$transaction`**:

1. `tx.orden.updateMany({ where: { id, deletedAt: null, estatus: { value: { notIn: estadosBloqueados } } }, data })`.
   La ventana va **en el `WHERE` de la sentencia que muta**, no en un `if` previo: es el
   mecanismo de `OrdenNotaRepository.marcarBorrada` («la propiedad se comprueba en el MISMO
   statement que muta, así que no existe ventana entre el chequeo y el efecto»). Esto es R12.
2. `count === 0` ⇒ `return "conflict"`. La transacción no escribe nada más.
3. `new OrdenNotaRepository(tx).crear(nota)` — el hilo lo escribe **su propio repositorio**,
   construido sobre el `tx`. Su constructor ya está tipado para admitirlo
   (`Pick<PrismaClient, "ordenNota" | "orden">`, y su comentario dice literalmente «para poder
   inyectar un `tx`»). El precedente de un repositorio que delega dentro de su propia transacción
   está vivo en este mismo archivo: `encolarGeocodificacion(this.jobRepo, tx, …)`.
   Para que sea inyectable (y no una dependencia escondida), el constructor gana un **tercer
   parámetro con default**, igual que `jobRepo`:
   `notaRepoDe: (tx) => Pick<IOrdenNotaRepository,"crear"> = (tx) => new OrdenNotaRepository(tx)`.
   Ningún `new OrdenRepository(prisma)` existente se toca.
4. `return "ok"`.

R15 y R5 se cumplen **por el tipo**: `CorregirDatosClienteData` no puede expresar `estatusId` ni
`direccion`, así que este camino es estructuralmente incapaz de disparar el `appendCambioEstado`
o el `encolarGeocodificacion` que `update` sí tiene.

---

## 8. Alternativas descartadas

**A — Tabla de auditoría propia (`orden_correccion_dato`).**
Descartada por decisión humana explícita (D4) y porque este repo ya rechazó dos specs por
proponer modelo nuevo en lugar del arreglo mínimo. El rastro pedido es la nota, y la nota tiene
tabla desde la 227. Coste evitado: migración up/down, RLS, repositorio, lector y una pantalla
que nadie pidió (el precedente `OrdenHabilitacionApi` nació sin lector y hubo que declararlo).

**B — Reusar `OrdenRepository.update` en vez de un método nuevo.**
Es lo primero que se probó, y se descarta por tres motivos concretos:
1. `update` **puede** escribir `estatusId` y `direccion`. Reusarlo dejaría D4 («no se escribe en
   `orden_historial_estado`») dependiendo de que el llamador se acuerde de no mandar `estatusId`.
   Con el método nuevo, D4 no es una convención: **no es representable**.
2. `update` **no tiene sitio para la ventana de estado**: su `WHERE` es `{ id, deletedAt: null }`.
   Meter `estatus.value NOT IN (…)` ahí cambiaría el comportamiento de sus dos consumidores vivos
   (`DevolucionOrigenService`, `EnvioDevolucionCentralService`), que sí transicionan estados.
3. `update` no puede escribir la nota sin ampliar su firma; ampliarla obliga a tocar dos servicios
   vivos y sus tests para un caso que no comparten.
   `update` **queda intacto**: esta ficha no lo toca.

**C — Escribir la nota FUERA de la transacción (update primero, nota después).**
Es el patrón que `SolicitudAyudaService` documenta y acepta («son repositorios distintos»), así
que había que evaluarlo. Se descarta aquí porque su modo de fallo es exactamente el que esta
ficha existe para eliminar: la orden quedaría corregida **en silencio, sin rastro**, que es lo
mismo que un `UPDATE` a mano contra producción. Es la familia de fallo que este repo tiene
identificada como la más cara: el sistema no falla, **aparenta**.

**D — Escribir la nota PRIMERO y corregir después** (el orden literal de `SolicitudAyudaService`).
Allí la nota va primero porque **es** la que autoriza. Aquí no autoriza nada, y si la corrección
fallara después quedaría una nota **irretractable** afirmando un cambio que no ocurrió: nadie
puede borrarla, porque `marcarBorrada` exige `autorId` propio **y** estar dentro de la ventana de
un `RolConHilo`, y un `maestro` no tiene ninguna. Descartada.

**E — `chat_conversacion.migrarTelefono` al corregir el número.**
Descartada: §5.3. Daría continuidad a un hilo que muy probablemente es con otra persona.

**F — Un campo nuevo en `OrdenListItemDTO` (`puedeCorregirse`), calcado de `sinGestion`.**
Descartada: §3.3. El predicado es una función pura de `estatusValue`, que el DTO ya lleva. Un
campo nuevo añadiría una segunda verdad que puede quedarse atrás, y en el modo completo
(`listarCompleto`) habría que decidir otra vez si se emite.

**G — Acción por LOTE, como «Eliminar».**
Descartada: los cuatro campos son propios de cada orden; un lote no tiene un «destinatario»
común. Mismo argumento con el que `ReportarIncidenteModal` justifica recibir `orden` en singular.

---

## 9. Superficies, al detalle

### 9.1 `/ordenes` — acción por fila

- `app/(app)/ordenes/page.tsx`: `const puedeCorregirDatos = rol ? esAccesoTotal(rol) : false;`
  (comentario obligado: **no** es `accionesLote` aunque hoy coincida el predicado — es una acción
  por ORDEN, igual que el incidente).
- `OrdenesListado` → `OrdenesModule`: la prop viaja tal cual y entra como **tercera fuente** de la
  columna `acciones` (hoy son dos: `mostrarHistorial` y `puedeReportarIncidente`).
- `CorregirDatosClienteAccion`: `if (!puedeCorregirDatos || !estadoAdmiteCorreccion(orden.estatusValue)) return null;`
  — **no renderiza nada**, no un botón deshabilitado (patrón `ReportarIncidenteAccion`).
- Éxito ⇒ `mutate(key => Array.isArray(key) && key[0] === "ordenes:list")` (R31).

### 9.2 `/novedades` — celda de la tabla

Tres archivos, y los tres son obligatorios para que las guardias pasen:

| Archivo | Cambio |
| --- | --- |
| `novedad-acciones-catalogo.ts` | `AccionNovedad` gana `"corregirDatos"`; `ACCIONES_POR_GRUPO.devolucion` la incluye (**y `ayuda` no**, R25); `PRODUCTOR_POR_ACCION.corregirDatos = { accionServidor: "corregirDatosCliente", modulo: "lib/actions/corregir-datos-cliente" }`. |
| `NovedadAcciones.tsx` | Entrada en `ICONO_POR_ACCION` (rótulo «Corregir datos», nombre accesible `Corregir los datos del cliente de la orden de ${destinatario}`) + prop `onCorregirDatos`. |
| `NovedadesModule.tsx` | Estado `ordenACorregir` + montaje del modal + relectura tras éxito. |

El icono: **`PencilLine`** (`lucide-react`). Es propio de esta acción, como `Power` lo es de
«Habilitar»: ninguna otra acción de la fila edita un dato.

### 9.3 El modal (compartido por las dos superficies)

`CorregirDatosClienteModal` vive en `app/(app)/ordenes/_components/` —donde nace y donde está su
consumidor principal— y `/novedades` lo **importa**, exactamente como `/recepcion-satelite`
importa `ReportarIncidenteAccion`. No se promueve a `components/shared/` (no hay una tercera
superficie).

- Recibe una `CorregirDatosClienteOrdenUI` estructural (`id`, `numRemision`, `numGuia`,
  `destinatario`, `telefonoDest`, `producto`, `notas`, `estatusValue`) que cumplen **por
  estructura** tanto `OrdenListItemDTO` como `NovedadDTO`. Mismo patrón que
  `ReportarIncidenteAccionOrden`.
- Cuatro campos precargados (R28). Valida en cliente con **el mismo** `corregirDatosClienteSchema`
  que el servidor revalida (patrón `ReportarIncidenteModal`): el cliente no tiene reglas propias.
- **Aviso de etiqueta (R29)**, solo si `numGuia !== null`: «Esta orden ya tiene la guía N impresa.
  La etiqueta pegada al paquete seguirá mostrando los datos anteriores.»
- **Aviso de WhatsApp (R30)**, solo si el campo de teléfono cambió respecto del precargado: «Los
  mensajes nuevos irán al número corregido. La conversación anterior se conserva, pero no se
  traslada.» *(Vocabulario: nada de «SLA»; aquí no aplica, pero la regla se recuerda.)*
- Errores traducidos por causa en `corregir-datos-cliente-error-messages.ts` (patrón
  `eliminar-orden-error-messages.ts`), sin exponer ids internos (R32). El borrador **no** se
  limpia ante un rechazo.

---

## 10. Normalización de los valores al guardar

| Campo | Tratamiento | De dónde sale |
| --- | --- | --- |
| `destinatario` | `.trim()`, no vacío | `crearOrdenSchema`/`filaCargaSchema` hacen lo mismo |
| `producto` | `.trim()`, no vacío | ídem |
| `notas` | `.trim()`; `""` ⇒ `null` | copia literal de `BulkOrdenService.ts:738` |
| `telefonoDest` | `.trim()` y **se guarda tal cual** (R19) | `filaCargaSchema.telefono = requiredNonEmpty("telefono")` |

**Aclaración medida, porque el encargo se puede leer de dos maneras.** La carga masiva **NO**
guarda el teléfono en E.164: guarda el texto recortado. Lo dice el propio código del chat: «una
orden de Costa Rica guardada en formato LOCAL (`8888-7777`, que es como las carga el negocio)»
(`ChatConversacionRepository.ts:78`). La normalización con `normalizarTelefonoCR` /
`normalizarTelefonoWa` vive **en el punto de uso** (matcheo del entrante, clave del hilo, destino
del envío), no en la columna. Por tanto «normalizarse igual que en la carga» se implementa como
`.trim()` en la columna, y la corrección **usa** `normalizarTelefonoWa` para una cosa distinta:

**R20 — la validación de utilidad.** Si `normalizarTelefonoWa(nuevo) === ""` el número es
inservible: no puede casar ningún entrante ni recibir ningún saliente (el job de bienvenida ya
lanza en ese caso, `whatsapp-bienvenida-handler.ts:146`). Se rechaza en el servicio con
`validation_error`, no se guarda.

Ver Pregunta T1.

---

## 11. Verificación (resumen; el desglose está en `tasks.md`)

- **Servicio con dobles**: rol, pertenencia, ventana, diff, composición del cuerpo, tope.
- **Repositorio contra Postgres** (`tests/integration/db`): el `WHERE` de la ventana recorta de
  verdad, la nota se crea en la misma transacción, ninguna otra columna cambia, y **cero** filas
  nuevas en `orden_historial_estado`. Los tests de servicio usan dobles y **no ven el SQL**: la
  ventana se prueba donde vive.
- **Chat contra Postgres**: tras corregir, `resolverOrdenActivaPorNumero(nuevo)` devuelve la
  orden y `resolverOrdenActivaPorNumero(viejo)` **no**; y la fila de `chat_conversacion` con el
  número viejo sigue intacta.
- **Componentes**: precarga, los dos avisos, fallo cerrado del disparador, relectura tras éxito.
- **Guardias existentes que deben seguir verdes**: `orden-nota-frontera`,
  `novedad-acciones-una-tabla`, `novedad-acciones-sin-maqueta`, `superficie-de-uso`.

---

## 12. Preguntas abiertas (técnicas)

> Las de producto y alcance están en `requirements.md` §Preguntas abiertas (P1–P4).

**T1 — ¿Guardar el teléfono corregido en forma canónica?**
Esta ficha lo guarda **como lo guarda la carga** (texto recortado), porque eso es lo medido y
porque escribir E.164 desde una sola superficie dejaría la columna con dos formatos según por
dónde entró el dato. Pero corregir es justamente la ocasión de canonizar. ¿Se quiere
(`normalizarTelefonoWa` al guardar), aunque diverja de la carga y del resto de las órdenes ya
existentes? Si la respuesta es sí, R19 cambia y hay que decidir si además se hace un backfill —
que es otra ficha.

**T2 — Dos hilos de chat por orden, y el panel enseña uno.**
§5.4. `findByOrdenParaMensajero` es un `findFirst`. Tras una corrección de número el mensajero
verá solo uno de los dos hilos. Las salidas conocidas son: (a) dejarlo así y confiar en la nota
de R13 —lo que esta ficha propone—; (b) que el panel liste los hilos de la orden en vez de tomar
el primero; (c) fusionar hilos. (b) y (c) son fichas propias del módulo de chat. ¿Se acepta (a)?

**T3 — La ventana de estado, ¿debe además excluir `sin_gestionar` o los estados de la
recolección?**
D3 fija exactamente cuatro valores y esta ficha no añade ninguno. Se anota porque `sin_gestionar`
es un estado de orden barrida por el corte, y corregirla ahí es legal según D3. Si eso no es lo
querido, la lista de `ESTADOS_SIN_CORRECCION` es una línea.
