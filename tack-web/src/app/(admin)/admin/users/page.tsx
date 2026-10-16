"use client";

import { UserCheck, UserPlus, Users, UserStar } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { toast } from "sonner";

import { InviteUser, STATUS_OPTIONS, ROLE_OPTIONS, useConfirm } from "@/components/admin";
import { ButtonGroup, DataTable, Statistics } from "@/components/shared";
import type { BulkResult, Page as ListPage, UserStats } from "@/types/admin";
import { periodLabel, selectedIds, statItem } from "@/lib/admin";
import { useTableParams } from "@/hooks/use-table-params";
import { useApiMutation, useApiQuery } from "@/lib/query";
import { createUserColumns } from "@/config/columns/user";
import { Button } from "@/components/ui/button";
import { useValues } from "@/hooks/use-values";
import { PERIODS } from "@/config/params";
import type { User } from "@/types/user";

const KEYS = [
  ["admin", "users"],
  ["admin", "user"],
];

const Page = () => {
  const { onValueChange, values } = useValues({ period: PERIODS[0].value });
  const { params, tableProps, rowSelection, clearSelection } = useTableParams();
  const router = useRouter();
  const { dialog, confirm } = useConfirm();

  const stats = useApiQuery<UserStats>({
    keys: ["admin", "users", "stats"],
    url: "/api/admin/users/stats",
    params: { period: values.period },
  });
  const list = useApiQuery<ListPage<User>>({
    keys: ["admin", "users", "list"],
    url: "/api/admin/users",
    params,
  });

  const update = useApiMutation<{ id: string; status: string }>({
    keys: KEYS,
    method: "patch",
    url: ({ id }) => `/api/admin/users/${id}`,
    successMessage: "User updated",
  });
  const sendReset = useApiMutation<{ id: string }>({
    keys: KEYS,
    method: "post",
    url: ({ id }) => `/api/admin/users/${id}/reset-password`,
    successMessage: "Reset link sent",
  });
  const remove = useApiMutation<{ id: string }>({
    keys: KEYS,
    method: "delete",
    url: ({ id }) => `/api/admin/users/${id}`,
    successMessage: "User deleted",
  });
  const bulk = useApiMutation<{ ids: string[]; action: string }, BulkResult>({
    keys: KEYS,
    method: "post",
    url: "/api/admin/users/bulk",
    successMessage: false,
  });

  const runBulk = (action: "activate" | "suspend" | "delete") =>
    bulk.mutate(
      { ids: selectedIds(rowSelection), action },
      {
        onSuccess: (result) => {
          clearSelection();
          const skipped = result.skipped ?? [];
          toast.success(`${result.updated.length} updated`, {
            description: skipped.length
              ? `${skipped.length} skipped: ${[...new Set(skipped.map((s) => s.reason))].join("; ")}`
              : undefined,
          });
        },
      },
    );

  const columns = useMemo(
    () =>
      createUserColumns({
        onView: (user) => router.push(`/admin/users/${user.id}`),
        onSetStatus: (user, status) => update.mutate({ id: user.id, status }),
        onSendReset: (user) => sendReset.mutate({ id: user.id }),
        onDelete: (user) =>
          confirm({
            title: `Delete ${user.name}?`,
            description:
              "They're signed out everywhere and can't sign in again. Boards they own are kept.",
            confirmLabel: "Delete",
            destructive: true,
            onConfirm: () => remove.mutate({ id: user.id }),
          }),
      }),
    // The router and the mutations' `mutate` functions are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const against = `the previous ${periodLabel(values.period)}`;
  const s = stats.data;

  return (
    <div className="space-y-6 overflow-y-auto">
      <Statistics
        items={
          s
            ? [
                statItem(Users, "Total Users", s.totalUsers, against),
                statItem(UserCheck, "Active Users", s.monthlyActiveUsers, against),
                statItem(UserStar, "Unique Visitors", s.monthlyUniqueUsers, against),
                statItem(UserPlus, "New Users", s.monthlyNewUsers, against),
              ]
            : []
        }
        isLoading={stats.isPending}
      />
      <div className="flex w-full items-center justify-between">
        <InviteUser />
        <ButtonGroup
          onValueChange={(value) => onValueChange("period", value)}
          options={PERIODS}
          value={values.period}
        />
      </div>
      <DataTable
        {...tableProps}
        columns={columns}
        data={list.data?.data ?? []}
        total={list.data?.total ?? 0}
        getRowId={(user) => user.id}
        filters={[
          { key: "status", label: "Status", options: STATUS_OPTIONS, type: "checkbox" },
          { key: "role", label: "Role", options: ROLE_OPTIONS, type: "checkbox" },
        ]}
        selectionActions={
          <>
            <Button onClick={() => runBulk("activate")} size="sm" variant="outline">
              Activate
            </Button>
            <Button onClick={() => runBulk("suspend")} size="sm" variant="outline">
              Suspend
            </Button>
            <Button
              onClick={() =>
                confirm({
                  title: `Delete ${selectedIds(rowSelection).length} users?`,
                  description: "They're signed out everywhere and can't sign in again.",
                  confirmLabel: "Delete",
                  destructive: true,
                  onConfirm: () => runBulk("delete"),
                })
              }
              size="sm"
              variant="destructive"
            >
              Delete
            </Button>
          </>
        }
        showPageSizeChange
      />
      {dialog}
    </div>
  );
};

export default Page;
