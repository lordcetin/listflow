"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker } from "react-day-picker";
import { tr } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  const navButtonClassName = cn(
    buttonVariants({ variant: "outline", size: "icon" }),
    "h-7 w-7 rounded-md border-white/10 bg-transparent p-0 text-slate-300 opacity-80 hover:opacity-100"
  );

  return (
    <DayPicker
      locale={tr}
      showOutsideDays={showOutsideDays}
      className={cn("p-3", className)}
      classNames={{
        months: "flex flex-col sm:flex-row gap-4",
        month: "space-y-3",
        month_caption: "relative flex h-9 items-center justify-center",
        caption_label: "text-sm font-black text-slate-100",
        nav: "absolute inset-y-0 left-0 right-0 flex items-center justify-between px-1",
        button_previous: navButtonClassName,
        button_next: navButtonClassName,
        chevron: "h-4 w-4",
        month_grid: "w-full border-collapse",
        weekdays: "",
        weekday: "h-8 w-9 p-0 text-center text-[11px] font-black uppercase text-slate-500",
        weeks: "",
        week: "",
        day: "h-9 w-9 p-0 text-center align-middle",
        day_button: cn(
          buttonVariants({ variant: "ghost", size: "icon" }),
          "h-9 w-9 rounded-md p-0 text-sm font-medium normal-case tracking-normal text-slate-200"
        ),
        selected:
          "bg-indigo-600 text-white hover:bg-indigo-500 hover:text-white focus:bg-indigo-500 focus:text-white",
        today: "bg-white/10 text-white",
        outside: "text-slate-600 opacity-60",
        disabled: "text-slate-600 opacity-40",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({
          className: iconClassName,
          orientation,
          ...iconProps
        }: {
          className?: string;
          size?: number;
          disabled?: boolean;
          orientation?: "up" | "down" | "left" | "right";
        }) => {
          if (orientation === "left") {
            return <ChevronLeft className={cn("h-4 w-4", iconClassName)} {...iconProps} />;
          }

          if (orientation === "right") {
            return <ChevronRight className={cn("h-4 w-4", iconClassName)} {...iconProps} />;
          }

          if (orientation === "up") {
            return <ChevronLeft className={cn("h-4 w-4 rotate-90", iconClassName)} {...iconProps} />;
          }

          return <ChevronRight className={cn("h-4 w-4 rotate-90", iconClassName)} {...iconProps} />;
        },
      }}
      {...props}
    />
  );
}

Calendar.displayName = "Calendar";

export { Calendar };
