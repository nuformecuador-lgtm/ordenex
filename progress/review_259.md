# Feature 259 — REVIEW

> **Rama:** `feat/259-tablero-por-reparto` (sin commit: todo en el árbol de trabajo) ·
> **Fecha de la revisión:** 2026-08-21 · **Revisor:** subagente `reviewer` (no edita código).
> **Leído antes:** `specs/259-tablero-dia-por-reparto/{requirements,design,tasks}.md`,
> `progress/impl_259_backend.md`, `progress/impl_259_frontend.md`, `docs/architecture.md`,
> `docs/conventions.md`, `docs/verification.md`, `CHECKPOINTS.md`.

## VEREDICTO: **APROBADO**

**26 requisitos verificados, 26 con test real.** Ningún hallazgo bloqueante. Nueve hallazgos
menores, todos de documentación, bookkeeping o riesgo ya declarado; ninguno cambia el veredicto.

**Lo que sostiene el APROBADO no es la bitácora: son tres mutaciones que apliqué yo mismo** sobre
`cteIdsDelDia`, con la copia intacta fuera del repo y comprobando el `sha256` del archivo al
restaurar (idéntico las tres veces, y `git status` al final es el mismo que al empezar: 15
modificados, 5 sin seguimiento, 640 insertions / 59 deletions).

---

## 1. Lo que corrí yo (no me fié de la bitácora)

| Comando | Resultado |
| --- | --- |
| `vitest run` sobre los 5 archivos de integración de la ficha + los 2 de unidad nuevos | **7 files, 59 passed, 0 skipped** — `describeSiHayBase` NO degradó a `describe.skip`: hay Postgres y los casos se **ejecutaron** |
| `vitest run` sobre los 3 tests de componente tocados + `TableroDiaModule` / `TableroDiaPage` + los 3 tests de forma preexistentes + `tablero-dia-conteo` + `tablero-dia-detalle-aislamiento` + `tests/unit/tablero-dia` (las guardias del árbol) | **19 files, 331 passed** |
| `vitest run tests/unit/actions/tablero-dia-*accion* tests/unit/services` (R19) | **190 files, 3249 passed** |
| Gate `./init.sh --rapido` (log de la sesión, revisado línea a línea) | `INIT_EXIT=0` **escrito dentro del log**; el propio gate declara «el cambio no toca esquema, tipos compartidos, config ni dinero: el modo rapido basta»; 22 files / 264 tests relacionados + **128 guardias / 1927 tests** |
| **Mutación M2 reproducida por mí** (rama (a) → rango de `asignado_at`, o sea *volver a D10*) | **6 rojos**: C2, C3, C7, C9, el cuadre de R14 y el ritmo de R15. `Tests 6 failed / 26 passed (32)` |
| **Mutación M5 reproducida por mí** (borrar la cláusula de R11) | **3 rojos**: C9 (`expected [ { …(11) } ] to deeply equal []` — la orden reaparece hoy en la tarjeta de Beto), el cuadre de R14 (`to have a length of 1 but got 2`) y la forma de R11 |
| **Mutación M6 reproducida por mí** (`ventana.desde` sin `::date`) | **2 rojos, los DOS de forma**; los cuatro archivos de integración **verdes** (41 passed). Confirma la mitad incómoda del hallazgo del implementer |

También leí los siete logs de mutación que el implementer dejó en el scratchpad: son salidas reales
de `vitest` con **67 casos por corrida**, con nombres de test y mensajes de aserción. No es un arnés
que reporta sin ejecutar —el patrón que ya mordió a este repo—: los tres que reproduje dan
**exactamente** los mismos rojos que los suyos.

---

## 2. `CHECKPOINTS.md`, punto por punto

### Especificación
- [x] `requirements.md` con requisitos EARS numerados R1–R26.
- [x] `design.md` con alternativas descartadas y su porqué (**seis**: A1–A6).
- [~] `tasks.md`: **todas marcadas `[x]` menos T8.1, T9.1 y T9.2.** T8.1 (aviso operativo) bloquea
      **la release, no el PR**, y así está escrito en el spec. T9.1 (gate) se ejecutó y salió verde
      (`INIT_EXIT=0`) aunque la casilla siga sin marcar. T9.2 (PR) es lo siguiente. → menor M-3.

### Trazabilidad
- [x] Cada `R<n>` mapea a al menos un test concreto — verificado uno a uno, tabla en §3.
- [~] El mapa `R<n> → test` existe, pero repartido en `progress/impl_259_backend.md` (R1–R22, R26)
      y `progress/impl_259_frontend.md` (R23–R25). No hay `progress/impl_259.md`, que es el nombre
      que citan `tasks.md`, `design.md` §6 y el propio CHECKPOINTS. → menor M-2.

### Calidad de código
- [x] `typecheck` sin errores (gate y bitácoras).
- [x] `lint` **0 errores** (99 warnings preexistentes; ninguno en archivos de esta ficha).
- [x] Tests verdes: corridos por mí, ver §1.
- [N/A] E2E: no hay harness de Playwright en el repo y la ficha no toca auth, pagos, recaudo,
      ingesta ni webhooks — es una pantalla de **solo lectura**. El riesgo que un E2E cubriría (que
      el texto nuevo se lea y quepa) queda **declarado abierto** en las dos bitácoras y en
      `tasks.md`, y se cubre abriendo la app. → menor M-7.

### Datos y seguridad (Supabase)
- [N/A] Tablas nuevas / RLS: **no hay tabla nueva ni migración** (R20, verificado sobre el diff:
      `db/**` intacto). Debajo de esta pantalla no hay policies —Prisma se conecta con credenciales
      de servicio—, así que la única frontera multi-tenant es el `WHERE` de alcance…
- [x] …y **ese `WHERE` no se movió**: sigue aplicándose **una sola vez, después de la unión, sobre
      `orden.zona_id`** (R16). El `JOIN "orden" o2` que entra en `ids_recoleccion` NO trae recorte
      de zona consigo, y el comentario del código explica que el motivo viejo («no conoce todavía la
      orden») dejó de ser cierto y por qué aun así no se mueve. Hay caso nuevo de integración que lo
      mide **en las dos direcciones** (zona A no la ve, zona B sí).
- [N/A] `down.sql`: no hay migración nueva.
- [x] Sin secretos hardcodeados: no entra ni una constante nueva; la fecha viaja **como parámetro**
      y el test de forma afirma que **nunca** aparece interpolada en la cadena.
- [N/A] Webhooks: la ficha no toca ninguno.

### Patrón de capas
- [x] Repositorio: solo consultas (SQL crudo, ya clasificado por `frontera.guardia`). El test de
      forma añade que las tres son de **solo lectura** (ni UPDATE / INSERT / DELETE / MERGE).
- [x] Servicio: **no se tocó** (`TableroDiaService.ts` no está en el diff). No conoce HTTP.
- [x] Controller / Server Action: no se tocan.
- [x] Interfaces: `ITableroDiaRepository` **sin cambios** — la firma ya recibía la `VentanaDiaCR`
      entera, que ya trae `fecha`. Contrato publicado intacto (R19).

### Permisos
- [x] Sin cambios: la autorización sigue por encima de la caché (`autorizar` antes de
      `claveDeTablero`), y la ficha no la roza.

### Multi-país / configuración
- [x] **Ni una segunda definición del día**: sin `AT TIME ZONE`, sin nombre de zona, sin
      `interval` de seis horas, sin `startOfDayCR` — afirmado por el test de forma sobre las
      **tres** consultas y por `frontera.guardia`. El día sale de `ventana.fecha`, el mismo objeto
      que produce `desde` y `hasta`.

### Verificación final
- [x] `./init.sh --rapido` en verde con el árbol completo (backend + frontend), y el propio gate
      confirma que el rápido basta. El completo queda pendiente **post-merge a `dev`** y **antes de
      release a `prod`**, como manda la regla 5 de `CLAUDE.md`.
- [x] Este archivo, con veredicto.
- [ ] Entrada en `progress/history.md`: pendiente del cierre (leader).

---

## 3. Trazabilidad R1–R26 — veredicto por requisito

> «Verificado» = abrí el test citado, corresponde al requisito, y **no pasaría igual sin el
> código**. La columna «muere con» nombra la mutación que lo demuestra (⊕ = reproducida por mí).

| R | Test que lo cubre | Muere con | Veredicto |
| --- | --- | --- | --- |
| **R1** | `tablero-dia-universo-sql` (las dos ramas, en las tres consultas) + C1/C4 | M1, M2⊕ | ✅ El predicado es el mismo de `RankingRepository` (comparado línea a línea: las mismas dos ramas) |
| **R2** | C1, y C3 para la parte «con independencia del día en que se asignó» | M2⊕ | ✅ |
| **R3** | C2 (`asignadas`) + C7 (el detalle, por ids) + el caso nuevo del ritmo (la serie) + el caso nuevo del cuadre (el detalle no trae ruido de mañana) | M2⊕, M3 | ✅ Las cuatro negaciones de R3 quedan cubiertas entre esos cuatro casos |
| **R4** | C3 | M2⊕ | ✅ |
| **R5** | C6 (la reserva de ayer no cuenta hoy) | M4 (`=` → `<=`) | ✅ |
| **R6** | C4 y C5 | M1 (26 rojos) | ✅ |
| **R7** | C7: las tres ventanas, `toHaveLength(6)` y `new Set(todas).size === 6` | M3 | ✅ **Ésta es la evidencia real de la disjunción**, no M7 (ver §4.2) |
| **R8** | `tablero-dia-universo-sql` (sin `COALESCE` sobre `fecha_reparto`; sin zona horaria; sin `startOfDayCR`) + `frontera.guardia` (a) | — | ✅ El `COALESCE` legítimo del `ORDER BY` se distingue del prohibido: se inspecciona bloque a bloque |
| **R9** | `tablero-dia-universo-sql`: sigue el **número del placeholder** de la rama (a) hasta su valor y afirma que ese valor es `ventana.fecha` | M6⊕ | ✅ con matiz declarado: **sólo lo defiende la forma** (§4.1) |
| **R10** | C8 (preexistente) y C10 (alcanzable por dos caminos, cuenta 1) | M1 | ✅ |
| **R11** | **C9**, sembrado con el mensajero **cambiado** (Ana recoge, Beto reparte mañana) + la forma de la cláusula | M5⊕, M2⊕, M3 | ✅ (§4.3) |
| **R12** | `sumaDeLosOcho` afirmado en **cada** caso nuevo (C1–C7, C9, C10 y el de aislamiento) | M1, M3 | ✅ |
| **R13** | `tablero-dia-universo-sql`: el fragmento del universo es **literalmente idéntico** en las tres consultas, y se afirma que no es trivial (más de 200 caracteres) | — | ✅ Aserción fuerte: obliga a reusar `cteIdsDelDia`, no a copiarlo |
| **R14** | Caso nuevo de `tablero-dia-detalle-cuadre` (rama (a) + rama (b) + recolección + ruido de mañana) | M1, M2⊕, M3, M5⊕ | ✅ (§4.4) |
| **R15** | Caso nuevo de `tablero-dia-ritmo` (dos ramas entregadas + una de mañana que NO entra) | M2⊕, M3 | ✅ |
| **R16** | `tablero-dia-sql` (una sola aparición de `zona_id`, después de `ids_del_dia`) + caso nuevo de `tablero-dia-aislamiento`, que mide **las dos direcciones** | — | ✅ El caso nuevo siembra la orden **asignada ayer**: sin la rama (a) no estaría hoy por ningún otro camino, así que mide la rama nueva |
| **R17** | `asignado-at-solo-lectura.guardia` + `tablero-dia-universo-sql` (ni UPDATE / INSERT / DELETE) + `fecha-reparto-acompana-asignado-at.guardia` | — | ✅ |
| **R18** | `frontera.guardia` (d): sin `findMany`, tres consultas clasificadas agregada / paginada / agregada | — | ✅ Verde sin editar |
| **R19** | `typecheck` + `tablero-dia-accion` y `tablero-dia-detalle-accion` verdes **sin editar**, y `lib/types/tablero-dia.ts` fuera del diff | — | ✅ |
| **R20** | Diff: `db/**` intacto; el gate confirma «no toca esquema» y no se niega solo | — | ✅ Verificado sobre el diff, no sólo por la guardia |
| **R21** | `d10-revertida.guardia`, bloque (1): (a) ninguna frase superada, (b) las **dos** fechas + el motivo `sinRecoger` + `fecha_reparto`, (c) cita a `RankingRepository` | — | ✅ Comprobé que la guardia **estaría roja contra el archivo anterior**: el blob de `HEAD` contiene las dos frases superadas y no contiene ni 2026-08-21 ni REVERTIDA |
| **R22** | C2, segunda mitad (la misma siembra contada con la ventana de mañana, sin ninguna escritura) + `claveDeTablero(alcance, ventana.fecha)` y sus tests de caché preexistentes | M2⊕ | ✅ |
| **R23** | `TableroDiaEstados.test.tsx` («la promesa vieja NO está» y «dice DÓNDE aparece») y `TableroDiaTarjetas.test.tsx` (la promesa, exigida **ausente**) | MT1, MT2 | ✅ |
| **R24** | Un caso por sitio: vacío y aviso de detalle cerrado (`TableroDiaEstados`), `aria-label` (`TableroDiaTarjetas`), cabecera (`DetalleMensajeroPanel`) | MT1–MT5 | ✅ Los **cuatro** sitios, **cinco** literales |
| **R25** | Censo de jerga por fuente sobre los **cuatro** archivos (con `tests/fixtures/sin-comentarios`, el quitador único del repo) + autocomprobación del detector + «⛔ `ETIQUETA_ASIGNADAS` sigue siendo Asignadas» | MT6, MT7 | ✅ con matiz: el detector de siglas sólo conoce SLA (menor M-8) |
| **R26** | `d10-revertida.guardia`, bloque (2): el apéndice (fecha + «supersedid» + puntero a `specs/259-…`) **y** cuatro frases testigo del §D10 original, **verbatim** | — | ✅ **Las dos direcciones**, y la autocomprobación (e) reescribe el título y confirma que el testigo lo caza. El diff de `specs/246/requirements.md` es **sólo adición**: 7 líneas, 0 borradas |

---

## 4. Los puntos que el encargo pidió mirar con lupa

### 4.1 M6 (`::date`) — la explicación es **cierta**, no una racionalización

La reproduje: con `ventana.desde` y sin `::date`, **los cuatro archivos de integración siguen
verdes** (41 passed) y sólo caen las dos aserciones de forma. En esta máquina el comportamiento no
cambia, exactamente como dice la bitácora — y eso confirma, de paso, *por qué* el `::date` importa:
el resultado estaba dependiendo de la zona horaria de la sesión y del offset del proceso, que es la
trampa que documenta `lib/utils/dia-reparto.ts`. Ninguna siembra de integración puede cazar eso en
una máquina donde las dos convenciones ya coinciden.

**La defensa existe y muerde:** el test de forma no se conforma con «la fecha está en algún
`values`»; **sigue el número del placeholder de la rama (a) hasta su valor**. Y el propio archivo
explica, junto a `ramasDeReparto`, que la primera versión se dejaba engañar porque la aserción la
satisfacía la cláusula de la recolección. El implementer **reforzó el test en vez de bajar la
exigencia**, y dejó escrito el porqué para que nadie lo simplifique de vuelta. Correcto.

### 4.2 M7 (`UNION ALL`) — la explicación es **cierta**, y es más honesta que el propio spec

Verificado en el código: `ids_reparto` **sólo** lo consume `ids_del_dia`, y `ids_del_dia` es un
`UNION` a secas, que deduplica todo el resultado. Por tanto M7 sobreviviría **aunque las ramas no
fueran disjuntas**: no es evidencia de la disjunción. El implementer lo dice con esas palabras
(Hallazgo 2) en vez de cobrarse la supervivencia como prueba, que es a lo que el spec le invitaba.

**La garantía real sí existe y sí mide:** es **C7**, que cuenta las apariciones de las seis órdenes
en los tres días, y **M3 la mata** — la orden de C2 aparecería en dos días y saldrían 7 apariciones
para 6 órdenes. Además la propiedad es cierta por construcción: `fecha_reparto = X` y
`fecha_reparto IS NULL` no pueden cumplirse a la vez.

→ Deja un residuo documental: `tasks.md` sigue diciendo «**M7** confirma la disjunción» en la fila
de R7. Menor M-1.

### 4.3 R11 — la cláusula existe, el caso la ejercita **con el mensajero cambiado**, y la secuencia está escrita donde se lee

- La cláusula está, **dentro** de la rama que corrige y no después de la unión:
  `AND (o2."fecha_reparto" IS NULL OR o2."fecha_reparto" = <dia>::date)`.
- **C9 siembra los dos mensajeros**: la recolección la registra Ana (`mensajero1`) y a las 14:00 la
  orden se reasigna a **Beto** (`mensajero2`) con día de reparto mañana — un `update` real que
  sobrescribe `mensajero_asignado_id`. Afirma que **hoy no aparece en NINGUNA tarjeta** y que
  **mañana aparece en la de Beto**. No prueba la mitad: prueba las dos.
- Reproduje M5: sin la cláusula, C9 cae con `expected [ { …(11) } ] to deeply equal []` — la orden
  reaparece hoy, en la tarjeta de quien ni fue a recoger ni tiene que repartirla.
- La secuencia 08:00 Ana / 14:00 Beto está escrita en **cuatro** sitios, y el que importa es el
  primero: **el comentario dentro del SQL**, pegado a la cláusula, con el hecho clave
  (`mensajero_asignado_id` se sobrescribe) y el ⛔ de «no se simplifica». También en `design.md` §5,
  en la nota de R11 y en la cabecera del test de recolección.

### 4.4 `tablero-dia-detalle-cuadre.test.ts` — la costura con la 260 **no se aflojó**

Verificado sobre el diff: el archivo sólo gana un `import` y **un caso al final**; los tres casos
previos no se tocan ni una letra. La afirmación del implementer es comprobable y la comprobé: ningún
caso previo fija `fecha_reparto`, así que **todos ejercitan la rama (b)** y las dos consultas se
mueven juntas porque comparten literalmente `cteIdsDelDia` (R13, afirmado por identidad literal del
fragmento).

Y la igualdad **sigue protegida**, que era la pregunta: bajo M1 caen los **dos casos preexistentes**
del cuadre (siguen midiendo), y bajo M2⊕ / M3 / M5⊕ cae el caso nuevo. El caso nuevo además no se
conforma con la igualdad: fija el número (`asignadas === 5`) y afirma que **ninguna orden de mañana
se coló en la página del detalle**.

### 4.5 Los cinco literales (R23–R25)

| Literal | Después | Veredicto |
| --- | --- | --- |
| `VACIO_TITULO` | «Sin órdenes asignadas **para** hoy» | ✅ cierto |
| `VACIO_DESCRIPCION` | «…asignadas para hoy dentro de tu alcance. El tablero muestra el trabajo de hoy: lo que se asigne para otro día aparecerá en el tablero de ese día.» | ✅ cierto (R22 lo sostiene: clave de caché por fecha CR). Matiz de lectura en M-6 |
| `aria-label` de `MensajeroCard` | «N asignadas **para** hoy — ver el detalle de sus órdenes de hoy» | ✅ |
| Cabecera de `DetalleMensajeroPanel` | «N órdenes asignadas **para** hoy» (y su singular) | ✅ y coherente con la tarjeta, que es el mismo número (R14) |
| `DESAPARECIDO_DESCRIPCION` | «…ya no tiene órdenes asignadas **para** hoy…» | ✅ el cuarto sitio |

- **«Asignadas» NO se tocó**, y hay un caso que lo vigila; **MT6** demuestra que ese caso muerde
  (renombrar la etiqueta pone rojos dos tests).
- **Sin jerga**: ni «día de reparto», ni nombres de columna, ni siglas. El censo se hace **por
  fuente sobre los cuatro archivos** con el quitador de comentarios compartido, y lleva
  autocomprobación (marca cuatro textos que infringen, no marca uno que no).
- **Los tests actualizados no se aflojaron.** El único anclado a los textos viejos era «R33: el
  vacío se dice de forma EXPLÍCITA…»: la primera aserción sigue siendo un `getByText` de **una
  frase concreta** (la nueva) y la segunda **cambia de signo a propósito** —lo que se exigía
  presente se exige ausente— **añadiendo** un `getByText` de la frase que sí es cierta. No hay
  ningún `toBeTruthy` ni ninguna expresión más laxa. MT1 y MT2 confirman que los dos siguen
  midiendo.
- `SIN_COINCIDENCIAS_DESCRIPCION` (el vacío del filtro) queda **fijado por un caso** para que nadie
  lo arrastre: correcto, habla del filtro y no del día.

### 4.6 La honestidad de `design.md` §3.1 — **se conserva**

El anexo del `EXPLAIN` en `progress/impl_259_backend.md` **no** convierte la deducción en medición:
abre con dos avisos en negrita («estos planes miden FORMA, NO COSTE» y «NO CONFIRMAN EL ARGUMENTO DE
INDEXABILIDAD DE §3.1»), dice que los cuatro planes de la 246 son de **otra consulta**, tomados con
`enable_seqscan = off` y sobre decenas de filas, y cierra con «que nadie cite este anexo como si
fuera esa medición». El matiz está además en los cuatro sitios donde el lector de dentro de un año
va a caer: `design.md` §3.1 (recuadro), `tasks.md` T4.1 y «Lo que este spec NO puede demostrar», la
bitácora, y **el propio comentario del repositorio** (punto 2 de la cabecera de `cteIdsDelDia`).
Lo que sí queda medido y dicho como tal: la **forma** del plan (dos `Seq Scan` bajo un `Append`, no
un `OR` colapsado) y dónde mirar el día que la pantalla vaya lenta.

---

## 5. Hallazgos

### Mayores (bloqueantes): **NINGUNO**

### Menores

- **M-1 · `tasks.md` sigue atribuyendo a M7 un valor probatorio que no tiene.** La fila de R7 dice
  «**M7** confirma la disjunción», y el propio implementer demostró que no (el `UNION` exterior
  deduplica igualmente). La corrección vive sólo en la bitácora. Quien lea el mapa dentro de un año
  se llevará la idea equivocada. *Para cerrarlo:* una línea en esa fila remitiendo a C7 y M3, o
  borrar la mención a M7. **No bloquea:** la evidencia real existe y mide.
- **M-2 · No existe `progress/impl_259.md`.** `tasks.md` (T0.1, T3.2, T4.1, T5, T6.1, T7.3),
  `design.md` §6 y `CHECKPOINTS.md` lo citan por ese nombre; los archivos reales son
  `impl_259_backend.md` e `impl_259_frontend.md`. El contenido está entero y el mapa `R → test`
  también, repartido entre los dos.
- **M-3 · Tres casillas sin marcar en `tasks.md`.** T8.1 (aviso operativo) **bloquea la release** y
  sigue sin hacer: es correcto que esté sin marcar, pero **hay que hacerlo antes de desplegar a
  `prod`**, no después. T9.1 (gate) se corrió y salió verde; la casilla está sin marcar. T9.2 (PR)
  es lo siguiente.
- **M-4 · `feature_list.json` tiene la 259 en `spec_ready`** con el código ya escrito en el árbol, y
  `progress/current.md` no menciona esta sesión. Bookkeeping del leader, no defecto de código. La
  regla de las 2 por zona lo permite: la zona `fullstack` tiene **0** en `in_progress` (255 y 257
  son `backend`).
- **M-5 · La bitácora dice que el arnés «aborta si la cadena no aparece exactamente una vez», y el
  script que quedó en el scratchpad no lo hace** (sólo aborta si la cadena **falta**, y sustituye la
  primera aparición). El fichero pudo sobrescribirse después; lo que sí verifiqué es lo que importa:
  los logs son reales, con 67 casos por corrida, y **las tres mutaciones que reproduje dan
  exactamente los mismos rojos**. Mi propio arnés sí cuenta las apariciones y aborta si no son 1.
- **M-6 · «aparecerá en el tablero de ese día» es cierto pero puede leerse mal.** `/monitoreo` no
  tiene selector de día: siempre muestra el día en curso (`ventanaDelDiaEnCursoCR(now)`). La frase
  significa «cuando llegue ese día», y es verdad; pero alguien puede entender que existe un tablero
  de otro día al que puede ir. Vale la pena mirarlo al abrir la app.
- **M-7 · Nadie ha visto la pantalla.** Las dos bitácoras lo declaran: los tests comprueban que el
  texto **está**, no que se entienda ni que quepa (la descripción del vacío pasó de 114 a 176
  caracteres). En este repo, ver la app ya encontró siete textos rotos que 12.000 tests daban por
  buenos. El estado vacío, además, sólo se ve con cero órdenes en el alcance.
- **M-8 · El detector de siglas de R25 sólo conoce SLA.** Cumple el requisito de hoy —y viene de una
  deuda real del repo—, pero no es un detector de siglas: es el detector de *esa* sigla.
- **M-9 · Una aserción decorativa** en `tablero-dia-universo-sql.test.ts`: en «el día viaja como
  TEXTO», comparar una lista de `Date` contra un `string` con `not.toContain` **no puede fallar
  nunca**. Las otras dos aserciones del mismo caso sí miden, y M6 lo mata por otras vías, así que no
  deja hueco — pero es la clase de línea que hace parecer más fuerte a un test de lo que es.

---

## 6. Riesgo vivo que conviene no perder de vista

- **La 260 toca el mismo archivo.** `design.md` §11 ya lo dice: no correr las dos a la vez sobre
  `lib/repositories/TableroDiaRepository.ts`. La 260 está en `spec_ready`, así que hoy no hay
  colisión.
- **R9 lo defiende sólo un test de forma.** Está declarado y el test es fuerte, pero si alguien
  «simplifica» `ramasDeReparto` para que mire el fragmento entero, R9 se queda sin red **y ninguna
  integración avisa**. El comentario del test lo dice; queda repetido aquí porque es el único
  agujero estructural de la ficha.
- **T8.1 bloquea la release.** El maestro que asigne para mañana verá **desaparecer** esas órdenes
  del tablero de hoy en el primer minuto. Sin aviso previo lo leerá como «se perdieron», que es el
  patrón que ya mordió a este repo: el sistema no falla, aparenta.
