import type { Metadata } from "next";
import { FindsDirectPartners } from "@/components/roamly/FindsDirectPartners";

export const metadata: Metadata = {
  title: "Roamly Finds",
  description: "Start with trusted travel partners for stays, flights, activities, gear, and eSIMs."
};

export const dynamic = "force-dynamic";

export default function FindsPage() {
  return (
    <main className="min-h-[75vh] bg-[#fbfaf6] px-4 pb-12 pt-8 text-[#203c43] sm:px-8 sm:pb-16 sm:pt-12">
      <FindsDirectPartners />
    </main>
  );
}
