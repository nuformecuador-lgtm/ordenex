# 383 — Normalizar al entrar los caracteres que la etiqueta no puede imprimir · requirements

> Zona: `fullstack` · Complejidad: `media` · Rama: `feat/383-normalizar-caracteres-no-imprimibles`
> Pedido humano (2026-09-07), tras cerrar la 382: «la 382 arregló el **mensaje**, pero no impide
> que vuelva a pasar».

## De dónde nace, y qué NO es

La ficha **382** (mergeada) hizo que el aviso diga **de qué orden** es el carácter no imprimible y
que **no** mande reintentar. Lo que no hizo —a propósito— es cerrar la puerta: el carácter sigue
entrando sin resistencia y solo se descubre días después, con el lote en la mano.

El caso medido: la orden de la guía **11081885** traía el destinatario y la dirección en
**caracteres matemáticos double-struck** (bloque U+1D400; el medido, **U+1D560**). La fuente de la
etiqueta es un **subconjunto** de cp1252 + `₡` + `€` (219 code points,
`COBERTURA` en `lib/pdf/etiquetas-fuente.ts`), así que `exigirCobertura` se niega a imprimir —y
hace bien—. **Una sola orden tumbaba el lote entero.**

**Esto NO es una urgencia y el spec lo dice para que nadie lo priorice mal.** Medido en producción
el 2026-09-07: **cero** órdenes vivas con caracteres del bloque U+1D400 (la única ya se corrigió).
Esta ficha **no desbloquea a nadie hoy**; es prevención. Su valor entero está en el **CUÁNDO**: que
el próximo carácter se vea **con la orden delante** —al cargar el lote— y no cuatro días más tarde.

## Las dos mitades, y por qué la segunda no es opcional

1. **Normalizar lo normalizable.** `NFKC` mapea el bloque U+1D400 a letras latinas.
2. **Rechazar lo que quede.** Un emoji, un carácter cirílico o CJK siguen fuera de cp1252 y
   **ninguna normalización los vuelve imprimibles**. Una ficha que solo normalizara dejaría el
   mismo fallo esperando con otro carácter.

Y una tercera cosa, que es una restricción sobre la primera: **si se normaliza, tiene que verse**.
Reescribir el nombre de un destinatario sin que nadie lo mire es el mismo género de fallo mudo que
este repo persigue (fichas 282, 294, 299/304).

## Alcance

**Entra:**

- La decisión única de «¿es imprimible este texto?», **compartida** con el generador de PDF.
- La reparación de los caracteres no imprimibles que tengan reparación, y el **aviso** de que la
  hubo.
- El rechazo por fila en la **carga masiva por sesión** y en la **carga por API key**.
- El rechazo en la **corrección de datos del cliente** (fichas 312/327), que es —medido— la única
  superficie donde hoy un humano escribe estos campos a mano. Ver §«El alta manual no existe».

**No entra, y con motivo:**

- **`notas`.** No se imprime en la etiqueta (`datosDeEtiqueta`, `lib/pdf/etiquetas-dibujo.ts:197`).
  Rechazar una carga por un emoji en un campo que nunca llega al papel es coste sin ganancia.
- **`monto_cobrar`, `provincia` y `canton_distrito` del archivo.** El primero es un número que
  formatea el servidor; los otros dos son nombres que se resuelven contra el catálogo y **no** son
  lo que se imprime: la etiqueta imprime los nombres del **catálogo**.
- **El nombre de la tienda y los nombres de geografía.** Sí llegan a la etiqueta, pero se escriben
  en otras superficies (`UsuarioService.crear`, `ZonaService.crear`, semillas de geografía). Riesgo
  residual **declarado**, no cerrado: ver **Q3**.
- **La comprobación del PDF (382/R1).** Se queda exactamente como está. Esta ficha añade una puerta
  antes, no sustituye la de después.

## El alta manual no existe — medido, no supuesto

La ficha pedía cubrir «el alta manual y la carga masiva». **El alta manual de órdenes no existe
hoy**, y esto está confirmado contra los archivos, no contra el índice del grafo:

- `lib/interfaces/services/IOrdenService.ts:49-63` declara desde el 2026-08-07 que el servicio es
  **«SOLO LECTURAS»** y que `crear`/`actualizar`/`borrar`/`obtener` se retiraron «al quedarse sin
  superficie».
- `lib/actions/ordenes.ts` exporta exactamente dos funciones: `listarOrdenes` y
  `listarOrdenesCompleto`.
- `crearOrdenSchema` sigue vivo en `lib/types/orden.ts:37` pero **sin un solo consumidor de
  producción** (solo tests y prosa de otros specs).

Las únicas escrituras de alta son las **dos vías de carga masiva**. Por eso la corrección de datos
del cliente **no es un extra**: es la mitad «alta manual» de esta ficha. Es la única superficie
donde una persona teclea a mano `destinatario`, `telefonoDest`, `producto` o `direccion` de una
orden — y si se deja fuera, un maestro vuelve a meter el carácter corrigiendo y la puerta sigue
abierta.

---

# Requisitos

## A. Una sola definición de «imprimible»

**R1** — El sistema DEBE decidir si un texto se puede imprimir en la etiqueta a partir de **la
misma** cobertura de code points que usa el generador del PDF, y NO DEBE mantener una segunda lista
de caracteres permitidos.
*Mutación: añadir un rango a la cobertura y comprobar que el veredicto de la validación de entrada
cambia con él → si no cambia, hay dos definiciones → rojo.*

**R2** — La cobertura DEBE seguir derivándose del archivo de fuente commiteado y NO DEBE escribirse
a mano (no regresión de 282/R29).
*Mutación: cambiar un rango del módulo de cobertura sin regenerarlo → la guardia que compara con el
`.ttf` → rojo.*

**R3** — Importar la validación de entrada NO DEBE hacer que el programa de fuente (los ~22 KB de
base64) entre en el bundle inicial del navegador (no regresión de 282/R13).
*Mutación: hacer que el módulo de validación importe el artefacto de fuente → la guardia de carga
diferida, ampliada → rojo.*

## B. La reparación: qué se toca y qué no

**R4** — CUANDO el sistema evalúe un texto, para cada carácter que la cobertura **ya cubra** DEBE
conservarlo **sin modificar**.
*Mutación: aplicar `NFKC` a la cadena entera → el caso «`½` entra y sale `½`» → rojo.*

**R5** — CUANDO un carácter no esté cubierto y su normalización de compatibilidad (`NFKC`) sí lo
esté, el sistema DEBE sustituir ese carácter por ella.
*Mutación: devolver el texto sin tocar → el caso «`𝕠rfirio` → `orfirio`» y el caso «`ﬁ` → `fi`» →
rojo.*

**R6** — CUANDO un carácter no esté cubierto y su normalización **tampoco** lo esté, el sistema NO
DEBE escribirlo ni sustituirlo por nada: DEBE **rechazar** el texto nombrando ese carácter y su
code point.
*Mutación: sustituir el carácter irreparable por `?` o eliminarlo → el caso «un emoji se rechaza, no
desaparece» → rojo.*

**R7** — CUANDO el texto traiga un carácter del bloque Símbolos Alfanuméricos Matemáticos
(U+1D400–U+1D7FF) cuya normalización sea una letra latina básica o un dígito, el sistema DEBE
repararlo; SI la normalización de ese carácter es una letra griega, ENTONCES el sistema DEBE
rechazarlo.
*Mutación: fijar el veredicto a «reparable» para todo el bloque → el caso «`𝛂` (U+1D6C2) se rechaza
porque `α` tampoco está en la fuente» → rojo.*

**R8** — El sistema NO DEBE cambiar ningún texto que sea imprimible entero: para los 219 code points
cubiertos, la salida DEBE ser idéntica a la entrada.
*Mutación: normalizar antes de comprobar cobertura → el barrido sobre los 219 code points, que caza
`¼ ½ ¾ ´ ¨ ¯ ¸ ˜` y `™` → rojo.*

## C. Carga masiva — las dos vías

**R9** — CUANDO una fila de la carga masiva traiga un texto **reparable** en `destinatario`,
`telefono`, `producto` o `direccion`, el sistema DEBE crear la orden con el texto **reparado**.
*Mutación: rechazar la fila en vez de repararla → el caso «fila con `𝕠rfirio` → `creada` y el
destinatario almacenado es `orfirio`» → rojo.*

**R10** — CUANDO ocurra R9, el sistema DEBE informar en el resultado de **esa** fila del **campo**,
del **valor original** y del **valor aplicado**.
*Mutación: reparar sin emitir el aviso → el caso «la fila creada trae `campo`, `original` y
`aplicado`» → rojo.*

**R11** — MIENTRAS la carga esté en **validación previa** (dry-run), el sistema DEBE producir
exactamente la misma reparación, el mismo aviso y el mismo rechazo que producirá la carga en firme.
*Mutación: saltarse la comprobación cuando `dryRun` es `true` → el caso «el preview y la carga real
sobre las mismas filas dan la misma clasificación y los mismos avisos» → rojo.*

**R12** — El sistema NO DEBE reparar nunca `num_remision`; SI `num_remision` no es imprimible,
ENTONCES la fila DEBE quedar en error.
*Mutación: aplicar la reparación también a `num_remision` → el caso «`num_remision` con un carácter
double-struck da error, y no una orden con una remisión distinta de la del archivo» → rojo.*

**R13** — CUANDO una fila traiga un texto **irreparable** en cualquiera de los campos de R9 o R12,
el sistema NO DEBE crear esa orden, DEBE marcar la fila como `error` bajo la **clave de la columna
del archivo**, y DEBE dejar entrar las demás filas del lote.
*Mutación: abortar el lote entero → el caso «lote de 3 filas, la del medio con un emoji: 2 creadas y
1 error» → rojo.*

**R14** — El mensaje de R13 DEBE nombrar el **carácter**, su notación **U+XXXX** y el **campo**, y
NO DEBE pedir que se reintente.
*Mutación: reemplazarlo por «dato inválido» → la aserción literal del mensaje → rojo.*

**R15** — El sistema DEBE aplicar R9–R14 de forma **idéntica** por la vía de sesión
(`adminTienda`) y por la vía de **API key**.
*Mutación: aplicar la comprobación solo en una de las dos → el caso espejo sobre `cargarViaApi` →
rojo.*

**R16** — El sistema NO DEBE evaluar `notas`, `monto_cobrar`, `provincia` ni `canton_distrito`: una
fila NO DEBE quedar rechazada por un carácter que nunca llega al papel.
*Mutación: incluir `notas` en la lista de campos evaluados → el caso «fila con un emoji SOLO en
`notas` → `creada`, y las notas se guardan con el emoji intacto» → rojo.*

## D. Corrección de datos del cliente

**R17** — CUANDO la corrección reciba un texto **irreparable** en `destinatario`, `telefonoDest`,
`producto` o `direccion`, el sistema NO DEBE guardar **ningún** campo de esa corrección y DEBE
devolver el rechazo bajo la clave de **ese** campo.
*Mutación: guardar los demás campos y rechazar solo el malo → el caso «se mandan nombre con emoji y
dirección buena; ni la dirección se escribe» → rojo.*

**R18** — CUANDO la corrección reciba un texto **reparable**, el sistema NO DEBE guardarlo reparado
por su cuenta: DEBE rechazarlo devolviendo el texto reparado **como sugerencia** dentro del
mensaje.
*Mutación: aplicar la reparación y devolver `ok` → el caso «`𝕠rfirio` → `validation_error`, el
mensaje contiene `orfirio`, y el repositorio no recibe ninguna escritura» → rojo.*

**R19** — La corrección NO DEBE evaluar `notas`.
*Mutación: incluirla → el caso «corregir solo `notas` con un emoji → `ok`» → rojo.*

## E. No romper lo que ya funciona

**R20** — El generador de etiquetas DEBE seguir abortando con `ErrorCaracterNoImprimible` cuando un
texto **ya almacenado** no sea imprimible (382/R1 y 282/R28 intactos): la validación de entrada NO
sustituye a la del PDF.
*Mutación: relajar `exigirCobertura` «porque ya se valida al entrar» → la suite de la 382 → rojo.*

**R21** — Una entrada **sin** caracteres fuera de cobertura DEBE producir exactamente el mismo
resultado que antes de esta feature: los mismos contadores, las mismas filas y ninguna clave nueva
en la respuesta.
*Mutación: emitir el aviso de R10 con `original === aplicado` → el caso «carga normal: el resumen es
byte a byte el de antes» → rojo (mismo criterio que la 304 aplicó a `montoAjustado`).*

---

## Decisiones sin firmar

Marcadas como **asunción del leader, NO firmadas por el humano**. Cada una con su vuelta atrás.

| # | Asunción | Vuelta atrás |
| --- | --- | --- |
| **A1** | **No se aplica `NFKC` a ciegas**: solo se toca el carácter que hoy NO se imprime (R4/R5). El humano pidió `NFKC` y aceptó ver escritas sus consecuencias sobre `½` y `ﬁ`; esto es `NFKC` **acotado**, que conserva `ﬁ→fi` y deja `½` intacto. | Quitar la guarda de R4 y normalizar la cadena entera. Un cambio de una línea en el módulo puro; los tests de R4/R8 pasan a rojo y se retiran con la decisión firmada. |
| **A2** | **La corrección rechaza, no repara** (R18). | Cambiar el retorno de `validation_error` a la reparación aplicada. Toca solo el servicio; R18 se reescribe. |
| **A3** | **`num_remision` no se repara nunca** (R12): es un identificador compartido con la tienda, no prosa. Repararlo dejaría a Ordenex y a la tienda con dos claves distintas para la misma orden. | Moverlo a la lista de reparables. Una constante. |
| **A4** | **`notas` queda fuera** (R16/R19). | Añadirlo a la lista. Una constante. |
| **A5** | **No queda rastro persistente** de que un texto se reparó: el aviso vive en la respuesta de la carga, como el de la 299/304. Si la tienda cierra la pestaña, ese «`𝕠rfirio` → `orfirio`» ya no está en ningún sitio. | Escribir una fila en `historial_accion` (ficha 362) por orden reparada. **Esto sí pediría migración** si se quisiera una columna propia; con `historial_accion` no. Ver **Q4**. |
| **A6** | **El nombre de la tienda y los nombres de geografía quedan fuera** del alcance (§Alcance). | Otra ficha, o ampliar esta con `UsuarioService.crear` y `ZonaService.crear`. Ver **Q3**. |

---

## Preguntas abiertas

**Q1 — FIRMADA POR EL HUMANO el 2026-09-08. Ya no está abierta.**
> «si dale, que reescriba el nombre y avise en pantalla»

Queda firmado que la carga masiva **repara y avisa** en vez de rechazar, **con la condición de que
se vea en pantalla** — la condición es parte de la firma, no un extra, y es lo que hace la línea
del preview (T7.2). No cambió una sola línea de código: confirma lo que ya estaba implementado
(R9/R10). Lo que cambia es de quién es la decisión. **Cuidado con la lectura fácil: esto NO firma
A2**, que es la misma pregunta en la OTRA superficie (la corrección de datos, donde sí hay una
persona delante de esa orden) y sigue siendo del leader. El texto original de la pregunta se
conserva abajo, tal como se escribió, porque es el que el humano respondió.

**Q1 (texto original) — ¿Es correcto que la reparación cambie el dato del cliente en la carga masiva?**
La ficha lo pide («normalizar lo normalizable») y el diseño lo hace **visible** en el preview antes
de escribir nada. Pero el resultado sigue siendo que Ordenex guarda un nombre que la tienda no
escribió. La alternativa honesta es **rechazar también en la carga** y que la tienda corrija su
archivo (el round-trip del XLSX con `motivo_error` ya existe, ficha 143). *Recomendación del
leader:* reparar y avisar, porque el preview es una puerta de confirmación humana real; pero es
decisión del humano y cambia R9/R10.

**Q2 — FIRMADA POR EL HUMANO el 2026-09-08, con la misma frase que Q1. Ya no está abierta.**
Es la mitad de la misma pregunta: reescribir el nombre para que la etiqueta salga incluye componer
la `ñ` que venía partida. Implementado en `evaluarTextoDeEtiqueta`, y **solo** con `reparar: true`.
Medido además (T0.1c): sobre los 219 code points cubiertos el `NFC` es la **identidad**, o sea que
no puede tocar un texto que hoy imprime bien. Texto original abajo.

**Q2 (texto original) — ¿Se añade un `NFC` previo?**
Un texto en forma **descompuesta** (`"n" + U+0303`, lo que produce macOS al copiar) se lee «ñ» en
pantalla y con las reglas de arriba se **rechaza** nombrando `U+0303` — un mensaje que va a
desconcertar a quien lo lea, porque el texto «se ve bien». `String.prototype.normalize("NFC")` es
**canónico** (no cambia la identidad de ningún carácter) y es la identidad sobre cualquier texto ya
cubierto, así que aplicarlo antes es barato y no reabre A1. No se ha metido para no ampliar el
alcance sin firma.

**Q3 — El nombre de la tienda y los nombres de geografía se imprimen en la etiqueta y esta ficha no
los toca.** Un maestro que registre una tienda como «𝕋ienda» vuelve a tumbar el lote entero, y esta
vez el aviso apuntará a una orden cuyo dato está bien. ¿Se amplía esta ficha a `UsuarioService.crear`
y `ZonaService.crear`, o es otra ficha? *Recomendación:* otra ficha; el riesgo es el mismo pero la
superficie y los roles son distintos.

**Q4 — ¿Hace falta rastro persistente de la reparación?** (asunción A5). Si la respuesta es sí, el
sitio ya existe (`historial_accion`, ficha 362) y **no** hace falta migración; si se quisiera un
campo en la propia orden, sí la haría.

**Q5 — El mensaje de la 382 dice «ninguna etiqueta del lote se descarga mientras siga ahí».** Ese
cierre no aplica al cargar (la orden ni existe todavía). El diseño propone conservar **literal** la
parte que nombra el carácter y su code point, y cambiar solo el cierre por «corrige esa celda» /
«escríbelo así». ¿Se acepta que los dos mensajes compartan la frase del diagnóstico y difieran en la
instrucción final?
