"use client";

import React from "react";

const Page = () => {
  return (
    <div className="space-y-6 overflow-y-auto">
      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-4 rounded-md border bg-white p-4">
          <p className="text-sm font-medium">Connected Users</p>
        </div>
        <div className="space-y-4 rounded-md border bg-white p-4">
          <p className="text-sm font-medium"></p>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-6">
        <div className="space-y-4 rounded-md border bg-white p-4">
          <p className="text-sm font-medium"></p>
        </div>
        <div className="col-span-2 space-y-4 rounded-md border bg-white p-4">
          <p className="text-sm font-medium"></p>
        </div>
      </div>
    </div>
  );
};

export default Page;
