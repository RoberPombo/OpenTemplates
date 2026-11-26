import { useCallback, type KeyboardEvent } from "react";

/**
 * Cierra un diálogo con Escape sin interferir con controles que ya consumieron
 * la tecla (por ejemplo, un combobox abierto o la propia paleta de comandos).
 */
export function useDialogDismiss(onClose: () => void) {
  return useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.stopPropagation();
      onClose();
    },
    [onClose],
  );
}
