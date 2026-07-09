# Review - feature login

Fecha: 2026-07-08
Reviewer: subagente reviewer (SDD)

## Veredicto final

RECHAZADO (CAMBIOS REQUERIDOS) - hay 2 hallazgos bloqueantes. El resto de la
implementacion (modelo de datos, RBA, lockout, sesion, capas, trazabilidad R1-R24)
es solida y pasa verificacion ejecutable en verde.

## Checklist contra CHECKPOINTS.md

### Especificacion
- [x] specs/login/requirements.md con R1..R24 (incl. R10a, R21a, R23a) en formato EARS.
- [x] specs/login/design.md con alternativas descartadas y su porque (3 alternativas).
- [x] specs/login/tasks.md - todas las tasks marcadas [x], salvo T020 marcada [~]
      con nota de diferimiento explicita y justificada (falta de .env/DB real).

### Trazabilidad
- [x] Cada R<n> mapea a un test concreto en progress/impl_login.md. Verifique
      abriendo los tests citados (auth-service.test.ts, auth-action.test.ts,
      user-repository.test.ts, login-attempt-repository.test.ts,
      risk-engine.test.ts, auth-schemas.test.ts, session-repository.test.ts,
      user-repository-catalog.test.ts) y confirmo que los asserts corresponden
      realmente al requisito citado (no son tests vacios).
- [x] El mapa R<n> a test esta en progress/impl_login.md.

### Calidad de codigo
- [x] pnpm run typecheck - sin errores (reejecutado).
- [x] pnpm run lint - sin errores (reejecutado).
- [x] pnpm run test - 14 test files / 77 tests, todos en verde (reejecutado).
- [ ] BLOQUEANTE: no hay ningun test E2E (Playwright) que cubra el flujo de
      login, pese a ser un flujo critico de auth (CHECKPOINTS.md lo exige
      explicitamente). El unico spec en e2e/ es e2e/home.spec.ts, que solo
      verifica que la home carga (toHaveTitle(/Next/)); no toca login,
      verifyChallenge ni logout. Ver detalle en Hallazgos.

### Datos y seguridad (Supabase)
- [x] Las 6 tablas nuevas (usuario, login_attempt, trusted_device,
      email_otp_challenge, tipo_identificacion, rol) tienen
      ALTER TABLE ... ENABLE ROW LEVEL SECURITY en migration.sql, sin
      policies para anon/authenticated (defensa en profundidad, server-only
      access via Prisma/service role).
- [ ] BLOQUEANTE: el propio criterio "Hecho cuando" de T004 en tasks.md
      exige verificar que una query desde un cliente Supabase con key anon a
      cualquiera de las 6 tablas es rechazada. Esa verificacion nunca se
      ejecuto ni se documento como diferida (a diferencia de T020, que si quedo
      explicitamente marcada [~] DIFERIDA con justificacion). docs/verification.md
      exige igualmente verificar RLS con un test que intente acceder sin
      permiso y confirme el rechazo. No existe tal test, ni una nota de
      diferimiento equivalente a la de T020. Ver detalle en Hallazgos.
- [x] Migraciones versionadas y reversibles: migration.sql + down.sql
      correctos (drop en orden inverso de dependencias, no toca Session
      preexistente). pnpm run db:rollback (script) revisado y correcto en su
      logica; su ejecucion contra DB real esta diferida por T020 (aceptable:
      no hay .env/Supabase en este entorno, y init.sh solo advierte, no
      falla, por falta de .env).
- [x] Ningun secreto hardcodeado. Constantes de auth centralizadas en
      lib/config/auth.ts, sobreescribibles por entorno.
- [x] passwordHash nunca se expone: UserRepository.findByEmail/findById/create
      usan PUBLIC_SELECT sin passwordHash; solo findByEmailWithHash lo trae,
      y solo se usa dentro de AuthService. StubEmailProvider no loguea el
      codigo OTP en claro, solo metadata (destinatario, minutos de expiracion).
- N/A Webhooks: esta feature no introduce webhooks.

### Patron de capas
- [x] Controller (lib/actions/auth.ts) solo parsea con zod, arma contexto y
      delega a AuthService; no contiene queries ni logica de negocio.
- [x] AuthService no conoce HTTP (recibe ipAddress/userAgent como datos
      planos, no Request/headers).
- [x] Repositorios (UserRepository, LoginAttemptRepository,
      TrustedDeviceRepository, EmailOtpChallengeRepository,
      SessionRepository) solo ejecutan Prisma; la unica logica de dominio que
      se cuela en UserRepository.create es la validacion de FK de catalogo
      (R10), justificada explicitamente en las notas del implementer como
      necesaria para dar un error de dominio claro; es aceptable.
- [x] Interfaces en lib/interfaces/services, repositories y external.

### Permisos
- [x] middleware.ts verifica presencia de cookie de sesion para rutas
      protegidas y redirige a /login si falta.
- [~] Menor: el diseno declara que la validez por expiresAt (R23a) se
      resuelve server-side al leer la sesion, pero SessionRepository.findValidById
      (que implementa correctamente ese chequeo y esta bien testeado) no se
      invoca desde ningun punto de la aplicacion real: no hay paginas
      protegidas en app/ todavia (solo page.tsx, layout.tsx, publico) ni
      ningun Server Component/Server Action que llame a findValidById. R23a
      queda correctamente implementado pero sin punto de uso, no es
      explotable hoy porque no hay contenido protegido, pero debe verificarse
      que se conecte cuando se construyan paginas protegidas (probablemente en
      login-home o una feature posterior). No bloqueante para esta feature
      dado su alcance (backend/API), pero se deja como nota de seguimiento.
- N/A Componentes private/: no aplica a esta feature (sin UI).
- [x] Mutaciones (login, verifyChallenge, logout) son Server Actions, no
      rutas API fetcheadas desde cliente.

### Multi-pais y configuracion
- [x] Validacion de cedula/telefono (R10a) es generica (numerico + longitud
      min/max configurable via numericIdentifierSchema(min, max)), sin
      hardcode de pais/formato especifico.

### Verificacion final
- [x] init.sh termina en verde (reejecutado: typecheck OK, lint OK, test OK
      14/14 archivos, 77/77 tests; advierte por falta de .env, no falla).
- [ ] Este archivo (progress/review_login.md) existe; veredicto es
      RECHAZADO por los bloqueantes listados abajo (no puede ser OK).
- [ ] No se anadio entrada a progress/history.md (esperado: solo se anade
      cuando la feature pasa a done, y aun no puede pasar).

## Hallazgos

### BLOQUEANTE 1 - Falta test E2E del flujo critico de auth (login)
CHECKPOINTS.md exige un test E2E (Playwright) para flujos criticos como auth,
pagos, recaudo, ingesta de ordenes o webhooks. login es el ejemplo canonico
de flujo critico de auth. El unico archivo en e2e/ (e2e/home.spec.ts) no
ejercita login, verifyChallenge ni logout en absoluto.

Entiendo la tension de scope: tasks.md deliberadamente dejo la UI de login
fuera de esta feature (vive en login-home, status pending), por lo que hoy
no existe ninguna pagina /login real contra la cual Playwright pueda navegar
y enviar un formulario. Aun asi, esto no estaba resuelto ni documentado en
el spec/tasks: no hay una nota explicita (como si la hay para T020) que diga
que el E2E de este flujo se difiere a login-home porque ahi vive la UI, y
que se acepta el riesgo mientras tanto. Sin esa nota, el checkpoint no se
cumple y no se puede dar por bueno silenciosamente.

Que falta para resolverlo (a eleccion de la feature/leader):
- Opcion A (recomendada si el orden de features se mantiene): agregar
  explicitamente en specs/login/tasks.md (o en un adendum aprobado) una nota
  de diferimiento del E2E hacia login-home, analoga a la de T020, dejando
  constancia de que el E2E real se escribira cuando exista la UI, y que
  login-home no puede cerrarse sin ese E2E cubriendo login exitoso,
  credenciales invalidas, cuenta bloqueada y logout como minimo.
- Opcion B: agregar un E2E minimo ahora mismo que ejercite el flujo sin UI
  (por ejemplo una pagina de prueba temporal que invoque las Server Actions),
  de forma que exista evidencia end-to-end real antes de cerrar login.

### BLOQUEANTE 2 - Verificacion de RLS (T004) no ejecutada ni diferida explicitamente
tasks.md T004 declara como criterio de Hecho cuando: una query desde un
cliente Supabase con key anon a cualquiera de las 6 tablas es rechazada.
docs/verification.md es igual de explicito: verifica RLS con un test que
intente acceder sin permiso y confirme el rechazo. No existe tal test (ni
unitario simulando el rechazo, ni de integracion contra un Supabase real), y
progress/impl_login.md no menciona este punto como diferido. El
migration.sql si contiene los ENABLE ROW LEVEL SECURITY correctos para las
6 tablas (verificado por lectura de codigo), pero la tarea esta marcada [x]
sin evidencia de que se cumplio su propio criterio, y sin la nota de
diferimiento explicita que si se uso correctamente para T020.

Que falta para resolverlo:
- Como minimo, actualizar progress/impl_login.md y tasks.md para marcar
  esta verificacion como diferida por falta de entorno Supabase real (igual
  que T020), con la misma justificacion explicita.
- Idealmente, agregar un test de integracion (cuando haya .env/Supabase de
  prueba disponible) que efectivamente intente una query con la key anon
  contra usuario/login_attempt/etc. y confirme el rechazo, tal como pide
  docs/verification.md.

### Menor 1 - R23a implementado pero no conectado a ningun punto de la app real
SessionRepository.findValidById implementa y testea correctamente el
rechazo de sesiones expiradas (R23a), pero ningun codigo de produccion lo
invoca hoy: middleware.ts solo verifica presencia de la cookie (correcto y
consistente con el diseno, que reconoce la limitacion del edge runtime), y no
existe todavia ninguna pagina protegida ni Server Component que llame a
findValidById para validar la sesion server-side antes de servir contenido.
No es explotable hoy porque no hay contenido protegido en el repo, pero debe
verificarse que quede conectado cuando se construyan paginas o Server Actions
protegidas (probablemente en login-home u otra feature posterior).

### Menor 2 - OTP por email via StubEmailProvider (no hay envio real)
StubEmailProvider solo loguea metadata (destinatario y minutos de
expiracion), no envia un correo real. Esto es correcto en cuanto a no
loguear el codigo en claro (buena practica), y esta documentado
explicitamente como implementacion de arranque en el propio codigo y en
progress/impl_login.md. Sin embargo, implica que R17 (challenge OTP por
email) no es funcionalmente completable por un usuario real hasta que se
integre un proveedor real (Resend, SendGrid o SES). No bloqueante porque ni
requirements.md ni design.md exigen explicitamente una integracion de
proveedor real dentro del alcance de esta feature, pero se deja constancia
para que no se pierda como deuda tecnica.

### Menor 3 - T020 diferida: evaluacion
Aceptable. docs/verification.md exige aplicar y revertir migraciones en un
entorno de prueba, pero no hay .env/Supabase disponible en este entorno de
ejecucion, y init.sh trata la ausencia de .env como advertencia, no como
fallo. La nota de diferimiento en tasks.md e impl_login.md es explicita,
justificada y no oculta el problema. Recomiendo que quede como condicion de
despliegue: no se puede marcar login como verdaderamente done en produccion
hasta correr pnpm run db:rollback y pnpm run db:migrate contra una DB real
al menos una vez, pero no es bloqueante para este ciclo de revision dado que
es una limitacion de entorno, no de implementacion.

## Verificacion ejecutable reejecutada (evidencia)

pnpm run typecheck: tsc --noEmit, sin errores.
pnpm run lint: eslint, sin errores ni warnings.
pnpm run test: Test Files 14 passed (14), Tests 77 passed (77).
bash init.sh: node v22.13.1 OK, dependencias OK, typecheck OK, lint OK,
test OK (14/77), todas las migraciones tienen down.sql OK, advierte por
falta de .env (no falla), termina en init OK.

## Resumen para el implementer

El codigo y los tests unitarios e integracion estan bien hechos: trazabilidad
R1-R24 real (no vacia), capas separadas correctamente, RLS declarado en
migracion, migraciones up/down correctas, sin exposicion de passwordHash,
sin secretos hardcodeados, lockout y RBA fielmente implementados segun
design.md. Los dos bloqueantes son de verificacion faltante o no
documentada, no de logica de negocio incorrecta:

1. Falta test E2E (o, como minimo, una nota de diferimiento explicita y
   aprobada, analoga a T020) para el flujo critico de auth.
2. Falta verificar (o diferir explicitamente, analogo a T020) el rechazo de
   RLS para el rol anon, tal como exige el propio criterio de T004 y
   docs/verification.md.

No se requieren cambios en la logica de AuthService, RiskEngine,
repositorios ni Server Actions.
