# review_408 — El motivo de un rechazo automático se lee en lenguaje humano

- **Rama revisada:** `feat/408-motivo-rechazo-automatico-legible` @ `c070083e` (PR #775, base `dev`)
- **Base:** `1754df7c`. `origin/dev` = `aff769d8`; los 4 commits que `dev` ganó por delante son
  **sólo specs/design/feature_list** — `git diff 1754df7c origin/dev` sobre las dos carpetas de
  componentes tocadas sale **vacío**. La medida no caducó y el PR está `MERGEABLE`.
- **Fecha:** 2026-09-10
- **Veredicto: APROBADO.** Cero bloqueantes.

---

## 1. Qué corrí yo (no me fié de la bitácora)

| Qué | Resultado |
| --- | --- |
| Los 7 archivos de test de la ficha | **124/124 verdes** (baseline propio) |
| `tsc --noEmit` | verde |
| Las 7 mutaciones, reaplicadas una a una sobre el árbol | **ninguna sobrevive** (tabla en §4) |
| Una **octava** mutación mía (`false` fijo en `/cierre-dia`) | **0 rojos — sobrevive**, ver §5.2 |
| `./init.sh` completo en el worktree, con `.env` copiado | typecheck ok, lint ok, **154 archivos contra Postgres SÍ ejecutados**, 1865 archivos / **27.172 pasados**, 26 `skipped`, **5 rojos en 3 archivos** -> `INIT_EXIT=1` |
| **Segunda corrida, contra `dev` limpio (`aff769d8`) y la MISMA base local** | **los mismos 5 rojos, en los mismos 3 archivos** |

### El rojo del gate NO es de esta ficha, y está medido

Los 3 archivos son `tests/integration/db/notificacion-evento-{dia-reparto-corregido,gasto-fijo,postulacion-recurso}-migration.test.ts`.
Fallan porque la base local compartida ya tiene los enums `novedades_sin_gestionar` /
`devoluciones_represadas` (+ sus `*_dia`), que **no están en esta rama**: los metió la migración de
otro agente sobre la misma base.

```
- Expected      + Received
    "geocodificacion_caida",
+   "novedades_sin_gestionar",
+   "devoluciones_represadas",
```

Discriminador aplicado: **las mismas 3 files, los mismos 5 casos, fallan en `dev` a pelo**
(`Test Files 3 failed (3)` · `Tests 5 failed | 56 passed`). Esta ficha **no toca `db/`, ni `lib/`,
ni una sola migración** — el diff son 7 archivos bajo `app/(app)/...`, 7 de test, spec y bitácora.
Es la contención de base compartida ya conocida, no una regresión. Cero `40P01` en la corrida.
**Para el leader:** o se migra la base local a la altura de `dev`, o esos 3 archivos entran al
`tests/baseline-rojos.json`; los gates de las demás fichas van a seguir rojos mientras tanto.

Los 26 `skipped` son los preexistentes de `AnaliticaPage` (17) y `AnaliticaShell` (9). Ninguno de la
ficha. Miré los `skipped`, no sólo el exit code.

---

## 2. CHECKPOINTS.md, punto por punto

- [x] `requirements.md` con EARS numerados `R1`..`R12`.
- [x] `design.md` con alternativas descartadas y su porqué — **siete** (A...G), incluida la que el
      humano tumbó el 2026-09-10 (vocabulario propio).
- [x] `tasks.md`: **11 de 11 en `[x]`**, cero pendientes.
- [x] Cada `R<n>` mapea a un test concreto que se pone rojo (seccion 3).
- [x] `progress/impl_408.md` trae el mapa `R<n>` -> test.
- [x] `pnpm run typecheck` — verde (corrido por mí, dos veces).
- [x] `pnpm run lint` — verde (183 warnings preexistentes, 0 errores).
- [x] `pnpm test` — 27.172 verdes; los 5 rojos son ajenos y reproducidos en `dev` (seccion 1).
- [~] **E2E: inaplicable.** No toca auth, pagos, recaudo, ingesta ni webhooks: cambia cómo se pinta
      un texto que ya existía. Y este repo no tiene arnés E2E vivo.
- [n/a] RLS, migraciones y `down.sql`: **cero cambios en `db/`**.
- [x] Sin secretos: el diff no trae `.env` ni credencial ninguna. El `.env` que yo copié al worktree
      para poder correr la integración está gitignorado y **lo borré**; el árbol quedó limpio.
- [n/a] Capas (controller/service/repository): frontend puro. `cierre-labels.ts` sigue siendo módulo
      **puro** — sus dos imports nuevos (`CAUSA_DEVOLUCION_LABEL`, `CAUSA_DEVOLUCION_SEED`) son
      módulos sin React ni DOM, comprobado leyéndolos.
- [n/a] Permisos: no cambia ni una lectura de datos.
- [x] Multi-país: ni país, ni moneda, ni cuenta en el texto nuevo.
- [x] `progress/review_408.md` — este archivo.
- [ ] `progress/history.md` **sin entrada de la 408**. En este repo esa entrada la escribe el leader
      sobre `dev` después de mergear (los 8 últimos commits que tocan el archivo son `chore(NNN)` o
      `docs(NNN)` en `dev`), así que **no es un hueco del implementador**: queda para el cierre.

---

## 3. Trazabilidad: los 12 requisitos, verificados por mí

Los verifiqué **uno a uno**, leyendo el test y comprobando que enrojece con una mutación. Los 12
tienen test real; ninguno se queda en un test vacío.

| R | Test que lo sostiene | Cómo comprobé que no está vacío |
| --- | --- | --- |
| R1 | `motivo-rechazo-automatico-legible.test.ts` (3 casos, un literal a mano por causa) + hoja fundida | M1 y M5 lo enrojecen |
| R2 | mismo archivo, 6 casos **por las 2 variantes** (texto libre, plantilla dentro de una frase, cadena vacía, otra caja, prefijo y espacio de más, `constructor` / `__proto__`) | M2 lo enrojece |
| R3 | unitario (nulo devuelve nulo) + celda nula en las **tres** descargas | M3: 5 rojos en 4 archivos |
| R4 | `motivo-automatico-sin-jerga.guardia.test.ts` — guardia **sobre la salida**, recorre el SEED y trae **control de no-vacuidad** propio | M1 la enrojece; el control mata el «verde sin datos» |
| R5 | causa desconocida devuelve la entrada idéntica, por las 2 variantes, y explícitamente ni `undefined` ni nulo ni cadena vacía | M1 |
| R6 | los 3 tests de descarga (corto, corto, **largo**) | M4: 7 rojos en 3 archivos |
| R7 | `Object.freeze` + comparación profunda + dos invocaciones + un tercer caso que destaparía un emparejador con estado | — |
| R8 | `CierreMotivoRechazoAutomatico.test.tsx`: badge `Automático` + la nota literal completa en `title` **y** `aria-label`, y el `Manual` del otro | — |
| R9 | misma tabla: la celda es **exactamente** `Dirección errada` y no contiene «automático», ni la nota, ni «plazo» | M5 |
| R10 | los casos usan la cadena de producción tal cual; **evidencia estructural**: el diff no toca `lib/`, `db/` ni el DTO (verificado con `git diff --stat`) | — |
| R11 | los 3 literales largos completos + la pantalla real del mensajero + su descarga | **M6: 6 rojos**; M7: 12 |
| R12 | el largo **contiene** el corto tecleado, para las tres causas | M5 y M7 |

---

## 4. Las siete mutaciones, reaplicadas por mí

Cada una sobre el árbol, corriendo los 7 archivos de la ficha (124 casos de baseline), anotando los
rojos y revirtiendo con `git checkout -- app/`. Árbol limpio al terminar.

| # | Mutación | Rojos (yo) | Archivos | Bitácora | Cuadra |
| --- | --- | --- | --- | --- | --- |
| 1 | devolver la entrada sin traducir | **35** | 7 de 7 | 35 / 7 | sí |
| 2 | emparejamiento laxo en vez de igualdad exacta | **4** | 1 | 2 / 1 | sí (usé `includes`, más agresivo que su `startsWith`; **las dos mueren**) |
| 3 | colapsar el nulo a guion dentro de la función | **5** | 4 | 5 / 4 | sí — incluido el **R46 preexistente** de la hoja fundida |
| 4 | traducir en pantalla y no en la descarga | **7** | 3 | 7 / 3 | sí |
| 5 | cambiar una palabra del catálogo | **12** | 6 | 12 / 6 | sí |
| 6 | **`true` fijo en los 8 llamadores de `/cierre-dia`** | **6** | **2** | 6 / 2 | **sí, exacta** |
| 7 | borrar la cola del texto largo | **12** | 3 | 12 / 3 | sí |

**La 6, que es la que importa** — reaplicada tal cual: los 4 renders de `CierreDiaModule.tsx` y las
4 celdas de `cierre-dia-descarga-columnas.ts` a `true` fijo. Salieron **exactamente los mismos 6
nombres** que anota la bitácora:

```
Test Files  2 failed | 5 passed (7)
     Tests  6 failed | 118 passed (124)

FAIL  la celda «Motivo» lleva el texto LARGO completo
FAIL  NO se aplica aquí la variante corta del admin
FAIL  una DEVUELTA con la plantilla del cron también se traduce, y con el texto largo
FAIL  un rechazo automático emite el texto LARGO, no la etiqueta a secas (R6/R11)
FAIL  y en esa celda no queda ni la sigla ni el value del enum (R4)
FAIL  una DEVUELTA con la plantilla también se traduce, y con el mismo texto largo (R6)
```

El fallo mudo que la ficha se puso por objetivo **está cazado**.

---

## 5. Los cinco puntos que el implementador declaró

### 5.1 «13 puntos de llamada» (design 3) contra los 18 de su tabla (design 4) — los conté yo: son 18

`grep` archivo por archivo sobre el árbol: `cierre-detalle-shared.tsx` 4,
`cierre-gestiones-descarga-columnas.ts` 4, `cierres-gestiones-fundida-descarga-columnas.ts` 1,
`cierre-factura.tsx` 1, `CierreDiaModule.tsx` 4, `cierre-dia-descarga-columnas.ts` 4 = **18**, y
**los 18 pasan `gestion.esRechazoSla`**. Comprobé además que no queda ninguna huérfana: hay 4
columnas `id: "motivo"` en cada pantalla y 4 celdas `clave: "motivo"` en cada descarga — tantas
declaradas como traducidas. El único `g.motivo` crudo que sigue vivo en `cierres-admin` es el del
diálogo de indemnización (`CierresAdminModule.tsx:1472`), que itera **incidentes**: un resultado que
el cron nunca produce. Fuera de alcance, y bien declarado.

**Hizo bien en no editar el spec**: el documento está aprobado y renumerarlo lo decide quien lo
aprobó. Lo que **no** debió hacer es copiar el número equivocado al código (hallazgo M1).

### 5.2 El hueco del `false` fijo — su razonamiento es correcto, y queda cerrado por escrito

Lo reproduje: cambiando los 8 llamadores de `/cierre-dia` a `false` fijo, **los 124 tests siguen
verdes y el typecheck limpio**. El hueco existe exactamente como lo declara.

Y **no hay forma de taparlo que no contradiga la ficha**:

1. El único discriminador posible entre `g.esRechazoSla` y `false` en esa vista es el caso
   `esRechazoSla === true`. El servidor **no puede producirlo**: `CierreDiaRepository.ts:295` es un
   literal `false`, y lo verifiqué en el archivo — es su única aparición en todo `lib/`.
2. Peor todavía: si algún día lo produjera, el texto correcto ahí **seguiría siendo el largo**,
   porque `/cierre-dia` no tiene columna «Origen» pase lo que pase con el booleano. Un test que
   afirmara «true implica texto corto en `/cierre-dia`» no protegería nada: **atornillaría el bug**.
   El fixture ya lo dice por tipos (`Omit<Partial<...>, "esRechazoSla">`), que es la forma honesta de
   decir «este estado no existe», y el caso «esta pantalla NO tiene columna Origen» ancla la premisa.
3. Las dos alternativas que se me ocurren son peores. (a) Una guardia sobre el **texto fuente** —«los
   cuatro renders pasan `g.esRechazoSla`»— mide escritura y no comportamiento, y este repo ya midió
   que esa clase de guardia se queda verde cuando se cambia sólo una de varias escrituras. (b) Un
   envoltorio del tipo `motivoGestionLegibleSinMarcador(motivo)` para las superficies sin columna
   «Origen» haría el hardcode correcto por construcción, pero reabre una decisión cerrada: «todos los
   llamadores pasan `gestion.esRechazoSla`».

**No es hallazgo.** Es deuda declarada, ya escrita en `impl_408.md`, y el riesgo residual es cero
mientras la decisión de la 102 no cambie. Nota: el hallazgo M2 de más abajo enseña que **el día que
cambie, el comprobante habrá que tocarlo igualmente** — o sea que el sitio por donde se reabrirá esto
ya tiene nombre y dirección.

### 5.3 Ningún `toEqual` ajeno tocado — cierto, verificado en el diff

`git diff --numstat dev...HEAD -- tests/` da **0 líneas borradas** en los 7 archivos
(262/251/227/82/77/55/69 añadidas, **0 eliminadas**). No hay una sola línea que empiece por menos
fuera de las cabeceras del diff. Los tres archivos ampliados sólo ganan bloques al final y dos
imports. Nada borrado, nada debilitado, y ningún test ajeno murió dentro de lo tocado.

### 5.4 Literales tecleados a mano — cierto, caso por caso, y además medido

Grep sobre los 7 archivos: **ninguno** menciona `CAUSA_DEVOLUCION_LABEL`,
`MOTIVO_RECHAZO_AUTOMATICO_COLA`, `RECHAZO_SLA_BADGE_NOTA` ni `RECHAZO_MANUAL_BADGE_NOTA`. Lo único
que importan de `cierre-labels` es **la función bajo prueba**. Las tres etiquetas, los tres textos
largos y la nota del marcador están tecleados como constantes locales del test.

Y no me quedé en la lectura: **la mutación 5** (cambiar una palabra del catálogo) produce **12 rojos
en 6 archivos**. Si los literales se compararan contra su propia fuente, esa mutación habría salido
verde entera. Es la prueba por comportamiento de que están atornillados.

Las dos únicas comparaciones entre salidas de la propia función son «el largo no es el corto» (R11) y
el `toContain` de R12: las dos afirman una **relación entre las dos ramas**, no un texto, y ambas
conviven en el mismo archivo con la aserción literal del mismo caso. Correcto.

### 5.5 El texto en `/cierre-dia` — sí, un mensajero lo entiende

> `Dirección errada · lo rechazó el sistema al vencerse el plazo de la devolución`

Responde las tres preguntas que la fila le deja al mensajero: **qué pasó** (la causa), **quién lo
hizo** (el sistema, no él) y **por qué** (venció el plazo de la devolución). No usa la sigla, no
depende de ningún `title` —que en táctil no existe— y no estrena vocabulario: «plazo vencido» y
«plazo de la devolución» es lo que ya dicen Novedades («Rechazadas por plazo vencido», «No tenés
órdenes rechazadas por plazo vencido») y la propia nota del marcador. Un concepto, un nombre, y
ninguna sigla en pantalla.

---

## 6. Hallazgos

### menor M1 — el comentario del código dice «trece» donde hay 18

`app/(app)/cierres-admin/_components/cierre-labels.ts:497`: «Los trece puntos de llamada pasan
SIEMPRE `gestion.esRechazoSla`». Son **18** (seccion 5.1). El número malo de la prosa del `design.md`
acabó copiado dentro del código; el mensaje del commit `ae919166`, en cambio, **sí dice 18**. Es un
comentario, no comportamiento: no bloquea, pero conviene arreglarlo en el mismo barrido que corrija
la prosa del spec. Si no, dentro de seis meses alguien contará trece y creerá que faltan cinco.

### menor M2 — el comprobante del mensajero se contradice: texto largo pegado al badge «Manual»

**Medido, no supuesto**: monté una sonda desechable sobre `CierreFacturaDetalle audiencia="mensajero"`
y la borré. En `/cierre-dia`, abriendo un cierre pasado y desplegando la fila de un rechazo del cron,
hoy se lee esto junto:

```
Motivo: Dirección errada · lo rechazó el sistema al vencerse el plazo de la devolución
Ingreso de bodega por rechazos: 1.500
[Manual]    title/aria-label: "Rechazo registrado manualmente por el mensajero."
```

O sea: **en esa fila el marcador SÍ se pinta, y dice lo contrario que el motivo** — encima
atribuyéndole el rechazo al mensajero. Con eso, la afirmación de `design.md` seccion 3 —«`esRechazoSla`
es `true` exactamente en las filas donde el marcador se pinta [...] y las dos cosas no pueden
desincronizarse»— tiene un contraejemplo: en este llamador el marcador se pinta con el flag en
`false`.

**Por qué NO lo marco bloqueante, y lo pensé despacio:**

- **No es regresión.** Antes de esta ficha la misma tarjeta ya decía «Manual» al lado de
  `escalado SLA wrong_address`. La contradicción es hija de la 102, no de la 408; lo que cambia es
  que ahora se lee.
- **El estado nuevo es mejor que el viejo**, no peor: de las dos frases de la tarjeta, la que esta
  ficha añade es **la verdadera**. Con la variante corta el resultado sería «Dirección errada» +
  «Manual», que es una mentira limpia — peor.
- **Ningún requisito se rompe.** R11 está condicionado a que la fila no muestre marcador; R9 exige
  que la celda no repita la frase del marcador, y no la repite: la contradice.
- **Los dos arreglos posibles están declarados fuera de alcance en el propio spec**: esconder el
  badge para la audiencia mensajero es «rediseñar el marcador», y derivar `esRechazoSla` para esa
  vista es la alternativa G, descartada por ser backend. Devolvérselo al implementador sería pedirle
  que viole el alcance aprobado.

**Lo que sí pido al leader**: que el límite quede escrito (design seccion 7 declara el `title` en
táctil y la columna «Origen» ocultable en la descarga, pero no esto) y que salga **ficha de
seguimiento** para el comprobante del mensajero. Es, además, el sitio exacto donde habrá que decidir
el día que se reabra lo de 5.2.

### menor M3 — un solo commit para T1..T10

`docs/conventions.md` pide «un commit por task lógica completada, no un mega-commit al final»; la
implementación entera llegó en `ae919166`. Sin impacto práctico —el mapa de requisitos y la bitácora
dejan todo trazable—, se anota por completitud.

### Fuera de esta ficha, para el leader (lo vi de paso, con un número delante)

La misma sonda enseñó que el comprobante con `audiencia="mensajero"` pinta **«Ingreso de bodega por
rechazos»** con su monto, que es plata de Ordenex, mientras ese mismo componente sí esconde el
ingreso y la liquidación para esa audiencia en otros cinco sitios (`cierre-factura.tsx:1853, 1899,
1933, 1955, 1984`). Preexistente y **sin ninguna relación con la 408**; lo digo porque está medido,
no para que entre en este PR.

---

## 7. Las trampas que fui a buscar a propósito

| Trampa | Resultado |
| --- | --- |
| **Aserción contra su propia fuente** | **No hay.** Grep limpio en los 7 archivos, y la mutación 5 (12 rojos en 6 archivos) lo demuestra por comportamiento. |
| **Literal: contrato o polizón** | **Ningún literal existente cambió.** Los `toEqual` de las descargas siguen intactos; el R46 de la hoja fundida (celda vacía, nunca el guion) sigue vivo y **enrojece** con la mutación 3, que es la prueba de que ese literal sigue siendo el contrato. |
| **El test que vive dentro de lo que borras** | **No se borró nada:** 0 líneas eliminadas en `tests/`. |
| **Test verde sin datos** | La guardia trae **control de no-vacuidad explícito** (el SEED tiene al menos 3 valores y la salida no es la entrada); los helpers `celdaDe` fallan si la columna o la fila no existen, en vez de devolver cadena vacía en silencio. |
| **Alcance: frontend puro** | Confirmado: cero `lib/`, cero `db/`, cero DTO, `DevolucionSlaService` intacto, histórico intacto. |
| **Fallo mudo** | Es el corazón de la ficha y **está cazado** (mutación 6, 6 rojos en 2 archivos). El único hueco que queda es el `false` fijo, razonado y cerrado en 5.2. |

---

## Veredicto

**APROBADO.** Cero bloqueantes. Los 12 requisitos tienen un test que se pone rojo si el código está
mal; las 7 mutaciones mueren y la del fallo mudo da los 6 rojos exactos que declara la bitácora; el
gate completo sólo trae rojos ajenos, reproducidos uno a uno contra `dev` limpio con la misma base
local.

Quedan dos cosas de leader, ninguna de código: la entrada en `progress/history.md` y el límite del
comprobante del mensajero (M2), escrito y con ficha de seguimiento. El comentario de las «trece»
llamadas (M1) puede ir en el mismo barrido que arregle la prosa del `design.md`.
