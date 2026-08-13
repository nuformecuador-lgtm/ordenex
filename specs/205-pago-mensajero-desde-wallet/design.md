# Feature 205 — Diseño

Decisiones técnicas antes de escribir código. Cada decisión grande lleva **la alternativa que
se descartó y por qué** (`docs/specs.md`). Lo que aquí se afirma del código existente está
citado con archivo y línea en `requirements.md > Punto de partida`.

---

## §0 — Las decisiones, en una línea cada una

> **Enmienda del 2026-08-11.** Las cinco preguntas abiertas están contestadas. D-F, D-G y D-H
> son nuevas; las secciones que cambiaron son §2.1, §2.4, §2.5, §5.4, §6.1, §7.2, §10, §11 y
> §12. Todo lo anterior sigue en pie salvo el límite «sin tope» de §10.1, que la respuesta a Q2
> deroga.
>
> **Enmienda posterior (misma fecha, ya con la tanda 4 construida).** El aviso de cierres
> excluidos de R36 pasa de **lista** a **conteo por estado**: D-I es nueva y las secciones que
> cambiaron son §6.4 (nueva), §7.2 y §12. Llegó **después** del spec aprobado, al descubrir la
> implementación que la lista no tenía cota; la cronología completa, en §6.4.

| # | Decisión | Alternativa descartada |
| --- | --- | --- |
| D-A | El reparto es una **función pura** (`lib/utils/reparto-liquidacion-mensajero.ts`) que ordena y trocea, más un método del servicio que lo APLICA bajo transacción | Un método que orqueste N llamadas a `registrarPagoMensajero` (§2.2) |
| D-B | **Todo o nada**: una transacción, N bloqueos de cierre tomados en el orden del reparto | Parcial-con-parte (N transacciones independientes) (§3.2) |
| D-C | El cierre se hace direccionable con **parámetro de búsqueda** `?cierre=<id>` en `/cierres-admin` | Ruta propia `/cierres-admin/[cierreId]` (§4.2) |
| D-D | La clave de idempotencia vive en una **tabla nueva `liquidacion_reparto`** con `UNIQUE(clave_idempotencia)`, insertada la primera dentro de la transacción | Derivar una clave por cierre sobre `liquidacion_pago.clave_idempotencia` (§5.2) |
| D-E | La previsualización la calcula el **servidor**, con la misma función pura, en una acción de solo lectura; el cliente solo pinta cadenas | Calcular el reparto en el diálogo a partir del listado de pendientes (§6.2) |
| D-F *(Q1)* | El FIFO ordena por **`solicitado_at`** (el día trabajado), desempate por `id` | Ordenar por `resuelto_at`, la fecha de aprobación (§2.4) |
| D-G *(Q2)* | Tope de **50** cierres por reparto, en `lib/config/reparto-mensajero.ts`, que **recorta la ventana** y responde `excede` con el disponible de esa ventana | Rechazar la operación al superar el tope (§2.5.3); y no poner tope (§2.5.4) |
| D-H *(Q4)* | **Una** captura de método/referencia/fecha, copiada literal en las N imputaciones | Pedir una referencia por cierre (§5.4.2) |
| D-I *(enmienda posterior)* | El aviso de cierres excluidos (R36) es un **conteo por estado**, agregado en la base y acotado por construcción | La **lista** de cierres excluidos con su id y su fecha, que es lo que R36 decía al aprobarse (§6.4) |

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

export interface RecorteVentana {         // enmienda Q2 — R53/R54/R56
  tope: number;             // el máximo que se aplicó (parámetro, no leído de config aquí)
  enVentana: number;        // cuántos cierres imputables entran
  fuera: number;            // cuántos quedan recortados
  montoFuera: string;       // Σ pendientes de los recortados, STRING 2 dec
}

export interface Reparto {
  imputaciones: Imputacion[];
  totalImputado: string;  // Σ montos
  imputable: string;      // Σ pendientes de la VENTANA — es el `disponible` de `excede`
  imputableTotal: string; // Σ pendientes de TODA la entrada imputable (para R37)
  sobrante: string;       // importe − totalImputado (> 0 solo si excede)
  recorte: RecorteVentana;
}

export function ordenarCierresFifo(cierres: readonly CierreImputable[]): CierreImputable[];
export function repartirEntreCierres(
  importe: string,
  cierres: readonly CierreImputable[],   // TODOS los imputables, sin recortar
  tope: number,                          // R53: entra por parámetro, nunca por `process.env`
): Reparto;
```

- `repartirEntreCierres` **ordena por su cuenta** (llama a `ordenarCierresFifo`): el criterio
  de R8 vive en el módulo puro y no en un `ORDER BY`, así que **el determinismo se prueba sin
  base de datos** (R17). El repositorio ordena igual por eficiencia, pero la verdad es esta.
- Comparador: `solicitadoAt` asc → `cierreId` asc. El segundo escalón no es adorno: sin él,
  dos cierres del mismo instante dan un orden que depende del motor (R8).
- Todo con `Prisma.Decimal`; salida `toFixed(2)`. Cero `Number(`/`parseFloat` (R16).
- Descarta las entradas con pendiente ≤ 0 y no emite imputaciones de 0 (R12).
- **La ventana se forma aquí**, no en el `WHERE` (enmienda Q2): la función recibe todos los
  imputables y el `tope`, corta los `tope` primeros del orden FIFO y reparte solo sobre ellos.
  Así el recorte se prueba sin base de datos (R17/R54) y `imputable`, `imputableTotal` y
  `recorte` salen de una sola pasada, coherentes entre sí por construcción.

**`LiquidacionService.registrarRepartoMensajero(input, actor)`** es quien lo aplica. El
esqueleto, en el orden en que importa:

1. **ROL** (`esAccesoTotal`), antes de tocar datos (R1/R4).
2. Abre **UNA** transacción.
3. Inserta la fila de `liquidacion_reparto`. Un choque de `clave_idempotencia` sale de la
   transacción con una señal interna y se responde fuera (§5.1) — mismo patrón que
   `ClaveRepetidaError` de la 172.
4. Lee los cierres imputables del mensajero **ordenados**, forma la **ventana** con los `tope`
   primeros y toma el **bloqueo de cada uno de la ventana** en ese orden (R21/R22/R55). Los
   recortados no se bloquean: no se van a tocar.
5. **Relee** el pendiente de cada cierre de la ventana bajo bloqueo y vuelve a llamar a
   `repartirEntreCierres` con esos valores (R23).
6. `sobrante > 0` → `excede` con el imputable **de la ventana** vigente, sin escribir (R14).
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

### 2.4 — La antigüedad que ordena el FIFO: `solicitado_at` (D-F, Q1 resuelta)

`cierre_dia` tiene dos marcas y no coinciden. Se ordena por **`solicitado_at` ascendente**, con
desempate por `id` ascendente. El motivo, escrito para que nadie lo revierta por intuición:

**`solicitado_at` es la fecha del TRABAJO, y el trabajo es lo que el mensajero percibe como
deuda.** «Todavía me deben el lunes» es una frase sobre el día trabajado, no sobre el día en que
un administrador tocó un botón.

**`resuelto_at` depende de la latencia administrativa.** Ordenar por él haría que el orden de
cobro dependiera del proceso interno: un admin que aprueba en orden raro —o que deja un cierre
del lunes trabado hasta el viernes— cambiaría **en silencio** la prioridad de cobro del
mensajero. Sería una decisión de negocio tomada por accidente, sin que nadie la escriba.

El desempate por `id` no es adorno: dos cierres con el mismo `solicitado_at` darían, sin él, un
orden que decide el motor, y R8 exige determinismo. El comparador vive en la función pura (§2.1),
no en el `ORDER BY`, para poder probarlo sin base de datos.

**Alternativa descartada — ordenar por `resuelto_at`.** Tiene un argumento a favor: es la fecha en
que la deuda quedó *confirmada*, y hasta que un cierre no se aprueba no ha devengado nada, así que
es el instante en que el pendiente empieza a existir. Se descarta porque hace que el orden de
cobro lo fije el proceso interno y no la deuda, que es exactamente lo que un mensajero no puede
verificar ni discutir. Cambiar de opinión cuesta una línea del comparador y sus tests: no arrastra
esquema.

### 2.5 — El tope de imputaciones (D-G, Q2 resuelta)

#### 2.5.1 — Qué hace

Un reparto toca **como mucho 50 cierres**. Si el mensajero tiene más cierres imputables, se
imputa sobre los **50 más antiguos** (el orden de §2.4) y el resto queda **recortado**: sigue
siendo deuda pagable, pero en otro reparto.

Al superarlo **no se rechaza nada**. Lo que cambia es de qué se calcula el disponible:

| Situación | Respuesta |
| --- | --- |
| importe ≤ imputable de la ventana | se aplica (R13) |
| importe > imputable de la ventana | **`excede`** con `disponible` = imputable de la ventana (R14) |
| no hay cierres imputables | `sin_saldo` (R15) |

**No hay estado de respuesta nuevo.** `excede` + `disponible` es exactamente la semántica que
`registrarPagoMensajero` ya tiene para un cierre (`LiquidacionService.ts:205-208`); lo único que
cambia es el conjunto sobre el que se mide el disponible. Reusarla mantiene el vocabulario de la
pantalla intacto (§7.2) y evita enseñar al operador una palabra nueva para una situación que ya
sabe resolver: teclear el disponible que le ofrecen.

**Cómo termina de pagar el operador.** Registra el reparto por el disponible de la ventana; al
volver, esos 50 cierres han quedado saldados, la ventana se vuelve a formar con los siguientes y
el resto entra. Dos repartos, dos comprobantes, ninguna deuda inalcanzable. Eso es lo que
convierte al tope en una cota de tamaño de transacción y no en un límite de negocio.

#### 2.5.2 — Dónde vive el número, y por qué el archivo NO se llama `liquidacion`

`lib/config/reparto-mensajero.ts`, patrón exacto de `lib/config/gasto-fijo.ts` /
`lib/config/wallet-mensajero.ts`: `readPositiveInt` sobre una variable de entorno con
`fallback`, más un `export const` ya cargado.

```ts
export interface RepartoMensajeroConfig {
  /** Máximo de cierres que UN reparto puede tocar (R53). */
  MAX_CIERRES_POR_REPARTO: number;   // REPARTO_MENSAJERO_MAX_CIERRES, por defecto 50
}
```

Por qué **50**: un cierre por día laborado, así que 50 son ~2 meses de trabajo seguido. Con pagos
semanales o quincenales no se acerca; con la deuda de un mensajero que lleva meses sin cobrar, el
tope corta y avisa en vez de abrir una transacción de 400 filas.

**El nombre del archivo no lleva `liquidacion`, y eso está medido.** El barrido money-safe
auto-captura *todo* archivo de `lib/**` cuya ruta case `/[Ll]iquidacion/`
(`liquidacion-money-safe.test.ts:140-146`) y prohíbe `parseInt(` en los censados
(`tests/fixtures/money-safe.ts:37-42`, con `\b` antes del nombre: `Number.parseInt(` **casa**).
Un `lib/config/liquidacion-reparto.ts` con el `readPositiveInt` del patrón pondría el barrido en
rojo por un **falso positivo**: ahí no hay ningún monto, hay un cardinal leído del entorno. En vez
de debilitar la guardia con una excepción, el módulo se queda fuera de su alcance por lo que es.
La aritmética de dinero sigue entera en `reparto-liquidacion-mensajero.ts`, que **sí** está
censado (§11). El módulo de config no importa `Prisma`, no toca ningún monto y solo exporta un
entero; hay un criterio de hecho en T0.4 que lo fija.

**El `tope` entra por parámetro** a la función pura y al servicio (§2.1): el módulo puro no lee
`process.env` —eso lo haría intestable y dependiente del entorno del runner— y el servicio recibe
el valor de config en su construcción, que es lo que permite a un test inyectar `tope: 2` y
ejercitar el recorte con tres cierres en vez de con cincuenta y uno (R53/R54).

#### 2.5.3 — Alternativa descartada: rechazar al superar el tope

Era la lectura literal de la pregunta: estado `demasiados_cierres` y a otra cosa. Se descarta
porque **es un callejón sin salida**: el operador ve que se le debe una cantidad, teclea, y el
sistema le dice que no sin ofrecerle ninguna acción que lo desbloquee. El único camino sería
pagar por otra pantalla, cierre a cierre, que es exactamente lo que esta feature existe para
evitar. Un tope que acota y avisa consigue la misma cota de transacción sin dejar a nadie
encerrado. Coste de haberla elegido: un estado de respuesta más en el contrato y una pantalla que
tiene que explicarlo.

#### 2.5.4 — Alternativa descartada: no poner tope (lo que decía §10.1)

Lo escrito antes de la respuesta: sin tope, con el riesgo declarado. Se descarta porque el
argumento que lo sostenía —«`N` está acotado en la práctica por el importe»— **es circular**: es
verdad para un importe pequeño y falso justo en el caso que preocupa, el operador que salda meses
de deuda de una vez. Sin tope, la cota de la transacción la fija el usuario al teclear.

#### 2.5.5 — La ventana se fija al bloquear

La ventana se calcula sobre la lectura previa y se **congela** al tomar los bloqueos. Si entre
esa lectura y el bloqueo un cierre de la ventana deja de estar `aprobado` o queda en pendiente 0,
la ventana **se encoge** (R24): no se sube al cierre 51 para rellenar el hueco. Es deliberado —
subir uno obligaría a bloquear un cierre que no se bloqueó al principio, es decir, a adquirir
bloqueos fuera del orden acordado (§3.1), que es como se fabrican los interbloqueos. El precio es
un reparto que toca 49 en vez de 50; la ganancia es que el conjunto bloqueado nunca crece a mitad
de la operación.

#### 2.5.6 — El tope acota la ESCRITURA, no la LECTURA

`listarCierresImputables` **no** lleva `LIMIT`: la previsualización necesita todos los imputables
para poder decir `imputableTotal`, cuántos quedan fuera y cuánto suman (R56), y el aviso de deuda
no imputable de R37 se mide contra el total, no contra la ventana. Son filas de `cierre_dia` de
un solo mensajero, leídas sin bloqueo; lo que había que acotar era la transacción de escritura y
el número de bloqueos, y eso lo acota la ventana (R55).

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

### 5.4 Método, referencia y fecha: una captura, copiada en las N (D-H, Q4 resuelta)

#### 5.4.1 — Qué se hace y por qué

El formulario pide **una** vez el método, la referencia y la fecha de pago, y el servicio los
copia **literales** en las N filas de `liquidacion_pago` del reparto (R58).

El motivo no es economía de tecleo: **es la verdad**. Hubo una sola transferencia y un solo
número de comprobante. Inventar una referencia por cierre —`REF-1/3`, un sufijo, un uuid—
fabricaría un dato que no existe en ningún extracto bancario y que nadie podría cotejar contra
nada. Y la repetición **favorece** la conciliación en vez de estorbarla: se busca la referencia y
aparecen las N imputaciones que esa transferencia saldó, que es justo la pregunta que alguien se
hace al conciliar.

Consecuencias, escritas para que no sorprendan:

- El libro del mensajero mostrará N líneas con la **misma** descripción (`"SINPE · 1234567"`,
  `lib/utils/descripcion-pago.ts:34`). Se distinguen por su `origen_id`, que es el id del pago y
  es distinto en cada una; el índice único parcial de `pago_mensajero_movimiento`
  (`origen_tipo, origen_id, mensajero_id, categoria`) no se ve afectado, porque el `origen_id`
  difiere fila a fila.
- La lista de comprobantes mostrará N filas con la misma referencia y montos que suman el
  importe transferido.

#### 5.4.2 — Alternativa descartada: una referencia por cierre

Obligaría al formulario a pedir N referencias —N que el usuario no conoce hasta que ve la
previsualización— y convertiría el reparto en N actos con N datos distintos, deshaciendo la
premisa de la feature (un pago, un comprobante). Se descarta por eso y porque el dato no existe.

#### 5.4.3 — Verificación pendiente, NO decisión (tarea T0.5)

Copiar la referencia crea, por primera vez, **N filas de `liquidacion_pago` con la misma
`referencia`**. Antes de escribir el reparto hay que comprobar que nada del árbol dé por hecho
que esa columna es única o 1:1 por pago: una constraint `UNIQUE`, un `findFirst`/`findUnique` por
referencia, o una consulta de conciliación que asuma un pago por referencia se romperían —o, peor,
devolverían una de las N en silencio.

Lo que ya se miró al escribir esta enmienda, para que la tarea empiece donde esto acaba y no lo
repita: `liquidacion_pago.referencia` es `String?` **sin `@unique`** (`db/schema.prisma:1316`) y
`LiquidacionPagoRepository` no tiene ningún `where` por `referencia` (sus tres lecturas puntuales
son `findUnique` por `id` de cierre o de pago, `:186`, `:248`, `:257`). Eso es indicio, **no
prueba**: falta barrer servicios, acciones, descargas, guardias, `scripts/**` y tests.

**Si aparece algo que asuma unicidad, se para y se reporta.** No se cambia por cuenta propia:
tocar una constraint o una consulta de conciliación es una decisión de otra persona.

---

## §6 — Previsualización derivada del servidor (D-E)

### 6.1 Lo elegido: una acción de solo lectura que usa la MISMA función pura

`previsualizarRepartoMensajeroAction({ mensajeroId, monto? })`:

- **sin `monto`**: devuelve el conjunto imputable (cierres con su pendiente), el `imputable`
  **de la ventana**, el `imputableTotal`, el `recorte` (R56), la `cuentaPorPagar` del mensajero,
  la `deudaNoImputable` (R37) y los `excluidos`. Es lo que alimenta el `disponible` con el que se
  abre el diálogo y decide si el botón está habilitado (R15).
- **con `monto`**: además, las `imputaciones` que produciría, el `sobrante` y `excede`
  (R32/R33/R38).
- El **mismo tope** que usa la escritura (R57): el servicio lo recibe una vez en su construcción
  y lo pasa a la función pura por los dos caminos. No hay dos números que puedan divergir.
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

### 6.4 — El aviso de excluidos es un CONTEO por estado (D-I, enmienda posterior)

> **Cronología, dicha a propósito.** Esta decisión **no** venía en el spec aprobado. R36 se
> escribió y se implementó como una **lista** —una fila por cierre excluido, con su `cierreId` y su
> `solicitadoAt` «para nombrarlo en pantalla»—, y fue al construirla cuando salió el problema:
> *esa lista no tiene tope*. Se reportó como decisión de negocio pendiente
> (`progress/impl_205_tandas3y4.md > HUECO DEL SPEC`), el humano la cerró el mismo día —conteo por
> estado— y el código y los tests se cambiaron entonces. **El spec se quedó sin plegar**, y el
> reviewer lo bloqueó por eso: R36 exigía una conducta y sus tests verificaban otra. Esta sección
> y la §J de `requirements.md` cierran ese desfase; no abren nada nuevo.

#### Lo elegido

`previsualizarRepartoMensajero` devuelve `excluidos: ExcluidosPorEstadoDTO[]` (§7.2): **una entrada
por estado** que tenga al menos un cierre no aprobado, con su `cantidad`. Nunca una fila por cierre.
El agregado lo hace la **base de datos**, no el servidor en memoria: lo que hay que acotar no es lo
que se devuelve, es lo que se **lee**.

Lo que hace correcta a esta forma es que queda acotada **por construcción**: el tamaño de la
respuesta depende del número de valores de `CierreEstado` —un puñado, y cerrado por el enum—, no
del número de cierres del mensajero. Por eso no hay `take`, ni recorte, ni tope: no hace falta
ninguno, y no hay ningún número que pueda quedarse corto el día que un mensajero acumule historial.

#### Alternativa descartada: la lista de cierres excluidos (lo que decía R36 al aprobarse)

Era la lectura literal del requisito y es la que se construyó primero. Se descarta porque **no
tiene cota**: la previsualización se pide en cada tecleo del importe, y un mensajero con dos años
de cierres rechazados se llevaría *todos* sus cierres —id y fecha, uno a uno— al diálogo, cada vez.
Ponerle un tope arbitrario («los 20 últimos») no arregla nada: convierte un aviso que dice la
verdad en uno que la dice a medias y sin manera de saber cuánto se calló. El conteo da la misma
información útil —hay dinero que esta pantalla no está pagando, y por qué— con una respuesta que
no puede crecer.

#### El precio, escrito para que no sorprenda

**Se pierde poder nombrar un cierre concreto en el aviso.** Antes viajaba el `solicitadoAt` de cada
excluido justamente para eso, y ya no viaja. Quien necesite el detalle —qué cierre, de qué día, por
qué se rechazó— abre `/cierres-admin`, que es adonde lleva el enlace que construye **T6** (R39,
R43, R44). El aviso informa; el **inventario** vive en la pantalla que existe para eso.

Consecuencia práctica: el aviso tampoco deriva un total («12 cierres quedan fuera»). Sumar los
`cantidad` sería aritmética en el cliente, y aunque sean cardinales y no dinero, la regla de esta
pantalla es que **no se deriva nada**. El texto enumera los estados con su cifra tal cual llegan.

#### Que nadie lo revierta por intuición

Devolver otra vez `cierreId`/`solicitadoAt` «para poder nombrarlos» **deshace esta decisión, no
arregla un olvido**. Está escrito en los dos docstrings del código (el DTO del repositorio y el del
borde) y hay **dos tests estructurales** que se ponen rojos si esos campos reaparecen — uno sobre el
módulo de tipos y otro sobre la forma de la respuesta del servicio (§12, fila de R36).

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

type ExcluidosPorEstadoDTO = { estado: CierreEstado; cantidad: number };
// R36 (enmienda posterior, §6.4): es un CONTEO por estado, UNA entrada por estado que tenga al
// menos un cierre — jamás una fila por cierre. `cantidad` es un CARDINAL (cuenta cierres, no
// dinero) y por eso viaja como `number`, igual que los tres del recorte.
// NO lleva `cierreId` ni `solicitadoAt`: el aviso informa, no inventaría, y el detalle vive en
// `/cierres-admin` (§6.4). NO lleva importe, y tampoco es un olvido (§10.2): un cierre no
// aprobado no ha devengado nada todavía y la 172 (R28) enseña `null` para su pendiente a
// propósito; inventar aquí una cifra lo contradiría.

type RecorteDTO = {          // enmienda Q2 — R56. El cliente lo PINTA, no lo deduce.
  aplicado: boolean;         // hay cierres imputables fuera de la ventana
  tope: number;              // el máximo vigente, para poder decirlo en pantalla
  enVentana: number;         // cuántos cierres entran
  fuera: number;             // cuántos quedan fuera
  montoFuera: string;        // STRING 2 dec — cuánto suman los que quedan fuera
};

type PrevisualizacionRepartoDTO = {
  mensajeroNombre: string;   // NOMBRE, nunca el id de la persona (R48)
  imputable: string;         // el de la VENTANA: es el `disponible` del diálogo (R14/R38)
  imputableTotal: string;    // el de TODOS los imputables (imputable + recorte.montoFuera)
  cuentaPorPagar: string;    // para la advertencia de R37
  deudaNoImputable: {        // R37 ya resuelto en el servidor: el cliente no compara importes
    hay: boolean;            // imputableTotal < cuentaPorPagar
    monto: string;           // STRING 2 dec — la parte que esta pantalla no puede imputar
  };
  recorte: RecorteDTO;       // R56 — distinto y separado del aviso de arriba
  imputaciones: ImputacionPrevistaDTO[];
  sobrante: string;
  excede: boolean;
  excluidos: ExcluidosPorEstadoDTO[];  // R36 — CONTEO por estado, jamás la lista de cierres
};

type RepartoAplicadoDTO = {
  totalImputado: string;
  restanteImputable: string;  // lo que SIGUE debiéndose por cierres tras el reparto: el TOTAL
                              // imputable, no el de la ventana. Tras un reparto con recorte es
                              // > 0 a propósito, y es lo que dice que hay que registrar otro.
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

**Los dos avisos son dos líneas distintas** (R56 exige distinguirlos, y confundirlos sería
mentir sobre qué se puede cobrar y cuándo):

- **Recorte por tope** — «Este pago alcanza a los {enVentana} cierres más antiguos. Quedan
  {fuera} cierres por ₡{montoFuera}, que se pagan en el siguiente registro.» Es deuda **pagable**
  aquí mismo, en otro acto.
- **Deuda no imputable (R37)** — «₡{monto} de la cuenta por pagar no corresponde a ningún cierre
  y no puede pagarse desde esta pantalla.» Es deuda que esta feature **no** sabe pagar (§10.2).

El texto final lo fija el implementer en el módulo de labels; lo que no puede es fundir los dos
en un solo mensaje ni omitir las cifras.

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

1. **Tamaño de la transacción (Q2) — ACOTADO desde la enmienda.** `2·N + 1` filas en una
   transacción interactiva, con `N ≤ 50` (§2.5). El límite que decía «no hay tope duro» queda
   derogado: ahora la cota no la fija el importe que teclee el usuario, la fija la configuración.
   Lo que queda declarado es el techo: un reparto lleno son 101 filas y 50 bloqueos de fila en
   una transacción. Si algún día ese techo resulta caro, se baja `REPARTO_MENSAJERO_MAX_CIERRES`
   sin desplegar código.
2. **Deuda no imputable (Q5) — medida, no supuesta.** `imputableTotal` puede ser menor que
   `cuentaPorPagar` si hay movimientos en el libro que no cuelgan de ningún cierre
   (`origen_tipo = 'manual'`, con categorías `ajuste_devengo`/`ajuste_pago`). Se **advierte**
   (R37) y no se paga: pagarla exigiría un pago sin cierre, es decir romper R21 de la 172.

   **Medición contra producción, 2026-08-11:** en `pago_mensajero_movimiento` hay **cero**
   movimientos con `origen_tipo = 'manual'`. Control de que la consulta no miente por tabla
   vacía: la tabla tiene 11 filas — 10 de `cierre_dia` por ₡46.025,90 y 1 de `pago_mensajero`
   por ₡1.800,00.

   **Por qué ese `origen_tipo` es la sonda correcta** (y no `categoria`, donde viven los nombres
   `ajuste_devengo`/`ajuste_pago`): al libro solo entran tres orígenes —`cierre_dia` (devengo `P`
   + pago `min(P,E)` al aprobar), `pago_mensajero` (que por R21 de la 172 **siempre** cuelga de un
   cierre) y `manual`, el único con `origen_id` NULL (`db/schema.prisma:1269`)—. Como
   `cuentaPorPagar = Σ devengo − Σ pago` y el pendiente de un cierre es
   `P − min(P,E) − Σ pagos vigentes` (`lib/utils/pendiente-cierre.ts:28`), las dos cifras
   coinciden **exactamente** salvo por lo que entró como `manual`. Cero manuales ⇒ cero deuda no
   imputable. El nombre de la categoría no cambia esa cuenta: cambia cómo se etiqueta la fila.

   **Y el límite de esa medición, con honestidad:** 11 filas son muy poco dato productivo. Lo
   correcto es afirmar «esto **no existe hoy**», no «no existirá nunca». Por eso R37 no se
   elimina aunque la cifra medida sea cero: el aviso es la red que hace visible el día en que
   alguien empiece a usar los ajustes manuales, en vez de dejar una diferencia callada entre lo
   que la fila dice que se debe y lo que esta pantalla sabe pagar.

   **Qué hacer si eso ocurre** (para quien lo lea con el aviso ya en pantalla): (a) confirmar con
   la misma consulta que los `manual` existen y en qué volumen; (b) NO abrir aquí una vía para
   pagarlos — seguiría rompiendo R21; (c) abrir ficha propia que decida el modelo, que es una
   decisión de negocio y no de implementación: o el ajuste manual pasa a colgar de un cierre, o
   se admite un pago sin cierre con su propio documento y su propia auditoría. La medición de
   este día es el punto de partida para saber si el problema creció.
3. **Los importes agregados siguen siendo brutos.** La fila de la tabla suma pagos anulados y
   sus reversos en «Devengado» y «Pagado» (aviso N1 de la 172, ya en pantalla). El `imputable`
   de esta feature **no** hereda ese problema: se deriva de pagos **vigentes** (R7).
4. **La previsualización caduca.** Entre verla y confirmar puede cambiar el estado; se resuelve
   recalculando bajo bloqueo (§6.1), no congelando la previsualización.
5. **Anular un reparto es anular sus pagos, uno a uno (Q3) — fuera de alcance, confirmado.**
   Deshacer un reparto de 4 imputaciones son 4 anulaciones con 4 motivos.

   **Por qué es aceptable:** no es un fallo de corrección. Cada anulación escribe su
   contraasiento en el libro (172, §6.2) y el dinero termina exactamente donde debe; el pendiente
   de cada cierre vuelve a su sitio porque se deriva de pagos vigentes (R7). Lo que sobra es
   **incomodidad**: cuatro diálogos en vez de uno. Se paga esa incomodidad a cambio de no
   inventar aquí una operación de anulación en bloque cuyo caso difícil —una de las cuatro ya
   anulada a mano, con otro motivo y otra fecha— exige decisiones que nadie ha tomado.

   **La puerta queda abierta, y esto es lo importante:** `liquidacion_pago.reparto_id` (§1.2) es
   lo que permitirá agruparlas el día que se haga, sin migración de datos ni arqueología —
   `WHERE reparto_id = …` devuelve el grupo entero. Si no existiera esa columna, «anular el
   reparto» sería irreconstruible después. Va **ficha aparte, sin urgencia**.
6. **La referencia se repetirá en N comprobantes (Q4).** Decidido y explicado en §5.4; queda como
   límite declarado porque cambia lo que ve quien lee la lista de comprobantes. La comprobación
   de que nada del árbol asume unicidad es la tarea T0.5, y su desenlace «parar y reportar» está
   escrito en §5.4.3.

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

**No entra, y no por olvido:** `lib/config/reparto-mensajero.ts`. Su ruta no casa
`/[Ll]iquidacion/` **a propósito** (§2.5.2): no maneja ningún monto —exporta un cardinal leído
del entorno— y el `Number.parseInt` del patrón de config casaría con `/\bparseInt\s*\(/`, que es
la prohibición de dinero del barrido. Meterlo dejaría dos opciones malas: el barrido en rojo por
un falso positivo, o una excepción dentro de la guardia. La aritmética de dinero de esta feature
está entera en `reparto-liquidacion-mensajero.ts`, que sí está censado.

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
| R8, R17 | `tests/unit/utils/reparto-liquidacion-mensajero.test.ts` (FIFO por `solicitadoAt` + desempate por id, sin DB; y un caso donde `resueltoAt` daría otro orden y **no** lo cambia) |
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
| R36 | *(enmienda §6.4: CONTEO por estado, no lista)* `tests/unit/repositories/liquidacion-pago-repository.test.ts` (el agregado ocurre en la BASE: `groupBy` por `estado` con el complemento exacto de `aprobado`, `findMany` ni una vez, sin ninguna columna de dinero) + `tests/unit/services/liquidacion-reparto-service.test.ts` (cada excluido tiene exactamente las claves `estado` y `cantidad`; con 900 rechazados sigue siendo UNA entrada, sin `cierreId` ni `solicitadoAt`) + `tests/unit/types/liquidacion-reparto-schema.test.ts` (estructural: `ExcluidosPorEstadoDTO` declara esos dos campos y ninguno más — es el test que impide revertir la decisión) + `tests/components/RepartoPrevisualizacion.test.tsx` (la pantalla pinta el conteo con su rótulo por estado y no deriva ningún total) |
| R37 | `RepartoPrevisualizacion.test.tsx` (aviso de deuda no imputable con su cifra ya comparada en el servidor) |
| R39, R40, R45 | `tests/components/CierresAdminDeepLink.test.tsx` (`?cierre=` abre el detalle; cerrarlo limpia la URL) |
| R41, R42 | `CierresAdminDeepLink.test.tsx` (id inexistente ⇒ aviso sin datos; rol sin acceso ⇒ el guard de la página manda) |
| R43, R44 | `tests/components/DesglosePagosMensajero.test.tsx` (fila con cierre ⇒ enlace; fila sin cierre ⇒ sin enlace) |
| R46, R48 | `tests/unit/types/liquidacion-reparto-schema.test.ts` (todos los importes `string`; sin ids de persona) + el caso existente de los 9 campos de `PagoRegistradoDTO` |
| R49 | `tests/integration/db/liquidacion-reparto-migration.test.ts` (columnas, FK, `UNIQUE`, `CHECK`, RLS, y `down.sql` deja el esquema idéntico) |
| R51 | `tests/unit/services/liquidacion-service.test.ts` **sin tocar un solo assert** + equivalencia reparto-de-un-cierre ↔ pago simple |
| R52 | `tests/unit/actions/liquidacion-action.test.ts:609` (la lista exacta de exportaciones, ampliada a siete; ninguna se llama editar/actualizar/modificar/corregir/desanular) |
| R53 | `tests/unit/config/reparto-mensajero-config.test.ts` (por defecto 50; la variable de entorno lo cambia; un valor basura cae al defecto) + `reparto-liquidacion-mensajero.test.ts` (el `tope` es parámetro: el módulo puro no lee `process.env`) |
| R54 | `reparto-liquidacion-mensajero.test.ts` (3 cierres con `tope: 2` ⇒ ventana de 2, reparto válido y **ningún** rechazo) + `liquidacion-reparto-service.test.ts` (importe que cabe en la ventana ⇒ `ok`, con más cierres imputables de los que toca) |
| R55 | `liquidacion-reparto-bloqueos.guardia.test.ts` (con `tope: 2` y 5 imputables: 2 bloqueos, 2 pagos, 2 movimientos; los otros 3 cierres no se bloquean ni se tocan) |
| R56 | `RepartoPrevisualizacion.test.tsx` (con `recorte.aplicado` pinta cuántos entran, cuántos quedan fuera y su suma) + `liquidacion-reparto-service.test.ts` (el `recorte` sale del servidor con las tres cifras) |
| R57 | `liquidacion-reparto-service.test.ts` (previsualizar y aplicar con el MISMO servicio dan la misma ventana; el tope entra una sola vez por construcción) |
| R58 | `liquidacion-reparto-service.test.ts` (3 imputaciones ⇒ 3 pagos con idéntico `metodo`, `referencia` y `fechaPago`, y 3 descripciones de libro iguales con `origen_id` distinto) |
