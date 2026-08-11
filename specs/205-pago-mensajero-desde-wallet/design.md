# Feature 205 — Diseño

Decisiones técnicas antes de escribir código. Cada decisión grande lleva **la alternativa que
se descartó y por qué** (`docs/specs.md`). Lo que aquí se afirma del código existente está
citado con archivo y línea en `requirements.md > Punto de partida`.

---

## §0 — Las cinco decisiones, en una línea cada una

| # | Decisión | Alternativa descartada |
| --- | --- | --- |
| D-A | El reparto es una **función pura** (`lib/utils/reparto-liquidacion-mensajero.ts`) que ordena y trocea, más un método del servicio que lo APLICA bajo transacción | Un método que orqueste N llamadas a `registrarPagoMensajero` (§2.2) |
| D-B | **Todo o nada**: una transacción, N bloqueos de cierre tomados en el orden del reparto | Parcial-con-parte (N transacciones independientes) (§3.2) |
| D-C | El cierre se hace direccionable con **parámetro de búsqueda** `?cierre=<id>` en `/cierres-admin` | Ruta propia `/cierres-admin/[cierreId]` (§4.2) |
| D-D | La clave de idempotencia vive en una **tabla nueva `liquidacion_reparto`** con `UNIQUE(clave_idempotencia)`, insertada la primera dentro de la transacción | Derivar una clave por cierre sobre `liquidacion_pago.clave_idempotencia` (§5.2) |
| D-E | La previsualización la calcula el **servidor**, con la misma función pura, en una acción de solo lectura; el cliente solo pinta cadenas | Calcular el reparto en el diálogo a partir del listado de pendientes (§6.2) |

---

## §1 — Modelo de datos

### 1.1 Tabla nueva: `liquidacion_reparto`

Es el **acto** de repartir: una fila por reparto, N pagos colgando de ella.

| Columna | Tipo | Notas |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `clave_idempotencia` | `text` **UNIQUE** NOT NULL | la barrera de R29; misma semántica que la del pago |
| `mensajero_id` | `uuid` NOT NULL → `usuario(id)` `ON DELETE RESTRICT` | beneficiario del acto |
| `monto_total` | `DECIMAL(12,2)` NOT NULL, `CHECK (monto_total > 0)` | lo que la persona comprometió |
| `registrado_por` | `uuid` NOT NULL → `usuario(id)` `ON DELETE RESTRICT` | R7 de la 172: un pago siempre lo registra alguien |
| `created_at` | `timestamptz DEFAULT now()` | instante del registro |

- **Fila inmutable**: sin `updated_at` ni `deleted_at`, igual que `liquidacion_pago` y
  `liquidacion_anulacion`. No hay método que la edite ni que la borre (R52).
- Índice `(mensajero_id, created_at DESC)` para auditar los repartos de un mensajero.
- **RLS habilitada sin policies**, patrón de `liquidacion_pago` / `liquidacion_anulacion`
  (solo service role) — R49.
- La suma de sus pagos es igual a `monto_total` por construcción, y **no** se guarda
  duplicada: derivarla es una suma sobre `liquidacion_pago`.

### 1.2 Columna nueva: `liquidacion_pago.reparto_id`

`uuid NULL → liquidacion_reparto(id) ON DELETE RESTRICT`, con índice.

- **Nullable a propósito**: los pagos existentes y los que se sigan registrando contra UN
  cierre desde `/cierres-admin` no pertenecen a ningún reparto. Aditiva pura: ni backfill ni
  `NOT NULL` (R49/R51).
- Es lo que permite **reconstruir el resultado original** en la respuesta idempotente (R28)
  con una consulta directa, en vez de inferirlo.
- No aparece en `PagoRegistradoDTO` (R48): el comprobante conserva sus 9 campos exactos, que
  es lo que afirma `liquidacion-money-safe.test.ts:216`.

### 1.3 Migración

`db/migrations/<timestamp>_liquidacion_reparto/{migration.sql,down.sql}` generada con
`pnpm run db:migrate:create` (nunca a mano). **No se añade ningún enum**, así que no hay que
revisar ningún `down.sql` previo. El `down.sql` revierte en orden inverso: `ALTER TABLE
liquidacion_pago DROP COLUMN reparto_id` y luego `DROP TABLE liquidacion_reparto`.

### 1.4 Lo que NO se toca

- `cierre_dia`: solo lectura (R26). Ningún método nuevo escribe en ella.
- `pago_mensajero_movimiento`: **no** gana columna `cierre_id`. Esa alternativa ya la descartó
  la 172 (§11.G, citada en `PagoMensajeroMovimientoRepository.ts:72-74`) porque exigiría
  backfillear una tabla declarada inmutable. Lo que esta feature hace es **proyectar** el
  cierre en el DTO resolviéndolo por consulta (§7.3), que no toca el esquema.

---

## §2 — Dónde vive el repartidor (D-A)

### 2.1 Lo elegido: función pura + método que aplica

**`lib/utils/reparto-liquidacion-mensajero.ts`** (nombre con `liquidacion` **a propósito**:
así el censo money-safe lo captura solo, ver §11):

```ts
export interface CierreImputable {
  cierreId: string;
  pendiente: string;      // STRING 2 dec, ya derivado
  solicitadoAt: string;   // ISO — la antigüedad de R8 (Q1)
}

export interface Imputacion {
  cierreId: string;
  monto: string;            // STRING 2 dec, > 0
  pendienteAntes: string;
  pendienteDespues: string; // pendienteAntes − monto
  parcial: boolean;         // monto < pendienteAntes
}

export interface Reparto {
  imputaciones: Imputacion[];
  totalImputado: string;  // Σ montos
  imputable: string;      // Σ pendientes de la entrada
  sobrante: string;       // importe − totalImputado (> 0 solo si excede)
}

export function ordenarCierresFifo(cierres: readonly CierreImputable[]): CierreImputable[];
export function repartirEntreCierres(importe: string, cierres: readonly CierreImputable[]): Reparto;
```

- `repartirEntreCierres` **ordena por su cuenta** (llama a `ordenarCierresFifo`): el criterio
  de R8 vive en el módulo puro y no en un `ORDER BY`, así que **el determinismo se prueba sin
  base de datos** (R17). El repositorio ordena igual por eficiencia, pero la verdad es esta.
- Comparador: `solicitadoAt` asc → `cierreId` asc. El segundo escalón no es adorno: sin él,
  dos cierres del mismo instante dan un orden que depende del motor (R8).
- Todo con `Prisma.Decimal`; salida `toFixed(2)`. Cero `Number(`/`parseFloat` (R16).
- Descarta las entradas con pendiente ≤ 0 y no emite imputaciones de 0 (R12).

**`LiquidacionService.registrarRepartoMensajero(input, actor)`** es quien lo aplica. El
esqueleto, en el orden en que importa:

1. **ROL** (`esAccesoTotal`), antes de tocar datos (R1/R4).
2. Abre **UNA** transacción.
3. Inserta la fila de `liquidacion_reparto`. Un choque de `clave_idempotencia` sale de la
   transacción con una señal interna y se responde fuera (§5.1) — mismo patrón que
   `ClaveRepetidaError` de la 172.
4. Lee los cierres imputables del mensajero **ordenados** y toma el **bloqueo de cada uno** en
   ese orden (R21/R22).
5. **Relee** el pendiente de cada cierre bajo bloqueo y vuelve a llamar a
   `repartirEntreCierres` con esos valores (R23).
6. `sobrante > 0` → `excede` con el imputable vigente, sin escribir (R14).
   Sin cierres imputables → `sin_saldo` (R15).
7. Por cada imputación, escribe documento + movimiento **con el mismo escritor privado** que
   usa el pago contra un cierre único (§2.3).
8. Devuelve el reparto **aplicado** (R25).

### 2.2 Alternativa descartada: orquestar N llamadas a `registrarPagoMensajero`

Es la opción obvia y **no puede cumplir R20**: `registrarPagoMensajero` abre su propia
transacción (`this.runTransaction`, `LiquidacionService.ts:190`), así que N llamadas son N
transacciones. Si la tercera falla, las dos primeras ya están confirmadas y el sistema queda
con un pago a medias que nadie pidió — dinero de terceros, sin registro de la diferencia. Se
descarta por eso, no por elegancia. Además obligaría a repetir el cálculo del monto de cada
llamada fuera de una función testeable, que es lo contrario de lo que se busca.

### 2.3 Corolario: un solo escritor

El cuerpo que hoy escribe el documento + el movimiento dentro de `registrarPagoMensajero`
(`:210-237`) se extrae a un método privado `escribirPagoDeCierre(tx, {...})` que **usan los
dos caminos**. Ganancia concreta: no hay dos copias del camino money-critical que puedan
divergir, y hay un test que lo mide (un reparto que cae entero en un cierre produce las mismas
filas que el pago simple por ese importe). El comentario de la 172 sobre «no factorizar» habla
del eje mensajero↔tienda (contra qué se compara, en qué libro se escribe, con qué signo); aquí
las tres cosas son idénticas, así que la razón de no factorizar no aplica.

---

## §3 — Atomicidad y concurrencia (D-B)

### 3.1 Lo elegido: todo o nada, N bloqueos en orden determinista

Es dinero de terceros: el único desenlace auditable de un fallo a mitad es «no pasó nada,
volvé a intentarlo». Un reparto medio aplicado dejaría al operador creyendo que pagó X cuando
se aplicó Y, sin ninguna fila que explique la diferencia — y rompería R28, porque la respuesta
idempotente no sabría qué «resultado original» devolver.

**Sobre el deadlock.** La 172 escribió que se toma **un** bloqueo por operación porque «al no
haber dos recursos que ordenar, no existe orden de adquisición capaz de producir un
interbloqueo» (`ILiquidacionPagoRepository.ts:151-154`). Aquí sí hay varios, y la respuesta es
el **orden total**: todos los repartos adquieren en el mismo orden (`solicitadoAt`, `cierreId`),
así que dos repartos concurrentes sobre el mismo mensajero no pueden formar ciclo. Frente al
pago simple tampoco: ese toma **un solo** bloqueo y por tanto nunca espera con otro en la mano.
El grano no cambia (sigue siendo la fila del cierre, R21): dos pagos a mensajeros distintos
siguen sin estorbarse.

### 3.2 Alternativa descartada: parcial-con-parte

«Aplicá lo que puedas y decí qué falló» tiene una virtud (nunca pierdes trabajo hecho) y tres
defectos que la matan aquí: (a) deja un importe comprometido distinto del aplicado, sin
asiento que lo explique; (b) hace irrepetible la respuesta idempotente; (c) obliga a la
pantalla a redactar un estado nuevo («se pagaron 2 de 4») que nadie sabe reconciliar seis meses
después. Se descarta.

### 3.3 Alternativa descartada: bloquear al mensajero en vez de a sus cierres

Un solo bloqueo, ninguna preocupación de orden. Descartada porque cambia el grano que la 172
eligió a propósito —la fila del cierre, no la de `usuario`, que es fila caliente (sesiones,
perfil)— y porque haría que un pago simple a un cierre y un reparto a otro mensajero... no, del
mismo mensajero, se serializaran sin necesidad. R21 lo prohíbe explícitamente.

---

## §4 — Cómo se hace direccionable un cierre (D-C)

### 4.1 Lo elegido: `?cierre=<uuid>` en `/cierres-admin`

`CierresAdminModule` lee el parámetro al montar y llama a `abrirDetalle(cierreId)`; al cerrar
el detalle, lo retira de la URL (R45).

Lo que lo hace barato **está medido**: `abrirDetalle` **no lee la fila de ninguna tabla**, pide
`verCierreDetalle({ cierreId })` por id (`CierresAdminModule.tsx:341-374`). Por eso el enlace
funciona igual para un cierre de la página 7 del histórico, que es justo lo que R40 exige y lo
que una ruta propia tendría que resolver de todos modos. Los tres desenlaces de error ya están
escritos ahí (`no_encontrada` → aviso + refresco; `unauthenticated`; fallo genérico), así que
R41 se cumple con el código que ya existe.

**Coste y consecuencias:** ~15 líneas en un archivo cliente; `useSearchParams` obliga a que el
módulo quede bajo un límite de `Suspense` (la página ya es dinámica, pero hay que verificarlo);
hay que limpiar la URL al cerrar o recargar reabre el modal; y `/cierres-admin` admite
`adminSatelite`, que seguirá viendo solo lo suyo por su propio alcance (R42).

### 4.2 Alternativa descartada: ruta propia `/cierres-admin/[cierreId]`

Es «lo correcto» en abstracto y **cara aquí**: el detalle no es un componente aislado, es un
modal dentro de `CierresAdminModule`, que sostiene el estado de aprobar, rechazar, destrabar,
capturar indemnizaciones y ofrecer el pago tras aprobar. Sacarlo a una página exige duplicar
ese render o montar una ruta interceptora, y toca la pantalla de mayor superficie de dinero del
repo para conseguir exactamente lo mismo que ya da leer un parámetro. Se descarta por relación
coste/riesgo, no por dogma; queda anotada por si algún día el detalle se extrae por otro motivo
(ahí el enlace pasa a ser una redirección de una línea).

### 4.3 Dónde aparecen los enlaces

- En el desglose de `/wallet/mensajeros`, por fila (R43). Una fila identifica su cierre si
  `origenTipo === "cierre_dia"` (el `origenId` **es** el `cierreId`,
  `WalletMensajeroFeedService.ts:56`) o si es un movimiento nacido de un pago
  (`origenTipo === "pago_mensajero"`), cuyo cierre se resuelve por consulta (§7.3). Las demás
  filas no llevan enlace.
- En la previsualización y en el resultado del reparto (R44).

---

## §5 — Idempotencia (D-D)

### 5.1 Lo elegido: una fila `liquidacion_reparto` con `UNIQUE`, insertada la primera

1. El diálogo acuña la clave al abrirse y la conserva entre reintentos — **no se escribe nada
   nuevo**: es exactamente lo que ya hace `RegistrarPagoDialog` (`:197-219`), y el reparto
   reusa ese diálogo (§8).
2. El servicio inserta la fila del reparto **antes de mover un céntimo**. Si la clave ya se
   usó, el `UNIQUE` rechaza el INSERT: la transacción sale por una señal interna y **fuera** de
   ella se relee el reparto por su clave y se reconstruye su resultado leyendo
   `liquidacion_pago WHERE reparto_id = …` (R28). Es el mismo baile que la 172 ya hace con
   `ClaveRepetidaError`, y por el mismo motivo técnico: en Postgres un error de sentencia deja
   la transacción abortada y no se puede releer dentro.
3. **Cero TOCTOU** (R29): no hay `SELECT` que decida si insertar. La barrera es de datos.
4. Un pago legítimamente repetido nace de **abrir el diálogo otra vez** → clave nueva → pasa
   (R30).
5. Cada `liquidacion_pago` del reparto conserva su propia `clave_idempotencia`, derivada de
   forma determinista como `<clave del reparto>:<cierreId>`. No es la barrera principal —ya lo
   es la fila del reparto— pero mantiene el `UNIQUE` de la columna con un valor auditable en
   lugar de un uuid inventado, y actúa de segunda red.

### 5.2 Alternativa descartada: derivar la clave por cierre y no crear tabla

Tentador (cero migración): mandar una clave y escribir cada pago con
`<clave>:<cierreId>`. **Está roto y se midió por qué**: si el primer intento agotó el cierre A,
el reintento recalcula el FIFO y empieza en el cierre B → la clave derivada es `<clave>:B`, que
no colisiona con nada → **se paga dos veces**. Para evitarlo habría que buscar antes por
prefijo, es decir, volver a un `SELECT` que decide si escribir: exactamente el TOCTOU que R29
prohíbe. Se descarta.

### 5.3 Alternativa descartada: heurística «mismo importe en menos de N segundos»

Ya venía descartada de fábrica en la ficha (D3) y se deja escrito: bloquea el caso legítimo
—dos pagos iguales el mismo día— y nadie puede razonar sobre ella seis meses después.

---

## §6 — Previsualización derivada del servidor (D-E)

### 6.1 Lo elegido: una acción de solo lectura que usa la MISMA función pura

`previsualizarRepartoMensajeroAction({ mensajeroId, monto? })`:

- **sin `monto`**: devuelve el conjunto imputable (cierres con su pendiente), el `imputable`
  total, la `cuentaPorPagar` del mensajero y los `excluidos`. Es lo que alimenta el
  `disponible` con el que se abre el diálogo y decide si el botón está habilitado (R15).
- **con `monto`**: además, las `imputaciones` que produciría, el `sobrante` y `excede`
  (R32/R33/R38).
- **No escribe nada** (R35): el servicio no abre transacción, no toma bloqueos y no llama a
  ningún método de escritura. Hay un test que lo mide con dobles.
- Todos los importes salen ya derivados y serializados como **STRING** (R34/R46). El diálogo
  recibe el texto y lo pinta; no lo suma, no lo resta y no lo compara.
- El cliente la vuelve a pedir cuando cambia el importe, con la misma espera que el resto de
  la app (`DEBOUNCE_MS_DEFAULT`), y **siempre** antes de habilitar la confirmación.

**La previsualización es advertencia, no contrato**: R23 obliga a recalcular bajo bloqueo, y
el resultado que se pinta al final es el aplicado (R25). Si entre previsualizar y confirmar
alguien pagó por otra vía, el importe ya no cabe y se responde `excede` con el imputable
vigente — nunca se paga de más, nunca se paga a un cierre que dejó de estar aprobado (R24).

### 6.2 Alternativa descartada: repartir en el cliente

El diálogo ya recibiría la lista de pendientes; trocear ahí es un bucle de diez líneas y ahorra
un viaje. Se descarta sin matices: es aritmética sobre dinero en el navegador, es lo que el
barrido money-safe existe para impedir y es la deuda que la ficha 204 acaba de abrir por hacer
justo eso en otra pantalla.

### 6.3 Alternativa descartada: token optimista que invalide la previsualización

Firmar la previsualización y rechazar la confirmación si el estado cambió. Da un mensaje más
preciso («esto cambió, revisá») a cambio de un rechazo extra en un caso raro y de un mecanismo
nuevo que mantener. Se descarta: recalcular bajo bloqueo ya impide el daño, y `excede` con el
importe vigente es un mensaje suficiente.

---

## §7 — Contratos I/O

### 7.1 Tipos y schemas — `lib/types/liquidacion-reparto.ts`

```ts
// Borde de la PREVISUALIZACIÓN (solo lectura)
previsualizarRepartoSchema = z.object({
  mensajeroId: z.string().uuid(),
  monto: montoLiquidacionSchema.optional(),   // el MISMO validador del pago (R11/R47)
}).strict();                                   // R9: un `cierreId` colado muere aquí

// Borde del REGISTRO
registrarRepartoMensajeroSchema = z.object({
  claveIdempotencia: z.string().uuid(),
  mensajeroId: z.string().uuid(),
  monto: montoLiquidacionSchema,
  metodo: z.enum(METODO_PAGO_SEED),
  referencia: …, nota: …, fechaPago: fechaPagoSchema,   // reusados del pago (172)
}).strict().superRefine(exigirReferenciaEnPagoElectronico);
```

`.strict()` es la barrera literal de R9 y R47: `cierreId` **no existe** en estos schemas.

### 7.2 DTO de salida

```ts
type ImputacionPrevistaDTO = {
  cierreId: string;          // R48: el id del CIERRE sí cruza (es el enlace)
  solicitadoAt: string;      // ISO — para nombrar el cierre en pantalla
  pendienteActual: string;   // STRING 2 dec
  monto: string;             // STRING 2 dec
  pendienteDespues: string;  // STRING 2 dec
  parcial: boolean;
};

type CierreExcluidoDTO = { cierreId: string; estado: CierreEstado; solicitadoAt: string };
// R36 y §10.2: NO lleva importe. Un cierre no aprobado no ha devengado nada todavía y la 172
// (R28) enseña `null` para su pendiente a propósito; inventar aquí una cifra lo contradiría.

type PrevisualizacionRepartoDTO = {
  mensajeroNombre: string;   // NOMBRE, nunca el id de la persona (R48)
  imputable: string;
  cuentaPorPagar: string;    // para la advertencia de R37
  imputaciones: ImputacionPrevistaDTO[];
  sobrante: string;
  excede: boolean;
  excluidos: CierreExcluidoDTO[];
};

type RepartoAplicadoDTO = {
  totalImputado: string;
  restanteImputable: string;
  imputaciones: ImputacionAplicadaDTO[];  // { cierreId, monto, pendienteDespues }
};
```

Resultados del registro:
`ok` · `ya_registrado` (con el reparto original, R28) · `excede` (con `disponible`) ·
`sin_saldo` · `no_encontrado` · `forbidden` · `validation_error` · `unauthenticated`.
Son **los mismos nombres** que ya usa `RegistrarPagoResult`, para que la pantalla no tenga que
aprender un vocabulario nuevo.

### 7.3 El cierre en las filas del desglose (R43)

`PagoMensajeroMovimientoDTO` gana `cierreId: string | null`, **derivado**, no almacenado:

- `origenTipo === "cierre_dia"` → `cierreId = origenId`;
- `origenTipo === "pago_mensajero"` → se resuelve con UNA consulta por página
  (`liquidacionPago WHERE id IN (…) SELECT id, cierreId`), el mismo patrón de dos pasos que ya
  usa `buildFiltrosWhere` (`PagoMensajeroMovimientoRepository.ts:84-94`);
- resto → `null`, y esa fila no lleva enlace.

No entra en las columnas de descarga: el archivo sigue sin emitir identificadores.

### 7.4 Server Actions

Dos, en `lib/actions/liquidacion.ts`, con el molde exacto de las cinco que ya viven ahí
(resolver actor → `UnauthenticatedError` antes del servicio → `schema.parse` → servicio bajo
`withErrorHandler`). No se crea ruta API: son mutaciones/lecturas internas
(`docs/architecture.md > Server Actions vs Route Handlers`). El test que afirma la lista exacta
de exportaciones de ese módulo (`tests/unit/actions/liquidacion-action.test.ts:609`) hay que
ampliarlo de cinco a siete: es el mecanismo que impide que aparezca un `editarRepartoAction`
sin que nadie lo note (R52).

---

## §8 — UI

**Dónde se monta el pago:** dentro del **desglose expandido** de `/wallet/mensajeros`
(`DesglosePagosMensajero`), en un bloque `PagoMensajeroAcciones` nuevo. Es el espejo exacto de
lo que hace la tienda (`PagoTiendaAcciones` dentro de su desglose) y evita tocar las columnas
de `CuentasPorPagarTable`, que están atadas a guardias de descarga.
*Alternativa descartada:* una columna «Acciones» en la tabla-resumen — más visible, pero toca
la lista de columnas de un listado descargable y no hay sitio para el aviso de R37.

**El diálogo:** se reusa `RegistrarPagoDialog`. Gana **una** prop aditiva y opcional,
`renderPrevisualizacion?: (monto: string) => ReactNode`, que se pinta bajo el campo de monto.
El diálogo sigue sin saber a quién se paga y sin calcular nada; el hijo se encarga de pedir la
previsualización al servidor. Reusarlo no es economía: es lo que hereda **gratis** la
disciplina de la clave de idempotencia (R27/R30/R31), que es el corazón de D3.

**La previsualización se pinta como lista descriptiva, no como `<DataTable>` ni `<table>`.**
No es un listado de registro (no ordena, no pagina, no se descarga) y ambas formas están
censadas por `cobertura-tablas.guardia` / `censo-tablas.ts`: meter una tabla ahí obligaría a
mover ese censo por una lista de tres filas dentro de un modal.

**Refresco dirigido tras pagar:** se invalidan exactamente las claves SWR de ESE mensajero (su
desglose y su previsualización), no un `mutate()` global — mismo criterio que
`PagoTiendaAcciones` (R33 de la 172: cada fila abierta cuesta una consulta).

---

## §9 — Permisos

Un único predicado, `esAccesoTotal`, en las dos mitades: el servicio responde `forbidden` (R1)
y la pantalla —que ya es de acceso total entera, `wallet/mensajeros/page.tsx:27`— monta el
control. La previsualización **también** exige acceso total: dice cuánto se le debe a una
persona y por qué cierres, que es la misma superficie de dinero.

---

## §10 — Límites conocidos, declarados

1. **Tamaño de la transacción (Q2).** `2·N + 1` filas en una transacción interactiva. `N` está
   acotado en la práctica por el importe, pero no hay tope duro. Riesgo: un importe enorme sobre
   una deuda muy fragmentada podría agotar el tiempo de transacción — y, por R20, no dejaría
   nada escrito (falla del lado seguro).
2. **Deuda no imputable (Q5).** `imputable` puede ser menor que `cuentaPorPagar` si hay ajustes
   manuales en el libro (`ajuste_devengo`/`ajuste_pago`), que no cuelgan de ningún cierre. Se
   **advierte** (R37) y no se paga: pagarla exigiría un pago sin cierre, es decir romper R21.
3. **Los importes agregados siguen siendo brutos.** La fila de la tabla suma pagos anulados y
   sus reversos en «Devengado» y «Pagado» (aviso N1 de la 172, ya en pantalla). El `imputable`
   de esta feature **no** hereda ese problema: se deriva de pagos **vigentes** (R7).
4. **La previsualización caduca.** Entre verla y confirmar puede cambiar el estado; se resuelve
   recalculando bajo bloqueo (§6.1), no congelando la previsualización.

---

## §11 — Money-safe: qué entra en el censo y por qué

El barrido `tests/unit/guards/liquidacion-money-safe.test.ts` tiene **dos mitades**: un censo
explícito (`ARCHIVOS_DE_LA_FEATURE`) y una cláusula que lo mantiene vivo — todo archivo bajo
`components/shared/liquidacion/` y todo archivo de `lib/**` cuya ruta case `/[Ll]iquidacion/`
tiene que estar censado o el primer test cae (`:139-146`).

Por eso los módulos nuevos del servidor se **nombran con `liquidacion`**: el censo los captura
solo y no depende de que alguien se acuerde de añadirlos.

Entran en el censo:

| Archivo | Por qué |
| --- | --- |
| `lib/utils/reparto-liquidacion-mensajero.ts` | **es** la aritmética del reparto (R50) |
| `lib/types/liquidacion-reparto.ts` | contratos y schemas de dinero |
| `lib/interfaces/repositories/ILiquidacionRepartoRepository.ts` | contrato del acto |
| `lib/repositories/LiquidacionRepartoRepository.ts` | escritura del acto |
| `app/(app)/wallet/mensajeros/_components/PagoMensajeroAcciones.tsx` | cliente que pinta montos |
| `app/(app)/wallet/mensajeros/_components/RepartoPrevisualizacion.tsx` | ídem |
| `app/(app)/wallet/mensajeros/_components/DesglosePagosMensajero.tsx` | gana el enlace y monta lo anterior |

(Los ya censados que se editan —`LiquidacionService.ts`, `lib/actions/liquidacion.ts`,
`ILiquidacionService.ts`, `ILiquidacionPagoRepository.ts`, `LiquidacionPagoRepository.ts`,
`components/shared/liquidacion/RegistrarPagoDialog.tsx`— siguen bajo las mismas reglas.)

> **Nota de honestidad.** El encargo pedía seguir «cómo entró el decorador de la feature 179» en
> este censo. Se buscó: el censo vigente contiene **solo** archivos de la 172, la 179 sigue
> `pending` sin rama ni spec, y el decorador de caché real
> (`CachedAnaliticaOperativaRollupRepository.ts`) es de la 128 y **no** está en este barrido. El
> patrón que sí existe —y el que se sigue aquí— es el de la cláusula de auto-captura de arriba.

---

## §12 — Mapa `R<n> → test` (el implementer lo rellena con la evidencia)

| Requisito | Test previsto |
| --- | --- |
| R1, R2, R4 | `tests/unit/services/liquidacion-reparto-service.test.ts` (rol ajeno ⇒ `forbidden` sin lecturas) + `tests/unit/actions/liquidacion-reparto-actions.test.ts` (sin sesión ⇒ rechazo antes del service) |
| R3 | `tests/components/PagoMensajeroAcciones.test.tsx` (el control existe en el desglose de la pantalla) |
| R5, R6, R7 | `liquidacion-reparto-service.test.ts` (cierre `solicitado` y cierre con pendiente 0 fuera del conjunto; pago anulado no descuenta) |
| R8, R17 | `tests/unit/utils/reparto-liquidacion-mensajero.test.ts` (orden FIFO + desempate por id, sin DB) |
| R9, R47 | `tests/unit/types/liquidacion-reparto-schema.test.ts` (`cierreId` colado ⇒ `validation_error`) |
| R10–R13 | `reparto-liquidacion-mensajero.test.ts` (tope por cierre, solo la última parcial, Σ exacta, sin ceros) |
| R14, R15 | `liquidacion-reparto-service.test.ts` (`excede` con `disponible`; `sin_saldo`; cero escrituras) |
| R16, R50 | `tests/unit/guards/liquidacion-money-safe.test.ts` (censo ampliado) |
| R18, R19 | `liquidacion-reparto-service.test.ts` (una fila de pago por imputación, con SU `cierreId`; un movimiento por pago) |
| R20 | `liquidacion-reparto-service.test.ts` (runner que lanza en la 3ª imputación ⇒ cero filas) |
| R21, R22 | `tests/unit/guards/liquidacion-reparto-bloqueos.guardia.test.ts` (bloqueo por cierre, mismo orden que el reparto, tomado antes de leer) |
| R23, R24 | `liquidacion-reparto-service.test.ts` (pendiente cambiado bajo bloqueo ⇒ se aplica el recalculado; cierre desaprobado ⇒ no recibe) |
| R25 | `liquidacion-reparto-service.test.ts` (el resultado lleva las imputaciones aplicadas) |
| R26 | guardia: ningún método nuevo escribe en `cierreDia` |
| R27, R31 | `tests/components/RegistrarPagoDialog.test.tsx` (ampliado: clave estable entre reintentos con previsualización montada) |
| R28, R29, R30 | `liquidacion-reparto-service.test.ts` + `tests/integration/db/liquidacion-reparto-migration.test.ts` (el `UNIQUE` rechaza el duplicado en la base) |
| R32–R34, R38 | `tests/components/RepartoPrevisualizacion.test.tsx` (pinta lo que devuelve el servidor; no calcula) |
| R35 | `liquidacion-reparto-service.test.ts` (previsualizar no invoca ningún método de escritura) |
| R36, R37 | `RepartoPrevisualizacion.test.tsx` (excluidos con su estado; aviso de deuda no imputable) |
| R39, R40, R45 | `tests/components/CierresAdminDeepLink.test.tsx` (`?cierre=` abre el detalle; cerrarlo limpia la URL) |
| R41, R42 | `CierresAdminDeepLink.test.tsx` (id inexistente ⇒ aviso sin datos; rol sin acceso ⇒ el guard de la página manda) |
| R43, R44 | `tests/components/DesglosePagosMensajero.test.tsx` (fila con cierre ⇒ enlace; fila sin cierre ⇒ sin enlace) |
| R46, R48 | `tests/unit/types/liquidacion-reparto-schema.test.ts` (todos los importes `string`; sin ids de persona) + el caso existente de los 9 campos de `PagoRegistradoDTO` |
| R49 | `tests/integration/db/liquidacion-reparto-migration.test.ts` (columnas, FK, `UNIQUE`, `CHECK`, RLS, y `down.sql` deja el esquema idéntico) |
| R51 | `tests/unit/services/liquidacion-service.test.ts` **sin tocar un solo assert** + equivalencia reparto-de-un-cierre ↔ pago simple |
| R52 | `tests/unit/actions/liquidacion-action.test.ts:609` (la lista exacta de exportaciones, ampliada a siete; ninguna se llama editar/actualizar/modificar/corregir/desanular) |
