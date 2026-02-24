"use client";

import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

const EMPTY_VALUE = "__empty__";

type NativeSelectChangeEvent = React.ChangeEvent<HTMLSelectElement>;

export type SelectProps = {
  className?: string;
  children?: React.ReactNode;
  value?: string;
  defaultValue?: string;
  onChange?: (event: NativeSelectChangeEvent) => void;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  id?: string;
};

type ParsedOption = {
  value: string;
  label: string;
  disabled: boolean;
};

const optionElementTypes = new Set(["option", "optgroup"]);

type OptionLikeProps = {
  children?: React.ReactNode;
  value?: string | number | null;
  disabled?: boolean;
};

const getTextContent = (node: React.ReactNode): string => {
  if (node === null || node === undefined || typeof node === "boolean") {
    return "";
  }

  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }

  if (Array.isArray(node)) {
    return node.map((item) => getTextContent(item)).join("");
  }

  if (React.isValidElement(node)) {
    const element = node as React.ReactElement<{ children?: React.ReactNode }>;
    return getTextContent(element.props.children);
  }

  return "";
};

const collectOptions = (node: React.ReactNode, output: ParsedOption[]) => {
  for (const child of React.Children.toArray(node)) {
    if (!React.isValidElement(child)) {
      continue;
    }

    const element = child as React.ReactElement<OptionLikeProps>;

    if (element.type === React.Fragment) {
      collectOptions(element.props.children, output);
      continue;
    }

    if (typeof element.type !== "string" || !optionElementTypes.has(element.type)) {
      continue;
    }

    if (element.type === "optgroup") {
      collectOptions(element.props.children, output);
      continue;
    }

    const rawValue = element.props.value;
    const value = rawValue == null ? "" : String(rawValue);
    const labelFromChildren = getTextContent(element.props.children).trim();

    output.push({
      value,
      label: labelFromChildren || value,
      disabled: Boolean(element.props.disabled),
    });
  }
};

const toSyntheticChangeEvent = (value: string, name: string | undefined): NativeSelectChangeEvent => {
  const target = {
    value,
    name: name ?? "",
  } as EventTarget & HTMLSelectElement;

  return {
    target,
    currentTarget: target,
  } as NativeSelectChangeEvent;
};

const Select = React.forwardRef<HTMLButtonElement, SelectProps>(
  (
    {
      className,
      children,
      value,
      defaultValue,
      onChange,
      disabled,
      required,
      name,
      id
    },
    ref
  ) => {
    const options = React.useMemo(() => {
      const parsed: ParsedOption[] = [];
      collectOptions(children, parsed);
      return parsed;
    }, [children]);

    const placeholderOption = options.find((option) => option.value === "");
    const selectableOptions = options.filter((option) => option.value !== "");
    const hasEmptyOption = Boolean(placeholderOption);
    const placeholder = placeholderOption?.label ?? "Seçiniz";

    const normalizedValue = value !== undefined ? (value === "" ? EMPTY_VALUE : value) : undefined;
    const normalizedDefaultValue =
      defaultValue !== undefined ? (defaultValue === "" ? EMPTY_VALUE : defaultValue) : undefined;
    const actualValue = normalizedValue === EMPTY_VALUE ? "" : normalizedValue ?? "";

    return (
      <div className="w-full">
        <SelectPrimitive.Root
          value={normalizedValue}
          defaultValue={normalizedDefaultValue}
          onValueChange={(nextValue) => {
            const resolved = nextValue === EMPTY_VALUE ? "" : nextValue;
            onChange?.(toSyntheticChangeEvent(resolved, name));
          }}
          disabled={disabled}
          name={name}
        >
          <SelectPrimitive.Trigger
            ref={ref}
            id={id}
            className={cn(
              "flex h-10 w-full items-center justify-between rounded-xl border border-white/10 bg-[#0a0a0c] px-3 py-2 text-sm text-white ring-offset-background placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/70 disabled:cursor-not-allowed disabled:opacity-50",
              className
            )}
          >
            <SelectPrimitive.Value placeholder={placeholder} />
            <SelectPrimitive.Icon asChild>
              <ChevronDown className="h-4 w-4 text-slate-400" />
            </SelectPrimitive.Icon>
          </SelectPrimitive.Trigger>

          <SelectPrimitive.Portal>
            <SelectPrimitive.Content
              position="popper"
              className="z-[120] min-w-[8rem] max-h-72 overflow-hidden rounded-xl border border-white/10 bg-[#0a0a0c] text-white shadow-2xl"
            >
              <SelectPrimitive.ScrollUpButton className="flex h-6 items-center justify-center text-slate-400">
                <ChevronUp className="h-4 w-4" />
              </SelectPrimitive.ScrollUpButton>
              <SelectPrimitive.Viewport className="max-h-64 overflow-y-auto p-1 custom-scrollbar">
                {hasEmptyOption ? (
                  <SelectPrimitive.Item
                    value={EMPTY_VALUE}
                    disabled={placeholderOption?.disabled}
                    className="relative flex w-full cursor-pointer select-none items-center rounded-md py-2 pl-3 pr-8 text-sm text-slate-200 outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-white/10 data-[highlighted]:text-white"
                  >
                    <SelectPrimitive.ItemText>{placeholder}</SelectPrimitive.ItemText>
                    <SelectPrimitive.ItemIndicator className="absolute right-2 inline-flex items-center">
                      <Check className="h-4 w-4" />
                    </SelectPrimitive.ItemIndicator>
                  </SelectPrimitive.Item>
                ) : null}

                {selectableOptions.map((option) => (
                  <SelectPrimitive.Item
                    key={option.value}
                    value={option.value}
                    disabled={option.disabled}
                    className="relative flex w-full cursor-pointer select-none items-center rounded-md py-2 pl-3 pr-8 text-sm text-slate-200 outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-white/10 data-[highlighted]:text-white"
                  >
                    <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                    <SelectPrimitive.ItemIndicator className="absolute right-2 inline-flex items-center">
                      <Check className="h-4 w-4" />
                    </SelectPrimitive.ItemIndicator>
                  </SelectPrimitive.Item>
                ))}
              </SelectPrimitive.Viewport>
              <SelectPrimitive.ScrollDownButton className="flex h-6 items-center justify-center text-slate-400">
                <ChevronUp className="h-4 w-4 rotate-180" />
              </SelectPrimitive.ScrollDownButton>
            </SelectPrimitive.Content>
          </SelectPrimitive.Portal>
        </SelectPrimitive.Root>

        {name ? (
          <input
            type="hidden"
            name={name}
            value={actualValue}
            required={required}
            aria-hidden="true"
            readOnly
          />
        ) : null}
      </div>
    );
  }
);

Select.displayName = "Select";

export { Select };
