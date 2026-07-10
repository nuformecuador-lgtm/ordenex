import { OrdenesModule } from "./_components/OrdenesModule";

export default function OrdenesPage() {
  return (
    <section className="flex flex-1 flex-col gap-6 p-6">
      <header className="flex flex-col gap-1 rounded-lg bg-navy px-5 py-4 text-white">
        <h1 className="text-2xl font-semibold tracking-tight">Órdenes</h1>
        <p className="text-sm text-white/70">
          Listado y gestión de órdenes
        </p>
      </header>
      <OrdenesModule />
    </section>
  );
}
