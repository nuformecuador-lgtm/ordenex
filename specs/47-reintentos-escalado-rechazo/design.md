# Feature 47 — Reintentos de entrega y escalado a rechazo — design.md

> El CÓMO técnico. Primero el MAPA del estado actual (archivo:símbolo:línea), porque el
> valor de la feature es enchufarse a la máquina de estados y al historial de la 49 SIN
> duplicar contador ni saltarse el choke point. Todos los símbolos son reales (verificados
> con Grep/Read sobre la rama `feature/47-...`, post-49).

---

## 1. MAPA del estado actual — `devuelta` / `rechazada` hoy

### 1.1 Catálogo `order_status` (`lib/types/order-status.ts:ORDER_STATUS_SEED:19-33`)

Los tres estados relevantes YA existen en el catálogo sembrado:

- `devuelta` (L21) — hoy es el destino de una gestión `resultado=devuelta`. **Terminal de
  facto:** la orden se queda ahí, no hay reintento. La 47 la vuelve INTERMEDIA/reintentable.
- `rechazada` (L31, feature 36) — destino de una gestión `resultado=rechazada`. FINAL.
- `devuelta_origen` (L22) — existe en el catálogo pero **ningún call-site lo escribe hoy**
  (confirmado con el test de cobertura de la 49). Reservado a la **feature 48**. La 47 NO lo toca.
- Bodegas de reintento: `en_bodega` (L26, central) y `en_bodega_satelite` (L32, satélite).

### 1.2 Cómo una gestión llega hoy a `devuelta` / `rechazada`

| Punto | archivo:símbolo:línea | Comportamiento HOY |
| --- | --- | --- |
| Orquestador | `lib/services/MisAsignacionesService.ts:gestionar:127-204` | Resuelve `nuevoEstatusId = ordenRepo.findEstatusIdByValue(input.resultado)` (**L157**). Para `devuelta` NO hay rama especial: destino = `devuelta`. Valida monto sólo en `entregada` (L143-155). Sube evidencia en `entregada`/`rechazada` (L166-177). |
| Constructor de datos | `lib/services/MisAsignacionesService.ts:buildGestionData:258-288` | Rama `devuelta` (**L278-279**): sólo `{ resultado, motivo }`, sin evidencia ni monto. |
| Escritura de estado (#9 del mapa 49) | `lib/repositories/GestionOrdenRepository.ts:crearGestionYTransicionar:184-239` | `$transaction`: (a) pre-lee estatus origen (`en_reparto`, L193-196); (b) `create` gestión (L197-213); (c) `orden.update estatus=nuevoEstatusId` (**L214-217**); (d) limpia el puntero `orden_en_gestion_id` (L219-222); (e) `appendCambioEstado` con `origen_tipo=gestion`, `actor=mensajero`, `gestion_orden_id`, `motivo` (L226-236). **No** limpia `orden.mensajeroAsignadoId`. |

**Conclusión del mapa:** hoy `devuelta` es un callejón sin salida. La feature 47 interviene
en la RAMA `devuelta` para: (1) contar intentos, (2) decidir reintento vs escalado, (3)
añadir la transición de seguimiento en la misma tx. `entregada`/`reprogramada`/`rechazada`
directa quedan intactas (R19).

### 1.3 Piezas de la 49 y de features previas que la 47 REUTILIZA (no reimplementa)

| Pieza | archivo:símbolo:línea | Uso en la 47 |
| --- | --- | --- |
| Choke point de append | `lib/repositories/registrar-cambio-estado.ts:appendCambioEstado:21-37` | La transición de seguimiento (`devuelta → bodega`/`devuelta → rechazada`) se registra por aquí, en la misma tx (R10/R11). |
| Derivador de intentos | `lib/services/OrdenHistorialService.ts:contarIntentos:49-56` | Cuenta transiciones a `devuelta`. La 47 lo LEE (R1/R2). |
| Conteo por destino | `lib/repositories/OrdenHistorialRepository.ts:contarPorDestino:75-79` | Query base del derivador (usa índice `(orden_id, estatus_destino_id)`). |
| Ruteo a bodega responsable | `lib/utils/bodega-responsable.ts:resolverDestinoCierre:16-23` | Deriva `bodega_central`/`bodega_satelite` de `zonaId` + `centralZonaId` → `en_bodega`/`en_bodega_satelite` (R5). |
| Zona central | `IZonaRepository.findCentralZonaId:57` (`ZonaRepository`) | Insumo de `resolverDestinoCierre`. |
| Patrón "volver a bodega" | `lib/services/LiberacionReprogramadaService.ts:ejecutarLiberacion:43-103` y `lib/repositories/LiberacionReprogramadaRepository.ts:liberarOrden:70-101` | Referencia: transiciona a bodega, limpia `mensajeroAsignadoId`, actor NULL, append en tx (R5/R6). |
| Resolver estatus por value | `IOrdenRepository.findEstatusIdByValue:221` | Resolver ids de `en_bodega`/`en_bodega_satelite`/`rechazada`. |
| Test de cobertura (49) | `tests/unit/repositories/orden-historial-cobertura.test.ts` (11 puntos) | Se ACTUALIZA para incluir la escritura de seguimiento (R14). |
| UI línea de tiempo (49) | `app/(app)/ordenes/_components/HistorialOrdenTimeline.tsx`, `HistorialOrdenSheet.tsx`, `estatus-label.ts` | Superficie donde se muestra el nº de intentos (R15/R16). |

---

## 2. Diseño del reintento/escalado (dónde se engancha, transacción, choke point)

### 2.1 Dónde vive la REGLA (service) vs la ESCRITURA (repo)

La regla de negocio (umbral, decisión reintento/escalado, ruteo a bodega) vive en el
SERVICE; el repo sólo ejecuta las escrituras (patrón de capas, `docs/architecture.md`).
Concretamente, en `MisAsignacionesService.gestionar`, para la rama `input.resultado ===
"devuelta"`:

1. Leer el conteo previo de intentos: `contarIntentos(ordenId)` = `intentosPrevios`
   (derivador de la 49, R1/R2). Se lee ANTES de la tx; ver §2.3 sobre concurrencia.
2. `intentoActual = intentosPrevios + 1`.
3. Resolver el umbral: `reintentosConfig.MIN_INTENTOS_ENTREGA` (R3, `lib/config/reintentos.ts`).
4. Decidir el SEGUIMIENTO:
   - **`intentoActual >= umbral` → ESCALADO:** destino de seguimiento = `rechazada` (final);
     actor de seguimiento = `null` (sistema); NO se limpia `mensajeroAsignadoId` (mismo trato
     que un rechazo directo, deja el rastro del último mensajero para la feature 48).
   - **`intentoActual < umbral` → REINTENTO:** destino de seguimiento =
     `resolverDestinoCierre(orden.zonaId, centralZonaId)` → `en_bodega`/`en_bodega_satelite`;
     actor de seguimiento = `null` (sistema); SÍ se limpia `mensajeroAsignadoId` (handoff a la
     bodega, patrón 46, R6).
5. Llamar al repo (§2.2) con la gestión + la transición de seguimiento resuelta.

`orden.zonaId` (`IOrdenRepository` DTO L135, `string | null`) hoy NO viene en
`OrdenGestionRow` (`IGestionOrdenRepository.ts:35-41`): la implementación DEBE añadir
`zonaId` a la proyección `findByIdsParaGestion`. Edge case: si `zonaId` es `null` (orden sin
zona), el reintento cae a `en_bodega` (central) como fallback seguro.

### 2.2 La ESCRITURA compuesta (repo, una sola transacción)

Se EXTIENDE `GestionOrdenRepository.crearGestionYTransicionar` (#9) para aceptar un
seguimiento opcional, o se añade un método hermano `crearGestionDevueltaYResolver`. En la
MISMA `$transaction` (R8/R10/R11):

1. Pre-leer estatus origen (`en_reparto`) — como hoy.
2. `create` gestión `resultado=devuelta` (con `motivo`).
3. `orden.update estatus = devuelta` + `appendCambioEstado` `[{ origen: en_reparto, destino:
   devuelta, actor: mensajero, origen_tipo: gestion, gestion_orden_id, motivo }]` — la fila
   que el derivador CUENTA (R11). (Mantiene el comportamiento actual de la rama devuelta:
   la orden pasa físicamente por `devuelta`, honrando la 49/R20.)
4. Aplicar el SEGUIMIENTO:
   - `orden.update estatus = <destinoSeguimiento>` (`en_bodega`/`en_bodega_satelite` o
     `rechazada`), limpiando `mensajeroAsignadoId` sólo en el caso reintento (R6).
   - `appendCambioEstado` `[{ origen: devuelta, destino: <seguimiento>, actor: null,
     origen_tipo: gestion, gestion_orden_id }]` (R10/R11).
5. Limpiar el puntero `orden_en_gestion_id` — como hoy.

Resultado: una gestión `devuelta` deja DOS filas de historial (`en_reparto → devuelta` y
`devuelta → <bodega|rechazada>`) y la orden NUNCA reposa en `devuelta` (R7). Atómico: si algo
falla, todo revierte (R10).

### 2.3 Concurrencia (por qué leer el conteo antes de la tx es seguro)

El puntero de bloqueo 1-a-1 del mensajero (`usuario.orden_en_gestion_id`,
`GestionOrdenRepository.setOrdenEnGestion:116-129`) garantiza que una orden sólo puede ser
gestionada por su mensajero asignado y de una en una: no puede haber dos gestiones `devuelta`
concurrentes sobre la misma orden. Por eso `intentosPrevios` leído justo antes de la tx no
sufre TOCTOU en la práctica. **Endurecimiento opcional** (si el reviewer lo exige): recontar
`contarPorDestino(devuelta)` DENTRO de la tx y pasar el umbral al repo; se descarta como
default por meter la regla de negocio en el repo.

---

## 3. Modelo de conteo derivado (sin materializar)

- **Fuente única:** el historial de la 49. Intentos = `count(orden_historial_estado where
  orden_id = ? and estatus_destino_id = <id de 'devuelta'>)` vía
  `OrdenHistorialRepository.contarPorDestino` (usa el índice `(orden_id, estatus_destino_id)`
  que la 49 ya creó para esto, design 49 §1.1).
- La 47 expone la lectura para la UI como `contarIntentos(ordenId)` (ya existe en
  `OrdenHistorialService`, R1/R2) — reutilizada tal cual, sin cambios de contrato.
- **Sin columna `orden.intentos`** (descartado, §7). La decisión reintento/escalado se toma
  con el conteo derivado + el umbral configurable.

---

## 4. Config del umbral (R3)

Nuevo `lib/config/reintentos.ts`, patrón `lib/config/ordenes.ts`/`gestion.ts`:

```ts
export interface ReintentosConfig {
  /** Mínimo de intentos de entrega por ley antes de escalar a rechazo. Default 3. */
  MIN_INTENTOS_ENTREGA: number;
}
export function loadReintentosConfig(): ReintentosConfig {
  return { MIN_INTENTOS_ENTREGA: readPositiveInt("REINTENTOS_MIN_INTENTOS", 3) };
}
export const reintentosConfig: ReintentosConfig = loadReintentosConfig();
```

`readPositiveInt` (mismo helper que `ordenes.ts`) garantiza entero ≥ 1; ausente/ inválido →
3. Sin hardcode (`docs/architecture.md`: "Sin hardcode de contexto").

---

## 5. Frontend: nº de intentos (R15/R16/R17)

- **Superficie:** la lista de órdenes (`OrdenesModule.tsx`/`OrdenesRevisionMaestro.tsx`) y el
  sheet de historial de la 49 (`HistorialOrdenSheet.tsx`/`HistorialOrdenTimeline.tsx`).
- **Dato:** el conteo de intentos derivado, pre-fetcheado en el servidor (Server Action /
  service, patrón de la 49; datos por props, nunca fetch de datos sensibles en el cliente).
  Se puede exponer junto al historial (la action de la 49 devuelve las entradas; el conteo de
  destinos `devuelta` se deriva de ellas o se añade al DTO) o como un campo agregado en la
  fila de la lista.
- **Presentación:** badge/columna "Intento X de N" (N = umbral) reutilizando `estatus-label`
  para nombres legibles (R16). Sólo visible según la visibilidad de la orden (R17), reusando
  la autz de la 49/R27 (no se añade regla de permisos nueva).
- **Sin sobre-ingeniería:** no se crea una página de "Devoluciones" (F1.4-g alternativa); el
  conteo cabe en las superficies existentes.

---

## 6. Actualización del test de cobertura de la 49 (R14)

`tests/unit/repositories/orden-historial-cobertura.test.ts` fija hoy el conjunto CERRADO de
11 puntos de escritura de `orden.estatus_id`, con la invariante "cada `origen_tipo` aparece
UNA sola vez" y "son EXACTAMENTE 11". La 47 introduce una escritura de estado de SEGUIMIENTO
(`devuelta → bodega`/`devuelta → rechazada`) dentro de la transacción de la gestión.

Con la sub-decisión recomendada (reutilizar `origen_tipo = gestion`, §2.2), la actualización
del test es:
- Documentar que el punto #9 (`crearGestionYTransicionar`) ahora emite una transición
  COMPUESTA: la gestión + su seguimiento automático (actor NULL), ambas con `origen_tipo =
  gestion`. El seguimiento no es un método nuevo ni un `origen_tipo` nuevo → no rompe el
  recuento de 11, pero SÍ se anota explícitamente en el inventario para que el reviewer sepa
  que #9 escribe destinos `en_bodega`/`en_bodega_satelite`/`rechazada` además de los 4
  resultados de gestión.
- Añadir aserciones específicas de la 47 (en tests de integración, no en el de cobertura):
  la gestión `devuelta` deja DOS filas de historial (devuelta + seguimiento) por el choke
  point.

**Si en la aprobación se elige la variante con enum nuevo** (F1.4-f alternativa): el test de
cobertura crece a 12/13 puntos con `origen_tipo` distintos (`reintento_devolucion`,
`escalado_rechazo`); la invariante "cada tipo una vez" se mantiene, pero se paga la migración
`ALTER TYPE ... ADD VALUE` (§7).

---

## 7. Migración: NO se requiere (recomendado) — y la alternativa con enum

**Recomendado:** ninguna migración.
- `order_status` NO cambia: `devuelta`, `rechazada`, `en_bodega`, `en_bodega_satelite` ya
  están sembrados (`ORDER_STATUS_SEED`).
- Contador NO materializado: se deriva del historial de la 49.
- `origen_tipo` reutilizado (`gestion`): sin `ALTER TYPE`.

**Alternativa (descartada por coste de reversibilidad):** añadir valores al enum
`orden_historial_origen_tipo` para autodescribir el seguimiento:
- UP: `ALTER TYPE "orden_historial_origen_tipo" ADD VALUE 'reintento_devolucion'; ADD VALUE
  'escalado_rechazo';`
- DOWN: Postgres no permite `DROP VALUE`; el `down.sql` tendría que RECREAR el enum (crear
  tipo nuevo sin los valores, `ALTER TABLE ... ALTER COLUMN ... TYPE ... USING`, `DROP TYPE`
  viejo, `RENAME`), frágil si ya hay filas con los valores nuevos. El round-trip R32 lo exige
  reversible. **Por qué se descarta:** el seguimiento ya es identificable sin enum nuevo (par
  `devuelta → rechazada`/`devuelta → bodega` + `actor = null` + `gestion_orden_id`), y evitar
  la migración de enum reduce riesgo. Queda como opción a mano si el humano prioriza la
  autodescripción del historial.

---

## 8. Estrategia de tests (cómo se prueba)

- **Unit de la regla de umbral / decisión** (service, con dobles): `intentoActual < umbral`
  → destino de seguimiento = bodega derivada de zona (central/satélite); `intentoActual ==
  umbral` → `rechazada`; `> umbral` (defensivo) → `rechazada`. Umbral configurable: con
  `REINTENTOS_MIN_INTENTOS=5`, la 5ª devolución escala, no la 3ª. (R3/R5/R8/R9)
- **Unit "qué cuenta"** (R4): una `reprogramada` intercalada NO cambia `intentoActual`
  (el derivador sólo cuenta `devuelta`).
- **Integración `devuelta → bodega`** (R5/R6/R11): con dobles del repo dentro de la tx, la
  gestión `devuelta` bajo umbral deja DOS filas de historial (`en_reparto→devuelta`,
  `devuelta→en_bodega`/`en_bodega_satelite` según zona), la orden queda en bodega y
  `mensajeroAsignadoId` limpio, `num_guia` intacto.
- **Integración `devuelta → rechazada`** (R8/R9/R10/R11): la N-ésima devolución (N=umbral)
  deja `devuelta→rechazada` con `actor=null`, la orden queda en `rechazada` (final),
  `mensajeroAsignadoId` conservado.
- **Atomicidad** (R10): simular fallo en la escritura de seguimiento → revierte la gestión y
  la transición a `devuelta` (nada persiste).
- **No-regresión** (R19): `entregada`/`reprogramada`/`rechazada` directa se comportan igual
  (una sola transición, sin seguimiento); tests previos de 36/46/49 verdes.
- **Cobertura** (R14): el test de cobertura de la 49 refleja el seguimiento de #9 (§6).
- **Derivador** (R1/R2): N devueltas → `contarIntentos` = N; 0 → 0 (reusa el test de la 49).
- **UI** (R15/R16/R17): render del badge "Intento X de N" con conteo derivado; visibilidad
  por rol (adminTienda ajena no ve; mensajero no asignado no ve).
- **E2E (flujo crítico, ingesta/recaudo adyacente):** una orden recibe 3 devoluciones
  consecutivas (con re-asignación entre ellas): tras la 3ª, queda `rechazada` y la UI muestra
  "intento 3 de 3"; la línea de tiempo muestra las 3 devoluciones y el escalado.

---

## 9. Alternativas descartadas (obligatorio)

### 9.1 Job/cron diario de escalado — DESCARTADA (F1.4-c)
Un job que revise a diario órdenes con ≥ umbral devoluciones y las escale (patrón de la
liberación 46). **Por qué se descarta:** introduce latencia entre "3ª devolución" y "rechazo",
un estado transitorio ambiguo ("devuelta pendiente de escalar"), y no-determinismo, sin
beneficio: el conteo y la decisión ya están disponibles en la MISMA transacción de la gestión
`devuelta`, así que el escalado síncrono es determinista y más simple. La liberación 46 usa
job porque depende de una FECHA futura (reprogramación); aquí el disparador es el propio
evento de devolución.

### 9.2 Columna materializada `orden.intentos` — DESCARTADA (F1.4-a de la 49 y de la 47)
Incrementar `orden.intentos` en cada devolución sería más rápido de leer, pero duplica un
estado ya derivable del historial de la 49 y puede divergir (dos fuentes de verdad). El
derivador `COUNT` sobre el índice `(orden_id, estatus_destino_id)` es suficiente y ya existe.
Además exigiría una migración (columna nueva) que el diseño recomendado evita.

### 9.3 Valores de enum `origen_tipo` nuevos para el seguimiento — DESCARTADA (F1.4-f/h)
Ver §6/§7: autodescribiría el historial pero cuesta una migración `ALTER TYPE ADD VALUE` con
`down.sql` que recrea el enum (reversibilidad frágil). El seguimiento ya es identificable por
`(origen=devuelta, destino, actor=null, gestion_orden_id)` con `origen_tipo=gestion`. Se
conserva como variante a decisión del humano en la puerta de aprobación.
