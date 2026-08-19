# Revisión — Feature 235 · Ayuda a la tienda: estatus propio y el viaje de ida y vuelta

> Rama `feature/235-ayuda-tienda-estatus`, commit **29310f74**, base `origin/dev` = **5f35963f**.
> Material leído: `specs/235-ayuda-tienda-estatus/{requirements,design,tasks}.md` (46 R, T0-T8),
> `progress/impl_235.md`, `progress/auditoria_ayuda_tienda.md`, `progress/design_pila_ayuda_tienda.md`,
> `specs/239-devolucion-espera-cierre/requirements.md`, `CLAUDE.md`, `DESIGN.md`, `CHECKPOINTS.md`,
> `docs/{architecture,conventions,verification}.md`.
>
> **Árbol medido antes y después de revisar: limpio.** Los hashes de los archivos que muté coinciden
> byte a byte con los del commit (tabla en §6).

---

## Veredicto

**RECHAZADO.** 4 bloqueantes, 9 menores.

El núcleo de la ficha está bien hecho y lo he verificado yo, no leído: el estatus, sus tres aristas,
el punto único de rescate, el retiro de la columna con las dos deudas de la 239 muertas, y la
excepción de webhook de P4 —que era lo más delicado— están implementados como se firmó y sus tests
**se saben poner rojos**. Lo que falla es el **barrido**: dos consultas que enumeran estados se
quedaron sin migrar, una superficie del hilo se entregó a medias, y la lista de tareas no está
cerrada.

---

## 1 · Checklist de CHECKPOINTS.md, punto por punto

### Especificación
- [x] `requirements.md` con requisitos EARS numerados R1-R46. Puerta humana firmada al final (2026-08-19).
- [x] `design.md` con alternativas descartadas y su porqué (el `in` unificado del corte, la excepción
      de webhook por estado, la ventana simétrica, colapsar `novedadWhere` a un `in`).
- [ ] **`tasks.md` con todas las tasks marcadas `[x]` → NO.** 0 de 39 marcadas. Ver **B4**.

### Trazabilidad
- [~] Cada `R<n>` mapea a al menos un test concreto → **45 de 46**. R35 solo está cubierto para uno
      de los dos roles que nombra. Ver **B3**. Sin huérfanos ni fantasmas en el resto: comprobé la
      existencia y la ejecución de los casos nombrados en el §3 de la bitácora, no su cita.
- [x] `progress/impl_235.md` contiene el mapa `R<n> → test`.

### Calidad de código
- [x] `typecheck` 0 errores · `lint` 0 errores (92 warnings preexistentes, no son hallazgo).
- [x] `pnpm test`: 1190 archivos / 15420 tests verdes (medido por el leader; yo re-corrí 18 archivos
      relevantes y todos verdes en baseline).
- [n/a] E2E: este repo no tiene arnés de Playwright vivo. El sustituto declarado por el propio
      proceso —T8.1, «ver la app»— **no se hizo**. Ver **B4** y **m2**.

### Datos y seguridad (Supabase)
- [x] Tablas nuevas: **ninguna**. RLS nueva: ninguna que escribir. Se reutilizan `orden`,
      `order_status`, `orden_historial_estado` y `orden_nota`, todas con su RLS ya declarada.
- [x] Las tres migraciones tienen su `down.sql`; rollback probado contra el motor por el leader
      (aplicar → bajar → ver pendiente → volver a subir).
- [x] Ningún secreto hardcodeado. Ningún literal de país/moneda/cuenta añadido.
- [x] Webhooks: no hay webhook nuevo. Cambia la **decisión de emitir**, no el emisor: la clave de
      idempotencia (`dedupeKeyWebhookEstado`, con instante) y las firmas de `emitirWebhooksEstado`,
      `WebhookEmisor` y `emisorWebhookEstadoReal` quedan intactas, y `emitirBestEffort` no se tocó.

### Patrón de capas
- [x] Server Actions conservan firma y forma de resultado. Los tres bordes revalidan con zod.
- [x] `rescatarOrdenAyuda` es una función de módulo con dependencias por interfaz: sin Prisma, sin
      Next, sin HTTP. La guarda de estado vive en el punto único, no en los llamadores.
- [x] `OrdenRepository.transicionarAyuda` solo ejecuta la query + el append del choke point.
- [x] Interfaces en `lib/interfaces/`, separadas por categoría.

### Permisos
- [x] La puerta es la del hilo (`autorizarSobreHilo` + `estaEnVentanaDeEscritura`), reusada y no
      duplicada. P9 se cumple **por estrechamiento de la ventana**, no por un `if` suelto.
- [x] Mutaciones internas por Server Action.

### Multi-país / configuración
- [x] Sin hardcode de contexto.

### Verificación final
- [x] `./init.sh` verde (leader, árbol quieto).
- [ ] Este archivo existe; su veredicto **no** es OK.
- [ ] Entrada en `progress/history.md`: pendiente (cierre del leader).

---

## 2 · Los cinco puntos que el leader pidió mirar

### (1) ¿Sale la orden de verdad de todas partes? — **NO: dos superficies sin migrar**

Lo que **sí** sale, verificado en el código y no en la bitácora:

| Superficie | Cómo sale | Dónde lo comprobé |
| --- | --- | --- |
| Optimizador de ruta | `findParadasEnReparto` acota por **igualdad** a `en_reparto` | `OrdenRepository`; el test aplica el predicado a filas, no solo a su forma |
| Mapa y `paradasSinOptimizar` | derivan de `porGestionar`, que ya no la trae | `MisAsignacionesService:227`, `RepartoModule:225` |
| Gestión | `ORIGEN_GESTION` sigue siendo `en_reparto`, así que `cargarOrdenGestionable` la rechaza sola | R16 ×2 |
| Asignación / ruteo / recolección de la ORDEN | `reasignables` acota a `en_bodega_central`; el grafo no da salida | R17(a)/(b) |
| Listado del portal | corte en el **servidor**, tres grupos | R18 |
| Bodega satélite, tablero del día, exclude-por-rol, webhook | mapas parciales, con la ausencia razonada en el archivo y afirmada con caso negativo | R37/R45 |
| Chat | **se conserva a propósito** (P8), con su test | `235/P8` |

Lo que **no** sale: **B1** y **B2**.

### (2) P4, la excepción del webhook — **CORRECTA, y su test se sabe poner rojo**

Está por **familia de origen** (`ORIGENES_SIN_EVENTO_PUBLICO = ["rescate_ayuda_tienda"]`), nunca por
estado destino. Lo medí yo, en las dos direcciones del riesgo:

- **Mutación A** — la lista gana `"liberacion_reprogramada"` → **3 rojos**, entre ellos
  `MISMA orden, MISMO estado destino, OTRA familia: liberacion_reprogramada SI encola`.
- **Mutación B** — la excepción se reimplementa **por estado destino**
  (`esEventoPublico(estado) && estado !== "en_reparto"`) → **7 rojos**, incluidos los cuatro
  `REINGRESO LEGITIMO a en_reparto via %s: SIGUE emitiendo` (`liberacion_reprogramada`,
  `deshacer_gestion`, `recoleccion`, `gestion`).

Las tres condiciones de la firma se cumplen. La regresión que la firma prohibía —una reprogramada
liberada que deja de avisar— está vigilada por un test que **cae**. No hay que reabrir P4.

### (3) El bloqueo del cierre — **explícito, y las dos exenciones son deliberadas**

- `ESTADOS_PENDIENTES = ["por_recoger", "en_reparto", "ayuda_tienda"]`, con el comentario que dice
  por qué (hasta ayer funcionaba por accidente). **Mutación C** (quitar `"ayuda_tienda"`) → 2 rojos,
  incluido `R23: la lista de estados pendientes NOMBRA ayuda_tienda`, que la fija por `toEqual`
  leído de la llamada real al repo y no de una copia importada.
- **Mutación D** (aplicar la precondición de pendientes antes de las dos ramas de re-solicitud) →
  **4 rojos**: los dos casos nuevos de R24 **y** los dos históricos del anti-deadlock (`111/R9`,
  `109/R28`). Las dos rutas exentas (`vencido → solicitado` y `rechazado → solicitado`) siguen
  exentas **a propósito**, y quien las «arregle» por simetría se estrella contra cuatro tests.
- La consecuencia para la 237 está escrita en la bitácora §7 y en `design_pila_ayuda_tienda.md`.
  Como indicó el leader, **no la cuento como defecto de esta ficha**.

⚠️ El caso `R22` en sí **no prueba lo que dice** (ver **m1**), pero R22 queda cubierto por el par
R23 + comportamiento heredado.

### (4) Las dos deudas de la 239 — **muertas, las dos**

- **El tapón de `novedadWhere`**: el `OR` son hoy **dos igualdades de estado**
  (`{ estatus: { value: ESTATUS_DEVUELTA } }` y `{ estatus: { value: ESTATUS_AYUDA } }`), sin
  ninguna marca al lado. La forma `OR` se conserva a propósito porque la guardia
  `hilo-ventana-alcanzable` la lee del texto fuente, y eso está escrito ahí mismo.
  **Mutación E** (borrar la rama de ayuda) → **9 rojos**.
- **El tercer parámetro de `estaEnVentanaDeEscritura`**: la firma es
  `(rol: RolConHilo, estatusValue: string)`. `VENTANA_ESCRITURA` pasó de un valor por rol a una lista
  por rol. **Mutación F** (quitar `ayuda_tienda` de la ventana del mensajero) → **4 rojos**, incluido
  `235/R34: ayuda_tienda es el ÚNICO estado en el que los dos roles pueden escribir`.
- `specs/239-devolucion-espera-cierre/requirements.md` lleva su acta de defunción fechada.

### (5) Tests que pasan sin comprobar nada

Encontré **dos**, y uno es la mitad del bloqueante B1:

- `235/R26: un mensajero cuyo dia entero acabo EN AYUDA genera igual su cierre vencido`
  (`tests/unit/repositories/cierre-dia-repository.test.ts`) — afirma la propiedad **un nivel por
  debajo de donde falla**: llama a `crearCierre` directamente, y en producción a ese mensajero
  **nunca se le llama a `crearCierre`**. Ver **B1**.
- `R22: con una orden en ayuda_tienda, solicitarCierre devuelve conflict...` — ver **m1**.

El resto de lo que muestreé sí comprueba algo: los casos de R14(a) aplican el predicado a filas en
vez de afirmar solo su forma; la guardia de la columna retirada trae **autocomprobación** con 6
positivos sintéticos, 4 falsos positivos y un anti-vacuidad (`> 500 archivos censados`); el test de
migración del enum **re-verifica** el censo de índices en vez de citar el de la 239.

---

## 3 · Hallazgos bloqueantes

### BLOQUEANTE B1 — El corte de la noche **no llega** a la orden en ayuda: la selección de mensajeros se quedó sin migrar

`lib/repositories/CorteDiarioRepository.ts:46-55`, rama (b) de
`findMensajerosConActividadSinCierre` — **archivo no tocado por esta ficha**:

```ts
const enReparto = await this.prisma.orden.findMany({
  where: {
    deletedAt: null,
    estatus: { value: ESTADO_EN_REPARTO },
    mensajeroAsignadoId: { not: null },
  },
  ...
```

`CorteDiarioService.ejecutarCorte` itera **exactamente** esa lista. Un mensajero que termina el día
con todas sus órdenes en `ayuda_tienda` y sin gestiones sin cerrar —recoge una guía, pide ayuda, se
va a casa; pedir ayuda no crea `gestion_orden`— **no entra ni en (a) ni en (b)**: no se le crea el
`vencido` y su orden no se barre nunca.

- **Es una regresión introducida por esta ficha.** Antes del cambio la orden seguía en `en_reparto`
  con `ayuda = true`, así que la rama (b) la pescaba y el corte hacía su trabajo.
- **Contradice el design §7**, que afirma con estas palabras: «un mensajero cuyo día entero acabó en
  ayuda **sí** genera su cierre `vencido`, que es lo que R26 pide». Es falso a nivel de sistema: es
  cierto de `crearCierre` hacia dentro y falso desde la selección hacia fuera.
- **R26 no se cumple** justo en el caso que la propia ficha eligió como ejemplo, y R29 tampoco se
  alcanza para esas órdenes, porque el corte no ocurre.
- **Ningún test lo cubre.** `tests/unit/repositories/corte-diario-repository.test.ts` no aparece en
  el diff del commit y sigue afirmando `estatus: { value: "en_reparto" }`. El test que suena a que
  lo cubre invoca `crearCierre` a mano y por eso pasa.

**Qué falta para cumplirlo:** ampliar la rama (b) a los dos estatus (unión, no sustitución), con su
caso en `corte-diario-repository.test.ts` y una mutación que lo mate; y bajar de nivel —o duplicar—
la aserción de «día entero en ayuda» para que ejercite la **selección**, no solo la escritura.

---

### BLOQUEANTE B2 — La regla de dedicación de la 157 dejó de ver la carga que va en ayuda

`lib/services/GuiaAsignacionService.ts:93`, tampoco tocado por esta ficha:

```ts
const ESTADOS_REPARTO_PENDIENTE = ["por_recoger", "en_reparto"];
```

Se consume en `asignarRecoleccionTienda` (`:456-459`) para rechazar con `MSG_MENSAJERO_CON_REPARTO`,
y su gemelo de interfaz vive en `lib/actions/ordenes-guia.ts:192` (`conRepartoIds`), que es lo que
deshabilita al mensajero en el selector del maestro.

Una orden en `ayuda_tienda` **ya no cuenta como carga**. El resultado: un mensajero que lleva el
paquete encima —y el estatus significa literalmente eso (R1: «el paquete sigue con él, en la
calle»)— pasa a leerse como «sin carga» y **se le puede mandar a recolectar a una tienda**, contra
la regla que el humano firmó el 2026-07-31 y que el propio archivo explica: «quien va a una tienda a
recoger un lote sale con el vehículo vacío y vuelve a la central».

- La barrida de T3.4 (R17) miró los **listados que ofrecen órdenes**, no las listas que describen la
  **ocupación del mensajero**. Es la misma clase de agujero que la ficha vino a cerrar, en otra
  columna del mapa.
- Ningún test lo cubre; `GuiaAsignacionService` no aparece en el diff.

**Qué falta:** decidir explícitamente si `ayuda_tienda` ocupa al mensajero —mi lectura del requisito
y del comentario del archivo dice que sí—, tocar la lista y el marcador del selector, y afirmarlo con
un caso por cada cara. Si la decisión fuera «no ocupa», tiene que quedar escrita con su razón, igual
que se hizo con los otros cuatro mapas parciales.

---

### BLOQUEANTE B3 — R35 solo está cumplido para **uno** de los dos roles que nombra

> **R35.** El sistema DEBE ofrecer a **cada uno de esos dos roles** al menos una superficie
> alcanzable, desde su propia pantalla, para **leer y escribir** en el hilo de una orden en el
> estatus de ayuda.

- **mensajero: cumplido.** `HiloNotasAyudaModal.tsx` + el botón «Conversación» de la card. Verificado
  por `235/R35: desde la card se abre el HILO...`, y el componente entra en el núcleo firmado de la
  guardia `orden-nota-frontera`.
- **adminTienda: NO cumplido.** No existe superficie de **lectura**. El botón «Notas» de `/novedades`
  se retiró el 2026-08-18 y `HiloNotasNovedadModal.tsx` **no está montado en ningún sitio** (censo:
  solo aparece en su propio archivo, en dos comentarios y en la lista de la guardia). El propio
  archivo lo dice: «desde `/novedades` la tienda YA NO LEE NI RESPONDE el hilo. Eso incluye **el
  MOTIVO de una solicitud de ayuda**». Lo único que la tienda puede hacer es **escribir** la nota
  obligatoria de «Habilitar», que además rescata la orden: no es una superficie de conversación, es
  el desenlace.

Consecuencia real: al desplegar esto, la tienda ve la orden en `/novedades` con el badge «Ayuda
solicitada a la tienda» y **no puede leer lo que el mensajero escribió**. La mitad de vuelta del
«viaje completo de ida y vuelta» que da nombre a la ficha no llega.

- **La trazabilidad lo refleja:** R35 mapea a un único test, del lado mensajero.
- **La guardia `hilo-ventana-alcanzable` NO es evidencia de R35:** cruza la ventana de escritura
  contra los **estatus que lista la pantalla**, no contra la existencia de una superficie. Pasa en
  verde con la tienda sin botón.
- **El spec se contradice consigo mismo:** «Fuera de alcance» difiere «la reposición de la lectura
  del hilo del lado tienda» a la ficha **236**, mientras R35 la exige aquí. Design §6.3 solo trata el
  lado mensajero.

**Qué falta:** o se entrega la superficie de lectura de la tienda con su test, o **el humano enmienda
R35** acotándolo al mensajero y dejando escrito, con fecha, que la lectura del lado tienda es de la
236 y qué se acepta mientras tanto. Lo que no puede quedarse es un requisito firmado, incumplido y
sin test.

---

### BLOQUEANTE B4 — `tasks.md` con 0 de 39 tareas marcadas, y cuatro de ellas realmente sin cerrar

`CHECKPOINTS.md` línea 9 lo exige literalmente. Y no es solo papeleo: dentro hay trabajo abierto que
la propia bitácora reconoce en su §8.

| Task | Estado real |
| --- | --- |
| **T0.1** — re-medir P6 contra producción | El leader dice haberlo re-medido (0 órdenes con la bandera, autocomprobado con 141 vivas). **No está escrito en la bitácora**, que sigue diciendo «PENDIENTE, y bloquea el despliegue». Hay que pegar la medición con su fecha antes del PR. |
| **T6.3** — `db:migrate` + `db:rollback` reales | Hecho por el leader contra el motor. La bitácora dice «queda por hacer». |
| **T8.1** — ver la app | **No hecho.** Es justo la parte que la suite no cubre, y esta ficha reescribió 8 archivos de `app/` más un componente nuevo, con un agente que declara la UI fuera de su lane. |
| **T8.2** — documentación al día | **Sí está hecho** (los tres documentos están editados en el commit); la bitácora dice lo contrario. Ver **m5**. |

**Qué falta:** cerrar T0.1 y T8.1 de verdad, corregir la bitácora y marcar las 39 casillas.

---

## 4 · Menores

- **m1 · El caso de R22 no prueba R22.** `tests/unit/services/cierre-dia-service.test.ts` fija
  `contarOrdenesPendientesGestion: vi.fn(async () => 1)`, así que devuelve 1 **venga lo que venga en
  la lista de estados**. Medido: con `"ayuda_tienda"` fuera de `ESTADOS_PENDIENTES` ese caso sigue
  **verde** (solo mueren R23 y un caso de la 111). Su propio comentario —«El repo cuenta 1 porque el
  estatus esta en la lista; si saliera de ella, contaria 0»— es falso sobre su doble. R22 queda
  cubierto por el par R23 + comportamiento heredado, pero el caso que lleva su nombre no lo
  demuestra. Mismo patrón en `R22: el gate de la pantalla dice lo mismo`.
- **m2 · El buscador y el filtro cantón/distrito ya no alcanzan la sección de ayuda.**
  `RepartoModule.tsx` pinta `conAyuda` **crudo** (`:770`), mientras que antes `visualConAyuda` salía
  de `porGestionarVisual`, es decir, después del buscador (114), del filtro (117) y del reordenado
  (115). Hoy, buscar una guía que está en ayuda muestra «Ninguna guía en reparto coincide con la
  búsqueda» arriba y, debajo, todas las cards de ayuda sin filtrar. Es defendible ahora que la
  sección es «aparte», pero es un cambio de conducta no declarado ni en design §6 ni en la bitácora.
- **m3 · El chip del chat pinta «Asignada» en vez de «En reparto».**
  `app/(app)/mis-asignaciones/_components/chat/chat-format.ts:27` (`estadoDe`) no conoce
  `ayuda_tienda` y cae en `default → "otro"`. P8 conserva el contacto, pero se ve con el chip neutro.
  Cosmético y en la dirección segura; se resuelve con una línea, decidiendo si el chip debe decir
  algo propio.
- **m4 · La UI le niega al mensajero bloqueado el rescate que R25 le concede.**
  `RecuperarAyudaButton ... disabled={bloqueado}` sigue en la card de ayuda. El servicio lo permite a
  propósito (`rescate-ayuda.ts` lo explica y hay test verde), pero desde la pantalla no se puede
  ejercer. Es conducta preexistente, pero R25 es un requisito **nuevo** de esta ficha y su único test
  mira el servicio.
- **m5 · La bitácora está desactualizada en su §8.5.** Dice que T8.2 no se hizo; el commit contiene
  las tres notas fechadas (`auditoria_ayuda_tienda.md`, `design_pila_ayuda_tienda.md`,
  `specs/239-devolucion-espera-cierre/requirements.md`). Solo falta el número de PR.
- **m6 · R44 se apoya en una prueba manual no repetible.** El §4 de la bitácora documenta el
  experimento (añadir un value falso al SEED → typecheck rojo en exactamente tres sitios) y lo
  revirtió. No queda ningún test que lo re-ejecute; la red real son las copias a mano de esos mapas
  en tres tests. Aceptable con el precedente del repo, pero conviene decirlo así en la columna de
  trazabilidad en vez de dejar «prueba manual».
- **m7 · R46 mapea a un test prestado.** Su celda es el caso de R22 (`not.toMatch(/m1|o1|c1/)`) más
  «las 818 guardias verdes». No hay aserción propia sobre los mensajes y payloads **nuevos** de esta
  feature (el `forbidden` opaco del rescate, el warn agregado del corte). El riesgo real es bajo
  —los tres son constantes sin interpolación, los leí uno a uno— pero la trazabilidad se apoya en un
  test de otro requisito.
- **m8 · R29 se acredita por una propiedad estructural.** «Después del corte no queda señal de ayuda
  viva» se demuestra con la guardia de la columna retirada («no hay marca que apagar»). Es un
  argumento válido y más fuerte que un test de estado, pero no ejercita el corte; y con **B1**
  abierto hay órdenes que nunca pasan por él.
- **m9 · `HiloNotasAyudaModal` usa texto de carga, no skeleton.** `DESIGN.md` reserva la regla
  «skeleton, no el texto Cargando…» a `DataTable`, y el modal es un calco de `HiloNotasNovedadModal`
  (mismos tokens, mismos roles ARIA, mismo `Modal` compartido). Lo anoto solo para que la decisión
  sea consciente: **no lo cuento como defecto**, es consistencia con su gemelo.

---

## 5 · El acabado de UI, revisado contra `DESIGN.md`

Lo que está **bien**, dicho con nombre porque el implementer avisó de que iba fuera de su lane:

- **`HiloNotasAyudaModal.tsx` (109 líneas)** es un calco estructural de `HiloNotasNovedadModal`: mismo
  `Modal` compartido (`hideConfirm`, `size="md"`, `cancelLabel`), mismo `HiloNotasOrden` de
  `components/shared/`, mismas Server Actions, mismo SWR con `key` por orden y carga bajo demanda.
  **Cero estilos propios, cero hex, cero utilidades ad-hoc.** Los estados están completos: `isLoading`
  (`role="status"`), ok, y error **tipado en tres variantes** (`forbidden` / `unauthenticated` /
  fallo de transporte) con `role="alert"`. Tokens correctos según el sistema de tres roles:
  `text-danger-strong` para el texto de error y `text-muted-foreground` para el secundario.
  `puedeEscribir` llega del servidor y la UI no lo re-deriva del estatus.
- **El botón «Conversación»** usa la primitiva `Button` con `variant="secondary"` y `size="sm"` —no
  hay ningún botón armado a mano—, así que hereda el focus ring y los estados de `buttonVariants`. No
  cuelga de él nada asíncrono (solo abre el modal), así que no le falta `loading`.
- **`GestionarOrdenPanel`**: el botón de ayuda pierde su rama condicional y queda con una sola clase;
  conserva `focus-visible:ring-2 focus-visible:ring-ring/40`. Es la clase heredada del archivo y no
  la estándar de `DESIGN.md` (`ring-3 ring-ring/50`), pero **no la introdujo esta ficha**: el diff
  solo colapsa el ternario.
- **`EstatusBadge`**: etiqueta y variante entran por la primitiva `Badge`, sin hex. `warning` es
  coherente con la familia de «espera con acción pendiente» que ya usan `por_devolver`,
  `sin_gestionar`, `devuelta` y `devolucion_por_confirmar`, y la razón está escrita al lado.
- **`NovedadAcciones` / `NovedadesModule`**: traducción literal por `estatusValue`, con el remite a la
  240 escrito en el sitio. Sin rediseñar la card, como pedía T5.4.

El **corte de secciones en `RepartoModule`** quedó coherente en lo estructural —el `useMemo` de
cliente desapareció, `conAyuda` llega por props, el mensaje de «todas con ayuda» se lee de las dos
props en vez de de una lista partida, la card pierde «Gestionar» y gana «Conversación» con su razón
escrita— pero arrastra **m2** (la sección de abajo se quedó fuera del buscador y del filtro) y **m4**
(el rescate deshabilitado). Y como **T8.1 no se hizo**, nadie ha visto esta pantalla funcionando.

---

## 6 · Mutaciones que corrí yo, con hash antes y después

Cada una: hash → mutar → correr vitest y leer su salida real → restaurar → hash. Ninguna quedó
aplicada. Las seis se aplicaron **una a una**, nunca en paralelo con el gate.

| # | Archivo | Mutación | Rojos |
| --- | --- | --- | --- |
| A | `lib/types/webhook-eventos.ts` | la lista de familias exceptuadas gana `liberacion_reprogramada` | **3** |
| B | `lib/types/webhook-eventos.ts` | la excepción se reimplementa **por estado destino** | **7** |
| C | `lib/services/CierreDiaService.ts` | `ESTADOS_PENDIENTES` pierde `ayuda_tienda` | **2** |
| D | `lib/services/CierreDiaService.ts` | se aplica la precondición de pendientes a las dos rutas exentas | **4** |
| E | `lib/repositories/OrdenRepository.ts` | `novedadWhere` pierde la rama de ayuda | **9** |
| F | `lib/types/ventana-hilo-notas.ts` | la ventana del mensajero pierde `ayuda_tienda` | **4** |

**Hashes finales, idénticos a los del commit (y a los que la bitácora declara):**

```
1381ed66749ebb2c64f6825ed53371eafd4462ddba6517dcbcb4627966ece668  lib/types/webhook-eventos.ts
9c12b1e23c4124cc3284ef1e406466c640ae9b886ba5c62eda8ae52e491c979c  lib/services/CierreDiaService.ts
a3b5c121fc1d01c817a1d2a53b207530feb2e163049ceebdbf2e37882c82f6fb  lib/repositories/OrdenRepository.ts
5fe37ae10dcb0c84b631d427be5248a533485e8ef5ae5fcace988e64a42a299d  lib/types/ventana-hilo-notas.ts
8b2f0942d7f2d312a0e564821fa09dbc7320daaeddf23fcace8d53a465251127  lib/services/MisAsignacionesService.ts
```

`git status` limpio al cerrar la revisión.

---

## 7 · Qué NO conté como hallazgo

- La advertencia heredada para la **237** (la invariante «una orden en ayuda bloquea el cierre» es
  falsa en las dos rutas de re-solicitud). Está documentada a propósito en tres sitios.
- Que **`gestion_tienda_ayuda`** no se declare aquí: nace con su productor, la 237, y hay test que
  lo fija por su ausencia.
- Los **92 warnings de lint preexistentes**.
- La ausencia de E2E: este repo no tiene arnés vivo. Lo que sí cuento es que su sustituto —T8.1, ver
  la app— no se hizo, y va dentro de **B4**.

---

## Veredicto final

**RECHAZADO** — **4 bloqueantes, 9 menores**.

No se abre el PR hasta que **B1**, **B2** y **B3** estén resueltos (B3 puede resolverse con una
enmienda humana de R35, no necesariamente con código) y **B4** cerrado. B1 y B2 vuelven al
implementer: son dos consultas que enumeran estados y que esta ficha dejó atrás, exactamente la clase
de fallo que vino a cerrar.
