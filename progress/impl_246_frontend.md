# Feature 246 — bitácora de implementación (FRONTEND: T4 y T5.2-T5.3)

> **Alcance: sólo la pantalla.** T4 (el selector y los dos modales de asignación), T5.2 y T5.3 (lo
> que ve el mensajero). El backend —T1, T2, T3, T5.1, T6, T7.1-T7.5— lo cerró otra tanda y su
> bitácora es `progress/impl_246.md`; **no la he tocado**, ni `progress/medicion_246.md`.
>
> **Sin commit.** El árbol queda mutado y sin tocar git: ni `checkout`, ni `switch`, ni `stash`,
> ni `commit`.
>
> **T7.7 («ver la app») NO está hecha aquí**: hay un servidor de dev vivo en `localhost:3000` y el
> recorrido lo hace el humano. No lo levanté ni lo maté.

---

## 1 · Lo que monté

| Pieza | Archivo | Qué hace |
| --- | --- | --- |
| **El selector** | `components/shared/SelectorDiaReparto.tsx` **(NUEVO)** | Dos opciones excluyentes, «Hoy» preseleccionada, sobre la primitiva `RadioGroup` de `components/ui/`. Recibe las dos fechas por props y **no lee ningún reloj**. |
| **El vocabulario** | `lib/utils/dia-reparto-textos.ts` **(NUEVO)** | Las etiquetas, la frase de confirmación y la marca «Para mañana», en un solo sitio para las dos superficies y las tres cards. Sin `Date` ni `Intl`. |
| **Bodega central** | `app/(app)/ordenes/_components/AsignarBodegaModal.tsx` | Monta el selector, manda `dia` en `asignarDesdeBodega` y confirma con palabras para qué día quedó el lote. |
| **Bodega satélite** | `app/(app)/recepcion-satelite/_components/AsignarSateliteModal.tsx` | Espejo exacto (**D4**). |
| **El cableado** | `app/(app)/ordenes/page.tsx` · `.../OrdenesListado.tsx` · `app/(app)/recepcion-satelite/page.tsx` · `.../RecepcionSateliteModule.tsx` | Las dos páginas (Server Components) resuelven las fechas con `fechaCalendarioCR()` / `mananaCalendarioCR()` y las bajan por props. Los módulos de cliente sólo **transportan**. |
| **Lo que ve el mensajero** | `.../pos-card/PosOrderCardMosaico.tsx` · `PosOrderCardDetalle.tsx` · `PosOrderCard.tsx` | Badge con el **texto** «Para mañana» en la fila de marcas de excepción, alimentado por el `esParaManana` que ya derivaba el servidor. |

### Por qué el selector va en `components/shared/` y sobre `RadioGroup`

Dos consumidores es el umbral que `docs/architecture.md` fija para promover un compuesto, y aquí
los dos consumidores **son el requisito**: D4 se firmó para que la elección signifique lo mismo
desde las dos bodegas.

**`npx shadcn add radio-group` habría sido la instrucción equivocada** y lo dejo escrito porque es
un atajo mental fácil: este repo **no usa Radix**. Sus primitivas van sobre **Base UI**
(`components/ui/radio-group.tsx` lo dice en su propia cabecera), y la primitiva **ya existía**. No
instalé nada; la reusé.

### Una pieza que el diseño no nombraba: `fechaLegible`

`design.md` §7 pide etiquetas «con el día resuelto en el servidor», pero el servidor emite
`YYYY-MM-DD` y eso no es una etiqueta para un operador. La conversión a «20 de agosto» la hace una
función **de texto puro**, con una tabla de meses, **no `Intl.DateTimeFormat`**: `Intl` necesita un
`Date`, y construir un `Date` desde `"2026-08-20"` lo interpreta **en la zona del navegador** — que
es exactamente la puerta que R29 cierra. Con una tabla, el resultado es el mismo en cualquier
máquina y no hay ningún reloj de por medio.

---

## 2 · El estado por defecto, y por qué

**El defecto es «Hoy», y se manda explícito.**

- `useState<DiaReparto>("hoy")` en los dos modales, y `dia` **viaja siempre** en el payload, se
  toque el selector o no.
- **Se reinicia a «Hoy» en CADA apertura**, no sólo en la primera. Los dos modales están **montados
  permanentemente** con un prop `open` (no se desmontan al cerrarse), así que sin el reinicio un
  «Mañana» elegido para un lote **se quedaría pegado** y el lote siguiente saldría reservado sin que
  nadie lo pidiera. Eso es literalmente el defecto que la ficha viene a evitar, servido por la otra
  puerta. Tiene caso propio y **mutación propia (M4)**.

**Por qué explícito y no confiando en el `.default("hoy")` de zod.** El borde tiene el default (R4)
y es la red de abajo, pero es **una red que no avisa**: la bitácora del backend lo declara —«un
modal que se olvide de mandarlo no rompe nada y nadie se entera»— y la action recibe `input:
unknown`, así que **el typecheck no puede verlo**. Lo único que lo impide es un
`toHaveBeenCalledWith` con el literal `dia: "hoy"` a la vista. Está en las dos suites de modal y en
`OrdenesRutearSatelite.test.tsx`, y lo mata **M2** y **M3**.

**Qué pasa si el usuario no elige:** no hay «no elegir». El grupo arranca con una opción marcada y
el `onValueChange` **ignora el `""`** que la primitiva emitiría al limpiar la selección, en vez de
reinterpretarlo. «Sin elegir» no puede convertirse en un día por accidente.

---

## 3 · El caso de la medianoche (D6): nombrado, no silenciado

Las etiquetas se resuelven **cuando la página se renderiza**; el día al que va el lote lo resuelve
el servidor **al enviar**. Una pestaña abierta a las 23:58 y confirmada a las 00:01 enseña un
«Mañana» que significa un día más allá de lo que el operador leyó.

**Decidido NO implementar el escape** (`design.md` §4.4), y está medido: M1 dice que la asignación
más tardía de los últimos 30 días es a las **20:00** y que no hay masa entre las 23:00 y la 01:00.
El fallo, además, es **benigno**: una noche de más de protección, nunca una orden perdida.

**Dónde queda escrito**, para que sea decisión y no descubrimiento:
- el porqué entero, en la cabecera de `components/shared/SelectorDiaReparto.tsx`;
- un puntero en cada una de las dos páginas, justo donde se calculan las fechas.

---

## 4 · Una decisión de cableado que conviene revisar

Los props de fecha son **obligatorios en el selector y en los dos modales** —montar un modal sin
decidir de dónde salen las etiquetas es imposible, y el typecheck lo demostró: los **5 rojos** que
aparecieron al añadirlos fueron **exactamente los 5 sitios donde los modales se montan**— pero son
**opcionales en los dos contenedores** (`OrdenesListado`, `RecepcionSateliteModule`), con defecto
`{ hoy: "", manana: "" }`.

**El porqué, y su coste declarado.** Hacerlos obligatorios en `OrdenesListado` habría obligado a
tocar **~53 puntos de montaje en 8 archivos de test** ajenos a esta ficha. Y la asimetría no es
pereza: si la página se olvidara, **nada miente** —el selector se lee «Hoy» / «Mañana» sin fecha y
el lote sigue yendo al día correcto, porque el día lo decide el servidor—; lo único que se pierde
es precisión. Es lo contrario del caso del payload `dia`, donde olvidarse **sí** cambia lo que se
escribe en la base y por eso el olvido tiene que romper un test.

**El defecto es la cadena vacía y no una fecha calculada** porque los contenedores son código de
**cliente**: cualquier fecha que se inventara ahí saldría del reloj del navegador. **Se degrada, no
se falsea**, y hay un caso que lo fija («sin fechas a mano las opciones se leen sólo con su
nombre — nunca con una fecha inventada»).

Las dos páginas **sí** las pasan. Si el revisor prefiere el obligatorio en toda la cadena, es un
cambio mecánico y lo hago.

---

## 5 · Mapa `R<n> → test` — **cada archivo comprobado, ejecutado por nombre**

> Todos los archivos citados **existen** y se ejecutaron por nombre, comprobando que corren casos.
> `vitest` no falla con un filtro que no casa nada: lo ignora en silencio, y en este repo ese mapa
> ya mintió cinco fichas seguidas.

| Req | Test (existe y corre) | Caso |
| --- | --- | --- |
| **R1** | `tests/components/AsignarBodegaModal.test.tsx` *(15 casos)* | «R1: elegir «Mañana» hace que la acción reciba `dia: manana` — el selector NO es decorativo» + «R26: … con el lote completo», que fija el `dia: "hoy"` por defecto |
| **R2** | `tests/components/AsignarSateliteModal.test.tsx` *(18 casos)* | «R2: elegir «Mañana» hace que la acción reciba `dia: manana`…» + su espejo del defecto |
| **R22** | `tests/components/RecogerModule.test.tsx` *(28)* · `tests/components/RepartoModule.test.tsx` *(83)* · `tests/components/PosCardParaManana.test.tsx` **(NUEVO, 12)** | «la card … dice «Para mañana» CON PALABRAS, y la de hoy no» (los dos módulos) · «también lo dice en la vista DETALLE» · las tres cards a la vez |
| **R24** *(la mitad que faltaba)* | `tests/components/RecogerModule.test.tsx` · `tests/components/RepartoModule.test.tsx` | «R24: la orden reservada SE PUEDE RECOGER — la Server Action se llama con su id» · «R24: la reservada SE PUEDE GESTIONAR — `escogerParaGestion` sí se llama» |
| **R27** | `tests/components/SelectorDiaReparto.test.tsx` **(NUEVO, 10)** · las dos suites de modal | «R27: «Hoy» sale MARCADA y «Mañana» NO» · «R27: reabrir el modal vuelve a «Hoy»…» |
| **R28** | `tests/components/AsignarBodegaModal.test.tsx` · `tests/components/AsignarSateliteModal.test.tsx` | «R28: tras asignar, el modal dice CON PALABRAS para qué día quedó el lote» + «si se deja «Hoy», la confirmación nombra HOY» |
| **R29** | `tests/components/SelectorDiaReparto.test.tsx` **(NUEVO)** | «R29: pinta LAS FECHAS QUE RECIBE, no las de ningún reloj» · «cambiar las props cambia las etiquetas — y las anteriores DEJAN de estar» · **censo del propio fuente** con anti-vacuidad y autocomprobación |

**Además, reforzados en el borde de pantalla** (el backend ya los tenía cubiertos server-side; esto
no los reclama, los acompaña): **R3/R6** («el día viaja UNA vez para TODO el lote, y como token —
nunca una fecha»), **R23** («la reservada APARECE en su grupo… y cuenta en el contador»), **R25**
(«deja de decirlo SIN QUE NADIE ESCRIBA NADA al llegar el día», con la misma fila re-renderizada).

**Emparejamiento ausencia ↔ presencia.** Ninguna aserción de ausencia va sola: cada `queryBy…
toBeNull` tiene al lado, **en la misma pantalla**, una presencia que demuestra que sí se renderizó
algo. Los casos «la de hoy no lo dice» montan **dos** cards; el «no aparece la frase de hoy» va
justo después de encontrar la de mañana; el «sin mensajeros no se ofrece elegir día» tiene su
gemelo con mensajeros.

**Los textos visibles van con su literal ESCRITO A MANO**, nunca contra la constante importada.
`SelectorDiaReparto.test.tsx`, `PosCardParaManana.test.tsx` y los bloques nuevos de los cuatro
archivos existentes **no importan** `lib/utils/dia-reparto-textos.ts`.

---

## 6 · Tabla de mutaciones — salida REAL y sha256 (16 primeros)

Once mutaciones, **una a una**, con `vitest` de verdad. El arnés (`scratchpad/mutar.py`) **aborta
en voz alta** si el texto a mutar no aparece exactamente una vez o si el archivo no cambia de
hash — en este repo ya hubo un arnés que reportó supervivientes **sin haber ejecutado un test**.
Cada revert restaura desde una copia byte a byte y vuelve a imprimir el hash.

| # | Qué se rompe | Archivo | sha256 antes → mutado → después | Rojo |
| --- | --- | --- | --- | --- |
| **M1** | El defecto pasa a «mañana» | `AsignarBodegaModal.tsx` | `9855d49976d627d1` → `d8bf0f0f906adb84` → `9855d49976d627d1` | **3 fallos** |
| **M2** | El modal deja de mandar `dia` (central) | `AsignarBodegaModal.tsx` | `9855d49976d627d1` → `f1184497cbd06c75` → `9855d49976d627d1` | **3 fallos** |
| **M3** | El modal deja de mandar `dia` (satélite) | `AsignarSateliteModal.tsx` | `e3add44c128cd9f0` → `e8863bfb929d1664` → `e3add44c128cd9f0` | **3 fallos** |
| **M4** | El «mañana» se queda pegado entre aperturas | `AsignarBodegaModal.tsx` | `9855d49976d627d1` → `5bd6d351aa9a1511` → `9855d49976d627d1` | **1 fallo** |
| **M5** | La etiqueta sale del reloj del navegador | `SelectorDiaReparto.tsx` | `4eb52ba13040c51f` → `b449d57d034bcbc7` → `4eb52ba13040c51f` | **7 fallos** (uno es el censo) |
| **M6** | Desaparece «Para mañana» del mosaico | `PosOrderCardMosaico.tsx` | `34b8c4e11167622c` → `6a79968b63c5ef9b` → `34b8c4e11167622c` | **1 + 1** (Recoger y Reparto, medidos aparte) |
| **M7** | Desaparece «Para mañana» de la card de detalle | `PosOrderCardDetalle.tsx` | `c34deabaeb4ee991` → `78bcb2687a021a77` → `c34deabaeb4ee991` | **1 fallo** |
| **M8** | Desaparece la confirmación del día | `AsignarBodegaModal.tsx` | `9855d49976d627d1` → `ffdd9adc9120fc73` → `9855d49976d627d1` | **2 fallos** |
| **M9** | **El candado que D5 prohíbe**: la reservada deja de poder recogerse | `RecogerModule.tsx` | `4eac68150c2185c6` → `d165dc90891c6a09` → `4eac68150c2185c6` | **1 fallo** |
| **M10** | El mes se corre uno: la fecha legible miente | `lib/utils/dia-reparto-textos.ts` | `863d44e1181cc5d2` → `dd86ca6f808f4b94` → `863d44e1181cc5d2` | **5 fallos** |
| **M11** | Desaparece «Para mañana» de la card completa | `PosOrderCard.tsx` | `1f279042c3e6d6f5` → `a5feccd26b7d3dcb` → `1f279042c3e6d6f5` | **2 fallos** |

**Cero supervivientes.** Los rojos, citados literalmente:

**M1 — el defecto pasa a «mañana»**

```
 FAIL  tests/components/AsignarBodegaModal.test.tsx > AsignarBodegaModal > R26: llama asignarDesdeBodega({ ordenIds, mensajeroId }) con el lote completo
AssertionError: expected "vi.fn()" to be called with arguments: [ { ordenIds: [ 'o1', 'o2' ], …(2) } ]
 FAIL  ... > R27: el modal abre con «Hoy» marcada y «Mañana» sin marcar
 FAIL  ... > R28: si se deja «Hoy», la confirmación nombra HOY (no un texto genérico)
TestingLibraryElementError: Unable to find an element with the text: El lote quedó para el reparto de hoy, 20 de agosto.
 Tests  3 failed | 12 passed (15)
```

**M2 — el modal deja de mandar `dia` (bodega central)**

```
 FAIL  ... > R1: elegir «Mañana» hace que la acción reciba `dia: manana` — el selector NO es decorativo
AssertionError: expected "vi.fn()" to be called with arguments: [ { ordenIds: [ 'o1' ], …(2) } ]
 FAIL  ... > R3/R6: el día viaja UNA vez para TODO el lote, y como token — nunca una fecha
AssertionError: expected undefined to be 'manana' // Object.is equality
 Tests  3 failed | 12 passed (15)
```

**M3 — el modal deja de mandar `dia` (bodega satélite)**

```
 FAIL  tests/components/AsignarSateliteModal.test.tsx > ... > R2: elegir «Mañana» hace que la acción reciba `dia: manana` — el selector NO es decorativo
AssertionError: expected "vi.fn()" to be called with arguments: [ { ordenIds: [ 'o1' ], …(2) } ]
 FAIL  ... > R3/R6: el día viaja UNA vez para TODO el lote, y como token — nunca una fecha
AssertionError: expected undefined to be 'manana' // Object.is equality
 Tests  3 failed | 15 passed (18)
```

**M4 — el día se queda pegado entre aperturas** *(la mutación que separa «el defecto es hoy» de «el
defecto es lo último que tocaste»)*

```
 FAIL  tests/components/AsignarBodegaModal.test.tsx > AsignarBodegaModal — día de reparto (feature 246) > R27: reabrir el modal vuelve a «Hoy» — un «Mañana» no se queda pegado al lote siguiente
 Tests  1 failed | 14 passed (15)
```

**M5 — la etiqueta sale de `new Date()` en vez de las props**

```
 FAIL  ... > R29: pinta LAS FECHAS QUE RECIBE, no las de ningún reloj
TestingLibraryElementError: Unable to find an accessible element with the role "radio" and name "Hoy · 31 de diciembre"
 FAIL  ... > R29: el fuente no contiene ninguna lectura del reloj
AssertionError: «new Date(» aparece en SelectorDiaReparto.tsx: la etiqueta del día dejaría de venir del servidor (R29): expected true to be false
 Tests  7 failed | 3 passed (10)
```

*(Sobre el árbol de antes de retirar la prop `disabled` esta misma mutación tumbaba además los 5
casos de `AsignarBodegaModal.test.tsx` que buscan el radio por su etiqueta; se volvió a medir sobre
el árbol final y los números de la tabla son los de esa segunda medición.)*

**M6 — desaparece «Para mañana» del mosaico**

```
 FAIL  tests/components/RecogerModule.test.tsx > RecogerModule — orden reservada para mañana (feature 246) > R22: la card de la orden reservada dice «Para mañana» CON PALABRAS, y la de hoy no
TestingLibraryElementError: Unable to find an element with the text: Para mañana.
 Tests  1 failed | 27 passed (28)
```

y, medida aparte contra Reparto:

```
 FAIL  tests/components/RepartoModule.test.tsx > RepartoModule — orden reservada para mañana (feature 246) > R22: la orden ya recogida anoche sigue diciendo «Para mañana», y la de hoy no
 Tests  1 failed | 82 passed (83)
```

> **Un hallazgo del arnés que conviene saber:** M7 (card de detalle) **NO** tumba el caso de
> `RepartoModule`, porque Reparto arranca en vista **mosaico** — su caso R22 ejercita
> `PosOrderCardMosaico`, igual que el de Recoger. Quien lea el mapa podría creer que ese caso cubre
> la card de detalle: **no la cubre**. Quien la cubre es el caso «también lo dice en la vista
> DETALLE» de `RecogerModule.test.tsx` y `PosCardParaManana.test.tsx`.

**M7 — desaparece «Para mañana» de la card de detalle**

```
 FAIL  tests/components/RecogerModule.test.tsx > ... > R22: también lo dice en la vista DETALLE — la marca no depende de cómo se mire
TestingLibraryElementError: Unable to find an element with the text: Para mañana.
 Test Files  1 failed | 1 passed (2)
      Tests  1 failed | 110 passed (111)
```

**M8 — desaparece la confirmación del día**

```
 FAIL  ... > R28: tras asignar, el modal dice CON PALABRAS para qué día quedó el lote
TestingLibraryElementError: Unable to find an element with the text: El lote quedó para el reparto de mañana, 21 de agosto.
 FAIL  ... > R28: si se deja «Hoy», la confirmación nombra HOY (no un texto genérico)
 Tests  2 failed | 13 passed (15)
```

**M9 — el candado que D5 prohíbe** *(la reservada sale de la lista con la que se resuelve la guía)*

```
 FAIL  tests/components/RecogerModule.test.tsx > ... > R24: la orden reservada SE PUEDE RECOGER — la Server Action se llama con su id
AssertionError: expected "vi.fn()" to be called with arguments: [ { ordenIds: [ 'r1' ] } ]
 Tests  1 failed | 27 passed (28)
```

**M10 — el mes se corre uno**

```
 FAIL  tests/components/SelectorDiaReparto.test.tsx > ... > R27: «Hoy» sale MARCADA y «Mañana» NO
TestingLibraryElementError: Unable to find an accessible element with the role "radio" and name "Hoy · 20 de agosto"
 FAIL  ... > R29: pinta LAS FECHAS QUE RECIBE, no las de ningún reloj
TestingLibraryElementError: Unable to find an accessible element with the role "radio" and name "Hoy · 31 de diciembre"
 Tests  5 failed | 5 passed (10)
```

**M11 — desaparece «Para mañana» de la card completa**

```
 FAIL  tests/components/PosCardParaManana.test.tsx > ... > R22: la card completa DICE «Para mañana» cuando la orden está reservada
TestingLibraryElementError: Unable to find an element with the text: Para mañana.
 FAIL  ... > R25: la card completa deja de decirlo SIN QUE NADIE ESCRIBA NADA al llegar el día
 Tests  2 failed | 10 passed (12)
```

### El censo de R29 se autocomprueba

`SelectorDiaReparto.test.tsx` no se conforma con «no encuentro `new Date(`»: tiene un caso de
**anti-vacuidad** (el archivo se lee de verdad, pesa más de 500 bytes y contiene
`export function SelectorDiaReparto`) y un caso de **autocomprobación** que pasa un fuente falso
con `new Date()` por el mismo filtro de comentarios y exige que dé positivo. Sin eso, un
`codigo()` que borrara el archivo entero dejaría el censo verde para siempre.

---

## 7 · Desviaciones, y por qué

### 1 · La marca va en las TRES cards, no en las dos que el portal monta

`PosOrderCard` (la card completa) **no está montada en ninguna pantalla hoy** —sólo la usan tests—,
pero las tres cards son **paralelas, no variantes**: comparten interfaz de props y son
intercambiables por diseño (lo dicen sus propias cabeceras). Una card sin «Para mañana» dejaría de
distinguir la orden reservada **en cuanto alguien la montara**, y ese día nadie buscaría la causa
aquí. Es el mismo criterio con el que la 227 comprobó en las tres a la vez que la nota privada
había desaparecido.

**Y no la dejé sin prueba**: `tests/components/PosCardParaManana.test.tsx` **(NUEVO)** recorre las
tres con el mismo DTO, y **M11** demuestra que el caso de la card completa muerde.

### 2 · `PosCardParaManana.test.tsx` es un archivo nuevo que `tasks.md` no pedía

T5.2 pedía casos en `RecogerModule.test.tsx` y `RepartoModule.test.tsx`, y están. El archivo extra
existe porque los dos anteriores prueban **módulos** (y, como descubrió M7, los dos acaban
ejercitando la misma card) y hacía falta un sitio donde la **paridad de las tres vistas** fuera una
aserción y no una frase en un comentario. Molde y vecino: `PosOrderCardSinNotaPrivada.test.tsx`.

### 3 · El selector **no** lleva prop `disabled`

La primitiva la tiene, pero ninguna superficie la ejerce: el `Modal` ya bloquea su propio confirmar
mientras la acción está en vuelo. Una prop que nadie usa es API que nadie prueba. Está dicho en el
propio archivo, para que añadirla el día que haga falta sea una decisión y no un descubrimiento.

### 4 · El selector **no** usa `FormField`

`DESIGN.md` fija `FormField` como patrón único de campo, y `FormField` cablea un `<Label htmlFor>`.
Un `for` apuntando a un `role="radiogroup"` **no produce nombre accesible**: el elemento no es
etiquetable. El patrón correcto para un grupo de radios es su propio nombre de grupo, así que el
título va como prosa visible y el `radiogroup` lleva **el mismo texto** en `aria-label` — que es lo
que evita que quien lo oye y quien lo lee estén oyendo dos nombres distintos. Las 125 guardias
siguen verdes con esto.

---

## 8 · Rojos que vi

### Míos, esperados, y arreglados

1. **Typecheck, 5 errores `TS2741`** al hacer obligatorias las fechas en los dos modales. **Era la
   señal buscada**, y salieron **exactamente los 5 sitios de montaje**:
   `AsignarBodegaModal.test.tsx:71`, `AsignarSateliteModal.test.tsx:67` y `:276`,
   `ManifiestoFlujos.test.tsx:282` y `:339`. Ningún sitio de producción quedó fuera porque los dos
   contenedores ya las pasaban.
2. **`tests/components/OrdenesRutearSatelite.test.tsx` — 2 rojos.** Dos `toHaveBeenCalledWith`
   sobre el payload de `asignarDesdeBodega`, que ahora gana `dia`.

   ```
   AssertionError: expected "vi.fn()" to be called with arguments: [ { ordenIds: [ 'o-gam' ], …(1) } ]
   Received:
   +     "dia": "hoy",
   ```

   **Actualizados con el literal `dia: "hoy"`, no relajados a un `objectContaining`**: ese archivo
   prueba el filtro por zona GAM, pero conservar el literal es una red más donde el campo no puede
   desaparecer en silencio.

### Ajenos: **ninguno**

Corrí la suite completa con el árbol como estaba y salió entera en verde. No vi ningún rojo de la
240 ni de nadie más.

**Lo que sí sigue abierto y no es mío:** los **ocho archivos en CRLF** que la bitácora del backend
lista (`app/(app)/novedades/_components/*` y sus tests). **No los toqué.** Comprobé byte a byte que
**ninguno de mis 18 archivos** quedó en CRLF ni con la codificación rota.

---

## 9 · Salidas reales del gate

### `pnpm run typecheck`

```
> ordenex@0.1.0 typecheck R:\job\singularis\projects\ordenex
> tsc --noEmit

(sin salida = cero errores)
```

### `pnpm exec eslint <los 19 archivos tocados>`

```
R:\job\singularis\projects\ordenex\tests\components\RepartoModule.test.tsx
  146:10  warning  'ordenCardsEnReparto' is defined but never used  @typescript-eslint/no-unused-vars

✖ 1 problem (0 errors, 1 warning)
```

**Cero errores.** El único warning es **preexistente y no es mío**: comprobado con
`git show HEAD:tests/components/RepartoModule.test.tsx`, la función ya estaba **en la misma línea
146** antes de que yo tocara el archivo (mi bloque está al final). Los archivos nuevos y los cinco
de producción salen **limpios, sin warnings**.

### `pnpm exec vitest run tests/components tests/unit/components`

```
 Test Files  262 passed (262)
      Tests  3386 passed | 26 skipped (3412)
```

### `pnpm exec vitest run guard guardia`

```
 Test Files  125 passed (125)
      Tests  1850 passed (1850)
```

### `pnpm exec vitest run tests/unit tests/integration`

```
 Test Files  1027 passed (1027)
      Tests  13518 passed (13518)
   Duration  136.26s
```

⚠️ **Estos números están medidos sobre un árbol que otra ficha (la 240) mutaba en paralelo.** Sirven
para cerrar MI tanda; **no valen como gate de PR**. `./init.sh` completo hay que correrlo **con el
árbol quieto**, cuando las dos fichas hayan terminado — es la lección que este repo ya tiene
escrita.

---

## 10 · Lo que queda vivo

- **T7.7, «ver la app»**: sin hacer. Con las dos pantallas ya montadas, el recorrido es posible; lo
  hace el humano sobre el dev server que ya está corriendo. Es donde se ve si «Hoy · 20 de agosto»
  cabe bien en el modal en móvil, que ningún test de jsdom puede decir.
- **La asimetría del apartado 4** (props obligatorias en el modal, opcionales en el contenedor):
  decisión tomada con su coste delante, revisable en un cambio mecánico.
- **D8 / D9 siguen fuera de alcance**, y D9 sigue siendo la primera candidata a seguimiento: sin
  ella, bodega no puede responder «¿qué dejé asignado para mañana?» sin abrir orden por orden. Ahora
  que el selector existe, esa pregunta se la va a hacer alguien.

---

## 11 · Archivos

**Nuevos (4)**

```
components/shared/SelectorDiaReparto.tsx
lib/utils/dia-reparto-textos.ts
tests/components/SelectorDiaReparto.test.tsx
tests/components/PosCardParaManana.test.tsx
```

**Modificados (15)**

```
app/(app)/ordenes/page.tsx
app/(app)/ordenes/_components/AsignarBodegaModal.tsx
app/(app)/ordenes/_components/OrdenesListado.tsx
app/(app)/recepcion-satelite/page.tsx
app/(app)/recepcion-satelite/_components/AsignarSateliteModal.tsx
app/(app)/recepcion-satelite/_components/RecepcionSateliteModule.tsx
app/(app)/mis-asignaciones/_components/pos-card/PosOrderCard.tsx
app/(app)/mis-asignaciones/_components/pos-card/PosOrderCardMosaico.tsx
app/(app)/mis-asignaciones/_components/pos-card/PosOrderCardDetalle.tsx
tests/components/AsignarBodegaModal.test.tsx
tests/components/AsignarSateliteModal.test.tsx
tests/components/ManifiestoFlujos.test.tsx
tests/components/OrdenesRutearSatelite.test.tsx
tests/components/RecogerModule.test.tsx
tests/components/RepartoModule.test.tsx
```

**Ni una línea fuera de la capa de presentación**: cero cambios en `lib/services`,
`lib/repositories`, `lib/actions`, `db/` ni `app/api/`. `lib/utils/dia-reparto-textos.ts` es un
módulo de texto puro, sin imports más allá del tipo `DiaReparto`.

---

## Veredicto

**T4 y T5.2-T5.3 terminadas.** El selector en las **dos** superficies con «Hoy» preseleccionado y
el día viajando en el payload, la confirmación con palabras y su fecha, la marca «Para mañana» en
las tres cards del portal, y la reserva **visible, etiquetada y trabajable** — recoger y gestionar
siguen funcionando, con la mutación del candado (M9) para demostrarlo. **Los 6 requisitos que el
backend dejó pendientes (R1, R2, R22, R27, R28, R29) están cerrados, y R24 completo.** Once
mutaciones, cero supervivientes.
