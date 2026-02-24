"use client";
/* eslint-disable react-hooks/incompatible-library */

import * as React from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type ColumnDef,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

type DataTableProps<TData, TValue> = {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  emptyMessage?: string;
  searchPlaceholder?: string;
  enableSearch?: boolean;
  pageSize?: number;
  statusFilterKey?: string;
  dateFilterKey?: string;
  statusFilterLabel?: string;
  dateFilterLabel?: string;
  filtersInline?: boolean;
};

export function DataTable<TData, TValue>({
  columns,
  data,
  emptyMessage = "Kayıt bulunamadı.",
  searchPlaceholder = "Ara...",
  enableSearch = true,
  pageSize = 10,
  statusFilterKey,
  dateFilterKey,
  statusFilterLabel = "Durum",
  dateFilterLabel = "Tarih Aralığı",
  filtersInline = false,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = React.useState("");
  const [statusFilterValue, setStatusFilterValue] = React.useState("all");
  const [dateFrom, setDateFrom] = React.useState<Date | undefined>(undefined);
  const [dateTo, setDateTo] = React.useState<Date | undefined>(undefined);

  const getRowValue = React.useCallback((row: TData, key: string) => {
    if (!row || typeof row !== "object") {
      return undefined;
    }

    return (row as Record<string, unknown>)[key];
  }, []);

  const parseDateValue = React.useCallback((value: unknown) => {
    if (value === null || value === undefined || value === "") {
      return null;
    }

    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
    }

    if (typeof value === "number") {
      const milliseconds = value > 1_000_000_000_000 ? value : value * 1000;
      const date = new Date(milliseconds);
      return Number.isNaN(date.getTime()) ? null : date;
    }

    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? null : date;
  }, []);

  const dateFilteredData = React.useMemo(() => {
    if (!dateFilterKey || (!dateFrom && !dateTo)) {
      return data;
    }

    const fromDate = dateFrom
      ? (() => {
          const value = new Date(dateFrom);
          value.setHours(0, 0, 0, 0);
          return value;
        })()
      : null;

    const toDate = dateTo
      ? (() => {
          const value = new Date(dateTo);
          value.setHours(23, 59, 59, 999);
          return value;
        })()
      : null;

    return data.filter((row) => {
      const raw = getRowValue(row, dateFilterKey);
      const rowDate = parseDateValue(raw);

      if (!rowDate) {
        return false;
      }

      if (fromDate && rowDate < fromDate) {
        return false;
      }

      if (toDate && rowDate > toDate) {
        return false;
      }

      return true;
    });
  }, [data, dateFilterKey, dateFrom, dateTo, getRowValue, parseDateValue]);

  const statusOptions = React.useMemo(() => {
    if (!statusFilterKey) {
      return [];
    }

    const values = new Set<string>();

    for (const row of dateFilteredData) {
      const raw = getRowValue(row, statusFilterKey);
      const value = raw === null || raw === undefined ? "" : String(raw).trim();
      if (value) {
        values.add(value);
      }
    }

    return Array.from(values).sort((a, b) => a.localeCompare(b, "tr"));
  }, [dateFilteredData, getRowValue, statusFilterKey]);

  const filteredData = React.useMemo(() => {
    if (!statusFilterKey || statusFilterValue === "all") {
      return dateFilteredData;
    }

    return dateFilteredData.filter((row) => {
      const raw = getRowValue(row, statusFilterKey);
      const value = raw === null || raw === undefined ? "" : String(raw).trim();
      return value.toLowerCase() === statusFilterValue.toLowerCase();
    });
  }, [dateFilteredData, getRowValue, statusFilterKey, statusFilterValue]);

  const normalizeSearchText = React.useCallback((value: string) => {
    return value
      .toLocaleLowerCase("tr")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }, []);

  const valueToSearchBlob = React.useCallback((value: unknown): string => {
    if (value === null || value === undefined) {
      return "";
    }

    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }

    if (Array.isArray(value)) {
      return value.map((item) => valueToSearchBlob(item)).join(" ");
    }

    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? "" : value.toISOString();
    }

    if (typeof value === "object") {
      return Object.values(value as Record<string, unknown>)
        .map((item) => valueToSearchBlob(item))
        .join(" ");
    }

    return "";
  }, []);

  const searchFilteredData = React.useMemo(() => {
    if (!enableSearch) {
      return filteredData;
    }

    const query = globalFilter.trim();
    if (!query) {
      return filteredData;
    }

    const normalizedQuery = normalizeSearchText(query);

    return filteredData.filter((row) => {
      const blob = valueToSearchBlob(row);
      return normalizeSearchText(blob).includes(normalizedQuery);
    });
  }, [enableSearch, filteredData, globalFilter, normalizeSearchText, valueToSearchBlob]);

  const table = useReactTable({
    data: searchFilteredData,
    columns,
    state: {
      sorting,
    },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: {
      pagination: {
        pageSize,
      },
    },
  });

  const clearFilters = () => {
    setGlobalFilter("");
    setStatusFilterValue("all");
    setDateFrom(undefined);
    setDateTo(undefined);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div
          className={cn(
            "flex items-center gap-2",
            filtersInline
              ? "w-full overflow-x-auto pb-1 md:flex-nowrap"
              : "w-full flex-wrap"
          )}
        >
          {enableSearch ? (
            <Input
              placeholder={searchPlaceholder}
              value={globalFilter}
              onChange={(event) => setGlobalFilter(event.target.value)}
              className={cn(filtersInline ? "min-w-[14rem] w-72" : "w-full sm:w-72")}
            />
          ) : null}

          {statusFilterKey ? (
            <Select
              value={statusFilterValue}
              onChange={(event) => setStatusFilterValue(event.target.value)}
              className={cn(filtersInline ? "min-w-[11rem] w-48" : "w-full sm:w-48")}
            >
              <option value="all">{statusFilterLabel}: Tümü</option>
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </Select>
          ) : null}

          {dateFilterKey ? (
            <div className={cn("flex items-center gap-2", filtersInline ? "flex-nowrap" : "flex-wrap")}>
              <div className="px-1 text-[10px] font-black uppercase tracking-widest text-slate-500">
                {dateFilterLabel}
              </div>
              <DatePicker
                value={dateFrom}
                onChange={setDateFrom}
                placeholder="Başlangıç"
                className={cn(filtersInline ? "min-w-[10.5rem] w-44" : "w-full sm:w-40")}
              />
              <DatePicker
                value={dateTo}
                onChange={setDateTo}
                placeholder="Bitiş"
                className={cn(filtersInline ? "min-w-[10.5rem] w-44" : "w-full sm:w-40")}
                minDate={dateFrom}
              />
            </div>
          ) : null}

          {(globalFilter || statusFilterValue !== "all" || dateFrom || dateTo) ? (
            <Button className="cursor-pointer" variant="outline" size="sm" onClick={clearFilters}>
              Filtreleri Temizle
            </Button>
          ) : null}
        </div>

        <div className="text-xs text-slate-500">
          Toplam: {searchFilteredData.length}
        </div>
      </div>

      <div className="w-full overflow-x-auto">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();

                  return (
                    <TableHead key={header.id}>
                      {header.isPlaceholder ? null : (
                        <button
                          type="button"
                          onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                          className={cn(
                            "inline-flex items-center gap-1 cursor-pointer",
                            canSort ? "cursor-pointer select-none hover:text-white" : "cursor-default"
                          )}
                        >
                          <span>{flexRender(header.column.columnDef.header, header.getContext())}</span>
                          {canSort ? (
                            sorted === "asc" ? (
                              <ArrowUp className="h-3.5 w-3.5" />
                            ) : sorted === "desc" ? (
                              <ArrowDown className="h-3.5 w-3.5" />
                            ) : (
                              <ArrowUpDown className="h-3.5 w-3.5" />
                            )
                          ) : null}
                        </button>
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center text-slate-500">
                  {emptyMessage}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button
          variant="outline"
          className="cursor-pointer"
          size="sm"
          onClick={() => table.previousPage()}
          disabled={!table.getCanPreviousPage()}
        >
          Önceki
        </Button>
        <Button
          variant="outline"
          className="cursor-pointer"
          size="sm"
          onClick={() => table.nextPage()}
          disabled={!table.getCanNextPage()}
        >
          Sonraki
        </Button>
      </div>
    </div>
  );
}
