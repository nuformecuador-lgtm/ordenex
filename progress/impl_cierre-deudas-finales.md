# Cierre de deudas finales — 2026-08-07

Rama `chore/cierre-deudas-finales` (desde `origin/dev`). Tres frentes, un commit cada uno y
el de la regresión primero y separado, porque tiene que poder leerse solo.

| # | Commit | Qué |
| --- | --- | --- |
| 1 | `4a862356` | `fix(161)` — devuelve el tono al chat del mensajero |
| 2 | `a78263ca` | `fix(172)` — los encabezados de la hoja dejan de prometer exactitud que no tienen |
| 3 | `f3d8afb4` | `test(descarga)` — guardia de aserción de orden para `COLUMNAS_DESCARGA_*` |

---

## 1. La regresión: el mensajero dejó de oír los mensajes del cliente

### Qué pasó

La causamos nosotros hoy. El PR #312 borró
`app/(app)/mis-asignaciones/_components/ChatWhatsappPanel.tsx` por decisión humana —el chat
flotante lo sustituye— y salió a producción en la release #314.

Ese panel era **uno de los dos consumidores** de `useTonoAlIncrementar`, el hook de la
feature 161. La feature declaraba dos superficies (requirements §D la campana, §E el chat) y
desde hoy tiene una: **el tono del chat se fue con el archivo**. No es un tono que suene mal:
es que no suena. Capacidad de usuario perdida, en producción.

### Cómo se detectó

Contando consumidores del hook a los dos lados del borrado, no leyendo el diff:

- `origin/prod~1`: `ChatWhatsappPanel.tsx` **y** `components/shared/NotificationsBell.tsx`.
- Hoy: solo `NotificationsBell.tsx`.

El propio archivo borrado llevaba escrito el aviso en su cabecera
(`@sin-superficie … se pierde el punto de entrada`), pero hablaba del punto de entrada al
chat, no del tono. Lo que delata la pérdida es el censo de consumidores, no el comentario.

### Qué se hizo

El enganche vuelve a `app/(app)/mis-asignaciones/_components/chat/ChatConversacion.tsx`, que
es la superficie viva del hilo (dentro de `ChatFlotante`, montado desde `RepartoModule`).

**Antes de escribir nada se comprobó la equivalencia**, que era la condición para no forzarla:

| | `ChatWhatsappPanel` (borrado) | `ChatConversacion` (vivo) |
| --- | --- | --- |
| Fuente del hilo | `listarHiloChat(orden.id)` con SWR | igual (misma clave `["chat-hilo", id]`) |
| Refresco | `REFRESH_INTERVAL_MS = 10_000` | igual |
| «Hilo cargado» | `data?.status === "ok" ? data : null` | idéntico, misma variable `hiloOk` |
| Forma del mensaje | `m.direccion === "entrante"` | idéntica (`ChatMensajeVista`) |

La equivalencia existe y es literal, no analógica. El enganche es el mismo del panel:

```ts
useTonoAlIncrementar(
  hiloOk ? mensajes.filter((m) => m.direccion === "entrante").length : null,
);
```

**R24 respetado**: `null` mientras el hilo no ha cargado. Sin eso, la primera carga se lee
como un salto de cero a N y suena al abrir un hilo con mensajes previos. Hay un matiz que el
panel no tenía: `ChatConversacion` acepta `orden: null`; en ese caso la clave de SWR es `null`,
no hay `data`, y el contador también es `null`. No suena.

**Fallo silencioso respetado**: no se añadió ni un `try`/`catch` ni un aviso. Todo el manejo
de errores del tono vive dentro del hook y de `lib/audio/`, que es donde la 161 lo dejó; esta
superficie solo aporta un número. Un tono que no puede sonar no rompe la pantalla.

### Verificación

Los tests del tono existían y se fueron con el panel: `tests/components/ChatWhatsappPanel.test.tsx`
tenía un bloque «feature 161, R21–R23» con cuatro casos. **Se recuperaron adaptados** (no
reescritos) en `tests/components/ChatConversacionTono.test.tsx`, más dos casos nuevos:

| Caso | Qué prueba |
| --- | --- |
| R21 | un entrante nuevo en el refresco **suena** |
| R22 | un saliente nuevo **no** suena |
| R23/R24 | abrir sobre un hilo con entrantes previos **no** suena |
| R24 (nuevo) | la **primera carga** con varios entrantes y **sin refresco** no suena |
| R13 | dos entrantes de golpe suenan **una** vez |
| — (nuevo) | sin orden seleccionada no se pide el hilo y no suena |

El caso R24 nuevo es el que faltaba: el del panel probaba «no suena al abrir» a través de un
ciclo de refresco, y eso deja pasar una implementación que arranque el contador en `0` en vez
de `null` si el primer fetch resuelve antes del primer render. Aislarlo sin refresco lo cierra.

Detalle de jsdom, declarado porque es un stub y no una propiedad del código: jsdom no
implementa `Element.scrollTo`, y la conversación ancla el hilo abajo en cada mensaje nuevo.
Sin el stub el efecto lanza y tumba el render antes de llegar al tono.

#### Mutaciones de control

| Mutación | Resultado | Restaurado |
| --- | --- | --- |
| Quitar el enganche (`useTonoAlIncrementar(...)` fuera) | **ROJO**: R21 y R13 | hash `44da9362` |
| Quitar el guard de R24 (`hiloOk ? … : null` → contar siempre) | **ROJO**: R21, R22, R23/R24 y R24-aislado | hash `44da9362` |

Las dos restauraciones verificadas por `git hash-object`, no por lectura. La segunda mutación
es la que dice que el caso de R24 no es decorativo: sin el guard, cuatro de los seis caen.

### Veredicto

**El tono del chat quedó RESTAURADO.** La feature 161 vuelve a tener sus dos superficies.

---

## 2. Los encabezados que prometían más exactitud de la que tienen

### El problema

`COLUMNAS_DESCARGA_CUENTAS_POR_PAGAR` exportaba «Devengado» y «Pagado». Los dos son sumas
**brutas** del libro: incluyen los pagos anulados y su reverso
(`PagoMensajeroMovimientoRepository.agregarCuentaPorPagar` agrupa por `tipo` sin excluir nada).
Solo «Cuenta por pagar» —la resta— sale exacta.

En pantalla eso lo explica `CUENTAS_AVISO_BRUTOS`, que la feature 172 puso justo encima de la
tabla (`CuentasPorPagarTable.tsx:215-217`). **La hoja de cálculo se reenvía sin ese aviso**: se
descarga, se manda por correo, y quien la abre ve dos importes que prometen exactitud.

### Los encabezados nuevos y por qué éstos

Decisión humana: renombrar. El texto se eligió leyendo el aviso de la 172 y usando **sus
mismas palabras**, que son las que el usuario ya vio en pantalla:

> «Pagado» sigue contando **los pagos que se anularon**, y «Devengado» suma **la devolución de
> cada uno**, así que esos dos importes quedan más altos de lo que se movió de verdad.
> «Cuenta por pagar» ya tiene todo eso descontado: ese es el número correcto.

De ahí:

| Antes | Ahora |
| --- | --- |
| `Devengado` | `Devengado (incluye la devolución de los pagos anulados)` |
| `Pagado` | `Pagado (incluye los pagos anulados)` |
| `Cuenta por pagar` | sin cambio — es el exacto |

**No se abrevian igual a propósito.** La sugerencia de partida era «(incluye anulados)» para las
dos, pero el aviso distingue y la distinción es real: «Pagado» sí incluye los pagos anulados;
«Devengado» **no** los incluye, incluye su devolución. Un mismo paréntesis para las dos volvería
a decir algo que no es.

**El dato no cambia**: ni una operación, ni un valor, ni el orden de las columnas. Cambia lo que
la cabecera promete.

La pantalla **no** se toca: allí los rótulos cortos van acompañados del aviso, y alargarlos
estropearía la tabla sin ganar nada. La divergencia es deliberada y está escrita en los dos
archivos.

### Verificación

El PR #316 había congelado esos encabezados con un test, así que constante y test se movieron
**en el mismo commit** (`tests/unit/descarga/cuentas-por-pagar-descarga-columnas.test.ts`). El
test gana además un segundo caso: la salvedad está en los **dos** importes brutos y **no** en la
resta. Ese caso es el que se rompe si mañana alguien «limpia» las cabeceras quitando el
paréntesis, o si se la pone también a «Cuenta por pagar».

---

## 3. La guardia de la constante nº 36

### Por qué no vale `censo-tablas.ts`

Se comprobó antes de escribir nada: **no sirve y no se reutiliza**. Censa instancias de
`<DataTable>`, es decir una decisión por **tabla**. Una tabla puede declarar varias listas de
columnas (el cierre del día declara seis) y una lista puede alimentar dos tablas (los dos
ledgers del pago por mensajero). Son dos ejes distintos; compartir el registro habría obligado a
uno de los dos a mentir.

La guardia nueva es hermana, no heredera: `tests/unit/descarga/columnas-asercion-de-orden.guardia.test.ts`,
mismo directorio y mismo estilo de parseo equilibrado que `cobertura-tablas.guardia`.

### El contrato

Para cada `export const COLUMNAS_DESCARGA_<X>` de `app/` o `components/` tiene que existir en
`tests/` un `expect(COLUMNAS_DESCARGA_<X>.map(...)).toEqual(...)`. Tres exigencias, cada una con
su motivo:

1. **La aserción nombra la constante.** Afirmar sobre el parámetro de un `describe.each`
   (`expect(columnas.map(...))`) no cuenta, aunque la permuta ponga rojo el caso: nadie que
   busque «¿quién cubre esta constante?» lo encuentra. Es literalmente lo que ya le pasó a
   `_MIS_PAGOS` y `_DESGLOSE_MENSAJERO`, cuyas aserciones se sacaron del `describe.each` por eso.
2. **Se afirma sobre `.map(...)`**, que es donde vive el orden.
3. **El lado esperado no se mira.** Puede ser un literal o una constante del propio test
   (`toEqual([...CLAVES_CONTRATO])`, como hace la analítica). Exigir literal daría por
   descubiertas constantes bien cubiertas y empujaría a duplicar el listado.

### Las dos trampas medidas, y cómo se cierran

| Trampa | Efecto si no se cierra | Cómo se cierra |
| --- | --- | --- |
| Recorrer solo `app/` | cuenta 34 y se deja `_PAGOS_REGISTRADOS`, en `components/shared/liquidacion/` | canario con ruta esperada en `components/` |
| Detector textual laxo | da por descubiertas `_MIS_PAGOS`, `_DESGLOSE_MENSAJERO` y `_ANALITICA_OPERATIVA`, que **sí** están cubiertas | el sujeto del `expect` se parsea con paréntesis equilibrados y se exige el nombre |

### La autocomprobación

Un detector roto pasa **verde**: encuentra cero constantes, cero incumplimientos, y se queda de
adorno para siempre. Por eso el primer caso del archivo no comprueba el árbol, comprueba el
detector, con mensajes que empiezan por `DETECTOR ROTO:` / `DETECTOR DEMASIADO LAXO:`:

- **canario en `app/`** (`COLUMNAS_DESCARGA_ORDENES`) — censado, con su ruta, y con cobertura
  detectada hoy;
- **canario en `components/`** (`COLUMNAS_DESCARGA_PAGOS_REGISTRADOS`) — el que delata un
  recorrido corto;
- **negativo sintético** — la forma `describe.each` no cuenta como cobertura, y una mención en un
  comentario tampoco;
- **positivo sintético** — la forma canónica sí, para que el negativo no pase por no encontrar
  nunca nada.

La propia guardia se excluye del barrido de `tests/`: si se cubriera a sí misma, sus canarios no
demostrarían nada.

Un tercer caso comprueba que una constante no se da por cubierta por otra cuyo nombre empiece
igual (`_DIA_ENTREGADAS` vs `_DIA_ENTREGADAS_V2`).

### Mutaciones

| # | Mutación | Resultado |
| --- | --- | --- |
| 1 | constante nº 36 sin test (`COLUMNAS_DESCARGA_MUTACION_SIN_TEST` en `app/`) | **ROJA**, y el mensaje nombra la constante y su archivo |
| 2 | detector que solo recorre `app/` | **ROJA** por partida doble: el canario de `components/` y el suelo del censo (34 < 35) |
| 3 | detector laxo (`/\.map/` en vez del nombre) | **ROJA**: el negativo sintético, con `DETECTOR DEMASIADO LAXO` |

Restauración verificada por `git hash-object` (`e7ee46c9`) tras cada mutación del archivo de
guardia; la mutación 1 era un archivo nuevo, borrado y suite en verde después.

### Efecto colateral que hubo que corregir

El commit 2 había creado `COLUMNAS_DESCARGA_MAESTRO` para los rótulos del archivo. No es un
`DescargaColumna[]` —es un diccionario de cabeceras— y con ese nombre entraba en el censo como
una entrada falsa: la guardia lo detectó al primer intento, con 36 constantes y una desnuda. Se
renombró a `ENCABEZADOS_DESCARGA_MAESTRO`. **El prefijo `COLUMNAS_DESCARGA_*` queda reservado a
listas de columnas**, que es lo que la guardia da por hecho, y así está escrito en los dos
archivos.

---

## Qué queda sin cubrir

Declarado, no escondido:

1. **El tono sigue sonando solo con el chat abierto.** Es el mismo límite que declaraba el panel
   borrado (design §4 de la 161) y no cambia: con `ChatConversacion` desmontado no hay polling y
   no suena nada. El aviso con el chat cerrado exigiría un contador real de mensajes sin leer,
   que hoy no existe. Lo que se recupera es lo que había, ni más ni menos.
2. **Nada impide que el próximo borrado repita esto.** Se ha reparado *esta* pérdida, no la clase
   de error. Una guardia hermana sería «toda superficie declarada en un spec tiene un consumidor
   vivo», y no se ha escrito: el encargo era acotado y el censo de superficies por spec no existe
   en este repo. Queda como deuda nombrada.
3. **`ChatConversacion` sigue sin tests de UI más allá del tono.** Los del panel borrado cubrían
   además el composer, las plantillas y los dos caminos de envío (feature 120). Solo se
   recuperaron los del tono, que es lo que pedía el encargo; los otros se fueron con el panel y
   su superficie sustituta no los tiene.
4. **La guardia usa un suelo (`>= 35`), no un total exacto.** Añadir la constante nº 36 con su
   test no obliga a tocar el número. La decisión es deliberada —el caso de cobertura ya falla si
   nace desnuda, y el suelo existe para detectar que el detector se rompió, no para contar—, pero
   significa que borrar una constante y añadir otra a la vez no deja rastro en ese número.
5. **La guardia no mira el contenido de la aserción.** Exige que exista y que nombre la
   constante; no comprueba que la lista esperada coincida con la real. Eso lo hace el propio test
   de cada constante, y meterlo aquí sería reimplementar `toEqual`.

## Gate

`./init.sh --rapido` — ver el cierre de la sesión. El completo lo corre el humano.
