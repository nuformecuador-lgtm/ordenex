# Bitácora — feature 262 · BLOQUE HISTORIAL, la PANTALLA (`F7` / `F8`)

> Rama `feature/262-historial-ui`, desde `origin/dev` en `85b5a017` (que ya trae todo el backend
> del historial mergeado, PR #472). Worktree aislado, `node_modules` por junction desde el repo
> principal, `prisma generate` antes del gate.
>
> **Punto de partida:** `progress/impl_262_historial.md`. Su §7.1 dejó dicho, sin disimularlo, qué
> quedaba: *«lo que hay es el mínimo funcional… lo que falta es de un agente de frontend: el estilo
> y el copy fino de la entrada (hoy reusa el mismo punto y el mismo borde que una transición: se
> distingue por texto, que es lo que R39 exige, pero no está pulida), y el resto de la suite de
> componente que F8 enumera»*. Esta tanda es exactamente eso.

---

## 1 · Archivos

**No se creó ningún archivo.** Todo el trabajo cae en piezas que ya existían.

| Archivo | Qué cambió |
| --- | --- |
| `app/(app)/ordenes/_components/HistorialOrdenTimeline.tsx` | **F7**: el estilo de la rama de corrección (filo discontinuo + anillo hueco), el nombre accesible de la lista, el envoltorio vestigial fuera, y la anotación `@pendiente-262-f6` **reescrita** (§5) |
| `app/(app)/ordenes/_components/HistorialOrdenSheet.tsx` | **F7 (copy)**: la descripción del drawer deja de prometer sólo «cambios de estado» (§3.2) |
| `tests/components/HistorialOrdenTimeline.test.tsx` | **F8**: +7 tests. La lista larga mezclada, «por texto» y «no sólo por color» con su clasificador auto-probado, el nombre accesible y el sello |
| `tests/components/HistorialOrdenSheet.test.tsx` | +1 test: la descripción nombra las dos clases, con su anti-vacuidad |
| `tests/unit/guards/historial-correccion-dia.guardia.test.ts` | **cláusula (i) nueva**, +4 tests: el estilo de la corrección no puede volver a ser el de una transición |
| `tests/components/EstatusBadgeRetiroFulfillment.test.tsx` | **un literal**, el nombre accesible de la lista (§3.3) |
| `e2e/{historial-orden,devolucion-origen,reintentos-escalado}.spec.ts` | **el mismo literal**, en sus `getByRole("list", { name })` y en sus cabeceras (§3.3) |

**No se tocó:** `feature_list.json`, `progress/current.md`, `lib/utils/dia-reparto-textos.ts`,
`lib/types/**`, ninguna migración, ni la rama de **transición** del componente (**R45**, §3.4).

---

## 2 · Mapa de lo que esta tanda defiende → test

`R37`-`R45` ya los mapeó la tanda de backend. Lo que sigue es lo que **antes de hoy no tenía un
test**, con la mutación que lo mata al lado (salida real en §4).

| Qué | Test que lo defiende | Muere con |
| --- | --- | --- |
| **R38/R39 · «se distingue por TEXTO»**, sobre el render | `HistorialOrdenTimeline.test` · «leyendo sólo las palabras, sin una sola clase de estilo»: se lee el `textContent` de cada `<li>` —donde no queda **ni una** clase— y se afirma que la entrada se identifica **y que la palabra DISCRIMINA** (ninguna transición la dice), con anti-vacuidad de que las transiciones se leen por su propio texto y con la comprobación de que el punto es decorativo | **M-sin-texto**, **M-texto-en-todas** |
| **F7 · «y no SÓLO por color»** | `HistorialOrdenTimeline.test` · la diferencia de clases entre las dos entradas (1) **no está vacía** y (2) incluye al menos una **marca de forma**; más la **contraprueba** de que la transición no ganó ninguna. El clasificador forma/color se **auto-prueba en las dos direcciones** antes de que se le crea nada · `historial-correccion-dia.guardia` (i) · lo mismo sobre el fuente | **M-igual**, **M-solo-color**, **M-clasificador** |
| **R37/R41 · la lista LARGA mezclada** | `HistorialOrdenTimeline.test` · 7 entradas con **dos correcciones en sentidos contrarios**: cada una con sus fechas, su actor y su motivo, **sin contaminarse**; exactamente dos llevan la etiqueta; las cinco transiciones en su sitio; ni un `YYYY-MM-DD` en la lista entera | **M-cruce** |
| **R37 · dos correcciones = dos entradas** | `HistorialOrdenTimeline.test` · lo que la puerta humana pide comprobar en la app, en la mitad que sí depende de la pantalla | **M-cruce** |
| **R39 · el nombre accesible de la lista** | `HistorialOrdenTimeline.test` · literal a mano, y `queryByRole` del nombre viejo devuelve `null` | **M-nombre** |
| **R39 · lo que el drawer PROMETE** | `HistorialOrdenSheet.test` · la descripción nombra las dos clases, con la anti-vacuidad de que dentro hay una entrada de cada una | **M-drawer** |
| **R38/R41 · el sello** | `HistorialOrdenTimeline.test` · `<time>` con el instante exacto en `dateTime`, y lo visible en la zona **fija** de Costa Rica (15:14 UTC → 9:14), no en UTC ni en la del entorno | **M-zona** |
| **R45 en pantalla** | la contraprueba (3) del test de forma: la transición **no** ganó el filo ni el anillo · `guardia` (i) · lo mismo sobre el fuente | **M-dashed-en-transicion** |
| **La deuda de F6 sigue anotada** | `guardia` (f), **intacta**: se volvió a mutar tras reescribir la anotación, para comprobar que sigue mordiendo | **M-f6** |

---

## 3 · Las decisiones, y las tres desviaciones del spec

### 3.1 · El estilo: dos marcas de FORMA, y **ni un tono nuevo**

`design.md` §14.4 fijó lo importante y esta tanda no lo toca: **la primera línea es texto**, y eso
es lo que distingue la entrada. Lo que faltaba es que, **encima de eso**, no se pintara idéntica a
una transición. Se añaden dos marcas:

- **filo discontinuo** (`border-dashed`) en vez de continuo;
- **punto en anillo hueco** (`size-2.5` + `border-2` + fondo de la superficie) en vez de disco lleno.

**Las dos son de forma, no de color, y los tokens de color son EXACTAMENTE los mismos que usa la
transición** (`border-border`, `border-primary`). No es escrúpulo: distinguir por color a secas no
vale en este repo —hay guardia de contraste y una lección medida de que *la herramienta miente* al
leer color en el navegador—, y **meter un tono nuevo tampoco habría sido la respuesta**: no dice
QUÉ es la entrada y se pierde en escala de grises. Se comprobó con una captura en escala de grises
de verdad (§6): las dos marcas sobreviven.

Se descartó una tercera opción, el rombo (`rotate-45`), porque a 8-10 px su caja visual crece √2 y
se solapa con la línea del filo.

### 3.2 · Dos textos que la 262 dejó MINTIENDO, y ninguno estaba en el inventario del spec

Los dos venían de la 49, cuando la lista tenía **una** sola clase de entrada. Con la 262 tiene dos,
y una de ellas **no es un estado**. Los dos se leían como una promesa que la pantalla ya no cumplía,
y los dos son **justo la puerta por la que R39 se incumplía sin verse**: son lo que anuncia un
lector de pantalla.

1. **El nombre accesible de la lista**: «Línea de tiempo **de estados**» → «Línea de tiempo **de la
   orden**».
2. **La descripción del drawer**: «Cambios de estado de la orden en orden cronológico.» → «Cambios
   de estado **y correcciones del día de reparto**, en orden cronológico.» Se nombran las dos clases
   en vez de irse a un genérico: quien abre esto está operando. Ese literal **no estaba fijado en
   ningún test del repo** — ahora sí, con la anti-vacuidad de que dentro hay una entrada de cada
   clase.

**Es una desviación del spec y se anota como tal:** `design.md` §14.4 enumeró lo que cambiaba de la
pantalla y no incluyó ninguno de los dos. Se hacen igualmente porque son defectos **causados por
esta feature**, no mejoras de oportunidad.

### 3.3 · El literal del nombre accesible lo tenían CUATRO consumidores, y es un contrato

`getByRole("list", { name: "Línea de tiempo de estados" })` vivía en `EstatusBadgeRetiroFulfillment.
test.tsx` (feature 155) y en tres specs de Playwright. **Ese literal ES el contrato**, así que se
hace **crecer** en los cuatro; no se relaja a un `queryByRole` sin nombre ni se borra ninguno.

Y no es teoría: la mutación **M-nombre** (volver al nombre viejo) pone rojo **también** el test de
la 155, que es la prueba de que ese literal seguía siendo un contrato vivo y de que se actualizó
donde tocaba.

**El riesgo que esto tiene, dicho:** los tres specs de Playwright **no se ejecutan** en este repo
(no hay harness de e2e), así que su edición no la verifica nada más que un `grep`. Se comprobó que
**cero** ocurrencias del nombre viejo quedan en el árbol.

### 3.4 · Lo que NO se tocó, y por qué

- **La rama de transición, ni un byte** (**R45**). El `git diff` del componente en esa rama es
  vacío. Hay dos tests que lo afirman por el otro lado (la contraprueba (3) y la cláusula (i)).
- **El copy de `dia-reparto-textos.ts`.** Se consideró y **se descartó**, y conviene dejar escrito
  el porqué porque es una decisión, no un olvido: «Día de reparto / Del 21 de agosto al 22 de
  agosto» **puede leerse como un RANGO** («del 21 al 22») en vez de como un cambio. La alternativa
  era mover `ETIQUETA_CORRECCION_DIA` a algo como «Corrección del día de reparto». **No se hizo**
  porque (a) `design.md` §14.4 aprobó ese texto **con su párrafo de razones**, (b) el literal está
  fijado a mano en `dia-reparto-textos.test.ts` §(5) como contrato, y (c) **visto en el navegador**
  (§6), con «Por Ana Pérez» y «Motivo: …» debajo y transiciones alrededor, la entrada se lee como
  un hecho ocurrido y no como una ventana de dos días. **Queda como pregunta explícita para F6**,
  que es la puerta donde un humano puede decidirlo mirándolo. No se cambia una copy aprobada por
  criterio propio.
- **Los espacios de la transición.** Su `textContent` sale «En reparto→Reprogramada», sin espacios,
  porque el `gap-1` es visual. Es un defecto **preexistente de la 49** y arreglarlo tocaría la rama
  de transición y aserciones ajenas: **queda anotado aquí, no arreglado**.

---

## 4 · Mutaciones — 11 corridas, 11 muertas, con su salida real

⚠️ **El arnés se autocomprueba** (`scratchpad/mutaciones_262_ui.py`, fuera del repo), porque en este
repo un arnés de mutaciones ya reportó «9/9 supervivientes» **dos veces sin haber ejecutado un
test**. Exige las cuatro cosas: (1) cada texto a mutar aparece **exactamente una vez**; (2) la
corrida **en limpio** del mismo comando está **verde antes de mutar**; (3) la salida trae la línea
`Test Files` de vitest —o sea que el comando corrió—; (4) restaura con `git checkout --` **sobre un
árbol commiteado** y comprueba que `git status --short` queda vacío al final.

```
== corrida limpia de control ==
   limpio: Test Files  4 passed (4)
== censo de anclas (cada texto a mutar, exactamente una vez) ==
   OK: 13 anclas, todas unicas
```

| # | Qué se rompe | Veredicto | Qué se puso rojo |
| --- | --- | --- | --- |
| **M-igual** | la corrección vuelve a pintarse **exactamente** como una transición | **MUERE** | `Test Files 2 failed (2)` — «y NO SÓLO por color…», «el filo de la corrección es DISCONTINUO…», «el punto de la corrección es un ANILLO hueco…» |
| **M-solo-color** | se distingue **sólo por color**: mismo filo, mismo punto, otro tono | **MUERE** | los tres de arriba **más** «las dos marcas son de FORMA: no se introdujo ningún tono nuevo». Es la prueba de que la mitad «y no sólo por color» no es decorativa |
| **M-sin-texto** | la entrada pierde **la palabra** y queda sólo la marca visual | **MUERE** | «se distingue POR TEXTO…», «en una lista LARGA y mezclada…», «mezclada con transiciones…», «R38: la corrección se lee con las dos fechas EN PALABRAS…» |
| **M-texto-en-todas** | la palabra deja de **discriminar**: la transición también la pinta | **MUERE** | **sólo** «se distingue POR TEXTO…» y «en una lista LARGA y mezclada…». Es la prueba de que la anti-vacuidad de esa aserción es lo que la sostiene |
| **M-dashed-en-transicion** | la **transición** gana el filo de la corrección (**R45** en pantalla) | **MUERE** | «y NO SÓLO por color…» (la contraprueba) y la cláusula (i) |
| **M-cruce** | todas las correcciones pintan las fechas de la primera | **MUERE** | «en una lista LARGA y mezclada…», «dos correcciones seguidas… son DOS entradas», y «no copia ningún literal de fecha» de la guardia |
| **M-nombre** | el nombre accesible vuelve a anunciar la lista entera como estados | **MUERE** | «el nombre accesible… ya no la anuncia como si todo fuesen estados» **y** «una fila de historial que referencia el value retirado NO rompe la línea de tiempo» (el test de la **155**: la prueba de §3.3) |
| **M-drawer** | la descripción del drawer vuelve a prometer sólo cambios de estado | **MUERE** | «dice que dentro hay cambios de estado Y correcciones del día de reparto» |
| **M-zona** | el sello suelta la zona fija y se formatea en UTC | **MUERE** | «el sello… en la zona FIJA del componente» y «no construye ninguna fecha» de la guardia |
| **M-f6** | se retira `@pendiente-262-f6` **sin** haber hecho F6 | **MUERE** | «el componente lleva la anotación `@pendiente-262-f6` con su motivo». Se volvió a correr **después** de reescribir la anotación: sigue mordiendo |
| **M-clasificador** | el clasificador forma/color se rompe y devuelve **siempre `true`** | **MUERE** | «AUTOCOMPROBACIÓN: el clasificador separa forma de color en las DOS direcciones». Sin este test, «no sólo por color» estaría verde con el detector roto — que es el fallo exacto que ya ocurrió en este repo |

**Sobreviven 0**, y el árbol quedó limpio (`git status --short` vacío, verificado por el arnés).
La tanda se corrió **dos veces**: antes y después del arreglo de §6, con el mismo resultado.

---

## 5 · ⬛ La anotación `@pendiente-262-f6`: **NO se retira**, y se dice por qué

**Decisión: se conserva, con su texto reescrito.** El encargo pedía retirarla «cuando corresponda de
verdad» y decirlo explícitamente si se decidía que no. Es que no corresponde:

- **La anotación cubría DOS cosas**, y sólo una era mía. Decía: *«F6 (ver la app) sigue sin hacerse…
  Lo que queda es de F7/F8: el estilo fino y el resto de la suite de pantalla.»*
- **La mitad de F7/F8 sí se retira**, porque ya está hecha y dejarla escrita convertiría la
  anotación en un dato falso para quien la lea mañana.
- **La mitad de F6 no.** F6 es abrir «Ver historial» **en preview**, con cuenta **maestro/admin** y
  con **adminTienda**, sobre una orden corregida de verdad. **Ninguna comprobación automática puede
  hacer eso**, y este repo tiene la lección medida de que ver la app encontró 7 textos rotos que
  12.000 tests daban por buenos. Borrarla habría sido firmar como hecho algo que no lo está.

**Comprobado con la guardia en la mano**, que es lo que se pedía:

- La cláusula (f) exige la anotación con un motivo de **≥40 caracteres** en su línea, que nombre
  `F6|ver la app`. El texto nuevo la cumple: `guardia` verde, 24/24.
- Y **se volvió a mutar** (`M-f6`) **después** de reescribirla, para no dar por hecho que seguía
  mordiendo: `Test Files 1 failed (1) | rojo: el componente lleva la anotación @pendiente-262-f6 con
  su motivo`.

Es decir: el estado final es coherente. La anotación dice lo que de verdad falta, ni más ni menos, y
la guardia sigue obligando a que retirarla sea **un acto consciente**.

---

## 6 · Lo que la suite no podía ver, y se vio con un navegador

**jsdom guarda las clases de Tailwind como cadenas y no calcula un solo color.** O sea: los ~17.900
tests del repo no pueden decir si un `border-dashed` se pinta, ni si un anillo parece un anillo. Así
que se montó una página temporal (nunca commiteada, borrada al terminar), se levantó `next dev` y se
miró con Chromium, en **tema claro y oscuro** y sobre la **superficie real del drawer** (`bg-popover`
del `SheetContent`, que no es `--background`).

**Encontró un defecto que ningún test podía encontrar.** El hueco del anillo llevaba `bg-background`:

```
antes:  huecoDelAnillo rgb(10, 21, 36)  ·  superficieDelPanel rgb(16, 32, 58)   ← no es un hueco
ahora:  huecoDelAnillo rgb(16, 32, 58)  ·  superficieDelPanel rgb(16, 32, 58)   ← lo es
```

En tema oscuro no era un hueco: era **un disco más oscuro que el panel**, justo lo contrario de lo
que el anillo quiere decir. Se corrigió a `bg-popover`, que además vale lo mismo que `--card` en los
dos temas, así que también casa si esta lista acaba dentro de una card. Está commiteado aparte
(`6b05e83c`) para que el hallazgo no se pierda dentro de la tanda grande.

También se comprobó, con el filtro `grayscale(1)` aplicado en el navegador, que **las dos marcas
sobreviven en escala de grises**: el anillo y el filo discontinuo se siguen distinguiendo del disco
lleno y el filo continuo cuando no hay color ninguno.

⚠️ **Y lo que esto NO es: no es F6.** Fue una página de fixtures en local, no la app con datos
reales, ni en preview, ni con las tres cuentas. No demuestra que la Server Action autorice, ni que
el rastro llegue, ni que la entrada salga en su sitio cronológico con datos de verdad. Por eso la
anotación se queda (§5).

---

## 7 · El gate

`./init.sh` **COMPLETO**, con `INIT_EXIT=$?` **escrito dentro del log**, porque en este repo un
`echo` posterior ya tapó un gate rojo haciéndolo pasar por «exit code 0».

```
== Arnes SDD :: init (modo: completo) ==
✓ node v24.13.0
✓ dependencias presentes
✓ regla max-2-por-zona respetada (in_progress=2)
✓ specs presentes para features sdd en vuelo
✓ typecheck paso
✓ lint paso
 Test Files  1324 passed (1324)
      Tests  17878 passed | 26 skipped (17904)
   Duration  351.23s
✓ test paso
! migraciones sin down.sql: 20260814120000_ruta_optimizada_trazado 20260814140000_ruta_parada_tramo 20260814160000_ruta_tramo_vivo_at
✓ .env presente
== init OK ==
INIT_EXIT=0
```

**A la primera y en verde**, sin ningún rojo que distinguir de un timeout o de la base compartida.
`gate.log` **no se commitea** (se borró); tampoco el `.env` copiado del repo principal.

El aviso de «migraciones sin down.sql» es **preexistente** (tres migraciones de la feature 92) y
esta tanda **no añade ninguna migración**.

---

## 8 · Lo que queda a deber

1. **`F6` («ver la app») — NO HECHA.** Es la deuda real y viva de esta ficha. Lo de §6 la acota
   —el estilo ya está mirado con un navegador de verdad, en los dos temas y sobre la superficie
   correcta— pero **no la sustituye**: falta preview, datos reales y las tres cuentas. Sigue
   anotada junto al código (§5).
2. **La pregunta de copy de §3.4**, para la misma pasada de F6: si «Del 21 de agosto al 22 de
   agosto» bajo «Día de reparto» se lee como un cambio o como un rango de dos días. Es una decisión
   de producto sobre un texto **aprobado en el spec**, así que no se toma desde aquí.
3. **Los tres specs de Playwright editados no se ejecutan** en este repo (§3.3). Su corrección se
   comprobó por `grep`, no por corrida.
4. **El `textContent` de la transición no lleva espacios** alrededor de la flecha («En
   reparto→Reprogramada»). Defecto preexistente de la 49; arreglarlo toca la rama de transición y
   aserciones ajenas (§3.4).
5. **`P4` y `P5`** siguen abiertas, y **`B0.2`** sigue siendo del leader. No son de esta tanda; las
   describe `progress/impl_262_historial.md` §7.
