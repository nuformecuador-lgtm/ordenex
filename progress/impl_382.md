# Ficha 382 — informe de implementación

> `CHECKPOINTS.md > Trazabilidad` exige este archivo con el mapa `R<n> → test`. La ficha es
> `sdd: false` y **no hay `specs/382/`**, así que los requisitos que el código cita —`R1` y `R2`—
> se enuncian AQUÍ: este es el único sitio donde pueden vivir, y sin ellos las cinco referencias
> `Feature 382 (R1/R2)` del código apuntan a la nada.

**Rama:** `fix/382-etiqueta-caracter-no-cubierto` · **Implementación:** `c77ac23c` ·
**Revisión:** `81390410` · **Cierre (esta entrega):** el commit que trae este archivo
**Zona:** frontend · **Fecha:** 2026-09-07

## Qué arregla, en una línea

Una orden de producción con el destinatario y la dirección escritos en caracteres **double-struck**
tumbaba la descarga del **lote entero**, y el modal respondía «No se pudo preparar la tipografía de
la etiqueta. **Inténtalo de nuevo.**» — una instrucción imposible de cumplir, sin decir qué orden
mirar.

## La causa, medida (no supuesta)

- La orden de la **guía 11081885** traía esos dos campos en el bloque **U+1D400** (matemáticos
  double-struck, los de los generadores de «letras bonitas»). El code point medido: **U+1D560**
  (hex del dato, `f09d95a0`).
- La fuente de la etiqueta es un **subconjunto**: cp1252 + el colón U+20A1. Esos code points no
  están, y `exigirCobertura` (`lib/pdf/etiquetas-fuente-registro.ts`) **lanza a propósito** para no
  imprimir un carácter roto. **Eso está bien y no se ha tocado**: con Identity-H jsPDF *borra de la
  cadena* lo que la fuente no cubre y sigue sin decir nada, que es el fallo mudo que cerró la 282.
- **UNA sola orden en todo el sistema**, y tumbaba el lote porque el generador lanza al llegar a
  ella. (Un primer conteo dio 38: era un filtro que contaba de más — U+2014, U+2019, U+2122 y
  U+00A0 **sí** están en cp1252.)
- **El defecto era el mensaje**, y era una decisión deliberada escrita en el `catch` de
  `handleDescargar`: «los dos significan lo mismo para quien está delante… el detalle técnico del
  segundo no le sirve a un operador de bodega». No significan lo mismo, y ese razonamiento está
  ahora **reemplazado por el contrario**, con su motivo al lado, para que nadie los vuelva a juntar.

## Los requisitos

**R1 — el error sabe de qué orden es.**
Cuando el generador de etiquetas encuentra en un texto de una orden un carácter que el subconjunto
embebido de la fuente no cubre, el sistema **debe** abortar sin emitir PDF y lanzar un error
**tipado** (`ErrorCaracterNoImprimible`) que lleve encima: la **guía** de esa orden, el **carácter**,
su **code point** y el **campo**. Aplica a las **dos** llamadas de `drawEtiqueta`: el texto de la
etiqueta y el **importe** (`Monto a cobrar`).
*Por qué tipado y no un mensaje:* quien lo recoge es una pantalla, y una pantalla no distingue dos
causas leyendo subcadenas de un texto.

**R2 — el aviso dice qué orden, qué carácter y qué hacer.**
Cuando la descarga falla por R1, el modal **debe** mostrar un mensaje que (a) nombre la **guía**,
(b) diga que el problema es un **carácter que no se puede imprimir**, mostrándolo junto a su
notación `U+XXXX`, (c) indique que hay que **corregir el dato de esa orden**, y (d) **no** mande
reintentar. Los otros dos modos de fallo **conservan** su mensaje: la fuente que no carga sigue con
el de hoy, palabra por palabra, y `ErrorEtiquetaNoCabe` con el suyo. Los tres tienen que ser
distinguibles.
*Por qué (d) es un requisito y no una preferencia de redacción:* la fuente que no carga es red o
bundle y reintentar puede funcionar; un carácter fuera del subconjunto no cambia nunca por
reintentar, y mandar hacerlo es enviar al operador a un bucle sin salida.

**R28 (feature 282) y R7 (feature 350) siguen vigentes y sin tocar**, y esta ficha los cita: R28 es
«un carácter no cubierto no se imprime en silencio»; R7 es el mensaje de «no cabe».

## Mapa R → test

| R | Qué clava | Test |
| --- | --- | --- |
| R1 (texto de la etiqueta) | el error es tipado y trae guía + carácter + code point | `tests/unit/pdf/etiquetas-fuente.test.ts` › «382 — el error es tipado y trae la guia, el caracter y su code point» |
| R1 (transporte real) | dibujando de verdad, el carácter double-struck del **destinatario** lanza con la guía | `tests/unit/pdf/etiquetas-caracter-no-cubierto.test.ts` › «el caracter double-struck del destinatario lanza…» |
| R1 (segundo campo) | lo mismo desde la **dirección** | idem › «lo mismo si el caracter esta en la DIRECCION y no en el nombre» |
| R1 (orden culpable) | la guía es la de **esa** orden, no una fija | idem › «la guia que viaja es la de la ORDEN CULPABLE, no la primera del lote» |
| R1 (**la línea del dinero**) | el fallo nacido en el **importe** dice la guía real, y se prueba que salió de esa llamada (`campo === "Monto a cobrar"`) | idem › «el simbolo de moneda fuera del subconjunto lanza desde el campo del IMPORTE» + «y la guia que viaja cambia con la orden» |
| R1 (control positivo) | con el dato en letras normales / con la cobertura real, **no** lanza | idem › los dos «control positivo» + `etiquetas-fuente.test.ts` › «382 (control negativo)» |
| R2 (a·b·c·d) | el aviso renderizado, como **literal**: guía, carácter, `U+XXXX`, «corrige ese dato» y **sin** «Inténtalo de nuevo» | `tests/components/EtiquetasGuiaModal.test.tsx` › «(a) muestra la guia y el caracter, y NO manda reintentar» |
| R2 (fuente intacta) | «No se pudo preparar la tipografía de la etiqueta. Inténtalo de nuevo.» literal, y sigue saliendo | idem › «(b) la fuente que no carga CONSERVA su mensaje de hoy, palabra por palabra» |
| R2 (fallo imprevisto) | lo no previsto sigue cayendo en el genérico | idem › «(b bis) un fallo NO previsto del generador…» |
| R2 (no cabe intacto) | el mensaje de la 350, literal | idem › «(c) `ErrorEtiquetaNoCabe` sigue con el suyo, intacto» |
| R2 (los tres distintos) | tres mensajes distintos y **solo uno** manda reintentar | idem › «los tres mensajes son DISTINTOS entre si» |
| R2 (aislante bidi) | el carácter va envuelto en `U+2068`/`U+2069` y no puede reordenar el aviso | idem › «un caracter de control no puede reordenar el aviso que lo denuncia» |
| R2 (ancho cero) | la notación `U+XXXX` sigue cuando el carácter no se ve | idem › «y la notacion U+XXXX sigue ahi cuando el caracter no se ve» |
| R28 (282) | no se descarga en silencio, y el aviso es **el de esta causa** | idem › «R28: un caracter fuera del subconjunto tampoco se descarga en silencio» + `tests/integration/carga-api-etiquetas.test.ts` (canal best-effort, HTTP 200) |

## Los tres mensajes, y cuándo sale cada uno

| Caso | Qué ve el operador | Puede reintentar |
| --- | --- | --- |
| La fuente no llega (chunk/red) o fallo no previsto | «No se pudo preparar la tipografía de la etiqueta. Inténtalo de nuevo.» | **Sí** — es lo único que puede hacer y a veces funciona |
| Carácter fuera del subconjunto (**esta ficha**) | «La etiqueta de la guía 11081885 lleva un carácter que la tipografía de la etiqueta no puede imprimir: «\u2068𝕠\u2069» (U+1D560). Reintentar no lo cambia, y ninguna etiqueta del lote se descarga mientras siga ahí: corrige ese dato en la orden 11081885 y escríbelo con letras y números normales.» | **No** — hay que corregir el dato de esa orden |
| La etiqueta no cabe (feature 350) | «La etiqueta de la guía N no cabe en este tamaño de hoja…» | **No, pero** puede cambiar de tamaño de hoja |

En los tres casos: **ningún PDF**, `onSuccess` no se llama, y la vista previa y el botón siguen ahí.

## Cómo se verificó

- **`./init.sh` completo**, con `INIT_EXIT=$?` escrito **dentro** del log y en su propia línea (el de
  fuera puede ser el de un `echo`; ya pasó tres veces en este repo). Sin `tail` en la tubería.
- Última corrida, ya con todo lo de esta entrega: **`INIT_EXIT=0`**, **1770/1770 archivos,
  25 279 tests, 26 `skipped`**. Los 26 están contados: **17** en `AnaliticaPage.test.tsx` y **9** en
  `AnaliticaShell.test.tsx`, preexistentes y ajenos a la ficha. **Cero saltados en
  `integration/db`**: el gate confirma que los 132 archivos contra Postgres sí se ejecutaron.
- La corrida de la implementación (`c77ac23c`) dio los mismos números con 25 274 tests; los **+5**
  son los de esta entrega (3 del importe, 2 del aislante y la notación).
- El **gate rápido no se niega** aquí: ninguna de las rutas tocadas casa `RUTAS_SENSIBLES` ni
  `NOMBRES_DE_DINERO` (`lib/pdf/` no lleva nombre de dinero pese a dibujar el importe). Se corrió el
  completo igualmente, por ser el pre-PR y por tocar `lib/`.
- **Solo este archivo y `progress/history.md` se escribieron después del gate**: son `.md`, no entran
  en typecheck, lint ni tests.

## Mutaciones — 16 aplicadas entre las tres pasadas, 16 muertas

Cada una se aplicó al árbol real, se corrió la suite relevante y se revirtió desde copia (nunca
`git checkout`: había trabajo sin commitear).

**Implementación (7/7 muertas):** quitar la rama `instanceof ErrorCaracterNoImprimible` del `catch`
(la regresión que la ficha cierra) · devolver el mensaje a «Inténtalo de nuevo» · fijar `0` como
guía dentro del error · fijar `1` como guía en el call site del texto · dejar `exigirCobertura` sin
camino de salida · borrar el carácter del error · reescribir `ERROR_FUENTE_ETIQUETA`.

**Revisión (6 aplicadas, 5 muertas + 1 superviviente):** las mismas por otro camino, más la que
importó: **M4b**, colar un `0` como guía en `exigirCobertura(fuente, monto, "Monto a cobrar", …)`
**sobrevivía con 268 tests verdes en 13 archivos**. Es la línea del importe.

**Cierre (3/3 muertas):**

| Mutación | Resultado |
| --- | --- |
| **M4b** (la del reviewer): `0` como guía en el call site del **importe** | **MUERTA** — 2 rojos en `etiquetas-caracter-no-cubierto.test.ts` |
| Quitar el aislante bidi (`return caracter`) | **MUERTA** — 2 rojos: `382 (a)` y el del `U+202E` |
| Anular la rama del `catch` (la M3 del reviewer) | **MUERTA** — ahora **2** rojos: `382 (a)` **y el test R28 preexistente**, que era el `menor 3` |

## Decisiones de esta entrega

1. **`numGuia` es un parámetro OBLIGATORIO de `exigirCobertura`**, no opcional. Con uno opcional,
   quien lo olvidara reproduciría el fallo de la ficha —«algo no se pudo imprimir», sin decir de
   quién— sin romper ni un tipo ni un test. Coste: los 3 call sites de test que ya existían pasan a
   dar la guía.
2. **El `campo` viaja en el error pero no se pinta.** Para todo lo que no es el importe vale «texto
   de la etiqueta», que no le dice al operador dónde mirar; con el carácter a la vista, se encuentra
   buscándolo. Se usa en los tests para demostrar **de qué llamada** salió el error, que es como
   quedó clavada la línea del dinero.
3. **El carácter culpable va envuelto en `U+2068`/`U+2069`** (aislante bidi). Sin eso, un `U+202E`
   —alcanzable: todo lo que no es `0x20-0x7E` ni `0xA0-0xFF` llega hasta aquí— invertiría el orden
   de lo que va detrás **dentro del propio aviso**, incluida la guía. Los dos aislantes se escriben
   **escapados** (`\u2068`) en el código y en el esperado del test: un literal invisible es un
   literal que alguien borra sin darse cuenta.

## Lo que queda vivo

1. **La decisión de negocio sigue abierta y no se ha implementado**: si Ordenex debe **normalizar**
   estos caracteres al entrar (double-struck → ASCII) en la carga masiva y en el alta manual. Mi
   opinión, sin firma del humano y por tanto sin código: **no** normalizaría a ciegas —reescribir el
   nombre de un destinatario es alterar el dato del cliente sin que nadie lo vea, y además no cierra
   el agujero: un emoji o un carácter cirílico siguen fuera de cp1252—. Si se quiere automatizar, la
   vía honesta es `NFKC`, que mapea **exactamente** el bloque U+1D400 a letras latinas y respeta
   acentos y ñ (pero también toca `½` y `ﬁ`). Lo que sí propongo es **rechazar o marcar en el
   alta/carga** con este mismo mensaje: se ve con la orden delante, no cuatro días después.
2. **Riesgo residual conocido (era el `menor 4` del reviewer):** un carácter de **ancho cero**
   (`U+200B`) se sigue pintando como unas comillas vacías. El aislante bidi no arregla eso y no
   pretende; quien salva al operador es la notación `U+XXXX` al lado, que por eso **no es opcional**
   y tiene su propio test. Cerrarlo del todo pediría pintar solo la notación cuando el code point no
   es imprimible, y eso quitaría el reconocimiento visual del sosia de una letra, que es el caso
   común. Se deja así, escrito.
3. **La orden 11081885 sigue rota en producción hasta que se corrija su dato.** El desbloqueo no
   necesita código ni tocar la base: la pantalla de corrección de datos del cliente (fichas
   312/327). Ojo: la P y la R que faltan en «orfirio odriguez» **no las borró ningún fallo**, no
   están en el dato.
4. **Nadie ha visto esto en la app real.** Lo que hay son 28 casos que montan el modal real en jsdom
   y lo manejan con `userEvent`, más el gate completo. En este repo eso no basta y está medido:
   mirar la app encontró siete textos rotos que doce mil tests daban por buenos. Queda pendiente de
   verificación humana: seleccionar la orden 11081885 en `/ordenes`, «Imprimir etiquetas» →
   «Descargar etiquetas», y leer el aviso.
5. **`menor 6` del reviewer, heredado:** el índice del grafo está rancio en `lib/pdf/` (`trace_path`
   devuelve un `camposDeEtiqueta` que no existe, y las líneas van ~80 desfasadas). Todo lo afirmado
   aquí está confirmado contra los archivos reales; conviene reindexar antes de la próxima consulta.
