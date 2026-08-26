# Feature 285 — Diseño técnico

> Requisitos: `requirements.md`. Contexto vivo: `lib/types/plantilla-datos.ts` (catálogo
> `CAMPOS_PLANTILLA`, 44 claves), `lib/utils/plantilla-mensaje.ts`,
> `lib/utils/whatsapp-template.ts`, `lib/services/PlantillaMensajeService.ts`.
>
> **Revisión humana 2026-08-26.** Se confirman: persistir el mapa `clave -> nombre` en
> `variables_nombres JSONB` (§2) y el rechazo del textarea WYSIWYG (§8). Se incorporan: la
> vista previa con valores de ejemplo por el motor de producción (§5.2), el aviso de claves
> no reemplazables (§5.4) y la ocultación de alias con `aliasDe` (§5.5).

---

## 0. El problema en una frase

Hoy el maestro **inventa** claves (`VariablesInsert` acepta cualquier `[a-z0-9_]+`), así que
puede escribir `{{sucursal}}`, guardarla, mandarla a Meta y descubrir en el primer envío que
esa clave no existe en el resolutor y llega un hueco al cliente. El catálogo ya arregla la
mitad del problema (resuelve por clave y describe cada campo); falta que la UI **solo deje
elegir de ahí**, que **avise** cuando el cuerpo tiene una clave que no se va a reemplazar, y
que la plantilla siga siendo legible dentro de un año.

---

## 1. Lo que NO se toca (invariantes, con su porqué)

| Invariante | Por qué no se toca |
| --- | --- |
| El **cuerpo persistido** sigue siendo `{{clave}}` | Es el único texto que Meta tiene aprobado, vía `cuerpoANumerado`. Cambiar su forma obligaría a reenviar a revisión TODAS las plantillas aprobadas. |
| `variables` sigue siendo **derivado del cuerpo**, dedup, en orden de aparición | Su posición **es** el número de parámetro de Meta (`whatsapp-template.ts` §cabecera). Reordenar = mandar el monto donde va el nombre. |
| `validarCuerpo` sigue siendo la **única** puerta que rechaza | Se sigue rechazando `{{a b}}`, `{{}}`, `{{á}}`, y se sigue **aceptando** cualquier clave bien formada (Decisión humana 4 de la feature 107; hay cuerpos vivos con claves fuera del catálogo). Esta feature restringe la **UI** y **avisa**; no endurece el validador. |
| Guard de rol | `ALLOWED_ROLES = {maestro}` en `PlantillaMensajeService`, sin cambios. |
| Resolución al rellenar | `resolverValoresPlantilla(variables, datos)` + `renderPlantilla`, ya compartidos por chat y wa.me. Sin cambios de contrato. |

**Consecuencia dura:** todo lo que el maestro *ve* —etiquetas, vista previa, avisos— es capa
de **presentación derivada**. No existe ninguna transformación inversa (nombre→clave, valor→
clave) en el camino de guardado, así que la presentación no puede corromper el cuerpo.

---

## 2. La decisión que había que cerrar: ¿el nombre se PERSISTE o se DERIVA?

### Decisión (confirmada por el humano): **se persiste**, como mapa `clave -> nombre`.

Un `jsonb` en `plantilla_mensaje`, escrito por el service en cada `crear`/`actualizar` a
partir del catálogo vigente **en ese momento**. Es un *snapshot*, no una fuente de verdad.

**Por qué persistir:**

1. **El catálogo es código; la plantilla es un dato con vida propia.** Una plantilla aprobada
   por Meta no se puede editar en caliente sin volver a revisión, así que sobrevive a varias
   versiones del catálogo. El día que alguien borre o renombre una fila de `CAMPOS_PLANTILLA`,
   la plantilla seguirá diciendo `{{orden_id}}` y, sin snapshot, el maestro vería la clave
   cruda justo en la pantalla donde tiene que decidir si el texto aprobado sigue valiendo.
2. **Detectar la deriva en vez de sufrirla.** El snapshot es lo que permite distinguir «clave
   que ERA del catálogo y alguien retiró» de «clave que nunca fue válida» — la distinción que
   pide R16 y que sin persistencia es literalmente indecidible.
3. **Es lo que pidió el humano**, literal: «al guardar se debe almacenar el nombre y la key».
4. **Coste real bajo:** migración aditiva con default, sin backfill, sin índice, sin tocar RLS
   y —crucial— **una columna que ningún camino de envío lee**.

**Alternativa descartada (b): derivar el nombre del catálogo al pintar.** Cero migración y
coherencia automática. Se descarta porque su único modo de fallo es exactamente el caso que
importa: una clave que sale del catálogo deja la plantilla ilegible sin avisar y sin poder
distinguirse del legado. Además, derivar significa que renombrar una etiqueta en código
**reescribe retroactivamente** lo que dice una plantilla ya aprobada por Meta, sin traza. La
derivación **no muere**: queda como *fallback* (R21) para las filas anteriores a esta feature.

**Alternativa descartada (c): meter los pares en el propio array `variables`**
(`"monto|Monto a cobrar"` o un array de objetos). La más barata en migración y la peor
posible: `variables` es el array cuya **posición** define el parámetro de Meta y lo leen
`cuerpoANumerado` y `construirComponentsEnvio`. Contaminarlo con presentación pone la
legibilidad de la UI y la corrección del envío en la misma estructura.

**Alternativa descartada (d): dos arrays paralelos** (`variables` + `variables_nombres` como
`text[]`, misma longitud y orden). Tipa mejor que `jsonb` (Prisma `String[]` vs `JsonValue`)
y calca el estilo de la columna existente. Se descarta porque acopla la etiqueta a la
**posición**: una escritura futura que actualice `variables` sin actualizar el otro array
desplaza todas las etiquetas y produce una plantilla que *parece* correcta. Un mapa por clave
no tiene ese modo de fallo. El coste es un `cast` en el repositorio.

---

## 3. Modelo de datos

### 3.1 Prisma (`db/schema.prisma`, modelo `PlantillaMensaje`)

```prisma
  /// Snapshot `clave -> nombre legible` tomado del catálogo (`CAMPOS_PLANTILLA`) en el
  /// último guardado. Es PRESENTACIÓN: ningún camino de envío lo lee. `{}` = fila anterior
  /// a la feature 285 (se deriva del catálogo al pintar, R21), NUNCA null.
  variablesNombres Json @default("{}") @map("variables_nombres")
```

Invariantes de la columna, escritos aquí para que el reviewer los pueda comprobar:
- Nunca `null` (`NOT NULL DEFAULT '{}'`).
- Sus claves son **subconjunto** de `variables` (una clave fuera del catálogo no entra, R20).
- Su contenido **no influye** en `cuerpo`, `variables`, ni en nada que viaje a Meta.

### 3.2 Migración

`db/migrations/<timestamp>_plantilla_variables_nombres/`

`migration.sql` (UP), aditiva y sin backfill:
```sql
ALTER TABLE "plantilla_mensaje"
  ADD COLUMN "variables_nombres" JSONB NOT NULL DEFAULT '{}';
```

`down.sql` (DOWN) — **exactamente** esa columna y nada más (la tabla y el enum los creó
`*_plantilla_mensaje`; revertirlos aquí sería destruir lo que esta migración no creó):
```sql
ALTER TABLE "plantilla_mensaje" DROP COLUMN "variables_nombres";
```

**RLS:** no se crea tabla nueva; las políticas de `plantilla_mensaje` no cambian y la columna
hereda su alcance. El control de acceso real del módulo sigue siendo el guard de rol.

**Backfill:** ninguno. Deliberado: rellenar hoy con el catálogo actual falsificaría un
snapshot que nunca se tomó, y borraría la distinción de R16. Las filas viejas quedan en `{}`
y caen al fallback (R21); la primera edición de cada plantilla las sella con nombres reales.

---

## 4. Capas y contratos

### 4.1 Datos de ejemplo: `DATOS_PLANTILLA_EJEMPLO`

Constante nueva en `lib/types/plantilla-datos.ts`, junto al catálogo:

```ts
/** Un `DatosPlantilla` completo y CRUDO cuya resolución produce, campo a campo, el
 *  `ejemplo` que cada entrada del catálogo declara. Ver el test de coherencia (R12). */
export const DATOS_PLANTILLA_EJEMPLO: DatosPlantilla;
```

**Crudo, no formateado.** Lleva `montoCobrar: 12500`, `fechaReparto: new Date(...)`,
`peso: 1.5`, `latitud/longitud`, `numGuia: 10432`, `negocio.urlBase: "https://ordenex.co"`…
No lleva las cadenas `"₡12.500"` ni `"1.5 kg"`. Ese es el punto: los datos de ejemplo entran
por `leer()` y salen por `transform()`, **el mismo par que usa el envío real**. Si los datos
ya vinieran formateados, la vista previa sería una maqueta que no ejercita el formateador.

**El pegamento que impide la deriva (R12):** un test recorre `CAMPOS_PLANTILLA` y exige
`valorDeCampo(campo.clave, DATOS_PLANTILLA_EJEMPLO) === campo.ejemplo` para las 44 entradas.
Así, el campo `ejemplo` (documentación) y el fixture (comportamiento) no pueden divergir:
añadir una fila al catálogo sin extender el fixture pone la suite roja.

> **Aviso al implementer:** ese test puede nacer rojo en 2–3 claves (`estatus`, `url_guia`,
> `mapa`, `fecha_*`) porque los `ejemplo` actuales se escribieron a mano. La corrección es
> **alinear** —ajustar el fixture o el `ejemplo` para que digan lo mismo—, nunca aflojar la
> aserción a un `toContain`.

### 4.2 Utilidades puras (`lib/utils/plantilla-mensaje.ts`)

```ts
/** Snapshot `clave -> nombre` para las claves que HOY están en el catálogo. R17/R20. */
export function nombresDeVariables(variables: string[]): Record<string, string>;

/** Etiqueta a mostrar para una clave. Caídas: snapshot -> catálogo -> clave. R13/R21. */
export function etiquetaDeVariable(
  clave: string,
  nombresPersistidos: Record<string, string>,
): { texto: string; enCatalogo: boolean };

/** Claves del cuerpo que NO se van a reemplazar, con el aviso ya redactado. R15/R16. */
export function clavesSinCampo(
  cuerpo: string,
  nombresPersistidos: Record<string, string>,
): Array<{ clave: string; etiqueta: string; retirada: boolean }>;
```

`nombresDeVariables` **recorre `variables` en su orden y devuelve un objeto**: no puede
reordenar nada por construcción (R19).

`clavesSinCampo` es `extraerVariables(cuerpo)` filtrado por ausencia en
`CAMPOS_PLANTILLA_POR_CLAVE`. `retirada: true` cuando la clave SÍ tiene nombre en el snapshot
(estuvo en el catálogo y ya no está); `false` cuando no lo tiene (nunca fue válida). Esa
distinción es exacta porque el snapshot **solo** guarda nombres de claves del catálogo (§3.1).

### 4.3 La vista previa se hace con el motor de producción

`previewConEjemplos` se **reescribe** para ser, literalmente, el mismo par de llamadas que
hace el envío:

```ts
export function previewConEjemplos(cuerpo: string): string {
  return renderPlantilla(
    cuerpo,
    resolverValoresPlantilla(extraerVariables(cuerpo), DATOS_PLANTILLA_EJEMPLO),
  );
}
```

Compárese con `EnviarPlantillaWhatsappButton`:
`renderPlantilla(plantilla.cuerpo, resolverValoresPlantilla(plantilla.variables, datos))`.
**Misma forma, mismas dos funciones, distinto `datos`.** No hay un renderizador de preview.
Si mañana el envío cambia de motor y la preview no, deja de coincidir **en pantalla**, y el
maestro lo ve antes de mandar nada. Eso es lo que fija R11 y su test.

**Efecto colateral querido:** una clave fuera del catálogo resuelve a cadena vacía
(`valorDeCampo` devuelve `""`), así que la preview muestra **el hueco real** que le llegaría
al cliente, en vez del marcador `SUCURSAL` en mayúsculas que pintaba la versión anterior. El
marcador en mayúsculas de `renderPlantilla` sigue existiendo como red de seguridad para
llamadores que no resuelvan todas las claves, pero deja de ser alcanzable desde la preview.

> **Contradicción resuelta con la versión anterior del spec:** el antiguo R25 exigía
> «clave desconocida ⇒ marcador en mayúsculas» en la preview. Queda **derogado**: contradecía
> el objetivo de «Así lo verá el cliente». Lo que le llega al cliente es un hueco, y quien
> avisa de él es R15, no un marcador que el cliente nunca verá.

### 4.4 Muerte de `lib/types/plantilla-variables.ts`

El catálogo viejo (`PLANTILLA_VARIABLES = []`) **se borra**. Era una lista vacía que hacía una
versión pobre de esto mismo: `previewConEjemplos` pintaba TODA clave como marcador en
mayúsculas y `ejemploDe` mandaba `MONTO` a Meta como valor de ejemplo. Sus dos consumidores:

- `lib/utils/plantilla-mensaje.ts` → ya no lo importa (§4.3).
- `lib/utils/whatsapp-template.ts` → `ejemploDe` pasa a `EJEMPLOS_POR_CLAVE` de
  `plantilla-datos.ts`, cuyos valores son los mismos que la preview por R12.

**Efecto sobre Meta, acotado:** cambia el `example.body_text` de los `create/update` de
template **futuros** (`₡12.500` en vez de `MONTO`), no el `text` aprobado ni el orden de los
parámetros. Meta usa los ejemplos para revisar, no para enviar. Ninguna plantilla ya aprobada
se reenvía por este cambio.

### 4.5 Service (`lib/services/PlantillaMensajeService.ts`)

```
crear(input, actor):
  guard rol                          (sin cambios, R25)
  validado = validarCuerpo(cuerpo)   (sin cambios, R24)
  repo.create({ …, variables: validado.variables,
                 variablesNombres: nombresDeVariables(validado.variables) })   ← NUEVO
```
```
actualizar(id, input, actor):
  … si input.cuerpo !== undefined:
      data.cuerpo = input.cuerpo
      data.variables = validado.variables
      data.variablesNombres = nombresDeVariables(validado.variables)           ← NUEVO
```

`preview(cuerpo, actor)` **no cambia de contrato**: sigue con su guard, su `validarCuerpo` y
su `previewConEjemplos`; lo que cambia es lo que esa función devuelve (§4.3).

**El snapshot lo calcula el servidor, no lo manda el cliente.** Es la decisión que evita
tocar el borde: `crearPlantillaSchema`/`actualizarPlantillaSchema` **no cambian**, no hay
entrada externa nueva que validar con zod, y un cliente no puede inyectar etiquetas
arbitrarias en la base. Además garantiza que el snapshot sale del mismo catálogo que la UI
acaba de mostrar (mismo módulo, mismo deploy).

### 4.6 Repositorio e interfaces

- `CreatePlantillaData` y `UpdatePlantillaData` ganan `variablesNombres?: Record<string,string>`.
- `PlantillaPublica` y `PlantillaListItem` ganan `variablesNombres: Record<string,string>`.
- `PlantillaEnviable` y `PlantillaTextoEnviable` **NO lo ganan**: el envío resuelve por clave
  y no tiene nada que hacer con las etiquetas. Mantenerlas fuera es la garantía estructural de
  que esta columna no puede afectar a Meta.
- El repositorio normaliza el `JsonValue` de Prisma con un lector defensivo (objeto plano
  `string -> string`; cualquier otra cosa ⇒ `{}`), sin `any`.

### 4.7 Rutas / endpoints

**Ninguno nuevo.** Se siguen usando las Server Actions existentes de `lib/actions/plantillas.ts`
(`crearPlantilla`, `actualizarPlantilla`, `previewPlantilla`), como manda
`docs/architecture.md` para mutaciones internas. El catálogo se importa directamente en el
Client Component: es una constante de código, no un dato de base.

---

## 5. UI

### 5.1 Componente nuevo: `CampoVariablePicker.tsx`

Ubicación: `app/(app)/configuracion/plantillas/_components/CampoVariablePicker.tsx`. Vive
junto a la página y **no** en `components/shared/`: un solo consumidor (regla «sin
sobre-ingeniería» de `docs/architecture.md`).

```ts
interface CampoVariablePickerProps {
  /** Se dispara con la CLAVE del catálogo elegida. El anfitrión decide dónde insertarla. */
  onSeleccionar: (clave: string) => void;
  /** Catálogo inyectable para test; por defecto CAMPOS_PLANTILLA sin alias. */
  campos?: CampoPlantilla[];
}
```

Cada opción pinta **nombre** en negrita, **descripción** debajo, la clave en tono tenue y, si
`sensible`, un `Badge` distintivo (R9). Filtro por `nombre + descripcion + clave` con
normalización `toLocaleLowerCase()` + `normalize("NFD")` sin diacríticos (R3). Sin resultados
⇒ fila de vacío (R6). Al elegir: `onSeleccionar(clave)`, filtro a cero, lista cerrada (R8).

**Accesibilidad (R29/R30):** patrón combobox a mano, sin dependencia nueva: `role="combobox"`
+ `aria-expanded` + `aria-controls` en el input; `role="listbox"` en la lista, `role="option"`
+ `aria-selected` por fila; `aria-activedescendant` a la opción activa; teclado
`ArrowDown`/`ArrowUp`/`Enter`/`Escape`. El nombre accesible sale de un `<span>` visible
referenciado por `aria-labelledby` —el patrón que ya usa `VariablesInsert`— y **no** de un
`aria-label`: en este repo ya nos mordió que el texto visible gana sobre `aria-label`.

**Por qué a mano y no `shadcn/ui Command`:** `components/ui/` no tiene `command` ni `popover`;
añadirlo arrastra `cmdk` + `@radix-ui/react-popover` para una lista filtrable de 39 elementos
en una sola pantalla de configuración. Si el patrón aparece en una segunda feature, se promueve.

### 5.2 El panel «Así lo verá el cliente»

Sustituye al viejo botón manual de vista previa como elemento principal del bloque. Muestra
el cuerpo resuelto con `DATOS_PLANTILLA_EJEMPLO`:

```
Así lo verá el cliente
┌──────────────────────────────────────────────────────────────┐
│ Hola María Rodríguez, tu pedido de Boutique Luna llega hoy.   │
│ Total a pagar: ₡12.500                                        │
└──────────────────────────────────────────────────────────────┘
3 campos: Cliente · Tienda · Monto a cobrar
```

**Cómo se calcula (decisión con consecuencias, léase entera).** El panel se actualiza tras
cada cambio del cuerpo (R10) llamando a la Server Action `previewPlantilla` con **debounce de
300 ms** y descarte de respuestas fuera de orden (se guarda el cuerpo solicitado y solo se
aplica la respuesta si sigue siendo el cuerpo actual).

*Alternativa descartada: calcularlo en el cliente* llamando directamente a
`previewConEjemplos` (todo es client-safe, sería instantáneo y sin carreras). Se descarta por
una razón concreta y verificada, no estética: `tests/unit/guards/superficie-de-uso.guardia.test.ts`
tiene un **CONTROL POSITIVO hard-codeado** que exige que `previewPlantilla` siga siendo
alcanzable desde `app/(app)/configuracion/plantillas/_components/VariablesInsert.tsx` —es uno
de los cinco falsos positivos con los que se calibró la guardia—. Dejar la acción sin
consumidor pondría esa guardia roja, y «arreglarla» editando su control positivo para que una
pantalla vaya más fluida es exactamente el movimiento que el arnés existe para impedir.
Además el camino por servidor tiene valor propio: lo que el maestro lee lo produjo el mismo
código desplegado que arma el envío, no una copia del navegador.
*Si el reviewer prefiere el cálculo en cliente, la retirada de `previewPlantilla` y el
re-baseline del control positivo tienen que ir razonados en el MISMO PR, no después.*

`service.preview` sigue devolviendo `validation_error` ante una llave malformada, así que el
panel sigue mostrando el mensaje de error que ya muestra hoy en ese caso.

### 5.3 Línea de campos usados

Debajo del panel, en una sola línea, derivada de `extraerVariables(value)` y etiquetada con
`etiquetaDeVariable` (R13/R14). Cada campo sigue siendo clicable para reinsertar su
`{{clave}}` en el cursor (uso frecuente: repetir una variable ya usada). Deja de ser el
elemento principal del bloque: explica la **estructura**, y la estructura es lo secundario.

### 5.4 Aviso de claves que no se van a reemplazar (R15/R16)

Bajo la línea de campos, un `role="alert"` por cada entrada de `clavesSinCampo(...)`:

- sin nombre persistido → «`{{sucursal}}` no es un campo válido y llegará vacío al cliente»;
- con nombre persistido → «`{{sucursal}}` («Sucursal») ya no existe en el catálogo y llegará
  vacío al cliente».

**AVISA, NO BLOQUEA**, y el porqué queda escrito: hay plantillas vivas con claves fuera del
catálogo, el modelo de `validarCuerpo` es abierto por Decisión humana 4 de la feature 107, y
bloquear el guardado las dejaría **sin poder editarse nunca más** —incluida la edición cuyo
propósito fuese justamente quitar la clave rota—. El botón de guardar no se deshabilita y la
Server Action no gana ninguna validación nueva (R24).

**Por qué se distinguen los dos mensajes** (la interacción con R21 que el humano pidió
resolver): «retirada del catálogo» y «nunca válida» piden acciones distintas del maestro. La
primera es un cambio de la app: el campo existía, alguien lo quitó, y el texto de la plantilla
—posiblemente ya aprobado por Meta— hay que revisarlo con esa historia en la mano. La segunda
es un error de tecleo del propio maestro. Que el snapshot **solo** guarde nombres de claves
del catálogo es lo que hace la distinción decidible; sin persistir el nombre (alternativa (b)
de §2) los dos casos serían indistinguibles y el aviso tendría que ser genérico.

### 5.5 Alias: `aliasDe` en el catálogo

Los 5 alias (`num_guia`, `nombre`, `destinatario`, `num_remision`, `total`) se **ocultan del
selector** (R4) y siguen siendo válidos en todo lo demás (R5).

Para saber cuál es alias **no se filtra por texto**: hoy se distinguen porque `alias()` añade
« (alias de {{guia}})» al `nombre`, y colgar el comportamiento de una subcadena de una
etiqueta de UI es frágil (se rompe con una traducción o con una coma). Se añade un campo
declarativo a `CampoPlantilla`:

```ts
  /** Clave del campo BASE si esta entrada es un alias del mismo dato. `undefined` = campo propio. */
  aliasDe?: string;
```

`alias(base, clave, nombre)` pasa a fijar `aliasDe: base.clave` y a dejar el `nombre`
**limpio** («Número de guía», sin el paréntesis), que es lo que se pinta en la línea de campos
usados. El selector consume `CAMPOS_PLANTILLA.filter((c) => c.aliasDe === undefined)`.

Efecto secundario a vigilar: al limpiar el `nombre`, `num_guia` y `guia` pasan a mostrar la
misma etiqueta en la línea de campos usados. Es aceptable —son el mismo dato— y ya no hay
ambigüedad de selección porque el selector solo ofrece uno de los dos.

### 5.6 `VariablesInsert.tsx` — reemplazo

- **Fuera:** `Input` de clave libre, `normalizarClave`, botón «Añadir», estado `variables`
  como lista editable, botón «x» de quitar, botón manual de «Vista previa». El estado editable
  era una lista **paralela** al cuerpo que podía divergir de él.
- **Dentro:** `CampoVariablePicker` + `insertarPlaceholder` (helper puro **conservado tal
  cual**, con sus tests) + panel «Así lo verá el cliente» (§5.2) + línea de campos usados
  (§5.3) + avisos (§5.4).
- Prop nueva: `variablesNombres?: Record<string,string>` (por defecto `{}`). La pasa
  `EditarPlantillaForm`; en `CrearPlantillaForm` va vacía.
- Se **conserva** la prop `previewAction = previewPlantilla` con su valor por defecto: es el
  uso por referencia que la guardia de superficie tiene calibrado (§5.2) y el punto de
  inyección que ya usan los tests.

**El `<textarea>` del cuerpo no cambia**: texto plano con `{{clave}}`, fuente de verdad (R18).

### 5.7 Formularios

`CrearPlantillaForm.tsx` y `EditarPlantillaForm.tsx`: solo pasan la prop nueva. Su lógica de
submit, sus schemas y su manejo de `fieldErrors` no cambian.

---

## 6. Rellenado (parte E de los requisitos)

**No hay código nuevo.** `EnviarPlantillaWhatsappButton` y `ChatConversacion` ya hacen
`renderPlantilla(cuerpo, resolverValoresPlantilla(variables, datos))`, y el envío server-side
usa el mismo par. Lo que esta feature aporta es **cobertura**: R26–R28 fijan por test que el
mensajero ve el texto relleno y que coincide con lo que se envía/persiste, para que un cambio
futuro en la capa de presentación no pueda filtrar una clave cruda a esa pantalla.

Se documenta la asimetría ya existente y **no** se cambia: la vista previa del mensajero arma
`DatosPlantilla` desde `MiAsignacionDTO`, que no trae fechas ni datos del mensajero, así que
esas claves salen vacías en el composer y llenas en el mensaje real. Está declarado en
`whatsapp-envio-valores.ts` y arreglarlo es otra feature. Nótese que la vista previa del
**editor** (R10) no tiene esa asimetría: `DATOS_PLANTILLA_EJEMPLO` es completo por R12.

---

## 7. Alternativa mayor descartada: textarea WYSIWYG con fichas

*(Confirmada por el humano el 2026-08-26.)* Sustituir el `<textarea>` por un editor
`contenteditable` donde `{{monto}}` se pinte como una ficha «Monto a cobrar», traduciendo
fichas→claves al guardar. Descartada por tres razones:

1. **Pone la presentación en el camino de guardado.** Cualquier bug del serializador (nombres
   con paréntesis, dos alias con la misma etiqueta, un pegado desde Word) escribe un cuerpo
   distinto del que el maestro creía. Ese cuerpo es el que Meta aprueba.
2. **El fallo es indetectable a tiempo.** Un cuerpo mal serializado pasa `validarCuerpo` si la
   forma es válida; el síntoma aparece en el WhatsApp de un cliente final.
3. **Coste desproporcionado**: selección parcial de una ficha, undo/redo, IME, móvil,
   accesibilidad de un `contenteditable`.

Y, sobre todo, resolvía el problema equivocado: la ficha muestra la **etiqueta**, y el maestro
no necesita leer «Cliente» sino «María Rodríguez». El panel de §5.2 entrega eso con dos
llamadas a funciones que ya existen.

---

## 8. Riesgos y mitigaciones

| Riesgo | Mitigación |
| --- | --- |
| El catálogo (`plantilla-datos.ts`) **sigue sin commitear** en el árbol de trabajo | T0 es bloqueante: si no está en la rama base, la feature se para; no se recrea el catálogo desde el árbol sucio. |
| El test de coherencia de R12 nace rojo en algunas claves | Es el objetivo del test. Se alinea fixture o `ejemplo`; **prohibido** aflojar la aserción (§4.1). |
| Tocar `alias()` cambia el `nombre` de 5 entradas | `tests/unit/types/plantilla-datos.test.ts` puede afirmar sobre esas cadenas: hay una task explícita para actualizarlo, no un descubrimiento en el gate. |
| Borrar `plantilla-variables.ts` roza la guardia de superficie | Task dedicada (T6). La guardia **no** se afloja: si algo sale huérfano, se retira de verdad o se conecta de verdad. |
| Retirar el botón «Vista previa» deja `previewPlantilla` sin consumidor | No se retira su uso: el panel llama a la acción (§5.2). El control positivo de la guardia sigue verde sin tocarla. |
| Cambiar `ejemploDe` altera el payload a Meta | Solo `example.body_text` de creaciones/actualizaciones futuras. No se reenvía nada (§4.4). |
| Una llamada a la acción por pausa de tecleo | Debounce 300 ms + descarte fuera de orden; pantalla de configuración, un solo rol, sin acceso a base en `preview`. |
| El campo nuevo se cuela en la descarga del dataset | Decisión: **no** se añade columna a la descarga; `tests/unit/descarga/plantillas-descarga-columnas.test.ts` la congela. Task de verificación. |
| Restringir el selector quita expresividad al maestro | Es el objetivo, y la válvula sigue abierta: el textarea admite escribir `{{lo_que_sea}}`, `validarCuerpo` lo acepta y ahora además **avisa** (R15). |
| `Json` de Prisma tipado como `JsonValue` | Lector defensivo en el repositorio, sin `any`, con test del caso «valor no-objeto en la columna». |
