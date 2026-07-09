import type { ReactNode } from "react";
import { Sidebar } from "./_components/Sidebar";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col md:flex-row">
      <Sidebar />
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
