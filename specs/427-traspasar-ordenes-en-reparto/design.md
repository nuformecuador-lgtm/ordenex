# 427 — Traspasar a otro mensajero lo que ya lleva encima · Diseño

> Base: `dev` @ `6cc87ad1`. Todo lo que aquí se afirma sobre el árbol está leído **del archivo**;
> el grafo se usó para saber dónde mirar. La tabla de hechos medidos está en `requirements.md`.

---

## 1. La decisión de alcance: **lote seleccionado**, no «todo lo del mensajero»

La ficha pide elegir entre las dos y argumentarlo. Se elige **lote de órdenes seleccionadas**
(`ordenIds[] + mensajeroDestinoId + motivo`), y el origen se **deriva** de las órdenes.

**Por qué:**

1. **«Pásalo todo» ya existe como composición, sin concepto nuevo.** `/ordenes` tiene filtro por
   mensajero asignado y por estado, y página de hasta 50 (`OrdenesListado.tsx:283-287`,
   `OrdenesModule.tsx:58`). Filtrar por *Andy + en reparto*, marcar todo y confirmar **es** el caso
   de la ficha, con las 31 a la vista. No hay pantalla nueva que construir para el caso que la
   motiva.
2. **«Repártele la mitad a otro» es imposible con el otro modelo**, y el humano dice que es igual
   de real.
3. **«Todo lo del mensajero» es un predicado VIVO evaluado en el servidor**, y eso es un fallo mudo
   esperando: entre lo que el coordinador **ve** y lo que el servidor **mueve**, el mensajero puede
   entregar una orden o pedir ayuda sobre otra. Se movería algo que nadie miró. Un lote cerrado de
   ids es lo que hacen **todas** las acciones por lote de este repo (asignar, deshacer, rutear,
   cambiar día) y lo que permite el `WHERE` guardado + todo-o-nada de R23/R24.
4. Con ids explícitos, el rastro dice **qué** se movió sin tener que reconstruir un predicado.

**Coste aceptado:** más de 50 órdenes exigen dos actos (dos `lote_id`). Límite declarado, Q5.

**Un solo origen por lote (R6).** Un lote con dos orígenes no tiene caso de uso y deja la
confirmación de R35 sin poder decir «de quién a quién». Además haría ambiguo el encolado de
reoptimización (§6.4): habría que reoptimizar N rutas de origen. Se rechaza el lote entero.

---

## 2. Qué estados son traspasables, y por qué cada uno

| Estado | ¿Traspasable? | Razón |
| --- | --- | --- |
| `en_reparto` | **Sí** | El caso de la ficha: el paquete va encima del mensajero. |
| `ayuda_tienda` | **Sí** | Significa literalmente «pidió ayuda y **el paquete sigue con él, en la calle**» (235/R1). Mismo hecho físico. Este repo ya pagó una vez dejarlo fuera de una lista de esta familia. |
| `por_recoger` | No | El paquete está **en la bodega**, no con nadie. Ya tiene su acción (149) y su camino correcto es deshacer + reasignar, que vuelve a pasar el gate de coordenadas, el tope de intentos y el día. Un traspaso directo sería **una segunda forma de asignar con guardas distintas**. |
| `devolviendo_a_tienda` | No | Decisión del humano: ahí el problema es dónde está la caja. Mover la asignación **afirmaría una custodia que nadie verificó** — el riesgo exacto que la 149 documenta como «falsificar la custodia de un paquete». |
| `sin_gestionar` | No | Pertenece al cierre de su mensajero por un **predicado vivo** (`schema.prisma:2372-2378`). Traspasarla la sacaría del cierre abierto del origen y la metería en el del destino, en silencio y moviendo dinero. |
| Resto del catálogo | No | O no tienen mensajero, o el paquete no está en su mano. |

La lista vive en **una sola constante** `ESTADOS_TRASPASABLES` en el servicio, y **entra como noveno
miembro** del censo de `tests/unit/guards/carga-del-mensajero.guardia.test.ts` (hoy
`expect(FAMILIA).toHaveLength(8)`), con su pregunta declarada («que ocupa al mensajero»),
`incluyeAyuda: true` y su razón escrita. Sin eso, la lista pertenecería a esa familia sin estar
vigilada, que es justo el agujero que la guardia existe para cerrar.

---

## 3. Autorización

`esAccesoTotal(actor.rol)` — `maestro` y `admin`, los que hoy asignan desde la central. Cualquier
otro rol: `forbidden` **antes de leer nada** (patrón literal de `DeshacerAsignacionService:145-147`).
El `mensajero` no tiene ni acción ni superficie (R3): la barra de `/ordenes` ya no le ofrece acciones
por lote (`accionesLote` es falso para su rol).

`adminSatelite` queda fuera en esta ficha: ver Q1 en `requirements.md`.

---

## 4. Modelo de datos

### 4.1 Tabla nueva: `orden_traspaso_mensajero`

Copia deliberada de la forma de `OrdenDiaRepartoCambio` (262) y `GestionFechaReprogramacionCambio`
(371): actor NOT NULL, motivo obligatorio, fila inmutable, `@@index([ordenId, createdAt])`, FK
`Restrict` sobre personas.

```prisma
/// FICHA 427 (design §4.1) — RASTRO de los TRASPASOS de una orden entre mensajeros: quién la pasó,
/// desde quién, hacia quién, por qué y cuándo. Fila INMUTABLE, append-only: sin `updated_at`, sin
/// `deleted_at`. Un traspaso posterior AÑADE una fila (R30).
///
/// ES LA HERMANA de `OrdenDiaRepartoCambio` (262) sobre otra columna de la misma orden: allí el día
/// en que el mensajero sale con el paquete, aquí QUIÉN lo lleva. Se copia su forma entera —actor
/// NOT NULL, motivo obligatorio, CHECK de «distinto», índice por (orden, instante)— porque es la
/// misma operación manual y las mismas trampas.
///
/// POR QUÉ UNA TABLA PROPIA Y NO SOLO `historial_accion` (362): el motivo es texto libre tecleado
/// por una persona, y R5 de la 362 lo deja fuera de esa tabla a propósito (se descarga a un archivo
/// y no se purga nunca). Mismo argumento, palabra por palabra, que la 371.
///
/// POR QUÉ NO VA EN `orden_historial_estado` (49): esa tabla es el registro de transiciones de
/// ESTADO, y un traspaso no cambia el estado. Su choke point VALIDA la transición contra el
/// inventario de la 140, así que `en_reparto -> en_reparto` no es escribible: reventaría.
model OrdenTraspasoMensajero {
  id      String @id @default(uuid())
  ordenId String @map("orden_id")

  /// Los dos extremos. NOT NULL las dos: una orden sin mensajero no se traspasa, se asigna.
  mensajeroAnteriorId String @map("mensajero_anterior_id")
  mensajeroNuevoId    String @map("mensajero_nuevo_id")

  /// NOT NULL, al revés que `orden_historial_estado.actor_usuario_id` (donde NULL = cron): AQUÍ
  /// SIEMPRE HAY UNA PERSONA, y quién traspasó es la evidencia.
  actorUsuarioId String @map("actor_usuario_id")

  /// R26 — CONGELADO, no resuelto por join al leer. El rol de una persona cambia (la 362 registra
  /// ese mismo evento), y leer el rol vivo al pintar re-etiquetaría la historia. Precedente
  /// directo: `orden_nota.rol_autor` y `historial_accion.actor_rol`.
  actorRol RolValue @map("actor_rol")

  /// R28: obligatorio, ya recortado en el borde (`trim().min(10).max(300)`), mismo esquema que el
  /// motivo del deshacer asignación (149/D4).
  motivo String

  /// R27 — uuid POR ACTO, no por fila: todas las filas de un mismo traspaso lo comparten. Es lo que
  /// distingue «se traspasaron 31 órdenes de una vez» de «hubo 31 traspasos». Precedente:
  /// `historial_accion.lote_id`.
  loteId String @map("lote_id")

  createdAt DateTime @default(now()) @map("created_at")

  orden             Orden   @relation("OrdenTraspasoOrden", fields: [ordenId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  mensajeroAnterior Usuario @relation("OrdenTraspasoAnterior", fields: [mensajeroAnteriorId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  mensajeroNuevo    Usuario @relation("OrdenTraspasoNuevo", fields: [mensajeroNuevoId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  actor             Usuario @relation("OrdenTraspasoActor", fields: [actorUsuarioId], references: [id], onDelete: Restrict, onUpdate: Cascade)

  @@index([ordenId, createdAt]) // la lectura prevista: «el rastro de esta orden», en orden
  @@index([mensajeroAnteriorId, createdAt]) // «qué se le quitó a este mensajero»; indexa además la FK Restrict
  @@index([mensajeroNuevoId, createdAt]) // «qué recibió este mensajero»; ídem
  @@index([actorUsuarioId]) // la FK Restrict del actor, indexada (patrón `orden_dia_reparto_cambio`)
  @@index([loteId]) // reconstruir un acto completo
  @@map("orden_traspaso_mensajero")
}
```

En `Orden` y en `Usuario`, los lados inversos con esos mismos nombres de relación.

### 4.2 Migración

Carpeta: `db/migrations/20260917120000_orden_traspaso_mensajero/` (posterior a la última del árbol,
`20260916120000_orden_clave_remision`).

`migration.sql`:

1. `CREATE TABLE "orden_traspaso_mensajero"` con las columnas de arriba y las **cuatro** FK
   `ON DELETE RESTRICT ON UPDATE CASCADE`: quién llevaba un paquete es evidencia y no se pierde al
   dar de baja a un usuario.
2. Los **cinco** índices declarados (van también en el datamodel: el invariante del repo es que el
   datamodel siempre declara el índice, para que ningún `migrate dev` futuro proponga borrarlo).
3. `ALTER TABLE ... ADD CONSTRAINT "orden_traspaso_mensajero_distinto_check"
   CHECK ("mensajero_nuevo_id" <> "mensajero_anterior_id")` — R7 puesto **en la base**: un
   «traspaso» a la misma persona no es escribible ni por error. Vive sólo en el SQL (Prisma no
   expresa CHECK), igual que `orden_dia_reparto_cambio_dia_distinto`.
4. `ALTER TABLE "orden_traspaso_mensajero" ENABLE ROW LEVEL SECURITY;` — habilitada **sin policies**
   (patrón `orden_dia_reparto_cambio` / `jobs` / `notificacion`): este repo no usa Supabase Auth, la
   autorización vive en el servicio, y lo que la RLS garantiza es que a estas filas no se llega si
   no es por el servidor.

`down.sql`: `DROP TABLE IF EXISTS "orden_traspaso_mensajero";` — arrastra índices, FK, CHECK y RLS.
**No crea ningún tipo**, así que no hay `DROP TYPE` ni lista de enum que recrear, y **no se toca
ningún `down.sql` anterior** (son fotos de su rama). Lo que se pierde al revertir, dicho en voz
alta: el rastro de los traspasos ya hechos. Las órdenes **no** vuelven a su mensajero anterior: el
`down` no deshace traspasos, sólo borra su registro.

### 4.3 Lo que **no** se toca en el esquema

`orden` no gana ninguna columna. `gestion_orden`, `cierre_*`, `orden_mensajero_meta`,
`orden_historial_estado` y `historial_accion` quedan **exactamente** como están.

---

## 5. Capas y archivos

```
app/(app)/ordenes/_components/TraspasarMensajeroModal.tsx   ← UI (cliente)
lib/actions/traspasar-mensajero.ts                          ← Server Action (borde: zod + actor)
lib/services/TraspasoMensajeroService.ts                    ← reglas (sin HTTP ni Prisma)
lib/interfaces/services/ITraspasoMensajeroService.ts        ← contrato
lib/repositories/OrdenRepository.ts  ::traspasarMensajeroLote   ← la transacción
lib/repositories/traspasar-conversaciones.ts                ← ÚNICO escritor del chat en el traspaso
lib/repositories/registrar-traspaso-mensajero.ts            ← ÚNICO escritor del rastro
lib/repositories/OrdenTraspasoRepository.ts                 ← lectura del rastro (línea de tiempo)
```

Los dos módulos `traspasar-conversaciones.ts` y `registrar-traspaso-mensajero.ts` reciben el `tx`
como primer parámetro y son **choke points declarados**, patrón literal de
`lib/repositories/registrar-cambio-dia-reparto.ts` («este es el único sitio del árbol que inserta
en…»). No es decoración: hace que la atomicidad sea del **tipo** y no de la disciplina — no pueden
abrir su propia transacción ni escribir fuera.

Mutación interna del mismo proyecto ⇒ **Server Action**, nunca ruta API
(`docs/architecture.md`).

---

## 6. La escritura, paso a paso

Todo dentro de **una** `$transaction` (R23/R31).

### 6.1 Pre-lectura bajo bloqueo

```sql
SELECT "id", "mensajero_asignado_id", "estatus_id", "zona_id", "fecha_reparto", "deleted_at"
FROM "orden"
WHERE "id" IN (…)
ORDER BY "id"
FOR UPDATE
```

`FOR UPDATE` + `ORDER BY "id"`: mismo motivo que en `corregirDiaRepartoLote` — que la foto no quede
rancia entre el SELECT y el UPDATE, y un orden de bloqueo determinista entre dos lotes que se
solapen.

### 6.2 El `UPDATE` por orden, guardado

Una sentencia por orden dentro de la misma transacción (patrón `deshacerAsignacionLote`), porque el
día de reparto se **conserva por orden** y no es un valor común al lote:

```sql
UPDATE "orden"
SET "mensajero_asignado_id" = ${destinoId},
    "asignado_at" = NOW(),
    "fecha_reparto" = ${fechaTextoDeEstaOrden}::date,
    "updated_at" = NOW()
WHERE "id" = ${ordenId}
  AND "mensajero_asignado_id" = ${origenId}
  AND "estatus_id" = ${estatusIdLeidoEnLaPreLectura}
  AND "deleted_at" IS NULL
RETURNING "id"
```

Si alguna devuelve 0 filas ⇒ `throw` ⇒ la transacción revierte el lote **completo** y el servicio
compone el `detalle` releyendo el estado actual (R24; patrón `detalleCarrera` de la 149).

**Tres decisiones que este `SET` congela, y por qué:**

- **`asignado_at = NOW()`.** El esquema define esa columna como «instante de la **última
  (re)asignación** de mensajero». Un traspaso es exactamente eso; no escribirla la dejaría
  mintiendo.
- **`fecha_reparto` se REESCRIBE CON SU MISMO VALOR.** Dos razones, y las dos son duras:
  1. la guardia `fecha-reparto-acompana-asignado-at` exige que **toda** escritura que toque
     `asignado_at` toque también `fecha_reparto` en la **misma** sentencia (cláusula 2). Omitirla
     pone el gate rojo, y con razón.
  2. **Poner «hoy» sería un segundo escritor silencioso del día.** Una orden `en_reparto` puede
     tener el día equivocado —es literalmente la población que la ficha 262 vino a rescatar— y
     cambiarlo aquí saltaría el rastro de `orden_dia_reparto_cambio`. El valor entra como
     **parámetro** `YYYY-MM-DD` (`fechaRepartoComoTexto`) y nunca como `NOW()::date`: la cláusula
     (d4) de esa misma guardia prohíbe aritmética horaria en el `SET`, y el driver serializaría un
     `Date` según el `TimeZone` de la sesión.
  3. Si la orden tiene `fecha_reparto` NULL (anterior a la 246), se reescribe NULL. Queda
     «mensajero con día NULL», que es el estado legado que la rama (b) del ranking ya contempla.
- **`prioridad` NO se toca.** `asignarBodegaLote` la apaga porque reasignar **desde bodega** cierra
  un ciclo de reasignación prioritaria (101/R5). Un traspaso en calle no cierra ningún ciclo:
  apagarla aquí perdería una marca que alguien puso a propósito.

### 6.3 Las conversaciones (R18/R19), en la misma transacción

```sql
UPDATE "chat_conversacion"
SET "mensajero_id" = ${destinoId},
    "mensajero_leido_at" = NULL,
    "updated_at" = NOW()
WHERE "orden_id" IN (…)
```

- **Todas** las conversaciones de esas órdenes, no una por orden: el único es
  `(orden_id, telefono_e164)`, así que una orden puede tener más de un hilo.
- **`mensajero_leido_at = NULL`** porque esa marca significa «hasta dónde leyó **este** mensajero», y
  el mensajero ha cambiado. Conservarla haría que el destino viera 0 sin leer sobre mensajes que él
  no ha visto nunca — justo el contexto que necesita para no llamar al cliente a ciegas.
- **No** se toca `ultimo_entrante_at`: es del hilo y del cliente, no del mensajero. Es lo que
  mantiene abierta la ventana de 24 h para el destino, que es la mitad del valor de mover el hilo
  (sin ella sólo podría mandar plantilla).
- **No** se toca `telefono_e164` ni ningún dato de `orden`: este `UPDATE` escribe sólo en
  `chat_conversacion` (misma frontera que `migrarTelefono`).
- Los **adjuntos** no necesitan nada: se autorizan por la orden, no por el hilo
  (`/api/chat/media`, medido).

### 6.4 El rastro y la ruta, en la misma transacción

- `registrarTraspasoMensajero(tx, filas)` inserta **una fila por orden movida**, todas con el mismo
  `loteId` (un `crypto.randomUUID()` por acto, generado en el servicio).
- `encolarOptimizacionDebounce(jobRepo, tx, mensajeroOrigenId, …)` y lo mismo para el destino
  (R32). Se reusa **tal cual** el encolado de la 92 con su patrón outbox: si la transacción
  revierte, los jobs se van con ella. Las claves de debounce son por mensajero, así que los dos jobs
  no colisionan, y un traspaso seguido de otro dentro del mismo minuto colapsa en uno — que es la
  semántica querida.
  - Es la primera vez que un escritor que **no** es la gestión encola reoptimización, y tiene que
    serlo: hasta hoy ningún camino cambiaba el conjunto de paradas de un mensajero **ya en reparto**
    (la asignación deja la orden en `por_recoger`, que no es parada). Éste sí, y de los dos lados.
  - Lo que el encolado **no** puede hacer es esconder R33: hasta que el job corra, las paradas
    nuevas del destino se pintan **al final** (comportamiento declarado de `ruta_optimizada_parada`),
    y la pantalla tiene que decirlo.

---

## 7. Contratos de entrada/salida

### 7.1 Server Action `traspasarMensajero(input)`

```ts
// zod, en el borde (lib/actions/traspasar-mensajero.ts)
const traspasarSchema = z.object({
  ordenIds: z.array(z.string().uuid()).min(1),
  mensajeroDestinoId: z.string().uuid(),
  motivo: z.string().trim().min(10, "explica el motivo (mínimo 10 caracteres)").max(300),
});
```

Salida (unión discriminada, patrón de `DeshacerAsignacionServiceResult`):

```ts
type TraspasoServiceResult =
  | { status: "ok"; movidas: number; conversaciones: number;
      origen: { id: string; nombre: string }; destino: { id: string; nombre: string } }
  | { status: "forbidden" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "conflict"; detalle: { ordenId: string; motivo: string }[] };

// y del borde, además: { status: "unauthenticated" }
```

`movidas` y `conversaciones` son **cifras**, no listas: alimentan R36 («31 órdenes y 31
conversaciones») sin devolver identificadores al navegador.

### 7.2 Motivos de conflicto (símbolos compartidos, no literales gemelos)

Se reusan los que ya existen en `lib/services/mensajes-bloqueo.ts`
(`MSG_MENSAJERO_SIN_VEHICULO`, `MSG_MENSAJERO_NO_ASIGNABLE`,
`MSG_MENSAJERO_BLOQUEADO_POR_CIERRES`) y nacen en un módulo propio
`lib/services/mensajes-traspaso.ts` los tres nuevos: estado no traspasable (con el nombre del
estado), orden de otro mensajero, y la carrera. Dos literales gemelos es como se desincronizan dos
pantallas que cuentan la misma regla.

---

## 8. Guardas: qué se reusa de la asignación y qué **no**

| Guarda | ¿Se aplica? | Por qué |
| --- | --- | --- |
| Rol `esAccesoTotal` | Sí | R1/R2. |
| Destino con rol `mensajero` y **de la zona de la orden** (`findMensajeroIdsValidosByZona`) | Sí | R9. Se evalúa contra la zona de **cada** orden del lote. |
| Destino con vehículo (`findMensajeroIdsConVehiculo`) | Sí | R10, mismo texto que las dos asignaciones. |
| Destino en estado que admite trabajo (`findMensajerosNoAsignablesPorEstado`) | Sí | R10. Un mensajero dado de baja no recibe 31 paquetes. |
| **Destino** bloqueado por cierres (`findMensajerosBloqueadosPorCierres`) | Sí | R11. Regla de la 271: **recibir trabajo nuevo** sí se bloquea. |
| **Origen** bloqueado por cierres | **No** | R12. Criterio explícito de la 149: quitarle trabajo a quien está atascado es lo contrario de dárselo — y el caso de la ficha es alguien que **no puede seguir**. Bloquearlo aquí atraparía exactamente el caso que la ficha existe para desatascar. |
| Dedicación 157 (destino con recolección pendiente) | Sí | R13. Quien tiene un viaje a tienda comprometido no puede además llevar reparto. |
| Tope de intentos (276) | **No** | R14. Esa puerta existe para que una orden agotada **no salga a la calle**. Ya está en la calle. Aplicarla dejaría el paquete en manos de un enfermo y sin salida; y el traspaso no cuenta ningún intento. |
| Gate de coordenadas (92) | **No** | R14. La orden ya pasó ese gate al asignarse. Sin coordenadas sólo se pierde su sitio en la ruta optimizada —queda de parada sin posicionar, al final—, que es un problema de orden de visita, no de custodia. |
| Reprogramada bloqueada (46) | No aplica | `reprogramada` no es un estado traspasable: R5 la rechaza antes. |
| Bodega satélite bloqueada (41) | No aplica | Sólo hay superficie central en esta ficha (Q1). |

Estas dos ausencias (tope y coordenadas) van **escritas en el servicio**, no omitidas: el precedente
del repo es que una guarda ausente sin razón escrita se vuelve a cablear sin releer por qué se quitó.

---

## 9. La línea de tiempo de la orden (R29)

`lib/types/orden-historial.ts` gana una **tercera clase**:

```ts
export interface OrdenHistorialTraspasoDTO {
  clase: "traspaso_mensajero";
  mensajeroAnteriorNombre: string;
  mensajeroNuevoNombre: string;
  actorNombre: string;
  actorRol: RolValue;   // el CONGELADO de la fila, nunca el vivo
  motivo: string;
  createdAt: Date;
}
```

`OrdenHistorialEntradaDTO` pasa a ser unión de tres. Eso hace que `RANGO_POR_CLASE`
(`OrdenHistorialService.ts:39`) **deje de compilar** hasta que se decida el rango de la clase nueva
— está escrito así a propósito. Rango propuesto: `traspaso_mensajero: 2` (empate exacto de instante:
primero la transición, luego la corrección de día, luego el traspaso), y
`fusionarLineaDeTiempo(transiciones, correcciones, traspasos)` gana su tercer parámetro.

`OrdenHistorialService` inyecta un repositorio más (`OrdenTraspasoRepository.findTraspasosByOrden`),
igual que ya inyecta el de correcciones. **La autorización de lectura no cambia**: quien ve el
historial de la orden ve también sus traspasos, con los mismos recortes por rol de hoy.

`tests/unit/guards/rastreo-frontera.guardia.test.ts` **no** cambia: el rastreo público no importa
`OrdenHistorialEntradaDTO`, y esta ficha no le añade ningún hito (R21).

---

## 10. La pantalla

- **Dónde:** `app/(app)/ordenes/_components/OrdenesListado.tsx`, en `accionesDe`, `case
  "en_reparto"` y `case "ayuda_tienda"` (hoy devuelven sólo `accionCambiarDia`): se añade
  «Traspasar a otro mensajero». No hay pantalla nueva ni ruta nueva (R34).
- **Modal `TraspasarMensajeroModal`**: cuerpo de `DeshacerAsignacionModal` (motivo obligatorio,
  confirmación deshabilitada hasta que valide, una sola llamada con el lote completo) + selector de
  mensajero de `AsignarBodegaModal` (con sus marcadores de bloqueado / sin vehículo / no asignable,
  que ya llegan por `listarMensajerosParaAsignacion`). El **origen se muestra, no se elige**: sale
  de la selección (R8/R35).
- **Texto de confirmación (R35):** «Vas a pasar **N órdenes** de *Andy Cortés* a *Carlos Eduardo*».
- **Éxito (R36/R33):** «Se movieron 31 órdenes y 31 conversaciones. La ruta de Carlos Eduardo se va
  a recalcular; hasta entonces las paradas nuevas aparecen al final de su recorrido.» Y
  `onSuccess()` reválida como las demás acciones.
- El selector de destino **excluye al origen** en la lista (R7 ya lo rechaza en el servidor; la UI no
  puede ofrecer lo que el servidor va a rechazar — la lección del incidente del 18/08).

---

## 11. Alternativas descartadas

**A1 — Extender `DeshacerAsignacionService` con `en_reparto` y encadenar «deshacer + asignar».**
Descartada. (a) Deshacer **devuelve el paquete a la bodega** derivando el destino del historial; el
paquete está en una moto, así que escribiría un estado falso. (b) La reasignación exigiría volver a
pasar el gate de coordenadas y el tope de intentos, y bloquearía órdenes que ya están en la calle.
(c) Dejaría dos transiciones de estado falsas en el historial de cada orden. Era el camino corto y
falsifica la custodia, que es precisamente lo que la 149 documenta como riesgo.

**A2 — Añadir una arista `en_reparto → en_reparto` al inventario de transiciones y usar
`orden_historial_estado` como rastro.** Descartada: convertiría el registro de **estados** en un
registro de cualquier cosa, y una arista de un estado a sí mismo rompe la lectura de la máquina de
estados para las doce features que la consultan. Además `OrdenHistorialOrigenTipo` es el censo
cerrado de familias que **escriben `orden.estatus_id`**; añadirle un valor que no escribe ningún
estado sería una migración y una mentira.

**A3 — Registrar el traspaso sólo en `historial_accion` (362).** Descartada: el motivo es texto
libre tecleado por una persona y R5 de la 362 lo deja fuera de esa tabla a propósito (se descarga a
un archivo y no se purga nunca), y `valor_anterior`/`valor_nuevo` son `VarChar(60)` de vocabulario
**cerrado** — un nombre de persona no lo es. Precedente exacto: 262 y 371 crearon tabla propia por
esta misma razón. Queda como Q6 por si el humano quiere **además** la fila del catálogo.

**A4 — «Traspasar todo lo del mensajero» como operación de servidor.** Descartada en §1: predicado
vivo ⇒ se movería lo que el coordinador no vio, y cierra la puerta a repartir la mitad.

**A5 — Mover sólo `orden.mensajero_asignado_id` y dejar el chat como está.** Descartada porque **es
el defecto medido**: el destino se queda con hilo vacío, ventana cerrada y sólo plantilla, y el
origen tampoco lo ve (falla la puerta de propiedad de la orden). El hilo quedaría inalcanzable para
los dos. Fue el hallazgo que el arreglo manual pagó.

**A6 — Reponer el mensajero también en las gestiones ya registradas (`gestion_orden.mensajero_id`).**
Descartada y prohibida (R20): esa columna es **el actor** que registró la gestión. Reescribirla haría
que las 37 entregas de Andy pasaran a contar como de Carlos, movería el pago al mensajero, el cierre
del día y el ranking, y dejaría a Andy sin cierre que aprobar.

**A7 — Recalcular la ruta de forma síncrona dentro de la operación.** Descartada: llamar al
proveedor de optimización dentro de la transacción la alarga con una llamada de red facturada, y su
fallo tumbaría un traspaso que ya es correcto. La 92 ya resolvió esto con el outbox + debounce; se
reusa (§6.4).

---

## 12. Límites declarados

1. **Más de 50 órdenes ⇒ dos actos** (§1, Q5).
2. **Una gestión en vuelo del origen se pierde limpiamente**: si el mensajero de origen tenía el
   modal de gestión abierto sobre una orden traspasada, su envío será rechazado por la guarda de
   propiedad que ya existe (`MisAsignacionesService`: `row.mensajeroAsignadoId !== actor.usuarioId`).
   No hay corrupción, pero sí una sorpresa. No se añade guarda nueva: el caso real es un mensajero
   que **no puede seguir**.
3. **La ruta del origen queda con paradas que ya no son suyas** hasta que su job corra (≤ ~1 min).
   La lectura de su ruta cruza contra sus órdenes `en_reparto`, así que no ve órdenes ajenas; lo que
   ve es un recorrido con huecos.
4. **El ranking y la analítica del día se mueven con la asignación** (Q2). No se toca nada.
5. **El rastro no dice por qué el origen no podía seguir**, sólo el motivo escrito por quien
   traspasó. Es la misma profundidad que el motivo del deshacer.
