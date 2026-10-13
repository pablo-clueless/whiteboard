import { formatDistanceToNow } from "date-fns";

import type { AuditLog } from "@/types/admin";
import { EmptyNote } from "./panel";

/** "board.links_reset" → "Board links reset". */
export function actionLabel(action: string) {
  const text = action.replace(/[._]/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export const ActivityList = ({ items }: { items: AuditLog[] }) => {
  if (!items.length) return <EmptyNote>No activity yet.</EmptyNote>;
  return (
    <ul className="divide-y">
      {items.map((log) => (
        <li className="flex items-center justify-between gap-4 py-2 text-sm" key={log.id}>
          <div className="min-w-0">
            <p className="truncate font-medium">{actionLabel(log.action)}</p>
            <p className="text-muted-foreground truncate text-xs">
              {log.user} · {log.resource}
            </p>
          </div>
          <span
            className="text-muted-foreground shrink-0 text-xs"
            title={new Date(log.createdAt).toLocaleString()}
          >
            {formatDistanceToNow(new Date(log.createdAt), { addSuffix: true })}
          </span>
        </li>
      ))}
    </ul>
  );
};
