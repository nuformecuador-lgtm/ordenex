# impl — renombrar `chat-demo/` (el chat vivo que se llamaba «demo»)

Rama: `chore/renombrar-chat-demo`, creada **encima de `chore/borrar-codigo-muerto`**
(no de `dev`): ambas tocan `RepartoModule.tsx` y así se evita el conflicto.

Encargo: renombrado + corrección de comentarios. **Cero cambios de comportamiento.**

---

## 1. Por qué esto no es cosmética

El mismo día (2026-08-07) se ejecutó un chore de borrado de código muerto (**PR #312**).
Uno de los criterios de trabajo de ese tipo de barrido es «lo `demo` es desechable».
Aplicado a `app/(app)/mis-asignaciones/_components/chat-demo/` se habría llevado por
delante **el chat real de producción**.

Había **dos señales independientes** apuntando a «esto se puede tirar» y **ninguna**
diciendo lo contrario:

1. El nombre de la carpeta: `chat-demo/`.
2. El comentario que lo monta: `RepartoModule.tsx:587` abría con
   `Rediseño del chat (rama ux) — MAQUETA:`.

Y una agravante: desde el 2026-08-07 esta es la **ÚNICA entrada al chat**. El panel del
detalle (`ChatWhatsappPanel`) se borró en `da544b30`. Si cae la carpeta, el mensajero se
queda sin poder escribirle al cliente.

---

## 2. Lo que medí ANTES de tocar nada

### 2.1 Contenido de la carpeta

Cuatro archivos: `ChatFlotante.tsx`, `ChatConversacion.tsx`, `ChatOrdenesLista.tsx`,
`chat-demo-data.ts`.

### 2.2 La comprobación que el encargo pedía como condición de parada

El encargo decía: **si `chat-demo-data.ts` contiene datos de maqueta mezclados con helpers
vivos, parar y avisar**, porque entonces el problema sería otro y más gordo.

**Comprobado: NO los contiene. No hay que parar.** El archivo son 88 líneas de helpers
puros de presentación, todos exportados y todos en uso:

| Símbolo | Qué es |
| --- | --- |
| `ChatEstado` | tipo de la familia de estado |
| `ESTADO_CHIP` | etiqueta + clases del chip por estado (tokens de marca) |
| `estadoDe` | mapea `estatusValue` de la orden a familia de estado |
| `iniciales` | iniciales del avatar |
| `nombrePlantilla` | `hello_world` → `Hello World` (tiene test propio) |
| `horaCorta` | hora local HH:MM de la burbuja |
| `guiaVisible` | guía si la hay, si no la remisión |
| `zonaCorta` | «Distrito · Cantón» |

Su propia cabecera ya lo decía: *«Ya NO hay datos quemados: los contactos son las órdenes
en reparto, el hilo lo sirve `listarHiloChat` (feature 120) y las plantillas
`listarPlantillasParaEnvio` (feature 87)»*.

Es decir: el archivo cuyo nombre decía `-data` **no tiene ni un dato**. Era el nombre más
engañoso de los cuatro.

### 2.3 Consumidores

De fuera de la carpeta, tres:

- `RepartoModule.tsx:30` — import.
- `tests/unit/components/chat-plantilla-nombre.test.ts:3` — import.
- `lib/actions/whatsapp-envio.ts:63` — **referencia en prosa** dentro de un comentario. Si
  no se actualiza queda apuntando a una ruta inexistente.

Internos, dos: `ChatConversacion.tsx:40` y `ChatOrdenesLista.tsx:11`.

Los cinco actualizados. No apareció ningún consumidor más.

---

## 3. Decisión de nombres

- **`chat-demo/` → `chat/`.** Es lo que es, y encaja con el vecino `pos-card/`.
- **`chat-demo-data.ts` → `chat-format.ts`.** Es el **análogo exacto** de
  `pos-card/pos-format.ts`, el hermano directo: mismo rol (helpers de presentación puros,
  sin lógica de negocio ni side-effects, testeables aislados) y su cabecera lo describe con
  **las mismas palabras** («helpers de PRESENTACIÓN puros»). Se descartó `-data` porque el
  archivo no tiene datos, que es justo el error que se venía a corregir.

Ambos movidos con **`git mv`**. Git los registró como renames (99–100 % de similitud), así
que `git log --follow` sigue funcionando sobre los cuatro archivos.

---

## 4. El comentario de `RepartoModule.tsx:587`

El resto del comentario ya describía bien el montaje; el problema era la **primera palabra
que lee cualquiera**. Ahora abre diciendo que es código vivo y única entrada, que el hilo
(`listarHiloChat`, feature 120) y las plantillas (`listarPlantillasParaEnvio`, feature 87)
son reales, y qué se rompe si se borra.

Se **conservó** la referencia histórica al rediseño de la rama `ux` —explica de dónde sale
el estilo— pero aclarando que *lo que nació como maqueta ya se cableó a datos reales*, para
que no pueda releerse como «esto es provisional».

---

## 5. Verificación

### 5.1 Typecheck

`pnpm run typecheck` **limpio**, corrido dos veces: tras el renombrado (es la red que caza
un import que se quedara en la ruta vieja) y al final.

### 5.2 Guardias — antes/después

| | Archivos | Tests |
| --- | --- | --- |
| **Antes** (baseline, árbol limpio) | 70 | 958 |
| **Después** | 70 | 958 |

**Ninguna guardia se movió y ninguna se puso roja.** Dejo por qué, porque el encargo avisaba
de que varias censan por ruta de archivo y ya había pasado hoy con
`superficie-de-uso.guardia.test.ts`:

- Esa guardia **no ancla en la ruta literal** `chat-demo/`. Construye un grafo de
  alcanzabilidad recorriendo el árbol y **resolviendo imports**, y reconoce componente por
  patrón genérico (`components/` o `_components/` bajo `app/`). Un renombrado de carpeta con
  los imports actualizados es transparente para ella. Sus dos menciones al chat
  (líneas 21 y 721) son **prosa en comentarios**, no aserciones.
- Los censos con conteos fijos (`contadores-cabecera`, `adaptador-conjunto`,
  `catalogo-produccion`…) son de otras features (descarga, analítica). Ninguno toca esta
  ruta.

### 5.3 Gate rápido

`./init.sh --rapido` **verde**. `test:cambiados` 5 archivos / 116 tests, guardias 70/958,
migraciones con `down.sql`, `.env` presente. Lint: **0 errores**, 49 warnings — todos
preexistentes (`_zonaId`, `_items` y compañía, en archivos que no toqué).

Sin flakes: no hizo falta repetir nada en aislado.

---

## 6. Recuento de `chat-demo` que SOBREVIVE

Medido con `git grep` sobre todo el repo, **tras los dos commits de código y antes de
escribir esta bitácora**: **23 ocurrencias en 6 archivos**.

**En código, tests y `docs/`: CERO.** Todo lo que queda es registro histórico.

| Archivo | Ocurrencias | Se toca |
| --- | --- | --- |
| `progress/impl_borrar-codigo-muerto.md` | 12 | NO — histórico |
| `progress/barrido_acciones_huerfanas.md` | 1 | NO — histórico |
| `progress/impl_161-tono-notificacion.md` | 1 | NO — histórico |
| `specs/161-tono-notificacion/design.md` | 2 | NO — histórico |
| `specs/130-analitica-componentes-graficas/requirements.md` | 1 | NO — histórico |
| `feature_list.json` | 1 | NO — ver §6.1 |

`progress/` y `specs/` son fotos de lo que se pensó entonces (misma regla que los
`down.sql`), así que quedan intactos por instrucción.

### 6.1 El caso que NO está en `progress/` ni en `specs/`: `feature_list.json`

La única mención fuera de esas dos carpetas está en el campo `description` de la
**feature 161** (`status: done`, zone `frontend`), que dice:

> «…un contador real de no-leidos, que hoy es DATO QUEMADO en `chat-demo/chat-demo-data.ts`
> y no tiene tabla equivalente a `notificacion_lectura`».

**No la toqué**: es la descripción de una feature ya cerrada, o sea un registro histórico de
lo que se sabía al especificarla, del mismo tipo que `progress/` y `specs/`. Pero **la señalo
porque es la que más va a confundir**, ya que vive en el archivo de estado vivo y no en una
carpeta que grite «histórico».

Y está **doblemente caducada**, no solo por la ruta. Verifiqué la afirmación de fondo:

- `git grep "sinLeer"` en todo `app/(app)/mis-asignaciones/` → **sin resultados**.
- El contador de no-leídos hardcodeado **ya no existe**; la cabecera del propio archivo dice
  «Ya NO hay datos quemados».

Lo mismo vale para `specs/161-tono-notificacion/design.md`, que cita
`chat-demo-data.ts:51,119,124,150,157,171`: el archivo tiene **88 líneas**, así que esas
referencias a las líneas 119–171 ya no apuntaban a nada antes de este cambio.

### 6.2 Nota sobre el recuento

Esta bitácora, al estar en `progress/` y tener que nombrar lo que se renombró, **añade sus
propias menciones** de la cadena. Es inevitable y es histórico por definición. El número que
importa —**el de código, tests y `docs/`: cero**— no cambia.

---

## 7. Qué queda SIN CUBRIR

1. **`feature_list.json` (feature 161) sigue con la ruta vieja y una afirmación falsa.** No
   es solo el path: el «DATO QUEMADO» que describe ya no existe (§6.1). Quien lea esa ficha
   para retomar el hilo del contador de no-leídos partirá de una premisa muerta. **Necesita
   decisión humana**, porque tocar la descripción de una feature `done` es reescribir un
   registro.
2. **`specs/161-tono-notificacion/design.md` cita líneas que ya no existen** (119–171 sobre
   un archivo de 88). Histórico, no se toca, pero es una pista falsa para quien lo lea.
3. **Nada garantiza que el nombre no vuelva a mentir.** Este chore arregla el caso concreto;
   no hay guardia que impida que mañana aparezca otra carpeta `*-demo/` o `*-mock/` con
   código vivo dentro. Se podría censar por nombre en una guardia, pero **eso es una feature
   aparte y excede el encargo** — lo dejo anotado, no implementado.
4. **Sin verificación de runtime.** El chat no se abrió en un navegador. La cobertura es
   `typecheck` (resuelve los cinco imports) + el test de `nombrePlantilla` + las guardias. Un
   renombrado puro no debería necesitar más, pero **no es lo mismo que haberlo visto andar**.
5. **`./init.sh` completo no se corrió aquí**: por instrucción lo corre el humano antes del
   PR. Lo que se pasó fue el `--rapido`.

## 8. Defectos encontrados y NO arreglados

Ninguno de comportamiento. Lo único que apareció es documentación caducada (§7.1 y §7.2), y
se queda anotada, no corregida: el encargo era renombrar y corregir comentarios, y reescribir
registros históricos habría sido salirse.

## 9. Commits

1. `refactor(chat)` — renombrado (`git mv`) + los cinco consumidores. 7 archivos.
2. `docs(chat)` — el comentario de `RepartoModule.tsx:587`. 1 archivo, solo comentarios.

Los dos mensajes explican **por qué**, con el PR #312 del mismo día como precedente de que el
criterio «lo `demo` es desechable» se aplica de verdad.
