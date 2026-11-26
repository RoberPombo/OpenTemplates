import type { ComponentProps } from "react";

export type ButtonVariant = "primary" | "ghost" | "danger" | "icon";
export type ButtonSize = "default" | "small";

/**
 * Native button on purpose: Base UI's button adds no behaviour for these
 * simple controls and pulled ~9 kB of render helpers into the initial chunk.
 * Complex primitives (Select, Combobox) stay on Base UI.
 */
type Props = Omit<ComponentProps<"button">, "className" | "size"> & {
  className?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
};

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "primary",
  ghost: "ghost",
  danger: "danger",
  icon: "icon-button",
};

export function Button({
  variant = "ghost",
  size = "default",
  className,
  type = "button",
  ...props
}: Props) {
  const classes = [VARIANT_CLASS[variant], size === "small" && "small", className]
    .filter(Boolean)
    .join(" ");

  return <button {...props} type={type} className={classes} />;
}
