import { AdminNav } from "@/components/admin/AdminNav";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto grid w-full max-w-7xl gap-5 px-4 py-6 sm:px-6 lg:grid-cols-[15rem_1fr]">
      <aside className="lg:pt-2">
        <AdminNav />
      </aside>
      <div>{children}</div>
    </div>
  );
}
