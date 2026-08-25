# Revisión — Feature 278 · el portal del `adminSatelite` se parte en «Por recibir» y «En bodega»

> Rama `feature/278-satelite-por-recibir-y-bodega`, HEAD `c9281ef5`, 6 commits sobre `dev`
> (`6c00ba9e`, base común verificada). Revisión del 2026-08-24.
> **Veredicto: RECHAZADO — 3 bloqueantes.**
>
> Nada de lo que sigue se hereda de `progress/impl_278.md`: cada número de este informe se
> volvió a medir. Donde la bitácora y la medida coinciden, se dice; donde no, también.

---

## 1. Checklist de `CHECKPOINTS.md`

### Especificación
- [x] `specs/278-satelite-por-recibir-y-bodega/requirements.md` con 47 requisitos EARS `R1`…`R47`, incluida la sección «P1 — FIRMADA».
- [x] `design.md` con alternativas descartadas y su porqué (borrar la ruta, redirigir a «En bodega», renombrar el módulo, conservar `mostrarAcciones`, dejar las claves inertes).
- [ ] **`tasks.md` con todas las tasks marcadas `[x]` → NO. 0 de 38.** Ver BLOQUEANTE 1.

### Trazabilidad
- [x] Cada `R<n>` mapea a al menos un test concreto (revisados los 47 abriendo el test, no la tabla).
- [x] `progress/impl_278.md` contiene el mapa `R<n> → test` (§8 para R34–R41, §18 para R1–R33 y R42–R47).
- [ ] **Un test nombrado no verifica lo que dice verificar: el de R22.** Ver BLOQUEANTE 2.

### Calidad de código
- [x] `pnpm run typecheck` sin errores.
- [x] `pnpm run lint` sin errores (101 warnings, las mismas preexistentes; ninguna en archivos de esta ficha).
- [x] `pnpm test` en verde.
- [~] E2E: **inaplicable en este repo**. Los tres specs tocados declaran `NOT EXECUTED` en su
  cabecera y la ficha lo repite en cada `goto` corregido. **No cuenta como cobertura** y así está
  escrito. Las cuatro rutas se corrigieron por lectura, y las dos `page.tsx` a las que apuntan
  existen en el árbol (comprobado).

### Datos y seguridad (Supabase)
- [x] Ninguna tabla nueva ⇒ nada de RLS que activar. `git diff 6c00ba9e..HEAD -- db/` **vacío**.
- [x] Ninguna migración nueva ⇒ ningún `down.sql` que escribir. El aviso de `down.sql` del gate es
      la familia `ruta_*`, preexistente y ajena.
- [x] Ningún secreto hardcodeado. Ninguna variable de entorno nueva.
- [x] Ningún webhook nuevo.

### Patrón de capas
- [x] Las dos páginas son Server Components: gate de rol server-side y luego Server Actions. Cero queries.
- [x] El servicio no conoce HTTP; el repositorio sigue siendo sólo Prisma.
- [x] **Las seis retiradas de servidor son borrado puro**: `git diff --numstat` da **0 inserciones**
      en `RecepcionSateliteService.ts`, `OrdenRepository.ts`, `IRecepcionSateliteService.ts`,
      `IOrdenRepository.ts`, `lib/actions/recepcion-satelite.ts` y `lib/types/recepcion-satelite.ts`.
      R7 y R38 quedan sostenidos por construcción, no por afirmación.
- [x] Interfaces en `lib/interfaces/`, separadas por categoría.

### Permisos
- [x] Las dos pantallas validan rol server-side y caen en `notFound()` **antes** de consultar datos.
- [x] Los módulos cliente reciben datos por props.
- [x] Las mutaciones van por Server Actions.

### Multi-país / configuración
- [x] Nada de país, moneda ni cuenta hardcodeado. Las dos menciones a «Costa Rica» son comentarios
      preexistentes sobre el día operativo, en archivos movidos sin tocar.

### Verificación final
- [x] `./init.sh` completo en verde (§2).
- [x] `progress/review_278.md` existe (este archivo).
- [ ] Entrada en `progress/history.md`: **no la hay**. Por convención de este repo se escribe al
      CERRAR la ficha, después de la revisión, así que no es deuda del implementer — queda como
      pendiente de cierre.

---

## 2. El gate, corrido por mí

`pnpm run db:generate` **antes** (el cliente de Prisma se comparte entre ramas en esta máquina).
`./init.sh` completo, con `INIT_EXIT=$?` escrito DENTRO del log y sin canalizar por `tail`.

```
== Arnes SDD :: init (modo: completo) ==
✓ node v24.13.0
✓ dependencias presentes
✓ regla max-2-por-zona respetada (in_progress=4)
✓ specs presentes para features sdd en vuelo
✓ typecheck paso
✓ lint paso            (0 errors, 101 warnings)
✓ test paso
  Test Files  1377 passed (1377)
  Tests       18754 passed | 26 skipped (18780)
  Duration    380.39s
! migraciones sin down.sql: 20260814120000_ruta_optimizada_trazado
                            20260814140000_ruta_parada_tramo
                            20260814160000_ruta_tramo_vivo_at
✓ .env presente
== init OK ==
INIT_EXIT=0
```

**Verde a la primera**, y **1377 / 18754 coinciden exactamente** con lo que reporta la bitácora en
§17. El aviso de `down.sql` es preexistente: esta rama no toca `db/`.

---

## 3. La medida del agujero del quitador — medida por mí, con SHAs explícitos

Script de un solo uso que pasa el fuente por el `quitarComentarios` del repo (el de verdad,
importado; no una copia de la regex), sobre los blobs extraídos con
`git show <sha>:lib/auth/menu-visibility.ts`. Sin `SHA^` en ninguna parte: los tres SHAs van escritos
enteros, que es la trampa que se lleva por delante la medición. El script se borró y el árbol quedó
limpio.

| | `6c00ba9e` (dev, ANTES) | reconstruido tras T1.0 | `c9281ef5` (HEAD) |
| --- | --- | --- | --- |
| (a) líneas no vacías que sobreviven | **76** (de 400 no vacías / 411 totales) | **156** | **160** (de 432 / 443) |
| (b) contiene `label: "Incidentes"` | `false` | `true` | `true` |
| (c) contiene `"/recepcion-satelite"` | `false` | `true` | `true` |
| (c2) contiene las dos subrutas | `false` | `false` | `true` |
| (d) aperturas de bloque dentro de un comentario de línea | **1**, en la línea 228 | 0 | 0 |

**El tamaño del bloque falso: confirmado.** En el archivo de `dev`, `awk` desde la 228 encuentra el
primer cierre de bloque en la **378**: `378 − 228 + 1 = 151` líneas invisibles para cualquier guardia
que escanee ese fuente. Coincide con lo que dice la ficha.

**Sobre el 156 contra el 160.** Sólo **un** commit toca `menu-visibility.ts` (`18cf90a0`), así que el
estado intermedio «comentario arreglado, subítems todavía no» **no existe como commit**. Lo
reconstruí aplicando únicamente el primer hunk del diff sobre el archivo de `dev`: da **156**
exactos, con (b) y (c) en `true` y (c2) en `false`. O sea: la tabla de la bitácora es **reproducible
y honesta** — el 156 es el efecto del arreglo aislado y el 160 el de la rama entera. (Mi
reconstrucción tiene 422 líneas y la suya 421: esa línea de diferencia es el propio número «156»
escrito después dentro del comentario. No afecta a (a).)

Queda un rastro que sí conviene arreglar: **el 156 está escrito en tres sitios** y quien mida hoy
obtiene **160**. Ver menor m2.

---

## 4. «Ninguna violación destapada»: me cuadra, y así lo comprobé

Es la afirmación más valiosa del trabajo y la más fácil de dar por buena. Tres comprobaciones:

1. **El censo censa.** `pnpm run test:guardias` a HEAD: **142 archivos / 2140 casos, en verde**. No
   es un `exit 0` de un censo vacío.
2. **La aritmética cierra con lo reportado.** La guardia nueva
   (`satelite-sin-boton-aceptar.guardia.test.ts`) entró en `30dfd0ba`, **después** de la corrida que
   la bitácora cita, y tiene 44 casos. `142 − 1 = 141` y `2140 − 44 = 2096`: exactamente los
   «141 archivos / 2.096 casos» de §12. Los números reportados no están inventados.
3. **Lo sustantivo, que es lo que importa.** El agujero está **abierto** en HEAD —las 151 líneas son
   visibles para cualquier guardia que escanee el fuente, medido en §3— y las 142 guardias están en
   verde. Cualquier violación que llevara escondida ahí sería visible ahora, así que la conclusión
   «no se destapó ninguna» se sostiene por medida, no sólo por la corrida intermedia.

La obligación de **P1 FIRMADA** (nombrar cada violación destapada con su regla y su tamaño, y parar
si tocara roles o visibilidad del menú) **no llegó a activarse**, y eso está correctamente dicho.

---

## 5. Mutaciones que inyecté yo (todas revertidas; `git diff` vacío al terminar)

| # | Mutación | Resultado medido |
| --- | --- | --- |
| M1 | `OrdenRepository.recibirEnSatelite`: fuera `zonaId` del `where` del `updateMany` | 🔴 `1 failed \| 7 passed`, en «R11/R18: UPDATE guardado por id+zona+deletedAt+origen». **El QR conserva su red tras la retirada del lote** (R38) |
| M2 | Reintroducir `"recibirLoteEnSatelite"` en `METODOS_ESCRITURA` | 🔴 **no compila**: `error TS2820: Type '"recibirLoteEnSatelite"' is not assignable to type 'keyof IOrdenRepository'` (R41) |
| M3 | **El contraste de M2**: el mismo nombre muerto, quitando el `satisfies` | 🟢 **typecheck completo en verde, sin una queja.** El `satisfies` es lo único que convierte ese censo en un censo |
| M4 | Un botón «Aceptar» renderizado dentro del `renderItem` de la tarjeta | 🔴 `3 failed \| 51 passed`: «R1/R2 … SIN ningún botón», «R5: no monta pie de acciones» y la guardia «ninguno de los dos módulos importa Button». R1/R2/R5/R30 muerden |
| M5 | El escáner vuelve a condicionarse a que la lista no esté vacía | 🔴 `1 failed \| 24 passed`, en «R28/R42: con zona y la lista VACÍA se dice el vacío Y el escáner sigue ofreciéndose». **El caso que el humano firmó muerde** |
| M6 | El redirect apunta a `/en-bodega` en vez de `/por-recibir` | 🔴 `2 failed \| 13 passed`: R13 y R14. La puerta única está defendida |
| M7 | Fuera el `await mutate()` de `releerBodega` | ⚠️ **VER BLOQUEANTE 2.** `RecepcionSateliteModule.test.tsx` queda **VERDE (38/38), 3 corridas de 3** |

Un detalle de M4 que vale la pena dejar escrito: mi primer intento fue pasar
`acciones={...}` a `SateliteOrderCard`. **Sólo cayó la guardia**, porque esa prop ya no existe y
React ignora lo que el componente no lee. Es una comprobación extra de que R5 se cumplió de verdad
—el hueco no está oculto: no está— y la razón por la que la mutación hay que escribirla renderizando
el botón, como está en §16 de la bitácora.

---

## 6. Trazabilidad R1–R47: cada casilla, abierta

Revisadas abriendo el test y leyendo la aserción, no la tabla:

- **R1, R2, R5, R6, R16, R21, R24, R26, R28, R42, R43** → `PorRecibirModule.test.tsx` (10 casos).
  Cada ausencia con positivo en el mismo caso; el de R16/R24 sostiene **nueve** ausencias sobre un
  positivo explícito (las dos tarjetas). Verificados con M4 y M5.
- **R3** → `PorAceptarSection.test.tsx`, los **dos** caminos (tarjeta por defecto y `renderItem`),
  con título, banner, cada orden y el número de `listitem` como positivos.
- **R4, R30, R31, R33, R34, R35** → la guardia nueva. Ámbito de 6 archivos × 6 prohibidos, leídos sin
  comentarios; el caso de R4 lee el texto **crudo** con su propio anclaje.
- **R7** → `git diff -- db/` vacío + 0 inserciones en los seis archivos de servidor.
- **R8, R9, R10, R12, R32, R45, R46** → `menu-visibility.test.ts`, **todo sobre `SIDEBAR_ITEMS`
  importado**. R10 pone el positivo **antes** de las seis ausencias. R45/R46 llevan anti-vacuidad, y
  su anclaje (`export const SIDEBAR_ITEMS`, línea 225) está **antes** del agujero, que es lo que lo
  hace válido.
- **R9** también en `AppLayout.test.tsx`: disparador más dos subenlaces, con las tres mitades
  negativas intactas.
- **R11** → `Sidebar.test.tsx`: `aria-current="page"`, padre `aria-expanded="true"` **y el hermano
  montado sin marcar** (activo por igualdad exacta, no por prefijo).
- **R12** → `destino-post-login.test.ts` con el literal a mano y un `not.toBe` de la ruta vieja; la
  cabecera sigue prohibiendo derivarlo de `primerDestino`.
- **R13, R14, R15, R17, R18, R19, R20, R44** → `RecepcionSatelitePage.test.tsx`. R13 comprueba mock a
  mock que no se resuelve la sesión ni se llama a ninguna de las seis lecturas; R14 escribe el
  aterrizaje **literal** y luego lo compara con el redirect; R19 corre la tabla de roles **contra las
  dos páginas** (4 casos → 8). Verificados con M6.
- **R22** → ver BLOQUEANTE 2. **R23** → cubierto: M7 pone rojo `SateliteSeleccionOtrasPaginas`.
- **R25, R27** → `RecepcionSateliteModule.test.tsx` contra `AVISO_SIN_ZONA_SATELITE`. Ver menor m4.
- **R29** → los tres archivos siguen existiendo y afirman la ausencia con positivo. Verificado con M4.
- **R36, R37, R38, R39, R40, R41** → typecheck + los tres archivos de servidor + M1/M2/M3.
- **R47** → `git diff 6c00ba9e..HEAD -- tests/fixtures/sin-comentarios.ts` **vacío**. Intacto.

**R40, caso por caso.** La bitácora declara 20 casos retirados con 20 destinos. Comprobé **cada
destino contra el árbol**, no contra la tabla: los 13 casos vivos que se citan como repuesto existen
con el nombre exacto que se les da, en los tres archivos. **Ningún destino es inventado.** Los 7 que
mueren con el código dicen por qué, y las razones se sostienen: sin lista no hay lote vacío, ni
dedupe, ni cota de lista vacía, ni conteo de recibidas.

**Los tests reexpresados.** `SateliteSeleccionOtrasPaginas.test.tsx` conserva los 9 casos y el
disparador nuevo es **más** exigente que el viejo, no menos (añade dos esperas y conserva el ancla
positiva sobre las remisiones visibles). `PorAceptarSection` funde 3 en 2 y **añade** cuatro
positivos. `RecepcionSateliteModule` reexpresa 10, cada uno con su positivo.

---

## 7. BLOQUEANTES

### BLOQUEANTE 1 — `tasks.md` no tiene ni una tarea marcada

```
grep -c "^- \[x\]" specs/278-satelite-por-recibir-y-bodega/tasks.md  ->  0
grep -c "^- \[ \]" specs/278-satelite-por-recibir-y-bodega/tasks.md  ->  38
```

`CHECKPOINTS.md` lo pide literalmente: «Existe `specs/<feature>/tasks.md` y **todas** las tasks estan
marcadas `[x]`». Aquí no hay ninguna, con el trabajo hecho y el gate en verde: el archivo dice que no
se empezó. No es cosmético — es el único sitio donde se lee, sin abrir 690 líneas de bitácora, qué se
hizo y qué no; y en este repo ya costó un commit de corrección (`28c91cf2`, «docs(262): tasks.md dice
la verdad»).

**Qué falta:** marcar `[x]` las 38, o dejar sin marcar **con su motivo escrito al lado** cualquiera
que no se haya hecho.

---

### BLOQUEANTE 2 — el caso de R22 no muerde en la configuración en la que la suite lo corre

**R22** exige que recibir por QR desde «En bodega» relea el estado del servidor **y** revalide la
página visible del listado. La trazabilidad lo mapea a `RecepcionSateliteModule.test.tsx` «R22:
recibir por guía mete la orden en el listado sin recargar la página», y §17 de la bitácora afirma
que, tras arreglar el ancla, **se volvió a medir que muerde**: «con el `mutate()` fuera de
`releerBodega` —la mutación (c)— el caso R22 se pone rojo, `1 failed | 37 passed`».

**No reproduce.** Quitando `await mutate()` de `releerBodega`:

| Cómo se corre | Resultado |
| --- | --- |
| **archivo completo** (como lo corre el gate) | 🟢 `Test Files 1 passed`, `Tests 38 passed (38)` — **3 corridas de 3** |
| aislado con `-t "R22: …"` | 🔴 `1 failed \| 37 skipped (38)` |

**El diagnóstico, instrumentado.** El caso toma la línea de partida con
`const lecturasAntes = paginadoBodegaMock.mock.calls.length` y luego afirma
`toBeGreaterThan(lecturasAntes)`. Metiendo un `console.log` a los dos lados:

```
archivo completo : lecturasAntes = 0   ->   lecturasDespues = 1    (pasa)
aislado (-t)     : lecturasAntes = 1   ->   se queda en 1          (falla)
```

O sea: en la corrida completa la línea de partida se toma **antes de que haya aterrizado la
revalidación de montaje de SWR**, y el «+1» que el caso interpreta como «la lectura paginada se
repitió» **es esa revalidación de montaje**, no el `mutate()`. La espera previa
(`await waitFor(() => expect(listado()).toHaveTextContent("REM-B1"))`) se satisface de inmediato con
el `fallbackData` y no sincroniza con el fetch, así que no ayuda. Descartado que sea revalidación por
foco: con `revalidateOnFocus: false` el resultado es idéntico.

Es exactamente el riesgo que la propia bitácora escribe en §19.2 —«si alguien recorta una, el
`mutate()` puede volverse un no-op sin que nada se ponga rojo»— materializado por otra vía: no por
recortar una de las dos afirmaciones, sino porque **la línea de partida corre una carrera con el
montaje**. Y en un navegador de verdad cerrar el modal no dispara esa lectura, así que el caso está
verde por un artefacto del entorno.

**Lo que SÍ hay, y por eso esto no es una regresión suelta:** la misma mutación pone rojo
`tests/components/paginacion/SateliteSeleccionOtrasPaginas.test.tsx` → `3 failed | 6 passed`
(medido). La pérdida del `mutate()` no es invisible para la suite entera. Pero el test que la
trazabilidad nombra para R22 **no verifica la mitad de R22**, y `docs/verification.md` es explícito:
«un test que no verifica el requisito que dice cubrir es hallazgo bloqueante».

**Qué falta para cumplirlo:**
1. Asentar la revalidación de montaje **antes** de tomar `lecturasAntes` (esperar a que la lectura
   paginada haya sido llamada y su promesa resuelta), de modo que el «+1» que se mide sólo pueda
   venir del `mutate()`.
2. **Volver a medir la mutación (c) con el ARCHIVO COMPLETO**, no con `-t`: `-t` deja 37 casos en
   `skipped` y da una foto que no es la del gate. Adjuntar la salida.

---

### BLOQUEANTE 3 — la ficha sigue afirmando lo que la bitácora da por corregido

La bitácora lo dice dos veces: §11 «El dato se corrigió en la ficha»; §19.5 «La ficha decía «79
líneas» y son 151. **Corregido en `feature_list.json`**».

Medido:

```
grep -o "esconde 79 lineas" feature_list.json | wc -l   ->   2
```

Las dos afirmaciones falsas **siguen ahí, palabra por palabra**, junto al párrafo que las corrige. No
se corrigió: se añadió una corrección encima. Un lector futuro encuentra las tres cosas y no sabe
cuál manda.

En la misma nota, y por lo mismo, sobrevive:

> «(c) el camino del servidor `recibirLote` **SE QUEDA** -lo usa el escaner-, solo desaparece el
> boton de la UI»

escrito como medición previa, cuando **Q2 firmada decidió lo contrario** y esta rama retiró la cadena
entera hasta el repositorio. Es el patrón que ya costó un commit dedicado en la 271 (`8b8f1356`, «la
ficha seguia afirmando la imposibilidad, y **la usaba de argumento**»).

Y T6.3 pide un `status_note` de **3–6 líneas**: el de la 278 tiene **4286 caracteres** y repite buena
parte de lo que ya vive en `progress/impl_278.md`, que es justo lo que esa tarea prohíbe.

**Qué falta:** borrar —no tapar— las dos menciones a «79 lineas» y el bullet «(c) … SE QUEDA», y
dejar el `status_note` en 3–6 líneas técnicas apuntando a `progress/impl_278.md`.

---

## 8. Hallazgos menores

- **m1 · R31 al pie de la letra.** R31 dice que una guardia que juzga texto debe demostrar «**dentro
  del propio caso**» que lee lo que dice leer. Los 36 casos de `not.toContain` de la guardia nueva no
  llevan su anclaje dentro; lo llevan en dos casos aparte («los archivos existen», «el texto ya sin
  comentarios conserva su anclaje»). El caso de R4 sí lo lleva inline. La protección real se
  sostiene —si el quitador vaciara un archivo, el caso del anclaje se pone rojo en la misma corrida—
  y tanto `tasks.md` T5.1 como la tabla de trazabilidad los diseñan así a propósito. Queda anotado
  porque la letra de R31 y su implementación no dicen lo mismo.

- **m2 · el «156» que hoy mide 160.** El número está escrito en tres sitios (el comentario de
  `lib/auth/menu-visibility.ts`, la cabecera de la guardia nueva y la de `menu-visibility.test.ts`)
  como «76 antes, 156 después». Es correcto para el arreglo aislado —lo reconstruí y da 156 exactos—
  pero quien mida el archivo de hoy obtiene **160**, y concluirá que el comentario miente. Una
  cláusula («160 con los dos subítems ya puestos») lo cierra.

- **m3 · dos aserciones que quedaron algo menos específicas.** (a) `PorAceptarSection.test.tsx`
  pierde la afirmación de que la acción por-orden se cableaba al id correcto — declarado muerto con
  el código, y es cierto que no hay acción equivalente. (b) `recepcion-satelite-action.test.ts`
  sustituye el paso limpio de `forbidden`/`sin_zona` por el de `zona_ajena`/`ya_recibida`: mismo
  mecanismo y mismo cuerpo de action, y el paso de `forbidden` sigue afirmado para `listar` en el
  mismo archivo. Las dos están nombradas con su destino, que es lo que R40 exige; se apuntan como
  pérdida neta de especificidad, no como incumplimiento.

- **m4 · el texto del aviso no lo fija nadie.** R25 se afirma contra `AVISO_SIN_ZONA_SATELITE`, el
  literal exportado. Eso demuestra la **fuente única**, que es lo que R25 pide, pero significa que
  reescribir el aviso no pone nada rojo. Es una aserción contra su propia fuente, con la atenuante de
  que el requisito habla de fuente única y no de redacción.

- **m5 · `progress/history.md` sin entrada.** Pendiente de cierre, por convención posterior a la
  revisión. No es deuda del implementer.

---

## 9. Lo que hay que reconocerle a esta entrega

Para que el rechazo no borre lo medido:

- **La retirada del lote es quirúrgica y se audita en un comando**: `--numstat` da 0 inserciones en
  los seis archivos de servidor. R7 y R38 no dependen de creerle a nadie.
- **El `satisfies` de R41 vale**, y lo verifiqué en los dos sentidos: el contraste es real — el mismo
  nombre muerto atraviesa un typecheck completo en silencio sin él.
- **El defecto que el implementer se denuncia a sí mismo** (las dos anclas de conteo que cazó
  `ancla-de-carga.guardia.test.ts`) está bien contado, y el arreglo por contenido es el correcto. Lo
  que falló es la **remedición** posterior, no el diagnóstico.
- **La medida del agujero es reproducible entera**, incluido el estado intermedio que no existe como
  commit. Es raro y es de agradecer.
- **Los 20 destinos de R40 son 20 destinos reales.** Los comprobé uno a uno contra el árbol.
- **Las cinco mutaciones que volví a inyectar (M1, M2, M4, M5, M6) muerden exactamente donde la
  bitácora dice.** La única que no es M7.

---

## VEREDICTO: **RECHAZADO**

**3 bloqueantes**: `tasks.md` sin marcar (B1), el caso de R22 que no muerde como lo corre el gate y
cuya remedición no reproduce (B2), y la ficha que sigue afirmando lo que la bitácora da por corregido
(B3).

B1 y B3 son de minutos. **B2 es el que importa**: hay que arreglar la línea de partida del caso y
volver a medir la mutación **con el archivo completo**, no con `-t`.
