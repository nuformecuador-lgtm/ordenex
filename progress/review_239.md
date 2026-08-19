# Revisión — Feature 239 · La devolución espera al cierre, y el reloj espera con ella

> Rama `feature/239-devolucion-espera-cierre` · HEAD `bb0748c0` · base `origin/dev` = `9f80b57f`
> (re-comprobada al cerrar la revisión: **`origin/dev` sigue en `9f80b57f`**, el pre-vuelo NO
> caducó). PR **#398**, `MERGEABLE`, 97 archivos.
> Revisión del 2026-08-19. Todo lo que aquí se afirma está medido en esta sesión salvo lo marcado
> como heredado del implementador.

**Veredicto: `OK`. 0 bloqueantes · 9 menores.**

---

## 1 · El gate, corrido por el revisor

`./init.sh` completo, con el árbol quieto (ningún subagente mutando en paralelo):

```
✓ regla max-2-por-zona respetada (in_progress=2)
✓ specs presentes para features sdd en vuelo
✓ typecheck paso
✓ lint paso                 ✖ 89 problems (0 errors, 89 warnings)
 Test Files  1186 passed (1186)
      Tests  15269 passed | 26 skipped (15295)
   Duration  307.63s
✓ test paso
exit = 0
```

Coincide **exactamente** con la cifra de cierre de `progress/impl_239.md` (1186 / 15269). Los 89
avisos de lint son preexistentes (`no-unused-vars` en dobles de test), ninguno en archivos de esta
feature.

Hashes de los tres archivos de producción críticos al terminar la revisión, **idénticos** a los que
la bitácora dejó anotados y a los del árbol antes de tocar nada:

| Archivo | sha256 |
| --- | --- |
| `lib/repositories/CierresAdminRepository.ts` | `e3534a98…14aa1f` |
| `lib/repositories/DevolucionSlaRepository.ts` | `c7d2f680…daf33c` |
| `lib/repositories/OrdenRepository.ts` | `b9ff3f12…c642d7` |

`git status` limpio.

---

## 2 · Lo primero: ¿el fallo está de verdad cerrado?

**Sí, y por construcción, no por convención.** Verificado de forma independiente:

### 2.1 No hay ningún camino a `devuelta` que no pase por el anclaje

`TRANSICIONES` declara **una sola arista de entrada** a `devuelta`:

```
{ to: "devuelta", via: "anclaje_devolucion", rol: "admin (aprobar cierre)" }   // #60
```

La antigua `en_reparto → devuelta` (#14) está **retirada** en el mismo commit que su último
productor, y el mapa `ESTATUS_POR_RESULTADO` (`lib/types/gestion-destino.ts`) manda la gestión del
mensajero al pre-estado. Censado además todo el árbol: **ningún otro módulo escribe
`estatus = devuelta`**. `ReprogramacionTiendaService`, `RecuperacionBodegaService` y
`RecepcionSateliteService` solo lo **leen** como estado de origen.

Y no es una declaración decorativa: `appendCambioEstado` valida **todo el lote contra
`TRANSICIONES` antes de escribir**, con fallo cerrado (`TransicionNoValidableError` si no puede
resolver el catálogo), y el `createMany` va **sin** `skipDuplicates`. Una escritura de estado que no
sea el anclaje no llega a `devuelta`: revienta la transacción.

**Consecuencia comprobada:** la rama legada de R14 (`origenAncla: "legado"`, que reancla en la fecha
de la gestión, o sea el comportamiento viejo) **no tiene productor nuevo**. Solo puede dispararla
población anterior al despliegue, y esa población está medida en **0 en producción el 2026-08-19**.

### 2.2 El cron no puede verla antes de tiempo

`findDevueltasSla` filtra por **igualdad** `estatus = { value: "devuelta" }`, ni `in` ni `notIn`, así
que el pre-estado no entra por omisión ni por lista negra. Es literalmente el mismo predicado que
`novedadWhere`. Las dos mitades miran el mismo hecho.

Comprobado además que **nada saca una orden del pre-estado por la puerta de atrás**:

- el corte nocturno (`corte_sin_gestionar`, `CierreDiaRepository:449`) acota por
  `estatusId = en_reparto`: una orden congelada en el pre-estado **no se barre**;
- la gestión sintética que el cron crea al escalar es `resultado: "rechazada"`
  (`DevolucionSlaRepository:197`), **no `devuelta`**: no puede robar la recencia del anclaje;
- el pre-estado no tiene arista de `recuperacion_manual` (P4 firmada en contra) ni hacia
  asignación, ruteo o recolección, afirmado sobre el grafo en `orden-repository.test.ts`.

---

## 3 · La transacción del dinero

### 3.1 Posición del bloque: correcta, y por una razón más fuerte que la del design

El bloque va **al final** de la rama `aprobado`, después de `devolucionRechazadas`
(`CierresAdminRepository:1233`). El design lo justificaba por no mover aserciones de orden. La razón
real es más limpia, y se verificó archivo por archivo:

| Feed | Qué lee dentro de la tx |
| --- | --- |
| `WalletFeedService` | `tx.gestionOrden.findMany` |
| `WalletTiendaFeedService` | `tx.gestionOrden.findMany` |
| `CajaCodFeedService` | `tx.walletTiendaMovimiento.findMany` |
| `WalletMensajeroFeedService` | `tx.cierreDia.findUnique` |
| `WalletIndemnizacionFeedService` | `tx.gestionOrden.findMany` |

**Ninguno de los cinco lee `orden`.** Ni `estatus_id` ni ninguna otra columna: los cinco derivan del
snapshot (`cierre_detail`), de `gestion_orden` y del ledger. Así que el bloque nuevo, cuyo `data`
lleva **solo** `estatusId`, no puede alimentar a ningún feed, esté donde esté. Y en sentido inverso:
los dos bloques anteriores mueven `sin_gestionar → bodega` y `rechazada → por_devolver`, ninguno
toca el pre-estado ni `devuelta`. **No hay lectura sucia en ninguna dirección.**

### 3.2 `cierres-admin-caja-cod.test.ts`: entra en el bloque, pero pasa de largo

Medido, no supuesto. Se instrumentó el bloque con un `throw` en su primera línea
(`if (anclajeDevolucion) { throw … }`) y se corrieron las siete suites de la transacción:

```
Test Files  7 failed (7)
     Tests  48 failed | 51 passed (99)
Error: MUT-REVIEW: el bloque de anclaje SE EJECUTO
 ❯ lib/repositories/CierresAdminRepository.ts:1258
 ❯ Object.<anonymous> tests/unit/repositories/cierres-admin-caja-cod.test.ts:133
```

Restaurado desde copia del original · sha256 posterior `e3534a98…14aa1f`, **idéntico** al de antes;
`git status` limpio.

Lectura del resultado, en dos partes:

- **Sí entra.** `caja-cod` atraviesa el bloque y ejecuta su primera consulta. El bloque está en el
  camino real de esa suite, no en una rama muerta.
- **Pero no lo mide.** Su doble devuelve `gestionOrden.findMany → []`, así que el bloque es un no-op
  ahí, y su `traza` solo registra `escribe-ledger` / `lee-ledger`. **Si alguien moviera el bloque al
  principio de la rama `aprobado`, esa suite seguiría verde.** No es un defecto —la posición es
  genuinamente libre porque ningún feed lee `orden` (§3.1)— pero su verde no se puede citar como
  «el orden del bloque nuevo está medido», porque no lo está.

Lo que **sí** ejercita el bloque junto al dinero es `tests/integration/db/wallet-idempotencia.test.ts`:
monta tres órdenes (`o1` entregada, `o2` devuelta de ESTE cierre, `o3` devuelta de OTRO cierre como
testigo), corre la transacción completa con los feeds, y afirma el `where` exacto, el `data`
money-neutral y la idempotencia en la segunda pasada. Ahí el doble **honra el `where`**, así que la
guarda por `estatus_id` se prueba de verdad en vez de afirmarse de palabra.

### 3.3 Money-safe

`data: { estatusId: devueltaId }` y nada más, con igualdad **exacta** en el test (no
`toMatchObject`) y tres `not.toHaveProperty` explícitos. Las guardias `ordenes-columnas-money-safe`
y `dinero-sin-centimos`, verdes sin tocarse. Ningún `Number()` ni `toNumber()` nuevo. R10 y R11
cumplidos.

---

## 4 · La carrera de los dos cierres

El recorte por recencia se hace **dentro de la transacción**, con una sola consulta ordenada
(`orderBy: [{ordenId:'asc'},{createdAt:'desc'}]`) y recorte en memoria; no un `findFirst` por orden,
que sería un N+1 en la transacción más cara del sistema.

Intenté romperla por caminos que la bitácora no recorre. Los cinco quedan cerrados:

| Intento | Resultado |
| --- | --- |
| **Doble aprobación del mismo cierre** | Imposible dos veces: `ESTADOS_RESOLUBLES = solicitado\|vencido` y `forzarSolicitudVencido` solo reabre `ESTADOS_REABRIBLES = vencido\|rechazado`. **Un cierre `aprobado` no se puede reabrir jamás.** Doble barrera con la guarda por pre-estado. |
| **Gestión anulada que roba la recencia** | Cubierto por caso propio (`anuladaAt: null` en las dos consultas) y por la aserción exacta del `where`. |
| **Gestión más nueva de otro resultado** (`entregada`) que bloquee el anclaje | El `where` de la segunda consulta se afirma por igualdad exacta, `resultado: "devuelta"` incluido. |
| **`orderBy` invertido** (el fallo silencioso que ancla con el cierre viejo) | Doble caza: la aserción literal del `orderBy` y el caso «aprobar el cierre VIEJO no ancla», cuyo doble respeta el orden. |
| **Gestión sintética del cron** colándose como «devuelta vigente más reciente» | No aplica: la sintética es `resultado: "rechazada"`. |

La mutación obligatoria (retirar el filtro de recencia) la midió el implementador con salida real y
hash idéntico antes y después. El conjunto de prueba
(`g1(o1,c1,T0) · g2(o1,c2,T1) · g3(o2,c1,T0)`) **no** hace la mutación un no-op: el recorte es por
orden y no por cierre, y el caso lo comprueba con dos órdenes de desenlace distinto.

---

## 5 · Tests que pasan sin comprobar nada: el barrido

Lo que se buscó y lo que se encontró:

- **Aserciones filtradas.** El `.filter(c => c.where.id !== undefined)` está **retirado** de los
  cuatro sitios (tres bloques de `cierres-admin-repository.test.ts` más el helper de
  `…resolverCierre.devolucion.test.ts`). Además, el fake de esa suite pasó de `args.where.id?.in`
  (opcional) a `args.where.id.in` (obligatorio): una escritura sobre `orden` sin `id` ahora
  **revienta el doble** en vez de colarse. La guardia `aprobacion-escrituras-cubiertas` vigila que
  el patrón no vuelva y **sabe ponerse roja**, con autocomprobación sobre las dos formas literales
  que vivían en el árbol y sobre los tres falsos positivos que hundieron su primera versión.
- **Controles anclados en algo que ya no existe.** Ninguno. Los inventarios congelados (catálogo
  20→21, enum 26→27, transiciones 54→56, puntos de escritura 26→27) se actualizaron **con nota
  fechada y motivo**, y siguen siendo literales, no derivaciones del propio código.
- **Censos vacíos.** Las tres guardias nuevas llevan anti-vacuidad explícita:
  `gestion-aprobada-retirada` exige más de 500 ficheros barridos y prueba las dos formas del nombre;
  `anclaje-vs-intentos` exige más de 200 ficheros y que cada detector encuentre sus símbolos en el
  árbol real; `aprobacion-escrituras-cubiertas` exige al menos 3 escrituras censadas. Todas escritas
  **en un archivo**, nunca por `node -e`.
- **Dobles mudos.** Los tres que importan honran el `where`: el de
  `cierres-admin-anclaje-devolucion` (gestión y orden), el de `wallet-idempotencia` (guarda por
  `estatus_id`) y el de los emuladores `resolver-novedad-*` (filtro por `origenTipo`, `orderBy` y
  `take` del historial). Un `{count:1}` a ciegas dejaría pasar una versión sin guarda; aquí no.
- **Semillas no portantes.** Los dos emuladores de integración ganan una aserción que hace la fila
  de anclaje *load-bearing* («el cron ancla en la APROBACIÓN, no en la gestión»), y **caen con la
  mutación del reloj**, medido.

Lo único que quedó en este frente está en §7 (menores 2, 3 y 4).

---

## 6 · Trazabilidad R1–R35

**35/35 mapeados a un test que existe y que se ejecutó en el gate de esta sesión**: los archivos
citados están todos dentro de los 1186 que corrieron. Comprobado por script contra el árbol: de los
35 nombres de archivo citados en el mapa de `tasks.md`, **34 resuelven** y 1 es un nombre obsoleto
de un archivo que sí existe con otro nombre (menor 7).

Spot-checks de que el test **verifica** el requisito y no solo lo menciona:

| R | Qué se comprobó |
| --- | --- |
| R2/R3 | `gestion-destino.test.ts` deriva los cinco resultados de una lista **escrita a mano** (si se derivaran del propio mapa, el test comprobaría que el mapa es igual a sí mismo) y afirma que `devuelta` es el único que rompe la identidad. `mis-asignaciones-service.test.ts` afirma `os-devolucion-por-confirmar` **y** `not.toBe("os-devuelta")`. |
| R4–R8/R10 | 13 casos en `cierres-admin-anclaje-devolucion.test.ts`, con **testigos** (otra orden de otro cierre; otro resultado del mismo cierre) y `where`/`data` por igualdad exacta. |
| R9 | Fallo cerrado con `expect(repo.resolverCierre).not.toHaveBeenCalled()`: sin efectos parciales de verdad, no «devuelve error». Dos casos (falta el pre-estado / falta `devuelta`) más el gemelo del rechazo. |
| R12–R15 | Medidos sobre el **repositorio**, que es donde vive la derivación, y no sobre el servicio, cuyo repo es un doble y recibe el ancla ya calculada. El reparto está bien hecho y explicado en la bitácora. |
| R13 | Afirmado sobre el `where` por igualdad, más `JSON.stringify(where)).not.toContain("devolucion_por_confirmar")`. |
| R21 | `count` y `find` comparados por `toEqual` del `where` completo; además comparten el mismo método privado. |
| R25 | Doble prueba: por el `where` (igualdad) **y** por el grafo (`assertTransicionValida` lanza hacia `por_recoger`, `en_ruta_bodega_satelite` y `recolectando`). La segunda sobrevive a un refactor del `where`. |
| R33 | Inventario cerrado, detector del patrón prohibido y autocomprobación. |

**Huérfanos: ninguno. Fantasmas: uno, y solo de nombre** (menor 7).

---

## 7 · Hallazgos

### `menor 1` — R19 permite escribir en el hilo de notas desde el pre-estado, y no hay test

**Medido en esta sesión** con una prueba efímera (creada, ejecutada y borrada; `git status` limpio):

```
estaEnVentanaDeEscritura("adminTienda", "devolucion_por_confirmar", true)  ->  true
estaEnVentanaDeEscritura("adminTienda", "devolucion_por_confirmar", false) ->  false
```

R19 dice literalmente: «MIENTRAS una orden esté en el pre-estado, el sistema NO DEBE listarla como
novedad, NI permitir que la tienda la reprograme, NI que la rechace, **NI que escriba en su hilo de
notas**». La segunda puerta de `estaEnVentanaDeEscritura` (`lib/types/ventana-hilo-notas.ts:81`)
abre la ventana del `adminTienda` con `ayuda = true` **en cualquier estatus**, y el flag sobrevive a
la gestión: el mensajero pide ayuda en `en_reparto`, gestiona `devuelta`, y la orden queda en el
pre-estado **con `ayuda` todavía encendida**.

**Por qué es menor y no bloqueante:**

- es money-neutral y visibilidad-neutral: la orden **no** se lista (la rama de ayuda ahora exige
  `en_reparto`), su reloj sigue parado, y las otras prohibiciones de R19 —reprogramar, rechazar—
  siguen guardadas por `= devuelta` en `ReprogramacionTiendaService` y `RecuperacionBodegaService`;
- lo único que se puede hacer es publicar una nota y pulsar «Habilitar», que hoy solo apaga `ayuda`;
- el implementador **razonó esta ventana a propósito** y dejó escrito el porqué («escribir no hace
  visible nada»; estrecharla dejaría el flag encendido para siempre). Lo que falta es reconciliarlo
  con el texto de R19, no descubrirlo;
- **muere con la ficha 235**, que retira el booleano `ayuda`: esa puerta desaparece con él.

**Qué hace falta para cerrarlo:** o un caso que fije la decisión con su razón —como se hizo con los
cuatro mapas parciales—, o anotarlo en `requirements.md` como excepción firmada de R19 con dueño
(235). No es trabajo de código.

### `menor 2` — el append del anclaje escribe historial para TODAS las anclables, no solo para las movidas

`CierresAdminRepository.ts:1315` · `if (movidas.count > 0) appendCambioEstado(tx, anclables.map(…))`.

Si `movidas.count < anclables.length`, se escribe una fila de historial `anclaje_devolucion` para una
orden que **no** transicionó, con un `estatusOrigenId = preEstadoId` falso.

**Es el patrón de los dos bloques hermanos** (109 y 139 hacen exactamente lo mismo con sus `ids`),
así que no es una regresión que introduzca esta feature. Pero aquí está estructuralmente más
expuesto: en 109 y 139 los `ids` vienen de un `findMany` **ya filtrado por `estatusId`**, mientras
que aquí `anclables` sale de `gestion_orden` y el único filtro por estado vive en el `updateMany`.

**Reachabilidad medida: ninguna hoy.** Haría falta una orden anclable que no esté en el pre-estado, y
las dos únicas vías están cerradas: (a) `deletedAt != null` — **ningún módulo de producción hace
soft-delete de `orden`**, censado; (b) una segunda aprobación del mismo cierre — **imposible**, un
cierre `aprobado` no es resoluble ni reabrible. Y la dirección del error sería conservadora: retrasa
el cobro, no lo adelanta.

**Ningún test cubre el caso mixto** (una anclable en el pre-estado y otra fuera). Los casos actuales
son todo-o-nada.

### `menor 3` — el inventario de la guardia de R33 es grueso

`ESCRITURAS_DE_LA_APROBACION` declara `tx.orden.updateMany` **una sola vez** para los tres bloques
que la comparten. Un cuarto bloque que escribiera por la misma llamada **no** pondría la guardia
roja: el censo compara nombres de llamada, no bloques. Tampoco ve `$executeRaw`. Es un neto positivo
enorme frente a lo que había (nada), pero no cumple R33 al pie de la letra: «toda escritura … cubierta
por al menos una aserción que la **nombre**».

### `menor 4` — `cierres-admin-caja-cod.test.ts` no fija la posición del bloque

Detallado y medido en §3.2. La posición es libre porque ningún feed lee `orden`, así que no hay
riesgo, pero el argumento de `design.md §3.2` («ahí está medido») no se sostiene tal cual y no
conviene citarlo como si lo estuviera.

### `menor 5` — R34 no tiene test automático

Su evidencia es la consulta de `design.md §12` **ejecutada a mano** contra producción, con resultado
`0` en las tres columnas, anotado en `specs/215-reintento-en-cierre/design.md §7bis`. Razonable para
una consulta de solo lectura, pero es el único de los 35 cuya trazabilidad no llega a un test que el
gate ejecute.

### `menor 6` — R27 se apoya en el choke point, no en un test propio de emisión

`webhook-eventos.test.ts` cubre bien la mitad «y NO antes»: el pre-estado no es evento público y la
lista queda congelada **por contenido** en sus 10 values. La mitad «en ese instante» se sostiene
porque `appendCambioEstado` invoca siempre `emitir` —cierto, y probado por la feature 99—, pero
ningún caso de la 239 afirma que la aprobación produce el webhook `devuelta`.

### `menor 7` — desajustes de bitácora y de mapa (tres, ninguno de comportamiento)

1. `tasks.md` (mapa de R26) cita `exclude-por-rol.test.ts`; el archivo real es
   `tests/components/OrdenesExcludePorRol.test.ts`, que sí existe y sí cubre R26. `impl_239.md` lo
   cita bien.
2. `impl_239.md` y `progress/history.md` dicen que `intentos-entrega-criterio-unico.test.ts` queda
   **«verde sin tocarse»**; el archivo **sí se tocó**. Los cambios son mecánicos —el campo
   `origenAncla` del DTO y el quinto contador `legadas` en cuatro `toEqual`— y no mueven el criterio,
   pero la frase, tal cual, no es exacta.
3. `tasks.md` marca T0.1 y T5.4 como `[x]` con la nota «pegado en `progress/impl_239.md`», y ahí no
   están: T0.1 vive en el `status_note` de `feature_list.json` («T0 RE-MEDIDO … el 2026-08-19: 0
   órdenes en `devuelta`, 12/12 cierres aprobados, 0 gestiones sin cierre …, autocomprobado con 141
   órdenes vivas») y T5.4 en `specs/215 §7bis`. **Las dos están hechas**, solo que no donde la tarea
   prometía. Nota adicional: la re-medición cubre (a), (b) y (d) de T0.1; el retraso
   gestión→aprobación (c) se da por «idéntico al 18» sin re-derivarlo.

### `menor 8` — prosa caducada en `db/schema.prisma`

`model OrderStatus` sigue comentando «seed (**20**, ver `ORDER_STATUS_SEED`…)»; ya son 21. Es el
único sitio del árbol con el conteo viejo que esta feature tocó sin actualizar.

### `menor 9` — cosmético: indentación

`anclajeDevolucion: ANCLAJE_DEVOLUCION,` queda desalineado (6 espacios en objetos de 4) en
`cierres-admin-caja-cod.test.ts:219`, `…resolverCierre.devolucion.test.ts:162` y
`wallet-idempotencia.test.ts:221`. `lint` no lo caza porque prettier no forma parte del gate.

---

## 8 · Checklist de `CHECKPOINTS.md`

### Especificación

- [x] `requirements.md` con EARS numerados R1–R35, y con la **puerta humana firmada** al final:
      P1, P2 y P3 con la recomendación, **P4 en contra y con el precio escrito**, P9 y P10 de
      secuencia.
- [x] `design.md` con alternativas descartadas y su porqué: cuatro (A, derivar el ancla en la
      consulta; B, columna `anclada_at`; C, parchear solo el cron; D, feature flag), cada una con la
      razón concreta y no genérica.
- [~] `tasks.md` con todas las tasks `[x]`: **tres abiertas a propósito y con motivo escrito**.
      T0.3 (aviso a integradores, bloquea el despliegue y no el código), T5.6 (ver la app: la mitad
      de `/novedades` exige OTP de `adminTienda`) y T6.4 (cerrar la ficha, va después del merge).
      Aceptadas: ninguna es de código y las tres tienen dueño. Ver menor 7.3 sobre T0.1 y T5.4.

### Trazabilidad

- [x] Cada `R<n>` mapea a al menos un test concreto (35/35, con la salvedad del menor 5 para R34).
- [x] `progress/impl_239.md` contiene el mapa `R<n> → test`, repartido por tanda.

### Calidad de código

- [x] `pnpm run typecheck`: 0 errores.
- [x] `pnpm run lint`: 0 errores (89 avisos preexistentes).
- [x] `pnpm test`: 1186 archivos y 15269 tests, verde.
- [n/a] E2E de flujo crítico: **declarado inaplicable con razón y con reemplazo**. Las specs de
      `e2e/` están escritas y **no se ejecutan** (no hay harness ni base sembrada; `pnpm test` no las
      incluye, y lo dice su propia `EXECUTION NOTE`). Se dejó `reintentos-escalado.spec.ts` de
      acuerdo con el comportamiento real —cada intento deja ahora dos filas— y se nombraron dentro
      los tres tests **ejecutables** que cubren la propiedad. Correcto: una spec que miente es peor
      que una que no corre.

### Datos y seguridad

- [x] RLS: **no hay tabla nueva**. Se reutilizan `orden`, `order_status`, `gestion_orden` y
      `orden_historial_estado`, todas con su RLS ya declarada. Los dos `down.sql` que tocan tipos
      llevan su caso afirmando que **no tocan policies**.
- [x] Migraciones versionadas y reversibles: las **tres** llevan `down.sql`, y el round-trip
      (`migrate deploy` → `db:rollback` → re-aplicar → tercera pasada idempotente) está medido contra
      la base local con salida real. El `down` del enum recrea el tipo con los 26 valores previos; el
      del catálogo borra **solo si nadie referencia**; el de la columna la repone con
      `NOT NULL DEFAULT false`, exactamente como el código anterior la leía. Pérdida de valores
      declarada y justificada. Rollback encadenado documentado en el propio `down.sql`.
- [x] Ningún secreto nuevo; ninguna variable de entorno nueva.
- [x] Webhooks: no hay endpoint nuevo. El único cambio de contrato es **cuándo** llega `devuelta`
      (P2), anotado como aviso obligatorio previo al despliegue (T0.3).

### Patrón de capas

- [x] Controller sin queries: la única ruta tocada (`/api/cron/procesar-devueltas-sla`) solo añade
      `legadas` al 200.
- [x] Service sin HTTP.
- [~] Repository: el bloque de anclaje lleva la derivación de recencia dentro del repositorio. **Es
      obligado** —tiene que ocurrir dentro de la misma transacción— y es **el molde exacto** de los
      dos bloques hermanos ya en el árbol. No es una desviación nueva.
- [x] Interfaces en `lib/interfaces/`, por categoría. `AnclajeDevolucionConfig` y el
      `ResolverCierreInput` como **unión discriminada** por `nuevoEstado` son una desviación del
      design (§3.3 pedía campo requerido en objeto plano) **bien razonada y mejor que lo pedido**: el
      rechazo no tiene que resolver ids que no usa, y un olvido de cableado sigue rompiendo el
      typecheck, que es la señal buscada.

### Permisos

- [x] Sin páginas ni Server Actions nuevas. El pre-estado se excluye del desplegable del
      `adminTienda`, junto a `devuelta`.

### Multi-país

- [x] Nada de país, moneda ni cuenta hardcodeado. El bloque no toca montos.

### Verificación final

- [x] `./init.sh` verde (§1).
- [x] `progress/history.md` tiene su entrada del 2026-08-19.
- [x] Este archivo.

---

## 9 · Lo que NO se re-litiga, y por qué queda claro que no es hallazgo

- **P4** (el adminSatélite no recupera una devolución no anclada) va **contra la recomendación del
  spec por firma humana**, con el precio escrito en `requirements.md` y repetido en el código, en
  `estados-bodega-satelite.ts` y en `order-status-transiciones.ts`. Se comprobó que la
  implementación es coherente con la firma en los tres sitios: sin arista de `recuperacion_manual`,
  sin entrada en `ESTADOS_BODEGA_SATELITE`, y con un caso que afirma la ausencia.
- **El tapón de `ayuda`** (`{ ayuda: true, estatus: en_reparto }`) es decisión humana del
  2026-08-19, está escrito en el código como tapón con dueño y fecha de caducidad (ficha 235), y
  lleva dos tests que lo matan por mutación.
- **Las tres tareas abiertas** y los **89 avisos de lint** preexistentes.

---

## 10 · Veredicto

**`OK`.** 0 bloqueantes, 9 menores, y ninguno de los nueve toca dinero, visibilidad ni el reloj.

El fallo que hoy cobra de más en `dev` queda cerrado **por construcción**: la única entrada a
`devuelta` es el anclaje, validado por un choke point de fallo cerrado; el cron filtra por la misma
igualdad de estado que `/novedades`; y la columna que sostenía las dos mitades desincronizadas está
retirada del árbol, con una guardia que censa su regreso. La carrera que costaba dinero se comprueba
dentro de la transacción y resiste los cinco caminos por los que intenté romperla.

**Se puede mergear el PR #398.** Antes de que esto llegue a producción siguen pendientes, con dueño
y con motivo, **T0.3 (avisar a los integradores)** —es un cambio de contrato observable— y T5.6 (ver
la app). Ninguna de las dos es código y ninguna bloquea el merge a `dev`.
