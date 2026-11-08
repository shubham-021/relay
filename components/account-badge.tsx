import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const ACCOUNT_PALETTE = [
  { dot: "bg-violet-400", text: "text-violet-400", ring: "bg-violet-500/10 border-violet-500/25" },
  { dot: "bg-sky-400", text: "text-sky-400", ring: "bg-sky-500/10 border-sky-500/25" },
  { dot: "bg-emerald-400", text: "text-emerald-400", ring: "bg-emerald-500/10 border-emerald-500/25" },
  { dot: "bg-amber-400", text: "text-amber-400", ring: "bg-amber-500/10 border-amber-500/25" },
  { dot: "bg-rose-400", text: "text-rose-400", ring: "bg-rose-500/10 border-rose-500/25" },
  { dot: "bg-indigo-400", text: "text-indigo-400", ring: "bg-indigo-500/10 border-indigo-500/25" },
] as const;

function getAccountColor(accountId: number) {
  return ACCOUNT_PALETTE[accountId % ACCOUNT_PALETTE.length];
}

function emailLabel(email: string): string {
  return email && email.length > 0 ? email.charAt(0).toUpperCase() : "?";
}

interface AccountBadgeProps {
  accountId: number;
  email: string;
  variant?: "overlay" | "inline";
}

export function AccountBadge({ accountId, email, variant = "inline" }: AccountBadgeProps) {
  const color = getAccountColor(accountId);
  const letter = emailLabel(email);

  if (variant === "overlay") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={`inline-flex items-center justify-center w-5 h-5 text-[11px] font-bold rounded border backdrop-blur-md shadow-sm ${color.ring} ${color.text} bg-black/40`}>
            {letter}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          TorBox: {email}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={`inline-flex items-center justify-center w-4 h-4 text-[10px] font-bold rounded border ${color.ring} ${color.text} bg-background/50`}>
          {letter}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        TorBox: {email}
      </TooltipContent>
    </Tooltip>
  );
}
