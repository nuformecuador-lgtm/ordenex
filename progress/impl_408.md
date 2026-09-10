# impl_408 — El motivo de un rechazo automático se lee en lenguaje humano

- **Rama:** `feat/408-motivo-rechazo-automatico-legible`
- **SHA base:** `1754df7c` (`docs(408): spec del motivo legible, y la ficha arranca`)
- **Zona:** frontend puro. Cero migraciones, cero cambios de DTO, cero endpoints, cero `lib/`.
- **Fecha:** 2026-09-10

---

## 1. Qué se hizo

La plantilla que compone el cron de plazos vencidos —`escalado SLA <causa>`,
`lib/services/DevolucionSlaService.ts`— se traduce **al pintar**, en el módulo PURO
`cierre-labels.ts`. El histórico de `gestion_orden.motivo` **no se toca** (esas filas son
evidencia) y el productor del texto tampoco.

Vocabulario: el **ya aprobado en la feature 73** (`CAUSA_DEVOLUCION_LABEL`, 2026-07-15) —
«Cliente no localizado» / «Número de celular errado» / «Dirección errada». Ni una palabra nueva.

Dos variantes del mismo texto, un solo vocabulario:

| Contexto de la fila | Texto |
| --- | --- |
| con marcador «Automático» a la vista (admin) | `Dirección errada` |
| sin marcador (`/cierre-dia`) | `Dirección errada · lo rechazó el sistema al vencerse el plazo de la devolución` |

`null` sigue siendo `null` **dentro** de la función: el `?? "—"` vive en el render, para que el
guion de pantalla no acabe dentro de una celda de Excel.

### Archivos de producción tocados (7)

| Archivo | Qué |
| --- | --- |
| `app/(app)/cierres-admin/_components/cierre-labels.ts` | **T1** — `MOTIVO_RECHAZO_AUTOMATICO_COLA` y `motivoGestionLegible(motivo, hayMarcadorDeOrigen)`. Importa `CAUSA_DEVOLUCION_LABEL` y `CAUSA_DEVOLUCION_SEED`: los dos módulos son puros, así que el archivo sigue sin React. |
| `app/(app)/cierres-admin/_components/cierre-detalle-shared.tsx` | **T4** — las 4 columnas «Motivo»; además importa y **re-exporta** el traductor, que es la puerta por la que las pantallas de cierre piden sus textos desde la 170. |
| `app/(app)/cierres-admin/_components/cierre-factura.tsx` | **T4** — la `DatoFila` del motivo del comprobante (1 punto). |
| `app/(app)/cierres-admin/_components/cierre-gestiones-descarga-columnas.ts` | **T5** — las 4 celdas `motivo`. |
| `app/(app)/cierres-admin/_components/cierres-gestiones-fundida-descarga-columnas.ts` | **T5** — la celda `motivo` de la hoja fundida (1 punto). |
| `app/(app)/cierre-dia/_components/CierreDiaModule.tsx` | **T7** — las 4 columnas «Motivo». Símbolo añadido al import de `cierre-labels` que **ya existía**. |
| `app/(app)/cierre-dia/_components/cierre-dia-descarga-columnas.ts` | **T7** — las 4 celdas `motivo`. Mismo import ya existente. |

**Los 18 puntos de llamada pasan `gestion.esRechazoSla`**, sin excepción — el mismo booleano que
decide si el marcador se pinta. Comprobado con `grep -c` archivo por archivo: 4+4+1+1+4+4 = 18.
(⚠️ El `design.md` §3 decía «13 puntos de llamada» en prosa, contra los 18 que enumera su propia
tabla de §4. Se implementaron **todos los que §4 enumera**; el 13 se coló además en el comentario
de `motivoGestionLegible`. **Las dos líneas se corrigieron tras la revisión** — ver §6.)

### Archivos de test (4 nuevos, 3 ampliados)

| Archivo | Estado |
| --- | --- |
| `tests/unit/components/motivo-rechazo-automatico-legible.test.ts` | nuevo (24 casos) |
| `tests/unit/guards/motivo-automatico-sin-jerga.guardia.test.ts` | nuevo (13 casos) |
| `tests/components/CierreMotivoRechazoAutomatico.test.tsx` | nuevo (8 casos) |
| `tests/components/CierreDiaMotivoRechazoAutomatico.test.tsx` | nuevo (7 casos) |
| `tests/unit/descarga/cierre-gestiones-descarga-columnas.test.ts` | ampliado (+4) |
| `tests/unit/descarga/cierres-gestiones-fundida-descarga-columnas.test.ts` | ampliado (+3) |
| `tests/unit/descarga/cierre-dia-descarga-columnas.test.ts` | ampliado (+5) |

**Ni un `toEqual` existente se tocó**, y no se borró ningún test ajeno: los tres archivos
ampliados sólo ganan bloques nuevos al final (y dos imports). **Todos los literales van tecleados
a mano**: ningún caso compara la salida contra `CAUSA_DEVOLUCION_LABEL`, contra
`MOTIVO_RECHAZO_AUTOMATICO_COLA` ni contra otra llamada a `motivoGestionLegible` — eso sería
«aserción contra su propia fuente» y saldría verde con las palabras rotas.

---

## 2. Mapa `R<n>` → test

| R | Qué exige | Test que lo cubre |
| --- | --- | --- |
| **R1** | las tres plantillas en castellano | `motivo-rechazo-automatico-legible.test.ts` → «R1 — la plantilla del cron se lee en castellano…» (3 casos, un literal a mano por causa) + `cierres-gestiones-fundida-…test.ts` → «las otras dos causas también salen en castellano (R1)» |
| **R2** | lo que no es la plantilla sale intacto, en **las dos** variantes | `motivo-…legible.test.ts` → «R2 — lo que NO es exactamente la plantilla sale intacto…» (6 casos × 2 variantes: texto libre, plantilla dentro de una frase, cadena vacía, otra caja, prefijo/espacio de más, claves del prototipo) + `CierreMotivoRechazoAutomatico.test.tsx` → «las dos filas conviven» + `CierreDiaMotivoRechazoAutomatico.test.tsx` → «el motivo que él escribió sale intacto» |
| **R3** | nulo: `"—"` en pantalla, **celda vacía** en el archivo | `motivo-…legible.test.ts` → «R3 — un motivo ausente sigue siendo ausente» (×2 variantes) + `cierre-gestiones-descarga-columnas.test.ts` → «un motivo AUSENTE deja la celda VACÍA…» + `cierre-dia-descarga-columnas.test.ts` → ídem + los dos componentes → «un motivo ausente sigue pintando el guion» |
| **R4** | ni la sigla ni el value del enum en pantalla | `tests/unit/guards/motivo-automatico-sin-jerga.guardia.test.ts` — guardia de **comportamiento**: recorre `CAUSA_DEVOLUCION_SEED`, compone la plantilla, pasa la salida por las dos variantes, y trae su propio control de no-vacuidad |
| **R5** | causa desconocida → entrada idéntica | `motivo-…legible.test.ts` → «R5 — una causa que el catálogo no conoce sale tal cual» (×2 variantes; afirma además que no es `undefined`, `null` ni `""`) |
| **R6** | el archivo dice lo mismo que la pantalla | `cierre-gestiones-descarga-columnas.test.ts` (corto), `cierres-gestiones-fundida-descarga-columnas.test.ts` (corto), `cierre-dia-descarga-columnas.test.ts` (largo, R11) |
| **R7** | función pura, la gestión no se toca | `motivo-…legible.test.ts` → «R7 — la traducción no toca el dato»: `Object.freeze` + comparación profunda antes/después, dos invocaciones iguales, y un tercer caso que destaparía un emparejador con estado |
| **R8** | el marcador sigue diciendo lo que decía | `CierreMotivoRechazoAutomatico.test.tsx` → «R8 — el marcador de origen sigue diciendo lo que decía»: `"Automático"` + la nota literal completa en `title` y `aria-label`, y el `"Manual"` del rechazo del mensajero |
| **R9** | la celda «Motivo» no repite el marcador | `CierreMotivoRechazoAutomatico.test.tsx` → «R9 — donde está el marcador, la columna «Motivo» no lo repite»: la celda es exactamente `"Dirección errada"`, no contiene «automático», ni la nota, ni «plazo» |
| **R10** | las filas ya guardadas se traducen sin migración | Los casos de R1/R6/R11 usan la cadena de producción **tal cual** (`"escalado SLA wrong_address"`) y las gestiones de prueba se construyen sólo con campos que el DTO ya tiene. Evidencia estructural: el diff de la rama **no toca `lib/`, `db/` ni ningún DTO** (`git show --stat`) |
| **R11** | sin marcador, el texto se sostiene solo | `motivo-…legible.test.ts` → «R11 — sin marcador de origen…» (los tres literales largos completos, a mano, + «la variante larga es DISTINTA de la corta») + `CierreDiaMotivoRechazoAutomatico.test.tsx` (la pantalla real) + `cierre-dia-descarga-columnas.test.ts` (el archivo) |
| **R12** | las dos variantes, la misma palabra | `motivo-…legible.test.ts` → «R12 — las dos variantes nombran la causa con la MISMA palabra»: para las tres causas, el largo **contiene** el literal corto tecleado |

---

## 3. Las siete mutaciones (T10)

Cada una se aplicó **sobre el árbol**, se corrieron los 7 archivos de esta ficha (**124 casos en
verde de baseline**), se anotó el número de rojos y se revirtió con `git checkout --`. Después de
la séptima se volvió a correr el conjunto: **124/124 verdes**, árbol limpio (`git status`
vacío). **Ninguna sobrevivió.**

| # | Mutación | Rojos | Archivos rojos | Qué la mató |
| --- | --- | --- | --- | --- |
| 1 | devolver la entrada sin traducir | **35** | 7 de 7 | R1, R4, R6, R9, R11, R12 — la ficha entera |
| 2 | igualdad exacta → `startsWith` | **2** | 1 | R2, «un motivo que sólo se parece por el prefijo tampoco se traduce», en las dos variantes |
| 3 | colapsar `null` a `"—"` dentro de la función | **5** | 4 | R3 en el traductor y en las dos descargas, **más el caso R46 preexistente** de la hoja fundida («un dato nulo deja la celda vacía y nunca el guion de pantalla») |
| 4 | traducir en pantalla y **no** en la descarga | **7** | 3 | R6 en los tres archivos de descarga (y R4 dentro de ellos) |
| 5 | cambiar una palabra del catálogo («Dirección errada» → «Dirección incorrecta») | **12** | 6 | R1, R9, R11, R12 y las dos descargas: el vocabulario está atornillado a mano en seis sitios |
| 6 | **`true` fijo en los llamadores de `/cierre-dia`** (el fallo mudo) | **6** | 2 | R11: `CierreDiaMotivoRechazoAutomatico.test.tsx` (3) y `cierre-dia-descarga-columnas.test.ts` (3) |
| 7 | borrar la cola del texto largo | **12** | 3 | R11 y R12 |

### La mutación 6, con detalle, porque es la que la ficha declara como fallo mudo

Se cambiaron los **8** llamadores de `/cierre-dia` (4 en `CierreDiaModule.tsx` + 4 en
`cierre-dia-descarga-columnas.ts`) de `g.esRechazoSla` a `true` fijo. **Nada se rompe a la
vista**: no hay excepción, no hay hueco, no hay warning — sólo un texto más corto, y un mensajero
que se queda sin saber que el rechazo no fue suyo. Murió con **6 rojos**:

```
× un rechazo automático emite el texto LARGO, no la etiqueta a secas (R6/R11)
× y en esa celda no queda ni la sigla ni el value del enum (R4)
× una DEVUELTA con la plantilla también se traduce, y con el mismo texto largo (R6)
× la celda «Motivo» lleva el texto LARGO completo
× NO se aplica aquí la variante corta del admin
× una DEVUELTA con la plantilla del cron también se traduce, y con el texto largo
Test Files  2 failed | 5 passed (7)
     Tests  6 failed | 118 passed (124)
```

---

## 4. Gate

### El rápido se niega solo, como el spec anunció

```
Tu cambio toca cimientos, y para eso el modo rapido no alcanza:
    app/(app)/cierre-dia/_components/CierreDiaModule.tsx
    app/(app)/cierre-dia/_components/cierre-dia-descarga-columnas.ts
    app/(app)/cierres-admin/_components/cierre-detalle-shared.tsx
    app/(app)/cierres-admin/_components/cierre-factura.tsx
    app/(app)/cierres-admin/_components/cierre-gestiones-descarga-columnas.ts
    app/(app)/cierres-admin/_components/cierre-labels.ts
    app/(app)/cierres-admin/_components/cierres-gestiones-fundida-descarga-columnas.ts
✗ esto exige el gate completo. Corre: ./init.sh
INIT_EXIT=1
```

Los siete llevan `cierre` en el nombre, que está en la lista de nombres de dinero de
`docs/verification.md`. No es un contratiempo: es la regla funcionando.

### `./init.sh` completo — VERDE

```
✓ typecheck paso
✓ lint paso                              (183 warnings preexistentes, 0 errores)
✓ DATABASE_URL resuelta: los 154 archivos de tests contra Postgres SI se ejecutan
 Test Files  1865 passed (1865)
      Tests  27177 passed | 26 skipped (27203)
   Duration  660.52s
✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 1865 ejecutado(s), todos en el baseline conocido)
! migraciones sin down.sql: 20260814120000_ruta_optimizada_trazado 20260814140000_ruta_parada_tramo 20260814160000_ruta_tramo_vivo_at
✓ .env presente
== init OK ==
INIT_EXIT=0
```

El `INIT_EXIT=$?` se escribió **dentro** del log (no por un `echo` posterior en consola, que
habría tapado un rojo), y el log tiene ruta propia del agente — no un `/tmp/gate.log` genérico
que otro worktree pueda pisar.

**Los `skipped`, mirados y no sólo el exit code:**

- **`integration/db`: SÍ corrieron.** El worktree nace sin `.env`; se copió el del checkout
  principal tras comprobar que su `DATABASE_URL` activa apunta a `localhost:5432/ordenex` (la de
  Supabase está comentada en ese archivo). El gate lo confirma con su propia cifra:
  **154 archivos contra Postgres ejecutados**, y en el log aparecen **232 archivos distintos**
  bajo `tests/integration/db/` en verde. El `.env` se borró al terminar y **nunca se commiteó**
  (está gitignorado).
- **26 casos `skipped`, ninguno de esta ficha:** 17 en `tests/components/AnaliticaPage.test.tsx`
  y 9 en `tests/components/AnaliticaShell.test.tsx`. Preexistentes y ajenos.
- **Cero `40P01`** en toda la corrida: no hubo contención con otro agente y no hizo falta
  re-correr ningún archivo aislado.
- La advertencia de las 3 migraciones sin `down.sql` es preexistente y de otras fichas: esta no
  toca `db/`.

---

## 5. Lo que queda abierto

1. **CERRADO (ver §6): el conteo «13» vs 18.** Estaba en el `design.md` §3 y —eso es lo que
   duele— acabó copiado al comentario de `motivoGestionLegible`. Los dos dicen ya 18.
2. **Un `false` fijo en los llamadores de `/cierre-dia` NO lo caza ningún test, y es honesto
   decirlo.** Hoy es indistinguible del código correcto, porque `CierreDiaRepository` manda
   siempre `false` para esa vista: el resultado pintado sería idéntico. Sólo empezaría a
   importar si esa decisión de la 102 cambiara. No está en la lista de mutaciones del design y
   no se inventó un test que lo cubriera, porque el único que lo haría tendría que afirmar
   «`true` → texto corto en `/cierre-dia`», que es precisamente lo que la ficha dice que NO debe
   pasar. Queda como residual conocido.
3. **El límite ya declarado en el spec §7, que esta ficha no arregla:** la nota del marcador
   «Automático» viaja en `title`/`aria-label`, y en táctil no existe. Por eso el texto de R11 no
   depende de ella — pero la superficie de admin sigue con esa deuda.
4. **Sincronización con `dev`:** `origin/dev` avanzó de `1754df7c` a `aff769d8` mientras corría
   esta ficha, con **cuatro commits de sólo specs, `design-notificaciones/` y
   `feature_list.json`**. Cero intersección con los 7 archivos de producción de aquí, así que no
   se mergeó: el gate medido sigue valiendo y el PR entra limpio. Si `dev` gana código antes del
   merge, hay que volver a medir.
5. **`feature_list.json` y `progress/current.md` NO se tocaron**, como pedía el encargo: los
   gestiona el leader.

---

## 6. Post-revisión (2026-09-10) — el comentario que se quedó mintiendo

La revisión salió **aprobada, cero bloqueantes**, con una corrección pedida antes de mergear.

**El defecto:** `cierre-labels.ts` decía «Los trece puntos de llamada» en el comentario de
`motivoGestionLegible`. El número equivocado venía del `design.md` §3 y **acabó copiado al
código**. El mensaje de commit sí decía 18 —la cuenta se hizo bien—, así que lo que se quedó
atrás fue el comentario, que es justo lo peor: **un comentario falso no lo pone rojo nadie**, y
la ficha 405 corrigió tres del mismo tipo el mismo día, una de ellas ya en producción.

**Las dos correcciones:**

| Dónde | Antes | Ahora |
| --- | --- | --- |
| `app/(app)/cierres-admin/_components/cierre-labels.ts` (comentario de `motivoGestionLegible`) | «Los trece puntos de llamada» | «Los DIECIOCHO puntos de llamada», con el desglose por archivo (4 + 4 + 1 + 1 + 4 + 4) escrito al lado, para que la cuenta se pueda comprobar sin salir del archivo |
| `specs/408-motivo-rechazo-automatico-legible/design.md` §3 | «los 13 puntos de llamada» | «los 18 puntos de llamada», con nota de la corrección y de su fecha |

**Por qué el `design.md` se edita AHORA y no antes:** mientras se implementa, el spec es la
referencia independiente contra la que el reviewer mide; corregirlo sobre la marcha la destruye.
Con la revisión ya cerrada, dejarlo mal sería sembrar el mismo error para el siguiente que lo
lea — que es exactamente cómo llegó al código esta vez.

**Dos cosas que el reviewer cerró por escrito y que estaban aquí como abiertas:**

- **El hueco del `false` fijo (§5.2) queda confirmado, no refutado.** Lo reprodujo: con `false`
  fijo en los llamadores de `/cierre-dia`, los 124 tests siguen verdes. Y confirmó que no hay
  forma de protegerlo sin contradecir la ficha — el único discriminador sería un test de
  «`true` → texto corto en `/cierre-dia`», que atornillaría el bug en lugar de impedirlo.
  Declararlo era lo correcto; fabricar una protección falsa, no.
- **Los rojos ajenos de la base local no son de esta rama.** El reviewer corrió `dev` limpio
  contra la misma base local y salieron los mismos: es la migración de otra ficha aplicada a la
  base compartida.
