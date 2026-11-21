import type { ComponentProps } from "react";

type Props = ComponentProps<"input">;

export function TextInput({ className, ...props }: Props) {
  return <input {...props} className={["text-input", className].filter(Boolean).join(" ")} />;
}
