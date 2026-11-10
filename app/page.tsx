import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { Sidebar } from "@/components/sidebar";
import { FileBrowser } from "@/components/file-browser";

import { getAccountsByUserId, getUserById } from "@/lib/db";

export default async function HomePage() {
  const session = await getSession();

  if (!session.userId) {
    redirect("/login");
  }

  const user = getUserById(session.userId);
  const accounts = getAccountsByUserId(session.userId);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar username={user?.username} />
      <main className="flex-1 overflow-hidden flex flex-col">
        <FileBrowser
          userId={session.userId}
          playerProtocol={session.playerProtocol || "vlc"}
          hasAccounts={accounts.length > 0}
          accounts={accounts}
        />
      </main>

    </div>
  );
}
