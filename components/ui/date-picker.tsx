"use client";

import * as React from "react";
import { CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type DatePickerProps = {
  value?: Date;
  onChange: (date: Date | undefined) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  minDate?: Date;
  maxDate?: Date;
};

const formatDate = (date: Date) => {
  return new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
};

export function DatePicker({
  value,
  onChange,
  placeholder = "Tarih seç",
  className,
  disabled,
  minDate,
  maxDate,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          disabled={disabled}
          className={cn(
            "h-10 w-full justify-start rounded-xl border-white/10 bg-[#0a0a0c] px-3 py-2 text-left text-sm font-medium normal-case tracking-normal text-slate-200 hover:bg-white/5",
            !value && "text-slate-500",
            className
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4 shrink-0 text-slate-400" />
          <span className="truncate">{value ? formatDate(value) : placeholder}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={value}
          onSelect={(selectedDate) => {
            onChange(selectedDate);
            setOpen(false);
          }}
          disabled={(date) => {
            if (minDate && date < minDate) {
              return true;
            }

            if (maxDate && date > maxDate) {
              return true;
            }

            return false;
          }}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}
