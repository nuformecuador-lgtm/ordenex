# Feature 223 — El flujo de impresión de la factura del cierre · REVISIÓN

Rama `feature/223-flujo-impresion-factura` (8 commits sobre `origin/dev`), árbol limpio.
Revisor: agente REVIEWER. Fecha: 2026-08-14.

> **Qué hice yo y qué me creí.** Abrí los 33 requisitos y su test uno a uno. **Planté ocho
> mutaciones** con autocomprobación y `git diff` antes de correr nada, incluidas las tres que la
> bitácora declara decisivas. Medí por mi cuenta la igualdad byte a byte del quitador de CSS y el
> contrafactual del ancla posicional. **El gate completo (`./init.sh`) lo corre el leader**, por
> encargo explícito; yo corrí `typecheck`, `lint` y los siete archivos de test implicados.

---

## Veredicto

**RECHAZADO** — por **un solo bloqueante, y es de registro, no de código**:
`specs/223-flujo-impresion-factura/tasks.md` tiene **las 23 tareas sin marcar**, y
`CHECKPOINTS.md > Especificación` exige que estén **todas** marcadas.

**Todo lo demás pasó**, y pasó bajo mutación plantada por mí, no por la bitácora. Si se marcan las
23 casillas y se atiende lo que el leader decida de los menores, esto es un **OK**.

---

## Checklist de `CHECKPOINTS.md`, punto por punto

### Especificación
- [x] `requirements.md` con 33 requisitos EARS numerados `R1`-`R33`.
- [x] `design.md` con alternativas descartadas y su porqué (§3.5 a-e, §7 A-I).
- [ ] **`tasks.md` con todas las tasks marcadas — FALLA. 23 de 23 siguen sin marcar.**

### Trazabilidad
- [x] Cada `R<n>` mapea a al menos un test concreto — **33 de 33 verificados por mí abriendo el
      test**. Detalle y matices en §2.
- [x] `progress/impl_223.md` contiene el mapa `R -> test` (§T22).

### Calidad de código
- [x] `pnpm run typecheck` — verde, sin salida.
- [x] `pnpm run lint` — **0 errores** (65 warnings, todos preexistentes y ajenos a esta rama).
- [x] Tests de la feature — `impresion-flujo.guardia`, `CierreFacturaPapel`, `tema-encendido`,
      `impresion-sin-dark`, `quitador-comentarios`, `factura-contraste`, `analytics-paleta`:
      **7 archivos / 182 tests, verdes**. El gate completo lo corre el leader.
- [x] E2E — **no aplica**. No toca auth, pagos, recaudo, ingesta ni webhooks: es CSS de
      presentación. Además el repo no tiene harness de impresión y la ficha lo declara (R33).

### Datos y seguridad (Supabase)
- [x] Tablas nuevas / RLS — **no aplica**: la feature no lee ni escribe un solo dato; `db/` intacto.
- [x] Migraciones / `down.sql` — **no aplica**: cero migraciones.
- [x] Secretos — **ninguno**. El diff no introduce una sola credencial ni URL con token.
- [x] Webhooks — **no aplica**.

### Patrón de capas
- [x] **No aplica** en sentido estricto: no hay controller, service ni repository nuevos. El diff
      toca `app/globals.css`, un componente **presentacional** (`cierre-factura.tsx`: sólo clases y
      prosa) y `tests/`. Ninguna query, ningún `Request`/`Response`.

### Permisos
- [x] **No aplica**: no se añade página, ni Server Action, ni fetch.

### Multi-país / configuración
- [x] Nada hardcodeado de país, moneda ni cuenta. `size: portrait` **sin nombre de papel** es
      justamente la decisión que evita hardcodear A4 o Carta (D2/R15), y hay caso que lo muerde.

### Verificación final
- [ ] `./init.sh` — **pendiente del leader** (por encargo explícito, no lo corrí).
- [x] `progress/review_223.md` — este archivo.
- [ ] **Entrada en `progress/history.md` — no existe.** Paso de cierre del leader; lo dejo listado,
      no lo cuento como bloqueante del implementador.

---

## 1. El hallazgo del CSS que dejaba la página EN BLANCO — CONFIRMADO

La bitácora abre diciendo que `design.md §3.4`, rama **A.1 segundo selector**, oculta el propio
diálogo. **Es cierto, y lo verifiqué plantándolo.**

Planté la **mutación 3-bis**: devolver A.1 a la forma literal del diseño, quitando el segundo
`:not(:has(.hoja-imprimible))`.

**Resultado: 2 ROJOS**, por dos vías independientes:

| Rojo | Qué dice |
| --- | --- |
| `CierreFacturaPapel.test.tsx:473` | «la hoja **ELEGIDA** quedó oculta: el papel saldría EN BLANCO» — evaluación de los selectores reales contra el DOM montado |
| `impresion-flujo.guardia.test.ts:591` | «esta rama volvió a la forma de `design.md §3.4`, que OCULTA EL PROPIO DIÁLOGO» — censo de la forma escrita |

Coincide exactamente con lo que la bitácora anota. **La versión rota quedó viva como mutación y de
verdad discrimina.**

**¿Implementa la prosa del diseño?** Sí. La prosa de A.1 dice «fuera del diálogo: se poda todo lo
que **no lleva al diálogo**», y el popup sí lleva a la hoja elegida: la contiene. La razón técnica
también es correcta: `E:has(A B)` exige que `A` sea descendiente de `E`, y el popup **es** el
`[role="dialog"]`.

**¿Cambia alguna decisión, en particular R6?** En el DOM de hoy, **no**. Comprobé que
`CierreFacturaPapel.test.tsx` afirma, evaluando la regla, que con el detalle abierto la compacta de
detrás **no** llega al papel (R6 nivel 1) y que el diálogo **sí**. Los dos niveles, la lista blanca,
los `:not()` con selectores simples y el «CSS puro, sin JavaScript» quedan intactos. Dos matices,
los dos menores: **m1** y **m2**.

**Spec NO retocado**: `design.md §3.4` conserva la versión rota. Es lo correcto según `tasks.md`
T21 («no se ajusta el spec para que encaje con lo que salió»); la desviación vive declarada al
principio de la bitácora.

---

## 2. Trazabilidad R -> test, uno a uno: 33 de 33, verificados abriendo el test

Abrí los cinco archivos dueños y comprobé cada fila del mapa §T22. **Ningún requisito huérfano.**

### Los diez «por comportamiento»: no son una envoltura

`design.md §6.6` daba por hecho que jsdom no resuelve `:has()`. Sí lo resuelve, y la implementación
lo aprovecha bien:

- `CierreFacturaPapel.test.tsx` **lee los selectores reales de `app/globals.css`** con el parser
  compartido (`selectoresQueOcultan()`, `selectoresDeLaCadena()`) y los pasa a
  `document.querySelectorAll` sobre el DOM montado con los componentes de verdad. **No copia
  cadenas** y **no afirma que casan**: evalúa.
- Si el localizador no encontrara la regla, **lanza** en vez de evaluar una lista vacía. Eso cierra
  el modo de fallo «verde por vacuidad».
- **Lo probé**: las mutaciones 2 y 3-bis pusieron rojos esos casos concretos. Un envoltorio no se
  pone rojo al cambiar el selector del archivo.

Verifiqué uno a uno los diez: **R1, R2, R4, R5, R6, R7, R9, R10, R11 y R3 parcial**. Los diez tienen
un caso que evalúa, no que describe.

### R21 y R22, declarados «declarativos»: es honesto, no es un requisito sin dueño

Los leí con cuidado porque el encargo pide juzgarlo. **La obligación que esos dos requisitos imponen
ES escribir una declaración**, no producir un comportamiento:

- R21: «El sistema NO DEBE afirmar que la fila de rótulos se repite... El límite DEBE quedar
  declarado junto a la regla, con su razón».
- R22: «El sistema DEBE dejar declarado que la hoja impresa contiene sólo lo que está en el DOM».

El censo lee el comentario **pegado al bloque** —localizándolo por la posición del bloque en el
fuente crudo, con `expect(lineasCodigo.length).toBe(lineasCrudas.length)` para que la alineación no
mienta— y exige `cabeceras de columna` **más su razón** (`no es una tabla`), y `plegad` más
`pestañas no visitadas` más `DOM`. **Eso es exactamente el requisito.** Llamarlo «estructural, no
hay test que pueda afirmar más» es la etiqueta correcta, no una excusa.

Único hueco, menor (**m5**): la mitad negativa de R21 no tiene censo propio.

---

## 3. Los anclajes posicionales (R24) — CONFIRMADO, y plantado

**Se hizo antes de tocar el CSS**, verificado en el historial:

| Commit | Qué toca |
| --- | --- |
| `27c539a8` tanda 0 | `css-reglas.ts`, `tema-encendido`, `impresion-sin-dark`, `analytics-paleta`, `CierreFacturaPapel` — **`app/globals.css` NO aparece** |
| `b71ba5b2` tanda 1 | `app/globals.css` (+201) |

Los tres casos localizan ahora el bloque de la 217 con
`atReglaQueContiene(css, /^\s*\.papel-al-imprimir\s*\{/m)`: **por contenido**.

Planté la mutación que un ancla posicional no puede ver: **mover el bloque de tokens de la 217
detrás de `.dark`**, dejando el de la 223 donde está.

| | Resultado |
| --- | --- |
| Con los anclajes de HOY (por contenido) | **4 ROJOS** — `tema-encendido:240` y `:375`, `impresion-flujo:310` y `:320` |
| Con el ancla VIEJA (primer `@media print`), **medido por mí** | ancla vieja idx **4141**, `.dark` idx **5775** -> `4141 < 5775` -> **VERDE. Miente.** |

Es decir: la mutación que el ancla vieja daba por buena, la nueva la mata. **C3 entregado.**

Planté **también la mutación 13** (el bloque nuevo movido **delante** del de la 217): **12 ROJOS**,
entre ellos `impresion-flujo:320` («el bloque del flujo va DESPUÉS del de tokens de la 217») y
`tema-encendido:240` (el comentario deja de estar pegado a su regla). Coincide con el 12 de la
bitácora.

**Invariante R24 clavado**: `impresion-flujo` exige **exactamente dos** `@media print` y los **dos**
antes de `.dark`.

---

## 4. La guardia que prohibía `@page` — REEXPRESADA, no relajada

Leí el diff entero de `tema-encendido.guardia.test.ts:331`. El caso **sigue existiendo**, con nombre
nuevo («el formato de página no se mezcla con el bloque de COLOR de la 217, ni aparece en un tercer
sitio») y con su motivo escrito en 20 líneas de comentario. Lo que afirma ahora:

1. Hay **exactamente una** `@page` en todo el archivo. Cero también es rojo.
2. `.papel-al-imprimir` **no declara nada que no sea un token**.
3. **No hay `@page` dentro del cuerpo del bloque de la 217**, localizado por contenido.

Es **más** de lo que vigilaba antes, no menos: antes sólo decía «no hay `@page` en el archivo». No
se borró, no se relajó, y el cambio de nombre lo autoriza `tasks.md` T18.

**Desviación de orden declarada y correcta**: T18 estaba en la Tanda 3, pero T8 escribe un `@page`
que ese caso prohibía, así que la Tanda 1 no podía cerrar en verde sin reexpresarlo antes. La
bitácora lo llama «conflicto de orden dentro del spec, no una decisión que me haya tomado».

---

## 5. `quitarComentariosCss` — la igualdad la medí yo, y el caso nuevo discrimina

Medición propia sobre `app/globals.css` (script en un archivo, no `node -e`):

```
crudo bytes:            37917
quitadorCSS bytes:      11442
quitadorTS  bytes:      11442
iguales:                true
ocurrencias de // fuera de comentario de bloque: 0
lineas crudo 847  ==  lineas cssq 847
```

**11442 = 11442, byte a byte.** El riesgo era **latente**, no vivo, exactamente como dice la
bitácora. Consecuencia importante y que el encargo pedía comprobar: **ninguna cifra de contraste
pudo moverse** al cambiar `tests/fixtures/contraste.ts` de `quitarComentarios` a
`quitarComentariosCss`. Eso es **medido**, no estimado.

Planté la **mutación 21** (`quitarComentariosCss` delegando en el quitador de TypeScript):

```
1 ROJO — quitador-comentarios.guardia.test.ts:205
   x  «EL CASO: la declaracion que sigue a url(//...) SOBREVIVE»
```

Rojo **exactamente** en el caso nuevo, y en ninguno más. Y **la contraprueba está**: el caso
«CONTRAPRUEBA: el quitador de TypeScript SÍ se la lleva» exige que `quitarComentarios` sí se coma la
URL y el `font-weight: 700` que la sigue. Sin ese caso, la separación no probaría nada. Hay además
un caso que vigila que las dos pasadas **sigan coincidiendo** sobre el CSS real, con un mensaje que
manda mirar qué se añadió el día que dejen de hacerlo.

Los cinco lectores de CSS consumen el quitador correcto: `css-reglas.ts`, `impresion-flujo`,
`tema-encendido`, `impresion-sin-dark` y `contraste.ts`.

De rebote, el censo de R32 encontró un infractor real que nadie sabía que estaba:
`analytics-paleta.test.ts` tenía su propio `selectoresDe`, su propio recorrido de llaves y su propio
quitador a mano. Pasa a consumir el fixture **sin cambiar una sola aserción**; lo verifiqué en el
diff y el archivo queda verde.

---

## 6. Los cinco `!important` — los cinco compiten de verdad. Ninguno es de conveniencia

La lista salió de la medición T4 (`CierreFacturaPapel.test.tsx:182`), que lee
`document.body.getAttribute("style")` con el `Modal` real abierto y **tras
`await findByRole("dialog")`**. La bitácora anota que la primera versión leía síncronamente y medía
una lista **vacía**, pasando por buena la afirmación contraria. Corregido y anotado en el caso.

| `!important` | Rival EN LÍNEA | Verificado |
| --- | --- | --- |
| `overflow: visible` | `overflow: hidden` del scroll lock sobre el `<body>` | sí, está en la lista medida |
| `position: static` | `position: relative` del scroll lock | sí |
| `height: auto` | `height: calc(100dvh - ...)` del scroll lock | sí |
| `width: auto` | `width: calc(100vw - ...)` del scroll lock | sí |
| `max-width: none` | `style={{ maxWidth: size }}` del popup | sí. `Modal.tsx:255` escribe `...(esToken(size) ? {} : { maxWidth: size })`; el detalle admin **no pasa `size`** (`CierresAdminModule.tsx:804-818`, con el comentario «Sin ancho propio: el default del Modal, 75%») y `DEFAULT_MAX_WIDTH = "75%"` **no es token**, así que va EN LÍNEA. Compite de verdad. |

La regla de la cadena arranca en `body:has(.hoja-imprimible)`, así que **sí** alcanza al `<body>`
donde vive el scroll lock: los cuatro son necesarios, no decorativos.

Y **no sobra ninguno**: `box-sizing` y `scroll-behavior` también están en línea sobre el `<body>`,
pero el bloque **no las declara**, así que no necesitan `!important`. Las otras nueve declaraciones
de la cadena no tienen rival en línea y no lo llevan.

Planté la **mutación 17** (quitar el `!important` de `max-width`): **1 ROJO**, «lleva `!important`
EXACTAMENTE en las cinco declaraciones que compiten con un estilo en línea». La lista está congelada
en las dos direcciones: uno de menos y uno de más.

**Límite bien declarado**: el `<html>` también queda bloqueado (`overflow-y/x: hidden` en línea) y
la regla **no lo alcanza**, porque R10 acota el alcance a «entre el `<body>` y la hoja». Está
medido, congelado por el caso, escrito junto al bloque en el CSS **y** listado en «lo que no queda
verificado». Es la forma correcta de dejar una deuda.

---

## 7. Lo que NO queda verificado — la declaración es honesta y es suficiente

Contrasté los 7 puntos de la bitácora contra lo que los tests afirman de verdad:

| Lo declarado | ¿Se corresponde? |
| --- | --- |
| El papel físico, encabezado/pie, «gráficos de fondo» | Sí. Ninguna pieza del gate imprime. Ningún test lo afirma. |
| **Gecko y WebKit no medidos** | Sí. T21 es Blink. Nada en el árbol dice lo contrario. |
| Dónde caen los cortes y cuántas páginas | Sí |
| Fragmentación del interior flex | Sí |
| Cifra del KPI (R29) | Sí. Declarada junto a la pieza, no arreglada. |
| El `<html>` bloqueado, fuera del alcance de R10 | Sí. Medido, congelado, escrito. |
| **La app corriendo**: T21 usa fixtures y DOM serializado, sin servidor ni sesión | Sí, y lo dice con esas palabras: «no sustituye a mirar la app». |

**Y dice que el harness se borró a propósito**, que es lo que hay que decir. Verifiqué que no queda
en el árbol: `.mutar.mjs` entró en `b71ba5b2` y ya no está; `git ls-files` no devuelve nada. Sin esa
frase, T21 se leería como cobertura permanente, y no lo es.

**¿Algún requisito se da por verificado con menos de lo que dice?** Uno, y es menor (**m4**): R11,
«la misma regla vale para las dos rutas». En el gate sólo se ejerce **la ruta del admin** —el
escenario de `CierreFacturaPapel.test.tsx` replica a mano sus contenedores—; la del mensajero sólo
estaba en T21, cuya evidencia se borró con el harness. El mapa lo etiqueta honestamente, pero
conviene saber que hoy, en el gate, R11 es estructural más **una sola ruta** evaluada.

---

## 8. Que no se haya roto lo ajeno — nada se movió, y donde pudo moverse está MEDIDO

- **Inventario CERRADO de la 217 (`factura-contraste.guardia.test.ts`): NO aparece en el diff.**
  `git diff --stat origin/dev...HEAD` no lo lista. Verde sin ser tocado. R23 y R27 se apoyan en eso.
- **Guardia de la 221 (`impresion-sin-dark.guardia.test.ts`)**: sólo cambia el import del lector, el
  ancla del caso `:184` —autorizado por R24 y por `design.md §8`— y un `^\s*` sobrante en la regex
  `vieja`. **Ninguna cifra medida cambia.** Sus números de contraste (`:381-397`) no se tocan.
- **La única cifra que pudo moverse** —el texto que leen los lectores de tokens tras cambiar
  `contraste.ts` de quitador— **está medida por mí**: 11442 = 11442. No es estimación.
- El caso `:184` de la 221 **ganó** una corrección real: sin quitar el `^\s*`, cuando las dos anclas
  enganchaban el mismo bloque `vieja` salía 1-2 caracteres por delante y el caso pasaba en verde. El
  motivo está escrito en el propio caso, con fecha.

---

## Hallazgos

### BLOQUEANTE

**B1 — `specs/223-flujo-impresion-factura/tasks.md`: las 23 tareas siguen sin marcar.**
`CHECKPOINTS.md > Especificación` lo exige explícitamente y el archivo abre diciendo que «una
feature solo pasa a `done` si TODO esto se cumple». Es un minuto de trabajo, pero **no lo arreglo
yo** y no es puramente cosmético: un `tasks.md` que nunca se marcó tampoco se usó como estado vivo,
y de hecho **dos tareas se ejecutaron fuera de lo escrito** —T18 adelantada de la Tanda 3 a la 1, y
T21 hecha con Playwright en vez de a mano—. Las dos desviaciones están **bien declaradas** en la
bitácora, pero el archivo que debía llevar la cuenta no lo refleja.
**Para cumplirlo**: marcar las 23 y dejar anotada junto a T18 y T21 la desviación que la bitácora ya
justifica.

### Menores

**m1 — El arreglo de A.1 no es literalmente «el segundo `:not()` que A.2 y A.3 ya llevaban».**
La bitácora lo argumenta así en su punto (b), y no es exacto: el segundo `:not()` de A.2 y A.3 es
`:not(.hoja-imprimible)` —la clase—, mientras que a A.1 se le añade `:not(:has(.hoja-imprimible))`
—el `:has()`—, que es el **primer** predicado de A.2 y A.3. La conclusión (desliz de transcripción,
no postura) **se sostiene igual** por el punto (a): la prosa de A.1 dice «se poda todo lo que no
lleva al diálogo» y el popup **lleva** a la hoja. Pero quien se apoye en el punto (b) para revisar
esto se lleva una idea equivocada de la simetría.

**m2 — El arreglo de A.1 sí cambia el resultado en una forma de DOM que hoy no ocurre.**
Con el segundo `:not(:has(.hoja-imprimible))`, la rama A.1-2 perdona **cualquier** subárbol que
contenga una candidata, no sólo el que lleva al diálogo. Hoy da igual: el portal cuelga del `<body>`
(medido: `popup.parentElement.parentElement === document.body`) y las N compactas mueren en el
**primer** selector de A.1, a nivel de hijo del `<body>`. Lo comprobé: el caso «sale la hoja del
diálogo y NO la compacta de detrás» es verde. Pero si Base UI montara el portal **dentro** del
envoltorio de la app, junto a las compactas, el nivel 1 dejaría de podarlas. **No es silencioso**:
el caso «el popup se monta en un contenedor propio COLGADO del `<body>`» se pondría rojo. Vale la
pena escribir ese vínculo en el comentario del CSS, que hoy explica el porqué del `:not()` pero no
esta condición.

**m3 — La mitad de R28 que vive en `app/globals.css:281-287` no está congelada por ningún caso.**
R28 nombra dos anclas: `globals.css:281-287` y `cierre-factura.tsx:111-117`. La segunda tiene dueño
(`impresion-flujo` con «la cabecera de la hoja ya no afirma que no hay `@page`», que lee
`hojaCruda`). La primera **está bien reescrita en el código** —la leí: remite a la 223 y conserva lo
que sigue siendo cierto— pero **ningún caso lo afirma**: el único uso de `cssCrudo` que la roza es
la autocomprobación `toMatch(/Feature 223/)`. Puede volver a mentir sin que nada se ponga rojo.

**m4 — R11 («vale igual en las dos rutas») queda, en el gate, como estructural más una sola ruta.**
Ver §7. La ruta del mensajero sólo se ejerció en T21, cuya evidencia se borró con el harness. Ningún
caso afirma siquiera que `CierreDiaModule` monte el mismo `CierreFacturaDetalle`.

**m5 — La mitad negativa de R21 no tiene censo.** Nadie comprueba que el CSS **no** declare
`table-header-group`. La mitad positiva —el límite declarado con su razón— sí está.

**m6 — `requirements.md` R19 sigue diciendo «la rejilla de KPI» y el código protege la tarjeta.**
El desempate del leader —por el efecto: partir la tarjeta parte un dato, partir la rejilla corta
entre tarjetas— es correcto, está escrito junto a la lista congelada en la guardia y la mutación 20
lo muerde. No pido tocar el spec, porque `tasks.md` T21 prohíbe ajustarlo para que encaje; pero
quien compare `requirements.md` con el código encuentra una discrepancia sin nota en
`requirements.md`.

**m7 — `progress/history.md` no tiene entrada.** `CHECKPOINTS.md > Verificación final` la pide. Es
paso de cierre del leader, posterior a esta revisión; lo dejo listado para que no se caiga.

---

## Mutaciones que planté yo

Método: árbol limpio antes de cada una, script con **autocomprobación** —aborta sin escribir si el
ancla no aparece **exactamente una** vez—, `git diff` para confirmar que la mutación estaba en el
árbol **antes** de correr nada, y `git checkout --` después. **Árbol limpio y 182 de 182 verdes al
terminar.**

| # | Mutación plantada | Resultado | Coincide con la bitácora |
| --- | --- | --- | --- |
| **3-bis** | A.1 tal como la escribe `design.md §3.4` | **2 ROJOS** — `CierreFacturaPapel:473` (la hoja elegida queda oculta) y `impresion-flujo:591` | sí, 2 |
| **2** | Quitar la guarda `:has()` del primer selector de A.1 | **3 ROJOS** — `CierreFacturaPapel:586` («sin ninguna candidata, la regla NO engancha nada» = **la página en blanco**), `:556` y `impresion-flujo:543` | sí |
| **R24 / T5** | Bloque de tokens de la 217 movido **detrás de `.dark`** | **4 ROJOS** — `tema-encendido:240` y `:375`, `impresion-flujo:310` y `:320`. **Contrafactual medido: con el ancla vieja habría salido VERDE** (4141 < 5775) | sí |
| **13** | Bloque del flujo movido **delante** del de la 217 | **12 ROJOS** | sí, 12 |
| **5-inocua** | `!open && "hoja-imprimible"`, o sea marcar la hoja **plegada** | **10 ROJOS** — el lookbehind de la guardia hace su trabajo | sí, 10 |
| **17** | Quitar el `!important` de `max-width` | **1 ROJO** | sí, 1 |
| **21** | `quitarComentariosCss` delegando en el quitador de TypeScript | **1 ROJO**, exactamente en «la declaración que sigue a url(//...) SOBREVIVE» | sí, 1 |
| **16-inocua** | `break-inside-avoid` **también** en la sección de órdenes | **2 ROJOS** | sí, 2 |

Ocho mutaciones, ocho rojas, **cero discrepancias con lo anotado**. A diferencia de la 217, aquí no
encontré ninguna mutación que la bitácora diera por roja y que **no pudiera ocurrir**.

---

## Lo que me pareció bien y conviene no perder

1. **La verificación por comportamiento es real y es un salto de nivel.** Leer los selectores del
   archivo y evaluarlos contra el DOM montado —en vez de copiarlos a una cadena— es lo que cazó el
   defecto que catorce censos de texto daban por bueno. Y evita el modo de fallo que la 222 encontró:
   una guardia describiendo clases retiradas.
2. **Las autocomprobaciones de censo están puestas donde tocaba**: `esSimple` se prueba contra
   simples y contra compuestos, `argumentosDeNot` exige extraer más de 7, el censo de `tests/` exige
   más de 300 archivos y encontrar la copia canónica, y `selectoresQueOcultan()` **lanza** en vez de
   devolver vacío.
3. **La medición de T4 se corrigió cuando midió vacío**, y quedó anotado el porqué en el propio caso.
   Un caso que pasaba afirmando lo contrario de lo que mide es exactamente el fallo de esta casa.
4. **El hallazgo del quitador se cerró por la raíz**, con contraprueba y con un caso que vigila que
   las dos pasadas sigan coincidiendo sobre el CSS real.
