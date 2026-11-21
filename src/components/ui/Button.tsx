import { Button as BaseButton } from "@base-ui/react/button";
import type { ComponentProps } from "react";

export type ButtonVariant = "primary" | "ghost" | "danger" | "icon";
export type ButtonSize = "default" | "small";

type Props = Omit<ComponentProps<typeof BaseButton>, "className" | "size"> & {
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

  return <BaseButton {...props} type={type} className={classes} />;
}
